# Blog Repository, Website, and Local Address Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在顶部博客切换器、展开列表和博客管理页统一显示“仓库 / 网站 / 本地”，支持安全打开仓库和网站，并允许用户保存或清除独立于 Quartz 配置的网站地址。

**Architecture:** 持久化注册表只新增可选的手动网站覆盖值，主进程地址解析服务每次从当前 `origin` 与 `quartz.config.yaml` 生成只读显示视图。渲染进程只能发送博客 ID 与链接类型，主进程在打开外部浏览器前重新读取、规范化和验证目标；界面复用一个无嵌套交互控件的地址行组件。

**Tech Stack:** Electron 44、React 19、TypeScript、Zod、YAML、Vitest、Testing Library、Electron Vite、CSS

---

## File map

- Modify `apps/publisher/src/shared/contracts.ts`: 区分持久化博客状态与渲染显示视图，定义网站更新和链接打开请求，并添加两个 IPC 通道。
- Modify `apps/publisher/src/shared/ipcSchemas.ts`: 严格校验新增请求与显示视图，限制 URL 字段长度、来源枚举和未知字段。
- Create `apps/publisher/src/main/services/blogAddresses.ts`: 规范化公开网站 URL、解析 Git 远端、读取 Quartz `baseUrl`、生成显示视图并在打开前重新解析目标。
- Create `apps/publisher/tests/unit/blogAddresses.test.ts`: 覆盖仓库转换、网站安全策略、Quartz 回退、逐博客失败隔离和重新解析。
- Modify `apps/publisher/src/main/services/blogRegistry.ts`: 兼容读取旧记录，原子保存或清除手动网站覆盖值。
- Modify `apps/publisher/tests/unit/blogRegistry.test.ts`: 覆盖旧格式兼容、覆盖值持久化、清除和失败回滚。
- Modify `apps/publisher/src/main/blogRuntime.ts`: 让博客管理适配器返回增强后的显示视图，增加网站更新与安全链接打开操作。
- Modify `apps/publisher/src/main/index.ts`: 注入 Git/YAML 地址解析器和 `shell.openExternal`，不向渲染进程暴露原始 URL 打开能力。
- Modify `apps/publisher/src/main/ipc.ts`: 注册网站更新和链接打开处理器，并沿用可信发送者、请求和响应校验。
- Modify `apps/publisher/src/preload/gardenApi.ts`: 只暴露 `updateWebsite` 与 `openLink` 两个窄能力。
- Modify `apps/publisher/tests/unit/blog-runtime.test.ts`: 覆盖增强列表、变更后刷新和打开前重新解析。
- Modify `apps/publisher/tests/unit/ipc-schemas.test.ts`: 覆盖新增请求、响应边界和敏感字段剥离。
- Modify `apps/publisher/tests/unit/ipc.test.ts`: 覆盖新增通道的可信发送者、严格请求、服务路由和 preload 映射。
- Create `apps/publisher/src/renderer/src/components/BlogAddressRows.tsx`: 统一渲染仓库、网站、本地三行及可选的打开按钮。
- Modify `apps/publisher/src/renderer/src/components/BlogSwitcher.tsx`: 在当前摘要和展开条目中使用地址行，并拆开切换与链接按钮。
- Modify `apps/publisher/src/renderer/src/components/BlogManager.tsx`: 显示三行地址，增加编辑、保存、清除网站覆盖值的表单。
- Modify `apps/publisher/src/renderer/src/App.tsx`: 连接打开链接和更新网站地址动作，刷新注册表视图并报告安全错误。
- Modify `apps/publisher/src/renderer/src/app.css`: 支持三行地址、长文本、省略、窄屏布局、独立焦点和编辑表单。
- Modify `apps/publisher/tests/unit/blog-manager.test.tsx`: 覆盖三个位置的展示、可访问交互、网站编辑与繁忙状态。
- Modify `apps/publisher/tests/unit/main-layout.test.tsx`: 覆盖 App 到 preload API 的更新和打开动作。
- Modify `apps/publisher/tests/e2e/app.spec.ts`: 在真实 Electron 渲染环境验证地址标签和无嵌套交互控件。

### Task 1: 定义持久化状态、显示视图和严格 IPC 合同

**Files:**
- Modify: `apps/publisher/src/shared/contracts.ts:326-343,450-481,679-694`
- Modify: `apps/publisher/src/shared/ipcSchemas.ts:46-74,671-780`
- Modify: `apps/publisher/tests/unit/ipc-schemas.test.ts`

- [ ] **Step 1: 添加失败测试锁定请求与显示响应边界**

在 `ipc-schemas.test.ts` 的博客 Schema 测试组中加入：

