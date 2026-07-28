# M1 Framework and Demo Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable Chrome floating panel and FastAPI service that demonstrate connectivity, deterministic sample scoring, collapsible UI, evidence details, and copy-only communication suggestions for tomorrow's acceptance.

**Architecture:** A Manifest V3 TypeScript/React content script mounts an isolated Shadow DOM panel on supported pages and sends typed messages to an extension Service Worker. The Service Worker proxies only two fixed endpoints on the FastAPI service bound to `127.0.0.1`; no real BOSS parsing, LLM call, or persistence is claimed in M1.

**Tech Stack:** Node.js 24, npm workspaces, TypeScript, React, Vite, Vitest, Testing Library, Python 3.14, FastAPI, Pydantic, pytest, httpx2.

---

## Scope and acceptance boundary

M1 is complete only when all of the following are demonstrated:

- `GET /healthz` returns a typed healthy response.
- `POST /v1/demo/assessment` validates dimension weights, calculates the total in Python, and returns a stable sample assessment.
- The extension builds into `extension/dist` with a valid Manifest V3 manifest and one content-script bundle.
- On a supported page, a right-side floating panel appears inside Shadow DOM and can collapse and expand.
- The panel distinguishes connecting, online, and offline states.
- An online panel loads the demo assessment, renders total score, dimensions, evidence, risk flags, and follow-up questions.
- Three demo communication suggestions can be selected and copied; the extension never types or sends them into the page.
- Backend and extension tests pass, the extension production build succeeds, and a manual smoke checklist is recorded.

Explicitly deferred: real BOSS DOM parsing, LLM providers, SQLite persistence, editable job configuration, batch-list extraction, automated messaging, cloud deployment, and accounts.

## File map

```text
.
├─ package.json                         # npm workspace and root verification commands
├─ .gitignore                           # generated files, secrets, local data
├─ .env.example                         # non-secret backend configuration example
├─ README.md                            # M1 setup and acceptance instructions
├─ backend/
│  ├─ requirements-dev.txt              # Python runtime and test dependencies
│  ├─ app/
│  │  ├─ __init__.py
│  │  ├─ main.py                        # FastAPI app, CORS, request-id middleware
│  │  ├─ models.py                      # API request/response contracts
│  │  ├─ scoring.py                     # deterministic score validation/calculation
│  │  └─ demo.py                        # stable demo assessment factory
│  └─ tests/
│     ├─ test_health.py
│     ├─ test_scoring.py
│     └─ test_demo_assessment.py
├─ extension/
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ vite.config.ts
│  ├─ public/manifest.json
│  └─ src/
│     ├─ api.ts                         # local backend client
│     ├─ background.ts                  # fixed-endpoint localhost network proxy
│     ├─ contracts.ts                   # M1 response types
│     ├─ content.tsx                    # Shadow DOM mount entry
│     ├─ styles.css                     # panel-scoped visual system
│     ├─ test/setup.ts
│     ├─ api.test.ts
│     ├─ components/CopilotPanel.tsx
│     ├─ components/CopilotPanel.test.tsx
│     └─ manifest.test.ts              # MV3 service worker declaration
├─ scripts/python.cmd                   # Unicode-path-safe Python entry using venv packages
└─ docs/validation/m1-loop-log.md        # unique findings and targeted rechecks
```

### Task 1: Repository foundation

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `backend/requirements-dev.txt`
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/vite.config.ts`
- Create: `extension/public/manifest.json`
- Create: `scripts/python.cmd`

- [ ] **Step 1: Add root workspace commands**

Create `package.json` with scripts that call the extension workspace and use Windows-compatible `npm.cmd` in documentation:

```json
{
  "name": "ai-recruitment-copilot",
  "private": true,
  "workspaces": ["extension"],
  "scripts": {
    "test:extension": "npm run test --workspace extension",
    "build:extension": "npm run build --workspace extension",
    "test:backend": "scripts\\python.cmd -m pytest backend/tests -q"
  }
}
```

- [ ] **Step 2: Add safe ignore rules and environment example**

Ignore `node_modules`, `dist`, Python caches, virtual environments, `.env`, SQLite files, logs, coverage output, and editor files. Expose only `ARC_API_HOST=127.0.0.1` and `ARC_API_PORT=8765` in `.env.example`; no secret value is committed.

- [ ] **Step 3: Define backend dependencies**

Use compatible current releases resolved by pip in `backend/requirements-dev.txt`:

```text
fastapi
uvicorn[standard]
pytest
httpx2
```

- [ ] **Step 4: Configure the extension build**

Configure a single Vite IIFE entry at `src/content.tsx`, output as `dist/content.js`, and copy `public/manifest.json` into `dist`. The manifest must match `https://www.zhipin.com/*` and `http://127.0.0.1/*`, request only `storage` and `clipboardWrite`, and connect only to `http://127.0.0.1:8765/*`.

