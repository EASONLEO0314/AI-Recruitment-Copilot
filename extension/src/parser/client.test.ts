import { describe, expect, it, vi } from 'vitest';

import type { PageKind, ParserRelayMessage, ParserStatus } from '../contracts';
import {
  acceptParserRelay,
  isParserRelayMessage,
  requestParserRefresh,
  requestResumeRead,
  selectBestParserRelay,
  subscribeToParserRelays,
  upsertParserRelay,
} from './client';
import { buildProfileSnapshot } from './snapshot';


function relay(
  pageKind: PageKind,
  status: ParserStatus,
  capturedAt: string,
): ParserRelayMessage {
  return {
    type: 'ARC_PARSER_RELAY',
    snapshot: {
      schema_version: 1,
      parser_version: 'boss-dom-v1',
      page_kind: pageKind,
      status,
      captured_at: capturedAt,
      present_fields: [],
      missing_fields: [],
      warnings: [],
    },
    source: { frame_id: 0, document_id: 'anonymous-document' },
  };
}


function frameRelay(
  frameId: number,
  pageKind: PageKind,
  status: ParserStatus,
  capturedAt: string,
  warnings: string[] = [],
): ParserRelayMessage {
  const message = relay(pageKind, status, capturedAt);
  return {
    ...message,
    snapshot: { ...message.snapshot, warnings },
    source: {
      frame_id: frameId,
      document_id: `anonymous-document-${frameId}`,
    },
  };
}


function runtimeHarness() {
  type RuntimeListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
  let installed: RuntimeListener | null = null;
  const addListener = vi.fn((listener: RuntimeListener) => {
    installed = listener;
  });
  const removeListener = vi.fn((listener: RuntimeListener) => {
    if (installed === listener) {
      installed = null;
    }
  });

  return {
    emit(message: unknown) {
      installed?.(message, {} as chrome.runtime.MessageSender, vi.fn());
    },
    runtime: {
      onMessage: { addListener, removeListener },
    } as unknown as typeof chrome.runtime,
    addListener,
    removeListener,
  };
}


