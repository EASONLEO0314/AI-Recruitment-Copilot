import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeMessageListener,
  handleApiRequest,
  isApiRequestMessage,
} from './background';


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


describe('background API transport', () => {
  it('fetches health from the one allowed localhost endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));

    const response = await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'health', timeout_ms: 1200 },
      fetcher,
    );

    expect(response).toEqual({ ok: true, data: { status: 'ok' } });
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/healthz',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('posts only the candidate label to the fixed demo endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ mode: 'demo' }));

    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'demo-assessment',
        candidate_label: '张同学',
        timeout_ms: 4500,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/demo/assessment',
      expect.objectContaining({
        body: JSON.stringify({ candidate_label: '张同学' }),
        method: 'POST',
      }),
    );
  });

  it('maps a non-success HTTP status to a typed failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, 503));

    const response = await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'health', timeout_ms: 1200 },
      fetcher,
    );

    expect(response).toEqual({
      ok: false,
      error: { code: 'REQUEST_FAILED', message: 'Local API returned HTTP 503' },
    });
  });

  it('maps invalid JSON to an invalid-response failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{broken', { status: 200 }));

    const response = await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'health', timeout_ms: 1200 },
      fetcher,
    );

    expect(response).toEqual({
      ok: false,
      error: { code: 'INVALID_RESPONSE', message: 'Local API returned invalid JSON' },
    });
  });

  it('rejects messages outside the two fixed API operations', () => {
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'proxy-url',
      url: 'https://example.com',
    })).toBe(false);
  });
});


describe('background runtime listener', () => {
  const parserSnapshot = {
    type: 'ARC_PARSER_SNAPSHOT',
    snapshot: {
      schema_version: 1,
      parser_version: 'boss-dom-v1',
      page_kind: 'logged_out',
      status: 'ready',
      captured_at: '2026-07-29T02:00:00.000Z',
      present_fields: [],
      missing_fields: [],
      warnings: [],
    },
  } as const;

  it('keeps the async channel open for API requests and sends the API response', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const routeParser = vi.fn().mockResolvedValue(true);
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(fetcher, routeParser);

    const keepChannelOpen = listener(
      { type: 'ARC_API_REQUEST', operation: 'health', timeout_ms: 1200 },
      {},
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { status: 'ok' } });
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/healthz',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(routeParser).not.toHaveBeenCalled();
  });

  it('routes parser snapshots without calling the injected API fetcher', async () => {
    const fetcher = vi.fn();
    const routeParser = vi.fn().mockResolvedValue(true);
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(fetcher, routeParser);
    const sender = { tab: { id: 17 }, frameId: 4, documentId: 'document-4' };

    const keepChannelOpen = listener(parserSnapshot, sender, sendResponse);

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
    expect(routeParser).toHaveBeenCalledWith(parserSnapshot, sender);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns parser validation failures without calling the API fetcher', async () => {
    const fetcher = vi.fn();
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(fetcher);

    const keepChannelOpen = listener(
      {
        ...parserSnapshot,
        snapshot: { ...parserSnapshot.snapshot, innerHTML: '<main>forbidden</main>' },
      },
      { tab: { id: 17 }, frameId: 4 },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, 'ARC_PARSER_SNAPSHOT', { type: 'UNKNOWN' }])(
    'rejects an unrelated message without calling API fetch for %j',
    (message) => {
      const fetcher = vi.fn();
      const routeParser = vi.fn();
      const sendResponse = vi.fn();
      const listener = createRuntimeMessageListener(fetcher, routeParser);

      expect(listener(message, {}, sendResponse)).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
      expect(routeParser).not.toHaveBeenCalled();
      expect(sendResponse).not.toHaveBeenCalled();
    },
  );
});
