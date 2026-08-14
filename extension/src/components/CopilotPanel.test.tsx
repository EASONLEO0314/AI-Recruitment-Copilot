import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  getAdminDashboard,
  getAssessmentRecords,
  getHealth,
  getKnowledgeAliases,
  getKnowledgeJobDetail,
  getKnowledgeJobs,
  getKnowledgeQuality,
  getMatchAssessment,
  getMatchExplanation,
  getScoringStandard,
} from '../api';
import type {
  AdminDashboardResponse,
  AssessmentRecordsResponse,
  CandidateProfile,
  KnowledgeAliasesResponse,
  KnowledgeJobDetailResponse,
  KnowledgeJobsResponse,
  KnowledgeQualityResponse,
  MatchAssessmentResponse,
  ParserRelayMessage,
  ScoringStandardResponse,
} from '../contracts';
import { buildProfileSnapshot, buildStatusSnapshot } from '../parser/snapshot';
import { CopilotPanel } from './CopilotPanel';


const parserClient = vi.hoisted(() => {
  let listener: ((message: ParserRelayMessage) => void) | null = null;
  const requestRefresh = vi.fn().mockResolvedValue(undefined);
  const requestResume = vi.fn().mockResolvedValue({
    ok: false,
    error: 'vue-root-not-found',
  });
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
    requestResume,
    reset() {
      listener = null;
      requestRefresh.mockReset().mockResolvedValue(undefined);
      requestResume.mockReset().mockResolvedValue({
        ok: false,
        error: 'vue-root-not-found',
      });
      subscribe.mockClear();
    },
    subscribe,
  };
});


vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  },
  getHealth: vi.fn(),
  getAdminDashboard: vi.fn(),
  getAssessmentRecords: vi.fn(),
  getKnowledgeAliases: vi.fn(),
  getKnowledgeJobDetail: vi.fn(),
  getKnowledgeJobs: vi.fn(),
  getKnowledgeQuality: vi.fn(),
  getMatchAssessment: vi.fn(),
  getMatchExplanation: vi.fn(),
  getScoringStandard: vi.fn(),
}));

vi.mock('../parser/client', async () => {
  const actual = await vi.importActual<typeof import('../parser/client')>('../parser/client');
  return {
    ...actual,
    requestParserRefresh: parserClient.requestRefresh,
    requestResumeRead: parserClient.requestResume,
    subscribeToParserRelays: parserClient.subscribe,
  };
});

const jobs: KnowledgeJobsResponse = {
  request_id: 'jobs-1',
  jobs: [
    {
      job_id: 'job-ai4s',
      title: 'AI4S 工程师',
      department: 'AI4S模型研究院',
      project: '科研智能体',
      status: '招聘中',
    },
    {
      job_id: 'job-java',
      title: '后端工程师',
      department: '工程中心',
      project: null,
      status: '招聘中',
    },
  ],
};

const candidateProfile: CandidateProfile = {
  display_name: '候选人甲',
  experience_years: 3,
  education: [{ school: '匿名大学', degree: '本科' }],
  work_experiences: [],
  project_experiences: [{ name: 'RAG 项目', description: '负责 LangChain RAG 应用' }],
  skills: ['TypeScript', 'Python', 'RAG'],
};

const secondCandidateProfile: CandidateProfile = {
  display_name: '候选人乙',
  experience_years: 5,
  education: [{ school: '匿名大学', degree: '硕士' }],
  work_experiences: [{ company: '匿名公司', title: '后端工程师' }],
  project_experiences: [],
  skills: ['Java', 'Spring Boot'],
};

const insufficientProfile: CandidateProfile = {
  display_name: '候选人信息少',
  education: [],
  work_experiences: [],
  project_experiences: [],
  skills: [],
};

