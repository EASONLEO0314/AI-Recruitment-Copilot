import type {
  AdminDashboardResponse,
  AssessmentResponse,
  AssessmentRecordSummary,
  AssessmentRecordsResponse,
  CandidateProfile,
  DimensionResult,
  HealthResponse,
  ConceptGraphLayer,
  DashboardTopJob,
  EligibilityRequirementResult,
  EligibilityResult,
  KnowledgeAliasesResponse,
  KnowledgeAliasItem,
  KnowledgeDocument,
  KnowledgeEvaluationMaterial,
  KnowledgeJobDetailResponse,
  KnowledgeJobOption,
  KnowledgeJobProfile,
  KnowledgeJobsResponse,
  KnowledgeQualityJobIssue,
  KnowledgeQualityReport,
  KnowledgeQualityResponse,
  KnowledgeUnrecognizedTerm,
  KnowledgeQualityWarning,
  MatchAssessmentResponse,
  MatchDimensionResult,
  MatchEvidence,
  MatchMissingInformation,
  MatchRiskFlag,
  MessageSuggestion,
  ParserSnapshot,
  PersonalizedFollowUpQuestion,
  ScoringCriterion,
  ScoringStandard,
  ScoringStandardResponse,
  SemanticReview,
  SemanticReviewFinding,
} from './contracts';
import {
  RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
  RESUME_READ_ERROR_CODES,
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


function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
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


function isOptionalNullableSafeString(
  record: Record<string, unknown>,
  key: string,
  maxLength = 160,
): boolean {
  return !(key in record) || record[key] === null || isSafeString(record[key], maxLength);
}


function isBoundedStringArray(value: unknown, maxItems: number, maxLength = 160): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isSafeString(item, maxLength));
}


function isOptionalNullableInteger(
  record: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): boolean {
  return !(key in record)
    || record[key] === null
    || (Number.isInteger(record[key])
      && Number(record[key]) >= min
      && Number(record[key]) <= max);
}


