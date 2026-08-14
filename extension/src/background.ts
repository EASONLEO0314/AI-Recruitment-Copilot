import type {
  ApiErrorCode,
  ApiRequestMessage,
  ApiRuntimeResponse,
  ParserSnapshot,
  ResumeReadResponse,
} from './contracts';
import { routeParserMessage, type ParserMessageSender } from './parser/router';
import {
  extractBossVueResumeProfile,
  isVueResumeProfileFrameProbe,
  type VueResumeProfileFrameProbe,
} from './parser/vueResumeMapper';
import { extractBossVisibleSkillTags, isVisibleSkillTagList } from './parser/visibleSkillTags';
import { buildProfileSnapshot } from './parser/snapshot';
import { isCandidateProfile, isRecord, isResumeReadRequest } from './validation';


const API_BASE_URL = 'http://127.0.0.1:8765';
const API_REQUEST_TIMEOUT_MAX_MS = 30_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ResumeScriptResult {
  frameId: number;
  result?: unknown;
}

type ResumeScriptExecutor = (details: {
  target: { tabId: number; allFrames: true };
  world: 'MAIN';
  func: typeof extractBossVueResumeProfile | typeof extractBossVisibleSkillTags;
}) => Promise<ResumeScriptResult[]>;

type ResumeReader = (tabId: number) => Promise<ResumeReadResponse>;
type OcrSkillsReader = (tabId: number) => Promise<string[]>;

interface ActiveTabInfo {
  id: number;
  url: string;
  windowId?: number;
}


function failure(code: ApiErrorCode, message: string): ApiRuntimeResponse<never> {
  return { ok: false, error: { code, message } };
}


function isScoringWeights(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = ['skills', 'experience_years', 'education', 'experience_evidence'];
  return Object.keys(value).length === keys.length
    && keys.every((key) => Number.isInteger(value[key]))
    && keys.reduce((sum, key) => sum + Number(value[key]), 0) === 100
    && keys.every((key) => Number(value[key]) >= 0 && Number(value[key]) <= 100);
}


export function isApiRequestMessage(value: unknown): value is ApiRequestMessage {
  if (!isRecord(value)
    || value.type !== 'ARC_API_REQUEST'
    || typeof value.timeout_ms !== 'number'
    || !Number.isInteger(value.timeout_ms)
    || value.timeout_ms < 100
    || value.timeout_ms > API_REQUEST_TIMEOUT_MAX_MS) {
    return false;
  }

  if (value.operation === 'health') {
    return true;
  }

  if (value.operation === 'demo-assessment') {
    return typeof value.candidate_label === 'string'
      && value.candidate_label.trim().length > 0
      && value.candidate_label.length <= 80;
  }

  if (value.operation === 'match-assessment' || value.operation === 'match-explanation') {
    return typeof value.job_id === 'string'
      && value.job_id.trim().length > 0
      && value.job_id.length <= 80
      && isCandidateProfile(value.candidate_profile)
      && (!('scoring_weights' in value) || isScoringWeights(value.scoring_weights));
  }

  if (value.operation === 'scoring-standard') {
    return typeof value.job_id === 'string'
      && value.job_id.trim().length > 0
      && value.job_id.length <= 80;
  }

  if (value.operation === 'knowledge-jobs' || value.operation === 'admin-assessments') {
    return Number.isInteger(value.limit)
      && Number(value.limit) >= 1
      && Number(value.limit) <= (value.operation === 'knowledge-jobs' ? 200 : 100);
  }

  if (value.operation === 'knowledge-job-detail') {
    return typeof value.job_id === 'string'
      && value.job_id.trim().length > 0
      && value.job_id.length <= 80;
  }

  return value.operation === 'admin-dashboard'
    || value.operation === 'knowledge-aliases'
    || value.operation === 'knowledge-quality';
}


