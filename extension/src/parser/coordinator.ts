import type {
  PageKind,
  ParserSnapshot,
  ParserSnapshotMessage,
} from '../contracts';
import { isHidden } from './dom';
import { findRecommendObservationRoot, parseRecommendFrame } from './adapters/recommend';
import { parseResumeFrame } from './adapters/resume';
import { classifyPage } from './pageClassifier';
import { buildStatusSnapshot } from './snapshot';


const MUTATION_DEBOUNCE_MS = 400;
const RESUME_ROOT_SELECTORS = ['.resume-content', '.resume-box', '.geek-resume', 'main'];


export interface CoordinatorHandle {
  stop(): void;
}


export interface CoordinatorOptions {
  targetDocument: Document;
  currentUrl: string;
  isTopFrame: boolean;
  sendMessage?: (message: ParserSnapshotMessage) => Promise<unknown>;
  runtimeOnMessage?: typeof chrome.runtime.onMessage;
  Observer?: typeof MutationObserver;
  now?: () => Date;
}


function defaultSendMessage(message: ParserSnapshotMessage): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return Promise.resolve(undefined);
  }

  return chrome.runtime.sendMessage(message);
}


function defaultRuntimeOnMessage(): typeof chrome.runtime.onMessage | undefined {
  if (typeof chrome === 'undefined') {
    return undefined;
  }

  return chrome.runtime?.onMessage;
}


function defaultObserver(): typeof MutationObserver | undefined {
  return typeof MutationObserver === 'undefined' ? undefined : MutationObserver;
}


function buildSnapshot(
  pageKind: PageKind,
  targetDocument: Document,
  now: Date,
): ParserSnapshot {
  switch (pageKind) {
    case 'logged_out':
    case 'non_candidate':
      return buildStatusSnapshot(pageKind, 'ready', undefined, now);
    case 'unsupported':
      return buildStatusSnapshot(pageKind, 'unsupported', undefined, now);
    case 'recommend_frame':
      return parseRecommendFrame(targetDocument, now);
    case 'resume_frame':
      return parseResumeFrame(targetDocument, now);
  }
}


function dedupeKey(snapshot: ParserSnapshot): string {
  return JSON.stringify({
    page_kind: snapshot.page_kind,
    status: snapshot.status,
    profile: snapshot.profile,
    present_fields: snapshot.present_fields,
    missing_fields: snapshot.missing_fields,
    warnings: snapshot.warnings,
  });
}


function findResumeObservationRoot(targetDocument: Document): Element | null {
  for (const selector of RESUME_ROOT_SELECTORS) {
    const root = Array.from(targetDocument.querySelectorAll(selector))
      .find((element) => !isHidden(element));
    if (root) {
      return root;
    }
  }

  return null;
}


function findObservationRoot(pageKind: PageKind, targetDocument: Document): Element | null {
  if (pageKind === 'recommend_frame') {
    return findRecommendObservationRoot(targetDocument);
  }
  if (pageKind === 'resume_frame') {
    return findResumeObservationRoot(targetDocument);
  }

  return null;
}


export function startParserCoordinator(options: CoordinatorOptions): CoordinatorHandle {
  const pageKind = classifyPage(
    options.targetDocument,
    options.currentUrl,
    options.isTopFrame,
  );
  const sendMessage = options.sendMessage ?? defaultSendMessage;
  const runtimeOnMessage = options.runtimeOnMessage ?? defaultRuntimeOnMessage();
  const Observer = options.Observer ?? defaultObserver();
  const now = options.now ?? (() => new Date());

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  let lastDedupeKey: string | undefined;

  const sendSnapshot = (snapshot: ParserSnapshot): void => {
    const message: ParserSnapshotMessage = {
      type: 'ARC_PARSER_SNAPSHOT',
      snapshot,
    };

    try {
      void sendMessage(message).catch(() => undefined);
    } catch {
      // Runtime transport failures must not alter or leak into parser snapshots.
    }
  };

  const run = (force = false): void => {
    if (stopped) {
      return;
    }

    let snapshot: ParserSnapshot;
    try {
      snapshot = buildSnapshot(pageKind, options.targetDocument, now());
    } catch {
      snapshot = buildStatusSnapshot(pageKind, 'error', 'parser-exception', now());
    }

    const nextDedupeKey = dedupeKey(snapshot);
    if (!force && nextDedupeKey === lastDedupeKey) {
      return;
    }

    lastDedupeKey = nextDedupeKey;
    sendSnapshot(snapshot);
  };

  const runtimeListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
  ) => {
    if (
      typeof message === 'object'
      && message !== null
      && (message as { type?: unknown }).type === 'ARC_PARSER_REFRESH_COMMAND'
    ) {
      run(true);
    }
  };

  runtimeOnMessage?.addListener(runtimeListener);
  run();

  let observationRoot: Element | null = null;
  try {
    observationRoot = findObservationRoot(pageKind, options.targetDocument);
  } catch {
    // A failed recognition pass must not escape after the safe error snapshot.
  }
  if (observationRoot && Observer) {
    observer = new Observer(() => {
      if (stopped) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, MUTATION_DEBOUNCE_MS);
    });
    observer.observe(observationRoot, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return {
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      observer?.disconnect();
      runtimeOnMessage?.removeListener(runtimeListener);
    },
  };
}
