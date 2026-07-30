import { firstText, isHidden } from './dom';
import { normalizeText } from './snapshot';


export interface PublicJobProbeResult {
  status: 'success' | 'partial' | 'not_found';
  title?: string;
  company?: string;
  location?: string;
}


const JOB_LINK_SELECTOR = 'a[href*="/job_detail/"]';
const JOB_CARD_SELECTORS = [
  '.job-card-box',
  '.job-card-wrapper',
  '[class*="job-card"]',
  'article',
  'li',
] as const;
const JOB_CARD_SELECTOR = JOB_CARD_SELECTORS.join(', ');
const TITLE_SELECTORS = ['.job-name', '.job-title', JOB_LINK_SELECTOR] as const;
const COMPANY_SELECTORS = ['.company-name', '.company-text'] as const;
const LOCATION_SELECTORS = ['.job-area', '.job-location'] as const;

const FIELD_MAX_LENGTH = 80;


function boundedFirstText(
  root: ParentNode,
  selectors: readonly string[],
  maxLength: number,
): string | undefined {
  return normalizeText(firstText(root, selectors, maxLength), maxLength) || undefined;
}


function isProbeHidden(element: Element): boolean {
  if (isHidden(element)) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }

  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return true;
    }
  }
  return false;
}


export function probePublicJob(root: ParentNode = document): PublicJobProbeResult {
  const link = Array.from(root.querySelectorAll(JOB_LINK_SELECTOR))
    .find((candidate) => !isProbeHidden(candidate));
  if (!link) {
    return { status: 'not_found' };
  }

  const card = link.closest(JOB_CARD_SELECTOR) ?? link;
  const title = boundedFirstText(card, TITLE_SELECTORS, FIELD_MAX_LENGTH)
    ?? (card === link ? normalizeText(link.textContent, FIELD_MAX_LENGTH) || undefined : undefined);
  const company = boundedFirstText(card, COMPANY_SELECTORS, FIELD_MAX_LENGTH);
  const location = boundedFirstText(card, LOCATION_SELECTORS, FIELD_MAX_LENGTH);
  if (!title && !company && !location) {
    return { status: 'not_found' };
  }

  const result: PublicJobProbeResult = {
    status: title && company && location ? 'success' : 'partial',
  };
  if (title) {
    result.title = title;
  }
  if (company) {
    result.company = company;
  }
  if (location) {
    result.location = location;
  }
  return result;
}
