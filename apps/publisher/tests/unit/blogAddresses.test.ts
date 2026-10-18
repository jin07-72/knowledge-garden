import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { BlogRecord, BlogRegistryState } from "../../src/shared/contracts"
import { IPC_CHANNELS } from "../../src/shared/contracts"
import { IPC_SUCCESS_SCHEMAS } from "../../src/shared/ipcSchemas"
import {
  BlogAddressError,
  createBlogAddressResolver,
  normalizePublicWebsite,
  parseRepositoryRemote,
} from "../../src/main/services/blogAddresses"

const blog: BlogRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Garden",
  path: join("C:", "gardens", "display-path"),
  canonicalPath: join("C:", "gardens", "first"),
  createdAt: "2026-10-01T00:00:00.000Z",
  lastOpenedAt: "2026-10-01T00:00:00.000Z",
}
const state = (...blogs: BlogRecord[]): BlogRegistryState => ({
  version: 1,
  activeBlogId: blogs[0]?.id ?? blog.id,
  blogs,
})
const gitResult = (stdout: string, exitCode = 0, stderr = "") => ({ stdout, exitCode, stderr })
const resolverWith = (remote = "", config = "") =>
  createBlogAddressResolver({
    runGit: async () => gitResult(remote),
    readText: async () => config,
  })
const expandedWebsite = "https://example.com/" + "界".repeat(300)
const nearLimitWebsite = "example.com/" + "a".repeat(2048 - "example.com/".length)
const expandedSshRemote = "git@github.com:owner/" + "界".repeat(300)

describe("repository remote policy", () => {
  it.each([
    ["http://0.0.0.0/owner/repo.git", "http://0.0.0.0/owner/repo"],
    ["http://[::]/owner/repo.git", "http://[::]/owner/repo"],
    ["https://github.com/acme/garden.git", "https://github.com/acme/garden"],
    ["git@github.com:acme/garden.git", "https://github.com/acme/garden"],
    ["ssh://git@gitlab.com/acme/garden.git", "https://gitlab.com/acme/garden"],
    ["git@gitee.com:acme/garden.git", "https://gitee.com/acme/garden"],
    ["git@GitHub.COM:acme/garden.git", "https://github.com/acme/garden"],
    [
      "https://github.com/acme/garden.git?tab=readme#top",
      "https://github.com/acme/garden?tab=readme#top",
    ],
    ["https://github.com/acme/garden.git/", "https://github.com/acme/garden.git/"],
  ])("preserves display and derives a click target for %s", (remote, url) => {
    expect(parseRepositoryRemote(remote)).toEqual({ display: remote, url })
  })

  it.each([
    "git@custom.example:acme/garden.git",
    "ssh://git@custom.example/acme/garden.git",
    "ssh://git@custom.example/repo.git",
  ])("keeps custom SSH display-only: %s", (remote) => {
    expect(parseRepositoryRemote(remote)).toEqual({ display: remote })
  })

  it.each([
    "",
    "   ",
    "https://github.com/a/b.git\n",
    "git@github.com:a/\nb.git",
    "git@github.com:a/\u0085b.git",
    "https://user:secret@github.com/a/b.git",
    "http://secret@github.com/a/b",
    "ssh://git:secret@github.com/a/b",
    "https://github.com/" + "界".repeat(700),
    "javascript:alert(1)",
    "ftp://user:secret@example.com/a/b",
    "git:secret@github.com:acme/garden.git",
    "ssh:///owner/repo.git",
    "ssh://git@custom.example",
    "ssh://git@custom.example/",
    "ssh://git@custom.example/?repo=repo.git#repo",
    expandedWebsite,
    expandedSshRemote,
  ])("rejects unsafe or unavailable remote %j", (remote) => {
    expect(parseRepositoryRemote(remote)).toBeUndefined()
  })

  it.each([
    "git@github.com.evil.example:a/b.git",
    "git@github.com:repo.git",
    "ssh://git@github.com/repo.git",
    "git@github.com:owner/..",
    "git@github.com:owner/%2e%2e",
    "git@github.com:owner/.git",
    "ssh://git@github.com/owner//",
  ])("does not convert SSH host lookalikes or missing owner/repository: %s", (remote) => {
    expect(parseRepositoryRemote(remote)).toEqual({ display: remote })
  })
})

