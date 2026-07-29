# AI Recruitment Copilot

AI Recruitment Copilot 是一个本地优先的招聘辅助工具。当前事实状态如下：

- M1 代码、自动验证和 Chrome 人工验收已通过。
- M2 本地只读 BOSS 页面解析代码、分任务定向验证和 Task 8 自动闭合已完成。
- M2 的未登录安全冒烟，以及登录后的至少 5 个样本 / 95% 核心字段准确率验收尚未执行。因此当前不得称 M2 完成。

> M2 只读取当前账号已获授权页面中已经渲染的 DOM。它不使用 LLM，不拦截网络，不调用 BOSS 私有 API，也不自动点击、滚动、导航、填写或发送。页面读取预览仅本地展示；现有 `92%` 评估仍是明确标注的演示数据，不由 BOSS 页面资料生成。

## M2 只读边界

- 顶层页面只挂载一个 Shadow DOM 悬浮窗；匹配的 BOSS frame 只读取已经渲染、当前可见且当前账号有权查看的 DOM。
- 折叠、尚未加载、图片或 canvas 中的内容按缺失处理；解析器不会操作页面来补齐字段。
- frame 只传递白名单结构化快照，不传递完整 HTML、DOM、Cookie、访问令牌、请求头或页面网络响应。
- 页面读取结果只在扩展本地内存和悬浮窗中使用，不发送给本地后端或外部服务。
- M2 不使用 LLM、网络拦截、BOSS 私有 API、Chrome 调试器、CDP 或 WebDriver。
- M2 不自动点击、滚动、导航、刷新、打开候选人、翻页、填写输入框或发送消息。
- 未登录安全冒烟只验证扩展注入、页面分类、消息链路和被动读取等安全 plumbing；真实候选人字段选择器准确率必须在用户手动登录后另行人工验收。

每次源码变化后的浏览器验证都必须按同一顺序执行：

```text
重新构建 -> 在 chrome://extensions 刷新扩展 -> 刷新测试页面
```

只刷新测试页面会继续运行 Chrome 已加载的旧扩展产物，不能作为新构建的验收证据。

## 运行方式与平台边界

当前代码采用 Windows 本地验证方式：Chrome 扩展连接同一台 Windows 电脑上运行的 FastAPI 服务。这套方式用于当前开发和验收，不是 HR 最终在 Mac 上的使用方式。

功能验证通过后，计划把 FastAPI、数据库和 LLM 调用迁移到阿里云。届时 HR 的 Mac 只需要 Chrome、已安装的扩展和网络连接，不需要安装 Node.js、Python、SQLite，也不需要手动启动本地服务。

> 阿里云部署和 Mac 端真实验收目前尚未实现。迁移时仍需完成 HTTPS、服务端鉴权、限流、日志脱敏和招聘数据保留策略，不能直接把当前本机接口暴露到公网。

## 当前 Windows 本地验证环境

- Windows 10/11
- Chrome
- Node.js 24 和 npm
- Python 3.14（可通过 `py -3.14` 调用）

## 计划中的 HR 使用环境（尚未实现）

- macOS
- Chrome
- AI Recruitment Copilot 扩展
- 可访问阿里云服务的网络连接

目标数据流为：扩展在 HR 的 Chrome 中读取当前页面并执行字段筛选和 PII 脱敏，只把业务所需的结构化结果通过 HTTPS 发送到阿里云；评分、LLM 调用和持久化由服务器统一处理。同一扩展构建产物能否在 HR 的实际 Mac 和 BOSS 页面稳定运行，必须经过真实环境验收后才能标记为通过。

## 首次安装

在项目根目录打开 PowerShell：

```powershell
npm.cmd install
py -3.14 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

项目使用 `scripts\python.cmd` 调用 Python。这个入口会加载 `.venv` 中的依赖，同时兼容包含中文字符的项目路径。

## 启动本机服务

```powershell
npm.cmd run start:backend
```

看到 Uvicorn 启动信息后不要关闭这个窗口。可在浏览器访问：

- 健康检查：<http://127.0.0.1:8765/healthz>
- API 文档及 M1 演示验收页：<http://127.0.0.1:8765/docs>

服务只监听 `127.0.0.1:8765`，不会暴露到局域网。

## 构建并加载 Chrome 扩展

另开一个 PowerShell 窗口，在项目根目录运行：

```powershell
npm.cmd run build:extension
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension\dist` 目录。
5. 刷新扩展，再刷新要验证的页面。

页面右侧应出现 `AI Recruitment Copilot` 悬浮窗。以后每次都遵循 `重新构建 -> 在 chrome://extensions 刷新扩展 -> 刷新测试页面`。

