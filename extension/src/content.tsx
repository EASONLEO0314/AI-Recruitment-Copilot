import type { CoordinatorHandle } from './parser/coordinator';
import { mountCopilot } from './mount';
import { startParserCoordinator } from './parser/coordinator';


export interface ContentBootstrapOptions {
  targetDocument: Document;
  currentUrl: string | (() => string);
  isTopFrame: boolean;
}


export function bootstrapContentScript(options: ContentBootstrapOptions): CoordinatorHandle {
  let host: HTMLElement | undefined;
  if (options.isTopFrame) {
    host = mountCopilot(options.targetDocument);
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (typeof message === 'object'
          && message !== null
          && (message as { type?: unknown }).type === 'ARC_PANEL_VISIBILITY') {
          host?.style.setProperty(
            'display',
            (message as { hidden?: unknown }).hidden === true ? 'none' : '',
          );
          sendResponse({ ok: true });
        }
        return false;
      });
    }
  }

  return startParserCoordinator(options);
}


if (
  typeof chrome !== 'undefined'
  && typeof chrome.runtime?.sendMessage === 'function'
) {
  bootstrapContentScript({
    targetDocument: document,
    currentUrl: () => location.href,
    isTopFrame: window.top === window,
  });
}
