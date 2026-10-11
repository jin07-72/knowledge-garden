import type { BigIntStats } from "node:fs"
import { lstat, type FileHandle } from "node:fs/promises"

/** Internal ownership probe kept separate so fault tests do not widen the public service adapter. */
export function captureImageLibraryPathIdentity(path: string): Promise<BigIntStats> {
  return lstat(path, { bigint: true })
}

/** Internal boundary used to fault later validation without widening the public adapter. */
export function completeImageLibraryOwnershipCapture(_path: string): void {}

/** Internal marker durability boundary used by focused ownership fault tests. */
export function syncImageLibraryMarker(handle: FileHandle): Promise<void> {
  return handle.sync()
}
