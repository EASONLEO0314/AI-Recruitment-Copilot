# 未登录公开职位卡片临时探针实施计划

> **面向代理执行者：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。所有步骤使用复选框跟踪。

**目标：** 在未登录 BOSS 求职首页由用户人工点击“重新读取页面”时，只读首个可见职位卡片并向 Console 输出三个限长字段；完成观察后删除全部临时探针代码，再生成 HR 登录测试构建。

**架构：** 新增一个不依赖 Chrome API 的临时纯 DOM 读取器，并通过 coordinator 的可注入依赖仅接入 top-frame、logged-out、人工 refresh 分支。读取结果不进入候选人快照或 background；未登录人工观察结束后删除模块、测试、调用点和日志前缀，并用完整验证与字符串扫描证明清理完成。

**技术栈：** TypeScript、Chrome Manifest V3 content script、React、Vitest、Testing Library、jsdom、Vite。

---

## 文件结构

- 新建 `extension/src/parser/publicJobProbe.ts`：临时纯 DOM 读取器和严格限长结果类型。
- 新建 `extension/src/parser/publicJobProbe.test.ts`：临时 fixture、可见性、字段缺失和输出边界测试；清理阶段删除。
- 修改 `extension/src/parser/coordinator.ts`：仅在人工 refresh 的 top-frame logged-out 分支调用探针并输出固定 Console 前缀；清理阶段恢复。
- 修改 `extension/src/parser/coordinator.test.ts`：锁定“不自动执行、人工执行一次、其他 frame 不执行”；清理阶段删除临时断言。
- 修改 `docs/validation/m2-loop-log.md`：只记录匿名探针状态和安全观察，不记录实际职位字段。

## 执行约束

- 工作目录固定为 `C:\Users\刘都羿男\Documents\AI Recruitment Copilot\.worktrees\codex-m2-boss-frame-parser`。
- 不读取、暂存或提交未跟踪的 `extension/dist.crx` 与 `extension/dist.pem`。
- 不控制用户登录，不自动操作 BOSS，不保存 Console 中的实际字段值。
- 临时探针安装和清理各自单独提交；清理提交完成前不得进入 HR 登录测试。
- 若出现验证码、自动刷新、访问限制或意外跳转，立即停止人工观察，不重复点击。

### 任务 1：实现临时纯 DOM 读取器

**文件：**
- 新建：`extension/src/parser/publicJobProbe.test.ts`
- 新建：`extension/src/parser/publicJobProbe.ts`
- 参考：`extension/src/parser/dom.ts`
- 参考：`extension/src/parser/snapshot.ts`

- [ ] **步骤 1：先编写完整字段和限长行为的失败测试**

创建 `extension/src/parser/publicJobProbe.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { readFirstVisiblePublicJob } from './publicJobProbe';


describe('temporary public job probe', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads only the first visible public job card and limits fields to 80 characters', () => {
    const longTitle = `高级前端工程师${'甲'.repeat(90)}`;
    document.body.innerHTML = `
      <article class="job-card-box">
        <a class="job-name" href="/job_detail/public-one.html"> ${longTitle} </a>
        <a class="company-name"> 示例公司 </a>
        <span class="job-area"> 北京 </span>
      </article>
      <article class="job-card-box">
        <a class="job-name" href="/job_detail/public-two.html">不应读取的职位</a>
        <a class="company-name">第二家公司</a>
        <span class="job-area">上海</span>
      </article>`;

    expect(readFirstVisiblePublicJob(document)).toEqual({
      status: 'success',
      title: longTitle.slice(0, 80),
      company: '示例公司',
      location: '北京',
    });
  });
});
```

- [ ] **步骤 2：运行测试并确认 RED**

运行：

```powershell
npm.cmd run test --workspace extension -- src/parser/publicJobProbe.test.ts --run
```

预期：FAIL，Vitest 明确报告无法解析 `./publicJobProbe`，因为临时读取器尚未创建。

- [ ] **步骤 3：补充隐藏、部分字段、未找到和字段白名单失败测试**

在同一 `describe` 中加入：