const matchAssessment: MatchAssessmentResponse = {
  request_id: 'match-1',
  mode: 'rule_v1.1',
  explanation_source: 'rule',
  assessment_summary: '规则评分 86%：技能匹配较好，追问聚焦项目证据。',
  llm_enhancement: 'disabled',
  job_id: 'job-ai4s',
  job_title: 'AI4S 工程师',
  total_score: 86,
  fit_score: 86,
  hybrid_score: 86,
  hybrid_delta: 0,
  hybrid_summary: '当前为规则评分，LLM 语义校准未启用。',
  recommendation: '建议进入下一轮',
  dimensions: [
    {
      key: 'skills',
      name: '技能匹配',
      score: 88,
      weight: 45,
      confidence: 0.91,
      reason: '候选人具备 Python 和 RAG 经验，LangChain 证据需要补充。',
      matched_concepts: ['Python', 'RAG'],
      missing_concepts: ['LangChain'],
      evidence: [
        {
          source: 'candidate.skills',
          text: 'Python',
          concept: 'Python',
        },
        {
          source: 'candidate.project_experiences',
          source_index: 0,
          text: '负责 LangChain RAG 应用',
          concept: 'RAG',
        },
      ],
    },
  ],
  highlights: ['具备 RAG 项目经验'],
  risk_flags: [
    {
      code: 'missing_required_skill',
      severity: 'warning',
      message: 'LangChain 证据不足',
      related_dimension: 'skills',
      related_concepts: ['LangChain'],
    },
  ],
  missing_information: [
    {
      field: 'work_experiences',
      reason: '工作经历未明确',
    },
  ],
  follow_up_questions: ['请补充 LangChain 项目细节？'],
  personalized_follow_up_questions: [
    {
      question: '请你结合 RAG 项目说明 LangChain 的具体使用场景和个人贡献？',
      purpose: '核实 LangChain 直接项目证据。',
      evidence_anchor: 'RAG 项目',
      copy_text: '请你结合 RAG 项目说明 LangChain 的具体使用场景和个人贡献？',
    },
  ],
  evidence: [],
};

const scoringStandardResponse: ScoringStandardResponse = {
  request_id: 'standard-1',
  job_id: 'job-ai4s',
  job_title: 'AI4S 工程师',
  standard: {
    standard_id: 'llm_dynamic_v1',
    source: 'llm_generated',
    job_family: 'research',
    related_compensation_cap: 60,
    dimensions: [
      { key: 'skills', name: '技能匹配', weight: 25, rationale: '科研岗技能为基础。' },
      { key: 'experience_years', name: '年限匹配', weight: 10, rationale: '年限弱参考。' },
      { key: 'education', name: '教育背景', weight: 25, rationale: '科研岗重视教育背景。' },
      { key: 'experience_evidence', name: '研究经历', weight: 40, rationale: '科研经历最关键。' },
    ],
  },
};

const adminDashboard: AdminDashboardResponse = {
  request_id: 'dashboard-1',
  total_jobs: 2,
  total_concepts: 18,
  quality_warning_count: 1,
  total_assessment_records: 3,
  unique_candidates: 2,
  unique_assessed_jobs: 2,
  average_score: 76,
  top_jobs: [
    {
      job_id: 'job-ai4s',
      job_title: 'AI4S 工程师',
      assessment_count: 2,
      average_score: 80,
    },
  ],
};

const assessmentRecords: AssessmentRecordsResponse = {
  request_id: 'records-1',
  records: [
    {
      record_id: 1,
      candidate_fingerprint: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      job_id: 'job-ai4s',
      job_title: 'AI4S 工程师',
      total_score: 86,
      fit_score: 86,
      hybrid_score: 86,
      recommendation: '建议进入下一轮',
      assessed_at: '2026-08-13T08:00:00+00:00',
    },
  ],
};

const knowledgeAliases: KnowledgeAliasesResponse = {
  request_id: 'aliases-1',
  aliases: [
    {
      canonical: 'React',
      category: 'frontend',
      aliases: ['React.js'],
      frequency: 4,
    },
  ],
};

const knowledgeQuality: KnowledgeQualityResponse = {
  request_id: 'quality-1',
  report: {
    total_rows: 3,
    imported_jobs: 2,
    warning_count: 1,
    status_counts: { 招聘中: 2 },
    department_counts: { 工程中心: 2 },
    unrecognized_terms: [
      {
        term: 'GraphQL',
        frequency: 2,
        sample_titles: ['全栈开发工程师'],
      },
    ],
    missing_required_keyword_jobs: [
      {
        job_id: 'job-java',
        title: '后端工程师',
        source_row: 3,
        department: '工程中心',
        suggested_keywords: ['Java', 'Spring Boot'],
      },
      {
        job_id: 'job-fullstack',
        title: '全栈开发工程师',
        source_row: 4,
        department: '工程中心',
        suggested_keywords: ['JavaScript', 'Node.js', 'React'],
      },
    ],
    warnings: [
      {
        code: 'missing-jd',
        severity: 'warning',
        message: '岗位 JD 为空',
        job_id: 'job-java',
        source_row: 3,
        title: '后端工程师',
      },
    ],
  },
};

