import type {
  AssessmentResponse,
  DimensionResult,
  HealthResponse,
  MessageSuggestion,
} from './contracts';


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}


function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}


function isDimension(value: unknown): value is DimensionResult {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.name === 'string'
    && isScore(value.score)
    && isScore(value.weight)
    && typeof value.confidence === 'number'
    && value.confidence >= 0
    && value.confidence <= 1
    && typeof value.reason === 'string'
    && isStringArray(value.evidence);
}


function isMessage(value: unknown): value is MessageSuggestion {
  return isRecord(value)
    && ['greeting', 'interview_invitation', 'phone_script'].includes(String(value.type))
    && typeof value.label === 'string'
    && typeof value.content === 'string';
}


export function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value)
    && typeof value.request_id === 'string'
    && value.status === 'ok'
    && value.service === 'ai-recruitment-copilot'
    && value.version === '0.1.0';
}


export function isAssessmentResponse(value: unknown): value is AssessmentResponse {
  return isRecord(value)
    && typeof value.request_id === 'string'
    && value.mode === 'demo'
    && typeof value.candidate_label === 'string'
    && typeof value.job_title === 'string'
    && isScore(value.total_score)
    && typeof value.recommendation === 'string'
    && Array.isArray(value.dimensions)
    && value.dimensions.every(isDimension)
    && isStringArray(value.highlights)
    && isStringArray(value.risk_flags)
    && isStringArray(value.follow_up_questions)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage);
}
