import type { ImageLibraryAdapter } from "./imageLibrary"
import { readBoundedImageMetadata } from "./imageFormats"

interface DialogResult {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

interface NativeImagePort {
  isEmpty(): boolean
  getSize(): { readonly width: number; readonly height: number }
  resize(options: {
    readonly width: number
    readonly height: number
    readonly quality: "good"
  }): { isEmpty?(): boolean; toDataURL(): string }
}

interface ElectronImageLibraryDependencies<Window> {
  readonly getWindow: () => Window | undefined
  readonly showOpenDialog: (window: Window, options: ImageDialogOptions) => Promise<DialogResult>
  readonly createImageFromBuffer: (bytes: Buffer) => NativeImagePort
  readonly writeClipboard: (text: string) => void
}

interface ImageDialogOptions {
  properties: ["openFile", "multiSelections"]
  filters: [
    {
      name: "图片"
      extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"]
    },
  ]
}

const dialogOptions: ImageDialogOptions = {
  properties: ["openFile", "multiSelections"],
  filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
}

function decodedImage(image: NativeImagePort): NativeImagePort {
  if (image.isEmpty()) throw new Error("The selected image could not be decoded.")
  const { width, height } = image.getSize()
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0)
    throw new Error("The selected image could not be decoded.")
  return image
}

export function createElectronImageLibraryAdapter<Window>(
  dependencies: ElectronImageLibraryDependencies<Window>,
): ImageLibraryAdapter {
  const createImage = (bytes: Uint8Array): NativeImagePort => {
    readBoundedImageMetadata(bytes)
    return decodedImage(dependencies.createImageFromBuffer(Buffer.from(bytes)))
  }
  return {
    chooseImages: async () => {
      const window = dependencies.getWindow()
      if (window === undefined) return undefined
      const result = await dependencies.showOpenDialog(window, dialogOptions)
      return result.canceled ? undefined : result.filePaths
    },
    renderThumbnail: async (bytes) => {
      const image = createImage(bytes)
      const { width, height } = image.getSize()
      const thumbnail = image.resize({ width: 320, height: 240, quality: "good" })
      if (thumbnail.isEmpty?.()) throw new Error("The selected image could not be decoded.")
      return { width, height, dataUrl: thumbnail.toDataURL() }
    },
    readDimensions: async (bytes) => createImage(bytes).getSize(),
    writeClipboard: (text) => dependencies.writeClipboard(text),
  }
}
