import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractBossVisibleSkillTags } from './visibleSkillTags';


function markVisible(element: Element): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: 500,
    height: 24,
    left: 0,
    right: 120,
    top: 0,
    width: 120,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}


function markTreeVisible(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    markVisible(element);
  }
}


describe('visible BOSS skill tag extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts high-confidence visible tag classes and filters profile basics', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend">
        <div class="profile-tags">
          <span class="boss-tag">前端</span>
          <span class="boss-tag">优势</span>
          <span class="boss-tag">AI全栈开发</span>
          <span class="boss-tag">3-5年经验</span>
          <span class="boss-tag">本科</span>
          <span class="boss-tag">微服务开发</span>
          <span class="boss-tag">系统架构设计</span>
        </div>
      </section>`;
    markTreeVisible(document);

    expect(extractBossVisibleSkillTags()).toEqual([
      '前端',
      'AI全栈开发',
      '微服务开发',
      '系统架构设计',
    ]);
  });

  it('ignores BOSS global chrome and scans only candidate resume containers', () => {
    document.body.innerHTML = `
      <header class="boss-top-banner">
        <span class="boss-tag">44</span>
        <span class="boss-tag">新</span>
        <span class="boss-tag">招聘规范</span>
        <span class="boss-tag">我的客服</span>
        <span class="boss-tag">面试</span>
        <span class="boss-tag">招聘数据</span>
        <span class="boss-tag">账号权益</span>
        <span class="boss-tag">升级VIP</span>
      </header>
      <aside class="boss-side-banner">
        <span class="boss-tag">首充礼</span>
        <span class="boss-tag">立即下载</span>
      </aside>
      <section class="dialog-lib-resume">
        <div class="resume-basic">
          <span class="boss-tag">全栈开发工程师 - 北京 10-11K</span>
          <span class="boss-tag">计算机专业</span>
          <span class="boss-tag">MySQL</span>
          <span class="boss-tag">微服务开发</span>
          <span class="boss-tag">系统联调</span>
        </div>
      </section>`;
    markTreeVisible(document);

    expect(extractBossVisibleSkillTags()).toEqual([
      'MySQL',
      '微服务开发',
      '系统联调',
    ]);
  });

  it('ignores the extension shadow UI while scanning the page', () => {
    document.body.innerHTML = `
      <section class="lib-resume-recommend">
        <span class="boss-tag">Python</span>
      </section>
      <div id="ai-recruitment-copilot-root"></div>`;
    const host = document.getElementById('ai-recruitment-copilot-root');
    const shadow = host?.attachShadow({ mode: 'open' });
    shadow?.append(document.createRange().createContextualFragment(`
      <div class="arc-reading__skills">
        <span class="arc-reading__badge">不得读取插件技能</span>
      </div>`));
    markTreeVisible(document);
    if (shadow) {
      markTreeVisible(shadow);
    }

    expect(extractBossVisibleSkillTags()).toEqual(['Python']);
  });
});