```ts
it('skips a hidden job card before the first visible card', () => {
  document.body.innerHTML = `
    <article class="job-card-box" hidden>
      <a class="job-name" href="/job_detail/hidden.html">隐藏职位</a>
      <a class="company-name">隐藏公司</a>
      <span class="job-area">隐藏地点</span>
    </article>
    <article class="job-card-box">
      <a class="job-name" href="/job_detail/visible.html">可见职位</a>
      <a class="company-name">可见公司</a>
      <span class="job-area">杭州</span>
    </article>`;

  expect(readFirstVisiblePublicJob(document)).toEqual({
    status: 'success',
    title: '可见职位',
    company: '可见公司',
    location: '杭州',
  });
});

it('returns partial without exposing href or whole-card text', () => {
  document.body.innerHTML = `
    <article class="job-card-box" data-job-id="forbidden-id">
      <a class="job-name" href="/job_detail/forbidden-id.html">测试职位</a>
      <p>不得作为回退返回的整卡文字</p>
    </article>`;

  const result = readFirstVisiblePublicJob(document);

  expect(result).toEqual({ status: 'partial', title: '测试职位' });
  expect(Object.keys(result).sort()).toEqual(['status', 'title']);
  expect(JSON.stringify(result)).not.toContain('forbidden-id');
  expect(JSON.stringify(result)).not.toContain('整卡文字');
});

it('returns not_found when no visible job detail link exists', () => {
  document.body.innerHTML = `
    <a href="/job_detail/hidden.html" aria-hidden="true">隐藏职位</a>
    <section>普通公开页面</section>`;

  expect(readFirstVisiblePublicJob(document)).toEqual({ status: 'not_found' });
});
```

- [ ] **步骤 4：实现最小纯 DOM 读取器**

创建 `extension/src/parser/publicJobProbe.ts`：

```ts
import { firstText, isHidden } from './dom';
import { normalizeText } from './snapshot';


export interface PublicJobProbeResult {
  status: 'success' | 'partial' | 'not_found';
  title?: string;
  company?: string;
  location?: string;
}


const JOB_LINK_SELECTOR = 'a[href*="/job_detail/"]';
const JOB_CARD_SELECTORS = [
  '.job-card-box',
  '.job-card-wrapper',
  '[class*="job-card"]',
  'article',
  'li',
] as const;
const TITLE_SELECTORS = ['.job-name', '.job-title', JOB_LINK_SELECTOR] as const;
const COMPANY_SELECTORS = ['.company-name', '.company-text'] as const;
const LOCATION_SELECTORS = ['.job-area', '.job-location'] as const;


function firstVisibleJobLink(targetDocument: Document): HTMLAnchorElement | undefined {
  return Array.from(targetDocument.querySelectorAll<HTMLAnchorElement>(JOB_LINK_SELECTOR))
    .find((link) => !isHidden(link));
}


function jobCardRoot(link: HTMLAnchorElement): ParentNode {
  for (const selector of JOB_CARD_SELECTORS) {
    const card = link.closest(selector);
    if (card && !isHidden(card)) {
      return card;
    }
  }
  return link;
}


export function readFirstVisiblePublicJob(
  targetDocument: Document,
): PublicJobProbeResult {
  const link = firstVisibleJobLink(targetDocument);
  if (!link) {
    return { status: 'not_found' };
  }

  const root = jobCardRoot(link);
  const title = (
    firstText(root, TITLE_SELECTORS, 80)
    ?? normalizeText(link.textContent, 80)
  ) || undefined;
  const company = firstText(root, COMPANY_SELECTORS, 80);
  const location = firstText(root, LOCATION_SELECTORS, 80);
  const fields = { title, company, location };
  const present = Object.values(fields).filter(Boolean).length;

  if (present === 0) {
    return { status: 'not_found' };
  }

  const result: PublicJobProbeResult = {
    status: present === 3 ? 'success' : 'partial',
  };
  if (title) {
    result.title = title;
  }
  if (company) {
    result.company = company;
  }
  if (location) {
    result.location = location;
  }
  return result;
}
```

