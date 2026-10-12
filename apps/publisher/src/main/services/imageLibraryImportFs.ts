import type { BigIntStats } from "node:fs"
import { lstat, unlink } from "node:fs/promises"

/** Narrow fault boundary for immediate post-link ownership capture. */
export function captureImportPathIdentity(path: string): Promise<BigIntStats> {
  return lstat(path, { bigint: true })
}

/** Narrow fault boundary for identity-checked owned staging cleanup. */
export function removeImportArtifact(path: string): Promise<void> {
  return unlink(path)
}
