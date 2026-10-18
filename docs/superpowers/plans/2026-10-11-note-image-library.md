# Note Image Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a note-scoped image library that creates its folder on first open, previews and imports multiple images, copies Markdown links without editing the note, and permanently deletes confirmed images.

**Architecture:** A new main-process `imageLibrary` service owns all filesystem access, opaque pending-selection sessions, thumbnails, transactional imports, and guarded deletion. Strict shared contracts expose only managed note paths, validated image names, hashes, and bounded data URLs through the existing trusted IPC/preload boundary; a focused React modal renders the gallery and confirmation flows.

**Tech Stack:** Electron 44 (`dialog`, `nativeImage`, `clipboard`), Node.js filesystem/crypto APIs, TypeScript 7, React 19, Zod 4, Vitest/Testing Library, Playwright Electron.

---

## File map

- Create `apps/publisher/src/main/services/imageFormats.ts`: allowed extensions, byte-signature detection, filename normalization, MIME lookup, and Markdown link formatting.
- Create `apps/publisher/src/main/services/imageLibrary.ts`: note-scoped path resolution, `.gitkeep`, image listing, pending selections, thumbnail/full preview, transactional import, guarded deletion, and disposal.
- Create `apps/publisher/src/renderer/src/components/ImageLibrary.tsx`: gallery, selection preview, collision confirmation, full preview, copy feedback, and permanent-delete confirmation.
- Create `apps/publisher/tests/unit/image-formats.test.ts`: pure format and link tests.
- Create `apps/publisher/tests/unit/image-library.test.ts`: filesystem, transaction, race, and session tests.
- Create `apps/publisher/tests/unit/image-library-ui.test.tsx`: renderer state-machine and accessibility tests.
- Modify `apps/publisher/src/shared/contracts.ts`: image-library types, error codes, IPC channels, and `GardenApi.images`.
- Modify `apps/publisher/src/shared/ipcSchemas.ts`: strict request/success schemas and public error serialization.
- Modify `apps/publisher/src/main/ipc.ts`: service port, request schemas, and secure handlers.
- Modify `apps/publisher/src/main/publisherServices.ts`: create, expose, and dispose the workspace-bound image service.
- Modify `apps/publisher/src/main/index.ts`: Electron file chooser, `nativeImage` renderer, and clipboard adapters.
- Modify `apps/publisher/src/preload/gardenApi.ts`: frozen image-library capability object.
- Modify `apps/publisher/src/renderer/src/components/MarkdownEditor.tsx`: toolbar button and modal host only; no editor transaction.
- Modify `apps/publisher/src/renderer/src/App.tsx`: pass `api.images` into the selected note editor.
- Modify `apps/publisher/src/renderer/src/app.css`: responsive gallery, selection, and preview styling.
- Modify `apps/publisher/tests/unit/ipc-schemas.test.ts`, `ipc.test.ts`, `publisher-services.test.ts`, `editor.test.tsx`, and `app-smoke.test.tsx`: contract, wiring, and non-mutation coverage.
- Modify `apps/publisher/tests/e2e/app.spec.ts`: real Electron main/renderer flow.
- Create `apps/publisher/README.md`: user-facing image-library instructions and limits.

### Task 1: Define strict shared image-library contracts

**Files:**
- Modify: `apps/publisher/src/shared/contracts.ts:1-75,421-470,599-680`
- Modify: `apps/publisher/src/shared/ipcSchemas.ts:1-160,400-475`
- Modify: `apps/publisher/src/preload/gardenApi.ts:1-260`
- Test: `apps/publisher/tests/unit/ipc-schemas.test.ts`
- Test: `apps/publisher/tests/unit/ipc.test.ts`
- Test: `apps/publisher/tests/unit/app-smoke.test.tsx`
- Test: `apps/publisher/tests/unit/first-run.test.tsx`
- Test: `apps/publisher/tests/unit/main-layout.test.tsx`

- [ ] **Step 1: Write failing schema and preload tests**

Add tests that require exact managed note paths, safe base filenames, UUID selection IDs, exact overwrite lists, 64-character hashes, bounded item arrays, and response stripping. Assert every new preload method invokes its exact channel.

