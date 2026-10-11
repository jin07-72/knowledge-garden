import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { basename, isAbsolute, join, resolve } from "node:path"
import { lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from "node:fs/promises"
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
import { acquireInternalNotePathLease, type InternalNotePathLease } from "./noteFiles"
import type { ImageLibraryAdapter, RenderedImage } from "./imageLibrary"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const TTL_MS = 5 * 60 * 1000
const MAX_SESSIONS = 8
const MAX_RESIDUE_ENTRIES = 32
const MAX_MANIFEST_BYTES = 64 * 1024
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const trustedImportErrors = new WeakSet<object>()
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

type Identity = Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs">
type DirectoryProof = Pick<BigIntStats, "dev" | "ino" | "birthtimeNs">
interface Source { path: string; identity: Identity; hash: string; item: ImageLibraryItem }
interface FileProof { identity: Identity; hash: string }
interface Session { id: string; path: string; created: number; sources: readonly Source[]; conflicts: readonly string[]; note: { identity: Identity; hash: string } }

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

async function sourceSnapshot(path: string): Promise<{ identity: Identity; bytes: Uint8Array; hash: string }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    if (!isAbsolute(path) || resolve(path) !== path) throw invalid("图片源路径无效。")
    const before = await lstat(path, { bigint: true })
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

async function libraryNames(path: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    const manifest: Array<{ name: string; identity: Identity }> = []
    const names: string[] = []; const insensitive = new Set<string>()
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile()) throw changed("图片库包含不安全的项目。")
      const snapshot = await sourceSnapshot(join(path, entry.name))
      manifest.push({ name: entry.name, identity: snapshot.identity })
      if (entry.name === ".gitkeep") {
        if (snapshot.bytes.length !== 0) throw invalid("图片库占位文件无效。")
        continue
      }
      try { normalizeImageName(entry.name); detectImageFormat(snapshot.bytes, entry.name) } catch { throw invalid("图片库包含无效图片。") }
      if (insensitive.has(key(entry.name))) throw invalid("图片库包含大小写冲突的名称。")
      insensitive.add(key(entry.name)); names.push(entry.name)
    }
    const finalEntries = await readdir(path, { withFileTypes: true })
    if (finalEntries.length !== manifest.length) throw changed()
    for (const expected of manifest) {
      const entry = finalEntries.find(({ name }) => name === expected.name)
      if (entry === undefined || entry.isSymbolicLink() || !entry.isFile()) throw changed()
      const details = await lstat(join(path, entry.name), { bigint: true })
      if (!sameIdentity(identity(details), expected.identity)) throw changed()
    }
    return names
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return []
    if ((caught as AppError).code === "IMAGE_LIBRARY_CHANGED") throw caught
    throw changed()
  }
}

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

async function removeOwnedStage(path: string, proof: DirectoryProof, allowedNames: ReadonlySet<string>): Promise<boolean> {
  try {
    const current = await lstat(path, { bigint: true })
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== proof.dev || current.ino !== proof.ino || current.birthtimeNs !== proof.birthtimeNs) return false
    const rootEntries = await readdir(path, { withFileTypes: true })
    if (rootEntries.some((entry) => !["manifest.json", "new", "backup"].includes(entry.name) || entry.isSymbolicLink())) return false
    for (const directoryName of ["new", "backup"]) {
      const directory = rootEntries.find((entry) => entry.name === directoryName)
      if (directory !== undefined) {
        if (!directory.isDirectory()) return false
        const children = await readdir(join(path, directoryName), { withFileTypes: true })
        if (children.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !allowedNames.has(key(entry.name)))) return false
      }
    }
    await rm(path, { recursive: true })
    return true
  } catch { return false }
}

const serializedProof = (proof: FileProof) => ({
  identity: Object.fromEntries(Object.entries(proof.identity).map(([name, value]) => [name, value.toString()])),
  hash: proof.hash,
})

