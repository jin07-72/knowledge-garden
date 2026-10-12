import { describe, expect, it, vi } from "vitest"
import { createElectronImageLibraryAdapter } from "../../src/main/services/imageLibraryElectron"

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
    const bytes = Uint8Array.from([1, 2, 3])

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

  it("rejects empty native images before dimensions or data URLs are used", async () => {
    const image = nativeImage({ empty: true })
    const adapter = createElectronImageLibraryAdapter({
      getWindow: () => undefined,
      showOpenDialog: vi.fn(),
      createImageFromBuffer: vi.fn(() => image),
      writeClipboard: vi.fn(),
    })
    await expect(adapter.renderThumbnail(Uint8Array.from([1]))).rejects.toThrow(
      "The selected image could not be decoded.",
    )
    await expect(adapter.readDimensions(Uint8Array.from([1]))).rejects.toThrow(
      "The selected image could not be decoded.",
    )
    expect(image.getSize).not.toHaveBeenCalled()
  })
})
