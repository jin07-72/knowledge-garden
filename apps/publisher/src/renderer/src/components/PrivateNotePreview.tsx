import DOMPurify from "dompurify"
import { Marked } from "marked"
import { useMemo } from "react"

const markdown = new Marked({ async: false, gfm: true, breaks: false })

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function stripFrontmatter(source: string): string {
  const match = /^(?:\uFEFF)?---[\t ]*\r?\n[\s\S]*?^---[\t ]*(?:\r?\n|$)/m.exec(source)
  return match?.index === 0 ? source.slice(match[0].length) : source
}

function replaceWikiLinks(source: string): string {
  let fenced = false
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part.replace(/!?\[\[([^\]\n]+)\]\]/g, (_match, inner: string) => {
                const [target, label] = inner.split("|")
                return `<span class="wiki-link">${escapeHtml((label ?? target).trim())}</span>`
              }),
        )
        .join("")
    })
    .join("\n")
}

export function renderLocalMarkdown(source: string): string {
  const html = markdown.parse(replaceWikiLinks(stripFrontmatter(source))) as string
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["iframe", "form", "input", "button", "style", "script"],
    FORBID_ATTR: ["style", "onerror", "onload", "href"],
  })
}

export function LocalNotePreview({
  title,
  markdown: source,
  privateNote,
}: {
  readonly title: string
  readonly markdown?: string
  readonly privateNote: boolean
}): React.JSX.Element {
  const html = useMemo(() => (source === undefined ? "" : renderLocalMarkdown(source)), [source])
  return (
    <div className="local-note-preview-shell" aria-label={`${title}的本地预览`}>
      {privateNote ? (
        <div className="local-note-preview-banner">
          <strong>私密笔记不会映射到公开网址</strong>
          <span>仅在这台电脑上预览，不会发布。</span>
        </div>
      ) : null}
      {html ? (
        <article
          className="local-note-preview"
          aria-label={`${title}的本地渲染`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : source === undefined ? (
        <p className="local-note-preview-empty">正在载入预览…</p>
      ) : (
        <p className="local-note-preview-empty">当前笔记内容为空。</p>
      )}
    </div>
  )
}
