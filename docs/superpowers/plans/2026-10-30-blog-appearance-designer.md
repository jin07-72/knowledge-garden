# Blog Appearance Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Quartz appearance designer to Knowledge Garden Publisher with presets, full visual controls, custom CSS, loopback-only live preview, atomic apply, one-step undo, and explicit publication through the existing review flow.

**Architecture:** Keep the renderer framework-neutral through a normalized appearance model and an `AppearanceAdapter` service boundary. The first adapter owns only marked Quartz files and resources; preview CSS is injected only into the exact local preview frame, while durable writes use a journaled cross-file transaction and build verification before success is reported.

**Tech Stack:** Electron 44, React 19, TypeScript, Zod, YAML, Vitest, Testing Library, Playwright, Quartz 5, Node filesystem primitives.

---

## Scope and delivery boundaries

This plan produces one working Quartz feature. It also introduces the adapter boundary and framework detection result needed for future Hugo and Hexo plans, but it does not add Hugo or Hexo preview, publishing, or file writes. A framework reported as unsupported remains read-only.

The implementation must preserve the user's existing uncommitted files. Every commit command below stages only the paths listed in that task.

## File structure

### Shared contract and pure model

- Create `apps/publisher/src/shared/appearance.ts`: normalized settings, presets, defaults, CSS compiler, managed-path constants, and pure validation helpers.
- Modify `apps/publisher/src/shared/contracts.ts`: appearance IPC DTOs, errors, channels, and `GardenApi.appearance`.
- Modify `apps/publisher/src/shared/ipcSchemas.ts`: strict request and response schemas with size bounds.

### Main-process services

- Create `apps/publisher/src/main/services/appearance/appearanceAdapter.ts`: adapter and plan interfaces plus framework detection result.
- Create `apps/publisher/src/main/services/appearance/quartzAppearanceAdapter.ts`: Quartz config/manifest/custom-SCSS reader and managed write-plan generator.
- Create `apps/publisher/src/main/services/appearance/appearanceAssets.ts`: native image selection, bounded staging sessions, and staged-resource resolution.
- Create `apps/publisher/src/main/services/appearance/appearanceTransaction.ts`: durable journal, optimistic revalidation, atomic replacement, rollback, restart recovery, and one-step history.
- Create `apps/publisher/src/main/services/appearance/appearanceService.ts`: orchestration for read, preview, apply, undo, and dispose.
- Create `apps/publisher/src/main/previewAppearance.ts`: exact-loopback-frame style injection and removal.
- Modify `apps/publisher/src/main/publisherServices.ts`, `apps/publisher/src/main/ipc.ts`, and `apps/publisher/src/main/index.ts`: service lifetime, IPC, Electron dialog adapter, frame access, and preview build verification.
- Modify `apps/publisher/src/preload/gardenApi.ts`: frozen appearance bridge.

### Renderer

- Create `apps/publisher/src/renderer/src/components/AppearanceDesigner.tsx`: modal orchestration and async states.
- Create `apps/publisher/src/renderer/src/components/AppearanceControls.tsx`: presets, background, palette, fonts, layout, and custom CSS controls.
- Create `apps/publisher/src/renderer/src/components/AppearancePreview.tsx`: preview frame container and unavailable state.
- Modify `apps/publisher/src/renderer/src/App.tsx`: top-bar entry, current preview URL, switch/publish interlocks, cleanup, apply, undo, and change refresh.
- Modify `apps/publisher/src/renderer/src/app.css`: responsive two-pane designer styles.

### Publication and documentation

- Modify `apps/publisher/src/main/services/changes.ts`: classify the exact managed appearance paths as one optional `appearance` group.
- Modify `apps/publisher/src/shared/contracts.ts` and `apps/publisher/src/shared/ipcSchemas.ts`: add the `appearance` change kind.
- Modify `apps/publisher/src/renderer/src/components/PublishReview.tsx`: appearance label and explanation.
- Modify `apps/publisher/README.md` and root `README.md`: user workflow, supported framework statement, backup/undo, and publication behavior.

---

### Task 1: Define the normalized appearance model and strict bridge contracts

**Files:**
- Create: `apps/publisher/src/shared/appearance.ts`
- Modify: `apps/publisher/src/shared/contracts.ts`
- Modify: `apps/publisher/src/shared/ipcSchemas.ts`
- Test: `apps/publisher/tests/unit/appearance-contracts.test.ts`
- Test: `apps/publisher/tests/unit/ipc-schemas.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that accept a bounded Quartz snapshot and reject unknown keys, invalid colors, unsafe font tokens, custom CSS over 64 KiB, an image token that is not a UUID, a preview URL outside `http://127.0.0.1`, and an apply request without a 64-character baseline hash.

```ts
it("rejects an appearance preview outside the exact loopback boundary", () => {
  expect(
    appearancePreviewRequestSchema.safeParse({
      url: "https://example.com/",
      settings: DEFAULT_APPEARANCE,
    }).success,
  ).toBe(false)
})

it("bounds custom CSS", () => {
  const settings = { ...DEFAULT_APPEARANCE, customCss: "x".repeat(64 * 1024 + 1) }
  expect(appearanceSettingsSchema.safeParse(settings).success).toBe(false)
})
```

