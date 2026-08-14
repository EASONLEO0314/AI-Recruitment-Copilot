import { describe, expect, it, vi } from 'vitest';

import {
  getAdminDashboard,
  getAssessmentRecords,
  getDemoAssessment,
  getHealth,
  getKnowledgeAliases,
  getKnowledgeJobDetail,
  getKnowledgeJobs,
  getKnowledgeQuality,
  getMatchAssessment,
  getMatchExplanation,
  getScoringStandard,
} from './api';
import type { CandidateProfile } from './contracts';


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

const candidateProfile: CandidateProfile = {
  display_name: '张同学',
  experience_years: 4,
  education: [{ school: '匿名大学', degree: '本科' }],
  work_experiences: [],
  project_experiences: [{ name: 'RAG 项目', description: '负责 LangChain RAG 应用' }],
  skills: ['Python', 'RAG'],
};

const matchAssessment = {
  request_id: 'match-1',
  mode: 'rule_v1.1',
  explanation_source: 'rule',
  assessment_summary: '规则评分 86%：技能匹配较好，追问聚焦项目证据。',
  llm_enhancement: 'disabled',
  job_id: 'job-ai4s',
  job_title: 'AI4S 工程师',
  total_score: 86,
  recommendation: '建议进入下一轮',
  dimensions: [
    {
      key: 'skills',
      name: '技能匹配',
      score: 88,
      weight: 45,
      confidence: 0.91,
      reason: '技能较匹配。',
      matched_concepts: ['Python', 'RAG'],
      missing_concepts: ['LangChain'],
      evidence: [
        {
          source: 'candidate.skills',
          text: 'Python',
          concept: 'Python',
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

const jobOptions = {
  request_id: 'jobs-1',
  jobs: [
    {
      job_id: 'job-ai4s',
      title: 'AI4S 工程师',
      department: 'AI4S模型研究院',
      project: '科研智能体',
      status: '招聘中',
    },
  ],
};

const scoringStandard = {
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

const adminDashboard = {
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

const assessmentRecords = {
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

const aliases = {
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

const quality = {
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

const jobDetail = {
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
  jd: '熟悉 Python 和 RAG。',
  concepts: ['Python', 'RAG'],
  profile: {
    required_concepts: ['Python'],
    preferred_concepts: ['RAG'],
    related_concepts: [],
    bonus_concepts: [],
    all_concepts: ['Python', 'RAG'],
    concept_categories: ['backend'],
    education_keywords: ['本科'],
    experience_years_min: 2,
    evaluation_materials: [],
  },
  documents: [],
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

  it('loads lightweight knowledge-base jobs through the service worker', async () => {
    const sendMessage = installRuntime({ ok: true, data: jobOptions });

    const response = await getKnowledgeJobs(3200);

    expect(response.jobs[0].job_id).toBe('job-ai4s');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-jobs',
      limit: 80,
      timeout_ms: 3200,
    });
  });

  it('loads admin dashboard through a fixed service-worker operation', async () => {
    const sendMessage = installRuntime({ ok: true, data: adminDashboard });

    const response = await getAdminDashboard(3200);

    expect(response.total_assessment_records).toBe(3);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'admin-dashboard',
      timeout_ms: 3200,
    });
  });

  it('loads anonymous assessment records through a bounded operation', async () => {
    const sendMessage = installRuntime({ ok: true, data: assessmentRecords });

    const response = await getAssessmentRecords(20, 3200);

    expect(response.records[0].candidate_fingerprint).toContain('abcdef');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'admin-assessments',
      limit: 20,
      timeout_ms: 3200,
    });
  });

  it('loads alias, quality, and selected job detail data for the admin panel', async () => {
    let sendMessage = installRuntime({ ok: true, data: aliases });
    expect((await getKnowledgeAliases(3200)).aliases[0].aliases).toEqual(['React.js']);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-aliases',
      timeout_ms: 3200,
    });

    sendMessage = installRuntime({ ok: true, data: quality });
    const qualityResponse = await getKnowledgeQuality(3200);
    expect(qualityResponse.report.warning_count).toBe(1);
    expect(qualityResponse.report.unrecognized_terms[0].term).toBe('GraphQL');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-quality',
      timeout_ms: 3200,
    });

    sendMessage = installRuntime({ ok: true, data: jobDetail });
    expect((await getKnowledgeJobDetail('job-ai4s', 3200)).profile.required_concepts).toEqual(['Python']);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-job-detail',
      job_id: 'job-ai4s',
      timeout_ms: 3200,
    });
  });

  it('sends the selected job id and CandidateProfile for rule_v1.1 matching', async () => {
    const sendMessage = installRuntime({ ok: true, data: matchAssessment });

    const response = await getMatchAssessment('job-ai4s', candidateProfile);

    expect(response.mode).toBe('rule_v1.1');
    expect(response.total_score).toBe(86);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      timeout_ms: 15000,
    });
  });

  it('can include HR-adjusted scoring weights in the match request', async () => {
    const sendMessage = installRuntime({ ok: true, data: matchAssessment });
    const weights = {
      skills: 50,
      experience_years: 10,
      education: 10,
      experience_evidence: 30,
    };

    await getMatchAssessment('job-ai4s', candidateProfile, weights);

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      scoring_weights: weights,
      timeout_ms: 15000,
    });
  });

  it('requests LLM explanation enhancement as a separate follow-up operation', async () => {
    const sendMessage = installRuntime({ ok: true, data: matchAssessment });

    const response = await getMatchExplanation('job-ai4s', candidateProfile);

    expect(response.mode).toBe('rule_v1.1');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'match-explanation',
      job_id: 'job-ai4s',
      candidate_profile: candidateProfile,
      timeout_ms: 12000,
    });
  });

  it('requests an LLM-generated scoring standard for the selected job', async () => {
    const sendMessage = installRuntime({ ok: true, data: scoringStandard });

    const response = await getScoringStandard('job-ai4s');

    expect(response.standard.source).toBe('llm_generated');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ARC_API_REQUEST',
      operation: 'scoring-standard',
      job_id: 'job-ai4s',
      timeout_ms: 30000,
    });
  });

  it('rejects a malformed rule response before React sees it', async () => {
    installRuntime({ ok: true, data: { ...matchAssessment, risk_flags: ['invalid'] } });

    await expect(getMatchAssessment('job-ai4s', candidateProfile)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a malformed knowledge job list before React sees it', async () => {
    installRuntime({ ok: true, data: { request_id: 'jobs-1', jobs: [{ title: '缺少 ID' }] } });

    await expect(getKnowledgeJobs()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
