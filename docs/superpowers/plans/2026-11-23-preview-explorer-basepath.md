# Preview Explorer Base Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local Publisher Explorer links retain the random preview URL prefix while preserving ordinary local and production Quartz behavior.

**Architecture:** Extend the existing Quartz build argument type with `baseDir`, then calculate the body `data-basepath` from that argument in serve mode. Keep the third-party Explorer package unchanged because it already consumes `data-basepath` correctly.

**Tech Stack:** TypeScript, Preact server rendering, Quartz CLI, Node test runner, Electron Publisher.

---

### Task 1: Specify base-path behavior with a failing unit test

**Files:**

- Modify: `quartz/components/renderPage.test.ts`

- [ ] **Step 1: Import the base-path resolver and add three cases**

Add tests asserting that serve mode with `baseDir: "/preview-id"` returns `/preview-id`, serve mode with an empty `baseDir` returns an empty string, and production with `baseUrl: "example.com/garden"` returns `/garden`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx --test quartz/components/renderPage.test.ts`

Expected: FAIL because `resolvePageBasePath` is not exported yet.

### Task 2: Pass the CLI base directory into rendered pages

**Files:**

- Modify: `quartz/util/ctx.ts`
- Modify: `quartz/components/renderPage.tsx`

- [ ] **Step 1: Type the existing CLI field**

Add `baseDir: string` to `Argv`, matching `quartz/cli/args.js` where the option already defaults to an empty string.

- [ ] **Step 2: Implement the minimal resolver**

Export `resolvePageBasePath(ctx, cfg)`. In serve mode return the normalized `ctx.argv.baseDir` (empty remains empty; a missing leading slash is added; trailing slashes are removed). Outside serve mode preserve the existing `baseUrl` pathname logic.

- [ ] **Step 3: Use the resolver for `<body data-basepath>`**

Replace the inline conditional in `renderPage` with the helper call.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx tsx --test quartz/components/renderPage.test.ts`

Expected: all tests pass.

### Task 3: Verify integration and package the fix

**Files:**

- Modify only if required by an exposed failure: Publisher tests or packaging metadata.

- [ ] **Step 1: Run static verification**

Run: `npm run check`

Expected: TypeScript and Prettier checks pass.

- [ ] **Step 2: Run the relevant Publisher preview tests**

Run the Publisher unit test command targeting `tests/unit/preview.test.ts` from `apps/publisher`.

Expected: preview tests pass and still include `--baseDir` in the Quartz command.

- [ ] **Step 3: Run a real prefixed Quartz preview**

Launch Quartz on unused ports with `--serve --baseDir preview-link-check`, request the generated home page, and assert its body contains `data-basepath="/preview-link-check"`. Request `/preview-link-check/extracurricular/` and verify HTTP 200.

- [ ] **Step 4: Build and package Publisher**

Use the existing Publisher build/package scripts and verify the generated installer exists.

- [ ] **Step 5: Update the installed app and perform final UI verification**

Install the new package, launch a single Publisher instance, click an Explorer domain in the actual preview, and verify the destination page appears without a 404.

- [ ] **Step 6: Commit and push the isolated fix**

Commit only the design, plan, tests, and implementation from this worktree, then integrate and push after all verification succeeds.
