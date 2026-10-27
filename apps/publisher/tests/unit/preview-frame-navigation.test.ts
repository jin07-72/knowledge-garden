import { describe, expect, it, vi } from "vitest"
import { revealSelectionInPreviewFrames } from "../../src/main/previewFrameNavigation"

describe("preview frame navigation", () => {
  it("executes navigation only in the matching loopback frame", async () => {
    const unrelated = { url: "https://example.com/", executeJavaScript: vi.fn() }
    const preview = {
      url: "http://127.0.0.1:8080/technology/css-grid/",
      executeJavaScript: vi.fn(async () => "found"),
    }

    await expect(
      revealSelectionInPreviewFrames([unrelated, preview], {
        url: "http://127.0.0.1:8080/technology/css-grid",
        text: "目标段落",
        positionRatio: 0.75,
      }),
    ).resolves.toBe("found")
    expect(unrelated.executeJavaScript).not.toHaveBeenCalled()
    expect(preview.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("目标段落"),
      true,
    )
  })

  it("fails closed for non-loopback, missing, or malformed frame results", async () => {
    await expect(
      revealSelectionInPreviewFrames([], {
        url: "https://example.com/",
        text: "目标",
        positionRatio: 0.5,
      }),
    ).resolves.toBe("not-ready")
    await expect(
      revealSelectionInPreviewFrames([], {
        url: "http://127.0.0.1:8080/missing",
        text: "目标",
        positionRatio: 0.5,
      }),
    ).resolves.toBe("not-ready")
    await expect(
      revealSelectionInPreviewFrames(
        [{ url: "http://127.0.0.1:8080/note", executeJavaScript: vi.fn(async () => "bad") }],
        { url: "http://127.0.0.1:8080/note", text: "目标", positionRatio: 0.5 },
      ),
    ).resolves.toBe("not-ready")
  })

  it("converts frame execution failures into not-ready", async () => {
    await expect(
      revealSelectionInPreviewFrames(
        [
          {
            url: "http://127.0.0.1:8080/note",
            executeJavaScript: vi.fn(async () => {
              throw new Error("frame navigated")
            }),
          },
        ],
        { url: "http://127.0.0.1:8080/note", text: "目标", positionRatio: 0.5 },
      ),
    ).resolves.toBe("not-ready")
  })
})
