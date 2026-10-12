import { constants } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  IMAGE_LIBRARY_MAX_GALLERY_THUMBNAIL_TOTAL_LENGTH,
  IMAGE_LIBRARY_MAX_ITEMS,
  IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH,
  IMAGE_LIBRARY_MAX_THUMBNAIL_DECODED_BYTES,
  type AppError,
} from "../../src/shared/contracts"
import { MAX_MARKDOWN_UTF8_BYTES } from "../../src/shared/ipcSchemas"

const leaseProbe = vi.hoisted(() => ({
  acquired: [] as string[],
  asserted: [] as string[],
  released: [] as string[],
  failRelease: false,
  acquireError: undefined as unknown,
  assertError: undefined as unknown,
  releaseError: undefined as unknown,
  immediate: false,
}))

const ownershipFault = vi.hoisted(() => ({
  path: undefined as string | undefined,
  afterCapturePath: undefined as string | undefined,
  markerSync: false,
}))

vi.mock("../../src/main/services/imageLibraryFs", async (load) => {
  const actual = await load<typeof import("../../src/main/services/imageLibraryFs")>()
  return {
    ...actual,
    async captureImageLibraryPathIdentity(path: string) {
      if (path === ownershipFault.path) {
        ownershipFault.path = undefined
        throw Object.assign(new Error("injected identity failure"), { code: "EIO" })
      }
      return actual.captureImageLibraryPathIdentity(path)
    },
    completeImageLibraryOwnershipCapture(path: string) {
      if (path === ownershipFault.afterCapturePath) {
        ownershipFault.afterCapturePath = undefined
        throw new Error("injected post-identity inspection failure")
      }
      return actual.completeImageLibraryOwnershipCapture(path)
    },
    async syncImageLibraryMarker(handle: Parameters<typeof actual.syncImageLibraryMarker>[0]) {
      if (ownershipFault.markerSync) {
        ownershipFault.markerSync = false
        throw Object.assign(new Error("injected marker sync failure"), { code: "EIO" })
      }
      return actual.syncImageLibraryMarker(handle)
    },
  }
})

vi.mock("../../src/main/services/noteFiles", async (load) => {
  const actual = await load<typeof import("../../src/main/services/noteFiles")>()
  return {
    ...actual,
    async acquireInternalNotePathLease(
      ...args: Parameters<typeof actual.acquireInternalNotePathLease>
    ) {
      const path = args[1]
      leaseProbe.acquired.push(path)
      if (leaseProbe.acquireError !== undefined) throw leaseProbe.acquireError
      if (leaseProbe.immediate) {
        return {
          lockId: `immediate:${path}`,
          async assertOwned() {
            leaseProbe.asserted.push(path)
            if (leaseProbe.assertError !== undefined) throw leaseProbe.assertError
          },
          async release() {
            leaseProbe.released.push(path)
            if (leaseProbe.releaseError !== undefined) throw leaseProbe.releaseError
            if (leaseProbe.failRelease) throw new Error("injected release failure")
          },
        }
      }
      const lease = await actual.acquireInternalNotePathLease(...args)
      return {
        lockId: lease.lockId,
        async assertOwned() {
          leaseProbe.asserted.push(path)
          if (leaseProbe.assertError !== undefined) throw leaseProbe.assertError
          await lease.assertOwned()
        },
        async release() {
          leaseProbe.released.push(path)
          await lease.release()
          if (leaseProbe.releaseError !== undefined) throw leaseProbe.releaseError
          if (leaseProbe.failRelease) throw new Error("injected release failure")
        },
      }
    },
  }
})

