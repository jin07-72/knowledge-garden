import { randomUUID } from "node:crypto"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { watch, type FSWatcher } from "chokidar"

export interface PreviewWorkspace {
  readonly root: string
  readonly contentDirectory: string
  readonly outputDirectory: string
  readonly dispose: () => Promise<void>
  readonly subscribeFailure: (listener: (failed: boolean) => void) => () => void
}

interface PreviewWorkspaceOptions {
  readonly debounceMs?: number
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}

async function sourceFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && directory === root) return
      throw error
    }
    for (const entry of entries) {
      if (entry.name === ".gitkeep") continue
      const absolute = join(directory, entry.name)
      if (!inside(root, absolute)) throw new Error("Preview source escaped its content root.")
      if (entry.isSymbolicLink()) throw new Error("Preview content cannot contain symbolic links.")
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) files.set(relative(root, absolute), absolute)
      else throw new Error("Preview content contains an unsupported filesystem entry.")
    }
  }
  await walk(root)
  return files
}

async function existingFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) files.push(relative(root, absolute))
    }
  }
  await walk(root)
  return files
}

async function replaceFile(source: string, destination: string): Promise<void> {
  const sourceDetails = await lstat(source)
  if (!sourceDetails.isFile() || sourceDetails.isSymbolicLink()) {
    throw new Error("Preview source changed to an unsafe filesystem entry.")
  }
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  await copyFile(source, temporary)
  try {
    await rename(temporary, destination)
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
    await rm(destination, { force: true })
    await rename(temporary, destination)
  }
}

async function reconcile(
  workspace: string,
  contentDirectory: string,
): Promise<void> {
  const publicFiles = await sourceFiles(join(workspace, "content"))
  const privateFiles = await sourceFiles(join(workspace, "private"))
  for (const path of privateFiles.keys()) {
    if (publicFiles.has(path)) throw new Error("Preview has a duplicate public/private logical path.")
  }
  const desired = new Map([...publicFiles, ...privateFiles])
  for (const [path, source] of desired) {
    await replaceFile(source, join(contentDirectory, path))
  }
  for (const path of await existingFiles(contentDirectory)) {
    if (!desired.has(path)) await rm(join(contentDirectory, path), { force: true })
  }
}

/** Creates an isolated, disposable Quartz input tree containing both visibility classes. */
export async function createPreviewWorkspace(
  workspace: string,
  options: PreviewWorkspaceOptions = {},
): Promise<PreviewWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "knowledge-garden-preview-"))
  const contentDirectory = join(root, "content")
  const outputDirectory = join(root, "site")
  await mkdir(contentDirectory, { recursive: true })
  await mkdir(outputDirectory, { recursive: true })

  let watcher: FSWatcher | undefined
  let timer: NodeJS.Timeout | undefined
  let disposed = false
  let syncTail = Promise.resolve()
  const failureListeners = new Set<(failed: boolean) => void>()
  const reportFailure = (failed: boolean): void => {
    for (const listener of failureListeners) listener(failed)
  }
  const schedule = (): void => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      syncTail = syncTail
        .then(() => reconcile(workspace, contentDirectory))
        .then(
          () => reportFailure(false),
          () => reportFailure(true),
        )
    }, Math.max(1, options.debounceMs ?? 80))
  }

  try {
    watcher = watch([join(workspace, "content"), join(workspace, "private")], {
      ignoreInitial: true,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    })
    watcher.on("all", schedule)
    watcher.on("error", () => reportFailure(true))
    await new Promise<void>((resolveReady, rejectReady) => {
      watcher?.once("ready", resolveReady)
      watcher?.once("error", rejectReady)
    })
    await reconcile(workspace, contentDirectory)
  } catch (error) {
    disposed = true
    await watcher?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    throw error
  }

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    await watcher?.close()
    await syncTail
    const details = await lstat(root).catch(() => undefined)
    if (details?.isDirectory() && !details.isSymbolicLink()) {
      await rm(root, { recursive: true, force: true })
    }
    failureListeners.clear()
  }

  const subscribeFailure = (listener: (failed: boolean) => void): (() => void) => {
    failureListeners.add(listener)
    return () => failureListeners.delete(listener)
  }

  return { root, contentDirectory, outputDirectory, dispose, subscribeFailure }
}
