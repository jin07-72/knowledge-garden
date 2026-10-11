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
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const UNSAFE_WINDOWS_NAME_PATTERN = /[<>:"/\\|?*]/
const WINDOWS_DEVICE_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\.|$)/i
const SLUG_PATTERN = new RegExp(`^${KEBAB_SLUG_SOURCE}$`)

function invalidImage(): AppError {
  return { code: "IMAGE_LIBRARY_INVALID", message: "The image is invalid." }
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
