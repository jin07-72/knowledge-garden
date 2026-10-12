import { describe, expect, it } from "vitest"
import {
  detectImageFormat,
  IMAGE_MAX_DECODED_DIMENSION,
  IMAGE_MAX_DECODED_PIXELS,
  imageDataUrl,
  markdownForImage,
  normalizeImageName,
  readBoundedImageMetadata,
  type ImageFormat,
} from "../../src/main/services/imageFormats"

// @ts-expect-error Image extensions and MIME types must remain exact pairs.
const mismatchedImageFormat: ImageFormat = { extension: ".png", mime: "image/jpeg" }
void mismatchedImageFormat

const ascii = (value: string) => Uint8Array.from(Buffer.from(value, "ascii"))
const bytes = (...values: number[]) => Uint8Array.from(values)
const append = (...parts: readonly Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]))
const uint32Bytes = (value: number) =>
  bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
const uint32LittleEndian = (value: number) =>
  bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)

function pngDimensions(width: number, height: number): Uint8Array {
  return append(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    uint32Bytes(13),
    ascii("IHDR"),
    uint32Bytes(width),
    uint32Bytes(height),
    bytes(8, 2, 0, 0, 0),
  )
}

function jpegDimensions(width: number, height: number): Uint8Array {
  return append(
    bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00),
    bytes(0xff, 0xc0, 0x00, 0x0b, 0x08, (height >>> 8) & 0xff, height & 0xff),
    bytes((width >>> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00),
  )
}

function gifDimensions(width: number, height: number): Uint8Array {
  return append(ascii("GIF89a"), bytes(width & 0xff, width >>> 8, height & 0xff, height >>> 8))
}

function webpDimensions(width: number, height: number): Uint8Array {
  return append(
    ascii("RIFF"),
    uint32LittleEndian(22),
    ascii("WEBPVP8X"),
    uint32LittleEndian(10),
    bytes(0, 0, 0, 0),
    bytes((width - 1) & 0xff, ((width - 1) >>> 8) & 0xff, ((width - 1) >>> 16) & 0xff),
    bytes((height - 1) & 0xff, ((height - 1) >>> 8) & 0xff, ((height - 1) >>> 16) & 0xff),
  )
}

function avifDimensions(width: number, height: number): Uint8Array {
  const ispe = append(
    uint32Bytes(20),
    ascii("ispe"),
    bytes(0, 0, 0, 0),
    uint32Bytes(width),
    uint32Bytes(height),
  )
  const ipco = append(uint32Bytes(8 + ispe.length), ascii("ipco"), ispe)
  const iprp = append(uint32Bytes(8 + ipco.length), ascii("iprp"), ipco)
  const meta = append(uint32Bytes(12 + iprp.length), ascii("meta"), bytes(0, 0, 0, 0), iprp)
  return append(avifHeader("avif"), meta)
}