function isNonNegativeNumberRecord(value: unknown, maxKeys = 200): value is Record<string, number> {
  return isRecord(value)
    && Object.keys(value).length <= maxKeys
    && Object.keys(value).every((key) => isSafeString(key, 160))
    && Object.values(value).every(isNonNegativeInteger);
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


const EVIDENCE_SOURCES = [
  'candidate.skills',
  'candidate.experience_years',
  'candidate.education',
  'candidate.work_experiences',
  'candidate.project_experiences',
  'candidate.summary',
  'job.profile',
] as const;

const MATCH_RISK_CODES = [
  'missing_required_skill',
  'insufficient_experience_years',
  'education_mismatch',
  'insufficient_candidate_information',
  'missing_related_experience_evidence',
] as const;

const RISK_SEVERITIES = ['info', 'warning', 'critical'] as const;

const MATCH_TYPES = ['DIRECT', 'ALIAS', 'RELATED', 'BONUS', 'NONE'] as const;
const EXPLANATION_SOURCES = ['rule', 'llm'] as const;
const LLM_ENHANCEMENT_STATES = ['disabled', 'applied', 'cached', 'failed', 'timeout'] as const;
const SCORING_STANDARD_SOURCES = ['rule_generated', 'llm_generated', 'hr_adjusted'] as const;
const ELIGIBILITY_STATUSES = ['pass', 'review', 'fail'] as const;
const ELIGIBILITY_REQUIREMENT_STATUSES = ['met', 'missing', 'not_met', 'related_only'] as const;
const CONCEPT_GRAPH_ROLES = ['required', 'preferred', 'related', 'bonus'] as const;
const SEMANTIC_REVIEW_SOURCES = ['rule', 'llm'] as const;
const SEMANTIC_REVIEW_STATUSES = ['not_requested', 'applied', 'failed'] as const;
const SEMANTIC_REVIEW_TOPICS = [
  'research_relevance',
  'project_complexity',
  'transferability',
  'candidate_contribution',
  'missing_skill_severity',
] as const;
const SEMANTIC_REVIEW_VERDICTS = [
  'strong',
  'positive',
  'uncertain',
  'risk',
  'not_applicable',
] as const;

const MATCH_EVIDENCE_KEYS = [
  'source',
  'text',
  'concept',
  'source_index',
  'match_type',
  'matched_with',
  'weight',
  'reason',
] as const;
const MATCH_DIMENSION_KEYS = [
  'key',
  'name',
  'score',
  'weight',
  'confidence',
  'reason',
  'matched_concepts',
  'missing_concepts',
  'evidence',
] as const;
const MATCH_RISK_KEYS = [
  'code',
  'severity',
  'message',
  'related_dimension',
  'related_concepts',
] as const;
const MATCH_MISSING_KEYS = ['field', 'reason'] as const;
const PERSONALIZED_FOLLOW_UP_KEYS = [
  'question',
  'purpose',
  'evidence_anchor',
  'copy_text',
] as const;
const SCORING_CRITERION_KEYS = ['key', 'name', 'weight', 'rationale'] as const;
const SCORING_STANDARD_KEYS = [
  'standard_id',
  'source',
  'job_family',
  'related_compensation_cap',
  'dimensions',
] as const;
const ELIGIBILITY_REQUIREMENT_KEYS = [
  'key',
  'label',
  'status',
  'severity',
  'reason',
  'related_concepts',
] as const;
const ELIGIBILITY_KEYS = ['status', 'summary', 'score_cap', 'requirements'] as const;
const CONCEPT_GRAPH_LAYER_KEYS = [
  'role',
  'label',
  'concepts',
  'compensation_cap',
  'description',
] as const;
const SEMANTIC_REVIEW_FINDING_KEYS = [
  'topic',
  'verdict',
  'summary',
  'related_concepts',
] as const;
const SEMANTIC_REVIEW_KEYS = ['source', 'status', 'summary', 'findings'] as const;
const SCORING_STANDARD_RESPONSE_KEYS = [
  'request_id',
  'job_id',
  'job_title',
  'standard',
] as const;
const MATCH_RESPONSE_KEYS = [
  'request_id',
  'mode',
  'explanation_source',
  'assessment_summary',
  'llm_enhancement',
  'job_id',
  'job_title',
  'total_score',
  'fit_score',
  'hybrid_score',
  'hybrid_delta',
  'hybrid_summary',
  'potential_level',
  'potential_summary',
  'eligibility',
  'scoring_standard',
  'concept_graph',
  'semantic_review',
  'recommendation',
  'dimensions',
  'highlights',
  'risk_flags',
  'missing_information',
  'follow_up_questions',
  'personalized_follow_up_questions',
  'evidence',
] as const;
const KNOWLEDGE_JOB_KEYS = ['job_id', 'title', 'department', 'project', 'status'] as const;
const ASSESSMENT_RECORD_KEYS = [
  'record_id',
  'candidate_fingerprint',
  'job_id',
  'job_title',
  'total_score',
  'fit_score',
  'hybrid_score',
  'recommendation',
  'assessed_at',
] as const;
const KNOWLEDGE_ALIAS_KEYS = ['canonical', 'category', 'aliases', 'frequency'] as const;
const DASHBOARD_TOP_JOB_KEYS = [
  'job_id',
  'job_title',
  'assessment_count',
  'average_score',
] as const;
const ADMIN_DASHBOARD_KEYS = [
  'request_id',
  'total_jobs',
  'total_concepts',
  'quality_warning_count',
  'total_assessment_records',
  'unique_candidates',
  'unique_assessed_jobs',
  'average_score',
  'top_jobs',
] as const;
const KNOWLEDGE_QUALITY_WARNING_KEYS = [
  'code',
  'severity',
  'message',
  'job_id',
  'source_row',
  'title',
] as const;
const KNOWLEDGE_UNRECOGNIZED_TERM_KEYS = [
  'term',
  'frequency',
  'sample_titles',
] as const;
const KNOWLEDGE_QUALITY_JOB_ISSUE_KEYS = [
  'job_id',
  'title',
  'source_row',
  'department',
  'suggested_keywords',
] as const;
const KNOWLEDGE_QUALITY_REPORT_KEYS = [
  'total_rows',
  'imported_jobs',
  'warning_count',
  'status_counts',
  'department_counts',
  'unrecognized_terms',
  'missing_required_keyword_jobs',
  'warnings',
] as const;
const KNOWLEDGE_EVALUATION_MATERIAL_KEYS = [
  'material_id',
  'label',
  'category',
  'signals',
  'guidance',
] as const;
const KNOWLEDGE_JOB_PROFILE_KEYS = [
  'required_concepts',
  'preferred_concepts',
  'related_concepts',
  'bonus_concepts',
  'all_concepts',
  'concept_categories',
  'education_keywords',
  'experience_years_min',
  'evaluation_materials',
] as const;
const KNOWLEDGE_DOCUMENT_KEYS = [
  'doc_id',
  'job_id',
  'title',
  'kind',
  'text',
  'concepts',
] as const;
const KNOWLEDGE_JOB_DETAIL_KEYS = [
  'request_id',
  'job_id',
  'source_row',
  'title',
  'department',
  'project',
  'headcount',
  'change_type',
  'hiring_type',
  'salary_min',
  'salary_max',
  'salary_months',
  'start_time',
  'status',
  'platform',
  'written_test_required',
  'required_keywords',
  'expected_outputs',
  'jd',
  'concepts',
  'profile',
  'documents',
] as const;


function isMatchEvidence(value: unknown): value is MatchEvidence {
  return isRecord(value)
    && hasOnlyKeys(value, MATCH_EVIDENCE_KEYS)
    && EVIDENCE_SOURCES.includes(value.source as typeof EVIDENCE_SOURCES[number])
    && isSafeString(value.text, 300)
    && isOptionalNullableSafeString(value, 'concept')
    && (!('match_type' in value)
      || value.match_type === null
      || MATCH_TYPES.includes(value.match_type as typeof MATCH_TYPES[number]))
    && isOptionalNullableSafeString(value, 'matched_with')
    && (!('weight' in value)
      || value.weight === null
      || (typeof value.weight === 'number'
        && Number.isFinite(value.weight)
        && value.weight >= 0
        && value.weight <= 1))
    && isOptionalNullableSafeString(value, 'reason', 240)
    && (!('source_index' in value)
      || value.source_index === null
      || (Number.isInteger(value.source_index) && Number(value.source_index) >= 0));
}


function isMatchDimension(value: unknown): value is MatchDimensionResult {
  return isRecord(value)
    && hasOnlyKeys(value, MATCH_DIMENSION_KEYS)
    && typeof value.key === 'string'
    && typeof value.name === 'string'
    && isScore(value.score)
    && isScore(value.weight)
    && typeof value.confidence === 'number'
    && value.confidence >= 0
    && value.confidence <= 1
    && typeof value.reason === 'string'
    && isStringArray(value.matched_concepts)
    && isStringArray(value.missing_concepts)
    && Array.isArray(value.evidence)
    && value.evidence.every(isMatchEvidence);
}


function isMatchRiskFlag(value: unknown): value is MatchRiskFlag {
  return isRecord(value)
    && hasOnlyKeys(value, MATCH_RISK_KEYS)
    && MATCH_RISK_CODES.includes(value.code as typeof MATCH_RISK_CODES[number])
    && RISK_SEVERITIES.includes(value.severity as typeof RISK_SEVERITIES[number])
    && typeof value.message === 'string'
    && typeof value.related_dimension === 'string'
    && isStringArray(value.related_concepts);
}


function isMatchMissingInformation(value: unknown): value is MatchMissingInformation {
  return isRecord(value)
    && hasOnlyKeys(value, MATCH_MISSING_KEYS)
    && typeof value.field === 'string'
    && typeof value.reason === 'string';
}


function isPersonalizedFollowUpQuestion(value: unknown): value is PersonalizedFollowUpQuestion {
  return isRecord(value)
    && hasOnlyKeys(value, PERSONALIZED_FOLLOW_UP_KEYS)
    && isSafeString(value.question, 240)
    && isSafeString(value.purpose, 180)
    && isSafeString(value.evidence_anchor, 160)
    && isSafeString(value.copy_text, 320);
}


function isScoringCriterion(value: unknown): value is ScoringCriterion {
  return isRecord(value)
    && hasOnlyKeys(value, SCORING_CRITERION_KEYS)
    && typeof value.key === 'string'
    && typeof value.name === 'string'
    && isScore(value.weight)
    && isSafeString(value.rationale, 240);
}


function isScoringStandard(value: unknown): value is ScoringStandard {
  return isRecord(value)
    && hasOnlyKeys(value, SCORING_STANDARD_KEYS)
    && isSafeString(value.standard_id, 80)
    && SCORING_STANDARD_SOURCES.includes(value.source as typeof SCORING_STANDARD_SOURCES[number])
    && isSafeString(value.job_family, 80)
    && isScore(value.related_compensation_cap)
    && Array.isArray(value.dimensions)
    && value.dimensions.every(isScoringCriterion);
}


function isEligibilityRequirement(value: unknown): value is EligibilityRequirementResult {
  return isRecord(value)
    && hasOnlyKeys(value, ELIGIBILITY_REQUIREMENT_KEYS)
    && typeof value.key === 'string'
    && isSafeString(value.label, 160)
    && ELIGIBILITY_REQUIREMENT_STATUSES.includes(
      value.status as typeof ELIGIBILITY_REQUIREMENT_STATUSES[number],
    )
    && RISK_SEVERITIES.includes(value.severity as typeof RISK_SEVERITIES[number])
    && isSafeString(value.reason, 260)
    && isStringArray(value.related_concepts);
}


function isEligibilityResult(value: unknown): value is EligibilityResult {
  return isRecord(value)
    && hasOnlyKeys(value, ELIGIBILITY_KEYS)
    && ELIGIBILITY_STATUSES.includes(value.status as typeof ELIGIBILITY_STATUSES[number])
    && isSafeString(value.summary, 260)
    && (!('score_cap' in value) || value.score_cap === null || isScore(value.score_cap))
    && Array.isArray(value.requirements)
    && value.requirements.every(isEligibilityRequirement);
}


function isConceptGraphLayer(value: unknown): value is ConceptGraphLayer {
  return isRecord(value)
    && hasOnlyKeys(value, CONCEPT_GRAPH_LAYER_KEYS)
    && CONCEPT_GRAPH_ROLES.includes(value.role as typeof CONCEPT_GRAPH_ROLES[number])
    && isSafeString(value.label, 80)
    && isStringArray(value.concepts)
    && (!('compensation_cap' in value)
      || value.compensation_cap === null
      || isScore(value.compensation_cap))
    && isSafeString(value.description, 240);
}


function isSemanticReviewFinding(value: unknown): value is SemanticReviewFinding {
  return isRecord(value)
    && hasOnlyKeys(value, SEMANTIC_REVIEW_FINDING_KEYS)
    && SEMANTIC_REVIEW_TOPICS.includes(value.topic as typeof SEMANTIC_REVIEW_TOPICS[number])
    && SEMANTIC_REVIEW_VERDICTS.includes(value.verdict as typeof SEMANTIC_REVIEW_VERDICTS[number])
    && isSafeString(value.summary, 260)
    && isStringArray(value.related_concepts);
}


function isSemanticReview(value: unknown): value is SemanticReview {
  return isRecord(value)
    && hasOnlyKeys(value, SEMANTIC_REVIEW_KEYS)
    && SEMANTIC_REVIEW_SOURCES.includes(value.source as typeof SEMANTIC_REVIEW_SOURCES[number])
    && SEMANTIC_REVIEW_STATUSES.includes(value.status as typeof SEMANTIC_REVIEW_STATUSES[number])
    && isSafeString(value.summary, 500)
    && Array.isArray(value.findings)
    && value.findings.every(isSemanticReviewFinding);
}


function isKnowledgeJobOption(value: unknown): value is KnowledgeJobOption {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_JOB_KEYS)
    && isSafeString(value.job_id, 80)
    && isSafeString(value.title, 160)
    && isOptionalNullableSafeString(value, 'department')
    && isOptionalNullableSafeString(value, 'project')
    && isOptionalNullableSafeString(value, 'status');
}


