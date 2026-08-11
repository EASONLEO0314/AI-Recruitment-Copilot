/**
 * Runs in the page's MAIN world. Keep helpers inside this function because
 * Chrome serializes it without module scope.
 */
export function extractBossVisibleSkillTags(): string[] {
  const maxElements = 2_000;
  const maxSkills = 20;
  const selector = [
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
    '.tag-item',
    '.label',
    '.badge',
    '[class]',
  ].join(', ');
  const tagClassPattern = /(?:^|[-_])(?:tags?|skills?|label|badge)(?:$|[-_])/i;
  const nonSkillPattern = /^(?:优势|亮点|标签|技能|工作|教育|项目|简历|候选人|推荐|未读|已读|查看|联系|沟通|打招呼|聊一聊|感兴趣|不合适|举报|反馈|当前岗位|字段覆盖率|演示数据|匹配度|非常匹配.*|建议联系.*|本科|硕士|博士|大专|高中|中专|学历|男|女|活跃|今日活跃|刚刚活跃|在线|离线|在职.*|离职.*|随时到岗|应届生|.+工程师|.+经理|.+主管|.+负责人|.+顾问|.+专家|.+架构师|\d+\s*(?:年|岁)(?:经验)?|\d+\s*[-~]\s*\d+\s*年(?:经验)?|\d+\s*[-~]\s*\d+\s*[kK]?)$/;
  const sampleFormat = /^[\p{Script=Han}A-Za-z0-9#+. _/-]{1,40}$/u;

  const normalize = (value: string | null | undefined, maximum = 80): string => (
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum)
  );

  const isExtensionElement = (element: Element): boolean => {
    const root = element.getRootNode();
    if (typeof ShadowRoot !== 'undefined'
      && root instanceof ShadowRoot
      && root.host instanceof Element
      && root.host.id === 'ai-recruitment-copilot-root') {
      return true;
    }
    return element.closest('#ai-recruitment-copilot-root') !== null;
  };

  const isVisible = (element: Element): boolean => {
    if (element.hasAttribute('hidden')
      || element.getAttribute('aria-hidden') === 'true'
      || isExtensionElement(element)) {
      return false;
    }
    try {
      const style = globalThis.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  };

  const deepElements = (root: ParentNode): Element[] => {
    const elements: Element[] = [];
    const visit = (scope: ParentNode): void => {
      if (elements.length >= maxElements) {
        return;
      }
      for (const element of Array.from(scope.children)) {
        if (elements.length >= maxElements) {
          return;
        }
        elements.push(element);
        if (element.shadowRoot) {
          visit(element.shadowRoot);
        }
        visit(element);
      }
    };
    visit(root);
    return elements.slice(0, maxElements);
  };

  const deepQuerySelectorAll = (root: ParentNode, targetSelector: string): Element[] => {
    const matches: Element[] = [];
    const seen = new Set<Element>();
    const scopes: ParentNode[] = [root];
    for (const element of deepElements(root)) {
      if (element.shadowRoot) {
        scopes.push(element.shadowRoot);
      }
    }

    for (const scope of scopes) {
      for (const element of Array.from(scope.querySelectorAll(targetSelector))) {
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
  };

  const isTagElement = (element: Element): boolean => (
    element.matches('.skill-label, .skill-tag, .tag-item, .label, .badge')
    || element.closest('.tags-wrap, .ai-preference-content-option') !== null
    || Array.from(element.classList).some((token) => tagClassPattern.test(token))
  );

  const hasNestedTagElement = (element: Element): boolean => (
    Array.from(element.querySelectorAll(selector))
      .slice(0, 50)
      .some((child) => child !== element && isTagElement(child))
  );

  const addSkill = (skills: Set<string>, value: string): void => {
    const normalized = normalize(value);
    const compact = normalized.replace(/\s+/g, '');
    if (!normalized
      || nonSkillPattern.test(normalized)
      || nonSkillPattern.test(compact)
      || (/^[\p{Script=Han}\s]+$/u.test(normalized) && normalized.length > 10)
      || !sampleFormat.test(normalized)
      || normalized.includes('|')
      || normalized.includes(':')) {
      return;
    }
    skills.add(normalized);
  };

  const values = new Set<string>();
  for (const element of deepQuerySelectorAll(document, selector)) {
    if (!isVisible(element) || !isTagElement(element) || hasNestedTagElement(element)) {
      continue;
    }
    addSkill(values, normalize(element.textContent, 80));
    if (values.size >= maxSkills) {
      break;
    }
  }

  return Array.from(values).slice(0, maxSkills);
}


export function isVisibleSkillTagList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 80);
}
