# Editor Selection Preview Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a “定位预览” editor-toolbar action that reveals the selected Markdown text in the current local preview, scrolls it into view, and briefly highlights the matching rendered block.

**Architecture:** Keep matching and DOM navigation in focused utilities, pass immutable navigation requests from `MarkdownEditor` through `App` into `PreviewPane`, and report a small result state back to the editor. `PreviewPane` owns tab switching and the simplified local preview; the trusted main process locates only the matching loopback Quartz child frame and executes the same bounded reveal behavior without weakening iframe isolation.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, Vitest, Testing Library, jsdom, Electron/Vite.

---

## File Map

- Create `apps/publisher/src/renderer/src/previewNavigation.ts`: request/result types, Markdown-aware text normalization, rendered-block matching, position disambiguation, highlight lifecycle.
- Create `apps/publisher/src/main/previewFrameNavigation.ts`: validate the loopback target, select the exact child frame, and execute bounded reveal code in the cross-origin Quartz frame.
- Create `apps/publisher/tests/unit/preview-navigation.test.ts`: pure matching and DOM navigation regression tests.
- Modify `apps/publisher/src/renderer/src/components/MarkdownEditor.tsx`: read CodeMirror selection, add toolbar button, emit requests, display navigation feedback.
- Modify `apps/publisher/src/renderer/src/components/PreviewPane.tsx`: switch to current-note tab, resolve iframe/fallback roots, run only the latest request, report results.
- Modify `apps/publisher/src/renderer/src/components/PrivateNotePreview.tsx`: expose the simplified-preview article through a ref.
- Modify `apps/publisher/src/renderer/src/App.tsx`: connect editor requests to preview results and invalidate requests when the selected document changes.
- Modify `apps/publisher/src/renderer/src/app.css`: button feedback and temporary preview highlight styles.
- Modify `apps/publisher/tests/unit/editor.test.tsx`: toolbar request and validation behavior.
- Modify `apps/publisher/tests/unit/renderer-security.test.tsx`: PreviewPane tab switching, fallback navigation, iframe safety, and failure behavior.
- Modify `apps/publisher/tests/unit/main-layout.test.tsx`: App wiring and stale-request invalidation.

### Task 1: Build the Markdown-aware preview matcher

**Files:**

- Create: `apps/publisher/src/renderer/src/previewNavigation.ts`
- Create: `apps/publisher/tests/unit/preview-navigation.test.ts`

- [ ] **Step 1: Write failing normalization and matching tests**

Cover these concrete cases with real DOM nodes:

```ts
expect(normalizePreviewNeedles("  **中心极限定理**  ")).toContain("中心极限定理")
expect(findPreviewTarget(article, ["重复内容"], 0.8)?.id).toBe("late")
expect(findPreviewTarget(article, ["不存在"], 0.5)).toBeUndefined()
```

Build the duplicate fixture with two `<p>` elements carrying the same text at different positions and mock `getBoundingClientRect()` so the requested source ratio selects the closest candidate.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/preview-navigation.test.ts
```

Expected: FAIL because `previewNavigation.ts` and its exports do not exist.

- [ ] **Step 3: Implement normalization and target selection**

Export these exact contracts:

```ts
export interface PreviewNavigationRequest {
  readonly id: number
  readonly documentPath: string
  readonly text: string
  readonly positionRatio: number
}

export type PreviewNavigationResult = "found" | "not-found" | "not-ready"

export function normalizePreviewNeedles(source: string): readonly string[]
export function findPreviewTarget(
  root: HTMLElement,
  needles: readonly string[],
  positionRatio: number,
): HTMLElement | undefined
```

Normalize CRLF and repeated whitespace. Generate a second needle by removing common Markdown heading, emphasis, inline-code, image, and link delimiters without executing HTML. Search only `h1`–`h6`, `p`, `li`, `blockquote`, `pre`, `td`, and `th`. Reject candidates inside `nav`, `.toc`, `script`, `style`, or `[aria-hidden="true"]`. Rank duplicate candidates by the absolute distance between their normalized vertical position inside the root and `positionRatio`.

- [ ] **Step 4: Add scroll/highlight lifecycle tests, then implementation**

Add tests proving that `revealPreviewSelection()`:

```ts
const cleanup = revealPreviewSelection(root, request)
expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" })
expect(target).toHaveClass("publisher-preview-locate-highlight")
cleanup?.()
expect(target).not.toHaveClass("publisher-preview-locate-highlight")
```

Run the test once to see the missing-export failure, then implement:

```ts
export function revealPreviewSelection(
  root: HTMLElement,
  request: PreviewNavigationRequest,
): { readonly result: PreviewNavigationResult; readonly cleanup?: () => void }
```

Limit matching input to 4,096 characters by retaining both the beginning and end. Return `not-found` without scrolling when no candidate exists. Add the highlight class before scrolling; cleanup removes only the class added by this invocation.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
npm run test:run -- tests/unit/preview-navigation.test.ts
```