describe('parser relay validation', () => {
  it('accepts a validated snapshot and future source metadata', () => {
    const message = {
      ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'),
      source: {
        frame_id: 0,
        document_id: 'anonymous-document',
        future_metadata: 'allowed',
      },
    };

    expect(isParserRelayMessage(message)).toBe(true);
  });

  it.each([
    null,
    { type: 'ARC_PARSER_RELAY' },
    { ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'), type: 'OTHER' },
    { ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'), snapshot: {} },
    { ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'), source: null },
    {
      ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'),
      source: { frame_id: -1, document_id: 'anonymous-document' },
    },
    {
      ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'),
      source: { frame_id: 1.5, document_id: 'anonymous-document' },
    },
    {
      ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'),
      source: { frame_id: Number.NaN, document_id: 'anonymous-document' },
    },
    {
      ...relay('resume_frame', 'ready', '2026-07-29T02:00:00.000Z'),
      source: { frame_id: 0, document_id: 7 },
    },
  ])('rejects an invalid relay %#', (message) => {
    expect(isParserRelayMessage(message)).toBe(false);
  });
});


describe('parser relay acceptance', () => {
  it.each(['non_candidate', 'unsupported'] as const)(
    'does not let a %s shell overwrite a candidate snapshot',
    (pageKind) => {
      const current = relay('resume_frame', 'ready', '2026-07-29T02:00:01.000Z');
      const shell = relay(pageKind, 'ready', '2026-07-29T02:00:02.000Z');

      expect(acceptParserRelay(current, shell)).toBe(current);
    },
  );

  it('rejects a relay older than the current snapshot', () => {
    const newer = relay('resume_frame', 'ready', '2026-07-29T02:00:02.000Z');
    const older = relay('resume_frame', 'ready', '2026-07-29T02:00:01.000Z');

    expect(acceptParserRelay(newer, older)).toBe(newer);
  });

  it('always accepts logged-out and otherwise accepts same-time or newer relays', () => {
    const candidate = relay('recommend_frame', 'ready', '2026-07-29T02:00:02.000Z');
    const olderLoggedOut = relay('logged_out', 'ready', '2026-07-29T02:00:01.000Z');
    const sameTimeCandidate = relay('resume_frame', 'partial', '2026-07-29T02:00:02.000Z');
    const newerCandidate = relay('resume_frame', 'ready', '2026-07-29T02:00:03.000Z');

    expect(acceptParserRelay(candidate, olderLoggedOut)).toBe(olderLoggedOut);
    expect(acceptParserRelay(candidate, sameTimeCandidate)).toBe(sameTimeCandidate);
    expect(acceptParserRelay(candidate, newerCandidate)).toBe(newerCandidate);
    expect(acceptParserRelay(null, candidate)).toBe(candidate);
  });

  it('keeps a logged-out safety watermark until a truly newer candidate arrives', () => {
    const candidateAtTwo = relay('recommend_frame', 'ready', '2026-07-29T02:00:02.000Z');
    const loggedOutAtOne = relay('logged_out', 'ready', '2026-07-29T02:00:01.000Z');
    const delayedCandidateAtTwo = relay('resume_frame', 'ready', '2026-07-29T02:00:02.000Z');
    const candidateAtThree = relay('resume_frame', 'ready', '2026-07-29T02:00:03.000Z');

    let current = acceptParserRelay(null, candidateAtTwo);
    current = acceptParserRelay(current, loggedOutAtOne);
    expect(current).toBe(loggedOutAtOne);
    expect(current.snapshot.captured_at).toBe('2026-07-29T02:00:01.000Z');

    current = acceptParserRelay(current, delayedCandidateAtTwo);
    expect(current).toBe(loggedOutAtOne);

    current = acceptParserRelay(current, candidateAtThree);
    expect(current).toBe(candidateAtThree);
  });
});


describe('parser frame registry and deterministic selection', () => {
  it('keeps the latest relay for every frame without arrival-order replacement', () => {
    const frameTwo = frameRelay(
      2,
      'recommend_frame',
      'unsupported',
      '2026-07-29T02:00:02.000Z',
    );
    const frameSeven = frameRelay(
      7,
      'resume_frame',
      'unsupported',
      '2026-07-29T02:00:03.000Z',
    );
    const olderFrameTwo = frameRelay(
      2,
      'unsupported',
      'unsupported',
      '2026-07-29T02:00:01.000Z',
    );

    let registry = upsertParserRelay([], frameTwo);
    registry = upsertParserRelay(registry, frameSeven);
    registry = upsertParserRelay(registry, olderFrameTwo);

    expect(registry.map((message) => message.source.frame_id)).toEqual([2, 7]);
    expect(registry[0]).toBe(frameTwo);
    expect(registry[1]).toBe(frameSeven);
  });

  it('drops stale child frames when the top document changes', () => {
    const oldTop = frameRelay(
      0,
      'non_candidate',
      'ready',
      '2026-07-29T02:00:01.000Z',
    );
    const oldCandidate = frameRelay(
      2,
      'recommend_frame',
      'unsupported',
      '2026-07-29T02:00:02.000Z',
      ['probe:heading=work:1'],
    );
    const newTop = frameRelay(
      0,
      'non_candidate',
      'ready',
      '2026-07-29T02:00:03.000Z',
    );
    newTop.source.document_id = 'new-top-document';

    let registry = upsertParserRelay([], oldTop);
    registry = upsertParserRelay(registry, oldCandidate);
    registry = upsertParserRelay(registry, newTop);

    expect(registry).toEqual([newTop]);
  });

  it('prefers semantic heading evidence over a newer sparse candidate frame', () => {
    const richFrame = frameRelay(
      2,
      'recommend_frame',
      'unsupported',
      '2026-07-29T02:00:02.000Z',
      [
        'probe:visible-elements=88',
        'probe:heading=work:1',
        'probe:heading=education:1',
      ],
    );
    const sparseFrame = frameRelay(
      7,
      'resume_frame',
      'unsupported',
      '2026-07-29T02:00:03.000Z',
      ['probe:visible-elements=10'],
    );

    const selection = selectBestParserRelay([sparseFrame, richFrame]);

    expect(selection?.relay).toBe(richFrame);
    expect(selection?.reason).toBe('semantic_headings');
  });

  it('prefers parsed profile evidence and keeps logged-out state authoritative', () => {
    const parsedFrame = frameRelay(
      4,
      'recommend_frame',
      'partial',
      '2026-07-29T02:00:02.000Z',
    );
    parsedFrame.snapshot = buildProfileSnapshot('recommend_frame', {
      education: [],
      work_experiences: [{ raw_text: '仅用于测试的工作经历' }],
      project_experiences: [],
      skills: [],
    }, new Date('2026-07-29T02:00:02.000Z'));
    const semanticFrame = frameRelay(
      2,
      'recommend_frame',
      'unsupported',
      '2026-07-29T02:00:03.000Z',
      ['probe:heading=work:1'],
    );
    const loggedOut = frameRelay(
      0,
      'logged_out',
      'ready',
      '2026-07-29T02:00:04.000Z',
    );

    expect(selectBestParserRelay([semanticFrame, parsedFrame])?.relay).toBe(parsedFrame);
    expect(selectBestParserRelay([semanticFrame, parsedFrame])?.reason)
      .toBe('profile_evidence');
    expect(selectBestParserRelay([semanticFrame, parsedFrame, loggedOut])?.relay)
      .toBe(loggedOut);
  });

  it('prefers semantic resume sections over a sparse list-card profile', () => {
    const sparseProfile = frameRelay(
      4,
      'recommend_frame',
      'partial',
      '2026-07-29T02:00:03.000Z',
    );
    sparseProfile.snapshot = buildProfileSnapshot('recommend_frame', {
      display_name: '候选人列表卡片',
      education: [],
      work_experiences: [],
      project_experiences: [],
      skills: ['TypeScript'],
    }, new Date('2026-07-29T02:00:03.000Z'));
    const semanticFrame = frameRelay(
      2,
      'recommend_frame',
      'unsupported',
      '2026-07-29T02:00:02.000Z',
      ['probe:heading=work:1', 'probe:heading=education:1'],
    );

    const selection = selectBestParserRelay([sparseProfile, semanticFrame]);

    expect(selection?.relay).toBe(semanticFrame);
    expect(selection?.reason).toBe('semantic_headings');
  });
});


describe('parser relay subscription', () => {
  it('installs one listener, emits only valid relays, and removes the same listener', () => {
    const harness = runtimeHarness();
    const listener = vi.fn();
    const valid = relay('logged_out', 'ready', '2026-07-29T02:00:00.000Z');

    const remove = subscribeToParserRelays(listener, harness.runtime);

    expect(harness.addListener).toHaveBeenCalledOnce();
    harness.emit({ type: 'ARC_PARSER_RELAY', snapshot: {}, source: {} });
    expect(listener).not.toHaveBeenCalled();
    harness.emit(valid);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(valid);

    const installedListener = harness.addListener.mock.calls[0][0];
    remove();
    expect(harness.removeListener).toHaveBeenCalledOnce();
    expect(harness.removeListener).toHaveBeenCalledWith(installedListener);
    harness.emit(valid);
    expect(listener).toHaveBeenCalledOnce();
  });
});


describe('parser refresh', () => {
  it('sends only the fixed refresh message and resolves for an exact true ack', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });

    await expect(requestParserRefresh(sendMessage)).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ARC_PARSER_REFRESH' });
  });

  it.each([
    { ok: false },
    { ok: true, extra: true },
    true,
    undefined,
  ])('rejects an invalid refresh acknowledgement %#', async (acknowledgement) => {
    const sendMessage = vi.fn().mockResolvedValue(acknowledgement);

    await expect(requestParserRefresh(sendMessage)).rejects.toThrow('Parser refresh was not acknowledged');
  });

  it('propagates a runtime rejection', async () => {
    const failure = new Error('runtime unavailable');
    const sendMessage = vi.fn().mockRejectedValue(failure);

    await expect(requestParserRefresh(sendMessage)).rejects.toBe(failure);
  });
});


