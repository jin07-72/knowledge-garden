import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { checkBuiltLinks } from "./check-built-links.mjs"

async function withSite(files, run) {
  const root = await mkdtemp(join(tmpdir(), "check-built-links-"))

  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, content]) => {
        const filePath = join(root, relativePath)
        await mkdir(join(filePath, ".."), { recursive: true })
        await writeFile(filePath, content)
      }),
    )
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("accepts a clean URL with an existing anchor", async () => {
  await withSite(
    {
      "index.html": '<a href="./reading/#notes">Reading notes</a>',
      "reading/index.html": '<section id="notes">Notes</section>',
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), [])
    },
  )
})

test("reports a missing internal page with a portable source and href", async () => {
  await withSite({ "index.html": '<a href="./missing/">Missing</a>' }, async (root) => {
    assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./missing/"])
  })
})

test("reports an existing page whose requested fragment is absent", async () => {
  await withSite(
    {
      "index.html": '<a href="./reading/#missing-note">Reading notes</a>',
      "reading/index.html": '<section id="notes">Notes</section>',
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./reading/#missing-note"])
    },
  )
})

test("ignores external, contact, and static asset links", async () => {
  await withSite(
    {
      "index.html": `
        <a href="https://example.com/elsewhere">HTTPS</a>
        <a href="http://example.com/elsewhere">HTTP</a>
        <a href="mailto:hello@example.com">Email</a>
        <a href="tel:+10000000000">Phone</a>
        <a href="/assets/site.css">Styles</a>
        <a href="./images/photo.png">Image</a>
      `,
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), [])
    },
  )
})
