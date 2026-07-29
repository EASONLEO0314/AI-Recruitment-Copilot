# M1 自检与修复循环记录

日期：2026-07-28

规则：每个阶段最多 8 轮；按问题指纹去重；修复后只运行受影响检查；阶段闭合时运行一次阶段全量检查；最终再运行一次项目全量检查。相同指纹若没有新证据，不重复应用同一修复。

## Task 1：项目基础配置

使用轮次：2 / 8

| 轮次 | 唯一问题指纹 | 根因与修复 | 定向验证 | 结果 |
|---|---|---|---|---|
| 1 | `plan:premature-build:missing-content-entry` | 计划在创建 `content.tsx` 前要求构建。将 Task 1 改为 Manifest JSON 校验，正式构建移至 Task 4。 | `Get-Content -Raw extension/public/manifest.json \| ConvertFrom-Json` | 通过，Manifest V3 可解析。 |
| 2 | `python:venv-launcher:unicode-workspace-path` | 沙箱内直接调用 venv 启动器未能启动测试。增加 `scripts/python.cmd`，使用系统 `py -3.14` 并加载 `.venv` site-packages。 | `scripts\python.cmd -m pytest backend\tests\test_scoring.py -q` | Python 成功启动；测试按预期因模块尚未实现而红灯。 |

## Task 2：后端演示 API

使用轮次：1 / 8

| 轮次 | 唯一问题指纹 | 根因与修复 | 定向验证 | 结果 |
|---|---|---|---|---|
| 1 | `pytest:StarletteDeprecationWarning:httpx` | Starlette 1.3.1 已优先使用 `httpx2`，旧 `httpx` 触发弃用警告。依赖改为 `httpx2`。 | `scripts\python.cmd -m pytest backend\tests\test_health.py backend\tests\test_demo_assessment.py -q` | 3 个测试通过，警告消失。 |

阶段闭合：`scripts\python.cmd -m pytest backend\tests -q` → 10 passed，0 warning。

## Task 3：扩展 API 客户端

使用轮次：1 / 8

| 轮次 | 唯一问题指纹 | 根因与修复 | 定向验证 | 结果 |
|---|---|---|---|---|
| 1 | `tsc:config-types:three-errors` | 缺少 Node 类型；配置从 `vite` 导入的类型不包含 Vitest 字段；错误对象断言泛型过严。增加 `@types/node`，改从 `vitest/config` 导入，收窄断言。 | `npm.cmd run typecheck --workspace extension` | 通过，0 错误。 |

定向回归：`npm.cmd run test --workspace extension -- src/api.test.ts --run` → 4 passed。

## Task 4：悬浮窗与 Shadow DOM

使用轮次：4 / 8

| 轮次 | 唯一问题指纹 | 根因与修复 | 定向验证 | 结果 |
|---|---|---|---|---|
| 1 | `vitest:dom-not-cleaned:duplicate-panels` | 测试之间没有清理 DOM，使多个面板叠加。测试 setup 增加 Testing Library `cleanup()`。 | 组件测试文件 | 原 4 个重复元素失败收敛为 1 个剪贴板测试问题。 |
| 2 | `vitest:user-event:clipboard-mock-replaced` | `userEvent.setup()` 替换了预先注入的 clipboard mock。改为 setup 后监听实际 clipboard。 | `...CopilotPanel.test.tsx --run -t "copies the active message"` | 1 passed，5 skipped。 |
| 3 | `vitest:css-inline-and-react-commit-timing` | Vitest 的 inline CSS 转换为空，且 React 19 渲染提交为异步。测试固定 CSS 模块值并等待提交，不修改产品逻辑。 | `npm.cmd run test --workspace extension -- src/content.test.tsx --run` | 1 passed。 |
| 4 | `vite:ignored-inlineDynamicImports` | Vite 8 已关闭该入口的代码拆分，显式选项被忽略。删除无效配置。 | `npm.cmd run build --workspace extension` | 构建通过，无警告。 |

阶段闭合事实：

- `npm.cmd run test:run --workspace extension` → 3 files、11 tests passed。
- `npm.cmd run typecheck --workspace extension` → 通过，0 错误。
- `npm.cmd run build --workspace extension` → 构建通过；`content.js` 206,570 字节，gzip 65.05 kB。
- 产物检查确认 Manifest V3、入口 `content.js`、Shadow CSS 字符串和重复挂载标识存在。

## 代码审查前闭合

已执行的运行时烟雾检查：

- 隐藏启动 Uvicorn 后，`GET /healthz` 实际返回 `status=ok`、`service=ai-recruitment-copilot`。
- 使用 Node 原生 `fetch` 发送 UTF-8 中文候选人标签，实际响应为 `candidate_label=张同学`、`total_score=92`、4 个维度、3 类话术。
- 烟雾测试结束后已关闭对应后端进程。

