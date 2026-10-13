import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Copy, ImagePlus, Trash2, X } from "lucide-react"
import type {
  GardenApi,
  ImageLibraryItem,
  ImageLibraryPreview,
  ImageLibrarySelection,
  ImageLibraryView,
  IpcResult,
} from "../../../shared/contracts"
import { ModalShell } from "./ModalShell"

interface ImageLibraryProps {
  readonly path: string
  readonly title: string
  readonly api: GardenApi["images"]
  readonly onClose: () => void
}

type Screen =
  | { readonly kind: "gallery" }
  | { readonly kind: "selection"; readonly selection: Exclude<ImageLibrarySelection, { cancelled: true }> }
  | { readonly kind: "preview"; readonly item: ImageLibraryItem }
  | { readonly kind: "delete-confirm"; readonly item: ImageLibraryItem; readonly preview: ImageLibraryPreview }

type FailedAction = "open" | "select" | "commit" | "preview" | "copy" | "delete"
type BusyAction = FailedAction | undefined

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" })

function messageFor(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message.trim() ? failure.message : fallback
}

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Number((bytes / 1_024).toFixed(1))} KB`
  return `${Number((bytes / 1_048_576).toFixed(1))} MB`
}

export function ImageLibrary({ path, title, api, onClose }: ImageLibraryProps): React.JSX.Element {
  const [library, setLibrary] = useState<ImageLibraryView>()
  const [screen, setScreen] = useState<Screen>({ kind: "gallery" })
  const [selectedNames, setSelectedNames] = useState<readonly string[]>([])
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [preview, setPreview] = useState<ImageLibraryPreview>()
  const [busy, setBusy] = useState<BusyAction>("open")
  const [error, setError] = useState("")
  const [failedAction, setFailedAction] = useState<FailedAction>()
  const [copyFeedback, setCopyFeedback] = useState("")
  const mounted = useRef(false)
  const generation = useRef(0)
  const actionLock = useRef<BusyAction>(undefined)
  const closeButton = useRef<HTMLButtonElement>(null)
  const viewFocus = useRef<HTMLButtonElement>(null)

  const beginRequest = useCallback((action: FailedAction): number | undefined => {
    if (actionLock.current) return undefined
    actionLock.current = action
    setBusy(action)
    setError("")
    setFailedAction(undefined)
    return ++generation.current
  }, [])

  const isCurrent = useCallback((token: number): boolean => mounted.current && generation.current === token, [])

  const finishRequest = useCallback((token: number): void => {
    if (!isCurrent(token)) return
    actionLock.current = undefined
    setBusy(undefined)
  }, [isCurrent])

  const failRequest = useCallback((token: number, action: FailedAction, failure: unknown, fallback: string): void => {
    if (!isCurrent(token)) return
    actionLock.current = undefined
    setBusy(undefined)
    setError(messageFor(failure, fallback))
    setFailedAction(action)
  }, [isCurrent])

  const loadLibrary = useCallback(async (postRefreshError?: string): Promise<void> => {
    const token = beginRequest("open")
    if (token === undefined) return
    try {
      const next = unwrap(await api.open({ path }))
      if (!isCurrent(token)) return
      setLibrary(next)
      setScreen({ kind: "gallery" })
      setPreview(undefined)
      setCopyFeedback("")
      if (postRefreshError) {
        setError(postRefreshError)
        setFailedAction(undefined)
      }
      finishRequest(token)
    } catch (failure) {
      const fallback = postRefreshError
        ? `${postRefreshError} 无法刷新图片库，请重试。`
        : "无法读取图片库，请重试。"
      failRequest(token, "open", postRefreshError ? new Error(fallback) : failure, fallback)
    }
  }, [api, beginRequest, failRequest, finishRequest, isCurrent, path])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      actionLock.current = undefined
    }
  }, [])

  useEffect(() => {
    generation.current += 1
    actionLock.current = undefined
    setLibrary(undefined)
    setScreen({ kind: "gallery" })
    setSelectedNames([])
    setConfirmOverwrite(false)
    setPreview(undefined)
    setCopyFeedback("")
    setError("")
    setFailedAction(undefined)
    setBusy(undefined)
    void loadLibrary()
    return () => {
      generation.current += 1
      actionLock.current = undefined
    }
  }, [loadLibrary])

  useLayoutEffect(() => {
    ;(screen.kind === "gallery" ? closeButton : viewFocus).current?.focus()
  }, [busy, confirmOverwrite, screen.kind, selectedNames.length])

  const close = (): void => {
    if (busy === "commit" || busy === "delete") return
    generation.current += 1
    actionLock.current = undefined
    setBusy(undefined)
    setError("")
    setFailedAction(undefined)
    onClose()
  }

  const selectImages = async (): Promise<void> => {
    const token = beginRequest("select")
    if (token === undefined) return
    try {
      const selection = unwrap(await api.select({ path }))
      if (!isCurrent(token)) return
      if (!selection.cancelled) {
        setScreen({ kind: "selection", selection })
        setSelectedNames(selection.images.map(({ name }) => name))
        setConfirmOverwrite(false)
      }
      finishRequest(token)
    } catch (failure) {
      failRequest(token, "select", failure, "无法选择图片，请重试。")
    }
  }

  const activeSelection = screen.kind === "selection"
    ? [...screen.selection.images]
        .filter(({ name }) => selectedNames.includes(name))
        .sort((left, right) => collator.compare(left.name, right.name))
    : []
  const activeConflicts = screen.kind === "selection"
    ? screen.selection.conflicts.filter((name) => selectedNames.includes(name))
    : []

  const commitSelection = async (): Promise<void> => {
    if (screen.kind !== "selection" || activeSelection.length === 0) return
    if (activeConflicts.length > 0 && !confirmOverwrite) {
      setConfirmOverwrite(true)
      setError("")
      setFailedAction(undefined)
      return
    }
    const token = beginRequest("commit")
    if (token === undefined) return
    try {
      const next = unwrap(await api.commit({
        path,
        selectionId: screen.selection.selectionId,
        include: activeSelection.map(({ name }) => name),
        overwrite: activeConflicts,
      }))
      if (!isCurrent(token)) return
      setLibrary(next)
      setScreen({ kind: "gallery" })
      setSelectedNames([])
      setConfirmOverwrite(false)
      finishRequest(token)
    } catch (failure) {
      if (!isCurrent(token)) return
      actionLock.current = undefined
      setBusy(undefined)
      setScreen({ kind: "gallery" })
      setSelectedNames([])
      setConfirmOverwrite(false)
      setPreview(undefined)
      setCopyFeedback("")
      const message = `${messageFor(failure, "无法添加图片。")} 请重新选择图片。`
      void loadLibrary(message)
    }
  }

  const openPreview = async (item: ImageLibraryItem): Promise<void> => {
    setScreen({ kind: "preview", item })
    setPreview(undefined)
    setCopyFeedback("")
    const token = beginRequest("preview")
    if (token === undefined) return
    try {
      const next = unwrap(await api.preview({
        path,
        name: item.name,
        expectedContentHash: item.contentHash,
      }))
      if (!isCurrent(token)) return
      setPreview(next)
      finishRequest(token)
    } catch (failure) {
      failRequest(token, "preview", failure, "无法加载图片预览，请重试。")
    }
  }

  const copyMarkdown = async (): Promise<void> => {
    const current = preview ?? (screen.kind === "preview" ? screen.item : undefined)
    if (!current) return
    const token = beginRequest("copy")
    if (token === undefined) return
    setCopyFeedback("")
    try {
      unwrap(await api.copyMarkdown({
        path,
        name: current.name,
        expectedContentHash: current.contentHash,
      }))
      if (!isCurrent(token)) return
      setCopyFeedback("已复制 Markdown 链接")
      finishRequest(token)
    } catch (failure) {
      failRequest(token, "copy", failure, "无法复制 Markdown 链接，请重试。")
    }
  }

  const deleteImage = async (): Promise<void> => {
    if (screen.kind !== "delete-confirm") return
    const current = screen.preview
    const token = beginRequest("delete")
    if (token === undefined) return
    try {
      const next = unwrap(await api.delete({
        path,
        name: current.name,
        expectedContentHash: current.contentHash,
      }))
      if (!isCurrent(token)) return
      setLibrary(next)
      setScreen({ kind: "gallery" })
      setPreview(undefined)
      finishRequest(token)
    } catch (failure) {
      failRequest(token, "delete", failure, "无法永久删除图片，请重试。")
    }
  }

  const retry = (): void => {
    if (failedAction === "open") void loadLibrary()
    else if (failedAction === "select") void selectImages()
    else if (failedAction === "commit") void commitSelection()
    else if (failedAction === "preview" && screen.kind === "preview") void openPreview(screen.item)
    else if (failedAction === "copy") void copyMarkdown()
    else if (failedAction === "delete") void deleteImage()
  }

  const sortedImages = useMemo(
    () => [...(library?.images ?? [])].sort((left, right) => collator.compare(left.name, right.name)),
    [library],
  )
  const dialogTitle = confirmOverwrite
    ? "确认覆盖同名图片"
    : screen.kind === "selection"
      ? "确认添加图片"
      : screen.kind === "preview" || screen.kind === "delete-confirm"
        ? screen.kind === "preview" ? screen.item.name : `永久删除 ${screen.preview.name}`
        : `${title} 图片库`
  const closeDisabled = busy === "commit" || busy === "delete"

  return (
    <ModalShell
      labelId="image-library-title"
      className="image-library-dialog"
      initialFocus={closeButton}
      closeDisabled={closeDisabled}
      onClose={close}
    >
      <header className="image-library-header">
        <div>
          <h2 id="image-library-title">{dialogTitle}</h2>
          {screen.kind === "gallery" ? <small>{path}</small> : null}
        </div>
        <button
          ref={closeButton}
          type="button"
          className="icon-button"
          aria-label="关闭图片库"
          disabled={closeDisabled}
          onClick={close}
        >
          <X size={19} aria-hidden="true" />
        </button>
      </header>

      <div className="image-library-content">
        {error ? (
          <div className="image-library-error">
            <p role="alert">{error}</p>
            {failedAction ? (
              <button type="button" className="secondary-button" disabled={busy !== undefined} onClick={retry}>
                重试
              </button>
            ) : null}
          </div>
        ) : null}

        {screen.kind === "gallery" ? (
          <Gallery
            images={sortedImages}
            loading={busy === "open" && !library}
            disabled={busy !== undefined}
            onAdd={() => void selectImages()}
            onPreview={(item) => void openPreview(item)}
          />
        ) : screen.kind === "selection" ? (
          confirmOverwrite ? (
            <section className="image-library-confirm-view">
              <p>以下同名图片将被永久覆盖：</p>
              <ul>{activeConflicts.map((name) => <li key={name}>{name}</li>)}</ul>
              <p className="image-library-note">不会修改当前 Markdown 笔记</p>
              <div className="dialog-actions">
                <button
                  ref={viewFocus}
                  type="button"
                  className="secondary-button"
                  disabled={busy !== undefined}
                  onClick={() => setConfirmOverwrite(false)}
                >
                  返回修改选择
                </button>
                <button
                  type="button"
                  className="primary-button danger-button"
                  disabled={busy !== undefined}
                  onClick={() => void commitSelection()}
                >
                  {busy === "commit" ? "正在覆盖…" : "覆盖并继续"}
                </button>
              </div>
            </section>
          ) : (
            <section className="image-library-selection-view">
              <p className="image-library-note">不会修改当前 Markdown 笔记</p>
              {activeSelection.length ? (
                <ul className="image-library-selection-grid">
                  {activeSelection.map((candidate, index) => (
                    <li key={candidate.name}>
                      <img src={candidate.thumbnailDataUrl} alt="" />
                      <span title={candidate.name}>{candidate.name}</span>
                      {candidate.conflict ? <small>同名冲突</small> : null}
                      <button
                        ref={index === 0 ? viewFocus : undefined}
                        type="button"
                        className="secondary-button"
                        disabled={busy !== undefined}
                        aria-label={`移除 ${candidate.name}`}
                        onClick={() => setSelectedNames((names) => names.filter((name) => name !== candidate.name))}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="image-library-empty">已移除全部候选图片。</p>}
              <div className="dialog-actions">
                <button
                  ref={activeSelection.length === 0 ? viewFocus : undefined}
                  type="button"
                  className="secondary-button"
                  disabled={busy !== undefined}
                  onClick={() => {
                    setScreen({ kind: "gallery" })
                    setError("")
                    setFailedAction(undefined)
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy !== undefined || activeSelection.length === 0}
                  onClick={() => void commitSelection()}
                >
                  {activeConflicts.length > 0
                    ? "继续"
                    : busy === "commit"
                      ? "正在添加…"
                      : `确认添加 ${activeSelection.length} 张图片`}
                </button>
              </div>
            </section>
          )
        ) : screen.kind === "preview" ? (
          <section className="image-library-preview-view">
            <button
              ref={viewFocus}
              type="button"
              className="image-library-back secondary-button"
              disabled={busy === "preview" || busy === "copy"}
              onClick={() => {
                generation.current += 1
                actionLock.current = undefined
                setBusy(undefined)
                setError("")
                setFailedAction(undefined)
                setCopyFeedback("")
                setPreview(undefined)
                setScreen({ kind: "gallery" })
              }}
            >
              返回图片库
            </button>
            {busy === "preview" && !preview ? <p role="status">正在加载完整预览…</p> : null}
            {preview ? (
              <>
                <div className="image-library-full-image">
                  <img src={preview.dataUrl} alt={preview.name} />
                </div>
                <dl className="image-library-metadata">
                  <div><dt>文件名</dt><dd>{preview.name}</dd></div>
                  <div><dt>尺寸</dt><dd>{preview.width} × {preview.height} 像素</dd></div>
                  <div><dt>大小</dt><dd>{formatBytes(preview.sizeBytes)}</dd></div>
                </dl>
                {copyFeedback ? <p role="status" className="image-library-success">{copyFeedback}</p> : null}
                <div className="dialog-actions">
                  <button type="button" className="secondary-button" disabled={busy !== undefined} onClick={() => void copyMarkdown()}>
                    <Copy size={16} aria-hidden="true" />
                    复制 Markdown 链接
                  </button>
                  <button
                    type="button"
                    className="secondary-button image-library-delete"
                    disabled={busy !== undefined}
                    onClick={() => setScreen({ kind: "delete-confirm", item: screen.item, preview })}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    删除图片
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : (
          <section className="image-library-delete-view">
            <p><strong>{screen.preview.name}</strong></p>
            <p className="image-library-danger-copy">永久删除、无法恢复</p>
            <div className="dialog-actions">
              <button
                ref={viewFocus}
                type="button"
                className="secondary-button"
                disabled={busy === "delete"}
                onClick={() => {
                  setError("")
                  setFailedAction(undefined)
                  setScreen({ kind: "preview", item: screen.item })
                }}
              >
                取消删除
              </button>
              <button
                type="button"
                className="primary-button danger-button"
                disabled={busy === "delete"}
                onClick={() => void deleteImage()}
              >
                {busy === "delete" ? "正在永久删除…" : `永久删除 ${screen.preview.name}`}
              </button>
            </div>
          </section>
        )}
      </div>
    </ModalShell>
  )
}

function Gallery({
  images,
  loading,
  disabled,
  onAdd,
  onPreview,
}: {
  readonly images: readonly ImageLibraryItem[]
  readonly loading: boolean
  readonly disabled: boolean
  readonly onAdd: () => void
  readonly onPreview: (item: ImageLibraryItem) => void
}): React.JSX.Element {
  if (loading) return <p className="image-library-empty" role="status">正在加载图片库…</p>
  return (
    <section className="image-library-gallery-view">
      <div className="image-library-toolbar">
        <p className="image-library-note">不会修改当前 Markdown 笔记</p>
        <button type="button" className="primary-button" disabled={disabled} onClick={onAdd}>
          <ImagePlus size={17} aria-hidden="true" />
          添加图片
        </button>
      </div>
      {images.length === 0 ? (
        <div className="image-library-empty">
          <strong>暂无图片</strong>
          <span>添加的图片会保存在当前笔记的专属文件夹中。</span>
        </div>
      ) : (
        <ul className="image-library-grid">
          {images.map((image) => (
            <li key={image.name}>
              <button type="button" disabled={disabled} aria-label={`预览 ${image.name}`} onClick={() => onPreview(image)}>
                <img src={image.thumbnailDataUrl} alt="" />
                <span title={image.name}>{image.name}</span>
                <small>{image.width} × {image.height} · {formatBytes(image.sizeBytes)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
