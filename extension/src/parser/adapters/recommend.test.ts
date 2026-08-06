import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findRecommendObservationRoot, parseRecommendFrame } from './recommend';


const capturedAt = new Date('2026-07-29T02:00:00.000Z');

let clickSpy: ReturnType<typeof vi.spyOn>;
let focusSpy: ReturnType<typeof vi.spyOn>;
let scrollSpy: ReturnType<typeof vi.spyOn>;


function expectNoPageOperations(): void {
  expect(clickSpy).not.toHaveBeenCalled();
  expect(focusSpy).not.toHaveBeenCalled();
  expect(scrollSpy).not.toHaveBeenCalled();
}


describe('recommend frame adapter', () => {
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

  it('reads only the active rendered candidate card', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="card-list">
        <article class="candidate-card-wrap">
          <span class="name">候选人甲</span>
          <div class="base-info"><span>杭州</span><span>9年</span></div>
          <div class="tags-wrap"><span class="tag-item">Java</span></div>
        </article>
        <article class="candidate-card-wrap active">
          <div class="name-wrap"><span class="name">候选人乙</span></div>
          <div class="base-info">
            <span>上海</span><span>3 年经验</span><span>本科</span>
          </div>
          <div class="expect-wrap"><span class="content">AI 工程师</span></div>
          <div class="geek-desc"><span class="content">具备模型工程经验</span></div>
          <div class="tags-wrap"><span class="tag-item">TypeScript</span></div>
        </article>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.page_kind).toBe('recommend_frame');
    expect(snapshot.profile).toMatchObject({
      display_name: '候选人乙',
      experience_years: 3,
      location: '上海',
      expected_position: 'AI 工程师',
      summary: '具备模型工程经验',
      skills: ['TypeScript'],
      education: [],
      work_experiences: [],
      project_experiences: [],
    });
    expect(snapshot.profile?.skills).not.toContain('Java');
    expect(findRecommendObservationRoot(document)).toBe(
      document.querySelector('.card-list'),
    );
    expectNoPageOperations();
  });

  it('reads the visible modern resume dialog before ambiguous list cards', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main class="recommend-wrap">
        <div class="candidate-recommend">
          <article class="candidate-card-wrap"><span class="name">候选人甲</span></article>
          <article class="candidate-card-wrap"><span class="name">候选人乙</span></article>
        </div>
        <div class="dialog-lib-resume">
          <div class="lib-standard-resume">
            <div class="resume-layout-wrap">
              <h1 class="resume-name">候选人丙</h1>
              <div class="base-info"><span>北京</span><span>4 年经验</span></div>
              <p class="candidate-advantage">擅长匿名示例业务</p>
              <section class="resume-item">
                <h2 class="section-title">工作经历</h2>
                <article class="history-item">
                  <span class="company-name">示例公司</span>
                  <span class="position-name">产品运营</span>
                  <span class="date-range">2024-2026</span>
                </article>
              </section>
              <span class="skill-label">数据分析</span>
            </div>
          </div>
        </div>
      </main>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.page_kind).toBe('recommend_frame');
    expect(snapshot.profile).toMatchObject({
      display_name: '候选人丙',
      location: '北京',
      experience_years: 4,
      summary: '擅长匿名示例业务',
      work_experiences: [{
        company: '示例公司',
        title: '产品运营',
        period: '2024-2026',
      }],
      skills: ['数据分析'],
    });
    expect(JSON.stringify(snapshot)).not.toContain('候选人甲');
    expect(JSON.stringify(snapshot)).not.toContain('候选人乙');
    expect(findRecommendObservationRoot(document)).toBe(
      document.querySelector('.recommend-wrap'),
    );
    expectNoPageOperations();
  });

  it('reads current BOSS resume-section work and education entries', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="dialog-lib-resume">
        <div class="lib-resume-recommend lib-standard-resume">
          <div class="resume-detail-wrap">
            <aside class="resume-anonymous-geek-card">
              <span class="name">其他推荐候选人</span>
            </aside>
            <div class="resume-right-side">
              <div class="geek-name"><span class="name">候选人丁</span></div>
            </div>
            <div class="anonymous-info-labels">
              <span>上海</span><span>7 年经验</span><span>本科</span>
            </div>
            <section class="resume-section geek-work-experience-wrap">
              <div class="work-wrap">
                <span class="company-name-wrap">示例科技</span>
                <span class="position">高级运营</span>
                <span class="period">2022-2026</span>
                <p class="item-content">负责增长与数据分析</p>
              </div>
              <div class="work-wrap">
                <span class="company-name">示例网络</span>
                <span class="position">产品运营</span>
                <span class="period">2020-2022</span>
              </div>
            </section>
            <section class="resume-section geek-education-experience-wrap">
              <div class="edu-wrap">
                <span class="school-name-wrap">示例大学</span>
                <span class="major">市场营销</span>
                <span class="degree">本科</span>
                <span class="period">2016-2020</span>
              </div>
            </section>
            <div class="geek-desc">擅长从零搭建运营体系</div>
            <span class="skill-tag">数据分析</span>
          </div>
        </div>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.profile).toMatchObject({
      display_name: '候选人丁',
      location: '上海',
      experience_years: 7,
      summary: '擅长从零搭建运营体系',
      work_experiences: [
        {
          company: '示例科技',
          title: '高级运营',
          period: '2022-2026',
          description: '负责增长与数据分析',
        },
        {
          company: '示例网络',
          title: '产品运营',
          period: '2020-2022',
        },
      ],
      education: [{
        school: '示例大学',
        major: '市场营销',
        degree: '本科',
        period: '2016-2020',
      }],
      skills: ['数据分析'],
    });
    expect(JSON.stringify(snapshot)).not.toContain('其他推荐候选人');
    expectNoPageOperations();
  });

  it('reports bounded structure diagnostics instead of a misleading empty profile', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="dialog-lib-resume">
        <div class="lib-standard-resume">
          <div
            id="sensitive-candidate-id"
            data-private="candidate-detail"
            class="wasm-resume-layout resume-middle-wrap tracking-token"
          >
            不得进入诊断的候选人正文
            <iframe class="resume-content-frame"></iframe>
            <div class="shadow-host"></div>
          </div>
        </div>
      </div>`);
    document.querySelector('.shadow-host')?.attachShadow({ mode: 'open' });

    const snapshot = parseRecommendFrame(document, capturedAt);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.status).toBe('unsupported');
    expect(snapshot).not.toHaveProperty('profile');
    expect(snapshot.warnings).toContain('recommend-resume-profile-empty');
    expect(snapshot.warnings).toContain('structure:iframe-count=1');
    expect(snapshot.warnings).toContain('structure:open-shadow-count=1');
    expect(snapshot.warnings.some((warning) => /^structure:element-count=\d+$/.test(warning)))
      .toBe(true);
    expect(snapshot.warnings).toContain('structure:class-count=lib-standard-resume:1');
    expect(snapshot.warnings).toContain('structure:class-count=wasm-resume-layout:1');
    expect(snapshot.warnings).toContain('structure:class-count=resume-middle-wrap:1');
    expect(snapshot.warnings).toContain('structure:class-count=resume-content-frame:1');
    expect(snapshot.warnings).toContain(
      'structure:edge=lib-standard-resume>wasm-resume-layout+resume-middle-wrap',
    );
    expect(snapshot.warnings).toContain(
      'structure:edge=wasm-resume-layout+resume-middle-wrap>resume-content-frame',
    );
    expect(snapshot.warnings.every((warning) => warning.length <= 160)).toBe(true);
    expect(serialized).not.toContain('不得进入诊断的候选人正文');
    expect(serialized).not.toContain('sensitive-candidate-id');
    expect(serialized).not.toContain('candidate-detail');
    expect(serialized).not.toContain('tracking-token');
    expect(serialized).not.toContain('shadow-host');
    expectNoPageOperations();
  });

  it('uses a standalone modern resume root for safe diagnostics', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main class="resume-detail-wrap wasm-resume-layout">
        <iframe class="resume-content-frame"></iframe>
      </main>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.page_kind).toBe('recommend_frame');
    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings).toContain('recommend-resume-profile-empty');
    expect(snapshot.warnings).toContain('structure:iframe-count=1');
    expect(snapshot.warnings).toContain('structure:class-count=resume-detail-wrap:1');
    expect(snapshot.warnings).toContain('structure:class-count=wasm-resume-layout:1');
    expectNoPageOperations();
  });

  it('reports bounded anonymous class counts and nearest structure edges', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main class="lib-standard-resume">
        <div class="resume-detail-wrap">
          <section class="resume-simple-box">
            <article class="resume-item-detail"></article>
            <article class="resume-item-detail education"></article>
          </section>
          <section class="resume-simple-box"></section>
        </div>
      </main>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.warnings).toContain('structure:class-count=resume-simple-box:2');
    expect(snapshot.warnings).toContain('structure:class-count=resume-item-detail:2');
    expect(snapshot.warnings).toContain(
      'structure:edge=resume-detail-wrap>resume-simple-box',
    );
    expect(snapshot.warnings).toContain(
      'structure:edge=resume-simple-box>resume-item-detail+education',
    );
    expect(snapshot.warnings.every((warning) => warning.length <= 160)).toBe(true);
    expectNoPageOperations();
  });

  it('focuses empty-profile diagnostics on resume summary and keeps repeated item classes', () => {
    const noise = Array.from(
      { length: 20 },
      (_, index) => `<div class="resume-noise-${index}"></div>`,
    ).join('');
    document.body.insertAdjacentHTML('beforeend', `
      <main class="lib-standard-resume wasm-resume-layout">
        <div class="resume-layout-wrap">
          <div class="resume-simple-box">
            <div class="resume-item-detail">
              <div class="resume-summary">
                ${noise}
                <section class="project">
                  <article class="resume-label title content timeline-item">
                    不得进入诊断的项目正文一
                  </article>
                  <article class="resume-label title content timeline-item">
                    不得进入诊断的项目正文二
                  </article>
                </section>
                <section class="education">
                  <article class="resume-label title content timeline-item">
                    不得进入诊断的教育正文
                  </article>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>`);

    const snapshot = parseRecommendFrame(document, capturedAt);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings).toContain('structure:class-count=resume-summary:1');
    expect(snapshot.warnings).toContain('structure:class-count=project:1');
    expect(snapshot.warnings).toContain('structure:class-count=education:1');
    expect(snapshot.warnings).toContain('structure:class-count=timeline-item:3');
    expect(snapshot.warnings).toContain('structure:edge=resume-summary>project');
    expect(snapshot.warnings).toContain('structure:edge=project>timeline-item');
    expect(snapshot.warnings).toContain('structure:edge=resume-summary>education');
    expect(snapshot.warnings).toContain('structure:edge=education>timeline-item');
    expect(serialized).not.toContain('lib-standard-resume');
    expect(serialized).not.toContain('resume-simple-box');
    expect(serialized).not.toContain('不得进入诊断');
    expectNoPageOperations();
  });

  it('counts current BOSS semantic sections and preserves each visible item text', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main class="lib-standard-resume wasm-resume-layout">
        <div class="lib-resume-recommend resume-layout-wrap">
          <div class="resume-middle-wrap resume-center-side">
            <div class="resume-detail-wrap">
              <section class="resume-simple-box">
                <h3 class="title">工作经历</h3>
                <article class="resume-item-detail">
                  示例科技 平台工程师 2022-2026
                  <p>负责数据平台建设</p>
                </article>
                <article class="resume-item-detail">
                  示例网络 数据工程师 2020-2022
                </article>
                <article class="resume-item-detail" hidden>隐藏工作</article>
              </section>
              <section class="resume-simple-box education">
                <h3 class="title">教育经历</h3>
                <article class="resume-item-detail">
                  示例大学 计算机 本科 2016-2020
                </article>
              </section>
              <section class="resume-simple-box">
                <h3 class="title">项目经历</h3>
                <article class="resume-item-detail">
                  匿名项目 负责核心模块
                </article>
              </section>
              <section class="resume-simple-box">
                <h3 class="title">个人优势</h3>
                <article class="resume-item-detail">不应归入经历</article>
              </section>
            </div>
          </div>
        </div>
      </main>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.profile?.work_experiences).toEqual([
      { raw_text: '示例科技 平台工程师 2022-2026 负责数据平台建设' },
      { raw_text: '示例网络 数据工程师 2020-2022' },
    ]);
    expect(snapshot.profile?.education).toEqual([
      { raw_text: '示例大学 计算机 本科 2016-2020' },
    ]);
    expect(snapshot.profile?.project_experiences).toEqual([
      { raw_text: '匿名项目 负责核心模块' },
    ]);
    expect(snapshot.warnings).toContain('resume-section-kind-unknown');
    expect(JSON.stringify(snapshot)).not.toContain('隐藏工作');
    expect(JSON.stringify(snapshot)).not.toContain('不应归入经历');
    expectNoPageOperations();
  });

  it('bounds current BOSS raw item text and reports truncation', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="resume-detail-wrap">
        <section class="resume-simple-box">
          <h3 class="title">工作经历</h3>
          <article class="resume-item-detail">${'工'.repeat(2_010)}</article>
        </section>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.profile?.work_experiences).toEqual([
      { raw_text: '工'.repeat(2_000) },
    ]);
    expect(snapshot.warnings).toContain('resume-item-raw-text-truncated');
    expectNoPageOperations();
  });

  it('reports ambiguity when several cards exist and none is selected', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="card-list">
        <article class="candidate-card-wrap"><span class="name">候选人甲</span></article>
        <article class="candidate-card-wrap"><span class="name">候选人乙</span></article>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings.slice(0, 2)).toEqual([
      'recommend-active-card-not-found',
      'structure:card-count=2',
    ]);
    expect(snapshot).not.toHaveProperty('profile');
    expectNoPageOperations();
  });

  it('prioritizes bounded candidate structure diagnostics over job and filter noise', () => {
    const extraClasses = Array.from(
      { length: 24 },
      (_, index) => `candidate-item-${index}`,
    ).join(' ');
    document.body.insertAdjacentHTML('beforeend', `
      <nav class="tab-list tab-item job-selecter-wrap ui-dropdown-list">
        <div class="job-list job-item job-mark city-item-active area-item trade-item"></div>
      </nav>
      <main
        id="sensitive-candidate-id"
        data-private="account-detail"
        class="recommend-detail resume-content unsafe@class tracking-token ${extraClasses}"
      >
        <section
          class="candidate-detail work-experience education-experience
            project-experience geek-advantage history-section"
        >
          不得进入诊断的候选人正文
        </section>
      </main>`);

    const snapshot = parseRecommendFrame(document, capturedAt);
    const serializedWarnings = JSON.stringify(snapshot.warnings);

    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings.slice(0, 10)).toEqual([
      'recommend-active-card-not-found',
      'structure:card-count=0',
      'structure:class=recommend-detail',
      'structure:class=resume-content',
      'structure:class=candidate-detail',
      'structure:class=work-experience',
      'structure:class=education-experience',
      'structure:class=project-experience',
      'structure:class=geek-advantage',
      'structure:class=history-section',
    ]);
    expect(snapshot.warnings).toHaveLength(20);
    expect(snapshot.warnings.every((warning) => warning.length <= 160)).toBe(true);
    expect(serializedWarnings).toContain('structure:class=work-experience');
    expect(serializedWarnings).toContain('structure:class=education-experience');
    expect(serializedWarnings).toContain('structure:class=project-experience');
    expect(serializedWarnings).toContain('structure:class=geek-advantage');
    expect(serializedWarnings).not.toContain('structure:class=tab-list');
    expect(serializedWarnings).not.toContain('structure:class=job-item');
    expect(serializedWarnings).not.toContain('structure:class=city-item-active');
    expect(serializedWarnings).not.toContain('structure:class=area-item');
    expect(serializedWarnings).not.toContain('structure:class=trade-item');
    expect(serializedWarnings).not.toContain('候选人正文');
    expect(serializedWarnings).not.toContain('sensitive-candidate-id');
    expect(serializedWarnings).not.toContain('account-detail');
    expect(serializedWarnings).not.toContain('unsafe@class');
    expect(serializedWarnings).not.toContain('tracking-token');
    expectNoPageOperations();
  });

  it('uses the only card without requiring an active marker', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="geek-list-wrap">
        <div class="geek-list">
          <article class="geek-card" aria-selected="false">
            <span class="name">候选人丙</span>
            <div class="base-info"><span>4年经验</span><span>硕士</span></div>
            <div class="operate">
              <div class="labels"><span class="label">Go</span></div>
            </div>
          </article>
        </div>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.profile?.display_name).toBe('候选人丙');
    expect(snapshot.profile?.experience_years).toBe(4);
    expect(snapshot.profile?.location).toBeUndefined();
    expect(snapshot.profile?.skills).toEqual(['Go']);
    expectNoPageOperations();
  });

  it('uses a later visible field when an earlier same-selector match is hidden', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="card-list">
        <article class="candidate-card-wrap">
          <span class="name" hidden>隐藏姓名</span>
          <span class="name">候选人可见</span>
        </article>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.profile?.display_name).toBe('候选人可见');
    expect(JSON.stringify(snapshot)).not.toContain('隐藏姓名');
    expectNoPageOperations();
  });

  it('ignores hidden candidate fields', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="card-list">
        <article class="card-item active">
          <span class="name">候选人丁</span>
          <div class="base-info">
            <span aria-hidden="true">12年</span><span>深圳</span><span>2年</span>
          </div>
          <div class="tags-wrap" hidden><span class="tag-item">隐藏技能</span></div>
          <div class="tags-wrap"><span class="tag-item">Python</span></div>
        </article>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.profile?.display_name).toBe('候选人丁');
    expect(snapshot.profile?.experience_years).toBe(2);
    expect(snapshot.profile?.skills).toEqual(['Python']);
    expectNoPageOperations();
  });
});
