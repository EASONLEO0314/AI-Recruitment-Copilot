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
