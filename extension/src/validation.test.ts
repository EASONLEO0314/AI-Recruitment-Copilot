import { describe, expect, it } from 'vitest';

import type { ParserSnapshot } from './contracts';
import * as validation from './validation';


const vueCapabilitySnapshot = {
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
  ],
} as unknown as ParserSnapshot;

const ruleV11MatchResponse = {
  request_id: 'match-1',
  mode: 'rule_v1.1',
  explanation_source: 'rule',
  assessment_summary: '规则评分 72%：存在可迁移线索，建议核实直接证据。',
  llm_enhancement: 'disabled',
  job_id: 'job-001',
  job_title: '全栈开发工程师',
  total_score: 72,
  fit_score: 80,
  hybrid_score: 74,
  hybrid_delta: 2,
  hybrid_summary: 'LLM 语义审阅识别到可迁移线索，受硬性条件上限约束。',
  potential_level: 'medium',
  potential_summary: '存在可继续核实的能力线索。',
  eligibility: {
    status: 'review',
    summary: '基础条件待核实。',
    score_cap: 74,
    requirements: [
      {
        key: 'required_concept:Node.js',
        label: '必备概念：Node.js',
        status: 'related_only',
        severity: 'warning',
        reason: '仅看到 Java 的可迁移线索。',
        related_concepts: ['Node.js'],
      },
    ],
  },
  scoring_standard: {
    standard_id: 'engineering_dynamic_v1',
    source: 'rule_generated',
    job_family: 'engineering',
    related_compensation_cap: 65,
    dimensions: [
      {
        key: 'skills',
        name: '技能匹配',
        weight: 40,
        rationale: '工程岗更看重技术栈直接匹配。',
      },
      {
        key: 'experience_years',
        name: '工作年限匹配',
        weight: 15,
        rationale: '工程岗更看重技术栈直接匹配。',
      },
      {
        key: 'education',
        name: '教育背景匹配',
        weight: 10,
        rationale: '工程岗更看重技术栈直接匹配。',
      },
      {
        key: 'experience_evidence',
        name: '工作/项目经历匹配',
        weight: 35,
        rationale: '工程岗更看重技术栈直接匹配。',
      },
    ],
  },
  concept_graph: [
    {
      role: 'required',
      label: '核心要求',
      concepts: ['Node.js'],
      compensation_cap: null,
      description: '必须优先核实。',
    },
    {
      role: 'related',
      label: '可迁移相关能力',
      concepts: ['Java'],
      compensation_cap: 65,
      description: '只能提供有限补偿。',
    },
  ],
  semantic_review: {
    source: 'rule',
    status: 'not_requested',
    summary: '',
    findings: [],
  },
  recommendation: '建议核实后推进',
  dimensions: [
    {
      key: 'skills',
      name: '技能匹配',
      score: 68,
      weight: 35,
      confidence: 0.82,
      reason: '存在相关迁移证据。',
      matched_concepts: ['Node.js'],
      missing_concepts: ['Node.js'],
      evidence: [
        {
          source: 'candidate.work_experiences',
          source_index: 0,
          text: '负责 Java Spring Boot 接口开发。',
          concept: 'Node.js',
          match_type: 'RELATED',
          matched_with: 'Java',
          weight: 0.55,
          reason: 'Java 与 Node.js 属于可迁移后端经验。',
        },
      ],
    },
  ],
  highlights: ['存在可迁移相关证据。'],
  risk_flags: [
    {
      code: 'missing_required_skill',
      severity: 'warning',
      message: '暂未看到直接证据。',
      related_dimension: 'skills',
      related_concepts: ['Node.js'],
    },
  ],
  missing_information: [],
  follow_up_questions: ['请确认是否直接使用过 Node.js。'],
  personalized_follow_up_questions: [
    {
      question: '请你结合 Java Spring Boot 接口开发经历，说明是否直接负责过 Node.js 服务？',
      purpose: '核实 Node.js 是否只有可迁移证据。',
      evidence_anchor: 'Java Spring Boot 接口开发',
      copy_text: '请你结合 Java Spring Boot 接口开发经历，说明是否直接负责过 Node.js 服务？',
    },
  ],
  evidence: [
    {
      source: 'candidate.work_experiences',
      source_index: 0,
      text: '负责 Java Spring Boot 接口开发。',
      concept: 'Node.js',
      match_type: 'RELATED',
      matched_with: 'Java',
      weight: 0.55,
      reason: 'Java 与 Node.js 属于可迁移后端经验。',
    },
  ],
};

const adminDashboardResponse = {
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
      job_id: 'job-001',
      job_title: '全栈开发工程师',
      assessment_count: 2,
      average_score: 74,
    },
  ],
};

const assessmentRecordsResponse = {
  request_id: 'records-1',
  records: [
    {
      record_id: 1,
      candidate_fingerprint: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      job_id: 'job-001',
      job_title: '全栈开发工程师',
      total_score: 72,
      fit_score: 72,
      hybrid_score: 72,
      recommendation: '建议核实后推进',
      assessed_at: '2026-08-13T08:00:00+00:00',
    },
  ],
};

const aliasesResponse = {
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

const qualityResponse = {
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
        job_id: 'job-002',
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
        job_id: 'job-002',
        source_row: 3,
        title: '后端工程师',
      },
    ],
  },
};

