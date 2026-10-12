import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats, type Dirent } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { link, lstat, mkdir, open, opendir, readdir, realpath, rmdir, rm, unlink } from "node:fs/promises"
import {
  IMAGE_LIBRARY_MAX_SELECTION_ITEMS,
  IMAGE_LIBRARY_MAX_SELECTION_THUMBNAIL_TOTAL_LENGTH,
  IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH,
  IMAGE_LIBRARY_MAX_THUMBNAIL_DECODED_BYTES,
  IMAGE_LIBRARY_MAX_ITEMS,
  type AppError,
  type ImageLibraryCommitRequest,
  type ImageLibraryItem,
  type ImageLibrarySelection,
  type ImageLibraryView,
  type NotePathRequest,
} from "../../shared/contracts"
import { detectImageFormat, markdownForImage, normalizeImageName } from "./imageFormats"
import { captureImportPathIdentity, removeImportArtifact } from "./imageLibraryImportFs"
import { acquireInternalNotePathLease, type InternalNotePathLease } from "./noteFiles"
import type { ImageLibraryAdapter, RenderedImage } from "./imageLibrary"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const TTL_MS = 5 * 60 * 1000
const MAX_SESSIONS = 8
const MAX_RESIDUE_ENTRIES = 32
const MAX_RESIDUE_CHILDREN = 256
const MAX_MANIFEST_BYTES = 64 * 1024
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const trustedImportErrors = new WeakSet<object>()
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

type Identity = Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs">
type DirectoryProof = Pick<BigIntStats, "dev" | "ino" | "birthtimeNs">
interface Source { path: string; identity: Identity; hash: string; item: ImageLibraryItem }
interface FileProof { identity: Identity; hash: string }
interface LibraryEntry extends FileProof { name: string; type: "file" }
type LibraryManifest = readonly LibraryEntry[]
interface LibraryDirectoryProof { canonical: string; identity: DirectoryProof }
interface Session { id: string; path: string; created: number; sources: readonly Source[]; conflicts: readonly string[]; note: { identity: Identity; hash: string }; library: LibraryManifest; libraryDirectory: LibraryDirectoryProof }

function error(code: AppError["code"], message: string, cleanup = false): AppError {
  const result = (cleanup
    ? { code, message, details: { cleanupWarnings: [{ code: "CLEANUP_UNCERTAIN", message: "无法确认图片导入回滚完整，请手动检查图片库。" }] } }
    : { code, message }) as AppError
  trustedImportErrors.add(result)
  return result
}
export const isImageLibraryImportError = (value: unknown): value is AppError =>
  typeof value === "object" && value !== null && trustedImportErrors.has(value)
const invalid = (message = "所选图片无效。") => error("IMAGE_LIBRARY_INVALID", message)
const changed = (message = "图片或图片库已发生变化，请重新选择。") => error("IMAGE_LIBRARY_CHANGED", message)
const failed = (message = "图片导入失败，请重试。", cleanup = false) => error("IMAGE_LIBRARY_FAILED", message, cleanup)
const tooLarge = () => error("IMAGE_LIBRARY_TOO_LARGE", "所选图片超过允许的数量或大小限制。")
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const key = (name: string) => name.toLocaleLowerCase("en-US")
const identity = (s: BigIntStats): Identity => ({ dev: s.dev, ino: s.ino, size: s.size, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs })
const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
const sameRenamedFile = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs
const pathsEqual = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
const inside = (root: string, path: string) => { const difference = relative(root, path); return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference)) }

async function boundedDirectoryEntries(path: string, maximum: number): Promise<readonly Dirent[]> {
  const directory = await opendir(path); const entries: Dirent[] = []
  for await (const entry of directory) {
    entries.push(entry)
    if (entries.length > maximum) throw failed("图片导入恢复项目超过安全限制。", true)
  }
  return entries
}

function validateThumbnail(rendered: RenderedImage): void {
  if (!Number.isSafeInteger(rendered.width) || rendered.width <= 0 || !Number.isSafeInteger(rendered.height) || rendered.height <= 0 || rendered.dataUrl.length > IMAGE_LIBRARY_MAX_THUMBNAIL_DATA_URL_LENGTH) throw invalid("缩略图数据无效。")
  const match = /^data:image\/(png|jpeg|gif|webp|avif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(rendered.dataUrl)
  if (match === null || match[2]!.length % 4 !== 0) throw invalid("缩略图数据无效。")
  const payload = match[2]!
  if ((payload.endsWith("==") && (BASE64_ALPHABET.indexOf(payload.at(-3)!) & 0x0f) !== 0) || (payload.endsWith("=") && !payload.endsWith("==") && (BASE64_ALPHABET.indexOf(payload.at(-2)!) & 0x03) !== 0)) throw invalid("缩略图数据无效。")
  const bytes = Uint8Array.from(Buffer.from(payload, "base64"))
  if (bytes.length > IMAGE_LIBRARY_MAX_THUMBNAIL_DECODED_BYTES) throw invalid("缩略图数据超过允许大小。")
  try { detectImageFormat(bytes, `thumbnail.${match[1] === "jpeg" ? "jpg" : match[1]}`) } catch { throw invalid("缩略图格式与内容不匹配。") }
}

async function sourceSnapshot(path: string, initialStat?: (path: string) => Promise<BigIntStats>): Promise<{ identity: Identity; bytes: Uint8Array; hash: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    if (!isAbsolute(path) || resolve(path) !== path) throw invalid("图片源路径无效。")
    const before = initialStat === undefined ? await lstat(path, { bigint: true }) : await initialStat(path)
    if (before.isSymbolicLink() || !before.isFile()) throw invalid("图片源必须是普通文件。")
    if (before.size > BigInt(MAX_FILE_BYTES)) throw tooLarge()
    const canonical = await realpath(path)
    if (process.platform === "win32" ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path) throw invalid("图片源路径不安全。")
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw changed()
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (bytes.length > MAX_FILE_BYTES || !sameIdentity(identity(opened), identity(after))) throw changed()
    return { identity: identity(opened), bytes, hash: hash(bytes) }
  } catch (caught) {
    if (typeof caught === "object" && caught !== null && "code" in caught && String((caught as AppError).code).startsWith("IMAGE_LIBRARY_")) throw caught
    throw invalid("无法安全读取所选图片。")
  } finally { await handle?.close().catch(() => undefined) }
}

