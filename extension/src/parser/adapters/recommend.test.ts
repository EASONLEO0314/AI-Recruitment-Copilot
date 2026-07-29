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

  it('reports ambiguity when several cards exist and none is selected', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="card-list">
        <article class="candidate-card-wrap"><span class="name">候选人甲</span></article>
        <article class="candidate-card-wrap"><span class="name">候选人乙</span></article>
      </div>`);

    const snapshot = parseRecommendFrame(document, capturedAt);

    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings).toEqual(['recommend-active-card-not-found']);
    expect(snapshot).not.toHaveProperty('profile');
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
