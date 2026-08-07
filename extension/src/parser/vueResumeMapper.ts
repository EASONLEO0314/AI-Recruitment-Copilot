import type {
  CandidateProfile,
  EducationExperience,
  ProjectExperience,
  WorkExperience,
} from '../contracts';
import { isParserSnapshot } from '../validation';
import {
  isVueResumeFrameProbe,
  type VueGeneration,
  type VueResumeCapability,
  type VueResumeRoot,
} from './vueResumeProbe';


export type VueResumeProfileFrameProbe =
  | {
      status: 'ready';
      capability: VueResumeCapability;
      profile: CandidateProfile;
      schema: VueResumeSchemaField[];
      nested_schema: VueResumeNestedSchemaField[];
    }
  | { status: 'vue-root-not-found' }
  | { status: 'vue-instance-not-found'; root: VueResumeRoot }
  | {
      status: 'vue-resume-data-unavailable';
      root: VueResumeRoot;
      vue_generation: VueGeneration;
    };

export type VueResumeSchemaType =
  | 'array'
  | 'object'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'other';

export interface VueResumeSchemaField {
  key: string;
  type: VueResumeSchemaType;
  array_length?: number;
}

export interface VueResumeNestedSchemaField extends VueResumeSchemaField {
  container: 'geekDetailInfo';
}


/**
 * Runs in the page's MAIN world. All runtime helpers and allowlists must stay
 * inside this function because Chrome serializes it without module scope.
 */
