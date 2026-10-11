import type { BigIntStats } from "node:fs"
import { lstat } from "node:fs/promises"

/** Narrow fault boundary for immediate post-link ownership capture. */
export function captureImportPathIdentity(path: string): Promise<BigIntStats> {
  return lstat(path, { bigint: true })
}