```ts
expect(imageLibraryCommitRequestSchema.safeParse({
  path: "content/life/daily.md",
  selectionId: crypto.randomUUID(),
  overwrite: ["cover.png"],
}).success).toBe(true)
expect(imageLibraryItemRequestSchema.safeParse({
  path: "content/life/daily.md",
  name: "../secret.png",
}).success).toBe(false)
await api.images.open({ path: "content/life/daily.md" })
expect(ipc.invoke).toHaveBeenCalledWith(
  IPC_CHANNELS.requests.imagesOpen,
  { path: "content/life/daily.md" },
)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc-schemas.test.ts tests/unit/ipc.test.ts
```

Expected: TypeScript/Vitest fails because image contracts, channels, schemas, and API methods do not exist.

- [ ] **Step 3: Add the contracts and schemas**

Define these public shapes and keep full-size data out of the gallery item:

```ts
export interface ImageLibraryItem {
  readonly name: string
  readonly sizeBytes: number
  readonly width: number
  readonly height: number
  readonly contentHash: string
  readonly thumbnailDataUrl: string
  readonly markdown: string
}
export interface ImageLibraryView {
  readonly path: string
  readonly images: readonly ImageLibraryItem[]
}
export interface ImageLibrarySelection {
  readonly selectionId?: string
  readonly images: readonly (ImageLibraryItem & { readonly conflict: boolean })[]
  readonly conflicts: readonly string[]
  readonly cancelled: boolean
}
export interface ImageLibraryPreview extends Omit<ImageLibraryItem, "thumbnailDataUrl"> {
  readonly dataUrl: string
}
export interface ImageLibraryCommitRequest extends NotePathRequest {
  readonly selectionId: string
  readonly overwrite: readonly string[]
}
export interface ImageLibraryItemRequest extends NotePathRequest {
  readonly name: string
  readonly expectedContentHash?: string
}
```

Add `IMAGE_LIBRARY_INVALID`, `IMAGE_LIBRARY_UNSAFE`, `IMAGE_LIBRARY_TOO_LARGE`, `IMAGE_LIBRARY_CONFLICT`, `IMAGE_LIBRARY_CHANGED`, and `IMAGE_LIBRARY_FAILED` to `APP_ERROR_CODES`; add channels `imagesOpen`, `imagesSelect`, `imagesCommit`, `imagesPreview`, `imagesDelete`, and `imagesCopyMarkdown`; add the corresponding `GardenApi.images` methods and Zod schemas. `ImageLibrarySelection.selectionId` is omitted when `cancelled` is true.

- [ ] **Step 4: Implement the frozen preload surface**

```ts
const images = Object.freeze({
  open: (request: NotePathRequest) =>
    invoke<ImageLibraryView>(ipc, IPC_CHANNELS.requests.imagesOpen, request),
  select: (request: NotePathRequest) =>
    invoke<ImageLibrarySelection>(ipc, IPC_CHANNELS.requests.imagesSelect, request),
  commit: (request: ImageLibraryCommitRequest) =>
    invoke<ImageLibraryView>(ipc, IPC_CHANNELS.requests.imagesCommit, request),
  preview: (request: ImageLibraryItemRequest) =>
    invoke<ImageLibraryPreview>(ipc, IPC_CHANNELS.requests.imagesPreview, request),
  delete: (request: Required<ImageLibraryItemRequest>) =>
    invoke<ImageLibraryView>(ipc, IPC_CHANNELS.requests.imagesDelete, request),
  copyMarkdown: (request: ImageLibraryItemRequest) =>
    invoke<void>(ipc, IPC_CHANNELS.requests.imagesCopyMarkdown, request),
})
```

Return `images` from `createGardenApi`; do not expose Electron objects or source file paths.
Add a complete inert `images` stub to every typed `GardenApi` test fixture in `app-smoke.test.tsx`, `first-run.test.tsx`, and `main-layout.test.tsx` so the shared contract stays compile-clean before the UI starts using it.