- [ ] **Step 5: Install dependencies and verify the source manifest**

Run:

```powershell
npm.cmd install
py -3.14 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
Get-Content -Raw extension/public/manifest.json | ConvertFrom-Json | Out-Null
```

Expected: npm and pip exit 0 and the source manifest parses as JSON. The production build is intentionally deferred until `content.tsx` exists in Task 4.

Create `scripts/python.cmd` so Python can run from a workspace containing Chinese characters while still using the packages installed in `.venv`:

```bat
@echo off
set "PYTHONPATH=%~dp0..\.venv\Lib\site-packages;%PYTHONPATH%"
py -3.14 %*
```

- [ ] **Step 6: Commit the foundation**

```powershell
git add package.json package-lock.json .gitignore .env.example backend/requirements-dev.txt extension
git commit -m "chore: scaffold extension and backend"
```

### Task 2: Deterministic backend slice

**Files:**
- Create: `backend/app/__init__.py`
- Create: `backend/app/models.py`
- Create: `backend/app/scoring.py`
- Create: `backend/app/demo.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/test_health.py`
- Create: `backend/tests/test_scoring.py`
- Create: `backend/tests/test_demo_assessment.py`

- [ ] **Step 1: Write failing score tests**

Cover a 92-point weighted result and invalid weights:

```python
import pytest

from backend.app.scoring import calculate_total_score, validate_weights


def test_calculate_total_score() -> None:
    assert calculate_total_score([(95, 30), (90, 30), (95, 20), (88, 20)]) == 92


@pytest.mark.parametrize("weights", [[30, 30], [100, 1], [-1, 101]])
def test_rejects_invalid_weights(weights: list[int]) -> None:
    with pytest.raises(ValueError):
        validate_weights(weights)
```

- [ ] **Step 2: Run the focused test and observe the intended failure**

Run: `scripts\python.cmd -m pytest backend/tests/test_scoring.py -q`

Expected: collection/import failure because `backend.app.scoring` does not exist.

- [ ] **Step 3: Implement the scoring boundary**

`validate_weights(weights)` accepts integer weights from 0 through 100 only and requires an exact sum of 100. `calculate_total_score(weighted_scores)` validates scores from 0 through 100 and returns `round(sum(score * weight) / 100)`.

- [ ] **Step 4: Define typed M1 contracts**

Use Pydantic models for `HealthResponse`, `DimensionResult`, `MessageSuggestion`, `DemoAssessmentRequest`, and `AssessmentResponse`. Every assessment response includes `request_id`, `candidate_label`, `job_title`, `total_score`, `recommendation`, `dimensions`, `highlights`, `risk_flags`, `follow_up_questions`, and `messages`.

- [ ] **Step 5: Add the fixed demo factory**

Return four dimensions with scores and weights `(95,30)`, `(90,30)`, `(95,20)`, and `(88,20)`. Total score must be obtained from `calculate_total_score`, not hard-coded. Mark all returned content as `demo` through a `mode` field.

- [ ] **Step 6: Write API tests before endpoints**

```python
from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_demo_assessment_is_explicitly_demo() -> None:
    response = client.post("/v1/demo/assessment", json={"candidate_label": "张同学"})
    body = response.json()
    assert response.status_code == 200
    assert body["mode"] == "demo"
    assert body["total_score"] == 92
    assert len(body["dimensions"]) == 4
```

- [ ] **Step 7: Implement FastAPI endpoints and safe CORS**

Create `GET /healthz` and `POST /v1/demo/assessment`. Bind behavior is controlled by the uvicorn command, not application code. CORS allows the Chrome extension origin regex and `http://127.0.0.1` development origins. Add or preserve `X-Request-ID` and return it in typed bodies.

- [ ] **Step 8: Run backend tests**

Run: `scripts\python.cmd -m pytest backend/tests -q`

Expected: all backend tests pass with no warning caused by project code.

- [ ] **Step 9: Commit the backend slice**

```powershell
git add backend
git commit -m "feat: add deterministic demo assessment API"
```

### Task 3: Extension API client and state model

**Files:**
- Create: `extension/src/contracts.ts`
- Create: `extension/src/api.ts`
- Create: `extension/src/api.test.ts`
- Create: `extension/src/background.ts`
- Create: `extension/src/background.test.ts`
- Create: `extension/src/validation.ts`
- Create: `extension/src/test/setup.ts`
- Modify: `extension/public/manifest.json`
- Modify: `extension/vite.config.ts`

- [ ] **Step 1: Define TypeScript contracts matching the backend**

Define `ConnectionState = 'connecting' | 'online' | 'offline'`, `DimensionResult`, `MessageSuggestion`, `AssessmentResponse`, the two allowed `ApiRequestMessage` variants, and typed success/failure envelopes. Use the same snake_case JSON property names as the API to avoid an untested translation layer in M1.