最终命令：`npm.cmd run verify`

最终结果：

- 后端：10 passed，0 failed，0 warning。
- 扩展：3 个测试文件、11 passed，0 failed。
- TypeScript：`tsc --noEmit` 通过，0 error。
- 生产构建：Vite 8.1.5 构建通过，16 个模块；`content.js` 206.57 kB，gzip 65.05 kB；0 warning。
- 该次闭合没有发现新问题，因此使用 0 个修复轮次，没有重复运行全量流程。

Chrome 扩展尚未安装到浏览器，因此真实浏览器中的视觉、折叠、剪贴板和原页面兼容性仍属未验证项，留给明日人工验收。

## 独立代码审查后的定向修复

使用轮次：1 / 8

| 轮次 | 唯一问题指纹 | 根因与处理 | 定向验证 | 结果 |
|---|---|---|---|---|
| 1 | `chrome:content-script-cross-origin:localhost` | Chrome 官方文档确认内容脚本按网页来源受同源策略约束；将本机请求移到 MV3 Service Worker，内容脚本只发送类型化消息，后台只接受 `health` 和 `demo-assessment` 两个固定操作。 | API/后台定向测试、Manifest 测试、类型检查、双入口构建 | 定向检查通过，生成 `content.js` 与 `background.js`。 |
| 1 | `extension:unvalidated-runtime-response` | 原客户端只做 TypeScript 断言。增加健康与评估响应的运行时结构校验，格式错误返回 `INVALID_RESPONSE`。 | `src/api.test.ts` | 包括畸形响应在内的 6 个客户端测试通过。 |
| 1 | `ui:copy-feedback-not-temporary` | “已复制”没有自动清除。增加 1.8 秒定时清除和卸载清理。 | 单独运行复制反馈定时测试 | 1 passed，6 skipped。 |

审查意见的证据核验：

- 审查者认为本机 CORS 正则转义错误；新增合法本机来源和任意网页来源的 preflight 测试后，3 个健康/CORS 测试通过，因此没有无依据修改正则。
- 审查者的只读沙箱无法调用宿主 `py`；主任务已通过受控宿主执行重复运行 Python 测试，并真实启动 Uvicorn 完成 HTTP 烟雾检查，因此该现象归类为审查沙箱限制，不是用户环境中的已证实产品缺陷。

## 最终闭合

最终命令：`npm.cmd run verify`

审查修复后的最终事实：

- 后端：12 passed，0 failed，0 warning。
- 扩展：5 个测试文件、20 passed，0 failed。
- TypeScript：`tsc --noEmit` 通过，0 error。
- 生产构建：Vite 8.1.5 双入口构建通过；`content.js` 208.06 kB（gzip 65.41 kB），`background.js` 1.29 kB（gzip 0.71 kB）；0 warning。
- 最终构建的 Manifest 为 V3，声明 `background.js` Service Worker、`content.js` 内容脚本，host permission 仅为 `http://127.0.0.1:8765/*`。
- 最终闭合没有发现新问题，使用 0 个额外修复轮次，没有再次运行全量流程。

Chrome 人工验收仍未执行；真实浏览器视觉、复制权限和 BOSS 页面兼容性不能标记为通过。

## 8. 2026-07-29 Review follow-up

外部复核确认在线状态没有再次执行连接检查的入口，因此原 README 中“停止后端后点击重新连接”的步骤无法从在线界面触发。本轮按新问题执行定向红绿修复：

- 新增在线刷新回归测试。修复前测试稳定失败于缺少“刷新连接”按钮；修复后在线状态提供手动刷新入口并复用既有连接流程。
- 强化时序测试：第二次健康检查保持 pending 时，界面必须已进入“正在连接”、清除旧的 `92%` 结果并隐藏刷新入口；请求失败后再进入离线状态。
- 新增离线恢复测试：服务恢复后点击“重新连接”，重新加载在线演示评估。
- 新增复制反馈回归测试。修复前刷新后旧“已复制”提示仍存在；修复后连接开始时清理提示及其计时器。
- 刷新按钮最小点击高度调整为 24px，文字字号调整为 10px。
- 组件定向测试最终为 10 passed、0 failed。

本轮完整验证只执行一次。沙箱内首次尝试因无法发现主机 Python 而在后端测试启动前退出；随后在主机环境执行 `npm.cmd run verify`，实际结果为：

- 后端：12 passed，0 failed。
- 扩展：5 个测试文件、23 passed，0 failed。
- TypeScript：`tsc --noEmit` 通过。
- 生产构建：`content.js` 和 `background.js` 双入口构建通过。

M1 代码实现及自动化验证已完成；Chrome 人工验收仍未执行，因此 M1 整体验收仍不能标记为完成。