function isAssessmentRecordSummary(value: unknown): value is AssessmentRecordSummary {
  return isRecord(value)
    && hasOnlyKeys(value, ASSESSMENT_RECORD_KEYS)
    && Number.isInteger(value.record_id)
    && Number(value.record_id) >= 1
    && isSafeString(value.candidate_fingerprint, 64)
    && isSafeString(value.job_id, 80)
    && isSafeString(value.job_title, 160)
    && isScore(value.total_score)
    && isScore(value.fit_score)
    && isScore(value.hybrid_score)
    && isSafeString(value.recommendation, 160)
    && isSafeString(value.assessed_at, 80);
}


function isKnowledgeAliasItem(value: unknown): value is KnowledgeAliasItem {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_ALIAS_KEYS)
    && isSafeString(value.canonical, 160)
    && isSafeString(value.category, 80)
    && isBoundedStringArray(value.aliases, 80, 160)
    && isNonNegativeInteger(value.frequency);
}


function isDashboardTopJob(value: unknown): value is DashboardTopJob {
  return isRecord(value)
    && hasOnlyKeys(value, DASHBOARD_TOP_JOB_KEYS)
    && isSafeString(value.job_id, 80)
    && isSafeString(value.job_title, 160)
    && isNonNegativeInteger(value.assessment_count)
    && isScore(value.average_score);
}


