import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParserSnapshotMessage } from '../contracts';
import { OBSERVATION_ROOT_SELECTOR } from './adapters/recommend';
import { startParserCoordinator } from './coordinator';


const capturedAt = new Date('2026-07-29T02:00:00.000Z');

type RuntimeListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

class FakeObserver {
  static instances: FakeObserver[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly takeRecords = vi.fn(() => []);

  constructor(private readonly callback: MutationCallback) {
    FakeObserver.instances.push(this);
  }

  emit(): void {
    this.callback([], this as unknown as MutationObserver);
  }
}


function createRuntimeOnMessage() {
  let listener: RuntimeListener | undefined;
  const addListener = vi.fn((nextListener: RuntimeListener) => {
    listener = nextListener;
  });
  const removeListener = vi.fn((removedListener: RuntimeListener) => {
    if (listener === removedListener) {
      listener = undefined;
    }
  });

  return {
    event: {
      addListener,
      removeListener,
      hasListener: vi.fn(),
      hasListeners: vi.fn(),
      addRules: vi.fn(),
      getRules: vi.fn(),
      removeRules: vi.fn(),
    } as unknown as typeof chrome.runtime.onMessage,
    addListener,
    removeListener,
    getListener: () => listener,
  };
}


function setRecommendFixture(): Element {
  document.body.innerHTML = `
    <section class="card-list">
      <article class="candidate-card-wrap active">
        <span class="name">匿名候选人</span>
        <div class="base-info"><span>华东</span><span>3 年</span></div>
        <div class="expect-wrap"><span class="content">平台工程师</span></div>
      </article>
    </section>`;

  return document.querySelector('.card-list')!;
}


function createDeferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
}


async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}


