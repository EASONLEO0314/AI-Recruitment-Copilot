import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractBossVueResumeProfile,
  isVueResumeProfileFrameProbe,
} from './vueResumeMapper';


function markVisible(element: Element): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: 500,
    height: 500,
    left: 0,
    right: 400,
    top: 0,
    width: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}


function attachProperty(element: Element, key: string, value: unknown): void {
  Object.defineProperty(element, key, { configurable: true, value });
}


function mountResume(resumeInfo: unknown, vue3 = false): Element {
  document.body.innerHTML = '<section class="lib-resume-recommend"></section>';
  const root = document.querySelector('section') as Element;
  markVisible(root);
  attachProperty(root, vue3 ? '__vueParentComponent' : '__vue__', vue3
    ? { setupState: { resumeInfo } }
    : { resumeInfo });
  return root;
}


describe('MAIN-world Vue resume profile mapper', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('maps only confirmed BOSS paths into CandidateProfile', () => {
    const geekDetailInfo: Record<string, unknown> = {
      professionalSkill: '不得读取技能正文',
      skillItems: Array.from({ length: 55 }, () => '不得读取数组元素'),
    };
    let childAccessorCalls = 0;
    Object.defineProperty(geekDetailInfo, 'childAccessor', {
      enumerable: true,
      get: () => {
        childAccessorCalls += 1;
        throw new Error('不得调用子字段 getter');
      },
    });
    const resumeInfo: Record<string, unknown> = {
      geekBaseInfo: {
        name: ' 候选人甲 ',
        positionName: ' 平台工程师 ',
        workYear: '4年',
        cityName: '上海',
        expectInfo: { position: 'AI 工程师', cityName: '北京' },
        privatePhone: '不得读取',
      },
      geekWorkExpList: [
        {
          company: '示例公司甲',
          positionName: '开发工程师',
          startYearMonStr: '2022.01',
          endYearMonStr: '至今',
          responsibility: '负责平台建设',
          workContent: '数据治理',
          unknown: '不得读取',
        },
        {
          company: '示例公司乙',
          positionName: '实习工程师',
          startYearMonStr: '2021.01',
          endYearMonStr: '2021.12',
          workContent: '工程实践',
        },
      ],
      geekEduExpList: [{
        school: '示例大学',
        major: '计算机',
        degreeName: '硕士',
        startDateDesc: '2019',
        endDateDesc: '2022',
        experienceDesc: '匿名在校经历',
      }],
      geekProjExpList: [{
        name: '匿名项目',
        roleName: '负责人',
        startDateDesc: '2023.01',
        endDateDesc: '2023.12',
        description: '项目说明',
        performance: '项目成果',
      }],
      geekDesc: ' 匿名自我描述 ',
      skillTagList: [{ name: 'TypeScript' }, 'Python', { name: 'TypeScript' }],
      professionalSkillInfo: '不得读取技能内容',
      unknownList: Array.from({ length: 55 }, () => '不得读取数组内容'),
      secretInternalState: { token: '不得读取' },
    };
    let detailAccessorCalls = 0;
    Object.defineProperty(resumeInfo, 'geekDetailInfo', {
      enumerable: true,
      get: () => {
        detailAccessorCalls += 1;
        return geekDetailInfo;
      },
    });
    let otherContainerCalls = 0;
    Object.defineProperty(resumeInfo, 'geekQuestInfoVO', {
      enumerable: true,
      get: () => {
        otherContainerCalls += 1;
        return { privateCandidateValue: '不得读取' };
      },
    });
    Object.defineProperty(resumeInfo, 'bad-key', {
      enumerable: true,
      value: '不得读取非法键内容',
    });
    let accessorCalls = 0;
    Object.defineProperty(resumeInfo, 'accessorField', {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        throw new Error('不得调用 getter');
      },
    });
    mountResume(resumeInfo);

    const result = extractBossVueResumeProfile();

    expect(result).toMatchObject({
      status: 'ready',
      capability: {
        root: 'lib-resume-recommend',
        vue_generation: 'vue2',
        resume_object: 'resumeInfo',
        allowed_keys: [
          'geekBaseInfo',
          'geekWorkExpList',
          'geekProjExpList',
          'geekEduExpList',
          'geekDesc',
          'skillTagList',
        ],
        array_lengths: {
          geekWorkExpList: 2,
          geekProjExpList: 1,
          geekEduExpList: 1,
          skillTagList: 3,
        },
      },
      schema: expect.arrayContaining([
        { key: 'geekBaseInfo', type: 'object' },
        { key: 'professionalSkillInfo', type: 'string' },
        { key: 'unknownList', type: 'array', array_length: 50 },
        { key: 'accessorField', type: 'other' },
      ]),
      nested_schema: expect.arrayContaining([
        {
          container: 'geekDetailInfo',
          key: 'professionalSkill',
          type: 'string',
        },
        {
          container: 'geekDetailInfo',
          key: 'skillItems',
          type: 'array',
          array_length: 50,
        },
        {
          container: 'geekDetailInfo',
          key: 'childAccessor',
          type: 'other',
        },
        {
          container: 'geekBaseInfo',
          key: 'workYear',
          type: 'string',
        },
        {
          container: 'geekWorkExpItem',
          key: 'positionName',
          type: 'string',
        },
      ]),
      profile: {
        display_name: '候选人甲',
        current_title: '平台工程师',
        location: '上海',
        experience_years: 4,
        expected_position: 'AI 工程师',
        expected_city: '北京',
        work_experiences: [
          {
            company: '示例公司甲',
            title: '开发工程师',
            period: '2022.01 - 至今',
            description: '负责平台建设 数据治理',
            raw_text: '负责平台建设 数据治理',
          },
          {
            company: '示例公司乙',
            title: '实习工程师',
            period: '2021.01 - 2021.12',
            description: '工程实践',
            raw_text: '工程实践',
          },
        ],
        education: [{
          school: '示例大学',
          major: '计算机',
          degree: '硕士',
          period: '2019 - 2022',
          raw_text: '匿名在校经历',
        }],
        project_experiences: [{
          name: '匿名项目',
          role: '负责人',
          period: '2023.01 - 2023.12',
          description: '项目说明 项目成果',
          raw_text: '项目说明 项目成果',
        }],
        skills: ['TypeScript', 'Python'],
        summary: '匿名自我描述',
      },
    });
    expect(accessorCalls).toBe(0);
    expect(detailAccessorCalls).toBe(1);
    expect(childAccessorCalls).toBe(0);
    expect(otherContainerCalls).toBe(0);
    if (result.status !== 'ready') {
      return;
    }
    const serializedProfile = JSON.stringify(result.profile);
    const serializedSchema = JSON.stringify(result.schema);
    const serializedNestedSchema = JSON.stringify(result.nested_schema);
    expect(serializedProfile).not.toContain('privatePhone');
    expect(serializedProfile).not.toContain('secretInternalState');
    expect(serializedProfile).not.toContain('不得读取');
    expect(serializedSchema).not.toContain('不得读取');
    expect(serializedSchema).not.toContain('bad-key');
    expect(serializedNestedSchema).not.toContain('privatePhone');
    expect(serializedNestedSchema).not.toContain('不得读取');
  });

  it('bounds arrays and every string before crossing the MAIN-world boundary', () => {
    const resumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '名'.repeat(170) },
      geekWorkExpList: Array.from({ length: 55 }, (_, index) => ({
        company: `示例公司${index}`,
        workContent: '工'.repeat(2_100),
      })),
      geekDesc: '述'.repeat(510),
      skillTagList: Array.from({ length: 55 }, (_, index) => `技能${index}`),
      geekDetailInfo: Object.fromEntries(
        Array.from({ length: 45 }, (_, index) => [
          `nestedSchemaField${index}`,
          `不得读取嵌套值${index}`,
        ]),
      ),
    };
    for (let index = 0; index < 45; index += 1) {
      resumeInfo[`schemaField${index}`] = `不得读取${index}`;
    }
    mountResume(resumeInfo);

    const result = extractBossVueResumeProfile();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') {
      return;
    }
    expect(result.profile.display_name).toHaveLength(160);
    expect(result.profile.work_experiences).toHaveLength(50);
    expect(result.profile.work_experiences[0].description).toHaveLength(500);
    expect(result.profile.work_experiences[0].raw_text).toHaveLength(2_000);
    expect(result.profile.summary).toHaveLength(500);
    expect(result.profile.skills).toHaveLength(50);
    expect(result.capability.array_lengths.geekWorkExpList).toBe(50);
    expect(result.capability.array_lengths.skillTagList).toBe(50);
    expect(result.schema).toHaveLength(40);
    expect(result.nested_schema.length).toBeGreaterThan(40);
    expect(result.nested_schema.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(result.schema)).not.toContain('不得读取');
    expect(JSON.stringify(result.nested_schema)).not.toContain('不得读取');
  });

  it('maps selected geekDetailInfo skill tags and baseInfo work-year aliases', () => {
    const resumeInfo: Record<string, unknown> = {
      geekBaseInfo: {
        name: '候选人丁',
        workYearDesc: '3年',
      },
      geekWorkExpList: [{ company: '示例公司' }],
    };
    Object.defineProperty(resumeInfo, 'geekDetailInfo', {
      enumerable: true,
      get: () => ({
        skillTagList: [
          { name: 'TypeScript' },
          { skillName: 'Python' },
          'SQL',
          { tagName: 'TypeScript' },
        ],
      }),
    });
    mountResume(resumeInfo);

    const result = extractBossVueResumeProfile();

    expect(result).toMatchObject({
      status: 'ready',
      profile: {
        display_name: '候选人丁',
        experience_years: 3,
        skills: ['TypeScript', 'Python', 'SQL'],
      },
      nested_schema: expect.arrayContaining([
        {
          container: 'geekDetailInfo',
          key: 'skillTagList',
          type: 'array',
          array_length: 4,
        },
      ]),
    });
  });

  it('derives experience years from bounded work experience date ranges', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'));
    const resumeInfo: Record<string, unknown> = {
      geekBaseInfo: {
        name: '候选人己',
      },
      geekWorkExpList: [
        {
          company: '示例公司甲',
          startYearMonStr: '2021.07',
          endYearMonStr: '至今',
        },
        {
          company: '示例公司乙',
          startYearMonStr: '2019.03',
          endYearMonStr: '2021.06',
        },
      ],
    };
    mountResume(resumeInfo);

    const result = extractBossVueResumeProfile();

    expect(result).toMatchObject({
      status: 'ready',
      profile: {
        display_name: '候选人己',
        experience_years: 7,
      },
      nested_schema: expect.arrayContaining([
        {
          container: 'geekWorkExpItem',
          key: 'startYearMonStr',
          type: 'string',
        },
        {
          container: 'geekWorkExpItem',
          key: 'endYearMonStr',
          type: 'string',
        },
      ]),
    });
    vi.useRealTimers();
  });

  it('parses delimited professionalSkill text only after selecting the richest resume', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend"></section>
      <section class="lib-resume-anonymous"></section>
    `;
    const [sparseRoot, richRoot] = Array.from(document.querySelectorAll('section'));
    markVisible(sparseRoot);
    markVisible(richRoot);
    let sparseDetailCalls = 0;
    const sparseResumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '稀疏候选人' },
    };
    Object.defineProperty(sparseResumeInfo, 'geekDetailInfo', {
      enumerable: true,
      get: () => {
        sparseDetailCalls += 1;
        return { professionalSkill: '不得读取未选中候选人技能' };
      },
    });
    let richDetailCalls = 0;
    const richResumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '候选人戊' },
      geekWorkExpList: [{ company: '示例公司' }],
    };
    Object.defineProperty(richResumeInfo, 'geekDetailInfo', {
      enumerable: true,
      get: () => {
        richDetailCalls += 1;
        return { professionalSkill: 'React、Node.js、PostgreSQL' };
      },
    });
    attachProperty(sparseRoot, '__vue__', { resumeInfo: sparseResumeInfo });
    attachProperty(richRoot, '__vue__', { resumeInfo: richResumeInfo });

    const result = extractBossVueResumeProfile();

    expect(result).toMatchObject({
      status: 'ready',
      profile: {
        display_name: '候选人戊',
        skills: ['React', 'Node.js', 'PostgreSQL'],
      },
      nested_schema: expect.arrayContaining([
        {
          container: 'geekDetailInfo',
          key: 'professionalSkill',
          type: 'string',
        },
      ]),
    });
    expect(sparseDetailCalls).toBe(0);
    expect(richDetailCalls).toBe(1);
    expect(JSON.stringify(result)).not.toContain('不得读取未选中候选人技能');
  });

  it('ignores hidden stale roots and selects the richest bounded profile', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend" hidden></section>
      <section class="lib-resume-recommend"></section>
      <section class="lib-resume-anonymous"></section>
    `;
    const [hiddenRoot, sparseRoot, richRoot] = Array.from(document.querySelectorAll('section'));
    markVisible(hiddenRoot);
    markVisible(sparseRoot);
    markVisible(richRoot);
    let sparseDetailCalls = 0;
    const sparseResumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '稀疏候选人' },
    };
    Object.defineProperty(sparseResumeInfo, 'geekDetailInfo', {
      enumerable: true,
      get: () => {
        sparseDetailCalls += 1;
        return { privateSkill: '不得读取稀疏候选人技能' };
      },
    });
    let richDetailCalls = 0;
    const richResumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '候选人乙' },
      geekWorkExpList: [{ company: '示例公司' }],
      geekEduExpList: [{ school: '示例大学' }],
    };
    Object.defineProperty(richResumeInfo, 'geekDetailInfo', {
      enumerable: true,
      get: () => {
        richDetailCalls += 1;
        return { selectedSkillField: '不得读取选中候选人技能' };
      },
    });
    attachProperty(hiddenRoot, '__vue__', {
      resumeInfo: { geekWorkExpList: [{ company: '隐藏公司' }] },
    });
    attachProperty(sparseRoot, '__vue__', {
      resumeInfo: sparseResumeInfo,
    });
    attachProperty(richRoot, '__vueParentComponent', {
      setupState: {
        resumeInfo: richResumeInfo,
      },
    });

    const result = extractBossVueResumeProfile();

    expect(result).toMatchObject({
      status: 'ready',
      capability: { root: 'lib-resume-anonymous', vue_generation: 'vue3' },
      profile: {
        display_name: '候选人乙',
        work_experiences: [{ company: '示例公司' }],
        education: [{ school: '示例大学' }],
      },
      nested_schema: expect.arrayContaining([{
        container: 'geekDetailInfo',
        key: 'selectedSkillField',
        type: 'string',
      }]),
    });
    expect(sparseDetailCalls).toBe(0);
    expect(richDetailCalls).toBe(1);
    expect(JSON.stringify(result)).not.toContain('隐藏公司');
    expect(JSON.stringify(result)).not.toContain('稀疏候选人');
    expect(JSON.stringify(result)).not.toContain('不得读取');
  });

  it('does not recurse into circular objects or expose throwing getters', () => {
    const resumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '候选人丙' },
      geekWorkExpList: [],
    };
    resumeInfo.circular = resumeInfo;
    let accessorCalls = 0;
    Object.defineProperty(resumeInfo, 'accessorField', {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        throw new Error('top-level getter detail');
      },
    });
    Object.defineProperty(resumeInfo.geekBaseInfo, 'privateValue', {
      get: () => { throw new Error('private getter detail'); },
    });
    mountResume(resumeInfo);

    expect(() => extractBossVueResumeProfile()).not.toThrow();
    const result = extractBossVueResumeProfile();
    expect(result).toMatchObject({
      status: 'ready',
      schema: expect.arrayContaining([
        { key: 'circular', type: 'object' },
        { key: 'accessorField', type: 'other' },
      ]),
      profile: {
        display_name: '候选人丙',
        work_experiences: [],
        education: [],
        project_experiences: [],
        skills: [],
      },
    });
    expect(accessorCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain('private getter detail');
    expect(JSON.stringify(result)).not.toContain('top-level getter detail');
  });
});


