import type { PageKind } from '../contracts';
import { isHidden } from './dom';
import { normalizeText } from './snapshot';


const LOGIN_LABELS = new Set(['登录', '立即登录', '登录/注册', '扫码登录']);

const RECOMMEND_FRAME_SIGNATURES = [
  '.dialog-lib-resume .lib-standard-resume',
  '.dialog-lib-resume .resume-layout-wrap',
  '.candidate-recommend',
  '.recommend-wrap',
] as const;


function hasVisibleLoginSignal(targetDocument: Document): boolean {
  return Array.from(targetDocument.querySelectorAll('a, button')).some((element) => {
    if (element.closest('[hidden], [aria-hidden="true"]')) {
      return false;
    }

    return LOGIN_LABELS.has(normalizeText(element.textContent, 20));
  });
}


function hasVisibleRecommendFrameSignal(targetDocument: Document): boolean {
  return RECOMMEND_FRAME_SIGNATURES.some((selector) =>
    Array.from(targetDocument.querySelectorAll(selector)).some((element) => !isHidden(element)),
  );
}


export function classifyPage(
  targetDocument: Document,
  currentUrl: string,
  isTopFrame: boolean,
): PageKind {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(currentUrl);
  } catch {
    return 'unsupported';
  }

  if (parsedUrl.hostname !== 'www.zhipin.com') {
    return isTopFrame ? 'non_candidate' : 'unsupported';
  }

  if (isTopFrame) {
    return hasVisibleLoginSignal(targetDocument) ? 'logged_out' : 'non_candidate';
  }

  if (parsedUrl.pathname.startsWith('/web/frame/recommend')) {
    return 'recommend_frame';
  }

  if (
    parsedUrl.pathname === '/web/frame/c-resume'
    || parsedUrl.pathname.startsWith('/web/frame/c-resume/')
  ) {
    return 'resume_frame';
  }

  if (hasVisibleRecommendFrameSignal(targetDocument)) {
    return 'recommend_frame';
  }

  return 'unsupported';
}
