import { isHidden, visibleText } from './dom';
import { normalizeText } from './snapshot';


type SemanticHeading = 'work' | 'education' | 'project';
type SkillProbeSource =
  | 'profile-header'
  | 'preference-option'
  | 'skill-class'
  | 'tag-class'
  | 'shadow-tag';

const HEADING_KIND_BY_LABEL = new Map<string, SemanticHeading>([
  ['工作经历', 'work'],
  ['工作经验', 'work'],
  ['教育经历', 'education'],
  ['教育背景', 'education'],
  ['项目经历', 'project'],
  ['项目经验', 'project'],
]);
const STRUCTURE_CLASS_FORMAT = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const STRUCTURE_CLASS_KEYWORD = /(?:resume|wasm|geek|candidate|recommend|history|experience|education|project|detail|work|school|company|position|degree|major|timeline|title|item|content|section|box|header|body|summary)/i;
const MAX_VISIBLE_ELEMENTS = 999;
const MAX_RENDERING_ELEMENTS = 50;
const MAX_HEADING_COUNT = 9;
const MAX_PATH_NODES = 5;
const MAX_WARNING_LENGTH = 160;
const MAX_SKILL_PROBE_SOURCES = 5;
const MAX_SKILL_PROBE_SAMPLES = 3;
const SKILL_PROBE_SELECTOR = [
  '.resume-basic .label',
  '.resume-basic .badge',
  '.resume-basic .tag-item',
  '.resume-basic .tags-wrap span',
  '.profile-info .label',
  '.profile-info .badge',
  '.profile-info .tag-item',
  '.profile-info .tags-wrap span',
  '.geek-base-info .label',
  '.geek-base-info .badge',
  '.geek-base-info .tag-item',
  '.geek-base-info .tags-wrap span',
  '.ai-preference-content-option .title',
  '.ai-preference-content-option span',
  '.skill-label',
  '.skill-tag',
  '[class*="skill"]',
  '[class*="Skill"]',
  '[class*="tag"]',
  '[class*="Tag"]',
  '.label',
  '.badge',
].join(', ');
const BASIC_INFO_TOKEN_PATTERN = /^(?:\d+\s*(?:年|岁)(?:经验)?|本科|硕士|博士|大专|高中|中专|学历|男|女|在职.*|离职.*|随时到岗|应届生|.+工程师|.+经理|.+主管|.+负责人|.+顾问|.+专家|.+架构师|工作经历|工作经验|教育经历|教育背景|项目经历|项目经验)$/;
const SAMPLE_TOKEN_FORMAT = /^[\p{Script=Han}A-Za-z0-9#+. _-]{1,40}$/u;


interface HeadingMatch {
  element: Element;
  kind: SemanticHeading;
}

function safeNodeLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList)
    .filter((token) => STRUCTURE_CLASS_FORMAT.test(token)
      && STRUCTURE_CLASS_KEYWORD.test(token))
    .slice(0, 2);
  return [tag, ...classes].join('.');
}


function safeElementPath(element: Element, prefix: string): string {
  const nodes: Element[] = [];
  let current: Element | null = element;
  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
    nodes.unshift(current);
    current = current.parentElement;
  }

  const labels = nodes.slice(-MAX_PATH_NODES).map(safeNodeLabel);
  while (labels.length > 1 && `${prefix}${labels.join('>')}`.length > MAX_WARNING_LENGTH) {
    labels.shift();
  }
  return labels.join('>');
}


function deepElements(targetDocument: Document, maxElements = 2_000): Element[] {
  const elements: Element[] = [];
  const visit = (scope: ParentNode): void => {
    if (elements.length >= maxElements) {
      return;
    }
    for (const element of Array.from(scope.children)) {
      if (isHidden(element)) {
        continue;
      }
      elements.push(element);
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
      visit(element);
      if (elements.length >= maxElements) {
        return;
      }
    }
  };

  visit(targetDocument);
  return elements.slice(0, maxElements);
}


function scopedSelector(selector: string, scope: ParentNode): string {
  return scope instanceof Element ? selector : selector.replace(/:scope\s+/g, '');
}


function deepQuerySelectorAll(
  targetDocument: Document,
  selector: string,
  maxElements = 2_000,
): Element[] {
  const matches: Element[] = [];
  const seen = new Set<Element>();
  const scopes: ParentNode[] = [targetDocument];
  for (const element of deepElements(targetDocument, maxElements)) {
    if (element.shadowRoot) {
      scopes.push(element.shadowRoot);
    }
  }

  for (const scope of scopes) {
    for (const element of Array.from(scope.querySelectorAll(scopedSelector(selector, scope)))) {
      if (!seen.has(element)) {
        seen.add(element);
        matches.push(element);
      }
      if (matches.length >= maxElements) {
        return matches;
      }
    }
  }
  return matches;
}


