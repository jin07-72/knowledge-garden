import {
  IMAGE_LIBRARY_MAX_NAME_LENGTH,
  KEBAB_SLUG_SOURCE,
  type AppError,
} from "../../shared/contracts"

export type ImageFormat =
  | { readonly extension: ".png"; readonly mime: "image/png" }
  | { readonly extension: ".jpg"; readonly mime: "image/jpeg" }
  | { readonly extension: ".jpeg"; readonly mime: "image/jpeg" }
  | { readonly extension: ".gif"; readonly mime: "image/gif" }
  | { readonly extension: ".webp"; readonly mime: "image/webp" }
  | { readonly extension: ".avif"; readonly mime: "image/avif" }

type Signature = "png" | "jpeg" | "gif" | "webp" | "avif"
type FormatDefinition = ImageFormat & { readonly signature: Signature }

const IMAGE_FORMATS: readonly FormatDefinition[] = Object.freeze([
  Object.freeze({ extension: ".png", mime: "image/png", signature: "png" }),
  Object.freeze({ extension: ".jpg", mime: "image/jpeg", signature: "jpeg" }),
  Object.freeze({ extension: ".jpeg", mime: "image/jpeg", signature: "jpeg" }),
  Object.freeze({ extension: ".gif", mime: "image/gif", signature: "gif" }),
  Object.freeze({ extension: ".webp", mime: "image/webp", signature: "webp" }),
  Object.freeze({ extension: ".avif", mime: "image/avif", signature: "avif" }),
])

// Product validation bound: compatible-brand parsing never scans more than one 64 KiB ftyp box.
const AVIF_MAX_FTYP_BOX_BYTES = 64 * 1024
const IMAGE_METADATA_SCAN_BYTES = 1024 * 1024
export const IMAGE_MAX_DECODED_DIMENSION = 16_384
export const IMAGE_MAX_DECODED_PIXELS = 40_000_000
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const UNSAFE_WINDOWS_NAME_PATTERN = /[<>:"/\\|?*]/
const WINDOWS_DEVICE_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\.|$)/i
const SLUG_PATTERN = new RegExp(`^${KEBAB_SLUG_SOURCE}$`)

function invalidImage(): AppError {
  return { code: "IMAGE_LIBRARY_INVALID", message: "The image is invalid." }
}

function imageTooLarge(): AppError {
  return { code: "IMAGE_LIBRARY_TOO_LARGE", message: "The image dimensions are too large." }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((value, index) => bytes[index] === value)
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function uint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_0000 +
    bytes[offset + 3] * 0x1_000000
  )
}

function uint64(bytes: Uint8Array, offset: number): number | undefined {
  const high = uint32(bytes, offset)
  if (high > 0x1f_ffff) return undefined
  return high * 0x1_0000_0000 + uint32(bytes, offset + 4)
}

function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !hasAscii(bytes, 4, "ftyp")) return false
  const shortSize = uint32(bytes, 0)
  const extended = shortSize === 1
  if (extended && bytes.length < 24) return false
  const boxSize = shortSize === 0 ? bytes.length : extended ? uint64(bytes, 8) : shortSize
  if (boxSize === undefined) return false
  const majorBrandOffset = extended ? 16 : 8
  const compatibleBrandsOffset = extended ? 24 : 16
  if (
    boxSize < compatibleBrandsOffset ||
    boxSize > AVIF_MAX_FTYP_BOX_BYTES ||
    boxSize > bytes.length ||
    (boxSize - compatibleBrandsOffset) % 4 !== 0
  )
    return false
  if (
    hasAscii(bytes, majorBrandOffset, "avif") ||
    hasAscii(bytes, majorBrandOffset, "avis")
  )
    return true
  for (let offset = compatibleBrandsOffset; offset < boxSize; offset += 4) {
    if (hasAscii(bytes, offset, "avif") || hasAscii(bytes, offset, "avis")) return true
  }
  return false
}

function matchesSignature(bytes: Uint8Array, signature: Signature): boolean {
  switch (signature) {
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case "gif":
      return hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a")
    case "webp":
      return hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")
    case "avif":
      return isAvif(bytes)
  }
}

export interface BoundedImageMetadata {
  readonly width: number
  readonly height: number
  readonly mime: ImageFormat["mime"]
}

