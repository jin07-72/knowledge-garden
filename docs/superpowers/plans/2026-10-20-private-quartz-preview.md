# Private Quartz Preview Implementation Plan

1. Add tests for an isolated merged public/private input tree, duplicate rejection, live mirroring,
   and cleanup.
2. Add the preview workspace service and integrate its input/output paths with PreviewManager.
3. Add a real Quartz build test proving public and private routes are emitted from the merged tree.
4. Change current-note preview to the exact Quartz route for public and private notes; keep the
   privacy warning and explicitly label the sanitized fallback.
5. Prevent stale preview frames during error/stopped states and update renderer regressions.
6. Run the complete publisher test suite, typecheck, production build, package, install, and verify
   the installed executable before pushing both remotes.
