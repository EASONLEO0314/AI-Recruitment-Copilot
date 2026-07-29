import { describe, expect, it, vi } from 'vitest';

import type { PageKind, ParserRelayMessage, ParserStatus } from '../contracts';
import {
  acceptParserRelay,
  isParserRelayMessage,
  requestParserRefresh,
  subscribeToParserRelays,
} from './client';


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