async function exactFile(path: string, expected: Source): Promise<Uint8Array> {
  return verifyProof(path, expected)
}

async function verifyProof(path: string, expected: FileProof): Promise<Uint8Array> {
  const current = await sourceSnapshot(path)
  if (!sameIdentity(current.identity, expected.identity) || current.hash !== expected.hash) throw changed()
  return current.bytes
}

async function inspectLibraryDirectory(path: string): Promise<LibraryDirectoryProof> {
  try {
    const before = await lstat(path, { bigint: true })
    if (before.isSymbolicLink() || !before.isDirectory()) throw changed("图片库目录已发生变化。")
    const canonical = await realpath(path)
    const after = await lstat(path, { bigint: true })
    const proof = { dev: before.dev, ino: before.ino, birthtimeNs: before.birthtimeNs }
    if (!pathsEqual(canonical, path) || after.isSymbolicLink() || !after.isDirectory() || after.dev !== proof.dev || after.ino !== proof.ino || after.birthtimeNs !== proof.birthtimeNs) throw changed("图片库目录已发生变化。")
    return { canonical, identity: proof }
  } catch (caught) {
    if ((caught as AppError).code === "IMAGE_LIBRARY_CHANGED") throw caught
    throw changed("图片库目录已发生变化。")
  }
}

const sameLibraryDirectory = (left: LibraryDirectoryProof, right: LibraryDirectoryProof): boolean =>
  pathsEqual(left.canonical, right.canonical) && left.identity.dev === right.identity.dev && left.identity.ino === right.identity.ino && left.identity.birthtimeNs === right.identity.birthtimeNs

async function readLibraryManifest(path: string, expectedDirectory?: LibraryDirectoryProof): Promise<LibraryManifest> {
  try {
    const directoryBefore = await inspectLibraryDirectory(path)
    if (expectedDirectory !== undefined && !sameLibraryDirectory(directoryBefore, expectedDirectory)) throw changed("图片库目录已发生变化。")
    const entries = await readdir(path, { withFileTypes: true })
    const manifest: Array<{ name: string; identity: Identity }> = []
    const result: LibraryEntry[] = []; const insensitive = new Set<string>()
    for (const entry of [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.isSymbolicLink() || !entry.isFile()) throw changed("图片库包含不安全的项目。")
      const snapshot = await sourceSnapshot(join(path, entry.name))
      manifest.push({ name: entry.name, identity: snapshot.identity })
      result.push({ name: entry.name, type: "file", identity: snapshot.identity, hash: snapshot.hash })
      if (entry.name === ".gitkeep") {
        if (snapshot.bytes.length !== 0) throw invalid("图片库占位文件无效。")
        continue
      }
      try { normalizeImageName(entry.name); detectImageFormat(snapshot.bytes, entry.name) } catch { throw invalid("图片库包含无效图片。") }
      if (insensitive.has(key(entry.name))) throw invalid("图片库包含大小写冲突的名称。")
      insensitive.add(key(entry.name))
    }
    const finalEntries = await readdir(path, { withFileTypes: true })
    if (finalEntries.length !== manifest.length) throw changed()
    for (const expected of manifest) {
      const entry = finalEntries.find(({ name }) => name === expected.name)
      if (entry === undefined || entry.isSymbolicLink() || !entry.isFile()) throw changed()
      const details = await lstat(join(path, entry.name), { bigint: true })
      if (!sameIdentity(identity(details), expected.identity)) throw changed()
    }
    const directoryAfter = await inspectLibraryDirectory(path)
    if (!sameLibraryDirectory(directoryBefore, directoryAfter) || (expectedDirectory !== undefined && !sameLibraryDirectory(directoryAfter, expectedDirectory))) throw changed("图片库目录已发生变化。")
    return result
  } catch (caught) {
    if ((caught as AppError).code === "IMAGE_LIBRARY_CHANGED") throw caught
    throw changed()
  }
}

function sameLibraryManifest(left: LibraryManifest, right: LibraryManifest): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index]
    return other !== undefined && entry.name === other.name && entry.type === other.type && entry.hash === other.hash && sameIdentity(entry.identity, other.identity)
  })
}
const sortLibraryManifest = (entries: readonly LibraryEntry[]): LibraryManifest =>
  [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

async function safeDirectory(path: string): Promise<void> {
  try { await mkdir(path, { mode: 0o700 }) } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "EEXIST") throw failed("无法创建图片导入暂存目录。")
  }
  try {
    const details = await lstat(path, { bigint: true })
    const canonical = await realpath(path)
    const equal = process.platform === "win32" ? canonical.toLowerCase() === path.toLowerCase() : canonical === path
    if (details.isSymbolicLink() || !details.isDirectory() || !equal) throw failed("图片导入暂存路径不安全。")
  } catch (caught) {
    if ((caught as AppError).code === "IMAGE_LIBRARY_FAILED") throw caught
    throw failed("无法验证图片导入暂存目录。")
  }
}

