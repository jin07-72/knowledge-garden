# Publisher Main Branch Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show publication failures inside the review dialog and provide an explicit, rollback-safe `master` to `main` repair that retries the exact selected publication.

**Architecture:** Add a focused main-process branch gate that inspects and repairs only the fixed `master`/`origin/main` legacy layout. Expose one validated repair IPC method, run the gate synchronously before accepting a publication operation, and keep the review dialog open so structured errors and the repair action remain visible. The ordinary publisher remains responsible for isolated verification, commit, push, and remote confirmation after repair.

**Tech Stack:** Electron 44, TypeScript 7, React 19, Zod, Vitest, Testing Library, Playwright Electron, Git CLI through the existing bounded command runner.

---

## File Map

- Create `apps/publisher/src/main/services/publishBranchRepair.ts`: fixed branch inspection, safe rename, verification, rollback, and concurrency guard.
- Create `apps/publisher/tests/integration/publish-branch-repair.test.ts`: real temporary Git repository coverage for inspection, mutation, rollback, and file preservation.
- Modify `apps/publisher/src/shared/contracts.ts`: public error codes, repair receipt, IPC channel, and `GardenApi.publish.repairBranch()`.
- Modify `apps/publisher/src/shared/ipcSchemas.ts`: strict repair receipt response schema.
- Modify `apps/publisher/src/main/ipc.ts`: service contract and secure no-argument repair handler.
- Modify `apps/publisher/src/preload/gardenApi.ts`: narrow renderer bridge method.
- Modify `apps/publisher/src/main/publisherServices.ts`: branch preflight before publication, shared repair/publish coordination, and repair service wiring.
- Modify `apps/publisher/src/main/index.ts`: construct the production branch repair service with the bounded command runner.
- Modify `apps/publisher/src/renderer/src/App.tsx`: preserve the open review, retain the selected IDs, call repair, and retry the exact request.
- Modify `apps/publisher/src/renderer/src/components/PublishReview.tsx`: visible submit error, repair action, and busy state.
- Modify `apps/publisher/src/renderer/src/app.css`: compact alert/action layout using existing tokens.
- Modify `apps/publisher/tests/unit/ipc-schemas.test.ts`: response validation and stripping tests.
- Modify `apps/publisher/tests/unit/ipc.test.ts`: authorization, schema, main handler, and preload bridge coverage.
- Modify `apps/publisher/tests/unit/publisher-services.test.ts`: synchronous branch gate and concurrency behavior.
- Modify `apps/publisher/tests/unit/app-smoke.test.tsx`: dialog error and repair/retry behavior.
- Modify `apps/publisher/tests/e2e/app.spec.ts`: full legacy-branch repair and publish flow.
- Modify `apps/publisher/README.md`: document the repair prompt and refusal conditions.

### Task 1: Define the Narrow Public Contract

**Files:**
- Modify: `apps/publisher/src/shared/contracts.ts`
- Modify: `apps/publisher/src/shared/ipcSchemas.ts`
- Test: `apps/publisher/tests/unit/ipc-schemas.test.ts`

- [ ] **Step 1: Write failing schema and contract tests**

Add assertions that the new response accepts only a verified receipt and strips unknown response fields:

```ts
it("validates the fixed publication branch repair receipt", () => {
  const schema = IPC_SUCCESS_SCHEMAS[IPC_CHANNELS.requests.publishRepairBranch]
  expect(
    schema.parse({
      branch: "main",
      upstream: "origin/main",
      head: "a".repeat(40),
      ignored: "host detail",
    }),
  ).toEqual({ branch: "main", upstream: "origin/main", head: "a".repeat(40) })
  expect(() =>
    schema.parse({ branch: "master", upstream: "origin/main", head: "a".repeat(40) }),
  ).toThrow()
})
```

Add compile-checked fixtures for these four public errors:

```ts
const repairErrors: readonly AppError[] = [
  { code: "PUBLISH_BRANCH_REPAIR_REQUIRED", message: "本地发布分支需要安全切换到 main。" },
  { code: "PUBLISH_BRANCH_REPAIR_BLOCKED", message: "当前分支不能自动修复。" },
  { code: "PUBLISH_BRANCH_REPAIR_FAILED", message: "分支修复失败，已恢复原状态。" },
  { code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN", message: "分支恢复状态无法确认。" },
]
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/ipc-schemas.test.ts
```