function isKnowledgeQualityWarning(value: unknown): value is KnowledgeQualityWarning {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_QUALITY_WARNING_KEYS)
    && isSafeString(value.code, 80)
    && (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error')
    && isSafeString(value.message, 500)
    && isOptionalNullableSafeString(value, 'job_id', 80)
    && isOptionalNullableInteger(value, 'source_row')
    && isOptionalNullableSafeString(value, 'title', 160);
}


function isKnowledgeUnrecognizedTerm(value: unknown): value is KnowledgeUnrecognizedTerm {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_UNRECOGNIZED_TERM_KEYS)
    && isSafeString(value.term, 80)
    && Number.isInteger(value.frequency)
    && Number(value.frequency) >= 2
    && isBoundedStringArray(value.sample_titles, 3, 160);
}


function isKnowledgeQualityJobIssue(value: unknown): value is KnowledgeQualityJobIssue {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_QUALITY_JOB_ISSUE_KEYS)
    && isSafeString(value.job_id, 80)
    && isSafeString(value.title, 160)
    && isOptionalNullableInteger(value, 'source_row')
    && isOptionalNullableSafeString(value, 'department', 160)
    && isBoundedStringArray(value.suggested_keywords, 12, 80);
}


function isKnowledgeQualityReport(value: unknown): value is KnowledgeQualityReport {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_QUALITY_REPORT_KEYS)
    && isNonNegativeInteger(value.total_rows)
    && isNonNegativeInteger(value.imported_jobs)
    && isNonNegativeInteger(value.warning_count)
    && isNonNegativeNumberRecord(value.status_counts)
    && isNonNegativeNumberRecord(value.department_counts)
    && Array.isArray(value.unrecognized_terms)
    && value.unrecognized_terms.length <= 100
    && value.unrecognized_terms.every(isKnowledgeUnrecognizedTerm)
    && Array.isArray(value.missing_required_keyword_jobs)
    && value.missing_required_keyword_jobs.length <= 500
    && value.missing_required_keyword_jobs.every(isKnowledgeQualityJobIssue)
    && Array.isArray(value.warnings)
    && value.warnings.length <= 500
    && value.warnings.every(isKnowledgeQualityWarning);
}


