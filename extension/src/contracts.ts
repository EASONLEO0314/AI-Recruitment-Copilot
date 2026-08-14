export type ConnectionState = 'connecting' | 'online' | 'offline';

export type ApiErrorCode =
  | 'BACKEND_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED';

export interface HealthResponse {
  request_id: string;
  status: 'ok';
  service: 'ai-recruitment-copilot';
  version: '0.1.0';
}

export interface DimensionResult {
  key: string;
  name: string;
  score: number;
  weight: number;
  confidence: number;
  reason: string;
  evidence: string[];
}

export type MessageType = 'greeting' | 'interview_invitation' | 'phone_script';

export interface MessageSuggestion {
  type: MessageType;
  label: string;
  content: string;
}

export interface AssessmentResponse {
  request_id: string;
  mode: 'demo';
  candidate_label: string;
  job_title: string;
  total_score: number;
  recommendation: string;
  dimensions: DimensionResult[];
  highlights: string[];
  risk_flags: string[];
  follow_up_questions: string[];
  messages: MessageSuggestion[];
}

export type AssessmentEvidenceSource =
  | 'candidate.skills'
  | 'candidate.experience_years'
  | 'candidate.education'
  | 'candidate.work_experiences'
  | 'candidate.project_experiences'
  | 'candidate.summary'
  | 'job.profile';

export interface MatchEvidence {
  source: AssessmentEvidenceSource;
  text: string;
  concept?: string | null;
  source_index?: number | null;
  match_type?: 'DIRECT' | 'ALIAS' | 'RELATED' | 'BONUS' | 'NONE' | null;
  matched_with?: string | null;
  weight?: number | null;
  reason?: string | null;
}

export interface MatchDimensionResult {
  key: string;
  name: string;
  score: number;
  weight: number;
  confidence: number;
  reason: string;
  matched_concepts: string[];
  missing_concepts: string[];
  evidence: MatchEvidence[];
}

export type MatchRiskCode =
  | 'missing_required_skill'
  | 'insufficient_experience_years'
  | 'education_mismatch'
  | 'insufficient_candidate_information'
  | 'missing_related_experience_evidence';

export interface MatchRiskFlag {
  code: MatchRiskCode;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  related_dimension: string;
  related_concepts: string[];
}

export interface MatchMissingInformation {
  field: string;
  reason: string;
}

export interface PersonalizedFollowUpQuestion {
  question: string;
  purpose: string;
  evidence_anchor: string;
  copy_text: string;
}

export interface MatchAssessmentRequest {
  job_id: string;
  candidate_profile: CandidateProfile;
  scoring_weights?: Record<string, number>;
}


export interface ScoringCriterion {
  key: string;
  name: string;
  weight: number;
  rationale: string;
}


export interface ScoringStandard {
  standard_id: string;
  source: 'rule_generated' | 'llm_generated' | 'hr_adjusted';
  job_family: string;
  related_compensation_cap: number;
  dimensions: ScoringCriterion[];
}


export interface ScoringStandardResponse {
  request_id: string;
  job_id: string;
  job_title: string;
  standard: ScoringStandard;
}


export interface EligibilityRequirementResult {
  key: string;
  label: string;
  status: 'met' | 'missing' | 'not_met' | 'related_only';
  severity: 'info' | 'warning' | 'critical';
  reason: string;
  related_concepts: string[];
}


export interface EligibilityResult {
  status: 'pass' | 'review' | 'fail';
  summary: string;
  score_cap?: number | null;
  requirements: EligibilityRequirementResult[];
}


export interface ConceptGraphLayer {
  role: 'required' | 'preferred' | 'related' | 'bonus';
  label: string;
  concepts: string[];
  compensation_cap?: number | null;
  description: string;
}


export interface SemanticReviewFinding {
  topic:
    | 'research_relevance'
    | 'project_complexity'
    | 'transferability'
    | 'candidate_contribution'
    | 'missing_skill_severity';
  verdict: 'strong' | 'positive' | 'uncertain' | 'risk' | 'not_applicable';
  summary: string;
  related_concepts: string[];
}