Expected: FAIL because `publishRepairBranch`, `PublishBranchRepairReceipt`, and the new error codes do not exist.

- [ ] **Step 3: Add the minimal shared contract**

Add to `APP_ERROR_CODES`:

```ts
"PUBLISH_BRANCH_REPAIR_REQUIRED",
"PUBLISH_BRANCH_REPAIR_BLOCKED",
"PUBLISH_BRANCH_REPAIR_FAILED",
"PUBLISH_BRANCH_REPAIR_UNCERTAIN",
```

Add the receipt and channel:

```ts
export interface PublishBranchRepairReceipt {
  readonly branch: "main"
  readonly upstream: "origin/main"
  readonly head: string
}

publishRepairBranch: "garden:publish:repair-branch",
```

Extend the API:

```ts
readonly publish: {
  start(request: PublishRequest): Promise<IpcResult<PublishStartReceipt>>
  repairBranch(): Promise<IpcResult<PublishBranchRepairReceipt>>
  cancel(request: PublishCancelRequest): Promise<IpcResult<void>>
  onProgress(listener: (progress: PublishProgress) => void): Unsubscribe
}
```

Add the strict response schema:

```ts
const publishBranchRepairReceiptSchema = z
  .object({
    branch: z.literal("main"),
    upstream: z.literal("origin/main"),
    head: z.string().regex(/^[a-f0-9]{40,64}$/),
  })
  .strip()

[IPC_CHANNELS.requests.publishRepairBranch]: publishBranchRepairReceiptSchema,
```

- [ ] **Step 4: Run the focused schema test to verify GREEN**

Run:

```powershell
npm run test:run -- tests/unit/ipc-schemas.test.ts
```

Expected: schema test passes. Update typed `GardenApi` test fixtures with an explicit `repairBranch: vi.fn()` so the contract compiles as later production layers are added; full typecheck runs after the bridge is implemented in Task 3.

- [ ] **Step 5: Commit the contract**

```powershell
git add -- apps/publisher/src/shared/contracts.ts apps/publisher/src/shared/ipcSchemas.ts apps/publisher/tests/unit/ipc-schemas.test.ts apps/publisher/tests
git commit -m "feat(publisher): define branch repair contract"
```

### Task 2: Implement Safe Branch Inspection and Repair

**Files:**
- Create: `apps/publisher/src/main/services/publishBranchRepair.ts`
- Create: `apps/publisher/tests/integration/publish-branch-repair.test.ts`
- Reuse: `apps/publisher/src/main/lib/commandRunner.ts`
- Reuse: `apps/publisher/tests/helpers/git.ts`

- [ ] **Step 1: Write the failing eligible-repair integration test**

Create a real temporary repository, rename its local branch to `master`, set its upstream to `origin/main`, write an untracked note, and assert the wished-for API. Define the test helpers in the same file:

```ts
async function gitOutput(root: string, args: readonly string[]): Promise<string> {
  const result = await git(root, args)
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function legacyMasterFixture() {
  const fixture = await createQuartzGardenFixture({
    directoryName: "Legacy Master Garden",
    noteTitle: "Existing Note",
    noteBody: "existing",
  })
  await git(fixture.root, ["branch", "-m", "master"])
  await git(fixture.root, ["branch", "--set-upstream-to=origin/main", "master"])
  await writeFixtureFile(fixture.root, "content/study/new-note.md", "# New note\n")
  return fixture
}
```

```ts
it("renames eligible master to main without changing HEAD or untracked bytes", async () => {
  const fixture = await legacyMasterFixture()
  const beforeHead = await gitOutput(fixture.root, ["rev-parse", "HEAD"])
  const beforeNote = await readFile(join(fixture.root, "content/study/new-note.md"))
  const service = createPublishBranchRepair({ workspace: fixture.root })

  await expect(service.inspect()).resolves.toEqual({ status: "repairable", head: beforeHead })
  await expect(service.repair()).resolves.toEqual({
    branch: "main",
    upstream: "origin/main",
    head: beforeHead,
  })
  expect(await gitOutput(fixture.root, ["branch", "--show-current"])).toBe("main")
  expect(await gitOutput(fixture.root, ["rev-parse", "@{upstream}"])).toBe("origin/main")
  expect(await readFile(join(fixture.root, "content/study/new-note.md"))).toEqual(beforeNote)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm run test:run -- tests/integration/publish-branch-repair.test.ts
```

