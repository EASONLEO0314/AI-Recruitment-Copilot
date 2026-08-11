/**
 * Runs in the page's MAIN world. Keep helpers inside this function because
 * Chrome serializes it without module scope.
 */
export function extractBossVisibleSkillTags(): string[] {
  const maxElements = 2_000;
  const maxSkills = 20;
  const scanRootSelector = [
    '.dialog-lib-resume',
    '.lib-resume-recommend',
    '.lib-resume-anonymous',
    '.resume-detail-wrap',
    '.resume-layout-wrap',
    '.wasm-resume-layout',
    '.resume-content',
    '.resume-box',
    '.geek-resume',
  ].join(', ');
  const scanContainerSelector = [
    '.resume-basic',
    '.resume-header',
    '.profile-info',
    '.geek-base-info',
    '.base-info-wrap',
    '.candidate-info',
    '.resume-top',
    '.resume-name-wrap',
    '.name-wrap',
    '.geek-info',
    '.profile-tags',
    '.skills',
    '.skill-section',
    '.skill-wrap',
    '.tags-wrap',
    '.ai-preference-content',
  ].join(', ');
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
  const nonSkillPattern = /^(?:优势|亮点|标签|技能|工作|教育|项目|简历|候选人|推荐|未读|已读|查看|联系|沟通|打招呼|聊一聊|感兴趣|不合适|举报|反馈|当前岗位|字段覆盖率|演示数据|匹配度|非常匹配.*|建议联系.*|招聘规范|我的客服|面试|招聘数据|账号权益|升级VIP|首充礼|筛选|最近关注|职位管理|牛人管理|工具箱|客户端|立即下载|新|本科|硕士|博士|大专|高中|中专|学历|男|女|活跃|今日活跃|刚刚活跃|在线|离线|在职.*|离职.*|随时到岗|应届生|.+专业|.+工程师|.+经理|.+主管|.+负责人|.+顾问|.+专家|.+架构师|.+(?:大学|学院|学校|中学|职校|技校)|\d+|\d+\s*(?:个)?月|\d+\s*(?:年|岁)(?:经验|应届生)?|\d+\s*[-~]\s*\d+\s*年(?:经验)?|\d+\s*[-~]\s*\d+\s*[kK]?)$/;
  const noisyTextPattern = /\d+\s*[-~]\s*\d+\s*[kK]/i;
  const dateLikePattern = /^(?:(?:19|20)?\d{2}(?:[./-]\d{1,2})?|\d{1,2})\s*[-–—至到]\s*(?:至今|现在|当前|(?:19|20)\d{2}(?:[./-]\d{1,2})?)$/;
  const sampleFormat = /^[\p{Script=Han}A-Za-z0-9#+. _/-]{1,40}$/u;
  const technicalSkillPatterns: Array<[string, RegExp]> = [
    ['Spring Cloud', /Spring\s*Cloud|SpringCloud/i],
    ['Spring Boot', /Spring\s*Boot/i],
    ['Spring AI', /Spring\s*AI/i],
    ['JavaScript', /\bJavaScript\b/i],
    ['TypeScript', /\bTypeScript\b/i],
    ['ClickHouse', /\bClickHouse\b/i],
    ['RabbitMQ', /\bRabbitMQ\b/i],
    ['MyBatis', /\bMyBatis\b/i],
    ['PostgreSQL', /\bPostgreSQL\b/i],
    ['Selenium', /\bSelenium\b/i],
    ['JMeter', /\bJMeter\b/i],
    ['Apifox', /\bApifox\b/i],
    ['Postman', /\bPostman\b/i],
    ['Docker', /\bDocker\b/i],
    ['Kubernetes', /\bKubernetes\b|\bK8s\b/i],
    ['Kafka', /\bKafka\b/i],
    ['Redis', /\bRedis\b/i],
    ['MySQL', /\bMySQL\b/i],
    ['Linux', /\bLinux\b/i],
    ['Maven', /\bMaven\b/i],
    ['Python', /\bPython\b/i],
    ['Java', /\bJava\b/],
    ['Vue', /\bVue\d?\b/i],
    ['React', /\bReact\b/i],
    ['HTML/CSS/JS', /HTML\s*\/\s*CSS\s*\/\s*JS/i],
    ['uni-app', /\buni-app\b/i],
    ['IoT', /\bIoT\b/i],
    ['SQL', /\bSQL\b/i],
    ['Git', /\bGit\b/i],
  ];
  const textSkillHeadingPattern = /^(?:专业技能|技能标签|技能特长|个人技能|技术栈|后端开发|前端开发|测试校验|测试经验|测试开发|工程\s*[&和及与/]\s*上线部署|工程化工具|运维部署|数据库(?:与中间件)?|编程语言(?:与框架)?|软件测试(?:与质量保障)?|需求(?:与产品实施)?|高效开发提效工具)$/;
  const textSkillHeadingPrefixPattern = /^(?:专业技能|技能标签|技能特长|个人技能|技术栈|后端开发|前端开发|测试校验|测试经验|测试开发|工程\s*[&和及与/]\s*上线部署|工程化工具|运维部署|数据库(?:与中间件)?|编程语言(?:与框架)?|软件测试(?:与质量保障)?|需求(?:与产品实施)?|高效开发提效工具)\s*[:：\-—]?\s*/;
  const textSkillStopPattern = /^(?:一句话总结|最近关注|工作经历|工作经验|教育经历|教育背景|项目经历|项目经验|经历概览|求职意向)$/;

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

  const preferredScanRoots = (): Element[] => {
    const visibleRoots = Array.from(document.querySelectorAll(scanRootSelector))
      .filter((element) => isVisible(element));
    const roots = visibleRoots.map((element) =>
      element.closest('.dialog-lib-resume, .lib-resume-recommend, .lib-resume-anonymous')
        ?? element);
    return Array.from(new Set(roots)).slice(0, 5);
  };

  const scanContainers = (): Element[] => {
    const roots = preferredScanRoots();
    const containers = roots.flatMap((root) => {
      const rootAsContainer = root.matches(scanContainerSelector) ? [root] : [];
      const nested = Array.from(root.querySelectorAll(scanContainerSelector))
        .filter((element) => isVisible(element));
      const rootText = normalize(root.textContent, 1_001);
      const smallRootFallback = nested.length === 0
        && rootText.length > 0
        && rootText.length <= 1_000
        ? [root]
        : [];
      return [...rootAsContainer, ...nested, ...smallRootFallback];
    });
    const filtered = containers.filter((element) => {
      const text = normalize(element.textContent, 1_001);
      return text.length > 0 && text.length <= 1_000;
    });
    return Array.from(new Set(filtered)).slice(0, 8);
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

  const hasVisibleTextChild = (element: Element): boolean => (
    Array.from(element.children)
      .some((child) => isVisible(child) && normalize(child.textContent, 120).length > 0)
  );

  const addSkill = (skills: Set<string>, value: string): void => {
    const normalized = normalize(value);
    const compact = normalized.replace(/\s+/g, '');
    if (!normalized
      || nonSkillPattern.test(normalized)
      || nonSkillPattern.test(compact)
      || noisyTextPattern.test(normalized)
      || noisyTextPattern.test(compact)
      || dateLikePattern.test(normalized)
      || dateLikePattern.test(compact)
      || (/^[\p{Script=Han}\s]+$/u.test(normalized) && normalized.length > 10)
      || !sampleFormat.test(normalized)
      || normalized.includes('|')
      || normalized.includes(':')) {
      return;
    }
    skills.add(normalized);
  };

  const stripSkillHeadingPrefix = (value: string): string => {
    return normalize(normalize(value, 500).replace(textSkillHeadingPrefixPattern, ''), 500);
  };

  const addDelimitedSkillText = (skills: Set<string>, value: string): void => {
    const stripped = stripSkillHeadingPrefix(value);
    for (const fragment of stripped.split(/[、,，;；]+|\s{2,}/)) {
      const candidate = normalize(
        fragment
          .replace(/^[（(]?\d+[.)、]\s*/, '')
          .replace(/[。.!！]+$/, ''),
        80,
      );
      addSkill(skills, candidate);
    }
  };

  const visibleLeafTexts = (root: Element): string[] => {
    const texts: string[] = [];
    for (const element of deepElements(root)) {
      if (!isVisible(element) || hasVisibleTextChild(element)) {
        continue;
      }
      const text = normalize(element.textContent, 500);
      if (text) {
        texts.push(text);
      }
      if (texts.length >= 120) {
        break;
      }
    }
    return texts;
  };

  const addTextBlockSkills = (skills: Set<string>): void => {
    for (const root of preferredScanRoots()) {
      let active = false;
      let consumedLines = 0;
      for (const text of visibleLeafTexts(root)) {
        const compact = text.replace(/\s+/g, '');
        if (textSkillStopPattern.test(compact)) {
          active = false;
          if (consumedLines > 0) {
            break;
          }
          continue;
        }
        if (textSkillHeadingPattern.test(compact)) {
          active = true;
          consumedLines = 0;
          continue;
        }
        if (!active) {
          continue;
        }
        addDelimitedSkillText(skills, text);
        consumedLines += 1;
        if (skills.size >= maxSkills || consumedLines >= 10) {
          break;
        }
      }
      if (skills.size >= maxSkills) {
        break;
      }
    }
  };

  const addTechnicalKeywordSkills = (skills: Set<string>): void => {
    const matches: Array<{ skill: string; index: number; order: number }> = [];
    const text = preferredScanRoots()
      .map((root) => normalize(root.textContent, 10_000))
      .join(' ');
    technicalSkillPatterns.forEach(([skill, pattern], order) => {
      const match = text.match(pattern);
      if (match?.index !== undefined) {
        matches.push({ skill, index: match.index, order });
      }
    });

    matches
      .sort((left, right) =>
        (left.index - right.index) || (left.order - right.order))
      .forEach(({ skill }) => {
        if (skills.size < maxSkills) {
          addSkill(skills, skill);
        }
      });
  };

  const values = new Set<string>();
  for (const root of scanContainers()) {
    for (const element of deepQuerySelectorAll(root, selector)) {
      if (!isVisible(element) || !isTagElement(element) || hasNestedTagElement(element)) {
        continue;
      }
      addSkill(values, normalize(element.textContent, 80));
      if (values.size >= maxSkills) {
        break;
      }
    }
    if (values.size >= maxSkills) {
      break;
    }
  }
  if (values.size < maxSkills) {
    addTextBlockSkills(values);
  }
  if (values.size === 0) {
    addTechnicalKeywordSkills(values);
  }

  return Array.from(values).slice(0, maxSkills);
}


export function isVisibleSkillTagList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 80);
}
