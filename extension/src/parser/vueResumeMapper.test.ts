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
    mountResume({
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
      secretInternalState: { token: '不得读取' },
    });

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
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('privatePhone');
    expect(serialized).not.toContain('secretInternalState');
    expect(serialized).not.toContain('不得读取');
  });

  it('bounds arrays and every string before crossing the MAIN-world boundary', () => {
    mountResume({
      geekBaseInfo: { name: '名'.repeat(170) },
      geekWorkExpList: Array.from({ length: 55 }, (_, index) => ({
        company: `示例公司${index}`,
        workContent: '工'.repeat(2_100),
      })),
      geekDesc: '述'.repeat(510),
      skillTagList: Array.from({ length: 55 }, (_, index) => `技能${index}`),
    });

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
    attachProperty(hiddenRoot, '__vue__', {
      resumeInfo: { geekWorkExpList: [{ company: '隐藏公司' }] },
    });
    attachProperty(sparseRoot, '__vue__', {
      resumeInfo: { geekBaseInfo: { name: '稀疏候选人' } },
    });
    attachProperty(richRoot, '__vueParentComponent', {
      setupState: {
        resumeInfo: {
          geekBaseInfo: { name: '候选人乙' },
          geekWorkExpList: [{ company: '示例公司' }],
          geekEduExpList: [{ school: '示例大学' }],
        },
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
    });
    expect(JSON.stringify(result)).not.toContain('隐藏公司');
    expect(JSON.stringify(result)).not.toContain('稀疏候选人');
  });

  it('does not recurse into circular objects or expose throwing getters', () => {
    const resumeInfo: Record<string, unknown> = {
      geekBaseInfo: { name: '候选人丙' },
      geekWorkExpList: [],
    };
    resumeInfo.circular = resumeInfo;
    Object.defineProperty(resumeInfo.geekBaseInfo, 'privateValue', {
      get: () => { throw new Error('private getter detail'); },
    });
    mountResume(resumeInfo);

    expect(() => extractBossVueResumeProfile()).not.toThrow();
    const result = extractBossVueResumeProfile();
    expect(result).toMatchObject({
      status: 'ready',
      profile: {
        display_name: '候选人丙',
        work_experiences: [],
        education: [],
        project_experiences: [],
        skills: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('private getter detail');
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
  });
});
