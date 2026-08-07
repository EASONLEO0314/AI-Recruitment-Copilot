import type {
  ApiErrorCode,
  ApiRequestMessage,
  ApiRuntimeResponse,
  ParserSnapshot,
  ResumeReadResponse,
} from './contracts';
import { routeParserMessage, type ParserMessageSender } from './parser/router';
import {
  extractBossVueResumeCapability,
  isVueResumeFrameProbe,
  type VueResumeFrameProbe,
} from './parser/vueResumeProbe';
import { isRecord, isResumeReadRequest } from './validation';


const API_BASE_URL = 'http://127.0.0.1:8765';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ResumeScriptResult {
  frameId: number;
  result?: unknown;
}

type ResumeScriptExecutor = (details: {
  target: { tabId: number; allFrames: true };
  world: 'MAIN';
  func: typeof extractBossVueResumeCapability;
}) => Promise<ResumeScriptResult[]>;

type ResumeReader = (tabId: number) => Promise<ResumeReadResponse>;


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


const executeResumeScript: ResumeScriptExecutor = async (details) => (
  chrome.scripting.executeScript(details) as Promise<ResumeScriptResult[]>
);


function capabilityScore(probe: Extract<VueResumeFrameProbe, { status: 'ready' }>): number {
  return probe.capability.allowed_keys.length * 100
    + Object.values(probe.capability.array_lengths).reduce((total, count) => total + count, 0);
}


function capabilitySnapshot(
  probe: Extract<VueResumeFrameProbe, { status: 'ready' }>,
  capturedAt: string,
): ParserSnapshot {
  const { capability } = probe;
  const warnings = [
    `vue-capability:root=${capability.root}`,
    `vue-capability:generation=${capability.vue_generation}`,
    `vue-capability:resume-object=${capability.resume_object}`,
    ...capability.allowed_keys.map((key) => `vue-capability:key=${key}`),
    ...Object.entries(capability.array_lengths)
      .map(([key, length]) => `vue-capability:array=${key}:${length}`),
  ];

  return {
    schema_version: 1,
    parser_version: 'boss-vue-v1',
    page_kind: capability.root === 'lib-resume-recommend' ? 'recommend_frame' : 'resume_frame',
    status: 'partial',
    captured_at: capturedAt,
    present_fields: [],
    missing_fields: [],
    warnings,
  };
}


export async function handleResumeRead(
  tabId: number,
  executor: ResumeScriptExecutor = executeResumeScript,
  now: () => Date = () => new Date(),
): Promise<ResumeReadResponse> {
  try {
    const results = await executor({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: extractBossVueResumeCapability,
    });
    const probes = results
      .map(({ result }) => result)
      .filter(isVueResumeFrameProbe);

    if (probes.length === 0) {
      return { ok: false, error: 'vue-result-invalid' };
    }

    const ready = probes
      .filter((probe): probe is Extract<VueResumeFrameProbe, { status: 'ready' }> => (
        probe.status === 'ready'
      ))
      .sort((left, right) => capabilityScore(right) - capabilityScore(left));

    if (ready.length > 0) {
      if (ready[0].capability.allowed_keys.length === 0) {
        return { ok: false, error: 'vue-schema-unsupported' };
      }
      return {
        ok: true,
        snapshot: capabilitySnapshot(ready[0], now().toISOString()),
      };
    }

    if (probes.some((probe) => probe.status === 'vue-resume-data-unavailable')) {
      return { ok: false, error: 'vue-resume-data-unavailable' };
    }
    if (probes.some((probe) => probe.status === 'vue-instance-not-found')) {
      return { ok: false, error: 'vue-instance-not-found' };
    }
    return { ok: false, error: 'vue-root-not-found' };
  } catch {
    return { ok: false, error: 'vue-read-failed' };
  }
}


export function createRuntimeMessageListener(
  fetcher: Fetcher = fetch,
  parserRouter: typeof routeParserMessage = routeParserMessage,
  resumeReader: ResumeReader = handleResumeRead,
) {
  return (
    message: unknown,
    sender: ParserMessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (isResumeReadRequest(message)) {
      const tabId = sender.tab?.id;
      if (sender.frameId !== 0 || !Number.isInteger(tabId)) {
        return false;
      }
      void resumeReader(Number(tabId)).then(
        sendResponse,
        () => sendResponse({ ok: false, error: 'vue-read-failed' }),
      );
      return true;
    }

    if (isApiRequestMessage(message)) {
      void handleApiRequest(message, fetcher).then(sendResponse);
      return true;
    }

    if (typeof message === 'object' && message !== null) {
      const messageType = (message as { type?: unknown }).type;
      if (messageType === 'ARC_PARSER_SNAPSHOT' || messageType === 'ARC_PARSER_REFRESH') {
        void parserRouter(message, sender).then(
          (ok) => sendResponse({ ok }),
          () => sendResponse({ ok: false }),
        );
        return true;
      }
    }

    return false;
  };
}


if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(createRuntimeMessageListener());
}
