import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { link, lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import {
  MANAGED_NOTE_PATH_PATTERN,
  type AppError,
  type ImageLibraryItemRequest,
  type ImageLibraryPreview,
} from "../../shared/contracts"
import { MAX_MARKDOWN_UTF8_BYTES } from "../../shared/ipcSchemas"
import { detectImageFormat, imageDataUrl, markdownForImage, normalizeImageName } from "./imageFormats"
import { acquireInternalNotePathLease, type InternalNotePathLease } from "./noteFiles"
import {
  createOwnedMarkerSource,
  deleteJournalKey,
  isDeleteManifestSlot,
  isPublishedDeleteManifestSlot,
  loadDeleteManifest,
  matchesSerializedDeleteDirectoryIdentity as sameSerializedDirectoryIdentity,
  matchesSerializedDeleteFileIdentity as sameSerializedFileIdentity,
  publishDeleteManifest,
  serializeDeleteDirectoryIdentity as serializeDirectoryIdentity,
  serializeDeleteFileIdentity as serializeFileIdentity,
  type DeleteManifest,
  validateDeleteManifest,
} from "./imageLibraryDeleteJournalCodec"
import { serializeImagePreview } from "./imageLibraryPreviewGate"

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const operationErrors = new WeakSet<object>()

type OperationPhase =
  | "delete-before-quarantine"
  | "delete-before-rename"
  | "delete-renamed"
  | "delete-before-commit"
  | "delete-committed"
  | "delete-quarantine-linked"
  | "delete-quarantined"
  | "delete-target-removed"
  | "delete-cleanup-latest-captured"
  | "delete-cleanup-latest-removed"

interface OperationAdapter {
  readDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }>
  writeClipboard(text: string): void
  syncDirectory?(path: string): Promise<void>
  afterPhase?(phase: OperationPhase): Promise<void> | void
}

interface FileIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

interface FileProof {
  readonly identity: FileIdentity
  readonly hash: string
}

interface DirectoryProof {
  readonly canonical: string
  readonly dev: bigint
  readonly ino: bigint
  readonly birthtimeNs: bigint
}

interface ParsedPath {
  readonly path: string
  readonly visibility: "content" | "private"
  readonly domain: string
  readonly slug: string
  readonly attachmentPath: string
}

function operationError(code: AppError["code"], message: string, details?: AppError["details"]): AppError {
  const error = details === undefined ? { code, message } as AppError : { code, message, details } as AppError
  operationErrors.add(error)
  return error
}

function invalid(message = "图片名称或路径无效。"): AppError {
  return operationError("IMAGE_LIBRARY_INVALID", message)
}

function unsafe(message = "图片库路径不安全，已停止操作。"): AppError {
  return operationError("IMAGE_LIBRARY_UNSAFE", message)
}

function tooLarge(): AppError {
  return operationError("IMAGE_LIBRARY_TOO_LARGE", "图片超过允许的大小限制。")
}

function changed(message = "笔记或图片已发生变化，请刷新后重试。"): AppError {
  return operationError("IMAGE_LIBRARY_CHANGED", message)
}

function failed(message = "图片库操作失败，请重试。"): AppError {
  return operationError("IMAGE_LIBRARY_FAILED", message)
}

export function isImageLibraryOperationError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && operationErrors.has(error)
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate)
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference))
}

function identity(details: BigIntStats): FileIdentity {
  return {
    dev: details.dev,
    ino: details.ino,
    size: details.size,
    mtimeNs: details.mtimeNs,
    ctimeNs: details.ctimeNs,
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function sameFileObject(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  )
}

function parsePath(path: string): ParsedPath {
  const match = MANAGED_NOTE_PATH_PATTERN.exec(path)
  if (match === null) throw invalid("笔记路径无效。")
  const visibility = match[1] as "content" | "private"
  const domain = match[2]!
  const slug = match[3]!
  return {
    path,
    visibility,
    domain,
    slug,
    attachmentPath: `${visibility}/_assets/${slug}`,
  }
}

async function inspectDirectory(path: string, root: string): Promise<DirectoryProof> {
  try {
    const details = await lstat(path, { bigint: true })
    if (details.isSymbolicLink()) throw unsafe()
    if (!details.isDirectory()) throw invalid("图片库路径不是目录。")
    const canonical = await realpath(path)
    if (!isInside(root, canonical) || !pathsEqual(path, canonical)) throw unsafe()
    const followed = await stat(canonical, { bigint: true })
    if (!followed.isDirectory()) throw invalid("图片库路径不是目录。")
    return {
      canonical,
      dev: details.dev,
      ino: details.ino,
      birthtimeNs: details.birthtimeNs,
    }
  } catch (error) {
    if (isImageLibraryOperationError(error)) throw error
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw invalid("图片库尚未创建。")
    throw failed("无法检查图片库目录。")
  }
}

async function verifyDirectory(path: string, root: string, expected: DirectoryProof): Promise<void> {
  const current = await inspectDirectory(path, root)
  if (
    !pathsEqual(current.canonical, expected.canonical) ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.birthtimeNs !== expected.birthtimeNs
  )
    throw changed("图片库目录已发生变化，请刷新后重试。")
}

async function canonicalWorkspace(workspace: string): Promise<string> {
  if (!isAbsolute(workspace) || !pathsEqual(resolve(workspace), workspace)) throw invalid("工作区路径无效。")
  return (await inspectDirectory(workspace, workspace)).canonical
}

async function fileSnapshot(
  path: string,
  root: string,
  maxBytes: number,
  missingIsChanged = false,
): Promise<{ readonly proof: FileProof; readonly bytes: Uint8Array }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const before = await lstat(path, { bigint: true })
    if (before.isSymbolicLink()) throw unsafe()
    if (!before.isFile()) throw invalid("图片不是普通文件。")
    if (before.size > BigInt(maxBytes)) throw tooLarge()
    const canonical = await realpath(path)
    if (!pathsEqual(path, canonical) || !isInside(root, canonical)) throw unsafe()
    const flags = process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW
    handle = await open(path, flags)
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw changed()
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    const afterPath = await lstat(path, { bigint: true })
    if (
      bytes.length > maxBytes ||
      BigInt(bytes.length) !== opened.size ||
      !sameIdentity(identity(opened), identity(after)) ||
      !sameIdentity(identity(opened), identity(afterPath))
    )
      throw changed()
    return {
      proof: {
        identity: identity(opened),
        hash: createHash("sha256").update(bytes).digest("hex"),
      },
      bytes,
    }
  } catch (error) {
    if (isImageLibraryOperationError(error)) throw error
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw missingIsChanged ? changed() : invalid("图片不存在。")
    }
    throw failed("无法安全读取图片。")
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function hashFile(path: string, root: string, maxBytes: number): Promise<FileProof> {
  return (await fileSnapshot(path, root, maxBytes)).proof
}