- [ ] **Step 5: Run tests and typecheck**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc-schemas.test.ts tests/unit/ipc.test.ts
npm --prefix apps/publisher run typecheck
```

Expected: focused tests pass; typecheck only reports the not-yet-wired `PublisherIpcServices.images` implementation if the next task has not begun.

- [ ] **Step 6: Commit the contract slice**

```powershell
git add apps/publisher/src/shared apps/publisher/src/preload apps/publisher/tests/unit/ipc-schemas.test.ts apps/publisher/tests/unit/ipc.test.ts apps/publisher/tests/unit/app-smoke.test.tsx apps/publisher/tests/unit/first-run.test.tsx apps/publisher/tests/unit/main-layout.test.tsx
git commit -m "feat(publisher): define image library bridge"
```

### Task 2: Implement image-format validation and safe link generation

**Files:**
- Create: `apps/publisher/src/main/services/imageFormats.ts`
- Create: `apps/publisher/tests/unit/image-formats.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

Cover PNG, JPEG, GIF87a/GIF89a, WebP, AVIF; extension/signature mismatch; control characters; Windows reserved names; trailing dots/spaces; natural Unicode filenames; and Markdown escaping.

```ts
expect(detectImageFormat(Buffer.from("89504e470d0a1a0a", "hex"), "图 表.png")).toEqual({
  extension: ".png",
  mime: "image/png",
})
expect(() => normalizeImageName("CON.png")).toThrowError(
  expect.objectContaining({ code: "IMAGE_LIBRARY_INVALID" }),
)
expect(markdownForImage("daily", "图 表.png")).toBe(
  "![图 表](<../_assets/daily/图 表.png>)",
)
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-formats.test.ts
```

Expected: FAIL because `imageFormats.ts` is missing.

- [ ] **Step 3: Implement exact signatures and filename rules**

Export a single immutable format table plus focused helpers:

```ts
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024
export const IMAGE_MAX_SELECTION = 50
export function detectImageFormat(bytes: Uint8Array, name: string): ImageFormat
export function normalizeImageName(name: string): string
export function markdownForImage(slug: string, name: string): string
export function imageDataUrl(mime: string, bytes: Uint8Array): string
```

JPEG accepts `.jpg` and `.jpeg`; `ftypavif` or `ftypavis` within the ISO-BMFF header identifies AVIF. Reject double-extension disguises only when the final extension is unsupported; content must match the final supported extension. Escape `[` and `]` in alt text and reject `>`, CR, LF, NUL, separators, absolute paths, `.` and `..` in target names.

- [ ] **Step 4: Run tests and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-formats.test.ts
git add apps/publisher/src/main/services/imageFormats.ts apps/publisher/tests/unit/image-formats.test.ts
git commit -m "feat(publisher): validate image formats and links"
```

Expected: all format tests pass.

### Task 3: Create and list a note-scoped image library

**Files:**
- Create: `apps/publisher/src/main/services/imageLibrary.ts`
- Create: `apps/publisher/tests/unit/image-library.test.ts`

- [ ] **Step 1: Write failing creation and listing tests**

Use temporary workspaces with public, private, and custom-domain notes. Assert first open creates `_assets/<slug>/.gitkeep`, ignores the marker, natural-sorts images, rejects unsafe note paths and symlinked roots, and returns bounded thumbnails.

```ts
const library = createImageLibraryService({ workspace, adapter: fakeAdapter() })
await expect(library.open({ path: "content/life/daily.md" })).resolves.toEqual({
  path: "content/life/daily.md",
  images: [],
})
expect(await readFile(join(workspace, "content/_assets/daily/.gitkeep"), "utf8")).toBe("")
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library.test.ts -t "creates|lists|rejects"
```

Expected: FAIL because `createImageLibraryService` is missing.

- [ ] **Step 3: Implement the service boundary and safe path resolution**

```ts
export interface ImageLibraryAdapter {
  chooseImages(): Promise<readonly string[] | undefined>
  renderThumbnail(bytes: Uint8Array): Promise<RenderedImage>
  readDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }>
  writeClipboard(text: string): void
  now?(): number
  afterPhase?(phase: ImageLibraryPhase): Promise<void> | void
}
export interface ImageLibraryService {
  open(request: NotePathRequest): Promise<ImageLibraryView>
  select(request: NotePathRequest): Promise<ImageLibrarySelection>
  commit(request: ImageLibraryCommitRequest): Promise<ImageLibraryView>
  preview(request: ImageLibraryItemRequest): Promise<ImageLibraryPreview>
  delete(request: Required<ImageLibraryItemRequest>): Promise<ImageLibraryView>
  copyMarkdown(request: ImageLibraryItemRequest): Promise<void>
  dispose(): Promise<void>
}
```

Resolve `content|private/<domain>/<slug>.md` to `<root>/_assets/<slug>`, verify the note and every existing ancestor with `lstat`/`realpath`, acquire the shared note-path and attachment-root leases via `acquireInternalNotePathLease`, create the directory with mode `0o700`, sync it, and create `.gitkeep` exclusively when no images exist. Listing reads only direct child regular files, validates their contents, hashes them, and asks the adapter for thumbnails.

- [ ] **Step 4: Run focused tests and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library.test.ts -t "creates|lists|rejects"
git add apps/publisher/src/main/services/imageLibrary.ts apps/publisher/tests/unit/image-library.test.ts
git commit -m "feat(publisher): create note image libraries"
```

