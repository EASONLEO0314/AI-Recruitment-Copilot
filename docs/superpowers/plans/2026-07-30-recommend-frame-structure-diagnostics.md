# 推荐页结构诊断实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不读取候选人正文的前提下，把新版 BOSS 推荐 iframe 的安全结构指纹显示在插件中，为下一步准确适配提供证据。

**Architecture:** 推荐页解析器在旧版卡片选择失败时，通过现有 `warnings` 生成限长、白名单 class token；页面读取卡仅在 `recommend_frame + unsupported` 状态展示这些安全诊断项。消息契约、后台路由和正式候选人字段保持不变。

**Tech Stack:** TypeScript、React、Vitest、Testing Library、Manifest V3 content script

---

### Task 1：生成安全结构诊断

**Files:**
- Modify: `extension/src/parser/adapters/recommend.test.ts`
- Modify: `extension/src/parser/adapters/recommend.ts`

- [ ] **Step 1：先写失败测试**

在无旧版卡片但存在结构 class 的 fixture 中断言：warnings 包含固定原因、card count 和白名单 class；不包含 textContent、ID、data 属性、超长或非白名单 token；总数不超过 20。

- [ ] **Step 2：运行 RED**

```powershell
npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts --run
```

预期：新增断言失败，因为旧实现只有 `recommend-active-card-not-found`。

- [ ] **Step 3：最小实现**

在 `recommend.ts` 中增加纯 DOM helper，遍历可见元素的 `classList`，按设计白名单、格式、去重和数量边界生成 warnings；仅在找不到可用卡片时调用。

- [ ] **Step 4：运行 GREEN**

重复聚焦命令，预期全部通过。

### Task 2：在页面读取卡显示安全诊断

**Files:**
- Modify: `extension/src/components/PageReadingCard.test.tsx`
- Modify: `extension/src/components/PageReadingCard.tsx`

- [ ] **Step 1：先写失败测试**

构造 `recommend_frame + unsupported` 快照，断言显示友好状态、card count 和结构 class；任意普通 warning 及候选人内容不得显示。

- [ ] **Step 2：运行 RED**

```powershell
npm.cmd run test --workspace extension -- src/components/PageReadingCard.test.tsx --run
```

预期：新增诊断 UI 断言失败。

- [ ] **Step 3：最小实现**

只解析 `structure:card-count=` 与 `structure:class=` 前缀，并在推荐页 unsupported 分支渲染；其他状态保持原行为。

- [ ] **Step 4：运行 GREEN**

重复聚焦命令，预期全部通过。

### Task 3：验证并构建临时诊断版本

**Files:**
- Build output: `extension/dist/*`

- [ ] **Step 1：运行目标测试与类型检查**

```powershell
npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts src/components/PageReadingCard.test.tsx --run
npm.cmd run typecheck:extension
```

- [ ] **Step 2：运行扩展全量测试和构建**

```powershell
npm.cmd run test:extension
npm.cmd run build:extension
```

- [ ] **Step 3：运行生产安全扫描**

```powershell
rg -n --glob "!*.test.ts" --glob "!*.test.tsx" "chrome\.debugger|fetch\(|\.click\(|\.focus\(|scrollTo\(|location\.(assign|replace|reload)|innerHTML|outerHTML|document\.cookie|localStorage|sessionStorage|console\.(log|debug|info)" extension/src/parser extension/src/content.tsx
```

预期：exit code 1 且无输出。

- [ ] **Step 4：提交并交给用户复测**

只暂存上述四个源码/测试文件和两份中文文档，绝不暂存 `extension/dist.crx`、`extension/dist.pem`。提交信息：

```text
test: add temporary recommend structure diagnostics
```

用户刷新 unpacked extension，保持当前候选人详情打开，点击一次“重新读取页面”，只截取页面读取诊断区域。