function avifHeader(
  majorBrand: "avif" | "avis" | "mif1" = "avif",
  compatibleBrands: readonly string[] = [],
): Uint8Array {
  const size = 16 + compatibleBrands.length * 4
  return append(
    bytes((size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
    ascii("ftyp"),
    ascii(majorBrand),
    bytes(0, 0, 0, 0),
    ...compatibleBrands.map(ascii),
  )
}

function extendedAvifHeader(
  majorBrand: "avif" | "avis" | "mif1" = "avif",
  compatibleBrands: readonly string[] = [],
): Uint8Array {
  const size = 24 + compatibleBrands.length * 4
  return append(
    uint32Bytes(1),
    ascii("ftyp"),
    uint32Bytes(Math.floor(size / 0x1_0000_0000)),
    uint32Bytes(size),
    ascii(majorBrand),
    bytes(0, 0, 0, 0),
    ...compatibleBrands.map(ascii),
  )
}

function expectInvalid(run: () => unknown): void {
  expect(run).toThrow(expect.objectContaining({ code: "IMAGE_LIBRARY_INVALID" }))
}

describe("image format detection", () => {
  const cases: readonly [string, Uint8Array, ImageFormat][] = [
    [
      "photo.png",
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      { extension: ".png", mime: "image/png" },
    ],
    ["photo.jpg", bytes(0xff, 0xd8, 0xff), { extension: ".jpg", mime: "image/jpeg" }],
    ["photo.jpeg", bytes(0xff, 0xd8, 0xff), { extension: ".jpeg", mime: "image/jpeg" }],
    ["animation.gif", ascii("GIF87a"), { extension: ".gif", mime: "image/gif" }],
    ["animation.gif", ascii("GIF89a"), { extension: ".gif", mime: "image/gif" }],
    [
      "photo.webp",
      append(ascii("RIFF"), bytes(0x11, 0x22, 0x33, 0x44), ascii("WEBP")),
      { extension: ".webp", mime: "image/webp" },
    ],
    ["photo.avif", avifHeader("avif"), { extension: ".avif", mime: "image/avif" }],
    ["sequence.avif", avifHeader("avis"), { extension: ".avif", mime: "image/avif" }],
    [
      "compatible.avif",
      avifHeader("mif1", ["miaf", "avif"]),
      { extension: ".avif", mime: "image/avif" },
    ],
  ]

  it.each(cases)("recognizes %s from its exact signature", (name, header, expected) => {
    expect(detectImageFormat(header, name)).toEqual(expected)
  })

  it("accepts supported extensions case-insensitively and normalizes the result", () => {
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff), "Portrait.JpEg")).toEqual({
      extension: ".jpeg",
      mime: "image/jpeg",
    })
  })

  it("detects signatures in Uint8Array views with a nonzero byte offset", () => {
    const backing = bytes(0xaa, 0xbb, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xcc)
    expect(detectImageFormat(backing.subarray(2, 10), "offset.png")).toEqual({
      extension: ".png",
      mime: "image/png",
    })
  })

  it("rejects truncated and near-match signatures", () => {
    for (const [name, header] of [
      ["photo.png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)],
      ["photo.jpg", bytes(0xff, 0xd8)],
      ["photo.gif", ascii("GIF89")],
      ["photo.webp", append(ascii("RIFF"), bytes(0, 0, 0), ascii("WEBP"))],
      ["photo.avif", avifHeader("avif").slice(0, 15)],
      ["photo.png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b)],
      ["photo.gif", ascii("GIF88a")],
    ] as const)
      expectInvalid(() => detectImageFormat(header, name))
  })

  it("rejects extension/signature mismatches and unsupported extensions", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    expectInvalid(() => detectImageFormat(png, "photo.jpg"))
    expectInvalid(() => detectImageFormat(png, "photo.svg"))
    expectInvalid(() => detectImageFormat(png, "photo"))
  })

  it("accepts normal, extended-size, and box-to-end AVIF ftyp layouts", () => {
    const normalOver512 = avifHeader(
      "mif1",
      Array.from({ length: 126 }, (_, index) => (index === 125 ? "avif" : "miaf")),
    )
    const extended = extendedAvifHeader("mif1", ["miaf", "avis"])
    const toEnd = avifHeader("mif1", ["avif"])
    toEnd.set(uint32Bytes(0), 0)

    expect(normalOver512).toHaveLength(520)
    for (const header of [normalOver512, extended, toEnd])
      expect(detectImageFormat(header, "photo.avif")).toEqual({
        extension: ".avif",
        mime: "image/avif",
      })
  })

  it("finds a compatible AVIF brand near the 64 KiB validation bound", () => {
    const compatibleBrands = Array.from({ length: 16_380 }, (_, index) =>
      index === 16_379 ? "avif" : "miaf",
    )
    const header = avifHeader("mif1", compatibleBrands)

    expect(header).toHaveLength(64 * 1024)
    expect(detectImageFormat(header, "bounded.avif")).toEqual({
      extension: ".avif",
      mime: "image/avif",
    })
  })

  it("rejects AVIF brands outside the declared leading ftyp box", () => {
    const strayBrand = append(
      bytes(0, 0, 0, 16),
      ascii("free"),
      ascii("mif1"),
      bytes(0, 0, 0, 0),
      ascii("avif"),
    )
    const outOfBoundsBrand = append(
      bytes(0, 0, 0, 16),
      ascii("ftyp"),
      ascii("mif1"),
      bytes(0, 0, 0, 0),
      ascii("avif"),
    )
    for (const header of [strayBrand, outOfBoundsBrand])
      expectInvalid(() => detectImageFormat(header, "photo.avif"))
  })

  it("rejects truncated, undersized, and unaligned AVIF ftyp boxes", () => {
    const normalTruncated = avifHeader("mif1", ["avif"])
    normalTruncated.set(uint32Bytes(normalTruncated.length + 4), 0)
    const extendedTruncated = extendedAvifHeader("mif1", ["avif"])
    extendedTruncated.set(uint32Bytes(extendedTruncated.length + 4), 12)
    const undersized = append(uint32Bytes(12), ascii("ftyp"), ascii("avif"), bytes(0, 0, 0, 0))
    const unaligned = append(
      uint32Bytes(17),
      ascii("ftyp"),
      ascii("avif"),
      bytes(0, 0, 0, 0, 0),
    )

    for (const header of [normalTruncated, extendedTruncated, undersized, unaligned])
      expectInvalid(() => detectImageFormat(header, "photo.avif"))
  })

  it("rejects AVIF ftyp boxes beyond the product bound or safe integer range", () => {
    const beyondBound = new Uint8Array(64 * 1024 + 4)
    beyondBound.set(uint32Bytes(beyondBound.length), 0)
    beyondBound.set(ascii("ftyp"), 4)
    beyondBound.set(ascii("avif"), 8)
    const unsafeExtendedSize = append(
      uint32Bytes(1),
      ascii("ftyp"),
      bytes(0x00, 0x20, 0x00, 0x00, 0, 0, 0, 0),
      ascii("avif"),
      bytes(0, 0, 0, 0),
    )

    for (const header of [beyondBound, unsafeExtendedSize])
      expectInvalid(() => detectImageFormat(header, "photo.avif"))
  })
})