Expected: creation/list/path tests pass.

### Task 4: Add pending selection, conflict detection, and transactional import

**Files:**
- Modify: `apps/publisher/src/main/services/imageLibrary.ts`
- Modify: `apps/publisher/tests/unit/image-library.test.ts`

- [ ] **Step 1: Write failing selection and transaction tests**

Test cancellation, 50-file/25-MB boundaries, renamed or modified sources, opaque-token workspace/path binding, expiration, duplicate normalized names, existing-target conflicts, explicit overwrite lists, late collisions, complete success, rollback after each injected phase, and `.gitkeep` removal.

```ts
const selection = await library.select({ path: notePath })
expect(selection).toMatchObject({ cancelled: false, conflicts: ["cover.png"] })
await expect(library.commit({
  path: notePath,
  selectionId: selection.selectionId!,
  overwrite: [],
})).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CONFLICT" })
expect(await readFile(existingCover)).toEqual(originalBytes)
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library.test.ts -t "selection|conflict|rollback|commit"
```

Expected: FAIL because selection sessions and commit are not implemented.

- [ ] **Step 3: Implement bounded opaque selections**

Store only in main-process memory:

```ts
interface PendingSelection {
  readonly id: string
  readonly notePath: string
  readonly createdAt: number
  readonly sources: readonly {
    sourcePath: string
    name: string
    bytes: Buffer
    sourceIdentity: FileIdentity
    contentHash: string
  }[]
  readonly conflicts: readonly string[]
}
```

Use `randomUUID()`, a five-minute expiry, a maximum of eight live sessions, and one-use tokens. Read and validate selected files before returning previews, but re-open/re-stat/re-hash each source at commit. Never return `sourcePath`.

- [ ] **Step 4: Implement an all-or-nothing commit**

Acquire note and attachment leases in canonical sorted order. Stage new bytes and overwritten backups inside `workspace/.garden-publisher/image-import/<selection-id>/`; sync files/directories; verify that every overwrite name was in the preflight conflict set and that no unapproved late collision exists. Publish with exclusive rename/link semantics, verify hashes, remove `.gitkeep`, then remove staging. On any failure, quarantine newly published files, restore exact backups, recreate `.gitkeep` when empty, verify the final snapshot, and throw `IMAGE_LIBRARY_FAILED` or `IMAGE_LIBRARY_CHANGED` without reporting success.

