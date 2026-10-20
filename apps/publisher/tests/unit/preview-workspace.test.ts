import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
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

  it("retries real workspace disposal after a temporary removal failure", async () => {
    const root = await fixture()
    const removeRoot = vi
      .fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockImplementationOnce((path) => rm(path, { recursive: true, force: true }))
    const preview = await createPreviewWorkspace(root, { removeRoot })

    await expect(preview.dispose()).rejects.toThrow("busy")
    await expect(stat(preview.root)).resolves.toBeDefined()
    await expect(preview.dispose()).resolves.toBeUndefined()
    await expect(stat(preview.root)).rejects.toMatchObject({ code: "ENOENT" })
    expect(removeRoot).toHaveBeenCalledTimes(2)
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
    await writeFile(join(root, "content", "life", "secret.md"), "public-version")
    await expect
      .poll(() => readFile(join(preview.contentDirectory, "life", "secret.md"), "utf8"))
      .toBe("public-version")
    await rename(
      join(root, "content", "life", "secret.md"),
      join(root, "private", "life", "secret.md"),
    )
    await writeFile(join(root, "private", "life", "secret.md"), "private-version")
    await expect
      .poll(() => readFile(join(preview.contentDirectory, "life", "secret.md"), "utf8"))
      .toBe("private-version")

    const temporaryRoot = preview.root
    await preview.dispose()
    disposers.pop()
    await expect(stat(temporaryRoot)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
