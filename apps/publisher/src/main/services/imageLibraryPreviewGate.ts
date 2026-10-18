let previewTail: Promise<void> = Promise.resolve()

export async function serializeImagePreview<T>(operation: () => Promise<T>): Promise<T> {
  let release!: () => void
  const predecessor = previewTail
  previewTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await predecessor
  try {
    return await operation()
  } finally {
    release()
  }
}
