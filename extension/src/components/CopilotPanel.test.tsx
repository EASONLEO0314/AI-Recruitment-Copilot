import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDemoAssessment, getHealth } from '../api';
import type { AssessmentResponse } from '../contracts';
import { CopilotPanel } from './CopilotPanel';


vi.mock('../api', () => ({
  getHealth: vi.fn(),
  getDemoAssessment: vi.fn(),
}));

const assessment: AssessmentResponse = {
  request_id: 'assessment-1',
  mode: 'demo',
  candidate_label: '张同学',
  job_title: 'AI4S 工程师（演示岗位）',
  total_score: 92,
  recommendation: '非常匹配，建议联系',
  dimensions: [
    {
      key: 'research_direction',
      name: '研究方向匹配',
      score: 95,
      weight: 30,
      confidence: 0.95,
      reason: '方向高度相关。',
      evidence: ['蛋白结构预测项目'],
    },
    {
      key: 'skills',
      name: '技能经验匹配',
      score: 90,
      weight: 30,
      confidence: 0.9,
      reason: '核心技能匹配。',
      evidence: ['AlphaFold 与 Rosetta'],
    },
  ],
  highlights: ['具备 AI for Science 经验'],
  risk_flags: ['工业化经验需确认'],
  follow_up_questions: ['是否有产业落地经验？'],
  messages: [
    {
      type: 'greeting',
      label: '打招呼话术',
      content: '您好，想和您沟通 AI4S 工程师岗位。',
    },
    {
      type: 'interview_invitation',
      label: '邀约面试话术',
      content: '想邀请您参加一次线上交流。',
    },
    {
      type: 'phone_script',
      label: '电话沟通提纲',
      content: '先介绍岗位，再了解项目经验。',
    },
  ],
};


beforeEach(() => {
  vi.mocked(getHealth).mockResolvedValue({
    request_id: 'health-1',
    status: 'ok',
    service: 'ai-recruitment-copilot',
    version: '0.1.0',
  });
  vi.mocked(getDemoAssessment).mockResolvedValue(assessment);
});


describe('CopilotPanel', () => {
  it('shows offline guidance and retry when health check fails', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('offline'));

    render(<CopilotPanel />);

    expect(await screen.findByText('本机服务未连接')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新连接' })).toBeInTheDocument();
    expect(screen.getByText(/scripts\\python\.cmd -m uvicorn/)).toBeInTheDocument();
    expect(getDemoAssessment).not.toHaveBeenCalled();
  });

  it('loads the explicitly labelled demo assessment', async () => {
    render(<CopilotPanel />);

    expect(await screen.findByText('92%')).toBeInTheDocument();
    expect(screen.getByText('演示数据')).toBeInTheDocument();
    expect(screen.getByText('非常匹配，建议联系')).toBeInTheDocument();
    expect(screen.getByText('具备 AI for Science 经验')).toBeInTheDocument();
  });

  it('expands dimension evidence on demand', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await screen.findByText('92%');

    expect(screen.queryByText('蛋白结构预测项目')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /研究方向匹配/ }));

    expect(screen.getByText('蛋白结构预测项目')).toBeInTheDocument();
    expect(screen.getByText('方向高度相关。')).toBeInTheDocument();
  });

  it('collapses to the edge rail and expands again', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await screen.findByText('92%');

    await user.click(screen.getByRole('button', { name: '折叠助手' }));
    expect(screen.getByRole('button', { name: '展开助手' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开助手' }));
    expect(screen.getByRole('button', { name: '折叠助手' })).toBeInTheDocument();
  });

  it('switches message types without copying automatically', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<CopilotPanel />);
    await screen.findByText('92%');

    expect(writeText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: '邀约面试话术' }));
    expect(screen.getByText('想邀请您参加一次线上交流。')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the active message only after an explicit click', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<CopilotPanel />);
    await screen.findByText('92%');

    await user.click(screen.getByRole('button', { name: '复制话术' }));

    expect(writeText).toHaveBeenCalledWith('您好，想和您沟通 AI4S 工程师岗位。');
    expect(screen.getByText('已复制')).toBeInTheDocument();
  });
});
