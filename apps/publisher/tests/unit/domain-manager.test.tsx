import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DomainManager } from "../../src/renderer/src/components/DomainManager"
import type { DomainSummary, IpcResult } from "../../src/shared/contracts"
import { createGardenApi } from "../../src/preload/gardenApi"

const domains: readonly DomainSummary[] = [
  {
    slug: "technology",
    name: "技术",
    description: "记录工程实践与工具选择。",
    tags: ["工程", "前端"],
    order: 1,
    publicNotes: 2,
    privateNotes: 1,
  },
  {
    slug: "empty",
    name: "空领域",
    description: "",
    tags: [],
    order: 2,
    publicNotes: 0,
    privateNotes: 0,
  },
]

afterEach(() => cleanup())

describe("DomainManager", () => {
  it("wraps metadata content and constrains the form to the viewport", () => {
    const stylesheet = readFileSync(resolve(process.cwd(), "src/renderer/src/app.css"), "utf8")
    expect(stylesheet).toMatch(/\.domain-manager-card-heading p\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(stylesheet).toMatch(/\.domain-manager-tags\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(stylesheet).toMatch(
      /\.domain-manager-form\s*\{[^}]*overflow-y:\s*auto[^}]*max-height:\s*calc\(100vh - 78px\)/,
    )
  })

  it("shows metadata and visual-only placeholders in the domain list", () => {
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={vi.fn(async () => domains)}
      />,
    )

    const described = screen.getByRole("article", { name: "技术" })
    expect(within(described).getByText("记录工程实践与工具选择。")).toBeVisible()
    expect(within(described).getByText("工程")).toBeVisible()
    expect(within(described).getByText("前端")).toBeVisible()
    const empty = screen.getByRole("article", { name: "空领域" })
    expect(within(empty).getByText("未填写描述")).toBeVisible()
    expect(within(empty).getByText("无标签")).toBeVisible()
  })

  it("prefills metadata, normalizes tags, trims description, and restores edit focus", async () => {
    const user = userEvent.setup()
    const updated = {
      ...domains[0]!,
      description: "新的描述",
      tags: ["反思", "planning", "weekly"],
    }
    const onUpdateMetadata = vi.fn(async (_request: unknown) => [updated, domains[1]!] as const)
    function Harness(): React.JSX.Element {
      const [currentDomains, setCurrentDomains] = useState(domains)
      return (
        <DomainManager
          domains={currentDomains}
          onClose={vi.fn()}
          onCreate={vi.fn(async () => currentDomains)}
          onRename={vi.fn(async () => currentDomains)}
          onUpdateMetadata={async (request) => {
            const next = await onUpdateMetadata(request)
            setCurrentDomains(next)
            return next
          }}
          onRemove={vi.fn(async () => currentDomains)}
        />
      )
    }
    render(<Harness />)

    const edit = screen.getByRole("button", { name: "编辑 技术 的信息" })
    await user.click(edit)
    expect(screen.getByRole("dialog", { name: "编辑领域信息" })).toBeVisible()
    expect(screen.getByLabelText("描述（选填）")).toHaveValue("记录工程实践与工具选择。")
    expect(screen.getByLabelText("标签（选填）")).toHaveValue("工程, 前端")
    expect(screen.getAllByText("选填；留空不会写入占位值")).toHaveLength(2)

    await user.clear(screen.getByLabelText("描述（选填）"))
    await user.type(screen.getByLabelText("描述（选填）"), "  新的描述  ")
    await user.clear(screen.getByLabelText("标签（选填）"))
    await user.type(screen.getByLabelText("标签（选填）"), "反思， planning,反思 ,, weekly")
    await user.click(screen.getByRole("button", { name: "保存信息" }))

    await waitFor(() =>
      expect(onUpdateMetadata).toHaveBeenCalledWith({
        slug: "technology",
        description: "新的描述",
        tags: ["反思", "planning", "weekly"],
      }),
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "编辑 技术 的信息" })).toHaveFocus(),
    )
    expect(screen.getByText("新的描述")).toBeVisible()
  })

  it("submits empty metadata without placeholder values", async () => {
    const user = userEvent.setup()
    const onUpdateMetadata = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={onUpdateMetadata}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "编辑 空领域 的信息" }))
    await user.click(screen.getByRole("button", { name: "保存信息" }))
    expect(onUpdateMetadata).toHaveBeenCalledWith({ slug: "empty", description: "", tags: [] })
  })

  it.each([
    ["description", "描述不能超过 2000 个字符"],
    ["tag-length", "每个标签不能超过 128 个字符"],
    ["tag-count", "标签不能超过 100 个"],
  ] as const)("validates metadata %s limits", async (kind, message) => {
    const user = userEvent.setup()
    const onUpdateMetadata = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={onUpdateMetadata}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "编辑 空领域 的信息" }))
    if (kind === "description") {
      fireEvent.change(screen.getByLabelText("描述（选填）"), {
        target: { value: "字".repeat(2001) },
      })
    } else if (kind === "tag-length") {
      fireEvent.change(screen.getByLabelText("标签（选填）"), {
        target: { value: "a".repeat(129) },
      })
    } else {
      fireEvent.change(screen.getByLabelText("标签（选填）"), {
        target: { value: Array.from({ length: 101 }, (_, index) => `tag-${index}`).join(",") },
      })
    }
    await user.click(screen.getByRole("button", { name: "保存信息" }))
    expect(screen.getByRole("alert")).toHaveTextContent(message)
    expect(onUpdateMetadata).not.toHaveBeenCalled()
  })

  it("cancels metadata editing and restores focus without saving", async () => {
    const user = userEvent.setup()
    const onUpdateMetadata = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={onUpdateMetadata}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "编辑 技术 的信息" }))
    await user.clear(screen.getByLabelText("描述（选填）"))
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(onUpdateMetadata).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "编辑 技术 的信息" })).toHaveFocus()
  })

  it("disables metadata controls while pending and allows retry after rejection", async () => {
    const user = userEvent.setup()
    let reject!: (reason: unknown) => void
    const onUpdateMetadata = vi
      .fn<() => Promise<readonly DomainSummary[]>>()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail
          }),
      )
      .mockResolvedValueOnce(domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={onUpdateMetadata}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "编辑 空领域 的信息" }))
    await user.click(screen.getByRole("button", { name: "保存信息" }))
    expect(screen.getByRole("button", { name: "保存信息" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled()
    reject(new Error("更新失败"))
    expect(await screen.findByRole("alert")).toHaveTextContent("更新失败")
    expect(screen.getByRole("button", { name: "保存信息" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "保存信息" }))
    await waitFor(() => expect(onUpdateMetadata).toHaveBeenCalledTimes(2))
  })

  it.each([
    ["create", "DOMAIN_ALREADY_EXISTS", "A domain with that name or path already exists."],
    ["rename", "DOMAIN_ALREADY_EXISTS", "A domain with that name or path already exists."],
    ["remove", "DOMAIN_NOT_EMPTY", "This domain is not empty and cannot be removed."],
    [
      "rename",
      "DOMAIN_ROLLBACK_UNCERTAIN",
      "The domain operation could not be safely recovered. Review the workspace before retrying.",
    ],
  ] as const)(
    "keeps %s open and displays the public %s rejection",
    async (operation, code, message) => {
      const user = userEvent.setup()
      const invoke = vi.fn(async () => ({ ok: false, error: { code, message } }))
      const api = createGardenApi({ invoke, on: vi.fn(), removeListener: vi.fn() })
      const unwrap = async (
        response: Promise<IpcResult<readonly DomainSummary[]>>,
      ): Promise<readonly DomainSummary[]> => {
        const result = await response
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }
      render(
        <DomainManager
          domains={domains}
          onClose={vi.fn()}
          onCreate={(request) => unwrap(api.domains.create(request))}
          onRename={(request) => unwrap(api.domains.rename(request))}
          onUpdateMetadata={(request) => unwrap(api.domains.updateMetadata(request))}
          onRemove={(request) => unwrap(api.domains.remove(request))}
        />,
      )
      if (operation === "create") {
        await user.click(screen.getByRole("button", { name: "新建领域" }))
        await user.type(screen.getByLabelText("显示名称"), "新领域")
        await user.type(screen.getByLabelText("英文路径"), "new-domain")
        await user.click(screen.getByRole("button", { name: "创建领域" }))
      } else if (operation === "rename") {
        await user.click(
          within(screen.getByRole("article", { name: "空领域" })).getByRole("button", {
            name: "重命名",
          }),
        )
        await user.clear(screen.getByLabelText("显示名称"))
        await user.type(screen.getByLabelText("显示名称"), "技术")
        await user.click(screen.getByRole("button", { name: "保存名称" }))
      } else {
        await user.click(
          within(screen.getByRole("article", { name: "空领域" })).getByRole("button", {
            name: "删除",
          }),
        )
        await user.click(screen.getByRole("button", { name: "确认删除" }))
      }
      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled()
      expect(invoke).toHaveBeenCalledOnce()
      if (operation !== "remove") {
        expect(screen.getByLabelText("显示名称")).toHaveValue(
          operation === "create" ? "新领域" : "技术",
        )
      } else {
        expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled()
      }
    },
  )

  it("creates a domain with trimmed values and returned list", async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={vi.fn(async () => domains)}
      />,
    )

    await user.click(screen.getByRole("button", { name: "新建领域" }))
    await user.type(screen.getByLabelText("显示名称"), " 新领域 ")
    await user.type(screen.getByLabelText("英文路径"), "new-domain")
    await user.click(screen.getByRole("button", { name: "创建领域" }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ name: "新领域", slug: "new-domain" }),
    )
  })

  it("shows validation feedback without calling create", async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "新建领域" }))
    await user.click(screen.getByRole("button", { name: "创建领域" }))
    expect(screen.getByRole("alert")).toHaveTextContent("显示名称不能为空")
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("rejects an invalid slug without calling create", async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "新建领域" }))
    await user.type(screen.getByLabelText("显示名称"), "新领域")
    await user.type(screen.getByLabelText("英文路径"), "Content")
    await user.click(screen.getByRole("button", { name: "创建领域" }))
    expect(screen.getByRole("alert")).toHaveTextContent("只能使用小写")
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("renames without editing the immutable slug", async () => {
    const user = userEvent.setup()
    const onRename = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={onRename}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    const card = screen.getByRole("article", { name: "技术" })
    await user.click(within(card).getByRole("button", { name: "重命名" }))
    expect(screen.getByLabelText("英文路径")).toHaveAttribute("readonly")
    await user.clear(screen.getByLabelText("显示名称"))
    await user.type(screen.getByLabelText("显示名称"), "工程")
    await user.click(screen.getByRole("button", { name: "保存名称" }))
    await waitFor(() => expect(onRename).toHaveBeenCalledWith({ slug: "technology", name: "工程" }))
  })

  it("requires confirmation for an empty domain and disables non-empty delete", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn(async () => domains)
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => domains)}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={onRemove}
      />,
    )
    const nonEmpty = screen.getByRole("article", { name: "技术" })
    expect(within(nonEmpty).getByRole("button", { name: /删除/ })).toBeDisabled()
    const empty = screen.getByRole("article", { name: "空领域" })
    await user.click(
      within(screen.getByRole("article", { name: "空领域" })).getByRole("button", {
        name: /删除/,
      }),
    )
    expect(screen.getByText("确认删除领域？")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus()
    await user.click(screen.getByRole("button", { name: "取消" }))
    await waitFor(() =>
      expect(
        within(screen.getByRole("article", { name: "空领域" })).getByRole("button", {
          name: "重命名",
        }),
      ).toHaveFocus(),
    )
    await user.click(
      within(screen.getByRole("article", { name: "空领域" })).getByRole("button", {
        name: /删除/,
      }),
    )
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith({ slug: "empty" }))
  })

  it("focuses an existing dialog control after removing the focused domain", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onRemove = vi.fn(async (_request: { readonly slug: string }) => [domains[0]!])
    function Harness(): React.JSX.Element {
      const [currentDomains, setCurrentDomains] = useState(domains)
      return (
        <DomainManager
          domains={currentDomains}
          onClose={onClose}
          onCreate={vi.fn(async () => currentDomains)}
          onRename={vi.fn(async () => currentDomains)}
          onUpdateMetadata={vi.fn(async () => currentDomains)}
          onRemove={async (request) => {
            const next = await onRemove(request)
            setCurrentDomains(next)
            return next
          }}
        />
      )
    }
    render(<Harness />)
    await user.click(
      within(screen.getByRole("article", { name: "空领域" })).getByRole("button", { name: "删除" }),
    )
    await user.click(screen.getByRole("button", { name: "确认删除" }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith({ slug: "empty" }))
    await waitFor(() =>
      expect(
        within(screen.getByRole("article", { name: "技术" })).getByRole("button", {
          name: "重命名",
        }),
      ).toHaveFocus(),
    )
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes on Escape while idle and restores focus to the opener", async () => {
    const user = userEvent.setup()
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            管理领域
          </button>
          {open ? (
            <DomainManager
              domains={domains}
              onClose={() => setOpen(false)}
              onCreate={vi.fn(async () => domains)}
              onRename={vi.fn(async () => domains)}
              onUpdateMetadata={vi.fn(async () => domains)}
              onRemove={vi.fn(async () => domains)}
            />
          ) : null}
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole("button", { name: "管理领域" })
    await user.click(opener)
    screen.getByRole("button", { name: "关闭" }).focus()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it("keeps the form busy and shows a service failure", async () => {
    const user = userEvent.setup()
    let reject!: (reason: unknown) => void
    const onCreate = vi.fn(
      () =>
        new Promise<readonly DomainSummary[]>((_, fail) => {
          reject = fail
        }),
    )
    render(
      <DomainManager
        domains={domains}
        onClose={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn(async () => domains)}
        onUpdateMetadata={vi.fn(async () => domains)}
        onRemove={vi.fn(async () => domains)}
      />,
    )
    await user.click(screen.getByRole("button", { name: "新建领域" }))
    await user.type(screen.getByLabelText("显示名称"), "新领域")
    await user.type(screen.getByLabelText("英文路径"), "new-domain")
    await user.click(screen.getByRole("button", { name: "创建领域" }))
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled()
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    reject(new Error("领域服务暂不可用"))
    expect(await screen.findByRole("alert")).toHaveTextContent("领域服务暂不可用")
    expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled()
  })
})
