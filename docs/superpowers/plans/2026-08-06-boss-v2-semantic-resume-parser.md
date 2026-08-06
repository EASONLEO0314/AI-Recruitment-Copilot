# BOSS 新版简历语义解析实施计划

> **执行要求：** 必须使用 `superpowers:executing-plans` 按任务逐项实施。所有行为变更先写失败测试，再写最小实现。

**目标：** 在 BOSS 新版简历 DOM 中准确统计工作、教育、项目条目，并为每条记录保留最多 2,000 字符的完整可见原文。

**架构：** 继续沿用 `parseResumeRoot` 入口，只扩展章节和条目识别。统一的可见文本读取放在 DOM 工具层，`raw_text` 的类型、清洗和边界校验放在现有快照契约层，推荐页适配器通过现有调用链获得新版解析能力。

**技术栈：** TypeScript、Chrome Extension Manifest V3、Vitest、Vite。

---

## 文件结构

- `extension/src/contracts.ts`：三类经历增加可选 `raw_text`。
- `extension/src/validation.ts`：允许并限制 `raw_text` 为最多 2,000 字符。
- `extension/src/parser/snapshot.ts`：清洗并截断 `raw_text`。
- `extension/src/parser/snapshot.test.ts`：覆盖契约、清洗和越界拒绝。
- `extension/src/parser/dom.ts`：增加只汇总可见文本节点的函数。
- `extension/src/parser/dom.test.ts`：验证隐藏内容和非展示节点不会进入原文。
- `extension/src/parser/adapters/resume.ts`：识别新版章节、条目并写入 `raw_text`。
- `extension/src/parser/adapters/recommend.test.ts`：用现场结构做端到端回归测试。

## 任务 1：扩展经历原文数据契约

**文件：**

- 修改：`extension/src/parser/snapshot.test.ts`
- 修改：`extension/src/contracts.ts`
- 修改：`extension/src/validation.ts`
- 修改：`extension/src/parser/snapshot.ts`

- [ ] **步骤 1：先写失败测试**

在快照清洗测试中加入三类 `raw_text`：

```ts
education: [{ school: '  示例大学 ', raw_text: ' 示例大学\n计算机 本科 ' }],
work_experiences: [{ company: ' 示例公司 ', raw_text: ` ${'工'.repeat(2_010)} ` }],
project_experiences: [{ name: ' 匿名项目 ', raw_text: ' 匿名项目\n负责数据分析 ' }],
```

加入断言：

```ts
expect(snapshot.profile).toMatchObject({
  education: [{ school: '示例大学', raw_text: '示例大学 计算机 本科' }],
  work_experiences: [{ company: '示例公司', raw_text: '工'.repeat(2_000) }],
  project_experiences: [{ name: '匿名项目', raw_text: '匿名项目 负责数据分析' }],
});
expect(isParserSnapshot(snapshot)).toBe(true);
```

在严格校验测试中加入：

```ts
expect(isParserSnapshot({
  ...valid,
  profile: {
    ...valid.profile,
    education: [{ raw_text: 'x'.repeat(2_001) }],
  },
})).toBe(false);
```

- [ ] **步骤 2：验证测试按预期失败**

运行：

```powershell
npm.cmd run test --workspace extension -- src/parser/snapshot.test.ts --run
```

预期：新增断言失败，因为 `raw_text` 尚未被保留。

- [ ] **步骤 3：实现最小契约**

在 `EducationExperience`、`WorkExperience`、`ProjectExperience` 中加入：

```ts
raw_text?: string;
```

在 `validation.ts` 中改为：

```ts
const EDUCATION_KEYS = ['school', 'degree', 'major', 'period', 'raw_text'] as const;
const WORK_KEYS = ['company', 'title', 'period', 'description', 'raw_text'] as const;
const PROJECT_KEYS = ['name', 'role', 'period', 'description', 'raw_text'] as const;
```

三个经历校验器均增加：

```ts
&& isOptionalSafeString(value, 'raw_text', 2_000)
```

在 `snapshot.ts` 定义并用于三个清洗器：

```ts
export const RESUME_ITEM_RAW_TEXT_MAX_LENGTH = 2_000;

setNormalizedString(
  sanitized,
  'raw_text',
  item.raw_text,
  RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
);
```

- [ ] **步骤 4：验证任务 1**