async function exclusiveDirectory(path: string): Promise<DirectoryProof> {
  try { await mkdir(path, { mode: 0o700 }) } catch { throw changed("图片导入暂存目录已被占用。") }
  const details = await lstat(path, { bigint: true })
  const canonical = await realpath(path)
  const equal = process.platform === "win32" ? canonical.toLowerCase() === path.toLowerCase() : canonical === path
  if (details.isSymbolicLink() || !details.isDirectory() || !equal) throw failed("图片导入暂存路径不安全。")
  return { dev: details.dev, ino: details.ino, birthtimeNs: details.birthtimeNs }
}

interface StageLedger {
  readonly root: { path: string; proof: DirectoryProof }
  readonly directories: Array<{ path: string; proof: DirectoryProof }>
  readonly files: Map<string, FileProof>
}

interface QuarantinedFile {
  readonly backup: string
  readonly target: string
  readonly expected: FileProof
  proof?: FileProof
}

interface PublishedFile {
  readonly path: string
  readonly staged: string
  readonly expected: FileProof
  proof?: FileProof
}

async function removeOwnedPublication(item: PublishedFile, ledger: StageLedger | undefined): Promise<boolean> {
  try {
    const target = await sourceSnapshot(item.path)
    if (item.proof !== undefined) {
      if (!sameIdentity(target.identity, item.proof.identity) || target.hash !== item.proof.hash) return false
    } else {
      const staged = await sourceSnapshot(item.staged)
      if (!sameIdentity(target.identity, staged.identity) || target.hash !== item.expected.hash || staged.hash !== item.expected.hash || !sameRenamedFile(staged.identity, item.expected.identity)) return false
    }
    await unlink(item.path)
    if (item.proof === undefined && ledger?.files.has(item.staged)) {
      const restoredStage = await sourceSnapshot(item.staged)
      if (!sameRenamedFile(restoredStage.identity, item.expected.identity) || restoredStage.hash !== item.expected.hash) return false
      ledger.files.set(item.staged, { identity: restoredStage.identity, hash: restoredStage.hash })
    }
    return true
  } catch { return false }
}

async function restoreQuarantinedFile(item: QuarantinedFile, ledger: StageLedger | undefined): Promise<boolean> {
  try {
    const backup = await sourceSnapshot(item.backup)
    const owned = item.proof === undefined
      ? sameRenamedFile(backup.identity, item.expected.identity) && backup.hash === item.expected.hash
      : sameIdentity(backup.identity, item.proof.identity) && backup.hash === item.proof.hash
    if (!owned) return false
    let targetExists = true
    try { await lstat(item.target, { bigint: true }) } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== "ENOENT") return false
      targetExists = false
    }
    if (targetExists) {
      const target = await sourceSnapshot(item.target)
      if (!sameIdentity(target.identity, backup.identity) || target.hash !== backup.hash || !sameRenamedFile(target.identity, item.expected.identity)) return false
    } else {
      try { await link(item.backup, item.target) } catch { return false }
      const target = await sourceSnapshot(item.target)
      const linkedBackup = await sourceSnapshot(item.backup)
      if (!sameIdentity(target.identity, linkedBackup.identity) || target.hash !== item.expected.hash || !sameRenamedFile(target.identity, item.expected.identity)) return false
    }
    await unlink(item.backup)
    ledger?.files.delete(item.backup)
    const restored = await sourceSnapshot(item.target)
    return sameRenamedFile(restored.identity, item.expected.identity) && restored.hash === item.expected.hash
  } catch { return false }
}

async function cleanupOwnedStage(ledger: StageLedger): Promise<boolean> {
  try {
    const root = await lstat(ledger.root.path, { bigint: true })
    if (!root.isDirectory() || root.isSymbolicLink() || root.dev !== ledger.root.proof.dev || root.ino !== ledger.root.proof.ino || root.birthtimeNs !== ledger.root.proof.birthtimeNs) return false
    const actualFiles = new Set<string>()
    const rootEntries = await readdir(ledger.root.path, { withFileTypes: true })
    for (const entry of rootEntries) {
      const path = join(ledger.root.path, entry.name)
      if (entry.name === "manifest.json" && entry.isFile() && !entry.isSymbolicLink()) actualFiles.add(path)
      else if (!["new", "backup"].includes(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) return false
    }
    for (const directory of ledger.directories) {
      const current = await lstat(directory.path, { bigint: true })
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.proof.dev || current.ino !== directory.proof.ino || current.birthtimeNs !== directory.proof.birthtimeNs) return false
      for (const entry of await readdir(directory.path, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink()) return false
        actualFiles.add(join(directory.path, entry.name))
      }
    }
    if (actualFiles.size !== ledger.files.size || [...actualFiles].some((path) => !ledger.files.has(path))) return false
    for (const [path, proof] of ledger.files) {
      const current = await sourceSnapshot(path)
      if (!sameIdentity(current.identity, proof.identity) || current.hash !== proof.hash) return false
    }
    for (const path of [...ledger.files.keys()].reverse()) await removeImportArtifact(path)
    for (const directory of [...ledger.directories].reverse()) await rmdir(directory.path)
    await rmdir(ledger.root.path)
    return true
  } catch { return false }
}