- [ ] **Step 2: Write failing client tests**

Mock `chrome.runtime.sendMessage` and verify that the content-side client sends a named operation rather than an arbitrary URL:

```ts
import { vi } from 'vitest';

import { getHealth } from './api';


const health = {
  request_id: 'health-1',
  status: 'ok',
  service: 'ai-recruitment-copilot',
  version: '0.1.0',
};


it('asks the service worker for health', async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: health });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  await getHealth(1200);
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'ARC_API_REQUEST',
    operation: 'health',
    timeout_ms: 1200,
  });
});
```

- [ ] **Step 3: Implement the fixed-operation Service Worker boundary**

Implement `getHealth(timeoutMs = 1500)` and `getDemoAssessment(candidateLabel, timeoutMs = 5000)` through `chrome.runtime.sendMessage`. In `background.ts`, accept only `health` and `demo-assessment`, map them to the two fixed localhost endpoints, and perform timeout-safe fetches with `AbortController`. Validate response shapes before passing them to React. Register `background.js` in the MV3 manifest and build it as a second self-contained IIFE entry.

- [ ] **Step 4: Run focused client tests**

Run: `npm.cmd run test --workspace extension -- src/api.test.ts src/background.test.ts src/manifest.test.ts --run`

Expected: content-client, background transport, operation whitelist, malformed response, and manifest tests all pass.

- [ ] **Step 5: Commit the client boundary**

```powershell
git add extension/src/contracts.ts extension/src/api.ts extension/src/api.test.ts extension/src/background.ts extension/src/background.test.ts extension/src/validation.ts extension/src/test/setup.ts extension/public/manifest.json extension/vite.config.ts
git commit -m "feat: connect extension to local API"
```

### Task 4: Shadow DOM floating panel

**Files:**
- Create: `extension/src/components/CopilotPanel.tsx`
- Create: `extension/src/components/CopilotPanel.test.tsx`
- Create: `extension/src/content.tsx`
- Create: `extension/src/styles.css`

- [ ] **Step 1: Write interaction tests first**

Test these observable behaviors:

```ts
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { getDemoAssessment, getHealth } from '../api';
import type { AssessmentResponse } from '../contracts';
import { CopilotPanel } from './CopilotPanel';


vi.mock('../api', () => ({
  getHealth: vi.fn(),
  getDemoAssessment: vi.fn(),
}));

const assessment: AssessmentResponse = {
  request_id: 'request-1',
  mode: 'demo',
  candidate_label: '张同学',
  job_title: 'AI4S 工程师',
  total_score: 92,
  recommendation: '非常匹配，建议联系',
  dimensions: [{
    key: 'research',
    name: '研究方向匹配',
    score: 95,
    weight: 30,
    confidence: 0.94,
    reason: '方向高度相关',
    evidence: ['蛋白结构预测项目'],
  }],
  highlights: ['具备 AI for Science 经验'],
  risk_flags: ['工业化经验需确认'],
  follow_up_questions: ['是否有产业落地经验？'],
  messages: [{
    type: 'greeting',
    label: '打招呼话术',
    content: '您好，想和您沟通 AI4S 工程师岗位。',
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHealth).mockResolvedValue({ status: 'ok', service: 'ai-recruitment-copilot' });
  vi.mocked(getDemoAssessment).mockResolvedValue(assessment);
});

it('shows offline guidance when health check fails', async () => {
  vi.mocked(getHealth).mockRejectedValue(new Error('offline'));
  render(<CopilotPanel />);
  expect(await screen.findByText('本机服务未连接')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新连接' })).toBeInTheDocument();
});

it('loads demo assessment when backend is online', async () => {
  render(<CopilotPanel />);
  expect(await screen.findByText('92%')).toBeInTheDocument();
  expect(screen.getByText('演示数据')).toBeInTheDocument();
});

it('collapses to the edge rail and expands again', async () => {
  const user = userEvent.setup();
  render(<CopilotPanel />);
  await screen.findByText('92%');
  await user.click(screen.getByRole('button', { name: '折叠助手' }));
  expect(screen.getByRole('button', { name: '展开助手' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '展开助手' }));
  expect(screen.getByRole('button', { name: '折叠助手' })).toBeInTheDocument();
});

it('copies only after an explicit user click', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const user = userEvent.setup();
  render(<CopilotPanel />);
  await screen.findByText('92%');
  expect(writeText).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '复制话术' }));
  expect(writeText).toHaveBeenCalledWith('您好，想和您沟通 AI4S 工程师岗位。');
});
```

The tests must assert that there is no automatic call to `navigator.clipboard.writeText` during render.

- [ ] **Step 2: Run the focused component test and observe failure**