Expected: all tests pass.

Commit:

```powershell
git add apps/publisher/src/renderer/src/previewNavigation.ts apps/publisher/tests/unit/preview-navigation.test.ts
git commit -m "feat(publisher): match editor selections in previews"
```

### Task 2: Add the editor toolbar request

**Files:**

- Modify: `apps/publisher/src/renderer/src/components/MarkdownEditor.tsx`
- Modify: `apps/publisher/tests/unit/editor.test.tsx`

- [ ] **Step 1: Write failing editor interaction tests**

Extend the editor render helper with:

```ts
onRevealPreview = { onRevealPreview }
previewNavigationMessage = { message }
```

Use the existing CodeMirror test access pattern to dispatch a non-empty selection, click “定位预览”, and expect:

```ts
expect(onRevealPreview).toHaveBeenCalledWith({
  text: "目标段落",
  positionRatio: expect.any(Number),
})
```

Add separate tests for a collapsed/whitespace-only selection showing “请先选择要定位的文字”, and for `readOnly` disabling the button.

- [ ] **Step 2: Run the editor tests and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/editor.test.tsx
```

Expected: FAIL because the new props and toolbar button are absent.

- [ ] **Step 3: Implement the toolbar action**

Add these props:

```ts
readonly onRevealPreview?: (selection: {
  readonly text: string
  readonly positionRatio: number
}) => void
readonly previewNavigationMessage?: string
```

On click, read `editor.current.state.selection.main`, use `sliceDoc(from, to)`, reject trimmed-empty text, and calculate `(from + to) / 2 / Math.max(1, doc.length)`. Add the “定位预览” button beside “搜索” and an `aria-live="polite"` status message in the toolbar region. Do not alter the document or selection.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
npm run test:run -- tests/unit/editor.test.tsx
```

Expected: all editor tests pass.

Commit:

```powershell
git add apps/publisher/src/renderer/src/components/MarkdownEditor.tsx apps/publisher/tests/unit/editor.test.tsx
git commit -m "feat(publisher): request preview location from editor"
```

### Task 3: Navigate the current-note preview

**Files:**

- Modify: `apps/publisher/src/renderer/src/components/PreviewPane.tsx`
- Modify: `apps/publisher/src/renderer/src/components/PrivateNotePreview.tsx`
- Modify: `apps/publisher/src/renderer/src/app.css`
- Modify: `apps/publisher/tests/unit/renderer-security.test.tsx`

- [ ] **Step 1: Write failing PreviewPane tests**

Add `navigation` and `onNavigationResult` to the PreviewPane test render helper. Cover:

- a request switches from “全站本地” to “当前笔记”;
- a simplified preview finds text, calls `scrollIntoView`, and receives `found`;
- a missing string receives `not-found` and does not scroll;
- an inaccessible or unloaded iframe receives `not-ready` without relaxing its sandbox;
- request `id: 2` supersedes request `id: 1`.

- [ ] **Step 2: Run PreviewPane tests and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/renderer-security.test.tsx
```

Expected: FAIL because PreviewPane does not accept navigation props.

- [ ] **Step 3: Implement refs, tab switching, and latest-request handling**

Add PreviewPane props:

```ts
readonly navigation?: PreviewNavigationRequest
readonly onNavigationResult?: (requestId: number, result: PreviewNavigationResult) => void
```

Keep a ref for the simplified-preview article. On a new request, set the tab to `note`; after the tab renders, use `revealPreviewSelection` for the fallback or call the restricted preview IPC for the exact Quartz URL. The main process accepts only `http://127.0.0.1` URLs, selects the exact matching child frame, and executes the reveal there. Clear previous cleanup/timers, report only the latest request, and retry once from iframe `onLoad` for a still-current `not-ready` request. Never inspect the online-public iframe.

Update `LocalNotePreview` to accept an optional `articleRef: Ref<HTMLElement>` and attach it only to the rendered article.