- [ ] **Step 5: Run tests and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library.test.ts
git add apps/publisher/src/main/services/imageLibrary.ts apps/publisher/tests/unit/image-library.test.ts
git commit -m "feat(publisher): import image batches atomically"
```

Expected: all image-library service tests through commit pass.

### Task 5: Add preview, clipboard copy, guarded permanent deletion, and disposal

**Files:**
- Modify: `apps/publisher/src/main/services/imageLibrary.ts`
- Modify: `apps/publisher/tests/unit/image-library.test.ts`

- [ ] **Step 1: Write failing operation tests**

Assert full previews are loaded one at a time, data MIME matches verified bytes, copy writes the exact angle-bracket Markdown, delete requires the current hash, external replacement is preserved, deleting the last image restores `.gitkeep`, and disposal invalidates sessions and rejects new calls.

```ts
await library.copyMarkdown({ path: notePath, name: "图 表.png" })
expect(writeClipboard).toHaveBeenCalledWith("![图 表](<../_assets/daily/图 表.png>)")
await expect(library.delete({
  path: notePath,
  name: "图 表.png",
  expectedContentHash: "0".repeat(64),
})).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library.test.ts -t "preview|clipboard|delete|dispose"
```

Expected: FAIL because these operations are not implemented.

- [ ] **Step 3: Implement guarded operations**

Preview validates and hashes the named file before returning a `data:<verified-mime>;base64,...` URL. Copy recomputes the validated name/link and calls only the injected clipboard function. Delete acquires both leases, opens and verifies the exact expected hash, renames the file to an owned same-directory quarantine, syncs, removes the quarantine, and restores `.gitkeep` if the image count reaches zero; if the target identity changes, preserve it and return `IMAGE_LIBRARY_CHANGED`.

- [ ] **Step 4: Run tests and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library.test.ts
git add apps/publisher/src/main/services/imageLibrary.ts apps/publisher/tests/unit/image-library.test.ts
git commit -m "feat(publisher): preview copy and delete images"
```

Expected: the full service test file passes.

### Task 6: Wire Electron adapters, runtime services, and secure IPC

**Files:**
- Modify: `apps/publisher/src/main/index.ts:1-35,360-435`
- Modify: `apps/publisher/src/main/publisherServices.ts:1-110,215-330`
- Modify: `apps/publisher/src/main/ipc.ts:1-220,330-675`
- Modify: `apps/publisher/tests/unit/publisher-services.test.ts`
- Modify: `apps/publisher/tests/unit/ipc.test.ts`

- [ ] **Step 1: Write failing wiring and authorization tests**

Require exactly six secure handlers, strict rejection of malformed names/tokens/hashes, no operation for untrusted or destroyed senders, forwarding to the service once for trusted input, service disposal on blog switch, and sanitized errors without absolute paths.

```ts
await expect(ipc.invoke(IPC_CHANNELS.requests.imagesOpen, trustedEvent, {
  path: "content/life/daily.md",
})).resolves.toEqual({ ok: true, value: imageView })
expect(servicePorts.calls.imagesOpen).toHaveBeenCalledExactlyOnceWith({
  path: "content/life/daily.md",
})
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc.test.ts tests/unit/publisher-services.test.ts
```

Expected: FAIL because the main service/handlers are not wired.

- [ ] **Step 3: Add runtime and IPC wiring**

Add `images: ImageLibraryService` to `PublisherIpcServices`. In `createPublisherServices`, create exactly one service per workspace, expose it unchanged, invalidate it before workspace disposal, and include its cleanup in construction rollback. Register all six channels with `secureHandler` and the shared schemas.

- [ ] **Step 4: Add production Electron adapters**

```ts
imageLibraryAdapter: {
  chooseImages: async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
    })
    return result.canceled ? undefined : result.filePaths
  },
  renderThumbnail: async (bytes) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    const { width, height } = image.getSize()
    const thumbnail = image.resize({ width: 320, height: 240, quality: "good" })
    return { width, height, dataUrl: thumbnail.toDataURL() }
  },
  readDimensions: async (bytes) => nativeImage.createFromBuffer(Buffer.from(bytes)).getSize(),
  writeClipboard: (text) => clipboard.writeText(text),
}
```

Reject empty `nativeImage` results. Use the current live `mainWindow` only to parent the dialog; cancellation returns `undefined`.

