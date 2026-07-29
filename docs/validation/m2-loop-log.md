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

## Task 8 最终完整闭合

### 自动 baseline

2026-07-29 在 commit `c211e82` 按顺序各执行一次：

| 命令 | Exit code | 已观察结果 |
|---|---:|---|
| `npm.cmd run test:extension` | 0 | 14 个 test files、135 tests passed，0 failed |
| `npm.cmd run typecheck:extension` | 0 | `tsc --noEmit` 无错误 |
| `npm.cmd run build:extension` | 0 | `content.js` 226.53 kB、gzip 70.74 kB；`background.js` 3.96 kB、gzip 1.68 kB |

生产代码安全扫描按计划执行一次。`rg` exit code 为 1 且无输出，表示在 `extension/src/parser` 与 `extension/src/content.tsx` 的非测试文件中没有匹配 `chrome.debugger`、`fetch(`、`.click(`、`.focus(`、`scrollTo(`、指定 `location` 导航、`innerHTML`、`outerHTML`、Cookie、storage 或 debug log。没有发现新的明确问题，因此没有使用第 8 轮定向修复；修复循环仍为 7 / 8。

### 最终 closure

最终命令按计划只执行一次：

```powershell
npm.cmd run verify
```

已观察结果：exit code 1。命令在第一步 `scripts\python.cmd -m pytest backend/tests -q` 终止，输出 `No installed Python found!`；由于命令使用 `&&` 串联，本次 closure 内的 extension tests、typecheck 和 build 均未执行。因此当前 M2 没有完整闭合通过结果。

只读诊断与聚焦验证事实：

- `scripts/python.cmd` 固定调用 `py -3.14`；`py -0p` exit code 1，输出 `No installed Pythons found!`。
- Python 3.14.6 基础解释器与工作树 `.venv` 均存在；直接使用基础解释器但不提供 venv 依赖时，`python -m pytest` exit code 1，输出 `No module named pytest`。
- 将工作树 `.venv/Lib/site-packages` 作为 `PYTHONPATH` 后，使用同一基础解释器运行 `backend/tests -q` exit code 0，12 passed，0 failed。这证明该次失败发生在 `scripts/python.cmd` 的解释器发现边界，不能证明完整 `verify` 已通过。

### 构建 Manifest 检查

读取 baseline build 生成的 `extension/dist/manifest.json`，命令 exit code 0，观察到：

- content script 只有 `content.js`，`all_frames` 为 `true`；
- matches 为 `https://www.zhipin.com/*` 与 `http://127.0.0.1/*`；
- permissions 为 `clipboardWrite`、`storage`，不含 `debugger` 或 `scripting`；
- host permissions 只有 `http://127.0.0.1:8765/*`。

当前自动验证状态：extension baseline 通过；backend 聚焦测试通过；完整 `npm.cmd run verify` 未通过。未登录 Chrome smoke 与登录后人工验收仍未执行，不能宣称 M2 完成。

## 未登录手工安全冒烟

执行状态：未执行。

- 已观察项目：0。
- 未访问或控制 Chrome / BOSS 页面。
- 未观察“一个悬浮窗”“BOSS 当前未登录”、重新读取、60 秒稳定性或 Network 行为。
- 因此未登录 smoke 没有通过结果，也不能证明真实候选人字段准确率。

## 登录后人工解析验收

执行状态：未执行。

- 样本数：0。
- 准确率：未计算。
- 尚无 `work_experience`、`education`、`projects`、`skills` 或 `experience_years` 的字段级 pass / partial / fail / not_present 记录。
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
