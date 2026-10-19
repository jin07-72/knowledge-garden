import { describe, expect, it } from "vitest"
import { windowBoundsForWorkArea } from "../../src/main/lib/windowBounds"

describe("window bounds", () => {
  it("keeps the preferred window on a large display", () => {
    expect(windowBoundsForWorkArea({ width: 1920, height: 1080 })).toEqual({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
    })
  })

  it("fits the window into a 200%-scaled 1536x960 work area", () => {
    expect(windowBoundsForWorkArea({ width: 768, height: 480 })).toEqual({
      width: 736,
      height: 448,
      minWidth: 736,
      minHeight: 448,
    })
  })

  it("never exceeds a tiny work area or returns non-positive sizes", () => {
    expect(windowBoundsForWorkArea({ width: 400, height: 300 })).toEqual({
      width: 400,
      height: 300,
      minWidth: 400,
      minHeight: 300,
    })
    expect(windowBoundsForWorkArea({ width: 0, height: 0 })).toEqual({
      width: 1,
      height: 1,
      minWidth: 1,
      minHeight: 1,
    })
  })
})
