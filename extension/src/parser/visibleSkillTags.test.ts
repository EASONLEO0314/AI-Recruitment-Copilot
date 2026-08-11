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
          <span class="boss-tag">3个月</span>
          <span class="boss-tag">06 - 2024.09</span>
          <span class="boss-tag">北方民族大学</span>
          <span class="boss-tag">合肥工业大学</span>
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

  it('falls back to technical keywords without keeping school and date tags', () => {
    document.body.innerHTML = `
      <section class="dialog-lib-resume">
        <div class="lib-resume-recommend">
          <div class="resume-detail-wrap">
            <div class="resume-basic">
              <span class="boss-tag">3个月</span>
              <span class="boss-tag">06 - 2024.09</span>
              <span class="boss-tag">北方民族大学</span>
              <span class="boss-tag">合肥工业大学</span>
            </div>
            <section class="resume-section geek-work-experience-wrap">
              <h2>工作经历</h2>
              <p>Java · 产业金融部门</p>
              <p>基于 Redis SET NX + EX 实现 Kafka 消费幂等控制。</p>
              <p>使用 Redis ZSet、ClickHouse 优化 IoT 数据处理链路。</p>
            </section>
          </div>
        </div>
      </section>`;
    markTreeVisible(document);

    expect(extractBossVisibleSkillTags()).toEqual([
      'Java',
      'Redis',
      'Kafka',
      'ClickHouse',
      'IoT',
    ]);
  });

  it('extracts grouped text skills from the resume header block', () => {
    document.body.innerHTML = `
      <section class="dialog-lib-resume">
        <div class="lib-resume-recommend">
          <div class="resume-detail-wrap">
            <div class="resume-header">
              <h1>候选人文本技能</h1>
              <p>23岁 | 本科 | 1年 | 离职-随时到岗</p>
              <div>后端开发</div>
              <p>Java、Spring全家桶、SpringCloud微服务、MyBatis、MySQL优化、Redis、RabbitMQ、Spring AI大模型应用开发</p>
              <div>前端开发</div>
              <p>HTML/CSS/JS、Vue、uni-app跨端开发</p>
              <div>测试校验</div>
              <p>Apifox/Postman接口调试、JMeter压测、Python+Selenium自动化测试、Allure测试报告</p>
              <div>工程&上线部署</div>
              <p>Git版本管理、Maven构建、Linux运维、Docker容器化部署</p>
              <div>一句话总结</div>
              <p>可独立完成前后端编码，依托 Git、Maven 管控工程。</p>
            </div>
            <section class="resume-section geek-work-experience-wrap">
              <h2>工作经历</h2>
              <p>不应从工作正文继续扩散读取</p>
            </section>
          </div>
        </div>
      </section>`;
    markTreeVisible(document);

    expect(extractBossVisibleSkillTags()).toEqual([
      'Java',
      'Spring全家桶',
      'SpringCloud微服务',
      'MyBatis',
      'MySQL优化',
      'Redis',
      'RabbitMQ',
      'Spring AI大模型应用开发',
      'HTML/CSS/JS',
      'Vue',
      'uni-app跨端开发',
      'Apifox/Postman接口调试',
      'JMeter压测',
      'Python+Selenium自动化测试',
      'Allure测试报告',
      'Git版本管理',
      'Maven构建',
      'Linux运维',
      'Docker容器化部署',
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
