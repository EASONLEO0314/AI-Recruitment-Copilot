# M2 BOSS 页面只读解析验证记录

本文只记录已经观察到的事实。候选人 HTML、截图、姓名、电话、邮箱、简历正文和匿名 fixture 的字段值均不进入本文。

## 记录元数据

| 项目 | 事实 |
|---|---|
| 日期 | 2026-07-29 |
| 分支 | `codex/m2-boss-frame-parser` |
| 初始 baseline commit | `ddab5b9` |
| 写文档前 HEAD | `15321cf` |
| 初始 baseline 命令 | `npm.cmd run verify` |

## 初始完整 baseline

2026-07-29 在 commit `ddab5b9` 执行了完整 baseline：

```powershell
npm.cmd run verify
```

已观察结果：

| 检查 | 结果 |
|---|---|
| backend | 12 passed，0 failed |
| extension | 24 passed，0 failed |
| TypeScript | typecheck exit 0 |
| content build | `content.js` 208.73 kB，gzip 65.53 kB |
| background build | `background.js` 1.29 kB，gzip 0.71 kB |

这是进入 M2 实现前的完整 baseline，不是当前 M2 的最终闭合结果。

## M2 主功能提交

| Task | Commit | 已实现范围 |
|---|---|---|
| 1 | `f61a5bc` | 本地 parser 快照契约和严格校验 |
| 2 | `1517997` | BOSS frame 页面分类和 frame-safe Manifest |
| 3 | `2ccd042` | 可见候选人摘要与简历区域只读 adapter |
| 4 | `00d9ea0` | 事件驱动协调器和仅顶层挂载的 bootstrap |
| 5 | `505ca64` | 按 tab、frame、document 路由 parser 快照 |
| 6 | `afb1a64` | 仅本地页面读取预览和人工重新读取入口 |

## 分任务聚焦验证记录

这些是本轮已经观察到的 focused test 和相应任务 typecheck 记录；它们不替代 Task 8 的最终完整闭合。

| Task / 阶段 | 聚焦命令 | 已观察结果 |
|---|---|---|
| Task 1 初始实现 | `npm.cmd run test --workspace extension -- src/parser/snapshot.test.ts --run` | 9 passed；对应 typecheck exit 0 |
| Task 2 初始实现与安全契约 | `npm.cmd run test --workspace extension -- src/parser/pageClassifier.test.ts src/manifest.test.ts --run` | 19 passed；对应 typecheck exit 0 |
| Task 3 初始实现 | `npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts src/parser/adapters/resume.test.ts --run` | 8 passed |
| Task 3 可见 root 修复 | `npm.cmd run test --workspace extension -- src/parser/adapters/resume.test.ts --run` | 5 passed |
| Task 3 hidden-first / nested 修复 | `npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts src/parser/adapters/resume.test.ts --run` | 11 passed；Task 3 对应 typecheck exit 0 |
| Task 4 初始实现 | `npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts src/content.test.tsx --run` | 10 passed |
| Task 4 root error 修复 | `npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts --run` | 7 passed |
| Task 4 observer / retry 修复 | `npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts --run` | 10 passed；Task 4 对应 typecheck exit 0 |
| Task 5 初始实现 | `npm.cmd run test --workspace extension -- src/parser/router.test.ts src/background.test.ts --run` | 26 passed |
| Task 5 ACK / rejection 修复 | `npm.cmd run test --workspace extension -- src/parser/router.test.ts src/background.test.ts src/parser/coordinator.test.ts --run` | 39 passed；Task 5 对应 typecheck exit 0 |
| Task 6 初始实现 | `npm.cmd run test --workspace extension -- src/parser/client.test.ts src/components/PageReadingCard.test.tsx src/components/CopilotPanel.test.tsx src/styles.test.ts --run` | 46 passed |
| Task 6 watermark / coverage 修复 | `npm.cmd run test --workspace extension -- src/parser/client.test.ts src/components/PageReadingCard.test.tsx --run` | 31 passed；Task 6 对应 typecheck exit 0 |

## 定向修复循环

Task 7 写文档前已经使用 7 / 8 个 targeted repair rounds；如果 Task 8 发现新的独立问题，剩余第 8 轮可用于最小定向修复。同一审查批次发现的相关新证据可以记录在同一轮。

