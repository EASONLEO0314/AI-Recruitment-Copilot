import type {
  ApiErrorCode,
  ApiRequestMessage,
  AssessmentResponse,
  HealthResponse,
} from './contracts';
import { isAssessmentResponse, isHealthResponse, isRecord } from './validation';


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
    throw new ApiError('INVALID_RESPONSE', 'Local API response did not match the expected schema');
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
