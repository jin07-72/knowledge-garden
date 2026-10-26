import { afterEach, describe, expect, it, vi } from "vitest"
import {
  findPreviewTarget,
  normalizePreviewNeedles,
  revealPreviewSelection,
} from "../../src/renderer/src/previewNavigation"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("preview navigation", () => {
  it("normalizes whitespace and common Markdown decoration", () => {
    expect(normalizePreviewNeedles("  **中心极限定理**  ")).toContain("中心极限定理")
    expect(normalizePreviewNeedles("[概率](./probability.md)\n分布")).toContain("概率 分布")
  })

  it("chooses the duplicate block nearest the source position", () => {
    document.body.innerHTML = `
      <article id="root">
        <p id="early">重复内容</p>
        <p id="late">重复内容</p>
      </article>
    `
    const root = document.querySelector<HTMLElement>("#root")!
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 1_000,
      height: 1_000,
      left: 0,
      right: 500,
      width: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(
      document.querySelector<HTMLElement>("#early")!,
      "getBoundingClientRect",
    ).mockReturnValue({
      top: 100,
      bottom: 140,
      height: 40,
      left: 0,
      right: 500,
      width: 500,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
    vi.spyOn(
      document.querySelector<HTMLElement>("#late")!,
      "getBoundingClientRect",
    ).mockReturnValue({
      top: 800,
      bottom: 840,
      height: 40,
      left: 0,
      right: 500,
      width: 500,
      x: 0,
      y: 800,
      toJSON: () => ({}),
    })

    expect(findPreviewTarget(root, ["重复内容"], 0.8)?.id).toBe("late")
    expect(findPreviewTarget(root, ["不存在"], 0.5)).toBeUndefined()
  })

  it("ignores navigation and hidden content", () => {
    document.body.innerHTML = `
      <article id="root">
        <nav><p id="nav-result">目标</p></nav>
        <div aria-hidden="true"><p id="hidden-result">目标</p></div>
        <p id="content-result">目标</p>
      </article>
    `
    const root = document.querySelector<HTMLElement>("#root")!
    expect(findPreviewTarget(root, ["目标"], 0)?.id).toBe("content-result")
  })

  it("scrolls, highlights, and cleans up the matching block", () => {
    document.body.innerHTML = `<article id="root"><p id="target">目标段落</p></article>`
    const root = document.querySelector<HTMLElement>("#root")!
    const target = document.querySelector<HTMLElement>("#target")!
    target.scrollIntoView = vi.fn()

    const outcome = revealPreviewSelection(root, {
      id: 1,
      documentPath: "content/study/example.md",
      text: "**目标段落**",
      positionRatio: 0.5,
    })

    expect(outcome.result).toBe("found")
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" })
    expect(target).toHaveClass("publisher-preview-locate-highlight")
    outcome.cleanup?.()
    expect(target).not.toHaveClass("publisher-preview-locate-highlight")
  })

  it("does not scroll when no preview block matches", () => {
    document.body.innerHTML = `<article id="root"><p id="target">其他内容</p></article>`
    const root = document.querySelector<HTMLElement>("#root")!
    const target = document.querySelector<HTMLElement>("#target")!
    target.scrollIntoView = vi.fn()

    expect(
      revealPreviewSelection(root, {
        id: 2,
        documentPath: "content/study/example.md",
        text: "不存在",
        positionRatio: 0.5,
      }).result,
    ).toBe("not-found")
    expect(target.scrollIntoView).not.toHaveBeenCalled()
  })
})
