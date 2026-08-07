# BOSS 简历技能字段安全诊断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有用户点击触发的 Vue 简历读取中，增加不含候选人值的 `resumeInfo` 顶层 schema 诊断，以精准定位当前 BOSS 版本的专业技能字段。

**Architecture:** MAIN world 映射器通过自有属性描述符生成受限 schema；Service Worker 严格校验后把它编码为固定 warning；页面读取卡只解析并显示安全字段名、类型和数组长度。现有 Vue profile、DOM 合并和演示评估保持不变。

**Tech Stack:** TypeScript、Chrome MV3 `chrome.scripting`、React、Vitest、Testing Library

---

### Task 1：生成并校验安全顶层 schema

**Files:**
- Modify: `extension/src/parser/vueResumeMapper.ts`
- Modify: `extension/src/parser/vueResumeMapper.test.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background.test.ts`

- [x] **Step 1：先写失败测试**

在 mapper fixture 中加入普通字段、长度超过 50 的数组、非法键名和会抛错的 getter，期望结果包含：

```ts
schema: [
  { key: 'geekBaseInfo', type: 'object' },
  { key: 'professionalSkillInfo', type: 'string' },
  { key: 'unknownList', type: 'array', array_length: 50 },
  { key: 'accessorField', type: 'other' },
]
```

断言序列化结果不包含任何 fixture 字段值，非法键名被忽略，字段总数不超过 40。后台测试要求生成严格格式：

```ts
'vue-schema:key=professionalSkillInfo:string'
'vue-schema:key=unknownList:array:50'
```

- [x] **Step 2：运行测试确认 RED**

Run:

```powershell
npm.cmd run test --workspace extension -- src/parser/vueResumeMapper.test.ts src/background.test.ts --run
```

Expected: FAIL，原因是 ready probe 尚无 `schema`，后台尚未输出 `vue-schema` warning。

- [x] **Step 3：最小实现 schema 生成与校验**

新增固定类型：

```ts
type VueResumeSchemaType =
  | 'array' | 'object' | 'string' | 'number'
  | 'boolean' | 'null' | 'undefined' | 'other';

interface VueResumeSchemaField {
  key: string;
  type: VueResumeSchemaType;
  array_length?: number;
}
```

使用 `Object.getOwnPropertyDescriptors(resumeInfo)`；只保留可枚举且符合 `^[A-Za-z_$][A-Za-z0-9_$]{0,63}$` 的前 40 个字符串键。访问器属性直接标记为 `other`，不调用 getter；数据属性只判断固定类型，数组长度截断至 50，不访问数组元素。校验器拒绝未知键、未知类型、重复字段、越界长度，以及非数组类型携带 `array_length`。

后台只把已经校验的 schema 转成 `vue-schema:key=<key>:<type>[:<length>]` warning。

- [x] **Step 4：运行聚焦测试确认 GREEN**

实际结果：RED 阶段 7 项按预期失败；GREEN 阶段 2 个测试文件、26 项测试通过，类型检查 exit code 0。

Run:

```powershell
npm.cmd run test --workspace extension -- src/parser/vueResumeMapper.test.ts src/background.test.ts --run
npm.cmd run typecheck:extension
```

Expected: 两个测试文件全部通过，类型检查 exit code 0。

### Task 2：在能力区域显示安全 schema

**Files:**
- Modify: `extension/src/components/PageReadingCard.tsx`
- Modify: `extension/src/components/PageReadingCard.test.tsx`

- [x] **Step 1：先写失败的界面测试**

给能力 snapshot 增加：

```ts
warnings: [
  'vue-schema:key=professionalSkillInfo:string',
  'vue-schema:key=unknownList:array:3',
  'vue-schema:key=bad-key:string',
  'vue-schema:key=privateValue:string:候选人值',
]
```

期望只显示 `professionalSkillInfo · 字符串` 和 `unknownList · 数组 3`；非法 warning 与候选人值不显示。

