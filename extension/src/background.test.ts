import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeMessageListener,
  handleApiRequest,
  isApiRequestMessage,
} from './background';
import * as backgroundModule from './background';


type ResumeReadHandler = (
  tabId: number,
  executeScript: (details: unknown) => Promise<Array<{ frameId: number; result?: unknown }>>,
  now: () => Date,
) => Promise<unknown>;


function resumeReadHandler(): ResumeReadHandler | undefined {
  return (backgroundModule as unknown as { handleResumeRead?: ResumeReadHandler }).handleResumeRead;
}


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

  it('responds with a false ack when the parser router rejects', async () => {
    const fetcher = vi.fn();
    const routeParser = vi.fn().mockRejectedValue(new Error('private routing detail'));
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(fetcher, routeParser);

    expect(listener(parserSnapshot, { tab: { id: 17 }, frameId: 4 }, sendResponse)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    expect(JSON.stringify(sendResponse.mock.calls)).not.toContain('private routing detail');
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

  it('accepts a resume read request only from frame zero', async () => {
    const fetcher = vi.fn();
    const routeParser = vi.fn();
    const readResume = vi.fn().mockResolvedValue({
      ok: false,
      error: 'vue-root-not-found',
    });
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(fetcher, routeParser, readResume);

    expect(listener(
      { type: 'ARC_RESUME_READ' },
      { tab: { id: 17 }, frameId: 0 },
      sendResponse,
    )).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: 'vue-root-not-found',
      });
    });
    expect(readResume).toHaveBeenCalledWith(17);
    expect(fetcher).not.toHaveBeenCalled();
    expect(routeParser).not.toHaveBeenCalled();

    expect(listener(
      { type: 'ARC_RESUME_READ' },
      { tab: { id: 17 }, frameId: 3 },
      vi.fn(),
    )).toBe(false);
    expect(readResume).toHaveBeenCalledOnce();
  });
});


