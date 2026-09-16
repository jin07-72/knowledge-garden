import assert from "node:assert/strict"
import test from "node:test"

import { pagesBaseUrl } from "./pages-base-url.mjs"

test("derives a project Pages URL from owner/repository", () => {
  assert.equal(pagesBaseUrl("octocat/knowledge-garden"), "octocat.github.io/knowledge-garden")
})

test("omits the repository path for the owner's Pages repository", () => {
  assert.equal(pagesBaseUrl("octocat/octocat.github.io"), "octocat.github.io")
  assert.equal(pagesBaseUrl("OctoCat/OCTOCAT.GITHUB.IO"), "OctoCat.github.io")
})

test("rejects repository slugs without exactly one separator", () => {
  assert.throws(() => pagesBaseUrl("missing-separator"), /owner\/repository/)
  assert.throws(() => pagesBaseUrl("octocat/knowledge-garden/extra"), /owner\/repository/)
})