- [ ] **Step 2: Run the focused tests and confirm the missing exports fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-contracts.test.ts tests/unit/ipc-schemas.test.ts`

Expected: FAIL because appearance contracts and schemas do not exist.

- [ ] **Step 3: Add the model and DTOs**

Define immutable, JSON-safe values with no filesystem paths supplied by the renderer:

```ts
export type BlogFramework = "quartz" | "hugo" | "hexo" | "unknown"

export type AppearanceBackground =
  | { readonly kind: "solid"; readonly color: string }
  | {
      readonly kind: "gradient"
      readonly start: string
      readonly end: string
      readonly angle: number
    }
  | {
      readonly kind: "image"
      readonly asset: { readonly source: "managed"; readonly name: string } |
        { readonly source: "staged"; readonly token: string; readonly name: string }
      readonly overlay: string
      readonly opacity: number
      readonly position: "center" | "top" | "bottom"
      readonly fixed: boolean
    }

export interface AppearanceSettings {
  readonly schemaVersion: 1
  readonly preset: "knowledge-garden" | "paper" | "minimal" | "custom"
  readonly background: AppearanceBackground
  readonly colors: {
    readonly page: string
    readonly surface: string
    readonly text: string
    readonly heading: string
    readonly accent: string
    readonly secondary: string
    readonly border: string
    readonly code: string
  }
  readonly typography: {
    readonly header: string
    readonly body: string
    readonly code: string
    readonly baseSizePx: number
    readonly lineHeight: number
  }
  readonly layout: {
    readonly articleWidthCh: number
    readonly pageWidthPx: number
    readonly sidebarWidthPx: number
    readonly sidebars: "both" | "left" | "none"
    readonly gapPx: number
  }
  readonly customCss: string
}

export interface AppearanceSnapshot {
  readonly framework: BlogFramework
  readonly supported: boolean
  readonly settings: AppearanceSettings
  readonly baselineHash: string
  readonly canUndo: boolean
  readonly message?: string
}
```

Add `APPEARANCE_UNSUPPORTED`, `APPEARANCE_INVALID`, `APPEARANCE_CHANGED`, `APPEARANCE_CONFLICT`, `APPEARANCE_PREVIEW_UNAVAILABLE`, `APPEARANCE_TRANSACTION_FAILED`, and `APPEARANCE_TRANSACTION_UNCERTAIN` to `APP_ERROR_CODES`. Add request channels `appearanceRead`, `appearanceChooseBackground`, `appearancePreview`, `appearanceClearPreview`, `appearanceApply`, and `appearanceUndo`.

- [ ] **Step 4: Add strict Zod schemas and success schemas**

Export request schemas needed by `ipc.ts`, cap fonts at 128 characters, custom CSS at 64 KiB, image names at 255 characters, and every returned object with `.strip()`. Extend `IPC_SUCCESS_SCHEMAS` for all six channels.

```ts
export const appearancePreviewRequestSchema = z.object({
  url: loopbackUrlSchema,
  sessionId: z.string().uuid(),
  settings: appearanceSettingsSchema,
}).strict()

export const appearanceApplyRequestSchema = z.object({
  settings: appearanceSettingsSchema,
  baselineHash: hashSchema,
}).strict()
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-contracts.test.ts tests/unit/ipc-schemas.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit only the shared contract work**

```powershell
git add -- apps/publisher/src/shared/appearance.ts apps/publisher/src/shared/contracts.ts apps/publisher/src/shared/ipcSchemas.ts apps/publisher/tests/unit/appearance-contracts.test.ts apps/publisher/tests/unit/ipc-schemas.test.ts
git commit -m "feat(publisher): define appearance contracts"
```

### Task 2: Implement presets and deterministic CSS compilation

**Files:**
- Modify: `apps/publisher/src/shared/appearance.ts`
- Test: `apps/publisher/tests/unit/appearance-model.test.ts`

- [ ] **Step 1: Write failing pure-model tests**

Cover preset cloning, range normalization, CSS escaping, custom CSS placement, solid/gradient/image backgrounds, sidebar modes, and byte-for-byte deterministic output. Assert that generated image CSS uses the adapter-provided public URL rather than a renderer path.

```ts
expect(
  compileAppearanceCss(imageSettings, { imageUrl: "./publisher/background.webp" }),
).toContain('url("./publisher/background.webp")')
expect(compileAppearanceCss(imageSettings, { imageUrl: undefined })).not.toContain("url(")
expect(compileAppearanceCss(DEFAULT_APPEARANCE)).toBe(compileAppearanceCss(DEFAULT_APPEARANCE))
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-model.test.ts`

Expected: FAIL because presets and compiler are absent.

- [ ] **Step 3: Implement presets and compiler**

Export `APPEARANCE_PRESETS`, `cloneAppearancePreset`, `normalizeAppearanceSettings`, and `compileAppearanceCss`. Emit only a marked root block and scoped selectors:

