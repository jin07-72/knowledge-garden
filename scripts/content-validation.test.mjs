import assert from "node:assert/strict"
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

  assert.deepEqual(validateNote("content/reading/broken.md", source), [
    "content/reading/broken.md: invalid YAML frontmatter",
  ])
})

test("private paths are distinguished from published content", () => {
  assert.equal(isPrivatePath("private/unfinished.md"), true)
  assert.equal(isPrivatePath("content/reading/note.md"), false)
})
