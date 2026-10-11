import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
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

const leaseProbe = vi.hoisted(() => ({
  acquired: [] as string[],
  asserted: [] as string[],
  released: [] as string[],
  failRelease: false,
}))

vi.mock("../../src/main/services/noteFiles", async (load) => {
  const actual = await load<typeof import("../../src/main/services/noteFiles")>()
  return {
    ...actual,
    async acquireInternalNotePathLease(
      ...args: Parameters<typeof actual.acquireInternalNotePathLease>
    ) {
      const path = args[1]
      leaseProbe.acquired.push(path)
      const lease = await actual.acquireInternalNotePathLease(...args)
      return {
        lockId: lease.lockId,
        async assertOwned() {
          leaseProbe.asserted.push(path)
          await lease.assertOwned()
        },
        async release() {
          leaseProbe.released.push(path)
          await lease.release()
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
const THUMBNAIL = `data:image/png;base64,${Buffer.from("thumb").toString("base64")}`

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

beforeEach(() => {
  leaseProbe.acquired.length = 0
  leaseProbe.asserted.length = 0
  leaseProbe.released.length = 0
  leaseProbe.failRelease = false
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

  it("rejects a missing, directory, or symlink note", async ({ skip }) => {
    const setup = await fixture()
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/missing.md" }), "IMAGE_LIBRARY_INVALID")

    await mkdir(join(setup.root, "content", "life", "folder.md"))
    await expectCode(service.open({ path: "content/life/folder.md" }), "IMAGE_LIBRARY_INVALID")

    const target = join(setup.root, "content", "life", "target.md")
    const linked = join(setup.root, "content", "life", "linked.md")
    await writeFile(target, "# target")
    try {
      await symlink(target, linked, "file")
    } catch {
      skip()
      return
    }
    await expectCode(service.open({ path: "content/life/linked.md" }), "IMAGE_LIBRARY_UNSAFE")
  })

  it("requires an absolute canonical workspace directory", async () => {
    const setup = await fixture()
    const relativeService = createImageLibraryService({ workspace: ".", adapter: adapter() })
    await expectCode(relativeService.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_INVALID")

    const alias = `${setup.root}-alias`
    cleanups.push(alias)
    try {
      await symlink(setup.root, alias, process.platform === "win32" ? "junction" : "dir")
    } catch {
      return
    }
    const aliasService = createImageLibraryService({ workspace: alias, adapter: adapter() })
    await expectCode(aliasService.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_UNSAFE")
  })

  it.each(["content", "content/_assets", "content/_assets/daily"])(
    "rejects a linked %s ancestor",
    async (relative) => {
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
      try {
        await symlink(outside, target, process.platform === "win32" ? "junction" : "dir")
      } catch {
        return
      }
      const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
      await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_UNSAFE")
    },
  )

  it("rejects unknown, nested, symlinked, corrupt, and unsafe entries", async ({ skip }) => {
    const cases: Array<() => Promise<void>> = [
      async () => writeFile(join(current!.libraryPath, "notes.txt"), "not an image"),
      async () => mkdir(join(current!.libraryPath, "nested")),
      async () => writeFile(join(current!.libraryPath, "bad.png"), "corrupt"),
      async () => writeFile(join(current!.libraryPath, ".png"), PNG),
      async () => {
        const outside = join(current!.root, "outside.png")
        await writeFile(outside, PNG)
        await symlink(outside, join(current!.libraryPath, "linked.png"), "file")
      },
    ]
    let current: Fixture | undefined
    for (let index = 0; index < cases.length; index += 1) {
      current = await fixture()
      await mkdir(current.libraryPath, { recursive: true })
      try {
        await cases[index]!()
      } catch {
        if (index === cases.length - 1) {
          skip()
          return
        }
        throw new Error("fixture setup failed")
      }
      const service = createImageLibraryService({ workspace: current.root, adapter: adapter() })
      await expectCode(
        service.open({ path: "content/life/daily.md" }),
        index === 4 ? "IMAGE_LIBRARY_UNSAFE" : "IMAGE_LIBRARY_INVALID",
      )
    }
  })

  it("rejects a nonempty or linked marker instead of replacing it", async ({ skip }) => {
    const setup = await fixture()
    await mkdir(setup.libraryPath, { recursive: true })
    const marker = join(setup.libraryPath, ".gitkeep")
    await writeFile(marker, "foreign")
    const service = createImageLibraryService({ workspace: setup.root, adapter: adapter() })
    await expectCode(service.open({ path: "content/life/daily.md" }), "IMAGE_LIBRARY_INVALID")
    expect(await readFile(marker, "utf8")).toBe("foreign")

    await rm(marker)
    const outside = join(setup.root, "outside-marker")
    await writeFile(outside, "")
    try {
      await symlink(outside, marker, "file")
    } catch {
      skip()
      return
    }
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
    const largeThumbnail = `data:image/png;base64,${Buffer.alloc(payloadBytes).toString("base64")}`
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
