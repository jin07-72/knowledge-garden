# Private Quartz Preview Design

## Goal

Public and private notes remain in their normal repository folders. Local preview renders both
through the real Quartz site, while publication continues to contain public content only.

## Design

The publisher creates a randomly named directory under the operating-system temporary folder.
Its `content` tree is a regular-file snapshot of `content/` plus `private/`, mapped by relative
path, and its `site` directory is the Quartz output. Quartz receives both paths explicitly through
`--directory` and `--output`; the repository `public/` directory is never used by local preview.

A watcher observes both source roots. Events are debounced and reconciled from final filesystem
state, which makes a visibility move at the same logical path an overwrite rather than a transient
deletion. Duplicate logical paths and links are rejected. On a confirmed preview stop, the watcher
closes before the owned temporary directory is removed.

The current-note tab loads `/domain/slug` from the same loopback Quartz server as the full-site
tab. Both visibility classes therefore use the site's actual layout, plugins, links, and assets.
When Quartz is unavailable, the existing sanitized Markdown renderer remains available only as an
explicitly labelled fallback. Error states never display a stale Quartz iframe.

## Privacy boundary

The merged tree exists outside the repository, is served only by the loopback preview process, and
is deleted after shutdown. Publishing still rejects `private/**`; publisher-owned state and preview
paths are also reserved from publication.
