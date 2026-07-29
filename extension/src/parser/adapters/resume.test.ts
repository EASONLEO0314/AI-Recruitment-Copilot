import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseResumeFrame } from './resume';


const capturedAt = new Date('2026-07-29T02:00:00.000Z');

let clickSpy: ReturnType<typeof vi.spyOn>;
let focusSpy: ReturnType<typeof vi.spyOn>;
let scrollSpy: ReturnType<typeof vi.spyOn>;


function expectNoPageOperations(): void {
  expect(clickSpy).not.toHaveBeenCalled();
  expect(focusSpy).not.toHaveBeenCalled();
  expect(scrollSpy).not.toHaveBeenCalled();
}


describe('resume frame adapter', () => {
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

  it('reads visible structured resume regions without a full-page fallback', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <main class="resume-content">
        <h1 class="resume-name">候选人甲</h1>
        <div class="base-info"><span>北京</span><span>5 年经验</span></div>
        <p class="candidate-advantage">关注可解释系统</p>
        <section class="resume-item">
          <h2 class="section-title">工作经历</h2>
          <article class="history-item">
            <span class="company-name">示例科技</span>
            <span class="position-name">算法工程师</span>
            <span class="date-range">2022-2026</span>
            <p class="description">负责匿名示例项目</p>
          </article>
        </section>
        <section class="resume-item">
          <h2 class="section-title">教育经历</h2>
          <article class="history-item">
            <span class="school-name">示例大学</span>
            <span class="major-name">计算机</span>
            <span class="degree-name">硕士</span>
            <span class="date-range">2019-2022</span>
          </article>
        </section>
        <section class="resume-item">
          <h2 class="section-title">项目经历</h2>
          <article class="history-item">
            <span class="project-name">匿名项目</span>
            <span class="role-name">开发者</span>
          </article>
        </section>
        <div class="skills"><span class="tag-item">Python</span></div>
      </main>`);

    const snapshot = parseResumeFrame(document, capturedAt);

    expect(snapshot.profile).toMatchObject({
      display_name: '候选人甲',
      location: '北京',
      experience_years: 5,
      summary: '关注可解释系统',
      work_experiences: [{
        company: '示例科技',
        title: '算法工程师',
        period: '2022-2026',
        description: '负责匿名示例项目',
      }],
      education: [{
        school: '示例大学',
        degree: '硕士',
        major: '计算机',
        period: '2019-2022',
      }],
      project_experiences: [{
        name: '匿名项目',
        role: '开发者',
      }],
      skills: ['Python'],
    });
    expect(snapshot.warnings).toEqual([]);
    expectNoPageOperations();
  });

  it('returns unsupported when no recognized resume root exists', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="unrelated-page">
        <span class="name">不应读取</span>
        <span class="company-name">不应读取的公司</span>
      </div>`);

    const snapshot = parseResumeFrame(document, capturedAt);

    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings).toEqual(['resume-root-not-found']);
    expect(snapshot).not.toHaveProperty('profile');
    expectNoPageOperations();
  });

  it('warns when recognized sections have no known structured child fields', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="resume-box">
        <h1 class="resume-name">候选人乙</h1>
        <section class="history-section">
          <h2>工作经验</h2>
          <article class="history-item">只能看到一段未知工作结构</article>
        </section>
        <section class="section-item">
          <div class="title">教育背景</div>
          <div class="item-content">只能看到一段未知教育结构</div>
        </section>
        <section class="resume-item">
          <h3>项目经验</h3>
          <div class="experience-item">只能看到一段未知项目结构</div>
        </section>
      </div>`);

    const snapshot = parseResumeFrame(document, capturedAt);

    expect(snapshot.profile?.work_experiences).toEqual([]);
    expect(snapshot.profile?.education).toEqual([]);
    expect(snapshot.profile?.project_experiences).toEqual([]);
    expect(snapshot.warnings).toEqual([
      'work-section-structure-unknown',
      'education-section-structure-unknown',
      'project-section-structure-unknown',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('只能看到一段未知');
    expectNoPageOperations();
  });

  it('ignores hidden header fields, base tokens, skills, and section items', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="geek-resume">
        <h1 class="resume-name" aria-hidden="true">隐藏姓名</h1>
        <h1 class="geek-name">候选人丙</h1>
        <div class="base-info">
          <span hidden>广州</span><span>6年</span><span>本科</span>
        </div>
        <section class="resume-item">
          <h2 class="section-title">工作经历</h2>
          <article class="history-item" hidden>
            <span class="company-name">隐藏公司</span>
          </article>
        </section>
        <div class="skills" hidden><span class="tag-item">隐藏技能</span></div>
        <span class="skill-label">TypeScript</span>
      </div>`);

    const snapshot = parseResumeFrame(document, capturedAt);

    expect(snapshot.profile?.display_name).toBe('候选人丙');
    expect(snapshot.profile?.location).toBeUndefined();
    expect(snapshot.profile?.experience_years).toBe(6);
    expect(snapshot.profile?.skills).toEqual(['TypeScript']);
    expect(snapshot.profile?.work_experiences).toEqual([]);
    expect(snapshot.warnings).toContain('work-section-structure-unknown');
    expectNoPageOperations();
  });
});
