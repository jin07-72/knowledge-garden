# Editable Domain Description and Tags Design

## Goal

Allow a user to edit a domain landing page's description and tags from Knowledge Garden Publisher. Both fields are optional. Saving domain metadata must not rename the domain, move files, modify notes, or alter public/private visibility behavior.

## User experience

- Each domain card in **管理领域** gains an **编辑信息** button alongside the existing rename and delete actions.
- **编辑领域信息** opens with the selected domain's current description and tags.
- The description is a multiline text field with a 2,000-character limit.
- Tags are entered as a comma-separated list. Chinese and English commas are accepted. Values are trimmed, empty entries are removed, and duplicates are removed while preserving first-occurrence order.
- Description and tags may both be empty. Helper text explicitly says they are optional.
- Saving returns to the domain list and immediately refreshes the application's domain state. The next local preview rebuild and publication use the updated landing page.
- Canceling or a failed save leaves the source file unchanged. Errors stay in the dialog so the user can retry.

## Data contract

`DomainSummary` gains `tags: readonly string[]`. Its `description` remains a string but may be empty.

Add a dedicated `DomainUpdateMetadataRequest`:

```ts
interface DomainUpdateMetadataRequest {
  readonly slug: DomainSlug
  readonly description: string
  readonly tags: readonly string[]
}
```

The domain API gains `updateMetadata(request)`, implemented as a new validated IPC channel. This is intentionally separate from `rename`: changing a title and changing descriptive metadata are independent operations and should not share UI state or transaction intent.

Validation rules:

- `description`: trim leading/trailing whitespace, maximum 2,000 characters, empty allowed.
- `tags`: at most 100 values; each trimmed value is 1-128 characters after empty entries are discarded; duplicates are removed before the request is sent and rejected if an untrusted IPC caller sends duplicates or untrimmed values.
- `slug`: the existing safe domain slug schema.

Domain discovery treats a missing or blank `description` as `""` and missing `tags` as `[]`. If either field is present with an incompatible YAML type, discovery fails closed with the existing `DOMAIN_METADATA_INVALID` behavior.

## Persistence and safety

The service updates only `content/<slug>/index.md`.

1. Canonically resolve the workspace, `content` root, domain directory, and landing page using the existing anti-symlink and file-identity checks.
2. Read and parse the current safe YAML frontmatter.
3. Revalidate that the page is still the same managed domain (`gardenDomain: true`, matching slug and unchanged file identity).
4. Preserve every unrelated frontmatter field, the Markdown body, newline style, and file encoding.
5. Set non-empty `description` and `tags`; remove those YAML keys when their normalized values are empty.
6. Write a same-directory temporary file, flush it, atomically replace the landing page, and retain rollback evidence until replacement is confirmed.
7. Re-discover domains and return the refreshed summaries.

The operation participates in the existing domain catalog serialization so create, rename, remove, and metadata updates cannot race. A concurrent external edit causes a safe failure rather than overwriting newer bytes.

No private directory, note file, attachment directory, Git branch, or publication visibility file is touched.

## UI integration

`DomainManager` adds an `edit-metadata` mode and an `onUpdateMetadata` callback. Description and tag controls have distinct labels, helper text, error association, keyboard focus, busy-state disabling, and cancel behavior consistent with the existing create/rename forms.

The domain list may show a concise description and tag chips so users can verify the saved values without opening the form. Empty metadata is shown as `未填写描述` and `无标签` inside the manager only; those placeholders are not written to Markdown.

`PublisherApp` routes the update through the existing `applyDomainMutation` path so returned summaries replace local state and dependent note/domain controls stay synchronized.

## Error handling

- Invalid UI input is rejected before IPC with a Chinese field-specific message.
- IPC schema errors remain generic and do not expose filesystem paths.
- Missing, replaced, linked, malformed, or concurrently changed landing pages fail closed through existing public domain error codes.
- Failed writes restore or retain the original page. The service never reports success until the replacement is durable and rediscovery succeeds.

## Testing

- Schema tests cover empty values, limits, trimming, tag normalization, and hostile IPC payloads.
- Domain-service tests cover reading empty/missing metadata, successful preservation of unrelated YAML/body/newlines, atomic failure rollback, external-change detection, symlink/path swaps, and serialization against other domain mutations.
- IPC/preload tests cover the new channel and public error mapping.
- `DomainManager` tests cover prefilled editing, comma normalization, empty save, cancel, busy state, error recovery, focus return, and accessible labels.
- Main-layout tests verify refreshed domain state and confirm no note mutation or visibility API is called.
- End-to-end coverage edits metadata, verifies `content/<slug>/index.md`, restarts the app, and confirms the new values persist.

## Non-goals

- Changing the English path.
- Editing domain order, landing-page body, dates, note metadata, or visibility.
- Automatically publishing after a save.
- Adding inline editing to the rendered Quartz page.
