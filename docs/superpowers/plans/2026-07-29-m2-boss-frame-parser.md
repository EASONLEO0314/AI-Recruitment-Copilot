# M2 BOSS Frame Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a passive, frame-aware BOSS page reader that classifies logged-out pages, parses already-rendered candidate data into a local typed snapshot, and previews it without clicking, scrolling, navigating, intercepting requests, or calling an LLM.

**Architecture:** One MV3 content bundle runs in every matching BOSS frame. The top frame mounts the existing React/Shadow DOM UI, while frame-specific adapters read only their own DOM and send validated snapshots through the Service Worker to frame `0`; a scoped, debounced coordinator reparses only when the recognized content root changes or the user clicks “重新读取”.

**Tech Stack:** Chrome Manifest V3, TypeScript, React, DOM APIs, `MutationObserver`, Chrome runtime/tabs messaging, Vite, Vitest, Testing Library, jsdom.

---

## Scope and execution boundary

- M2 stops at `BOSS DOM -> local ParserSnapshot -> page-reading preview`.
- The existing 92% assessment remains `mode: 'demo'` and visually labelled “演示数据”.
- No parser code may call `fetch`, `chrome.debugger`, private BOSS APIs, `click`, `focus`, `scrollTo`, `history`, `location.assign`, `location.replace`, `location.reload`, form setters, `innerHTML`, `outerHTML`, Cookie APIs, or storage APIs.
- The first browser run is logged-out only. It proves injection, classification, messaging, manual refresh, and page stability; it does not prove candidate selectors.
- After the logged-out smoke passes, stop and wait for the user to log in. Logged-in acceptance is manual comparison on at least five authorized candidate pages, without external CDP/browser automation attached to the BOSS tab.
- Use anonymous synthetic fixtures only. Never copy real candidate HTML, screenshots, names, phone numbers, email addresses, or resume text into the repository, test output, console, or validation log.
- Run one baseline, fix only unique findings, and use at most eight targeted repair rounds. Do not rerun the whole verification suite after every fix.

## File map

```text
extension/
├── public/manifest.json                         # inject one content bundle into every matching frame
└── src/
    ├── contracts.ts                            # parser snapshots and parser runtime messages
    ├── validation.ts                           # strict runtime validation for parser snapshots
    ├── content.tsx                             # top-frame UI bootstrap plus per-frame coordinator bootstrap
    ├── content.test.tsx                        # top-frame-only mount and frame bootstrap tests
    ├── background.ts                           # dispatch existing API messages and parser routing messages
    ├── background.test.ts                      # preserve fixed API proxy behavior and reject parser misuse
    ├── manifest.test.ts                        # all_frames and least-privilege manifest contract
    ├── styles.css                              # page-reading card states and compact profile preview
    ├── components/
    │   ├── CopilotPanel.tsx                    # compose page-reading preview with unchanged demo assessment
    │   ├── CopilotPanel.test.tsx               # ensure local reading is independent of backend/demo state
    │   ├── PageReadingCard.tsx                 # render parser states and explicit refresh control
    │   └── PageReadingCard.test.tsx            # logged-out, ready, partial, unsupported, and refresh behavior
    └── parser/
        ├── pageClassifier.ts                   # minimal URL/title/login-wall classification
        ├── pageClassifier.test.ts              # five page kinds with anonymous DOM
        ├── snapshot.ts                         # normalization, length limits, coverage, safe fingerprint
        ├── snapshot.test.ts                    # whitelist and deterministic snapshot tests
        ├── dom.ts                              # bounded selector reads shared by both adapters
        ├── adapters/
        │   ├── recommend.ts                    # currently selected rendered recommend card only
        │   ├── recommend.test.ts               # anonymous selected-card fixtures and ambiguity fallback
        │   ├── resume.ts                       # visible structured resume sections only
        │   └── resume.test.ts                  # anonymous work/education/project/skills fixtures
        ├── coordinator.ts                      # first read, 400 ms debounce, dedupe, refresh, cleanup
        ├── coordinator.test.ts                 # event-driven behavior and zero page operations
        ├── router.ts                           # Service Worker tab/frame relay boundary
        ├── router.test.ts                      # source isolation and frame-0 routing
        ├── client.ts                           # top-frame relay subscription and refresh request
        └── client.test.ts                      # stale message and non-candidate overwrite protection
README.md                                       # M2 local-only read boundary and two-stage acceptance
docs/validation/m2-loop-log.md                  # factual unique-finding and manual-observation record
```

Public implementation references used only to seed the first adapter version:

- Chrome content scripts, isolated worlds, `document_idle`, and `all_frames`: <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- Chrome `tabs.sendMessage` frame/document targeting: <https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage>
- Public BOSS recommend frame/card selectors: <https://github.com/joohw/boss-cli/blob/main/src/toolset/recommend.ts>
- Public confirmation of `/web/frame/c-resume/...`: <https://github.com/joohw/boss-cli/blob/main/src/common/c_resume_capture.ts>

The public selectors are hypotheses until the logged-in manual acceptance passes. The extension must report `unsupported` or `partial` instead of performing a broad full-page text scrape when those hypotheses do not match.

### Task 1: Parser contracts and strict snapshot validation

**Files:**
- Modify: `extension/src/contracts.ts`
- Modify: `extension/src/validation.ts`
- Create: `extension/src/parser/snapshot.ts`
- Create: `extension/src/parser/snapshot.test.ts`

- [ ] **Step 1: Write failing snapshot contract tests**

Create `snapshot.test.ts` with a fully anonymous profile and assertions for normalization, field coverage, unknown-key rejection, and maximum lengths:

```ts
import { describe, expect, it } from 'vitest';

import { isParserSnapshot } from '../validation';
import { buildProfileSnapshot, normalizeText } from './snapshot';


describe('parser snapshot boundary', () => {
  it('normalizes whitespace and builds a partial anonymous profile snapshot', () => {
    expect(normalizeText('  AI\n  工程师  ')).toBe('AI 工程师');

    const snapshot = buildProfileSnapshot('resume_frame', {
      display_name: '候选人甲',
      current_title: 'AI 工程师',
      experience_years: 3,
      education: [],
      work_experiences: [],
      project_experiences: [],
      skills: ['TypeScript'],
    }, new Date('2026-07-29T02:00:00.000Z'));

    expect(snapshot.status).toBe('partial');
    expect(snapshot.present_fields).toContain('current_title');
    expect(snapshot.missing_fields).toContain('work_experiences');
    expect(isParserSnapshot(snapshot)).toBe(true);
  });

  it('rejects non-whitelisted fields and overlong unclassified text', () => {
    const snapshot = buildProfileSnapshot('resume_frame', {
      display_name: '候选人乙',
      education: [],
      work_experiences: [],
      project_experiences: [],
      skills: [],
    }, new Date('2026-07-29T02:00:00.000Z'));

    expect(isParserSnapshot({ ...snapshot, innerHTML: '<main>forbidden</main>' })).toBe(false);
    expect(isParserSnapshot({
      ...snapshot,
      profile: { ...snapshot.profile, summary: 'x'.repeat(501) },
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and observe the intended failure**

Run: `npm.cmd run test --workspace extension -- src/parser/snapshot.test.ts --run`

Expected: FAIL because the parser contracts, `snapshot.ts`, and `isParserSnapshot` do not exist.

- [ ] **Step 3: Add exact parser types**

Append these types to `contracts.ts`; keep every existing M1 API type unchanged:

```ts
export type PageKind =
  | 'logged_out'
  | 'non_candidate'
  | 'recommend_frame'
  | 'resume_frame'
  | 'unsupported';

