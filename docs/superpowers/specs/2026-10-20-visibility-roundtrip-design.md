# Visibility round-trip repair

## Goal

Changing a note between public and private must preserve the local note and its local editing/preview experience. Visibility only decides whether the note is included in the next verified public publication.

## Product semantics

- Public to private moves the note and owned attachments from the tracked public tree to the ignored private store. The note remains listed, editable, and previewable locally. The public deletion stays pending until the existing review-and-publish flow completes.
- Private to public performs the inverse move. The note remains listed, editable, and previewable locally. The public addition stays pending until explicitly published.
- A visibility transaction never edits unrelated Markdown and never starts publication implicitly.
- "Current note" always renders the current local editor buffer for both visibilities. "Full local site" remains the Quartz iframe used for site-level verification, and "Public site" remains a separate destination.

## Safety boundaries

- Private bytes must never enter a Git tree, public build directory, log, or remote.
- The visibility transaction must verify the installed target immediately before removing the source and again before reporting success.
- On a failed postcondition, rollback must restore the source; an uncertain result must never be reported as success.
- Publication stays explicit because a selected path can contain unrelated unpublished edits.
- Existing private storage remains ignored by Git; this repair guarantees transaction and publication persistence, not Git backup of secrets.

## Compatibility

- Keep the existing content/private path model and IPC shape where possible.
- Remove DeepSeek's inbound-wikilink deletion and automatic-retirement publication behavior.
- Keep generated-site link validation strict. A domain landing page should not be hand-edited as a side effect of changing visibility; navigation should be derived from the public content set.
