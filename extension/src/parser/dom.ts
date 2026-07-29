import { normalizeText } from './snapshot';


export function isHidden(element: Element): boolean {
  return element.closest('[hidden], [aria-hidden="true"]') !== null;
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
