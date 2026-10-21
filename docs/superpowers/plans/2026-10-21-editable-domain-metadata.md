# Editable Domain Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit an existing domain's optional description and tags from the domain manager without changing its path, notes, body, or visibility behavior.

**Architecture:** Extend the typed domain contract with a dedicated metadata mutation and carry it through schema validation, IPC, preload, the serialized `DomainCatalog`, and the existing `applyDomainMutation` UI path. The service will parse and safely replace only `content/<slug>/index.md`, preserving unrelated frontmatter and body content while using the domain catalog's existing boundary, identity, serialization, and atomic-replacement primitives.

**Tech Stack:** TypeScript, React 19, Electron IPC/preload, Zod, gray-matter/YAML, Vitest, Testing Library, Playwright.

---

## File map

- `apps/publisher/src/shared/contracts.ts`: public domain summary/request/API/channel types.
- `apps/publisher/src/shared/ipcSchemas.ts`: trusted request and response validation.
- `apps/publisher/src/main/services/domains.ts`: metadata discovery, normalization, serialized atomic update.
- `apps/publisher/src/main/publisherServices.ts`: exposes the catalog operation through the service port.
- `apps/publisher/src/main/ipc.ts`: registers the new secure IPC handler.
- `apps/publisher/src/preload/gardenApi.ts`: exposes the typed renderer method.
- `apps/publisher/src/renderer/src/components/DomainManager.tsx`: edit form and list verification display.
- `apps/publisher/src/renderer/src/App.tsx`: routes the mutation through existing state refresh logic.
- `apps/publisher/src/renderer/src/app.css`: compact description/tag presentation and form styling.
- `apps/publisher/tests/unit/{domains,ipc,ipc-schemas,domain-manager,main-layout}.test.*`: TDD coverage for every boundary.
- `apps/publisher/tests/e2e/app.spec.ts`: persistence across restart.
- `HANDOFF.md`: released behavior and verification evidence.

### Task 1: Add the typed metadata contract and schemas

**Files:**
- Modify: `apps/publisher/src/shared/contracts.ts:214-237,454-470,734-739`
- Modify: `apps/publisher/src/shared/ipcSchemas.ts:85-110,760-775`
- Test: `apps/publisher/tests/unit/ipc-schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add a domain fixture with `tags`, assert summaries accept empty metadata, and assert the update request accepts empty values but rejects untrimmed/duplicate/oversized tags:

```ts
expect(domainSummarySchema.parse({
  slug: "reflection",
  name: "每周复盘",
  description: "",
  tags: [],
  order: 1,
  publicNotes: 1,
  privateNotes: 0,
})).toMatchObject({ description: "", tags: [] })

expect(domainUpdateMetadataSchema.parse({
  slug: "reflection",
  description: "",
  tags: [],
})).toEqual({ slug: "reflection", description: "", tags: [] })

expect(() => domainUpdateMetadataSchema.parse({
  slug: "reflection",
  description: "Review",
  tags: ["planning", "planning"],
})).toThrow()
```

- [ ] **Step 2: Run the schema tests and verify RED**

Run: `npm run test:run -- tests/unit/ipc-schemas.test.ts`

Expected: FAIL because `tags`, `domainUpdateMetadataSchema`, and the new channel response schema do not exist.

- [ ] **Step 3: Add the contract**

Add:

```ts
export interface DomainSummary {
  readonly slug: DomainSlug
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly order: number
  readonly publicNotes: number
  readonly privateNotes: number
}

export interface DomainUpdateMetadataRequest {
  readonly slug: DomainSlug
  readonly description: string
  readonly tags: readonly string[]
}
```

Add `domainsUpdateMetadata: "garden:domains:update-metadata"` and `GardenApi.domains.updateMetadata(request)`.

- [ ] **Step 4: Add strict Zod validation**

Define shared tag validation and the request schema:

```ts
const domainTagSchema = z.string().min(1).max(128).refine((value) => value === value.trim())
const domainTagsSchema = z.array(domainTagSchema).max(100).refine(
  (tags) => new Set(tags).size === tags.length,
  "Domain tags must be unique.",
)

export const domainUpdateMetadataSchema = z.object({
  slug: domainSlugSchema,
  description: z.string().max(2_000).refine((value) => value === value.trim()),
  tags: domainTagsSchema,
}).strict()
```

Change `domainSummarySchema.description` to allow `""`, add `tags`, and register the new array response under `responseSchemas`.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:run -- tests/unit/ipc-schemas.test.ts`

Expected: PASS.

```powershell
git add apps/publisher/src/shared/contracts.ts apps/publisher/src/shared/ipcSchemas.ts apps/publisher/tests/unit/ipc-schemas.test.ts
git commit -m "feat(publisher): define editable domain metadata contract"
```