describe('parser coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    FakeObserver.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('parses immediately, debounces mutations, deduplicates unchanged snapshots, and disconnects once', () => {
    const observationRoot = setRecommendFixture();
    const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);
    let nowOffset = 0;
    const now = vi.fn(
      () => new Date(capturedAt.getTime() + nowOffset++ * 1_000),
    );

    const handle = startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now,
    });

    expect(now).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'ARC_PARSER_SNAPSHOT',
      snapshot: {
        page_kind: 'recommend_frame',
        profile: { display_name: '匿名候选人' },
      },
    });
    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0].observe).toHaveBeenCalledWith(observationRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-selected', 'hidden', 'aria-hidden'],
    });

    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(300);
    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(399);
    expect(now).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(now).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    document.querySelector('.candidate-card-wrap .name')!.textContent = '匿名候选人乙';
    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);
    expect(now).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0].snapshot.profile?.display_name).toBe('匿名候选人乙');

    handle.stop();
    handle.stop();
    expect(FakeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('reparses when active-card markers switch without structural or text changes', () => {
    document.body.innerHTML = `
      <section class="card-list">
        <article class="candidate-card-wrap active">
          <span class="name">匿名候选人甲</span>
        </article>
        <article class="candidate-card-wrap">
          <span class="name">匿名候选人乙</span>
        </article>
      </section>`;
    const cards = document.querySelectorAll('.candidate-card-wrap');
    const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    expect(sendMessage.mock.calls[0][0].snapshot.profile?.display_name)
      .toBe('匿名候选人甲');
    cards[0].classList.remove('active');
    cards[1].setAttribute('aria-selected', 'true');
    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0].snapshot.profile?.display_name)
      .toBe('匿名候选人乙');
  });

  it('forces an unchanged snapshot on the exact refresh command and removes the listener on stop', () => {
    setRecommendFixture();
    const runtime = createRuntimeOnMessage();
    const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);
    const handle = startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      runtimeOnMessage: runtime.event,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });
    const listener = runtime.getListener();

    expect(runtime.addListener).toHaveBeenCalledTimes(1);
    expect(listener).toBeDefined();
    listener?.(
      { type: 'ARC_PARSER_REFRESH' },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);

    listener?.(
      { type: 'ARC_PARSER_REFRESH_COMMAND' },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);

    FakeObserver.instances[0].emit();
    handle.stop();
    expect(runtime.removeListener).toHaveBeenCalledOnce();
    expect(runtime.removeListener).toHaveBeenCalledWith(listener);

    vi.advanceTimersByTime(400);
    listener?.(
      { type: 'ARC_PARSER_REFRESH_COMMAND' },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );
    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('sends only a safe logged-out snapshot and never constructs an observer', () => {
    document.body.innerHTML = '<a>登录/注册</a>';
    const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/',
      isTopFrame: true,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: 'ARC_PARSER_SNAPSHOT',
      snapshot: {
        schema_version: 1,
        parser_version: 'boss-dom-v1',
        page_kind: 'logged_out',
        status: 'ready',
        captured_at: capturedAt.toISOString(),
        present_fields: [],
        missing_fields: [],
        warnings: [],
      },
    });
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('observes the first visible resume root for the highest-priority selector', () => {
    document.body.innerHTML = `
      <main class="resume-content" hidden><span class="resume-name">隐藏候选人</span></main>
      <main class="resume-content"><span class="resume-name">匿名候选人</span></main>
      <section class="resume-box"><span class="resume-name">备用候选人</span></section>`;
    const visibleRoot = document.querySelectorAll('.resume-content')[1];

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/c-resume',
      isTopFrame: false,
      sendMessage: vi.fn(async () => undefined),
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0].observe).toHaveBeenCalledWith(
      visibleRoot,
      expect.objectContaining({ childList: true, subtree: true, characterData: true }),
    );
  });

  it('sanitizes adapter exceptions and does not observe when no recognized root remains', () => {
    const secret = 'private DOM text';
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll')
      .mockImplementation(() => {
        throw new Error(secret);
      });
    const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'ARC_PARSER_SNAPSHOT',
      snapshot: {
        page_kind: 'recommend_frame',
        status: 'error',
        warnings: ['parser-exception'],
      },
    });
    expect(JSON.stringify(sendMessage.mock.calls[0][0])).not.toContain(secret);
    expect(FakeObserver.instances).toHaveLength(0);
    querySelectorAll.mockRestore();
  });

  it('sends a sanitized error snapshot when only observation-root lookup throws', () => {
    setRecommendFixture();
    const secret = 'private observation root text';
    const originalQuerySelectorAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, 'querySelectorAll').mockImplementation((selector) => {
      if (selector === OBSERVATION_ROOT_SELECTOR) {
        throw new Error(secret);
      }
      return originalQuerySelectorAll(selector);
    });
    const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'ARC_PARSER_SNAPSHOT',
      snapshot: {
        page_kind: 'recommend_frame',
        status: 'error',
        warnings: ['parser-exception'],
      },
    });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(secret);
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('contains sendMessage rejections instead of leaking them', async () => {
    document.body.innerHTML = '<a>登录/注册</a>';
    const sendMessage = vi.fn().mockRejectedValue(new Error('network detail'));

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/',
      isTopFrame: true,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(JSON.stringify(sendMessage.mock.calls[0][0])).not.toContain('network detail');
  });

  it('retries an unchanged snapshot after the default runtime transport returns a false ack', async () => {
    setRecommendFixture();
    const runtimeSendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage: runtimeSendMessage } });

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });
    await flushMicrotasks();

    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);

    expect(runtimeSendMessage).toHaveBeenCalledTimes(2);
    await flushMicrotasks();

    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);
    expect(runtimeSendMessage).toHaveBeenCalledTimes(2);
  });

  it('retries an unchanged snapshot after the previous transport rejects', async () => {
    setRecommendFixture();
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error('transient relay failure'))
      .mockResolvedValueOnce(undefined);

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });
    await flushMicrotasks();

    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0].snapshot.profile?.display_name)
      .toBe('匿名候选人');
    await flushMicrotasks();
  });

  it('does not let an older relay success replace a newer successful key', async () => {
    setRecommendFixture();
    const olderRelay = createDeferred();
    const newerRelay = createDeferred();
    const sendMessage = vi.fn()
      .mockImplementationOnce(() => olderRelay.promise)
      .mockImplementationOnce(() => newerRelay.promise);

    startParserCoordinator({
      targetDocument: document,
      currentUrl: 'https://www.zhipin.com/web/frame/recommend',
      isTopFrame: false,
      sendMessage,
      Observer: FakeObserver as unknown as typeof MutationObserver,
      now: () => capturedAt,
    });

    document.querySelector('.candidate-card-wrap .name')!.textContent = '匿名候选人乙';
    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    newerRelay.resolve(undefined);
    await flushMicrotasks();
    olderRelay.resolve(undefined);
    await flushMicrotasks();

    FakeObserver.instances[0].emit();
    vi.advanceTimersByTime(400);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
