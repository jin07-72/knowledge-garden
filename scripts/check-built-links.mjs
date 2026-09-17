import { readdir, readFile, stat } from "node:fs/promises"
import { extname, isAbsolute, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { fromHtml } from "hast-util-from-html"

const ignoredSchemes = /^(?:https?:|mailto:|tel:|javascript:|data:)/i
const staticAssetExtensions = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".svg",
  ".txt",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
])

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isInside(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

async function htmlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const filePath = resolve(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await htmlFiles(filePath)))
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".html") {
      files.push(filePath)
    }
  }

  return files
}

function elementNodesFromHtml(html) {
  const tree = fromHtml(html)
  const elements = []

  function visit(node) {
    if (node.type === "element") elements.push(node)
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child)
    }
  }

  visit(tree)
  return elements
}

function rawAttributeValue(html, element, attributeName) {
  const start = element.position?.start?.offset
  const end = element.position?.end?.offset
  if (typeof start !== "number" || typeof end !== "number") return undefined

  const tag = html.slice(start, end)
  let index = 1
  while (index < tag.length && !/\s|\/?>/.test(tag[index])) index += 1

  while (index < tag.length) {
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    if (
      index >= tag.length ||
      tag[index] === ">" ||
      (tag[index] === "/" && tag[index + 1] === ">")
    ) {
      return undefined
    }

    const nameStart = index
    while (index < tag.length && !/\s|=|\/?>/.test(tag[index])) index += 1
    const name = tag.slice(nameStart, index)
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    if (tag[index] !== "=") {
      continue
    }

    index += 1
    while (index < tag.length && /\s/.test(tag[index])) index += 1
    const quote = tag[index] === '"' || tag[index] === "'" ? tag[index++] : undefined
    const valueStart = index
    if (quote) {
      while (index < tag.length && tag[index] !== quote) index += 1
    } else {
      while (index < tag.length && !/\s|>/.test(tag[index])) index += 1
    }

    if (name.toLowerCase() === attributeName) return tag.slice(valueStart, index)
    if (quote && index < tag.length) index += 1
  }
}

function hrefsFromHtml(html) {
  return elementNodesFromHtml(html)
    .filter((element) => element.tagName === "a" && typeof element.properties?.href === "string")
    .map((element) => ({
      href: element.properties.href,
      originalHref: rawAttributeValue(html, element, "href") ?? element.properties.href,
    }))
}

function idsFromHtml(html) {
  const ids = new Set()
  for (const element of elementNodesFromHtml(html)) {
    if (typeof element.properties?.id === "string") ids.add(element.properties.id)
  }

  return ids
}

async function isHtmlFile(filePath) {
  try {
    return (await stat(filePath)).isFile() && extname(filePath).toLowerCase() === ".html"
  } catch {
    return false
  }
}

async function resolveTarget(root, source, pathPart) {
  const decodedPath = decodeUrlPart(pathPart)
  const targetBase = decodedPath.startsWith("/")
    ? resolve(root, `.${decodedPath}`)
    : resolve(source, "..", decodedPath)

  if (!isInside(root, targetBase)) return undefined

  const candidates = [targetBase, `${targetBase}.html`, resolve(targetBase, "index.html")]
  for (const candidate of candidates) {
    if (isInside(root, candidate) && (await isHtmlFile(candidate))) return candidate
  }

  return undefined
}

function isStaticAsset(pathPart) {
  if (pathPart.endsWith("/")) return false
  const extension = extname(decodeUrlPart(pathPart)).toLowerCase()
  return staticAssetExtensions.has(extension)
}

function splitHref(href) {
  const hashIndex = href.indexOf("#")
  const beforeFragment = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const queryIndex = beforeFragment.indexOf("?")

  return {
    pathPart: queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex),
    fragment: hashIndex === -1 ? undefined : decodeUrlPart(href.slice(hashIndex + 1)),
  }
}

/**
 * Returns broken generated-page links as sorted, portable "source -> href" strings.
 */
export async function checkBuiltLinks(root) {
  const siteRoot = resolve(root)
  const files = (await htmlFiles(siteRoot)).sort()
  const htmlByFile = new Map(
    await Promise.all(files.map(async (filePath) => [filePath, await readFile(filePath, "utf8")])),
  )
  const idsByFile = new Map(
    [...htmlByFile].map(([filePath, html]) => [filePath, idsFromHtml(html)]),
  )
  const failures = new Set()

  for (const source of files) {
    const sourceName = relative(siteRoot, source).split(sep).join("/")

    for (const { href, originalHref } of hrefsFromHtml(htmlByFile.get(source))) {
      const trimmedHref = href.trim()
      if (trimmedHref === "" || ignoredSchemes.test(trimmedHref) || trimmedHref.startsWith("//")) {
        continue
      }

      const { pathPart, fragment } = splitHref(trimmedHref)
      const target = pathPart === "" ? source : await resolveTarget(siteRoot, source, pathPart)
      if (!target && isStaticAsset(pathPart)) continue
      if (
        !target ||
        (fragment !== undefined && fragment !== "" && !idsByFile.get(target)?.has(fragment))
      ) {
        failures.add(`${sourceName} -> ${originalHref}`)
      }
    }
  }

  return [...failures].sort()
}

async function main() {
  const failures = await checkBuiltLinks(resolve(process.cwd(), "public"))

  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exitCode = 1
  } else {
    console.log("Generated internal links are valid.")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