## M1 Chrome 复验清单

M1 Chrome 人工验收已有事实记录且已通过。README 只保留可重复执行的未勾选 runbook；观察结果写入验证日志，不在这里勾选。

- [ ] `http://127.0.0.1:8765/healthz` 返回 `status: ok`。
- [ ] `/docs` 页面右侧出现悬浮窗，原页面仍能滚动和点击。
- [ ] 顶部显示“本机服务在线”，主体显示“演示数据”。
- [ ] 总分显示 `92%`，建议显示“非常匹配，建议联系”。
- [ ] 点击任一匹配维度后，可以展开理由和参考证据。
- [ ] 可以看到候选人亮点、风险提示和建议确认问题。
- [ ] 三个沟通建议标签可以切换。
- [ ] 页面初次展示和切换标签时不会自动复制、填写或发送任何内容。
- [ ] 点击“复制话术”后出现“已复制”，粘贴板内容与当前话术一致。
- [ ] 点击顶部折叠按钮后变为右侧窄条，点击箭头可恢复。
- [ ] 停止后端，再点击在线状态下的“刷新连接”，悬浮窗清除旧结果并显示本机服务未连接及启动命令。
- [ ] 恢复后端后点击“重新连接”，悬浮窗重新显示在线状态和演示评估。

## M2 Task 8 未登录安全冒烟清单

以下项目必须由用户和执行者逐项观察；当前全部未执行，因此全部保持未勾选。异常、验证码、访问限制或意外跳转一旦出现，立即停止本轮测试，不尝试规避。

- [ ] 用户确认当前 Chrome BOSS 会话已经登出；扩展不执行登出，也不改变账号状态。
- [ ] 执行 `重新构建 -> 在 chrome://extensions 刷新扩展 -> 刷新测试页面`。
- [ ] 在确认未登录的状态下打开 <https://www.zhipin.com/>。
- [ ] 页面只出现一个悬浮窗，并显示“BOSS 当前未登录”。
- [ ] 悬浮窗不显示任何候选人字段。
- [ ] 人工点击“重新读取页面”一次；状态返回，且解析器没有 click、scroll、navigation、input 或 message 动作。
- [ ] 连续观察至少 60 秒，没有因扩展读取发生可见自动刷新。
- [ ] 仅在这个未登录页面检查 DevTools Network；解析器没有发起 BOSS 请求，既有 `http://127.0.0.1:8765` 本机 health 请求允许出现。
- [ ] 页面滚动位置、登录字段和其他输入内容保持不变。
- [ ] 如出现自动刷新、验证码、访问限制、异常跳转或其他异常，立即停止并只记录事实症状。

## M2 登录后人工解析验收清单

未登录冒烟通过且用户明确授权后，才执行以下人工验收；不得由扩展或自动化工具完成登录。

- [ ] 用户手动登录 BOSS，并明确授权本轮人工验收。
- [ ] 用户打开至少 5 个其有权查看的候选人页面。
- [ ] 每个页面只按下方模板记录匿名 `sample_id` 和字段级结果。
- [ ] 每个样本核对 `work_experience`、`education`、`projects`、`skills` 和 `experience_years`。
- [ ] 全程没有自动点击、滚动、导航、输入或消息动作，没有扩展导致的自动刷新，也没有上一候选人的 stale 数据。
- [ ] 按 `正确的 present core fields / 全部 present core fields` 计算准确率，至少 5 个样本的汇总结果达到 `95%` 或更高。
- [ ] 不记录真实字段值，不保存候选人 HTML、截图、姓名、电话、邮箱或简历正文。

准确率计算遵循以下 runbook 规则；这些规则不预填任何验收结果：

- numerator 只统计标记为 `pass` 的核心字段。
- `partial` 和 `fail` 表示字段在页面实际 present，因此保留在 denominator，但不计入 correct。
- `not_present` 表示页面没有该字段，排除在 denominator 之外。
- denominator 只包含每页实际 present 的 `work_experience`、`education`、`projects`、`skills` 和 `experience_years`，并汇总至少 5 个样本。
- 如果汇总后的 total present core fields 为 `0`，不得计算准确率，也不得判定通过；即使已经打开 5 个样本也适用此规则。