describe("bounded image metadata", () => {
  it.each([
    ["PNG", pngDimensions(640, 480), "image/png"],
    ["JPEG", jpegDimensions(640, 480), "image/jpeg"],
    ["GIF", gifDimensions(640, 480), "image/gif"],
    ["animated WebP canvas", webpDimensions(640, 480), "image/webp"],
    ["AVIF item property", avifDimensions(640, 480), "image/avif"],
  ] as const)("reads %s dimensions without a decoder", (_label, input, mime) => {
    expect(readBoundedImageMetadata(input)).toEqual({ width: 640, height: 480, mime })
  })

  it("accepts the exact pixel budget and rejects the next pixel row", () => {
    expect(IMAGE_MAX_DECODED_PIXELS).toBe(40_000_000)
    expect(readBoundedImageMetadata(pngDimensions(10_000, 4_000))).toMatchObject({
      width: 10_000,
      height: 4_000,
    })
    expect(() => readBoundedImageMetadata(pngDimensions(10_000, 4_001))).toThrow(
      expect.objectContaining({ code: "IMAGE_LIBRARY_TOO_LARGE" }),
    )
  })

  it("rejects zero, over-dimension, truncated, and integer-overflow dimensions", () => {
    expect(IMAGE_MAX_DECODED_DIMENSION).toBe(16_384)
    for (const input of [
      pngDimensions(0, 480),
      gifDimensions(640, 0),
      pngDimensions(IMAGE_MAX_DECODED_DIMENSION + 1, 1),
      avifDimensions(0xffff_ffff, 0xffff_ffff),
      pngDimensions(640, 480).subarray(0, 28),
    ])
      expect(() => readBoundedImageMetadata(input)).toThrow(
        expect.objectContaining({
          code: expect.stringMatching(/^IMAGE_LIBRARY_(?:INVALID|TOO_LARGE)$/),
        }),
      )
  })

  it("rejects unsupported signatures instead of sending them to a decoder", () => {
    expectInvalid(() => readBoundedImageMetadata(ascii("not an image")))
  })
})

