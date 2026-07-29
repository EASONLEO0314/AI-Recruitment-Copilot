import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDemoAssessment, getHealth } from '../api';
import type { AssessmentResponse, ParserRelayMessage } from '../contracts';
import { buildProfileSnapshot, buildStatusSnapshot } from '../parser/snapshot';
import { CopilotPanel } from './CopilotPanel';


const parserClient = vi.hoisted(() => {
  let listener: ((message: ParserRelayMessage) => void) | null = null;
  const requestRefresh = vi.fn().mockResolvedValue(undefined);
  const subscribe = vi.fn((next: (message: ParserRelayMessage) => void) => {
    listener = next;
    return () => {
      if (listener === next) {
        listener = null;
      }
    };
  });

  return {
    emit(message: ParserRelayMessage) {
      listener?.(message);
    },
    requestRefresh,
    reset() {
      listener = null;
      requestRefresh.mockReset().mockResolvedValue(undefined);
      subscribe.mockClear();
    },
    subscribe,
  };
});


vi.mock('../api', () => ({
  getHealth: vi.fn(),
  getDemoAssessment: vi.fn(),
}));

vi.mock('../parser/client', () => ({
  acceptParserRelay: (_current: ParserRelayMessage | null, incoming: ParserRelayMessage) => incoming,
  requestParserRefresh: parserClient.requestRefresh,
  subscribeToParserRelays: parserClient.subscribe,
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

const loggedOutRelay: ParserRelayMessage = {
  type: 'ARC_PARSER_RELAY',
  snapshot: buildStatusSnapshot(
    'logged_out',
    'ready',
    undefined,
    new Date('2026-07-29T02:00:00.000Z'),
  ),
  source: { frame_id: 0, document_id: 'anonymous-document' },
};

const partialRelay: ParserRelayMessage = {
  type: 'ARC_PARSER_RELAY',
  snapshot: buildProfileSnapshot('resume_frame', {
    display_name: '候选人甲',
    education: [],
    work_experiences: [],
    project_experiences: [],
    skills: ['TypeScript'],
  }, new Date('2026-07-29T02:00:00.000Z')),
  source: { frame_id: 0, document_id: 'anonymous-document' },
};


beforeEach(() => {
  parserClient.reset();
  vi.mocked(getHealth).mockReset();
  vi.mocked(getDemoAssessment).mockReset();
  vi.mocked(getHealth).mockResolvedValue({
    request_id: 'health-1',
    status: 'ok',
    service: 'ai-recruitment-copilot',
    version: '0.1.0',
  });
  vi.mocked(getDemoAssessment).mockResolvedValue(assessment);
});


describe('CopilotPanel', () => {
  it('shows logged-out page reading while the backend is offline', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('offline'));

    render(<CopilotPanel />);

    expect(await screen.findByText('本机服务未连接')).toBeInTheDocument();
    act(() => parserClient.emit(loggedOutRelay));
    expect(screen.getByText('BOSS 当前未登录')).toBeInTheDocument();
    expect(screen.getByText('扩展已加载，登录后才可读取候选人资料')).toBeInTheDocument();
  });

  it('keeps the assessment explicitly demo after a partial profile relay', async () => {
    render(<CopilotPanel />);
    expect(await screen.findByText('92%')).toBeInTheDocument();

    act(() => parserClient.emit(partialRelay));

    expect(screen.getByText('候选人甲')).toBeInTheDocument();
    expect(screen.getByText('演示数据')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.queryByText('真实评估')).not.toBeInTheDocument();
  });

  it('refreshes page reading once without clipboard or scrolling side effects', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<CopilotPanel />);
    await screen.findByText('92%');

    await user.click(screen.getByRole('button', { name: '重新读取页面' }));

    expect(parserClient.requestRefresh).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('shows offline guidance and retry when health check fails', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('offline'));

    render(<CopilotPanel />);

    expect(await screen.findByText('本机服务未连接')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新连接' })).toBeInTheDocument();
    expect(screen.getByText(/scripts\\python\.cmd -m uvicorn/)).toBeInTheDocument();
    expect(getDemoAssessment).not.toHaveBeenCalled();
  });

  it('reconnects after the backend becomes available again', async () => {
    const user = userEvent.setup();
    vi.mocked(getHealth).mockRejectedValueOnce(new Error('offline'));
    render(<CopilotPanel />);
    await screen.findByText('本机服务未连接');

    await user.click(screen.getByRole('button', { name: '重新连接' }));

    expect(await screen.findByText('92%')).toBeInTheDocument();
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(getDemoAssessment).toHaveBeenCalledTimes(1);
  });

  it('loads the explicitly labelled demo assessment', async () => {
    render(<CopilotPanel />);

    expect(await screen.findByText('92%')).toBeInTheDocument();
    expect(screen.getByText('演示数据')).toBeInTheDocument();
    expect(screen.getByText('非常匹配，建议联系')).toBeInTheDocument();
    expect(screen.getByText('具备 AI for Science 经验')).toBeInTheDocument();
  });

  it('refreshes an online connection and clears stale results when the backend stops', async () => {
    const user = userEvent.setup();
    let rejectRefresh: (reason?: unknown) => void = () => undefined;
    const pendingRefresh = new Promise<never>((_, reject) => {
      rejectRefresh = reject;
    });
    vi.mocked(getHealth)
      .mockResolvedValueOnce({
        request_id: 'health-1',
        status: 'ok',
        service: 'ai-recruitment-copilot',
        version: '0.1.0',
      })
      .mockReturnValueOnce(pendingRefresh);
    render(<CopilotPanel />);
    await screen.findByText('92%');

    await user.click(screen.getByRole('button', { name: '刷新连接' }));

    expect(screen.getByText('正在连接本机分析服务')).toBeInTheDocument();
    expect(screen.queryByText('92%')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新连接' })).not.toBeInTheDocument();

    await act(async () => {
      rejectRefresh(new Error('offline'));
    });
    expect(await screen.findByText('本机服务未连接')).toBeInTheDocument();
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(getDemoAssessment).toHaveBeenCalledTimes(1);
  });

  it('clears stale copy feedback when refreshing the assessment', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<CopilotPanel />);
    await screen.findByText('92%');
    await user.click(screen.getByRole('button', { name: '复制话术' }));
    expect(screen.getByText('已复制')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '刷新连接' }));

    expect(await screen.findByText('92%')).toBeInTheDocument();
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('tab', { name: '电话沟通提纲' }));
    expect(screen.getByText('先介绍岗位，再了解项目经验。')).toBeInTheDocument();
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

  it('clears copy-success feedback after a short delay', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<CopilotPanel />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: '复制话术' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('已复制')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
  });
});
