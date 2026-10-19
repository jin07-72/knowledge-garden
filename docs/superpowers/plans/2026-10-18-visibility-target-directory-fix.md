# Visibility Target Directory Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a public note to become private when its private domain directory does not yet exist, without weakening transaction path safety.

**Architecture:** Add one transaction-local helper that prepares only the validated target note's immediate domain directory. The helper validates the managed root, creates the domain directory non-recursively and exclusively when absent, then validates the resulting entry before the existing exclusive note publication proceeds.

**Tech Stack:** TypeScript, Node.js filesystem promises, Vitest integration tests, Electron/Vite packaging

---

## File Structure

- Modify `apps/publisher/tests/integration/noteTransactions.test.ts`: reproduce the missing private-domain failure and verify unsafe target-domain entries remain blocked.
- Modify `apps/publisher/src/main/services/noteTransactions.ts`: prepare and validate the exact visibility target domain immediately before publication.

### Task 1: Reproduce the missing target-domain defect

**Files:**

- Test: `apps/publisher/tests/integration/noteTransactions.test.ts:136-300`

- [ ] **Step 1: Add a focused failing integration test**

Add this test beside the existing visibility-move cases:

```ts
it("creates a missing private domain directory before moving a public note", async () => {
  const workspace = await garden()
  const source = "content/reading/active-recall.md"
  const targetDirectory = join(workspace, "private", "reading")
  const target = join(targetDirectory, "active-recall.md")
  const markdown = "---\ntitle: Active recall\n---\n\nPractice retrieval.\n"
  await rm(targetDirectory, { recursive: true })
  await put(workspace, source, markdown)

  const plan = await planVisibilityChange({ workspace, path: source, visibility: "private" })
  const result = await executeVisibilityChange(plan, { workspace })

  expect(result.pendingPublicDeletion).toBe(source)
  expect(await readFile(target, "utf8")).toBe(markdown)
  expect(await exists(join(workspace, source))).toBe(false)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/integration/noteTransactions.test.ts -t "creates a missing private domain directory"
```

Expected: FAIL with `TRANSACTION_FAILED` / `The transaction failed before modifying note data.` because `private/reading` is absent.

- [ ] **Step 3: Commit the failing regression test**

```powershell
git add apps/publisher/tests/integration/noteTransactions.test.ts
git commit -m "test: reproduce missing visibility target directory"
```

### Task 2: Prepare the target domain safely

**Files:**

- Modify: `apps/publisher/src/main/services/noteTransactions.ts:408-524`
- Modify: `apps/publisher/src/main/services/noteTransactions.ts:3075-3115`
- Test: `apps/publisher/tests/integration/noteTransactions.test.ts:136-330`

- [ ] **Step 1: Add unsafe-entry coverage before production code**

Add a second test that replaces the missing target directory with a regular file:

```ts
it("rejects a target domain replaced by a file after planning without changing the source", async () => {
  const workspace = await garden()
  const source = "content/reading/active-recall.md"
  const targetDirectory = join(workspace, "private", "reading")
  const markdown = "---\ntitle: Active recall\n---\n\nPractice retrieval.\n"
  await rm(targetDirectory, { recursive: true })
  await put(workspace, source, markdown)
  const plan = await planVisibilityChange({ workspace, path: source, visibility: "private" })

  await expect(
    executeVisibilityChange(plan, {
      workspace,
      adapter: { beforePublish: () => writeFile(targetDirectory, "occupied") },
    }),
  ).rejects.toMatchObject({
    code: "TRANSACTION_PLAN_BLOCKED",
    details: { issue: "UNSAFE_TARGET", path: "private/reading" },
  })
  await expect(readFile(join(workspace, source), "utf8")).resolves.toBe(markdown)
})
```

Add the equivalent link-swap case using the test suite's existing cross-platform
directory-link pattern:

```ts
it("rejects a target domain replaced by a link after planning without changing the source", async () => {
  const workspace = await garden()
  const source = "content/reading/active-recall.md"
  const targetDirectory = join(workspace, "private", "reading")
  const linkedDirectory = join(workspace, "private", "linked-reading")
  const markdown = "---\ntitle: Active recall\n---\n\nPractice retrieval.\n"
  await rm(targetDirectory, { recursive: true })
  await mkdir(linkedDirectory)
  await put(workspace, source, markdown)
  const plan = await planVisibilityChange({ workspace, path: source, visibility: "private" })

  await expect(
    executeVisibilityChange(plan, {
      workspace,
      adapter: {
        beforePublish: () =>
          symlink(
            linkedDirectory,
            targetDirectory,
            process.platform === "win32" ? "junction" : "dir",
          ),
      },
    }),
  ).rejects.toMatchObject({
    code: "TRANSACTION_PLAN_BLOCKED",
    details: { issue: "UNSAFE_TARGET", path: "private/reading" },
  })
  await expect(readFile(join(workspace, source), "utf8")).resolves.toBe(markdown)
})
```

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/integration/noteTransactions.test.ts -t "visibility target domain"
```

Expected: all three new tests FAIL because target-domain preparation does not exist and the current fallback loses the affected path.

- [ ] **Step 2: Implement the minimal target-domain helper**

Add immediately after `ensureStateDirectories`:

```ts
async function ensureVisibilityTargetDomainDirectory(
  workspace: string,
  targetPath: string,
): Promise<void> {
  const target = parseNotePath(targetPath)
  const rootPath = target.root
  const domainPath = `${target.root}/${target.domain}`
  const root = absolutePath(workspace, rootPath)
  const directory = absolutePath(workspace, domainPath)

  try {
    await ensureSafeDirectory(root, workspace)
  } catch {
    throw transactionError("TRANSACTION_STALE", "The target visibility root is unavailable.", {
      path: rootPath,
    })
  }

  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw transactionError(
        "TRANSACTION_FAILED",
        "The target domain directory could not be created.",
        { path: domainPath },
      )
    }
  }

  try {
    await ensureSafeDirectory(directory, root)
  } catch {
    throw transactionError("TRANSACTION_PLAN_BLOCKED", "The target domain directory is unsafe.", {
      issue: "UNSAFE_TARGET",
      path: domainPath,
    })
  }
}
```

In `execute`, prepare the directory after domain revalidation and before exclusive publication:

```ts
await adapter.beforePublish?.(plan.target)
await revalidateDomains()
await ensureVisibilityTargetDomainDirectory(workspace, plan.target)
await revalidateDomains()
await publishExclusive(
```

The second revalidation ensures the domain catalog and managed roots still match after directory creation.

#### Final implementation note

The completed implementation uses two visibility-only checks and deliberately
leaves rename execution unchanged:

1. Immediately after `verifyPlan`, and before `captureNoteDomainSnapshot`,
   `validateVisibilityTargetDomainDirectory` safely validates the target root.
   It accepts an absent exact target domain without creating it and rejects an
   existing file, link, junction, escaped path, or other unsafe entry with
   `TRANSACTION_PLAN_BLOCKED` and `UNSAFE_TARGET` details.
2. After locks and journal setup, the publication order is
   `beforePublish` -> domain revalidation -> visibility-only target-domain
   creation/validation -> parent-root directory sync -> second domain
   revalidation -> `publishExclusive`. Creation is non-recursive. A parent sync
   failure prevents publication and source removal.
3. Both checks are guarded by `plan.kind === "visibility"`; cross-domain rename
   behavior remains supported and does not enter either path.

- [ ] **Step 3: Verify the focused tests are GREEN**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/integration/noteTransactions.test.ts -t "visibility target domain|creates a missing private domain directory"
```

Expected: all three new tests PASS.

- [ ] **Step 4: Verify the complete transaction suite**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/integration/noteTransactions.test.ts
```

Expected: all transaction integration tests PASS with zero failures.

- [ ] **Step 5: Commit the fix**

```powershell
git add apps/publisher/src/main/services/noteTransactions.ts apps/publisher/tests/integration/noteTransactions.test.ts
git commit -m "fix: create missing visibility target directory"
```

### Task 3: Full verification and delivery

**Files:**

- Verify only: `apps/publisher/**`

- [ ] **Step 1: Run static and full automated verification**

```powershell
git diff --check main...HEAD
npm --prefix apps/publisher run typecheck
npm --prefix apps/publisher run test:run -- --maxWorkers=2
npm --prefix apps/publisher run build
npm --prefix apps/publisher run test:e2e
```

Expected: type checking, 42+ test files, build, and all E2E tests pass with zero failures.

- [ ] **Step 2: Merge the verified branch into local `main`**

From `C:\Users\11546\Desktop\web`, preserve the user's unrelated `content/study/index.md` modification, then merge only if Git confirms it can do so without overwriting that file:

```powershell
git merge --no-ff codex/visibility-target-directory-fix
```

Expected: merge succeeds without touching `content/study/index.md`.

- [ ] **Step 3: Push the software repository explicitly**

```powershell
git push publisher main:main
```

Expected: `publisher/main` advances to the local `main` merge commit. Do not push software commits to `origin` (`knowledge-garden`).

- [ ] **Step 4: Package and install the Windows update**

```powershell
npm --prefix apps/publisher run package:win
Start-Process -FilePath "C:\Users\11546\Desktop\web\apps\publisher\release\Knowledge-Garden-Publisher-0.1.0-Setup.exe" -ArgumentList "/S" -WindowStyle Hidden -Wait
```

Expected: packaging and installer exit with code 0.

- [ ] **Step 5: Verify the installed artifact and remote commit**

Compare SHA-256 for:

```text
C:\Users\11546\Desktop\web\apps\publisher\release\win-unpacked\resources\app.asar
C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher\resources\app.asar
```

Also verify `git ls-remote publisher refs/heads/main` equals local `git rev-parse main`.

Expected: both app archive hashes match and remote/local commit hashes match.
