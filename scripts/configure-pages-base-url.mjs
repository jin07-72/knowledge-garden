import { readFile, writeFile } from "node:fs/promises"

import { parse, stringify } from "yaml"

import { pagesBaseUrl } from "./pages-base-url.mjs"

const repositorySlug = process.env.GITHUB_REPOSITORY
if (!repositorySlug) {
  throw new Error("GITHUB_REPOSITORY is required")
}

const configPath = new URL("../quartz.config.yaml", import.meta.url)
const configuration = parse(await readFile(configPath, "utf8"))
configuration.configuration.baseUrl = pagesBaseUrl(repositorySlug)
await writeFile(configPath, stringify(configuration), "utf8")

console.log(`Configured baseUrl: ${configuration.configuration.baseUrl}`)
