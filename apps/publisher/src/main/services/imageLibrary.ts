import { createHash } from "node:crypto"
import { constants, type BigIntStats, type Dirent } from "node:fs"
import { lstat, mkdir, open, readdir, realpath, rmdir, stat, unlink } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import {
  IMAGE_LIBRARY_MAX_GALLERY_THUMBNAIL_TOTAL_LENGTH,
  IMAGE_LIBRARY_MAX_ITEMS,
  IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH,
  IMAGE_LIBRARY_MAX_THUMBNAIL_DECODED_BYTES,
  MANAGED_NOTE_PATH_PATTERN,
  type AppError,
  type ImageLibraryItem,
  type ImageLibraryView,
  type NotePathRequest,
} from "../../shared/contracts"
import { MAX_MARKDOWN_UTF8_BYTES } from "../../shared/ipcSchemas"
import { detectImageFormat, markdownForImage } from "./imageFormats"
import {
  acquireInternalNotePathLease,
  type InternalNotePathLease,
} from "./noteFiles"

export const IMAGE_LIBRARY_MAX_FILE_BYTES = 25 * 1024 * 1024

export interface RenderedImage {
  readonly width: number
  readonly height: number
  readonly dataUrl: string
}

export type ImageLibraryPhase = "note-validated" | "image-read" | "thumbnail-rendered"

export interface ImageLibraryAdapter {
  chooseImages(): Promise<readonly string[] | undefined>
  renderThumbnail(bytes: Uint8Array): Promise<RenderedImage>
  readDimensions(bytes: Uint8Array): Promise<{ width: number; height: number }>
  writeClipboard(text: string): void
  syncDirectory?(path: string): Promise<void>
  afterPhase?(phase: ImageLibraryPhase): Promise<void> | void
  now?(): number
}

export interface ImageLibraryService {
  open(request: NotePathRequest): Promise<ImageLibraryView>
  dispose(): Promise<void>
}

interface ParsedNotePath {
  readonly path: string
  readonly visibility: "content" | "private"
  readonly domain: string
  readonly slug: string
  readonly attachmentPath: string
}

interface FileSnapshot {
  readonly identity: FileIdentity
  readonly hash: string
}

interface FileIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

interface DirectorySnapshot {
  readonly identity: DirectoryIdentity
  readonly canonical: string
}

interface DirectoryIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly birthtimeNs: bigint
}

interface OwnedArtifact {
  readonly kind: "file" | "directory"
  readonly path: string
  readonly identity: FileIdentity | DirectoryIdentity
  readonly parent: DirectorySnapshot
}

interface DirectChildSnapshot {
  readonly name: string
  readonly directoryType: string
  readonly statType: string
  readonly identity: FileIdentity
}

type DirectChildManifest = readonly DirectChildSnapshot[]

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|gif|webp|avif);base64,([A-Za-z0-9+/]*={0,2})$/
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const trustedErrors = new WeakSet<object>()
const naturalCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" })

function imageError(code: AppError["code"], message: string, details?: AppError["details"]): AppError {
  const error = details === undefined
    ? ({ code, message } as AppError)
    : ({ code, message, details } as AppError)
  trustedErrors.add(error)
  return error
}

function invalid(message = "图片库包含无效的文件或数据。"): AppError {
  return imageError("IMAGE_LIBRARY_INVALID", message)
}

function unsafe(message = "图片库路径不安全，已停止操作。"): AppError {
  return imageError("IMAGE_LIBRARY_UNSAFE", message)
}

function tooLarge(message = "图片库超过允许的大小或数量限制。"): AppError {
  return imageError("IMAGE_LIBRARY_TOO_LARGE", message)
}

function changed(message = "笔记或图片在读取过程中发生变化，请重试。"): AppError {
  return imageError("IMAGE_LIBRARY_CHANGED", message)
}

function failed(message = "无法打开图片库，请重试。"): AppError {
  return imageError("IMAGE_LIBRARY_FAILED", message)
}

function isImageError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    trustedErrors.has(error) &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("IMAGE_LIBRARY_")
  )
}

function statType(details: BigIntStats): string {
  if (details.isSymbolicLink()) return "link"
  if (details.isFile()) return "file"
  if (details.isDirectory()) return "directory"
  if (details.isBlockDevice()) return "block-device"
  if (details.isCharacterDevice()) return "character-device"
  if (details.isFIFO()) return "fifo"
  if (details.isSocket()) return "socket"
  return "unknown"
}

