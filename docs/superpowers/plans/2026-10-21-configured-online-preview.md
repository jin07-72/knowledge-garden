# Configured Online Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the active blog's configured website in “线上公开站” and release the integrated publisher fixes as version 0.1.3.

**Architecture:** `App` derives the active blog's already-normalized website URL from `BlogRegistryView` and passes it to `PreviewPane`. `PreviewPane` owns cache-busting and the unconfigured state; the existing main-process cache-clearing IPC remains unchanged. The renderer CSP permits validated HTTP(S) frame targets while preserving the existing local preview allowance.

**Tech Stack:** Electron 44, React 19, TypeScript, Vitest, Testing Library, electron-vite, electron-builder.

---

### Task 1: Drive the URL behavior with renderer tests

**Files:**
- Modify: `apps/publisher/tests/unit/renderer-security.test.tsx`
- Modify: `apps/publisher/tests/unit/main-layout.test.tsx`

- [ ] **Step 1: Write the failing configured-URL test**

Render `PreviewPane` with `publicWebsiteUrl="https://notes.example.net/garden/"`, open “线上公开站”, and assert the iframe URL starts with that address and contains a `refresh` query parameter.

- [ ] **Step 2: Write the failing unconfigured-state test**

Render `PreviewPane` without `publicWebsiteUrl`, open “线上公开站”, and assert that “请在管理博客中配置网站地址” is visible and no online-site iframe exists.

- [ ] **Step 3: Write the failing active-blog integration test**

Configure the `main-layout` registry fixture with a non-GitHub manual website, render `App`, open “线上公开站”, and assert `App` passes that website through to the iframe.

- [ ] **Step 4: Run tests and verify RED**

Run: `npm --prefix apps/publisher run test:run -- tests/unit/renderer-security.test.tsx tests/unit/main-layout.test.tsx`

Expected: FAIL because `PreviewPane` has no `publicWebsiteUrl` property and still uses the hard-coded address.

### Task 2: Use the active blog website

**Files:**
- Modify: `apps/publisher/src/renderer/src/App.tsx`
- Modify: `apps/publisher/src/renderer/src/components/PreviewPane.tsx`
- Modify: `apps/publisher/src/renderer/index.html`

- [ ] **Step 1: Derive the website in App**

Find `registry.blogs.find((blog) => blog.id === registry.activeBlogId)` and pass `website.url` only when the resolved website union contains a URL.

- [ ] **Step 2: Replace the hard-coded preview address**

Add `publicWebsiteUrl?: string` to `PreviewPaneProps`. Build the cache-busted iframe URL with `new URL(publicWebsiteUrl)`, preserving any existing query parameters and setting `refresh` to the current refresh token.

- [ ] **Step 3: Render a safe unconfigured state**

When no valid public website URL is present, render guidance to configure it in “管理博客” and omit the iframe and refresh action.

- [ ] **Step 4: Generalize the frame CSP**

Change the static `frame-src` restriction from the single GitHub Pages host to HTTP(S) schemes plus the existing `http://127.0.0.1:*` preview source. Keep scripts, objects, forms, and base URI restrictions unchanged.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm --prefix apps/publisher run test:run -- tests/unit/renderer-security.test.tsx tests/unit/main-layout.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the behavior**

Commit message: `fix(publisher): use configured online preview address`

### Task 3: Release regression verification

**Files:**
- Modify: `apps/publisher/package.json`
- Modify: `apps/publisher/package-lock.json`

- [ ] **Step 1: Increment version to 0.1.3**

Update both publisher package manifests without adding or removing dependencies.

- [ ] **Step 2: Run focused regression tests**

Run the renderer tests plus visibility transaction and publication integration tests to confirm the public/private workflow is unchanged.

- [ ] **Step 3: Run type checking and production build**

Run `npm --prefix apps/publisher run typecheck` and `npm --prefix apps/publisher run build`.

- [ ] **Step 4: Build the Windows package**

Run `npm --prefix apps/publisher run package:win` and verify the 0.1.3 setup artifact and unpacked executable exist.

- [ ] **Step 5: Commit the release metadata**

Commit message: `chore(publisher): release 0.1.3`

### Task 4: Integrate, push, and update the installed app

**Files:**
- Preserve: `apps/publisher/package.json` user dependency edit
- Preserve: `apps/publisher/package-lock.json` user dependency edit
- Preserve: `.tmp-render-check.png`

- [ ] **Step 1: Merge the verified branch into local main**

Temporarily preserve the user's unrelated package-manifest changes, merge the feature commits, then restore those changes on top of version 0.1.3.

- [ ] **Step 2: Push both project remotes**

Push `main` to `origin/main` and `publisher/main` without force.

- [ ] **Step 3: Update the formal installation**

Stop running publisher processes, copy the verified unpacked 0.1.3 application into `C:\Users\11546\AppData\Local\Programs\Knowledge Garden Publisher`, and preserve the existing shortcut target.

- [ ] **Step 4: Verify installed version and launch**

Confirm the installed executable and packaged artifact hashes match, launch the formal app, and verify its bundled `package.json` reports version 0.1.3.

- [ ] **Step 5: Confirm final repository state**

Verify local `main`, `origin/main`, and `publisher/main` point to the intended commit while the user's three unrelated working-tree changes remain present.