describe("image filename normalization", () => {
  it("preserves safe Unicode, spaces, brackets, and extension casing", () => {
    for (const name of ["猫咪 夏天 [一].PNG", "résumé photo.JpEg", "动画 01.gif"]) {
      expect(normalizeImageName(name)).toBe(name)
    }
  })

  it("rejects controls, separators, unsafe Windows punctuation, and dot segments", () => {
    for (const name of [
      "",
      ".",
      "..",
      "../hero.png",
      "folder/hero.png",
      "folder\\hero.png",
      "hero\u0000.png",
      "hero\n.png",
      "hero\r.png",
      "hero\u007f.png",
      "hero\u0085.png",
      "bad<name.png",
      "bad>name.png",
      "bad:name.png",
      'bad"name.png',
      "bad|name.png",
      "bad?name.png",
      "bad*name.png",
      "trailing.png.",
      "trailing.png ",
    ])
      expectInvalid(() => normalizeImageName(name))
  })

  it("rejects classic and superscript Windows device names", () => {
    for (const name of [
      "CON.png",
      "con.backup.png",
      "PRN.JPG",
      "aux.gif",
      "NUL.webp",
      "COM1.avif",
      "com9.png",
      "LPT1.jpeg",
      "lpt9.gif",
      "COM¹.png",
      "com².JPG",
      "CoM³.gif",
      "LPT¹.webp",
      "lpt².AVIF",
      "LpT³.jpeg",
    ])
      expectInvalid(() => normalizeImageName(name))
  })

  it("requires a supported extension, a nonempty stem, and at most 255 characters", () => {
    expect(normalizeImageName(`${"a".repeat(251)}.png`)).toHaveLength(255)
    for (const name of [
      ".png",
      "photo",
      "photo.svg",
      "photo.pdf",
      "photo.mp4",
      "photo.png.exe",
      `${"a".repeat(252)}.png`,
    ])
      expectInvalid(() => normalizeImageName(name))
  })
})

describe("image Markdown and data URLs", () => {
  it("uses an angle-bracket destination while preserving Unicode and spaces", () => {
    expect(markdownForImage("summer-notes", "猫咪 夏天.png")).toBe(
      "![猫咪 夏天](<../_assets/summer-notes/猫咪 夏天.png>)",
    )
  })

  it("uses extensionless alt text and safely escapes brackets without double escaping", () => {
    expect(markdownForImage("garden-log", "draft [one].png")).toBe(
      "![draft \\[one\\]](<../_assets/garden-log/draft [one].png>)",
    )
    expectInvalid(() => markdownForImage("garden-log", "draft \\[one].png"))
  })

  it.each([
    ["cover#draft.png", "![cover#draft](<../_assets/garden-log/cover%23draft.png>)"],
    ["cover%20draft.png", "![cover%20draft](<../_assets/garden-log/cover%2520draft.png>)"],
    ["%ZZ.png", "![%ZZ](<../_assets/garden-log/%25ZZ.png>)"],
  ])("round-trips reserved destination characters in %s", (name, expected) => {
    const markdown = markdownForImage("garden-log", name)
    expect(markdown).toBe(expected)
    const encodedName = /\/([^/]*)>\)$/.exec(markdown)?.[1]
    expect(encodedName).toBeDefined()
    expect(decodeURIComponent(encodedName!)).toBe(name)
  })

  it("rejects invalid slugs and unsafe image names", () => {
    for (const slug of ["", "Garden-Log", "garden_log", "-garden", "garden--log", "../garden"])
      expectInvalid(() => markdownForImage(slug, "photo.png"))
    expectInvalid(() => markdownForImage("garden-log", "bad>name.png"))
  })

  it("returns the exact MIME-prefixed canonical Base64 data URL", () => {
    expect(imageDataUrl("image/png", bytes(0x00, 0xff, 0x10, 0x80))).toBe(
      "data:image/png;base64,AP8QgA==",
    )
    expect(imageDataUrl("image/jpeg", bytes(0xff, 0xd8, 0xff))).toBe(
      "data:image/jpeg;base64,/9j/",
    )
  })

  it("encodes only the selected bytes from a nonzero-offset Uint8Array view", () => {
    const backing = bytes(0xaa, 0x00, 0xff, 0x10, 0x80, 0xbb)
    expect(imageDataUrl("image/png", backing.subarray(1, 5))).toBe(
      "data:image/png;base64,AP8QgA==",
    )
  })
})
