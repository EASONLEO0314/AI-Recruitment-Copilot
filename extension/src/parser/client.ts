import type {
  ParserRefreshRequest,
  ParserRelayMessage,
} from '../contracts';
import { isParserSnapshot, isRecord } from '../validation';


const REFRESH_REQUEST: ParserRefreshRequest = { type: 'ARC_PARSER_REFRESH' };
const relayWatermarks = new WeakMap<ParserRelayMessage, number>();


function capturedTime(relay: ParserRelayMessage): number {
  return Date.parse(relay.snapshot.captured_at);
}


function watermark(relay: ParserRelayMessage): number {
  return Math.max(capturedTime(relay), relayWatermarks.get(relay) ?? Number.NEGATIVE_INFINITY);
}


function markWatermark(relay: ParserRelayMessage, value: number): void {
  relayWatermarks.set(relay, Math.max(capturedTime(relay), value));
}


function defaultRuntime(): typeof chrome.runtime | undefined {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return undefined;
  }
  return chrome.runtime;
}


async function defaultSendMessage(message: ParserRefreshRequest): Promise<unknown> {
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
