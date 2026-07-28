import { describe, expect, it, vi } from 'vitest';

import { getDemoAssessment, getHealth } from './api';


function installRuntime(response: unknown) {
  const sendMessage = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return sendMessage;
}


const health = {
  request_id: 'health-1',
  status: 'ok',
  service: 'ai-recruitment-copilot',
  version: '0.1.0',
};

const assessment = {
  request_id: 'assessment-1',
  mode: 'demo',
  candidate_label: '张同学',
  job_title: 'AI4S 工程师（演示岗位）',
  total_score: 92,
  recommendation: '非常匹配，建议联系',
  dimensions: [
    {
      key: 'research',
      name: '研究方向匹配',
      score: 95,
      weight: 30,
      confidence: 0.95,
      reason: '方向相关',
      evidence: ['蛋白结构预测'],
    },
  ],
  highlights: ['AI for Science 经验'],
  risk_flags: ['产业经验待确认'],
  follow_up_questions: ['是否有落地经验？'],
  messages: [
    {
      type: 'greeting',
      label: '打招呼话术',
      content: '您好。',
    },
  ],
};


describe('extension API client', () => {
  it('asks the service worker for health instead of fetching in the content script', async () => {
    const sendMessage = installRuntime({ ok: true, data: health });

    const response = await getHealth(1200);

    expect(response.status).toBe('ok');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'health',
      timeout_ms: 1200,
    });
  });

  it('reports a missing service worker as backend unavailable', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('receiving end does not exist'));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(getHealth()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
    });
  });

  it('preserves a typed failure returned by the service worker', async () => {
    installRuntime({
      ok: false,
      error: { code: 'REQUEST_FAILED', message: 'Local API returned HTTP 500' },
    });

    await expect(getHealth()).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
    });
  });

  it('rejects a structurally invalid health response', async () => {
    installRuntime({ ok: true, data: { status: 'ok' } });

    await expect(getHealth()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('sends the demo candidate label through the fixed assessment operation', async () => {
    const sendMessage = installRuntime({ ok: true, data: assessment });

    const response = await getDemoAssessment('张同学', 4500);

    expect(response.total_score).toBe(92);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'demo-assessment',
      candidate_label: '张同学',
      timeout_ms: 4500,
    });
  });

  it('rejects a malformed assessment instead of passing it to React', async () => {
    installRuntime({ ok: true, data: { ...assessment, dimensions: 'invalid' } });

    await expect(getDemoAssessment('张同学')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
