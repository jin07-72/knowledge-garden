import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ImageLibrary } from "../../src/renderer/src/components/ImageLibrary"
import type {
  GardenApi,
  ImageLibraryItem,
  ImageLibraryPreview,
  ImageLibrarySelection,
  ImageLibraryView,
  IpcResult,
} from "../../src/shared/contracts"

const path = "content/life/daily.md"

const item = (name: string, overrides: Partial<ImageLibraryItem> = {}): ImageLibraryItem => ({
  name,
  sizeBytes: 1_536,
  width: 640,
  height: 480,
  contentHash: `hash-${name}`,
  thumbnailDataUrl: "data:image/png;base64,dGh1bWI=",
  markdown: `![${name.replace(/\.[^.]+$/, "")}](<../_assets/daily/${name}>)`,
  ...overrides,
})

const view = (...images: ImageLibraryItem[]): ImageLibraryView => ({ path, images })
const ok = <T,>(value: T): IpcResult<T> => ({ ok: true, value })
const rejected = <T,>(message: string): IpcResult<T> => ({
  ok: false,
  error: { code: "IMAGE_LIBRARY_FAILED", message },
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function api(overrides: Partial<GardenApi["images"]> = {}): GardenApi["images"] {
  const cancelled: ImageLibrarySelection = { cancelled: true, images: [], conflicts: [] }
  return {
    open: vi.fn(async () => ok(view())),
    select: vi.fn(async () => ok(cancelled)),
    commit: vi.fn(async () => ok(view())),
    preview: vi.fn(async ({ name }) => {
      const image = item(name)
      return ok({ ...image, dataUrl: "data:image/png;base64,ZnVsbA==" })
    }),
    delete: vi.fn(async () => ok(view())),
    copyMarkdown: vi.fn(async () => ok(undefined)),
    ...overrides,
  }
}

afterEach(() => cleanup())

describe("ImageLibrary", () => {
  it("loads an empty library and explains that adding never edits Markdown", async () => {
    const pending = deferred<IpcResult<ImageLibraryView>>()
    const images = api({ open: vi.fn(() => pending.promise) })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)

    expect(screen.getByRole("status")).toHaveTextContent("正在加载图片库")
    pending.resolve(ok(view()))
    expect(await screen.findByText("暂无图片")).toBeVisible()
    expect(screen.getByText("不会修改当前 Markdown 笔记")).toBeVisible()
    expect(screen.getByRole("button", { name: "添加图片" })).toBeEnabled()
  })

  it("renders gallery cards in natural filename order", async () => {
    const images = api({
      open: vi.fn(async () => ok(view(item("figure-10.png"), item("figure-2.png")))),
    })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)
    const cards = await screen.findAllByRole("button", { name: /预览 figure-/ })
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "预览 figure-2.png",
      "预览 figure-10.png",
    ])
  })

  it("previews a selection, removes a candidate, and commits the remainder", async () => {
    const user = userEvent.setup()
    const selection: ImageLibrarySelection = {
      cancelled: false,
      selectionId: "selection-1",
      images: [{ ...item("one.png"), conflict: false }, { ...item("two.png"), conflict: false }],
      conflicts: [],
    }
    const commit = vi.fn(async () => ok(view(item("two.png"))))
    const images = api({ select: vi.fn(async () => ok(selection)), commit })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)
    await screen.findByText("暂无图片")

    await user.click(screen.getByRole("button", { name: "添加图片" }))
    const dialog = await screen.findByRole("dialog", { name: "确认添加图片" })
    expect(within(dialog).getByText("不会修改当前 Markdown 笔记")).toBeVisible()
    await user.click(within(dialog).getByRole("button", { name: "移除 one.png" }))
    expect(within(dialog).queryByText("one.png")).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "确认添加 1 张图片" }))

    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith({
        path,
        selectionId: "selection-1",
        include: ["two.png"],
        overwrite: [],
      }),
    )
    expect(await screen.findByRole("button", { name: "预览 two.png" })).toBeVisible()
  })

  it("summarizes all conflicts and requires explicit overwrite approval", async () => {
    const user = userEvent.setup()
    const selection: ImageLibrarySelection = {
      cancelled: false,
      selectionId: "selection-2",
      images: [{ ...item("one.png"), conflict: true }, { ...item("two.png"), conflict: true }],
      conflicts: ["one.png", "two.png"],
    }
    const commit = vi.fn(async () => ok(view(item("one.png"), item("two.png"))))
    const images = api({ select: vi.fn(async () => ok(selection)), commit })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)
    await screen.findByText("暂无图片")
    await user.click(screen.getByRole("button", { name: "添加图片" }))
    await user.click(await screen.findByRole("button", { name: "继续" }))

    expect(screen.getByRole("heading", { name: "确认覆盖同名图片" })).toBeVisible()
    expect(screen.getByText("one.png")).toBeVisible()
    expect(screen.getByText("two.png")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "返回修改选择" }))
    expect(screen.getByRole("heading", { name: "确认添加图片" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "继续" }))
    await user.click(screen.getByRole("button", { name: "覆盖并继续" }))
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith({
        path,
        selectionId: "selection-2",
        include: ["one.png", "two.png"],
        overwrite: ["one.png", "two.png"],
      }),
    )
  })

  it("shows full preview metadata and copy success or failure feedback", async () => {
    const user = userEvent.setup()
    const photo = item("旅行照.png", { sizeBytes: 1_536, width: 1920, height: 1080 })
    const preview: ImageLibraryPreview = {
      ...photo,
      dataUrl: "data:image/png;base64,ZnVsbA==",
    }
    const copyMarkdown = vi
      .fn()
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(rejected<void>("剪贴板暂不可用"))
    const images = api({
      open: vi.fn(async () => ok(view(photo))),
      preview: vi.fn(async () => ok(preview)),
      copyMarkdown,
    })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)
    await user.click(await screen.findByRole("button", { name: "预览 旅行照.png" }))

    expect(await screen.findByRole("heading", { name: "旅行照.png" })).toBeVisible()
    expect(screen.getByText("1920 × 1080 像素")).toBeVisible()
    expect(screen.getByText("1.5 KB")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "复制 Markdown 链接" }))
    expect(await screen.findByRole("status")).toHaveTextContent("已复制 Markdown 链接")
    expect(copyMarkdown).toHaveBeenLastCalledWith({
      path,
      name: "旅行照.png",
      expectedContentHash: "hash-旅行照.png",
    })
    await user.click(screen.getByRole("button", { name: "复制 Markdown 链接" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("剪贴板暂不可用")
  })

  it("cancels or confirms permanent deletion and refreshes the gallery", async () => {
    const user = userEvent.setup()
    const photo = item("old.png")
    const remove = vi.fn(async () => ok(view()))
    const images = api({ open: vi.fn(async () => ok(view(photo))), delete: remove })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)
    await user.click(await screen.findByRole("button", { name: "预览 old.png" }))
    await screen.findByRole("heading", { name: "old.png" })
    await user.click(screen.getByRole("button", { name: "删除图片" }))
    expect(screen.getByText("永久删除、无法恢复")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "取消删除" }))
    expect(screen.getByRole("heading", { name: "old.png" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "删除图片" }))
    await user.click(screen.getByRole("button", { name: "永久删除 old.png" }))

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({
        path,
        name: "old.png",
        expectedContentHash: "hash-old.png",
      }),
    )
    expect(await screen.findByText("暂无图片")).toBeVisible()
  })

  it("shows request rejections in Chinese and retries the current gallery view", async () => {
    const user = userEvent.setup()
    const open = vi
      .fn()
      .mockResolvedValueOnce(rejected<ImageLibraryView>("图片库暂时无法读取"))
      .mockResolvedValueOnce(ok(view()))
    const images = api({ open })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)

    expect(await screen.findByRole("alert")).toHaveTextContent("图片库暂时无法读取")
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText("暂无图片")).toBeVisible()
    expect(open).toHaveBeenCalledTimes(2)
  })

  it("handles rejected promises and allows retrying selection without leaving the gallery", async () => {
    const user = userEvent.setup()
    const select = vi
      .fn()
      .mockRejectedValueOnce(new Error("选择器意外关闭"))
      .mockResolvedValueOnce(ok<ImageLibrarySelection>({ cancelled: true, images: [], conflicts: [] }))
    const images = api({ select })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />)
    await screen.findByText("暂无图片")
    await user.click(screen.getByRole("button", { name: "添加图片" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("选择器意外关闭")
    await user.click(screen.getByRole("button", { name: "添加图片" }))
    await waitFor(() => expect(select).toHaveBeenCalledTimes(2))
    expect(screen.getByText("暂无图片")).toBeVisible()
  })

  it("ignores stale open results after a path change", async () => {
    const oldRequest = deferred<IpcResult<ImageLibraryView>>()
    const open = vi.fn(({ path: requestedPath }: { path: string }) =>
      requestedPath === path
        ? oldRequest.promise
        : Promise.resolve(ok({ path: requestedPath, images: [item("new.png")] })),
    )
    const images = api({ open })
    const rendered = render(
      <ImageLibrary path={path} title="Daily" api={images} onClose={vi.fn()} />,
    )
    rendered.rerender(
      <ImageLibrary path="private/life/secret.md" title="Secret" api={images} onClose={vi.fn()} />,
    )
    expect(await screen.findByRole("button", { name: "预览 new.png" })).toBeVisible()
    oldRequest.resolve(ok(view(item("old.png"))))
    await waitFor(() => expect(screen.queryByText("old.png")).not.toBeInTheDocument())
    expect(screen.getByRole("heading", { name: /Secret 图片库/ })).toBeVisible()
  })

  it("ignores a late selection result after the modal is closed", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const pendingSelection = deferred<IpcResult<ImageLibrarySelection>>()
    const images = api({ select: vi.fn(() => pendingSelection.promise) })
    render(<ImageLibrary path={path} title="Daily" api={images} onClose={onClose} />)
    await screen.findByText("暂无图片")
    await user.click(screen.getByRole("button", { name: "添加图片" }))
    await user.click(screen.getByRole("button", { name: "关闭图片库" }))
    expect(onClose).toHaveBeenCalledOnce()
    pendingSelection.resolve(ok({
      cancelled: false,
      selectionId: "late-selection",
      images: [{ ...item("late.png"), conflict: false }],
      conflicts: [],
    }))
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "确认添加图片" })).not.toBeInTheDocument(),
    )
  })

  it("invalidates pending work on close and prevents double commits", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const selection: ImageLibrarySelection = {
      cancelled: false,
      selectionId: "selection-3",
      images: [{ ...item("one.png"), conflict: false }],
      conflicts: [],
    }
    const pendingCommit = deferred<IpcResult<ImageLibraryView>>()
    const commit = vi.fn(() => pendingCommit.promise)
    const images = api({ select: vi.fn(async () => ok(selection)), commit })
    const rendered = render(
      <ImageLibrary path={path} title="Daily" api={images} onClose={onClose} />,
    )
    await screen.findByText("暂无图片")
    await user.click(screen.getByRole("button", { name: "添加图片" }))
    const confirm = await screen.findByRole("button", { name: "确认添加 1 张图片" })
    await user.dblClick(confirm)
    expect(commit).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "关闭图片库" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(onClose).not.toHaveBeenCalled()
    rendered.unmount()
    pendingCommit.resolve(ok(view(item("one.png"))))
    await Promise.resolve()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes with Escape while idle and exposes one labelled modal", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImageLibrary path={path} title="Daily" api={api()} onClose={onClose} />)
    await screen.findByText("暂无图片")
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByRole("dialog", { name: "Daily 图片库" })).toBeVisible()
    expect(screen.getByRole("button", { name: "关闭图片库" })).toHaveFocus()
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })
})