```ts
export function compileAppearanceCss(
  settings: AppearanceSettings,
  resources: { readonly imageUrl?: string } = {},
): string {
  const background = backgroundCss(settings.background, resources.imageUrl)
  return [
    "/* Knowledge Garden Publisher managed appearance. */",
    ":root {",
    `  --publisher-page: ${settings.colors.page};`,
    `  --publisher-surface: ${settings.colors.surface};`,
    `  --publisher-accent: ${settings.colors.accent};`,
    `  --publisher-article-width: ${settings.layout.articleWidthCh}ch;`,
    `  --publisher-sidebar-width: ${settings.layout.sidebarWidthPx}px;`,
    "}",
    `body { ${background} font-size: ${settings.typography.baseSizePx}px; }`,
    ".center article { max-width: var(--publisher-article-width); }",
    sidebarCss(settings.layout.sidebars),
    settings.customCss.trim(),
    "",
  ].filter(Boolean).join("\n")
}
```

Do not attempt a full CSS parser. Reject NUL characters and `</style` in the contract validator; store the remaining CSS exactly inside the managed file because it executes only in the blog page, never in Publisher chrome.

- [ ] **Step 4: Run the pure-model tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-model.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/publisher/src/shared/appearance.ts apps/publisher/tests/unit/appearance-model.test.ts
git commit -m "feat(publisher): compile managed appearance styles"
```

### Task 3: Build the Quartz adapter and framework detection boundary

**Files:**
- Create: `apps/publisher/src/main/services/appearance/appearanceAdapter.ts`
- Create: `apps/publisher/src/main/services/appearance/quartzAppearanceAdapter.ts`
- Test: `apps/publisher/tests/unit/quartz-appearance-adapter.test.ts`

- [ ] **Step 1: Write adapter tests against temporary workspaces**

Test detection of Quartz, Hugo, Hexo, and unknown roots. For Quartz, cover reading theme colors/fonts from `quartz.config.yaml`, a missing manifest falling back to defaults, a valid manifest round trip, a single import inserted after leading `@use` statements, duplicate application remaining byte-identical, malformed markers failing closed, and no write paths outside the allowlist.

Use these exact managed locations:

```ts
export const QUARTZ_APPEARANCE_PATHS = Object.freeze({
  manifest: "quartz/styles/publisher-appearance.json",
  stylesheet: "quartz/styles/publisher-appearance.scss",
  backgroundDirectory: "quartz/static/publisher",
  customStylesheet: "quartz/styles/custom.scss",
  config: "quartz.config.yaml",
})
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/quartz-appearance-adapter.test.ts`

Expected: FAIL because adapter modules are missing.

- [ ] **Step 3: Define the adapter contract**

```ts
export interface AppearanceWrite {
  readonly path: string
  readonly expectedHash: string | null
  readonly bytes: Uint8Array
}

export interface AppearanceDelete {
  readonly path: string
  readonly expectedHash: string
}

export interface AppearancePlan {
  readonly baselineHash: string
  readonly settings: AppearanceSettings
  readonly writes: readonly AppearanceWrite[]
  readonly deletes: readonly AppearanceDelete[]
}

export interface AppearanceAdapter {
  readonly framework: BlogFramework
  read(): Promise<AppearanceSnapshot>
  plan(settings: AppearanceSettings, baselineHash: string, staged?: StagedAppearanceAsset): Promise<AppearancePlan>
}
```

- [ ] **Step 4: Implement Quartz read and plan generation**

Use the existing `yaml` dependency to parse and stringify only the managed theme fields. Preserve non-managed YAML values. Insert exactly this block after the final leading Sass `@use` statement:

```scss
/* publisher-appearance:start */
@use "./publisher-appearance.scss";
/* publisher-appearance:end */
```

Calculate `baselineHash` from sorted tuples of relative path, existence, and SHA-256 content. Treat symlinks, duplicate markers, a marker after ordinary CSS rules, invalid JSON, or manifest paths outside the fixed allowlist as `APPEARANCE_CONFLICT`.

```ts
const nextConfiguration = {
  ...parsed.configuration,
  theme: {
    ...parsed.configuration.theme,
    typography: { ...parsed.configuration.theme.typography, ...settings.typography },
    colors: managedQuartzColors(parsed.configuration.theme.colors, settings.colors),
  },
}
const writes = [
  textWrite(QUARTZ_APPEARANCE_PATHS.manifest, baseline.manifest, manifestJson(settings)),
  textWrite(QUARTZ_APPEARANCE_PATHS.stylesheet, baseline.stylesheet, css),
  textWrite(QUARTZ_APPEARANCE_PATHS.customStylesheet, baseline.custom, withManagedUse(custom)),
  textWrite(QUARTZ_APPEARANCE_PATHS.config, baseline.config, stringifyYaml(nextConfiguration)),
]
```

- [ ] **Step 5: Run adapter tests and typecheck**

Run: `cd apps/publisher && npm run test:run -- tests/unit/quartz-appearance-adapter.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/publisher/src/main/services/appearance/appearanceAdapter.ts apps/publisher/src/main/services/appearance/quartzAppearanceAdapter.ts apps/publisher/tests/unit/quartz-appearance-adapter.test.ts
git commit -m "feat(publisher): add Quartz appearance adapter"
```

### Task 4: Stage and validate background images without touching the blog

**Files:**
- Create: `apps/publisher/src/main/services/appearance/appearanceAssets.ts`
- Modify: `apps/publisher/src/main/services/imageFormats.ts`
- Modify: `apps/publisher/src/main/index.ts`
- Test: `apps/publisher/tests/unit/appearance-assets.test.ts`

- [ ] **Step 1: Write failing staging tests**

Cover cancel, one selected file, multiple selected files rejected, 25 MiB bound, extension/signature mismatch, excessive dimensions, symlink source, changed source identity, expiry after five minutes, eight-session cap, token isolation, and cleanup on dispose. Assert no file is created under `quartz/static` during selection.

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-assets.test.ts`

