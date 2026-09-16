import { readdir, readFile, stat } from "node:fs/promises"
import { extname, isAbsolute, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const ignoredSchemes = /^(?:https?:|mailto:|tel:|javascript:|data:)/i
const hrefAttribute = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
const idAttribute = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi

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

function hrefsFromHtml(html) {
  const hrefs = []
  const anchorTags = html.match(/<a\b[^>]*>/gi) ?? []

  for (const anchorTag of anchorTags) {
    hrefAttribute.lastIndex = 0
    const match = hrefAttribute.exec(anchorTag)
    if (match) hrefs.push(match[1] ?? match[2] ?? match[3] ?? "")
  }

  return hrefs
}

function idsFromHtml(html) {
  const ids = new Set()
  idAttribute.lastIndex = 0

  for (let match = idAttribute.exec(html); match; match = idAttribute.exec(html)) {
    ids.add(match[1] ?? match[2] ?? match[3] ?? "")
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
  const extension = extname(decodeUrlPart(pathPart)).toLowerCase()
  return extension !== "" && extension !== ".html" && extension !== ".htm"
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

    for (const href of hrefsFromHtml(htmlByFile.get(source))) {
      const trimmedHref = href.trim()
      if (trimmedHref === "" || ignoredSchemes.test(trimmedHref) || trimmedHref.startsWith("//")) {
        continue
      }

      const { pathPart, fragment } = splitHref(trimmedHref)
      if (isStaticAsset(pathPart)) continue

      const target = pathPart === "" ? source : await resolveTarget(siteRoot, source, pathPart)
      if (
        !target ||
        (fragment !== undefined && fragment !== "" && !idsByFile.get(target)?.has(fragment))
      ) {
        failures.add(`${sourceName} -> ${href}`)
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