| 轮次 / commit | 唯一问题指纹 | 新证据 | Root cause | Changed files | Focused command | 已观察结果 |
|---|---|---|---|---|---|---|
| 1 / `578cc03` | `vitest:manifest-frame-safety:incomplete-safety-contract:extension/src/manifest.test.ts` | Production Manifest 当时已经正确；聚焦测试缺少最小权限和 frame fallback 行为的回归断言。 | 测试没有完整锁定精确权限列表，以及 `match_about_blank` / `match_origin_as_fallback` 不存在的契约。 | `extension/src/manifest.test.ts` | `npm.cmd run test --workspace extension -- src/manifest.test.ts --run` | 1 file / 2 tests passed |
| 2 / `9aeb2ef` | `vitest:resume-visible-root:hidden-root-selected:extension/src/parser/adapters/resume.ts` | 同类 resume root 同时存在时，隐藏 root 可能先于可见 root 被选中。 | root 选择只取首个 selector 命中项，没有先过滤可见性。 | `extension/src/parser/adapters/resume.test.ts`；`extension/src/parser/adapters/resume.ts` | `npm.cmd run test --workspace extension -- src/parser/adapters/resume.test.ts --run` | 5 passed |
| 3 / `5f23a8a` | `vitest:adapter-root-selection:hidden-first-nested-duplicate:extension/src/parser/adapters/resume.ts` | hidden-first 结构和嵌套重复节点产生了新的字段重复或错误 root 证据。 | 可见性判断和嵌套 section 去重边界不足，adapter 会纳入隐藏或已由父节点覆盖的内容。 | `extension/src/parser/adapters/recommend.test.ts`；`extension/src/parser/adapters/resume.test.ts`；`extension/src/parser/adapters/resume.ts`；`extension/src/parser/dom.ts` | `npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts src/parser/adapters/resume.test.ts --run` | 11 passed |
| 4 / `2001dff` | `vitest:coordinator-root-errors:observation-root-exception:extension/src/parser/coordinator.ts` | observation-root 的 `querySelectorAll` 同步异常被静默吞掉，没有发送脱敏的 safe error snapshot。 | observation-root lookup 的 `catch` 只阻止异常外泄，没有 emit error snapshot。 | `extension/src/parser/coordinator.test.ts`；`extension/src/parser/coordinator.ts` | `npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts --run` | 7 passed |
| 5 / `4f8087e` | `vitest:coordinator-observer-relay:attribute-mutation-and-retry-dedupe:extension/src/parser/coordinator.ts` | 同一审查批次出现两个新 finding：`active` / `is-active` 的 class 或 `aria-selected` 只发生属性变化时未触发 observer；`sendMessage` rejection 前 dedupe key 已提交，使相同内容不能重试。 | observer 缺少 `attributes` 和相应 `attributeFilter`；dedupe 没有分离 successful key 与 inflight key。 | `extension/src/parser/coordinator.test.ts`；`extension/src/parser/coordinator.ts` | `npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts --run` | 10 passed |
| 6 / `81306f2` | `vitest:parser-routing-ack:false-ack-and-rejection-accepted:extension/src/background.ts` | false ACK、background promise rejection 和 refresh rejection 会被当作成功或形成未处理拒绝。 | routing / relay 边界只覆盖同步返回，没有把 false ACK 与 rejected transport 统一视为失败并安全重试。 | `extension/src/background.test.ts`；`extension/src/background.ts`；`extension/src/parser/coordinator.test.ts`；`extension/src/parser/coordinator.ts`；`extension/src/parser/router.test.ts` | `npm.cmd run test --workspace extension -- src/parser/router.test.ts src/background.test.ts src/parser/coordinator.test.ts --run` | 39 passed |
| 7 / `15321cf` | `vitest:parser-client:logged-out-watermark-regression:extension/src/parser/client.ts`<br>`vitest:page-reading-card:core-field-coverage-missing:extension/src/components/PageReadingCard.tsx` | 两个新 finding：candidate `t2` 后接受更旧的 logged-out `t1` 作为安全状态时，delayed / equal candidate `t2` 存在恢复候选人预览的风险；UI 没有显示五个 core fields 的覆盖率。 | relay 选择只比较当前显示项的 `captured_at`，接受旧 logged-out 后会丢失已经观察到的最大 candidate 时间，需要保留 watermark 并只允许真正更新的 candidate 恢复；PageReadingCard 没有按五个 core fields 计算和呈现覆盖率。 | `extension/src/components/PageReadingCard.test.tsx`；`extension/src/components/PageReadingCard.tsx`；`extension/src/parser/client.test.ts`；`extension/src/parser/client.ts` | `npm.cmd run test --workspace extension -- src/parser/client.test.ts src/components/PageReadingCard.test.tsx --run` | 31 passed |
| 8 / `d48594a` | `cmd:python-runtime-discovery:py-launcher-unregistered:scripts/python.cmd` | pre-repair closure 在 backend 启动前输出 `No installed Python found!`；`py -0p` 同样没有发现已安装解释器，但 `%LocalAppData%/Programs/Python/Python314/python.exe` 与工作树 venv 依赖实际存在。 | 启动脚本只调用 `py -3.14`，没有在 Windows Python launcher 未注册解释器时回退到已安装 runtime。 | `scripts/python.cmd` | `scripts\python.cmd --version`；`npm.cmd run test:backend`；受控 exit code 透传检查 | Python 3.14.6；12 passed；实际 `$LASTEXITCODE` 为 7 |