Expected: FAIL because the staging service does not exist.

- [ ] **Step 3: Reuse bounded image validation and add a one-file Electron adapter**

Export the existing safe image metadata reader and format detector rather than duplicating signatures. Define a port that can be faked in tests:

```ts
export interface AppearanceAssetPicker {
  chooseImage(): Promise<string | undefined>
  decodePreview(bytes: Uint8Array): Promise<{ readonly width: number; readonly height: number }>
}

export interface StagedAppearanceAsset {
  readonly token: string
  readonly name: string
  readonly extension: ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" | ".avif"
  readonly hash: string
  readonly bytes: Uint8Array
}
```

The production picker uses `dialog.showOpenDialog` with `properties: ["openFile"]` and the same extension filter as the image library. Keep staged bytes in a bounded in-memory service; do not expose absolute paths or full bytes over IPC.

- [ ] **Step 4: Run tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-assets.test.ts tests/unit/image-formats.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/publisher/src/main/services/appearance/appearanceAssets.ts apps/publisher/src/main/services/imageFormats.ts apps/publisher/src/main/index.ts apps/publisher/tests/unit/appearance-assets.test.ts
git commit -m "feat(publisher): stage appearance backgrounds safely"
```

### Task 5: Implement durable appearance transactions, rollback, recovery, and undo

**Files:**
- Create: `apps/publisher/src/main/services/appearance/appearanceTransaction.ts`
- Test: `apps/publisher/tests/unit/appearance-transaction.test.ts`

- [ ] **Step 1: Write failure-injection tests**

Cover successful multi-file commit, optimistic hash conflict, new-file collision, symlink parent, temporary write failure, backup failure, replacement failure at every file index, delete failure, directory sync failure, build verification failure, rollback failure producing uncertain state, restart recovery from `prepared` and `published` journals, and one-step undo. Verify unrelated Markdown bytes remain unchanged.

Use ignored state roots:

```ts
const TRANSACTION_ROOT = ".garden-publisher/appearance-transactions"
const HISTORY_ROOT = ".garden-publisher/appearance-history"
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-transaction.test.ts`

Expected: FAIL because the executor does not exist.

- [ ] **Step 3: Implement an authenticated, monotonic journal**

Use a versioned journal with phases `prepared`, `published`, and `verified`; record path, prior existence, prior hash, new hash, backup location, and staged location. Write journal revisions through exclusive temporary files, fsync the file, atomically rename, and fsync the parent directory. Reject any journal path not under the fixed transaction root.

```ts
type AppearanceJournal = {
  readonly version: 1
  readonly id: string
  readonly phase: "prepared" | "published" | "verified"
  readonly entries: readonly {
    readonly path: string
    readonly beforeHash: string | null
    readonly afterHash: string | null
    readonly backup: string | null
    readonly staged: string | null
  }[]
}
```

Reuse the HMAC key pattern already used by editor recovery or extract a focused internal helper if required; do not weaken existing transaction code. Keep exactly one verified history snapshot after a successful apply or undo.

- [ ] **Step 4: Implement execution and recovery**

Before any mutation, revalidate every expected hash and file identity. Publish replacements one at a time only after every backup exists. On build verification failure, restore all prior files. On startup, roll back `prepared`, finish or roll back `published` based on exact evidence, and retain evidence whenever certainty cannot be established.

```ts
export async function executeAppearancePlan(
  workspace: string,
  plan: AppearancePlan,
  verifyBuild: () => Promise<void>,
): Promise<AppearanceTransactionReceipt> {
  const prepared = await prepareJournal(workspace, plan)
  try {
    await publishPreparedEntries(prepared)
    await advanceJournal(prepared, "published")
    await verifyBuild()
    await advanceJournal(prepared, "verified")
    return await retainUndoSnapshot(prepared)
  } catch (error) {
    await rollbackJournal(prepared, error)
    throw error
  }
}
```

- [ ] **Step 5: Run transaction tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-transaction.test.ts`

