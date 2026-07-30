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
const TITLE_SELECTORS = ['.job-name', '.job-title', JOB_LINK_SELECTOR] as const;
const COMPANY_SELECTORS = ['.company-name', '.company-text'] as const;
const LOCATION_SELECTORS = ['.job-area', '.job-location'] as const;

const TITLE_MAX_LENGTH = 80;
const DETAIL_MAX_LENGTH = 160;


function boundedFirstText(
  root: ParentNode,
  selectors: readonly string[],
  maxLength: number,
): string | undefined {
  return normalizeText(firstText(root, selectors, maxLength), maxLength) || undefined;
}


export function probePublicJob(root: ParentNode = document): PublicJobProbeResult {
  const cards = root.querySelectorAll(JOB_CARD_SELECTORS.join(', '));

  for (const card of cards) {
    if (isHidden(card)) {
      continue;
    }

    const link = Array.from(card.querySelectorAll(JOB_LINK_SELECTOR))
      .find((candidate) => !isHidden(candidate));
    if (!link) {
      continue;
    }

    const title = boundedFirstText(card, TITLE_SELECTORS, TITLE_MAX_LENGTH);
    const company = boundedFirstText(card, COMPANY_SELECTORS, DETAIL_MAX_LENGTH);
    const location = boundedFirstText(card, LOCATION_SELECTORS, DETAIL_MAX_LENGTH);
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

  return { status: 'not_found' };
}
