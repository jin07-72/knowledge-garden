import { ExternalLink } from "lucide-react"
import { useId } from "react"
import type { BlogDisplayRecord, BlogLinkOpenRequest } from "../../../shared/contracts"

type LinkKind = BlogLinkOpenRequest["kind"]

export function getBlogAddressIds(prefix: string) {
  return {
    repository: `${prefix}-repository`,
    website: `${prefix}-website`,
    local: `${prefix}-local`,
  }
}

export interface BlogAddressRowsProps {
  readonly blog: BlogDisplayRecord
  /** Supply a unique instance prefix when another control describes these values. */
  readonly idPrefix?: string
  readonly onOpenLink?: (kind: LinkKind) => void
  readonly disabled?: boolean
  readonly getLinkButtonProps?: (kind: LinkKind) => {
    readonly role: "menuitem"
    readonly "data-menu-index": number
    readonly tabIndex: number
    readonly onFocus: () => void
  }
}

export function BlogAddressRows({
  blog,
  idPrefix,
  onOpenLink,
  disabled = false,
  getLinkButtonProps,
}: BlogAddressRowsProps): React.JSX.Element {
  const generatedId = useId()
  const ids = getBlogAddressIds(idPrefix ?? generatedId)
  const website = blog.website.source === "unconfigured" ? "未配置网站" : blog.website.url
  const rows = [
    {
      label: "仓库",
      value: blog.repository.display,
      kind: "repository" as const,
      available: !!blog.repository.url,
    },
    {
      label: "网站",
      value: website,
      kind: "website" as const,
      available: blog.website.source !== "unconfigured",
    },
    { label: "本地", value: blog.path, kind: undefined, available: false },
  ]

  return (
    <dl className="blog-address-rows">
      {rows.map(({ label, value, kind, available }) => (
        <div className="blog-address-row" key={label}>
          <dt>{label}</dt>
          <dd id={ids[kind ?? "local"]} title={value} aria-label={value}>
            <span className="blog-address-value">{value}</span>
            {available && kind ? (
              <button
                {...getLinkButtonProps?.(kind)}
                type="button"
                className="blog-address-open"
                aria-label={`打开 ${blog.name} 的${label}`}
                aria-describedby={ids[kind]}
                disabled={disabled || !onOpenLink}
                onClick={() => {
                  if (!disabled) onOpenLink?.(kind)
                }}
              >
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
