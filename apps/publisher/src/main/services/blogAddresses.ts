import { isIP } from "node:net"
import { join } from "node:path"
import { parseDocument } from "yaml"
import type {
  BlogDisplayRecord,
  BlogLinkOpenRequest,
  BlogRecord,
  BlogRegistryState,
  BlogRegistryView,
} from "../../shared/contracts"

const controls = /[\u0000-\u001f\u007f-\u009f]/
const knownGitHosts = new Set(["github.com", "gitlab.com", "gitee.com"])
const unavailableRepository = { display: "未配置仓库" } as const
const unconfiguredWebsite = { source: "unconfigured" } as const

function safeCandidate(input: string): boolean {
  return input.length > 0 && Buffer.byteLength(input, "utf8") <= 2048 && !controls.test(input)
}

function withoutGitSuffix(url: URL): string {
  url.pathname = url.pathname.replace(/\.git$/, "")
  return url.href
}

function sshTarget(host: string, path: string): string | undefined {
  if (!knownGitHosts.has(host.toLowerCase()) || !/^\/?[^/]+\/.+/.test(path)) return undefined
  const url = new URL(`https://${host.toLowerCase()}/${path.replace(/^\//, "")}`)
  return withoutGitSuffix(url)
}

export function parseRepositoryRemote(
  remote: string,
): { readonly display: string; readonly url?: string } | undefined {
  if (!safeCandidate(remote)) return undefined
  const display = remote.trim()
  if (!display || /\s|\\/.test(display)) return undefined
  try {
    if (/^https?:\/\//i.test(display)) {
      const url = new URL(display)
      if (url.username || url.password) return undefined
      return { display, url: withoutGitSuffix(url) }
    }
    if (/^ssh:\/\//i.test(display)) {
      const url = new URL(display)
      if (url.password) return undefined
      const target = sshTarget(url.hostname, url.pathname)
      return target ? { display, url: target } : { display }
    }
    if (display.includes("://")) return undefined
    const scp = /^(?:[a-z\d._-]+@)?([a-z\d.-]+):([^@?#]+)$/i.exec(display)
    if (!scp || (!display.includes("@") && !scp[1]!.includes("."))) return undefined
    const target = sshTarget(scp[1]!, scp[2]!)
    return target ? { display, url: target } : { display }
  } catch {
    return undefined
  }
}

function blockedIpv4(host: string): boolean {
  const [first, second] = host.split(".").map(Number)
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

function blockedIpv6(host: string): boolean {
  // URL serializes IPv4-mapped addresses as hexadecimal IPv6 groups.
  const [left, right] = host.split("::")
  const head = left ? left.split(":").map((part) => Number.parseInt(part, 16)) : []
  const tail = right ? right.split(":").map((part) => Number.parseInt(part, 16)) : []
  const groups =
    right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail]
  if (groups.slice(0, 7).every((part) => part === 0) && groups[7] === 1) return true
  if ((groups[0]! & 0xfe00) === 0xfc00 || (groups[0]! & 0xffc0) === 0xfe80) return true
  if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) {
    return blockedIpv4(
      `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`,
    )
  }
  return false
}

export function normalizePublicWebsite(input: string): string | undefined {
  if (!safeCandidate(input) || /\s|\\/.test(input)) return undefined
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`)
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
      return undefined
    const host = url.hostname.replace(/^\[|\]$/g, "")
    const ipVersion = isIP(host)
    if (ipVersion === 4) {
      if (blockedIpv4(host)) return undefined
    } else if (ipVersion === 6) {
      if (blockedIpv6(host)) return undefined
    } else {
      if (host.length > 253 || host === "localhost" || host.endsWith(".localhost")) return undefined
      if (!host.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
        return undefined
    }
    return url.href
  } catch {
    return undefined
  }
}

export class BlogAddressError extends Error {
  constructor(readonly code: "INVALID_WEBSITE" | "LINK_UNAVAILABLE") {
    super(code === "INVALID_WEBSITE" ? "Invalid public website" : "Blog link is unavailable")
    this.name = "BlogAddressError"
  }
}

export interface BlogAddressResolver {
  normalizeWebsite(input: string): string | undefined
  describe(state: BlogRegistryState): Promise<BlogRegistryView>
  resolveLink(
    state: BlogRegistryState,
    id: string,
    kind: BlogLinkOpenRequest["kind"],
  ): Promise<string>
}

export function createBlogAddressResolver(options: {
  readonly runGit: (
    workspace: string,
  ) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>
  readonly readText: (file: string) => Promise<string>
}): BlogAddressResolver {
  async function repository(blog: BlogRecord): Promise<BlogDisplayRecord["repository"]> {
    try {
      const result = await options.runGit(blog.canonicalPath)
      if (result.exitCode !== 0) return unavailableRepository
      // Git emits one final line ending. Additional line endings remain invalid.
      return parseRepositoryRemote(result.stdout.replace(/\r?\n$/, "")) ?? unavailableRepository
    } catch {
      return unavailableRepository
    }
  }

  async function website(blog: BlogRecord): Promise<BlogDisplayRecord["website"]> {
    if (blog.websiteUrl !== undefined) {
      const url = normalizePublicWebsite(blog.websiteUrl)
      return url ? { source: "manual", url } : unconfiguredWebsite
    }
    try {
      const document = parseDocument(
        await options.readText(join(blog.canonicalPath, "quartz.config.yaml")),
      )
      // Inspect diagnostics without logging YAML source or exception messages.
      if (document.errors.length || document.warnings.length) return unconfiguredWebsite
      const config: unknown = document.toJS({ maxAliasCount: 100 })
      if (!config || typeof config !== "object" || !("configuration" in config))
        return unconfiguredWebsite
      const configuration = config.configuration
      if (!configuration || typeof configuration !== "object" || !("baseUrl" in configuration))
        return unconfiguredWebsite
      if (typeof configuration.baseUrl !== "string") return unconfiguredWebsite
      const url = normalizePublicWebsite(configuration.baseUrl)
      return url ? { source: "quartz", url } : unconfiguredWebsite
    } catch {
      return unconfiguredWebsite
    }
  }

  async function describeBlog(blog: BlogRecord): Promise<BlogDisplayRecord> {
    const [resolvedRepository, resolvedWebsite] = await Promise.all([
      repository(blog),
      website(blog),
    ])
    return {
      id: blog.id,
      name: blog.name,
      path: blog.path,
      canonicalPath: blog.canonicalPath,
      createdAt: blog.createdAt,
      lastOpenedAt: blog.lastOpenedAt,
      repository: resolvedRepository,
      website: resolvedWebsite,
    }
  }

  return {
    normalizeWebsite: normalizePublicWebsite,
    async describe(state) {
      return {
        version: state.version,
        activeBlogId: state.activeBlogId,
        blogs: await Promise.all(state.blogs.map(describeBlog)),
      }
    },
    async resolveLink(state, id, kind) {
      const blog = state.blogs.find((candidate) => candidate.id === id)
      if (!blog) throw new BlogAddressError("LINK_UNAVAILABLE")
      const resolved = await describeBlog(blog)
      const link = resolved[kind]
      if (!("url" in link) || !link.url) throw new BlogAddressError("LINK_UNAVAILABLE")
      return link.url
    },
  }
}
