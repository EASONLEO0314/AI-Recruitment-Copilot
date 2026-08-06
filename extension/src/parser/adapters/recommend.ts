import type { CandidateProfile, ParserSnapshot } from '../../contracts';
import { allTexts, firstText, isHidden } from '../dom';
import { buildProfileSnapshot, buildStatusSnapshot } from '../snapshot';
import { parseResumeRoot } from './resume';


export const CARD_SELECTOR =
  '.candidate-card-wrap, .card-list .card-item, .geek-list .geek-card';
export const ACTIVE_CARD_SELECTOR = [
  '.candidate-card-wrap.active',
  '.candidate-card-wrap.is-active',
  '.card-list .card-item.active',
  '.geek-list .geek-card.active',
  '[aria-selected="true"]',
].join(', ');
export const OBSERVATION_ROOT_SELECTOR = [
  '.recommend-wrap',
  '.candidate-recommend',
  '.card-list',
  '.geek-list-wrap .geek-list',
].join(', ');

const MODERN_RESUME_ROOT_SELECTORS = [
  '.dialog-lib-resume .lib-standard-resume',
  '.dialog-lib-resume .resume-layout-wrap',
  '.dialog-lib-resume',
];

const LOCATION_EXCLUSIONS = /年|学历|本科|硕士|博士|大专/;
const STRUCTURE_CLASS_FORMAT = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const STRUCTURE_CLASS_KEYWORD = /(?:resume|geek|candidate|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline)/i;
const HIGH_INFORMATION_CLASS_KEYWORD = /(?:resume|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline)/i;
const MAX_STRUCTURE_CLASSES = 18;
const MAX_EMPTY_PROFILE_CLASSES = 16;
const PROFILE_EVIDENCE_FIELDS = new Set([
  'work_experiences',
  'education',
  'project_experiences',
  'skills',
  'experience_years',
]);


function structureWarnings(document: Document, cardCount: number): string[] {
  const warnings = [
    'recommend-active-card-not-found',
    `structure:card-count=${Math.min(cardCount, 50)}`,
  ];
  const seen = new Set<string>();
  const highInformationClasses: string[] = [];
  const fallbackClasses: string[] = [];

  for (const element of document.querySelectorAll('[class]')) {
    if (isHidden(element)) {
      continue;
    }
    for (const token of element.classList) {
      if (!STRUCTURE_CLASS_FORMAT.test(token)
        || !STRUCTURE_CLASS_KEYWORD.test(token)
        || seen.has(token)) {
        continue;
      }
      const target = HIGH_INFORMATION_CLASS_KEYWORD.test(token)
        ? highInformationClasses
        : fallbackClasses;
      if (target.length === MAX_STRUCTURE_CLASSES) {
        continue;
      }
      seen.add(token);
      target.push(token);
    }
  }

  warnings.push(
    ...highInformationClasses
      .concat(fallbackClasses)
      .slice(0, MAX_STRUCTURE_CLASSES)
      .map((token) => `structure:class=${token}`),
  );
  return warnings;
}


function emptyProfileStructureWarnings(root: Element): string[] {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
    .filter((element) => !isHidden(element));
  const iframeCount = elements.filter((element) => element.tagName === 'IFRAME').length;
  const openShadowCount = elements.filter((element) => element.shadowRoot !== null).length;
  const seen = new Set<string>();
  const classWarnings: string[] = [];

  for (const element of elements) {
    for (const token of element.classList) {
      if (classWarnings.length === MAX_EMPTY_PROFILE_CLASSES) {
        break;
      }
      if (!STRUCTURE_CLASS_FORMAT.test(token)
        || !STRUCTURE_CLASS_KEYWORD.test(token)
        || seen.has(token)) {
        continue;
      }
      seen.add(token);
      classWarnings.push(`structure:class=${token}`);
    }
  }

  return [
    'recommend-resume-profile-empty',
    `structure:element-count=${Math.min(elements.length, 999)}`,
    `structure:iframe-count=${Math.min(iframeCount, 50)}`,
    `structure:open-shadow-count=${Math.min(openShadowCount, 50)}`,
    ...classWarnings,
  ];
}


function findModernResumeRoot(document: Document): Element | undefined {
  for (const selector of MODERN_RESUME_ROOT_SELECTORS) {
    const root = Array.from(document.querySelectorAll(selector))
      .find((element) => !isHidden(element));
    if (root) {
      return root;
    }
  }
  return undefined;
}


export function findRecommendObservationRoot(document: Document): Element | null {
  return Array.from(document.querySelectorAll(OBSERVATION_ROOT_SELECTOR))
    .find((element) => !isHidden(element)) ?? null;
}


export function parseRecommendFrame(document: Document, now: Date): ParserSnapshot {
  const resumeRoot = findModernResumeRoot(document);
  if (resumeRoot) {
    const snapshot = parseResumeRoot(resumeRoot, 'recommend_frame', now);
    const hasProfileEvidence = snapshot.present_fields
      .some((field) => PROFILE_EVIDENCE_FIELDS.has(field));
    if (hasProfileEvidence) {
      return snapshot;
    }

    return {
      ...buildStatusSnapshot('recommend_frame', 'unsupported', undefined, now),
      warnings: emptyProfileStructureWarnings(resumeRoot),
    };
  }

  const cards = Array.from(document.querySelectorAll(CARD_SELECTOR))
    .filter((element) => !isHidden(element));
  const activeCard = cards.find((card) => card.matches(ACTIVE_CARD_SELECTOR));
  const card = activeCard ?? (cards.length === 1 ? cards[0] : undefined);

  if (!card) {
    const snapshot = buildStatusSnapshot(
      'recommend_frame',
      'unsupported',
      undefined,
      now,
    );
    return {
      ...snapshot,
      warnings: structureWarnings(document, cards.length),
    };
  }

  const name = firstText(card, ['.name-wrap .name', '.name'], 80);
  const baseInfo = allTexts(card, ['.base-info span'], 80);
  const experienceText = baseInfo.find((value) => /\d+\s*年/.test(value));
  const experienceMatch = experienceText?.match(/(\d+)\s*年/);
  const experienceYears = experienceMatch ? Number(experienceMatch[1]) : undefined;
  const expectedPosition = firstText(
    card,
    ['.expect-wrap .content', '.expect-wrap .join-text-wrap'],
    160,
  );
  const summary = firstText(card, ['.geek-desc .content'], 500);
  const skills = allTexts(
    card,
    ['.operate .labels .label', '.tags-wrap .tag-item'],
    80,
  );
  const location = baseInfo[0] && !LOCATION_EXCLUSIONS.test(baseInfo[0])
    ? baseInfo[0]
    : undefined;

  const profile: CandidateProfile = {
    display_name: name,
    location,
    experience_years: experienceYears,
    expected_position: expectedPosition,
    education: [],
    work_experiences: [],
    project_experiences: [],
    skills,
    summary,
  };

  return buildProfileSnapshot('recommend_frame', profile, now);
}
