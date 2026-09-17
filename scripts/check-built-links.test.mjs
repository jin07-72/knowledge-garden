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

test("maps project Pages base-path links onto the artifact root", async () => {
  await withSite(
    {
      "404.html": `
        <a href="/knowledge-garden">Home</a>
        <a href="/knowledge-garden/guide/">Guide</a>
      `,
      "index.html": "Home",
      "guide/index.html": "Guide",
    },
    async (root) => {
      assert.deepEqual(
        await checkBuiltLinks(root, { baseUrl: "jin07-72.github.io/knowledge-garden" }),
        [],
      )
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

test("does not treat data attributes or comments as fragment targets", async () => {
  await withSite(
    {
      "index.html": '<a href="./reading/#ghost">Reading notes</a>',
      "reading/index.html": `
        <section data-id="ghost">Not an anchor</section>
        <!-- <section id="ghost">Not an anchor</section> -->
      `,
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./reading/#ghost"])
    },
  )
})

test("does not inspect data attributes or comments as links", async () => {
  await withSite(
    {
      "index.html": `
        <a data-href="./missing-data/">Data attribute</a>
        <!-- <a href="./missing-comment/">Commented link</a> -->
      `,
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), [])
    },
  )
})

test("validates dotted page slugs while ignoring dotted static references", async () => {
  await withSite(
    {
      "index.html": `
        <a href="./release-1.2/">Missing release</a>
        <a href="./release-1.2">Missing release without slash</a>
        <a href="./Node.js/#missing">Node.js</a>
        <a href="./Node.js#missing-no-slash">Node.js file-like slug</a>
        <link rel="stylesheet" href="./styles.v1.css">
        <script src="./script.v2.js"></script>
      `,
      "Node.js/index.html": '<section id="present">Node.js</section>',
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), [
        "index.html -> ./Node.js#missing-no-slash",
        "index.html -> ./Node.js/#missing",
        "index.html -> ./release-1.2",
        "index.html -> ./release-1.2/",
      ])
    },
  )
})

test("decodes HTML character references in hrefs and ids", async () => {
  await withSite(
    {
      "index.html": `
        <a href="./a&amp;b">Ampersand page</a>
        <a href="./reading/#a%26b">Ampersand anchor</a>
        <a href="./missing&amp;page/">Missing page</a>
      `,
      "a&b.html": "Ampersand page",
      "reading/index.html": '<section id="a&amp;b">Ampersand anchor</section>',
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./missing&amp;page/"])
    },
  )
})

test("parses hrefs when quoted attributes contain greater-than signs", async () => {
  await withSite(
    {
      "index.html": '<a title="1 > 0" href="./missing-page/">Missing page</a>',
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./missing-page/"])
    },
  )
})

test("does not treat id text inside another attribute as an anchor", async () => {
  await withSite(
    {
      "index.html": '<a href="./reading/#ghost">Reading notes</a>',
      "reading/index.html": `<section aria-label="prefix id='ghost'">Not an anchor</section>`,
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./reading/#ghost"])
    },
  )
})

test("does not scan script raw text for anchors or ids", async () => {
  await withSite(
    {
      "index.html": '<a href="./reading/#ghost">Reading notes</a>',
      "reading/index.html": "<script>const markup = '<section id=\"ghost\">'</script>",
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./reading/#ghost"])
    },
  )
})

test("accepts a self-anchor in a complete HTML document", async () => {
  await withSite(
    {
      "index.html": `<!doctype html>
        <html><head><title>Home</title></head>
        <body id="top"><a href="#top">Top</a></body></html>`,
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), [])
    },
  )
})

test("preserves an entity href after a boolean attribute", async () => {
  await withSite(
    {
      "index.html": '<a download href="./missing&amp;page/">Missing page</a>',
    },
    async (root) => {
      assert.deepEqual(await checkBuiltLinks(root), ["index.html -> ./missing&amp;page/"])
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