export function extractBossVueResumeProfile(): VueResumeProfileFrameProbe {
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
  const maxItems = 50;
  const maxSchemaFields = 40;
  const schemaKeyFormat = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

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

  const normalize = (value: unknown, maximum = 160): string | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.replace(/\s+/g, ' ').trim().slice(0, maximum);
    return normalized || undefined;
  };

  const readString = (
    value: unknown,
    key: string,
    maximum = 160,
  ): string | undefined => normalize(safeRead(value, key), maximum);

  const joinText = (values: Array<string | undefined>, maximum: number): string | undefined => {
    const unique = Array.from(new Set(values.filter((value): value is string => Boolean(value))));
    return normalize(unique.join(' '), maximum);
  };

  const period = (start: string | undefined, end: string | undefined): string | undefined => {
    if (start && end) {
      return `${start} - ${end}`.slice(0, 160);
    }
    return start ?? end;
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

  const visibleRoots = (): Array<{ element: Element; root: VueResumeRoot }> => {
    const selected: Array<{ element: Element; root: VueResumeRoot }> = [];
    for (const [selector, root] of roots) {
      const matches = Array.from(document.querySelectorAll(selector)).slice(0, maxElements);
      for (const element of matches) {
        if (isVisible(element)) {
          selected.push({ element, root });
        }
      }
    }
    return selected.slice(0, 10);
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

  const vueHandles = (
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
        // Ignore page-owned getters and keep the search inside the fixed bound.
      }
    }
    return handles;
  };

  const resumeInfoFor = (generation: VueGeneration, instance: unknown): unknown => {
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

  const boundedArray = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    try {
      return value.slice(0, maxItems);
    } catch {
      return [];
    }
  };

  const mapWork = (value: unknown): WorkExperience[] => boundedArray(value).flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const responsibility = readString(item, 'responsibility', 2_000);
    const workContent = readString(item, 'workContent', 2_000);
    const fullDescription = joinText([responsibility, workContent], 2_000);
    const mapped: WorkExperience = {};
    const company = readString(item, 'company');
    const title = readString(item, 'positionName');
    const itemPeriod = period(
      readString(item, 'startYearMonStr'),
      readString(item, 'endYearMonStr'),
    );
    if (company) mapped.company = company;
    if (title) mapped.title = title;
    if (itemPeriod) mapped.period = itemPeriod;
    if (fullDescription) {
      mapped.description = fullDescription.slice(0, 500);
      mapped.raw_text = fullDescription;
    }
    return Object.keys(mapped).length > 0 ? [mapped] : [];
  });

  const mapEducation = (value: unknown): EducationExperience[] => (
    boundedArray(value).flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const mapped: EducationExperience = {};
      const school = readString(item, 'school');
      const degree = readString(item, 'degreeName');
      const major = readString(item, 'major');
      const itemPeriod = period(
        readString(item, 'startDateDesc'),
        readString(item, 'endDateDesc'),
      );
      const rawText = readString(item, 'experienceDesc', 2_000);
      if (school) mapped.school = school;
      if (degree) mapped.degree = degree;
      if (major) mapped.major = major;
      if (itemPeriod) mapped.period = itemPeriod;
      if (rawText) mapped.raw_text = rawText;
      return Object.keys(mapped).length > 0 ? [mapped] : [];
    })
  );

  const mapProjects = (value: unknown): ProjectExperience[] => (
    boundedArray(value).flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const description = readString(item, 'description', 2_000);
      const performance = readString(item, 'performance', 2_000);
      const fullDescription = joinText([description, performance], 2_000);
      const mapped: ProjectExperience = {};
      const name = readString(item, 'name');
      const role = readString(item, 'roleName');
      const itemPeriod = period(
        readString(item, 'startDateDesc'),
        readString(item, 'endDateDesc'),
      );
      if (name) mapped.name = name;
      if (role) mapped.role = role;
      if (itemPeriod) mapped.period = itemPeriod;
      if (fullDescription) {
        mapped.description = fullDescription.slice(0, 500);
        mapped.raw_text = fullDescription;
      }
      return Object.keys(mapped).length > 0 ? [mapped] : [];
    })
  );

  const mapSkills = (value: unknown): string[] => {
    const skills = new Set<string>();
    for (const item of boundedArray(value)) {
      const skill = normalize(item) ?? readString(item, 'name');
      if (skill) {
        skills.add(skill);
      }
    }
    return Array.from(skills).slice(0, maxItems);
  };

  const experienceYears = (value: unknown): number | undefined => {
    if (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 80) {
      return Number(value);
    }
    const text = normalize(value);
    if (!text) {
      return undefined;
    }
    if (/(?:应届|无经验)/.test(text)) {
      return 0;
    }
    const match = text.match(/(?:^|\D)([0-9]{1,2})(?:\D|$)/);
    const parsed = match ? Number(match[1]) : Number.NaN;
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 80 ? parsed : undefined;
  };

  const mapProfile = (resumeInfo: Record<string, unknown>): CandidateProfile => {
    const profile: CandidateProfile = {
      education: mapEducation(safeRead(resumeInfo, 'geekEduExpList')),
      work_experiences: mapWork(safeRead(resumeInfo, 'geekWorkExpList')),
      project_experiences: mapProjects(safeRead(resumeInfo, 'geekProjExpList')),
      skills: mapSkills(safeRead(resumeInfo, 'skillTagList')),
    };
    const baseInfo = safeRead(resumeInfo, 'geekBaseInfo');
    const displayName = readString(baseInfo, 'name');
    const currentTitle = readString(baseInfo, 'positionName');
    const location = readString(baseInfo, 'cityName');
    const years = experienceYears(safeRead(baseInfo, 'workYear'));
    const expectInfo = safeRead(baseInfo, 'expectInfo');
    const expectedPosition = readString(expectInfo, 'position');
    const expectedCity = readString(expectInfo, 'cityName');
    const summary = normalize(safeRead(resumeInfo, 'geekDesc'), 500);
    if (displayName) profile.display_name = displayName;
    if (currentTitle) profile.current_title = currentTitle;
    if (location) profile.location = location;
    if (years !== undefined) profile.experience_years = years;
    if (expectedPosition) profile.expected_position = expectedPosition;
    if (expectedCity) profile.expected_city = expectedCity;
    if (summary) profile.summary = summary;
    return profile;
  };

  const capabilityFor = (
    root: VueResumeRoot,
    generation: VueGeneration,
    resumeInfo: Record<string, unknown>,
  ): VueResumeCapability => {
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
        arrayLengths[key] = Math.min(value.length, maxItems);
      }
    }
    return {
      root,
      vue_generation: generation,
      resume_object: 'resumeInfo',
      allowed_keys: presentKeys,
      array_lengths: arrayLengths,
    };
  };

  const schemaForRecord = (record: Record<string, unknown>): VueResumeSchemaField[] => {
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(record);
    } catch {
      return [];
    }

    const schema: VueResumeSchemaField[] = [];
    for (const key of Object.keys(descriptors)) {
      if (schema.length >= maxSchemaFields) {
        break;
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !schemaKeyFormat.test(key)) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        schema.push({ key, type: 'other' });
        continue;
      }

      const value = descriptor.value;
      if (Array.isArray(value)) {
        let arrayLength = 0;
        try {
          const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
          if (Number.isInteger(length) && length >= 0) {
            arrayLength = Math.min(length, maxItems);
          }
        } catch {
          // Keep a safe zero length when a page-owned proxy blocks the descriptor.
        }
        schema.push({ key, type: 'array', array_length: arrayLength });
        continue;
      }
      if (value === null) {
        schema.push({ key, type: 'null' });
        continue;
      }

      const valueType = typeof value;
      if (valueType === 'object'
        || valueType === 'string'
        || valueType === 'number'
        || valueType === 'boolean'
        || valueType === 'undefined') {
        schema.push({ key, type: valueType });
      } else {
        schema.push({ key, type: 'other' });
      }
    }
    return schema;
  };

  const nestedSchemaFor = (
    resumeInfo: Record<string, unknown>,
  ): VueResumeNestedSchemaField[] => {
    const detail = safeRead(resumeInfo, 'geekDetailInfo');
    if (!isRecord(detail)) {
      return [];
    }
    return schemaForRecord(detail).map((field) => ({
      container: 'geekDetailInfo',
      ...field,
    }));
  };

  const profileScore = (profile: CandidateProfile): number => {
    const scalarCount = [
      profile.display_name,
      profile.current_title,
      profile.location,
      profile.expected_position,
      profile.expected_city,
      profile.summary,
      profile.experience_years,
    ].filter((value) => value !== undefined).length;
    return scalarCount
      + (profile.work_experiences.length * 100)
      + (profile.education.length * 100)
      + (profile.project_experiences.length * 100)
      + (profile.skills.length * 10);
  };

  const selectedRoots = visibleRoots();
  if (selectedRoots.length === 0) {
    return { status: 'vue-root-not-found' };
  }

  type ReadyProbe = Extract<VueResumeProfileFrameProbe, { status: 'ready' }>;
  const ready: Array<{ probe: ReadyProbe; resumeInfo: Record<string, unknown> }> = [];
  let firstVueHandle: { root: VueResumeRoot; generation: VueGeneration } | undefined;
  for (const selectedRoot of selectedRoots) {
    for (const handle of vueHandles(selectedRoot.element)) {
      firstVueHandle ??= { root: selectedRoot.root, generation: handle.generation };
      const resumeInfo = resumeInfoFor(handle.generation, handle.instance);
      if (!isRecord(resumeInfo)) {
        continue;
      }
      ready.push({
        probe: {
          status: 'ready',
          capability: capabilityFor(selectedRoot.root, handle.generation, resumeInfo),
          profile: mapProfile(resumeInfo),
          schema: schemaForRecord(resumeInfo),
          nested_schema: [],
        },
        resumeInfo,
      });
    }
  }

  ready.sort((left, right) => profileScore(right.probe.profile) - profileScore(left.probe.profile));
  if (ready.length > 0) {
    return {
      ...ready[0].probe,
      nested_schema: nestedSchemaFor(ready[0].resumeInfo),
    };
  }
  if (firstVueHandle) {
    return {
      status: 'vue-resume-data-unavailable',
      root: firstVueHandle.root,
      vue_generation: firstVueHandle.generation,
    };
  }
  return { status: 'vue-instance-not-found', root: selectedRoots[0].root };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}