describe('MAIN-world resume read handler', () => {
  it('executes the bounded probe in MAIN world across the current tab frames', async () => {
    const executeScript = vi.fn().mockResolvedValue([{
      frameId: 4,
      result: {
        status: 'ready',
        capability: {
          root: 'lib-resume-recommend',
          vue_generation: 'vue2',
          resume_object: 'resumeInfo',
          allowed_keys: ['geekBaseInfo', 'geekWorkExpList'],
          array_lengths: { geekWorkExpList: 2 },
        },
        profile: {
          display_name: '候选人甲',
          education: [],
          work_experiences: [
            { company: '示例公司甲' },
            { company: '示例公司乙' },
          ],
          project_experiences: [],
          skills: [],
        },
      },
    }]);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
    );

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 17, allFrames: true },
      world: 'MAIN',
      func: expect.any(Function),
    });
    expect(response).toEqual({
      ok: true,
      snapshot: {
        schema_version: 1,
        parser_version: 'boss-vue-v1',
        page_kind: 'recommend_frame',
        status: 'partial',
        captured_at: '2026-08-07T02:00:00.000Z',
        fingerprint: expect.stringMatching(/^v1-[0-9a-f]{8}$/),
        profile: {
          display_name: '候选人甲',
          education: [],
          work_experiences: [
            { company: '示例公司甲' },
            { company: '示例公司乙' },
          ],
          project_experiences: [],
          skills: [],
        },
        present_fields: ['work_experiences', 'display_name'],
        missing_fields: [
          'education',
          'project_experiences',
          'skills',
          'experience_years',
        ],
        warnings: [
          'vue-capability:root=lib-resume-recommend',
          'vue-capability:generation=vue2',
          'vue-capability:resume-object=resumeInfo',
          'vue-capability:key=geekBaseInfo',
          'vue-capability:key=geekWorkExpList',
          'vue-capability:array=geekWorkExpList:2',
        ],
      },
    });
  });

  it('selects the valid frame with the richest mapped profile', async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        frameId: 3,
        result: {
          status: 'ready',
          capability: {
            root: 'lib-resume-anonymous',
            vue_generation: 'vue2',
            resume_object: 'resumeInfo',
            allowed_keys: ['geekBaseInfo', 'geekWorkExpList'],
            array_lengths: { geekWorkExpList: 1 },
          },
          profile: {
            display_name: '稀疏候选人',
            education: [],
            work_experiences: [],
            project_experiences: [],
            skills: [],
          },
        },
      },
      {
        frameId: 4,
        result: {
          status: 'ready',
          capability: {
            root: 'lib-resume-recommend',
            vue_generation: 'vue3',
            resume_object: 'resumeInfo',
            allowed_keys: ['geekBaseInfo', 'geekWorkExpList'],
            array_lengths: { geekWorkExpList: 1 },
          },
          profile: {
            display_name: '候选人乙',
            education: [{ school: '示例大学' }],
            work_experiences: [{ company: '示例公司' }],
            project_experiences: [],
            skills: [],
          },
        },
      },
    ]);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
    );

    expect(JSON.stringify(response)).toContain('vue-capability:generation=vue3');
    expect(JSON.stringify(response)).toContain('vue-capability:array=geekWorkExpList:1');
    expect(JSON.stringify(response)).toContain('候选人乙');
    expect(JSON.stringify(response)).not.toContain('稀疏候选人');
    expect(JSON.stringify(response)).not.toContain('lib-resume-anonymous');
  });

  it('ignores an invalid frame when another frame returns a valid capability', async () => {
    const executeScript = vi.fn().mockResolvedValue([
      { frameId: 0, result: { status: 'private-error', detail: 'secret' } },
      {
        frameId: 4,
        result: {
          status: 'ready',
          capability: {
            root: 'lib-resume-recommend',
            vue_generation: 'vue2',
            resume_object: 'resumeInfo',
            allowed_keys: ['geekBaseInfo'],
            array_lengths: {},
          },
          profile: {
            display_name: '候选人丙',
            education: [],
            work_experiences: [],
            project_experiences: [],
            skills: [],
          },
        },
      },
    ]);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
    );

    expect(response).toMatchObject({
      ok: true,
      snapshot: { parser_version: 'boss-vue-v1' },
    });
    expect(JSON.stringify(response)).not.toContain('private-error');
    expect(JSON.stringify(response)).not.toContain('secret');
  });

  it.each([
    ['no visible root', [{ frameId: 0, result: { status: 'vue-root-not-found' } }], 'vue-root-not-found'],
    ['root without Vue', [{
      frameId: 4,
      result: { status: 'vue-instance-not-found', root: 'lib-resume-recommend' },
    }], 'vue-instance-not-found'],
    ['Vue without resume data', [{
      frameId: 4,
      result: {
        status: 'vue-resume-data-unavailable',
        root: 'lib-resume-recommend',
        vue_generation: 'vue2',
      },
    }], 'vue-resume-data-unavailable'],
    ['invalid frame result', [{ frameId: 4, result: { status: 'private-error', detail: 'secret' } }], 'vue-result-invalid'],
  ])('returns a fixed failure for %s', async (_label, results, expectedError) => {
    const response = await resumeReadHandler()?.(
      17,
      vi.fn().mockResolvedValue(results),
      () => new Date('2026-08-07T02:00:00.000Z'),
    );

    expect(response).toEqual({ ok: false, error: expectedError });
  });

  it('maps script execution rejection to a fixed failure without exception text', async () => {
    const response = await resumeReadHandler()?.(
      17,
      vi.fn().mockRejectedValue(new Error('private browser detail')),
      () => new Date('2026-08-07T02:00:00.000Z'),
    );

    expect(response).toEqual({ ok: false, error: 'vue-read-failed' });
    expect(JSON.stringify(response)).not.toContain('private browser detail');
  });
});
