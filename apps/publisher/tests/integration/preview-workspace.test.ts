import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createPreviewWorkspace } from "../../src/main/services/previewWorkspace"

const execute = promisify(execFile)

describe("Quartz merged local preview", () => {
  it("builds public and private fixture notes without writing the repository public folder", async () => {
    const repository = resolve("../..")
    const source = resolve("tests/fixtures/garden")
    const preview = await createPreviewWorkspace(source)
    try {
      await execute(
        process.execPath,
        [
          resolve(repository, "quartz/bootstrap-cli.mjs"),
          "build",
          "--directory",
          preview.contentDirectory,
          "--output",
          preview.outputDirectory,
        ],
        { cwd: repository, timeout: 60_000, maxBuffer: 2_000_000 },
      )

      expect(
        await readFile(resolve(preview.outputDirectory, "technology/css-grid.html"), "utf8"),
      ).toContain("CSS Grid")
      expect(await readFile(resolve(preview.outputDirectory, "life/journal.html"), "utf8")).toContain(
        "Journal",
      )
    } finally {
      await preview.dispose()
    }
  }, 70_000)
})