function isKnowledgeEvaluationMaterial(value: unknown): value is KnowledgeEvaluationMaterial {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_EVALUATION_MATERIAL_KEYS)
    && isSafeString(value.material_id, 80)
    && isSafeString(value.label, 160)
    && isSafeString(value.category, 80)
    && isBoundedStringArray(value.signals, 50, 160)
    && isSafeString(value.guidance, 500);
}


function isKnowledgeJobProfile(value: unknown): value is KnowledgeJobProfile {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_JOB_PROFILE_KEYS)
    && isBoundedStringArray(value.required_concepts, 200)
    && isBoundedStringArray(value.preferred_concepts, 200)
    && isBoundedStringArray(value.related_concepts, 200)
    && isBoundedStringArray(value.bonus_concepts, 200)
    && isBoundedStringArray(value.all_concepts, 400)
    && isBoundedStringArray(value.concept_categories, 80, 80)
    && isBoundedStringArray(value.education_keywords, 20, 80)
    && isOptionalNullableInteger(value, 'experience_years_min', 0, 80)
    && Array.isArray(value.evaluation_materials)
    && value.evaluation_materials.length <= 80
    && value.evaluation_materials.every(isKnowledgeEvaluationMaterial);
}


function isKnowledgeDocument(value: unknown): value is KnowledgeDocument {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_DOCUMENT_KEYS)
    && isSafeString(value.doc_id, 120)
    && isSafeString(value.job_id, 80)
    && isSafeString(value.title, 160)
    && isSafeString(value.kind, 80)
    && isSafeString(value.text, 10_000)
    && isBoundedStringArray(value.concepts, 200);
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


