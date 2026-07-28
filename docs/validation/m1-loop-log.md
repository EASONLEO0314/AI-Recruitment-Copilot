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

## 最终闭合

已执行的运行时烟雾检查：

- 隐藏启动 Uvicorn 后，`GET /healthz` 实际返回 `status=ok`、`service=ai-recruitment-copilot`。
- 使用 Node 原生 `fetch` 发送 UTF-8 中文候选人标签，实际响应为 `candidate_label=张同学`、`total_score=92`、4 个维度、3 类话术。
- 烟雾测试结束后已关闭对应后端进程。

最终全量自动验证尚未执行。Chrome 扩展也尚未安装到浏览器，因此真实浏览器中的视觉、折叠、剪贴板和原页面兼容性仍属未验证项。最终执行后在此处记录实际命令、通过数、失败数和未验证项；不得提前填写成功结论。