function directoryEntryType(entry: Dirent): string {
  if (entry.isSymbolicLink()) return "link"
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  if (entry.isBlockDevice()) return "block-device"
  if (entry.isCharacterDevice()) return "character-device"
  if (entry.isFIFO()) return "fifo"
  if (entry.isSocket()) return "socket"
  return "unknown"
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function directChildManifest(
  library: DirectorySnapshot,
  entries?: readonly Dirent[],
): Promise<DirectChildManifest> {
  try {
    const children =
      entries ?? (await readdir(library.canonical, { withFileTypes: true }))
    const manifest: DirectChildSnapshot[] = []
    for (const entry of [...children].sort((left, right) => compareNames(left.name, right.name))) {
      const details = await lstat(resolve(library.canonical, entry.name), { bigint: true })
      manifest.push({
        name: entry.name,
        directoryType: directoryEntryType(entry),
        statType: statType(details),
        identity: fileIdentity(details),
      })
    }
    return manifest
  } catch (error) {
    if (isImageError(error)) throw error
    throw changed("图片库内容在读取过程中发生变化，请重试。")
  }
}

function sameManifest(left: DirectChildManifest, right: DirectChildManifest): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        entry.name === other.name &&
        entry.directoryType === other.directoryType &&
        entry.statType === other.statType &&
        sameFileIdentity(entry.identity, other.identity)
      )
    })
  )
}

function withCreatedMarker(
  manifest: DirectChildManifest,
  marker: FileSnapshot,
): DirectChildManifest {
  return [
    ...manifest,
    {
      name: ".gitkeep",
      directoryType: "file",
      statType: "file",
      identity: marker.identity,
    },
  ].sort((left, right) => compareNames(left.name, right.name))
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate)
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference))
}

function fileIdentity(details: BigIntStats): FileIdentity {
  return {
    dev: details.dev,
    ino: details.ino,
    size: details.size,
    mtimeNs: details.mtimeNs,
    ctimeNs: details.ctimeNs,
  }
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function directoryIdentity(details: BigIntStats): DirectoryIdentity {
  return {
    dev: details.dev,
    ino: details.ino,
    birthtimeNs: details.birthtimeNs,
  }
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeNs === right.birthtimeNs
  )
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function parseNotePath(path: string): ParsedNotePath {
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

async function canonicalWorkspace(workspace: string): Promise<string> {
  if (!isAbsolute(workspace) || !pathsEqual(resolve(workspace), workspace)) {
    throw invalid("工作区路径必须是绝对规范路径。")
  }
  try {
    const details = await lstat(workspace, { bigint: true })
    if (details.isSymbolicLink()) throw unsafe()
    if (!details.isDirectory()) throw invalid("工作区不是目录。")
    const canonical = await realpath(workspace)
    if (!pathsEqual(canonical, workspace)) throw unsafe()
    return canonical
  } catch (error) {
    if (isImageError(error)) throw error
    throw invalid("无法读取工作区目录。")
  }
}

async function inspectDirectory(
  path: string,
  expectedRoot: string,
  missingIsInvalid = false,
): Promise<DirectorySnapshot> {
  try {
    const details = await lstat(path, { bigint: true })
    if (details.isSymbolicLink()) throw unsafe()
    if (!details.isDirectory()) throw invalid("图片库路径不是目录。")
    const canonical = await realpath(path)
    if (!isInside(expectedRoot, canonical) || !pathsEqual(canonical, path)) throw unsafe()
    const canonicalDetails = await stat(canonical, { bigint: true })
    if (!canonicalDetails.isDirectory()) throw invalid("图片库路径不是目录。")
    return { identity: directoryIdentity(details), canonical }
  } catch (error) {
    if (isImageError(error)) throw error
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && missingIsInvalid) {
      throw invalid("所需目录不存在。")
    }
    throw failed("无法检查图片库目录。")
  }
}

async function verifyDirectory(
  path: string,
  expectedRoot: string,
  expected: DirectorySnapshot,
): Promise<void> {
  const current = await inspectDirectory(path, expectedRoot)
  if (
    !pathsEqual(current.canonical, expected.canonical) ||
    !sameDirectoryIdentity(current.identity, expected.identity)
  ) {
    throw changed("图片库目录在读取过程中发生变化，请重试。")
  }
}

async function createOrInspectDirectory(
  path: string,
  parent: DirectorySnapshot,
  adapter: ImageLibraryAdapter,
  owned: OwnedArtifact[],
): Promise<DirectorySnapshot> {
  // Node exposes no openat-style relative mkdir on Windows. Revalidate the
  // owned parent immediately before mutation, then verify both components
  // again after every injected await; this closes deterministic seam swaps.
  await verifyDirectory(parent.canonical, parent.canonical, parent)
  let created = false
  try {
    await mkdir(path, { mode: 0o700 })
    created = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw failed("无法创建图片库目录。")
  }
  const inspected = await inspectDirectory(path, parent.canonical)
  if (created) {
    owned.push({ kind: "directory", path, identity: inspected.identity, parent })
    try {
      await adapter.syncDirectory?.(parent.canonical)
    } catch {
      throw failed("无法安全同步图片库目录。")
    }
    await verifyDirectory(parent.canonical, parent.canonical, parent)
    await verifyDirectory(path, parent.canonical, inspected)
  }
  return inspected
}

async function safeFileSnapshot(
  path: string,
  root: string,
  sizeLimit: number | undefined,
  missingCode: "invalid" | "changed" = "invalid",
): Promise<{ readonly snapshot: FileSnapshot; readonly bytes: Uint8Array }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const before = await lstat(path, { bigint: true })
    if (before.isSymbolicLink()) throw unsafe()
    if (!before.isFile()) throw invalid("文件不是普通文件。")
    if (sizeLimit !== undefined && before.size > BigInt(sizeLimit)) throw tooLarge()
    const canonical = await realpath(path)
    if (!isInside(root, canonical) || !pathsEqual(canonical, path)) throw unsafe()
    const noFollow = constants.O_NOFOLLOW ?? 0
    handle = await open(path, constants.O_RDONLY | noFollow)
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFileIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw changed()
    }
    const bytes = await handle.readFile()
    if (sizeLimit !== undefined && bytes.length > sizeLimit) throw tooLarge()
    if (BigInt(bytes.length) !== opened.size) throw changed()
    return {
      snapshot: { identity: fileIdentity(opened), hash: sha256(bytes) },
      bytes,
    }
  } catch (error) {
    if (isImageError(error)) throw error
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw missingCode === "changed" ? changed() : invalid("文件不存在。")
    }
    throw failed("无法安全读取文件。")
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function verifyFileSnapshot(
  path: string,
  root: string,
  expected: FileSnapshot,
  sizeLimit?: number,
): Promise<void> {
  const current = await safeFileSnapshot(path, root, sizeLimit, "changed")
  if (
    !sameFileIdentity(current.snapshot.identity, expected.identity) ||
    current.snapshot.hash !== expected.hash
  ) {
    throw changed()
  }
}

