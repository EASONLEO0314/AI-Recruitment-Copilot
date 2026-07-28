import { describe, expect, it, vi } from 'vitest';

import { handleApiRequest, isApiRequestMessage } from './background';


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
