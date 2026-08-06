import { beforeEach, describe, expect, it } from 'vitest';

import { visibleText } from './dom';


describe('visibleText', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('joins only visible rendered text nodes', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <article class="resume-item-detail">
        示例公司
        <span>平台工程师</span>
        <span aria-hidden="true">隐藏职位</span>
        <span hidden>隐藏公司</span>
        <script>隐藏脚本</script>
        <style>.secret { color: red; }</style>
        <p>负责\n数据平台</p>
      </article>`);

    const item = document.querySelector('.resume-item-detail');
    if (!(item instanceof Element)) {
      throw new Error('fixture missing');
    }

    expect(visibleText(item, 2_000)).toBe(
      '示例公司 平台工程师 负责 数据平台',
    );
  });

  it('ignores text hidden by CSS on the element or an ancestor', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <style>
        .css-hidden { display: none; }
        .css-invisible { visibility: hidden; }
      </style>
      <article class="resume-item-detail">
        可见内容
        <span class="css-hidden">CSS 隐藏内容</span>
        <span class="css-invisible"><b>CSS 隐藏后代</b></span>
      </article>`);

    const item = document.querySelector('.resume-item-detail');
    if (!(item instanceof Element)) {
      throw new Error('fixture missing');
    }

    expect(visibleText(item, 2_000)).toBe('可见内容');
  });

  it('keeps a visible child when a hidden overlay ancestor is overridden', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div style="visibility: hidden">
        <article class="resume-item-detail" style="visibility: visible">
          弹层内可见简历
        </article>
      </div>`);

    const item = document.querySelector('.resume-item-detail');
    if (!(item instanceof Element)) {
      throw new Error('fixture missing');
    }

    expect(visibleText(item, 2_000)).toBe('弹层内可见简历');
  });
});