function boundedDimensions(
  width: number,
  height: number,
  mime: ImageFormat["mime"],
): BoundedImageMetadata {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw invalidImage()
  if (
    width > IMAGE_MAX_DECODED_DIMENSION ||
    height > IMAGE_MAX_DECODED_DIMENSION ||
    width > Math.floor(IMAGE_MAX_DECODED_PIXELS / height)
  )
    throw imageTooLarge()
  return { width, height, mime }
}

function pngMetadata(bytes: Uint8Array): BoundedImageMetadata {
  if (bytes.length < 29 || uint32(bytes, 8) !== 13 || !hasAscii(bytes, 12, "IHDR"))
    throw invalidImage()
  return boundedDimensions(uint32(bytes, 16), uint32(bytes, 20), "image/png")
}

const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function jpegMetadata(bytes: Uint8Array): BoundedImageMetadata {
  const limit = Math.min(bytes.length, IMAGE_METADATA_SCAN_BYTES)
  let offset = 2
  while (offset < limit) {
    while (offset < limit && bytes[offset] !== 0xff) offset += 1
    while (offset < limit && bytes[offset] === 0xff) offset += 1
    if (offset >= limit) break
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (offset + 2 > limit) throw invalidImage()
    const length = uint16(bytes, offset)
    if (length < 2 || offset + length > limit || offset + length > bytes.length)
      throw invalidImage()
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 7) throw invalidImage()
      return boundedDimensions(uint16(bytes, offset + 5), uint16(bytes, offset + 3), "image/jpeg")
    }
    offset += length
  }
  throw invalidImage()
}

function gifMetadata(bytes: Uint8Array): BoundedImageMetadata {
  if (bytes.length < 10) throw invalidImage()
  return boundedDimensions(uint16LittleEndian(bytes, 6), uint16LittleEndian(bytes, 8), "image/gif")
}

function webpMetadata(bytes: Uint8Array): BoundedImageMetadata {
  if (bytes.length < 20) throw invalidImage()
  const riffEnd = uint32LittleEndian(bytes, 4) + 8
  if (!Number.isSafeInteger(riffEnd) || riffEnd < 20 || riffEnd > bytes.length) throw invalidImage()
  const limit = Math.min(riffEnd, IMAGE_METADATA_SCAN_BYTES)
  let offset = 12
  while (offset + 8 <= limit) {
    const size = uint32LittleEndian(bytes, offset + 4)
    const data = offset + 8
    const end = data + size
    if (!Number.isSafeInteger(end) || end > riffEnd || end > limit) throw invalidImage()
    if (hasAscii(bytes, offset, "VP8X")) {
      if (size !== 10) throw invalidImage()
      return boundedDimensions(
        uint24LittleEndian(bytes, data + 4) + 1,
        uint24LittleEndian(bytes, data + 7) + 1,
        "image/webp",
      )
    }
    if (hasAscii(bytes, offset, "VP8 ")) {
      if (size < 10 || !startsWith(bytes.subarray(data + 3), [0x9d, 0x01, 0x2a]))
        throw invalidImage()
      return boundedDimensions(
        uint16LittleEndian(bytes, data + 6) & 0x3fff,
        uint16LittleEndian(bytes, data + 8) & 0x3fff,
        "image/webp",
      )
    }
    if (hasAscii(bytes, offset, "VP8L")) {
      if (size < 5 || bytes[data] !== 0x2f) throw invalidImage()
      const bits = uint32LittleEndian(bytes, data + 1)
      return boundedDimensions(
        (bits & 0x3fff) + 1,
        (Math.floor(bits / 0x4000) & 0x3fff) + 1,
        "image/webp",
      )
    }
    offset = end + (size & 1)
  }
  throw invalidImage()
}

interface IsoBox {
  readonly type: string
  readonly data: number
  readonly end: number
}

function isoBox(bytes: Uint8Array, offset: number, parentEnd: number): IsoBox {
  if (offset + 8 > parentEnd || offset + 8 > bytes.length) throw invalidImage()
  const shortSize = uint32(bytes, offset)
  let header = 8
  let size: number | undefined = shortSize
  if (shortSize === 1) {
    if (offset + 16 > parentEnd || offset + 16 > bytes.length) throw invalidImage()
    header = 16
    size = uint64(bytes, offset + 8)
  } else if (shortSize === 0) size = parentEnd - offset
  if (
    size === undefined ||
    !Number.isSafeInteger(size) ||
    size < header ||
    offset + size > parentEnd ||
    offset + size > bytes.length
  )
    throw invalidImage()
  return {
    type: String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    ),
    data: offset + header,
    end: offset + size,
  }
}

