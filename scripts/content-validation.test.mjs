import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { isPrivatePath, validateNote } from "./content-validation.mjs"

test("valid complete note returns []", () => {
  const source = `---
title: Reading note
date: 2026-09-16
description: A concise description.
tags:
  - reading
---

Note body.`

  assert.deepEqual(validateNote("content/reading/note.md", source), [])
})

test("a UTF-8 BOM before frontmatter is accepted", () => {
  const source = `\uFEFF---
title: Reading note
date: 2026-09-16
description: A concise description.
tags:
  - reading
---`

  assert.deepEqual(validateNote("content/reading/bom.md", source), [])
})

test("source without frontmatter reports a path-specific error", () => {
  assert.deepEqual(validateNote("content/reading/incomplete.md", "# Untitled"), [
    "content/reading/incomplete.md: missing frontmatter",
  ])
})

test("frontmatter after body text is not accepted", () => {
  const source = `Body text comes first.
---
title: Reading note
date: 2026-09-16
description: A concise description.
tags:
  - reading
---`

  assert.deepEqual(validateNote("content/reading/misplaced.md", source), [
    "content/reading/misplaced.md: missing frontmatter",
  ])
})

test("empty frontmatter reports each missing required field", () => {
  const source = `---
---

Empty metadata.`

  assert.deepEqual(validateNote("content/reading/empty.md", source), [
    "content/reading/empty.md: title must be non-empty",
    "content/reading/empty.md: date must be non-empty",
    "content/reading/empty.md: description must be non-empty",
    "content/reading/empty.md: tags must be a non-empty array",
  ])
})

test("tags as a scalar reports a path-specific error", () => {
  const source = `---
title: Reading note
date: 2026-09-16
description: A concise description.
tags: reading
---`

  assert.deepEqual(validateNote("content/reading/note.md", source), [
    "content/reading/note.md: tags must be a non-empty array",
  ])
})

test("invalid YAML reports a path-specific error", () => {
  const source = `---
title: [unclosed
---`

  const [error] = validateNote("content/reading/broken.md", source)
  assert.match(error, /^content\/reading\/broken\.md: invalid YAML frontmatter \(BAD_INDENT\)$/)
})

test("private paths are distinguished from published content", () => {
  assert.equal(isPrivatePath("private/unfinished.md"), true)
  assert.equal(isPrivatePath("content/reading/note.md"), false)
})

test("validate-content recursively reports Markdown validation failures", () => {
  const validatorScript = fileURLToPath(new URL("./validate-content.mjs", import.meta.url))
  const fixtureDirectory = new URL("./fixtures/content-validation-cli/", import.meta.url)
  const result = spawnSync(process.execPath, [validatorScript], {
    cwd: fileURLToPath(fixtureDirectory),
    encoding: "utf8",
    env: process.env,
    shell: false,
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /content\/root\.md: missing frontmatter/)
  assert.match(result.stderr, /content\/invalid\.md: date must be non-empty/)
  assert.match(result.stderr, /content\/invalid\.md: description must be non-empty/)
  assert.match(result.stderr, /content\/invalid\.md: tags must be a non-empty array/)
  assert.doesNotMatch(result.stderr, /ignored\.txt/)
  assert.equal(result.stdout, "")
})
