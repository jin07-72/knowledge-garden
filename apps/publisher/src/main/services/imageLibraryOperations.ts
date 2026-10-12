import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { link, lstat, open, readdir, realpath, stat, unlink } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import {
  MANAGED_NOTE_PATH_PATTERN,
  type AppError,
  type ImageLibraryItemRequest,
  type ImageLibraryPreview,
} from "../../shared/contracts"
import { MAX_MARKDOWN_UTF8_BYTES } from "../../shared/ipcSchemas"
import { detectImageFormat, imageDataUrl, markdownForImage, normalizeImageName } from "./imageFormats"
import { syncImageLibraryMarker } from "./imageLibraryFs"
import { acquireInternalNotePathLease, type InternalNotePathLease } from "./noteFiles"

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const operationErrors = new WeakSet<object>()

type OperationPhase =
  | "delete-before-quarantine"
  | "delete-quarantine-linked"
  | "delete-quarantined"
  | "delete-target-removed"

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

async function removeOwned(
  path: string,
  root: string,
  expected: FileProof,
  allowLinkCtimeChange = false,
): Promise<boolean> {
  try {
    const current = await fileSnapshot(path, root, MAX_IMAGE_BYTES, true)
    if (
      current.proof.hash !== expected.hash ||
      !(allowLinkCtimeChange
        ? sameFileObject(current.proof.identity, expected.identity)
        : sameIdentity(current.proof.identity, expected.identity))
    )
      return false
    await unlink(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    return false
  }
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

async function createMarker(library: DirectoryProof): Promise<FileProof> {
  const path = resolve(library.canonical, ".gitkeep")
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let created: FileProof | undefined
  try {
    const flags = process.platform === "win32"
      ? "wx"
      : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    handle = await open(path, flags, 0o600)
    const details = await handle.stat({ bigint: true })
    if (!details.isFile() || details.size !== 0n) throw changed()
    created = { identity: identity(details), hash: createHash("sha256").digest("hex") }
    await syncImageLibraryMarker(handle)
    return created
  } catch (error) {
    await handle?.close().catch(() => undefined)
    handle = undefined
    if (created !== undefined && !(await removeOwned(path, library.canonical, created))) {
      throw failed("无法确认失败后的占位文件清理。")
    }
    if (isImageLibraryOperationError(error)) throw error
    throw failed("无法恢复空图片库占位文件。")
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function deleteImage(
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

  await adapter.afterPhase?.("delete-before-quarantine")
  await verifyFile(target, library.canonical, original.proof)
  const quarantine = resolve(library.canonical, `.garden-delete-${randomUUID()}.tmp`)
  let quarantineProof: FileProof | undefined
  let quarantineProofAllowsCtimeChange = false
  let targetRemoved = false
  let markerProof: FileProof | undefined
  let existingMarkerProof: FileProof | undefined
  try {
    try {
      await link(target, quarantine)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw changed("删除隔离位置已被占用。")
      throw failed("无法安全隔离待删除图片。")
    }
    quarantineProof = original.proof
    quarantineProofAllowsCtimeChange = true
    await adapter.afterPhase?.("delete-quarantine-linked")
    quarantineProof = (await fileSnapshot(quarantine, library.canonical, MAX_IMAGE_BYTES, true)).proof
    quarantineProofAllowsCtimeChange = false
    const linkedTarget = (await fileSnapshot(target, library.canonical, MAX_IMAGE_BYTES, true)).proof
    if (
      !sameFileObject(quarantineProof.identity, original.proof.identity) ||
      !sameIdentity(quarantineProof.identity, linkedTarget.identity) ||
      quarantineProof.hash !== original.proof.hash ||
      linkedTarget.hash !== original.proof.hash
    )
      throw changed("待删除图片在隔离时发生变化。")
    const linkedProof = linkedTarget
    await adapter.syncDirectory?.(library.canonical)
    await adapter.afterPhase?.("delete-quarantined")
    await verifyFile(quarantine, library.canonical, quarantineProof)
    await verifyFile(target, library.canonical, linkedProof)
    await unlink(target)
    targetRemoved = true
    quarantineProof = (await fileSnapshot(quarantine, library.canonical, MAX_IMAGE_BYTES, true)).proof
    await adapter.syncDirectory?.(library.canonical)
    await adapter.afterPhase?.("delete-target-removed")

    const children = await readdir(library.canonical, { withFileTypes: true })
    const existingMarker = children.find(({ name: child }) => child === ".gitkeep")
    if (existingMarker !== undefined) {
      if (existingMarker.isSymbolicLink()) throw unsafe("图片库占位文件不能是链接。")
      if (!existingMarker.isFile()) throw invalid("图片库占位文件不是普通文件。")
      const marker = await fileSnapshot(
        resolve(library.canonical, ".gitkeep"),
        library.canonical,
        MAX_IMAGE_BYTES,
      )
      if (marker.bytes.length !== 0) throw invalid("图片库占位文件必须为空。")
      existingMarkerProof = marker.proof
    }
    const remainingImages = children.filter(({ name: child }) => child !== ".gitkeep" && child !== quarantine.split(/[\\/]/).at(-1))
    for (const child of remainingImages) {
      if (child.isSymbolicLink()) throw unsafe("图片库包含链接文件，已停止操作。")
      if (!child.isFile()) throw invalid("图片库只能包含直接图片文件。")
      safeName(child.name)
    }
    if (remainingImages.length === 0 && !children.some(({ name: child }) => child === ".gitkeep")) {
      markerProof = await createMarker(library)
      await adapter.syncDirectory?.(library.canonical)
    }

    if (await targetExists(target)) throw changed("删除位置已被外部创建。")
    if (existingMarkerProof !== undefined) {
      await verifyFile(
        resolve(library.canonical, ".gitkeep"),
        library.canonical,
        existingMarkerProof,
      )
    }
    await verifyFile(quarantine, library.canonical, quarantineProof)
    await unlink(quarantine)
    quarantineProof = undefined
    await adapter.syncDirectory?.(library.canonical)
  } catch (error) {
    let cleanupFailed = false
    if (targetRemoved && quarantineProof !== undefined) {
      if (!(await targetExists(target))) {
        try {
          await verifyFile(quarantine, library.canonical, quarantineProof)
          await link(quarantine, target)
          quarantineProof = (await fileSnapshot(quarantine, library.canonical, MAX_IMAGE_BYTES, true)).proof
          const restored = await fileSnapshot(target, library.canonical, MAX_IMAGE_BYTES, true)
          if (!sameIdentity(restored.proof.identity, quarantineProof.identity) || restored.proof.hash !== quarantineProof.hash)
            cleanupFailed = true
        } catch {
          cleanupFailed = true
        }
      }
    }
    if (markerProof !== undefined) {
      if (!(await removeOwned(resolve(library.canonical, ".gitkeep"), library.canonical, markerProof)))
        cleanupFailed = true
    }
    if (quarantineProof !== undefined) {
      if (!(await removeOwned(
        quarantine,
        library.canonical,
        quarantineProof,
        quarantineProofAllowsCtimeChange,
      ))) cleanupFailed = true
    }
    try {
      await adapter.syncDirectory?.(library.canonical)
    } catch {
      cleanupFailed = true
    }
    if (cleanupFailed) throw failed("删除未能安全完成，请刷新图片库检查。")
    if (isImageLibraryOperationError(error)) throw error
    throw failed("无法永久删除图片。")
  }
}

export function createImageLibraryOperations(options: {
  readonly workspace: string
  readonly adapter: OperationAdapter
}): {
  preview(request: ImageLibraryItemRequest): Promise<ImageLibraryPreview>
  copyMarkdown(request: ImageLibraryItemRequest): Promise<void>
  delete(request: Required<ImageLibraryItemRequest>): Promise<void>
} {
  return {
    preview(request) {
      return withOperation(options.workspace, request.path, async ({ parsed, library }) => {
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
      })
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
      return withOperation(options.workspace, request.path, ({ library }) =>
        deleteImage(request, library, options.adapter),
      )
    },
  }
}
