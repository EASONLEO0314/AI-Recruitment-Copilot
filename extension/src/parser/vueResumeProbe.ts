export type VueResumeRoot = 'lib-resume-recommend' | 'lib-resume-anonymous';

export type VueGeneration = 'vue2' | 'vue3';

export interface VueResumeCapability {
  root: VueResumeRoot;
  vue_generation: VueGeneration;
  resume_object: 'resumeInfo';
  allowed_keys: string[];
  array_lengths: Record<string, number>;
}

export type VueResumeFrameProbe =
  | { status: 'ready'; capability: VueResumeCapability }
  | { status: 'vue-root-not-found' }
  | { status: 'vue-instance-not-found'; root: VueResumeRoot }
  | {
      status: 'vue-resume-data-unavailable';
      root: VueResumeRoot;
      vue_generation: VueGeneration;
    };


/**
 * Runs in the page's MAIN world. Keep every helper and allowlist inside this
 * function because Chrome serializes the function without module scope.
 */
export function extractBossVueResumeCapability(): VueResumeFrameProbe {
  const roots = [
    ['.lib-resume-recommend', 'lib-resume-recommend'],
    ['.lib-resume-anonymous', 'lib-resume-anonymous'],
  ] as const;
  const allowedKeys = [
    'geekBaseInfo',
    'geekWorkExpList',
    'geekProjExpList',
    'geekEduExpList',
    'geekDesc',
    'skillTagList',
  ] as const;
  const maxElements = 500;

  const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );

  const safeRead = (value: unknown, key: string): unknown => {
    if (!isRecord(value)) {
      return undefined;
    }
    try {
      return value[key];
    } catch {
      return undefined;
    }
  };

  const isVisible = (element: Element): boolean => {
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
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

  const findVisibleRoots = (): Array<{ element: Element; root: VueResumeRoot }> => {
    const visibleRoots: Array<{ element: Element; root: VueResumeRoot }> = [];
    for (const [selector, root] of roots) {
      const matches = Array.from(document.querySelectorAll(selector)).slice(0, maxElements);
      for (const element of matches) {
        if (isVisible(element)) {
          visibleRoots.push({ element, root });
        }
      }
    }
    return visibleRoots.slice(0, 10);
  };

  const boundedElements = (root: Element): Element[] => {
    const elements = [root, ...Array.from(root.querySelectorAll('*')).slice(0, maxElements - 1)];
    let ancestor = root.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1) {
      elements.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    return elements;
  };

  const findVueHandles = (
    root: Element,
  ): Array<{ generation: VueGeneration; instance: unknown }> => {
    const handles: Array<{ generation: VueGeneration; instance: unknown }> = [];
    for (const element of boundedElements(root)) {
      const candidate = element as Element & {
        __vue__?: unknown;
        __vueParentComponent?: unknown;
        __vnode?: unknown;
      };
      try {
        if (candidate.__vue__ !== undefined) {
          handles.push({ generation: 'vue2', instance: candidate.__vue__ });
        }
        if (candidate.__vueParentComponent !== undefined) {
          handles.push({ generation: 'vue3', instance: candidate.__vueParentComponent });
        }
        const vnodeComponent = safeRead(candidate.__vnode, 'component');
        if (vnodeComponent !== undefined) {
          handles.push({ generation: 'vue3', instance: vnodeComponent });
        }
      } catch {
        // Continue within the bounded root when a page-owned getter rejects.
      }
    }
    return handles;
  };

  const findResumeInfo = (generation: VueGeneration, instance: unknown): unknown => {
    const containers = generation === 'vue2'
      ? [
          instance,
          safeRead(instance, '$data'),
          safeRead(instance, '$props'),
          safeRead(safeRead(instance, '$options'), 'propsData'),
        ]
      : [
          safeRead(instance, 'setupState'),
          safeRead(instance, 'ctx'),
          safeRead(instance, 'proxy'),
          safeRead(instance, 'props'),
          safeRead(instance, 'data'),
        ];

    for (const container of containers) {
      const resumeInfo = safeRead(container, 'resumeInfo');
      if (isRecord(resumeInfo)) {
        return resumeInfo;
      }
    }
    return undefined;
  };

  const visibleRoots = findVisibleRoots();
  if (visibleRoots.length === 0) {
    return { status: 'vue-root-not-found' };
  }

  const ready: VueResumeCapability[] = [];
  let firstVueHandle: { root: VueResumeRoot; generation: VueGeneration } | undefined;
  for (const visibleRoot of visibleRoots) {
    const vueHandles = findVueHandles(visibleRoot.element);
    for (const vueHandle of vueHandles) {
      firstVueHandle ??= { root: visibleRoot.root, generation: vueHandle.generation };
      const resumeInfo = findResumeInfo(vueHandle.generation, vueHandle.instance);
      if (!isRecord(resumeInfo)) {
        continue;
      }

      const presentKeys: string[] = [];
      const arrayLengths: Record<string, number> = {};
      for (const key of allowedKeys) {
        let value: unknown;
        try {
          if (!Object.prototype.hasOwnProperty.call(resumeInfo, key)) {
            continue;
          }
          value = resumeInfo[key];
        } catch {
          continue;
        }
        presentKeys.push(key);
        if (Array.isArray(value)) {
          arrayLengths[key] = Math.min(value.length, 50);
        }
      }

      ready.push({
        root: visibleRoot.root,
        vue_generation: vueHandle.generation,
        resume_object: 'resumeInfo',
        allowed_keys: presentKeys,
        array_lengths: arrayLengths,
      });
    }
  }

  ready.sort((left, right) => {
    const leftScore = left.allowed_keys.length * 100
      + Object.values(left.array_lengths).reduce((total, count) => total + count, 0);
    const rightScore = right.allowed_keys.length * 100
      + Object.values(right.array_lengths).reduce((total, count) => total + count, 0);
    return rightScore - leftScore;
  });
  if (ready.length > 0) {
    return { status: 'ready', capability: ready[0] };
  }

  if (firstVueHandle) {
    return {
      status: 'vue-resume-data-unavailable',
      root: firstVueHandle.root,
      vue_generation: firstVueHandle.generation,
    };
  }

  return { status: 'vue-instance-not-found', root: visibleRoots[0].root };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}