- [ ] **Step 5: Run tests, typecheck, and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc.test.ts tests/unit/publisher-services.test.ts
npm --prefix apps/publisher run typecheck
git add apps/publisher/src/main apps/publisher/tests/unit/ipc.test.ts apps/publisher/tests/unit/publisher-services.test.ts
git commit -m "feat(publisher): wire image library services"
```

Expected: focused tests and typecheck pass.

### Task 7: Build the accessible image-library modal

**Files:**
- Create: `apps/publisher/src/renderer/src/components/ImageLibrary.tsx`
- Create: `apps/publisher/tests/unit/image-library-ui.test.tsx`
- Modify: `apps/publisher/src/renderer/src/app.css:793-850` and append image-library rules

- [ ] **Step 1: Write failing renderer tests**

Cover loading, empty state, natural grid order, selection confirmation, removal of a selected candidate, conflict summary, overwrite/back actions, full preview metadata, copy success/failure feedback, delete confirmation/cancel/success, request rejection, retry, and stale results after close/path change.

```tsx
render(<ImageLibrary path="content/life/daily.md" title="Daily" api={api} onClose={onClose} />)
expect(await screen.findByText("暂无图片")).toBeVisible()
await user.click(screen.getByRole("button", { name: "添加图片" }))
expect(await screen.findByRole("dialog", { name: "确认添加图片" })).toBeVisible()
expect(screen.getByText("不会修改当前 Markdown 笔记")).toBeVisible()
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library-ui.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the state machine and modal hierarchy**

Use one top-level `ModalShell` with internal views (`gallery`, `selection`, `preview`, `delete-confirm`) rather than nested portals. Guard every promise with a monotonically increasing request generation and mounted flag. Disable close during commit/delete only. Show Chinese errors and retain the current view for retry. Never call a note save callback.

```ts
type ImageLibraryScreen =
  | { readonly kind: "gallery" }
  | { readonly kind: "selection"; readonly selection: ImageLibrarySelection }
  | { readonly kind: "preview"; readonly item: ImageLibraryItem }
  | { readonly kind: "delete-confirm"; readonly preview: ImageLibraryPreview }
```

- [ ] **Step 4: Add responsive, keyboard-visible styling**

Use a bounded `min(960px, calc(100vw - 32px))` dialog, CSS grid `repeat(auto-fill, minmax(150px, 1fr))`, `object-fit: contain`, scroll only inside the content region, visible focus rings, text labels in addition to icons, and a single-column layout below 640 px. Do not use `zoom`, `scale`, or viewport-clipping hacks.

- [ ] **Step 5: Run UI tests and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/image-library-ui.test.tsx
git add apps/publisher/src/renderer/src/components/ImageLibrary.tsx apps/publisher/src/renderer/src/app.css apps/publisher/tests/unit/image-library-ui.test.tsx
git commit -m "feat(publisher): add image library gallery"
```

Expected: UI tests pass without React act warnings.

### Task 8: Add the toolbar entry without mutating Markdown

**Files:**
- Modify: `apps/publisher/src/renderer/src/components/MarkdownEditor.tsx:128-175,436-470`
- Modify: `apps/publisher/src/renderer/src/App.tsx:1001-1025`
- Modify: `apps/publisher/tests/unit/editor.test.tsx`
- Modify: `apps/publisher/tests/unit/app-smoke.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Open the image library from the toolbar, assert it receives the selected note path/title and image API, then perform open/add/copy/delete with fake responses. Snapshot the CodeMirror document, save mock call count, recovery write count, content hash, and save-state label before and after every operation.

```ts
const before = editorView().state.doc.toString()
await user.click(screen.getByRole("button", { name: "图片库" }))
await user.click(await screen.findByRole("button", { name: "复制 Markdown 链接" }))
expect(editorView().state.doc.toString()).toBe(before)
expect(save).not.toHaveBeenCalled()
expect(screen.getByLabelText("保存状态")).toHaveTextContent("已保存")
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/editor.test.tsx tests/unit/app-smoke.test.tsx
```

Expected: FAIL because no toolbar button/prop/modal exists.

- [ ] **Step 3: Wire the component without touching CodeMirror**

Add an `images: GardenApi["images"]` prop and local `imageLibraryOpen` boolean to `MarkdownEditor`. The toolbar button only sets the boolean. Render `ImageLibrary` beside the existing recovery/comparison modals and close it on read-only transition or unmount. Pass `api.images` from `PublisherApp`. Do not dispatch an editor transaction, call autosave, or alter `document.markdown`.

