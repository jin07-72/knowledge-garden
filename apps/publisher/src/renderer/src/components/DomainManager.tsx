import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import type {
  DomainCreateRequest,
  DomainRemoveRequest,
  DomainRenameRequest,
  DomainSummary,
  DomainUpdateMetadataRequest,
} from "../../../shared/contracts"
import { ModalShell } from "./ModalShell"

type DomainManagerMode =
  | { readonly kind: "list" }
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly domain: DomainSummary }
  | { readonly kind: "edit-metadata"; readonly domain: DomainSummary }
  | { readonly kind: "confirm-remove"; readonly domain: DomainSummary }

interface DomainManagerProps {
  readonly domains: readonly DomainSummary[]
  readonly onClose: () => void
  readonly onCreate: (request: DomainCreateRequest) => Promise<readonly DomainSummary[]>
  readonly onRename: (request: DomainRenameRequest) => Promise<readonly DomainSummary[]>
  readonly onUpdateMetadata: (
    request: DomainUpdateMetadataRequest,
  ) => Promise<readonly DomainSummary[]>
  readonly onRemove: (request: DomainRemoveRequest) => Promise<readonly DomainSummary[]>
}

function normalizedTags(value: string): readonly string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of value.split(/[,，]/)) {
    const tag = part.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

function validateMetadata(description: string, tags: readonly string[]): string | undefined {
  if (description.trim().length > 2000) return "描述不能超过 2000 个字符"
  if (tags.some((tag) => tag.length > 128)) return "每个标签不能超过 128 个字符"
  if (tags.length > 100) return "标签不能超过 100 个"
  return undefined
}

function validateName(value: string): string | undefined {
  const name = value.trim()
  if (!name) return "显示名称不能为空"
  if (name.length > 80) return "显示名称不能超过 80 个字符"
  return undefined
}

function validateSlug(value: string): string | undefined {
  const slug = value.trim()
  if (!slug) return "英文路径不能为空"
  if (slug.length > 80) return "英文路径不能超过 80 个字符"
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "英文路径只能使用小写字母、数字和连字符"
  }
  if (new Set(["index", "content", "private", "garden-publisher"]).has(slug)) {
    return "英文路径是保留名称，不能使用"
  }
  return undefined
}