export function isMatchAssessmentResponse(value: unknown): value is MatchAssessmentResponse {
  return isRecord(value)
    && hasOnlyKeys(value, MATCH_RESPONSE_KEYS)
    && typeof value.request_id === 'string'
    && (value.mode === 'rule_v1' || value.mode === 'rule_v1.1')
    && (!('explanation_source' in value)
      || EXPLANATION_SOURCES.includes(value.explanation_source as typeof EXPLANATION_SOURCES[number]))
    && isOptionalNullableSafeString(value, 'assessment_summary', 500)
    && (!('llm_enhancement' in value)
      || value.llm_enhancement === null
      || LLM_ENHANCEMENT_STATES.includes(value.llm_enhancement as typeof LLM_ENHANCEMENT_STATES[number]))
    && typeof value.job_id === 'string'
    && typeof value.job_title === 'string'
    && isScore(value.total_score)
    && (!('fit_score' in value) || isScore(value.fit_score))
    && (!('hybrid_score' in value) || isScore(value.hybrid_score))
    && (!('hybrid_delta' in value)
      || (Number.isInteger(value.hybrid_delta)
        && Number(value.hybrid_delta) >= -10
        && Number(value.hybrid_delta) <= 10))
    && isOptionalSafeString(value, 'hybrid_summary', 260)
    && (!('potential_level' in value)
      || value.potential_level === 'low'
      || value.potential_level === 'medium'
      || value.potential_level === 'high')
    && isOptionalSafeString(value, 'potential_summary', 240)
    && (!('eligibility' in value) || isEligibilityResult(value.eligibility))
    && (!('scoring_standard' in value) || isScoringStandard(value.scoring_standard))
    && (!('concept_graph' in value)
      || (Array.isArray(value.concept_graph)
        && value.concept_graph.every(isConceptGraphLayer)))
    && (!('semantic_review' in value) || isSemanticReview(value.semantic_review))
    && typeof value.recommendation === 'string'
    && Array.isArray(value.dimensions)
    && value.dimensions.every(isMatchDimension)
    && isStringArray(value.highlights)
    && Array.isArray(value.risk_flags)
    && value.risk_flags.every(isMatchRiskFlag)
    && Array.isArray(value.missing_information)
    && value.missing_information.every(isMatchMissingInformation)
    && isStringArray(value.follow_up_questions)
    && Array.isArray(value.personalized_follow_up_questions)
    && value.personalized_follow_up_questions.length <= 20
    && value.personalized_follow_up_questions.every(isPersonalizedFollowUpQuestion)
    && Array.isArray(value.evidence)
    && value.evidence.every(isMatchEvidence);
}


export function isScoringStandardResponse(value: unknown): value is ScoringStandardResponse {
  return isRecord(value)
    && hasOnlyKeys(value, SCORING_STANDARD_RESPONSE_KEYS)
    && typeof value.request_id === 'string'
    && isSafeString(value.job_id, 80)
    && isSafeString(value.job_title, 160)
    && isScoringStandard(value.standard);
}


export function isKnowledgeJobsResponse(value: unknown): value is KnowledgeJobsResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ['request_id', 'jobs'])
    && typeof value.request_id === 'string'
    && Array.isArray(value.jobs)
    && value.jobs.length <= 200
    && value.jobs.every(isKnowledgeJobOption);
}


export function isAssessmentRecordsResponse(value: unknown): value is AssessmentRecordsResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ['request_id', 'records'])
    && typeof value.request_id === 'string'
    && Array.isArray(value.records)
    && value.records.length <= 100
    && value.records.every(isAssessmentRecordSummary);
}


export function isKnowledgeAliasesResponse(value: unknown): value is KnowledgeAliasesResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ['request_id', 'aliases'])
    && typeof value.request_id === 'string'
    && Array.isArray(value.aliases)
    && value.aliases.length <= 5000
    && value.aliases.every(isKnowledgeAliasItem);
}


