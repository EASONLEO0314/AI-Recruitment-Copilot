import type {
  PageKind,
  ParserSnapshot,
  ParserSnapshotMessage,
} from '../contracts';
import { isHidden } from './dom';
import { findRecommendObservationRoot, parseRecommendFrame } from './adapters/recommend';
import { parseResumeFrame } from './adapters/resume';
import { buildCapabilityWarnings } from './capabilityProbe';
import { classifyPage } from './pageClassifier';
import { buildStatusSnapshot } from './snapshot';


const MUTATION_DEBOUNCE_MS = 400;
const ROUTE_POLL_MS = 500;
const RESUME_ROOT_SELECTORS = ['.resume-content', '.resume-box', '.geek-resume', 'main'];
const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['class', 'aria-selected', 'hidden', 'aria-hidden'],
};


export interface CoordinatorHandle {
  stop(): void;
}


export interface CoordinatorOptions {
  targetDocument: Document;
  currentUrl: string | (() => string);
  isTopFrame: boolean;
  sendMessage?: (message: ParserSnapshotMessage) => Promise<unknown>;
  runtimeOnMessage?: typeof chrome.runtime.onMessage;
  Observer?: typeof MutationObserver;
  now?: () => Date;
}


async function defaultSendMessage(message: ParserSnapshotMessage): Promise<unknown> {
  const acknowledgement = typeof chrome === 'undefined' || !chrome.runtime?.sendMessage
    ? undefined
    : await chrome.runtime.sendMessage(message);

  if (typeof acknowledgement !== 'object'
    || acknowledgement === null
    || (acknowledgement as { ok?: unknown }).ok !== true) {
    throw new Error('Parser routing was not acknowledged');
  }

  return acknowledgement;
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


function currentUrlFor(options: CoordinatorOptions): string {
  return typeof options.currentUrl === 'function' ? options.currentUrl() : options.currentUrl;
}


function buildSnapshot(
  pageKind: PageKind,
  targetDocument: Document,
  now: Date,
): ParserSnapshot {
  let snapshot: ParserSnapshot;
  switch (pageKind) {
    case 'logged_out':
    case 'non_candidate':
      return buildStatusSnapshot(pageKind, 'ready', undefined, now);
    case 'unsupported':
      return buildStatusSnapshot(pageKind, 'unsupported', undefined, now);
    case 'recommend_frame':
      snapshot = parseRecommendFrame(targetDocument, now);
      break;
    case 'resume_frame':
      snapshot = parseResumeFrame(targetDocument, now);
      break;
  }

  let capabilityWarnings: string[] = [];
  try {
    capabilityWarnings = buildCapabilityWarnings(targetDocument);
  } catch {
    // Optional diagnostics must never replace a successful parser result.
  }

  return {
    ...snapshot,
    warnings: [
      ...capabilityWarnings,
      ...snapshot.warnings,
    ].slice(0, 40),
  };
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
  const sendMessage = options.sendMessage ?? defaultSendMessage;
  const runtimeOnMessage = options.runtimeOnMessage ?? defaultRuntimeOnMessage();
  const Observer = options.Observer ?? defaultObserver();
  const now = options.now ?? (() => new Date());

  let stopped = false;
  let pageKind: PageKind = 'unsupported';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let routeTimer: ReturnType<typeof setInterval> | undefined;
  let observer: MutationObserver | undefined;
  let observationRoot: Element | null = null;
  let lastSuccessfulKey: string | undefined;
  let nextSendSequence = 0;
  let lastSuccessfulSequence = 0;
  let lastRouteUrl = currentUrlFor(options);
  const inFlightByKey = new Map<string, number>();

  const decrementInFlight = (key: string): void => {
    const nextCount = (inFlightByKey.get(key) ?? 1) - 1;
    if (nextCount === 0) {
      inFlightByKey.delete(key);
    } else {
      inFlightByKey.set(key, nextCount);
    }
  };

  const sendSnapshot = (snapshot: ParserSnapshot, key: string): void => {
    const message: ParserSnapshotMessage = {
      type: 'ARC_PARSER_SNAPSHOT',
      snapshot,
    };
    const sequence = ++nextSendSequence;
    inFlightByKey.set(key, (inFlightByKey.get(key) ?? 0) + 1);

    try {
      void sendMessage(message).then(
        () => {
          decrementInFlight(key);
          if (sequence >= lastSuccessfulSequence) {
            lastSuccessfulKey = key;
            lastSuccessfulSequence = sequence;
          }
        },
        () => {
          decrementInFlight(key);
        },
      );
    } catch {
      decrementInFlight(key);
      // Runtime transport failures must not alter or leak into parser snapshots.
    }
  };

  const emitSnapshot = (snapshot: ParserSnapshot, force = false): void => {
    const nextDedupeKey = dedupeKey(snapshot);
    if (
      !force
      && (
        nextDedupeKey === lastSuccessfulKey
        || (inFlightByKey.get(nextDedupeKey) ?? 0) > 0
      )
    ) {
      return;
    }

    sendSnapshot(snapshot, nextDedupeKey);
  };

  const scheduleRun = (force = false): void => {
    if (stopped) {
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      run(force);
    }, MUTATION_DEBOUNCE_MS);
  };

  const observeCurrentRoot = (): void => {
    if (!Observer) {
      return;
    }

    let nextRoot: Element | null = null;
    try {
      nextRoot = findObservationRoot(pageKind, options.targetDocument);
    } catch {
      emitSnapshot(
        buildStatusSnapshot(pageKind, 'error', 'parser-exception', now()),
      );
    }

    if (nextRoot === observationRoot) {
      return;
    }

    observer?.disconnect();
    observer = undefined;
    observationRoot = nextRoot;
    if (!nextRoot) {
      return;
    }

    observer = new Observer(() => scheduleRun());
    observer.observe(nextRoot, OBSERVER_OPTIONS);
  };

  const run = (force = false): void => {
    if (stopped) {
      return;
    }

    let snapshot: ParserSnapshot;
    try {
      pageKind = classifyPage(
        options.targetDocument,
        currentUrlFor(options),
        options.isTopFrame,
      );
      snapshot = buildSnapshot(pageKind, options.targetDocument, now());
    } catch {
      snapshot = buildStatusSnapshot(pageKind, 'error', 'parser-exception', now());
    }

    emitSnapshot(snapshot, force);
    observeCurrentRoot();
  };

  const watchRoute = (): void => {
    const nextUrl = currentUrlFor(options);
    if (nextUrl === lastRouteUrl) {
      return;
    }
    lastRouteUrl = nextUrl;
    run(true);
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

  routeTimer = setInterval(watchRoute, ROUTE_POLL_MS);

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
      if (routeTimer !== undefined) {
        clearInterval(routeTimer);
        routeTimer = undefined;
      }
      observer?.disconnect();
      runtimeOnMessage?.removeListener(runtimeListener);
    },
  };
}