## Task 8 最终完整闭合

### 自动 baseline

2026-07-29 在 commit `c211e82` 按顺序各执行一次：

| 命令 | Exit code | 已观察结果 |
|---|---:|---|
| `npm.cmd run test:extension` | 0 | 14 个 test files、135 tests passed，0 failed |
| `npm.cmd run typecheck:extension` | 0 | `tsc --noEmit` 无错误 |
| `npm.cmd run build:extension` | 0 | `content.js` 226.53 kB、gzip 70.74 kB；`background.js` 3.96 kB、gzip 1.68 kB |

生产代码安全扫描按计划执行一次。`rg` exit code 为 1 且无输出，表示在 `extension/src/parser` 与 `extension/src/content.tsx` 的非测试文件中没有匹配 `chrome.debugger`、`fetch(`、`.click(`、`.focus(`、`scrollTo(`、指定 `location` 导航、`innerHTML`、`outerHTML`、Cookie、storage 或 debug log。baseline 与扫描没有发现新问题；随后 pre-repair closure 暴露了解释器发现问题，并使用第 8 轮完成最小修复。修复循环最终为 8 / 8。

### Pre-repair closure attempt

首次 closure attempt 执行：

```powershell
npm.cmd run verify
```

已观察结果：exit code 1。命令在第一步 `scripts\python.cmd -m pytest backend/tests -q` 终止，输出 `No installed Python found!`；由于命令使用 `&&` 串联，本次 attempt 内的 extension tests、typecheck 和 build 均未执行。此失败事实没有被后续结果覆盖或删除。

只读诊断与聚焦验证事实：

- `scripts/python.cmd` 固定调用 `py -3.14`；`py -0p` exit code 1，输出 `No installed Pythons found!`。
- Python 3.14.6 基础解释器与工作树 `.venv` 均存在；直接使用基础解释器但不提供 venv 依赖时，`python -m pytest` exit code 1，输出 `No module named pytest`。
- 将工作树 `.venv/Lib/site-packages` 作为 `PYTHONPATH` 后，使用同一基础解释器运行 `backend/tests -q` exit code 0，12 passed，0 failed。这证明该次失败发生在 `scripts/python.cmd` 的解释器发现边界，不能证明完整 `verify` 已通过。

第 8 轮仅修改 `scripts/python.cmd`：先用无副作用命令探测 `py -3.14`，不可用时回退到 `%LocalAppData%/Programs/Python/Python314/python.exe`，同时保留原有 venv `PYTHONPATH`。解释器一经选择，只执行一次传入命令并透传退出码；找不到 runtime 时明确返回非零。

聚焦验证：

| 命令 | Exit code | 已观察结果 |
|---|---:|---|
| `scripts\python.cmd --version` | 0 | `Python 3.14.6` |
| `npm.cmd run test:backend` | 0 | 12 passed，0 failed |
| `scripts\python.cmd -c "import sys; sys.exit(7)"` | 7 | PowerShell `$LASTEXITCODE` 观察为 7；未回退重跑 |

### Post-repair final closure

修复提交 `d48594a` 后，final closure 执行一次：

```powershell
npm.cmd run verify
```

已观察结果：exit code 0。

| 检查 | 已观察结果 |
|---|---|
| backend | 12 passed，0 failed |
| extension | 14 个 test files、135 tests passed，0 failed |
| TypeScript | `tsc --noEmit` exit 0 |
| content build | `content.js` 226.53 kB，gzip 70.74 kB |
| background build | `background.js` 3.96 kB，gzip 1.68 kB |

### 构建 Manifest 检查

读取 post-repair final closure 生成的 `extension/dist/manifest.json`，命令 exit code 0，观察到：

- content script 只有 `content.js`，`all_frames` 为 `true`；
- matches 为 `https://www.zhipin.com/*` 与 `http://127.0.0.1/*`；
- permissions 为 `clipboardWrite`、`storage`，不含 `debugger` 或 `scripting`；
- host permissions 只有 `http://127.0.0.1:8765/*`。

