import { useState } from "react"
import { Monitor, TriangleAlert } from "lucide-react"
import type { NoteSummary, PreviewStatus } from "../../../shared/contracts"
import { HistoryView, type HistorySnapshot } from "./HistoryView"
import { LocalNotePreview } from "./PrivateNotePreview"

type PreviewTab = "note" | "site" | "public" | "history"

interface PreviewPaneProps {
  readonly note?: NoteSummary
  readonly markdown?: string
  readonly preview: PreviewStatus
  readonly onLoadHistory: (requestId: string) => Promise<HistorySnapshot>
  readonly onCancelHistory: (requestId: string) => Promise<void>
  readonly onOpenHistoryLink: (url: string) => Promise<void>
}

export function PreviewPane({
  note,
  markdown,
  preview,
  onLoadHistory,
  onCancelHistory,
  onOpenHistoryLink,
}: PreviewPaneProps): React.JSX.Element {
  const [tab, setTab] = useState<PreviewTab>("note")
  const baseUrl = preview.lastSuccessfulUrl ?? preview.url

  const tabs: readonly { id: PreviewTab; label: string }[] = [
    { id: "note", label: "当前笔记" },
    { id: "site", label: "全站本地" },
    { id: "public", label: "线上公开站" },
    { id: "history", label: "历史" },
  ]

  return (
    <section className="preview-pane pane" aria-label="本地预览" role="region">
      <header className="preview-header">
        <div>
          <span className="eyebrow">本地 Markdown</span>
          <h2>当前笔记预览</h2>
        </div>
        <span className={`preview-chip preview-${preview.state}`}>
          {preview.state === "ready" ? "实时" : "状态"}
        </span>
      </header>
      <div className="preview-tabs" role="tablist" aria-label="预览目标">
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`preview-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`preview-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
              event.preventDefault()
              const current = tabs.findIndex((candidate) => candidate.id === tab)
              const next =
                tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]
              setTab(next.id)
              document.getElementById(`preview-tab-${next.id}`)?.focus()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="preview-canvas"
        id={`preview-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`preview-tab-${tab}`}
      >
        {tab === "site" && preview.state === "error" ? (
          <div className="preview-banner" role="alert">
            <TriangleAlert size={16} />
            {preview.error?.message ?? "Quartz 预览暂时不可用。"}
          </div>
        ) : null}
        {tab === "note" && note ? (
          <LocalNotePreview
            markdown={markdown}
            title={note.title}
            privateNote={note.visibility === "private"}
          />
        ) : null}
        {tab === "note" && !note ? (
          <div className="empty-state">
            <Monitor size={28} />
            <strong>等待本地预览</strong>
            <span>选择笔记后，这里显示当前本地 Markdown 内容。</span>
          </div>
        ) : null}
        {tab === "site" && baseUrl ? (
          <iframe
            title="Quartz 本地全站预览"
            src={baseUrl}
            sandbox="allow-same-origin allow-scripts"
          />
        ) : null}
        {tab === "site" && !baseUrl ? (
          <div className="empty-state">
            <strong>本地全站尚未就绪</strong>
          </div>
        ) : null}
        {tab === "public" ? (
          <iframe
            title="线上公开站"
            src="https://jin07-72.github.io/knowledge-garden/"
            sandbox="allow-same-origin allow-scripts"
          />
        ) : null}
        {tab === "history" ? (
          <HistoryView
            loadHistory={onLoadHistory}
            cancelHistory={onCancelHistory}
            openExternal={onOpenHistoryLink}
          />
        ) : null}
      </div>
    </section>
  )
}