import {
  IMAGE_LIBRARY_MAX_FILE_BYTES,
  createImageLibraryService,
  type ImageLibraryAdapter,
  type ImageLibraryPhase,
} from "../../src/main/services/imageLibrary"

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 1])
const GIF = Uint8Array.from(Buffer.from("GIF89a!", "ascii"))
const WEBP = Uint8Array.from(Buffer.from("RIFF1234WEBP!", "ascii"))
const AVIF = Uint8Array.from([
  0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
])
const THUMBNAIL = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`

function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

interface Fixture {
  readonly root: string
  readonly notePath: string
  readonly libraryPath: string
}

const cleanups: string[] = []

async function fixture(
  path = "content/life/daily.md",
  requestedRoot?: string,
): Promise<Fixture> {
  const root = requestedRoot ?? (await mkdtemp(join(tmpdir(), "publisher-image-library-")))
  cleanups.push(root)
  const notePath = join(root, ...path.split("/"))
  await mkdir(join(root, "content"), { recursive: true })
  await mkdir(join(root, "private"), { recursive: true })
  await mkdir(join(notePath, ".."), { recursive: true })
  await writeFile(notePath, "# stable note\n")
  const [visibility, , file] = path.split("/")
  return {
    root: await realpath(root),
    notePath,
    libraryPath: join(root, visibility!, "_assets", file!.slice(0, -3)),
  }
}

function adapter(overrides: Partial<ImageLibraryAdapter> = {}): ImageLibraryAdapter {
  return {
    chooseImages: async () => undefined,
    renderThumbnail: async () => ({ width: 640, height: 480, dataUrl: THUMBNAIL }),
    readDimensions: async () => ({ width: 640, height: 480 }),
    writeClipboard: () => undefined,
    ...overrides,
  }
}

function code(error: unknown): AppError["code"] | undefined {
  return (error as Partial<AppError>).code
}

async function expectCode(run: Promise<unknown>, expected: AppError["code"]): Promise<void> {
  await expect(run).rejects.toMatchObject({ code: expected })
  await run.catch((error) => {
    expect((error as AppError).message).toMatch(/[\u3400-\u9fff]/)
    expect(JSON.stringify(error)).not.toMatch(/[A-Za-z]:\\|\/tmp\//)
  })
}

async function createLinkOrSkip(
  skip: () => never,
  target: string,
  path: string,
  type: "file" | "dir" | "junction",
): Promise<boolean> {
  try {
    await symlink(target, path, type)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) {
      skip()
      return false
    }
    throw error
  }
}

async function expectSanitizedFailure(
  run: Promise<unknown>,
  expected: AppError["code"],
  secret: string,
): Promise<void> {
  const error = await run.catch((caught) => caught)
  expect(error).toMatchObject({ code: expected, message: expect.stringMatching(/[\u3400-\u9fff]/) })
  expect(JSON.stringify(error)).not.toContain(secret)
  const details = (error as AppError).details
  if (details !== undefined) {
    expect(Object.keys(details)).toEqual(["cleanupWarnings"])
    expect(details.cleanupWarnings).toEqual(expect.any(Array))
  }
}

beforeEach(() => {
  leaseProbe.acquired.length = 0
  leaseProbe.asserted.length = 0
  leaseProbe.released.length = 0
  leaseProbe.failRelease = false
  leaseProbe.acquireError = undefined
  leaseProbe.assertError = undefined
  leaseProbe.releaseError = undefined
  leaseProbe.immediate = false
  ownershipFault.path = undefined
  ownershipFault.afterCapturePath = undefined
  ownershipFault.markerSync = false
})

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("note-scoped image library", () => {
  it("creates the public attachment directory and one empty marker idempotently", async () => {
    const setup = await fixture()
    const synced: string[] = []
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ syncDirectory: async (path) => void synced.push(path) }),
    })

    await expect(service.open({ path: "content/life/daily.md" })).resolves.toEqual({
      path: "content/life/daily.md",
      images: [],
    })
    await expect(service.open({ path: "content/life/daily.md" })).resolves.toEqual({
      path: "content/life/daily.md",
      images: [],
    })

    expect(await readdir(setup.libraryPath)).toEqual([".gitkeep"])
    expect(await readFile(join(setup.libraryPath, ".gitkeep"))).toHaveLength(0)
    expect(synced).toContain(setup.libraryPath)
  })

  it.each([
    ["private/reading/secret-note.md", "private/_assets/secret-note"],
    ["content/custom-domain/field-log.md", "content/_assets/field-log"],
  ])("maps %s to %s", async (path, expectedLibrary) => {
    const setup = await fixture(path)
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    await expect(service.open({ path })).resolves.toEqual({ path, images: [] })
    expect(await readdir(join(setup.root, ...expectedLibrary.split("/")))).toEqual([".gitkeep"])
  })

  it("lists supported direct images in natural order with exact safe metadata", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, ".gitkeep"), "")
    await writeFile(join(setup.libraryPath, "photo10.png"), PNG)
    await writeFile(join(setup.libraryPath, "photo2.JPG"), JPEG)
    const seen: string[] = []
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        renderThumbnail: async (bytes) => {
          seen.push(Buffer.from(bytes).equals(Buffer.from(PNG)) ? "png" : "jpeg")
          return { width: 320, height: 200, dataUrl: THUMBNAIL }
        },
      }),
    })

    const result = await service.open({ path: "content/life/daily.md" })

    expect(result.path).toBe("content/life/daily.md")
    expect(result.images.map(({ name }) => name)).toEqual(["photo2.JPG", "photo10.png"])
    expect(result.images[0]).toEqual({
      name: "photo2.JPG",
      sizeBytes: JPEG.length,
      width: 320,
      height: 200,
      contentHash: "2501302c0464719ae433103d7f70c01350d8dceee909f52197fe284905e20a96",
      thumbnailDataUrl: THUMBNAIL,
      markdown: "![photo2](<../_assets/daily/photo2.JPG>)",
    })
    expect(seen).toEqual(["jpeg", "png"])
    expect(JSON.stringify(result)).not.toContain(setup.root)
  })

  it.each([
    ["a.png", PNG],
    ["b.jpeg", JPEG],
    ["c.gif", GIF],
    ["d.webp", WEBP],
    ["e.avif", AVIF],
  ])("accepts the supported %s format through signature validation", async (name, bytes) => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, name), bytes)
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    const result = await service.open({ path: "content/life/daily.md" })
    expect(result.images.map((image) => image.name)).toEqual([name])
  })

  it.each([
    "content/life/../daily.md",
    "content/life/daily.txt",
    "content//daily.md",
    "C:/content/life/daily.md",
  ])("rejects unmanaged path %s", async (path) => {
    const setup = await fixture()
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path }), "IMAGE_LIBRARY_INVALID")
  })

  it("rejects a missing or directory note", async () => {
    const setup = await fixture()
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/missing.md" }), "IMAGE_LIBRARY_INVALID")

    await mkdir(join(setup.root, "content", "life", "folder.md"))
    await expectCode(service.open({ path: "content/life/folder.md" }), "IMAGE_LIBRARY_INVALID")
  })

  it("rejects a symlink note", async ({ skip }) => {
    const setup = await fixture()
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    const target = join(setup.root, "content", "life", "target.md")
    const linked = join(setup.root, "content", "life", "linked.md")
    await writeFile(target, "# target")
    if (!(await createLinkOrSkip(skip, target, linked, "file"))) return
    await expectCode(service.open({ path: "content/life/linked.md" }), "IMAGE_LIBRARY_UNSAFE")
  })

  it("requires an absolute canonical workspace directory", async ({ skip }) => {
    const setup = await fixture()
    const relativeService = createImageLibraryService({ workspace: ".", adapter: adapter() })
    await expectCode(relativeService.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_INVALID")

    const alias = `${setup.root}-alias`
    cleanups.push(alias)
    if (
      !(await createLinkOrSkip(
        skip,
        setup.root,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      ))
    )
      return
    const aliasService = createImageLibraryService({ workspace: alias, adapter: adapter() })
    await expectCode(aliasService.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_UNSAFE")
  })

  for (const relative of ["content", "content/_assets", "content/_assets/daily"] as const) {
    it(`rejects a linked ${relative} ancestor`, async ({ skip }) => {
      const setup = await fixture()
      const outside = await mkdtemp(join(tmpdir(), "publisher-image-outside-"))
      cleanups.push(outside)
      const target = join(setup.root, ...relative.split("/"))
      if (relative === "content") {
        await rm(target, { recursive: true })
        await mkdir(join(outside, "life"), { recursive: true })
        await writeFile(join(outside, "life", "daily.md"), "# copied")
      } else {
        await mkdir(join(target, ".."), { recursive: true })
      }
      if (
        !(await createLinkOrSkip(
          skip,
          outside,
          target,
          process.platform === "win32" ? "junction" : "dir",
        ))
      )
        return
      const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
      await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_UNSAFE")
    })
  }

  for (const swapped of ["_assets", "daily"] as const) {
    it(`does not write outside when the newly created ${swapped} directory is swapped at sync`, async ({
      skip,
    }) => {
      const setup = await fixture()
      const outside = await mkdtemp(join(tmpdir(), "publisher-image-swap-outside-"))
      cleanups.push(outside)
      let swappedOnce = false
      const service = createImageLibraryService({
        workspace: setup.root,
        adapter: adapter({
          syncDirectory: async (path) => {
            if (swappedOnce) return
            const expectedParent =
              swapped === "_assets" ? join(setup.root, "content") : join(setup.root, "content", "_assets")
            if (path !== expectedParent) return
            const target =
              swapped === "_assets"
                ? join(setup.root, "content", "_assets")
                : join(setup.root, "content", "_assets", "daily")
            const displaced = `${target}.displaced`
            await import("node:fs/promises").then(({ rename }) => rename(target, displaced))
            if (
              !(await createLinkOrSkip(
                skip,
                outside,
                target,
                process.platform === "win32" ? "junction" : "dir",
              ))
            )
              return
            swappedOnce = true
          },
        }),
      })

      const error = await service.open({ path: "content/life/daily.md" }).catch((caught) => caught)
      expect(["IMAGE_LIBRARY_CHANGED", "IMAGE_LIBRARY_UNSAFE"]).toContain(code(error))
      expect((error as AppError).message).toMatch(/[\u3400-\u9fff]/)
      expect(await readdir(outside)).toEqual([])
    })
  }

  it("rejects unknown, nested, corrupt, and unsafe entries", async () => {
    const cases: Array<() => Promise<void>> = [
      async () => writeFile(join(current!.libraryPath, "notes.txt"), "not an image"),
      async () => mkdir(join(current!.libraryPath, "nested")),
      async () => writeFile(join(current!.libraryPath, "bad.png"), "corrupt"),
      async () => writeFile(join(current!.libraryPath, ".png"), PNG),
    ]
    let current: Fixture | undefined
    for (let index = 0; index < cases.length; index += 1) {
      current = await fixture()
      await mkdir(current.libraryPath, { recursive: true })
      await cases[index]!()
      const service = createImageLibraryService({ workspace: current.root, adapter: adapter() })
      await expectCode(
        service.open({ path: "content/life/daily.md" }),
        "IMAGE_LIBRARY_INVALID",
      )
    }
  })

  it("rejects a symlink image entry", async ({ skip }) => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const outside = join(setup.root, "outside.png")
    await writeFile(outside, PNG)
    if (!(await createLinkOrSkip(skip, outside, join(setup.libraryPath, "linked.png"), "file")))
      return
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_UNSAFE")
  })

  it("rejects a nonempty marker instead of replacing it", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const marker = join(setup.libraryPath, ".gitkeep")
    await writeFile(marker, "foreign")
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_INVALID")
    expect(await readFile(marker, "utf8")).toBe("foreign")
  })

  it("rejects a symlink marker instead of replacing it", async ({ skip }) => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const marker = join(setup.libraryPath, ".gitkeep")
    const outside = join(setup.root, "outside-marker")
    await writeFile(outside, "")
    if (!(await createLinkOrSkip(skip, outside, marker, "file"))) return
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_UNSAFE")
  })

  it("enforces the exported file and item limits before rendering", async () => {
    expect(IMAGE_LIBRARY_MAX_FILE_BYTES).toBe(25 * 1024 * 1024)
    const oversized = await fixture()
    await mkdir(oversized.libraryPath, { recursive: true })
    const huge = join(oversized.libraryPath, "huge.png")
    const handle = await import("node:fs/promises").then(({ open }) => open(huge, "w"))
    await handle.write(PNG, 0, PNG.length, 0)
    await handle.truncate(IMAGE_LIBRARY_MAX_FILE_BYTES + 1)
    await handle.close()
    const renderThumbnail = vi.fn(adapter().renderThumbnail)
    const hugeService = createImageLibraryService({
      workspace: oversized.root,
      adapter: adapter({ renderThumbnail }),
    })
    await expectCode(hugeService.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_TOO_LARGE")
    expect(renderThumbnail).not.toHaveBeenCalled()

    const crowded = await fixture()
    await mkdir(crowded.libraryPath, { recursive: true })
    await Promise.all(
      Array.from({ length: IMAGE_LIBRARY_MAX_ITEMS + 1 }, (_, index) =>
        writeFile(join(crowded.libraryPath, `image-${index}.png`), PNG),
      ),
    )
    const crowdedService = createImageLibraryService({ workspace: crowded.root, adapter: adapter() })
    await expectCode(
      crowdedService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_TOO_LARGE",
    )
  })

  it("streams note hashes up to the shared Markdown limit and rejects larger notes", async () => {
    const boundary = await fixture()
    const boundaryHandle = await import("node:fs/promises").then(({ open }) =>
      open(boundary.notePath, "w"),
    )
    await boundaryHandle.truncate(MAX_MARKDOWN_UTF8_BYTES)
    await boundaryHandle.close()
    const boundaryService = createImageLibraryService({ workspace: boundary.root, adapter: adapter() })
    await expect(boundaryService.open({ path: "content/life/daily.md" })).resolves.toMatchObject({
      images: [],
    })

    const oversized = await fixture()
    const oversizedHandle = await import("node:fs/promises").then(({ open }) =>
      open(oversized.notePath, "w"),
    )
    await oversizedHandle.truncate(MAX_MARKDOWN_UTF8_BYTES + 1)
    await oversizedHandle.close()
    const renderThumbnail = vi.fn(adapter().renderThumbnail)
    const oversizedService = createImageLibraryService({
      workspace: oversized.root,
      adapter: adapter({ renderThumbnail }),
    })
    await expectCode(
      oversizedService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_TOO_LARGE",
    )
    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it("validates dimensions and exact canonical thumbnail data URL bounds", async () => {
    const invalidRenders = [
      { width: 0, height: 1, dataUrl: THUMBNAIL },
      { width: Number.MAX_SAFE_INTEGER + 1, height: 1, dataUrl: THUMBNAIL },
      { width: 1, height: 1, dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
      { width: 1, height: 1, dataUrl: "data:image/png;base64,dGh1bWI" },
      {
        width: 1,
        height: 1,
        dataUrl: `data:image/png;base64,${"A".repeat(IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH)}`,
      },
      {
        width: 1,
        height: 1,
        dataUrl: `data:image/png;base64,${Buffer.alloc(IMAGE_LIBRARY_MAX_THUMBNAIL_DECODED_BYTES + 1).toString("base64")}`,
      },
    ]
    for (const rendered of invalidRenders) {
      const setup = await fixture()
      await mkdir(setup.libraryPath, { recursive: true })
      await writeFile(join(setup.libraryPath, "photo.png"), PNG)
      const service = createImageLibraryService({
        workspace: setup.root,
        adapter: adapter({ renderThumbnail: async () => rendered }),
      })
      await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_INVALID")
    }
  })

  it.each([
    "data:image/jpeg;base64,iVBORw0KGgoBAQ==",
    "data:image/png;base64,AAAAAA==",
  ])("rejects corrupt or MIME-mismatched thumbnail bytes", async (dataUrl) => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "photo.png"), PNG)
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ renderThumbnail: async () => ({ width: 1, height: 1, dataUrl }) }),
    })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_INVALID")
  })

  it("enforces the shared aggregate gallery thumbnail budget", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const count = 40
    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        writeFile(join(setup.libraryPath, `photo-${index}.png`), PNG),
      ),
    )
    const payloadBytes = 380 * 1024
    const largeThumbnailBytes = Buffer.alloc(payloadBytes)
    largeThumbnailBytes.set(PNG)
    const largeThumbnail = `data:image/png;base64,${largeThumbnailBytes.toString("base64")}`
    expect(largeThumbnail.length).toBeLessThanOrEqual(IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH)
    expect(largeThumbnail.length * count).toBeGreaterThan(
      IMAGE_LIBRARY_MAX_GALLERY_THUMBNAIL_TOTAL_LENGTH,
    )
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        renderThumbnail: async () => ({ width: 1, height: 1, dataUrl: largeThumbnail }),
      }),
    })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_TOO_LARGE")
  })

  it("fails closed when the note changes during open", async () => {
    const setup = await fixture()
    const phases: ImageLibraryPhase[] = []
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          phases.push(phase)
          if (phase === "note-validated") await writeFile(setup.notePath, "# changed note\n")
        },
      }),
    })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_CHANGED")
    expect(phases).toContain("note-validated")
  })

  it("does not expose adapter failures from the pre-lock race seam", async () => {
    const setup = await fixture()
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: (phase) => {
          if (phase === "note-validated") throw new Error(`secret adapter path: ${setup.root}`)
        },
      }),
    })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
  })

  it("fails closed when image identity or content changes around thumbnailing", async () => {
    for (const phase of ["image-read", "thumbnail-rendered"] as const) {
      const setup = await fixture()
      await mkdir(setup.libraryPath, { recursive: true })
      const image = join(setup.libraryPath, "photo.png")
      await writeFile(image, PNG)
      const service = createImageLibraryService({
        workspace: setup.root,
        adapter: adapter({
          afterPhase: async (current) => {
            if (current === phase) await writeFile(image, Uint8Array.from([...PNG, phase.length]))
          },
        }),
      })
      await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_CHANGED")
    }
  })

  it.each(["add", "remove", "replace"] as const)(
    "rejects a direct-child manifest %s race after thumbnailing",
    async (mutation) => {
      const setup = await fixture()
      await mkdir(setup.libraryPath, { recursive: true })
      const image = join(setup.libraryPath, "photo.png")
      await writeFile(image, PNG)
      const service = createImageLibraryService({
        workspace: setup.root,
        adapter: adapter({
          afterPhase: async (phase) => {
            if (phase !== "thumbnail-rendered") return
            if (mutation === "add") await writeFile(join(setup.libraryPath, "intruder.txt"), "x")
            if (mutation === "remove") await rm(image)
            if (mutation === "replace") {
              await rm(image)
              await writeFile(image, PNG)
            }
          },
        }),
      })
      await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_CHANGED")
    },
  )

  it("rejects a child inserted from the marker directory-sync seam", async () => {
    const setup = await fixture()
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        syncDirectory: async (path) => {
          if (path === setup.libraryPath) await writeFile(join(path, "intruder.txt"), "x")
        },
      }),
    })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_CHANGED")
  })

  it("sanitizes malicious AppError-shaped adapter failures at every reachable seam", async () => {
    const secret = "C:\\secret\\adapter-token"
    const malicious = {
      code: "IMAGE_LIBRARY_INVALID",
      message: `leak ${secret}`,
      details: { path: secret },
    }

    const noteSetup = await fixture()
    const noteService = createImageLibraryService({
      workspace: noteSetup.root,
      adapter: adapter({ afterPhase: () => Promise.reject(malicious) }),
    })
    await expectSanitizedFailure(
      noteService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_FAILED",
      secret,
    )

    const syncSetup = await fixture()
    const syncService = createImageLibraryService({
      workspace: syncSetup.root,
      adapter: adapter({ syncDirectory: () => Promise.reject(malicious) }),
    })
    await expectSanitizedFailure(
      syncService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_FAILED",
      secret,
    )

    for (const seam of ["image-read", "thumbnail-rendered"] as const) {
      const setup = await fixture()
      await mkdir(setup.libraryPath, { recursive: true })
      await writeFile(join(setup.libraryPath, "photo.png"), PNG)
      const service = createImageLibraryService({
        workspace: setup.root,
        adapter: adapter({
          afterPhase: (phase) => (phase === seam ? Promise.reject(malicious) : undefined),
        }),
      })
      await expectSanitizedFailure(
        service.open({ path: "content/life/daily.md" }),
        "IMAGE_LIBRARY_FAILED",
        secret,
      )
    }

    const renderSetup = await fixture()
    await mkdir(renderSetup.libraryPath, { recursive: true })
    await writeFile(join(renderSetup.libraryPath, "photo.png"), PNG)
    const renderService = createImageLibraryService({
      workspace: renderSetup.root,
      adapter: adapter({ renderThumbnail: () => Promise.reject(malicious) }),
    })
    await expectSanitizedFailure(
      renderService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_FAILED",
      secret,
    )

    const releaseSetup = await fixture()
    leaseProbe.releaseError = malicious
    const releaseService = createImageLibraryService({
      workspace: releaseSetup.root,
      adapter: adapter(),
    })
    await expectSanitizedFailure(
      releaseService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_FAILED",
      secret,
    )
    leaseProbe.releaseError = undefined

    const acquireSetup = await fixture()
    leaseProbe.acquireError = malicious
    const acquireService = createImageLibraryService({
      workspace: acquireSetup.root,
      adapter: adapter(),
    })
    await expectSanitizedFailure(
      acquireService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_FAILED",
      secret,
    )
    leaseProbe.acquireError = undefined

    const assertSetup = await fixture()
    leaseProbe.assertError = malicious
    const assertService = createImageLibraryService({
      workspace: assertSetup.root,
      adapter: adapter(),
    })
    await expectSanitizedFailure(
      assertService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_CHANGED",
      secret,
    )
  })

  it("never changes Markdown note bytes while creating or listing a library", async () => {
    const setup = await fixture()
    const beforeBytes = await readFile(setup.notePath)
    const before = await lstat(setup.notePath, { bigint: true })
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    await service.open({ path: "content/life/daily.md" })
    await writeFile(join(setup.libraryPath, "photo.png"), PNG)
    await service.open({ path: "content/life/daily.md" })

    const afterBytes = await readFile(setup.notePath)
    const after = await lstat(setup.notePath, { bigint: true })
    expect(afterBytes).toEqual(beforeBytes)
    expect({
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      mtimeNs: after.mtimeNs,
      ctimeNs: after.ctimeNs,
    }).toEqual({
      dev: before.dev,
      ino: before.ino,
      size: before.size,
      mtimeNs: before.mtimeNs,
      ctimeNs: before.ctimeNs,
    })
  })

  it("previews one verified image with the byte MIME, dimensions, size, and hash", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "封 面.JPG"), JPEG)
    const readDimensions = vi.fn(async (_bytes: Uint8Array) => ({ width: 1920, height: 1080 }))
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ readDimensions }),
    })

    await expect(
      service.preview({
        path: "content/life/daily.md",
        name: "封 面.JPG",
        expectedContentHash: contentHash(JPEG),
      }),
    ).resolves.toEqual({
      name: "封 面.JPG",
      sizeBytes: JPEG.length,
      width: 1920,
      height: 1080,
      contentHash: contentHash(JPEG),
      markdown: "![封 面](<../_assets/daily/封 面.JPG>)",
      dataUrl: `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`,
    })
    expect(readDimensions).toHaveBeenCalledTimes(1)
    expect(Buffer.from(readDimensions.mock.calls[0]![0])).toEqual(Buffer.from(JPEG))
  })

  it("rejects preview extension/signature mismatches and stale expected hashes", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "wrong.jpg"), PNG)
    await writeFile(join(setup.libraryPath, "right.png"), PNG)
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    await expectCode(
      service.preview({ path: "content/life/daily.md", name: "wrong.jpg" }),
      "IMAGE_LIBRARY_INVALID",
    )
    await expectCode(
      service.preview({
        path: "content/life/daily.md",
        name: "right.png",
        expectedContentHash: "0".repeat(64),
      }),
      "IMAGE_LIBRARY_CHANGED",
    )
  })

  it("rejects preview as changed when its note or attachment lease is lost", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "right.png"), PNG)
    leaseProbe.assertError = new Error("lease lost")
    const readDimensions = vi.fn(async () => ({ width: 1, height: 1 }))
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ readDimensions }),
    })

    await expectCode(
      service.preview({ path: "content/life/daily.md", name: "right.png" }),
      "IMAGE_LIBRARY_CHANGED",
    )
    expect(readDimensions).not.toHaveBeenCalled()
  })

  it("preserves a preview validation error and reports lease cleanup failure", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "wrong.jpg"), PNG)
    leaseProbe.failRelease = true
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    const error = await service
      .preview({ path: "content/life/daily.md", name: "wrong.jpg" })
      .catch((caught) => caught)
    expect(error).toMatchObject({
      code: "IMAGE_LIBRARY_INVALID",
      details: { cleanupWarnings: expect.any(Array) },
    })
    expect(JSON.stringify(error)).not.toContain(setup.root)
  })

  it("fails closed before previewing while an unverified import residue exists", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "photo.png"), PNG)
    await mkdir(join(setup.root, ".garden-publisher", "image-import", randomUUID()), {
      recursive: true,
    })
    const readDimensions = vi.fn(async () => ({ width: 1, height: 1 }))
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ readDimensions }),
    })

    await expectCode(
      service.preview({ path: "content/life/daily.md", name: "photo.png" }),
      "IMAGE_LIBRARY_FAILED",
    )
    expect(readDimensions).not.toHaveBeenCalled()
  })

  it("copies the exact safe Markdown link without changing the note", async () => {
    const setup = await fixture()
    const writeClipboard = vi.fn()
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ writeClipboard }),
    })
    const before = await readFile(setup.notePath)

    await service.copyMarkdown({
      path: "content/life/daily.md",
      name: "图 表#100%.png",
    })

    expect(writeClipboard).toHaveBeenCalledOnce()
    expect(writeClipboard).toHaveBeenCalledWith(
      "![图 表#100%](<../_assets/daily/图 表%23100%25.png>)",
    )
    expect(await readFile(setup.notePath)).toEqual(before)
  })

  it("requires the current content hash before deleting and preserves a stale target", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: "0".repeat(64),
      }),
      "IMAGE_LIBRARY_CHANGED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
  })

  it("permanently deletes the last verified image and restores the empty marker", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const synced: string[] = []
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ syncDirectory: async (path) => void synced.push(path) }),
    })

    await expect(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
    ).resolves.toEqual({ path: "content/life/daily.md", images: [] })

    expect(await readdir(setup.libraryPath)).toEqual([".gitkeep"])
    expect(await readFile(join(setup.libraryPath, ".gitkeep"))).toHaveLength(0)
    expect(synced).toContain(setup.libraryPath)
  })

  it("preserves the image when an existing empty-library marker is invalid", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    await writeFile(join(setup.libraryPath, ".gitkeep"), "external")
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_INVALID",
    )
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
    expect(await readFile(join(setup.libraryPath, ".gitkeep"), "utf8")).toBe("external")
  })

  it("preserves an externally replaced image at the delete boundary", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const replacement = Uint8Array.from([...PNG, 2])
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          if ((phase as string) !== "delete-before-quarantine") return
          await rm(target)
          await writeFile(target, replacement)
        },
      }),
    })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_CHANGED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(replacement))
  })

  it("atomically quarantines and restores a replacement installed immediately before rename", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const replacement = Uint8Array.from([...PNG, 77])
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          if ((phase as string) !== "delete-before-rename") return
          await rm(target)
          await writeFile(target, replacement)
        },
      }),
    })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_CHANGED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(replacement))
    expect((await readdir(setup.libraryPath)).filter((name) => name.startsWith(".garden-delete-"))).toEqual([])
  })

  it("preserves a late external quarantine destination collision", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const external = Buffer.from("external quarantine")
    let collision = ""
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          if ((phase as string) !== "delete-before-rename") return
          const directory = (await readdir(setup.libraryPath)).find((name) =>
            name.startsWith(".garden-delete-"),
          )!
          collision = join(setup.libraryPath, directory, "image")
          await writeFile(collision, external)
        },
      }),
    })

    const error = await service
      .delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      })
      .catch((caught) => caught)
    expect(error).toMatchObject({
      code: "IMAGE_LIBRARY_FAILED",
      details: { cleanupWarnings: expect.any(Array) },
    })
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
    expect(await readFile(collision)).toEqual(external)
  })

  it("preserves a replaced delete journal manifest during rollback", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    let replacedManifest = ""
    let replacementIdentity: bigint | undefined
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          if ((phase as string) !== "delete-renamed") return
          const root = join(setup.root, ".garden-publisher", "image-delete")
          const id = (await readdir(root)).find((name) => /^[0-9a-f-]{36}$/i.test(name))!
          replacedManifest = join(root, id, "manifest.json")
          const bytes = await readFile(replacedManifest)
          await rm(replacedManifest)
          await writeFile(replacedManifest, bytes)
          replacementIdentity = (await lstat(replacedManifest, { bigint: true })).ino
          throw new Error("stop after manifest replacement")
        },
      }),
    })

    const error = await service
      .delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      })
      .catch((caught) => caught)
    expect(error).toMatchObject({
      code: "IMAGE_LIBRARY_FAILED",
      details: { cleanupWarnings: expect.any(Array) },
    })
    expect((await lstat(replacedManifest, { bigint: true })).ino).toBe(replacementIdentity)
  })

  it("rolls back an owned delete quarantine when a later step fails", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          if ((phase as string) === "delete-quarantined") throw new Error("injected failure")
        },
      }),
    })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_FAILED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
    expect((await readdir(setup.libraryPath)).filter((name) => name !== "photo.png")).toEqual([])
  })

  it("registers and removes the owned quarantine before later awaited validation", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: async (phase) => {
          if ((phase as string) === "delete-quarantine-linked") throw new Error("stop after link")
        },
      }),
    })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_FAILED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
    expect(await readdir(setup.libraryPath)).toEqual(["photo.png"])
  })

  it("restores the last image when the replacement marker cannot be made durable", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    ownershipFault.markerSync = true
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_FAILED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
    expect(await readdir(setup.libraryPath)).toEqual(["photo.png"])
  })

  it("dispose waits for an admitted preview and rejects every new image operation", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "photo.png"), PNG)
    let releaseDimensions!: () => void
    const dimensionsGate = new Promise<void>((resolve) => {
      releaseDimensions = resolve
    })
    let dimensionsStarted!: () => void
    const started = new Promise<void>((resolve) => {
      dimensionsStarted = resolve
    })
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        readDimensions: async () => {
          dimensionsStarted()
          await dimensionsGate
          return { width: 10, height: 20 }
        },
      }),
    })

    const previewing = service.preview({ path: "content/life/daily.md", name: "photo.png" })
    await started
    let disposed = false
    const disposing = service.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    await expectCode(
      service.preview({ path: "content/life/daily.md", name: "photo.png" }),
      "IMAGE_LIBRARY_FAILED",
    )
    await expectCode(
      service.copyMarkdown({ path: "content/life/daily.md", name: "photo.png" }),
      "IMAGE_LIBRARY_FAILED",
    )
    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_FAILED",
    )
    releaseDimensions()
    await previewing
    await disposing
    expect(disposed).toBe(true)
  })

  it("serializes full preview decoding globally across different notes", async () => {
    leaseProbe.immediate = true
    const first = await fixture("content/life/daily.md")
    const secondPath = "private/reading/secret.md"
    const secondNote = join(first.root, ...secondPath.split("/"))
    const secondLibrary = join(first.root, "private", "_assets", "secret")
    await mkdir(join(secondNote, ".."), { recursive: true })
    await writeFile(secondNote, "# secret\n")
    await mkdir(first.libraryPath, { recursive: true })
    await mkdir(secondLibrary, { recursive: true })
    await writeFile(join(first.libraryPath, "one.png"), PNG)
    await writeFile(join(secondLibrary, "two.png"), PNG)
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted!: () => void
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    let calls = 0
    const readDimensions = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        firstStarted()
        await firstGate
      }
      return { width: 1, height: 1 }
    })
    const service = createImageLibraryService({
      workspace: first.root,
      adapter: adapter({ readDimensions }),
    })

    const firstPreview = service.preview({ path: "content/life/daily.md", name: "one.png" })
    await started
    const secondPreview = service.preview({ path: secondPath, name: "two.png" })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(readDimensions).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([firstPreview, secondPreview])
    expect(readDimensions).toHaveBeenCalledTimes(2)
  })

  it.each(["prepared", "renamed"] as const)(
    "recovers an uncommitted %s delete journal on the next service start",
    async (phase) => {
      const setup = await fixture()
      await mkdir(setup.libraryPath, { recursive: true })
      const target = join(setup.libraryPath, "photo.png")
      await writeFile(target, PNG)
      const id = randomUUID()
      const quarantine = join(setup.libraryPath, `.garden-delete-${id}`)
      const stage = join(setup.root, ".garden-publisher", "image-delete", id)
      await mkdir(quarantine)
      await mkdir(stage, { recursive: true })
      const before = await lstat(target, { bigint: true })
      const quarantineDetails = await lstat(quarantine, { bigint: true })
      if (phase === "renamed") await rename(target, join(quarantine, "image"))
      await writeFile(
        join(stage, "manifest.json"),
        JSON.stringify({
          version: 1,
          id,
          workspace: contentHash(Buffer.from(setup.root)),
          note: "content/life/daily.md",
          name: "photo.png",
          expectedContentHash: contentHash(PNG),
          expectedIdentity: {
            dev: before.dev.toString(),
            ino: before.ino.toString(),
            size: before.size.toString(),
            mtimeNs: before.mtimeNs.toString(),
          },
          quarantineIdentity: {
            dev: quarantineDetails.dev.toString(),
            ino: quarantineDetails.ino.toString(),
            birthtimeNs: quarantineDetails.birthtimeNs.toString(),
          },
          phase,
        }),
      )

      const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
      await expect(service.open({ path: "content/life/daily.md" })).resolves.toMatchObject({
        images: [{ name: "photo.png" }],
      })
      expect(await readFile(target)).toEqual(Buffer.from(PNG))
      await expect(lstat(quarantine)).rejects.toMatchObject({ code: "ENOENT" })
      await expect(lstat(stage)).rejects.toMatchObject({ code: "ENOENT" })
      const expectedLocks = ["content/life/daily.md", "content/_assets/daily"].sort((a, b) =>
        a.localeCompare(b),
      )
      expect(leaseProbe.acquired).toEqual([...expectedLocks, ...expectedLocks])
    },
  )

  it("finishes cleanup for a committed delete journal on the next service start", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const before = await lstat(target, { bigint: true })
    const id = randomUUID()
    const quarantine = join(setup.libraryPath, `.garden-delete-${id}`)
    const stage = join(setup.root, ".garden-publisher", "image-delete", id)
    await mkdir(quarantine)
    const quarantineDetails = await lstat(quarantine, { bigint: true })
    await mkdir(stage, { recursive: true })
    await rename(target, join(quarantine, "image"))
    await writeFile(join(setup.libraryPath, ".gitkeep"), "")
    await writeFile(
      join(stage, "manifest.json"),
      JSON.stringify({
        version: 1,
        id,
        workspace: contentHash(Buffer.from(setup.root)),
        note: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
        expectedIdentity: {
          dev: before.dev.toString(),
          ino: before.ino.toString(),
          size: before.size.toString(),
          mtimeNs: before.mtimeNs.toString(),
        },
        quarantineIdentity: {
          dev: quarantineDetails.dev.toString(),
          ino: quarantineDetails.ino.toString(),
          birthtimeNs: quarantineDetails.birthtimeNs.toString(),
        },
        phase: "committed",
      }),
    )

    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expect(service.open({ path: "content/life/daily.md" })).resolves.toEqual({
      path: "content/life/daily.md",
      images: [],
    })
    await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(quarantine)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(stage)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("restores the image when the final target-absence directory sync fails", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    let failCommitSync = false
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        afterPhase: (phase) => {
          if ((phase as string) === "delete-before-commit") failCommitSync = true
        },
        syncDirectory: async (path) => {
          if (failCommitSync && path === setup.libraryPath) {
            failCommitSync = false
            throw new Error("injected final directory sync failure")
          }
        },
      }),
    })

    await expectCode(
      service.delete({
        path: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
      }),
      "IMAGE_LIBRARY_FAILED",
    )
    expect(await readFile(target)).toEqual(Buffer.from(PNG))
    expect((await readdir(setup.libraryPath)).filter((name) => name.startsWith(".garden-delete-"))).toEqual([])
  })

  it("preserves a replaced committed quarantine captured inside the journal stage", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const before = await lstat(target, { bigint: true })
    const id = randomUUID()
    const originalQuarantine = join(setup.libraryPath, `.garden-delete-${id}`)
    const stage = join(setup.root, ".garden-publisher", "image-delete", id)
    await mkdir(originalQuarantine)
    const originalDirectory = await lstat(originalQuarantine, { bigint: true })
    await mkdir(stage, { recursive: true })
    await rm(originalQuarantine, { recursive: true })
    const held = join(stage, "quarantine")
    await mkdir(held)
    await writeFile(join(held, "image"), Uint8Array.from([...PNG, 91]))
    await rm(target)
    await writeFile(join(setup.libraryPath, ".gitkeep"), "")
    await writeFile(
      join(stage, "manifest.json"),
      JSON.stringify({
        version: 1,
        id,
        workspace: contentHash(Buffer.from(setup.root)),
        note: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
        expectedIdentity: {
          dev: before.dev.toString(),
          ino: before.ino.toString(),
          size: before.size.toString(),
          mtimeNs: before.mtimeNs.toString(),
        },
        quarantineIdentity: {
          dev: originalDirectory.dev.toString(),
          ino: originalDirectory.ino.toString(),
          birthtimeNs: originalDirectory.birthtimeNs.toString(),
        },
        phase: "committed",
      }),
    )

    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    const error = await service.open({ path: "content/life/daily.md" }).catch((caught) => caught)
    expect(error).toMatchObject({ code: "IMAGE_LIBRARY_FAILED" })
    expect(await readFile(join(held, "image"))).toEqual(Buffer.from([...PNG, 91]))
  })

  it("finishes a committed journal already atomically captured for cleanup", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const target = join(setup.libraryPath, "photo.png")
    await writeFile(target, PNG)
    const before = await lstat(target, { bigint: true })
    const id = randomUUID()
    const stage = join(setup.root, ".garden-publisher", "image-delete", `${id}.cleanup`)
    const held = join(stage, "quarantine")
    await mkdir(held, { recursive: true })
    const heldDirectory = await lstat(held, { bigint: true })
    await rename(target, join(held, "image"))
    await writeFile(join(setup.libraryPath, ".gitkeep"), "")
    await writeFile(
      join(stage, "manifest.json"),
      JSON.stringify({
        version: 1,
        id,
        workspace: contentHash(Buffer.from(setup.root)),
        note: "content/life/daily.md",
        name: "photo.png",
        expectedContentHash: contentHash(PNG),
        expectedIdentity: {
          dev: before.dev.toString(),
          ino: before.ino.toString(),
          size: before.size.toString(),
          mtimeNs: before.mtimeNs.toString(),
        },
        quarantineIdentity: {
          dev: heldDirectory.dev.toString(),
          ino: heldDirectory.ino.toString(),
          birthtimeNs: heldDirectory.birthtimeNs.toString(),
        },
        phase: "committed",
      }),
    )

    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expect(service.open({ path: "content/life/daily.md" })).resolves.toEqual({
      path: "content/life/daily.md",
      images: [],
    })
    await expect(lstat(stage)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("dispose waits for active opens and prevents all later work", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "photo.png"), PNG)
    let releaseThumbnail!: () => void
    const thumbnailGate = new Promise<void>((resolve) => {
      releaseThumbnail = resolve
    })
    let thumbnailStarted!: () => void
    const started = new Promise<void>((resolve) => {
      thumbnailStarted = resolve
    })
    const renderThumbnail = vi.fn(async () => {
      thumbnailStarted()
      await thumbnailGate
      return { width: 1, height: 1, dataUrl: THUMBNAIL }
    })
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ renderThumbnail }),
    })

    const opening = service.open({ path: "content/life/daily.md" })
    await started
    let disposed = false
    const disposing = service.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    releaseThumbnail()
    await opening
    await disposing
    expect(disposed).toBe(true)
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
  })

  it("rolls back only owned empty artifacts after a failed open", async () => {
    const setup = await fixture()
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({ syncDirectory: async () => Promise.reject(new Error("sync failed")) }),
    })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    await expect(lstat(join(setup.root, "content", "_assets"))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("removes an identity-known marker when sync fails in a pre-existing slug directory", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    ownershipFault.markerSync = true
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    await expect(lstat(join(setup.libraryPath, ".gitkeep"))).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readdir(setup.libraryPath)).toEqual([])
  })

  it("retains a replaced marker and reports cleanup uncertainty after marker sync failure", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const marker = join(setup.libraryPath, ".gitkeep")
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        syncDirectory: async (path) => {
          if (path !== setup.libraryPath) return
          await rm(marker)
          await writeFile(marker, "external")
          throw new Error("marker sync failed after replacement")
        },
      }),
    })
    const error = await service.open({ path: "content/life/daily.md" }).catch((caught) => caught)
    expect(error).toMatchObject({
      code: "IMAGE_LIBRARY_FAILED",
      details: { cleanupWarnings: expect.any(Array) },
    })
    expect(await readFile(marker, "utf8")).toBe("external")
    expect(JSON.stringify(error)).not.toContain(setup.root)
  })

  it("removes a created directory when later canonical inspection fails", async () => {
    const setup = await fixture()
    const assets = join(setup.root, "content", "_assets")
    ownershipFault.afterCapturePath = assets
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    await expect(lstat(assets)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("does not delete by unresolved path when immediate directory identity capture fails", async () => {
    const setup = await fixture()
    const assets = join(setup.root, "content", "_assets")
    ownershipFault.path = assets
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    const error = await service.open({ path: "content/life/daily.md" }).catch((caught) => caught)
    expect(error).toMatchObject({
      code: "IMAGE_LIBRARY_FAILED",
      details: { cleanupWarnings: expect.any(Array) },
    })
    expect((await lstat(assets)).isDirectory()).toBe(true)
    expect(JSON.stringify(error)).not.toContain(setup.root)
  })

  it("retains external content and replacements while rolling back owned artifacts", async () => {
    const externalChild = await fixture()
    let inserted = false
    const externalService = createImageLibraryService({
      workspace: externalChild.root,
      adapter: adapter({
        syncDirectory: async (path) => {
          if (!inserted && path === externalChild.libraryPath) {
            inserted = true
            await writeFile(join(path, "foreign.txt"), "foreign")
          }
        },
      }),
    })
    await expectCode(
      externalService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_CHANGED",
    )
    expect(await readFile(join(externalChild.libraryPath, "foreign.txt"), "utf8")).toBe("foreign")

    const replacement = await fixture()
    let replaced = false
    const replacementService = createImageLibraryService({
      workspace: replacement.root,
      adapter: adapter({
        syncDirectory: async (path) => {
          if (!replaced && path === replacement.libraryPath) {
            replaced = true
            const marker = join(path, ".gitkeep")
            await rm(marker)
            await writeFile(marker, "external replacement")
          }
        },
      }),
    })
    await expectCode(
      replacementService.open({ path: "content/life/daily.md" }),
      "IMAGE_LIBRARY_CHANGED",
    )
    expect(await readFile(join(replacement.libraryPath, ".gitkeep"), "utf8")).toBe(
      "external replacement",
    )
  })

  it("reports safe cleanup uncertainty when rollback sync fails", async () => {
    const setup = await fixture()
    let calls = 0
    const service = createImageLibraryService({
      workspace: setup.root,
      adapter: adapter({
        syncDirectory: async (path) => {
          calls += 1
          if (path === setup.libraryPath) await writeFile(join(path, "foreign.txt"), "foreign")
          if (calls >= 4) throw new Error(`cleanup leak ${setup.root}`)
        },
      }),
    })
    const error = await service.open({ path: "content/life/daily.md" }).catch((caught) => caught)
    expect(error).toMatchObject({
      code: "IMAGE_LIBRARY_CHANGED",
      details: { cleanupWarnings: expect.any(Array) },
    })
    expect(JSON.stringify(error)).not.toContain(setup.root)
  })

  it("acquires canonical paths in sorted order, asserts ownership, and releases in reverse", async () => {
    const setup = await fixture()
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await service.open({ path: "content/life/daily.md" })
    const expected = ["content/life/daily.md", "content/_assets/daily"].sort((a, b) =>
      a.localeCompare(b),
    )
    expect(leaseProbe.acquired).toEqual(expected)
    expect(leaseProbe.asserted).toEqual([...expected, ...expected])
    expect(leaseProbe.released).toEqual([...expected].reverse())
  })

  it("preserves the primary error and reports lock release cleanup failures", async () => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    await writeFile(join(setup.libraryPath, "bad.txt"), "bad")
    leaseProbe.failRelease = true
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    const error = await service.open({ path: "content/life/daily.md" }).catch((caught) => caught)
    expect(code(error)).toBe("IMAGE_LIBRARY_INVALID")
    expect((error as AppError).details?.cleanupWarnings).toBeDefined()
  })

  it("turns release failure after success into a safe service failure", async () => {
    const setup = await fixture()
    leaseProbe.failRelease = true
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    expect(leaseProbe.released).toHaveLength(2)
  })

  it("disposes idempotently, rejects future calls, and keeps library content", async () => {
    const setup = await fixture()
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await service.open({ path: "content/life/daily.md" })
    await service.dispose()
    await service.dispose()
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_FAILED")
    expect(await lstat(join(setup.libraryPath, ".gitkeep"))).toMatchObject({ mode: expect.any(Number) })
  })
})