async function verifyFile(path: string, root: string, expected: FileProof): Promise<void> {
  const current = await fileSnapshot(path, root, MAX_IMAGE_BYTES, true)
  if (!sameIdentity(current.proof.identity, expected.identity) || current.proof.hash !== expected.hash)
    throw changed()
}

async function acquireLocks(workspace: string, paths: readonly string[]): Promise<InternalNotePathLease[]> {
  const leases: InternalNotePathLease[] = []
  try {
    for (const path of [...new Set(paths)].sort((a, b) => a.localeCompare(b)))
      leases.push(await acquireInternalNotePathLease(workspace, path))
    return leases
  } catch {
    await Promise.allSettled([...leases].reverse().map((lease) => lease.release()))
    throw failed("无法获取图片库操作锁。")
  }
}

async function releaseLocks(leases: readonly InternalNotePathLease[], primary?: unknown): Promise<void> {
  let releaseFailed = false
  for (const lease of [...leases].reverse()) {
    try {
      await lease.release()
    } catch {
      releaseFailed = true
    }
  }
  if (primary !== undefined) {
    if (isImageLibraryOperationError(primary)) {
      if (releaseFailed) {
        throw operationError(primary.code, primary.message, {
          ...primary.details,
          cleanupWarnings: [{ code: "LOCK_RELEASE_FAILED", message: "部分操作锁未能安全释放。" }],
        })
      }
      throw primary
    }
    throw failed()
  }
  if (releaseFailed) throw failed("图片库操作完成，但操作锁未能安全释放。")
}

async function assertLocks(leases: readonly InternalNotePathLease[]): Promise<void> {
  try {
    for (const lease of leases) await lease.assertOwned()
  } catch {
    throw changed("图片库操作锁已失效，请重试。")
  }
}

async function noteProof(workspace: string, parsed: ParsedPath): Promise<{ path: string; proof: FileProof }> {
  const visibility = await inspectDirectory(resolve(workspace, parsed.visibility), workspace)
  const domain = await inspectDirectory(resolve(visibility.canonical, parsed.domain), visibility.canonical)
  const path = resolve(domain.canonical, `${parsed.slug}.md`)
  return { path, proof: await hashFile(path, domain.canonical, MAX_MARKDOWN_UTF8_BYTES) }
}

async function libraryProof(workspace: string, parsed: ParsedPath): Promise<DirectoryProof> {
  const visibility = await inspectDirectory(resolve(workspace, parsed.visibility), workspace)
  const assets = await inspectDirectory(resolve(visibility.canonical, "_assets"), visibility.canonical)
  return inspectDirectory(resolve(assets.canonical, parsed.slug), assets.canonical)
}

async function withOperation<T>(
  workspaceInput: string,
  path: string,
  run: (context: {
    readonly workspace: string
    readonly parsed: ParsedPath
    readonly library: DirectoryProof
  }) => Promise<T>,
): Promise<T> {
  return withNoteOperation(workspaceInput, path, async ({ workspace, parsed }) => {
    const library = await libraryProof(workspace, parsed)
    const result = await run({ workspace, parsed, library })
    await verifyDirectory(library.canonical, resolve(workspace, parsed.visibility, "_assets"), library)
    return result
  })
}