function isInsideProfileHeader(element: Element): boolean {
  return element.closest([
    '.resume-basic',
    '.resume-header',
    '.profile-info',
    '.geek-base-info',
    '.base-info-wrap',
    '.candidate-info',
    '.name-wrap',
  ].join(', ')) !== null;
}


function skillProbeSource(element: Element): SkillProbeSource {
  if (typeof ShadowRoot !== 'undefined' && element.getRootNode() instanceof ShadowRoot) {
    return 'shadow-tag';
  }
  if (element.closest('.ai-preference-content-option')) {
    return 'preference-option';
  }
  if (isInsideProfileHeader(element)) {
    return 'profile-header';
  }
  if (Array.from(element.classList).some((token) => /skill/i.test(token))) {
    return 'skill-class';
  }
  return 'tag-class';
}


function safeSkillSample(text: string): string | undefined {
  const raw = normalizeText(text, 120);
  if (!raw || raw.length > 40) {
    return undefined;
  }
  const normalized = normalizeText(raw, 40);
  if (!normalized
    || BASIC_INFO_TOKEN_PATTERN.test(normalized)
    || (/^[\p{Script=Han}\s]+$/u.test(normalized) && normalized.length > 12)
    || !SAMPLE_TOKEN_FORMAT.test(normalized)
    || normalized.includes('|')
    || normalized.includes(':')) {
    return undefined;
  }
  return normalized;
}


function skillProbeWarnings(targetDocument: Document): string[] {
  const grouped = new Map<SkillProbeSource, Set<string>>();
  for (const element of deepQuerySelectorAll(targetDocument, SKILL_PROBE_SELECTOR)) {
    if (isHidden(element)) {
      continue;
    }
    const sample = safeSkillSample(visibleText(element, 40));
    if (!sample) {
      continue;
    }
    const source = skillProbeSource(element);
    const values = grouped.get(source) ?? new Set<string>();
    values.add(sample);
    grouped.set(source, values);
  }

  const sourceOrder: SkillProbeSource[] = [
    'profile-header',
    'shadow-tag',
    'preference-option',
    'skill-class',
    'tag-class',
  ];
  return sourceOrder.flatMap((source) => {
    const values = grouped.get(source);
    if (!values || values.size === 0) {
      return [];
    }
    const samples = Array.from(values).slice(0, MAX_SKILL_PROBE_SAMPLES);
    const warning = `probe:skill=${source}:${Math.min(values.size, 50)}:${samples.join('|')}`;
    return warning.length <= MAX_WARNING_LENGTH ? [warning] : [];
  }).slice(0, MAX_SKILL_PROBE_SOURCES);
}


function deepestHeadingMatches(elements: readonly Element[]): HeadingMatch[] {
  const matches = elements.flatMap((element) => {
    const rawText = normalizeText(element.textContent, 80);
    if (!HEADING_KIND_BY_LABEL.has(rawText)) {
      return [];
    }
    const kind = HEADING_KIND_BY_LABEL.get(visibleText(element, 80));
    return kind ? [{ element, kind }] : [];
  });

  return matches.filter((match) => !matches.some((other) =>
    other !== match
      && other.kind === match.kind
      && match.element.contains(other.element)));
}


export function buildCapabilityWarnings(targetDocument: Document): string[] {
  const elements = deepElements(targetDocument)
    .filter((element) => !isHidden(element));
  const headings = deepestHeadingMatches(elements);
  const headingKinds: SemanticHeading[] = ['work', 'education', 'project'];
  const warnings = [
    `probe:visible-elements=${Math.min(elements.length, MAX_VISIBLE_ELEMENTS)}`,
    `probe:iframe-count=${Math.min(
      elements.filter((element) => element.tagName === 'IFRAME').length,
      MAX_RENDERING_ELEMENTS,
    )}`,
    `probe:canvas-count=${Math.min(
      elements.filter((element) => element.tagName === 'CANVAS').length,
      MAX_RENDERING_ELEMENTS,
    )}`,
    `probe:open-shadow-count=${Math.min(
      elements.filter((element) => element.shadowRoot !== null).length,
      MAX_RENDERING_ELEMENTS,
    )}`,
    `probe:wasm-class-count=${Math.min(
      elements.filter((element) =>
        Array.from(element.classList).some((token) => /wasm/i.test(token))).length,
      MAX_RENDERING_ELEMENTS,
    )}`,
  ];

  for (const kind of headingKinds) {
    const matches = headings.filter((heading) => heading.kind === kind);
    if (matches.length === 0) {
      continue;
    }
    warnings.push(`probe:heading=${kind}:${Math.min(matches.length, MAX_HEADING_COUNT)}`);
    const prefix = `probe:heading-path=${kind}:`;
    const path = safeElementPath(matches[0].element, prefix);
    if (path && `${prefix}${path}`.length <= MAX_WARNING_LENGTH) {
      warnings.push(`${prefix}${path}`);
    }
  }

  return [
    ...warnings,
    ...skillProbeWarnings(targetDocument),
  ];
}