const jobDetail: KnowledgeJobDetailResponse = {
  request_id: 'detail-1',
  job_id: 'job-ai4s',
  source_row: 2,
  title: 'AI4S 工程师',
  department: 'AI4S模型研究院',
  project: '科研智能体',
  headcount: 1,
  change_type: null,
  hiring_type: null,
  salary_min: null,
  salary_max: null,
  salary_months: null,
  start_time: null,
  status: '招聘中',
  platform: null,
  written_test_required: null,
  required_keywords: ['Python'],
  expected_outputs: null,
  jd: '熟悉 Python、RAG、React。',
  concepts: ['Python', 'RAG', 'React'],
  profile: {
    required_concepts: ['Python'],
    preferred_concepts: ['RAG'],
    related_concepts: ['React'],
    bonus_concepts: [],
    all_concepts: ['Python', 'RAG', 'React'],
    concept_categories: ['backend', 'frontend'],
    education_keywords: ['本科'],
    experience_years_min: 2,
    evaluation_materials: [],
  },
  documents: [],
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
  snapshot: buildProfileSnapshot(
    'resume_frame',
    candidateProfile,
    new Date('2026-07-29T02:00:00.000Z'),
  ),
  source: { frame_id: 0, document_id: 'anonymous-document' },
};

const secondRelay: ParserRelayMessage = {
  type: 'ARC_PARSER_RELAY',
  snapshot: buildProfileSnapshot(
    'resume_frame',
    secondCandidateProfile,
    new Date('2026-07-29T02:00:01.000Z'),
  ),
  source: { frame_id: 0, document_id: 'anonymous-document' },
};

const insufficientRelay: ParserRelayMessage = {
  type: 'ARC_PARSER_RELAY',
  snapshot: buildProfileSnapshot(
    'resume_frame',
    insufficientProfile,
    new Date('2026-07-29T02:00:00.000Z'),
  ),
  source: { frame_id: 0, document_id: 'anonymous-document' },
};


async function waitForOnlinePanel() {
  return screen.findByLabelText('选择匹配岗位');
}


beforeEach(() => {
  parserClient.reset();
  vi.mocked(getHealth).mockReset();
  vi.mocked(getAdminDashboard).mockReset();
  vi.mocked(getAssessmentRecords).mockReset();
  vi.mocked(getKnowledgeAliases).mockReset();
  vi.mocked(getKnowledgeJobDetail).mockReset();
  vi.mocked(getKnowledgeJobs).mockReset();
  vi.mocked(getKnowledgeQuality).mockReset();
  vi.mocked(getMatchAssessment).mockReset();
  vi.mocked(getMatchExplanation).mockReset();
  vi.mocked(getScoringStandard).mockReset();
  vi.mocked(getHealth).mockResolvedValue({
    request_id: 'health-1',
    status: 'ok',
    service: 'ai-recruitment-copilot',
    version: '0.1.0',
  });
  vi.mocked(getKnowledgeJobs).mockResolvedValue(jobs);
  vi.mocked(getAdminDashboard).mockResolvedValue(adminDashboard);
  vi.mocked(getAssessmentRecords).mockResolvedValue(assessmentRecords);
  vi.mocked(getKnowledgeAliases).mockResolvedValue(knowledgeAliases);
  vi.mocked(getKnowledgeJobDetail).mockResolvedValue(jobDetail);
  vi.mocked(getKnowledgeQuality).mockResolvedValue(knowledgeQuality);
  vi.mocked(getMatchAssessment).mockResolvedValue(matchAssessment);
  vi.mocked(getMatchExplanation).mockResolvedValue(matchAssessment);
  vi.mocked(getScoringStandard).mockResolvedValue(scoringStandardResponse);
});