export interface SemanticReview {
  source: 'rule' | 'llm';
  status: 'not_requested' | 'applied' | 'failed';
  summary: string;
  findings: SemanticReviewFinding[];
}

export interface MatchAssessmentResponse {
  request_id: string;
  mode: 'rule_v1' | 'rule_v1.1';
  explanation_source?: 'rule' | 'llm';
  assessment_summary?: string | null;
  llm_enhancement?: 'disabled' | 'applied' | 'cached' | 'failed' | 'timeout' | null;
  job_id: string;
  job_title: string;
  total_score: number;
  fit_score?: number;
  hybrid_score?: number;
  hybrid_delta?: number;
  hybrid_summary?: string;
  potential_level?: 'low' | 'medium' | 'high';
  potential_summary?: string;
  eligibility?: EligibilityResult;
  scoring_standard?: ScoringStandard;
  concept_graph?: ConceptGraphLayer[];
  semantic_review?: SemanticReview;
  recommendation: string;
  dimensions: MatchDimensionResult[];
  highlights: string[];
  risk_flags: MatchRiskFlag[];
  missing_information: MatchMissingInformation[];
  follow_up_questions: string[];
  personalized_follow_up_questions: PersonalizedFollowUpQuestion[];
  evidence: MatchEvidence[];
}

export interface KnowledgeJobOption {
  job_id: string;
  title: string;
  department?: string | null;
  project?: string | null;
  status?: string | null;
}

export interface KnowledgeJobsResponse {
  request_id: string;
  jobs: KnowledgeJobOption[];
}

export interface AssessmentRecordSummary {
  record_id: number;
  candidate_fingerprint: string;
  job_id: string;
  job_title: string;
  total_score: number;
  fit_score: number;
  hybrid_score: number;
  recommendation: string;
  assessed_at: string;
}

export interface AssessmentRecordsResponse {
  request_id: string;
  records: AssessmentRecordSummary[];
}

export interface KnowledgeAliasItem {
  canonical: string;
  category: string;
  aliases: string[];
  frequency: number;
}

export interface KnowledgeAliasesResponse {
  request_id: string;
  aliases: KnowledgeAliasItem[];
}

export interface DashboardTopJob {
  job_id: string;
  job_title: string;
  assessment_count: number;
  average_score: number;
}

export interface AdminDashboardResponse {
  request_id: string;
  total_jobs: number;
  total_concepts: number;
  quality_warning_count: number;
  total_assessment_records: number;
  unique_candidates: number;
  unique_assessed_jobs: number;
  average_score: number;
  top_jobs: DashboardTopJob[];
}

export interface KnowledgeQualityWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  job_id?: string | null;
  source_row?: number | null;
  title?: string | null;
}

export interface KnowledgeQualityJobIssue {
  job_id: string;
  title: string;
  source_row?: number | null;
  department?: string | null;
  suggested_keywords: string[];
}

export interface KnowledgeUnrecognizedTerm {
  term: string;
  frequency: number;
  sample_titles: string[];
}

export interface KnowledgeQualityReport {
  total_rows: number;
  imported_jobs: number;
  warning_count: number;
  status_counts: Record<string, number>;
  department_counts: Record<string, number>;
  unrecognized_terms: KnowledgeUnrecognizedTerm[];
  missing_required_keyword_jobs: KnowledgeQualityJobIssue[];
  warnings: KnowledgeQualityWarning[];
}

export interface KnowledgeQualityResponse {
  request_id: string;
  report: KnowledgeQualityReport;
}

export interface KnowledgeEvaluationMaterial {
  material_id: string;
  label: string;
  category: string;
  signals: string[];
  guidance: string;
}

export interface KnowledgeJobProfile {
  required_concepts: string[];
  preferred_concepts: string[];
  related_concepts: string[];
  bonus_concepts: string[];
  all_concepts: string[];
  concept_categories: string[];
  education_keywords: string[];
  experience_years_min?: number | null;
  evaluation_materials: KnowledgeEvaluationMaterial[];
}

export interface KnowledgeDocument {
  doc_id: string;
  job_id: string;
  title: string;
  kind: string;
  text: string;
  concepts: string[];
}

