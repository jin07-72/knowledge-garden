import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PreviewPane } from "../../src/renderer/src/components/PreviewPane"
import type { NoteSummary, PreviewStatus } from "../../src/shared/contracts"

const note: NoteSummary = {
  path: "content/technology/css-grid.md",
  domain: "technology",
  slug: "css-grid",
  title: "CSS Grid",
  date: "2026-09-18",
  description: "layout",
  visibility: "public",
  updatedAt: "2026-09-18T00:00:00.000Z",
  tags: ["css"],
}

const preview: PreviewStatus = {
  state: "ready",
  generation: 1,
  url: "http://127.0.0.1:8080/capability-token/",
  lastSuccessfulUrl: "http://127.0.0.1:8080/capability-token/",
}

afterEach(cleanup)

describe("renderer security", () => {
  it("renders the current public note through the exact Quartz route", async () => {
    render(
      <PreviewPane
        note={note}
        markdown="# Local public buffer"
        preview={preview}
        onLoadHistory={async () => ({
          commits: [],
          deployments: {
            runs: [],
            actionsUrl: "https://github.com/octocat/garden/actions/workflows/deploy.yml",
            liveSiteUrl: "https://octocat.github.io/garden/",
          },
        })}
        onCancelHistory={async () => undefined}
        onOpenHistoryLink={async () => undefined}
        onClearPublicCache={async () => undefined}
      />,
    )
    expect(screen.getByTitle("CSS Grid的 Quartz 精确预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8080/capability-token/technology/css-grid",
    )
    expect(screen.queryByRole("heading", { name: "Local public buffer" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "全站本地" }))
    expect(screen.getByTitle("Quartz 本地全站预览")).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-scripts",
    )
  })

  it("uses the same Quartz route for private notes and keeps the privacy warning", () => {
    render(
      <PreviewPane
        note={{ ...note, path: "private/technology/css-grid.md", visibility: "private" }}
        markdown="# Private buffer"
        preview={preview}
        onLoadHistory={async () => ({
          commits: [],
          deployments: {
            runs: [],
            actionsUrl: "https://example.com",
            liveSiteUrl: "https://example.com",
          },
        })}
        onCancelHistory={async () => undefined}
        onOpenHistoryLink={async () => undefined}
        onClearPublicCache={async () => undefined}
      />,
    )

    expect(screen.getByText("私密笔记不会映射到公开网址")).toBeVisible()
    expect(screen.getByTitle("CSS Grid的 Quartz 精确预览")).toHaveAttribute(
      "src",
      "http://127.0.0.1:8080/capability-token/technology/css-grid",
    )
  })

  it("labels the simplified renderer as a fallback when Quartz is unavailable", () => {
    render(
      <PreviewPane
        note={note}
        markdown="# Local public buffer"
        preview={{
          state: "error",
          generation: 2,
          error: { code: "PREVIEW_EXITED", message: "failed" },
        }}
        onLoadHistory={async () => ({
          commits: [],
          deployments: {
            runs: [],
            actionsUrl: "https://example.com",
            liveSiteUrl: "https://example.com",
          },
        })}
        onCancelHistory={async () => undefined}
        onOpenHistoryLink={async () => undefined}
        onClearPublicCache={async () => undefined}
      />,
    )

    expect(screen.getByText("Quartz 暂不可用，当前显示简化预览")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Local public buffer" })).toBeVisible()
    expect(screen.queryByTitle("CSS Grid的 Quartz 精确预览")).not.toBeInTheDocument()
  })

  it("labels a building frame as the last successful version", () => {
    render(
      <PreviewPane
        note={note}
        markdown="# Buffer"
        preview={{ state: "building", generation: 2, lastSuccessfulUrl: preview.url }}
        onLoadHistory={async () => ({
          commits: [],
          deployments: {
            runs: [],
            actionsUrl: "https://example.com",
            liveSiteUrl: "https://example.com",
          },
        })}
        onCancelHistory={async () => undefined}
        onOpenHistoryLink={async () => undefined}
        onClearPublicCache={async () => undefined}
      />,
    )

    expect(screen.getByText("正在重建；当前显示上次成功版本。")).toBeVisible()
    expect(screen.getByText("重建中")).toBeVisible()
    expect(screen.getByTitle("CSS Grid的 Quartz 精确预览")).toBeInTheDocument()
  })

  it("treats an empty markdown string as a loaded empty note", () => {
    render(
      <PreviewPane
        note={note}
        markdown=""
        preview={{ state: "stopped", generation: 1 }}
        onLoadHistory={async () => ({
          commits: [],
          deployments: {
            runs: [],
            actionsUrl: "https://github.com/octocat/garden/actions/workflows/deploy.yml",
            liveSiteUrl: "https://octocat.github.io/garden/",
          },
        })}
        onCancelHistory={async () => undefined}
        onOpenHistoryLink={async () => undefined}
        onClearPublicCache={async () => undefined}
      />,
    )

    expect(screen.getByText("当前笔记内容为空。")).toBeVisible()
    expect(screen.queryByText("正在载入预览…")).not.toBeInTheDocument()
  })

  it("declares a strict renderer CSP for local dev and production frame targets", async () => {
    const html = await readFile(resolve("src/renderer/index.html"), "utf8")
    expect(html).toContain("Content-Security-Policy")
    expect(html).toContain("default-src 'self'")
    expect(html).toContain("script-src 'self'")
    expect(html).toContain("frame-src http://127.0.0.1:* https://jin07-72.github.io")
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(html).not.toContain("unsafe-eval")
  })
})