export function isVueResumeFrameProbe(value: unknown): value is VueResumeFrameProbe {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return false;
  }

  if (value.status === 'vue-root-not-found') {
    return hasOnlyKeys(value, ['status']);
  }

  const roots = ['lib-resume-recommend', 'lib-resume-anonymous'] as const;
  if (!roots.includes(value.root as VueResumeRoot)) {
    if (value.status !== 'ready') {
      return false;
    }
  }

  if (value.status === 'vue-instance-not-found') {
    return hasOnlyKeys(value, ['status', 'root']);
  }

  const generations = ['vue2', 'vue3'] as const;
  if (value.status === 'vue-resume-data-unavailable') {
    return hasOnlyKeys(value, ['status', 'root', 'vue_generation'])
      && generations.includes(value.vue_generation as VueGeneration);
  }

  if (value.status !== 'ready'
    || !hasOnlyKeys(value, ['status', 'capability'])
    || !isRecord(value.capability)) {
    return false;
  }

  const capability = value.capability;
  const allowedKeys = [
    'geekBaseInfo',
    'geekWorkExpList',
    'geekProjExpList',
    'geekEduExpList',
    'geekDesc',
    'skillTagList',
  ] as const;
  if (!hasOnlyKeys(capability, [
    'root',
    'vue_generation',
    'resume_object',
    'allowed_keys',
    'array_lengths',
  ])
    || !roots.includes(capability.root as VueResumeRoot)
    || !generations.includes(capability.vue_generation as VueGeneration)
    || capability.resume_object !== 'resumeInfo'
    || !Array.isArray(capability.allowed_keys)
    || capability.allowed_keys.length > allowedKeys.length
    || !capability.allowed_keys.every((key) => (
      typeof key === 'string' && allowedKeys.includes(key as typeof allowedKeys[number])
    ))
    || new Set(capability.allowed_keys).size !== capability.allowed_keys.length
    || !isRecord(capability.array_lengths)) {
    return false;
  }

  const presentKeys = capability.allowed_keys as string[];
  const arrayLengths = capability.array_lengths;
  const arrayKeys = ['geekWorkExpList', 'geekProjExpList', 'geekEduExpList', 'skillTagList'];
  return Object.entries(arrayLengths).every(([key, length]) => (
    arrayKeys.includes(key)
      && presentKeys.includes(key)
      && Number.isInteger(length)
      && Number(length) >= 0
      && Number(length) <= 50
  ));
}
