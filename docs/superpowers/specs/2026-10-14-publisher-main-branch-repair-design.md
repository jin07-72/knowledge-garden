# Publisher Main Branch Repair Design

**Date:** 2026-10-14

## Goal

Make publication failures visible inside the publish-review dialog and let a user explicitly repair the one legacy branch layout the application can migrate without guessing: a local `master` branch whose upstream is `origin/main`. After the user confirms, the application renames the local branch to `main`, preserves its commit and working tree, keeps tracking `origin/main`, and retries the exact publication selection.

The first use of this feature will repair the current Knowledge Garden checkout and publish the selected public note plus its selected attachments. The repair must not add private content or unrelated unselected changes.

## Existing Failure

The publisher requires the current branch to be named `main`. The current garden is on local `master` while tracking remote `origin/main`. `Publisher.publish()` correctly returns `BRANCH_UNSAFE`, but `PublishReview` catches and discards the rejected promise. `App` updates only the footer summary, so the open dialog shows no explanation and appears to do nothing.

## User Experience

The existing two-step workflow remains:

1. The user selects **检查并发布**.
2. The review dialog lists the selected public changes.
3. The user selects **验证并发布**.

If publication fails, the dialog remains open and displays the structured error as an accessible `role="alert"`. Ordinary errors offer retry without changing Git state.

For the specifically eligible legacy branch state, the alert explains that the local branch is `master` while GitHub uses `main` and offers a primary action named **安全切换到 main 并继续**. The button is shown only after the main process has classified the checkout as safely repairable. Clicking it is the user's confirmation to rename the branch and retry the same selected change-group IDs. The button is disabled while the repair or retry is active, and repeated clicks share the same in-flight operation.

On success, the dialog closes through the existing successful-publication flow. On failure, it stays open and shows the new error. The footer status mirrors the same message but is not the only visible error surface.

## Main-Process Contract

Add a narrow publication branch-repair operation rather than a general Git command API. Its result is returned through the existing validated IPC result envelope.

The operation reports one of these states:

- `repairable`: all safety checks passed and the user may confirm repair;
- `not-needed`: the current branch is already `main`;
- `blocked`: repair is unsafe, with a user-facing reason and a stable error code;
- `repaired`: the local branch is now `main`, its upstream is `origin/main`, and its HEAD is unchanged.

The renderer never sends branch names, remote names, refs, paths, or arbitrary Git arguments. The main process owns the fixed migration from `master` to `main`.

## Safety Preconditions

Immediately before mutation, the main process rechecks all conditions:

- the workspace is the configured garden Git root;
- `HEAD` is attached to local branch `master`;
- `master` resolves to the captured HEAD commit;
- `master` has the exact upstream `origin/main`;
- `refs/remotes/origin/main` exists;
- no local `main` branch exists, even if it points at the same commit;
- no merge, rebase, cherry-pick, revert, or bisect operation is in progress;
- the real Git index contains no staged changes;
- no publication or other branch repair is active.

Untracked and unstaged files are allowed because renaming a branch does not change their bytes, and those files are the content the user intends to publish. The service snapshots the current HEAD, upstream, status porcelain bytes, and selected publication IDs before mutation.

## Repair Algorithm and Rollback

The trusted bounded command runner executes fixed argument arrays with `shell: false`:

1. Re-run the safety preconditions.
2. Run `git branch -m master main`.
3. Run `git branch --set-upstream-to=origin/main main`.
4. Verify the current branch is `main`.
5. Verify `HEAD` is byte-for-byte the captured commit hash.
6. Verify the upstream is exactly `origin/main`.
7. Verify the status porcelain bytes are unchanged except for branch-header naming.

If any post-rename step fails, attempt a bounded rollback:

1. rename `main` back to `master`;
2. restore upstream `origin/main` on `master`;
3. verify the original branch, upstream, HEAD, and file-status bytes.

If rollback cannot be confirmed, return a distinct recovery-required error and block further publication in that process. Never force-delete, reset, checkout files, clean untracked files, or rewrite commits.

After a confirmed repair, the renderer invokes the ordinary publication endpoint again with the exact change-group IDs selected before repair. Publication still performs its own fetch, ancestry, isolated verification, commit, push, and remote-confirmation checks.

## Error Model

`BRANCH_UNSAFE` gains structured repair metadata only when the trusted inspection says the exact legacy migration is eligible. All other branch layouts remain blocked and display a specific explanation, including:

- local `main` already exists;
- `master` does not track `origin/main`;
- a Git operation is in progress;
- staged changes exist;
- the remote-tracking ref is missing;
- branch or HEAD changed during confirmation;
- repair failed and rollback succeeded;
- repair failed and rollback could not be confirmed.

Renderer code must display submission errors within `PublishReview`; it must not convert structured repair eligibility into free-form string matching.

## Concurrency

Publication and branch repair share a single main-process coordination boundary. A repair is rejected while publishing, and publishing is rejected while repair is active. Closing the dialog does not interrupt a branch rename after mutation begins; the bounded operation completes or rolls back before returning. The subsequent publication retry can be cancelled through the existing publication cancellation path.

## Tests

Follow test-driven development with a failing test before each production change.

Main-process integration tests use real temporary repositories to prove:

- eligible `master` is renamed to `main`, retains the same HEAD and file bytes, and tracks `origin/main`;
- untracked public notes and attachments survive unchanged;
- an existing local `main` blocks repair;
- a different or missing upstream blocks repair;
- staged changes and in-progress Git operations block repair;
- a branch or HEAD race blocks mutation;
- a failure after rename rolls back to the original verified state;
- an unconfirmed rollback blocks later publication;
- concurrent repair attempts and publish/repair overlap are rejected.

Renderer tests prove:

- a publication rejection is visible in the open dialog;
- repair controls appear only from structured eligibility metadata;
- confirmation calls the narrow repair API once;
- successful repair retries the exact selected groups;
- failed repair remains visible and does not retry publication;
- controls expose accessible names, alert semantics, and busy state.

Electron E2E uses a temporary garden whose local branch is `master` and upstream is `origin/main`. It opens the review, attempts publication, observes the branch explanation, confirms repair, and verifies the note and attachments reach the temporary remote `main` while unrelated changes remain local.

## Delivery and Current Garden

After all focused and full suites pass:

1. build and package the Windows application;
2. update the installed application through the established silent installer flow;
3. run an isolated installed-app smoke test for the visible error and repair action;
4. use the same precondition checks on the real garden;
5. rename its local `master` to `main` while preserving `origin/main` tracking;
6. publish only the user-confirmed public change groups;
7. verify the remote commit, GitHub Actions deployment result, and live route.

The real-garden step must stop without mutation if its state differs from the diagnosed state or if unrelated selected publication groups cannot be excluded.