export type ParserStatus = 'waiting' | 'ready' | 'partial' | 'unsupported' | 'error';

export interface EducationExperience {
  school?: string;
  degree?: string;
  major?: string;
  period?: string;
}

export interface WorkExperience {
  company?: string;
  title?: string;
  period?: string;
  description?: string;
}

export interface ProjectExperience {
  name?: string;
  role?: string;
  period?: string;
  description?: string;
}

export interface CandidateProfile {
  display_name?: string;
  current_title?: string;
  location?: string;
  experience_years?: number;
  expected_position?: string;
  expected_city?: string;
  education: EducationExperience[];
  work_experiences: WorkExperience[];
  project_experiences: ProjectExperience[];
  skills: string[];
  summary?: string;
}

export interface ParserSnapshot {
  schema_version: 1;
  parser_version: 'boss-dom-v1';
  page_kind: PageKind;
  status: ParserStatus;
  captured_at: string;
  fingerprint?: string;
  profile?: CandidateProfile;
  present_fields: string[];
  missing_fields: string[];
  warnings: string[];
}

export interface ParserSnapshotMessage {
  type: 'ARC_PARSER_SNAPSHOT';
  snapshot: ParserSnapshot;
}

export interface ParserRefreshRequest {
  type: 'ARC_PARSER_REFRESH';
}

export interface ParserRefreshCommand {
  type: 'ARC_PARSER_REFRESH_COMMAND';
}

export interface ParserRelayMessage {
  type: 'ARC_PARSER_RELAY';
  snapshot: ParserSnapshot;
  source: { frame_id: number; document_id: string };
}
```

- [ ] **Step 4: Implement normalization, coverage, and a non-identifying fingerprint**

In `snapshot.ts`, export `normalizeText(value, maxLength = 500)`, `buildProfileSnapshot(pageKind, profile, now)`, and `buildStatusSnapshot(pageKind, status, warning: string | undefined, now)`. Use this exact core behavior:

```ts
const CORE_FIELDS = [
  'work_experiences',
  'education',
  'project_experiences',
  'skills',
  'experience_years',
] as const;

