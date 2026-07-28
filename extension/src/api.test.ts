import { describe, expect, it, vi } from 'vitest';

import { getDemoAssessment, getHealth } from './api';


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


describe('local API client', () => {
  it('requests the local health endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        request_id: 'health-1',
        status: 'ok',
        service: 'ai-recruitment-copilot',
        version: '0.1.0',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getHealth();

    expect(response.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/healthz',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('times out with a typed offline error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })),
    );

    const request = getHealth(50);
    const rejection = expect(request).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(51);
    await rejection;
  });

  it('reports invalid JSON as an invalid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{broken-json', { status: 200 })),
    );

    await expect(getHealth()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('posts the requested demo candidate label', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        request_id: 'assessment-1',
        mode: 'demo',
        candidate_label: '张同学',
        job_title: 'AI4S 工程师（演示岗位）',
        total_score: 92,
        recommendation: '非常匹配，建议联系',
        dimensions: [],
        highlights: [],
        risk_flags: [],
        follow_up_questions: [],
        messages: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getDemoAssessment('张同学');

    expect(response.total_score).toBe(92);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/demo/assessment',
      expect.objectContaining({
        body: JSON.stringify({ candidate_label: '张同学' }),
        method: 'POST',
      }),
    );
  });
});