async function boundedHashSnapshot(
  path: string,
  root: string,
  maxBytes: number,
  missingCode: "invalid" | "changed" = "invalid",
): Promise<FileSnapshot> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const before = await lstat(path, { bigint: true })
    if (before.isSymbolicLink()) throw unsafe()
    if (!before.isFile()) throw invalid("文件不是普通文件。")
    if (before.size > BigInt(maxBytes)) throw tooLarge("笔记超过允许的大小限制。")
    const canonical = await realpath(path)
    if (!isInside(root, canonical) || !pathsEqual(canonical, path)) throw unsafe()
    const flags = process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW
    handle = await open(path, flags)
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFileIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw changed()
    }
    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (position < Number(opened.size)) {
      const length = Math.min(buffer.length, Number(opened.size) - position)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      if (bytesRead <= 0) throw changed()
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    const afterHandle = await handle.stat({ bigint: true })
    const afterPath = await lstat(path, { bigint: true })
    if (
      !sameFileIdentity(fileIdentity(opened), fileIdentity(afterHandle)) ||
      !sameFileIdentity(fileIdentity(opened), fileIdentity(afterPath))
    ) {
      throw changed()
    }
    return { identity: fileIdentity(opened), hash: hash.digest("hex") }
  } catch (error) {
    if (isImageError(error)) throw error
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw missingCode === "changed" ? changed() : invalid("文件不存在。")
    }
    throw failed("无法安全读取文件。")
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function verifyNoteSnapshot(
  path: string,
  root: string,
  expected: FileSnapshot,
): Promise<void> {
  const current = await boundedHashSnapshot(path, root, MAX_MARKDOWN_UTF8_BYTES, "changed")
  if (
    !sameFileIdentity(current.identity, expected.identity) ||
    current.hash !== expected.hash
  ) {
    throw changed()
  }
}