export async function handleApiRequest(
  message: ApiRequestMessage,
  fetcher: Fetcher = fetch,
): Promise<ApiRuntimeResponse<unknown>> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), message.timeout_ms);

  let path = '/healthz';
  let init: RequestInit = { method: 'GET' };

  if (message.operation === 'demo-assessment') {
    path = '/v1/demo/assessment';
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_label: message.candidate_label }),
    };
  } else if (message.operation === 'match-assessment' || message.operation === 'match-explanation') {
    path = message.operation === 'match-explanation'
      ? '/v1/assessment/match/explanation'
      : '/v1/assessment/match';
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: message.job_id,
        candidate_profile: message.candidate_profile,
        ...(message.scoring_weights ? { scoring_weights: message.scoring_weights } : {}),
      }),
    };
  } else if (message.operation === 'scoring-standard') {
    path = '/v1/assessment/scoring-standard';
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: message.job_id }),
    };
  } else if (message.operation === 'knowledge-jobs') {
    path = `/v1/knowledge/jobs?limit=${encodeURIComponent(String(message.limit))}`;
  } else if (message.operation === 'admin-dashboard') {
    path = '/v1/admin/dashboard';
  } else if (message.operation === 'admin-assessments') {
    path = `/v1/admin/assessments?limit=${encodeURIComponent(String(message.limit))}`;
  } else if (message.operation === 'knowledge-aliases') {
    path = '/v1/admin/aliases';
  } else if (message.operation === 'knowledge-quality') {
    path = '/v1/knowledge/quality';
  } else if (message.operation === 'knowledge-job-detail') {
    path = `/v1/knowledge/jobs/${encodeURIComponent(message.job_id)}`;
  }

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
  chrome.scripting.executeScript(
    details as Parameters<typeof chrome.scripting.executeScript>[0],
  ) as Promise<ResumeScriptResult[]>
);


function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}


async function setPanelHidden(tabId: number, hidden: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ARC_PANEL_VISIBILITY', hidden });
  } catch {
    // The screenshot fallback should continue even if the panel message is unavailable.
  }
}


function isBossPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.zhipin.com';
  } catch {
    return false;
  }
}


async function activeTabInfo(): Promise<ActiveTabInfo | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return null;
  }
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (chrome.runtime.lastError
          || !tab
          || !Number.isInteger(tab.id)
          || typeof tab.url !== 'string') {
          resolve(null);
          return;
        }
        resolve({
          id: Number(tab.id),
          url: tab.url,
          windowId: Number.isInteger(tab.windowId) ? tab.windowId : undefined,
        });
      });
    } catch {
      resolve(null);
    }
  });
}


async function activeBossTab(tabId: number): Promise<ActiveTabInfo | null> {
  const active = await activeTabInfo();
  if (!active || active.id !== tabId || !isBossPageUrl(active.url)) {
    return null;
  }
  return active;
}


async function captureVisiblePng(windowId?: number): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const callback = (dataUrl?: string) => {
        resolve(chrome.runtime.lastError ? null : dataUrl ?? null);
      };
      if (typeof windowId === 'number' && Number.isInteger(windowId)) {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, callback);
      } else {
        chrome.tabs.captureVisibleTab({ format: 'png' }, callback);
      }
    } catch {
      resolve(null);
    }
  });
}


async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.addEventListener('load', () => {
      resolve(String(reader.result));
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}


async function cropVisibleTop(dataUrl: string): Promise<string | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const height = Math.max(1, Math.floor(bitmap.height * 0.45));
    const canvas = new OffscreenCanvas(bitmap.width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0, bitmap.width, height, 0, 0, bitmap.width, height);
    return await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  } catch {
    return null;
  }
}


async function fetchOcrSkills(
  imageDataUrl: string,
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  try {
    const response = await fetcher(`${API_BASE_URL}/v1/ocr/skills`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_data_url: imageDataUrl }),
    });
    if (!response.ok) {
      return [];
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload)
      || payload.available !== true
      || !Array.isArray(payload.skills)) {
      return [];
    }
    return payload.skills
      .filter((skill): skill is string => typeof skill === 'string' && skill.length <= 80)
      .slice(0, 20);
  } catch {
    return [];
  }
}


export async function readVisibleTopOcrSkills(tabId: number): Promise<string[]> {
  const initialActive = await activeBossTab(tabId);
  if (!initialActive) {
    return [];
  }
  await setPanelHidden(tabId, true);
  try {
    await delay(120);
    const activeBeforeCapture = await activeBossTab(tabId);
    if (!activeBeforeCapture) {
      return [];
    }
    const screenshot = await captureVisiblePng(activeBeforeCapture.windowId);
    if (!screenshot) {
      return [];
    }
    if (!await activeBossTab(tabId)) {
      return [];
    }
    const cropped = await cropVisibleTop(screenshot);
    if (!cropped) {
      return [];
    }
    if (!await activeBossTab(tabId)) {
      return [];
    }
    return await fetchOcrSkills(cropped);
  } finally {
    await setPanelHidden(tabId, false);
  }
}


function withOcrSkills(snapshot: ParserSnapshot, skills: string[]): ParserSnapshot {
  if (!snapshot.profile || snapshot.profile.skills.length > 0 || skills.length === 0) {
    return snapshot;
  }
  const merged = buildProfileSnapshot(
    snapshot.page_kind,
    { ...snapshot.profile, skills },
    new Date(snapshot.captured_at),
  );
  return {
    ...merged,
    parser_version: snapshot.parser_version,
    warnings: [...snapshot.warnings, 'ocr-skills:visible-top'].slice(0, 180),
  };
}