- [ ] **步骤 5：运行聚焦测试并确认 GREEN**

运行：

```powershell
npm.cmd run test --workspace extension -- src/parser/publicJobProbe.test.ts --run
npm.cmd run typecheck --workspace extension
```

预期：`publicJobProbe.test.ts` 4 项通过，TypeScript exit code 0。

- [ ] **步骤 6：提交纯读取器**

```powershell
git add extension/src/parser/publicJobProbe.ts extension/src/parser/publicJobProbe.test.ts
git commit -m "test: add temporary public job reader"
```

提交前运行 `git diff --cached --check`，并确认 staged files 中没有 `extension/dist.pem` 或 `extension/dist.crx`。

### 任务 2：只在人工未登录 refresh 时输出一条 Console 诊断

**文件：**
- 修改：`extension/src/parser/coordinator.test.ts`
- 修改：`extension/src/parser/coordinator.ts`
- 使用：`extension/src/parser/publicJobProbe.ts`

- [ ] **步骤 1：编写 coordinator 触发边界失败测试**

在 `extension/src/parser/coordinator.test.ts` 的 logged-out 测试附近加入：

```ts
it('runs the temporary public job probe only on a manual logged-out top-frame refresh', () => {
  document.body.innerHTML = `
    <a>登录/注册</a>
    <article class="job-card-box">
      <a class="job-name" href="/job_detail/public.html">公开职位</a>
      <a class="company-name">公开公司</a>
      <span class="job-area">北京</span>
    </article>`;
  const runtime = createRuntimeOnMessage();
  const sendMessage = vi.fn(async (_message: ParserSnapshotMessage) => undefined);
  const publicJobProbe = vi.fn(() => ({
    status: 'success' as const,
    title: '公开职位',
    company: '公开公司',
    location: '北京',
  }));
  const publicJobProbeLogger = vi.fn();

  startParserCoordinator({
    targetDocument: document,
    currentUrl: 'https://www.zhipin.com/',
    isTopFrame: true,
    sendMessage,
    runtimeOnMessage: runtime.event,
    Observer: FakeObserver as unknown as typeof MutationObserver,
    now: () => capturedAt,
    publicJobProbe,
    publicJobProbeLogger,
  });

  expect(publicJobProbe).not.toHaveBeenCalled();
  expect(publicJobProbeLogger).not.toHaveBeenCalled();

  runtime.getListener()?.(
    { type: 'ARC_PARSER_REFRESH_COMMAND' },
    {} as chrome.runtime.MessageSender,
    vi.fn(),
  );

  expect(publicJobProbe).toHaveBeenCalledOnce();
  expect(publicJobProbe).toHaveBeenCalledWith(document);
  expect(publicJobProbeLogger).toHaveBeenCalledOnce();
  expect(publicJobProbeLogger).toHaveBeenCalledWith({
    status: 'success',
    title: '公开职位',
    company: '公开公司',
    location: '北京',
  });
  expect(sendMessage).toHaveBeenCalledTimes(2);
});
```

- [ ] **步骤 2：补充非 top-frame 和读取异常安全测试**

加入两个用例：

