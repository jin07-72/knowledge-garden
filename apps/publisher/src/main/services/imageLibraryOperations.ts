import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { link, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve } from "node:path"
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
  | "delete-before-rename"
  | "delete-renamed"
  | "delete-before-commit"
  | "delete-committed"
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

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function createMarker(library: DirectoryProof, rollbackDirectory?: DirectoryProof): Promise<FileProof> {
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
    if (created !== undefined && rollbackDirectory !== undefined) {
      try {
        const held = resolve(rollbackDirectory.canonical, "marker")
        await rename(path, held)
        const moved = await fileSnapshot(held, rollbackDirectory.canonical, MAX_IMAGE_BYTES, true)
        if (moved.bytes.length !== 0 || !sameFileObject(moved.proof.identity, created.identity))
          throw new Error("marker identity changed")
      } catch {
        throw operationError("IMAGE_LIBRARY_FAILED", "无法确认失败后的占位文件清理。", {
          cleanupWarnings: [{ code: "DELETE_MARKER_UNCERTAIN", message: "请人工检查图片库。" }],
        })
      }
    }
    if (isImageLibraryOperationError(error)) throw error
    throw failed("无法恢复空图片库占位文件。")
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

interface SerializedFileIdentity {
  readonly dev: string
  readonly ino: string
  readonly size: string
  readonly mtimeNs: string
}

interface SerializedDirectoryIdentity {
  readonly dev: string
  readonly ino: string
  readonly birthtimeNs: string
}

interface DeleteManifest {
  readonly version: 1
  readonly id: string
  readonly workspace: string
  readonly note: string
  readonly name: string
  readonly expectedContentHash: string
  readonly expectedIdentity: SerializedFileIdentity
  readonly quarantineIdentity: SerializedDirectoryIdentity | null
  readonly phase: "prepared" | "renamed" | "committed"
}

interface DeleteJournal {
  readonly stage: DirectoryProof
  readonly manifestPath: string
  readonly manifest: DeleteManifest
  readonly manifestProof: FileProof
  readonly quarantinePath: string
  readonly quarantine?: DirectoryProof
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLEANUP_DIRECTORY_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.cleanup$/i
const HASH_PATTERN = /^[a-f0-9]{64}$/

function serializeFileIdentity(value: FileIdentity): SerializedFileIdentity {
  return {
    dev: value.dev.toString(),
    ino: value.ino.toString(),
    size: value.size.toString(),
    mtimeNs: value.mtimeNs.toString(),
  }
}

function serializeDirectoryIdentity(value: DirectoryProof): SerializedDirectoryIdentity {
  return {
    dev: value.dev.toString(),
    ino: value.ino.toString(),
    birthtimeNs: value.birthtimeNs.toString(),
  }
}

function sameSerializedFileIdentity(value: FileIdentity, expected: SerializedFileIdentity): boolean {
  return (
    value.dev.toString() === expected.dev &&
    value.ino.toString() === expected.ino &&
    value.size.toString() === expected.size &&
    value.mtimeNs.toString() === expected.mtimeNs
  )
}

function sameSerializedDirectoryIdentity(
  value: DirectoryProof,
  expected: SerializedDirectoryIdentity,
): boolean {
  return (
    value.dev.toString() === expected.dev &&
    value.ino.toString() === expected.ino &&
    value.birthtimeNs.toString() === expected.birthtimeNs
  )
}

function workspaceHash(workspace: string): string {
  return createHash("sha256").update(Buffer.from(workspace)).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseIdentity(value: unknown, directory = false): value is SerializedFileIdentity | SerializedDirectoryIdentity {
  if (!isRecord(value)) return false
  const keys = directory ? ["dev", "ino", "birthtimeNs"] : ["dev", "ino", "size", "mtimeNs"]
  return exactKeys(value, keys) && keys.every((key) => typeof value[key] === "string" && /^\d+$/.test(value[key] as string))
}

function parseDeleteManifest(bytes: Uint8Array, expectedId: string, workspace: string): DeleteManifest {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"))
  } catch {
    throw failed("图片删除恢复记录无效。")
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, ["version", "id", "workspace", "note", "name", "expectedContentHash", "expectedIdentity", "quarantineIdentity", "phase"]) ||
    value.version !== 1 ||
    value.id !== expectedId ||
    value.workspace !== workspaceHash(workspace) ||
    typeof value.note !== "string" ||
    MANAGED_NOTE_PATH_PATTERN.exec(value.note) === null ||
    typeof value.name !== "string" ||
    safeName(value.name) !== value.name ||
    typeof value.expectedContentHash !== "string" ||
    !HASH_PATTERN.test(value.expectedContentHash) ||
    !parseIdentity(value.expectedIdentity) ||
    !(value.quarantineIdentity === null || parseIdentity(value.quarantineIdentity, true)) ||
    !["prepared", "renamed", "committed"].includes(String(value.phase))
  )
    throw failed("图片删除恢复记录无效。")
  return value as unknown as DeleteManifest
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

async function writeManifestFile(
  path: string,
  root: string,
  manifest: DeleteManifest,
): Promise<{ handle: Awaited<ReturnType<typeof open>>; proof: FileProof }> {
  const handle = await open(path, "wx", 0o600).catch(() => {
    throw failed("无法创建图片删除恢复记录。")
  })
  try {
    await handle.writeFile(JSON.stringify(manifest))
    await handle.sync()
    const proof = (await fileSnapshot(path, root, 64 * 1024, true)).proof
    const opened = await handle.stat({ bigint: true })
    if (!sameIdentity(identity(opened), proof.identity)) throw failed("图片删除恢复记录身份无效。")
    return { handle, proof }
  } catch {
    await handle.close().catch(() => undefined)
    throw failed("无法同步图片删除恢复记录。")
  }
}

async function rewriteManifest(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  root: string,
  manifest: DeleteManifest,
): Promise<FileProof> {
  try {
    await handle.truncate(0)
    await handle.write(JSON.stringify(manifest), 0, "utf8")
    await handle.sync()
    const proof = (await fileSnapshot(path, root, 64 * 1024, true)).proof
    const opened = await handle.stat({ bigint: true })
    if (!sameIdentity(identity(opened), proof.identity)) throw failed("图片删除恢复记录身份已变化。")
    return proof
  } catch {
    throw failed("无法更新图片删除恢复记录。")
  }
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

async function moveQuarantineIntoStage(journal: DeleteJournal): Promise<void> {
  if (journal.quarantine === undefined || !(await targetExists(journal.quarantinePath))) return
  const held = resolve(journal.stage.canonical, "quarantine")
  if (pathsEqual(journal.quarantinePath, held)) return
  await verifyDirectory(journal.quarantinePath, resolve(journal.quarantinePath, ".."), journal.quarantine)
  if (await targetExists(held)) throw failed("图片删除暂存目录包含未知项目。")
  await rename(journal.quarantinePath, held)
  const moved = await inspectDirectory(held, journal.stage.canonical)
  if (
    moved.dev !== journal.quarantine.dev ||
    moved.ino !== journal.quarantine.ino ||
    moved.birthtimeNs !== journal.quarantine.birthtimeNs
  )
    throw failed("图片删除隔离目录身份已变化。")
}

async function removeCapturedJournal(journal: DeleteJournal, deleteRoot: DirectoryProof): Promise<void> {
  await moveQuarantineIntoStage(journal)
  await verifyFile(journal.manifestPath, journal.stage.canonical, journal.manifestProof)
  const children = await readdir(journal.stage.canonical, { withFileTypes: true })
  if (children.some((entry) => !entry.isFile() && !(entry.name === "quarantine" && entry.isDirectory())))
    throw failed("图片删除记录包含未知项目。")
  if (children.some((entry) => entry.name !== "manifest.json" && entry.name !== "quarantine"))
    throw failed("图片删除记录包含未知项目。")
  let captured = journal.stage.canonical
  if (!CLEANUP_DIRECTORY_PATTERN.test(basename(journal.stage.canonical))) {
    captured = resolve(deleteRoot.canonical, `${journal.manifest.id}.cleanup`)
    await rename(journal.stage.canonical, captured)
    const moved = await inspectDirectory(captured, deleteRoot.canonical)
    if (
      moved.dev !== journal.stage.dev ||
      moved.ino !== journal.stage.ino ||
      moved.birthtimeNs !== journal.stage.birthtimeNs
    )
      throw failed("图片删除记录身份已变化。")
  }
  await rm(captured, { recursive: true })
}

async function loadJournal(
  workspace: string,
  deleteRoot: DirectoryProof,
  id: string,
  directoryName = id,
): Promise<DeleteJournal> {
  const stage = await inspectDirectory(resolve(deleteRoot.canonical, directoryName), deleteRoot.canonical)
  const manifestPath = resolve(stage.canonical, "manifest.json")
  const manifestBytes = await fileSnapshot(manifestPath, stage.canonical, 64 * 1024)
  const manifest = parseDeleteManifest(manifestBytes.bytes, id, workspace)
  const parsed = parsePath(manifest.note)
  const library = await libraryProof(workspace, parsed)
  const quarantinePath = resolve(library.canonical, `.garden-delete-${id}`)
  const heldQuarantinePath = resolve(stage.canonical, "quarantine")
  let currentQuarantinePath = quarantinePath
  let quarantine: DirectoryProof | undefined
  if (manifest.quarantineIdentity !== null && await targetExists(quarantinePath)) {
    quarantine = await inspectDirectory(quarantinePath, library.canonical)
    if (!sameSerializedDirectoryIdentity(quarantine, manifest.quarantineIdentity))
      throw failed("图片删除隔离目录身份不匹配。")
  } else if (manifest.quarantineIdentity === null && await targetExists(quarantinePath)) {
    quarantine = await inspectDirectory(quarantinePath, library.canonical)
    if ((await readdir(quarantine.canonical)).length !== 0)
      throw failed("未登记的图片删除隔离目录包含内容，已保留。")
  } else if (manifest.quarantineIdentity !== null && await targetExists(heldQuarantinePath)) {
    quarantine = await inspectDirectory(heldQuarantinePath, stage.canonical)
    currentQuarantinePath = heldQuarantinePath
    if (!sameSerializedDirectoryIdentity(quarantine, manifest.quarantineIdentity))
      throw failed("图片删除隔离目录身份不匹配。")
  }
  return { stage, manifestPath, manifest, manifestProof: manifestBytes.proof, quarantinePath: currentQuarantinePath, ...(quarantine === undefined ? {} : { quarantine }) }
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
  const hasQuarantined = journal.quarantine !== undefined && await targetExists(quarantined)
  if (hasQuarantined) {
    const moved = await fileSnapshot(quarantined, journal.quarantine!.canonical, MAX_IMAGE_BYTES, true)
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
  await removeCapturedJournal(journal, deleteRoot)
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
  await removeCapturedJournal(journal, deleteRoot)
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
    const cleanupMatch = CLEANUP_DIRECTORY_PATTERN.exec(entry.name)
    const id = cleanupMatch?.[1] ?? entry.name
    if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID_PATTERN.test(id))
      throw failed("图片删除恢复目录包含未知项目。")
    const journal = await loadJournal(workspace, deleteRoot, id, entry.name)
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
): Promise<{ journal: DeleteJournal; deleteRoot: DirectoryProof; handle: Awaited<ReturnType<typeof open>> }> {
  const workspaceDirectory = await inspectDirectory(workspace, workspace)
  const garden = await ensureDirectory(resolve(workspace, ".garden-publisher"), workspaceDirectory)
  const deleteRoot = await ensureDirectory(resolve(garden.canonical, "image-delete"), garden)
  const id = randomUUID()
  const stage = await exclusiveDirectory(resolve(deleteRoot.canonical, id), deleteRoot)
  const quarantinePath = resolve(library.canonical, `.garden-delete-${id}`)
  let manifest: DeleteManifest = {
    version: 1,
    id,
    workspace: workspaceHash(workspace),
    note: parsed.path,
    name,
    expectedContentHash: original.hash,
    expectedIdentity: serializeFileIdentity(original.identity),
    quarantineIdentity: null,
    phase: "prepared",
  }
  const manifestPath = resolve(stage.canonical, "manifest.json")
  const writer = await writeManifestFile(manifestPath, stage.canonical, manifest)
  await adapter.syncDirectory?.(stage.canonical)
  await adapter.syncDirectory?.(deleteRoot.canonical)
  const quarantine = await exclusiveDirectory(quarantinePath, library)
  manifest = { ...manifest, quarantineIdentity: serializeDirectoryIdentity(quarantine) }
  const manifestProof = await rewriteManifest(writer.handle, manifestPath, stage.canonical, manifest)
  await adapter.syncDirectory?.(stage.canonical)
  await adapter.syncDirectory?.(library.canonical)
  return {
    journal: { stage, manifestPath, manifest, manifestProof, quarantinePath, quarantine },
    deleteRoot,
    handle: writer.handle,
  }
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
  let manifestHandle: Awaited<ReturnType<typeof open>> | undefined
  let committed = false
  let createdMarker: FileProof | undefined
  let primary: unknown
  try {
    const created = await createDeleteJournal(workspace, parsed, name, original.proof, library, adapter)
    journal = created.journal
    deleteRoot = created.deleteRoot
    manifestHandle = created.handle
    await adapter.afterPhase?.("delete-quarantine-linked")
    await adapter.afterPhase?.("delete-before-rename")
    const quarantined = resolve(journal.quarantinePath, "image")
    if (await targetExists(quarantined)) throw changed("图片删除隔离位置已被外部占用。")
    await rename(target, quarantined)
    const moved = await fileSnapshot(quarantined, journal.quarantine!.canonical, MAX_IMAGE_BYTES, true)
    if (
      moved.proof.hash !== original.proof.hash ||
      !sameFileObject(moved.proof.identity, original.proof.identity)
    )
      throw changed("待删除位置在原子隔离前已被替换。")
    await adapter.syncDirectory?.(journal.quarantine!.canonical)
    await adapter.syncDirectory?.(library.canonical)
    journal = { ...journal, manifest: { ...journal.manifest, phase: "renamed" } }
    journal = {
      ...journal,
      manifestProof: await rewriteManifest(
        manifestHandle,
        journal.manifestPath,
        journal.stage.canonical,
        journal.manifest,
      ),
    }
    await adapter.syncDirectory?.(journal.stage.canonical)
    await adapter.afterPhase?.("delete-quarantined")
    await adapter.afterPhase?.("delete-renamed")

    const state = await inspectMarkerAndImages(library, `.garden-delete-${journal.manifest.id}`)
    if (state.images.length === 0 && state.marker === undefined) {
      createdMarker = await createMarker(library, journal.quarantine)
      await adapter.syncDirectory?.(library.canonical)
    }
    if (await targetExists(target)) throw changed("删除位置已被外部创建。")
    await verifyFile(quarantined, journal.quarantine!.canonical, moved.proof)
    await adapter.afterPhase?.("delete-before-commit")
    await adapter.syncDirectory?.(library.canonical)
    journal = { ...journal, manifest: { ...journal.manifest, phase: "committed" } }
    journal = {
      ...journal,
      manifestProof: await rewriteManifest(
        manifestHandle,
        journal.manifestPath,
        journal.stage.canonical,
        journal.manifest,
      ),
    }
    await adapter.syncDirectory?.(journal.stage.canonical)
    committed = true
    await adapter.afterPhase?.("delete-committed")
  } catch (error) {
    primary = error
  }
  await manifestHandle?.close().catch(() => {
    primary = failed("无法关闭图片删除恢复记录。")
  })
  if (!committed && primary !== undefined && createdMarker !== undefined && journal?.quarantine !== undefined) {
    const markerPath = resolve(library.canonical, ".gitkeep")
    const heldMarker = resolve(journal.quarantine.canonical, "marker")
    try {
      await rename(markerPath, heldMarker)
      const movedMarker = await fileSnapshot(heldMarker, journal.quarantine.canonical, MAX_IMAGE_BYTES, true)
      if (movedMarker.bytes.length !== 0 || !sameFileObject(movedMarker.proof.identity, createdMarker.identity))
        throw new Error("marker changed")
    } catch {
      throw operationError("IMAGE_LIBRARY_FAILED", "图片删除失败且占位文件恢复未能确认。", {
        cleanupWarnings: [{ code: "DELETE_MARKER_UNCERTAIN", message: "请刷新并人工检查图片库。" }],
      })
    }
  }
  if (journal !== undefined && deleteRoot !== undefined) {
    try {
      await recoverJournal(workspace, journal, deleteRoot, adapter)
    } catch {
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

let previewTail: Promise<void> = Promise.resolve()

async function serializePreview<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void
  const predecessor = previewTail
  previewTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await predecessor
  try {
    return await operation()
  } finally {
    release()
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
      return serializePreview(() => withOperation(options.workspace, request.path, async ({ parsed, library }) => {
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
