import { normalizeText } from './snapshot';


const NON_RENDERED_TEXT_CONTAINERS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
]);


export function isHidden(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]') !== null) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }

  const elementStyle = view.getComputedStyle(element);
  if (elementStyle.visibility === 'hidden'
    || elementStyle.visibility === 'collapse') {
    return true;
  }

  let current: Element | null = element;
  while (current) {
    const style = view.getComputedStyle(current);
    if (style.display === 'none') {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}


export function visibleText(root: Element, maxLength = 500): string {
  const parts: string[] = [];

  function visit(node: Node): void {
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (parent && !isHidden(parent)) {
        const value = normalizeText(node.textContent, maxLength + 1);
        if (value) {
          parts.push(value);
        }
      }
      return;
    }

    if (!(node instanceof Element)
      || isHidden(node)
      || NON_RENDERED_TEXT_CONTAINERS.has(node.tagName)) {
      return;
    }

    for (const child of node.childNodes) {
      visit(child);
    }
  }

  visit(root);
  return normalizeText(parts.join(' '), maxLength);
}


export function firstText(
  root: ParentNode,
  selectors: readonly string[],
  maxLength = 160,
): string | undefined {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (isHidden(element)) {
        continue;
      }
      const value = normalizeText(element.textContent, maxLength);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}


export function allTexts(
  root: ParentNode,
  selectors: readonly string[],
  maxLength = 160,
): string[] {
  const values = selectors.flatMap((selector) =>
    Array.from(root.querySelectorAll(selector))
      .filter((element) => !isHidden(element))
      .map((element) => normalizeText(element.textContent, maxLength))
      .filter(Boolean));

  return [...new Set(values)].slice(0, 50);
}
