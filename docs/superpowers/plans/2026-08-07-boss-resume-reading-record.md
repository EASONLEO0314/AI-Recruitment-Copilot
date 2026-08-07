# BOSS 完整简历读取实施计划与排障记录

> **供后续执行者使用：** 实施时必须逐项勾选本文件中的任务，并遵守“先失败测试、再最小实现、再定向验证”的顺序。每次真实页面实验结束后，无论成功或失败，都要在本文件追加事实记录。

**目标：** 在不调用 BOSS 私有接口、不读取 Cookie、不自动点击或发送消息的前提下，准确读取用户当前手动打开的候选人完整简历，并转换为现有 `CandidateProfile` 结构。

**当前架构结论：** 保留现有 frame 路由和 DOM 摘要解析；新增一次性、由用户点击触发的 Chrome MAIN world Vue 数据读取。只有 Vue 数据不可用或覆盖不足时，才进入后续截图 OCR 方案评估。

**技术栈：** Chrome Manifest V3、TypeScript、React、`chrome.scripting.executeScript`、Vitest、现有 `ParserSnapshot` / `CandidateProfile` 契约。

**文档状态：** 当前唯一的 BOSS 完整简历读取主记录。旧设计和验证日志继续作为历史证据保留，但后续方案、实验和结论以本文件为准。

---

## 1. 记录规则

1. 只记录已经观察到的事实；尚未验证的判断必须标记为“假设”。
2. 不记录候选人姓名、电话、邮箱、公司、学校、简历正文、截图或完整 HTML。
3. 真实页面样本只使用匿名编号，例如 `sample-01`。
4. 一次实验只验证一个新假设；失败后先记录唯一问题指纹，再决定是否修复。
5. 新结果不得删除或改写旧失败；如果旧判断被推翻，追加“结论更新”。
6. 自动测试通过不能替代真实 Chrome 人工验收。
7. 未达到验收门槛前，不得把演示评分描述为真实候选人评分。

## 2. 不变的安全边界

- 只处理当前账号已经有权查看、且用户手动打开的候选人简历。
- 不读取或转发 Cookie、Token、请求头、localStorage、sessionStorage 或浏览器密码。
- 不调用、复刻或拦截 BOSS 私有接口和网络响应。
- 第一阶段不自动打开候选人、不自动翻页、不自动滚动、不自动收藏、不自动打招呼。
- 不使用 `chrome.debugger`、CDP、WebDriver 或远程调试端口。
- MAIN world 读取必须由用户点击“读取当前简历”触发，不在后台轮询。
- MAIN world 只返回白名单结构化字段；不得返回 Vue 实例、完整页面对象、HTML 或未知字段。
- 候选人正文不得写入 Console、测试 fixture、验证日志或 Git。
- 读取结果在第一阶段只保留于当前扩展内存；刷新页面或关闭标签页后消失。

## 3. 当前已确认事实

### 3.1 已打通的基础链路

- Chrome 扩展能够在 BOSS 顶层页面挂载悬浮窗。
- `all_frames: true` 已使匹配的 BOSS frame 分别运行 content script。
- 子 frame 快照能够经 MV3 Service Worker 转发到 frame 0。
- 用户点击“重新读取页面”能够广播只读刷新命令。
- 本机 FastAPI 在线状态与 BOSS 页面读取状态已经分离。
- 现有解析和诊断不会主动调用 BOSS 网络接口。

### 3.2 真实页面结构证据

匿名现场截图曾观察到以下 class：

- `lib-standard-resume`
- `lib-resume-recommend`
- `wasm-resume-layout`
- `resume-layout-wrap`
- `resume-middle-wrap`
- `resume-center-side`
- `resume-detail-wrap`
- `resume-summary`
- `education`

匿名 frame 诊断曾同时观察到：

- 推荐候选 frame：DOM 结构较多，但没有得到完整经历正文；
- 候选简历 frame：DOM 元素很少，没有形成可用 `CandidateProfile`；
- 按“可见 DOM 元素最多”选择 frame 后，仍然只显示“候选人结构未匹配”。

