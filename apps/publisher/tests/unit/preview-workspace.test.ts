import { mkdtemp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createPreviewWorkspace } from "../../src/main/services/previewWorkspace"

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.allSettled(disposers.splice(0).map((dispose) => dispose()))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "garden-preview-test-"))
  await mkdir(join(root, "content", "technology"), { recursive: true })
  await mkdir(join(root, "private", "life"), { recursive: true })
  await writeFile(join(root, "content", "technology", "public.md"), "public")
  await writeFile(join(root, "private", "life", "secret.md"), "secret")
  return root
}

describe("preview workspace", () => {
  it("materializes public and private notes into one isolated Quartz content tree", async () => {
    const root = await fixture()
    const preview = await createPreviewWorkspace(root)
    disposers.push(preview.dispose)

    expect(await readFile(join(preview.contentDirectory, "technology", "public.md"), "utf8")).toBe(
      "public",
    )
    expect(await readFile(join(preview.contentDirectory, "life", "secret.md"), "utf8")).toBe(
      "secret",
    )
    expect(preview.contentDirectory.startsWith(root)).toBe(false)
    expect(preview.outputDirectory.startsWith(root)).toBe(false)
  })

  it("rejects duplicate logical paths instead of choosing public or private content", async () => {
    const root = await fixture()
    await mkdir(join(root, "private", "technology"), { recursive: true })
    await writeFile(join(root, "private", "technology", "public.md"), "private collision")

    await expect(createPreviewWorkspace(root)).rejects.toThrow(/duplicate/i)
  })

  it("mirrors edits and both visibility moves without changing note bytes", async () => {
    const root = await fixture()
    const preview = await createPreviewWorkspace(root, { debounceMs: 10 })
    disposers.push(preview.dispose)
    await writeFile(join(root, "private", "life", "secret.md"), "updated")

    await expect
      .poll(() => readFile(join(preview.contentDirectory, "life", "secret.md"), "utf8"))
      .toBe("updated")
    expect(await readFile(join(root, "private", "life", "secret.md"), "utf8")).toBe("updated")

    await mkdir(join(root, "content", "life"), { recursive: true })
    await rename(
      join(root, "private", "life", "secret.md"),
      join(root, "content", "life", "secret.md"),
    )
    await expect
      .poll(() => readFile(join(preview.contentDirectory, "life", "secret.md"), "utf8"))
      .toBe("updated")
    await rename(
      join(root, "content", "life", "secret.md"),
      join(root, "private", "life", "secret.md"),
    )
    await expect
      .poll(() => readFile(join(preview.contentDirectory, "life", "secret.md"), "utf8"))
      .toBe("updated")

    const temporaryRoot = preview.root
    await preview.dispose()
    disposers.pop()
    await expect(stat(temporaryRoot)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
