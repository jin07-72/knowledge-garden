import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, open, readdir, rename, unlink } from "node:fs/promises"
import { resolve } from "node:path"
import { internalRecoveryKey } from "./noteFiles"
import { syncImageLibraryMarker } from "./imageLibraryFs"
import { MANAGED_NOTE_PATH_PATTERN } from "../../shared/contracts"
import { normalizeImageName } from "./imageFormats"

export interface SerializedDeleteFileIdentity {
  readonly dev: string
  readonly ino: string
  readonly size: string
  readonly mtimeNs: string
}

export interface SerializedDeleteDirectoryIdentity {
  readonly dev: string
  readonly ino: string
  readonly birthtimeNs: string
}

export interface OwnedDeleteFileProof {
  readonly identity: {
    readonly dev: bigint
    readonly ino: bigint
    readonly size: bigint
    readonly mtimeNs: bigint
    readonly ctimeNs: bigint
  }
  readonly hash: string
}

export interface DeleteMarkerProof {
  readonly state?: "proof"
  readonly sourceName?: string
  readonly identity: SerializedDeleteFileIdentity
  readonly hash: string
}

export interface DeleteMarkerIntent {
  readonly state: "intent"
  readonly sourceName: string
}

export interface DeleteManifest {
  readonly version: 2
  readonly sequence: number
  readonly id: string
  readonly workspace: string
  readonly note: string
  readonly name: string
  readonly expectedContentHash: string
  readonly expectedIdentity: SerializedDeleteFileIdentity
  readonly stageIdentity: SerializedDeleteDirectoryIdentity
  readonly quarantineIdentity: SerializedDeleteDirectoryIdentity | null
  readonly marker: DeleteMarkerProof | DeleteMarkerIntent | null
  readonly phase: "prepared" | "renamed" | "marker-planned" | "committed"
}

interface Envelope {
  readonly manifest: DeleteManifest
  readonly authentication: string
}

const SLOT_PATTERN = /^manifest\.(\d{8})\.json$/
const TEMP_PATTERN = /^\.manifest\.(\d{8})\.[0-9a-f-]{36}\.tmp$/i
const CLEANUP_PATTERN = /^\.cleanup-manifest\.(\d{8})\.[0-9a-f-]{36}$/i
const AUTH_PATTERN = /^[a-f0-9]{64}$/
const MARKER_SOURCE_PATTERN = /^marker-source-[0-9a-f]{8}-[0-9a-f-]{27}$/i

interface FileIdentityLike {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

interface DirectoryIdentityLike {
  readonly dev: bigint
  readonly ino: bigint
  readonly birthtimeNs: bigint
}

export function serializeDeleteFileIdentity(value: FileIdentityLike): SerializedDeleteFileIdentity {
  return { dev: String(value.dev), ino: String(value.ino), size: String(value.size), mtimeNs: String(value.mtimeNs) }
}

export function serializeDeleteDirectoryIdentity(value: DirectoryIdentityLike): SerializedDeleteDirectoryIdentity {
  return { dev: String(value.dev), ino: String(value.ino), birthtimeNs: String(value.birthtimeNs) }
}

export function matchesSerializedDeleteFileIdentity(value: FileIdentityLike, expected: SerializedDeleteFileIdentity): boolean {
  return String(value.dev) === expected.dev && String(value.ino) === expected.ino &&
    String(value.size) === expected.size && String(value.mtimeNs) === expected.mtimeNs
}

export function matchesSerializedDeleteDirectoryIdentity(value: DirectoryIdentityLike, expected: SerializedDeleteDirectoryIdentity): boolean {
  return String(value.dev) === expected.dev && String(value.ino) === expected.ino &&
    String(value.birthtimeNs) === expected.birthtimeNs
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function serializedIdentity(value: unknown, directory = false): boolean {
  if (!record(value)) return false
  const expected = directory ? ["dev", "ino", "birthtimeNs"] : ["dev", "ino", "size", "mtimeNs"]
  return keys(value, expected) && expected.every((key) => typeof value[key] === "string" && /^\d+$/.test(value[key] as string))
}

export function validateDeleteManifest(
  value: DeleteManifest,
  expectedId: string,
  expectedWorkspaceHash: string,
  stage: DirectoryIdentityLike,
): DeleteManifest {
  const hash = (candidate: unknown) => typeof candidate === "string" && AUTH_PATTERN.test(candidate)
  const validMarker = value.marker === null || (record(value.marker) && (
    (keys(value.marker, ["state", "sourceName"]) && value.marker.state === "intent" &&
      typeof value.marker.sourceName === "string" && MARKER_SOURCE_PATTERN.test(value.marker.sourceName)) ||
    (keys(value.marker, ["state", "sourceName", "identity", "hash"]) && value.marker.state === "proof" &&
      typeof value.marker.sourceName === "string" && MARKER_SOURCE_PATTERN.test(value.marker.sourceName) &&
      serializedIdentity(value.marker.identity) && hash(value.marker.hash)) ||
    (keys(value.marker, ["identity", "hash"]) && serializedIdentity(value.marker.identity) && hash(value.marker.hash))
  ))
  let normalizedName: string | undefined
  try { normalizedName = normalizeImageName(value.name) } catch { normalizedName = undefined }
  if (
    value.version !== 2 || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
    value.id !== expectedId || value.workspace !== expectedWorkspaceHash ||
    typeof value.note !== "string" || MANAGED_NOTE_PATH_PATTERN.exec(value.note) === null ||
    normalizedName !== value.name || !hash(value.expectedContentHash) ||
    !serializedIdentity(value.expectedIdentity) || !serializedIdentity(value.stageIdentity, true) ||
    !matchesSerializedDeleteDirectoryIdentity(stage, value.stageIdentity) ||
    !(value.quarantineIdentity === null || serializedIdentity(value.quarantineIdentity, true)) ||
    !validMarker || !["prepared", "renamed", "marker-planned", "committed"].includes(String(value.phase))
  ) throw new Error("invalid authenticated delete manifest")
  return value
}

function payload(manifest: DeleteManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), "utf8")
}

