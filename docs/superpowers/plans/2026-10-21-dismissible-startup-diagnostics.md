# Dismissible Startup Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the non-blocking startup diagnostics banner to be dismissed for the current session and make a repeated occupied-port result explicit.

**Architecture:** Keep dismissal state inside `PublisherStartup`, so it resets naturally when the application restarts. Add an optional close callback to `FirstRun`; only the compact banner receives it. Track whether a diagnostic retry was requested and provide a specific status message when that retry still reports `PREVIEW_PORT_UNAVAILABLE`.

**Tech Stack:** React 19, TypeScript, Lucide React, Vitest, Testing Library, CSS.

---

### Task 1: Specify close-button behavior

**Files:**
- Modify: `apps/publisher/tests/unit/first-run.test.tsx`
- Modify: `apps/publisher/src/renderer/src/components/FirstRun.tsx`
- Modify: `apps/publisher/src/renderer/src/app.css`

- [ ] **Step 1: Write the failing component test**

Add a test that renders compact `FirstRun` with `onClose`, clicks the accessible button named `关闭启动检查提示`, and expects the callback once. Also assert that the button is absent when `onClose` is omitted.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:run -- tests/unit/first-run.test.tsx`

Expected: FAIL because `FirstRunProps` does not accept `onClose` and no close button exists.

- [ ] **Step 3: Implement the minimal component behavior**

Import `X` from `lucide-react`, add `readonly onClose?: () => void`, and render:

```tsx
{onClose ? (
  <button
    type="button"
    className="first-run-close"
    aria-label="关闭启动检查提示"
    onClick={onClose}
  >
    <X aria-hidden="true" />
  </button>
) : null}
```

Position `.first-run-close` at the card's top-right and keep keyboard focus visible.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm run test:run -- tests/unit/first-run.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/publisher/tests/unit/first-run.test.tsx apps/publisher/src/renderer/src/components/FirstRun.tsx apps/publisher/src/renderer/src/app.css
git commit -m "feat(publisher): make startup diagnostics dismissible"
```

### Task 2: Wire session dismissal and retry feedback

**Files:**
- Modify: `apps/publisher/tests/unit/main-layout.test.tsx`
- Modify: `apps/publisher/src/renderer/src/App.tsx`

- [ ] **Step 1: Write failing integration tests**

Extend the transient-diagnostics test to click `关闭启动检查提示`, then assert the startup region disappears while the Markdown editor remains visible. Add a test whose first and second `workspace.inspect` calls both return `PREVIEW_PORT_UNAVAILABLE`; click `重新检查` and assert `重新检查完成：预览端口仍被占用。` appears.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:run -- tests/unit/main-layout.test.tsx`

Expected: FAIL because `PublisherStartup` does not expose dismissal or retry-result feedback.

- [ ] **Step 3: Implement session-only state**

Add state in `PublisherStartup`:

```tsx
const [diagnosticsDismissed, setDiagnosticsDismissed] = useState(false)
const [diagnosticsRetried, setDiagnosticsRetried] = useState(false)
```

When the compact banner is eligible, render it only if not dismissed, pass `onClose={() => setDiagnosticsDismissed(true)}`, and make its retry handler set `diagnosticsRetried` before invoking inspection. Derive the retry message only when the latest inspection still includes `PREVIEW_PORT_UNAVAILABLE`, then pass it to `FirstRun` as status feedback.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm run test:run -- tests/unit/main-layout.test.tsx tests/unit/first-run.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/publisher/tests/unit/main-layout.test.tsx apps/publisher/src/renderer/src/App.tsx apps/publisher/src/renderer/src/components/FirstRun.tsx
git commit -m "fix(publisher): report occupied port after retry"
```

### Task 3: Verify and release

**Files:**
- Modify: `apps/publisher/package.json`
- Modify: `apps/publisher/package-lock.json`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Run focused regression tests**

Run: `npm run test:run -- tests/unit/first-run.test.tsx tests/unit/main-layout.test.tsx`

Expected: all tests pass.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Bump the publisher version to 0.1.4**

Update both package manifests consistently without changing dependency selections.

- [ ] **Step 4: Build the Windows installer**

Run: `npm run package:win`

Expected: an NSIS installer for version 0.1.4 is produced successfully.

- [ ] **Step 5: Install and smoke-check the release**

Install 0.1.4 over the current application, confirm the installed executable reports version 0.1.4, and launch it.

- [ ] **Step 6: Update handoff and commit release metadata**

Record the behavior, tests, artifact, and install verification in `HANDOFF.md`, then commit all release metadata.
