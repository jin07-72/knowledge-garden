const repositoryFormatError = "GITHUB_REPOSITORY must use owner/repository format"

export function pagesBaseUrl(repositorySlug) {
  const segments = repositorySlug.split("/")
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    throw new Error(repositoryFormatError)
  }

  const [owner, repository] = segments
  const host = `${owner}.github.io`
  return repository.toLowerCase() === host.toLowerCase() ? host : `${host}/${repository}`
}
