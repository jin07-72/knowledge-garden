import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { basename, isAbsolute, join, resolve } from "node:path"
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink } from "node:fs/promises"
import {
  IMAGE_LIBRARY_MAX_SELECTION_ITEMS,
  IMAGE_LIBRARY_MAX_SELECTION_THUMBNAIL_TOTAL_LENGTH,
  IMAGE_LIBRARY_MAX_ITEMS,
  type AppError,
  type ImageLibraryCommitRequest,
  type ImageLibraryItem,
  type ImageLibrarySelection,
  type ImageLibraryView,
  type NotePathRequest,
} from "../../shared/contracts"
import { detectImageFormat, markdownForImage, normalizeImageName } from "./imageFormats"
import type { ImageLibraryAdapter, RenderedImage } from "./imageLibrary"

const MAX_FILE_BYTES = 25 * 1024 * 1024
const TTL_MS = 5 * 60 * 1000
const MAX_SESSIONS = 8
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const trustedImportErrors = new WeakSet<object>()

type Identity = Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs">
interface Source { path: string; identity: Identity; hash: string; item: ImageLibraryItem }
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

function validateThumbnail(rendered: RenderedImage): void {
  if (!Number.isSafeInteger(rendered.width) || rendered.width <= 0 || !Number.isSafeInteger(rendered.height) || rendered.height <= 0 || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(rendered.dataUrl)) throw invalid("缩略图数据无效。")
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
  const current = await sourceSnapshot(path)
  if (!sameIdentity(current.identity, expected.identity) || current.hash !== expected.hash) throw changed()
  return current.bytes
}

async function libraryNames(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).map((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) throw changed("图片库包含不安全的项目。")
      return entry.name
    }).filter((name) => name !== ".gitkeep")
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

export interface ImageImportManager {
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
    async select(request, loadCurrent) {
      let chosen: readonly string[] | undefined
      try { chosen = await options.adapter.chooseImages() } catch { throw failed("无法打开图片选择器。") }
      if (chosen === undefined || chosen.length === 0) return { cancelled: true, images: [], conflicts: [] }
      if (chosen.length > IMAGE_LIBRARY_MAX_SELECTION_ITEMS) throw tooLarge()
      await loadCurrent()
      const notePath = join(options.workspace, ...request.path.split("/"))
      const noteSnapshot = await sourceSnapshot(notePath)
      const seenSources = new Set<string>(), seenNames = new Set<string>()
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
        try { detectImageFormat(snapshot.bytes, name) } catch { throw invalid("图片扩展名与内容不匹配。") }
        let rendered: RenderedImage
        try { rendered = await options.adapter.renderThumbnail(snapshot.bytes) } catch { throw failed("无法生成图片缩略图。") }
        validateThumbnail(rendered); thumbnails += rendered.dataUrl.length
        if (thumbnails > IMAGE_LIBRARY_MAX_SELECTION_THUMBNAIL_TOTAL_LENGTH) throw tooLarge()
        const item: ImageLibraryItem = { name, sizeBytes: snapshot.bytes.length, width: rendered.width, height: rendered.height, contentHash: snapshot.hash, thumbnailDataUrl: rendered.dataUrl, markdown: markdownForImage(request.path.split("/")[2]!.slice(0, -3), name) }
        sources.push({ path: sourcePath, identity: snapshot.identity, hash: snapshot.hash, item })
      }
      const existing = new Set((await libraryNames(libraryPath(request.path))).map(key))
      const conflicts = sources.filter(({ item }) => existing.has(key(item.name))).map(({ item }) => item.name)
      expire()
      while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
      const id = randomUUID(); sessions.set(id, { id, path: request.path, created: now(), sources, conflicts, note: { identity: noteSnapshot.identity, hash: noteSnapshot.hash } })
      return { cancelled: false, selectionId: id, images: sources.map(({ item }) => ({ ...item, conflict: existing.has(key(item.name)) })) as [ImageLibraryItem & { conflict: boolean }, ...(ImageLibraryItem & { conflict: boolean })[]], conflicts }
    },

    async commit(request) {
      expire()
      if (!TOKEN.test(request.selectionId)) throw changed("图片选择已失效，请重新选择。")
      const session = sessions.get(request.selectionId)
      sessions.delete(request.selectionId)
      if (session === undefined || session.path !== request.path || now() - session.created >= TTL_MS) throw changed("图片选择已失效，请重新选择。")
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

      const stageRoot = join(options.workspace, ".garden-publisher", "image-import", session.id)
      const staged = join(stageRoot, "new"), backups = join(stageRoot, "backup")
      const published: Array<{ path: string; hash: string }> = []; const movedBackups: Array<{ backup: string; target: string }> = []
      let markerRemoved = false
      try {
        const garden = join(options.workspace, ".garden-publisher")
        const importRoot = join(garden, "image-import")
        await safeDirectory(garden); await safeDirectory(importRoot)
        await safeDirectory(stageRoot); await safeDirectory(staged); await safeDirectory(backups)
        for (const source of session.sources) {
          const bytes = await exactFile(source.path, source)
          const handle = await open(join(staged, source.item.name), "wx", 0o600)
          try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
        }
        await options.adapter.afterPhase?.("import-staged")
        for (const source of session.sources) {
          await exactFile(source.path, source)
          const existingName = current.get(key(source.item.name)); const target = join(targetRoot, source.item.name)
          if (existingName !== undefined) {
            const existingTarget = join(targetRoot, existingName); const backup = join(backups, source.item.name)
            await rename(existingTarget, backup); movedBackups.push({ backup, target: existingTarget })
            await options.adapter.afterPhase?.("import-backed-up")
          }
          await rename(join(staged, source.item.name), target); published.push({ path: target, hash: source.hash })
          if (hash(await readFile(target)) !== source.hash) throw changed()
          await options.adapter.afterPhase?.("import-published")
        }
        const finalNote = await sourceSnapshot(notePath)
        if (!sameIdentity(finalNote.identity, session.note.identity) || finalNote.hash !== session.note.hash) throw changed("笔记已发生变化，请重新选择图片。")
        const marker = join(targetRoot, ".gitkeep")
        try { await unlink(marker); markerRemoved = true } catch (caught) { if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught }
        if (markerRemoved) await options.adapter.afterPhase?.("import-marker-removed")
        await options.adapter.syncDirectory?.(targetRoot)
        await rm(stageRoot, { recursive: true })
      } catch {
        let uncertain = false
        for (const item of [...published].reverse()) {
          try { if (hash(await readFile(item.path)) === item.hash) await unlink(item.path); else uncertain = true } catch (caught) { if ((caught as NodeJS.ErrnoException).code !== "ENOENT") uncertain = true }
        }
        for (const item of [...movedBackups].reverse()) {
          try { await lstat(item.target); uncertain = true } catch (caught) { if ((caught as NodeJS.ErrnoException).code === "ENOENT") { try { await rename(item.backup, item.target) } catch { uncertain = true } } else uncertain = true }
        }
        if (markerRemoved) { try { const h = await open(join(targetRoot, ".gitkeep"), "wx"); await h.close() } catch { uncertain = true } }
        if (!uncertain) await rm(stageRoot, { recursive: true, force: true }).catch(() => { uncertain = true })
        throw failed("图片导入事务失败，已尝试恢复。", uncertain)
      }
    },
    clear() { sessions.clear() },
  }
}