```powershell
npm.cmd run test --workspace extension -- src/parser/snapshot.test.ts --run
npm.cmd run typecheck:extension
```

预期：测试通过，类型检查退出码为 0。

- [ ] **步骤 5：提交任务 1**

```powershell
git add -- extension/src/contracts.ts extension/src/validation.ts extension/src/parser/snapshot.ts extension/src/parser/snapshot.test.ts
git commit -m "feat: preserve raw resume item text"
```

## 任务 2：增加可见文本读取工具

**文件：**

- 创建：`extension/src/parser/dom.test.ts`
- 修改：`extension/src/parser/dom.ts`

- [ ] **步骤 1：先写失败测试**

创建 `dom.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { visibleText } from './dom';

describe('visibleText', () => {
  beforeEach(() => document.body.replaceChildren());

  it('joins only visible rendered text nodes', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <article class="resume-item-detail">
        示例公司 <span>平台工程师</span>
        <span aria-hidden="true">隐藏职位</span>
        <span hidden>隐藏公司</span>
        <script>隐藏脚本</script>
        <style>.secret { color: red; }</style>
        <p>负责\n数据平台</p>
      </article>`);
    const item = document.querySelector('.resume-item-detail');
    if (!(item instanceof Element)) throw new Error('fixture missing');
    expect(visibleText(item, 2_000)).toBe('示例公司 平台工程师 负责 数据平台');
  });
});
```

- [ ] **步骤 2：验证测试按预期失败**

```powershell
npm.cmd run test --workspace extension -- src/parser/dom.test.ts --run
```

预期：因 `visibleText` 尚未导出而失败。

- [ ] **步骤 3：实现可见文本遍历**

在 `dom.ts` 增加：

```ts
const NON_RENDERED_TEXT_CONTAINERS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

export function visibleText(root: Element, maxLength = 500): string {
  const parts: string[] = [];
  function visit(node: Node): void {
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (parent && !isHidden(parent)) {
        const value = normalizeText(node.textContent, maxLength + 1);
        if (value) parts.push(value);
      }
      return;
    }
    if (!(node instanceof Element)
      || isHidden(node)
      || NON_RENDERED_TEXT_CONTAINERS.has(node.tagName)) return;
    for (const child of node.childNodes) visit(child);
  }
  visit(root);
  return normalizeText(parts.join(' '), maxLength);
}
```

- [ ] **步骤 4：验证并提交任务 2**

```powershell
npm.cmd run test --workspace extension -- src/parser/dom.test.ts --run
git add -- extension/src/parser/dom.ts extension/src/parser/dom.test.ts
git commit -m "feat: read visible resume item text"
```

预期：测试通过，提交只包含上述两个文件。

## 任务 3：解析 BOSS 新版语义章节

**文件：**

- 修改：`extension/src/parser/adapters/recommend.test.ts`
- 修改：`extension/src/parser/adapters/resume.ts`

- [ ] **步骤 1：先写新版结构失败测试**

在 `recommend.test.ts` 增加包含以下结构的夹具：

```html
<main class="lib-standard-resume wasm-resume-layout">
  <div class="resume-detail-wrap">
    <section class="resume-simple-box">
      <h3 class="title">工作经历</h3>
      <article class="resume-item-detail">示例科技 平台工程师 2022-2026</article>
      <article class="resume-item-detail">示例网络 数据工程师 2020-2022</article>
      <article class="resume-item-detail" hidden>隐藏工作</article>
    </section>
    <section class="resume-simple-box education">
      <h3 class="title">教育经历</h3>
      <article class="resume-item-detail">示例大学 计算机 本科 2016-2020</article>
    </section>
    <section class="resume-simple-box">
      <h3 class="title">项目经历</h3>
      <article class="resume-item-detail">匿名项目 负责核心模块</article>
    </section>
    <section class="resume-simple-box">
      <h3 class="title">个人优势</h3>
      <article class="resume-item-detail">不应归入经历</article>
    </section>
  </div>
