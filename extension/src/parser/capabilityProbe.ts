import { isHidden, visibleText } from './dom';
import { normalizeText } from './snapshot';


type SemanticHeading = 'work' | 'education' | 'project';

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
  const elements = Array.from(targetDocument.querySelectorAll('*'))
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

  return warnings;
}
