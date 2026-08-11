/** URL extraction from arbitrary text. */

const WEB_URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

export function extractWebUrls(text: string): string[] {
  const matches = text.replace(/&amp;/gi, "&").match(WEB_URL_PATTERN) ?? []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const match of matches) {
    const candidate = match.replace(/[),.;!?，。！？；：）】》」』"'']+$/u, "")
    try {
      const parsed = new URL(candidate)
      parsed.hash = ""
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !seen.has(parsed.href)) {
        seen.add(parsed.href)
        urls.push(parsed.href)
      }
    } catch {
      // 忽略分享文案中不完整的 URL。
    }
  }
  return urls
}

/** Normalise a raw URL string, returning null if it's not a valid http(s) link. */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}
