# Preview Explorer Base Path Design

## Problem

The Publisher starts Quartz with a random `--baseDir` so each local preview is served below a URL such as `/fca2.../`. Quartz strips that prefix before reading files, but `renderPage` currently writes an empty `data-basepath` whenever `--serve` is active. The Explorer plugin reads `document.body.dataset.basepath` when it creates folder links, so its links point to `/extracurricular/` (404) instead of `/fca2.../extracurricular/` (200).

## Approved behavior

- A Publisher preview started with `--serve --baseDir preview-id` writes `data-basepath="/preview-id"`.
- A normal Quartz preview started with `--serve` and no `baseDir` continues to write an empty base path.
- Production builds continue to derive the base path from `baseUrl`.
- The change does not edit Markdown, content, public/private state, or the configured online site address.

## Design

Add the already-supported CLI `baseDir` field to Quartz's TypeScript `Argv` interface. Centralize the body base-path calculation in a small exported helper in `renderPage.tsx`: serve mode uses the normalized CLI `baseDir`; production mode keeps the existing `baseUrl` behavior. The rendered `<body>` continues to expose the result through `data-basepath`, so Explorer and any other JavaScript components use one correct source of truth without patching third-party package files.

## Verification

1. Unit tests cover prefixed serve mode, ordinary serve mode, and production mode.
2. Quartz type checking and formatting pass.
3. A local preview launched with a base directory renders the expected body attribute and both the prefixed page URL and Explorer click work.
4. The Publisher is rebuilt, packaged, installed, and checked without interrupting the user's currently running instance until the final update step.
