import type { CoordinatorHandle } from './parser/coordinator';
import { mountCopilot } from './mount';
import { startParserCoordinator } from './parser/coordinator';


export interface ContentBootstrapOptions {
  targetDocument: Document;
  currentUrl: string;
  isTopFrame: boolean;
}


export function bootstrapContentScript(options: ContentBootstrapOptions): CoordinatorHandle {
  if (options.isTopFrame) {
    mountCopilot(options.targetDocument);
  }

  return startParserCoordinator(options);
}


if (
  typeof chrome !== 'undefined'
  && typeof chrome.runtime?.sendMessage === 'function'
) {
  bootstrapContentScript({
    targetDocument: document,
    currentUrl: location.href,
    isTopFrame: window.top === window,
  });
}
