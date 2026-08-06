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
  '.resume-detail-wrap',
  '.lib-standard-resume',
  '.wasm-resume-layout',
  '.lib-resume-recommend',
];

const LOCATION_EXCLUSIONS = /年|学历|本科|硕士|博士|大专/;
const STRUCTURE_CLASS_FORMAT = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const STRUCTURE_CLASS_KEYWORD = /(?:resume|geek|candidate|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline)/i;
const HIGH_INFORMATION_CLASS_KEYWORD = /(?:resume|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline)/i;
const TOPOLOGY_CLASS_KEYWORD = /(?:resume|geek|candidate|recommend|history|experience|education|project|advantage|detail|work|school|company|position|degree|major|timeline|title|item|content|section|box|header|body|summary|greet)/i;
const SUMMARY_SECTION_CLASS_KEYWORD = /(?:^|[-_])(?:work|project|education|experience|history)(?:$|[-_])/i;
const SUMMARY_ITEM_CLASS_KEYWORD = /(?:^|[-_])(?:item|timeline|entry|list)(?:$|[-_])/i;
const MAX_STRUCTURE_CLASSES = 18;
const MAX_EMPTY_PROFILE_CLASSES = 16;
const MAX_EMPTY_PROFILE_EDGES = 16;
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


function emptyProfileDiagnosticRoot(root: Element): Element {
  if (root.matches('.resume-summary')) {
    return root;
  }
  return Array.from(root.querySelectorAll('.resume-summary'))
    .find((element) => !isHidden(element)) ?? root;
}


function emptyProfileStructureWarnings(root: Element): string[] {
  const diagnosticRoot = emptyProfileDiagnosticRoot(root);
  const elements = [diagnosticRoot, ...Array.from(diagnosticRoot.querySelectorAll('*'))]
    .filter((element) => !isHidden(element));
  const iframeCount = elements.filter((element) => element.tagName === 'IFRAME').length;
  const openShadowCount = elements.filter((element) => element.shadowRoot !== null).length;
  const classCounts = new Map<string, number>();
  const classOrder = new Map<string, number>();
  const tokensByElement = new Map<Element, string[]>();

  for (const element of elements) {
    const tokens = Array.from(element.classList)
      .filter((token) => STRUCTURE_CLASS_FORMAT.test(token)
        && TOPOLOGY_CLASS_KEYWORD.test(token));
    tokensByElement.set(element, tokens);
    for (const token of tokens) {
      const count = classCounts.get(token);
      if (count !== undefined) {
        classCounts.set(token, Math.min(count + 1, 999));
      } else {
        classCounts.set(token, 1);
        classOrder.set(token, classOrder.size);
      }
    }
  }

  const rootTokens = new Set(tokensByElement.get(diagnosticRoot) ?? []);
  const directChildTokens = new Set(
    Array.from(diagnosticRoot.children)
      .filter((element) => !isHidden(element))
      .flatMap((element) => tokensByElement.get(element) ?? []),
  );
  const tokenPriority = (token: string, count: number): number => {
    if (rootTokens.has(token)) {
      return 0;
    }
    if (directChildTokens.has(token) && SUMMARY_SECTION_CLASS_KEYWORD.test(token)) {
      return 1;
    }
    if (count > 1 && SUMMARY_ITEM_CLASS_KEYWORD.test(token)) {
      return 2;
    }
    if (count > 1) {
      return 3;
    }
    if (directChildTokens.has(token)) {
      return 4;
    }
    return 5;
  };
  const compareTokens = (leftToken: string, rightToken: string): number => {
    const leftCount = classCounts.get(leftToken) ?? 0;
    const rightCount = classCounts.get(rightToken) ?? 0;
    const priorityDifference = tokenPriority(leftToken, leftCount)
      - tokenPriority(rightToken, rightCount);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }
    if (leftCount !== rightCount) {
      return rightCount - leftCount;
    }
    return (classOrder.get(leftToken) ?? 0) - (classOrder.get(rightToken) ?? 0);
  };
  const selectedClassCounts = Array.from(classCounts.entries())
    .sort(([leftToken], [rightToken]) => compareTokens(leftToken, rightToken))
    .slice(0, MAX_EMPTY_PROFILE_CLASSES);
  const selectedTokens = new Set(selectedClassCounts.map(([token]) => token));
  const maxTokensPerEdgeNode = diagnosticRoot.matches('.resume-summary') ? 1 : 3;
  const edgeTokens = (element: Element): string[] =>
    (tokensByElement.get(element) ?? [])
      .filter((token) => selectedTokens.has(token))
      .sort(compareTokens)
      .slice(0, maxTokensPerEdgeNode);
  const edgeWarnings: string[] = [];
  const seenEdges = new Set<string>();
  for (const element of elements) {
    const childTokens = edgeTokens(element);
    if (childTokens.length === 0) {
      continue;
    }

    let ancestor = element.parentElement;
    while (ancestor && diagnosticRoot.contains(ancestor)) {
      const parentTokens = edgeTokens(ancestor);
      if (parentTokens.length > 0) {
        const warning = `structure:edge=${parentTokens.join('+')}>${childTokens.join('+')}`;
        if (warning.length <= 160
          && !seenEdges.has(warning)
          && edgeWarnings.length < MAX_EMPTY_PROFILE_EDGES) {
          seenEdges.add(warning);
          edgeWarnings.push(warning);
        }
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  return [
    'recommend-resume-profile-empty',
    `structure:element-count=${Math.min(elements.length, 999)}`,
    `structure:iframe-count=${Math.min(iframeCount, 50)}`,
    `structure:open-shadow-count=${Math.min(openShadowCount, 50)}`,
    ...selectedClassCounts.map(([token, count]) =>
      `structure:class-count=${token}:${count}`),
    ...edgeWarnings,
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