async function noteSnapshot(
  workspace: string,
  parsed: ParsedNotePath,
): Promise<{ readonly path: string; readonly snapshot: FileSnapshot }> {
  const visibilityPath = resolve(workspace, parsed.visibility)
  const visibility = await inspectDirectory(visibilityPath, workspace, true)
  const domainPath = resolve(visibilityPath, parsed.domain)
  await inspectDirectory(domainPath, visibility.canonical, true)
  const path = resolve(domainPath, `${parsed.slug}.md`)
  const snapshot = await boundedHashSnapshot(path, domainPath, MAX_MARKDOWN_UTF8_BYTES)
  return { path, snapshot }
}

function naturalCompare(left: string, right: string): number {
  const compared = naturalCollator.compare(left, right)
  if (compared !== 0) return compared
  return left < right ? -1 : left > right ? 1 : 0
}

function validBase64Padding(payload: string): boolean {
  if (payload.endsWith("==")) return (BASE64_ALPHABET.indexOf(payload.at(-3)!) & 0x0f) === 0
  if (payload.endsWith("=")) return (BASE64_ALPHABET.indexOf(payload.at(-2)!) & 0x03) === 0
  return true
}

function validateThumbnail(rendered: RenderedImage): void {
  if (
    !Number.isSafeInteger(rendered.width) ||
    rendered.width <= 0 ||
    !Number.isSafeInteger(rendered.height) ||
    rendered.height <= 0 ||
    rendered.dataUrl.length > IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH
  ) {
    throw invalid("缩略图数据无效。")
  }
  const match = DATA_URL_PATTERN.exec(rendered.dataUrl)
  const mime = match?.[1]
  const payload = match?.[2]
  if (
    mime === undefined ||
    payload === undefined ||
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !validBase64Padding(payload)
  ) {
    throw invalid("缩略图数据无效。")
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  const decodedBytes = (payload.length / 4) * 3 - padding
  if (decodedBytes > IMAGE_LIBRARY_MAX_THUMBNAIL_DECODED_BYTES) {
    throw invalid("缩略图数据超过允许的大小。")
  }
  const bytes = Uint8Array.from(Buffer.from(payload, "base64"))
  const extension = mime === "jpeg" ? "jpg" : mime
  try {
    detectImageFormat(bytes, `thumbnail.${extension}`)
  } catch {
    throw invalid("缩略图格式与内容不匹配。")
  }
}

async function verifyMarker(path: string, library: DirectorySnapshot): Promise<FileSnapshot> {
  const marker = await safeFileSnapshot(path, library.canonical, undefined)
  if (marker.bytes.length !== 0) throw invalid("图片库占位文件必须为空。")
  return marker.snapshot
}

async function createOrVerifyMarker(
  path: string,
  library: DirectorySnapshot,
  adapter: ImageLibraryAdapter,
  owned: OwnedArtifact[],
): Promise<FileSnapshot> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let created: FileSnapshot | undefined
  try {
    await verifyDirectory(library.canonical, library.canonical, library)
    // O_EXCL is the strongest portable final-component creation primitive;
    // POSIX additionally gets O_NOFOLLOW. Node has no Windows openat equivalent.
    const flags =
      process.platform === "win32"
        ? "wx"
        : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    handle = await open(path, flags, 0o600)
    await handle.sync()
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.size !== 0n) throw changed()
    await handle.close()
    handle = undefined
    created = await verifyMarker(path, library)
    if (!sameFileIdentity(created.identity, fileIdentity(opened))) throw changed()
    owned.push({ kind: "file", path, identity: created.identity, parent: library })
    await adapter.syncDirectory?.(library.canonical)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    handle = undefined
    if (created !== undefined) {
      if (isImageError(error)) throw error
      throw failed("无法安全同步图片库占位文件。")
    }
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      if (isImageError(error)) throw error
      throw failed("无法创建图片库占位文件。")
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
  if (created !== undefined) {
    await verifyDirectory(library.canonical, library.canonical, library)
    await verifyFileSnapshot(path, library.canonical, created)
    return created
  }
  return verifyMarker(path, library)
}

function validateEntryType(entry: Dirent): void {
  if (entry.isSymbolicLink()) throw unsafe("图片库包含链接文件，已停止操作。")
  if (!entry.isFile()) throw invalid("图片库只能包含直接图片文件。")
}

