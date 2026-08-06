import type {
  AssessmentResponse,
  CandidateProfile,
  DimensionResult,
  HealthResponse,
  MessageSuggestion,
  ParserSnapshot,
} from './contracts';
import { RESUME_ITEM_RAW_TEXT_MAX_LENGTH } from './contracts';


export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}


function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}


function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}


function isSafeString(value: unknown, maxLength = 160): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}


function isOptionalSafeString(
  record: Record<string, unknown>,
  key: string,
  maxLength = 160,
): boolean {
  return !(key in record) || isSafeString(record[key], maxLength);
}


function isBoundedStringArray(value: unknown, maxItems: number, maxLength = 160): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isSafeString(item, maxLength));
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


const SNAPSHOT_KEYS = [
  'schema_version',
  'parser_version',
  'page_kind',
  'status',
  'captured_at',
  'fingerprint',
  'profile',
  'present_fields',
  'missing_fields',
  'warnings',
] as const;

const PROFILE_KEYS = [
  'display_name',
  'current_title',
  'location',
  'experience_years',
  'expected_position',
  'expected_city',
  'education',
  'work_experiences',
  'project_experiences',
  'skills',
  'summary',
] as const;

const EDUCATION_KEYS = ['school', 'degree', 'major', 'period', 'raw_text'] as const;
const WORK_KEYS = ['company', 'title', 'period', 'description', 'raw_text'] as const;
const PROJECT_KEYS = ['name', 'role', 'period', 'description', 'raw_text'] as const;

const PAGE_KINDS = [
  'logged_out',
  'non_candidate',
  'recommend_frame',
  'resume_frame',
  'unsupported',
] as const;

const PARSER_STATUSES = ['waiting', 'ready', 'partial', 'unsupported', 'error'] as const;


function isEducationExperience(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, EDUCATION_KEYS)
    && ['school', 'degree', 'major', 'period']
      .every((key) => isOptionalSafeString(value, key))
    && isOptionalSafeString(value, 'raw_text', RESUME_ITEM_RAW_TEXT_MAX_LENGTH);
}


function isWorkExperience(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, WORK_KEYS)
    && isOptionalSafeString(value, 'company')
    && isOptionalSafeString(value, 'title')
    && isOptionalSafeString(value, 'period')
    && isOptionalSafeString(value, 'description', 500)
    && isOptionalSafeString(value, 'raw_text', RESUME_ITEM_RAW_TEXT_MAX_LENGTH);
}


function isProjectExperience(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, PROJECT_KEYS)
    && isOptionalSafeString(value, 'name')
    && isOptionalSafeString(value, 'role')
    && isOptionalSafeString(value, 'period')
    && isOptionalSafeString(value, 'description', 500)
    && isOptionalSafeString(value, 'raw_text', RESUME_ITEM_RAW_TEXT_MAX_LENGTH);
}


function isBoundedArray(value: unknown, validator: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= 50 && value.every(validator);
}


function isCandidateProfile(value: unknown): value is CandidateProfile {
  if (!isRecord(value) || !hasOnlyKeys(value, PROFILE_KEYS)) {
    return false;
  }

  const scalarKeys = [
    'display_name',
    'current_title',
    'location',
    'expected_position',
    'expected_city',
  ] as const;

  return scalarKeys.every((key) => isOptionalSafeString(value, key))
    && isOptionalSafeString(value, 'summary', 500)
    && (!('experience_years' in value)
      || (Number.isInteger(value.experience_years)
        && Number(value.experience_years) >= 0
        && Number(value.experience_years) <= 80))
    && isBoundedArray(value.education, isEducationExperience)
    && isBoundedArray(value.work_experiences, isWorkExperience)
    && isBoundedArray(value.project_experiences, isProjectExperience)
    && isBoundedStringArray(value.skills, 50);
}


export function isParserSnapshot(value: unknown): value is ParserSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, SNAPSHOT_KEYS)) {
    return false;
  }

  return value.schema_version === 1
    && value.parser_version === 'boss-dom-v1'
    && PAGE_KINDS.includes(value.page_kind as typeof PAGE_KINDS[number])
    && PARSER_STATUSES.includes(value.status as typeof PARSER_STATUSES[number])
    && typeof value.captured_at === 'string'
    && Number.isFinite(Date.parse(value.captured_at))
    && isOptionalSafeString(value, 'fingerprint')
    && (!('profile' in value) || isCandidateProfile(value.profile))
    && isBoundedStringArray(value.present_fields, 50)
    && isBoundedStringArray(value.missing_fields, 50)
    && isBoundedStringArray(value.warnings, 40);
}