```ts
it("accepts only strict website updates and typed blog link requests", () => {
  expect(blogWebsiteUpdateRequestSchema.parse({ id, websiteUrl: null })).toEqual({
    id,
    websiteUrl: null,
  })
  expect(
    blogWebsiteUpdateRequestSchema.parse({ id, websiteUrl: "https://example.com/garden/" }),
  ).toEqual({ id, websiteUrl: "https://example.com/garden/" })
  expect(() =>
    blogWebsiteUpdateRequestSchema.parse({ id, websiteUrl: "https://example.com", extra: true }),
  ).toThrow()
  expect(blogLinkOpenRequestSchema.parse({ id, kind: "repository" })).toEqual({
    id,
    kind: "repository",
  })
  expect(() => blogLinkOpenRequestSchema.parse({ id, kind: "local" })).toThrow()
})

it("strips unknown blog display fields and rejects malformed address metadata", () => {
  const parsed = IPC_SUCCESS_SCHEMAS[IPC_CHANNELS.requests.blogsList].parse({
    version: 1,
    activeBlogId: id,
    activeAvailability: "available",
    blogs: [
      {
        id,
        name: "Knowledge Garden",
        path: workspace,
        canonicalPath: workspace,
        createdAt: timestamp,
        lastOpenedAt: timestamp,
        repository: { display: "https://example.com/owner/repo", url: "https://example.com/owner/repo", secret: "drop" },
        website: { source: "manual", url: "https://garden.example/", secret: "drop" },
        secret: "drop",
      },
    ],
  })
  expect(parsed.blogs[0]).not.toHaveProperty("secret")
  expect(parsed.blogs[0]?.repository).not.toHaveProperty("secret")
  expect(() =>
    IPC_SUCCESS_SCHEMAS[IPC_CHANNELS.requests.blogsList].parse({
      ...parsed,
      blogs: [{ ...parsed.blogs[0], website: { source: "manual" } }],
    }),
  ).toThrow()
})
```

- [ ] **Step 2: 运行聚焦测试并确认缺少合同定义**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc-schemas.test.ts -t "website updates|blog display fields"
```

Expected: FAIL，报告 `blogWebsiteUpdateRequestSchema`、`blogLinkOpenRequestSchema` 或新的显示字段尚未定义。

- [ ] **Step 3: 在共享合同中明确状态和视图类型**

把原 `BlogRecord` / `BlogRegistryView` 拆为：

```ts
export interface BlogRecord {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly canonicalPath: string
  readonly createdAt: string
  readonly lastOpenedAt: string
  readonly websiteUrl?: string
}

export interface BlogRegistryState {
  readonly version: 1
  readonly activeBlogId: string
  readonly blogs: readonly BlogRecord[]
}

export interface BlogDisplayRecord extends Omit<BlogRecord, "websiteUrl"> {
  readonly repository: { readonly display: string; readonly url?: string }
  readonly website:
    | { readonly source: "manual" | "quartz"; readonly url: string }
    | { readonly source: "unconfigured" }
}

export interface BlogRegistryView {
  readonly version: 1
  readonly activeBlogId: string
  readonly blogs: readonly BlogDisplayRecord[]
}

export interface BlogWebsiteUpdateRequest {
  readonly id: string
  readonly websiteUrl: string | null
}

export interface BlogLinkOpenRequest {
  readonly id: string
  readonly kind: "repository" | "website"
}
```

在 `IPC_CHANNELS.requests` 中添加 `blogsUpdateWebsite` 和 `blogsOpenLink`，并在 `GardenApi.blogs` 中添加：

```ts
updateWebsite(request: BlogWebsiteUpdateRequest): Promise<IpcResult<BlogRegistryView>>
openLink(request: BlogLinkOpenRequest): Promise<IpcResult<void>>
```

- [ ] **Step 4: 在 IPC Schema 中编码同一边界**

新增并导出：

```ts
const websiteInputSchema = z.string().max(2_048).refine((value) => !controlCharacterPattern.test(value))
export const blogWebsiteUpdateRequestSchema = z
  .object({ id: blogIdSchema, websiteUrl: websiteInputSchema.nullable() })
  .strict()
export const blogLinkOpenRequestSchema = z
  .object({ id: blogIdSchema, kind: z.enum(["repository", "website"]) })
  .strict()
```

持久化记录 Schema 接受可选 `websiteUrl`；IPC 成功响应使用单独的显示记录 Schema：

```ts
const repositoryDisplaySchema = z
  .object({ display: z.string().min(1).max(2_048), url: z.url().max(2_048).optional() })
  .strip()
const websiteDisplaySchema = z.discriminatedUnion("source", [
  z.object({ source: z.enum(["manual", "quartz"]), url: z.url().max(2_048) }).strip(),
  z.object({ source: z.literal("unconfigured") }).strip(),
])
const blogDisplayRecordSchema = persistedBlogRecordSchema
  .omit({ websiteUrl: true })
  .extend({ repository: repositoryDisplaySchema, website: websiteDisplaySchema })
  .strip()
```

把博客列表和所有博客变更响应绑定到 `blogRegistryViewSchema`，新增打开链接的 `z.undefined()` 成功 Schema。

- [ ] **Step 5: 运行合同测试和类型检查**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc-schemas.test.ts
npm --prefix apps/publisher run typecheck
```

Expected: Schema 测试 PASS；类型检查会因主进程和测试 fixture 仍返回持久化状态而 FAIL，错误应集中在尚未迁移的博客服务与视图 fixture。

- [ ] **Step 6: 提交共享合同**

```powershell
git add -- apps/publisher/src/shared/contracts.ts apps/publisher/src/shared/ipcSchemas.ts apps/publisher/tests/unit/ipc-schemas.test.ts
git commit -m "feat: define blog address display contracts"
```

### Task 2: 用纯策略和适配器解析仓库与公开网站

**Files:**
- Create: `apps/publisher/src/main/services/blogAddresses.ts`
- Create: `apps/publisher/tests/unit/blogAddresses.test.ts`

- [ ] **Step 1: 写仓库远端解析失败测试**

创建测试并使用表格覆盖：