describe('CopilotPanel', () => {
  it('shows logged-out page reading while the backend is offline', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('offline'));

    render(<CopilotPanel />);

    expect(await screen.findByText('评分服务未连接')).toBeInTheDocument();
    act(() => parserClient.emit(loggedOutRelay));
    expect(screen.getByText('BOSS 当前未登录')).toBeInTheDocument();
    expect(screen.getByText('扩展已加载，登录后才可读取候选人资料')).toBeInTheDocument();
    expect(getKnowledgeJobs).not.toHaveBeenCalled();
    expect(getMatchAssessment).not.toHaveBeenCalled();
  });

  it('shows a ready real-assessment control after a partial profile relay without auto scoring', async () => {
    render(<CopilotPanel />);
    await waitForOnlinePanel();

    act(() => parserClient.emit(partialRelay));

    expect(screen.getByText('候选人甲')).toBeInTheDocument();
    expect(screen.getByText('将当前候选人与 AI4S 工程师 对比')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析候选人' })).toBeEnabled();
    expect(getMatchAssessment).not.toHaveBeenCalled();
    expect(screen.queryByText('86%')).not.toBeInTheDocument();
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
  });

  it('renders the local admin view with jobs, profile, aliases, quality, and anonymous records', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();

    await user.click(screen.getByRole('button', { name: '后台' }));

    expect(await screen.findByText('后台管理')).toBeInTheDocument();
    expect(getAdminDashboard).toHaveBeenCalled();
    expect(getAssessmentRecords).toHaveBeenCalledWith(20);
    expect(getKnowledgeAliases).toHaveBeenCalled();
    expect(getKnowledgeQuality).toHaveBeenCalled();
    expect(getKnowledgeJobDetail).toHaveBeenCalledWith('job-ai4s');
    expect(screen.getByText('AI4S 工程师 · 2 次 · 80%')).toBeInTheDocument();
    expect(screen.getByText('岗位画像')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('React.js')).toBeInTheDocument();
    expect(screen.getByText('GraphQL · 2')).toBeInTheDocument();
    expect(screen.getByText('关键词为空岗位')).toBeInTheDocument();
    expect(screen.getByText('2 岗依赖 JD 自动抽取')).toBeInTheDocument();
    expect(screen.getByText('全栈开发工程师')).toBeInTheDocument();
    expect(screen.getByText('第 4 行 · job-fullstack · 工程中心')).toBeInTheDocument();
    expect(screen.getByText('建议：JavaScript、Node.js、React')).toBeInTheDocument();
    expect(screen.getByText('岗位 JD 为空')).toBeInTheDocument();
    expect(screen.getByText('后端工程师 · 第 3 行 · job-java')).toBeInTheDocument();
    expect(screen.getByText('建议进入下一轮')).toBeInTheDocument();
    expect(screen.getByText(/abcdef123456/)).toBeInTheDocument();
    expect(screen.queryByText('候选人甲')).not.toBeInTheDocument();
  });

  it('requests rule_v1.1 scoring with the selected job and existing CandidateProfile', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(getMatchAssessment).toHaveBeenCalledWith('job-ai4s', partialRelay.snapshot.profile);
    expect(await screen.findByText('86%')).toBeInTheDocument();
    expect(getMatchExplanation).toHaveBeenCalledWith('job-ai4s', partialRelay.snapshot.profile);
    expect(screen.getByText('真实评估 · rule_v1.1 · 规则解释')).toBeInTheDocument();
    expect(screen.getByText('规则评分 86%：技能匹配较好，追问聚焦项目证据。')).toBeInTheDocument();
    expect(screen.getByText('建议进入下一轮')).toBeInTheDocument();
    expect(screen.getByText('具备 RAG 项目经验')).toBeInTheDocument();
    expect(screen.getByText('LangChain 证据不足')).toBeInTheDocument();
    expect(screen.getByText('工作经历未明确')).toBeInTheDocument();
    expect(screen.getByText('AI 个性化追问')).toBeInTheDocument();
    expect(screen.getByText('请你结合 RAG 项目说明 LangChain 的具体使用场景和个人贡献？')).toBeInTheDocument();
    expect(screen.queryByText('建议追问')).not.toBeInTheDocument();
  });

  it('copies personalized follow-up questions one by one or as a bundle', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: '分析候选人' }));
    await screen.findByText('AI 个性化追问');

    await user.click(screen.getByRole('button', { name: '复制个性化追问 1' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      '请你结合 RAG 项目说明 LangChain 的具体使用场景和个人贡献？',
    ));
    expect(screen.getByRole('button', { name: '复制个性化追问 1' })).toHaveTextContent('已复制');

    await user.click(screen.getByRole('button', { name: '复制全部个性化追问' }));
    expect(writeText).toHaveBeenLastCalledWith(
      '1. 请你结合 RAG 项目说明 LangChain 的具体使用场景和个人贡献？',
    );
    expect(screen.getByRole('button', { name: '复制全部个性化追问' })).toHaveTextContent('已复制');
  });

  it('lets HR load AI scoring weights and sends adjusted percentages with scoring', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: 'AI 建议权重' }));

    expect(getScoringStandard).toHaveBeenCalledWith('job-ai4s');
    expect(await screen.findAllByDisplayValue('25')).toHaveLength(2);
    const skillInput = screen.getByLabelText('技能权重');
    const yearsInput = screen.getByLabelText('年限权重');
    await user.clear(skillInput);
    await user.type(skillInput, '30');
    await user.clear(yearsInput);
    await user.type(yearsInput, '5');
    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    const expectedWeights = {
      skills: 30,
      experience_years: 5,
      education: 25,
      experience_evidence: 40,
    };
    expect(getMatchAssessment).toHaveBeenCalledWith(
      'job-ai4s',
      partialRelay.snapshot.profile,
      expectedWeights,
    );
    expect(getMatchExplanation).toHaveBeenCalledWith(
      'job-ai4s',
      partialRelay.snapshot.profile,
      expectedWeights,
    );
  });

  it('labels LLM-assisted explanation without changing the real-score badge', async () => {
    vi.mocked(getMatchAssessment).mockResolvedValue(matchAssessment);
    let resolveExplanation: (value: MatchAssessmentResponse) => void = () => undefined;
    vi.mocked(getMatchExplanation).mockReturnValueOnce(new Promise((resolve) => {
      resolveExplanation = resolve;
    }));
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(await screen.findByText('真实评估 · rule_v1.1 · AI 解释生成中')).toBeInTheDocument();
    expect(screen.getByText('AI 追问生成中，当前先显示规则结果')).toBeInTheDocument();
    await act(async () => {
      resolveExplanation({
        ...matchAssessment,
        explanation_source: 'llm',
        llm_enhancement: 'applied',
        assessment_summary: 'LLM 只整理解释，不改变评分。',
        hybrid_score: 89,
        hybrid_delta: 3,
        hybrid_summary: 'LLM 语义审阅识别到更强的项目复杂度线索。',
      });
    });
    expect(await screen.findByText('真实评估 · rule_v1.1 · LLM 辅助解释')).toBeInTheDocument();
    expect(screen.getByText('LLM 只整理解释，不改变评分。')).toBeInTheDocument();
    expect(screen.getByText('AI参考分：89%')).toBeInTheDocument();
    expect(screen.getByText('LLM 语义审阅识别到更强的项目复杂度线索。')).toBeInTheDocument();
  });

  it('labels cached LLM explanations and timeout fallback distinctly', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));
    vi.mocked(getMatchAssessment).mockResolvedValue(matchAssessment);
    vi.mocked(getMatchExplanation).mockResolvedValueOnce({
      ...matchAssessment,
      explanation_source: 'llm',
      llm_enhancement: 'cached',
      assessment_summary: '缓存解释已复用。',
    });

    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(await screen.findByText('真实评估 · rule_v1.1 · LLM 缓存解释')).toBeInTheDocument();
    expect(screen.getByText('缓存解释已复用。')).toBeInTheDocument();

    act(() => parserClient.emit(secondRelay));
    vi.mocked(getMatchAssessment).mockResolvedValueOnce({
      ...matchAssessment,
      request_id: 'match-timeout',
    });
    vi.mocked(getMatchExplanation).mockResolvedValueOnce({
      ...matchAssessment,
      request_id: 'explain-timeout',
      llm_enhancement: 'timeout',
      explanation_source: 'rule',
    });

    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(await screen.findByText('真实评估 · rule_v1.1 · AI 超时降级')).toBeInTheDocument();
    expect(screen.getByText('AI 解释响应较慢，已保留规则结果')).toBeInTheDocument();
  });

  it('uses the HR-selected job id for scoring', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.selectOptions(screen.getByLabelText('选择匹配岗位'), 'job-java');
    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(getMatchAssessment).toHaveBeenCalledWith('job-java', partialRelay.snapshot.profile);
    expect(getMatchExplanation).toHaveBeenCalledWith('job-java', partialRelay.snapshot.profile);
  });

  it('does not send a scoring request when candidate core information is missing', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();

    act(() => parserClient.emit(insufficientRelay));

    const button = screen.getByRole('button', { name: '分析候选人' });
    expect(screen.getByText('候选人信息不足，暂时无法评分')).toBeInTheDocument();
    expect(button).toBeDisabled();
    await user.click(button);
    expect(getMatchAssessment).not.toHaveBeenCalled();
    expect(getMatchExplanation).not.toHaveBeenCalled();
  });

  it('does not send a scoring request when no job can be selected', async () => {
    vi.mocked(getKnowledgeJobs).mockResolvedValueOnce({ request_id: 'jobs-empty', jobs: [] });
    render(<CopilotPanel />);

    expect(await screen.findByText('暂无可选岗位')).toBeInTheDocument();
    act(() => parserClient.emit(partialRelay));

    expect(screen.getByText('请先选择一个岗位')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析候选人' })).toBeDisabled();
    expect(getMatchAssessment).not.toHaveBeenCalled();
    expect(getMatchExplanation).not.toHaveBeenCalled();
  });

  it('shows loading while real scoring is in flight', async () => {
    const user = userEvent.setup();
    let resolveAssessment: (value: MatchAssessmentResponse) => void = () => undefined;
    vi.mocked(getMatchAssessment).mockReturnValueOnce(new Promise((resolve) => {
      resolveAssessment = resolve;
    }));
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(screen.getByText('正在生成真实评分')).toBeInTheDocument();
    expect(screen.getByText('评分仅发送岗位 ID、CandidateProfile 和可选权重')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在分析' })).toBeDisabled();

    await act(async () => {
      resolveAssessment(matchAssessment);
    });
    expect(await screen.findByText('86%')).toBeInTheDocument();
  });

  it('shows the real scoring error without falling back to demo data', async () => {
    const user = userEvent.setup();
    vi.mocked(getMatchAssessment).mockRejectedValueOnce(
      new ApiError('REQUEST_FAILED', '评分服务返回 HTTP 503'),
    );
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('评分服务返回 HTTP 503');
    expect(screen.queryByText('86%')).not.toBeInTheDocument();
    expect(screen.queryByText('92%')).not.toBeInTheDocument();
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
  });

  it('ignores a stale scoring response after the candidate snapshot changes', async () => {
    const user = userEvent.setup();
    let resolveAssessment: (value: MatchAssessmentResponse) => void = () => undefined;
    vi.mocked(getMatchAssessment).mockReturnValueOnce(new Promise((resolve) => {
      resolveAssessment = resolve;
    }));
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));
    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    act(() => parserClient.emit(secondRelay));
    await act(async () => {
      resolveAssessment(matchAssessment);
    });

    expect(screen.getByText('候选人乙')).toBeInTheDocument();
    expect(screen.queryByText('86%')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析候选人' })).toBeEnabled();
  });

  it('invalidates a pending scoring response as soon as the selected job changes', async () => {
    const user = userEvent.setup();
    let resolveAssessment: (value: MatchAssessmentResponse) => void = () => undefined;
    vi.mocked(getMatchAssessment).mockReturnValueOnce(new Promise((resolve) => {
      resolveAssessment = resolve;
    }));
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));
    await user.click(screen.getByRole('button', { name: '分析候选人' }));

    fireEvent.change(screen.getByLabelText('选择匹配岗位'), { target: { value: 'job-java' } });
    await act(async () => {
      resolveAssessment(matchAssessment);
    });

    expect(screen.getByLabelText('选择匹配岗位')).toHaveValue('job-java');
    expect(screen.queryByText('86%')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析候选人' })).toBeEnabled();
  });

  it('keeps a richer semantic frame selected when a sparse frame arrives later', async () => {
    const richFrame: ParserRelayMessage = {
      type: 'ARC_PARSER_RELAY',
      snapshot: {
        ...buildStatusSnapshot(
          'recommend_frame',
          'unsupported',
          undefined,
          new Date('2026-07-29T02:00:02.000Z'),
        ),
        warnings: [
          'probe:visible-elements=88',
          'probe:heading=work:1',
          'probe:heading=education:1',
        ],
      },
      source: { frame_id: 2, document_id: 'anonymous-document-2' },
    };
    const sparseFrame: ParserRelayMessage = {
      type: 'ARC_PARSER_RELAY',
      snapshot: {
        ...buildStatusSnapshot(
          'resume_frame',
          'unsupported',
          undefined,
          new Date('2026-07-29T02:00:03.000Z'),
        ),
        warnings: ['probe:visible-elements=10'],
      },
      source: { frame_id: 7, document_id: 'anonymous-document-7' },
    };

    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(richFrame));
    act(() => parserClient.emit(sparseFrame));
    await userEvent.setup().click(screen.getByRole('button', { name: '展开读取信息' }));

    expect(screen.getByText('已选择 frame 2 · 检测到固定简历栏目')).toBeInTheDocument();
    expect(screen.getByText(/frame 2 · 推荐候选 · 未匹配/)).toBeInTheDocument();
    expect(screen.getByText(/frame 7 · 候选简历 · 未匹配/)).toBeInTheDocument();
  });

  it('refreshes page reading once without clipboard or scrolling side effects', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<CopilotPanel />);
    await waitForOnlinePanel();

    await user.click(screen.getByRole('button', { name: '重新读取页面' }));

    expect(parserClient.requestRefresh).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(getMatchAssessment).not.toHaveBeenCalled();
  });

  it('reads Vue capability once only after the explicit user click', async () => {
    const user = userEvent.setup();
    parserClient.requestResume.mockResolvedValue({
      ok: true,
      snapshot: {
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
      },
    });
    render(<CopilotPanel />);
    await waitForOnlinePanel();

    expect(parserClient.requestResume).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '读取当前简历' }));

    expect(parserClient.requestResume).toHaveBeenCalledOnce();
    expect(screen.queryByText('已找到可读取的 resumeInfo')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开读取信息' }));

    expect(await screen.findByText('已找到可读取的 resumeInfo')).toBeInTheDocument();
    expect(screen.getByText('允许字段 1')).toBeInTheDocument();
  });

  it('shows the merged Vue exact profile after the explicit read without auto scoring', async () => {
    const user = userEvent.setup();
    parserClient.requestResume.mockResolvedValue({
      ok: true,
      snapshot: {
        ...buildProfileSnapshot('recommend_frame', {
          display_name: '候选人乙',
          education: [{ school: '匿名大学' }],
          work_experiences: [{ company: '匿名公司' }],
          project_experiences: [{ name: '匿名项目' }],
          skills: ['Python'],
        }, new Date('2026-08-07T02:00:00.000Z')),
        parser_version: 'boss-vue-v1',
        warnings: [
          'vue-capability:root=lib-resume-recommend',
          'vue-capability:generation=vue2',
          'vue-capability:resume-object=resumeInfo',
          'vue-capability:key=geekWorkExpList',
        ],
      },
    });
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));

    await user.click(screen.getByRole('button', { name: '读取当前简历' }));

    expect(await screen.findByText('Vue 精确读取（仅本地）')).toBeInTheDocument();
    expect(screen.getByText('候选人乙')).toBeInTheDocument();
    expect(screen.getByText('工作 1')).toBeInTheDocument();
    expect(screen.getByText('教育 1')).toBeInTheDocument();
    expect(screen.getByText('项目 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分析候选人' })).toBeEnabled();
    expect(getMatchAssessment).not.toHaveBeenCalled();
    expect(screen.queryByText('演示数据')).not.toBeInTheDocument();
  });

  it('blocks repeated resume reads in flight and renders only the fixed failure copy', async () => {
    let resolveRead: (value: { ok: false; error: 'vue-instance-not-found' }) => void = () => undefined;
    parserClient.requestResume.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    render(<CopilotPanel />);
    await waitForOnlinePanel();

    const button = screen.getByRole('button', { name: '读取当前简历' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(parserClient.requestResume).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '正在读取简历' })).toBeDisabled();

    await act(async () => {
      resolveRead({ ok: false, error: 'vue-instance-not-found' });
    });
    expect(screen.getByText('当前页面未暴露可读取的简历数据')).toBeInTheDocument();
    expect(screen.queryByText(/private/)).not.toBeInTheDocument();
  });

  it('shows offline guidance and retry when health check fails', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('offline'));

    render(<CopilotPanel />);

    expect(await screen.findByText('评分服务未连接')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新连接' })).toBeInTheDocument();
    expect(screen.getByText(/scripts\\python\.cmd -m uvicorn/)).toBeInTheDocument();
    expect(getKnowledgeJobs).not.toHaveBeenCalled();
    expect(getMatchAssessment).not.toHaveBeenCalled();
  });

  it('reconnects after the backend becomes available again', async () => {
    const user = userEvent.setup();
    vi.mocked(getHealth).mockRejectedValueOnce(new Error('offline'));
    render(<CopilotPanel />);
    await screen.findByText('评分服务未连接');

    await user.click(screen.getByRole('button', { name: '重新连接' }));

    expect(await screen.findByLabelText('选择匹配岗位')).toHaveValue('job-ai4s');
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(getKnowledgeJobs).toHaveBeenCalledTimes(1);
    expect(getMatchAssessment).not.toHaveBeenCalled();
  });

  it('refreshes an online connection and clears stale real-scoring results when the backend stops', async () => {
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
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));
    await user.click(screen.getByRole('button', { name: '分析候选人' }));
    expect(await screen.findByText('86%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '刷新连接' }));

    expect(screen.getByText('正在连接评分服务')).toBeInTheDocument();
    expect(screen.queryByText('86%')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新连接' })).not.toBeInTheDocument();

    await act(async () => {
      rejectRefresh(new Error('offline'));
    });
    expect(await screen.findByText('评分服务未连接')).toBeInTheDocument();
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(getMatchAssessment).toHaveBeenCalledTimes(1);
  });

  it('expands dimension evidence on demand', async () => {
    const user = userEvent.setup();
    render(<CopilotPanel />);
    await waitForOnlinePanel();
    act(() => parserClient.emit(partialRelay));
    await user.click(screen.getByRole('button', { name: '分析候选人' }));
    await screen.findByText('86%');

    expect(screen.queryByText('Python: Python')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /技能匹配/ }));

    expect(screen.getByText('Python: Python')).toBeInTheDocument();
    expect(screen.getByText('RAG: 负责 LangChain RAG 应用')).toBeInTheDocument();
    expect(screen.getByText('候选人具备 Python 和 RAG 经验，LangChain 证据需要补充。')).toBeInTheDocument();
  });

  it('collapses to the edge rail and expands again', async () => {
    const user = userEvent.setup();
    const { container } = render(<CopilotPanel />);
    await waitForOnlinePanel();

    await user.click(screen.getByRole('button', { name: '折叠助手' }));
    expect(screen.getByRole('button', { name: '展开助手' })).toBeInTheDocument();
    expect(container.querySelector('.arc-rail--right')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开助手' }));
    expect(screen.getByRole('button', { name: '折叠助手' })).toBeInTheDocument();
  });

  it('moves the panel between right and left docking positions', async () => {
    const user = userEvent.setup();
    const { container } = render(<CopilotPanel />);
    await waitForOnlinePanel();

    expect(container.querySelector('.arc-panel--right')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移到左侧' }));

    expect(container.querySelector('.arc-panel--left')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '折叠助手' }));
    expect(container.querySelector('.arc-rail--left')).toBeInTheDocument();
  });

  it('drags the panel handle and snaps to the nearest side', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const { container } = render(<CopilotPanel />);
    await waitForOnlinePanel();

    const header = container.querySelector('.arc-header');
    expect(header).toBeInTheDocument();

    fireEvent.pointerDown(header as Element, {
      button: 0,
      clientX: 920,
      clientY: 40,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, {
      clientX: 80,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerUp(window, {
      clientX: 80,
      clientY: 120,
      pointerId: 1,
    });

    const panel = container.querySelector('.arc-panel') as HTMLElement;
    expect(panel).toHaveClass('arc-panel--left');
    expect(panel.style.left).toBe('16px');
    expect(panel.style.right).toBe('auto');
    expect(panel.style.top).toBe('96px');
  });

  it('drags the collapsed rail and keeps it expandable', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const user = userEvent.setup();
    const { container } = render(<CopilotPanel />);
    await waitForOnlinePanel();

    await user.click(screen.getByRole('button', { name: '折叠助手' }));
    const rail = container.querySelector('.arc-rail');
    expect(rail).toBeInTheDocument();

    fireEvent.pointerDown(rail as Element, {
      button: 0,
      clientX: 940,
      clientY: 40,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, {
      clientX: 70,
      clientY: 420,
      pointerId: 1,
    });
    fireEvent.pointerUp(window, {
      clientX: 70,
      clientY: 420,
      pointerId: 1,
    });

    expect(rail).toHaveClass('arc-rail--left');
    expect((rail as HTMLElement).style.top).toBe('396px');

    await user.click(screen.getByRole('button', { name: '展开助手' }));
    expect(container.querySelector('.arc-panel--left')).toBeInTheDocument();
  });
});