- [x] **Step 2：运行测试确认 RED**

Run:

```powershell
npm.cmd run test --workspace extension -- src/components/PageReadingCard.test.tsx --run
```

Expected: FAIL，原因是 schema 区域尚未渲染。

- [x] **Step 3：最小实现安全解析和展示**

只接受以下正则匹配的 warning：

```ts
/^vue-schema:key=([A-Za-z_$][A-Za-z0-9_$]{0,63}):(array|object|string|number|boolean|null|undefined|other)(?::([0-9]|[1-4][0-9]|50))?$/
```

数组必须带长度，非数组不得带长度；最多显示 40 项。固定中文类型标签为“数组、对象、字符串、数字、布尔、空值、未定义、其他”。

- [x] **Step 4：运行测试确认 GREEN**

实际结果：RED 阶段 1 项按预期失败；GREEN 阶段 1 个测试文件、20 项测试通过，类型检查 exit code 0。

Run:

```powershell
npm.cmd run test --workspace extension -- src/components/PageReadingCard.test.tsx --run
npm.cmd run typecheck:extension
```

Expected: 测试与类型检查 exit code 0。

### Task 3：记录、完整验证并构建人工诊断版本

**Files:**
- Modify: `docs/superpowers/plans/2026-08-07-boss-resume-reading-record.md`
- Modify: `docs/validation/m2-loop-log.md`
- Modify: `docs/superpowers/plans/2026-08-07-boss-resume-skill-field-diagnostic.md`
- Modify: `extension/src/validation.ts`
- Modify: `extension/src/validation.test.ts`

- [x] **Step 1：记录唯一问题与安全决策**

记录问题指纹 `skill-present-but-skillTagList-absent`、参考插件只支持 `skillTagList` 的静态证据，以及本轮仅增加 schema 诊断、尚未正式映射技能的边界。

代码审查新增并修复问题指纹 `schema-warning-budget-overflow`：最坏情况下 3 条固定能力信息、6 个允许字段、4 个数组长度和 40 个 schema 字段合计 53 条，超过旧的 40 条 warning 校验上限。先以失败测试复现 53 条 Vue 结果被拒绝，再把上限仅对 `boss-vue-v1` 调整为 64；`boss-dom-v1` 仍保持 40，65 条仍拒绝。

- [x] **Step 2：运行安全扫描与完整验证**

实际结果：安全扫描无匹配；`npm.cmd run verify` exit code 0，后端 12 项、扩展 19 个测试文件 218 项全部通过，类型检查与 content/background 构建通过。

Run:

```powershell
rg -n "chrome\.debugger|webRequest|cookies|localStorage|sessionStorage|\.click\(|\.focus\(|scrollTo\(|scrollBy\(|fetch\(" extension/src/parser/vueResumeMapper.ts extension/src/background.ts extension/src/components/PageReadingCard.tsx
npm.cmd run verify
```

Expected: 新 schema 路径没有自动行为、存储或网络调用；标准验证 exit code 0。

- [x] **Step 3：提交**

```powershell
git add docs/superpowers/plans/2026-08-07-boss-resume-skill-field-diagnostic.md docs/superpowers/plans/2026-08-07-boss-resume-reading-record.md docs/validation/m2-loop-log.md extension/src/parser/vueResumeMapper.ts extension/src/parser/vueResumeMapper.test.ts extension/src/background.ts extension/src/background.test.ts extension/src/components/PageReadingCard.tsx extension/src/components/PageReadingCard.test.tsx extension/src/validation.ts extension/src/validation.test.ts
git commit -m "feat: diagnose BOSS resume skill schema safely"
```

- [ ] **Step 4：人工诊断门槛**

用户重新加载当前 worktree 的 `extension/dist`，手动打开同一候选人并点击一次“读取当前简历”。只回传 schema 字段名、类型和数组长度；在该证据出现前，不新增技能字段映射、不宣布技能问题已修复。
