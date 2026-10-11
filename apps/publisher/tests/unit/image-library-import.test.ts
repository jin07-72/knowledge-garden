import { mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AppError } from "../../src/shared/contracts"
import {
  createImageLibraryService,
  type ImageLibraryAdapter,
} from "../../src/main/services/imageLibrary"

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const THUMBNAIL = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`
const cleanups: string[] = []

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "publisher-image-import-")))
  cleanups.push(root)
  await mkdir(join(root, "content", "life"), { recursive: true })
  const note = join(root, "content", "life", "daily.md")
  await writeFile(note, "# unchanged\n")
  return { root, note, library: join(root, "content", "_assets", "daily") }
}

function adapter(paths: readonly string[] | undefined): ImageLibraryAdapter {
  return {
    chooseImages: async () => paths,
    renderThumbnail: async () => ({ width: 2, height: 3, dataUrl: THUMBNAIL }),
    readDimensions: async () => ({ width: 2, height: 3 }),
    writeClipboard: () => undefined,
    now: () => 1000,
  }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("image import transactions", () => {
  it("returns the exact cancellation shape without touching the filesystem", async () => {
    const fixture = await setup()
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter(undefined) })
    await expect(service.select({ path: "content/life/daily.md" })).resolves.toEqual({
      cancelled: true,
      images: [],
      conflicts: [],
    })
    await expect(readFile(fixture.note, "utf8")).resolves.toBe("# unchanged\n")
    await expect(readFile(join(fixture.library, ".gitkeep"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("selects safe metadata, reports ordered conflicts, and never exposes source paths", async () => {
    const fixture = await setup()
    const source = join(fixture.root, "photo.png")
    await writeFile(source, PNG)
    await mkdir(fixture.library, { recursive: true })
    await writeFile(join(fixture.library, "PHOTO.PNG"), PNG)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
    const selection = await service.select({ path: "content/life/daily.md" })
    expect(selection).toMatchObject({
      cancelled: false,
      images: [{ name: "photo.png", conflict: true, width: 2, height: 3 }],
      conflicts: ["photo.png"],
    })
    expect(JSON.stringify(selection)).not.toContain(fixture.root)
  })

  it("commits a batch, removes the marker, preserves note bytes, and consumes the token", async () => {
    const fixture = await setup()
    const source = join(fixture.root, "photo.png")
    await writeFile(source, PNG)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
    const before = await readFile(fixture.note)
    const selection = await service.select({ path: "content/life/daily.md" })
    if (selection.cancelled) throw new Error("unexpected cancellation")
    const view = await service.commit({
      path: "content/life/daily.md",
      selectionId: selection.selectionId,
      overwrite: [],
    })
    expect(view.images.map(({ name }) => name)).toEqual(["photo.png"])
    expect(await readFile(join(fixture.library, "photo.png"))).toEqual(Buffer.from(PNG))
    await expect(readFile(join(fixture.library, ".gitkeep"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(fixture.note)).toEqual(before)
    await expect(
      service.commit({ path: "content/life/daily.md", selectionId: selection.selectionId, overwrite: [] }),
    ).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" } satisfies Partial<AppError>)
  })

  it("dispose waits for a selection already in flight, then clears its token", async () => {
    const fixture = await setup()
    const source = join(fixture.root, "photo.png")
    await writeFile(source, PNG)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const configured = adapter([source])
    configured.chooseImages = async () => { await gate; return [source] }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selecting = service.select({ path: "content/life/daily.md" })
    const disposing = service.dispose()
    release()
    const selection = await selecting
    expect(selection.cancelled).toBe(false)
    await disposing
    if (selection.cancelled) throw new Error("unexpected cancellation")
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selection.selectionId, overwrite: [] }))
      .rejects.toMatchObject({ code: "IMAGE_LIBRARY_FAILED" })
  })

  it("never follows a linked staging root", async ({ skip }) => {
    const fixture = await setup()
    const outside = await realpath(await mkdtemp(join(tmpdir(), "publisher-import-outside-")))
    cleanups.push(outside)
    const source = join(fixture.root, "photo.png")
    await writeFile(source, PNG)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
    const selection = await service.select({ path: "content/life/daily.md" })
    if (selection.cancelled) throw new Error("unexpected cancellation")
    try { await symlink(outside, join(fixture.root, ".garden-publisher", "image-import"), process.platform === "win32" ? "junction" : "dir") }
    catch (error) { if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) skip(); throw error }
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selection.selectionId, overwrite: [] }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^IMAGE_LIBRARY_/) })
    expect(await readdir(outside)).toEqual([])
  })
})
