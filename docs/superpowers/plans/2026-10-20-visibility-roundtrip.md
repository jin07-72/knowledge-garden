# Visibility round-trip implementation plan

> Update 2026-10-20: the product requirement now includes automatic cleanup of public inbound WikiLinks when a note becomes private. The current design is in `docs/superpowers/specs/2026-10-20-visibility-roundtrip-design.md`; steps below that say inbound Markdown must remain unchanged are historical.

1. Add failing transaction tests for target deletion/replacement races, unchanged inbound Markdown, and private-file persistence through publication. Remove tests that require inbound-link mutation.
2. Simplify visibility plans to move only the note and owned attachments. Revalidate the target identity/hash before source removal and before success.
3. Add failing renderer tests proving public and private notes use the same current-buffer preview, including empty Markdown and live edits. Replace split preview behavior with a unified local note renderer.
4. Add failing UI tests proving visibility changes never invoke publication automatically and always refresh the pending change review.
5. Run focused suites, then all publisher tests, typecheck, build, and site verification. Review the diff for private-data leakage and unrelated DeepSeek changes.
6. Package/install the repaired publisher only after verification, then publish the software repository changes separately from public blog content.