### Task 2: Discover tags and optional descriptions

**Files:**
- Modify: `apps/publisher/src/main/services/domains.ts:700-760,920-970`
- Test: `apps/publisher/tests/unit/domains.test.ts:215-510`

- [ ] **Step 1: Write failing discovery tests**

Cover missing, blank, valid, and invalid metadata:

```ts
it("discovers optional domain descriptions and tags", async () => {
  await writeFixture(root, "content/reflection/index.md", [
    "---",
    "gardenDomain: true",
    "title: 每周复盘",
    "description: ''",
    "tags: []",
    "domainOrder: 1",
    "---",
    "",
    "body",
  ].join("\n"))

  await expect(discoverDomains(root)).resolves.toEqual([
    expect.objectContaining({ description: "", tags: [] }),
  ])
})
```

Add a second page with no `description`/`tags`, a valid multi-tag page, and table cases where `tags` is a scalar, contains non-strings, whitespace-padded strings, duplicates, or more than 100 items. Invalid present values must reject with `DOMAIN_METADATA_INVALID`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- tests/unit/domains.test.ts -t "optional domain descriptions and tags"`

Expected: FAIL because discovery currently requires a non-empty description and omits tags.

- [ ] **Step 3: Parse optional metadata without weakening other fields**

Extend `parseDomainPage` to return `tags`. Normalize only absence/null to empty values; validate present values using the strict summary shapes:

```ts
const descriptionValue = data.description == null ? "" : data.description
const tagsValue = data.tags == null ? [] : data.tags
const parsedDescription = domainSummarySchema.shape.description.safeParse(descriptionValue)
const parsedTags = domainSummarySchema.shape.tags.safeParse(tagsValue)
```

Include `tags` in the discovered summary. Keep title, slug, order, marker, safe-YAML, and path checks unchanged.

- [ ] **Step 4: Run discovery tests and commit**

Run: `npm run test:run -- tests/unit/domains.test.ts -t "discoverDomains"`

Expected: PASS.

```powershell
git add apps/publisher/src/main/services/domains.ts apps/publisher/tests/unit/domains.test.ts
git commit -m "feat(publisher): discover optional domain metadata"
```

### Task 3: Implement serialized atomic metadata updates

**Files:**
- Modify: `apps/publisher/src/main/services/domains.ts:1500-3435`
- Test: `apps/publisher/tests/unit/domains.test.ts`

- [ ] **Step 1: Write the successful-update test**

Create an index with CRLF, unrelated frontmatter, and body content. Call `catalog.updateMetadata` and verify only the owned keys change:

```ts
const before = [
  "---",
  "title: 每周复盘",
  "description: 旧描述",
  "tags:",
  "  - old",
  "gardenDomain: true",
  "domainOrder: 1",
  "customField: keep-me",
  "---",
  "",
  "正文保持不变。",
  "",
].join("\r\n")

await catalog.updateMetadata({
  slug: "reflection",
  description: "新的描述",
  tags: ["reflection", "planning"],
})

const after = await readFile(index, "utf8")
expect(after).toContain("description: 新的描述")
expect(after).toContain("customField: keep-me")
expect(after).toContain("正文保持不变。")
expect(after).not.toContain("\n正文保持不变。\n")
```

Add a test saving `{ description: "", tags: [] }` and assert both keys are absent while summary returns empty values.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- tests/unit/domains.test.ts -t "updates domain metadata"`

Expected: FAIL because `DomainCatalog.updateMetadata` does not exist.

- [ ] **Step 3: Add the catalog method and safe rewrite helper**

Add `updateMetadata(request: DomainUpdateMetadataRequest)` to `DomainCatalog`. Inside the existing `mutation()` queue:

- Parse with `domainUpdateMetadataSchema`.
- Obtain a fresh `discoverDomainSnapshot` and the selected domain evidence.
- Read the landing page and retain its full bytes, identity, mode, and newline convention.
- Parse with `SAFE_MATTER_OPTIONS`; require `gardenDomain === true` and a matching selected domain.
- Copy the complete data object, set/delete only `description` and `tags`, and serialize with the unchanged Markdown body.
- Normalize generated line endings back to the source convention.
- Create a same-directory uniquely named temporary file and backup path with mode `0o600`.
- Sync the temporary file, revalidate all managed boundaries and the exact original landing identity/hash, then call existing `replaceFileEntry(temporary, target, backup)`.
- Sync the parent directory, remove the backup after successful rediscovery, and return the refreshed domain list.
- On failure, restore the backup when replacement began and clean only transaction-owned paths.