const SCHEMA_TYPES: readonly VueResumeSchemaType[] = [
  'array',
  'object',
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'other',
];


function isVueResumeSchema(value: unknown): value is VueResumeSchemaField[] {
  if (!Array.isArray(value) || value.length > 40) {
    return false;
  }
  const seen = new Set<string>();
  for (const field of value) {
    if (!isRecord(field)
      || !hasOnlyKeys(field, ['key', 'type', 'array_length'])
      || typeof field.key !== 'string'
      || !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(field.key)
      || seen.has(field.key)
      || typeof field.type !== 'string'
      || !SCHEMA_TYPES.includes(field.type as VueResumeSchemaType)) {
      return false;
    }
    seen.add(field.key);
    if (field.type === 'array') {
      if (!Number.isInteger(field.array_length)
        || Number(field.array_length) < 0
        || Number(field.array_length) > 50) {
        return false;
      }
    } else if (field.array_length !== undefined) {
      return false;
    }
  }
  return true;
}


function isVueResumeNestedSchema(value: unknown): value is VueResumeNestedSchemaField[] {
  if (!Array.isArray(value) || value.length > 40) {
    return false;
  }
  const seen = new Set<string>();
  for (const field of value) {
    if (!isRecord(field)
      || !hasOnlyKeys(field, ['container', 'key', 'type', 'array_length'])
      || field.container !== 'geekDetailInfo'
      || typeof field.key !== 'string'
      || seen.has(field.key)) {
      return false;
    }
    const schemaField = {
      key: field.key,
      type: field.type,
      ...(field.array_length === undefined ? {} : { array_length: field.array_length }),
    };
    if (!isVueResumeSchema([schemaField])) {
      return false;
    }
    seen.add(field.key);
  }
  return true;
}


export function isVueResumeProfileFrameProbe(
  value: unknown,
): value is VueResumeProfileFrameProbe {
  if (!isRecord(value) || value.status !== 'ready') {
    return isVueResumeFrameProbe(value);
  }
  if (!hasOnlyKeys(value, ['status', 'capability', 'profile', 'schema', 'nested_schema'])
    || !isVueResumeFrameProbe({ status: 'ready', capability: value.capability })
    || !isVueResumeSchema(value.schema)
    || !isVueResumeNestedSchema(value.nested_schema)) {
    return false;
  }

  return isParserSnapshot({
    schema_version: 1,
    parser_version: 'boss-vue-v1',
    page_kind: 'resume_frame',
    status: 'partial',
    captured_at: '2026-08-07T00:00:00.000Z',
    profile: value.profile,
    present_fields: [],
    missing_fields: [],
    warnings: [],
  });
}