describe('Vue resume profile probe validation', () => {
  it('accepts a bounded profile result and rejects unknown nested fields', () => {
    const valid = {
      status: 'ready',
      capability: {
        root: 'lib-resume-recommend',
        vue_generation: 'vue2',
        resume_object: 'resumeInfo',
        allowed_keys: ['geekBaseInfo'],
        array_lengths: {},
      },
      schema: [{ key: 'geekBaseInfo', type: 'object' }],
      nested_schema: [],
      profile: {
        display_name: '候选人甲',
        education: [],
        work_experiences: [],
        project_experiences: [],
        skills: [],
      },
    };

    expect(isVueResumeProfileFrameProbe(valid)).toBe(true);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      profile: { ...valid.profile, privateToken: 'forbidden' },
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      schema: [{ key: 'privateField', type: 'private-type' }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      schema: [{ key: 'privateField', type: 'string', array_length: 1 }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      schema: [
        { key: 'duplicate', type: 'string' },
        { key: 'duplicate', type: 'string' },
      ],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'unsafeContainer',
        key: 'privateField',
        type: 'string',
      }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'geekBaseInfo',
        key: 'workYearDesc',
        type: 'string',
      }],
    })).toBe(true);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'geekWorkExpItem',
        key: 'startYearMonStr',
        type: 'string',
      }],
    })).toBe(true);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [
        { container: 'geekDetailInfo', key: 'duplicate', type: 'string' },
        { container: 'geekDetailInfo', key: 'duplicate', type: 'string' },
      ],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'geekDetailInfo',
        key: 'bad-key',
        type: 'string',
      }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'geekDetailInfo',
        key: 'privateField',
        type: 'private-type',
      }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'geekDetailInfo',
        key: 'privateList',
        type: 'array',
      }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: [{
        container: 'geekDetailInfo',
        key: 'privateField',
        type: 'string',
        array_length: 1,
      }],
    })).toBe(false);
    expect(isVueResumeProfileFrameProbe({
      ...valid,
      nested_schema: Array.from({ length: 121 }, (_, index) => ({
        container: 'geekDetailInfo',
        key: `field${index}`,
        type: 'string',
      })),
    })).toBe(false);
    const unsafeKey = {
      toString: () => {
        throw new Error('不得调用不可信 key 的 toString');
      },
    };
    const unsafeKeyProbe = {
      ...valid,
      nested_schema: [{
        container: 'geekDetailInfo',
        key: unsafeKey,
        type: 'string',
      }],
    };
    expect(() => isVueResumeProfileFrameProbe(unsafeKeyProbe)).not.toThrow();
    expect(isVueResumeProfileFrameProbe(unsafeKeyProbe)).toBe(false);
  });
});
