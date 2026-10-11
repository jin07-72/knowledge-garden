import { createHash, randomUUID } from "node:crypto"
import { link, lstat, mkdir, mkdtemp, open as openFile, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises"
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

  it("rejects a same-content overwrite target replacement before backup", async () => {
    const fixture = await setup(); await mkdir(fixture.library, { recursive: true })
    const target = join(fixture.library, "photo.png"); const source = join(fixture.root, "photo.png")
    await writeFile(target, Uint8Array.from([...PNG, 2])); await writeFile(source, Uint8Array.from([...PNG, 3]))
    let replacementIdentity: bigint | undefined
    const configured = adapter([source])
    configured.afterPhase = async (phase) => {
      if (phase === "import-staged") {
        const bytes = await readFile(target); await rm(target); await writeFile(target, bytes)
        replacementIdentity = (await lstat(target, { bigint: true })).ino
      }
    }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selection = await service.select({ path: "content/life/daily.md" })
    if (selection.cancelled) throw new Error("unexpected cancellation")
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selection.selectionId, overwrite: ["photo.png"] }))
      .rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
    expect((await lstat(target, { bigint: true })).ino).toBe(replacementIdentity)
  })

  it("preserves a same-content external replacement during rollback and reports uncertainty", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    let replacementIdentity: bigint | undefined
    const configured = adapter([source])
    configured.afterPhase = async (phase) => {
      if (phase === "import-published") {
        const target = join(fixture.library, "photo.png"); const bytes = await readFile(target)
        await rm(target); await writeFile(target, bytes)
        replacementIdentity = (await lstat(target, { bigint: true })).ino
        throw new Error("injected")
      }
    }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selection = await service.select({ path: "content/life/daily.md" })
    if (selection.cancelled) throw new Error("unexpected cancellation")
    const caught = await service.commit({ path: "content/life/daily.md", selectionId: selection.selectionId, overwrite: [] }).catch((error) => error as AppError)
    expect(caught).toMatchObject({ code: "IMAGE_LIBRARY_FAILED", details: { cleanupWarnings: expect.any(Array) } })
    expect((await lstat(join(fixture.library, "photo.png"), { bigint: true })).ino).toBe(replacementIdentity)
  })

  it.each(["valid", "oversized"] as const)("retains and blocks on %s crash residue", async (kind) => {
    const fixture = await setup(); const id = randomUUID()
    const residue = join(fixture.root, ".garden-publisher", "image-import", id)
    await mkdir(residue, { recursive: true })
    const manifest = join(residue, "manifest.json")
    if (kind === "valid") {
      await writeFile(manifest, JSON.stringify({ version: 1, workspace: createHash("sha256").update(fixture.root).digest("hex"), note: "content/life/daily.md", selectionId: id, createdAt: 1, phase: "staged", preState: {}, staged: {}, published: {} }))
    } else if (kind === "oversized") {
      await writeFile(manifest, Buffer.alloc(64 * 1024 + 1))
    }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter(undefined) })
    const caught = await service.open({ path: "content/life/daily.md" }).catch((error) => error as AppError)
    expect(caught).toMatchObject({ code: "IMAGE_LIBRARY_FAILED", details: { cleanupWarnings: expect.any(Array) } })
    expect((await lstat(residue)).isDirectory()).toBe(true)
  })

  it("retains and blocks on linked crash manifests", async ({ skip }) => {
    const fixture = await setup(); const id = randomUUID(); const residue = join(fixture.root, ".garden-publisher", "image-import", id)
    await mkdir(residue, { recursive: true }); const outside = join(fixture.root, "outside.json"); await writeFile(outside, "{}")
    try { await symlink(outside, join(residue, "manifest.json"), "file") } catch (error) { if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) skip(); throw error }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter(undefined) })
    await expect(service.open({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_FAILED", details: { cleanupWarnings: expect.any(Array) } })
    expect((await lstat(residue)).isDirectory()).toBe(true)
  })

  it("fails selection when a source changes while its thumbnail is rendered", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    const configured = adapter([source]); configured.renderThumbnail = async () => {
      await writeFile(source, Uint8Array.from([...PNG, 9])); return { width: 2, height: 3, dataUrl: THUMBNAIL }
    }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    await expect(service.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
  })

  it("includes a target that appears during selection in the final conflict list", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    const configured = adapter([source]); configured.renderThumbnail = async () => {
      await mkdir(fixture.library, { recursive: true }); await writeFile(join(fixture.library, "PHOTO.PNG"), PNG)
      return { width: 2, height: 3, dataUrl: THUMBNAIL }
    }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selected = await service.select({ path: "content/life/daily.md" })
    expect(selected).toMatchObject({ cancelled: false, conflicts: ["photo.png"], images: [{ conflict: true }] })
  })

  it("expires tokens at exactly five minutes and evicts the deterministic oldest of nine", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    let clock = 0
    const configured = adapter([source]); configured.now = () => clock
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const ids: string[] = []
    for (let index = 0; index < 9; index += 1) {
      clock = index
      const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
      ids.push(selected.selectionId)
    }
    await expect(service.commit({ path: "content/life/daily.md", selectionId: ids[0]!, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
    clock = 8 + 5 * 60 * 1000
    await expect(service.commit({ path: "content/life/daily.md", selectionId: ids[8]!, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
  })

  it("accepts a token one millisecond before five minutes", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG); let clock = 0
    const configured = adapter([source]); configured.now = () => clock
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    clock = 5 * 60 * 1000 - 1
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: [] })).resolves.toMatchObject({ images: [{ name: "photo.png" }] })
  })

  it("rejects two names that resolve to the same source file identity", async () => {
    const fixture = await setup(); const first = join(fixture.root, "one.png"); const second = join(fixture.root, "two.png")
    await writeFile(first, PNG); await link(first, second)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([first, second]) })
    await expect(service.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_INVALID" })
  })

  it("rejects case-insensitive duplicate target names", async () => {
    const fixture = await setup(); const a = join(fixture.root, "a"); const b = join(fixture.root, "b"); await mkdir(a); await mkdir(b)
    const first = join(a, "Photo.png"); const second = join(b, "photo.PNG"); await writeFile(first, PNG); await writeFile(second, PNG)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([first, second]) })
    await expect(service.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_INVALID" })
  })

  it("requires exact overwrite authorization and accepts the approved conflict", async () => {
    for (const overwrite of [[], ["photo.png", "photo.png"], ["extra.png"]]) {
      const fixture = await setup(); await mkdir(fixture.library, { recursive: true })
      const source = join(fixture.root, "photo.png"); await writeFile(source, Uint8Array.from([...PNG, 7])); await writeFile(join(fixture.library, "PHOTO.PNG"), PNG)
      const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
      const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
      await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_INVALID" })
    }
    const fixture = await setup(); await mkdir(fixture.library, { recursive: true })
    const source = join(fixture.root, "photo.png"); const replacement = Uint8Array.from([...PNG, 8]); await writeFile(source, replacement); await writeFile(join(fixture.library, "PHOTO.PNG"), PNG)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: ["PHOTO.PNG"] })).resolves.toMatchObject({ images: [{ name: "photo.png" }] })
    expect(await readFile(join(fixture.library, "photo.png"))).toEqual(Buffer.from(replacement))
  })

  it("fails closed on an unapproved collision created after selection", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    await writeFile(join(fixture.library, "PHOTO.PNG"), PNG)
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
  })

  it.each(["import-staged", "import-backed-up", "import-published", "import-marker-removed"] as const)("rolls back exactly after %s failure", async (phase) => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); const fresh = Uint8Array.from([...PNG, 6]); await writeFile(source, fresh)
    const old = Uint8Array.from([...PNG, 4])
    if (phase === "import-backed-up") { await mkdir(fixture.library, { recursive: true }); await writeFile(join(fixture.library, "photo.png"), old) }
    const noteBefore = await readFile(fixture.note)
    const configured = adapter([source]); configured.afterPhase = (current) => { if (current === phase) throw new Error("injected") }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: phase === "import-backed-up" ? ["photo.png"] : [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_FAILED" })
    if (phase === "import-backed-up") expect(await readFile(join(fixture.library, "photo.png"))).toEqual(Buffer.from(old))
    else await expect(readFile(join(fixture.library, "photo.png"))).rejects.toMatchObject({ code: "ENOENT" })
    if (phase === "import-backed-up") await expect(readFile(join(fixture.library, ".gitkeep"))).rejects.toMatchObject({ code: "ENOENT" })
    else expect(await readFile(join(fixture.library, ".gitkeep"))).toEqual(Buffer.alloc(0))
    expect(await readFile(fixture.note)).toEqual(noteBefore)
    expect(await readdir(join(fixture.root, ".garden-publisher", "image-import"))).toEqual([])
  })

  it.each([1, 2])("rolls back a two-image batch after published target %i", async (failAt) => {
    const fixture = await setup(); const sources = [join(fixture.root, "one.png"), join(fixture.root, "two.png")]
    await Promise.all(sources.map((path, index) => writeFile(path, Uint8Array.from([...PNG, index]))))
    let published = 0; const configured = adapter(sources); configured.afterPhase = (phase) => { if (phase === "import-published" && ++published === failAt) throw new Error("injected") }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_FAILED" })
    for (const name of ["one.png", "two.png"]) await expect(readFile(join(fixture.library, name))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(join(fixture.library, ".gitkeep"))).toEqual(Buffer.alloc(0))
  })

  it("dispose waits for an active commit and then rejects its cleared token", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
    const configured = adapter([source]); configured.afterPhase = async (phase) => { if (phase === "import-staged") await gate }
    const service = createImageLibraryService({ workspace: fixture.root, adapter: configured })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    const committing = service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: [] })
    let disposed = false; const disposing = service.dispose().then(() => { disposed = true })
    await Promise.resolve(); expect(disposed).toBe(false); release()
    await expect(committing).resolves.toMatchObject({ images: [{ name: "photo.png" }] }); await disposing
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_FAILED" })
  })

  it("accepts 50 sources and rejects 51", async () => {
    const fixture = await setup(); const paths: string[] = []
    for (let index = 0; index < 51; index += 1) { const path = join(fixture.root, `photo-${index}.png`); await writeFile(path, PNG); paths.push(path) }
    const accepted = createImageLibraryService({ workspace: fixture.root, adapter: adapter(paths.slice(0, 50)) })
    await expect(accepted.select({ path: "content/life/daily.md" })).resolves.toMatchObject({ cancelled: false, images: expect.arrayContaining([expect.objectContaining({ name: "photo-49.png" })]) })
    const rejected = createImageLibraryService({ workspace: fixture.root, adapter: adapter(paths) })
    await expect(rejected.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_TOO_LARGE" })
  }, 15_000)

  it("accepts exactly 25 MiB and rejects one byte more", async () => {
    const fixture = await setup(); const exact = join(fixture.root, "exact.png"); const large = join(fixture.root, "large.png")
    for (const [path, size] of [[exact, 25 * 1024 * 1024], [large, 25 * 1024 * 1024 + 1]] as const) {
      const handle = await openFile(path, "w"); await handle.write(PNG, 0, PNG.length, 0); await handle.truncate(size); await handle.close()
    }
    const accepted = createImageLibraryService({ workspace: fixture.root, adapter: adapter([exact]) })
    await expect(accepted.select({ path: "content/life/daily.md" })).resolves.toMatchObject({ cancelled: false, images: [{ sizeBytes: 25 * 1024 * 1024 }] })
    const rejected = createImageLibraryService({ workspace: fixture.root, adapter: adapter([large]) })
    await expect(rejected.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_TOO_LARGE" })
  }, 15_000)

  it("binds each token to its original note", async () => {
    const fixture = await setup(); const source = join(fixture.root, "photo.png"); await writeFile(source, PNG)
    await mkdir(join(fixture.root, "content", "work")); await writeFile(join(fixture.root, "content", "work", "other.md"), "# other\n")
    const service = createImageLibraryService({ workspace: fixture.root, adapter: adapter([source]) })
    const selected = await service.select({ path: "content/life/daily.md" }); if (selected.cancelled) throw new Error("cancelled")
    await expect(service.commit({ path: "content/work/other.md", selectionId: selected.selectionId, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
    await expect(service.commit({ path: "content/life/daily.md", selectionId: selected.selectionId, overwrite: [] })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_CHANGED" })
  })

  it("rejects nonregular and linked image sources", async ({ skip }) => {
    const fixture = await setup(); const directory = join(fixture.root, "folder.png"); await mkdir(directory)
    const directoryService = createImageLibraryService({ workspace: fixture.root, adapter: adapter([directory]) })
    await expect(directoryService.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_INVALID" })
    const target = join(fixture.root, "target.png"); const linked = join(fixture.root, "linked.png"); await writeFile(target, PNG)
    try { await symlink(target, linked, "file") } catch (error) { if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) skip(); throw error }
    const linkedService = createImageLibraryService({ workspace: fixture.root, adapter: adapter([linked]) })
    await expect(linkedService.select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_INVALID" })
  })

  it("enforces the aggregate selection thumbnail budget at its boundary", async () => {
    const fixture = await setup(); const paths: string[] = []
    for (let index = 0; index < 17; index += 1) { const path = join(fixture.root, `budget-${index}.png`); await writeFile(path, PNG); paths.push(path) }
    const thumbnailBytes = Buffer.alloc(393_192); thumbnailBytes.set(PNG)
    const largeThumbnail = `data:image/png;base64,${thumbnailBytes.toString("base64")}`
    const configured = (selected: readonly string[]) => adapter(selected)
    const acceptedAdapter = configured(paths.slice(0, 16)); acceptedAdapter.renderThumbnail = async () => ({ width: 1, height: 1, dataUrl: largeThumbnail })
    await expect(createImageLibraryService({ workspace: fixture.root, adapter: acceptedAdapter }).select({ path: "content/life/daily.md" })).resolves.toMatchObject({ cancelled: false })
    const rejectedAdapter = configured(paths); rejectedAdapter.renderThumbnail = acceptedAdapter.renderThumbnail
    await expect(createImageLibraryService({ workspace: fixture.root, adapter: rejectedAdapter }).select({ path: "content/life/daily.md" })).rejects.toMatchObject({ code: "IMAGE_LIBRARY_TOO_LARGE" })
  }, 15_000)
})