```ts
it('does not run the public job probe outside a logged-out top frame', () => {
  setRecommendFixture();
  const runtime = createRuntimeOnMessage();
  const publicJobProbe = vi.fn(() => ({ status: 'not_found' as const }));
  const publicJobProbeLogger = vi.fn();

  startParserCoordinator({
    targetDocument: document,
    currentUrl: 'https://www.zhipin.com/web/frame/recommend',
    isTopFrame: false,
    sendMessage: vi.fn(async () => undefined),
    runtimeOnMessage: runtime.event,
    Observer: FakeObserver as unknown as typeof MutationObserver,
    now: () => capturedAt,
    publicJobProbe,
    publicJobProbeLogger,
  });

  runtime.getListener()?.(
    { type: 'ARC_PARSER_REFRESH_COMMAND' },
    {} as chrome.runtime.MessageSender,
    vi.fn(),
  );

  expect(publicJobProbe).not.toHaveBeenCalled();
  expect(publicJobProbeLogger).not.toHaveBeenCalled();
});

it('converts a public job probe exception to not_found without exposing the error', () => {
  document.body.innerHTML = '<a>登录/注册</a>';
  const runtime = createRuntimeOnMessage();
  const publicJobProbeLogger = vi.fn();

  startParserCoordinator({
    targetDocument: document,
    currentUrl: 'https://www.zhipin.com/',
    isTopFrame: true,
    sendMessage: vi.fn(async () => undefined),
    runtimeOnMessage: runtime.event,
    now: () => capturedAt,
    publicJobProbe: () => {
      throw new Error('private DOM detail');
    },
    publicJobProbeLogger,
  });

  runtime.getListener()?.(
    { type: 'ARC_PARSER_REFRESH_COMMAND' },
    {} as chrome.runtime.MessageSender,
    vi.fn(),
  );

  expect(publicJobProbeLogger).toHaveBeenCalledWith({ status: 'not_found' });
  expect(JSON.stringify(publicJobProbeLogger.mock.calls)).not.toContain('private DOM detail');
});

it('uses one fixed Console prefix with the default probe logger', () => {
  document.body.innerHTML = `
    <a>登录/注册</a>
    <article class="job-card-box">
      <a class="job-name" href="/job_detail/public.html">公开职位</a>
      <a class="company-name">公开公司</a>
      <span class="job-area">北京</span>
    </article>`;
  const runtime = createRuntimeOnMessage();
  const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

  startParserCoordinator({
    targetDocument: document,
    currentUrl: 'https://www.zhipin.com/',
    isTopFrame: true,
    sendMessage: vi.fn(async () => undefined),
    runtimeOnMessage: runtime.event,
    now: () => capturedAt,
  });

  runtime.getListener()?.(
    { type: 'ARC_PARSER_REFRESH_COMMAND' },
    {} as chrome.runtime.MessageSender,
    vi.fn(),
  );

  expect(consoleInfo).toHaveBeenCalledOnce();
  expect(consoleInfo).toHaveBeenCalledWith('[ARC public job probe]', {
    status: 'success',
    title: '公开职位',
    company: '公开公司',
    location: '北京',
  });
  consoleInfo.mockRestore();
});
```

- [ ] **步骤 3：运行 coordinator 测试并确认 RED**

运行：

```powershell
npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts --run
```

预期：FAIL，`CoordinatorOptions` 尚不接受 `publicJobProbe` / `publicJobProbeLogger`，且人工 refresh 尚未调用探针。

- [ ] **步骤 4：实现最小 coordinator 接入**

在 `extension/src/parser/coordinator.ts` 顶部加入：

```ts
import {
  readFirstVisiblePublicJob,
  type PublicJobProbeResult,
} from './publicJobProbe';
```

扩展 `CoordinatorOptions`：

```ts
publicJobProbe?: (targetDocument: Document) => PublicJobProbeResult;
publicJobProbeLogger?: (result: PublicJobProbeResult) => void;
```

在 `startParserCoordinator` 依赖初始化区加入：

```ts
const publicJobProbe = options.publicJobProbe ?? readFirstVisiblePublicJob;
const publicJobProbeLogger = options.publicJobProbeLogger ?? ((result) => {
  console.info('[ARC public job probe]', result);
});
```

在 `runtimeListener` 之前加入：

```ts
const runPublicJobProbe = (): void => {
  if (!options.isTopFrame || pageKind !== 'logged_out') {
    return;
  }

  let result: PublicJobProbeResult;
  try {
    result = publicJobProbe(options.targetDocument);
  } catch {
    result = { status: 'not_found' };
  }
  publicJobProbeLogger(result);
};
```

把人工 refresh 分支改为：

```ts
if (
  typeof message === 'object'
  && message !== null
  && (message as { type?: unknown }).type === 'ARC_PARSER_REFRESH_COMMAND'
) {
  runPublicJobProbe();
  run(true);
}
```

- [ ] **步骤 5：运行聚焦测试、类型检查和安全扫描**

运行：

