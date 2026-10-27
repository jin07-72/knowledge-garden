import type { PreviewRevealRequest, PreviewRevealResult } from "../shared/contracts"

export interface PreviewFramePort {
  readonly url: string
  executeJavaScript(source: string, userGesture?: boolean): Promise<unknown>
}

function normalizedLoopbackUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return undefined
    url.hash = ""
    url.search = ""
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString()
  } catch {
    return undefined
  }
}

function revealInDocument(request: { text: string; positionRatio: number }): PreviewRevealResult {
  const compact = (value: string): string =>
    value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim()
  const stripMarkdown = (value: string): string =>
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
      .replace(/(\*\*|__|~~|`)/g, "")
  const bounded =
    request.text.length <= 4_096
      ? request.text
      : `${request.text.slice(0, 2_048)}\n${request.text.slice(-2_048)}`
  const needles = Array.from(
    new Set(
      [
        bounded,
        stripMarkdown(bounded),
        ...bounded.split(/\r?\n/).flatMap((line) => [line, stripMarkdown(line)]),
      ]
        .map(compact)
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length)
  const root =
    document.querySelector<HTMLElement>("article") ??
    document.querySelector<HTMLElement>("main") ??
    document.body
  if (!root || needles.length === 0) return "not-ready"
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th"),
  ).filter((element) => !element.closest('nav,.toc,script,style,[aria-hidden="true"]'))
  const matches = blocks.filter((element) => {
    const text = compact(element.innerText || element.textContent || "")
    return needles.some((needle) => text.includes(needle))
  })
  if (matches.length === 0) return "not-found"
  const rootRect = root.getBoundingClientRect()
  const ratioFor = (element: HTMLElement, index: number): number => {
    const rect = element.getBoundingClientRect()
    if (rootRect.height > 0) {
      return Math.min(1, Math.max(0, (rect.top + rect.height / 2 - rootRect.top) / rootRect.height))
    }
    return matches.length <= 1 ? 0.5 : index / (matches.length - 1)
  }
  const desired = Math.min(1, Math.max(0, request.positionRatio))
  const target = matches.reduce((best, candidate, index) => {
    const bestIndex = matches.indexOf(best)
    return Math.abs(ratioFor(candidate, index) - desired) <
      Math.abs(ratioFor(best, bestIndex) - desired)
      ? candidate
      : best
  })
  let style = document.querySelector<HTMLStyleElement>("style[data-publisher-preview-navigation]")
  if (!style) {
    style = document.createElement("style")
    style.dataset.publisherPreviewNavigation = "true"
    style.textContent =
      ".publisher-preview-locate-highlight{background:rgba(134,213,207,.28)!important;outline:3px solid #86d5cf!important;outline-offset:4px;border-radius:4px}"
    document.head.append(style)
  }
  document
    .querySelectorAll(".publisher-preview-locate-highlight")
    .forEach((element) => element.classList.remove("publisher-preview-locate-highlight"))
  target.classList.add("publisher-preview-locate-highlight")
  target.scrollIntoView({ behavior: "smooth", block: "center" })
  window.setTimeout(() => target.classList.remove("publisher-preview-locate-highlight"), 2_000)
  return "found"
}

function scriptFor(request: PreviewRevealRequest): string {
  return `(${revealInDocument.toString()})(${JSON.stringify({
    text: request.text,
    positionRatio: request.positionRatio,
  })})`
}

export async function revealSelectionInPreviewFrames(
  frames: readonly PreviewFramePort[],
  request: PreviewRevealRequest,
): Promise<PreviewRevealResult> {
  const requestedUrl = normalizedLoopbackUrl(request.url)
  if (!requestedUrl) return "not-ready"
  const frame = frames.find((candidate) => normalizedLoopbackUrl(candidate.url) === requestedUrl)
  if (!frame) return "not-ready"
  try {
    const result = await frame.executeJavaScript(scriptFor(request), true)
    return result === "found" || result === "not-found" || result === "not-ready"
      ? result
      : "not-ready"
  } catch {
    return "not-ready"
  }
}
