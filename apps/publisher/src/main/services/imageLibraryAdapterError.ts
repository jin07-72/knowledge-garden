export type ImageAdapterErrorCode = "IMAGE_LIBRARY_INVALID" | "IMAGE_LIBRARY_TOO_LARGE"

const SAFE_ADAPTER_ERRORS: Readonly<Record<ImageAdapterErrorCode, string>> = {
  IMAGE_LIBRARY_INVALID: "The image is invalid.",
  IMAGE_LIBRARY_TOO_LARGE: "The image dimensions are too large.",
}

function ownString(value: object, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined
}

/**
 * Accepts only the two exact, path-free errors emitted by the native image adapter.
 * All other adapter failures are treated as untrusted implementation failures.
 */
export function imageAdapterErrorCode(value: unknown): ImageAdapterErrorCode | undefined {
  if (typeof value !== "object" || value === null) return undefined
  try {
    const code = ownString(value, "code")
    if (code !== "IMAGE_LIBRARY_INVALID" && code !== "IMAGE_LIBRARY_TOO_LARGE") return undefined
    return ownString(value, "message") === SAFE_ADAPTER_ERRORS[code] ? code : undefined
  } catch {
    return undefined
  }
}