const serializedProof = (proof: FileProof) => ({
  identity: Object.fromEntries(Object.entries(proof.identity).map(([name, value]) => [name, value.toString()])),
  hash: proof.hash,
})
function matchesSerializedProof(value: unknown, snapshot: { identity: Identity; hash: string }, renamed = false): boolean {
  if (typeof value !== "object" || value === null) return false
  const record = value as { identity?: Record<string, unknown>; hash?: unknown }
  return record.hash === snapshot.hash && typeof record.identity === "object" && record.identity !== null &&
    Object.entries(snapshot.identity).every(([name, current]) => (renamed && name === "ctimeNs") || record.identity?.[name] === current.toString())
}

interface ManifestWriter { readonly path: string; readonly parentPath: string; readonly parent: DirectoryProof; readonly handle: Awaited<ReturnType<typeof open>>; proof: FileProof }

async function createManifestWriter(path: string, parentPath: string, parent: DirectoryProof, manifest: object): Promise<ManifestWriter> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600)
  const details = await handle.stat({ bigint: true })
  const writer: ManifestWriter = { path, parentPath, parent, handle, proof: { identity: identity(details), hash: "" } }
  await rewriteManifest(writer, manifest)
  return writer
}

async function rewriteManifest(writer: ManifestWriter, manifest: object): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(manifest))
  if (bytes.length > MAX_MANIFEST_BYTES) throw failed("图片导入清单超过安全限制。")
  const parent = await lstat(writer.parentPath, { bigint: true })
  const parentCanonical = await realpath(writer.parentPath)
  if (!parent.isDirectory() || parent.isSymbolicLink() || !pathsEqual(parentCanonical, writer.parentPath) || parent.dev !== writer.parent.dev || parent.ino !== writer.parent.ino || parent.birthtimeNs !== writer.parent.birthtimeNs) throw failed("图片导入清单父目录身份已变化。", true)
  const pathDetails = await lstat(writer.path, { bigint: true })
  const handleDetails = await writer.handle.stat({ bigint: true })
  if (pathDetails.isSymbolicLink() || !pathDetails.isFile() || !sameIdentity(identity(pathDetails), identity(handleDetails)) || !sameIdentity(identity(handleDetails), writer.proof.identity)) throw failed("图片导入清单身份已变化。", true)
  await writer.handle.truncate(0)
  await writer.handle.write(bytes, 0, bytes.length, 0)
  await writer.handle.sync()
  const afterHandle = await writer.handle.stat({ bigint: true }); const afterPath = await lstat(writer.path, { bigint: true })
  if (!sameIdentity(identity(afterHandle), identity(afterPath))) throw failed("图片导入清单写入后身份无法确认。", true)
  writer.proof = { identity: identity(afterHandle), hash: hash(bytes) }
}

async function withSelectionLeases<T>(workspace: string, notePath: string, operation: () => Promise<T>): Promise<T> {
  const [visibility, , file] = notePath.split("/")
  const paths = [notePath, `${visibility}/_assets/${file!.slice(0, -3)}`].sort((a, b) => a.localeCompare(b))
  const leases: InternalNotePathLease[] = []
  try {
    for (const path of paths) leases.push(await acquireInternalNotePathLease(workspace, path))
    for (const lease of leases) await lease.assertOwned()
    const result = await operation()
    for (const lease of leases) await lease.assertOwned()
    return result
  } catch (caught) {
    if (isImageLibraryImportError(caught)) throw caught
    throw changed("图片选择期间操作锁或图片库发生变化。")
  } finally {
    let releaseFailed = false
    for (const lease of [...leases].reverse()) try { await lease.release() } catch { releaseFailed = true }
    if (releaseFailed) throw failed("图片选择操作锁未能安全释放。", true)
  }
}

export interface ImageImportManager {
  inspect(): Promise<void>
  select(request: NotePathRequest, loadCurrent: () => Promise<ImageLibraryView>): Promise<ImageLibrarySelection>
  commit(request: ImageLibraryCommitRequest): Promise<void>
  clear(): void
}

