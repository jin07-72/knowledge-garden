import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { validateNote } from "./content-validation.mjs"

async function findMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return findMarkdownFiles(entryPath)
      }

      return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : []
    }),
  )

  return files.flat()
}

const contentDirectory = path.join(process.cwd(), "content")
const files = await findMarkdownFiles(contentDirectory)
const errors = (
  await Promise.all(
    files.map(async (filePath) => {
      const source = await readFile(filePath, "utf8")
      return validateNote(path.relative(process.cwd(), filePath).replaceAll("\\", "/"), source)
    }),
  )
).flat()

if (errors.length > 0) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else {
  console.log(`Validated ${files.length} Markdown files.`)
}
