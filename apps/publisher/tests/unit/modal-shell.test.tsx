import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModalShell } from "../../src/renderer/src/components/ModalShell"

afterEach(() => cleanup())

describe("ModalShell", () => {
  it("moves Tab from a programmatically focused dialog to its first or last enabled control", () => {
    render(
      <ModalShell labelId="modal-shell-title" className="test-dialog" onClose={vi.fn()}>
        <h2 id="modal-shell-title">测试对话框</h2>
        <button type="button">第一个操作</button>
        <button type="button" disabled>禁用操作</button>
        <button type="button">最后一个操作</button>
      </ModalShell>,
    )
    const dialog = screen.getByRole("dialog")
    const first = screen.getByRole("button", { name: "第一个操作" })
    const last = screen.getByRole("button", { name: "最后一个操作" })

    dialog.focus()
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false)
    expect(first).toHaveFocus()

    dialog.focus()
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false)
    expect(last).toHaveFocus()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