```powershell
npm.cmd run test --workspace extension -- src/parser/publicJobProbe.test.ts src/parser/coordinator.test.ts --run
npm.cmd run typecheck --workspace extension
rg -n --glob "!*.test.ts" "fetch\(|XMLHttpRequest|WebSocket|\.click\(|\.focus\(|scrollTo\(|location\.(assign|replace|reload)|innerHTML|outerHTML|document\.cookie|localStorage|sessionStorage" extension/src/parser/publicJobProbe.ts extension/src/parser/coordinator.ts
```

预期：所有聚焦测试通过；TypeScript exit code 0；`rg` exit code 1 且无输出。

- [ ] **步骤 6：提交临时触发接入**

```powershell
git add extension/src/parser/coordinator.ts extension/src/parser/coordinator.test.ts
git commit -m "test: wire temporary public job probe"
```

提交前运行 `git diff --cached --check` 并确认未暂存 CRX/PEM。

### 任务 3：构建临时版本并执行一次未登录人工观察

**文件：**
- 修改：`docs/validation/m2-loop-log.md`
- 构建产物：`extension/dist/*`（不提交）

- [ ] **步骤 1：运行临时版本自动基线**

运行：

```powershell
npm.cmd run test:extension
npm.cmd run typecheck:extension
npm.cmd run build:extension
```

记录真实 test files、tests、错误数和 bundle sizes；任何命令失败都停止，不加载扩展。

- [ ] **步骤 2：确认临时构建只包含一个诊断前缀**

运行：

```powershell
$content = Get-Content -Raw -Encoding utf8 extension\dist\content.js
([regex]::Matches($content, '\[ARC public job probe\]')).Count
```

预期：输出 `1`。若为 `0` 或大于 `1`，停止人工观察并定位构建问题。

- [ ] **步骤 3：由用户加载正确工作树构建**

Chrome 中只启用以下 unpacked extension：

```text
C:\Users\刘都羿男\Documents\AI Recruitment Copilot\.worktrees\codex-m2-boss-frame-parser\extension\dist
```

刷新扩展后刷新未登录 BOSS 首页。不得由自动化工具登录、登出或控制页面。

- [ ] **步骤 4：执行一次人工 Console / Network 观察**

用户执行：

1. 打开 DevTools Console 与 Network，清空两处记录。
2. 不滚动、不点击 BOSS 内容，只点击扩展“重新读取页面”一次。
3. 只向执行者报告 `probe_status=success|partial|not_found`，不复制实际职位名、公司或地点。
4. 观察 60 秒；报告是否发生验证码、页面刷新、跳转、访问限制或其他自动操作。
5. 检查是否观察到由扩展触发的 BOSS 请求；localhost health 请求允许出现。
6. 发生任何停止条件时不再次点击。

- [ ] **步骤 5：把匿名事实写入验证日志**

在 `docs/validation/m2-loop-log.md` 新增“未登录公开职位临时探针”小节。探针状态必须根据 Console 结果选择下列三条中的且仅一条：

```markdown
- 探针状态：`success`。
- 探针状态：`partial`。
- 探针状态：`not_found`。
```

其余内容按已经观察到的事实写成完整句子，不得保留竖线选项或占位符。小节结构为：

```markdown
## 未登录公开职位临时探针

- 执行日期：2026-07-30。
- 人工触发次数：1。
- 探针状态：使用上方三条中的实际一条。
- Console 字段核对：写明“已核对”或“未核对”，不记录字段值。
- 60 秒观察：用完整句子写明是否出现验证码、刷新、跳转或访问限制。
- Network：用完整句子写明是否观察到扩展触发的 BOSS 请求，并单独说明 localhost health。
- 结论只限本次观察，不推断后续 HR 登录绝对安全。
```

- [ ] **步骤 6：提交匿名验证事实**

```powershell
git add docs/validation/m2-loop-log.md
git diff --cached --check
git commit -m "test: record logged-out public job probe"
```

确认提交中没有实际职位字段、页面 HTML、截图、账号信息、CRX 或 PEM。

### 任务 4：在 HR 登录前强制删除临时探针