Add `.publisher-preview-locate-highlight` to app CSS and inject the equivalent rule inside the validated Quartz child frame with a single `<style data-publisher-preview-navigation>` node. Use outline/background only; do not mutate text nodes.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
npm run test:run -- tests/unit/renderer-security.test.tsx tests/unit/preview-navigation.test.ts
```

Expected: all selected tests pass.

Commit:

```powershell
git add apps/publisher/src/renderer/src/components/PreviewPane.tsx apps/publisher/src/renderer/src/components/PrivateNotePreview.tsx apps/publisher/src/renderer/src/app.css apps/publisher/tests/unit/renderer-security.test.tsx
git commit -m "feat(publisher): reveal selections in current preview"
```

### Task 4: Wire requests through App and invalidate stale work

**Files:**

- Modify: `apps/publisher/src/renderer/src/App.tsx`
- Modify: `apps/publisher/tests/unit/main-layout.test.tsx`

- [ ] **Step 1: Write failing App wiring tests**

Add a test that selects editor text, clicks “定位预览”, and observes the current-preview tab selected plus a success status after the preview reports `found`. Add another test that changes the selected note before an older result arrives and verifies that the old result does not update the new note’s message.

- [ ] **Step 2: Run the App tests and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/main-layout.test.tsx
```

Expected: FAIL because App does not hold or connect navigation state.

- [ ] **Step 3: Implement immutable request/result state**

Add state and a monotonic ref:

```ts
const previewNavigationId = useRef(0)
const [previewNavigation, setPreviewNavigation] = useState<PreviewNavigationRequest>()
const [previewNavigationMessage, setPreviewNavigationMessage] = useState<string>()
```

When the editor emits a selection, create a request containing the current `document.path`. Clear both states whenever `document?.path` changes. Accept PreviewPane results only when both request ID and document path still match. Map results to “已定位到预览”, “预览中未找到对应内容”, and “当前预览尚未就绪”.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
npm run test:run -- tests/unit/main-layout.test.tsx tests/unit/editor.test.tsx tests/unit/renderer-security.test.tsx tests/unit/preview-navigation.test.ts
```

Expected: all selected tests pass.

Commit:

```powershell
git add apps/publisher/src/renderer/src/App.tsx apps/publisher/tests/unit/main-layout.test.tsx
git commit -m "feat(publisher): connect editor preview navigation"
```

### Task 5: Full verification, packaging, installation, and sync

**Files:**

- Verify all files from Tasks 1–4.
- Preserve unrelated user changes in `apps/publisher/package.json`, `apps/publisher/package-lock.json`, `content/extracurricular/agent-study.md`, and `.tmp-render-check.png`.

- [ ] **Step 1: Format only touched files and run type checking**

Run:

```powershell
npx prettier src/renderer/src/previewNavigation.ts src/renderer/src/components/MarkdownEditor.tsx src/renderer/src/components/PreviewPane.tsx src/renderer/src/components/PrivateNotePreview.tsx src/renderer/src/App.tsx src/renderer/src/app.css tests/unit/preview-navigation.test.ts tests/unit/editor.test.tsx tests/unit/renderer-security.test.tsx tests/unit/main-layout.test.tsx --write
npm run typecheck
```

Expected: type checking exits 0.

- [ ] **Step 2: Run the full test suite**

Run:

```powershell
npm run test:run -- --testTimeout=30000
```

Expected: all non-skipped tests pass.

- [ ] **Step 3: Run focused Electron end-to-end coverage**

Add or extend one Playwright scenario to select editor text, click “定位预览”, and verify that the current-note preview reports success without producing file changes. Run:

```powershell
npx playwright test tests/e2e/app.spec.ts --grep "locates selected editor text in the current preview"
```

Expected: 1 test passes.

- [ ] **Step 4: Build and package**

Run:

```powershell
npm run build
npm exec electron-builder -- --win dir
```

Expected: both commands exit 0 and `release/win-unpacked/resources/app.asar` exists.

- [ ] **Step 5: Install with a recoverable backup**

Verify exact build and install paths, copy the current installation to a timestamped sibling backup, stop only `Knowledge Garden Publisher` processes, copy `release/win-unpacked` over the exact install directory, compare SHA-256 hashes of built and installed `resources/app.asar`, then restart the installed executable hidden. Abort if any resolved path differs from the expected absolute path.

- [ ] **Step 6: Final verification and Git sync**

Confirm the installed app is running, the built and installed hashes match, `git diff --check` is clean for feature files, and both remotes point to the feature HEAD. Commit any final E2E-only change, then push `main` to `publisher` and `origin` without staging the unrelated user files listed above.