Expected: FAIL because `createPublishBranchRepair` does not exist.

- [ ] **Step 3: Implement inspection with fixed Git commands**

Create these internal types and public service boundary:

```ts
export type PublishBranchInspection =
  | { readonly status: "ready"; readonly head: string }
  | { readonly status: "repairable"; readonly head: string }
  | { readonly status: "blocked"; readonly reason: string }

export interface PublishBranchRepairService {
  inspect(): Promise<PublishBranchInspection>
  repair(): Promise<PublishBranchRepairReceipt>
  dispose(): Promise<void>
}

export function createPublishBranchRepair(options: {
  readonly workspace: string
  readonly runner?: CommandRunner
  readonly beforeMutation?: () => Promise<void>
  readonly afterRename?: () => Promise<void>
}): PublishBranchRepairService
```

Use the existing command runner with `executable: "git"`, the workspace as `cwd`, and fixed argument arrays. Inspection must read:

```ts
["rev-parse", "--show-toplevel"]
["symbolic-ref", "--quiet", "--short", "HEAD"]
["rev-parse", "HEAD"]
["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]
["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"]
["show-ref", "--verify", "--quiet", "refs/heads/main"]
["diff", "--cached", "--quiet", "--exit-code"]
["status", "--porcelain=v1", "-z", "--untracked-files=all"]
```

Check `.git/MERGE_HEAD`, `.git/CHERRY_PICK_HEAD`, `.git/REVERT_HEAD`, `.git/BISECT_LOG`, `.git/rebase-merge`, and `.git/rebase-apply` through the resolved common Git directory. Return `repairable` only for branch `master`, upstream `origin/main`, existing remote-tracking main, absent local main, no operation marker, and no staged changes. Return `ready` for branch `main`; all other layouts are `blocked`.

- [ ] **Step 4: Implement repair verification and bounded rollback**

Use a single-flight promise and a persistent `uncertain` flag. An uncertain service rejects every later `inspect()` and `repair()` with `PUBLISH_BRANCH_REPAIR_UNCERTAIN`. Immediately re-run inspection and capture HEAD plus porcelain bytes. Invoke the test-only `beforeMutation` dependency, then re-run the full preconditions and confirm the same HEAD before executing:

```ts
await runGit(["branch", "-m", "master", "main"])
renamed = true
await options.afterRename?.()
await runGit(["branch", "--set-upstream-to=origin/main", "main"])
await verifyMainState(capturedHead, capturedStatus)
```

On failure after rename:

```ts
try {
  await runGit(["branch", "-m", "main", "master"])
  await runGit(["branch", "--set-upstream-to=origin/main", "master"])
  await verifyMasterState(capturedHead, capturedStatus)
} catch {
  uncertain = true
}
throw uncertain
  ? appError("PUBLISH_BRANCH_REPAIR_UNCERTAIN", "分支恢复状态无法确认；请停止发布并检查 Git 状态。")
  : appError("PUBLISH_BRANCH_REPAIR_FAILED", "分支修复失败，已恢复原状态。")
```

Status comparison must ignore only the `##` branch header by using porcelain v1 without `--branch`; every tracked/untracked path entry and byte must remain identical.

- [ ] **Step 5: Add refusal, race, rollback, and concurrency tests one at a time**

For each case, add the test, run it to see the expected failure, add the minimal behavior, and rerun:

```ts
const blockers: ReadonlyArray<{
  readonly name: string
  readonly arrange: (root: string) => Promise<void>
}> = [
  {
    name: "existing local main",
    arrange: async (root) => {
      const head = await gitOutput(root, ["rev-parse", "HEAD"])
      await git(root, ["branch", "main", head])
    },
  },
  {
    name: "wrong upstream",
    arrange: async (root) => {
      await git(root, ["branch", "--unset-upstream", "master"])
      const head = await gitOutput(root, ["rev-parse", "HEAD"])
      await git(root, ["update-ref", "refs/remotes/origin/other", head])
      await git(root, ["branch", "--set-upstream-to=origin/other", "master"])
    },
  },
  {
    name: "missing upstream",
    arrange: async (root) => {
      await git(root, ["branch", "--unset-upstream", "master"])
    },
  },
  {
    name: "staged changes",
    arrange: async (root) => {
      await git(root, ["add", "content/study/new-note.md"])
    },
  },
  {
    name: "merge in progress",
    arrange: async (root) => {
      const gitDirectory = await gitOutput(root, ["rev-parse", "--git-dir"])
      await writeFile(resolve(root, gitDirectory, "MERGE_HEAD"), `${"b".repeat(40)}\n`)
    },
  },
]

it.each(blockers)("blocks $name without mutating refs", async ({ arrange }) => {
  const fixture = await legacyMasterFixture()
  const beforeHead = await gitOutput(fixture.root, ["rev-parse", "HEAD"])
  const beforeNote = await readFile(join(fixture.root, "content/study/new-note.md"))
  await arrange(fixture.root)
  const service = createPublishBranchRepair({ workspace: fixture.root })

  await expect(service.inspect()).resolves.toMatchObject({ status: "blocked" })
  expect(await gitOutput(fixture.root, ["branch", "--show-current"])).toBe("master")
  expect(await gitOutput(fixture.root, ["rev-parse", "HEAD"])).toBe(beforeHead)
  expect(await readFile(join(fixture.root, "content/study/new-note.md"))).toEqual(beforeNote)
  await fixture.cleanup()
})

it("rolls back when the post-rename step fails", async () => {
  const service = createPublishBranchRepair({
    workspace,
    afterRename: async () => { throw new Error("injected failure") },
  })
  await expect(service.repair()).rejects.toMatchObject({ code: "PUBLISH_BRANCH_REPAIR_FAILED" })
  expect(await gitOutput(workspace, ["branch", "--show-current"])).toBe("master")
})

it("refuses a HEAD race before mutation", async () => {
  const fixture = await legacyMasterFixture()
  const service = createPublishBranchRepair({
    workspace: fixture.root,
    beforeMutation: async () => {
      await git(fixture.root, ["commit", "--allow-empty", "-m", "racing commit"])
    },
  })
  await expect(service.repair()).rejects.toMatchObject({
    code: "PUBLISH_BRANCH_REPAIR_BLOCKED",
  })
  expect(await gitOutput(fixture.root, ["branch", "--show-current"])).toBe("master")
  await fixture.cleanup()
})

it("blocks later work when rollback cannot be confirmed", async () => {
  const fixture = await legacyMasterFixture()
  const runner: CommandRunner = {
    run: (request) => {
      if (
        request.executable === "git" &&
        request.args.join("\0") === ["branch", "-m", "main", "master"].join("\0")
      ) {
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "injected rollback failure" })
      }
      return runCommand(request)
    },
  }
  const service = createPublishBranchRepair({
    workspace: fixture.root,
    runner,
    afterRename: async () => { throw new Error("injected post-rename failure") },
  })
  await expect(service.repair()).rejects.toMatchObject({
    code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
  })
  await expect(service.inspect()).rejects.toMatchObject({
    code: "PUBLISH_BRANCH_REPAIR_UNCERTAIN",
  })
  await fixture.cleanup()
})

it("shares one repair flight", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const service = createPublishBranchRepair({
    workspace,
    beforeMutation: () => gate,
  })
  const leftFlight = service.repair()
  const rightFlight = service.repair()
  release()
  const [left, right] = await Promise.all([leftFlight, rightFlight])
  expect(left).toEqual(right)
})
```

- [ ] **Step 6: Run the complete branch service suite**

Run:

```powershell
npm run test:run -- tests/integration/publish-branch-repair.test.ts
```

Expected: all branch inspection, preservation, refusal, rollback, and concurrency tests pass.

- [ ] **Step 7: Commit the service**

```powershell
git add -- apps/publisher/src/main/services/publishBranchRepair.ts apps/publisher/tests/integration/publish-branch-repair.test.ts
git commit -m "feat(publisher): repair legacy publication branch safely"
```

### Task 3: Wire Preflight and Repair Through Services and IPC

**Files:**
- Modify: `apps/publisher/src/main/publisherServices.ts`
- Modify: `apps/publisher/src/main/index.ts`
- Modify: `apps/publisher/src/main/ipc.ts`
- Modify: `apps/publisher/src/preload/gardenApi.ts`
- Test: `apps/publisher/tests/unit/publisher-services.test.ts`
- Test: `apps/publisher/tests/unit/ipc.test.ts`

- [ ] **Step 1: Write failing publisher-service preflight tests**

Inject a branch service and assert that a repairable branch fails before an operation ID is allocated or `publisher.publish()` starts:

```ts
const branchRepair = {
  inspect: vi.fn(async () => ({ status: "repairable" as const, head: "a".repeat(40) })),
  repair: vi.fn(),
  dispose: vi.fn(async () => undefined),
}
await expect(services.publish.start({ changeGroupIds: ["note:daily"] })).rejects.toEqual({
  code: "PUBLISH_BRANCH_REPAIR_REQUIRED",
  message: "本地 master 正在跟踪 origin/main；请确认安全切换到 main 后继续发布。",
})
expect(publish).not.toHaveBeenCalled()
```

Add tests that `publish.repairBranch()` rejects during an active or preparing publication and that publish rejects while repair is active.

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/publisher-services.test.ts
```

Expected: FAIL because branch preflight and `repairBranch` are not wired.

- [ ] **Step 3: Add the branch repair dependency and coordination**

Extend dependencies:

```ts
readonly branchRepair?: PublishBranchRepairService
```

Before scanning selected groups inside `publish.start`, increment `preparingPublish`, await `branchRepair.inspect()`, and map:

```ts
if (inspection.status === "repairable") {
  throw {
    code: "PUBLISH_BRANCH_REPAIR_REQUIRED",
    message: "本地 master 正在跟踪 origin/main；请确认安全切换到 main 后继续发布。",
  } satisfies AppError
}
if (inspection.status === "blocked") {
  throw {
    code: "PUBLISH_BRANCH_REPAIR_BLOCKED",
    message: inspection.reason,
  } satisfies AppError
}
```

Add a `repairingBranch` flight. `publish.repairBranch()` checks `activePublish`, `preparingPublish`, and `switchPreparing`, calls the branch service once, and clears the flight in `finally`. `publish.start` rejects while that flight exists. Dispose the branch service with the other runtime services.

- [ ] **Step 4: Run publisher-service tests and verify GREEN**

Run:

```powershell
npm run test:run -- tests/unit/publisher-services.test.ts
```

Expected: all publisher service tests pass.

- [ ] **Step 5: Write failing IPC and preload tests**

Test the finite no-argument channel, trusted sender, response validation, and bridge:

```ts
await expect(api.publish.repairBranch()).resolves.toEqual({
  ok: true,
  value: { branch: "main", upstream: "origin/main", head: "a".repeat(40) },
})
expect(ipc.invocations.at(-1)).toEqual({
  channel: IPC_CHANNELS.requests.publishRepairBranch,
  args: [],
})
```

- [ ] **Step 6: Run IPC tests and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/ipc.test.ts
```

Expected: FAIL because the handler and bridge method do not exist.

- [ ] **Step 7: Implement the secure handler and bridge**

Extend `PublisherIpcServices.publish`:

```ts
repairBranch(): Promise<PublishBranchRepairReceipt>
```

Register:

```ts
[
  IPC_CHANNELS.requests.publishRepairBranch,
  secureHandler(
    IPC_CHANNELS.requests.publishRepairBranch,
    noRequestSchema,
    isTrustedSender,
    () => services.publish.repairBranch(),
  ),
],
```

Expose through preload:

```ts
repairBranch: () =>
  invoke<PublishBranchRepairReceipt>(ipc, IPC_CHANNELS.requests.publishRepairBranch),
```

Construct `createPublishBranchRepair({ workspace })` in `index.ts` and pass it into `createPublisherServices`.

- [ ] **Step 8: Run IPC, service, and type checks**

Run:

```powershell
npm run test:run -- tests/unit/ipc.test.ts tests/unit/publisher-services.test.ts tests/unit/ipc-schemas.test.ts
npm run typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 9: Commit service and IPC wiring**

```powershell
git add -- apps/publisher/src/main/publisherServices.ts apps/publisher/src/main/index.ts apps/publisher/src/main/ipc.ts apps/publisher/src/preload/gardenApi.ts apps/publisher/tests/unit/publisher-services.test.ts apps/publisher/tests/unit/ipc.test.ts
git commit -m "feat(publisher): expose safe branch repair"
```

### Task 4: Keep Publication Errors Visible and Retry Exact Selection

**Files:**
- Modify: `apps/publisher/src/renderer/src/App.tsx`
- Modify: `apps/publisher/src/renderer/src/components/PublishReview.tsx`
- Modify: `apps/publisher/src/renderer/src/app.css`
- Modify: `apps/publisher/tests/unit/app-smoke.test.tsx`

- [ ] **Step 1: Write a failing visible-error test**

Render the app with a valid change review and a rejected start result:

```ts
api.publish.start.mockResolvedValue({
  ok: false,
  error: {
    code: "PUBLISH_BRANCH_REPAIR_REQUIRED",
    message: "本地 master 正在跟踪 origin/main；请确认安全切换到 main 后继续发布。",
  },
})
await user.click(screen.getByRole("button", { name: "检查并发布" }))
await user.click(await screen.findByRole("button", { name: "验证并发布" }))
expect(await screen.findByRole("alert")).toHaveTextContent("本地 master")
expect(screen.getByRole("button", { name: "安全切换到 main 并继续" })).toBeEnabled()
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
npm run test:run -- tests/unit/app-smoke.test.tsx
```

Expected: FAIL because the error is not rendered inside the dialog and there is no repair button.

- [ ] **Step 3: Add explicit submission state to the dialog**

Add props:

```ts
readonly submitError?: AppError
readonly onRepairAndPublish?: () => Promise<void>
```

Render below the change list:

```tsx
{submitError ? (
  <div className="review-state review-error publish-submit-error" role="alert">
    <strong>发布未开始</strong>
    <span>{submitError.message}</span>
    {submitError.code === "PUBLISH_BRANCH_REPAIR_REQUIRED" && onRepairAndPublish ? (
      <button
        type="button"
        className="primary-button"
        disabled={publishing}
        onClick={() => runSubmission(onRepairAndPublish)}
      >
        {publishing ? "正在安全切换…" : "安全切换到 main 并继续"}
      </button>
    ) : null}
  </div>
) : null}
```

Replace the `.catch(() => undefined)` path with a helper that keeps the dialog open and lets `App` set `submitError`. Reset the error when review data or selected IDs change.

- [ ] **Step 4: Add a failing exact-retry test**

```ts
api.publish.repairBranch.mockResolvedValue({
  ok: true,
  value: { branch: "main", upstream: "origin/main", head: "a".repeat(40) },
})
api.publish.start
  .mockResolvedValueOnce({ ok: false, error: repairRequired })
  .mockResolvedValueOnce({ ok: true, value: { operationId: "publish-2" } })

await user.click(screen.getByRole("button", { name: "安全切换到 main 并继续" }))
expect(api.publish.repairBranch).toHaveBeenCalledOnce()
expect(api.publish.start).toHaveBeenNthCalledWith(2, {
  changeGroupIds: ["note:daily", "attachment:daily"],
})
```

- [ ] **Step 5: Run the exact-retry test and verify RED**

Run the named test with:

```powershell
npm run test:run -- tests/unit/app-smoke.test.tsx -t "repairs master and retries the exact publication selection"
```

Expected: FAIL because the repair/retry flow is absent.

- [ ] **Step 6: Implement repair and retry in `App`**

Store `publishSubmitError` and the last selected request. Make `onPublish` return normally on a failed IPC result after setting the error, and close the dialog only after a successful start receipt. Implement:

```ts
const repairAndRetryPublish = async (): Promise<void> => {
  const request = pendingPublishRequest.current
  if (!request) return
  const repaired = await api.publish.repairBranch()
  if (!repaired.ok) {
    setPublishSubmitError(repaired.error)
    return
  }
  const retried = await api.publish.start(request)
  if (!retried.ok) {
    setPublishSubmitError(retried.error)
    return
  }
  setPublishSubmitError(undefined)
  setChangeReviewOpen(false)
}
```

Do not reconstruct IDs from labels or the refreshed filesystem. Retry the immutable request captured from the user's confirmation.

- [ ] **Step 7: Style and verify the renderer flow**

Use the existing `.review-error`, `.primary-button`, spacing, and responsive tokens. Add only:

```css
.publish-submit-error {
  align-items: flex-start;
}

