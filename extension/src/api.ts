import type { AssessmentResponse, HealthResponse } from './contracts';


const API_BASE_URL = 'http://127.0.0.1:8765';

export type ApiErrorCode =
  | 'BACKEND_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED';

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError('REQUEST_FAILED', `Local API returned HTTP ${response.status}`);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError('INVALID_RESPONSE', 'Local API returned invalid JSON');
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('BACKEND_UNAVAILABLE', 'Local API is unavailable');
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function getHealth(timeoutMs = 1500): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/healthz', { method: 'GET' }, timeoutMs);
}

export function getDemoAssessment(
  candidateLabel: string,
  timeoutMs = 5000,
): Promise<AssessmentResponse> {
  return requestJson<AssessmentResponse>(
    '/v1/demo/assessment',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_label: candidateLabel }),
    },
    timeoutMs,
  );
}
