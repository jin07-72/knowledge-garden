# Configured Online Preview Design

## Goal

Make the publisher's “线上公开站” preview use the active blog's configured public website instead of a hard-coded GitHub Pages URL, without changing any public/private note transaction behavior.

## Address source

The renderer already receives `BlogRegistryView`, whose active `BlogDisplayRecord.website` is resolved by the main process. Resolution keeps the existing priority:

1. A manually configured website URL.
2. `configuration.baseUrl` from the active blog's `quartz.config.yaml`.
3. Unconfigured when neither source yields a valid public HTTP(S) URL.

The preview must consume this resolved value rather than parsing configuration or inferring a URL from a Git remote.

## UI behavior

- When the active blog has a website URL, the online iframe loads that URL with the existing cache-busting query parameter.
- Entering the online tab and pressing “刷新线上站” keep clearing the Electron HTTP cache before remounting the iframe.
- When no website URL is configured, the iframe is not rendered. The panel explains that the address must be configured in “管理博客”.
- Switching the active blog immediately changes the preview target to that blog's resolved website.

## Boundaries

- Do not change visibility transactions, WikiLink cleanup, note movement, publication selection, or private-preview behavior.
- Do not infer GitHub Pages, GitLab Pages, or any other hosting URL from repository metadata.
- Do not add a second website-address store or a new IPC channel.

## Testing

- Add a renderer test proving a configured non-GitHub URL is used.
- Add a renderer test proving the unconfigured state shows guidance and no iframe.
- Retain tests for cache clearing, cache-busting refreshes, visibility selection, publication status, and public/private round trips.
- Run focused tests, type checking, production build, package creation, and relevant visibility regression tests before release.

## Release

- Increment the publisher patch version to `0.1.3`.
- Push the integrated `main` branch to the configured project remotes.
- Replace the installed formal application with the verified packaged build while preserving the user's unrelated working-tree files.