```ts
it.each([
  ["https://github.com/acme/garden.git", { display: "https://github.com/acme/garden.git", url: "https://github.com/acme/garden" }],
  ["git@github.com:acme/garden.git", { display: "git@github.com:acme/garden.git", url: "https://github.com/acme/garden" }],
  ["ssh://git@gitlab.com/acme/garden.git", { display: "ssh://git@gitlab.com/acme/garden.git", url: "https://gitlab.com/acme/garden" }],
  ["git@gitee.com:acme/garden.git", { display: "git@gitee.com:acme/garden.git", url: "https://gitee.com/acme/garden" }],
  ["git@git.internal:acme/garden.git", { display: "git@git.internal:acme/garden.git" }],
])("normalizes repository remote %s", (remote, expected) => {
  expect(parseRepositoryRemote(remote)).toEqual(expected)
})

it.each(["", "https://user:secret@example.com/repo.git", "https://example.com/repo\nsecret"])(
  "rejects unsafe repository remote %s",
  (remote) => expect(parseRepositoryRemote(remote)).toBeUndefined(),
)
```

- [ ] **Step 2: 写公开网站安全策略失败测试**

```ts
it.each([
  ["example.com/garden", "https://example.com/garden"],
  ["https://example.com/garden/", "https://example.com/garden/"],
])("normalizes public website %s", (input, expected) => {
  expect(normalizePublicWebsite(input)).toBe(expected)
})

it.each([
  "file:///C:/garden",
  "https://user:secret@example.com",
  "http://localhost:8080",
  "http://notes.localhost",
  "http://127.0.0.1",
  "http://10.0.0.4",
  "http://172.16.0.4",
  "http://192.168.1.4",
  "http://169.254.1.1",
  "http://[::1]",
  "http://[fc00::1]",
  "http://[fe80::1]",
])("rejects non-public website %s", (input) => {
  expect(normalizePublicWebsite(input)).toBeUndefined()
})
```

- [ ] **Step 3: 写显示视图和逐博客失败隔离测试**

通过注入 `runGit` 与 `readText`，验证手动覆盖优先于 Quartz、合法 `baseUrl` 自动补协议、`localhost:8080` 退化为未配置、一个博客读失败不影响其他博客，并且输出不包含 Git stderr：

```ts
const resolver = createBlogAddressResolver({
  runGit: async (workspace) =>
    workspace.endsWith("one")
      ? { exitCode: 0, stdout: "git@github.com:acme/one.git\n", stderr: "" }
      : { exitCode: 1, stdout: "", stderr: "token-shaped-secret" },
  readText: async (file) =>
    file.includes("one")
      ? "configuration:\n  baseUrl: quartz.example/one\n"
      : "configuration:\n  baseUrl: localhost:8080\n",
})
const view = await resolver.describe(state)
expect(view.blogs[0]).toMatchObject({
  repository: { url: "https://github.com/acme/one" },
  website: { source: "manual", url: "https://manual.example/" },
})
expect(view.blogs[1]).toMatchObject({
  repository: { display: "未配置仓库" },
  website: { source: "unconfigured" },
})
expect(JSON.stringify(view)).not.toContain("token-shaped-secret")
```

- [ ] **Step 4: 运行测试并确认模块不存在**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blogAddresses.test.ts
```

Expected: FAIL，报告无法导入 `blogAddresses.ts`。

- [ ] **Step 5: 实现独立地址解析服务**

服务公开以下窄接口：

```ts
export interface BlogAddressResolver {
  normalizeWebsite(input: string): string | undefined
  describe(state: BlogRegistryState): Promise<BlogRegistryView>
  resolveLink(state: BlogRegistryState, id: string, kind: BlogLinkOpenRequest["kind"]): Promise<string>
}

export class BlogAddressError extends Error {
  readonly name = "BlogAddressError"
  constructor(
    readonly code: "INVALID_WEBSITE" | "LINK_UNAVAILABLE",
    message: string,
  ) {
    super(message)
  }
}

