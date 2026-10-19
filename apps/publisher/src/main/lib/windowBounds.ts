export interface WindowBounds {
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
}

const PREFERRED_WIDTH = 1440
const PREFERRED_HEIGHT = 900
const MIN_WIDTH = 480
const MIN_HEIGHT = 360
const EDGE_MARGIN = 32

/**
 * Electron sizes are DIPs while the physical screen can be much smaller at high
 * Windows scaling. Keep the preferred window when it fits, otherwise shrink to
 * the available work area so the preview and status bar are never off-screen.
 */
export function windowBoundsForWorkArea(workArea: {
  readonly width: number
  readonly height: number
}): WindowBounds {
  const availableWidth = Math.max(1, Math.floor(workArea.width))
  const availableHeight = Math.max(1, Math.floor(workArea.height))
  const width = Math.min(
    availableWidth,
    Math.min(PREFERRED_WIDTH, Math.max(MIN_WIDTH, availableWidth - EDGE_MARGIN)),
  )
  const height = Math.min(
    availableHeight,
    Math.min(PREFERRED_HEIGHT, Math.max(MIN_HEIGHT, availableHeight - EDGE_MARGIN)),
  )
  return {
    width,
    height,
    minWidth: Math.min(960, width),
    minHeight: Math.min(640, height),
  }
}