async function withNoteOperation<T>(
  workspaceInput: string,
  path: string,
  run: (context: { readonly workspace: string; readonly parsed: ParsedPath }) => Promise<T>,
): Promise<T> {
  const parsed = parsePath(path)
  const workspace = await canonicalWorkspace(workspaceInput)
  const note = await noteProof(workspace, parsed)
  const leases = await acquireLocks(workspace, [parsed.path, parsed.attachmentPath])
  let result: T | undefined
  let primary: unknown
  try {
    await assertLocks(leases)
    const currentNote = await hashFile(note.path, resolve(workspace, parsed.visibility, parsed.domain), MAX_MARKDOWN_UTF8_BYTES)
    if (!sameIdentity(currentNote.identity, note.proof.identity) || currentNote.hash !== note.proof.hash)
      throw changed("笔记已发生变化，请重试。")
    result = await run({ workspace, parsed })
    await assertLocks(leases)
    const finalNote = await hashFile(note.path, resolve(workspace, parsed.visibility, parsed.domain), MAX_MARKDOWN_UTF8_BYTES)
    if (!sameIdentity(finalNote.identity, note.proof.identity) || finalNote.hash !== note.proof.hash)
      throw changed("笔记已发生变化，请重试。")
  } catch (error) {
    primary = error
  }
  await releaseLocks(leases, primary)
  return result!
}

function safeName(name: string): string {
  try {
    return normalizeImageName(name)
  } catch {
    throw invalid("图片名称无效。")
  }
}

