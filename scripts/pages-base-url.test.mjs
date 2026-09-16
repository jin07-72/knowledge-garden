import assert from "node:assert/strict"
import test from "node:test"

import { parse } from "yaml"

import { updatePagesBaseUrl } from "./configure-pages-base-url.mjs"
import { pagesBaseUrl } from "./pages-base-url.mjs"

test("derives a project Pages URL from owner/repository", () => {
  assert.equal(pagesBaseUrl("octocat/knowledge-garden"), "octocat.github.io/knowledge-garden")
})

test("omits the repository path for the owner's Pages repository", () => {
  assert.equal(pagesBaseUrl("octocat/octocat.github.io"), "octocat.github.io")
  assert.equal(pagesBaseUrl("OctoCat/OCTOCAT.GITHUB.IO"), "OctoCat.github.io")
})

test("rejects malformed repository slugs", () => {
  const invalidSlugs = [
    "missing-separator",
    "octocat/knowledge-garden/extra",
    "/knowledge-garden",
    "octocat/",
    "   /knowledge-garden",
    "octocat/   ",
    "   /   ",
    " octocat/knowledge-garden",
    "octocat/knowledge-garden ",
  ]

  for (const repositorySlug of invalidSlugs) {
    assert.throws(() => pagesBaseUrl(repositorySlug), {
      message: "GITHUB_REPOSITORY must use owner/repository format",
    })
  }
})

test("updates only baseUrl while preserving YAML comments", () => {
  const source = `# yaml-language-server: $schema=./quartz/plugins/quartz-plugins.schema.json
configuration:
  # Keep this title comment.
  pageTitle: Knowledge Garden
  baseUrl: localhost:8080
plugins:
  # Keep this plugin comment.
  - source: example
`
  const expectedBaseUrl = "octocat.github.io/knowledge-garden"
  const updated = updatePagesBaseUrl(source, "octocat/knowledge-garden")

  const before = parse(source)
  const after = parse(updated)
  assert.deepEqual(after, {
    ...before,
    configuration: { ...before.configuration, baseUrl: expectedBaseUrl },
  })
  assert.ok(
    updated.includes("# yaml-language-server: $schema=./quartz/plugins/quartz-plugins.schema.json"),
  )
  assert.ok(updated.includes("# Keep this title comment."))
  assert.ok(updated.includes("# Keep this plugin comment."))
})