- [ ] **Step 4: Run tests and commit**

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/editor.test.tsx tests/unit/app-smoke.test.tsx
git add apps/publisher/src/renderer/src/components/MarkdownEditor.tsx apps/publisher/src/renderer/src/App.tsx apps/publisher/tests/unit/editor.test.tsx apps/publisher/tests/unit/app-smoke.test.tsx
git commit -m "feat(publisher): open image library from editor"
```

Expected: tests pass and prove Markdown/save state is unchanged.

### Task 9: Exercise the real Electron flow and document usage

**Files:**
- Modify: `apps/publisher/tests/e2e/app.spec.ts`
- Create: `apps/publisher/README.md`

- [ ] **Step 1: Add a failing Electron E2E test**

Create tiny valid PNG fixtures, launch against a temporary garden, monkeypatch Electron's `dialog.showOpenDialog` to return those exact files, then test folder creation, multi-add confirmation, thumbnail visibility, full preview, clipboard copy, permanent delete, `.gitkeep`, and unchanged note bytes.

```ts
await application.evaluate(({ dialog }, paths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
}, [firstPng, secondPng])
const noteBefore = await readFile(notePath)
await page.getByRole("button", { name: "图片库" }).click()
await page.getByRole("button", { name: "添加图片" }).click()
await page.getByRole("button", { name: "确认添加" }).click()
await expect(page.getByRole("img", { name: "first" })).toBeVisible()
expect(await readFile(notePath)).toEqual(noteBefore)
```

- [ ] **Step 2: Run and verify RED, then complete test seams only where needed**

```powershell
npm --prefix apps/publisher run build
npm --prefix apps/publisher run test:e2e -- --grep "manages a note image library"
```

Expected before final wiring corrections: the new E2E test fails at its first missing/incorrect user-visible behavior. Fix only actual integration gaps; do not add production backdoors.

- [ ] **Step 3: Document exact user workflow and limits**

Add a “图片库” section explaining per-note paths, `.gitkeep`, supported formats, 25-MB/50-file limits, conflict overwrite, permanent deletion, and that “复制 Markdown 链接” never edits the note automatically.

- [ ] **Step 4: Run E2E and commit**

```powershell
npm --prefix apps/publisher run build
npm --prefix apps/publisher run test:e2e -- --grep "manages a note image library"
git add apps/publisher/tests/e2e/app.spec.ts apps/publisher/README.md
git commit -m "test(publisher): verify image library workflow"
```

Expected: the focused Electron test passes and no child Electron process remains.

### Task 10: Full regression, packaging, and installed-app smoke test

**Files:**
- Verify only; modify a failing file only when the failure is caused by this feature.

- [ ] **Step 1: Run formatting-sensitive and security checks**

```powershell
git diff --check
npm --prefix apps/publisher run typecheck
npm --prefix apps/publisher run test:run -- tests/unit/renderer-security.test.tsx tests/unit/ipc-schemas.test.ts tests/unit/ipc.test.ts tests/unit/image-formats.test.ts tests/unit/image-library.test.ts tests/unit/image-library-ui.test.tsx
```

Expected: no whitespace errors, typecheck passes, and all focused/security tests pass.

- [ ] **Step 2: Run the complete publisher suite**

```powershell
npm --prefix apps/publisher run test:run
npm --prefix apps/publisher run build
npm --prefix apps/publisher run test:e2e
```

Expected: all unit/integration suites and all Electron E2E tests pass with zero orphan processes.

- [ ] **Step 3: Package Windows installer**

```powershell
npm --prefix apps/publisher run package:win
```

Expected: NSIS packaging succeeds and creates `apps/publisher/release/Knowledge-Garden-Publisher-0.1.0-Setup.exe`.

- [ ] **Step 4: Verify installer artifact and installed runtime without claiming unobserved UI**

Compute SHA-256 for the installer, install/update it using the project's existing silent-install procedure, launch one controlled installed-app smoke run, and verify: process starts, trusted renderer loads, opening an existing note exposes “图片库”, opening it creates the correct empty library, closing exits cleanly, and the Markdown bytes remain unchanged. Record exactly which UI behavior was directly observed.

```powershell
Get-FileHash -Algorithm SHA256 '<exact installer path>'
```

- [ ] **Step 5: Final clean-tree review and completion commit if corrections were needed**

```powershell
git status --short
git log --oneline -12
```

Expected: no uncommitted source changes; the log contains the design plus the focused implementation commits above. If verification required a code correction, rerun the affected focused test first, then the full suite, and commit the correction with a specific `fix(publisher): ...` message.