export function createImageImportManager(options: { workspace: string; adapter: ImageLibraryAdapter }): ImageImportManager {
  const sessions = new Map<string, Session>()
  const now = () => options.adapter.now?.() ?? Date.now()
  const libraryPath = (notePath: string) => {
    const [visibility, , file] = notePath.split("/")
    return join(options.workspace, visibility!, "_assets", file!.slice(0, -3))
  }
  const expire = () => {
    const time = now()
    for (const [id, session] of sessions) if (time - session.created >= TTL_MS) sessions.delete(id)
  }
  return {
    async inspect() {
      const root = join(options.workspace, ".garden-publisher", "image-import")
      let entries
      try {
        const details = await lstat(root, { bigint: true })
        const canonical = await realpath(root)
        const equal = process.platform === "win32" ? canonical.toLowerCase() === root.toLowerCase() : canonical === root
        if (details.isSymbolicLink() || !details.isDirectory() || !equal) throw new Error("unsafe")
        entries = await boundedDirectoryEntries(root, MAX_RESIDUE_ENTRIES)
      } catch (caught) {
        if ((caught as NodeJS.ErrnoException).code === "ENOENT") return
        throw failed("无法检查图片导入恢复状态。", true)
      }
      if (entries.length === 0) return
      for (const entry of entries) {
        if (!TOKEN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) throw failed("检测到未知图片导入残留，需要手动检查。", true)
        const directory = join(root, entry.name)
        const details = await lstat(directory, { bigint: true }).catch(() => undefined)
        if (details === undefined || details.isSymbolicLink() || !details.isDirectory()) throw failed("检测到不安全的图片导入残留，需要手动检查。", true)
        const canonical = await realpath(directory).catch(() => "")
        if (!pathsEqual(canonical, directory) || !inside(root, canonical)) throw failed("检测到不安全的图片导入残留，需要手动检查。", true)
        const children = await boundedDirectoryEntries(directory, MAX_RESIDUE_CHILDREN).catch(() => [])
        if (children.some((child) => child.isSymbolicLink() || !["manifest.json", "new", "backup"].includes(child.name))) throw failed("检测到未知图片导入残留，需要手动检查。", true)
        if (!["manifest.json", "new", "backup"].every((name) => children.some((child) => child.name === name))) throw failed("检测到不完整的图片导入残留，需要手动检查。", true)
        let handle: Awaited<ReturnType<typeof open>> | undefined
        try {
          handle = await open(join(directory, "manifest.json"), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          const stat = await handle.stat({ bigint: true })
          const pathStat = await lstat(join(directory, "manifest.json"), { bigint: true })
          if (!stat.isFile() || pathStat.isSymbolicLink() || !sameIdentity(identity(stat), identity(pathStat)) || stat.size > BigInt(MAX_MANIFEST_BYTES)) throw new Error("invalid")
          const parsed = JSON.parse((await handle.readFile()).toString()) as Record<string, unknown>
          if (parsed.version !== 1 || parsed.selectionId !== entry.name || parsed.workspace !== hash(Buffer.from(options.workspace)) || typeof parsed.note !== "string" || typeof parsed.createdAt !== "number" || !["created", "staged", "backed-up", "published", "marker-removed"].includes(String(parsed.phase))) throw new Error("invalid")
          const stagedRefs = parsed.staged; const preState = parsed.preState
          if (typeof stagedRefs !== "object" || stagedRefs === null || typeof preState !== "object" || preState === null || typeof (preState as Record<string, unknown>).targets !== "object") throw new Error("invalid")
          for (const childName of ["new", "backup"] as const) {
            const child = children.find(({ name }) => name === childName)
            if (child === undefined) continue
            if (!child.isDirectory()) throw new Error("invalid")
            const childPath = join(directory, childName); const childDetails = await lstat(childPath, { bigint: true }); const childCanonical = await realpath(childPath)
            if (childDetails.isSymbolicLink() || !childDetails.isDirectory() || !pathsEqual(childCanonical, childPath) || !inside(directory, childCanonical)) throw new Error("invalid")
            const files = await boundedDirectoryEntries(childPath, MAX_RESIDUE_CHILDREN)
            const references = childName === "new" ? stagedRefs as Record<string, unknown> : (preState as { targets: Record<string, unknown> }).targets
            for (const file of files) {
              if (file.isSymbolicLink() || !file.isFile()) throw new Error("invalid")
              normalizeImageName(file.name)
              const referenceName = Object.keys(references).find((name) => key(name) === key(file.name))
              if (referenceName === undefined) throw new Error("invalid")
              const snapshot = await sourceSnapshot(join(childPath, file.name))
              if (!matchesSerializedProof(references[referenceName], snapshot, childName === "backup")) throw new Error("invalid")
            }
          }
        } catch { throw failed("检测到未完成的图片导入，需要手动检查。", true) }
        finally { await handle?.close().catch(() => undefined) }
      }
      throw failed("检测到未完成的图片导入，需要手动检查。", true)
    },
    async select(request, loadCurrent) {
      await this.inspect()
      let chosen: readonly string[] | undefined
      try { chosen = await options.adapter.chooseImages() } catch { throw failed("无法打开图片选择器。") }
      if (chosen === undefined || chosen.length === 0) return { cancelled: true, images: [], conflicts: [] }
      if (chosen.length > IMAGE_LIBRARY_MAX_SELECTION_ITEMS) throw tooLarge()
      await loadCurrent()
      return withSelectionLeases(options.workspace, request.path, async () => {
      const notePath = join(options.workspace, ...request.path.split("/"))
      const noteSnapshot = await sourceSnapshot(notePath)
      const libraryDirectory = await inspectLibraryDirectory(libraryPath(request.path))
      const seenSources = new Set<string>(), seenIdentities = new Set<string>(), seenNames = new Set<string>()
      const sources: Source[] = []; let thumbnails = 0
      for (const sourcePath of chosen) {
        const canonicalKey = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath
        if (seenSources.has(canonicalKey)) throw invalid("不能重复选择同一图片。")
        seenSources.add(canonicalKey)
        let name: string
        try { name = normalizeImageName(basename(sourcePath)) } catch { throw invalid("图片名称无效。") }
        if (seenNames.has(key(name))) throw invalid("目标图片名称不能重复。")
        seenNames.add(key(name))
        const snapshot = await sourceSnapshot(sourcePath)
        const identityKey = `${snapshot.identity.dev}:${snapshot.identity.ino}`
        if (seenIdentities.has(identityKey)) throw invalid("不能重复选择同一图片。")
        seenIdentities.add(identityKey)
        try { detectImageFormat(snapshot.bytes, name) } catch { throw invalid("图片扩展名与内容不匹配。") }
        let rendered: RenderedImage
        try { rendered = await options.adapter.renderThumbnail(snapshot.bytes) } catch { throw failed("无法生成图片缩略图。") }
        validateThumbnail(rendered); thumbnails += rendered.dataUrl.length
        if (thumbnails > IMAGE_LIBRARY_MAX_SELECTION_THUMBNAIL_TOTAL_LENGTH) throw tooLarge()
        await verifyProof(sourcePath, snapshot)
        const item: ImageLibraryItem = { name, sizeBytes: snapshot.bytes.length, width: rendered.width, height: rendered.height, contentHash: snapshot.hash, thumbnailDataUrl: rendered.dataUrl, markdown: markdownForImage(request.path.split("/")[2]!.slice(0, -3), name) }
        sources.push({ path: sourcePath, identity: snapshot.identity, hash: snapshot.hash, item })
      }
      const library = await readLibraryManifest(libraryPath(request.path), libraryDirectory)
      const existing = new Set(library.filter(({ name }) => name !== ".gitkeep").map(({ name }) => key(name)))
      const conflicts = sources.filter(({ item }) => existing.has(key(item.name))).map(({ item }) => item.name)
      expire()
      while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
      const id = randomUUID(); sessions.set(id, { id, path: request.path, created: now(), sources, conflicts, note: { identity: noteSnapshot.identity, hash: noteSnapshot.hash }, library, libraryDirectory })
      return { cancelled: false, selectionId: id, images: sources.map(({ item }) => ({ ...item, conflict: existing.has(key(item.name)) })) as [ImageLibraryItem & { conflict: boolean }, ...(ImageLibraryItem & { conflict: boolean })[]], conflicts }
      })
    },

    async commit(request) {
      expire()
      if (!TOKEN.test(request.selectionId)) throw changed("图片选择已失效，请重新选择。")
      const session = sessions.get(request.selectionId)
      sessions.delete(request.selectionId)
      if (session === undefined || session.path !== request.path || now() - session.created >= TTL_MS) throw changed("图片选择已失效，请重新选择。")
      await this.inspect()
      const overwriteKeys = request.overwrite.map(key)
      if (new Set(overwriteKeys).size !== overwriteKeys.length || overwriteKeys.some((name) => !session.conflicts.some((conflict) => key(conflict) === name)) || session.conflicts.some((name) => !overwriteKeys.includes(key(name)))) throw invalid("覆盖授权与预检冲突不一致。")
      for (const source of session.sources) await exactFile(source.path, source)
      const notePath = join(options.workspace, ...request.path.split("/"))
      const currentNote = await sourceSnapshot(notePath)
      if (!sameIdentity(currentNote.identity, session.note.identity) || currentNote.hash !== session.note.hash) throw changed("笔记已发生变化，请重新选择图片。")
      const targetRoot = libraryPath(request.path)
      const commitManifest = await readLibraryManifest(targetRoot, session.libraryDirectory)
      if (!sameLibraryManifest(commitManifest, session.library)) throw changed("图片库自选择后已发生变化。")
      const currentNames = commitManifest.filter(({ name }) => name !== ".gitkeep").map(({ name }) => name)
      const current = new Map(currentNames.map((name) => [key(name), name]))
      for (const source of session.sources) if (current.has(key(source.item.name)) && !overwriteKeys.includes(key(source.item.name))) throw changed("图片库出现未授权的新冲突。")
      const additions = session.sources.filter(({ item }) => !current.has(key(item.name))).length
      if (currentNames.length + additions > IMAGE_LIBRARY_MAX_ITEMS) throw tooLarge()
      const targetProofs = new Map<string, FileProof>()
      for (const source of session.sources) {
        const existingName = current.get(key(source.item.name))
        if (existingName !== undefined) {
          const snapshot = await sourceSnapshot(join(targetRoot, existingName))
          targetProofs.set(key(source.item.name), { identity: snapshot.identity, hash: snapshot.hash })
        }
      }

      const stageRoot = join(options.workspace, ".garden-publisher", "image-import", session.id)
      const staged = join(stageRoot, "new"), backups = join(stageRoot, "backup")
      const published: PublishedFile[] = []; const movedBackups: QuarantinedFile[] = []
      let markerRemoved = false
      let markerMove: QuarantinedFile | undefined
      let stageProof: DirectoryProof | undefined
      let manifestWriter: ManifestWriter | undefined
      let stageLedger: StageLedger | undefined
      let committed = false
      const manifestPath = join(stageRoot, "manifest.json")
      const markerPath = join(targetRoot, ".gitkeep")
      const markerEntry = session.library.find(({ name }) => name === ".gitkeep")
      const markerProof: FileProof | null = markerEntry === undefined ? null : { identity: markerEntry.identity, hash: markerEntry.hash }
      const manifest = {
        version: 1, workspace: hash(Buffer.from(options.workspace)), note: request.path,
        selectionId: session.id, createdAt: now(), phase: "created",
        preState: {
          marker: markerProof === null ? null : serializedProof(markerProof),
          targets: Object.fromEntries(session.sources.map((source) => {
            const proof = targetProofs.get(key(source.item.name))
            return [source.item.name, proof === undefined ? null : serializedProof(proof)]
          })),
        },
        staged: {} as Record<string, ReturnType<typeof serializedProof>>,
        published: {} as Record<string, ReturnType<typeof serializedProof>>,
      }
      try {
        const garden = join(options.workspace, ".garden-publisher")
        const importRoot = join(garden, "image-import")
        await safeDirectory(garden); await safeDirectory(importRoot)
        stageProof = await exclusiveDirectory(stageRoot); const stagedProof = await exclusiveDirectory(staged); const backupsProof = await exclusiveDirectory(backups)
        stageLedger = { root: { path: stageRoot, proof: stageProof }, directories: [{ path: staged, proof: stagedProof }, { path: backups, proof: backupsProof }], files: new Map() }
        manifestWriter = await createManifestWriter(manifestPath, stageRoot, stageProof, manifest)
        stageLedger.files.set(manifestPath, manifestWriter.proof)
        for (const source of session.sources) {
          const bytes = await exactFile(source.path, source)
          const handle = await open(join(staged, source.item.name), "wx", 0o600)
          try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
          const proof = await sourceSnapshot(join(staged, source.item.name))
          manifest.staged[source.item.name] = serializedProof({ identity: proof.identity, hash: proof.hash })
          stageLedger.files.set(join(staged, source.item.name), { identity: proof.identity, hash: proof.hash })
        }
        await options.adapter.syncDirectory?.(staged)
        manifest.phase = "staged"; await rewriteManifest(manifestWriter, manifest); stageLedger.files.set(manifestPath, manifestWriter.proof)
        await options.adapter.afterPhase?.("import-staged")
        if (!sameLibraryManifest(await readLibraryManifest(targetRoot, session.libraryDirectory), session.library)) throw changed("图片库在暂存期间发生变化。")
        let expectedWorking = [...session.library]
        for (const source of session.sources) {
          await exactFile(source.path, source)
          const existingName = current.get(key(source.item.name)); const target = join(targetRoot, source.item.name)
          if (existingName !== undefined) {
            const existingTarget = join(targetRoot, existingName); const backup = join(backups, source.item.name)
            const expected = targetProofs.get(key(source.item.name))!
            const before = await sourceSnapshot(existingTarget)
            if (!sameIdentity(before.identity, expected.identity) || before.hash !== expected.hash) throw changed("覆盖目标已发生变化，请重试。")
            await options.adapter.afterPhase?.("import-before-backup")
            await verifyProof(existingTarget, expected)
            try { await link(existingTarget, backup) } catch (caught) {
              if ((caught as NodeJS.ErrnoException).code === "EEXIST") throw changed("覆盖目标备份位置已被占用。")
              throw failed("无法安全备份覆盖目标。")
            }
            const moved: QuarantinedFile = { backup, target: existingTarget, expected }
            movedBackups.push(moved)
            const captured = await captureImportPathIdentity(backup)
            moved.proof = { identity: identity(captured), hash: expected.hash }
            stageLedger.files.set(backup, moved.proof)
            const after = await sourceSnapshot(backup)
            const linkedSource = await sourceSnapshot(existingTarget)
            if (!sameRenamedFile(after.identity, expected.identity) || after.hash !== expected.hash || !sameIdentity(after.identity, linkedSource.identity)) throw changed("覆盖目标在备份时发生变化。")
            moved.proof = { identity: after.identity, hash: after.hash }; stageLedger.files.set(backup, moved.proof)
            await options.adapter.syncDirectory?.(backups)
            const durableBackup = await sourceSnapshot(backup)
            const sourceBeforeUnlink = await sourceSnapshot(existingTarget)
            if (!sameIdentity(durableBackup.identity, sourceBeforeUnlink.identity) || durableBackup.hash !== expected.hash || !sameRenamedFile(sourceBeforeUnlink.identity, expected.identity)) throw changed("覆盖目标在隔离前发生变化。")
            moved.proof = { identity: durableBackup.identity, hash: durableBackup.hash }; stageLedger.files.set(backup, moved.proof)
            await unlink(existingTarget)
            const quarantined = await sourceSnapshot(backup)
            if (!sameRenamedFile(quarantined.identity, expected.identity) || quarantined.hash !== expected.hash) throw changed("覆盖目标在隔离时发生变化。")
            moved.proof = { identity: quarantined.identity, hash: quarantined.hash }; stageLedger.files.set(backup, moved.proof)
            expectedWorking = expectedWorking.filter((entry) => key(entry.name) !== key(source.item.name))
            await options.adapter.syncDirectory?.(backups); await options.adapter.syncDirectory?.(targetRoot)
            manifest.phase = "backed-up"; await rewriteManifest(manifestWriter, manifest); stageLedger.files.set(manifestPath, manifestWriter.proof)
            await options.adapter.afterPhase?.("import-backed-up")
          }
          await exactFile(source.path, source)
          if (!sameLibraryManifest(await readLibraryManifest(targetRoot, session.libraryDirectory), sortLibraryManifest(expectedWorking))) throw changed("图片库在发布边界发生变化。")
          await options.adapter.afterPhase?.("import-before-publish")
          const stagedPath = join(staged, source.item.name)
          const stagedProof = stageLedger.files.get(stagedPath)
          if (stagedProof === undefined) throw failed("图片暂存身份记录缺失。", true)
          await verifyProof(stagedPath, stagedProof)
          try { await link(stagedPath, target) } catch (failure) {
            if ((failure as NodeJS.ErrnoException).code === "EEXIST") throw changed("发布目标已被外部创建。")
            throw failed("无法原子发布图片。")
          }
          const publication: PublishedFile = { path: target, staged: stagedPath, expected: stagedProof }
          published.push(publication)
          const linkedSnapshot = await sourceSnapshot(target, captureImportPathIdentity)
          if (linkedSnapshot.hash !== source.hash) throw changed()
          publication.proof = { identity: linkedSnapshot.identity, hash: linkedSnapshot.hash }
          stageLedger.files.set(stagedPath, { identity: linkedSnapshot.identity, hash: linkedSnapshot.hash })
          await unlink(stagedPath)
          stageLedger.files.delete(stagedPath)
          const publishedSnapshot = await sourceSnapshot(target)
          if (!sameRenamedFile(publishedSnapshot.identity, linkedSnapshot.identity) || publishedSnapshot.hash !== source.hash) throw changed()
          publication.proof = { identity: publishedSnapshot.identity, hash: publishedSnapshot.hash }
          expectedWorking.push({ name: source.item.name, type: "file", identity: publishedSnapshot.identity, hash: publishedSnapshot.hash })
          await options.adapter.syncDirectory?.(targetRoot)
          manifest.published[source.item.name] = serializedProof({ identity: publishedSnapshot.identity, hash: publishedSnapshot.hash })
          manifest.phase = "published"; await rewriteManifest(manifestWriter, manifest); stageLedger.files.set(manifestPath, manifestWriter.proof)
          await options.adapter.afterPhase?.("import-published")
        }
        for (const item of published) {
          if (item.proof === undefined) throw failed("无法确认已发布图片身份。", true)
          const finalTarget = await sourceSnapshot(item.path)
          if (!sameIdentity(finalTarget.identity, item.proof.identity) || finalTarget.hash !== item.proof.hash) throw changed("已发布图片发生变化。")
        }
        const expectedBeforeMarker = sortLibraryManifest(expectedWorking)
        if (!sameLibraryManifest(await readLibraryManifest(targetRoot, session.libraryDirectory), expectedBeforeMarker)) throw changed("图片库发布结果与预期不一致。")
        const finalNote = await sourceSnapshot(notePath)
        if (!sameIdentity(finalNote.identity, session.note.identity) || finalNote.hash !== session.note.hash) throw changed("笔记已发生变化，请重新选择图片。")
        if (markerProof !== null) {
          await verifyProof(markerPath, markerProof)
          const backup = join(backups, ".gitkeep")
          await options.adapter.afterPhase?.("import-before-marker-backup")
          await verifyProof(markerPath, markerProof)
          try { await link(markerPath, backup) } catch (caught) {
            if ((caught as NodeJS.ErrnoException).code === "EEXIST") throw changed("图片库占位文件备份位置已被占用。")
            throw failed("无法安全备份图片库占位文件。")
          }
          markerMove = { backup, target: markerPath, expected: markerProof }; markerRemoved = true
          const captured = await captureImportPathIdentity(backup)
          markerMove.proof = { identity: identity(captured), hash: markerProof.hash }
          stageLedger.files.set(backup, markerMove.proof)
          const movedMarker = await sourceSnapshot(backup)
          const linkedMarker = await sourceSnapshot(markerPath)
          if (!sameRenamedFile(movedMarker.identity, markerProof.identity) || movedMarker.hash !== markerProof.hash || !sameIdentity(movedMarker.identity, linkedMarker.identity)) throw changed("图片库占位文件备份身份无效。")
          markerMove.proof = { identity: movedMarker.identity, hash: movedMarker.hash }; stageLedger.files.set(backup, markerMove.proof)
          await options.adapter.syncDirectory?.(backups)
          const durableMarkerBackup = await sourceSnapshot(backup)
          const markerBeforeUnlink = await sourceSnapshot(markerPath)
          if (!sameIdentity(durableMarkerBackup.identity, markerBeforeUnlink.identity) || durableMarkerBackup.hash !== markerProof.hash || !sameRenamedFile(markerBeforeUnlink.identity, markerProof.identity)) throw changed("图片库占位文件在隔离前发生变化。")
          markerMove.proof = { identity: durableMarkerBackup.identity, hash: durableMarkerBackup.hash }; stageLedger.files.set(backup, markerMove.proof)
          await unlink(markerPath)
          const quarantinedMarker = await sourceSnapshot(backup)
          if (!sameRenamedFile(quarantinedMarker.identity, markerProof.identity) || quarantinedMarker.hash !== markerProof.hash) throw changed("图片库占位文件在隔离时发生变化。")
          markerMove.proof = { identity: quarantinedMarker.identity, hash: quarantinedMarker.hash }; stageLedger.files.set(backup, markerMove.proof)
        }
        manifest.phase = "marker-removed"; await rewriteManifest(manifestWriter, manifest); stageLedger.files.set(manifestPath, manifestWriter.proof)
        if (markerRemoved) await options.adapter.afterPhase?.("import-marker-removed")
        const expectedFinal = expectedBeforeMarker.filter(({ name }) => name !== ".gitkeep")
        if (!sameLibraryManifest(await readLibraryManifest(targetRoot, session.libraryDirectory), expectedFinal)) throw changed("图片库最终状态与预期不一致。")
        await options.adapter.syncDirectory?.(targetRoot)
        committed = true
        await manifestWriter.handle.close(); manifestWriter = undefined
        if (!(await cleanupOwnedStage(stageLedger))) throw failed("无法确认图片导入暂存目录清理。", true)
        await options.adapter.syncDirectory?.(importRoot)
      } catch (caught) {
        let uncertain = false
        if (manifestWriter !== undefined) {
          try { await manifestWriter.handle.close() } catch { uncertain = true }
          manifestWriter = undefined
        }
        if (committed) throw failed("图片已导入，但导入记录清理未能确认。", true)
        for (const item of [...published].reverse()) {
          if (!(await removeOwnedPublication(item, stageLedger))) uncertain = true
        }
        for (const item of [...movedBackups].reverse()) {
          if (!(await restoreQuarantinedFile(item, stageLedger))) uncertain = true
        }
        if (markerMove !== undefined) {
          if (!(await restoreQuarantinedFile(markerMove, stageLedger))) uncertain = true
        }
        if (!uncertain && stageLedger !== undefined) uncertain = !(await cleanupOwnedStage(stageLedger))
        try { await options.adapter.syncDirectory?.(targetRoot); await options.adapter.syncDirectory?.(join(options.workspace, ".garden-publisher", "image-import")) } catch { uncertain = true }
        if (!uncertain && isImageLibraryImportError(caught)) throw caught
        throw failed("图片导入事务失败，已尝试恢复。", uncertain)
      }
    },
    clear() { sessions.clear() },
  }
}