.publish-submit-error .primary-button {
  align-self: flex-start;
}
```

Run:

```powershell
npm run test:run -- tests/unit/app-smoke.test.tsx tests/unit/ipc.test.ts
npm run typecheck
```

Expected: visible-error, repair, exact-retry, accessibility, and existing app tests pass.

- [ ] **Step 8: Commit the renderer repair flow**

```powershell
git add -- apps/publisher/src/renderer/src/App.tsx apps/publisher/src/renderer/src/components/PublishReview.tsx apps/publisher/src/renderer/src/app.css apps/publisher/tests/unit/app-smoke.test.tsx
git commit -m "fix(publisher): show and repair publication branch errors"
```

### Task 5: Prove the Full Electron Workflow

**Files:**
- Modify: `apps/publisher/tests/e2e/app.spec.ts`
- Modify: `apps/publisher/README.md`

- [ ] **Step 1: Write the failing Electron E2E**

Extend the Git fixture so its working branch is `master`, upstream is `origin/main`, and it contains an untracked public note plus attachment. The test must:

```ts
await page.getByRole("button", { name: "检查并发布" }).click()
await page.getByRole("button", { name: "验证并发布" }).click()
await expect(page.getByRole("alert")).toContainText("本地 master")
await page.getByRole("button", { name: "安全切换到 main 并继续" }).click()
await expect(page.getByRole("dialog", { name: "检查并发布" })).toHaveCount(0)
await expect.poll(() => gitOutput(garden.root, ["branch", "--show-current"])).toBe("main")
await expect.poll(() => gitOutput(garden.root, ["rev-parse", "@{upstream}"])).toBe("origin/main")
await expect.poll(() => gitOutput(garden.root, ["rev-parse", "origin/main"])).toBe(
  await gitOutput(garden.root, ["rev-parse", "HEAD"]),
)
expect(await readFile(privatePath)).toEqual(privateBefore)
expect(await exists(unrelatedPublicPath)).toBe(true)
```

The selected change groups must exclude the unrelated public path so it remains untracked after publication.

- [ ] **Step 2: Run the E2E and verify RED**

Run:

```powershell
npm run build
npx playwright test tests/e2e/app.spec.ts -g "repairs legacy master and publishes the exact selection" --workers=1
```

Expected: FAIL at the missing visible repair action.

- [ ] **Step 3: Add only the fixture support required by the test**

Use existing `git()` and temporary fixture helpers. Set up the legacy layout with fixed commands:

```ts
await git(root, ["branch", "-m", "master"])
await git(root, ["branch", "--set-upstream-to=origin/main", "master"])
```

Do not introduce a production-only test seam or disable packaged safety checks.

- [ ] **Step 4: Run E2E and verify GREEN**

Run:

```powershell
npm run build
npx playwright test tests/e2e/app.spec.ts -g "repairs legacy master and publishes the exact selection" --workers=1
```

Expected: `1 passed`; no Electron, preview, or helper process remains.

- [ ] **Step 5: Document the user workflow**

Add a README section stating:

```md
### 本地 master 与 GitHub main 不一致