async function writeManifest(path: string, manifest: object, exclusive = false): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(manifest))
  if (bytes.length > MAX_MANIFEST_BYTES) throw failed("图片导入清单超过安全限制。")
  const handle = await open(path, exclusive ? "wx" : "r+")
  try { await handle.truncate(0); await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
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
      try { entries = await readdir(root, { withFileTypes: true }) } catch (caught) {
        if ((caught as NodeJS.ErrnoException).code === "ENOENT") return
        throw failed("无法检查图片导入恢复状态。", true)
      }
      if (entries.length === 0) return
      if (entries.length > MAX_RESIDUE_ENTRIES) throw failed("图片导入恢复项目过多，需要手动检查。", true)
      for (const entry of entries) {
        if (!TOKEN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) throw failed("检测到未知图片导入残留，需要手动检查。", true)
        const directory = join(root, entry.name)
        const details = await lstat(directory, { bigint: true }).catch(() => undefined)
        if (details === undefined || details.isSymbolicLink() || !details.isDirectory()) throw failed("检测到不安全的图片导入残留，需要手动检查。", true)
        let handle: Awaited<ReturnType<typeof open>> | undefined
        try {
          handle = await open(join(directory, "manifest.json"), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
          const stat = await handle.stat({ bigint: true })
          if (!stat.isFile() || stat.size > BigInt(MAX_MANIFEST_BYTES)) throw new Error("invalid")
          const parsed = JSON.parse((await handle.readFile()).toString()) as Record<string, unknown>
          if (parsed.version !== 1 || parsed.selectionId !== entry.name || parsed.workspace !== hash(Buffer.from(options.workspace)) || typeof parsed.note !== "string" || typeof parsed.createdAt !== "number" || typeof parsed.phase !== "string") throw new Error("invalid")
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
      const existing = new Set((await libraryNames(libraryPath(request.path))).map(key))
      const conflicts = sources.filter(({ item }) => existing.has(key(item.name))).map(({ item }) => item.name)
      expire()
      while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
      const id = randomUUID(); sessions.set(id, { id, path: request.path, created: now(), sources, conflicts, note: { identity: noteSnapshot.identity, hash: noteSnapshot.hash } })
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
      const currentNames = await libraryNames(targetRoot)
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
      const published: Array<{ path: string; proof: FileProof }> = []; const movedBackups: Array<{ backup: string; target: string; proof: FileProof }> = []
      let markerRemoved = false
      let stageProof: DirectoryProof | undefined
      const manifestPath = join(stageRoot, "manifest.json")
      const markerPath = join(targetRoot, ".gitkeep")
      let markerProof: FileProof | null = null
      const markerDetails = await lstat(markerPath, { bigint: true }).catch((caught) => {
        if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw changed("无法验证图片库占位文件。")
      })
      if (markerDetails !== undefined) {
        const marker = await sourceSnapshot(markerPath); markerProof = { identity: marker.identity, hash: marker.hash }
      }
      const manifest = {
        version: 1, workspace: hash(Buffer.from(options.workspace)), note: request.path,
        selectionId: session.id, createdAt: now(), phase: "created",
        preState: { marker: markerProof === null ? null : serializedProof(markerProof), targets: Object.fromEntries([...targetProofs].map(([name, proof]) => [name, serializedProof(proof)])) },
        staged: {} as Record<string, ReturnType<typeof serializedProof>>,
        published: {} as Record<string, ReturnType<typeof serializedProof>>,
      }
      try {
        const garden = join(options.workspace, ".garden-publisher")
        const importRoot = join(garden, "image-import")
        await safeDirectory(garden); await safeDirectory(importRoot)
        stageProof = await exclusiveDirectory(stageRoot); await exclusiveDirectory(staged); await exclusiveDirectory(backups)
        await writeManifest(manifestPath, manifest, true)
        for (const source of session.sources) {
          const bytes = await exactFile(source.path, source)
          const handle = await open(join(staged, source.item.name), "wx", 0o600)
          try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
          const proof = await sourceSnapshot(join(staged, source.item.name))
          manifest.staged[source.item.name] = serializedProof({ identity: proof.identity, hash: proof.hash })
        }
        await options.adapter.syncDirectory?.(staged)
        manifest.phase = "staged"; await writeManifest(manifestPath, manifest)
        await options.adapter.afterPhase?.("import-staged")
        for (const source of session.sources) {
          await exactFile(source.path, source)
          const existingName = current.get(key(source.item.name)); const target = join(targetRoot, source.item.name)
          if (existingName !== undefined) {
            const existingTarget = join(targetRoot, existingName); const backup = join(backups, source.item.name)
            const expected = targetProofs.get(key(source.item.name))!
            const before = await sourceSnapshot(existingTarget)
            if (!sameIdentity(before.identity, expected.identity) || before.hash !== expected.hash) throw changed("覆盖目标已发生变化，请重试。")
            await rename(existingTarget, backup)
            const after = await sourceSnapshot(backup)
            if (!sameRenamedFile(after.identity, expected.identity) || after.hash !== expected.hash) throw changed("覆盖目标在备份时发生变化。")
            movedBackups.push({ backup, target: existingTarget, proof: { identity: after.identity, hash: after.hash } })
            await options.adapter.syncDirectory?.(backups); await options.adapter.syncDirectory?.(targetRoot)
            manifest.phase = "backed-up"; await writeManifest(manifestPath, manifest)
            await options.adapter.afterPhase?.("import-backed-up")
          }
          await exactFile(source.path, source)
          await rename(join(staged, source.item.name), target)
          const publishedSnapshot = await sourceSnapshot(target)
          if (publishedSnapshot.hash !== source.hash) throw changed()
          published.push({ path: target, proof: { identity: publishedSnapshot.identity, hash: publishedSnapshot.hash } })
          await options.adapter.syncDirectory?.(targetRoot)
          manifest.published[source.item.name] = serializedProof({ identity: publishedSnapshot.identity, hash: publishedSnapshot.hash })
          manifest.phase = "published"; await writeManifest(manifestPath, manifest)
          await options.adapter.afterPhase?.("import-published")
        }
        for (const item of published) {
          const finalTarget = await sourceSnapshot(item.path)
          if (!sameIdentity(finalTarget.identity, item.proof.identity) || finalTarget.hash !== item.proof.hash) throw changed("已发布图片发生变化。")
        }
        const finalNote = await sourceSnapshot(notePath)
        if (!sameIdentity(finalNote.identity, session.note.identity) || finalNote.hash !== session.note.hash) throw changed("笔记已发生变化，请重新选择图片。")
        try { await unlink(markerPath); markerRemoved = true } catch (caught) { if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught }
        manifest.phase = "marker-removed"; await writeManifest(manifestPath, manifest)
        if (markerRemoved) await options.adapter.afterPhase?.("import-marker-removed")
        await options.adapter.syncDirectory?.(targetRoot)
        if (!(await removeOwnedStage(stageRoot, stageProof, new Set(session.sources.map(({ item }) => key(item.name)))))) throw failed("无法确认图片导入暂存目录清理。", true)
        await options.adapter.syncDirectory?.(importRoot)
      } catch (caught) {
        let uncertain = false
        for (const item of [...published].reverse()) {
          try {
            const snapshot = await sourceSnapshot(item.path)
            if (sameIdentity(snapshot.identity, item.proof.identity) && snapshot.hash === item.proof.hash) await unlink(item.path)
            else uncertain = true
          } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") uncertain = true }
        }
        for (const item of [...movedBackups].reverse()) {
          try { await lstat(item.target); uncertain = true } catch (caught) {
            if ((caught as NodeJS.ErrnoException).code === "ENOENT") {
              try {
                await rename(item.backup, item.target)
                const restored = await sourceSnapshot(item.target)
                if (!sameRenamedFile(restored.identity, item.proof.identity) || restored.hash !== item.proof.hash) uncertain = true
              } catch { uncertain = true }
            } else uncertain = true
          }
        }
        if (markerRemoved) { try { const h = await open(markerPath, "wx"); await h.close() } catch { uncertain = true } }
        if (!uncertain && stageProof !== undefined) uncertain = !(await removeOwnedStage(stageRoot, stageProof, new Set(session.sources.map(({ item }) => key(item.name)))))
        try { await options.adapter.syncDirectory?.(targetRoot); await options.adapter.syncDirectory?.(join(options.workspace, ".garden-publisher", "image-import")) } catch { uncertain = true }
        if (!uncertain && isImageLibraryImportError(caught)) throw caught
        throw failed("图片导入事务失败，已尝试恢复。", uncertain)
      }
    },
    clear() { sessions.clear() },
  }
}
