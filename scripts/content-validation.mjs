import { parse } from "yaml"

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}

function getFrontmatter(source) {
  const match = source.match(/^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/)
  return match ? (match[1] ?? "") : undefined
}

export function isPrivatePath(filePath) {
  return filePath.replaceAll("\\", "/").startsWith("private/")
}

export function validateNote(filePath, source) {
  const frontmatter = getFrontmatter(source)

  if (frontmatter === undefined) {
    return [`${filePath}: missing frontmatter`]
  }

  let data
  try {
    data = parse(frontmatter)
  } catch {
    return [`${filePath}: invalid YAML frontmatter`]
  }

  const errors = []
  for (const field of ["title", "date", "description"]) {
    if (!hasText(data?.[field])) {
      errors.push(`${filePath}: ${field} must be non-empty`)
    }
  }

  if (!Array.isArray(data?.tags) || data.tags.length === 0) {
    errors.push(`${filePath}: tags must be a non-empty array`)
  }

  return errors
}
