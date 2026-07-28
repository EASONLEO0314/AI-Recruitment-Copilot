import type {
  ApiErrorCode,
  ApiRequestMessage,
  ApiRuntimeResponse,
} from './contracts';
import { isRecord } from './validation';


const API_BASE_URL = 'http://127.0.0.1:8765';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;


function failure(code: ApiErrorCode, message: string): ApiRuntimeResponse<never> {
  return { ok: false, error: { code, message } };
}


export function isApiRequestMessage(value: unknown): value is ApiRequestMessage {
  if (!isRecord(value)
    || value.type !== 'ARC_API_REQUEST'
    || typeof value.timeout_ms !== 'number'
    || !Number.isInteger(value.timeout_ms)
    || value.timeout_ms < 100
    || value.timeout_ms > 10_000) {
    return false;
  }

  if (value.operation === 'health') {
    return true;
  }

  return value.operation === 'demo-assessment'
    && typeof value.candidate_label === 'string'
    && value.candidate_label.trim().length > 0
    && value.candidate_label.length <= 80;
}


export async function handleApiRequest(
  message: ApiRequestMessage,
  fetcher: Fetcher = fetch,
): Promise<ApiRuntimeResponse<unknown>> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), message.timeout_ms);

  const path = message.operation === 'health'
    ? '/healthz'
    : '/v1/demo/assessment';
  const init: RequestInit = message.operation === 'health'
    ? { method: 'GET' }
    : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_label: message.candidate_label }),
      };

  try {
    const response = await fetcher(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      return failure('REQUEST_FAILED', `Local API returned HTTP ${response.status}`);
    }
    try {
      return { ok: true, data: await response.json() };
    } catch {
      return failure('INVALID_RESPONSE', 'Local API returned invalid JSON');
    }
  } catch {
    return failure('BACKEND_UNAVAILABLE', 'Local API is unavailable');
  } finally {
    globalThis.clearTimeout(timeout);
  }
}


if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isApiRequestMessage(message)) {
      return false;
    }
    void handleApiRequest(message).then(sendResponse);
    return true;
  });
}