describe('user-triggered resume read', () => {
  const snapshot = {
    schema_version: 1,
    parser_version: 'boss-vue-v1',
    page_kind: 'recommend_frame',
    status: 'partial',
    captured_at: '2026-08-07T02:00:00.000Z',
    present_fields: [],
    missing_fields: [],
    warnings: [
      'vue-capability:root=lib-resume-recommend',
      'vue-capability:generation=vue2',
      'vue-capability:resume-object=resumeInfo',
      'vue-capability:key=geekBaseInfo',
    ],
  } as const;

  it('sends exactly one fixed request and returns a validated capability snapshot', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, snapshot });

    await expect(requestResumeRead(sendMessage)).resolves.toEqual({ ok: true, snapshot });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ARC_RESUME_READ' });
  });

  it('returns a validated fixed failure without retrying', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: 'vue-instance-not-found',
    });

    await expect(requestResumeRead(sendMessage)).resolves.toEqual({
      ok: false,
      error: 'vue-instance-not-found',
    });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it.each([
    { ok: false, error: 'private-page-error' },
    { ok: true, snapshot: { ...snapshot, parser_version: 'private-parser' } },
    { ok: true, snapshot, extra: 'private' },
    undefined,
  ])('rejects an invalid resume read response %#', async (response) => {
    const sendMessage = vi.fn().mockResolvedValue(response);

    await expect(requestResumeRead(sendMessage)).rejects.toThrow(
      'Resume read returned an invalid response',
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
