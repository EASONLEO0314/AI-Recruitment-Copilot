import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCapabilityWarnings } from './capabilityProbe';


let clickSpy: ReturnType<typeof vi.spyOn>;
let focusSpy: ReturnType<typeof vi.spyOn>;
let scrollSpy: ReturnType<typeof vi.spyOn>;


describe('candidate frame capability probe', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
    focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    scrollSpy = vi.spyOn(window, 'scrollTo');
  });

  afterEach(() => {
    clickSpy.mockRestore();
    focusSpy.mockRestore();
    scrollSpy.mockRestore();
  });

  it('reports public section headings and rendering capabilities without candidate text', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main
        id="private-candidate-id"
        data-private="candidate-record"
        class="lib-standard-resume wasm-resume-layout tracking-token"
      >
        <section class="work-experience">
          <h2 class="section-title">工作经历</h2>
          <article>不得进入诊断的候选人工作正文</article>
        </section>
        <section class="education">
          <div class="title"><span>教育经历</span></div>
          <article>不得进入诊断的候选人教育正文</article>
        </section>
        <p>负责工作经历相关的数据项目，不是栏目标题</p>
        <h2 hidden>项目经历</h2>
        <canvas class="resume-canvas"></canvas>
        <iframe class="resume-frame"></iframe>
        <div class="shadow-host"></div>
      </main>`);
    document.querySelector('.shadow-host')?.attachShadow({ mode: 'open' });

    const warnings = buildCapabilityWarnings(document);
    const serialized = JSON.stringify(warnings);

    expect(warnings.some((warning) => /^probe:visible-elements=\d+$/.test(warning)))
      .toBe(true);
    expect(warnings).toContain('probe:iframe-count=1');
    expect(warnings).toContain('probe:canvas-count=1');
    expect(warnings).toContain('probe:open-shadow-count=1');
    expect(warnings).toContain('probe:wasm-class-count=1');
    expect(warnings).toContain('probe:heading=work:1');
    expect(warnings).toContain('probe:heading=education:1');
    expect(warnings).not.toContain('probe:heading=project:1');
    expect(warnings).toContain(
      'probe:heading-path=work:main.lib-standard-resume.wasm-resume-layout'
        + '>section.work-experience>h2.section-title',
    );
    expect(warnings).toContain(
      'probe:heading-path=education:main.lib-standard-resume.wasm-resume-layout'
        + '>section.education>div.title>span',
    );
    expect(serialized).not.toContain('不得进入诊断');
    expect(serialized).not.toContain('private-candidate-id');
    expect(serialized).not.toContain('candidate-record');
    expect(serialized).not.toContain('tracking-token');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('counts a nested public heading once at its deepest visible node', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <section class="project-experience">
        <h2 class="title"><span>项目经历</span></h2>
      </section>`);

    const warnings = buildCapabilityWarnings(document);

    expect(warnings).toContain('probe:heading=project:1');
    expect(warnings).toContain(
      'probe:heading-path=project:section.project-experience>h2.title>span',
    );
    expect(warnings.filter((warning) => warning.startsWith('probe:heading-path=project:')))
      .toHaveLength(1);
  });

  it('reports multiple bounded skill probe sources in one scan', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main class="lib-standard-resume">
        <div class="resume-basic">
          <span class="name">候选人甲</span>
          <span class="label">Java</span>
          <span class="badge">MySQL</span>
          <span class="label">本科</span>
        </div>
        <div class="ai-preference-content-option"><span class="title">Python</span></div>
        <div class="skill-label">TypeScript</div>
        <div class="tag-item">不得进入诊断的长篇候选人正文内容超过四十个字符用于测试过滤</div>
        <div class="shadow-host"></div>
      </main>`);
    const shadow = document.querySelector('.shadow-host')?.attachShadow({ mode: 'open' });
    shadow?.append(document.createRange().createContextualFragment(`
      <div class="tags-wrap"><span>Docker</span></div>`));

    const warnings = buildCapabilityWarnings(document);
    const serialized = JSON.stringify(warnings);

    expect(warnings).toContain('probe:skill=profile-header:2:Java|MySQL');
    expect(warnings).toContain('probe:skill=shadow-tag:1:Docker');
    expect(warnings).toContain('probe:skill=preference-option:1:Python');
    expect(warnings).toContain('probe:skill=skill-class:1:TypeScript');
    expect(serialized).not.toContain('本科');
    expect(serialized).not.toContain('不得进入诊断');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('does not treat text from a hidden heading child as visible evidence', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <h2><span hidden>工作经历</span></h2>
      <h2 aria-hidden="true">教育经历</h2>`);

    const warnings = buildCapabilityWarnings(document);

    expect(warnings.some((warning) => warning.startsWith('probe:heading='))).toBe(false);
    expect(warnings.some((warning) => warning.startsWith('probe:heading-path='))).toBe(false);
  });
});
