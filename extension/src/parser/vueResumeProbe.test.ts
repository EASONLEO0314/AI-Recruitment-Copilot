import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractBossVueResumeCapability,
  isVueResumeFrameProbe,
} from './vueResumeProbe';


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
  Object.defineProperty(element, key, {
    configurable: true,
    value,
  });
}


describe('MAIN-world Vue resume capability probe', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns only whitelisted Vue 2 capability metadata', () => {
    document.body.innerHTML = '<section class="lib-resume-recommend"></section>';
    const root = document.querySelector('.lib-resume-recommend') as Element;
    markVisible(root);
    attachProperty(root, '__vue__', {
      resumeInfo: {
        geekBaseInfo: { name: '候选人A' },
        geekWorkExpList: [{ company: '公司A' }, { company: '公司B' }],
        geekEduExpList: [{ school: '学校A' }],
        secretInternalState: ['不得返回'],
      },
    });

    const result = extractBossVueResumeCapability();

    expect(result).toEqual({
      status: 'ready',
      capability: {
        root: 'lib-resume-recommend',
        vue_generation: 'vue2',
        resume_object: 'resumeInfo',
        allowed_keys: ['geekBaseInfo', 'geekWorkExpList', 'geekEduExpList'],
        array_lengths: {
          geekWorkExpList: 2,
          geekEduExpList: 1,
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('候选人A');
    expect(serialized).not.toContain('公司A');
    expect(serialized).not.toContain('secretInternalState');
  });

  it('ignores a hidden stale root and reads the visible root', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend" hidden></section>
      <section class="lib-resume-anonymous"></section>
    `;
    const [hiddenRoot, visibleRoot] = Array.from(document.querySelectorAll('section'));
    markVisible(hiddenRoot);
    markVisible(visibleRoot);
    attachProperty(hiddenRoot, '__vue__', { resumeInfo: { geekWorkExpList: [1, 2, 3] } });
    attachProperty(visibleRoot, '__vue__', { resumeInfo: { geekProjExpList: [1] } });

    expect(extractBossVueResumeCapability()).toEqual({
      status: 'ready',
      capability: {
        root: 'lib-resume-anonymous',
        vue_generation: 'vue2',
        resume_object: 'resumeInfo',
        allowed_keys: ['geekProjExpList'],
        array_lengths: { geekProjExpList: 1 },
      },
    });
  });

  it('reports fixed root and Vue-instance failure states', () => {
    expect(extractBossVueResumeCapability()).toEqual({ status: 'vue-root-not-found' });

    document.body.innerHTML = '<section class="lib-resume-recommend"></section>';
    const root = document.querySelector('section') as Element;
    markVisible(root);

    expect(extractBossVueResumeCapability()).toEqual({
      status: 'vue-instance-not-found',
      root: 'lib-resume-recommend',
    });
  });

  it('recognizes a Vue 3 component but never traverses arbitrary global state', () => {
    document.body.innerHTML = '<section class="lib-resume-recommend"></section>';
    const root = document.querySelector('section') as Element;
    markVisible(root);
    attachProperty(root, '__vueParentComponent', {
      setupState: {
        resumeInfo: {
          geekDesc: '候选人私密自述',
          skillTagList: Array.from({ length: 55 }, () => ({ name: '技能' })),
        },
      },
    });

    expect(extractBossVueResumeCapability()).toEqual({
      status: 'ready',
      capability: {
        root: 'lib-resume-recommend',
        vue_generation: 'vue3',
        resume_object: 'resumeInfo',
        allowed_keys: ['geekDesc', 'skillTagList'],
        array_lengths: { skillTagList: 50 },
      },
    });
  });

  it('reports when a Vue instance has no resumeInfo object', () => {
    document.body.innerHTML = '<section class="lib-resume-recommend"></section>';
    const root = document.querySelector('section') as Element;
    markVisible(root);
    attachProperty(root, '__vue__', { unrelated: true });

    expect(extractBossVueResumeCapability()).toEqual({
      status: 'vue-resume-data-unavailable',
      root: 'lib-resume-recommend',
      vue_generation: 'vue2',
    });
  });

  it('does not stop at an unrelated outer Vue instance', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend">
        <div class="resume-detail"></div>
      </section>
    `;
    const root = document.querySelector('section') as Element;
    const detail = document.querySelector('.resume-detail') as Element;
    markVisible(root);
    attachProperty(root, '__vue__', { unrelated: true });
    attachProperty(detail, '__vue__', {
      resumeInfo: { geekWorkExpList: [1, 2] },
    });

    expect(extractBossVueResumeCapability()).toMatchObject({
      status: 'ready',
      capability: {
        root: 'lib-resume-recommend',
        allowed_keys: ['geekWorkExpList'],
        array_lengths: { geekWorkExpList: 2 },
      },
    });
  });

  it('selects a usable visible root instead of an earlier stale visible root', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend"></section>
      <section class="lib-resume-anonymous"></section>
    `;
    const [staleRoot, usableRoot] = Array.from(document.querySelectorAll('section'));
    markVisible(staleRoot);
    markVisible(usableRoot);
    attachProperty(staleRoot, '__vue__', { unrelated: true });
    attachProperty(usableRoot, '__vue__', {
      resumeInfo: { geekEduExpList: [1] },
    });

    expect(extractBossVueResumeCapability()).toMatchObject({
      status: 'ready',
      capability: {
        root: 'lib-resume-anonymous',
        allowed_keys: ['geekEduExpList'],
      },
    });
  });
});


describe('Vue resume probe validation', () => {
  it('accepts only fixed roots, keys, and bounded array lengths', () => {
    expect(isVueResumeFrameProbe({
      status: 'ready',
      capability: {
        root: 'lib-resume-recommend',
        vue_generation: 'vue2',
        resume_object: 'resumeInfo',
        allowed_keys: ['geekBaseInfo', 'geekWorkExpList'],
        array_lengths: { geekWorkExpList: 2 },
      },
    })).toBe(true);
    expect(isVueResumeFrameProbe({
      status: 'ready',
      capability: {
        root: 'private-root',
        vue_generation: 'vue2',
        resume_object: 'resumeInfo',
        allowed_keys: ['secretInternalState'],
        array_lengths: { secretInternalState: 5000 },
      },
    })).toBe(false);
  });
});
