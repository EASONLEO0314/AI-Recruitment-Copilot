import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeMessageListener,
  handleApiRequest,
  isApiRequestMessage,
  readVisibleTopOcrSkills,
} from './background';
import * as backgroundModule from './background';
import type { CandidateProfile } from './contracts';


type ResumeReadHandler = (
  tabId: number,
  executeScript: (details: unknown) => Promise<Array<{ frameId: number; result?: unknown }>>,
  now: () => Date,
  ocrReader?: (tabId: number) => Promise<string[]>,
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


function installChromeForOcr({
  queryTabs,
  screenshot = 'data:image/png;base64,SCREENSHOT',
}: {
  queryTabs: () => Array<{ id: number; url: string; windowId: number }>;
  screenshot?: string;
}) {
  const query = vi.fn((_queryInfo: unknown, callback: (tabs: unknown[]) => void) => {
    callback(queryTabs());
  });
  const captureVisibleTab = vi.fn((...args: unknown[]) => {
    const callback = args[args.length - 1] as (dataUrl?: string) => void;
    callback(screenshot);
  });
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {},
    tabs: {
      captureVisibleTab,
      query,
      sendMessage,
    },
  });
  return { captureVisibleTab, query, sendMessage };
}


const candidateProfile: CandidateProfile = {
  display_name: '张同学',
  experience_years: 4,
  education: [{ school: '匿名大学', degree: '本科' }],
  work_experiences: [],
  project_experiences: [{ name: 'RAG 项目', description: '负责 LangChain RAG 应用' }],
  skills: ['Python', 'RAG'],
};


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

  it('uses the configured server endpoint and shared token when provided', async () => {
    vi.stubEnv('VITE_ARC_API_BASE_URL', 'http://39.105.105.248:8765/');
    vi.stubEnv('VITE_ARC_API_TOKEN', 'shared-token');
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));

    const response = await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'health', timeout_ms: 1200 },
      fetcher,
    );

    expect(response).toEqual({ ok: true, data: { status: 'ok' } });
    expect(fetcher).toHaveBeenCalledWith(
      'http://39.105.105.248:8765/healthz',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'X-ARC-API-Token': 'shared-token',
        }),
        method: 'GET',
      }),
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

  it('posts only the selected job id and CandidateProfile to the fixed match endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ mode: 'rule_v1.1' }));

    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'match-assessment',
        job_id: 'job-ai4s',
        candidate_profile: candidateProfile,
        timeout_ms: 6500,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/assessment/match',
      expect.objectContaining({
        body: JSON.stringify({
          job_id: 'job-ai4s',
          candidate_profile: candidateProfile,
        }),
        method: 'POST',
      }),
    );
  });

  it('forwards bounded HR scoring weights to the fixed match endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ mode: 'rule_v1.1' }));
    const scoringWeights = {
      skills: 50,
      experience_years: 10,
      education: 10,
      experience_evidence: 30,
    };

    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'match-assessment',
        job_id: 'job-ai4s',
        candidate_profile: candidateProfile,
        scoring_weights: scoringWeights,
        timeout_ms: 6500,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/assessment/match',
      expect.objectContaining({
        body: JSON.stringify({
          job_id: 'job-ai4s',
          candidate_profile: candidateProfile,
          scoring_weights: scoringWeights,
        }),
        method: 'POST',
      }),
    );
  });

  it('posts explanation enhancement requests to the fixed local endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ mode: 'rule_v1.1' }));

    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'match-explanation',
        job_id: 'job-ai4s',
        candidate_profile: candidateProfile,
        timeout_ms: 30000,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/assessment/match/explanation',
      expect.objectContaining({
        body: JSON.stringify({
          job_id: 'job-ai4s',
          candidate_profile: candidateProfile,
        }),
        method: 'POST',
      }),
    );
  });

  it('fetches knowledge job options from the fixed local endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'jobs-1', jobs: [] }));

    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'knowledge-jobs',
        limit: 80,
        timeout_ms: 3500,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/knowledge/jobs?limit=80',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fetches fixed admin and knowledge-management endpoints', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'admin-1' }));

    await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'admin-dashboard', timeout_ms: 3500 },
      fetcher,
    );
    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'admin-assessments',
        limit: 20,
        timeout_ms: 3500,
      },
      fetcher,
    );
    await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'knowledge-aliases', timeout_ms: 3500 },
      fetcher,
    );
    await handleApiRequest(
      { type: 'ARC_API_REQUEST', operation: 'knowledge-quality', timeout_ms: 3500 },
      fetcher,
    );
    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'knowledge-job-detail',
        job_id: 'job-ai4s',
        timeout_ms: 3500,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/admin/dashboard',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/admin/assessments?limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/admin/aliases',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/knowledge/quality',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/knowledge/jobs/job-ai4s',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('posts scoring-standard requests to the fixed local endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ request_id: 'standard-1' }));

    await handleApiRequest(
      {
        type: 'ARC_API_REQUEST',
        operation: 'scoring-standard',
        job_id: 'job-ai4s',
        timeout_ms: 30000,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/assessment/scoring-standard',
      expect.objectContaining({
        body: JSON.stringify({ job_id: 'job-ai4s' }),
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
      error: { code: 'REQUEST_FAILED', message: '评分服务返回 HTTP 503' },
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
      error: { code: 'INVALID_RESPONSE', message: '评分服务返回了无效 JSON' },
    });
  });

  it('accepts only fixed API operations with bounded payloads', () => {
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      timeout_ms: 15000,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'match-explanation',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      timeout_ms: 30000,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'scoring-standard',
      job_id: 'job-ai4s',
      timeout_ms: 30000,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-jobs',
      limit: 80,
      timeout_ms: 3500,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'admin-dashboard',
      timeout_ms: 3500,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'admin-assessments',
      limit: 20,
      timeout_ms: 3500,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-aliases',
      timeout_ms: 3500,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-quality',
      timeout_ms: 3500,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-job-detail',
      job_id: 'job-ai4s',
      timeout_ms: 3500,
    })).toBe(true);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'proxy-url',
      url: 'https://example.com',
    })).toBe(false);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: 'job-ai4s',
      candidate_profile: { ...candidateProfile, education: 'invalid' },
      timeout_ms: 6500,
    })).toBe(false);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      scoring_weights: { skills: 90, experience_years: 10 },
      timeout_ms: 6500,
    })).toBe(false);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      timeout_ms: 30001,
    })).toBe(false);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'admin-assessments',
      limit: 101,
      timeout_ms: 3500,
    })).toBe(false);
    expect(isApiRequestMessage({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-job-detail',
      job_id: '',
      timeout_ms: 3500,
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

  it('returns a typed failure for malformed API requests instead of dropping the channel', () => {
    const fetcher = vi.fn();
    const routeParser = vi.fn();
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(fetcher, routeParser);

    const keepChannelOpen = listener(
      {
        type: 'ARC_API_REQUEST',
        operation: 'match-assessment',
        job_id: 'job-ai4s',
        candidate_profile: { ...candidateProfile, education: 'invalid' },
        timeout_ms: 15000,
      },
      {},
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: {
        code: 'REQUEST_FAILED',
        message: '评分请求格式异常，请重新读取简历后再试。',
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
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


describe('OCR screenshot fallback boundaries', () => {
  it('does not capture when the active tab is not the triggering BOSS tab', async () => {
    const { captureVisibleTab, sendMessage } = installChromeForOcr({
      queryTabs: () => [{ id: 18, url: 'https://www.zhipin.com/web/geek/recommend', windowId: 42 }],
    });

    const skills = await readVisibleTopOcrSkills(17);

    expect(skills).toEqual([]);
    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('discards the screenshot when the active tab changes after capture', async () => {
    vi.useFakeTimers();
    let queryCount = 0;
    const { captureVisibleTab } = installChromeForOcr({
      queryTabs: () => {
        queryCount += 1;
        return queryCount < 3
          ? [{ id: 17, url: 'https://www.zhipin.com/web/geek/recommend', windowId: 42 }]
          : [{ id: 18, url: 'https://example.com/private', windowId: 42 }];
      },
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    const promise = readVisibleTopOcrSkills(17);
    await vi.advanceTimersByTimeAsync(120);
    const skills = await promise;

    expect(skills).toEqual([]);
    expect(captureVisibleTab).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send a full-page screenshot when top cropping is unavailable', async () => {
    vi.useFakeTimers();
    const { captureVisibleTab } = installChromeForOcr({
      queryTabs: () => [{ id: 17, url: 'https://www.zhipin.com/web/geek/recommend', windowId: 42 }],
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('createImageBitmap', undefined);

    const promise = readVisibleTopOcrSkills(17);
    await vi.advanceTimersByTimeAsync(120);
    const skills = await promise;

    expect(skills).toEqual([]);
    expect(captureVisibleTab).toHaveBeenCalledWith(
      42,
      { format: 'png' },
      expect.any(Function),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});


describe('MAIN-world resume read handler', () => {
  it('executes the bounded probe in MAIN world across the current tab frames', async () => {
    const executeScript = vi.fn()
      .mockResolvedValueOnce([{
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
          schema: [
            { key: 'geekBaseInfo', type: 'object' },
            { key: 'geekWorkExpList', type: 'array', array_length: 2 },
          ],
          nested_schema: [
            {
              container: 'geekDetailInfo',
              key: 'professionalSkill',
              type: 'string',
            },
            {
              container: 'geekDetailInfo',
              key: 'skillItems',
              type: 'array',
              array_length: 50,
            },
          ],
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
      }])
      .mockResolvedValueOnce([]);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
    );

    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 17, allFrames: true },
      world: 'MAIN',
      func: expect.any(Function),
    });
    expect(executeScript).toHaveBeenNthCalledWith(2, {
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
          'vue-schema:key=geekBaseInfo:object',
          'vue-schema:key=geekWorkExpList:array:2',
          'vue-nested-schema:container=geekDetailInfo:key=professionalSkill:string',
          'vue-nested-schema:container=geekDetailInfo:key=skillItems:array:50',
        ],
      },
    });
  });

  it('merges visible MAIN-world DOM tag skills before trying OCR', async () => {
    const executeScript = vi.fn()
      .mockResolvedValueOnce([{
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
          schema: [{ key: 'geekBaseInfo', type: 'object' }],
          nested_schema: [],
          profile: {
            display_name: '候选人标签',
            education: [],
            work_experiences: [],
            project_experiences: [],
            skills: [],
          },
        },
      }])
      .mockResolvedValueOnce([
        { frameId: 0, result: ['招聘规范', '我的客服'] },
        { frameId: 4, result: ['前端', '微服务开发'] },
      ]);
    const ocrReader = vi.fn().mockResolvedValue(['OCR 不应调用']);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
      ocrReader,
    );

    expect(ocrReader).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: true,
      snapshot: {
        parser_version: 'boss-vue-v1',
        profile: {
          display_name: '候选人标签',
          skills: ['前端', '微服务开发'],
        },
        present_fields: ['skills', 'display_name'],
        warnings: expect.arrayContaining(['dom-skills:visible-tags']),
      },
    });
  });

  it('falls back to visible DOM skills from another frame when the selected Vue frame is empty', async () => {
    const executeScript = vi.fn()
      .mockResolvedValueOnce([{
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
          schema: [{ key: 'geekBaseInfo', type: 'object' }],
          nested_schema: [],
          profile: {
            display_name: '候选人跨 frame',
            education: [],
            work_experiences: [],
            project_experiences: [],
            skills: [],
          },
        },
      }])
      .mockResolvedValueOnce([
        { frameId: 4, result: [] },
        { frameId: 0, result: ['Java', 'Redis', 'Kafka'] },
      ]);
    const ocrReader = vi.fn().mockResolvedValue(['OCR 不应调用']);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
      ocrReader,
    );

    expect(ocrReader).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: true,
      snapshot: {
        parser_version: 'boss-vue-v1',
        profile: {
          display_name: '候选人跨 frame',
          skills: ['Java', 'Redis', 'Kafka'],
        },
        warnings: expect.arrayContaining(['dom-skills:visible-tags']),
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
          schema: [{ key: 'geekBaseInfo', type: 'object' }],
          nested_schema: [],
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
          schema: [
            { key: 'geekBaseInfo', type: 'object' },
            { key: 'geekWorkExpList', type: 'array', array_length: 1 },
          ],
          nested_schema: [],
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

  it('merges local OCR skills when the Vue profile has no skills', async () => {
    const executeScript = vi.fn().mockResolvedValue([{
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
        schema: [{ key: 'geekBaseInfo', type: 'object' }],
        nested_schema: [],
        profile: {
          display_name: '候选人 OCR',
          education: [],
          work_experiences: [],
          project_experiences: [],
          skills: [],
        },
      },
    }]);
    const ocrReader = vi.fn().mockResolvedValue(['Python', 'MySQL']);

    const response = await resumeReadHandler()?.(
      17,
      executeScript,
      () => new Date('2026-08-07T02:00:00.000Z'),
      ocrReader,
    );

    expect(ocrReader).toHaveBeenCalledWith(17);
    expect(response).toMatchObject({
      ok: true,
      snapshot: {
        parser_version: 'boss-vue-v1',
        profile: {
          display_name: '候选人 OCR',
          skills: ['Python', 'MySQL'],
        },
        present_fields: ['skills', 'display_name'],
        warnings: expect.arrayContaining(['ocr-skills:visible-top']),
      },
    });
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
          schema: [{ key: 'geekBaseInfo', type: 'object' }],
          nested_schema: [],
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