function collectAvifDimensions(
  bytes: Uint8Array,
  start: number,
  end: number,
  container: "top" | "meta" | "iprp" | "ipco",
  found: Array<{ width: number; height: number }>,
): void {
  let offset = start
  while (offset < end) {
    const box = isoBox(bytes, offset, end)
    if (box.end <= offset) throw invalidImage()
    if (container === "top" && box.type === "meta") {
      if (box.data + 4 > box.end) throw invalidImage()
      collectAvifDimensions(bytes, box.data + 4, box.end, "meta", found)
    } else if (container === "meta" && box.type === "iprp") {
      collectAvifDimensions(bytes, box.data, box.end, "iprp", found)
    } else if (container === "iprp" && box.type === "ipco") {
      collectAvifDimensions(bytes, box.data, box.end, "ipco", found)
    } else if (container === "ipco" && box.type === "ispe") {
      if (box.data + 12 !== box.end) throw invalidImage()
      found.push({ width: uint32(bytes, box.data + 4), height: uint32(bytes, box.data + 8) })
    }
    offset = box.end
  }
  if (offset !== end) throw invalidImage()
}

function avifMetadata(bytes: Uint8Array): BoundedImageMetadata {
  const limit = Math.min(bytes.length, IMAGE_METADATA_SCAN_BYTES)
  const found: Array<{ width: number; height: number }> = []
  collectAvifDimensions(bytes, 0, limit, "top", found)
  if (found.length === 0) throw invalidImage()
  let maximum = boundedDimensions(found[0].width, found[0].height, "image/avif")
  for (const dimensions of found.slice(1)) {
    const candidate = boundedDimensions(dimensions.width, dimensions.height, "image/avif")
    if (candidate.width * candidate.height > maximum.width * maximum.height) maximum = candidate
  }
  return maximum
}

/** Reads only bounded container metadata and never invokes an image decoder. */
export function readBoundedImageMetadata(bytes: Uint8Array): BoundedImageMetadata {
  if (matchesSignature(bytes, "png")) return pngMetadata(bytes)
  if (matchesSignature(bytes, "jpeg")) return jpegMetadata(bytes)
  if (matchesSignature(bytes, "gif")) return gifMetadata(bytes)
  if (matchesSignature(bytes, "webp")) return webpMetadata(bytes)
  if (matchesSignature(bytes, "avif")) return avifMetadata(bytes)
  throw invalidImage()
}

function formatForName(name: string): FormatDefinition | undefined {
  const lowerName = name.toLowerCase()
  return IMAGE_FORMATS.find(({ extension }) => lowerName.endsWith(extension))
}

function imageFormat(format: FormatDefinition): ImageFormat {
  switch (format.extension) {
    case ".png":
      return { extension: format.extension, mime: format.mime }
    case ".jpg":
      return { extension: format.extension, mime: format.mime }
    case ".jpeg":
      return { extension: format.extension, mime: format.mime }
    case ".gif":
      return { extension: format.extension, mime: format.mime }
    case ".webp":
      return { extension: format.extension, mime: format.mime }
    case ".avif":
      return { extension: format.extension, mime: format.mime }
  }
}

export function normalizeImageName(name: string): string {
  const format = formatForName(name)
  if (
    name.length === 0 ||
    name.length > IMAGE_LIBRARY_MAX_NAME_LENGTH ||
    format === undefined ||
    name.length === format.extension.length ||
    name === "." ||
    name === ".." ||
    UNSAFE_WINDOWS_NAME_PATTERN.test(name) ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    /[. ]$/.test(name) ||
    WINDOWS_DEVICE_NAME_PATTERN.test(name)
  )
    throw invalidImage()
  return name
}

export function detectImageFormat(bytes: Uint8Array, name: string): ImageFormat {
  const safeName = normalizeImageName(name)
  const format = formatForName(safeName)
  if (format === undefined || !matchesSignature(bytes, format.signature)) throw invalidImage()
  return imageFormat(format)
}

export function markdownForImage(slug: string, name: string): string {
  if (!SLUG_PATTERN.test(slug)) throw invalidImage()
  const safeName = normalizeImageName(name)
  const format = formatForName(safeName)
  if (format === undefined) throw invalidImage()
  const stem = safeName.slice(0, -format.extension.length)
  const alt = stem.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
  const destinationName = safeName.replace(/%/g, "%25").replace(/#/g, "%23")
  return `![${alt}](<../_assets/${slug}/${destinationName}>)`
}

export function imageDataUrl(mime: ImageFormat["mime"], bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
}