</main>
```

断言：工作 2 条、教育 1 条、项目 1 条；每条只有正确的 `raw_text`；隐藏文本和个人优势均不进入快照；警告包含 `resume-section-kind-unknown`；`expectNoPageOperations()` 通过。

再增加 2,010 字符条目的测试，断言保存 2,000 字符并包含 `resume-item-raw-text-truncated`。

- [ ] **步骤 2：验证测试按预期失败**

```powershell
npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts --run
```

预期：新增测试返回空经历或 `unsupported`，断言失败。

- [ ] **步骤 3：扩展章节和条目结构**

将 `.resume-simple-box` 加入 `SECTION_ROOTS`，将 `.resume-item-detail` 同时加入 `ITEM_ROOTS` 和 `ITEM_MATCH_SELECTOR`。增加：

```ts
type SectionKind = 'work' | 'education' | 'project';

function sectionKind(section: Element, headings: string[]): SectionKind | undefined {
  if (section.matches('.geek-work-experience-wrap')) return 'work';
  if (section.matches('.geek-education-experience-wrap, .resume-simple-box.education')) {
    return 'education';
  }
  if (headings.some((heading) => WORK_HEADINGS.has(heading))) return 'work';
  if (headings.some((heading) => EDUCATION_HEADINGS.has(heading))) return 'education';
  if (headings.some((heading) => PROJECT_HEADINGS.has(heading))) return 'project';
  return undefined;
}
```

- [ ] **步骤 4：读取原文并产生受控警告**

从 `dom.ts` 导入 `visibleText`，从 `snapshot.ts` 导入上限常量。增加：

```ts
function readRawItemText(item: Element): { rawText?: string; truncated: boolean } {
  const value = visibleText(item, RESUME_ITEM_RAW_TEXT_MAX_LENGTH + 1);
  if (!value) return { truncated: false };
  return {
    rawText: value.slice(0, RESUME_ITEM_RAW_TEXT_MAX_LENGTH),
    truncated: value.length > RESUME_ITEM_RAW_TEXT_MAX_LENGTH,
  };
}
```

三个章节解析函数为每条记录加入 `raw_text`，并向 `parseResumeRoot` 返回是否发生截断。无法分类但包含可见 `.resume-item-detail` 的 `.resume-simple-box` 只设置 `resume-section-kind-unknown`，不进入任何数组。截断只加入一次 `resume-item-raw-text-truncated`。旧版结构化字段保留原逻辑。

- [ ] **步骤 5：验证并提交任务 3**

```powershell
npm.cmd run test --workspace extension -- src/parser/dom.test.ts src/parser/snapshot.test.ts src/parser/adapters/resume.test.ts src/parser/adapters/recommend.test.ts --run
git add -- extension/src/parser/adapters/resume.ts extension/src/parser/adapters/recommend.test.ts
git commit -m "feat: parse semantic BOSS resume sections"
```

预期：定点测试全部通过，提交只包含解析器和端到端测试。

## 任务 4：完整验证、同步和代码 Review

- [ ] **步骤 1：运行完整验证**

```powershell
npm.cmd run test:extension
npm.cmd run typecheck:extension
npm.cmd run build:extension
```

预期：全部退出码为 0，测试无失败，Vite 构建成功。

- [ ] **步骤 2：运行被动读取安全扫描**

```powershell
rg -n --glob '!*.test.ts' --glob '!*.test.tsx' 'chrome\.debugger|fetch\(|\.click\(|\.focus\(|scrollTo\(|location\.(assign|replace|reload)|innerHTML|outerHTML|document\.cookie|localStorage|sessionStorage|console\.(log|debug|info)' extension/src/parser extension/src/content.tsx
```

预期：无匹配；`rg` 退出码 1 表示未发现禁用行为。

- [ ] **步骤 3：同步 Chrome 加载目录**

将工作树 `extension/dist` 中的 `content.js`、`background.js`、`manifest.json` 精确复制到主目录的 `extension/dist`，并用 `Get-FileHash -Algorithm SHA256` 验证三组哈希一致。不得复制、删除或暂存 `extension/dist.crx` 与 `extension/dist.pem`。

- [ ] **步骤 4：执行代码 Review**

使用 `code-review` 技能检查本轮代码提交相对设计提交 `db74c00` 的差异，重点检查三层长度上限一致、隐藏文本隔离、条目不重复、未知章节不误归类、旧版解析无回归、无主动页面操作或正文日志。如发现问题，先增加失败测试再最小修复，并重新运行任务 4 的完整验证。

- [ ] **步骤 5：检查最终状态**

```powershell
git diff --check
git status --short --branch
git log -5 --oneline
```

预期：源代码无未提交修改；只允许保留未跟踪的 `extension/dist.crx` 和 `extension/dist.pem`。
