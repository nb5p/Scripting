// Common utilities shared by index.tsx and intent.tsx.
// Contains i18n helper, Douyin parsing, and download logic.

import { fetch, Path } from "scripting"

// iPhone User-Agent used for all Douyin requests.
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1"

// Regex matching Douyin share URLs across known domains.
export const DOUYIN_URL_REGEX =
  /https?:\/\/(?:v\.douyin\.com|www\.iesdouyin\.com|www\.douyin\.com)\/[^\s<>"{}|\\^`\[\]]+/

// Parsed Douyin video info.
export interface ParseResult {
  videoId: string
  title: string
  downloadUrl: string
  shareUrl: string
  type: "video" | "images"
}

// Extract the first Douyin URL from arbitrary text.
export function extractFirstUrl(text: string): string | null {
  const match = text.match(DOUYIN_URL_REGEX)
  return match ? match[0] : null
}

// Sanitize a video title for use as a file name.
// Long titles are shortened to a topic tag or a short id-based fallback.
export function sanitizeTitle(title: string, videoId: string): string {
  let clean = title.replace(/[\\/:*?"<>|]/g, "_")
  if (clean.length > 30) {
    const topics = clean.match(/#(\w+)/g)
    if (topics && topics.length > 0) {
      clean = topics[0].replace("#", "")
    } else {
      const vidShort = videoId.length >= 4 ? videoId.slice(-4) : videoId
      clean = "dy_" + vidShort
    }
  }
  return clean
}

// Parse the video id from the final redirect URL path.
export function parseVideoIdFromFinalUrl(finalUrl: string): string {
  const path = finalUrl.split("?")[0]
  const parts = path.split("/").filter((p) => p.length > 0)
  if (parts.length === 0) {
    throw new Error("Unexpected redirect URL path: " + finalUrl)
  }
  let last = parts[parts.length - 1]
  if ((last === "video" || last === "note") && parts.length >= 2) {
    last = parts[parts.length - 2]
  }
  return last
}

// Extract the window._ROUTER_DATA JSON object from the share page HTML.
export function extractRouterDataJson(html: string): any {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s)
  if (!match || !match[1]) {
    throw new Error("Failed to parse video info from HTML (window._ROUTER_DATA not found)")
  }
  const raw = match[1].trim().replace(/;+$/, "")
  try {
    return JSON.parse(raw)
  } catch (e: any) {
    throw new Error("Failed to parse JSON: " + e.message)
  }
}

// Locate the videoInfoRes object inside the router data.
export function pickVideoInfoRes(routerData: any): any {
  const loaderData = routerData?.loaderData
  if (!loaderData || typeof loaderData !== "object") {
    throw new Error("Invalid window._ROUTER_DATA structure (missing loaderData)")
  }

  for (const key of ["video_(id)/page", "note_(id)/page"]) {
    if (loaderData[key]?.videoInfoRes) {
      return loaderData[key].videoInfoRes
    }
  }

  for (const v of Object.values(loaderData)) {
    if (v && typeof v === "object" && (v as any).videoInfoRes) {
      return (v as any).videoInfoRes
    }
  }

  throw new Error("Unable to locate videoInfoRes in loaderData")
}

// Parse a Douyin share text and return the video info.
export async function parseDouyinShareText(shareText: string): Promise<ParseResult> {
  const shareUrl = extractFirstUrl(shareText)
  if (!shareUrl) {
    throw new Error("No valid share link found")
  }

  const resp1 = await fetch(shareUrl, {
    headers: { "User-Agent": IPHONE_UA },
    timeout: 30,
    allowInsecureRequest: true,
  })
  if (!resp1.ok) {
    throw new Error("Failed to access share link: HTTP " + resp1.status)
  }

  const finalUrl = resp1.url
  const videoId = parseVideoIdFromFinalUrl(finalUrl)

  const pageUrl = "https://www.iesdouyin.com/share/video/" + videoId
  const resp2 = await fetch(pageUrl, {
    headers: { "User-Agent": IPHONE_UA },
    timeout: 30,
    allowInsecureRequest: true,
  })
  if (!resp2.ok) {
    throw new Error("Failed to access share page: HTTP " + resp2.status)
  }

  const html = await resp2.text()
  const routerData = extractRouterDataJson(html)
  const videoInfoRes = pickVideoInfoRes(routerData)

  const itemList = videoInfoRes?.item_list
  if (!itemList || itemList.length === 0) {
    throw new Error("Unable to read video data")
  }

  const item = itemList[0]
  const urlList: string[] = item?.video?.play_addr?.url_list
  if (!urlList || urlList.length === 0) {
    throw new Error("Unable to read play address")
  }

  const rawPlayUrl = urlList[0]
  const desc = (item?.desc || "").trim() || ("douyin_" + videoId)
  const title = sanitizeTitle(desc, videoId)

  // Douyin watermark URLs usually contain "playwm"; replacing it with "play" returns the clean video URL.
  const downloadUrl = rawPlayUrl.replace("playwm", "play")

  return {
    videoId,
    title,
    downloadUrl,
    shareUrl,
    type: "video",
  }
}

// Build a file path inside the Documents directory using Path.join to avoid duplicate separators.
export function buildDocumentsPath(fileName: string): string {
  return Path.join(FileManager.documentsDirectory, fileName)
}

// Download a video to the given output path, creating the parent directory if needed.
export async function downloadVideo(url: string, outputPath: string): Promise<string> {
  const dir = Path.dirname(outputPath)
  if (dir && dir !== ".") {
    FileManager.createDirectorySync(dir, true)
  }

  const resp = await fetch(url, {
    headers: {
      "User-Agent": IPHONE_UA,
      Referer: "https://www.douyin.com/",
    },
    timeout: 120,
    allowInsecureRequest: true,
  })

  if (!resp.ok) {
    throw new Error("Download failed: HTTP " + resp.status)
  }

  const data = await resp.data()
  FileManager.writeAsDataSync(outputPath, data)

  return outputPath
}