**结论：** frame 注入和路由不是当前主要阻塞点；“完整简历正文存在于普通可见 DOM 中”这一假设没有得到现场支持。

### 3.3 第三方实现静态分析证据

2026-08-07 对 `https://hrassistent.online/` 公开离线安装包执行了静态检查，未安装、未运行、未连接 BOSS 账号。

- 安装包 Manifest 版本：`1.66`。
- ZIP SHA-256：`AF2727353265B68EAA6AACBD4F2E8B80A08488562C46656CE4C42832AF5A4548`。
- 其代码明确写明 BOSS 使用 Canvas 渲染简历，并尝试从 `.lib-resume-recommend`、`.lib-resume-anonymous` 对应 Vue 组件的 `resumeInfo` 读取结构化数据。
- Vue/DOM 读取失败时，它使用 `chrome.tabs.captureVisibleTab`，滚动简历容器并最多截取五屏，再调用 `/api/ocr` 和评估接口。
- 该插件还包含自动滚动、收藏和打招呼等逻辑；这些功能不进入本项目参考范围。

**结论：** `.lib-resume-recommend → Vue resumeInfo` 是当前最值得先验证的精确读取入口；截图 OCR 是可行兜底，不是首选主通路。

### 3.4 GitHub 交叉证据

- [`joohw/boss-cli`](https://github.com/joohw/boss-cli/blob/main/src/common/c_resume_capture.ts) 定位 `/web/frame/c-resume` 并对整个 iframe 截图。
- [`steveoon/agent-computer-user`](https://github.com/steveoon/agent-computer-user/blob/main/lib/tools/zhipin/locate-resume-canvas.tool.ts) 记录了 `recommend frame → c-resume frame → canvas#resume` 层级。
- [`hhh0078/goodhr`](https://github.com/hhh0078/goodhr/blob/main/goodhr5/local-agent-go-new/internal/platform/boss/config.json) 同样配置了 `recommendFrame → /web/frame/c-resume/ → #resume`。
- [`wenbinlv0118-arch/recruitment-automation`](https://github.com/wenbinlv0118-arch/recruitment-automation/blob/main/backend/src/services/dragSelectionService.js) 使用 Canvas 选择和复制，但需要自动鼠标操作及多次重试。
- [`jackwener/OpenCLI`](https://github.com/jackwener/OpenCLI/blob/main/clis/boss/resume.js) 能从聊天右侧 DOM 读取候选人摘要，但不是完整在线简历。

**结论：** 公开实现没有证明“继续增加 CSS 选择器”能够稳定读取新版完整简历；有效实现集中在 Vue 运行时数据、Canvas 复制或截图 OCR。

## 4. 历史尝试与失败原因

| 日期 / 提交 | 尝试方案 | 已观察结果 | 失败原因或限制 | 当前决定 |
|---|---|---|---|---|
| 2026-07-29 / M2 初版 | `frame-aware + DOM-first`，只读已渲染可见 DOM | 自动测试和消息路由通过，真实登录样本尚未验收 | 设计把 Canvas 内容直接视为缺失，无法覆盖新版完整简历 | 保留路由和安全边界，降级 DOM 为摘要来源 |
| 2026-07-30 / `b63861f`、`5800584` | 收集推荐页 class 指纹并补充新版弹窗选择器 | 能识别更多推荐页和简历外壳 | class 只描述组件外壳，未提供候选人正文 | 不再靠追加外壳 selector 作为主方案 |
| 2026-07-30 / 未登录公开页探针 | 在未登录页面验证只读注入 | 打开 DevTools 后页面出现状态变化，实验按约定停止 | 无法证明变化由 DevTools、会话过期、BOSS 或扩展中的哪一方造成 | 该实验没有反爬结论，不重复使用真实账号试探 |
| 2026-08-03 / `981b133` | 根据现代候选人 DOM 特征重新分类 frame | 页面类型识别改善 | 分类正确不等于正文可读 | 保留分类器，不把分类成功当作解析成功 |
| 2026-08-06 / `54d2731` 至 `aac176b` | 语义章节、`resume-simple-box`、`resume-item-detail` 与 `raw_text` | fixture 测试可解析模拟 DOM；真实页面仍返回 0 条经历或不支持 | 真实正文没有以相同的可见文本 DOM 暴露 | 保留兼容旧页面的 adapter，停止扩大语义 DOM 假设 |
| 2026-08-06 / `9df4009`、`fe64b5d` | 排除隐藏副本，优先可见简历浮层 | 避免部分隐藏 DOM 误读 | 即使选择可见浮层，正文仍不可用 | 可见性逻辑保留，仅用于选择正确容器 |
| 2026-08-06 / `d3586e9`、`0d082d3` | 输出匿名结构拓扑、栏目和渲染能力诊断 | 确认存在 recommend / resume 两类 frame 和简历组件外壳 | 诊断只证明结构存在，不能读取 Canvas/Vue 正文 | 保留为排障工具，禁止输出真实正文 |
| 2026-08-07 / `c27e2dd` | 选择“候选结构证据最多”的唯一 frame | 选择了 DOM 元素较多的推荐 frame，但完整简历仍未匹配 | 不同 frame 承担不同职责；元素数不能代表正文完整度 | 后续改为按来源合并，不再 winner-takes-all |
| 2026-08-07 / GitHub 与第三方包复核 | 比较 Vue、Canvas 复制、截图 OCR 和私有 API | 找到 `.lib-resume-recommend → resumeInfo` 与截图 OCR 的明确实现证据 | 当前项目尚未在 MAIN world 验证 Vue 数据是否存在 | 先做无正文泄漏的 MAIN world 能力探针 |

## 5. 已排除或暂缓的方案

### 5.1 继续扩展 DOM 选择器

暂不继续。真实页面已经多次证明外壳 class 存在但正文不可见；继续追加 class 只能提高“识别到组件”的概率，不能保证得到完整经历。

### 5.2 `match_origin_as_fallback`

不是当前主修复。现场已经收到 `/web/frame/c-resume` 对应 frame 的 content-script 快照，说明普通 HTTPS frame 已成功注入。该 Manifest 属性主要用于 `about:`、`data:`、`blob:` 等关联 frame。

### 5.3 Canvas 自动框选和剪贴板 Hook

暂缓。公开实现需要拖拽、右键、聚焦和重试，会修改页面交互，也不符合当前“无自动操作”边界。

### 5.4 BOSS 私有 API、网络响应拦截和 Cookie 复用

排除。该方案依赖内部接口、签名和登录凭据，维护、隐私和账号风险均高。

### 5.5 `chrome.debugger` / CDP / WebDriver

排除第一阶段。虽然可以进行超视口截图或浏览器自动化，但权限和可观察性明显高于本项目需要。

### 5.6 直接以 OCR 为唯一主通路

暂缓。OCR 会增加图片传输、中文识别误差、成本和隐私处理；只有精确 Vue 数据通路失败或覆盖不足时才启用。

## 6. 当前方案

### 6.1 数据流

```text
用户点击“读取当前简历”
        ↓
frame 0 content script 发送 ARC_RESUME_READ
        ↓
MV3 Service Worker 校验请求来源与 tab
        ↓
chrome.scripting.executeScript
target: 当前 tab 的全部 frame
world: MAIN
        ↓
只检查可见的 lib-resume-recommend / lib-resume-anonymous
        ↓
查找 Vue 2 __vue__.resumeInfo 或经过现场证实的 Vue 3 等价入口
        ↓
先返回安全能力结果；确认字段结构后映射白名单值
        ↓
Service Worker 校验、限长、选择结构化字段最完整的结果
        ↓
生成 boss-vue-v1 ParserSnapshot
        ↓
与 DOM 摘要来源合并，在悬浮窗展示条目数、覆盖率和读取来源
```

### 6.2 两阶段验证

第一阶段不能直接猜测 Vue 数据结构，必须先运行不含候选人正文的能力探针：

- 是否命中可见 `.lib-resume-recommend` 或 `.lib-resume-anonymous`；
- 是否存在 Vue 2 `__vue__` 或 Vue 3 等价组件入口；
- 是否找到名为 `resumeInfo` 的候选对象；
- 只返回允许的字段名、数组长度和布尔状态，不返回字段值；
- 所有字符串诊断必须来自固定枚举，不得包含页面文本。

能力探针确认后，才增加白名单字段映射。若没有找到 Vue 数据，不猜测、不遍历所有全局变量，记录 `vue-resume-data-unavailable` 并停止。

### 6.3 多来源合并

- DOM adapter：继续负责当前岗位、候选卡和聊天侧摘要。
- Vue reader：负责工作、教育、项目、技能和完整摘要等简历字段。
- 相同字段同时存在时，Vue 结构化来源优先于 DOM 摘要。
- 仅在用户本次点击后的同一读取会话内合并，不持久化候选人身份。
- 不同 frame 不再相互竞争一个“最佳 frame”；只对同一来源类型的重复结果做质量比较。

### 6.4 失败状态

| 错误码 | 含义 | 界面文案 |
|---|---|---|
| `vue-root-not-found` | 当前全部 frame 没有可见的已知简历根 | 未找到当前简历，请先手动打开候选人简历 |
| `vue-instance-not-found` | 找到简历根，但没有可读 Vue 实例 | 当前版本未暴露可读取的简历数据 |
| `vue-resume-data-unavailable` | Vue 实例存在，但没有已确认的简历对象 | 未获取到完整简历，可稍后使用 OCR 方案 |
| `vue-schema-unsupported` | 找到对象，但字段结构未在白名单中 | 检测到新的简历结构，暂未适配 |
| `vue-result-invalid` | MAIN world 返回值没有通过扩展校验 | 页面读取结果无效，已安全丢弃 |
| `vue-read-failed` | 脚本执行或消息路由失败 | 简历读取失败，可手动重试 |

错误信息不得包含异常原文、页面字段值或对象序列化内容。

## 7. 实施任务

### Task 1：锁定 MAIN world 权限与消息契约

**文件：**

- 修改：`extension/public/manifest.json`
- 修改：`extension/src/manifest.test.ts`
- 修改：`extension/src/contracts.ts`
- 修改：`extension/src/validation.ts`
- 测试：`extension/src/validation.test.ts`（新建）

- [x] **Step 1：先写失败的 Manifest 测试**

  断言只新增 `scripting` 权限和 `https://www.zhipin.com/*` host permission；不得新增 `<all_urls>`、`tabs`、`debugger`、`webRequest` 或 Cookie 权限。

- [x] **Step 2：运行聚焦测试并确认失败**

  ```powershell
  npm.cmd run test --workspace extension -- src/manifest.test.ts --run
  ```

  预期：因缺少 `scripting` 和 BOSS host permission 失败。

- [x] **Step 3：定义读取请求与响应契约**

  ```ts
  type ResumeReadErrorCode =
    | 'vue-root-not-found'
    | 'vue-instance-not-found'
    | 'vue-resume-data-unavailable'
    | 'vue-schema-unsupported'
    | 'vue-result-invalid'
    | 'vue-read-failed';

  interface ResumeReadRequest {
    type: 'ARC_RESUME_READ';
  }

  type ResumeReadResponse =
    | { ok: true; snapshot: ParserSnapshot }
    | { ok: false; error: ResumeReadErrorCode };
  ```

- [x] **Step 4：实现最小 Manifest 变更和严格校验器**

  校验器必须拒绝未知顶层键、超长字符串、超过 50 项的数组，以及不是 `boss-dom-v1` / `boss-vue-v1` 的 parser version。

- [x] **Step 5：运行测试、类型检查并提交**

  ```powershell
  npm.cmd run test --workspace extension -- src/manifest.test.ts src/validation.test.ts --run
  npm.cmd run typecheck:extension
  ```

  预期：聚焦测试通过，TypeScript exit code 0。

  ```powershell
  git add extension/public/manifest.json extension/src/manifest.test.ts extension/src/contracts.ts extension/src/validation.ts extension/src/validation.test.ts
  git commit -m "feat: define user-triggered resume read contract"
  ```

### Task 2：实现不含正文的 MAIN world 能力探针

**文件：**

- 新建：`extension/src/parser/vueResumeProbe.ts`
- 新建：`extension/src/parser/vueResumeProbe.test.ts`
- 修改：`extension/src/background.ts`
- 修改：`extension/src/background.test.ts`

- [ ] **Step 1：使用合成 DOM 和合成 Vue 对象写失败测试**

  覆盖：可见根、隐藏根、Vue 2 命中、无 Vue、无 `resumeInfo`、多个 frame 结果。测试中的候选值只能使用匿名 fixture，例如 `候选人A`。

- [ ] **Step 2：运行聚焦测试并确认能力探针尚不存在**

  ```powershell
  npm.cmd run test --workspace extension -- src/parser/vueResumeProbe.test.ts src/background.test.ts --run
  ```

- [ ] **Step 3：实现完全自包含的注入函数**

  `extractBossVueResumeCapability()` 内部只能包含局部 helper 和字面量，确保传给 `chrome.scripting.executeScript({ func })` 后不引用模块外变量。返回结构限定为：

  ```ts
  interface VueResumeCapability {
    root: 'lib-resume-recommend' | 'lib-resume-anonymous';
    vue_generation: 'vue2' | 'vue3';
    resume_object: 'resumeInfo';
    allowed_keys: string[];
    array_lengths: Record<string, number>;
  }
  ```

  `allowed_keys` 必须与扩展内固定候选键集合求交集；不得返回任意页面键名。

- [ ] **Step 4：在 background 中只接受 frame 0 发起的用户请求**

  调用参数固定为：

  ```ts
  {
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: extractBossVueResumeCapability,
  }
  ```

  结果必须先经过扩展侧校验；不能把 `InjectionResult` 原样返回给页面。

- [ ] **Step 5：运行聚焦测试和生产安全扫描**

  ```powershell
  npm.cmd run test --workspace extension -- src/parser/vueResumeProbe.test.ts src/background.test.ts --run
  rg -n "fetch\(|chrome\.debugger|\.click\(|scrollTo\(|scrollBy\(" extension/src/parser/vueResumeProbe.ts extension/src/background.ts
  ```

  预期：测试通过；新增读取路径中没有 BOSS fetch、debugger、click 或 scroll。

- [ ] **Step 6：提交能力探针**

  ```powershell
  git add extension/src/parser/vueResumeProbe.ts extension/src/parser/vueResumeProbe.test.ts extension/src/background.ts extension/src/background.test.ts
  git commit -m "feat: probe BOSS resume data in the main world"
  ```

### Task 3：接入用户触发按钮并执行一次匿名人工验证

**文件：**

- 修改：`extension/src/parser/client.ts`
- 修改：`extension/src/parser/client.test.ts`
- 修改：`extension/src/components/PageReadingCard.tsx`
- 修改：`extension/src/components/PageReadingCard.test.tsx`
- 修改：`extension/src/components/CopilotPanel.tsx`
- 修改：`extension/src/components/CopilotPanel.test.tsx`
- 修改：本文件“实验记录”章节

- [ ] **Step 1：先写失败的交互测试**

  点击“读取当前简历”只发送一次 `ARC_RESUME_READ`；请求期间按钮禁用；失败显示固定错误文案；不得自动重试或自动刷新页面。

- [ ] **Step 2：实现客户端请求与界面状态**

  保留原来的 DOM 诊断刷新能力，但将完整简历读取设置为明确的用户操作。能力探针结果只显示：根是否命中、Vue 代际、允许字段数量和数组数量，不显示字段值。

- [ ] **Step 3：运行组件与客户端测试**

  ```powershell
  npm.cmd run test --workspace extension -- src/parser/client.test.ts src/components/PageReadingCard.test.tsx src/components/CopilotPanel.test.tsx --run
  ```

- [ ] **Step 4：构建并刷新 Chrome 扩展**

  ```powershell
  npm.cmd run build:extension
  ```

  然后人工执行：Chrome 扩展页刷新扩展 → 刷新 BOSS 页面 → 用户手动打开一名候选人 → 点击一次“读取当前简历”。

- [ ] **Step 5：只记录匿名能力结果**

  在本文件记录：sample id、命中根、Vue 代际、`resumeInfo` 是否存在、允许键数量和数组长度；不记录任何值。

- [ ] **Step 6：根据现场事实作单一决策**

  - 找到 `resumeInfo`：进入 Task 4；
  - 没找到：记录唯一失败码，停止 Vue 映射，不继续猜测全局变量，转入第 9 节 OCR 决策。

### Task 4：把已确认的 Vue schema 映射为 CandidateProfile

**前置条件：** Task 3 已用匿名能力探针确认真实字段结构。未满足时禁止执行。

**文件：**

- 新建：`extension/src/parser/vueResumeMapper.ts`
- 新建：`extension/src/parser/vueResumeMapper.test.ts`
- 修改：`extension/src/parser/vueResumeProbe.ts`
- 修改：`extension/src/contracts.ts`
- 修改：`extension/src/validation.ts`
- 修改：`extension/src/background.ts`

- [ ] **Step 1：根据确认的字段名创建完全匿名的最小 fixture**

  fixture 包含两条工作、一条教育、一条项目和技能数组，用于证明映射数量、顺序、限长和空字段处理；不得复制真实候选人值。

- [ ] **Step 2：写失败测试**

  测试必须覆盖：正确映射、未知字段忽略、隐藏/非当前根忽略、数组上限、字符串上限、循环对象安全失败、多个结果按实际结构化字段完整度选择。

- [ ] **Step 3：实现白名单映射**

  只映射经过 Task 3 确认的路径。不得使用 `JSON.stringify(vueInstance)`，不得递归遍历所有 Vue 状态，不得以任意 key 猜测字段含义。

- [ ] **Step 4：生成 `boss-vue-v1` 快照**

  快照继续使用现有 `CandidateProfile`；`warnings` 只能包含固定枚举；`fingerprint` 只能来自规范化结构的单向摘要，不能保存明文身份字段。

- [ ] **Step 5：运行聚焦测试并提交**

  ```powershell
  npm.cmd run test --workspace extension -- src/parser/vueResumeMapper.test.ts src/parser/vueResumeProbe.test.ts src/background.test.ts src/validation.test.ts --run
  npm.cmd run typecheck:extension
  ```

  ```powershell
  git add extension/src/parser/vueResumeMapper.ts extension/src/parser/vueResumeMapper.test.ts extension/src/parser/vueResumeProbe.ts extension/src/contracts.ts extension/src/validation.ts extension/src/background.ts
  git commit -m "feat: map authorized BOSS Vue resume data"
  ```

### Task 5：按来源合并摘要与完整简历

**文件：**

- 修改：`extension/src/parser/client.ts`
- 修改：`extension/src/parser/client.test.ts`
- 修改：`extension/src/components/PageReadingCard.tsx`
- 修改：`extension/src/components/PageReadingCard.test.tsx`

- [ ] **Step 1：写失败的来源合并测试**

  DOM 摘要提供岗位或城市，Vue 提供完整经历；最终保留两类信息。Vue 同字段优先；不同读取会话不得合并；logged-out 仍有安全优先级。

- [ ] **Step 2：用来源聚合替代唯一 frame 选择**

  保留 `selectBestParserRelay` 供历史 DOM 诊断使用，但完整简历展示改为 `composeCandidateReading(domRelays, vueSnapshot, sessionId)`，不得按可见元素数选择正文来源。

- [ ] **Step 3：界面显示来源和覆盖率**

  显示“Vue 精确读取”或“DOM 摘要”；不得把 Vue 结果标记成 OCR，也不得把演示 92% 分数标记成真实评估。

- [ ] **Step 4：运行聚焦测试并提交**

  ```powershell
  npm.cmd run test --workspace extension -- src/parser/client.test.ts src/components/PageReadingCard.test.tsx --run
  npm.cmd run typecheck:extension
  ```

  ```powershell
  git add extension/src/parser/client.ts extension/src/parser/client.test.ts extension/src/components/PageReadingCard.tsx extension/src/components/PageReadingCard.test.tsx
  git commit -m "feat: combine BOSS resume sources by read session"
  ```

### Task 6：完整验证、代码 Review 与真实样本验收

**文件：**

- 修改：`docs/validation/m2-loop-log.md`
- 修改：本文件

- [ ] **Step 1：运行聚焦安全扫描**

  ```powershell
  rg -n "chrome\.debugger|webRequest|cookies|localStorage|sessionStorage|\.click\(|\.focus\(|scrollTo\(|scrollBy\(|fetch\(" extension/src/parser extension/src/background.ts
  ```

  允许的 `fetch` 只能是既有固定 localhost API transport；新 Vue 读取文件中必须为 0。

- [ ] **Step 2：运行完整闭合**

  ```powershell
  npm.cmd run verify
  ```

  预期：backend、extension tests、TypeScript 和 production build 全部 exit code 0。

- [ ] **Step 3：Review 本轮差异**

  只修复本轮新发现且有证据的问题，不重复无意义执行全量流程。每个修复必须记录唯一问题指纹和聚焦测试。

- [ ] **Step 4：执行五个匿名授权样本验收**

  对每个样本仅记录字段级 `pass / partial / fail / not_present`。五个核心字段：工作、教育、项目、技能、工作年限。

- [ ] **Step 5：计算准确率**

  `pass / (pass + partial + fail)`，`not_present` 不进入分母。至少 5 个样本、总体准确率不低于 95%，且观察到 0 次自动点击、滚动、导航或发送，才可宣布 Vue 读取阶段通过。

## 8. 人工实验记录

> 后续每次真实 Chrome 实验向表格末尾追加一行，不删除旧行。

| 日期 | sample id | 实验假设 | 用户动作 | 匿名观察 | 结果 | 唯一失败码 / 结论 |
|---|---|---|---|---|---|---|
| 2026-08-07 | `research-only` | 公开插件可能给出完整简历读取入口 | 未操作 BOSS；仅静态检查公开 ZIP | 发现 `.lib-resume-recommend → resumeInfo` 尝试及 OCR 主回退 | 研究通过 | 下一步验证当前 BOSS 版本是否暴露 Vue 数据 |

## 9. OCR 兜底决策门槛

只有满足以下任一条件，才创建单独的 OCR 实施任务：

1. 五个授权样本中，Vue 数据完全不可用的样本不少于 2 个；
2. Vue 通路总体核心字段准确率低于 95%；
3. BOSS 更新导致 `resumeInfo` 或已确认 Vue schema 消失；
4. 用户明确要求支持 Canvas-only 页面。

OCR 方案必须另行确认：

- 截图由用户明确触发；
- 是否允许本次自动滚动必须单独授权；
- 图片默认只在内存中存在；
- 如果发送至阿里云或第三方模型，必须先明确传输、加密、保留和删除策略；
- OCR 字段必须带来源和置信度，不能冒充精确 Vue 数据；
- OCR 与 Vue 准确率分别统计。

## 10. 当前下一步

当前只执行 Task 1 至 Task 3，目标是用一次无正文泄漏的真实页面实验回答唯一问题：

> 当前 BOSS 页面中的可见 `.lib-resume-recommend` 是否在 MAIN world 暴露可用 `resumeInfo`？

在得到这个事实前，不执行 Task 4，不实现 OCR，也不继续增加 DOM selector。