async function readImage(
  entry: Dirent,
  library: DirectorySnapshot,
  slug: string,
  adapter: ImageLibraryAdapter,
): Promise<ImageLibraryItem> {
  validateEntryType(entry)
  const path = resolve(library.canonical, entry.name)
  const { snapshot, bytes } = await safeFileSnapshot(
    path,
    library.canonical,
    IMAGE_LIBRARY_MAX_FILE_BYTES,
  )
  try {
    detectImageFormat(bytes, entry.name)
  } catch {
    throw invalid("图片名称、扩展名或文件内容无效。")
  }
  await adapter.afterPhase?.("image-read")
  let rendered: RenderedImage
  try {
    rendered = await adapter.renderThumbnail(bytes)
  } catch {
    throw failed("无法生成图片缩略图。")
  }
  await adapter.afterPhase?.("thumbnail-rendered")
  validateThumbnail(rendered)
  await verifyFileSnapshot(path, library.canonical, snapshot, IMAGE_LIBRARY_MAX_FILE_BYTES)
  return {
    name: entry.name,
    sizeBytes: bytes.length,
    width: rendered.width,
    height: rendered.height,
    contentHash: snapshot.hash,
    thumbnailDataUrl: rendered.dataUrl,
    markdown: markdownForImage(slug, entry.name),
  }
}

async function acquireLocks(
  workspace: string,
  paths: readonly string[],
): Promise<readonly InternalNotePathLease[]> {
  const ordered = [...new Set(paths)].sort((left, right) => left.localeCompare(right))
  const acquired: InternalNotePathLease[] = []
  try {
    for (const path of ordered) acquired.push(await acquireInternalNotePathLease(workspace, path))
    return acquired
  } catch {
    let releaseFailed = false
    for (const lease of [...acquired].reverse()) {
      try {
        await lease.release()
      } catch {
        releaseFailed = true
      }
    }
    const error = failed("无法获取图片库操作锁。")
    if (releaseFailed) {
      throw imageError(error.code, error.message, {
        cleanupWarnings: [{ code: "LOCK_RELEASE_FAILED", message: "部分操作锁未能安全释放。" }],
      })
    }
    throw error
  }
}

async function assertLocks(leases: readonly InternalNotePathLease[]): Promise<void> {
  try {
    for (const lease of leases) await lease.assertOwned()
  } catch {
    throw changed("图片库操作锁已失效，请重试。")
  }
}

async function releaseLocks(
  leases: readonly InternalNotePathLease[],
  primary?: unknown,
): Promise<never | void> {
  let releaseFailed = false
  for (const lease of [...leases].reverse()) {
    try {
      await lease.release()
    } catch {
      releaseFailed = true
    }
  }
  if (primary !== undefined) {
    const safePrimary = isImageError(primary) ? primary : failed()
    if (releaseFailed) {
      throw imageError(safePrimary.code, safePrimary.message, {
        ...safePrimary.details,
        cleanupWarnings: [{ code: "LOCK_RELEASE_FAILED", message: "部分操作锁未能安全释放。" }],
      })
    }
    throw safePrimary
  }
  if (releaseFailed) throw failed("图片库已读取，但操作锁未能安全释放。")
}

