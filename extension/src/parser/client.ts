import type {
  ParserRefreshRequest,
  ParserRelayMessage,
  ResumeReadRequest,
  ResumeReadResponse,
} from '../contracts';
import { isParserSnapshot, isRecord, isResumeReadResponse } from '../validation';


const REFRESH_REQUEST: ParserRefreshRequest = { type: 'ARC_PARSER_REFRESH' };
const RESUME_READ_REQUEST: ResumeReadRequest = { type: 'ARC_RESUME_READ' };
const relayWatermarks = new WeakMap<ParserRelayMessage, number>();
const MAX_TRACKED_FRAMES = 32;

export type ParserSelectionReason =
  | 'logged_out'
  | 'profile_evidence'
  | 'semantic_headings'
  | 'candidate_structure'
  | 'page_state';

export interface ParserRelaySelection {
  relay: ParserRelayMessage;
  reason: ParserSelectionReason;
}


function capturedTime(relay: ParserRelayMessage): number {
  return Date.parse(relay.snapshot.captured_at);
}


function watermark(relay: ParserRelayMessage): number {
  return Math.max(capturedTime(relay), relayWatermarks.get(relay) ?? Number.NEGATIVE_INFINITY);
}


function markWatermark(relay: ParserRelayMessage, value: number): void {
  relayWatermarks.set(relay, Math.max(capturedTime(relay), value));
}


function isCandidateRelay(relay: ParserRelayMessage): boolean {
  return relay.snapshot.page_kind === 'recommend_frame'
    || relay.snapshot.page_kind === 'resume_frame';
}


function warningNumber(relay: ParserRelayMessage, prefix: string, maximum: number): number {
  const warning = relay.snapshot.warnings.find((value) => value.startsWith(prefix));
  if (!warning) {
    return 0;
  }
  const value = Number(warning.slice(prefix.length));
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value : 0;
}


function semanticHeadingCount(relay: ParserRelayMessage): number {
  return relay.snapshot.warnings.reduce((total, warning) => {
    const match = warning.match(/^probe:heading=(?:work|education|project):([1-9][0-9]?)$/);
    return total + (match ? Number(match[1]) : 0);
  }, 0);
}


function experienceItemCount(relay: ParserRelayMessage): number {
  const profile = relay.snapshot.profile;
  if (!profile) {
    return 0;
  }
  return profile.work_experiences.length
    + profile.education.length
    + profile.project_experiences.length;
}


function relayQuality(relay: ParserRelayMessage): readonly number[] {
  if (relay.snapshot.page_kind === 'logged_out') {
    return [6, 0, 0, 0];
  }
  if (!isCandidateRelay(relay)) {
    return relay.snapshot.page_kind === 'non_candidate'
      ? [1, 0, 0, 0]
      : [0, 0, 0, 0];
  }

  const presentFieldCount = relay.snapshot.present_fields.length;
  const itemCount = experienceItemCount(relay);
  if (relay.snapshot.profile && itemCount > 0) {
    return [5, itemCount, presentFieldCount, 0];
  }

  const headingCount = semanticHeadingCount(relay);
  const visibleElementCount = warningNumber(relay, 'probe:visible-elements=', 999);
  if (headingCount > 0) {
    return [4, headingCount, visibleElementCount, 0];
  }

  if (relay.snapshot.profile && presentFieldCount > 0) {
    return [3, presentFieldCount, relay.snapshot.profile.skills.length, 0];
  }

  const structureElementCount = Math.max(
    visibleElementCount,
    warningNumber(relay, 'structure:element-count=', 999),
  );
  return [2, structureElementCount, relay.snapshot.status === 'error' ? 0 : 1, 0];
}


function compareQuality(left: ParserRelayMessage, right: ParserRelayMessage): number {
  const leftQuality = relayQuality(left);
  const rightQuality = relayQuality(right);
  for (let index = 0; index < leftQuality.length; index += 1) {
    const difference = leftQuality[index] - rightQuality[index];
    if (difference !== 0) {
      return difference;
    }
  }

  const timeDifference = capturedTime(left) - capturedTime(right);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return right.source.frame_id - left.source.frame_id;
}


function selectionReason(relay: ParserRelayMessage): ParserSelectionReason {
  if (relay.snapshot.page_kind === 'logged_out') {
    return 'logged_out';
  }
  if (relay.snapshot.profile && experienceItemCount(relay) > 0) {
    return 'profile_evidence';
  }
  if (semanticHeadingCount(relay) > 0) {
    return 'semantic_headings';
  }
  if (relay.snapshot.profile && relay.snapshot.present_fields.length > 0) {
    return 'profile_evidence';
  }
  return isCandidateRelay(relay) ? 'candidate_structure' : 'page_state';
}


