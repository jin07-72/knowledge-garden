# Visibility round-trip repair

## Goal

Changing a note between public and private must preserve the local note and its local editing/preview experience. Visibility only decides whether the note is included in the next verified public publication.

Public builds must remain link-valid when a note becomes private. The publisher therefore repairs public inbound WikiLinks as part of the privacy transaction instead of leaving them for the user to find after a failed site verification.

## Product semantics

- Public to private moves the note and owned attachments from the tracked public tree to the ignored private store. The note remains listed, editable, and previewable locally. The public deletion stays pending until the existing review-and-publish flow completes.
- During public to private, the transaction automatically removes public WikiLinks that target the note. Qualified links are always removed; unqualified links are removed when the slug is unambiguous. Links in private Markdown, code spans, and fenced or indented code blocks are untouched.
- Private to public performs the inverse move. The note remains listed, editable, and previewable locally. The public addition stays pending until explicitly published.
- A visibility transaction never starts publication implicitly. It edits only the public Markdown files whose inbound links must be repaired.
- "Current note" always renders the current local editor buffer for both visibilities. "Full local site" remains the Quartz iframe used for site-level verification, and "Public site" remains a separate destination.

## Safety boundaries

- Private bytes must never enter a Git tree, public build directory, log, or remote.
- The visibility transaction must verify the installed target immediately before removing the source and again before reporting success.
- On a failed postcondition, rollback must restore the source; an uncertain result must never be reported as success.
- Link edits are revision-checked, journaled, rolled back with the note move, and exposed in the transaction result so the UI can report how many pages were repaired.
- Publication stays explicit because a selected path can contain unrelated unpublished edits.
- Existing private storage remains ignored by Git; this repair guarantees transaction and publication persistence, not Git backup of secrets.

## Compatibility

- Keep the existing content/private path model and IPC shape where possible.
- Keep generated-site link validation strict.
- Automatic link repair is limited to public inbound WikiLinks affected by the privacy move. It does not rewrite private Markdown, prose, code samples, or unrelated links.
- The UI announces automatic cleanup after a successful privacy transaction so the Markdown edits are visible and reviewable before publication.