**文件：**
- 删除：`extension/src/parser/publicJobProbe.ts`
- 删除：`extension/src/parser/publicJobProbe.test.ts`
- 修改：`extension/src/parser/coordinator.ts`
- 修改：`extension/src/parser/coordinator.test.ts`
- 修改：`docs/validation/m2-loop-log.md`

- [ ] **步骤 1：记录清理前指纹**

运行：

```powershell
rg -n "ARC public job probe|publicJobProbe|readFirstVisiblePublicJob|job_detail" extension/src
```

预期：只命中临时模块、临时测试和 coordinator 临时接入。若命中其他正式文件，先审查范围，不扩大删除目标。

- [ ] **步骤 2：删除临时模块和测试**

使用补丁删除：

```text
extension/src/parser/publicJobProbe.ts
extension/src/parser/publicJobProbe.test.ts
```

不得删除候选人 parser、page classifier、router 或 PageReadingCard。

- [ ] **步骤 3：从 coordinator 删除全部临时接入**

仅删除以下内容：

- `publicJobProbe` import 和 `PublicJobProbeResult` type import；
- `CoordinatorOptions.publicJobProbe`；
- `CoordinatorOptions.publicJobProbeLogger`；
- 两个默认依赖常量；
- `runPublicJobProbe`；
- refresh 分支中的 `runPublicJobProbe()` 调用。

refresh 分支最终恢复为：

```ts
if (
  typeof message === 'object'
  && message !== null
  && (message as { type?: unknown }).type === 'ARC_PARSER_REFRESH_COMMAND'
) {
  run(true);
}
```

- [ ] **步骤 4：删除 coordinator 中三个临时测试**

从 `extension/src/parser/coordinator.test.ts` 删除任务 2 新增的：

- `runs the temporary public job probe only on a manual logged-out top-frame refresh`；
- `does not run the public job probe outside a logged-out top frame`；
- `converts a public job probe exception to not_found without exposing the error`；
- `uses one fixed Console prefix with the default probe logger`。

保留原有 logged-out snapshot、refresh、observer 和 parser 安全测试。

- [ ] **步骤 5：运行清理后字符串与生产安全扫描**

运行：

```powershell
rg -n "ARC public job probe|publicJobProbe|readFirstVisiblePublicJob|job_detail" extension/src
rg -n --glob "!*.test.ts" --glob "!*.test.tsx" "chrome\.debugger|fetch\(|\.click\(|\.focus\(|scrollTo\(|location\.(assign|replace|reload)|innerHTML|outerHTML|document\.cookie|localStorage|sessionStorage|console\.(log|debug|info)" extension/src/parser extension/src/content.tsx
```

预期：两条命令均 exit code 1 且无输出。任何匹配都阻止进入 HR 登录测试。

- [ ] **步骤 6：运行清理后完整验证和构建检查**

运行：

```powershell
npm.cmd run verify
$content = Get-Content -Raw -Encoding utf8 extension\dist\content.js
([regex]::Matches($content, '\[ARC public job probe\]')).Count
```

预期：完整验证 exit code 0；构建产物前缀计数为 `0`。记录真实测试计数和 bundle sizes。

- [ ] **步骤 7：在验证日志记录清理完成**

在临时探针小节追加：

```markdown
- 清理状态：临时读取器、测试、调用点和 Console 前缀已删除。
- HR 测试构建检查：`[ARC public job probe]` 计数为 0。
- 清理后完整验证：记录实际命令结果、测试计数和 bundle sizes。
```

- [ ] **步骤 8：提交清理结果**

```powershell
git add extension/src/parser/coordinator.ts extension/src/parser/coordinator.test.ts docs/validation/m2-loop-log.md
git add -u extension/src/parser/publicJobProbe.ts extension/src/parser/publicJobProbe.test.ts
git diff --cached --check
git commit -m "test: remove temporary public job probe"
```

最后运行：

```powershell
git status --short --branch
```

预期：除用户已有的 `extension/dist.crx` 与 `extension/dist.pem` 外没有未提交变化。只有此时才能刷新扩展并进入 HR 登录后五页人工验收。