- [ ] **Step 4: Add adversarial and serialization tests**

Add deterministic hooks/test filesystem seams for:

- source changed after read;
- domain/index replaced by a symlink;
- atomic replacement failure;
- rediscovery failure after replacement;
- concurrent rename/remove/update requests run serially;
- unrelated notes, private directories, attachments, title, order, body, and custom YAML remain unchanged.

Each failure test must compare the original landing bytes and assert no transaction artifacts remain.

- [ ] **Step 5: Run service tests and commit**

Run: `npm run test:run -- tests/unit/domains.test.ts`

Expected: PASS.

```powershell
git add apps/publisher/src/main/services/domains.ts apps/publisher/tests/unit/domains.test.ts
git commit -m "feat(publisher): update domain metadata atomically"
```

### Task 4: Carry the operation through IPC and preload

**Files:**
- Modify: `apps/publisher/src/main/publisherServices.ts:62-90,329-344`
- Modify: `apps/publisher/src/main/ipc.ts:100-125,810-840`
- Modify: `apps/publisher/src/preload/gardenApi.ts:185-202`
- Test: `apps/publisher/tests/unit/ipc.test.ts`
- Test: `apps/publisher/tests/unit/app-smoke.test.tsx`
- Test: `apps/publisher/tests/unit/main-layout.test.tsx` mock factory

- [ ] **Step 1: Add failing IPC tests**

Extend the service mock and assert the trusted channel delegates exactly once:

```ts
[
  IPC_CHANNELS.requests.domainsUpdateMetadata,
  { slug: "reflection", description: "复盘", tags: ["reflection"] },
  "domainsUpdateMetadata",
]
```

Add hostile payload cases for untrimmed description/tags, duplicate tags, unknown keys, bad slug, and oversized arrays. Assert the service is not called.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- tests/unit/ipc.test.ts tests/unit/app-smoke.test.tsx`

Expected: FAIL because no handler or preload method exists.

- [ ] **Step 3: Implement the transport**

Expose `catalog.updateMetadata` from `createPublisherServices`, register a `secureHandler` with `domainUpdateMetadataSchema`, and add:

```ts
updateMetadata: (request) =>
  invoke<readonly DomainSummary[]>(
    ipc,
    IPC_CHANNELS.requests.domainsUpdateMetadata,
    request,
  ),
```

Update all typed test mocks with `updateMetadata: vi.fn(...)`.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:run -- tests/unit/ipc.test.ts tests/unit/ipc-schemas.test.ts tests/unit/app-smoke.test.tsx`

Expected: PASS.

```powershell
git add apps/publisher/src/main/publisherServices.ts apps/publisher/src/main/ipc.ts apps/publisher/src/preload/gardenApi.ts apps/publisher/tests/unit/ipc.test.ts apps/publisher/tests/unit/ipc-schemas.test.ts apps/publisher/tests/unit/app-smoke.test.tsx apps/publisher/tests/unit/main-layout.test.tsx
git commit -m "feat(publisher): expose domain metadata updates"
```

### Task 5: Add the domain metadata editor

**Files:**
- Modify: `apps/publisher/src/renderer/src/components/DomainManager.tsx`
- Modify: `apps/publisher/src/renderer/src/app.css`
- Test: `apps/publisher/tests/unit/domain-manager.test.tsx`

- [ ] **Step 1: Write failing component tests**

Update fixtures with `tags`, pass `onUpdateMetadata`, then cover:

```ts
await user.click(screen.getByRole("button", { name: "编辑 每周复盘 的信息" }))
expect(screen.getByRole("textbox", { name: "描述（选填）" })).toHaveValue("旧描述")
expect(screen.getByRole("textbox", { name: "标签（选填）" })).toHaveValue("reflection, planning")

await user.clear(screen.getByRole("textbox", { name: "描述（选填）" }))
await user.clear(screen.getByRole("textbox", { name: "标签（选填）" }))
await user.click(screen.getByRole("button", { name: "保存信息" }))
expect(onUpdateMetadata).toHaveBeenCalledWith({
  slug: "reflection",
  description: "",
  tags: [],
})
```