Expected: PASS with all failure injection cases.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/publisher/src/main/services/appearance/appearanceTransaction.ts apps/publisher/tests/unit/appearance-transaction.test.ts
git commit -m "feat(publisher): apply appearance changes atomically"
```

### Task 6: Add exact-frame live appearance preview

**Files:**
- Create: `apps/publisher/src/main/previewAppearance.ts`
- Modify: `apps/publisher/src/main/index.ts`
- Test: `apps/publisher/tests/unit/preview-appearance.test.ts`

- [ ] **Step 1: Write failing frame-boundary tests**

Test exact normalized URL match, `127.0.0.1` only, no `localhost`, no HTTPS, no online frame, malformed result, navigated frame, replacement of the prior style, and removal by session ID. Assert unrelated frames never execute code.

```ts
expect(unrelated.executeJavaScript).not.toHaveBeenCalled()
expect(preview.executeJavaScript).toHaveBeenCalledWith(
  expect.stringContaining("data-publisher-appearance-preview"),
  true,
)
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/preview-appearance.test.ts`

Expected: FAIL because preview appearance injection is missing.

- [ ] **Step 3: Implement replacement and clearing**

Serialize CSS only with `JSON.stringify`; never interpolate it into executable source manually. The injected function creates one `<style data-publisher-appearance-preview="SESSION">`, replaces its text, and removes older Publisher appearance preview styles. Clearing only removes the matching session's element.

```ts
function installPreviewStyle(payload: { sessionId: string; css: string }): true {
  document.querySelectorAll("style[data-publisher-appearance-preview]").forEach((node) => node.remove())
  const style = document.createElement("style")
  style.dataset.publisherAppearancePreview = payload.sessionId
  style.textContent = payload.css
  document.head.append(style)
  return true
}
```

- [ ] **Step 4: Wire access to current preview frames without broadening trust**

In `index.ts`, reuse the same `webContents.mainFrame.framesInSubtree` enumeration and trusted window checks used by preview selection navigation. Expose only `previewAppearance` and `clearAppearancePreview` service functions; do not give the renderer frame IDs or arbitrary script execution.

```ts
const appearanceFrames = (): readonly PreviewFramePort[] => {
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return []
  return [...window.webContents.mainFrame.framesInSubtree].map((frame) => ({
    url: frame.url,
    executeJavaScript: (source, userGesture) => frame.executeJavaScript(source, userGesture),
  }))
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/preview-appearance.test.ts tests/unit/preview-frame-navigation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/publisher/src/main/previewAppearance.ts apps/publisher/src/main/index.ts apps/publisher/tests/unit/preview-appearance.test.ts
git commit -m "feat(publisher): preview appearance in exact local frame"
```

### Task 7: Orchestrate appearance service, IPC, preload, and preview rebuild

**Files:**
- Create: `apps/publisher/src/main/services/appearance/appearanceService.ts`
- Modify: `apps/publisher/src/main/publisherServices.ts`
- Modify: `apps/publisher/src/main/ipc.ts`
- Modify: `apps/publisher/src/main/index.ts`
- Modify: `apps/publisher/src/preload/gardenApi.ts`
- Test: `apps/publisher/tests/unit/appearance-service.test.ts`
- Test: `apps/publisher/tests/unit/ipc.test.ts`
- Test: `apps/publisher/tests/unit/publisher-services.test.ts`

- [ ] **Step 1: Write failing service and IPC tests**

Test read, unsupported framework, background selection, preview supersession, clear, apply, apply-build-failure rollback, undo, busy-state rejection, disposal cleanup, untrusted sender rejection, malformed request rejection, and frozen preload API methods.

- [ ] **Step 2: Verify the tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-service.test.ts tests/unit/ipc.test.ts tests/unit/publisher-services.test.ts`

Expected: FAIL because appearance services are not wired.

- [ ] **Step 3: Implement the service state machine**

```ts
export interface AppearanceService {
  read(): Promise<AppearanceSnapshot>
  chooseBackground(): Promise<AppearanceBackgroundSelection | undefined>
  preview(request: AppearancePreviewRequest): Promise<AppearancePreviewReceipt>
  clearPreview(request: AppearanceClearPreviewRequest): Promise<void>
  apply(request: AppearanceApplyRequest): Promise<AppearanceApplyReceipt>
  undo(request: AppearanceUndoRequest): Promise<AppearanceApplyReceipt>
  dispose(): Promise<void>
}
```

Serialize `apply` and `undo`; allow only the newest preview request to win; clear preview when applying, switching blogs, or disposing. To verify a committed appearance, restart or invalidate the current Quartz preview using the existing preview manager and wait for its next `ready` state. A build error must be returned to the transaction executor so it rolls back before the IPC call resolves.

- [ ] **Step 4: Register six secure handlers and preload methods**

Use `secureHandler`, strict request schemas, `isTrustedSender`, and `IPC_SUCCESS_SCHEMAS`. Add an optional `appearance` service to construction rollback and disposal ordering, then require it in the active runtime after successful creation.

```ts
[
  IPC_CHANNELS.requests.appearanceRead,
  secureHandler(IPC_CHANNELS.requests.appearanceRead, noRequestSchema, isTrustedSender, () =>
    services.appearance.read(),
  ),
]

const appearance = Object.freeze({
  read: () => invoke<AppearanceSnapshot>(ipc, IPC_CHANNELS.requests.appearanceRead),
  preview: (request: AppearancePreviewRequest) =>
    invoke<AppearancePreviewReceipt>(ipc, IPC_CHANNELS.requests.appearancePreview, request),
  apply: (request: AppearanceApplyRequest) =>
    invoke<AppearanceApplyReceipt>(ipc, IPC_CHANNELS.requests.appearanceApply, request),
})
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-service.test.ts tests/unit/ipc.test.ts tests/unit/publisher-services.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/publisher/src/main/services/appearance/appearanceService.ts apps/publisher/src/main/publisherServices.ts apps/publisher/src/main/ipc.ts apps/publisher/src/main/index.ts apps/publisher/src/preload/gardenApi.ts apps/publisher/tests/unit/appearance-service.test.ts apps/publisher/tests/unit/ipc.test.ts apps/publisher/tests/unit/publisher-services.test.ts
git commit -m "feat(publisher): expose appearance service"
```

### Task 8: Build the appearance designer UI

**Files:**
- Create: `apps/publisher/src/renderer/src/components/AppearanceDesigner.tsx`
- Create: `apps/publisher/src/renderer/src/components/AppearanceControls.tsx`
- Create: `apps/publisher/src/renderer/src/components/AppearancePreview.tsx`
- Modify: `apps/publisher/src/renderer/src/app.css`
- Test: `apps/publisher/tests/unit/appearance-designer.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover loading, unsupported framework, presets, all background modes, image selection, color inputs, font fields, layout sliders, sidebar select, custom CSS, dirty state, cancel cleanup, apply disabled while invalid or busy, apply success, conflict error, build rollback error, reset default as draft-only, undo, focus trap, Escape, and narrow layout.

```tsx
await user.click(screen.getByRole("button", { name: "知识花园" }))
expect(onPreview).toHaveBeenLastCalledWith(
  expect.objectContaining({ settings: APPEARANCE_PRESETS["knowledge-garden"] }),
)
expect(onApply).not.toHaveBeenCalled()
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-designer.test.tsx`

Expected: FAIL because UI components are missing.

- [ ] **Step 3: Implement modal orchestration**

Use `ModalShell`. Keep `snapshot` and `draft` separate, debounce preview by 100 ms, assign a monotonically increasing request ID, and ignore stale completions. Cancel calls `clearPreview` before close. Apply updates the baseline from the receipt and leaves the modal open long enough to show success; undo reloads the returned snapshot.

```tsx
useEffect(() => {
  if (!snapshot?.supported || !previewUrl) return
  const request = ++previewGeneration.current
  const timer = window.setTimeout(() => {
    void api.preview({ url: previewUrl, sessionId, settings: draft }).then((result) => {
      if (request !== previewGeneration.current || !result.ok) return
      setPreviewState("ready")
    })
  }, 100)
  return () => window.clearTimeout(timer)
}, [api, draft, previewUrl, sessionId, snapshot?.supported])
```

- [ ] **Step 4: Implement accessible controls and responsive preview**

Every field receives a visible label and bounded numeric value. Use native `<input type="color">`, `<input type="range">`, and the existing button styles; do not add a color-picker dependency. The preview pane uses the active loopback URL in a sandboxed iframe and never embeds the public site.

```tsx
<label>
  <span>强调色</span>
  <input type="color" value={settings.colors.accent} onChange={setAccent} />
</label>
<label>
  <span>正文宽度</span>
  <input type="range" min={48} max={100} value={settings.layout.articleWidthCh} onChange={setArticleWidth} />
</label>
<iframe title="博客外观实时预览" sandbox="allow-same-origin allow-scripts" src={previewUrl} />
```

- [ ] **Step 5: Add CSS matching the approved mockup**

Use a two-column grid above 1,000 px and one column below it. Keep the actions sticky inside the modal, make the controls independently scrollable, and preserve the existing modal focus/inert behavior.

```css
.appearance-dialog { width: min(96vw, 1500px); height: min(92vh, 980px); }
.appearance-body { display: grid; grid-template-columns: minmax(300px, 34%) 1fr; min-height: 0; }
.appearance-controls, .appearance-preview { min-height: 0; overflow: auto; }
@media (max-width: 1000px) {
  .appearance-body { grid-template-columns: 1fr; }
  .appearance-preview { min-height: 420px; }
}
```

- [ ] **Step 6: Run UI tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/appearance-designer.test.tsx tests/unit/modal-shell.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- apps/publisher/src/renderer/src/components/AppearanceDesigner.tsx apps/publisher/src/renderer/src/components/AppearanceControls.tsx apps/publisher/src/renderer/src/components/AppearancePreview.tsx apps/publisher/src/renderer/src/app.css apps/publisher/tests/unit/appearance-designer.test.tsx
git commit -m "feat(publisher): add appearance designer UI"
```

### Task 9: Integrate the designer with the current blog lifecycle

**Files:**
- Modify: `apps/publisher/src/renderer/src/App.tsx`
- Test: `apps/publisher/tests/unit/main-layout.test.tsx`
- Test: `apps/publisher/tests/unit/blog-manager.test.tsx`

- [ ] **Step 1: Write failing application integration tests**

Assert the “外观” button appears beside “管理领域”, is disabled during blog switching and publishing preparation, opens against the active blog, receives only `preview.lastSuccessfulUrl ?? preview.url`, clears preview on close and switch, refreshes the change count after apply/undo, and never calls publish automatically.

- [ ] **Step 2: Verify the tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/main-layout.test.tsx tests/unit/blog-manager.test.tsx`

Expected: FAIL because `App` has no appearance entry.

- [ ] **Step 3: Add top-bar entry and lifecycle interlocks**

Add `Palette` from `lucide-react`, `appearanceOpen` state, and a generation counter. Flush the Markdown editor before apply only to preserve the existing publication/switch invariant; appearance itself must not read or write note files. On blog switch, close the modal and clear the old preview before calling `api.blogs.switch`.

```tsx
<button
  type="button"
  className="secondary-button appearance-trigger"
  disabled={blogBusy || switchPreparing}
  onClick={() => setAppearanceOpen(true)}
>
  <Palette size={16} aria-hidden="true" />
  外观
</button>
```

- [ ] **Step 4: Refresh publication review without publishing**

After apply or undo, call `loadChanges()` only when the publication review is already open; otherwise invalidate `changeCount` and let the existing background refresh update it. Do not invoke `api.publish.start` from appearance code.

```ts
const appearanceChanged = (): void => {
  setChangeCount(undefined)
  if (changeReviewOpen) void loadChanges()
}
```

- [ ] **Step 5: Run integration tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/main-layout.test.tsx tests/unit/blog-manager.test.tsx tests/unit/app-smoke.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/publisher/src/renderer/src/App.tsx apps/publisher/tests/unit/main-layout.test.tsx apps/publisher/tests/unit/blog-manager.test.tsx
git commit -m "feat(publisher): integrate blog appearance workflow"
```

### Task 10: Classify appearance changes separately in publish review

**Files:**
- Modify: `apps/publisher/src/shared/contracts.ts`
- Modify: `apps/publisher/src/shared/ipcSchemas.ts`
- Modify: `apps/publisher/src/main/services/changes.ts`
- Modify: `apps/publisher/src/renderer/src/components/PublishReview.tsx`
- Test: `apps/publisher/tests/unit/changes.test.ts`
- Test: `apps/publisher/tests/unit/publish-review.test.tsx`

- [ ] **Step 1: Write failing classification tests**

Feed Git status entries for the exact Quartz managed manifest, stylesheet, custom marker host, config, and background directory. Expect one optional group labelled “外观修改”; unrelated repository files remain under “配置修改”. Assert no path belongs to both groups.

```ts
expect(review.groups).toContainEqual(
  expect.objectContaining({
    kind: "appearance",
    label: "外观修改",
    selection: "optional",
  }),
)
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd apps/publisher && npm run test:run -- tests/unit/changes.test.ts tests/unit/publish-review.test.tsx`

Expected: FAIL because appearance paths are classified as config.

- [ ] **Step 3: Add exact managed-path classification**

Extend `ChangeKind` and its schema with `appearance`. Recognize only fixed paths and `quartz/static/publisher/<safe-image-name>`. If `custom.scss` changes without the other managed files, keep it under config because Publisher cannot prove ownership from Git status alone; when both the manifest and generated stylesheet are present, group the marked host file with appearance.

```ts
const managedAppearancePath = (path: string): boolean =>
  path === "quartz/styles/publisher-appearance.json" ||
  path === "quartz/styles/publisher-appearance.scss" ||
  /^quartz\/static\/publisher\/[a-z0-9][a-z0-9._-]*$/i.test(path)

const appearance = makeGroup(
  "appearance",
  "publisher-appearance",
  "外观修改",
  "optional",
  "博客背景、主题配色与排版；选择后发布到线上站点。",
)
```

- [ ] **Step 4: Render the review group**

Show “外观修改” with description “博客背景、主题配色与排版；选择后发布到线上站点。” Keep it optional and unchecked initially, matching the confirmed requirement that applying locally does not publish.

```tsx
const kindLabel: Record<ChangeKind, string> = {
  added: "新增",
  modified: "修改",
  unpublish: "下线",
  attachment: "附件",
  private: "私密",
  appearance: "外观",
  config: "配置",
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/publisher && npm run test:run -- tests/unit/changes.test.ts tests/unit/publish-review.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- apps/publisher/src/shared/contracts.ts apps/publisher/src/shared/ipcSchemas.ts apps/publisher/src/main/services/changes.ts apps/publisher/src/renderer/src/components/PublishReview.tsx apps/publisher/tests/unit/changes.test.ts apps/publisher/tests/unit/publish-review.test.tsx
git commit -m "feat(publisher): review appearance changes separately"
```

### Task 11: Prove the real Electron workflow and document it

**Files:**
- Modify: `apps/publisher/tests/e2e/app.spec.ts`
- Modify: `apps/publisher/tests/e2e/globalSetup.ts`
- Modify: `apps/publisher/README.md`
- Modify: `README.md`

- [ ] **Step 1: Extend the E2E fixture with minimal Quartz appearance files**

Copy a deterministic `quartz.config.yaml`, `quartz/styles/custom.scss`, and `quartz/static` into the isolated E2E workspace. Keep the fixture independent of the user's real blog and add no generated files to the source checkout.

- [ ] **Step 2: Write the end-to-end test**

The test must open “外观”, switch to a gradient, change the accent and article width, verify the local iframe receives the preview style, cancel and assert no disk changes, reopen and apply, verify managed files and successful preview rebuild, restart Publisher and verify settings persist, undo, and confirm the original bytes return. Then open publication review and assert “外观修改” is optional and no automatic publish occurred.

```ts
test("appearance designer previews, applies, persists, and undoes without publishing", async ({ page }) => {
  await page.getByRole("button", { name: "外观" }).click()
  await page.getByLabel("背景类型").selectOption("gradient")
  await page.getByLabel("正文宽度").fill("76")
  await expect(page.getByTitle("博客外观实时预览")).toBeVisible()
  await page.getByRole("button", { name: "一键应用" }).click()
  await expect(page.getByRole("status")).toContainText("外观已应用")
  await expect(page.getByText("正在验证所选公开变化…")).toHaveCount(0)
})
```

- [ ] **Step 3: Run the single E2E test**

Run: `cd apps/publisher && npm run test:e2e -- --grep "appearance designer"`

Expected: PASS in real Electron.

- [ ] **Step 4: Document the user workflow and limits**

Document: Quartz-only first release; presets, controls, custom CSS, background import, live preview, local apply, undo, and the separate “检查并发布” step. State that Hugo and Hexo are not yet renderable and will remain read-only until their adapters exist.

```markdown
### 外观设置

“外观”支持 Quartz 博客的背景、配色、字体、正文宽度、侧栏和自定义 CSS。
调整会先显示在本地实时预览中；“一键应用”只更新本地博客。需要上线时，请继续使用“检查并发布”并选择“外观修改”。

当前版本尚不能渲染或修改 Hugo、Hexo 博客。
```

- [ ] **Step 5: Run the complete Publisher verification**

Run:

```powershell
cd apps/publisher
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
```

Expected: all commands exit 0; Vitest and Playwright report no failures.

- [ ] **Step 6: Run repository-level checks**

Run from repository root:

```powershell
npm run check
npm run test:site
git diff --check
```

Expected: all commands exit 0 and `git diff --check` prints nothing.

- [ ] **Step 7: Commit documentation and E2E proof**

```powershell
git add -- apps/publisher/tests/e2e/app.spec.ts apps/publisher/tests/e2e/globalSetup.ts apps/publisher/README.md README.md
git commit -m "test(publisher): verify appearance designer workflow"
```

### Task 12: Final regression, package, and installation handoff

**Files:**
- Verify only; update package metadata only if the implementation requires a version bump requested at release time.

- [ ] **Step 1: Inspect the final branch and preserve unrelated user work**

Run: `git status --short && git log --oneline --decorate -15`

Expected: only known pre-existing user changes remain outside the feature commits; no appearance implementation file is uncommitted.

- [ ] **Step 2: Build the Windows installer**

Run: `cd apps/publisher && npm run package:win`

Expected: the NSIS installer and unpacked application are produced under `apps/publisher/release/` with exit code 0.

- [ ] **Step 3: Smoke-test the packaged application**

Launch the unpacked executable against an isolated Quartz fixture, open the designer, preview a preset, cancel, apply, restart, undo, and open publish review. Record the exact executable and fixture paths in the completion report.

- [ ] **Step 4: Review the final diff against the design**

Check every requirement in `docs/superpowers/specs/2026-10-30-blog-appearance-designer-design.md`: Quartz adapter only, no note mutation, no automatic publish, exact loopback preview, atomic apply, rollback, undo, and appearance publication group.

- [ ] **Step 5: Request code review before merging or pushing**

Invoke the `requesting-code-review` skill. Resolve any correctness or security finding, rerun the affected focused test, then rerun the complete verification from Task 11.

---

## Plan self-review record

- Spec coverage: UI, normalized model, Quartz managed files, preview boundary, background staging, transactions, undo, publication classification, unsupported frameworks, documentation, package proof, and real Electron E2E each map to an explicit task.
- Scope control: Hugo and Hexo are adapter-detection outcomes only; their real support requires later designs and plans.
- Type consistency: `AppearanceSettings`, `AppearanceSnapshot`, `AppearancePlan`, staged asset token, `baselineHash`, and service method names are introduced once and reused consistently.
- Safety: renderer paths are never trusted, existing custom styles remain outside the marked block, background selection does not touch the blog, and no step invokes publication automatically.