async function readMainWorldDomSkills(
  tabId: number,
  executor: ResumeScriptExecutor,
  selectedFrameId: number,
): Promise<string[]> {
  try {
    const results = await executor({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: extractBossVisibleSkillTags,
    });
    const collectSkills = (frameIdFilter?: number): string[] => {
      const values = new Set<string>();
      for (const { frameId, result } of results) {
        if (frameIdFilter !== undefined && frameId !== frameIdFilter) {
          continue;
        }
        if (!isVisibleSkillTagList(result)) {
          continue;
        }
        for (const skill of result) {
          values.add(skill);
        }
        if (values.size >= 20) {
          break;
        }
      }
      return Array.from(values).slice(0, 20);
    };

    const selectedFrameSkills = collectSkills(selectedFrameId);
    if (selectedFrameSkills.length > 0) {
      return selectedFrameSkills;
    }

    return collectSkills();
  } catch {
    return [];
  }
}


function withDomSkills(snapshot: ParserSnapshot, skills: string[]): ParserSnapshot {
  if (!snapshot.profile || snapshot.profile.skills.length > 0 || skills.length === 0) {
    return snapshot;
  }
  const merged = buildProfileSnapshot(
    snapshot.page_kind,
    { ...snapshot.profile, skills },
    new Date(snapshot.captured_at),
  );
  return {
    ...merged,
    parser_version: snapshot.parser_version,
    warnings: [...snapshot.warnings, 'dom-skills:visible-tags'].slice(0, 180),
  };
}


function profileScore(
  probe: Extract<VueResumeProfileFrameProbe, { status: 'ready' }>,
): number {
  const profile = probe.profile;
  const scalarCount = [
    profile.display_name,
    profile.current_title,
    profile.location,
    profile.expected_position,
    profile.expected_city,
    profile.summary,
    profile.experience_years,
  ].filter((value) => value !== undefined).length;
  return scalarCount
    + (profile.work_experiences.length * 100)
    + (profile.education.length * 100)
    + (profile.project_experiences.length * 100)
    + (profile.skills.length * 10);
}


function capabilitySnapshot(
  probe: Extract<VueResumeProfileFrameProbe, { status: 'ready' }>,
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
    ...probe.schema.map(({ key, type, array_length: arrayLength }) => (
      type === 'array'
        ? `vue-schema:key=${key}:${type}:${arrayLength}`
        : `vue-schema:key=${key}:${type}`
    )),
    ...probe.nested_schema.map(({ container, key, type, array_length: arrayLength }) => (
      type === 'array'
        ? `vue-nested-schema:container=${container}:key=${key}:${type}:${arrayLength}`
        : `vue-nested-schema:container=${container}:key=${key}:${type}`
    )),
  ];

  const snapshot = buildProfileSnapshot(
    capability.root === 'lib-resume-recommend' ? 'recommend_frame' : 'resume_frame',
    probe.profile,
    new Date(capturedAt),
  );
  return {
    ...snapshot,
    parser_version: 'boss-vue-v1',
    warnings,
  };
}


export async function handleResumeRead(
  tabId: number,
  executor: ResumeScriptExecutor = executeResumeScript,
  now: () => Date = () => new Date(),
  ocrReader: OcrSkillsReader = readVisibleTopOcrSkills,
): Promise<ResumeReadResponse> {
  try {
    const results = await executor({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: extractBossVueResumeProfile,
    });
    const probes = results
      .map(({ result }) => result)
      .filter(isVueResumeProfileFrameProbe);

    if (probes.length === 0) {
      return { ok: false, error: 'vue-result-invalid' };
    }

    const ready = results
      .flatMap(({ frameId, result }) => (
        isVueResumeProfileFrameProbe(result) && result.status === 'ready'
          ? [{ frameId, probe: result }]
          : []
      ))
      .sort((left, right) => profileScore(right.probe) - profileScore(left.probe));

    if (ready.length > 0) {
      const selected = ready[0];
      if (selected.probe.capability.allowed_keys.length === 0) {
        return { ok: false, error: 'vue-schema-unsupported' };
      }
      let snapshot = capabilitySnapshot(selected.probe, now().toISOString());
      snapshot = withDomSkills(
        snapshot,
        await readMainWorldDomSkills(tabId, executor, selected.frameId),
      );
      if (!snapshot.profile || snapshot.profile.skills.length === 0) {
        snapshot = withOcrSkills(snapshot, await ocrReader(tabId));
      }
      return {
        ok: true,
        snapshot,
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
      if (messageType === 'ARC_API_REQUEST') {
        sendResponse(failure('REQUEST_FAILED', '评分请求格式异常，请重新读取简历后再试。'));
        return true;
      }
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