当前自动验证状态：post-repair final closure 通过；未登录 Chrome smoke 与登录后人工验收仍未执行，不能宣称 M2 完成。

## 未登录手工安全冒烟

执行状态：未执行（Chrome 标签页控制连接阻塞）。

- 2026-07-29，用户明确确认当前 Chrome BOSS 会话已经登出，并授权开始未登录 smoke。
- Chrome 只读标签页列表观察到唯一的 `https://www.zhipin.com/` 首页；连续 3 次尝试接管该标签页均在读取任何页面内容之前超时，因此按 stop 条件终止。
- 已观察验收项目：0。没有刷新、点击、滚动、跳转、输入或读取候选人信息，也没有改变账号状态。
- 未观察“一个悬浮窗”“BOSS 当前未登录”、重新读取、60 秒稳定性或 Network 行为。
- 因此未登录 smoke 没有通过或失败结果，也不能证明真实候选人字段准确率。

## 登录后人工解析验收

执行状态：进行中，尚未达到完成门槛。

- 匿名授权样本数：1。
- 准确率：未计算。
- 当前只完成 `skills=fail` 的人工对比：BOSS 页面可见“专业技能”，读取结果显示缺少技能。工作、教育、项目和工作年限尚未逐字段确认，不记为通过或失败。
- 尚无自动操作、自动刷新或 stale candidate 的人工观察结果。

未来计算口径（尚未应用于任何样本）：numerator 只统计 `pass`；`partial` 和 `fail` 属于 present、保留在 denominator 但不计 correct；`not_present` 排除 denominator。denominator 只汇总至少 5 个样本中每页实际 present 的五个 core fields。若 total present core fields 为 `0`，不得计算准确率，也不得判定通过。

## 数据记录边界

后续 Task 8 只允许记录匿名 `sample_id`、字段级结果、自动行为观察和汇总准确率；不记录真实字段值，不保存任何真实候选人 HTML、截图、姓名、电话、邮箱或简历正文。

## 明确延期

- LLM 评分、证据分析和话术生成。
- 正式候选人评估与 92% 演示评估替换。
- SQLite 或其他持久化。
- 阿里云部署、HTTPS 服务端鉴权和跨平台交付。
- 账号、权限和多人协作。
- 自动点击、滚动、导航、打开候选人、翻页、输入、采集或发送消息。

## 2026-08-07 Vue 精确简历读取与来源合并

### 能力确认

- 匿名样本 `sample-01` 由用户手动打开候选人并点击一次“读取当前简历”。
- 已观察到可见 `.lib-resume-recommend`、Vue 2 和 `resumeInfo`；允许字段 4，工作数组 1、教育数组 2、项目数组 1。
- 能力阶段只记录字段名与数量，没有记录候选人字段值。

### 白名单映射

- MAIN world 读取只访问固定 Vue 入口与已确认字段路径；限制可见根、遍历元素、祖先层级、数组条目与字符串长度。
- 不递归枚举 Vue 状态，不序列化任意对象，不读取 Cookie、Token、浏览器存储或请求头。
- Task 4 聚焦测试 4 个文件、38 个测试通过；当时扩展全量 19 个测试文件、211 个测试通过；类型检查和生产构建通过。
- 提交：`74ca305 feat: map authorized BOSS Vue resume data`。

### 来源合并自检循环

| 轮次 | 唯一问题指纹 | 新证据 | 修复 | 聚焦结果 |
|---:|---|---|---|---|
| 1 | `candidate-source-composition-missing` | 新增来源、会话、未登录优先和界面用例后 6 项按预期失败 | 实现会话化 Vue/DOM 合并与来源标签 | 3 个文件、73 项通过 |
| 2 | `vue-empty-array-restored-stale-dom` | Vue 明确返回空工作数组时，旧 DOM 工作项被错误补回 | 以能力字段存在性判定 Vue 数组权威性 | 3 个文件、74 项通过 |

### 完整闭合

- 受限终端首次执行 `npm.cmd run verify` 时，项目脚本在测试启动前无法看见用户目录中的 Python 3.14；这属于执行环境失败，不是测试失败。
- 在可访问本机 Python 3.14 的终端重新执行同一标准命令，exit code 0：backend 12 passed；extension 19 个 test files、217 tests passed；`tsc --noEmit` exit 0；content/background production build exit 0。
- 本轮安全扫描未发现新增的自动点击、聚焦、滚动、BOSS 网络请求、浏览器存储、Cookie 或 debugger 使用。
- 尚未完成 5 个授权匿名样本的字段级人工验收，因此暂不计算准确率，也不宣布 Vue 读取阶段最终通过。

