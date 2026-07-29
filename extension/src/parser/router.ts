import type { ParserRefreshCommand, ParserRelayMessage } from '../contracts';
import { isParserSnapshot } from '../validation';


type SendToTab = (
  tabId: number,
  message: ParserRelayMessage | ParserRefreshCommand,
  options?: { frameId: number },
) => Promise<unknown>;

export interface ParserMessageSender {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}


export async function routeParserMessage(
  message: unknown,
  sender: ParserMessageSender,
  sendToTab: SendToTab = (tabId, payload, options) =>
    chrome.tabs.sendMessage(tabId, payload, options),
): Promise<boolean> {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    return false;
  }

  const messageType = (message as { type?: unknown }).type;

  if (messageType === 'ARC_PARSER_SNAPSHOT') {
    const frameId = sender.frameId ?? 0;
    if (!Number.isInteger(frameId)
      || (sender.documentId !== undefined && typeof sender.documentId !== 'string')
      || !isParserSnapshot((message as { snapshot?: unknown }).snapshot)) {
      return false;
    }

    const relay: ParserRelayMessage = {
      type: 'ARC_PARSER_RELAY',
      snapshot: (message as { snapshot: ParserRelayMessage['snapshot'] }).snapshot,
      source: {
        frame_id: frameId,
        document_id: sender.documentId ?? 'unknown',
      },
    };

    try {
      await sendToTab(tabId as number, relay, { frameId: 0 });
      return true;
    } catch {
      return false;
    }
  }

  if (messageType === 'ARC_PARSER_REFRESH' && sender.frameId === 0) {
    try {
      await sendToTab(tabId as number, { type: 'ARC_PARSER_REFRESH_COMMAND' });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