describe("public website policy", () => {
  it.each([
    ["example.com/garden", "https://example.com/garden"],
    ["https://example.com/garden/", "https://example.com/garden/"],
    ["http://example.com/path?q=a#anchor", "http://example.com/path?q=a#anchor"],
    ["https://8.8.8.8", "https://8.8.8.8/"],
    ["https://[::ffff:8.8.8.8]/", "https://[::ffff:808:808]/"],
    ["https://[2606:4700:4700::1111]/", "https://[2606:4700:4700::1111]/"],
    ["example.com:8443/garden", "https://example.com:8443/garden"],
    ["https://example.com./path?q=a#anchor", "https://example.com./path?q=a#anchor"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePublicWebsite(input)).toBe(expected)
  })

  it.each([
    ["http://0", "0.0.0.0"],
    ["http://00", "0.0.0.0"],
    ["http://0x0", "0.0.0.0"],
    ["http://0.0", "0.0.0.0"],
    ["http://0.0.0", "0.0.0.0"],
    ["http://0.0.0.0/", "0.0.0.0"],
    ["http://0.0.0.0./", "0.0.0.0"],
    ["http://[::]/", "[::]"],
    ["http://[0:0:0:0:0:0:0:0]/", "[::]"],
    ["http://[0000:0000:0000:0000:0000:0000:0000:0000]/", "[::]"],
    ["http://[::0]/", "[::]"],
    ["http://[::ffff:0.0.0.0]/", "[::ffff:0:0]"],
    ["http://[::ffff:0:0]/", "[::ffff:0:0]"],
    ["http://[0:0:0:0:0:ffff:0000:0000]/", "[::ffff:0:0]"],
  ])("rejects unspecified destinations after WHATWG normalization: %s", (input, hostname) => {
    const canonical = new URL(input)
    expect(canonical.hostname).toBe(hostname)
    expect(normalizePublicWebsite(input)).toBeUndefined()
    expect(normalizePublicWebsite(canonical.href)).toBeUndefined()
  })

  it.each([
    "",
    "ftp://example.com",
    "file:///tmp/file",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://user@example.com",
    "localhost",
    "sub.localhost",
    "https://LOCALHOST./",
    "https://sub.localhost./",
    "https://notes.localhost./",
    "https://notes.localhost\u3002/",
    "https://example.com../",
    "https://127.0.0.1./",
    "https://192.168.1.1./",
    "127.0.0.1",
    "127.255.255.255",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.2.3",
    "http://2130706433",
    "http://0x7f000001",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fdff::1]",
    "https://[fe80::1]",
    "https://[febf::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:192.168.1.1]",
    "https://bad_host.example",
    "https://-bad.example",
    "https://bad-.example",
    "https://a..example",
    "https://.example",
    "https://" + "a".repeat(64) + ".com",
    " https://example.com",
    "https://example.com/has space",
    "https://example.com/\n",
    "https://example.com/\u0085",
    "https://example.com/" + "界".repeat(700),
    expandedWebsite,
    nearLimitWebsite,
  ])("rejects unsafe website %j", (input) => {
    expect(normalizePublicWebsite(input)).toBeUndefined()
  })

  it.each(["172.15.255.255", "172.32.0.1", "192.169.0.1", "https://[fec0::1]"])(
    "does not broaden the blocked ranges to %s",
    (input) => {
      expect(normalizePublicWebsite(input)).toBeDefined()
    },
  )
})

