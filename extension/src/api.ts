import type {
  AdminDashboardResponse,
  ApiErrorCode,
  ApiRequestMessage,
  AssessmentResponse,
  AssessmentRecordsResponse,
  CandidateProfile,
  HealthResponse,
  KnowledgeAliasesResponse,
  KnowledgeJobDetailResponse,
  KnowledgeJobsResponse,
  KnowledgeQualityResponse,
  MatchAssessmentResponse,
  ScoringStandardResponse,
} from './contracts';
import {
  isAdminDashboardResponse,
  isAssessmentResponse,
  isAssessmentRecordsResponse,
  isHealthResponse,
  isKnowledgeAliasesResponse,
  isKnowledgeJobDetailResponse,
  isKnowledgeJobsResponse,
  isKnowledgeQualityResponse,
  isMatchAssessmentResponse,
  isRecord,
  isScoringStandardResponse,
} from './validation';


export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}


function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return value === 'BACKEND_UNAVAILABLE'
    || value === 'INVALID_RESPONSE'
    || value === 'REQUEST_FAILED';
}


async function sendApiRequest<T>(
  message: ApiRequestMessage,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch {
    throw new ApiError('BACKEND_UNAVAILABLE', 'Extension service worker is unavailable');
  }

  if (!isRecord(response) || typeof response.ok !== 'boolean') {
    throw new ApiError('INVALID_RESPONSE', 'Extension service worker returned an invalid response');
  }

  if (!response.ok) {
    const error = response.error;
    if (!isRecord(error) || !isApiErrorCode(error.code) || typeof error.message !== 'string') {
      throw new ApiError('INVALID_RESPONSE', 'Extension service worker returned an invalid error');
    }
    throw new ApiError(error.code, error.message);
  }

  if (!validate(response.data)) {
    throw new ApiError('INVALID_RESPONSE', '评分服务响应格式与预期不一致');
  }

  return response.data;
}


export function getHealth(timeoutMs = 1500): Promise<HealthResponse> {
  return sendApiRequest(
    { type: 'ARC_API_REQUEST', operation: 'health', timeout_ms: timeoutMs },
    isHealthResponse,
  );
}


export function getDemoAssessment(
  candidateLabel: string,
  timeoutMs = 5000,
): Promise<AssessmentResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'demo-assessment',
      candidate_label: candidateLabel,
      timeout_ms: timeoutMs,
    },
    isAssessmentResponse,
  );
}


export function getKnowledgeJobs(timeoutMs = 5000): Promise<KnowledgeJobsResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-jobs',
      limit: 80,
      timeout_ms: timeoutMs,
    },
    isKnowledgeJobsResponse,
  );
}


export function getAdminDashboard(timeoutMs = 5000): Promise<AdminDashboardResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'admin-dashboard',
      timeout_ms: timeoutMs,
    },
    isAdminDashboardResponse,
  );
}


export function getAssessmentRecords(
  limit = 20,
  timeoutMs = 5000,
): Promise<AssessmentRecordsResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'admin-assessments',
      limit,
      timeout_ms: timeoutMs,
    },
    isAssessmentRecordsResponse,
  );
}


export function getKnowledgeAliases(timeoutMs = 5000): Promise<KnowledgeAliasesResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-aliases',
      timeout_ms: timeoutMs,
    },
    isKnowledgeAliasesResponse,
  );
}


export function getKnowledgeQuality(timeoutMs = 5000): Promise<KnowledgeQualityResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-quality',
      timeout_ms: timeoutMs,
    },
    isKnowledgeQualityResponse,
  );
}


export function getKnowledgeJobDetail(
  jobId: string,
  timeoutMs = 5000,
): Promise<KnowledgeJobDetailResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'knowledge-job-detail',
      job_id: jobId,
      timeout_ms: timeoutMs,
    },
    isKnowledgeJobDetailResponse,
  );
}


export function getMatchAssessment(
  jobId: string,
  candidateProfile: CandidateProfile,
  scoringWeights?: Record<string, number>,
  timeoutMs = 15000,
): Promise<MatchAssessmentResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'match-assessment',
      job_id: jobId,
      candidate_profile: candidateProfile,
      ...(scoringWeights ? { scoring_weights: scoringWeights } : {}),
      timeout_ms: timeoutMs,
    },
    isMatchAssessmentResponse,
  );
}


export function getMatchExplanation(
  jobId: string,
  candidateProfile: CandidateProfile,
  scoringWeights?: Record<string, number>,
  timeoutMs = 12000,
): Promise<MatchAssessmentResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'match-explanation',
      job_id: jobId,
      candidate_profile: candidateProfile,
      ...(scoringWeights ? { scoring_weights: scoringWeights } : {}),
      timeout_ms: timeoutMs,
    },
    isMatchAssessmentResponse,
  );
}


export function getScoringStandard(
  jobId: string,
  timeoutMs = 30000,
): Promise<ScoringStandardResponse> {
  return sendApiRequest(
    {
      type: 'ARC_API_REQUEST',
      operation: 'scoring-standard',
      job_id: jobId,
      timeout_ms: timeoutMs,
    },
    isScoringStandardResponse,
  );
}
