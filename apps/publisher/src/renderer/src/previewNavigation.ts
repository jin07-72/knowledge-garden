export interface PreviewNavigationRequest {
  readonly id: number
  readonly documentPath: string
  readonly text: string
  readonly positionRatio: number
}

export type PreviewNavigationResult = "found" | "not-found" | "not-ready"

const PREVIEW_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th"
const EXCLUDED_PREVIEW_SELECTOR = 'nav,.toc,script,style,[aria-hidden="true"]'
const MAX_SELECTION_LENGTH = 4_096

function compactWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim()
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^\\])[*_](?=\S)|(?<=\S)[*_](?![*_])/g, "$1")
}

function boundedSelection(value: string): string {
  if (value.length <= MAX_SELECTION_LENGTH) return value
  const half = MAX_SELECTION_LENGTH / 2
  return `${value.slice(0, half)}\n${value.slice(-half)}`
}

export function normalizePreviewNeedles(source: string): readonly string[] {
  const bounded = boundedSelection(source)
  const candidates = [bounded, stripMarkdown(bounded)]
  for (const line of bounded.split(/\r?\n/)) {
    candidates.push(line, stripMarkdown(line))
  }
  return [...new Set(candidates.map(compactWhitespace).filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  )
}

function candidateRatio(
  root: HTMLElement,
  candidate: HTMLElement,
  index: number,
  total: number,
): number {
  const rootRect = root.getBoundingClientRect()
  const candidateRect = candidate.getBoundingClientRect()
  if (rootRect.height > 0) {
    const midpoint = candidateRect.top + candidateRect.height / 2
    return Math.min(1, Math.max(0, (midpoint - rootRect.top) / rootRect.height))
  }
  return total <= 1 ? 0.5 : index / (total - 1)
}

export function findPreviewTarget(
  root: HTMLElement,
  needles: readonly string[],
  positionRatio: number,
): HTMLElement | undefined {
  const normalizedNeedles = needles.map(compactWhitespace).filter(Boolean)
  if (normalizedNeedles.length === 0) return undefined

  const blocks = [...root.querySelectorAll<HTMLElement>(PREVIEW_BLOCK_SELECTOR)].filter(
    (element) => !element.closest(EXCLUDED_PREVIEW_SELECTOR),
  )
  const matches = blocks.filter((element) => {
    const text = compactWhitespace(element.innerText || element.textContent || "")
    return normalizedNeedles.some((needle) => text.includes(needle))
  })
  if (matches.length === 0) return undefined

  const desiredRatio = Math.min(1, Math.max(0, positionRatio))
  return matches.reduce((best, candidate, index) => {
    const bestIndex = matches.indexOf(best)
    const bestDistance = Math.abs(
      candidateRatio(root, best, bestIndex, matches.length) - desiredRatio,
    )
    const candidateDistance = Math.abs(
      candidateRatio(root, candidate, index, matches.length) - desiredRatio,
    )
    return candidateDistance < bestDistance ? candidate : best
  })
}

export function revealPreviewSelection(
  root: HTMLElement,
  request: PreviewNavigationRequest,
): { readonly result: PreviewNavigationResult; readonly cleanup?: () => void } {
  const target = findPreviewTarget(
    root,
    normalizePreviewNeedles(request.text),
    request.positionRatio,
  )
  if (!target) return { result: "not-found" }

  target.classList.add("publisher-preview-locate-highlight")
  target.scrollIntoView({ behavior: "smooth", block: "center" })
  let active = true
  return {
    result: "found",
    cleanup: () => {
      if (!active) return
      active = false
      target.classList.remove("publisher-preview-locate-highlight")
    },
  }
}