export function isAdminDashboardResponse(value: unknown): value is AdminDashboardResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ADMIN_DASHBOARD_KEYS)
    && typeof value.request_id === 'string'
    && isNonNegativeInteger(value.total_jobs)
    && isNonNegativeInteger(value.total_concepts)
    && isNonNegativeInteger(value.quality_warning_count)
    && isNonNegativeInteger(value.total_assessment_records)
    && isNonNegativeInteger(value.unique_candidates)
    && isNonNegativeInteger(value.unique_assessed_jobs)
    && isScore(value.average_score)
    && Array.isArray(value.top_jobs)
    && value.top_jobs.length <= 8
    && value.top_jobs.every(isDashboardTopJob);
}


export function isKnowledgeQualityResponse(value: unknown): value is KnowledgeQualityResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ['request_id', 'report'])
    && typeof value.request_id === 'string'
    && isKnowledgeQualityReport(value.report);
}


export function isKnowledgeJobDetailResponse(value: unknown): value is KnowledgeJobDetailResponse {
  return isRecord(value)
    && hasOnlyKeys(value, KNOWLEDGE_JOB_DETAIL_KEYS)
    && typeof value.request_id === 'string'
    && isSafeString(value.job_id, 80)
    && isNonNegativeInteger(value.source_row)
    && isSafeString(value.title, 160)
    && isOptionalNullableSafeString(value, 'department')
    && isOptionalNullableSafeString(value, 'project')
    && isOptionalNullableInteger(value, 'headcount')
    && isOptionalNullableSafeString(value, 'change_type')
    && isOptionalNullableSafeString(value, 'hiring_type')
    && isOptionalNullableInteger(value, 'salary_min')
    && isOptionalNullableInteger(value, 'salary_max')
    && isOptionalNullableSafeString(value, 'salary_months')
    && isOptionalNullableSafeString(value, 'start_time')
    && isOptionalNullableSafeString(value, 'status')
    && isOptionalNullableSafeString(value, 'platform')
    && isOptionalNullableSafeString(value, 'written_test_required')
    && isBoundedStringArray(value.required_keywords, 200)
    && isOptionalNullableSafeString(value, 'expected_outputs', 5000)
    && isSafeString(value.jd, 50_000)
    && isBoundedStringArray(value.concepts, 400)
    && isKnowledgeJobProfile(value.profile)
    && Array.isArray(value.documents)
    && value.documents.length <= 20
    && value.documents.every(isKnowledgeDocument);
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
const PARSER_VERSIONS = ['boss-dom-v1', 'boss-vue-v1'] as const;
const DOM_WARNING_MAX_ITEMS = 40;
const VUE_WARNING_MAX_ITEMS = 180;


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


export function isCandidateProfile(value: unknown): value is CandidateProfile {
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
  const warningMaxItems = value.parser_version === 'boss-vue-v1'
    ? VUE_WARNING_MAX_ITEMS
    : DOM_WARNING_MAX_ITEMS;

  return value.schema_version === 1
    && PARSER_VERSIONS.includes(value.parser_version as typeof PARSER_VERSIONS[number])
    && PAGE_KINDS.includes(value.page_kind as typeof PAGE_KINDS[number])
    && PARSER_STATUSES.includes(value.status as typeof PARSER_STATUSES[number])
    && typeof value.captured_at === 'string'
    && Number.isFinite(Date.parse(value.captured_at))
    && isOptionalSafeString(value, 'fingerprint')
    && (!('profile' in value) || isCandidateProfile(value.profile))
    && isBoundedStringArray(value.present_fields, 50)
    && isBoundedStringArray(value.missing_fields, 50)
    && isBoundedStringArray(value.warnings, warningMaxItems);
}


export function isResumeReadRequest(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['type'])
    && value.type === 'ARC_RESUME_READ';
}


export function isResumeReadResponse(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }

  if (value.ok) {
    return hasOnlyKeys(value, ['ok', 'snapshot'])
      && isParserSnapshot(value.snapshot)
      && value.snapshot.parser_version === 'boss-vue-v1';
  }

  return hasOnlyKeys(value, ['ok', 'error'])
    && RESUME_READ_ERROR_CODES.includes(
      value.error as typeof RESUME_READ_ERROR_CODES[number],
    );
}