describe("blog address resolver", () => {
  const unspecifiedSources = (["manual", "quartz"] as const).flatMap((source) =>
    ["http://0", "http://[::]/", "http://[::ffff:0.0.0.0]/"].map((websiteUrl) => ({
      source,
      websiteUrl,
    })),
  )

  it.each(unspecifiedSources)(
    "marks $source unspecified website $websiteUrl unconfigured",
    async ({ source, websiteUrl }) => {
      const resolver = resolverWith("", `configuration:\n  baseUrl: ${websiteUrl}`)
      const view = await resolver.describe(
        state(source === "manual" ? { ...blog, websiteUrl } : blog),
      )
      expect(view.blogs[0]?.website).toEqual({ source: "unconfigured" })
      expect(JSON.stringify(view)).not.toContain(websiteUrl)
    },
  )

  it.each(unspecifiedSources)(
    "refuses to resolve $source unspecified website $websiteUrl",
    async ({ source, websiteUrl }) => {
      const resolver = resolverWith("", `configuration:\n  baseUrl: ${websiteUrl}`)
      const current = state(source === "manual" ? { ...blog, websiteUrl } : blog)
      const error = await resolver
        .resolveLink(current, blog.id, "website")
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(BlogAddressError)
      expect(error).toMatchObject({ code: "LINK_UNAVAILABLE", message: "Blog link is unavailable" })
      expect(error).not.toHaveProperty("cause")
      expect(JSON.stringify(error)).not.toContain(websiteUrl)
    },
  )

  it.each([expandedWebsite, nearLimitWebsite])(
    "keeps oversized normalized websites within the real IPC contract: %s",
    async (websiteUrl) => {
      for (const source of ["manual", "quartz"] as const) {
        const resolver = resolverWith(expandedWebsite, `configuration:\n  baseUrl: ${websiteUrl}`)
        const view = await resolver.describe(
          state(source === "manual" ? { ...blog, websiteUrl } : blog),
        )
        const response = { ...view, activeAvailability: "available" }
        expect(IPC_SUCCESS_SCHEMAS[IPC_CHANNELS.requests.blogsList].parse(response)).toEqual(
          response,
        )
        expect(view.blogs[0]?.repository).toEqual({ display: "未配置仓库" })
        expect(view.blogs[0]?.website).toEqual({ source: "unconfigured" })
      }
    },
  )

  it("keeps oversized SSH targets unconfigured and accepts URLs exactly at the limit", async () => {
    const websiteUrl = "https://example.com/" + "a".repeat(2048 - "https://example.com/".length)
    expect(normalizePublicWebsite(websiteUrl)).toBe(websiteUrl)
    expect(parseRepositoryRemote(websiteUrl)?.url).toBe(websiteUrl)
    const view = await resolverWith(expandedSshRemote).describe(state({ ...blog, websiteUrl }))
    const response = { ...view, activeAvailability: "available" }
    expect(IPC_SUCCESS_SCHEMAS[IPC_CHANNELS.requests.blogsList].parse(response)).toEqual(response)
    expect(view.blogs[0]?.repository).toEqual({ display: "未配置仓库" })
    expect(view.blogs[0]?.website).toEqual({ source: "manual", url: websiteUrl })
  })

  it("provides the same pure website normalization and safe typed errors", () => {
    const resolver = resolverWith()
    expect(resolver.normalizeWebsite("example.com")).toBe("https://example.com/")
    for (const input of ["", "   ", "localhost", "https://user:secret@example.com"]) {
      expect(resolver.normalizeWebsite(input)).toBeUndefined()
    }
    expect(new BlogAddressError("INVALID_WEBSITE")).toMatchObject({
      code: "INVALID_WEBSITE",
      message: "Invalid public website",
    })
  })

  it("reads the canonical workspace and YAML file and trims one Git output line", async () => {
    const workspaces: string[] = []
    const files: string[] = []
    const resolver = createBlogAddressResolver({
      runGit: async (workspace) => {
        workspaces.push(workspace)
        return gitResult("  git@github.com:acme/garden.git  \r\n")
      },
      readText: async (file) => {
        files.push(file)
        return "configuration:\n  baseUrl: example.com/garden"
      },
    })
    const view = await resolver.describe(state(blog))
    expect(workspaces).toEqual([blog.canonicalPath])
    expect(files).toEqual([join(blog.canonicalPath, "quartz.config.yaml")])
    expect(view).toEqual({
      ...state(blog),
      blogs: [
        {
          ...blog,
          repository: {
            display: "git@github.com:acme/garden.git",
            url: "https://github.com/acme/garden",
          },
          website: { source: "quartz", url: "https://example.com/garden" },
        },
      ],
    })
  })

  it("prioritizes manual websites and omits the persisted field", async () => {
    const resolver = resolverWith("", "configuration:\n  baseUrl: quartz.example")
    const view = await resolver.describe(
      state({ ...blog, websiteUrl: "https://manual.example/path" }),
    )
    expect(view.blogs[0]?.website).toEqual({ source: "manual", url: "https://manual.example/path" })
    expect(view.blogs[0]).not.toHaveProperty("websiteUrl")
  })

  it.each([
    "",
    "configuration: [broken",
    "baseUrl: example.com",
    "configuration:\n  baseUrl: 123",
    "configuration:\n  baseUrl: localhost",
    "configuration:\n  baseUrl: https://user:secret@example.com",
    "configuration:\n  baseUrl: |\n    example.com\n    other.example",
    "configuration:\n  baseUrl: https://example.com/" + "界".repeat(700),
  ])("fails softly for unusable Quartz config %j", async (config) => {
    const view = await resolverWith("", config).describe(state(blog))
    expect(view.blogs[0]?.website).toEqual({ source: "unconfigured" })
    expect(JSON.stringify(view)).not.toContain("secret")
  })

  it("isolates Git and file failures and retains every blog", async () => {
    const second = { ...blog, id: "second", canonicalPath: join("C:", "gardens", "second") }
    const third = { ...blog, id: "third", canonicalPath: join("C:", "gardens", "third") }
    const resolver = createBlogAddressResolver({
      runGit: async (workspace) => {
        if (workspace === blog.canonicalPath) throw new Error("secret git exception")
        if (workspace === second.canonicalPath)
          return gitResult("https://user:secret@example.com/a/b", 1, "secret stderr")
        return gitResult("git@github.com:acme/garden.git")
      },
      readText: async (file) => {
        if (file === join(blog.canonicalPath, "quartz.config.yaml"))
          throw new Error("secret file exception")
        return "configuration:\n  baseUrl: example.com"
      },
    })
    const view = await resolver.describe(state(blog, second, third))
    expect(view.blogs).toHaveLength(3)
    expect(view.blogs[0]?.repository).toEqual({ display: "未配置仓库" })
    expect(view.blogs[1]?.repository).toEqual({ display: "未配置仓库" })
    expect(view.blogs[1]?.website).toEqual({ source: "quartz", url: "https://example.com/" })
    expect(view.blogs[2]?.repository.url).toBe("https://github.com/acme/garden")
    expect(JSON.stringify(view)).not.toContain("secret")
  })

  it("keeps custom SSH nonclickable and rejects multiple Git output lines", async () => {
    expect(
      (await resolverWith("git@custom.example:a/b.git").describe(state(blog))).blogs[0]?.repository,
    ).toEqual({ display: "git@custom.example:a/b.git" })
    expect(
      (await resolverWith("https://example.com/a/b\nhttps://evil.example\n").describe(state(blog)))
        .blogs[0]?.repository,
    ).toEqual({ display: "未配置仓库" })
  })

  it("resolves each click from the current record and live adapters", async () => {
    let remote = "git@github.com:a/first.git"
    let baseUrl = "first.example"
    const workspaces: string[] = []
    const resolver = createBlogAddressResolver({
      runGit: async (workspace) => {
        workspaces.push(workspace)
        return gitResult(remote)
      },
      readText: async () => `configuration:\n  baseUrl: ${baseUrl}`,
    })
    await resolver.describe(state(blog))
    remote = "git@github.com:a/second.git"
    baseUrl = "second.example"
    const moved = { ...blog, canonicalPath: join("C:", "moved") }
    await expect(resolver.resolveLink(state(moved), blog.id, "repository")).resolves.toBe(
      "https://github.com/a/second",
    )
    await expect(resolver.resolveLink(state(moved), blog.id, "website")).resolves.toBe(
      "https://second.example/",
    )
    await expect(
      resolver.resolveLink(state({ ...moved, websiteUrl: "manual.example" }), blog.id, "website"),
    ).resolves.toBe("https://manual.example/")
    expect(workspaces.slice(1)).toEqual([
      moved.canonicalPath,
      moved.canonicalPath,
      moved.canonicalPath,
    ])
  })

  it("throws only a fixed safe error for missing or unavailable links", async () => {
    const resolver = resolverWith(
      "git@custom.example:a/b.git",
      "configuration:\n  baseUrl: https://user:secret@example.com",
    )
    for (const [id, kind] of [
      ["missing-secret", "website"],
      [blog.id, "repository"],
      [blog.id, "website"],
    ] as const) {
      const error = await resolver
        .resolveLink(state(blog), id, kind)
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(BlogAddressError)
      expect(error).toMatchObject({ code: "LINK_UNAVAILABLE", message: "Blog link is unavailable" })
      expect(JSON.stringify(error)).not.toContain("secret")
      expect(error).not.toHaveProperty("cause")
    }
  })

  it("does not expose an invalid persisted website", async () => {
    const view = await resolverWith().describe(
      state({ ...blog, websiteUrl: "https://user:secret@example.com" }),
    )
    expect(view.blogs[0]?.website).toEqual({ source: "unconfigured" })
    expect(JSON.stringify(view)).not.toContain("secret")
  })
})