async function cleanupOwnedArtifacts(
  artifacts: readonly OwnedArtifact[],
  adapter: ImageLibraryAdapter,
  primary: unknown,
): Promise<AppError> {
  const warnings: Array<{ readonly code: string; readonly message: string }> = []
  for (const artifact of [...artifacts].reverse()) {
    try {
      await verifyDirectory(artifact.parent.canonical, artifact.parent.canonical, artifact.parent)
      const current = await lstat(artifact.path, { bigint: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw error
      })
      if (current === undefined) continue
      const matches =
        artifact.kind === "file"
          ? current.isFile() &&
            !current.isSymbolicLink() &&
            sameFileIdentity(fileIdentity(current), artifact.identity as FileIdentity)
          : current.isDirectory() &&
            !current.isSymbolicLink() &&
            sameDirectoryIdentity(directoryIdentity(current), artifact.identity as DirectoryIdentity)
      if (!matches) {
        warnings.push({ code: "CLEANUP_UNCERTAIN", message: "未删除身份已变化的图片库项目。" })
        continue
      }
      if (artifact.kind === "file") await unlink(artifact.path)
      else await rmdir(artifact.path)
      try {
        await adapter.syncDirectory?.(artifact.parent.canonical)
      } catch {
        warnings.push({ code: "CLEANUP_SYNC_FAILED", message: "图片库清理后的目录同步失败。" })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      warnings.push({
        code: code === "ENOTEMPTY" || code === "EEXIST" ? "CLEANUP_RETAINED" : "CLEANUP_FAILED",
        message:
          code === "ENOTEMPTY" || code === "EEXIST"
            ? "图片库目录含有外部内容，已安全保留。"
            : "部分图片库项目未能安全清理。",
      })
    }
  }
  const safePrimary = isImageError(primary) ? primary : failed()
  return warnings.length === 0
    ? safePrimary
    : imageError(safePrimary.code, safePrimary.message, {
        ...safePrimary.details,
        cleanupWarnings: warnings,
      })
}

export function createImageLibraryService(options: {
  workspace: string
  adapter: ImageLibraryAdapter
}): ImageLibraryService {
  let disposed = false
  const active = new Set<Promise<ImageLibraryView>>()

  return {
    open(request: NotePathRequest): Promise<ImageLibraryView> {
      if (disposed) return Promise.reject(failed("图片库服务已关闭。"))
      const operation = (async (): Promise<ImageLibraryView> => {
        const parsed = parseNotePath(request.path)
        const workspace = await canonicalWorkspace(options.workspace)
        const initialNote = await noteSnapshot(workspace, parsed)
        try {
          await options.adapter.afterPhase?.("note-validated")
        } catch {
          throw failed("图片库验证未能完成。")
        }
        const leases = await acquireLocks(workspace, [parsed.path, parsed.attachmentPath])
        const owned: OwnedArtifact[] = []
        let result: ImageLibraryView | undefined
        let primaryError: unknown
        try {
          await assertLocks(leases)
          await verifyNoteSnapshot(initialNote.path, workspace, initialNote.snapshot)

          const visibilityPath = resolve(workspace, parsed.visibility)
          const visibility = await inspectDirectory(visibilityPath, workspace, true)
          const assetsPath = resolve(visibility.canonical, "_assets")
          const assets = await createOrInspectDirectory(
            assetsPath,
            visibility,
            options.adapter,
            owned,
          )
          const libraryPath = resolve(assets.canonical, parsed.slug)
          const library = await createOrInspectDirectory(
            libraryPath,
            assets,
            options.adapter,
            owned,
          )

          const entries = await readdir(library.canonical, { withFileTypes: true }).catch(() => {
            throw failed("无法读取图片库。")
          })
          let expectedManifest = await directChildManifest(library, entries)
          const markerEntry = entries.find(({ name }) => name === ".gitkeep")
          if (markerEntry !== undefined) validateEntryType(markerEntry)
          const imageEntries = entries.filter(({ name }) => name !== ".gitkeep")
          if (imageEntries.length > IMAGE_LIBRARY_MAX_ITEMS) throw tooLarge()

          const markerPath = resolve(library.canonical, ".gitkeep")
          let marker: FileSnapshot | undefined
          if (imageEntries.length === 0) {
            marker = await createOrVerifyMarker(markerPath, library, options.adapter, owned)
            if (markerEntry === undefined) {
              expectedManifest = withCreatedMarker(expectedManifest, marker)
            }
          } else if (markerEntry !== undefined) marker = await verifyMarker(markerPath, library)

          const images: ImageLibraryItem[] = []
          let thumbnailLength = 0
          for (const entry of imageEntries.sort((left, right) => naturalCompare(left.name, right.name))) {
            const image = await readImage(entry, library, parsed.slug, options.adapter)
            thumbnailLength += image.thumbnailDataUrl.length
            if (thumbnailLength > IMAGE_LIBRARY_MAX_GALLERY_THUMBNAIL_TOTAL_LENGTH) throw tooLarge()
            images.push(image)
          }

          await assertLocks(leases)
          await verifyNoteSnapshot(initialNote.path, workspace, initialNote.snapshot)
          await verifyDirectory(library.canonical, assets.canonical, library)
          if (marker !== undefined) await verifyFileSnapshot(markerPath, library.canonical, marker, 0)
          const finalManifest = await directChildManifest(library)
          if (!sameManifest(expectedManifest, finalManifest)) {
            throw changed("图片库内容在读取过程中发生变化，请重试。")
          }
          result = { path: parsed.path, images }
        } catch (error) {
          primaryError = await cleanupOwnedArtifacts(owned, options.adapter, error)
        }
        await releaseLocks(leases, primaryError)
        return result!
      })()
      active.add(operation)
      void operation.then(
        () => active.delete(operation),
        () => active.delete(operation),
      )
      return operation
    },

    async dispose(): Promise<void> {
      disposed = true
      await Promise.allSettled([...active])
    },
  }
}
