# BOSS `geekDetailInfo` 下一层安全诊断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户手动读取当前简历时，安全显示 `resumeInfo.geekDetailInfo` 的直接子字段名、固定类型和数组长度，以便依据真实结构定位技能字段。

**Architecture:** 复用 MAIN world 中现有的非递归 schema 枚举逻辑，新增固定容器 `geekDetailInfo` 的单层诊断；Service Worker 将严格校验后的结构编码为固定 warning，悬浮窗只解析锚定格式。保留现有顶层 40 项诊断，并把 Vue warning 硬上限精确扩展到可容纳最坏情况下的 93 项，DOM 上限不变。

**Tech Stack:** TypeScript、React、Chrome Extension Manifest V3、Vitest、Testing Library、Vite

---

## 现场问题记录

- 问题指纹：`skill-not-in-top-level-resumeInfo`。
- 授权样本的 `resumeInfo` 顶层 40 项结构中存在 `geekDetailInfo`，不存在 `skillTagList`。
- 所有顶层字段显示为 `other`，符合 Vue 2 响应式访问器属性的当前安全处理；不能据此判断容器内部为空。
- 本计划只诊断 `geekDetailInfo` 的直接子字段，不新增技能值映射。

### Task 1：MAIN world 生成并校验固定容器的下一层 schema

**Files:**
- Modify: `extension/src/parser/vueResumeMapper.ts`
- Modify: `extension/src/parser/vueResumeMapper.test.ts`
- Modify: `extension/src/background.test.ts`

- [ ] **Step 1：先写失败的 mapper 测试**

在 mapper fixture 中准备以下对象，并把它作为顶层 `geekDetailInfo` getter 的返回值：

```ts
const geekDetailInfo: Record<string, unknown> = {
  professionalSkill: '不得读取技能正文',
  skillItems: Array.from({ length: 55 }, () => '不得读取数组元素'),
};
```

给 `geekDetailInfo` 增加一个可枚举、会抛错的 `childAccessor` getter；给顶层 `resumeInfo.geekDetailInfo` 增加返回上述对象的计数 getter，给 `resumeInfo.geekQuestInfoVO` 增加另一个计数 getter。期望 `geekDetailInfo` getter 恰好调用一次、`geekQuestInfoVO` getter从不调用，并且 ready probe 新增：

```ts
nested_schema: [
  {
    container: 'geekDetailInfo',
    key: 'professionalSkill',
    type: 'string',
  },
  {
    container: 'geekDetailInfo',
    key: 'skillItems',
    type: 'array',
    array_length: 50,
  },
  {
    container: 'geekDetailInfo',
    key: 'childAccessor',
    type: 'other',
  },
]
```

断言序列化结果不含“不得读取”，`childAccessor` 未被调用，`geekQuestInfoVO` 未被读取。再增加严格校验用例，拒绝：未知容器、重复键、非法键名、未知类型、数组缺少长度、非数组携带长度以及第 41 项。

- [ ] **Step 2：运行测试确认 RED**

Run:

```powershell
npm.cmd --prefix extension run test:run -- src/parser/vueResumeMapper.test.ts src/background.test.ts
```

Expected: FAIL，原因是 ready probe 尚无 `nested_schema`，也没有固定容器校验。

- [ ] **Step 3：实现最小的固定容器单层诊断**

在 `VueResumeProfileFrameProbe` ready 分支新增必填 `nested_schema`，定义：

```ts
export interface VueResumeNestedSchemaField extends VueResumeSchemaField {
  container: 'geekDetailInfo';
}
```

将现有 `schemaFor` 重命名为接收任意记录的 `schemaForRecord`，保持以下边界不变：最多 40 项、安全键正则、访问器标记 `other`、数组长度最大 50、不访问数组元素。

新增固定实现：

```ts
const nestedSchemaFor = (
  resumeInfo: Record<string, unknown>,
): VueResumeNestedSchemaField[] => {
  const detail = safeRead(resumeInfo, 'geekDetailInfo');
  if (!isRecord(detail)) {
    return [];
  }
  return schemaForRecord(detail).map((field) => ({
    container: 'geekDetailInfo',
    ...field,
  }));
};
```

