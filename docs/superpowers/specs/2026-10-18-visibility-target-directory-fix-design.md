# Visibility Target Directory Fix Design

## Problem

Changing `content/reading/active-recall.md` from public to private plans the target
`private/reading/active-recall.md`. The transaction currently assumes
`private/reading` already exists. When it does not, `publishExclusive` calls
`ensureSafeDirectory`, `lstat` raises `ENOENT`, and the transaction returns the
generic `TRANSACTION_FAILED` message before changing note data.

The transaction rollback is safe, but users cannot change visibility for a
domain that exists only on the source visibility side.

## Approaches Considered

1. **Create the exact missing target domain directory on demand (selected).**
   Validate the target root first, create only its immediate domain child, and
   revalidate the resulting directory before publishing. This fixes existing
   blogs without creating unrelated directories.
2. **Mirror every domain under both `content` and `private`.**
   This simplifies later moves but creates unnecessary empty directories and
   requires migration or startup maintenance.
3. **Require users to create the directory manually.**
   This avoids code changes but exposes filesystem details and leaves the
   misleading error in place.

## Design

Before publishing the target note, the transaction derives the target root and
domain from the already validated note path. It verifies that the target root
is a real directory inside the canonical workspace. It then creates the exact
target domain directory with restrictive permissions if absent.

Creation is idempotent for an existing real directory. A file, symbolic link,
junction, path escape, or unexpected filesystem failure remains an error. The
directory is revalidated after creation so the existing safety boundary is not
weakened.

The helper is safe for either visibility root, but the missing-directory case is
reachable only for public-to-private moves: domain identity is defined by
`content/<domain>/index.md`, so a valid private-to-public plan already has an
existing public domain directory. Rename transactions remain unchanged because
they stay in the same visibility and domain.

## Failure Handling

Expected target-directory preparation failures become a structured transaction
error with the affected path instead of the generic English fallback. No note
file is modified before this check completes, so the existing transaction
journal can still terminate as safely rolled back.

## Tests

Add integration coverage that starts with only the source-side domain directory
and verifies:

- public-to-private visibility creates the missing private domain directory and
  moves the note successfully;
- an existing real private domain directory continues to work unchanged;
- a non-directory or symbolic-link target-domain path is rejected without
  modifying the source note.

Run the focused transaction suite first, then type checking and the complete
Publisher test suite.
