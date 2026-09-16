const repositoryFormatError = "GITHUB_REPOSITORY must use owner/repository format"

export function pagesBaseUrl(repositorySlug) {
  if (typeof repositorySlug !== "string") {
    throw new Error(repositoryFormatError)
  }

  const segments = repositorySlug.split("/")
  if (
    segments.length !== 2 ||
    segments.some((segment) => segment.length === 0 || segment.trim() !== segment)
  ) {
    throw new Error(repositoryFormatError)
  }

  const [owner, repository] = segments
  const host = `${owner}.github.io`
  return repository.toLowerCase() === host.toLowerCase() ? host : `${host}/${repository}`
}
