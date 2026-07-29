import type {
  ParserRefreshRequest,
  ParserRelayMessage,
} from '../contracts';
import { isParserSnapshot, isRecord } from '../validation';


const REFRESH_REQUEST: ParserRefreshRequest = { type: 'ARC_PARSER_REFRESH' };


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
  if (!current || incoming.snapshot.page_kind === 'logged_out') {
    return incoming;
  }

  if (Date.parse(incoming.snapshot.captured_at) < Date.parse(current.snapshot.captured_at)) {
    return current;
  }

  const currentIsCandidate = current.snapshot.page_kind === 'recommend_frame'
    || current.snapshot.page_kind === 'resume_frame';
  const incomingIsShell = incoming.snapshot.page_kind === 'non_candidate'
    || incoming.snapshot.page_kind === 'unsupported';

  return currentIsCandidate && incomingIsShell ? current : incoming;
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