function authenticate(key: Buffer, manifest: DeleteManifest): string {
  return createHmac("sha256", key).update(payload(manifest)).digest("hex")
}

function authenticated(key: Buffer, envelope: Envelope): boolean {
  if (!AUTH_PATTERN.test(envelope.authentication)) return false
  const expected = Buffer.from(authenticate(key, envelope.manifest), "hex")
  const actual = Buffer.from(envelope.authentication, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function deleteJournalKey(workspace: string, create: boolean): Promise<Buffer> {
  return internalRecoveryKey(workspace, create)
}

export async function createOwnedMarkerSource(directory: string, sourceName: string): Promise<OwnedDeleteFileProof> {
  const path = resolve(directory, sourceName)
  const flags = process.platform === "win32"
    ? "wx"
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  const handle = await open(path, flags, 0o600)
  try {
    const details = await handle.stat({ bigint: true })
    if (!details.isFile() || details.size !== 0n) throw new Error("invalid marker source")
    await syncImageLibraryMarker(handle)
    return {
      identity: {
        dev: details.dev,
        ino: details.ino,
        size: details.size,
        mtimeNs: details.mtimeNs,
        ctimeNs: details.ctimeNs,
      },
      hash: createHash("sha256").digest("hex"),
    }
  } catch (error) {
    const captured = resolve(directory, `.marker-source-failed-${randomUUID()}`)
    try {
      const opened = await handle.stat({ bigint: true })
      await rename(path, captured)
      const moved = await lstat(captured, { bigint: true })
      if (opened.dev !== moved.dev || opened.ino !== moved.ino) throw new Error("marker source replaced")
      await unlink(captured)
    } catch {
      throw new Error("marker source cleanup uncertain", { cause: error })
    }
    throw error
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export async function publishDeleteManifest(
  stage: string,
  manifest: DeleteManifest,
  key: Buffer,
  syncDirectory?: (path: string) => Promise<void>,
): Promise<string> {
  const sequence = manifest.sequence.toString().padStart(8, "0")
  const temporary = resolve(stage, `.manifest.${sequence}.${randomUUID()}.tmp`)
  const destination = resolve(stage, `manifest.${sequence}.json`)
  const envelope: Envelope = { manifest, authentication: authenticate(key, manifest) }
  const flags = process.platform === "win32"
    ? "wx"
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  const handle = await open(temporary, flags, 0o600)
  try {
    await handle.writeFile(JSON.stringify(envelope))
    await handle.sync()
    await link(temporary, destination)
    await syncDirectory?.(stage)
    return destination
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export async function loadDeleteManifest(
  stage: string,
  key: Buffer,
): Promise<{
  readonly manifest: DeleteManifest
  readonly path: string
  readonly ownedPaths: readonly { path: string; sequence: number; kind: "published" | "temporary"; dev: bigint; ino: bigint; size: bigint; hash: string }[]
  readonly unknownPaths: readonly string[]
}> {
  const entries = await readdir(stage, { withFileTypes: true })
  const slots = entries
    .filter((entry) => entry.isFile() && (SLOT_PATTERN.test(entry.name) || CLEANUP_PATTERN.test(entry.name)))
    .sort((left, right) => {
      const leftSequence = Number((SLOT_PATTERN.exec(left.name) ?? CLEANUP_PATTERN.exec(left.name))![1])
      const rightSequence = Number((SLOT_PATTERN.exec(right.name) ?? CLEANUP_PATTERN.exec(right.name))![1])
      return rightSequence - leftSequence || left.name.localeCompare(right.name)
    })
  const ownedPaths: { path: string; sequence: number; kind: "published" | "temporary"; dev: bigint; ino: bigint; size: bigint; hash: string }[] = []
  const slotIdentities = new Map<string, { dev: bigint; ino: bigint }>()
  let latest: { manifest: DeleteManifest; path: string } | undefined
  for (const entry of slots) {
    const path = resolve(stage, entry.name)
    let envelope: unknown
    let raw = Buffer.alloc(0)
    try {
      const details = await lstat(path, { bigint: true })
      if (!details.isFile() || details.isSymbolicLink() || details.size > 64n * 1024n)
        throw new Error("invalid authenticated delete manifest slot")
      const handle = await open(path, process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        raw = await handle.readFile()
        envelope = JSON.parse(raw.toString("utf8"))
      } finally {
        await handle.close()
      }
    } catch {
      throw new Error("invalid authenticated delete manifest slot")
    }
    if (
      typeof envelope === "object" && envelope !== null && !Array.isArray(envelope) &&
      Object.keys(envelope).sort().join(",") === "authentication,manifest" &&
      typeof (envelope as Envelope).manifest === "object" &&
      (envelope as Envelope).manifest !== null &&
      authenticated(key, envelope as Envelope)
    ) {
      const manifest = (envelope as Envelope).manifest
      const sequence = (SLOT_PATTERN.exec(entry.name) ?? CLEANUP_PATTERN.exec(entry.name))![1]!
      if (manifest.sequence.toString().padStart(8, "0") !== sequence)
        throw new Error("delete manifest sequence mismatch")
      const details = await lstat(path, { bigint: true })
      ownedPaths.push({ path, sequence: Number(sequence), kind: "published", dev: details.dev, ino: details.ino, size: details.size, hash: createHash("sha256").update(raw).digest("hex") })
      slotIdentities.set(sequence, { dev: details.dev, ino: details.ino })
      latest ??= { manifest, path }
      continue
    }
    throw new Error("invalid authenticated delete manifest slot")
  }
  if (latest === undefined) throw new Error("authenticated delete manifest unavailable")
  const unknownPaths: string[] = []
  for (const entry of entries.filter((candidate) => candidate.isFile() && TEMP_PATTERN.test(candidate.name))) {
    const path = resolve(stage, entry.name)
    const details = await lstat(path, { bigint: true })
    const sequence = TEMP_PATTERN.exec(entry.name)![1]!
    const slot = slotIdentities.get(sequence)
    if (slot !== undefined && slot.dev === details.dev && slot.ino === details.ino)
      ownedPaths.push({
        path,
        sequence: Number(sequence),
        kind: "temporary",
        dev: details.dev,
        ino: details.ino,
        size: details.size,
        hash: ownedPaths.find((owned) => owned.dev === details.dev && owned.ino === details.ino)!.hash,
      })
    else unknownPaths.push(path)
  }
  return { ...latest, ownedPaths, unknownPaths }
}

export function isDeleteManifestSlot(name: string): boolean {
  return SLOT_PATTERN.test(name) || TEMP_PATTERN.test(name) || CLEANUP_PATTERN.test(name)
}

export function isPublishedDeleteManifestSlot(name: string): boolean {
  return SLOT_PATTERN.test(name) || CLEANUP_PATTERN.test(name)
}
