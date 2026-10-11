import { describe, expect, it } from "vitest"
import {
  detectImageFormat,
  imageDataUrl,
  markdownForImage,
  normalizeImageName,
  type ImageFormat,
} from "../../src/main/services/imageFormats"

const ascii = (value: string) => Uint8Array.from(Buffer.from(value, "ascii"))
const bytes = (...values: number[]) => Uint8Array.from(values)
const append = (...parts: readonly Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]))

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

  it("accepts AVIF brands only inside a valid bounded leading ftyp box", () => {
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
    const oversizedBox = append(
      bytes(0, 0, 2, 4),
      ascii("ftyp"),
      ascii("avif"),
      bytes(0, 0, 0, 0),
      new Uint8Array(500),
    )
    const invalidSize = append(
      bytes(0, 0, 0, 12),
      ascii("ftyp"),
      ascii("avif"),
      bytes(0, 0, 0, 0),
    )

    for (const header of [strayBrand, outOfBoundsBrand, oversizedBox, invalidSize])
      expectInvalid(() => detectImageFormat(header, "photo.avif"))
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
})