export interface KnowledgeJobDetailResponse {
  request_id: string;
  job_id: string;
  source_row: number;
  title: string;
  department?: string | null;
  project?: string | null;
  headcount?: number | null;
  change_type?: string | null;
  hiring_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_months?: string | null;
  start_time?: string | null;
  status?: string | null;
  platform?: string | null;
  written_test_required?: string | null;
  required_keywords: string[];
  expected_outputs?: string | null;
  jd: string;
  concepts: string[];
  profile: KnowledgeJobProfile;
  documents: KnowledgeDocument[];
}

export type ApiRequestMessage =
  | {
      type: 'ARC_API_REQUEST';
      operation: 'health';
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'demo-assessment';
      candidate_label: string;
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'match-assessment';
      job_id: string;
      candidate_profile: CandidateProfile;
      scoring_weights?: Record<string, number>;
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'match-explanation';
      job_id: string;
      candidate_profile: CandidateProfile;
      scoring_weights?: Record<string, number>;
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'scoring-standard';
      job_id: string;
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'knowledge-jobs';
      limit: number;
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'admin-dashboard';
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'admin-assessments';
      limit: number;
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'knowledge-aliases';
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'knowledge-quality';
      timeout_ms: number;
    }
  | {
      type: 'ARC_API_REQUEST';
      operation: 'knowledge-job-detail';
      job_id: string;
      timeout_ms: number;
    };

export interface ApiFailure {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiRuntimeResponse<T> = ApiSuccess<T> | ApiFailure;


export const RESUME_READ_ERROR_CODES = [
  'vue-root-not-found',
  'vue-instance-not-found',
  'vue-resume-data-unavailable',
  'vue-schema-unsupported',
  'vue-result-invalid',
  'vue-read-failed',
] as const;

export type ResumeReadErrorCode = typeof RESUME_READ_ERROR_CODES[number];

export interface ResumeReadRequest {
  type: 'ARC_RESUME_READ';
}


export type PageKind =
  | 'logged_out'
  | 'non_candidate'
  | 'recommend_frame'
  | 'resume_frame'
  | 'unsupported';

export type ParserStatus = 'waiting' | 'ready' | 'partial' | 'unsupported' | 'error';

export const RESUME_ITEM_RAW_TEXT_MAX_LENGTH = 2_000;

export interface EducationExperience {
  school?: string;
  degree?: string;
  major?: string;
  period?: string;
  raw_text?: string;
}

export interface WorkExperience {
  company?: string;
  title?: string;
  period?: string;
  description?: string;
  raw_text?: string;
}

export interface ProjectExperience {
  name?: string;
  role?: string;
  period?: string;
  description?: string;
  raw_text?: string;
}

export interface CandidateProfile {
  display_name?: string;
  current_title?: string;
  location?: string;
  experience_years?: number;
  expected_position?: string;
  expected_city?: string;
  education: EducationExperience[];
  work_experiences: WorkExperience[];
  project_experiences: ProjectExperience[];
  skills: string[];
  summary?: string;
}

export interface ParserSnapshot {
  schema_version: 1;
  parser_version: 'boss-dom-v1' | 'boss-vue-v1';
  page_kind: PageKind;
  status: ParserStatus;
  captured_at: string;
  fingerprint?: string;
  profile?: CandidateProfile;
  present_fields: string[];
  missing_fields: string[];
  warnings: string[];
}

export interface ParserSnapshotMessage {
  type: 'ARC_PARSER_SNAPSHOT';
  snapshot: ParserSnapshot;
}

export interface ParserRefreshRequest {
  type: 'ARC_PARSER_REFRESH';
}

export interface ParserRefreshCommand {
  type: 'ARC_PARSER_REFRESH_COMMAND';
}

export interface ParserRelayMessage {
  type: 'ARC_PARSER_RELAY';
  snapshot: ParserSnapshot;
  source: { frame_id: number; document_id: string };
}

export type ResumeReadResponse =
  | { ok: true; snapshot: ParserSnapshot }
  | { ok: false; error: ResumeReadErrorCode };