### 技能缺失诊断

- 唯一问题指纹：`skill-present-but-skillTagList-absent`。
- 匿名样本的读取结果为工作 1、教育 2、项目 4、技能缺失；用户对比确认 BOSS 页面存在“专业技能”正文。
- 现有能力结果只命中 4 个字段，数组仅为工作、教育、项目，未命中 `skillTagList`。
- 重新静态检查公开参考插件离线包，SHA-256 仍为 `AF2727353265B68EAA6AACBD4F2E8B80A08488562C46656CE4C42832AF5A4548`；其技能路径同样只有 `skillTagList`，因此不能直接复用来修复该样本。临时下载与解压文件已删除。
- 本轮只增加由用户点击触发的 `resumeInfo` 顶层 schema 诊断：最多 40 个安全键名、固定类型和最大 50 的数组长度；不返回任何值，不持久化，不新增自动操作。
- 代码审查发现 `schema-warning-budget-overflow`：完整 schema 诊断最多产生 53 条 warning，旧校验上限 40 会使客户端安全丢弃整个读取结果。失败测试确认该问题后，将上限仅对 `boss-vue-v1` 调整为 64；DOM 快照仍为 40，65 条 Vue warning 仍被拒绝。
- 完整验证：`npm.cmd run verify` exit code 0；后端 12 项、扩展 19 个测试文件 218 项通过，类型检查与两种扩展构建通过。安全扫描未匹配自动点击、聚焦、滚动、BOSS 网络请求、浏览器存储、Cookie 或 debugger 使用。
- 顶层 schema 人工证据：返回 40 个安全键名，存在 `geekDetailInfo`，不存在 `skillTagList`；全部显示 `other`，符合 Vue 2 访问器属性不调用 getter 的诊断设计。唯一问题指纹更新为 `skill-not-in-top-level-resumeInfo`。
- 公开检索没有找到可验证的 `geekDetailInfo` 内部字段结构，因此不依据网络猜测字段名。
- 下一步实现只读取固定 `resumeInfo.geekDetailInfo` 一次，并仅枚举直接子字段结构；不检查 `geekQuestInfoVO` 或其他顶层容器，不输出字段值。
- TDD 自检发现并修复 `nested-schema-key-coercion`：嵌套校验器曾在确认键为字符串前调用 `String(key)`；失败测试证明可触发不可信 `toString` 后，已改为先做类型检查。
- 最终代码审查发现并修复 `nested-schema-read-before-selection`：多 Vue handle 场景曾在选出最丰富候选人前读取每个 handle 的 `geekDetailInfo`。失败测试确认问题后，将下一层读取延后到排序完成；未选中的 getter 调用 0 次，选中的 getter 调用 1 次。
- 下一层诊断构建验证：`npm.cmd run verify` exit code 0；后端 12 项、扩展 19 个测试文件 218 项通过，类型检查和 content/background production build 通过。安全扫描无匹配。
- 在真实下一层 schema 证据返回之前，不猜测技能字段名，也不宣布技能问题已经修复。

## 未登录公开职位临时探针（已中止）

- 日期：2026-07-30。
- 页面状态：实际显示招聘端“推荐牛人”界面，并非预定的未登录公开职位页；BOSS 页面同时显示登录状态失效和数据加载异常提示。
- 扩展状态：页面读取卡显示当前页面结构暂不支持，评分仍为演示数据。
- 人工探针触发次数：0；用户未点击“重新读取页面”，因此未产生探针输出。
- Console 观察：截图中未观察到 `[ARC public job probe]`。
- 字段核对：未执行。
- 停止条件：打开 BOSS 页面 DevTools 后观察到页面状态变化，且页面并非预定目标；用户按协议停止且未重试。
- 60 秒观察：未执行，无结论。
- Network / localhost health：均未执行，无结论。
- 归因边界：只能确认时间上的现象，无法确认上述状态由打开 DevTools、会话自身过期、BOSS 机制、扩展或其他因素造成；不能据此推断反爬结论或后续 HR 登录安全性。
- 后续：进入临时探针强制清理，不再重复本次试探。
- 清理验证：临时读取器、对应测试、调用点与 `[ARC public job probe]` Console 前缀均已删除；最终构建 `extension/dist/content.js` 的该前缀匹配次数为 0。
- 完整验证：fresh `npm.cmd run verify` exit 0；后端 12 项测试通过；扩展 14 个测试文件、135 项测试通过、失败 0；类型检查 exit 0；`content.js` 226.53 kB（gzip 70.74 kB），`background.js` 3.96 kB（gzip 1.68 kB）。
