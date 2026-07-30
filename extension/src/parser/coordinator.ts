import type {
  PageKind,
  ParserSnapshot,
  ParserSnapshotMessage,
} from '../contracts';
import { isHidden } from './dom';
import { findRecommendObservationRoot, parseRecommendFrame } from './adapters/recommend';
import { parseResumeFrame } from './adapters/resume';
import { classifyPage } from './pageClassifier';
import { probePublicJob, type PublicJobProbeResult } from './publicJobProbe';
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
  publicJobProbe?: (targetDocument: Document) => PublicJobProbeResult;
  publicJobProbeLogger?: (result: PublicJobProbeResult) => void;
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
  const publicJobProbe = options.publicJobProbe ?? probePublicJob;
  const publicJobProbeLogger = options.publicJobProbeLogger
    ?? ((result: PublicJobProbeResult): void => {
      console.info('[ARC public job probe]', result);
    });

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  let lastSuccessfulKey: string | undefined;
  let nextSendSequence = 0;
  let lastSuccessfulSequence = 0;
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

    emitSnapshot(snapshot, force);
  };

  const runPublicJobProbe = (): void => {
    if (stopped || !options.isTopFrame || pageKind !== 'logged_out') {
      return;
    }

    let result: PublicJobProbeResult;
    try {
      result = publicJobProbe(options.targetDocument);
    } catch {
      result = { status: 'not_found' };
    }
    try {
      publicJobProbeLogger(result);
    } catch {
      // Diagnostic logging must not block or leak into a forced parser refresh.
    }
  };

  const runtimeListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
  ) => {
    if (
      typeof message === 'object'
      && message !== null
      && (message as { type?: unknown }).type === 'ARC_PARSER_REFRESH_COMMAND'
    ) {
      runPublicJobProbe();
      run(true);
    }
  };

  runtimeOnMessage?.addListener(runtimeListener);
  run();

  let observationRoot: Element | null = null;
  try {
    observationRoot = findObservationRoot(pageKind, options.targetDocument);
  } catch {
    emitSnapshot(
      buildStatusSnapshot(pageKind, 'error', 'parser-exception', now()),
    );
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
      attributes: true,
      attributeFilter: ['class', 'aria-selected', 'hidden', 'aria-hidden'],
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