function validDimensions(dimensions: { width: number; height: number }): void {
  if (
    !Number.isSafeInteger(dimensions.width) ||
    dimensions.width <= 0 ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.height <= 0
  )
    throw invalid("图片尺寸无效。")
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

interface DeleteJournal {
  readonly stage: DirectoryProof
  readonly manifestPath: string
  readonly manifest: DeleteManifest
  readonly manifestProof: FileProof
  readonly quarantinePath: string
  readonly quarantine?: DirectoryProof
  readonly key: Buffer
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function workspaceHash(workspace: string): string {
  return createHash("sha256").update(Buffer.from(workspace)).digest("hex")
}

async function ensureDirectory(path: string, parent: DirectoryProof): Promise<DirectoryProof> {
  await verifyDirectory(parent.canonical, parent.canonical, parent)
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw failed("无法创建图片删除记录目录。")
  }
  return inspectDirectory(path, parent.canonical)
}

async function exclusiveDirectory(path: string, parent: DirectoryProof): Promise<DirectoryProof> {
  await verifyDirectory(parent.canonical, parent.canonical, parent)
  try {
    await mkdir(path, { mode: 0o700 })
  } catch {
    throw failed("无法创建专用图片删除目录。")
  }
  return inspectDirectory(path, parent.canonical)
}


async function inspectMarkerAndImages(
  library: DirectoryProof,
  quarantineName?: string,
): Promise<{ readonly images: string[]; readonly marker?: FileProof }> {
  const children = await readdir(library.canonical, { withFileTypes: true })
  const images: string[] = []
  let marker: FileProof | undefined
  for (const child of children) {
    if (child.name === quarantineName) continue
    if (child.name === ".gitkeep") {
      if (child.isSymbolicLink()) throw unsafe("图片库占位文件不能是链接。")
      if (!child.isFile()) throw invalid("图片库占位文件不是普通文件。")
      const snapshot = await fileSnapshot(resolve(library.canonical, child.name), library.canonical, MAX_IMAGE_BYTES)
      if (snapshot.bytes.length !== 0) throw invalid("图片库占位文件必须为空。")
      marker = snapshot.proof
      continue
    }
    if (child.isSymbolicLink()) throw unsafe("图片库包含链接文件，已停止操作。")
    if (!child.isFile()) throw invalid("图片库只能包含直接图片文件。")
    images.push(safeName(child.name))
  }
  return { images, ...(marker === undefined ? {} : { marker }) }
}

function markerIntent(marker: DeleteManifest["marker"]): marker is { state: "intent"; sourceName: string } {
  return marker !== null && "state" in marker && marker.state === "intent"
}

function markerProof(marker: DeleteManifest["marker"]): marker is Exclude<DeleteManifest["marker"], null | { state: "intent"; sourceName: string }> {
  return marker !== null && !("state" in marker && marker.state === "intent")
}

async function removeCapturedJournal(
  journal: DeleteJournal,
  deleteRoot: DirectoryProof,
  adapter: OperationAdapter,
): Promise<void> {
  await verifyFile(journal.manifestPath, journal.stage.canonical, journal.manifestProof)
  const authenticatedFiles = await loadDeleteManifest(journal.stage.canonical, journal.key).catch(() => {
    throw failed("图片删除恢复记录已被替换，已安全保留。")
  })
  if (authenticatedFiles.manifest.sequence !== journal.manifest.sequence)
    throw failed("图片删除恢复记录状态已变化，已安全保留。")
  const children = await readdir(journal.stage.canonical, { withFileTypes: true })
  const sourceName = journal.manifest.marker !== null && "sourceName" in journal.manifest.marker
    ? journal.manifest.marker.sourceName
    : undefined
  const markerCleanupPattern = sourceName === undefined
    ? undefined
    : new RegExp(`^\\.${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.cleanup-[0-9a-f-]{36}$`, "i")
  if (children.some((entry) => !entry.isFile() || !(
    isDeleteManifestSlot(entry.name) || entry.name === sourceName || markerCleanupPattern?.test(entry.name)
  )))
    throw failed("图片删除记录包含未知项目。")

  const latestPath = authenticatedFiles.path
  const removeManifestFile = async (
    owned: (typeof authenticatedFiles.ownedPaths)[number],
    latest: boolean,
  ): Promise<void> => {
    let captured = owned.path
    if (!/^\.cleanup-manifest\./i.test(resolve(owned.path).split(/[\\/]/).at(-1)!)) {
      captured = resolve(journal.stage.canonical, `.cleanup-manifest.${owned.sequence.toString().padStart(8, "0")}.${randomUUID()}`)
      await rename(owned.path, captured)
      await adapter.syncDirectory?.(journal.stage.canonical)
      if (latest) await adapter.afterPhase?.("delete-cleanup-latest-captured")
    }
    const moved = await fileSnapshot(captured, journal.stage.canonical, 64 * 1024, true)
    if (
      moved.proof.identity.dev !== owned.dev || moved.proof.identity.ino !== owned.ino ||
      moved.proof.identity.size !== owned.size || moved.proof.hash !== owned.hash
    ) {
      await link(captured, owned.path).catch(() => undefined)
      throw failed("图片删除恢复记录在清理时被替换，外部内容已保留。")
    }
    await unlink(captured)
    if (latest) await adapter.afterPhase?.("delete-cleanup-latest-removed")
    await adapter.syncDirectory?.(journal.stage.canonical)
  }

  for (const owned of authenticatedFiles.ownedPaths.filter((item) => item.path !== latestPath))
    await removeManifestFile(owned, false)

  let preservePendingMarkerSource = false
  if (sourceName !== undefined) {
    const sourceEntry = children.find((entry) => entry.name === sourceName || markerCleanupPattern?.test(entry.name))
    if (sourceEntry !== undefined) {
      if (markerIntent(journal.manifest.marker)) {
        preservePendingMarkerSource = true
      } else if (markerProof(journal.manifest.marker)) {
        const sourcePath = resolve(journal.stage.canonical, sourceEntry.name)
        const snapshot = await fileSnapshot(sourcePath, journal.stage.canonical, MAX_IMAGE_BYTES, true)
        if (
          snapshot.bytes.length !== 0 || snapshot.proof.hash !== journal.manifest.marker.hash ||
          !sameSerializedFileIdentity(snapshot.proof.identity, journal.manifest.marker.identity)
        ) throw failed("图片库占位恢复源身份异常，已安全保留。")
        let captured = sourcePath
        if (sourceEntry.name === sourceName) {
          captured = resolve(journal.stage.canonical, `.${sourceName}.cleanup-${randomUUID()}`)
          await rename(sourcePath, captured)
          await adapter.syncDirectory?.(journal.stage.canonical)
        }
        const moved = await fileSnapshot(captured, journal.stage.canonical, MAX_IMAGE_BYTES, true)
        if (!sameFileObject(moved.proof.identity, snapshot.proof.identity) || moved.proof.hash !== snapshot.proof.hash)
          throw failed("图片库占位恢复源在清理时被替换，已安全保留。")
        await unlink(captured)
        await adapter.syncDirectory?.(journal.stage.canonical)
      }
    }
  }

  if (journal.quarantine !== undefined && await targetExists(journal.quarantinePath)) {
    await verifyDirectory(journal.quarantinePath, resolve(journal.quarantinePath, ".."), journal.quarantine)
    const entries = await readdir(journal.quarantinePath, { withFileTypes: true })
    for (const entry of entries) {
      const capturedImage = /^(?:capture-|\.cleanup-image-)[0-9a-f-]{36}$/i.test(entry.name)
      const capturedMarker = /^(?:marker-rollback-|\.cleanup-marker-)[0-9a-f-]{36}$/i.test(entry.name)
      if (!entry.isFile() || !(["image", "marker-source"].includes(entry.name) || capturedImage || capturedMarker))
        throw failed("图片删除隔离目录包含未知项目，已保留。")
      const path = resolve(journal.quarantinePath, entry.name)
      const snapshot = await fileSnapshot(path, journal.quarantinePath, MAX_IMAGE_BYTES, true)
      if ((entry.name === "image" || capturedImage) && (
        snapshot.proof.hash !== journal.manifest.expectedContentHash ||
        !sameSerializedFileIdentity(snapshot.proof.identity, journal.manifest.expectedIdentity)
      )) throw failed("图片删除隔离内容身份异常，已保留。")
      if ((entry.name === "marker-source" || capturedMarker) && (
        !markerProof(journal.manifest.marker) || snapshot.proof.hash !== journal.manifest.marker.hash ||
        !sameSerializedFileIdentity(snapshot.proof.identity, journal.manifest.marker.identity)
      )) throw failed("图片库占位恢复源身份异常，已保留。")
      const cleanupKind = entry.name === "marker-source" || capturedMarker ? "marker" : "image"
      const cleanupPath = resolve(journal.quarantinePath, `.cleanup-${cleanupKind}-${randomUUID()}`)
      await rename(path, cleanupPath)
      const moved = await fileSnapshot(cleanupPath, journal.quarantinePath, MAX_IMAGE_BYTES, true)
      if (!sameFileObject(moved.proof.identity, snapshot.proof.identity) || moved.proof.hash !== snapshot.proof.hash) {
        await link(cleanupPath, path).catch(() => undefined)
        throw failed("图片删除隔离内容在清理时被替换，外部内容已保留。")
      }
      await unlink(cleanupPath)
      await adapter.syncDirectory?.(journal.quarantinePath)
    }
    await rmdir(journal.quarantinePath)
    await adapter.syncDirectory?.(resolve(journal.quarantinePath, ".."))
  }
  if (!preservePendingMarkerSource) {
    const latest = authenticatedFiles.ownedPaths.find((item) => item.path === latestPath)
    if (latest === undefined) throw failed("图片删除恢复记录缺少最新认证状态。")
    await removeManifestFile(latest, true)
  }
  if (authenticatedFiles.unknownPaths.length === 0 && !preservePendingMarkerSource) {
    await rmdir(journal.stage.canonical)
    await adapter.syncDirectory?.(deleteRoot.canonical)
  }
}

async function loadJournal(
  workspace: string,
  deleteRoot: DirectoryProof,
  id: string,
): Promise<DeleteJournal> {
  const stage = await inspectDirectory(resolve(deleteRoot.canonical, id), deleteRoot.canonical)
  const key = await deleteJournalKey(workspace, false).catch(() => { throw failed("图片删除恢复密钥不可用。") })
  const loaded = await loadDeleteManifest(stage.canonical, key).catch(() => { throw failed("图片删除恢复记录无效或认证失败。") })
  const manifest = (() => {
    try { return validateDeleteManifest(loaded.manifest, id, workspaceHash(workspace), stage) }
    catch { throw failed("图片删除恢复记录无效或认证失败。") }
  })()
  const manifestPath = loaded.path
  const manifestBytes = await fileSnapshot(manifestPath, stage.canonical, 64 * 1024)
  const parsed = parsePath(manifest.note)
  const library = await libraryProof(workspace, parsed)
  const quarantinePath = resolve(library.canonical, `.garden-delete-${id}`)
  let quarantine: DirectoryProof | undefined
  if (manifest.quarantineIdentity !== null && await targetExists(quarantinePath)) {
    quarantine = await inspectDirectory(quarantinePath, library.canonical)
    if (!sameSerializedDirectoryIdentity(quarantine, manifest.quarantineIdentity))
      throw failed("图片删除隔离目录身份不匹配。")
  } else if (manifest.quarantineIdentity === null && await targetExists(quarantinePath)) {
    quarantine = await inspectDirectory(quarantinePath, library.canonical)
    if ((await readdir(quarantine.canonical)).length !== 0)
      throw failed("未登记的图片删除隔离目录包含内容，已保留。")
  }
  return { stage, manifestPath, manifest, manifestProof: manifestBytes.proof, quarantinePath, key, ...(quarantine === undefined ? {} : { quarantine }) }
}

async function restoreUncommitted(
  workspace: string,
  journal: DeleteJournal,
  deleteRoot: DirectoryProof,
  adapter: OperationAdapter,
): Promise<void> {
  const parsed = parsePath(journal.manifest.note)
  const library = await libraryProof(workspace, parsed)
  const target = resolve(library.canonical, journal.manifest.name)
  const quarantined = resolve(journal.quarantinePath, "image")
  if (markerProof(journal.manifest.marker)) {
    const markerPath = resolve(library.canonical, ".gitkeep")
    if (await targetExists(markerPath)) {
      const marker = await fileSnapshot(markerPath, library.canonical, MAX_IMAGE_BYTES, true)
      if (
        marker.bytes.length !== 0 || marker.proof.hash !== journal.manifest.marker.hash ||
        !sameSerializedFileIdentity(marker.proof.identity, journal.manifest.marker.identity)
      ) throw operationError("IMAGE_LIBRARY_FAILED", "图片库占位文件已被外部替换，已安全保留。", {
        cleanupWarnings: [{ code: "DELETE_MARKER_UNCERTAIN", message: "请人工检查图片库占位文件。" }],
      })
      if (journal.quarantine === undefined) throw failed("图片删除恢复记录缺少隔离目录。")
      const held = resolve(journal.quarantine.canonical, `marker-rollback-${randomUUID()}`)
      await rename(markerPath, held)
      const captured = await fileSnapshot(held, journal.quarantine.canonical, MAX_IMAGE_BYTES, true)
      if (
        captured.bytes.length !== 0 || captured.proof.hash !== journal.manifest.marker.hash ||
        !sameSerializedFileIdentity(captured.proof.identity, journal.manifest.marker.identity)
      ) {
        await link(held, markerPath).catch(() => undefined)
        throw failed("图片库占位文件在回滚时发生变化，已保留。")
      }
      await unlink(held)
      await adapter.syncDirectory?.(library.canonical)
      await adapter.syncDirectory?.(journal.quarantine.canonical)
    }
  }
  const hasQuarantined = journal.quarantine !== undefined && await targetExists(quarantined)
  if (hasQuarantined) {
    const moved = await fileSnapshot(quarantined, journal.quarantine!.canonical, MAX_IMAGE_BYTES, true)
    if (
      moved.proof.hash !== journal.manifest.expectedContentHash ||
      !sameSerializedFileIdentity(moved.proof.identity, journal.manifest.expectedIdentity)
    )
      throw operationError("IMAGE_LIBRARY_FAILED", "未提交删除的隔离内容身份异常，已安全保留。", {
        cleanupWarnings: [{ code: "DELETE_RECOVERY_UNCERTAIN", message: "请人工检查图片删除恢复记录。" }],
      })
    if (!(await targetExists(target))) {
      try {
        await link(quarantined, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw failed("图片删除恢复位置已被占用。")
        throw failed("无法恢复未完成删除的图片。")
      }
      await adapter.syncDirectory?.(library.canonical)
      const restored = await fileSnapshot(target, library.canonical, MAX_IMAGE_BYTES, true)
      if (!sameFileObject(restored.proof.identity, moved.proof.identity) || restored.proof.hash !== moved.proof.hash)
        throw failed("无法确认恢复后的图片身份。")
    } else {
      const current = await fileSnapshot(target, library.canonical, MAX_IMAGE_BYTES, true)
      if (!sameIdentity(current.proof.identity, moved.proof.identity) || current.proof.hash !== moved.proof.hash) {
        throw operationError("IMAGE_LIBRARY_FAILED", "恢复位置已有其他图片，已安全保留两者。", {
          cleanupWarnings: [{ code: "DELETE_RECOVERY_COLLISION", message: "请人工检查图片删除恢复记录。" }],
        })
      }
    }
  } else {
    if (!(await targetExists(target))) throw failed("图片删除恢复记录缺少原图。")
    const current = await fileSnapshot(target, library.canonical, MAX_IMAGE_BYTES, true)
    if (
      current.proof.hash !== journal.manifest.expectedContentHash ||
      !sameSerializedFileIdentity(current.proof.identity, journal.manifest.expectedIdentity)
    )
      throw failed("图片删除恢复目标身份不匹配。")
  }
  await removeCapturedJournal(journal, deleteRoot, adapter)
}

async function recoverJournal(
  workspace: string,
  journal: DeleteJournal,
  deleteRoot: DirectoryProof,
  adapter: OperationAdapter,
): Promise<void> {
  if (journal.manifest.phase !== "committed") {
    await restoreUncommitted(workspace, journal, deleteRoot, adapter)
    return
  }
  if (journal.quarantine !== undefined) {
    const quarantined = resolve(journal.quarantinePath, "image")
    if (await targetExists(quarantined)) {
      const snapshot = await fileSnapshot(quarantined, journal.quarantine.canonical, MAX_IMAGE_BYTES, true)
      if (
        snapshot.proof.hash !== journal.manifest.expectedContentHash ||
        !sameSerializedFileIdentity(snapshot.proof.identity, journal.manifest.expectedIdentity)
      )
        throw operationError("IMAGE_LIBRARY_FAILED", "已提交删除的隔离内容身份异常，已保留。", {
          cleanupWarnings: [{ code: "DELETE_CLEANUP_UNCERTAIN", message: "请人工检查图片删除记录。" }],
        })
    }
  }
  await removeCapturedJournal(journal, deleteRoot, adapter)
}

async function inspectDeleteJournals(
  workspaceInput: string,
  adapter: OperationAdapter,
): Promise<void> {
  const workspace = await canonicalWorkspace(workspaceInput)
  const gardenPath = resolve(workspace, ".garden-publisher")
  if (!(await targetExists(gardenPath))) return
  const garden = await inspectDirectory(gardenPath, workspace)
  const deleteRootPath = resolve(garden.canonical, "image-delete")
  if (!(await targetExists(deleteRootPath))) return
  const deleteRoot = await inspectDirectory(deleteRootPath, garden.canonical)
  const entries = await readdir(deleteRoot.canonical, { withFileTypes: true })
  if (entries.length > 64) throw failed("图片删除恢复记录过多。")
  for (const entry of entries) {
    const id = entry.name
    if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID_PATTERN.test(id))
      throw failed("图片删除恢复目录包含未知项目。")
    const stagePath = resolve(deleteRoot.canonical, id)
    const stageEntries = await readdir(stagePath, { withFileTypes: true })
    if (stageEntries.length === 0) {
      await rmdir(stagePath)
      await adapter.syncDirectory?.(deleteRoot.canonical)
      continue
    }
    if (!stageEntries.some((child) => isPublishedDeleteManifestSlot(child.name))) {
      if (stageEntries.every((child) => child.isFile() && isDeleteManifestSlot(child.name))) continue
      throw failed("图片删除恢复目录包含未认证项目。")
    }
    const journal = await loadJournal(workspace, deleteRoot, id)
    const parsed = parsePath(journal.manifest.note)
    const leases = await acquireLocks(workspace, [parsed.path, parsed.attachmentPath])
    let primary: unknown
    try {
      await assertLocks(leases)
      await recoverJournal(workspace, journal, deleteRoot, adapter)
      await assertLocks(leases)
    } catch (error) {
      primary = error
    }
    await releaseLocks(leases, primary)
  }
}

async function createDeleteJournal(
  workspace: string,
  parsed: ParsedPath,
  name: string,
  original: FileProof,
  library: DirectoryProof,
  adapter: OperationAdapter,
): Promise<{ journal: DeleteJournal; deleteRoot: DirectoryProof; key: Buffer }> {
  const workspaceDirectory = await inspectDirectory(workspace, workspace)
  const garden = await ensureDirectory(resolve(workspace, ".garden-publisher"), workspaceDirectory)
  const deleteRoot = await ensureDirectory(resolve(garden.canonical, "image-delete"), garden)
  const id = randomUUID()
  const stage = await exclusiveDirectory(resolve(deleteRoot.canonical, id), deleteRoot)
  const key = await deleteJournalKey(workspace, true).catch(() => { throw failed("无法创建图片删除恢复密钥。") })
  const quarantinePath = resolve(library.canonical, `.garden-delete-${id}`)
  let manifest: DeleteManifest = {
    version: 2,
    sequence: 0,
    id,
    workspace: workspaceHash(workspace),
    note: parsed.path,
    name,
    expectedContentHash: original.hash,
    expectedIdentity: serializeFileIdentity(original.identity),
    stageIdentity: serializeDirectoryIdentity(stage),
    quarantineIdentity: null,
    marker: null,
    phase: "prepared",
  }
  let manifestPath = await publishDeleteManifest(stage.canonical, manifest, key, adapter.syncDirectory)
  await adapter.syncDirectory?.(deleteRoot.canonical)
  const quarantine = await exclusiveDirectory(quarantinePath, library)
  manifest = { ...manifest, sequence: 1, quarantineIdentity: serializeDirectoryIdentity(quarantine) }
  manifestPath = await publishDeleteManifest(stage.canonical, manifest, key, adapter.syncDirectory)
  const manifestProof = (await fileSnapshot(manifestPath, stage.canonical, 64 * 1024, true)).proof
  await adapter.syncDirectory?.(library.canonical)
  return {
    journal: { stage, manifestPath, manifest, manifestProof, quarantinePath, quarantine, key },
    deleteRoot,
    key,
  }
}

async function appendDeleteManifest(
  journal: DeleteJournal,
  manifest: DeleteManifest,
  key: Buffer,
  adapter: OperationAdapter,
): Promise<DeleteJournal> {
  const manifestPath = await publishDeleteManifest(journal.stage.canonical, manifest, key, adapter.syncDirectory)
  return {
    ...journal,
    manifest,
    manifestPath,
    manifestProof: (await fileSnapshot(manifestPath, journal.stage.canonical, 64 * 1024, true)).proof,
  }
}

async function quarantineWithoutOverwrite(
  target: string,
  quarantined: string,
  library: DirectoryProof,
  quarantine: DirectoryProof,
  original: FileProof,
): Promise<FileProof> {
  try {
    await link(target, quarantined)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw changed("图片删除隔离位置已被外部占用。")
    throw changed("待删除图片在隔离前已发生变化。")
  }
  const linked = await fileSnapshot(quarantined, quarantine.canonical, MAX_IMAGE_BYTES, true)
  if (linked.proof.hash !== original.hash || !sameFileObject(linked.proof.identity, original.identity))
    throw changed("待删除图片在隔离前已被替换。")
  const captured = resolve(quarantine.canonical, `capture-${randomUUID()}`)
  await rename(target, captured)
  const moved = await fileSnapshot(captured, quarantine.canonical, MAX_IMAGE_BYTES, true)
  if (moved.proof.hash !== original.hash || !sameFileObject(moved.proof.identity, original.identity)) {
    try {
      await link(captured, target)
    } catch {
      throw operationError("IMAGE_LIBRARY_CHANGED", "待删除位置已被替换，外部内容已保留。", {
        cleanupWarnings: [{ code: "DELETE_RECOVERY_COLLISION", message: "请人工检查图片删除隔离目录。" }],
      })
    }
    throw changed("待删除位置在原子隔离时已被替换。")
  }
  await unlink(captured)
  await verifyDirectory(library.canonical, resolve(library.canonical, ".."), library)
  return (await fileSnapshot(quarantined, quarantine.canonical, MAX_IMAGE_BYTES, true)).proof
}

async function deleteImage(
  workspace: string,
  parsed: ParsedPath,
  request: Required<ImageLibraryItemRequest>,
  library: DirectoryProof,
  adapter: OperationAdapter,
): Promise<void> {
  const name = safeName(request.name)
  const target = resolve(library.canonical, name)
  const original = await fileSnapshot(target, library.canonical, MAX_IMAGE_BYTES)
  if (original.proof.hash !== request.expectedContentHash) throw changed("图片内容已发生变化，请刷新后重试。")
  try {
    detectImageFormat(original.bytes, name)
  } catch {
    throw invalid("图片扩展名与文件内容不匹配。")
  }
  await inspectMarkerAndImages(library)
  await adapter.afterPhase?.("delete-before-quarantine")
  await verifyFile(target, library.canonical, original.proof)

  let journal: DeleteJournal | undefined
  let deleteRoot: DirectoryProof | undefined
  let journalKey: Buffer | undefined
  let committed = false
  let primary: unknown
  try {
    const created = await createDeleteJournal(workspace, parsed, name, original.proof, library, adapter)
    journal = created.journal
    deleteRoot = created.deleteRoot
    journalKey = created.key
    await adapter.afterPhase?.("delete-quarantine-linked")
    await adapter.afterPhase?.("delete-before-rename")
    const quarantined = resolve(journal.quarantinePath, "image")
    const movedProof = await quarantineWithoutOverwrite(target, quarantined, library, journal.quarantine!, original.proof)
    const moved = { proof: movedProof }
    await adapter.syncDirectory?.(journal.quarantine!.canonical)
    await adapter.syncDirectory?.(library.canonical)
    journal = await appendDeleteManifest(journal, {
      ...journal.manifest,
      sequence: journal.manifest.sequence + 1,
      phase: "renamed",
    }, journalKey, adapter)
    await adapter.afterPhase?.("delete-quarantined")
    await adapter.afterPhase?.("delete-renamed")

    const state = await inspectMarkerAndImages(library, `.garden-delete-${journal.manifest.id}`)
    if (state.images.length === 0 && state.marker === undefined) {
      const sourceName = `marker-source-${randomUUID()}`
      journal = await appendDeleteManifest(journal, {
        ...journal.manifest,
        sequence: journal.manifest.sequence + 1,
        marker: { state: "intent", sourceName },
        phase: "marker-planned",
      }, journalKey, adapter)
      const createdMarker = await createOwnedMarkerSource(journal.stage.canonical, sourceName).catch(() => {
        throw failed("无法创建占位文件恢复源。")
      })
      journal = await appendDeleteManifest(journal, {
        ...journal.manifest,
        sequence: journal.manifest.sequence + 1,
        marker: {
          state: "proof",
          sourceName,
          identity: serializeFileIdentity(createdMarker.identity),
          hash: createdMarker.hash,
        },
        phase: "marker-planned",
      }, journalKey, adapter)
      const markerPath = resolve(library.canonical, ".gitkeep")
      await link(resolve(journal.stage.canonical, sourceName), markerPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw changed("图片库占位文件已被外部创建。")
        throw failed("无法恢复空图片库占位文件。")
      })
      const publishedMarker = await fileSnapshot(markerPath, library.canonical, MAX_IMAGE_BYTES, true)
      if (!sameFileObject(publishedMarker.proof.identity, createdMarker.identity) || publishedMarker.bytes.length !== 0)
        throw changed("图片库占位文件身份无效。")
      await adapter.syncDirectory?.(library.canonical)
    }
    if (await targetExists(target)) throw changed("删除位置已被外部创建。")
    await verifyFile(quarantined, journal.quarantine!.canonical, moved.proof)
    await adapter.afterPhase?.("delete-before-commit")
    await adapter.syncDirectory?.(library.canonical)
    journal = await appendDeleteManifest(journal, {
      ...journal.manifest,
      sequence: journal.manifest.sequence + 1,
      phase: "committed",
    }, journalKey, adapter)
    committed = true
    await adapter.afterPhase?.("delete-committed")
  } catch (error) {
    primary = error
  }
  if (journal !== undefined && deleteRoot !== undefined) {
    try {
      await recoverJournal(workspace, journal, deleteRoot, adapter)
    } catch {
      if (!committed && isImageLibraryOperationError(primary) && primary.code === "IMAGE_LIBRARY_CHANGED") {
        throw operationError(primary.code, primary.message, {
          ...primary.details,
          cleanupWarnings: [{ code: "DELETE_RECOVERY_UNCERTAIN", message: "外部替换已保留，请刷新后重试。" }],
        })
      }
      throw operationError("IMAGE_LIBRARY_FAILED", committed
        ? "图片已删除，但删除记录清理未能确认。"
        : "图片删除失败且自动恢复未能确认。", {
        cleanupWarnings: [{ code: "DELETE_RECOVERY_UNCERTAIN", message: "请刷新并人工检查图片库。" }],
      })
    }
  }
  if (primary !== undefined) {
    if (isImageLibraryOperationError(primary)) throw primary
    throw failed("无法永久删除图片。")
  }
}