Run: `npm.cmd run test --workspace extension -- src/components/CopilotPanel.test.tsx --run`

Expected: import or assertion failure because the component is not implemented.

- [ ] **Step 3: Implement the panel state machine**

On mount, check health. Offline state shows the exact start command and a retry button. Online state requests the demo assessment and renders a visible `演示数据` badge. Maintain independent state for collapse, active message tab, expanded dimension, copy feedback, and retry.

- [ ] **Step 4: Implement the visual hierarchy**

Use a 400-pixel white panel, dark navy header, teal primary accent, amber star/score accent, compact dimension bars, risk and follow-up cards, and three message tabs. Use only system fonts. At viewport widths below 720 pixels, cap the panel at `calc(100vw - 24px)`. The collapsed rail remains at the right edge and displays `AI`, `92%`, and an expand button.

- [ ] **Step 5: Mount in isolated Shadow DOM**

`content.tsx` creates a single host with id `ai-recruitment-copilot-root`, attaches an open Shadow DOM, inserts the CSS text into a `<style>`, and renders `CopilotPanel`. Re-running the content script must not mount a duplicate host.

- [ ] **Step 6: Run component tests and build**

Run:

```powershell
npm.cmd run test --workspace extension -- --run
npm.cmd run build --workspace extension
```

Expected: all extension tests pass and Vite exits 0.

- [ ] **Step 7: Commit the panel**

```powershell
git add extension
git commit -m "feat: add floating copilot demo panel"
```

### Task 5: Local runbook and manual acceptance page

**Files:**
- Create: `README.md`
- Create: `docs/validation/m1-loop-log.md`

- [ ] **Step 1: Document exact startup commands**

Document:

```powershell
scripts\python.cmd -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765
npm.cmd run build:extension
```

Then explain Chrome `chrome://extensions` → Developer mode → Load unpacked → select `extension/dist`.

- [ ] **Step 2: Document the acceptance script**

The manual checklist must cover backend health, panel injection, online state, 92% demo result, dimension expansion, message tabs, copy feedback, collapse/expand, offline guidance after stopping the backend, and confirmation that no page input or message is changed.

- [ ] **Step 3: Clearly label M1 limitations**

The README must state that all assessment content is demo data and that M1 has no real BOSS parsing, LLM request, database, or automated action.

- [ ] **Step 4: Commit the runbook**

```powershell
git add README.md docs/validation/m1-loop-log.md
git commit -m "docs: add M1 acceptance runbook"
```

### Task 6: Bounded self-check and repair loop

**Files:**
- Modify: only files implicated by a newly discovered issue
- Update: `docs/validation/m1-loop-log.md`

- [ ] **Step 1: Establish the baseline once**

Run the complete automated baseline once:

```powershell
scripts\python.cmd -m pytest backend/tests -q
npm.cmd run test --workspace extension -- --run
npm.cmd run build --workspace extension
```

Record command, result, and each unique issue fingerprint as `tool:test-id:error-class:file`.

- [ ] **Step 2: Execute at most eight repair rounds**

For round `1..8`:

1. Select only unresolved findings not already repaired with the same evidence and hypothesis.
2. Diagnose the smallest responsible boundary.
3. Add or tighten a focused regression test where applicable.
4. Apply the smallest repair.
5. Run only the focused test or build step affected by that repair.
6. Record the fingerprint, root cause, changed files, and exact focused command.
7. Stop immediately when no unresolved finding remains.

If the same fingerprint persists, do not repeat the previous repair or rerun the whole suite. Gather materially new evidence and change the hypothesis; if none exists, stop and report it as unresolved.

- [ ] **Step 3: Perform one final closure verification**

After the targeted loop is clean—or after round 8—run the complete backend tests, extension tests, and extension build exactly once. Then execute the manual acceptance checklist once. Do not claim any browser behavior that was not actually observed.

- [ ] **Step 4: Record factual outcome**

The loop log must include:

- number of repair rounds actually used;
- unique findings, including unresolved ones;
- exact passing and failing commands;
- manual checks actually performed;
- deferred functionality that is not implemented.

- [ ] **Step 5: Commit final verified state**

```powershell
git add .
git commit -m "test: verify M1 demo slice"
```

Do not create an empty commit when the verification loop produced no tracked-file change.

## Execution policy

- Work on `codex/m1-framework-demo`, not directly on `main`.
- Use test-driven changes for behavior: failing focused test, minimal implementation, passing focused test.
- Preserve unrelated user changes and stage explicit paths until the final verified scope is known.
- Never exceed eight repair rounds.
- Do not rerun all checks after every fix; use impact-based targeted verification and one final full closure run.
- Final reporting must separate verified behavior, unverified behavior, and deferred scope. It must include exact test/build counts and any remaining failures.