Add normalization coverage for `反思， planning,反思 ,, weekly`, limits, retry after rejection, cancel, disabled controls while pending, focus return, and list placeholders.

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- tests/unit/domain-manager.test.tsx`

Expected: FAIL because the edit action and callback do not exist.

- [ ] **Step 3: Implement the editor UI**

Add `{ kind: "edit-metadata"; domain: DomainSummary }` mode, `description` and `tags` state, and:

```ts
function normalizeTags(value: string): readonly string[] {
  const seen = new Set<string>()
  return value
    .split(/[,，]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !seen.has(tag) && Boolean(seen.add(tag)))
}
```

Use an explicit loop instead if lint/type readability rejects the side-effect filter. Validate the normalized length and individual tag lengths before calling `onUpdateMetadata`.

Render description/tag summaries in each card. Use visible placeholders only in the manager; never submit them as values. Keep create, rename, delete, focus recovery, and busy behavior unchanged.

- [ ] **Step 4: Style and verify**

Add compact `.domain-manager-description`, `.domain-manager-tags`, and tag chip rules that wrap long content without expanding the modal beyond its viewport.

Run: `npm run test:run -- tests/unit/domain-manager.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/publisher/src/renderer/src/components/DomainManager.tsx apps/publisher/src/renderer/src/app.css apps/publisher/tests/unit/domain-manager.test.tsx
git commit -m "feat(publisher): edit domain descriptions and tags"
```

### Task 6: Integrate refreshed state without touching notes or visibility

**Files:**
- Modify: `apps/publisher/src/renderer/src/App.tsx:1537-1551`
- Test: `apps/publisher/tests/unit/main-layout.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Open the manager, edit one domain, resolve the API with updated summaries, and assert the new values render. Also assert unrelated APIs are untouched:

```ts
expect(garden.domains.updateMetadata).toHaveBeenCalledWith({
  slug: "reflection",
  description: "新的复盘说明",
  tags: ["reflection", "planning"],
})
expect(garden.notes.save).not.toHaveBeenCalled()
expect(garden.notes.changeVisibility).not.toHaveBeenCalled()
expect(garden.notes.rename).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:run -- tests/unit/main-layout.test.tsx -t "updates domain metadata"`

Expected: FAIL because `DomainManager` is not wired to the API.

- [ ] **Step 3: Wire the existing mutation path**

Pass:

```tsx
onUpdateMetadata={(request: DomainUpdateMetadataRequest) =>
  applyDomainMutation(() => api.domains.updateMetadata(request))
}
```

Do not add note reloads, visibility changes, automatic Git operations, or automatic publication.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:run -- tests/unit/main-layout.test.tsx tests/unit/domain-manager.test.tsx`

Expected: PASS.

```powershell
git add apps/publisher/src/renderer/src/App.tsx apps/publisher/tests/unit/main-layout.test.tsx
git commit -m "feat(publisher): refresh edited domain metadata"
```

### Task 7: Prove persistence and release the update

**Files:**
- Modify: `apps/publisher/tests/e2e/app.spec.ts:1343-1505`
- Modify: `apps/publisher/package.json`
- Modify: `apps/publisher/package-lock.json`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Add the end-to-end persistence scenario**

In the custom-domain lifecycle test, edit a domain to a blank description and two tags, assert the landing file, restart the application, and assert the manager reloads those tags. Then edit to a non-empty description and empty tags and verify again.

- [ ] **Step 2: Run focused and complete verification**

Run:

```powershell
npm run test:run -- tests/unit/ipc-schemas.test.ts tests/unit/domains.test.ts tests/unit/ipc.test.ts tests/unit/domain-manager.test.tsx tests/unit/main-layout.test.tsx
npm run typecheck
npm run test:run -- --maxWorkers=1 --no-file-parallelism
npm run test:e2e -- --grep "manages custom domains"
```

Expected: all focused tests, typecheck, the full suite, and the domain E2E scenario pass.

- [ ] **Step 3: Review the diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat HEAD~6
```

Confirm no note transaction, visibility, preview-publication isolation, or unrelated user-owned file changed.

- [ ] **Step 4: Request independent code review and address only confirmed findings**

Review the contract, atomic replacement/rollback, symlink and concurrency safety, IPC validation, accessibility, and regression scope. For each confirmed issue, add a failing test before its fix.

- [ ] **Step 5: Bump the patch version and document verification**

Increment the Publisher patch version in both package files, record the behavior and exact verification counts in `HANDOFF.md`, then commit:

```powershell
git add apps/publisher/package.json apps/publisher/package-lock.json HANDOFF.md apps/publisher/tests/e2e/app.spec.ts
git commit -m "chore(publisher): release editable domain metadata"
```

- [ ] **Step 6: Package, install, and verify**

Run `npm run package:win`, install the generated build using the established versioned-backup replacement procedure, verify product/file version and SHA256, launch it once, and manually confirm editing/clearing domain metadata survives reopening the manager.

- [ ] **Step 7: Merge and push without consuming user changes**

Preserve the existing uncommitted `highlight.js` package changes and `.tmp-render-check.png`, fast-forward the feature branch into `main`, restore those user changes, rerun focused tests/typecheck, and push the verified `main` commit to both `origin` and `publisher` remotes.