每个样本使用以下空白模板；`sample_id` 只使用匿名编号，不预填或记录任何真实字段值：

```text
sample_id: anonymous-<序号>
refresh_observed: yes|no
stale_candidate_observed: yes|no
work_experience: pass|partial|fail|not_present
education: pass|partial|fail|not_present
projects: pass|partial|fail|not_present
skills: pass|partial|fail|not_present
experience_years: pass|partial|fail|not_present
unsupported_message_correct: pass|not_applicable
```

## 自动验证

项目完整验证入口为：

```powershell
npm.cmd run verify
```

单独运行各项：

```powershell
npm.cmd run test:backend
npm.cmd run test:extension
npm.cmd run typecheck:extension
npm.cmd run build:extension
```

初始完整 baseline 的事实记录是 2026-07-29、commit `ddab5b9`：执行 `npm.cmd run verify`，后端 12 项、扩展 24 项通过，TypeScript 类型检查和双入口生产构建通过。该 24 项扩展测试是进入 M2 前的 baseline，不是当前 M2 的最终闭合结果。

M2 的 post-repair Task 8 final closure 已执行：`npm.cmd run verify` exit 0，后端 12 项、扩展 135 项通过，TypeScript 类型检查通过；`content.js` 为 226.53 kB（gzip 70.74 kB），`background.js` 为 3.96 kB（gzip 1.68 kB）。pre-repair closure 的解释器发现失败、第 8 轮修复及全部命令事实见 [`docs/validation/m2-loop-log.md`](docs/validation/m2-loop-log.md)。这只证明自动验证闭合，不替代未登录与登录后人工验收。

## 当前已实现的代码范围

M1 已实现并通过 Chrome 人工验收：

- FastAPI 健康检查、演示评估接口和确定性分数计算。
- Chrome Manifest V3 双入口构建、本机 Service Worker 网络代理和 Shadow DOM 悬浮窗。
- 在线、连接中、离线、重试、证据展开、话术切换及手动复制。

M2 已实现并通过自动验证，但仍待 Task 8 两阶段人工验收：

- 本地只读、frame-aware 的 BOSS 页面分类器和 DOM parser。
- 已渲染候选人摘要、工作经历、教育经历、项目经历、技能和基本年限信息的白名单结构化读取。
- 事件驱动协调、去重、受限观察、人工重新读取，以及按 tab / frame / document 路由的内存快照。
- 悬浮窗中的“页面读取（仅本地）”状态、覆盖率、缺失字段和结构化预览。
- 未登录与不支持页面的安全状态，以及本地演示评估和真实页面读取之间的视觉隔离。

本地只读 parser 的代码已经实现；“真实 BOSS 解析尚未实现”已不再准确。当前尚未验证的是登录后真实页面 selector 的字段准确率与稳定性，必须通过至少 5 个授权样本和 95% 门槛后才能确认。

## 尚未实现或明确延期

- 真实岗位创建、权重编辑和版本保存。
- LLM 评分、证据分析或话术生成；`92%` 仍是演示数据。
- 正式候选人评估、SQLite 持久化和招聘数据保留流程。
- 账号、权限、多人协作和云端部署。
- Mac HR 端安装包、阿里云 API 地址、HTTPS 鉴权和真实跨平台验收。
- 自动打开候选人、自动翻页、自动采集、自动点击、自动滚动、自动填写或自动发送消息。

总体技术设计见 [`docs/superpowers/specs/2026-07-28-ai-recruitment-copilot-design.md`](docs/superpowers/specs/2026-07-28-ai-recruitment-copilot-design.md)，M1 实施计划见 [`docs/superpowers/plans/2026-07-28-m1-framework-demo.md`](docs/superpowers/plans/2026-07-28-m1-framework-demo.md)。M2 设计见 [`docs/superpowers/specs/2026-07-29-m2-boss-frame-parser-design.md`](docs/superpowers/specs/2026-07-29-m2-boss-frame-parser-design.md)，M2 实施计划见 [`docs/superpowers/plans/2026-07-29-m2-boss-frame-parser.md`](docs/superpowers/plans/2026-07-29-m2-boss-frame-parser.md)，当前验证事实见 [`docs/validation/m2-loop-log.md`](docs/validation/m2-loop-log.md)。