export function createBlogAddressResolver(dependencies: {
  readonly runGit: (workspace: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  readonly readText: (file: string) => Promise<string>
}): BlogAddressResolver
```

实现时使用 `YAML.parse` 后只读取 `configuration.baseUrl`，将所有文件、Git 和 YAML 异常映射为未配置；限制 Git stdout 与配置字符串为 2,048 字节并拒绝控制字符。`resolveLink` 必须按 ID 找到当前记录并调用与 `describe` 相同的实时解析函数；没有可点击目标时抛出 `new BlogAddressError("LINK_UNAVAILABLE", "The requested blog link is unavailable.")`，不得包含原始 URL 或底层错误。

- [ ] **Step 6: 运行地址服务测试**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blogAddresses.test.ts
```

Expected: 全部 PASS，包括三家已知 Git 服务转换、未知 SSH 只显示、公开 URL 策略、Quartz 回退、错误隔离和敏感 stderr 不外泄。

- [ ] **Step 7: 提交地址解析服务**

```powershell
git add -- apps/publisher/src/main/services/blogAddresses.ts apps/publisher/tests/unit/blogAddresses.test.ts
git commit -m "feat: resolve blog repository and website addresses"
```

### Task 3: 原子持久化手动网站覆盖值并兼容旧注册表

**Files:**
- Modify: `apps/publisher/src/main/services/blogRegistry.ts:15-29,74-94,533-735`
- Modify: `apps/publisher/tests/unit/blogRegistry.test.ts`

- [ ] **Step 1: 写兼容、保存和清除失败测试**

```ts
it("loads old records without a website override and persists an optional override", async () => {
  const directory = await createDirectory("garden-blog-registry-website-")
  const file = join(directory, "blogs.v1.json")
  const workspace = await createWorkspace(directory, "garden")
  const registry = createRegistry(file, workspace)
  const original = await registry.load()

  expect(original.blogs[0]).not.toHaveProperty("websiteUrl")
  const saved = await registry.setWebsiteUrl(
    original.activeBlogId,
    "https://garden.example/notes/",
  )
  expect(saved.blogs[0]?.websiteUrl).toBe("https://garden.example/notes/")
  expect((await registry.load()).blogs[0]?.websiteUrl).toBe("https://garden.example/notes/")

  const cleared = await registry.setWebsiteUrl(original.activeBlogId, undefined)
  expect(cleared.blogs[0]).not.toHaveProperty("websiteUrl")
  expect((await registry.load()).blogs[0]).not.toHaveProperty("websiteUrl")
})
```

再复用现有失败注入文件系统，断言替换失败后重新加载仍保留旧 URL。

- [ ] **Step 2: 运行聚焦测试并确认方法不存在**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blogRegistry.test.ts -t "website override"
```

Expected: FAIL，报告 `setWebsiteUrl` 不存在。

- [ ] **Step 3: 扩展注册表状态和原子更新方法**

将注册表接口改为返回 `BlogRegistryState`，Schema 添加严格的可选规范化 URL：

```ts
const storedWebsiteUrlSchema = z.url().max(2_048)

const blogRecordSchema = z
  .object({
    id: identifierSchema,
    name: nameSchema,
    path: pathSchema,
    canonicalPath: pathSchema.refine(isAbsolute, "Canonical path must be absolute"),
    createdAt: timestampSchema,
    lastOpenedAt: timestampSchema,
    websiteUrl: storedWebsiteUrlSchema.optional(),
  })
  .strict()
```

新增方法并通过展开对象删除空值，而不是写入 `undefined`：

```ts
async setWebsiteUrl(id, websiteUrl) {
  return runExclusive(async (file) => {
    const state = await readState(file)
    const blog = await requireBlog(state, id)
    const next: BlogRegistryState = {
      ...state,
      blogs: state.blogs.map((candidate) => {
        if (candidate.id !== blog.id) return candidate
        const { websiteUrl: _old, ...withoutWebsite } = candidate
        return websiteUrl ? { ...withoutWebsite, websiteUrl } : withoutWebsite
      }),
    }
    await persist(file, next)
    return next
  })
}
```

URL 的公开性仍由地址服务验证；注册表只接受已经规范化的绝对 URL。

- [ ] **Step 4: 运行注册表测试**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blogRegistry.test.ts
```

Expected: 全部 PASS；旧记录无需迁移即可加载，保存与清除均持久化，写失败保持原状态。

- [ ] **Step 5: 提交注册表变更**

```powershell
git add -- apps/publisher/src/main/services/blogRegistry.ts apps/publisher/tests/unit/blogRegistry.test.ts
git commit -m "feat: persist blog website overrides"
```

### Task 4: 在管理适配器中生成视图并安全重新解析链接

**Files:**
- Modify: `apps/publisher/src/main/blogRuntime.ts:210-408`
- Modify: `apps/publisher/src/main/index.ts:257-325`
- Modify: `apps/publisher/tests/unit/blog-runtime.test.ts`

- [ ] **Step 1: 写管理适配器失败测试**

为测试依赖添加 `addresses.describe`、`addresses.normalizeWebsite`、`addresses.resolveLink` 和 `openExternal` mock，覆盖：

```ts
it("returns enriched views, persists normalized websites, and re-resolves links before opening", async () => {
  const listed = await adapter.services.list()
  expect(addresses.describe).toHaveBeenCalledWith(state)
  expect(listed.blogs[0]?.repository).toBeDefined()

  await adapter.services.updateWebsite({ id, websiteUrl: "garden.example" })
  expect(addresses.normalizeWebsite).toHaveBeenCalledWith("garden.example")
  expect(registry.setWebsiteUrl).toHaveBeenCalledWith(id, "https://garden.example/")
  expect(addresses.describe).toHaveBeenCalledWith(updatedState)

  await adapter.services.openLink({ id, kind: "website" })
  expect(registry.load).toHaveBeenCalled()
  expect(addresses.resolveLink).toHaveBeenCalledWith(currentState, id, "website")
  expect(openExternal).toHaveBeenCalledWith("https://garden.example/")
})
```

另测无效网站输入抛 `BlogAddressError("INVALID_WEBSITE", ...)` 前不写注册表，以及解析失败前不调用 `openExternal`。

- [ ] **Step 2: 运行聚焦测试并确认服务缺失**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blog-runtime.test.ts -t "enriched views|invalid website|re-resolves links"
```

Expected: FAIL，报告管理服务没有 `updateWebsite` / `openLink` 或缺少地址解析依赖。

- [ ] **Step 3: 扩展管理服务但保持主进程为信任边界**

为 `createBlogManagementAdapter` 注入：

```ts
readonly addresses: BlogAddressResolver
readonly openExternal: (url: string) => Promise<void>
```

所有返回注册表的操作通过本地帮助函数增强：

```ts
const view = (state: BlogRegistryState): Promise<BlogRegistryView> =>
  dependencies.addresses.describe(state)
```

实现新增操作：

```ts
async updateWebsite(request) {
  const websiteUrl =
    request.websiteUrl === null
      ? undefined
      : dependencies.addresses.normalizeWebsite(request.websiteUrl)
  if (request.websiteUrl !== null && !websiteUrl) {
    throw new BlogAddressError("INVALID_WEBSITE", "The website address is invalid.")
  }
  return view(await dependencies.registry.setWebsiteUrl(request.id, websiteUrl))
},
async openLink(request) {
  const current = await dependencies.registry.load()
  const url = await dependencies.addresses.resolveLink(current, request.id, request.kind)
  await dependencies.openExternal(url)
},
```

`list`、`addLocal`、`recoverLocal`、`rename`、`relocate` 和 `remove` 都在返回前调用 `view`；`list` 在增强视图上追加 `activeAvailability`。

- [ ] **Step 4: 在 Electron 启动处注入真实只读适配器**

在 `index.ts` 创建：

```ts
const blogAddresses = createBlogAddressResolver({
  runGit: (workspace) =>
    importRunner.run({ executable: "git", args: ["remote", "get-url", "origin"], cwd: workspace }),
  readText: (file) => readFile(file, "utf8"),
})
```

传给管理适配器，并将 `openExternal` 实现限定为：

```ts
openExternal: async (url) => {
  await shell.openExternal(url)
},
```

此函数只能收到地址解析器刚刚返回的 URL，不能加入接受渲染层 URL 的桥接方法。

- [ ] **Step 5: 运行管理适配器测试**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blog-runtime.test.ts
```

Expected: 全部 PASS；列表和变更响应均被增强，保存前规范化，打开前读取当前状态并重新解析。

- [ ] **Step 6: 提交主进程业务接线**

```powershell
git add -- apps/publisher/src/main/blogRuntime.ts apps/publisher/src/main/index.ts apps/publisher/tests/unit/blog-runtime.test.ts
git commit -m "feat: add secure blog address operations"
```

### Task 5: 将两个窄能力接入 IPC 与 preload

**Files:**
- Modify: `apps/publisher/src/main/ipc.ts:3-85,158-172,418-522,525-620`
- Modify: `apps/publisher/src/preload/gardenApi.ts:135-175`
- Modify: `apps/publisher/tests/unit/ipc.test.ts`

- [ ] **Step 1: 写主 IPC 和 preload 映射失败测试**

在现有博客通道表中加入：

```ts
[IPC_CHANNELS.requests.blogsUpdateWebsite, { id, websiteUrl: "https://garden.example/" }, "blogsUpdateWebsite"],
[IPC_CHANNELS.requests.blogsOpenLink, { id, kind: "website" }, "blogsOpenLink"],
```

并在 preload 测试中调用：

```ts
await api.blogs.updateWebsite({ id, websiteUrl: "https://garden.example/" })
await api.blogs.openLink({ id, kind: "repository" })
expect(ipc.invocations).toContainEqual([
  IPC_CHANNELS.requests.blogsOpenLink,
  { id, kind: "repository" },
])
```

在不可信发送者和 service unavailable 表中也加入两个通道，防止新增旁路。

- [ ] **Step 2: 运行聚焦 IPC 测试并确认通道未接线**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc.test.ts -t "blog|preload garden API"
```

Expected: FAIL，新增通道未注册，preload 方法不存在。

- [ ] **Step 3: 注册严格请求处理器**

扩展 `PublisherIpcServices.blogs`，并在 `blogRequestHandlers` 中加入：

```ts
[
  IPC_CHANNELS.requests.blogsUpdateWebsite,
  secureHandler(
    IPC_CHANNELS.requests.blogsUpdateWebsite,
    blogWebsiteUpdateRequestSchema,
    isTrustedSender,
    (request) => services.updateWebsite(request),
  ),
],
[
  IPC_CHANNELS.requests.blogsOpenLink,
  secureHandler(
    IPC_CHANNELS.requests.blogsOpenLink,
    blogLinkOpenRequestSchema,
    isTrustedSender,
    (request) => services.openLink(request),
  ),
],
```

把两项加入 unavailable handler 的有限白名单。在 `serializeFailure` 的博客通道分支中显式映射受信的错误类：

```ts
if (error instanceof BlogAddressError) {
  return error.code === "INVALID_WEBSITE"
    ? { ok: false, error: { code: "INVALID_INPUT", message: "The website address is invalid." } }
    : { ok: false, error: { code: "BLOG_LINK_UNAVAILABLE", message: "The requested blog link is unavailable." } }
}
```

不得依赖任意异常对象携带的可伪造 `code`。其他错误继续由现有 `serializeFailure` 生成固定安全消息；不得返回 Git stderr、配置文件内容或目标 URL。测试分别断言两种已知错误映射正确，而普通 `Error("secret")` 仍变成固定 `INTERNAL_ERROR`。

- [ ] **Step 4: 暴露窄 preload 方法**

在冻结的 `blogs` 对象中加入：

```ts
updateWebsite: (request: BlogWebsiteUpdateRequest) =>
  invoke<BlogRegistryView>(ipc, IPC_CHANNELS.requests.blogsUpdateWebsite, request),
openLink: (request: BlogLinkOpenRequest) =>
  invoke<void>(ipc, IPC_CHANNELS.requests.blogsOpenLink, request),
```

保持深冻结安全测试不变；不要暴露 `shell`、`openExternal(url)`、Git 或文件读取能力。

- [ ] **Step 5: 运行 IPC、preload 和安全测试**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/ipc.test.ts tests/unit/renderer-security.test.tsx
```

Expected: 全部 PASS；严格请求、不可信发送者、服务缺失、响应 Schema、精确通道映射和深冻结能力边界均通过。

- [ ] **Step 6: 提交 IPC 接线**

```powershell
git add -- apps/publisher/src/main/ipc.ts apps/publisher/src/preload/gardenApi.ts apps/publisher/tests/unit/ipc.test.ts
git commit -m "feat: expose safe blog address IPC actions"
```

### Task 6: 在切换器中显示三行地址并保持交互语义正确

**Files:**
- Create: `apps/publisher/src/renderer/src/components/BlogAddressRows.tsx`
- Modify: `apps/publisher/src/renderer/src/components/BlogSwitcher.tsx:5-176`
- Modify: `apps/publisher/tests/unit/blog-manager.test.tsx:8-202`

- [ ] **Step 1: 更新 fixture 并写三个位置中的前两个失败测试**

为测试博客增加：

```ts
repository: { display: "git@github.com:jin07-72/knowledge-garden.git", url: "https://github.com/jin07-72/knowledge-garden" },
website: { source: "manual", url: "https://jin07-72.github.io/knowledge-garden/" },
```

将切换器首个测试扩展为：

```tsx
expect(screen.getAllByText("仓库").length).toBeGreaterThanOrEqual(1)
expect(screen.getAllByText("网站").length).toBeGreaterThanOrEqual(1)
expect(screen.getAllByText("本地").length).toBeGreaterThanOrEqual(1)
await user.click(screen.getByRole("button", { name: "打开 Knowledge Garden 的仓库" }))
expect(onOpenLink).toHaveBeenCalledWith(registry.blogs[0]!.id, "repository")
await user.click(screen.getByRole("button", { name: "打开 Knowledge Garden 的网站" }))
expect(onOpenLink).toHaveBeenCalledWith(registry.blogs[0]!.id, "website")
expect(document.querySelector("button button, button a, a button")).toBeNull()
```

再测未知 SSH 仓库和未配置网站只显示文本，不渲染对应打开按钮。

- [ ] **Step 2: 运行切换器测试并确认新展示和回调缺失**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blog-manager.test.tsx -t "BlogSwitcher"
```

Expected: FAIL，`BlogSwitcher` 缺少 `onOpenLink`，三类标签和独立按钮不存在。

- [ ] **Step 3: 创建纯展示地址行组件**

```tsx
export function BlogAddressRows({
  blog,
  onOpenLink,
}: {
  readonly blog: BlogDisplayRecord
  readonly onOpenLink?: (kind: BlogLinkOpenRequest["kind"]) => void
}): React.JSX.Element {
  const website = blog.website.source === "unconfigured" ? "未配置网站" : blog.website.url
  return (
    <dl className="blog-address-rows">
      <div><dt>仓库</dt><dd title={blog.repository.display}>{blog.repository.display}</dd>{blog.repository.url && onOpenLink ? <button type="button" aria-label={`打开 ${blog.name} 的仓库`} onClick={() => onOpenLink("repository")}><ExternalLink size={13} aria-hidden="true" /></button> : null}</div>
      <div><dt>网站</dt><dd title={website}>{website}</dd>{blog.website.source !== "unconfigured" && onOpenLink ? <button type="button" aria-label={`打开 ${blog.name} 的网站`} onClick={() => onOpenLink("website")}><ExternalLink size={13} aria-hidden="true" /></button> : null}</div>
      <div><dt>本地</dt><dd title={blog.path}>{blog.path}</dd></div>
    </dl>
  )
}
```

按钮仅发送链接类型，不能把 `repository.url` 或 `website.url` 传给回调。

- [ ] **Step 4: 重构切换器避免交互控件嵌套**

增加属性：

```ts
readonly onOpenLink: (id: string, kind: BlogLinkOpenRequest["kind"]) => void
```

顶部摘要保留一个只负责展开菜单的触发按钮，地址按钮放在它的相邻容器中。展开列表的每项使用一个 `role="group"` 容器，内部的切换按钮继续使用 `role="menuitemradio"`，地址按钮使用独立 `role="menuitem"` 和单独的 `data-menu-index`。更新 roving focus 目标数组，使方向键按 DOM 中所有可用菜单动作循环，禁用或不存在的链接不进入索引。

- [ ] **Step 5: 运行切换器全部测试**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blog-manager.test.tsx -t "BlogSwitcher"
```

Expected: 全部 PASS；地址标签、打开意图、切换意图、Escape、外部点击、Home/End、循环方向键、Shift+Tab 和繁忙禁用行为均保持有效，DOM 中没有嵌套交互控件。

- [ ] **Step 6: 提交切换器界面**

```powershell
git add -- apps/publisher/src/renderer/src/components/BlogAddressRows.tsx apps/publisher/src/renderer/src/components/BlogSwitcher.tsx apps/publisher/tests/unit/blog-manager.test.tsx
git commit -m "feat: show blog addresses in the switcher"
```

### Task 7: 在管理页编辑网站并连接 App 动作

**Files:**
- Modify: `apps/publisher/src/renderer/src/components/BlogManager.tsx:29-47,58-200,399-537`
- Modify: `apps/publisher/src/renderer/src/App.tsx:900-1040,997-1015,1430-1469`
- Modify: `apps/publisher/tests/unit/blog-manager.test.tsx:204-514`
- Modify: `apps/publisher/tests/unit/main-layout.test.tsx:155-205,1794-1935`

- [ ] **Step 1: 写管理表单失败测试**

```tsx
it("shows all addresses and saves or clears a manual website override", async () => {
  const user = userEvent.setup()
  const onUpdateWebsite = vi.fn()
  render(<BlogManager {...props} onOpenLink={vi.fn()} onUpdateWebsite={onUpdateWebsite} />)

  expect(screen.getAllByText("仓库")).toHaveLength(registry.blogs.length)
  expect(screen.getAllByText("网站")).toHaveLength(registry.blogs.length)
  expect(screen.getAllByText("本地")).toHaveLength(registry.blogs.length)
  await user.click(screen.getByRole("button", { name: "编辑 Knowledge Garden 的网站地址" }))
  const input = screen.getByRole("textbox", { name: "网站地址" })
  expect(input).toHaveValue("https://jin07-72.github.io/knowledge-garden/")
  await user.clear(input)
  await user.type(input, "garden.example")
  await user.click(screen.getByRole("button", { name: "保存网站地址" }))
  expect(onUpdateWebsite).toHaveBeenCalledWith(registry.blogs[0]!.id, "garden.example")

  await user.click(screen.getByRole("button", { name: "编辑 Knowledge Garden 的网站地址" }))
  await user.clear(screen.getByRole("textbox", { name: "网站地址" }))
  await user.click(screen.getByRole("button", { name: "保存网站地址" }))
  expect(onUpdateWebsite).toHaveBeenLastCalledWith(registry.blogs[0]!.id, null)
})
```

增加测试：Quartz 来源显示“自动读取”；未配置项输入为空；`busy` 时保存、恢复自动读取、取消、打开链接和其他注册表变更按钮全部禁用；提交后父级仍忙时表单保持可见，直到新 registry 确认值才关闭。

- [ ] **Step 2: 写 App API 接线失败测试**

在 mock `garden.blogs` 添加方法，并断言：

```tsx
await user.click(screen.getByRole("button", { name: "打开 Knowledge Garden 的网站" }))
expect(garden.blogs.openLink).toHaveBeenCalledWith({ id: "study", kind: "website" })

await user.click(screen.getByRole("button", { name: "编辑 Knowledge Garden 的网站地址" }))
await user.clear(screen.getByRole("textbox", { name: "网站地址" }))
await user.type(screen.getByRole("textbox", { name: "网站地址" }), "https://garden.example/")
await user.click(screen.getByRole("button", { name: "保存网站地址" }))
expect(garden.blogs.updateWebsite).toHaveBeenCalledWith({
  id: "study",
  websiteUrl: "https://garden.example/",
})
```

让 mock 返回更新后的 `BlogRegistryView`，并断言三个界面位置显示新 URL；拒绝时断言安全错误出现在管理器中且输入未丢失。

- [ ] **Step 3: 运行聚焦 UI 测试并确认交互缺失**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blog-manager.test.tsx tests/unit/main-layout.test.tsx -t "website override|网站地址|打开 Knowledge Garden"
```

Expected: FAIL，管理页没有表单，App 未调用新增 API。

- [ ] **Step 4: 在管理页加入地址行和受控网站编辑状态**

为 `BlogManager` / `BlogList` 增加：

```ts
readonly onOpenLink: (id: string, kind: BlogLinkOpenRequest["kind"]) => void
readonly onUpdateWebsite: (id: string, websiteUrl: string | null) => void
```

组件状态使用：

```ts
const [editingWebsite, setEditingWebsite] = useState<string>()
const [websiteValue, setWebsiteValue] = useState("")
```

打开表单时，只有 `source === "manual"` 才把当前 URL 放入输入框；自动地址用 `<small>当前自动读取：…</small>` 单独说明。表单提交先计算 `const value = websiteValue.trim()`，再调用 `onUpdateWebsite(id, value || null)`，所以清空后点击“保存网站地址”即删除手动覆盖并恢复自动读取；也可以保留一个含义相同的“恢复自动读取”快捷按钮。所有按钮遵守 `busy`。保留输入直到传入的 registry 显示匹配结果或用户主动取消，失败时由父层错误提示且草稿不丢失。

- [ ] **Step 5: 在 App 中连接安全动作并复用现有忙碌/错误流程**

增加：

```ts
const openBlogLink = (id: string, kind: BlogLinkOpenRequest["kind"]): void => {
  void runBlogOperation(async () => {
    const result = await api.blogs.openLink({ id, kind })
    if (!result.ok) throw new Error(result.error.message)
  })
}

const updateBlogWebsite = (id: string, websiteUrl: string | null): void => {
  updateRegistry(() => api.blogs.updateWebsite({ id, websiteUrl }))
}
```

把两个回调同时传给 `BlogSwitcher`、常规 `BlogManager` 和恢复流程使用的 `BlogManager`。恢复界面可以只读显示地址，但必须传入安全的 no-op 禁用状态或相同打开动作，不能用类型断言绕过必填属性。

- [ ] **Step 6: 运行管理和 App 测试**

Run:

```powershell
npm --prefix apps/publisher run test:run -- tests/unit/blog-manager.test.tsx tests/unit/main-layout.test.tsx
```

Expected: 两个测试文件全部 PASS；三个位置显示一致，保存/清除请求正确，错误保留输入，更新响应刷新界面，打开动作只传 ID 与类型。

- [ ] **Step 7: 提交管理界面与 App 接线**

```powershell
git add -- apps/publisher/src/renderer/src/components/BlogManager.tsx apps/publisher/src/renderer/src/App.tsx apps/publisher/tests/unit/blog-manager.test.tsx apps/publisher/tests/unit/main-layout.test.tsx
git commit -m "feat: manage and open blog addresses"
```

### Task 8: 完成视觉布局、真实 DOM 回归和交付验证

**Files:**
- Modify: `apps/publisher/src/renderer/src/app.css:245-352,1313-1421,2195-2225`
- Modify: `apps/publisher/tests/e2e/app.spec.ts`
- Verify: all files listed in this plan

- [ ] **Step 1: 添加样式前的真实 DOM 断言**

在已有应用启动 E2E 测试中加入：

```ts
await expect(page.getByText("仓库", { exact: true }).first()).toBeVisible()
await expect(page.getByText("网站", { exact: true }).first()).toBeVisible()
await expect(page.getByText("本地", { exact: true }).first()).toBeVisible()
expect(await page.locator("button button, button a, a button").count()).toBe(0)
```

打开管理博客后再次断言三类标签可见，并把视口改为 `900x720` 后确认标签仍显示、地址值容器没有水平溢出对话框。

- [ ] **Step 2: 运行 E2E 并记录当前布局失败**

Run:

```powershell
npm --prefix apps/publisher run test:e2e -- tests/e2e/app.spec.ts
```

Expected: 功能断言通过或仅因地址布局/溢出断言失败；不得出现嵌套交互控件。

- [ ] **Step 3: 实现统一三行布局和响应式规则**

添加基础规则：

```css
.blog-address-rows {
  min-width: 0;
  display: grid;
  gap: 3px;
  margin: 0;
}

.blog-address-rows > div {
  min-width: 0;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.blog-address-rows dt {
  color: #8bd5ca;
  font-size: 10px;
}

.blog-address-rows dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #8d98a5;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

为地址图标按钮加入明确的 `:focus-visible`，顶部摘要使用相邻容器，菜单条目 group 不改变现有宽度；管理卡片允许地址区域占满一行。将旧的窄屏 `display: none` 路径规则删除，改为保留 `dt` 并只对 `dd` 省略；网站编辑表单在窄屏变为单列。

- [ ] **Step 4: 运行格式、聚焦测试和 E2E**

Run:

```powershell
npx prettier --check apps/publisher/src/shared/contracts.ts apps/publisher/src/shared/ipcSchemas.ts apps/publisher/src/main/services/blogAddresses.ts apps/publisher/src/main/services/blogRegistry.ts apps/publisher/src/main/blogRuntime.ts apps/publisher/src/main/index.ts apps/publisher/src/main/ipc.ts apps/publisher/src/preload/gardenApi.ts apps/publisher/src/renderer/src/components/BlogAddressRows.tsx apps/publisher/src/renderer/src/components/BlogSwitcher.tsx apps/publisher/src/renderer/src/components/BlogManager.tsx apps/publisher/src/renderer/src/App.tsx apps/publisher/src/renderer/src/app.css
npm --prefix apps/publisher run test:run -- tests/unit/blogAddresses.test.ts tests/unit/blogRegistry.test.ts tests/unit/blog-runtime.test.ts tests/unit/ipc-schemas.test.ts tests/unit/ipc.test.ts tests/unit/blog-manager.test.tsx tests/unit/main-layout.test.tsx tests/unit/renderer-security.test.tsx
npm --prefix apps/publisher run test:e2e -- tests/e2e/app.spec.ts
```

Expected: Prettier 和所有聚焦单元/E2E 测试 PASS；窄屏仍显示三个标签，地址不撑破容器，真实 DOM 无嵌套交互控件。

- [ ] **Step 5: 提交样式和 E2E 回归**

```powershell
git add -- apps/publisher/src/renderer/src/app.css apps/publisher/tests/e2e/app.spec.ts
git commit -m "test: verify blog address layout"
```

- [ ] **Step 6: 运行 Publisher 全量验证**

Run:

```powershell
git diff --check HEAD~8..HEAD
npm --prefix apps/publisher run test:run -- --maxWorkers=2
npm --prefix apps/publisher run typecheck
npm --prefix apps/publisher run build
npm --prefix apps/publisher run test:e2e
```

Expected: diff 检查无输出；全部单元和集成测试 PASS；TypeScript 无错误；main、preload、renderer 生产构建成功；完整 E2E PASS。

- [ ] **Step 7: 重新打包 Windows 安装程序并检查产物**

Run:

```powershell
npm --prefix apps/publisher run package:win
Get-ChildItem apps/publisher/dist -File | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,Length,LastWriteTime
```

Expected: `electron-builder` 成功生成新的 NSIS 安装程序；最新安装程序时间晚于本次构建且文件大小大于 0。安装动作不包含在此命令中，只有用户另行要求时才运行安装程序。

- [ ] **Step 8: 核对范围、提交历史和交付证据**

Run:

```powershell
git status --short
git log --oneline -8
git show --stat --oneline HEAD
```

Expected: 工作树干净；提交按合同、解析服务、注册表、主进程、IPC、切换器、管理界面、样式/E2E 的边界排列。最终报告必须列出实际观察到的测试、类型检查、构建、E2E、打包结果和各功能提交 SHA；没有运行的项目不得写成已通过。