const jobDetailResponse = {
  request_id: 'detail-1',
  job_id: 'job-001',
  source_row: 2,
  title: '全栈开发工程师',
  department: '工程中心',
  project: '业务平台',
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
  required_keywords: ['JavaScript'],
  expected_outputs: null,
  jd: '熟悉 JavaScript、Node.js、React。',
  concepts: ['JavaScript', 'Node.js', 'React'],
  profile: {
    required_concepts: ['JavaScript', 'Node.js'],
    preferred_concepts: ['React'],
    related_concepts: [],
    bonus_concepts: [],
    all_concepts: ['JavaScript', 'Node.js', 'React'],
    concept_categories: ['frontend', 'backend'],
    education_keywords: ['本科'],
    experience_years_min: 2,
    evaluation_materials: [],
  },
  documents: [],
};


function resumeReadValidators() {
  return validation as unknown as {
    isResumeReadRequest?: (value: unknown) => boolean;
    isResumeReadResponse?: (value: unknown) => boolean;
  };
}


describe('resume read request validation', () => {
  it('accepts only the fixed user-triggered request', () => {
    const { isResumeReadRequest } = resumeReadValidators();

    expect(isResumeReadRequest?.({ type: 'ARC_RESUME_READ' })).toBe(true);
    expect(isResumeReadRequest?.({ type: 'ARC_RESUME_READ', retry: true })).toBe(false);
    expect(isResumeReadRequest?.({ type: 'ARC_PARSER_REFRESH' })).toBe(false);
  });
});


describe('resume read response validation', () => {
  it('accepts a strictly validated Vue capability snapshot', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(validation.isParserSnapshot(vueCapabilitySnapshot)).toBe(true);
    expect(isResumeReadResponse?.({ ok: true, snapshot: vueCapabilitySnapshot })).toBe(true);
  });

  it('rejects unknown versions, extra keys, and oversized arrays', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, parser_version: 'unknown-v1' },
    })).toBe(false);
    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, private_page_value: 'forbidden' },
    })).toBe(false);
    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, warnings: Array(181).fill('bounded') },
    })).toBe(false);
  });

  it('accepts the bounded 170-warning nested diagnostic bundle without widening DOM snapshots', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(isResumeReadResponse?.({
      ok: true,
      snapshot: { ...vueCapabilitySnapshot, warnings: Array(170).fill('bounded') },
    })).toBe(true);
    expect(validation.isParserSnapshot({
      ...vueCapabilitySnapshot,
      parser_version: 'boss-dom-v1',
      warnings: Array(41).fill('bounded'),
    })).toBe(false);
  });

  it('accepts only fixed failure codes without diagnostic details', () => {
    const { isResumeReadResponse } = resumeReadValidators();

    expect(isResumeReadResponse?.({ ok: false, error: 'vue-root-not-found' })).toBe(true);
    expect(isResumeReadResponse?.({ ok: false, error: 'private exception text' })).toBe(false);
    expect(isResumeReadResponse?.({
      ok: false,
      error: 'vue-read-failed',
      detail: 'forbidden',
    })).toBe(false);
  });
});


describe('match assessment response validation', () => {
  it('accepts rule_v1.1 evidence with match metadata', () => {
    expect(validation.isMatchAssessmentResponse(ruleV11MatchResponse)).toBe(true);
  });

  it('rejects unknown explanation metadata', () => {
    expect(validation.isMatchAssessmentResponse({
      ...ruleV11MatchResponse,
      llm_enhancement: 'rewrote-score',
    })).toBe(false);
  });

  it('accepts cached and timeout LLM enhancement metadata', () => {
    expect(validation.isMatchAssessmentResponse({
      ...ruleV11MatchResponse,
      llm_enhancement: 'cached',
      explanation_source: 'llm',
    })).toBe(true);
    expect(validation.isMatchAssessmentResponse({
      ...ruleV11MatchResponse,
      llm_enhancement: 'timeout',
      explanation_source: 'rule',
    })).toBe(true);
  });

  it('rejects out-of-bound hybrid calibration metadata', () => {
    expect(validation.isMatchAssessmentResponse({
      ...ruleV11MatchResponse,
      hybrid_delta: 11,
    })).toBe(false);
  });

  it('keeps accepting rule_v1 responses during comparisons', () => {
    expect(validation.isMatchAssessmentResponse({
      request_id: 'match-legacy',
      mode: 'rule_v1',
      job_id: 'job-001',
      job_title: '全栈开发工程师',
      total_score: 60,
      recommendation: '建议补充信息',
      dimensions: [],
      highlights: [],
      risk_flags: [],
      missing_information: [],
      follow_up_questions: [],
      personalized_follow_up_questions: [],
      evidence: [],
    })).toBe(true);
  });
});


describe('admin response validation', () => {
  it('accepts bounded management dashboard data', () => {
    expect(validation.isAdminDashboardResponse(adminDashboardResponse)).toBe(true);
    expect(validation.isAssessmentRecordsResponse(assessmentRecordsResponse)).toBe(true);
    expect(validation.isKnowledgeAliasesResponse(aliasesResponse)).toBe(true);
    expect(validation.isKnowledgeQualityResponse(qualityResponse)).toBe(true);
    expect(validation.isKnowledgeJobDetailResponse(jobDetailResponse)).toBe(true);
  });

  it('rejects extra fields and invalid anonymous record summaries', () => {
    expect(validation.isAdminDashboardResponse({
      ...adminDashboardResponse,
      raw_sql: 'forbidden',
    })).toBe(false);
    expect(validation.isAssessmentRecordsResponse({
      ...assessmentRecordsResponse,
      records: [
        {
          ...assessmentRecordsResponse.records[0],
          candidate_fingerprint: 'x'.repeat(65),
        },
      ],
    })).toBe(false);
    expect(validation.isKnowledgeJobDetailResponse({
      ...jobDetailResponse,
      profile: { ...jobDetailResponse.profile, required_concepts: Array(201).fill('Python') },
    })).toBe(false);
  });
});