ready probe 同时返回：

```ts
schema: schemaForRecord(resumeInfo),
nested_schema: nestedSchemaFor(resumeInfo),
```

校验器必须只接受 `container: 'geekDetailInfo'`，并复用顶层 schema 的键名、类型、数组长度、数量和去重规则。同步给 `background.test.ts` 的所有 ready fixture 加入 `nested_schema: []`，避免伪造旧协议。

- [ ] **Step 4：运行聚焦测试和类型检查确认 GREEN**

Run:

```powershell
npm.cmd --prefix extension run test:run -- src/parser/vueResumeMapper.test.ts src/background.test.ts
npm.cmd --prefix extension run typecheck
```

Expected: mapper 与后台测试通过，类型检查 exit code 0。

- [ ] **Step 5：提交 MAIN world 诊断协议**

```powershell
git add extension/src/parser/vueResumeMapper.ts extension/src/parser/vueResumeMapper.test.ts extension/src/background.test.ts
git commit -m "feat: probe BOSS geek detail schema safely"
```

### Task 2：Service Worker 传递下一层结构并保持明确容量边界

**Files:**
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background.test.ts`
- Modify: `extension/src/validation.ts`
- Modify: `extension/src/validation.test.ts`

- [ ] **Step 1：先写失败的后台与容量测试**

在后台 ready probe 加入：

```ts
nested_schema: [
  {
    container: 'geekDetailInfo',
    key: 'professionalSkill',
    type: 'string',
  },
  {
    container: 'geekDetailInfo',
    key: 'skillItems',
    type: 'array',
    array_length: 50,
  },
],
```

期望 snapshot warnings 包含：

```ts
'vue-nested-schema:container=geekDetailInfo:key=professionalSkill:string',
'vue-nested-schema:container=geekDetailInfo:key=skillItems:array:50',
```

在 `validation.test.ts` 断言：`boss-vue-v1` 接受 93 条 warning、拒绝 97 条；`boss-dom-v1` 仍拒绝 41 条。

- [ ] **Step 2：运行测试确认 RED**

Run:

```powershell
npm.cmd --prefix extension run test:run -- src/background.test.ts src/validation.test.ts
```

Expected: FAIL，原因是后台尚未编码下一层结构，Vue warning 上限仍为 64。

- [ ] **Step 3：实现固定 warning 与精确上限**

在 `capabilitySnapshot` 中追加：

```ts
...probe.nested_schema.map(({ container, key, type, array_length: arrayLength }) => (
  type === 'array'
    ? `vue-nested-schema:container=${container}:key=${key}:${type}:${arrayLength}`
    : `vue-nested-schema:container=${container}:key=${key}:${type}`
)),
```

最坏情况为 3 条固定能力信息、6 个允许字段、4 个数组长度、40 个顶层字段、40 个下一层字段，共 93 条。将 `VUE_WARNING_MAX_ITEMS` 从 64 调整为 96；保持 `DOM_WARNING_MAX_ITEMS = 40`，单条字符串长度仍为 160。

- [ ] **Step 4：运行聚焦测试和类型检查确认 GREEN**

Run:

```powershell
npm.cmd --prefix extension run test:run -- src/background.test.ts src/validation.test.ts
npm.cmd --prefix extension run typecheck
```

Expected: 两个测试文件通过，类型检查 exit code 0。

- [ ] **Step 5：提交后台传输边界**

```powershell
git add extension/src/background.ts extension/src/background.test.ts extension/src/validation.ts extension/src/validation.test.ts
git commit -m "feat: relay BOSS geek detail schema safely"
```

### Task 3：悬浮窗只显示合法的 `geekDetailInfo` 下一层结构

**Files:**
- Modify: `extension/src/components/PageReadingCard.tsx`
- Modify: `extension/src/components/PageReadingCard.test.tsx`

- [ ] **Step 1：先写失败的界面测试**

给 Vue snapshot 增加：

```ts
'vue-nested-schema:container=geekDetailInfo:key=professionalSkill:string',
'vue-nested-schema:container=geekDetailInfo:key=skillItems:array:3',
'vue-nested-schema:container=geekQuestInfoVO:key=privateValue:string',
'vue-nested-schema:container=geekDetailInfo:key=bad-key:string',
'vue-nested-schema:container=geekDetailInfo:key=privateValue:string:候选人值',
```

期望显示标题 `geekDetailInfo 下一层字段（仅结构）`、`professionalSkill · 字符串`、`skillItems · 数组 3`；未知容器、非法键名和带候选人值后缀的 warning 不显示。

- [ ] **Step 2：运行测试确认 RED**

Run:

```powershell
npm.cmd --prefix extension run test:run -- src/components/PageReadingCard.test.tsx
```

Expected: FAIL，原因是界面尚未解析和显示下一层 schema。

- [ ] **Step 3：实现锚定解析与固定展示**

新增只接受固定容器的正则：

```ts
const VUE_NESTED_SCHEMA_WARNING = /^vue-nested-schema:container=(geekDetailInfo):key=([A-Za-z_$][A-Za-z0-9_$]{0,63}):(array|object|string|number|boolean|null|undefined|other)(?::([0-9]|[1-4][0-9]|50))?$/;
```

复用现有中文类型标签；数组必须带长度，非数组不得带长度，键名去重，最多显示 40 项。下一层列表使用独立 `aria-label="Vue geekDetailInfo 下一层 schema"`，不显示任何未匹配 warning。

- [ ] **Step 4：运行聚焦测试和类型检查确认 GREEN**

Run:

```powershell
npm.cmd --prefix extension run test:run -- src/components/PageReadingCard.test.tsx
npm.cmd --prefix extension run typecheck
```

Expected: 界面测试通过，类型检查 exit code 0。

- [ ] **Step 5：提交界面诊断**

```powershell
git add extension/src/components/PageReadingCard.tsx extension/src/components/PageReadingCard.test.tsx
git commit -m "feat: show BOSS geek detail schema"
```

### Task 4：更新记录、审查并构建人工诊断版本

**Files:**
- Modify: `docs/superpowers/plans/2026-08-07-boss-resume-reading-record.md`
- Modify: `docs/superpowers/plans/2026-08-07-boss-geek-detail-schema-diagnostic.md`
- Modify: `docs/validation/m2-loop-log.md`

- [ ] **Step 1：记录现场结果和本轮边界**

记录 `skill-not-in-top-level-resumeInfo`、现场顶层存在 `geekDetailInfo`、公开检索未提供可验证内部结构，以及本轮只增加固定容器下一层无值诊断。明确技能仍未修复，人工准确率不更新。

- [ ] **Step 2：运行安全扫描**

Run:

```powershell
rg -n "chrome\.debugger|webRequest|cookies|localStorage|sessionStorage|\.click\(|\.focus\(|scrollTo\(|scrollBy\(|fetch\(" extension/src/parser/vueResumeMapper.ts extension/src/background.ts extension/src/components/PageReadingCard.tsx extension/src/validation.ts
```

Expected: 无匹配；新增路径没有自动页面行为、存储、Cookie、debugger 或 BOSS 网络请求。

- [ ] **Step 3：运行完整验证**

Run:

```powershell
npm.cmd run verify
```

Expected: 后端测试、扩展测试、类型检查及 content/background 构建全部 exit code 0。

- [ ] **Step 4：审查最终差异**

Run:

```powershell
git diff --check
git diff --stat
git status --short --branch
```

Expected: 仅包含计划内代码、测试和中文记录；`extension/dist.crx`、`extension/dist.pem` 保持未跟踪且不暂存。

- [ ] **Step 5：提交记录**

```powershell
git add docs/superpowers/plans/2026-08-07-boss-resume-reading-record.md docs/superpowers/plans/2026-08-07-boss-geek-detail-schema-diagnostic.md docs/validation/m2-loop-log.md
git commit -m "docs: record geek detail schema diagnostic"
```

- [ ] **Step 6：人工诊断门槛**

用户重新加载当前 worktree 的 `extension/dist`，打开同一候选人并手动点击一次“读取当前简历”。只有界面显示 `geekDetailInfo 下一层字段（仅结构）` 且不包含候选人正文，才视为本轮诊断通过；仍不得宣布技能映射已修复。
