import { describe, expect, it, vi } from "vitest"
import { createElectronImageLibraryAdapter } from "../../src/main/services/imageLibraryElectron"

const pngHeader = (width: number, height: number) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    8,
    2,
    0,
    0,
    0,
  ])

const pngDimensions = (width: number, height: number) =>
  Uint8Array.from([
    ...pngHeader(width, height),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0x49,
    0x44,
    0x41,
    0x54,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x49,
    0x45,
    0x4e,
    0x44,
    0,
    0,
    0,
    0,
  ])

const truncatedImageInputs = [
  ["PNG", pngHeader(640, 480)],
  [
    "JPEG",
    Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      4,
      0,
      0,
      0xff,
      0xc0,
      0,
      11,
      8,
      1,
      0xe0,
      2,
      0x80,
      1,
      1,
      0x11,
      0,
    ]),
  ],
  ["GIF", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 2, 0xe0, 1, 0, 0, 0])],
  [
    "WebP",
    Uint8Array.from([
      0x52,
      0x49,
      0x46,
      0x46,
      22,
      0,
      0,
      0,
      0x57,
      0x45,
      0x42,
      0x50,
      0x56,
      0x50,
      0x38,
      0x58,
      10,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x7f,
      2,
      0,
      0xdf,
      1,
      0,
    ]),
  ],
  [
    "AVIF",
    Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]),
  ],
] as const

function nativeImage(options?: { empty?: boolean }) {
  const thumbnail = { toDataURL: vi.fn(() => "data:image/png;base64,iVBORw0KGgo=") }
  return {
    isEmpty: vi.fn(() => options?.empty ?? false),
    getSize: vi.fn(() => ({ width: 640, height: 480 })),
    resize: vi.fn(() => thumbnail),
    thumbnail,
  }
}

describe("Electron image library adapter", () => {
  it("uses the live window as parent and maps cancellation without exposing paths elsewhere", async () => {
    const window = { id: 7 }
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({ canceled: true, filePaths: ["C:/secret.png"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["C:/photo.png", "C:/图.png"] })
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => window,
      showOpenDialog,
      createImageFromBuffer: vi.fn(() => nativeImage()),
      writeClipboard: vi.fn(),
    })

    await expect(adapter.chooseImages()).resolves.toBeUndefined()
    await expect(adapter.chooseImages()).resolves.toEqual(["C:/photo.png", "C:/图.png"])
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, window, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
    })
  })

  it("does not open an unparented chooser when no live window exists", async () => {
    const showOpenDialog = vi.fn()
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog,
      createImageFromBuffer: vi.fn(() => nativeImage()),
      writeClipboard: vi.fn(),
    })
    await expect(adapter.chooseImages()).resolves.toBeUndefined()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it("renders bounded thumbnails, reads dimensions, and writes clipboard text", async () => {
    const image = nativeImage()
    const createImageFromBuffer = vi.fn(() => image)
    const writeClipboard = vi.fn()
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer,
      writeClipboard,
    })
    const bytes = pngDimensions(640, 480)

    await expect(adapter.renderThumbnail(bytes)).resolves.toEqual({
      width: 640,
      height: 480,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    })
    await expect(adapter.readDimensions(bytes)).resolves.toEqual({ width: 640, height: 480 })
    expect(image.resize).toHaveBeenCalledWith({ width: 320, height: 240, quality: "good" })
    adapter.writeClipboard("![cover](<../_assets/daily/cover.png>)")
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith(
      "![cover](<../_assets/daily/cover.png>)",
    )
    expect(createImageFromBuffer).toHaveBeenCalledTimes(2)
  })

  it("rejects oversized metadata before nativeImage receives any bytes", async () => {
    const createImageFromBuffer = vi.fn(() => nativeImage())
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer,
      writeClipboard: vi.fn(),
    })

    await expect(adapter.renderThumbnail(pngDimensions(10_000, 4_001))).rejects.toMatchObject({
      code: "IMAGE_LIBRARY_TOO_LARGE",
    })
    await expect(adapter.readDimensions(pngDimensions(0xffff_ffff, 1))).rejects.toMatchObject({
      code: "IMAGE_LIBRARY_TOO_LARGE",
    })
    expect(createImageFromBuffer).not.toHaveBeenCalled()
  })

  it("rejects zero-sized and malformed metadata before nativeImage receives any bytes", async () => {
    const createImageFromBuffer = vi.fn(() => nativeImage())
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer,
      writeClipboard: vi.fn(),
    })

    await expect(adapter.renderThumbnail(pngDimensions(0, 480))).rejects.toMatchObject({
      code: "IMAGE_LIBRARY_INVALID",
    })
    await expect(
      adapter.readDimensions(pngDimensions(640, 480).subarray(0, 28)),
    ).rejects.toMatchObject({
      code: "IMAGE_LIBRARY_INVALID",
    })
    expect(createImageFromBuffer).not.toHaveBeenCalled()
  })

  it.each(truncatedImageInputs)(
    "rejects a truncated %s before nativeImage receives any bytes",
    async (_format, input) => {
    const createImageFromBuffer = vi.fn(() => nativeImage())
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer,
      writeClipboard: vi.fn(),
    })

    await expect(adapter.renderThumbnail(input)).rejects.toMatchObject({
      code: "IMAGE_LIBRARY_INVALID",
    })
    expect(createImageFromBuffer).not.toHaveBeenCalled()
    },
  )

  it("allows the exact pixel budget before native decode", async () => {
    const image = nativeImage()
    const createImageFromBuffer = vi.fn(() => image)
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer,
      writeClipboard: vi.fn(),
    })
    await expect(adapter.readDimensions(pngDimensions(10_000, 4_000))).resolves.toEqual({
      width: 640,
      height: 480,
    })
    expect(createImageFromBuffer).toHaveBeenCalledOnce()
  })

  it("rejects empty native images before dimensions or data URLs are used", async () => {
    const image = nativeImage({ empty: true })
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer: vi.fn(() => image),
      writeClipboard: vi.fn(),
    })
    await expect(adapter.renderThumbnail(pngDimensions(1, 1))).rejects.toThrow(
      "The selected image could not be decoded.",
    )
    await expect(adapter.readDimensions(pngDimensions(1, 1))).rejects.toThrow(
      "The selected image could not be decoded.",
    )
    expect(image.getSize).not.toHaveBeenCalled()
  })
})
