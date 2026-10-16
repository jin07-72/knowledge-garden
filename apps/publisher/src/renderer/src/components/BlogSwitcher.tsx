import { Check, ChevronDown, FolderPlus, GitFork, Settings2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { BlogLinkOpenRequest, BlogRegistryView } from "../../../shared/contracts"
import { BlogAddressRows } from "./BlogAddressRows"

export interface BlogSwitcherProps {
  readonly registry: BlogRegistryView
  readonly disabled: boolean
  readonly onSwitch: (id: string) => void
  readonly onOpenLink: (id: string, kind: BlogLinkOpenRequest["kind"]) => void
  readonly onAddLocal: () => void
  readonly onClone: () => void
  readonly onManage: () => void
}

export function BlogSwitcher({
  registry,
  disabled,
  onSwitch,
  onOpenLink,
  onAddLocal,
  onClone,
  onManage,
}: BlogSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const actions: {
    id?: string
    kind: "switch" | BlogLinkOpenRequest["kind"] | "addLocal" | "clone" | "manage"
  }[] = [
    ...registry.blogs.flatMap((blog) => [
      { id: blog.id, kind: "switch" as const },
      ...(blog.repository.url ? [{ id: blog.id, kind: "repository" as const }] : []),
      ...(blog.website.source !== "unconfigured"
        ? [{ id: blog.id, kind: "website" as const }]
        : []),
    ]),
    { kind: "addLocal" },
    { kind: "clone" },
    { kind: "manage" },
  ]
  const actionIndex = (kind: (typeof actions)[number]["kind"], id?: string): number =>
    actions.findIndex((action) => action.kind === kind && action.id === id)
  const activeIndex = Math.max(0, actionIndex("switch", registry.activeBlogId))
  const [focusIndex, setFocusIndex] = useState(activeIndex)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const active =
    registry.blogs.find((blog) => blog.id === registry.activeBlogId) ?? registry.blogs[0]

  useEffect(() => {
    if (!open) return
    if (!disabled)
      root.current?.querySelector<HTMLElement>(`[data-menu-index="${focusIndex}"]`)?.focus()
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [disabled, focusIndex, open])

  const openAndFocus = (index = activeIndex): void => {
    if (disabled) return
    setFocusIndex(index)
    setOpen(true)
  }

  const finish = (action: () => void): void => {
    if (disabled) return
    setOpen(false)
    trigger.current?.focus()
    action()
  }

  const menuButtonProps = (index: number) => ({
    "data-menu-index": index,
    tabIndex: !disabled && focusIndex === index ? 0 : -1,
    onFocus: () => setFocusIndex(index),
  })

  return (
    <div ref={root} className="blog-switcher">
      <div className="blog-switcher-summary">
        <button
          ref={trigger}
          type="button"
          className="blog-switcher-trigger"
          aria-label={`切换博客：${active?.name ?? "未选择博客"}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled || !active}
          onClick={() => {
            if (open) setOpen(false)
            else openAndFocus()
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              openAndFocus(event.key === "ArrowUp" ? actions.length - 1 : activeIndex)
            }
          }}
        >
          <span className="blog-switcher-copy">
            <strong>{active?.name ?? "未选择博客"}</strong>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {active ? (
          <BlogAddressRows
            blog={active}
            disabled={disabled}
            onOpenLink={(kind) => finish(() => onOpenLink(active.id, kind))}
          />
        ) : null}
      </div>

      {open ? (
        <div
          className="blog-switcher-menu"
          role="menu"
          aria-label="选择博客"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              setOpen(false)
              trigger.current?.focus()
              return
            }
            if (event.key === "Tab") {
              if (event.shiftKey) {
                event.preventDefault()
                setOpen(false)
                trigger.current?.focus()
              } else queueMicrotask(() => setOpen(false))
              return
            }
            if (disabled) return
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
            event.preventDefault()
            const count = actions.length
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? count - 1
                  : event.key === "ArrowUp"
                    ? (focusIndex - 1 + count) % count
                    : (focusIndex + 1) % count
            setFocusIndex(next)
          }}
        >
          <div className="blog-switcher-options">
            {registry.blogs.map((blog) => {
              const current = blog.id === registry.activeBlogId
              return (
                <div
                  key={blog.id}
                  className="blog-switcher-option"
                  role="group"
                  aria-label={blog.name}
                >
                  <button
                    {...menuButtonProps(actionIndex("switch", blog.id))}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={disabled}
                    onClick={() => finish(() => onSwitch(blog.id))}
                  >
                    <span className="blog-menu-check" aria-hidden="true">
                      {current ? <Check size={14} /> : null}
                    </span>
                    <span className="blog-menu-copy">
                      <span>
                        <strong>{blog.name}</strong>
                        {current ? <em>当前</em> : null}
                      </span>
                    </span>
                  </button>
                  <BlogAddressRows
                    blog={blog}
                    disabled={disabled}
                    onOpenLink={(kind) => finish(() => onOpenLink(blog.id, kind))}
                    getLinkButtonProps={(kind) => ({
                      role: "menuitem",
                      ...menuButtonProps(actionIndex(kind, blog.id)),
                    })}
                  />
                </div>
              )
            })}
          </div>
          <div className="blog-switcher-actions">
            <button
              {...menuButtonProps(actionIndex("addLocal"))}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => finish(onAddLocal)}
            >
              <FolderPlus size={15} aria-hidden="true" /> 添加本地博客
            </button>
            <button
              {...menuButtonProps(actionIndex("clone"))}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => finish(onClone)}
            >
              <GitFork size={15} aria-hidden="true" /> 从 GitHub 下载
            </button>
            <button
              {...menuButtonProps(actionIndex("manage"))}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => finish(onManage)}
            >
              <Settings2 size={15} aria-hidden="true" /> 管理博客
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