export function DomainManager({
  domains,
  onClose,
  onCreate,
  onRename,
  onUpdateMetadata,
  onRemove,
}: DomainManagerProps): React.JSX.Element {
  const [mode, setMode] = useState<DomainManagerMode>({ kind: "list" })
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const descriptionInput = useRef<HTMLTextAreaElement>(null)
  const removeCancel = useRef<HTMLButtonElement>(null)
  const returnFocusSlug = useRef<string | undefined>(undefined)
  const renameButtons = useRef(new Map<string, HTMLButtonElement>())
  const metadataButtons = useRef(new Map<string, HTMLButtonElement>())
  const returnFocusAction = useRef<"rename" | "metadata">("rename")
  const createDomainButton = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (mode.kind !== "list" || !returnFocusSlug.current) return
    const slug = returnFocusSlug.current
    returnFocusSlug.current = undefined
    const preferred =
      returnFocusAction.current === "metadata"
        ? metadataButtons.current.get(slug)
        : renameButtons.current.get(slug)
    const fallback = renameButtons.current.values().next().value ?? createDomainButton.current
    ;(preferred ?? fallback)?.focus()
  }, [domains, mode.kind])

  useEffect(() => {
    if (mode.kind === "create" || mode.kind === "rename") {
      queueMicrotask(() => nameInput.current?.focus())
    } else if (mode.kind === "edit-metadata") {
      queueMicrotask(() => descriptionInput.current?.focus())
    } else if (mode.kind === "confirm-remove") {
      queueMicrotask(() => removeCancel.current?.focus())
    }
  }, [mode.kind])

  const goList = (): void => {
    if (busy) return
    if (mode.kind === "confirm-remove") {
      returnFocusSlug.current = mode.domain.slug
      returnFocusAction.current = "rename"
    } else if (mode.kind === "edit-metadata") {
      returnFocusSlug.current = mode.domain.slug
      returnFocusAction.current = "metadata"
    }
    setError(undefined)
    setMode({ kind: "list" })
  }

  const openCreate = (): void => {
    if (busy) return
    setName("")
    setSlug("")
    setError(undefined)
    setMode({ kind: "create" })
  }

  const openRename = (domain: DomainSummary): void => {
    if (busy) return
    setName(domain.name)
    setSlug(domain.slug)
    setError(undefined)
    setMode({ kind: "rename", domain })
  }

  const openMetadata = (domain: DomainSummary): void => {
    if (busy) return
    setDescription(domain.description)
    setTags(domain.tags.join(", "))
    setError(undefined)
    setMode({ kind: "edit-metadata", domain })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy || (mode.kind !== "create" && mode.kind !== "rename")) return
    const nameError = validateName(name)
    const slugError = mode.kind === "create" ? validateSlug(slug) : undefined
    const validationError = nameError ?? slugError
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      if (mode.kind === "create") {
        await onCreate({ name: name.trim(), slug: slug.trim() })
      } else {
        await onRename({ name: name.trim(), slug: mode.domain.slug })
      }
      if (mode.kind === "create" || mode.kind === "rename") setMode({ kind: "list" })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "领域操作失败，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const submitMetadata = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy || mode.kind !== "edit-metadata") return
    const nextTags = normalizedTags(tags)
    const validationError = validateMetadata(description, nextTags)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await onUpdateMetadata({
        slug: mode.domain.slug,
        description: description.trim(),
        tags: nextTags,
      })
      returnFocusSlug.current = mode.domain.slug
      returnFocusAction.current = "metadata"
      setMode({ kind: "list" })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法更新领域信息，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const confirmRemove = async (): Promise<void> => {
    if (busy || mode.kind !== "confirm-remove") return
    setBusy(true)
    setError(undefined)
    try {
      await onRemove({ slug: mode.domain.slug })
      returnFocusSlug.current = mode.domain.slug
      setMode({ kind: "list" })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法删除领域，请稍后重试。")
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode.kind === "create"
      ? "新建领域"
      : mode.kind === "rename"
        ? "重命名领域"
        : mode.kind === "edit-metadata"
          ? "编辑领域信息"
          : mode.kind === "confirm-remove"
            ? "确认删除领域？"
            : "管理领域"

  return (
    <ModalShell
      labelId="domain-manager-title"
      className="domain-manager-dialog"
      closeDisabled={busy}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <header className="domain-manager-header">
        <h2 id="domain-manager-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {mode.kind === "list" ? (
        <>
          <div className="domain-manager-body">
            <div className="domain-manager-list">
              {domains.map((domain) => {
                const noteCount = domain.publicNotes + domain.privateNotes
                return (
                  <article
                    className="domain-manager-card"
                    key={domain.slug}
                    aria-label={domain.name}
                  >
                    <div className="domain-manager-card-heading">
                      <strong>{domain.name}</strong>
                      <code>{domain.slug}</code>
                      <p className={domain.description ? undefined : "domain-manager-placeholder"}>
                        {domain.description || "未填写描述"}
                      </p>
                      <div className="domain-manager-tags" aria-label="领域标签">
                        {domain.tags.length > 0 ? (
                          domain.tags.map((tag) => (
                            <span className="domain-tag-chip" key={tag}>
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="domain-manager-placeholder">无标签</span>
                        )}
                      </div>
                    </div>
                    <div className="domain-manager-badges" aria-label="笔记数量">
                      <span className="domain-count-badge">公开 {domain.publicNotes}</span>
                      <span className="domain-count-badge">私密 {domain.privateNotes}</span>
                    </div>
                    <div className="domain-manager-card-actions">
                      <button
                        ref={(node) => {
                          if (node) metadataButtons.current.set(domain.slug, node)
                          else metadataButtons.current.delete(domain.slug)
                        }}
                        type="button"
                        className="secondary-button"
                        aria-label={`编辑 ${domain.name} 的信息`}
                        onClick={() => openMetadata(domain)}
                      >
                        编辑信息
                      </button>
                      <button
                        ref={(node) => {
                          if (node) renameButtons.current.set(domain.slug, node)
                          else renameButtons.current.delete(domain.slug)
                        }}
                        type="button"
                        className="secondary-button"
                        onClick={() => openRename(domain)}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        className="secondary-button domain-remove-button"
                        disabled={noteCount > 0}
                        aria-label={
                          noteCount > 0
                            ? `删除（公开 ${domain.publicNotes}，私密 ${domain.privateNotes}）`
                            : "删除"
                        }
                        title={
                          noteCount > 0
                            ? `公开 ${domain.publicNotes}，私密 ${domain.privateNotes} 篇笔记`
                            : undefined
                        }
                        onClick={() => {
                          setError(undefined)
                          setMode({ kind: "confirm-remove", domain })
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                )
              })}
              {domains.length === 0 ? <p className="domain-manager-empty">暂无领域</p> : null}
            </div>
          </div>
          <footer className="domain-manager-footer">
            <button
              ref={createDomainButton}
              type="button"
              className="primary-button"
              onClick={openCreate}
              disabled={busy}
            >
              新建领域
            </button>
          </footer>
        </>
      ) : mode.kind === "confirm-remove" ? (
        <div className="domain-manager-confirm">
          <p>确认删除「{mode.domain.name}」？此操作会移除领域目录，且不能撤销。</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              ref={removeCancel}
              type="button"
              className="secondary-button"
              onClick={goList}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => void confirmRemove()}
              disabled={busy}
            >
              确认删除
            </button>
          </div>
        </div>
      ) : mode.kind === "edit-metadata" ? (
        <form
          className="domain-manager-form"
          onSubmit={(event) => void submitMetadata(event)}
          noValidate
        >
          <div className="domain-manager-field">
            <label htmlFor="domain-description">描述（选填）</label>
            <textarea
              id="domain-description"
              ref={descriptionInput}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={5}
              disabled={busy}
              aria-describedby={error ? "domain-manager-error" : undefined}
            />
            <small>选填；留空不会写入占位值</small>
          </div>
          <div className="domain-manager-field">
            <label htmlFor="domain-tags">标签（选填）</label>
            <input
              id="domain-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              disabled={busy}
              aria-describedby={error ? "domain-manager-error" : undefined}
            />
            <small>选填；留空不会写入占位值</small>
          </div>
          {error ? (
            <p id="domain-manager-error" className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={goList} disabled={busy}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              保存信息
            </button>
          </div>
        </form>
      ) : (
        <form className="domain-manager-form" onSubmit={(event) => void submit(event)} noValidate>
          <label>
            显示名称
            <input
              ref={nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              aria-describedby={error ? "domain-manager-error" : undefined}
            />
          </label>
          <label>
            英文路径
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              readOnly={mode.kind === "rename"}
              maxLength={80}
              aria-describedby={error ? "domain-manager-error" : undefined}
            />
          </label>
          {error ? (
            <p id="domain-manager-error" className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={goList} disabled={busy}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {mode.kind === "create" ? "创建领域" : "保存名称"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  )
}