export function createImageLibraryOperations(options: {
  readonly workspace: string
  readonly adapter: OperationAdapter
}): {
  inspect(): Promise<void>
  preview(request: ImageLibraryItemRequest): Promise<ImageLibraryPreview>
  copyMarkdown(request: ImageLibraryItemRequest): Promise<void>
  delete(request: Required<ImageLibraryItemRequest>): Promise<void>
} {
  let inspectionTail: Promise<void> = Promise.resolve()

  function inspect(): Promise<void> {
    const current = inspectionTail.then(() =>
      inspectDeleteJournals(options.workspace, options.adapter),
    )
    inspectionTail = current.catch(() => undefined)
    return current
  }

  return {
    inspect() {
      return inspect()
    },

    preview(request) {
      return serializeImagePreview(() => withOperation(options.workspace, request.path, async ({ parsed, library }) => {
        const name = safeName(request.name)
        const image = await fileSnapshot(resolve(library.canonical, name), library.canonical, MAX_IMAGE_BYTES)
        if (request.expectedContentHash !== undefined && image.proof.hash !== request.expectedContentHash)
          throw changed("图片内容已发生变化，请刷新后重试。")
        let format: ReturnType<typeof detectImageFormat>
        try {
          format = detectImageFormat(image.bytes, name)
        } catch {
          throw invalid("图片扩展名与文件内容不匹配。")
        }
        let dimensions: { width: number; height: number }
        try {
          dimensions = await options.adapter.readDimensions(image.bytes)
        } catch {
          throw failed("无法读取图片尺寸。")
        }
        validDimensions(dimensions)
        await verifyFile(resolve(library.canonical, name), library.canonical, image.proof)
        return {
          name,
          sizeBytes: image.bytes.length,
          width: dimensions.width,
          height: dimensions.height,
          contentHash: image.proof.hash,
          markdown: markdownForImage(parsed.slug, name),
          dataUrl: imageDataUrl(format.mime, image.bytes),
        }
      }))
    },

    copyMarkdown(request) {
      return withNoteOperation(options.workspace, request.path, async ({ parsed }) => {
        const name = safeName(request.name)
        const markdown = markdownForImage(parsed.slug, name)
        try {
          options.adapter.writeClipboard(markdown)
        } catch {
          throw failed("无法写入系统剪贴板。")
        }
      })
    },

    delete(request) {
      return withOperation(options.workspace, request.path, ({ workspace, parsed, library }) =>
        deleteImage(workspace, parsed, request, library, options.adapter),
      )
    },
  }
}
