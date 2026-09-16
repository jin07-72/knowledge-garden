import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { parseDocument } from "yaml"

import { pagesBaseUrl } from "./pages-base-url.mjs"

export function updatePagesBaseUrl(source, repositorySlug) {
  const document = parseDocument(source)
  document.setIn(["configuration", "baseUrl"], pagesBaseUrl(repositorySlug))
  return document.toString()
}

async function main() {
  const repositorySlug = process.env.GITHUB_REPOSITORY
  if (!repositorySlug) {
    throw new Error("GITHUB_REPOSITORY is required")
  }

  const configPath = new URL("../quartz.config.yaml", import.meta.url)
  const source = await readFile(configPath, "utf8")
  const baseUrl = pagesBaseUrl(repositorySlug)
  await writeFile(configPath, updatePagesBaseUrl(source, repositorySlug), "utf8")

  console.log(`Configured baseUrl: ${baseUrl}`)
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  await main()
}