export function upsertParserRelay(
  current: readonly ParserRelayMessage[],
  incoming: ParserRelayMessage,
): ParserRelayMessage[] {
  const currentTop = current.find((relay) => relay.source.frame_id === 0);
  const base = incoming.source.frame_id === 0
    && currentTop
    && currentTop.source.document_id !== incoming.source.document_id
    ? []
    : current;
  const existing = base.find((relay) =>
    relay.source.frame_id === incoming.source.frame_id);
  if (existing && capturedTime(incoming) < capturedTime(existing)) {
    return [...base];
  }

  const next = base
    .filter((relay) => relay.source.frame_id !== incoming.source.frame_id)
    .concat(incoming);
  const bounded = next.length <= MAX_TRACKED_FRAMES
    ? next
    : [...next]
      .sort((left, right) => capturedTime(right) - capturedTime(left))
      .slice(0, MAX_TRACKED_FRAMES);
  return bounded.sort((left, right) => left.source.frame_id - right.source.frame_id);
}


export function selectBestParserRelay(
  relays: readonly ParserRelayMessage[],
): ParserRelaySelection | null {
  const relay = relays.reduce<ParserRelayMessage | null>((best, candidate) =>
    !best || compareQuality(candidate, best) > 0 ? candidate : best, null);
  return relay ? { relay, reason: selectionReason(relay) } : null;
}


function defaultRuntime(): typeof chrome.runtime | undefined {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return undefined;
  }
  return chrome.runtime;
}


async function defaultSendMessage(
  message: ParserRefreshRequest | ResumeReadRequest,
): Promise<unknown> {
  const runtime = defaultRuntime();
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    throw new Error('Parser runtime is unavailable');
  }
  return runtime.sendMessage(message);
}


export function isParserRelayMessage(value: unknown): value is ParserRelayMessage {
  if (!isRecord(value)
    || value.type !== 'ARC_PARSER_RELAY'
    || !isParserSnapshot(value.snapshot)
    || !isRecord(value.source)) {
    return false;
  }

  return Number.isInteger(value.source.frame_id)
    && Number(value.source.frame_id) >= 0
    && typeof value.source.document_id === 'string';
}


export function acceptParserRelay(
  current: ParserRelayMessage | null,
  incoming: ParserRelayMessage,
): ParserRelayMessage {
  const incomingTime = capturedTime(incoming);
  if (!current) {
    markWatermark(incoming, incomingTime);
    return incoming;
  }

  const currentWatermark = watermark(current);
  if (incoming.snapshot.page_kind === 'logged_out') {
    markWatermark(incoming, Math.max(currentWatermark, incomingTime));
    return incoming;
  }

  if (incomingTime < currentWatermark
    || (current.snapshot.page_kind === 'logged_out' && incomingTime <= currentWatermark)) {
    return current;
  }

  const currentIsCandidate = current.snapshot.page_kind === 'recommend_frame'
    || current.snapshot.page_kind === 'resume_frame';
  const incomingIsShell = incoming.snapshot.page_kind === 'non_candidate'
    || incoming.snapshot.page_kind === 'unsupported';

  if (currentIsCandidate && incomingIsShell) {
    markWatermark(current, Math.max(currentWatermark, incomingTime));
    return current;
  }

  markWatermark(incoming, Math.max(currentWatermark, incomingTime));
  return incoming;
}


export function subscribeToParserRelays(
  listener: (message: ParserRelayMessage) => void,
  runtime: typeof chrome.runtime | undefined = defaultRuntime(),
): () => void {
  if (!runtime?.onMessage
    || typeof runtime.onMessage.addListener !== 'function'
    || typeof runtime.onMessage.removeListener !== 'function') {
    return () => undefined;
  }

  const relayListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
    if (isParserRelayMessage(message)) {
      listener(message);
    }
  };

  runtime.onMessage.addListener(relayListener);
  return () => runtime.onMessage.removeListener(relayListener);
}


export async function requestParserRefresh(
  sendMessage?: typeof chrome.runtime.sendMessage,
): Promise<void> {
  const acknowledgement = sendMessage
    ? await sendMessage(REFRESH_REQUEST)
    : await defaultSendMessage(REFRESH_REQUEST);

  if (!isRecord(acknowledgement)
    || acknowledgement.ok !== true
    || Object.keys(acknowledgement).length !== 1) {
    throw new Error('Parser refresh was not acknowledged');
  }
}


export async function requestResumeRead(
  sendMessage?: typeof chrome.runtime.sendMessage,
): Promise<ResumeReadResponse> {
  const response = sendMessage
    ? await sendMessage(RESUME_READ_REQUEST)
    : await defaultSendMessage(RESUME_READ_REQUEST);

  if (!isResumeReadResponse(response)) {
    throw new Error('Resume read returned an invalid response');
  }
  return response;
}