如果本地博客仍使用 `master`，但它明确跟踪 `origin/main`，发布窗口会说明原因并提供“安全切换到 main 并继续”。软件只重命名本地分支并保留 `origin/main` 上游、当前提交和未提交文件。若本地已存在 `main`、上游不同、有暂存内容或 Git 操作正在进行，软件会拒绝自动修改并显示原因。
```

- [ ] **Step 6: Commit E2E and documentation**

```powershell
git add -- apps/publisher/tests/e2e/app.spec.ts apps/publisher/README.md
git commit -m "test(publisher): cover legacy branch publication repair"
```

### Task 6: Full Verification and Installed-App Smoke

**Files:**
- Verify: `apps/publisher/**`
- Artifact: `apps/publisher/release/Knowledge-Garden-Publisher-0.1.0-Setup.exe`

- [ ] **Step 1: Run source hygiene, typecheck, and all tests**

Run:

```powershell
git diff --check
npm --prefix apps/publisher run typecheck
npm --prefix apps/publisher run test:run -- --maxWorkers=2
```

Expected: no whitespace errors, 39 or more test files pass, and no unexpected failures.

- [ ] **Step 2: Build and run all Electron E2E tests**

Run:

```powershell
npm --prefix apps/publisher run build
npm --prefix apps/publisher run test:e2e
```

Expected: build succeeds; all E2E tests pass with no orphan processes.

- [ ] **Step 3: Package and hash the Windows installer**

Run:

```powershell
npm --prefix apps/publisher run package:win
Get-FileHash -Algorithm SHA256 'apps/publisher/release/Knowledge-Garden-Publisher-0.1.0-Setup.exe'
```

Expected: NSIS packaging succeeds and prints a stable SHA-256 for the exact installer.

- [ ] **Step 4: Install without interrupting an active session**

Confirm no `Knowledge Garden Publisher` process is running. Then run the installer with `/S`, wait for exit code `0`, and compare:

```powershell
Get-FileHash 'apps/publisher/release/win-unpacked/resources/app.asar' -Algorithm SHA256
Get-FileHash "$env:LOCALAPPDATA\Programs\Knowledge Garden Publisher\resources\app.asar" -Algorithm SHA256
```

Expected: hashes match exactly.

- [ ] **Step 5: Run an isolated installed-app smoke test**

Create an untracked temporary Playwright spec through `apply_patch`, seed a temporary packaged-app registry and a legacy `master` garden, then launch the installed executable with isolated `--user-data-dir`. Directly observe the visible branch alert and repair button, click it, and verify branch/upstream/HEAD and remote publication. Remove the temporary spec through `apply_patch` after the run.

Run:

```powershell
$env:GARDEN_PUBLISHER_PACKAGED_EXE = "$env:LOCALAPPDATA\Programs\Knowledge Garden Publisher\Knowledge Garden Publisher.exe"
npx --prefix apps/publisher playwright test tests/e2e/publish-branch-packaged.temp.spec.ts --workers=1
```

Expected: `1 passed`, application exits cleanly, and no temporary blog remains.

### Task 7: Repair and Publish the Real Garden Through the Updated App

**Files:**
- User content allowlist: `content/study/index.md`
- User content allowlist: `content/study/new-note.md`
- User attachment allowlist: `content/_assets/new-note/*.png`

- [ ] **Step 1: Re-check the real garden without mutation**

From `C:\Users\11546\Desktop\web`, record:

```powershell
git status --porcelain=v1 --branch
git branch --show-current
git rev-parse HEAD
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git show-ref --verify --quiet refs/heads/main
git show-ref --verify refs/remotes/origin/main
git diff --cached --quiet --exit-code
```

Expected: current branch `master`, upstream `origin/main`, no local `main`, no staged changes, and only the allowlisted public content is untracked. Stop if any other publishable path appears.

- [ ] **Step 2: Launch the installed app and inspect the review**

Use the existing registered real garden. Open **检查并发布** and verify every selected path is within:

```text
content/study/index.md
content/study/new-note.md
content/_assets/new-note/*.png
```

Unselect or stop if the review contains any other path. No private path may be selectable.

- [ ] **Step 3: Exercise the visible repair flow**

Select **验证并发布**, directly observe the `master` explanation, then select **安全切换到 main 并继续**. Wait for the application to report publication success or a concrete error. Do not use manual Git rename commands unless the product flow fails and a new diagnosis is completed.

- [ ] **Step 4: Verify Git and remote state**

Run:

```powershell
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
$local = (git rev-parse HEAD).Trim()
$remote = ((git ls-remote origin refs/heads/main) -split '\s+')[0]
if ($local -ne $remote) { throw 'Remote main does not match the verified local publication.' }
git status --short
```

Expected: branch `main`, upstream `origin/main`, remote equals local, allowlisted published files are tracked, and no unrelated file was committed.

- [ ] **Step 5: Verify deployment and live route**

Poll the public GitHub Actions API for the run whose `head_sha` equals the publication commit:

```powershell
$sha = (git rev-parse HEAD).Trim()
$runs = Invoke-RestMethod -Headers @{ 'User-Agent'='Knowledge-Garden-Publisher-Verification' } -Uri 'https://api.github.com/repos/jin07-72/knowledge-garden/actions/runs?branch=main&per_page=20'
$run = $runs.workflow_runs | Where-Object { $_.head_sha -eq $sha } | Select-Object -First 1
if (-not $run -or $run.status -ne 'completed' -or $run.conclusion -ne 'success') { throw 'Matching deployment has not succeeded.' }
```

Then request the live route and verify HTTP success plus the title `大物`:

```powershell
$page = Invoke-WebRequest -UseBasicParsing 'https://jin07-72.github.io/knowledge-garden/study/new-note'
if ($page.StatusCode -ne 200 -or $page.Content -notmatch '大物') { throw 'The published note is not visible yet.' }
```

Expected: matching workflow run succeeds and the public page contains the published title.

- [ ] **Step 6: Commit any verification-only correction, then report exact evidence**

If verification exposed a product bug, return to a failing automated test before changing code. Otherwise confirm the feature branch is clean:

```powershell
git -C 'C:\Users\11546\Desktop\web\.worktrees\publisher-main-branch-repair' status --short
```

Report the Publisher commit, installer SHA-256, real publication commit, deployment URL, live note URL, and exactly which UI states were directly observed.