export function normalizeText(value: string | null | undefined, maxLength = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function hasValue(profile: CandidateProfile, field: typeof CORE_FIELDS[number]): boolean {
  const value = profile[field];
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

function structuralFingerprint(profile: CandidateProfile): string {
  const source = JSON.stringify({
    current_title: profile.current_title ?? '',
    experience_years: profile.experience_years ?? null,
    expected_position: profile.expected_position ?? '',
    expected_city: profile.expected_city ?? '',
    education_count: profile.education.length,
    work_count: profile.work_experiences.length,
    project_count: profile.project_experiences.length,
    skill_count: profile.skills.length,
  });
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
```

Before coverage calculation, `buildProfileSnapshot` must create a new sanitized profile: scalar labels use `normalizeText(value, 160)`, summaries/descriptions use `normalizeText(value, 500)`, each structured array is sliced to 50 entries, empty structured records are removed, and skills are normalized, deduplicated, and sliced to 50. Invalid `experience_years` values are omitted. Never mutate the adapter input.

`buildProfileSnapshot` must set `ready` only when all five `CORE_FIELDS` are present; otherwise set `partial`. The fingerprint must exclude `display_name`, company names, school names, descriptions, and raw DOM text. Coordinator deduplication in Task 4 will compare an in-memory sanitized payload, so fingerprint collisions cannot suppress candidate changes.

- [ ] **Step 5: Implement the strict runtime guard**

Add `isParserSnapshot(value)` to `validation.ts`. Use `hasOnlyKeys(record, allowedKeys)` at every object level. Enforce:

```ts
const SNAPSHOT_KEYS = [
  'schema_version', 'parser_version', 'page_kind', 'status', 'captured_at',
  'fingerprint', 'profile', 'present_fields', 'missing_fields', 'warnings',
] as const;
const PROFILE_KEYS = [
  'display_name', 'current_title', 'location', 'experience_years',
  'expected_position', 'expected_city', 'education', 'work_experiences',
  'project_experiences', 'skills', 'summary',
] as const;
```

Scalar profile strings are at most 160 characters, descriptions/summary at most 500, arrays at most 50 entries, `warnings` at most 20 safe codes, and `experience_years` is an integer from 0 through 80. ISO timestamps must satisfy `Number.isFinite(Date.parse(value))`. Do not accept extra keys.

- [ ] **Step 6: Run focused tests, typecheck, and commit**

Run:

```powershell
npm.cmd run test --workspace extension -- src/parser/snapshot.test.ts --run
npm.cmd run typecheck --workspace extension
```

Expected: focused tests PASS and TypeScript exits 0.

Commit:

```powershell
git add extension/src/contracts.ts extension/src/validation.ts extension/src/parser/snapshot.ts extension/src/parser/snapshot.test.ts
git commit -m "feat: define local parser snapshots"
```

### Task 2: Page classification and frame-safe manifest

**Files:**
- Create: `extension/src/parser/pageClassifier.ts`
- Create: `extension/src/parser/pageClassifier.test.ts`
- Modify: `extension/public/manifest.json`
- Modify: `extension/src/manifest.test.ts`

- [ ] **Step 1: Write failing page-classifier and Manifest tests**

Use anonymous DOM only:

```ts
import { describe, expect, it } from 'vitest';

import { classifyPage } from './pageClassifier';


function page(html: string): Document {
  const result = document.implementation.createHTMLDocument('fixture');
  result.body.insertAdjacentHTML('beforeend', html);
  return result;
}

describe('BOSS page classifier', () => {
  it('classifies an exact visible login action as logged out', () => {
    expect(classifyPage(page('<header><a>登录/注册</a></header>'),
      'https://www.zhipin.com/', true)).toBe('logged_out');
  });

  it('recognizes only the two supported frame paths', () => {
    expect(classifyPage(page(''), 'https://www.zhipin.com/web/frame/recommend', false))
      .toBe('recommend_frame');
    expect(classifyPage(page(''), 'https://www.zhipin.com/web/frame/c-resume/example', false))
      .toBe('resume_frame');
    expect(classifyPage(page(''), 'https://www.zhipin.com/web/frame/unknown', false))
      .toBe('unsupported');
  });
});
```

Extend `manifest.test.ts`:

```ts
const contentScript = manifest.content_scripts[0];
expect(contentScript.matches).toEqual([
  'https://www.zhipin.com/*',
  'http://127.0.0.1/*',
]);
expect(contentScript.all_frames).toBe(true);
expect(manifest.permissions).not.toContain('debugger');
expect(manifest.permissions).not.toContain('scripting');
expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8765/*']);
```

- [ ] **Step 2: Run both tests and observe the intended failure**

Run: `npm.cmd run test --workspace extension -- src/parser/pageClassifier.test.ts src/manifest.test.ts --run`

Expected: FAIL because the classifier does not exist and `all_frames` is absent.

- [ ] **Step 3: Implement minimal classification without full-page resume reading**

Create `pageClassifier.ts`:

```ts
import type { PageKind } from '../contracts';
import { normalizeText } from './snapshot';


const LOGIN_LABELS = new Set(['登录', '立即登录', '登录/注册', '扫码登录']);


function hasVisibleLoginSignal(targetDocument: Document): boolean {
  return Array.from(targetDocument.querySelectorAll('a, button')).some((element) =>
    element.closest('[hidden], [aria-hidden="true"]') === null
    && LOGIN_LABELS.has(normalizeText(element.textContent, 20)));
}


export function classifyPage(
  targetDocument: Document,
  currentUrl: string,
  isTopFrame: boolean,
): PageKind {
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return 'unsupported';
  }

  if (url.hostname !== 'www.zhipin.com') {
    return isTopFrame ? 'non_candidate' : 'unsupported';
  }
  if (isTopFrame && hasVisibleLoginSignal(targetDocument)) {
    return 'logged_out';
  }
  if (!isTopFrame && url.pathname.startsWith('/web/frame/recommend')) {
    return 'recommend_frame';
  }
  if (!isTopFrame
    && (url.pathname === '/web/frame/c-resume'
      || url.pathname.startsWith('/web/frame/c-resume/'))) {
    return 'resume_frame';
  }
  return isTopFrame ? 'non_candidate' : 'unsupported';
}
```

Do not inspect `document.cookie`, local storage, network state, or arbitrary body text.

- [ ] **Step 4: Enable matching iframe injection with no new permissions**

Add only `"all_frames": true` beside `run_at` in the existing content-script declaration. Do not add `match_origin_as_fallback`, `match_about_blank`, `tabs`, `debugger`, or `scripting`; the two currently corroborated frame paths are normal `https://www.zhipin.com/...` URLs.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm.cmd run test --workspace extension -- src/parser/pageClassifier.test.ts src/manifest.test.ts --run`

Expected: both files PASS.

Commit:

```powershell
git add extension/src/parser/pageClassifier.ts extension/src/parser/pageClassifier.test.ts extension/public/manifest.json extension/src/manifest.test.ts
git commit -m "feat: classify supported BOSS frames"
```

### Task 3: Read-only recommend and resume adapters

**Files:**
- Create: `extension/src/parser/dom.ts`
- Create: `extension/src/parser/adapters/recommend.ts`
- Create: `extension/src/parser/adapters/recommend.test.ts`
- Create: `extension/src/parser/adapters/resume.ts`
- Create: `extension/src/parser/adapters/resume.test.ts`

- [ ] **Step 1: Write a failing selected-card test**

The recommend adapter must never guess among multiple unselected cards:

```ts
import { describe, expect, it } from 'vitest';

import { parseRecommendFrame } from './recommend';


describe('recommend frame adapter', () => {
  it('reads only the selected rendered card', () => {
    document.body.replaceChildren();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="card-list">
        <article class="candidate-card-wrap"><span class="name">候选人甲</span></article>
        <article class="candidate-card-wrap active">
          <span class="name">候选人乙</span>
          <div class="base-info"><span>上海</span><span>3年</span><span>本科</span></div>
          <div class="expect-wrap"><span class="content">AI 工程师</span></div>
          <div class="geek-desc"><span class="content">具备模型工程经验</span></div>
          <div class="tags-wrap"><span class="tag-item">TypeScript</span></div>
        </article>
      </div>`);

    const snapshot = parseRecommendFrame(document, new Date('2026-07-29T02:00:00.000Z'));
    expect(snapshot.profile?.display_name).toBe('候选人乙');
    expect(snapshot.profile?.experience_years).toBe(3);
    expect(snapshot.profile?.skills).toEqual(['TypeScript']);
  });

  it('reports ambiguity when several cards exist and none is selected', () => {
    document.body.innerHTML = `
      <div class="card-list">
        <article class="candidate-card-wrap"><span class="name">候选人甲</span></article>
        <article class="candidate-card-wrap"><span class="name">候选人乙</span></article>
      </div>`;
    const snapshot = parseRecommendFrame(document, new Date());
    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.warnings).toContain('recommend-active-card-not-found');
  });
});
```

Using `innerHTML` is allowed only in synthetic test setup; production parser files must not use it.

- [ ] **Step 2: Write a failing structured-resume test**

```ts
import { expect, it } from 'vitest';

import { parseResumeFrame } from './resume';


it('reads visible structured resume regions without a full-page text fallback', () => {
  document.body.innerHTML = `
    <main class="resume-content">
      <h1 class="resume-name">候选人甲</h1>
      <div class="base-info"><span>北京</span><span>5年经验</span></div>
      <section class="resume-item">
        <h2 class="section-title">工作经历</h2>
        <article class="history-item">
          <span class="company-name">示例科技</span>
          <span class="position-name">算法工程师</span>
          <span class="date-range">2022-2026</span>
          <p class="description">负责匿名示例项目</p>
        </article>
      </section>
      <section class="resume-item">
        <h2 class="section-title">教育经历</h2>
        <article class="history-item">
          <span class="school-name">示例大学</span>
          <span class="major-name">计算机</span>
          <span class="degree-name">硕士</span>
        </article>
      </section>
      <section class="resume-item">
        <h2 class="section-title">项目经历</h2>
        <article class="history-item"><span class="project-name">匿名项目</span></article>
      </section>
      <div class="skills"><span class="tag-item">Python</span></div>
    </main>`;

  const snapshot = parseResumeFrame(document, new Date('2026-07-29T02:00:00.000Z'));
  expect(snapshot.profile?.work_experiences[0]).toMatchObject({
    company: '示例科技', title: '算法工程师', period: '2022-2026',
  });
  expect(snapshot.profile?.education[0]?.school).toBe('示例大学');
  expect(snapshot.profile?.project_experiences[0]?.name).toBe('匿名项目');
  expect(snapshot.profile?.skills).toEqual(['Python']);
});
```

- [ ] **Step 3: Run both adapter tests and observe the intended failure**

Run: `npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts src/parser/adapters/resume.test.ts --run`

Expected: FAIL because both adapters are missing.

- [ ] **Step 4: Implement bounded shared DOM readers**

Create `dom.ts` with no general body-text helper:

```ts
import { normalizeText } from './snapshot';


function isHidden(element: Element): boolean {
  return element.closest('[hidden], [aria-hidden="true"]') !== null;
}


export function firstText(
  root: ParentNode,
  selectors: readonly string[],
  maxLength = 160,
): string | undefined {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element && !isHidden(element)) {
      const value = normalizeText(element.textContent, maxLength);
      if (value) return value;
    }
  }
  return undefined;
}


export function allTexts(
  root: ParentNode,
  selectors: readonly string[],
  maxLength = 160,
): string[] {
  const values = selectors.flatMap((selector) =>
    Array.from(root.querySelectorAll(selector))
      .filter((element) => !isHidden(element))
      .map((element) => normalizeText(element.textContent, maxLength))
      .filter(Boolean));
  return [...new Set(values)].slice(0, 50);
}
```

Do not add `readBodyText`, XPath evaluation, recursive traversal, computed-style probing, or arbitrary attribute serialization.

- [ ] **Step 5: Implement the recommend adapter with explicit selection rules**

Use these selectors, centralized at the top of `recommend.ts`:

```ts
const CARD_SELECTOR = '.candidate-card-wrap, .card-list .card-item, .geek-list .geek-card';
const ACTIVE_CARD_SELECTOR = [
  '.candidate-card-wrap.active',
  '.candidate-card-wrap.is-active',
  '.card-list .card-item.active',
  '.geek-list .geek-card.active',
  '[aria-selected="true"]',
].join(', ');
const OBSERVATION_ROOT_SELECTOR = '.card-list, .geek-list-wrap .geek-list';
```

Export `findRecommendObservationRoot(document)` and `parseRecommendFrame(document, now)`. Select the active card; use the only card when exactly one exists; otherwise return `buildStatusSnapshot('recommend_frame', 'unsupported', 'recommend-active-card-not-found', now)`. Read only:

```ts
const name = firstText(card, ['.name-wrap .name', '.name'], 80);
const baseInfo = allTexts(card, ['.base-info span'], 80);
const experienceText = baseInfo.find((value) => /\d+\s*年/.test(value));
const experienceYears = experienceText
  ? Number(experienceText.match(/(\d+)\s*年/)?.[1])
  : undefined;
const expectedPosition = firstText(card,
  ['.expect-wrap .content', '.expect-wrap .join-text-wrap'], 160);
const summary = firstText(card, ['.geek-desc .content'], 500);
const skills = allTexts(card, ['.operate .labels .label', '.tags-wrap .tag-item'], 80);
```

Use `baseInfo[0]` as `location` only when it does not contain `年`, `学历`, `本科`, `硕士`, `博士`, or `大专`; otherwise leave location missing. Do not read salary, greeting availability, chat history, platform IDs, hidden nodes, or entire card text.

- [ ] **Step 6: Implement the resume adapter with section-scoped selectors**

Use explicit roots and headings:

```ts
const RESUME_ROOTS = ['.resume-content', '.resume-box', '.geek-resume', 'main'];
const SECTION_ROOTS = '.resume-item, .history-section, .section-item';
const ITEM_ROOTS = ':scope .history-item, :scope .experience-item, :scope .item-content';
const WORK_HEADINGS = new Set(['工作经历', '工作经验']);
const EDUCATION_HEADINGS = new Set(['教育经历', '教育背景']);
const PROJECT_HEADINGS = new Set(['项目经历', '项目经验']);
```

Find a section only when its `h1, h2, h3, .section-title, .title` normalizes to an exact heading. Read repeated items only inside that section using:

```ts
const workSelectors = {
  company: ['.company-name', '.company'],
  title: ['.position-name', '.position'],
  period: ['.date-range', '.period'],
  description: ['.description', '.content'],
};
const educationSelectors = {
  school: ['.school-name', '.school'],
  degree: ['.degree-name', '.degree'],
  major: ['.major-name', '.major'],
  period: ['.date-range', '.period'],
};
const projectSelectors = {
  name: ['.project-name', '.name'],
  role: ['.role-name', '.role'],
  period: ['.date-range', '.period'],
  description: ['.description', '.content'],
};
```

Read the profile header from `.resume-name, .geek-name, .name`; base tokens from `.base-info span, .user-info span`; summary from `.candidate-advantage, .self-description, .geek-desc .content`; and skills from `.skills .tag-item, .skill-label, .tags-wrap .tag-item`. If no recognized root exists, return `unsupported` with `resume-root-not-found`. If a section heading exists but no structured child fields match, leave that array empty and add a safe code such as `work-section-structure-unknown`; do not use the section's whole `textContent` as a fallback.

- [ ] **Step 7: Assert zero page operations, run focused tests, and commit**

In both adapter test files, spy on `HTMLElement.prototype.click`, `HTMLElement.prototype.focus`, and `window.scrollTo`; assert that parsing does not call them. Then run:

```powershell
npm.cmd run test --workspace extension -- src/parser/adapters/recommend.test.ts src/parser/adapters/resume.test.ts --run
npm.cmd run typecheck --workspace extension
```

Expected: adapter tests PASS and typecheck exits 0.

Commit:

```powershell
git add extension/src/parser/dom.ts extension/src/parser/adapters
git commit -m "feat: parse visible BOSS candidate fields"
```

### Task 4: Event-driven coordinator and top-frame-only bootstrap

**Files:**
- Create: `extension/src/parser/coordinator.ts`
- Create: `extension/src/parser/coordinator.test.ts`
- Modify: `extension/src/content.tsx`
- Modify: `extension/src/content.test.tsx`

- [ ] **Step 1: Write failing coordinator behavior tests**

Use fake timers and this injected observer constructor:

```ts
let observerCallback: MutationCallback | null = null;
const observerDisconnect = vi.fn();

class FakeObserver {
  constructor(callback: MutationCallback) {
    observerCallback = callback;
  }
  observe = vi.fn();
  disconnect = observerDisconnect;
  takeRecords = vi.fn().mockReturnValue([]);
}

it('parses once, debounces mutations for 400 ms, and deduplicates unchanged content', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div class="card-list">
      <article class="candidate-card-wrap active"><span class="name">候选人甲</span></article>
    </div>`;
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  const handle = startParserCoordinator({
    targetDocument: document,
    currentUrl: 'https://www.zhipin.com/web/frame/recommend',
    isTopFrame: false,
    sendMessage,
    Observer: FakeObserver as unknown as typeof MutationObserver,
  });

  await vi.runAllTicks();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  observerCallback?.([], {} as MutationObserver);
  observerCallback?.([], {} as MutationObserver);
  await vi.advanceTimersByTimeAsync(399);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  handle.stop();
  expect(observerDisconnect).toHaveBeenCalledOnce();
});
```

Add a second test by capturing the listener passed to the injected `runtimeOnMessage.addListener`, invoke it with `{ type: 'ARC_PARSER_REFRESH_COMMAND' }`, and expect one forced snapshot even when content is unchanged. Add a third test using `<a>登录/注册</a>` in a top-frame document; expect a `logged_out` snapshot and assert the injected observer constructor is never called.

- [ ] **Step 2: Run the coordinator test and observe the intended failure**

Run: `npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts --run`

Expected: FAIL because `startParserCoordinator` does not exist.

- [ ] **Step 3: Implement the coordinator with dependency injection**

Use this public boundary:

```ts
export interface CoordinatorHandle { stop(): void }

export interface CoordinatorOptions {
  targetDocument: Document;
  currentUrl: string;
  isTopFrame: boolean;
  sendMessage?: (message: ParserSnapshotMessage) => Promise<unknown>;
  runtimeOnMessage?: typeof chrome.runtime.onMessage;
  Observer?: typeof MutationObserver;
  now?: () => Date;
}

export function startParserCoordinator(options: CoordinatorOptions): CoordinatorHandle;
```

Required algorithm:

1. Classify once at startup.
2. For `logged_out`, `non_candidate`, and `unsupported`, send one safe status snapshot and create no observer.
3. For a supported frame, choose exactly one adapter, parse immediately, and observe only that adapter's recognized root.
4. Use a single 400 ms timer. Multiple mutations reset the timer.
5. Compute the dedupe key from `{ page_kind, status, profile, present_fields, missing_fields, warnings }`, excluding `captured_at` and `fingerprint`. This in-memory comparison may include the already-sanitized profile and is never transmitted or persisted.
6. Normal mutation reads skip an unchanged key; manual refresh calls `run(true)` and sends even when unchanged.
7. Catch adapter exceptions and send `buildStatusSnapshot(pageKind, 'error', 'parser-exception', now())`; never include exception messages or DOM text.
8. `stop()` clears the timer, disconnects the observer, and removes the refresh listener.

- [ ] **Step 4: Write failing top-frame bootstrap tests**

Refactor `content.test.tsx` to test a new export:

```ts
const top = bootstrapContentScript({
  targetDocument: document,
  currentUrl: 'http://127.0.0.1:8765/docs',
  isTopFrame: true,
});
expect(document.querySelectorAll('#ai-recruitment-copilot-root')).toHaveLength(1);
top.stop();

document.body.replaceChildren();
const child = bootstrapContentScript({
  targetDocument: document,
  currentUrl: 'https://www.zhipin.com/web/frame/recommend',
  isTopFrame: false,
});
expect(document.querySelector('#ai-recruitment-copilot-root')).toBeNull();
child.stop();
```

- [ ] **Step 5: Implement a single content-script bootstrap**

`content.tsx` must export `bootstrapContentScript` and call it once for the real page:

```ts
export interface ContentBootstrapOptions {
  targetDocument: Document;
  currentUrl: string;
  isTopFrame: boolean;
}

export function bootstrapContentScript(options: ContentBootstrapOptions): CoordinatorHandle {
  if (options.isTopFrame) {
    mountCopilot(options.targetDocument);
  }
  return startParserCoordinator(options);
}

if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
  bootstrapContentScript({
    targetDocument: document,
    currentUrl: location.href,
    isTopFrame: window.top === window,
  });
}
```

Tests must mock `startParserCoordinator`; the `chrome` guard prevents import-time bootstrap in jsdom. Production must not write any BOSS node except the existing top-frame Shadow DOM host created by `mountCopilot`.

- [ ] **Step 6: Run coordinator/content tests and commit**

Run:

```powershell
npm.cmd run test --workspace extension -- src/parser/coordinator.test.ts src/content.test.tsx --run
npm.cmd run typecheck --workspace extension
```

Expected: tests PASS and typecheck exits 0.

Commit:

```powershell
git add extension/src/parser/coordinator.ts extension/src/parser/coordinator.test.ts extension/src/content.tsx extension/src/content.test.tsx
git commit -m "feat: coordinate passive frame reads"
```

### Task 5: Service Worker parser routing

**Files:**
- Create: `extension/src/parser/router.ts`
- Create: `extension/src/parser/router.test.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/src/background.test.ts`

- [ ] **Step 1: Write failing source-isolation and routing tests**

```ts
import { describe, expect, it, vi } from 'vitest';

import { routeParserMessage } from './router';


const snapshot = {
  schema_version: 1,
  parser_version: 'boss-dom-v1',
  page_kind: 'logged_out',
  status: 'ready',
  captured_at: '2026-07-29T02:00:00.000Z',
  present_fields: [],
  missing_fields: [],
  warnings: [],
} as const;


describe('parser message router', () => {
  it('relays a valid frame snapshot only to frame zero in the same tab', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);
    const result = await routeParserMessage(
      { type: 'ARC_PARSER_SNAPSHOT', snapshot },
      { tab: { id: 17 }, frameId: 4, documentId: 'document-4' },
      sendToTab,
    );
    expect(result).toBe(true);
    expect(sendToTab).toHaveBeenCalledWith(17, {
      type: 'ARC_PARSER_RELAY',
      snapshot,
      source: { frame_id: 4, document_id: 'document-4' },
    }, { frameId: 0 });
  });

  it('broadcasts refresh only when requested by frame zero', async () => {
    const sendToTab = vi.fn().mockResolvedValue(undefined);
    expect(await routeParserMessage(
      { type: 'ARC_PARSER_REFRESH' },
      { tab: { id: 17 }, frameId: 3 },
      sendToTab,
    )).toBe(false);
    expect(sendToTab).not.toHaveBeenCalled();
  });
});
```

Add explicit assertions that missing `tab.id`, a snapshot with `{ innerHTML: 'forbidden' }`, and `{ type: 'UNKNOWN' }` each return `false` without calling `sendToTab`. For a frame-zero refresh, assert `sendToTab(17, { type: 'ARC_PARSER_REFRESH_COMMAND' })` is called without `frameId`, so every content frame receives it.

- [ ] **Step 2: Run the router test and observe the intended failure**

Run: `npm.cmd run test --workspace extension -- src/parser/router.test.ts --run`

Expected: FAIL because `routeParserMessage` does not exist.

- [ ] **Step 3: Implement the router without persistence or network access**

Use this exact boundary:

```ts
type SendToTab = (
  tabId: number,
  message: ParserRelayMessage | ParserRefreshCommand,
  options?: { frameId: number },
) => Promise<unknown>;

export interface ParserMessageSender {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}

export async function routeParserMessage(
  message: unknown,
  sender: ParserMessageSender,
  sendToTab: SendToTab = (tabId, payload, options) =>
    chrome.tabs.sendMessage(tabId, payload, options),
): Promise<boolean>;
```

Validate `ARC_PARSER_SNAPSHOT` with `isParserSnapshot`. Require an integer `sender.tab.id`. For relays, use `document_id: sender.documentId ?? 'unknown'` and `{ frameId: 0 }`. For refresh, require `sender.frameId === 0` and broadcast `ARC_PARSER_REFRESH_COMMAND`. Catch `tabs.sendMessage` rejection and return `false`; do not log snapshot contents.

- [ ] **Step 4: Integrate parser routing with the existing API listener**

Keep `handleApiRequest` and `isApiRequestMessage` unchanged. In the registered `runtime.onMessage` listener:

```ts
if (isApiRequestMessage(message)) {
  void handleApiRequest(message).then(sendResponse);
  return true;
}
if (message?.type === 'ARC_PARSER_SNAPSHOT' || message?.type === 'ARC_PARSER_REFRESH') {
  void routeParserMessage(message, sender).then((ok) => sendResponse({ ok }));
  return true;
}
return false;
```

Extend `background.test.ts` to assert the existing two fixed localhost API operations still pass and that a parser snapshot never calls the injected API `fetcher`.

- [ ] **Step 5: Run router/background tests and commit**

Run: `npm.cmd run test --workspace extension -- src/parser/router.test.ts src/background.test.ts --run`

Expected: both files PASS; existing API whitelist remains green.

Commit:

```powershell
git add extension/src/parser/router.ts extension/src/parser/router.test.ts extension/src/background.ts extension/src/background.test.ts
git commit -m "feat: relay parser snapshots by tab and frame"
```

### Task 6: Top-frame parser client and local page-reading UI

**Files:**
- Create: `extension/src/parser/client.ts`
- Create: `extension/src/parser/client.test.ts`
- Create: `extension/src/components/PageReadingCard.tsx`
- Create: `extension/src/components/PageReadingCard.test.tsx`
- Modify: `extension/src/components/CopilotPanel.tsx`
- Modify: `extension/src/components/CopilotPanel.test.tsx`
- Modify: `extension/src/styles.css`
- Modify: `extension/src/styles.test.ts`

- [ ] **Step 1: Write failing client reducer and refresh tests**

```ts
import { expect, it, vi } from 'vitest';

import type { PageKind, ParserRelayMessage, ParserStatus } from '../contracts';
import { acceptParserRelay, requestParserRefresh } from './client';


function relay(
  pageKind: PageKind,
  status: ParserStatus,
  capturedAt: string,
): ParserRelayMessage {
  return {
    type: 'ARC_PARSER_RELAY',
    snapshot: {
      schema_version: 1,
      parser_version: 'boss-dom-v1',
      page_kind: pageKind,
      status,
      captured_at: capturedAt,
      present_fields: [],
      missing_fields: [],
      warnings: [],
    },
    source: { frame_id: 0, document_id: 'anonymous-document' },
  };
}


it('does not let a non-candidate shell overwrite a candidate snapshot', () => {
  const current = relay('resume_frame', 'ready', '2026-07-29T02:00:01.000Z');
  const shell = relay('non_candidate', 'ready', '2026-07-29T02:00:02.000Z');
  expect(acceptParserRelay(current, shell)).toBe(current);
});

it('rejects an older relay and sends only the fixed refresh message', async () => {
  const newer = relay('resume_frame', 'ready', '2026-07-29T02:00:02.000Z');
  const older = relay('resume_frame', 'ready', '2026-07-29T02:00:01.000Z');
  expect(acceptParserRelay(newer, older)).toBe(newer);

  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  await requestParserRefresh(sendMessage);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'ARC_PARSER_REFRESH' });
});
```

Keep all client fixtures anonymous and free of candidate field values.

- [ ] **Step 2: Implement client validation and subscription**

Export:

```ts
export function isParserRelayMessage(value: unknown): value is ParserRelayMessage;
export function acceptParserRelay(
  current: ParserRelayMessage | null,
  incoming: ParserRelayMessage,
): ParserRelayMessage;
export function subscribeToParserRelays(
  listener: (message: ParserRelayMessage) => void,
  runtime?: typeof chrome.runtime,
): () => void;
export function requestParserRefresh(
  sendMessage?: typeof chrome.runtime.sendMessage,
): Promise<void>;
```

`isParserRelayMessage` must validate the snapshot and require non-negative integer `frame_id` plus a string `document_id`. `acceptParserRelay` rejects older `captured_at`; it also rejects `non_candidate` or `unsupported` shell messages while the current message is `recommend_frame` or `resume_frame`. A `logged_out` message is accepted, because it is a security-relevant state. `subscribeToParserRelays` installs one runtime listener and returns a remover. It must not log message bodies.

- [ ] **Step 3: Write failing page-reading card tests**

```tsx
import { buildProfileSnapshot, buildStatusSnapshot } from '../parser/snapshot';


const loggedOutSnapshot = buildStatusSnapshot(
  'logged_out', 'ready', undefined, new Date('2026-07-29T02:00:00.000Z'));
const partialSnapshot = buildProfileSnapshot('resume_frame', {
  display_name: '候选人甲',
  education: [],
  work_experiences: [],
  project_experiences: [],
  skills: ['TypeScript'],
}, new Date('2026-07-29T02:00:00.000Z'));

it('shows the logged-out safe state and an explicit refresh button', async () => {
  const user = userEvent.setup();
  const onRefresh = vi.fn();
  render(<PageReadingCard snapshot={loggedOutSnapshot} onRefresh={onRefresh} refreshing={false} />);
  expect(screen.getByText('BOSS 当前未登录')).toBeInTheDocument();
  expect(screen.queryByText('候选人甲')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '重新读取页面' }));
  expect(onRefresh).toHaveBeenCalledOnce();
});

it('shows a local partial profile without calling it a real assessment', () => {
  render(<PageReadingCard snapshot={partialSnapshot} onRefresh={vi.fn()} refreshing={false} />);
  expect(screen.getByText('BOSS 页面（仅本地）')).toBeInTheDocument();
  expect(screen.getByText('候选人甲')).toBeInTheDocument();
  expect(screen.getByText(/缺少：工作经历/)).toBeInTheDocument();
  expect(screen.queryByText('真实评估')).not.toBeInTheDocument();
});
```

Add this table test plus a refresh-state assertion:

```tsx
it.each([
  [null, '等待页面读取'],
  [buildStatusSnapshot('non_candidate', 'ready', undefined, new Date()),
    '当前页面没有可读取的候选人资料'],
  [buildStatusSnapshot('unsupported', 'unsupported', 'page-structure-unknown', new Date()),
    '当前页面结构暂不支持'],
  [buildStatusSnapshot('resume_frame', 'error', 'parser-exception', new Date()),
    '页面读取失败，可手动重试'],
])('renders the parser state without candidate text', (snapshot, expected) => {
  render(<PageReadingCard snapshot={snapshot} onRefresh={vi.fn()} refreshing={false} />);
  expect(screen.getByText(expected)).toBeInTheDocument();
  expect(screen.queryByText('候选人甲')).not.toBeInTheDocument();
});

it('disables page refresh while a request is in flight', () => {
  render(<PageReadingCard snapshot={loggedOutSnapshot} onRefresh={vi.fn()} refreshing />);
  expect(screen.getByRole('button', { name: '正在重新读取' })).toBeDisabled();
});
```

- [ ] **Step 4: Implement `PageReadingCard` as a pure component**

Use this prop boundary:

```ts
interface PageReadingCardProps {
  snapshot: ParserSnapshot | null;
  onRefresh: () => void;
  refreshing: boolean;
}
```

Render exact primary messages:

- `null`: “等待页面读取”
- `logged_out`: “BOSS 当前未登录” and “扩展已加载，登录后才可读取候选人资料”
- `non_candidate`: “当前页面没有可读取的候选人资料”
- `unsupported`: “当前页面结构暂不支持”
- `error`: “页面读取失败，可手动重试”
- `ready` / `partial`: source badge, `display_name` or “当前候选人”, title/location/year, counts for work/education/project, skill chips, missing field labels, parser version, and formatted local capture time.

Never render warnings as raw exception text; warnings are predefined safe codes and may be mapped to Chinese labels.

- [ ] **Step 5: Integrate parser subscription without coupling it to backend health**

In `CopilotPanel`, add state independent of `connection`:

```ts
const [parserRelay, setParserRelay] = useState<ParserRelayMessage | null>(null);
const [parserRefreshing, setParserRefreshing] = useState(false);

useEffect(() => subscribeToParserRelays((incoming) => {
  setParserRelay((current) => acceptParserRelay(current, incoming));
  setParserRefreshing(false);
}), []);

const refreshPageReading = async () => {
  setParserRefreshing(true);
  try {
    await requestParserRefresh();
  } catch {
    setParserRefreshing(false);
  }
};
```

Render `PageReadingCard` at the top of `<main className="arc-content">`, before all backend connection branches. This ensures logged-out page status remains visible when the Python backend is offline. Keep the assessment block and `arc-demo-badge` unchanged. Change only the footer copy to `M2 页面只读解析 · 评估仍为演示数据 · 无自动操作`.

Mock only the parser client boundary with this in-memory listener harness:

```tsx
const parserClient = vi.hoisted(() => {
  let listener: ((message: ParserRelayMessage) => void) | null = null;
  return {
    emit(message: ParserRelayMessage) { listener?.(message); },
    requestRefresh: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((next: (message: ParserRelayMessage) => void) => {
      listener = next;
      return () => { listener = null; };
    }),
  };
});

vi.mock('../parser/client', () => ({
  acceptParserRelay: (_current: ParserRelayMessage | null, incoming: ParserRelayMessage) => incoming,
  requestParserRefresh: parserClient.requestRefresh,
  subscribeToParserRelays: parserClient.subscribe,
}));
```

Wrap `loggedOutSnapshot` and `partialSnapshot` in `ParserRelayMessage` fixtures named `loggedOutRelay` and `partialRelay`, both using `source: { frame_id: 0, document_id: 'anonymous-document' }`. Then add these integration assertions to `CopilotPanel.test.tsx`:

```tsx
it('shows logged-out page reading while the backend is offline', async () => {
  vi.mocked(getHealth).mockRejectedValue(new Error('offline'));
  render(<CopilotPanel />);
  expect(await screen.findByText('本机服务未连接')).toBeInTheDocument();
  act(() => parserClient.emit(loggedOutRelay));
  expect(screen.getByText('BOSS 当前未登录')).toBeInTheDocument();
});

it('keeps the assessment explicitly demo after a profile relay', async () => {
  render(<CopilotPanel />);
  expect(await screen.findByText('92%')).toBeInTheDocument();
  act(() => parserClient.emit(partialRelay));
  expect(screen.getByText('演示数据')).toBeInTheDocument();
  expect(screen.queryByText('真实评估')).not.toBeInTheDocument();
});
```

Add a third test that clicks “重新读取页面” and asserts mocked `requestParserRefresh` is called once while `navigator.clipboard.writeText` and `window.scrollTo` receive no call from the refresh handler. Do not spy on `HTMLElement.prototype.click` in this UI test because the user's explicit refresh click is itself legitimate; zero automatic clicks are covered by the adapter tests.

- [ ] **Step 6: Add scoped page-reading styles and style contracts**

Add `.arc-reading`, `.arc-reading__status`, `.arc-reading__badge`, `.arc-reading__facts`, `.arc-reading__skills`, and `.arc-reading__missing`. Keep the card inside the existing panel flow; do not alter BOSS layout. Add this test to `styles.test.ts`:

```ts
it('scopes page-reading styles to the extension panel', () => {
  const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
  expect(styles).toMatch(/\.arc-reading\s*{/);
  expect(styles).toMatch(/\.arc-reading__badge\s*{/);
  expect(styles).toMatch(/\.arc-reading[^{]*button[^}]*pointer-events:\s*auto/s);
  expect(styles).not.toMatch(/\.candidate-card-wrap|\.resume-content|\.geek-list|\.c-resume/);
});
```

- [ ] **Step 7: Run focused UI/client tests, typecheck, and commit**

Run:

```powershell
npm.cmd run test --workspace extension -- src/parser/client.test.ts src/components/PageReadingCard.test.tsx src/components/CopilotPanel.test.tsx src/styles.test.ts --run
npm.cmd run typecheck --workspace extension
```

Expected: focused tests PASS and typecheck exits 0.

Commit:

```powershell
git add extension/src/parser/client.ts extension/src/parser/client.test.ts extension/src/components/PageReadingCard.tsx extension/src/components/PageReadingCard.test.tsx extension/src/components/CopilotPanel.tsx extension/src/components/CopilotPanel.test.tsx extension/src/styles.css extension/src/styles.test.ts
git commit -m "feat: preview local BOSS page reads"
```

### Task 7: Runbook and factual M2 validation log

**Files:**
- Modify: `README.md`
- Create: `docs/validation/m2-loop-log.md`

- [ ] **Step 1: Update README status and boundaries**

Replace stale M1 acceptance wording with the observed fact that M1 Chrome acceptance passed, then document M2 as “implemented only after the following verification runs”. The final README must state:

```text
- M2 reads only DOM already rendered in the current authorized page.
- M2 does not use LLM, network interception, private BOSS APIs, automatic clicks, scrolling, navigation, filling, or sending.
- The page-reading preview is local; the 92% assessment remains demo data.
- The logged-out smoke verifies safety plumbing only; real field accuracy requires a separate logged-in manual acceptance.
- Rebuild -> refresh the extension at chrome://extensions -> refresh the test page.
```

Add exact logged-out and logged-in checklists from Task 8. Do not mark a checkbox complete in README; observed results belong only in `m2-loop-log.md`.

- [ ] **Step 2: Create the validation log only from observed evidence**

After the first automated baseline, create `m2-loop-log.md` containing:

- date, branch, baseline commit, and exact commands;
- automated results with exact passed/failed counts;
- unique issue fingerprints in the format `tool:test:error-class:file`;
- at most eight targeted repair rounds, each with new evidence, root cause, changed files, focused command, and result;
- final closure command and result;
- logged-out manual checks actually observed;
- logged-in checks separately marked executed or not executed;
- explicit deferred items: LLM, formal assessment, persistence, cloud, accounts, automation.

Do not create rows containing unresolved placeholder text, assumed results, or candidate content.

- [ ] **Step 3: Verify documentation facts and commit**

Run:

```powershell
rg -n "M2|未登录|仅本地|演示数据|不自动" README.md docs/validation/m2-loop-log.md
git diff --check
```

Expected: required boundary phrases are present and `git diff --check` exits 0.

Commit:

```powershell
git add README.md docs/validation/m2-loop-log.md
git commit -m "docs: add M2 parser acceptance runbook"
```

### Task 8: Bounded self-check, logged-out smoke, and logged-in gate

**Files:**
- Modify only files implicated by newly discovered issues
- Update: `docs/validation/m2-loop-log.md`

- [ ] **Step 1: Run one automated baseline**

Run once:

```powershell
npm.cmd run test:extension
npm.cmd run typecheck:extension
npm.cmd run build:extension
```

Record exact counts and errors. Do not run backend tests at this baseline because M2 does not modify backend code.

- [ ] **Step 2: Run a production-code safety scan**

Run:

```powershell
rg -n --glob "!*.test.ts" --glob "!*.test.tsx" "chrome\.debugger|fetch\(|\.click\(|\.focus\(|scrollTo\(|location\.(assign|replace|reload)|innerHTML|outerHTML|document\.cookie|localStorage|sessionStorage|console\.(log|debug)" extension/src/parser extension/src/content.tsx
```

Expected: no matches. The existing M1 `background.ts` fetch is outside the parser path and remains restricted to two fixed localhost endpoints.

- [ ] **Step 3: Execute at most eight targeted repair rounds**

For round `1..8`:

1. Select one unresolved fingerprint not already repaired with the same evidence and hypothesis.
2. Add or tighten the smallest failing regression test.
3. Run only that test and observe the intended failure.
4. Apply the smallest fix.
5. Run only the affected test or build command.
6. Record fingerprint, evidence, root cause, files, command, and result.
7. Stop when no unique unresolved issue remains.

If the same fingerprint persists, gather materially new evidence and change the hypothesis. Do not repeat the previous edit or rerun the full suite.

- [ ] **Step 4: Run one automated closure**

Run exactly once after targeted repairs:

```powershell
npm.cmd run verify
```

Expected: backend tests, extension tests, TypeScript typecheck, and both production builds exit 0. Record actual counts and bundle sizes; do not predict them in advance.

Inspect the built Manifest:

```powershell
$manifest = Get-Content -Raw -Encoding utf8 extension/dist/manifest.json | ConvertFrom-Json
$manifest.content_scripts[0] | ConvertTo-Json -Depth 5
$manifest.permissions
$manifest.host_permissions
```

Expected: one `content.js`, `all_frames: true`, BOSS plus localhost matches, no debugger/scripting permission, and host permission only for `127.0.0.1:8765`.

- [ ] **Step 5: Perform the logged-out Chrome safety smoke**

Prerequisite: the user confirms the Chrome BOSS session is logged out. Do not sign the user out or change account state automatically.

1. Build is already complete from Step 4.
2. User refreshes the unpacked extension at `chrome://extensions` and refreshes the BOSS page.
3. Open `https://www.zhipin.com/` while logged out.
4. Confirm one floating panel appears and says “BOSS 当前未登录”.
5. Confirm no candidate field is shown.
6. Click “重新读取页面” once; confirm the state returns without click, scroll, navigation, login-field changes, or message actions on BOSS.
7. Observe the page continuously for at least 60 seconds; record whether any visible automatic refresh occurs.
8. On this logged-out page only, manually inspect the Network panel and confirm the parser sends no BOSS request. The existing M1 health request to `http://127.0.0.1:8765` is allowed.
9. Confirm page scroll position, login fields, and inputs are unchanged.

If any automatic refresh, captcha, access restriction, or unexpected navigation appears, stop immediately, record the factual symptom, and do not proceed to login.

- [ ] **Step 6: Stop at the user login gate**

After the logged-out smoke passes, report its six factual results and ask the user to log in manually. Do not perform the login, enter credentials, control the logged-in BOSS tab, or attach CDP/browser automation.

- [ ] **Step 7: Perform logged-in manual parsing acceptance only after user authorization**

The user opens at least five candidate pages they are authorized to view and compares the page-reading card with visible page fields. Record only field-level outcomes:

```text
sample_id: anonymous-1
refresh_observed: no
stale_candidate_observed: no
work_experience: pass|partial|fail|not_present
education: pass|partial|fail|not_present
projects: pass|partial|fail|not_present
skills: pass|partial|fail|not_present
experience_years: pass|partial|fail|not_present
unsupported_message_correct: pass|not_applicable
```

Calculate accuracy as `correct present core fields / total present core fields`. M2 reaches the parser acceptance threshold only at 95% or higher across at least five samples, with no automatic click, scroll, navigation, refresh, input, or message action. Do not store the underlying field values.

- [ ] **Step 8: Commit only the factual closure record**

After updating `m2-loop-log.md`, run:

```powershell
git diff --check
git status --short
```

Commit only if the validation record changed:

```powershell
git add docs/validation/m2-loop-log.md
git commit -m "test: record M2 parser verification"
```

Do not claim M2 complete if logged-in acceptance has not executed. In that case report exactly: automated verification status, logged-out smoke status, logged-in acceptance pending, and the unverified selector areas.
