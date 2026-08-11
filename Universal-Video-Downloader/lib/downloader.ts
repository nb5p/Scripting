import { Path } from "scripting"
import { loadQuickDownloadScript } from "./python-loader"

const RESULT_MARKER = "__YTDLP_RESULT__="
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/i
const MERGE_JOBS_FOLDER = ".native-merge-jobs"

/** Sentinel string shared between the TypeScript and Python sides for cancel signalling. */
export const USER_CANCELLED = "__USER_CANCELLED__"

export interface MediaInfo {
  title: string
  mediaId: string
  site: string
  uploader: string
  duration: number | null
  webpageUrl: string
  thumbnail: string | null
  extension: string | null
  nativeMergeAvailable: boolean
  nativeVideoHeight: number | null
}

export interface DownloadResult extends MediaInfo {
  filePath: string
  fileSize: number
  downloadMode: "compatible" | "ffmpeg" | "nativeMerge"
}

export interface QuickDownloadProgress {
  stage: "media" | "video" | "audio" | "validating" | "mergingFfmpeg" | "mergingNative" | "publishing"
  percent: number | null
  bytes: number
  total: number | null
  speed: number | null
  eta: number | null
  message: string
}

export type QuickDownloadProgressHandler = (
  progress: QuickDownloadProgress,
) => void | Promise<void>

type SeparateFile = {
  filePath: string
  fileSize: number
  formatId: string
  extension: string
  vcodec: string
  acodec: string
  width: number | null
  height: number | null
  fps: number | null
}

type PythonPayload = {
  ok: boolean
  error?: string
  title?: string
  mediaId?: string
  site?: string
  uploader?: string
  duration?: number | null
  webpageUrl?: string
  thumbnail?: string | null
  extension?: string | null
  nativeMergeAvailable?: boolean
  nativeVideoHeight?: number | null
  filePath?: string
  fileSize?: number
  jobDir?: string
  video?: SeparateFile
  audio?: SeparateFile
}

let _quickRunnerCache: string | null = null

function getQuickRunner(): string {
  if (_quickRunnerCache !== null) return _quickRunnerCache
  _quickRunnerCache = loadQuickDownloadScript()
  return _quickRunnerCache
}

export function extractFirstWebUrl(text: string): string | null {
  const match = text.match(URL_REGEX)
  if (!match) return null

  const candidate = match[0]
    .replace(/&amp;/g, "&")
    .replace(/[\s，。！？、；：,.!?;:'"')\]}＞>]+$/g, "")

  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

export function downloadsDirectory(): string {
  return Path.join(FileManager.documentsDirectory, "Video Downloads")
}

export function createCancelTokenPath(): string {
  FileManager.createDirectorySync(downloadsDirectory(), true)
  return Path.join(
    downloadsDirectory(),
    `.cancel-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
}

export function triggerCancel(cancelTokenPath: string): void {
  try {
    FileManager.writeAsStringSync(cancelTokenPath, "cancel")
  } catch (error) {
    console.warn("[Video Downloader] 无法写入取消令牌：", error)
  }
}

export function cleanCancelToken(cancelTokenPath: string): void {
  if (cancelTokenPath && FileManager.existsSync(cancelTokenPath)) {
    try {
      FileManager.removeSync(cancelTokenPath)
    } catch {
      // ignore
    }
  }
}

export function isUserCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === USER_CANCELLED
}

function errorMessage(output: string, payload?: PythonPayload): string {
  const detail = payload?.error || output.trim() || "yt-dlp 没有返回错误详情"
  const lower = detail.toLowerCase()

  if (lower.includes("requested format is not available")) {
    return "该视频没有符合当前下载方式的媒体格式。兼容模式需要音视频合一的流，如果该视频只有分离流（如 B 站高清），请返回后使用「高清音视频合并下载」。"
  }
  if (lower.includes("unsupported url")) {
    return "当前版本的 yt-dlp 不支持这个链接。"
  }
  if (lower.includes("private video") || lower.includes("login") || lower.includes("sign in")) {
    return "该内容可能需要登录或账号权限，当前下载器无法直接访问。"
  }
  if (lower.includes("drm")) {
    return "该内容受 DRM 保护，无法下载。"
  }
  if (lower.includes("javascript runtime") || lower.includes("challenge")) {
    return "该站点需要额外的 JavaScript 运行环境，当前 iOS 环境暂不支持。"
  }
  if (lower.includes("merge") || lower.includes("ffmpeg") || lower.includes("combin")) {
    return "该视频需要合并分离的音视频流，兼容模式无法处理。请返回后使用「高清音视频合并下载」。"
  }
  return detail
}

function startQuickProgressPolling(
  progressPath: string,
  callback?: QuickDownloadProgressHandler,
): () => Promise<void> {
  if (!callback) return async () => undefined
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSnapshot = ""
  let callbackQueue = Promise.resolve()

  const readSnapshot = () => {
    try {
      if (!FileManager.isFileSync(progressPath)) return
      const snapshot = FileManager.readAsStringSync(progressPath)
      if (!snapshot || snapshot === lastSnapshot) return
      const progress = JSON.parse(snapshot) as QuickDownloadProgress
      lastSnapshot = snapshot
      callbackQueue = callbackQueue
        .then(() => callback(progress))
        .catch(error => {
          console.warn("[Video Downloader] 进度回调失败：", error)
        })
    } catch {
      // 原子替换仍可能与文件系统元数据更新短暂交错；下一轮会重试。
    }
  }

  const poll = () => {
    if (stopped) return
    readSnapshot()
    timer = setTimeout(poll, 300)
  }
  poll()

  return async () => {
    if (!stopped) {
      readSnapshot()
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
    await callbackQueue
  }
}

function quickProgressPath(): string {
  FileManager.createDirectorySync(downloadsDirectory(), true)
  return Path.join(
    downloadsDirectory(),
    `.quick-download-progress-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  )
}

async function reportQuickProgress(
  callback: QuickDownloadProgressHandler | undefined,
  stage: QuickDownloadProgress["stage"],
  percent: number | null,
  message: string,
): Promise<void> {
  if (!callback) return
  try {
    await callback({
      stage,
      percent,
      bytes: 0,
      total: null,
      speed: null,
      eta: null,
      message,
    })
  } catch (error) {
    console.warn("[Video Downloader] 进度回调失败：", error)
  }
}

async function runYtDlp(
  action: "inspect" | "download" | "downloadSeparate",
  url: string,
  onProgress?: QuickDownloadProgressHandler,
  cookieFilePath?: string,
  cancelTokenPath?: string,
): Promise<PythonPayload> {
  const progressPath = action === "inspect" ? null : quickProgressPath()
  const stopPolling = progressPath
    ? startQuickProgressPolling(progressPath, onProgress)
    : async () => undefined
  let result: Awaited<ReturnType<typeof Python.run>>
  try {
    result = await Python.run(getQuickRunner(), {
      queryParameters: {
        action,
        url,
        outputDir: downloadsDirectory(),
        ...(progressPath ? { progressPath } : {}),
        ...(cookieFilePath ? { cookieFilePath } : {}),
        ...(cancelTokenPath ? { cancelTokenPath } : {}),
      },
    })
    await stopPolling()
  } finally {
    await stopPolling()
    if (progressPath && FileManager.existsSync(progressPath)) {
      try {
        FileManager.removeSync(progressPath)
      } catch (error) {
        console.warn("[Video Downloader] 无法清理进度文件：", error)
      }
    }
  }

  const markerLine = result.output
    .split("\n")
    .reverse()
    .find(line => line.startsWith(RESULT_MARKER))

  let payload: PythonPayload | undefined
  if (markerLine) {
    try {
      payload = JSON.parse(markerLine.slice(RESULT_MARKER.length)) as PythonPayload
    } catch {
      payload = undefined
    }
  }

  if (result.cancelled) throw new Error("操作已取消。")
  if (result.timedOut) throw new Error("操作超时，请检查网络后重试。")
  if (payload?.error === USER_CANCELLED) throw new Error(USER_CANCELLED)
  if (result.exitCode !== 0 || !payload?.ok) {
    throw new Error(errorMessage(result.output, payload))
  }
  return payload
}

function toMediaInfo(payload: PythonPayload): MediaInfo {
  return {
    title: payload.title || "未命名视频",
    mediaId: payload.mediaId || "",
    site: payload.site || "未知站点",
    uploader: payload.uploader || "",
    duration: typeof payload.duration === "number" ? payload.duration : null,
    webpageUrl: payload.webpageUrl || "",
    thumbnail: payload.thumbnail || null,
    extension: payload.extension || null,
    nativeMergeAvailable: payload.nativeMergeAvailable === true,
    nativeVideoHeight:
      typeof payload.nativeVideoHeight === "number" ? payload.nativeVideoHeight : null,
  }
}

function safeFileName(title: string, mediaId: string): string {
  const cleanTitle = title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "未命名视频"
  const cleanId = mediaId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 50)
  return cleanId ? `${cleanTitle} [${cleanId}]` : cleanTitle
}

function uniqueOutputPath(baseName: string): string {
  const dir = downloadsDirectory()
  FileManager.createDirectorySync(dir, true)
  let candidate = Path.join(dir, `${baseName}.mp4`)
  let suffix = 2
  while (FileManager.existsSync(candidate)) {
    candidate = Path.join(dir, `${baseName} (${suffix}).mp4`)
    suffix += 1
  }
  return candidate
}

function isSafeJobDirectory(path: string): boolean {
  const root = Path.join(downloadsDirectory(), MERGE_JOBS_FOLDER)
  const prefix = root.endsWith("/") ? root : `${root}/`
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/")
}

function displaySize(
  natural: { width: number; height: number },
  transform: { a: number; b: number; c: number; d: number; tx: number; ty: number },
): { width: number; height: number } {
  const points = [
    { x: 0, y: 0 },
    { x: natural.width, y: 0 },
    { x: 0, y: natural.height },
    { x: natural.width, y: natural.height },
  ].map(point => ({
    x: transform.a * point.x + transform.c * point.y + transform.tx,
    y: transform.b * point.x + transform.d * point.y + transform.ty,
  }))
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  let width = Math.max(...xs) - Math.min(...xs)
  let height = Math.max(...ys) - Math.min(...ys)
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    width = natural.width
    height = natural.height
  }

  const maxSide = Math.max(width, height)
  if (maxSide > 3840) {
    const scale = 3840 / maxSide
    width *= scale
    height *= scale
  }
  return {
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2),
  }
}

async function validateAndDescribeSources(
  video: SeparateFile,
  audio: SeparateFile,
): Promise<{ renderSize: { width: number; height: number }; frameRate: number }> {
  if (!FileManager.isFileSync(video.filePath) || !FileManager.isFileSync(audio.filePath)) {
    throw new Error("独立音视频流下载不完整。")
  }

  const videoAsset = new AVAsset(video.filePath)
  const audioAsset = new AVAsset(audio.filePath)
  try {
    const [videoReadable, videoProtected, videoTracks, transform, audioReadable, audioTracks] =
      await Promise.all([
        videoAsset.loadIsReadable(),
        videoAsset.loadHasProtectedContent(),
        videoAsset.loadTracks("video"),
        videoAsset.loadPreferredTransform(),
        audioAsset.loadIsReadable(),
        audioAsset.loadTracks("audio"),
      ])
    if (!videoReadable || videoProtected || videoTracks.length === 0) {
      throw new Error("iOS 无法读取选中的独立视频流。")
    }
    if (!audioReadable || audioTracks.length === 0) {
      throw new Error("iOS 无法读取选中的 AAC 音频流。")
    }

    const [videoDuration, audioDuration, natural, nominalFrameRate] = await Promise.all([
      videoAsset.loadDuration(),
      audioAsset.loadDuration(),
      videoTracks[0].loadNaturalSize(),
      videoTracks[0].loadNominalFrameRate(),
    ])
    const videoSeconds = videoDuration.seconds
    const audioSeconds = audioDuration.seconds
    if (
      Number.isFinite(videoSeconds) && videoSeconds > 0 &&
      Number.isFinite(audioSeconds) && audioSeconds > 0 &&
      Math.abs(videoSeconds - audioSeconds) > Math.max(2, videoSeconds * 0.03)
    ) {
      throw new Error("独立视频流和音频流的时长差异过大，可能不是同一版本的媒体。")
    }
    const candidateFrameRate =
      Number.isFinite(nominalFrameRate) && nominalFrameRate > 0
        ? nominalFrameRate
        : video.fps || 30
    return {
      renderSize: displaySize(natural, transform),
      frameRate: Math.max(1, Math.min(60, candidateFrameRate)),
    }
  } finally {
    videoAsset.dispose()
    audioAsset.dispose()
  }
}

async function validateMergedOutput(path: string): Promise<void> {
  if (!FileManager.isFileSync(path) || FileManager.statSync(path).size <= 0) {
    throw new Error("原生合并没有生成有效文件。")
  }
  const asset = new AVAsset(path)
  try {
    const [playable, readable, protectedContent, videoTracks, audioTracks] = await Promise.all([
      asset.loadIsPlayable(),
      asset.loadIsReadable(),
      asset.loadHasProtectedContent(),
      asset.loadTracks("video"),
      asset.loadTracks("audio"),
    ])
    if (!playable || !readable || protectedContent || videoTracks.length === 0 || audioTracks.length === 0) {
      throw new Error("合并文件未通过音视频轨道验证。")
    }
  } finally {
    asset.dispose()
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function mergeWithBundledFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<boolean> {
  const command = [
    "ffmpeg",
    "-y",
    "-i", shellQuote(videoPath),
    "-i", shellQuote(audioPath),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c", "copy",
    "-movflags", "+faststart",
    shellQuote(outputPath),
  ].join(" ")
  const result = await Shell.run(command, { timeout: 900 })
  if (
    result.exitCode === 0 &&
    !result.cancelled &&
    !result.timedOut &&
    FileManager.isFileSync(outputPath) &&
    FileManager.statSync(outputPath).size > 0
  ) {
    try {
      await validateMergedOutput(outputPath)
      return true
    } catch (error: any) {
      console.warn("[Video Downloader] FFmpeg 输出未通过 iOS 验证，改用 MediaComposer：", error?.message ?? error)
    }
  }
  console.warn("[Video Downloader] Scripting 内置 FFmpeg 合并失败，改用 MediaComposer：", result.output.slice(-2000))
  if (FileManager.existsSync(outputPath)) FileManager.removeSync(outputPath)
  return false
}

async function mergeWithMediaComposer(
  video: SeparateFile,
  audio: SeparateFile,
  outputPath: string,
): Promise<void> {
  const source = await validateAndDescribeSources(video, audio)
  await MediaComposer.composeAndExport({
    exportPath: outputPath,
    timeline: {
      videoItems: [{ videoPath: video.filePath, keepOriginalAudio: false }],
      audioClips: [{
        path: audio.filePath,
        at: MediaTime.make({ seconds: 0, preferredTimescale: 600 }),
        volume: 1,
        loopToFitVideoDuration: false,
      }],
    },
    exportOptions: {
      renderSize: source.renderSize,
      frameRate: source.frameRate,
      scaleMode: "fit",
      presetName: "HighestQuality",
      outputFileType: "mp4",
      colorSpacePolicy: "forceSDR",
    },
    overwrite: false,
  })
}

export async function inspectMedia(
  url: string,
  cookieFilePath?: string,
): Promise<MediaInfo> {
  return toMediaInfo(await runYtDlp("inspect", url, undefined, cookieFilePath))
}

export async function downloadMedia(
  url: string,
  onProgress?: QuickDownloadProgressHandler,
  cookieFilePath?: string,
  cancelTokenPath?: string,
): Promise<DownloadResult> {
  const payload = await runYtDlp("download", url, onProgress, cookieFilePath, cancelTokenPath)
  if (!payload.filePath || !FileManager.isFileSync(payload.filePath)) {
    throw new Error("下载已结束，但输出文件不存在。")
  }

  return {
    ...toMediaInfo(payload),
    filePath: payload.filePath,
    fileSize: payload.fileSize || FileManager.statSync(payload.filePath).size,
    downloadMode: "compatible",
  }
}

export async function downloadAndNativeMergeMedia(
  url: string,
  onProgress?: QuickDownloadProgressHandler,
  cookieFilePath?: string,
  cancelTokenPath?: string,
): Promise<DownloadResult> {
  const payload = await runYtDlp("downloadSeparate", url, onProgress, cookieFilePath, cancelTokenPath)
  const jobDir = payload.jobDir
  if (!jobDir || !isSafeJobDirectory(jobDir) || !payload.video || !payload.audio) {
    throw new Error("yt-dlp 返回了无效的原生合并任务。")
  }

  const stagingPath = Path.join(jobDir, "merged.staging.mp4")
  let publishedPath: string | null = null
  let mergeMode: "ffmpeg" | "nativeMerge" = "ffmpeg"
  try {
    await reportQuickProgress(onProgress, "validating", null, "正在验证独立音视频流")
    await validateAndDescribeSources(payload.video, payload.audio)
    await reportQuickProgress(onProgress, "mergingFfmpeg", null, "正在使用 FFmpeg 合并音视频")
    const ffmpegMerged = await mergeWithBundledFfmpeg(
      payload.video.filePath,
      payload.audio.filePath,
      stagingPath,
    )
    if (!ffmpegMerged) {
      mergeMode = "nativeMerge"
      await reportQuickProgress(onProgress, "mergingNative", null, "正在使用 iOS 原生能力合并音视频")
      await mergeWithMediaComposer(payload.video, payload.audio, stagingPath)
    }
    await validateMergedOutput(stagingPath)

    await reportQuickProgress(onProgress, "publishing", 0, "正在发布合并视频")
    const info = toMediaInfo(payload)
    const finalPath = uniqueOutputPath(`${safeFileName(info.title, info.mediaId)} (高清合并)`)
    FileManager.renameSync(stagingPath, finalPath)
    if (!FileManager.isFileSync(finalPath)) {
      throw new Error("合并视频无法移动到下载目录。")
    }
    publishedPath = finalPath
    await reportQuickProgress(onProgress, "publishing", 100, "合并视频发布完成")
    return {
      ...info,
      extension: "mp4",
      filePath: finalPath,
      fileSize: FileManager.statSync(finalPath).size,
      downloadMode: mergeMode,
    }
  } catch (error: any) {
    if (publishedPath && FileManager.existsSync(publishedPath)) {
      try {
        FileManager.removeSync(publishedPath)
      } catch (cleanupError) {
        console.warn("[Video Downloader] 无法清理失败的发布文件：", cleanupError)
      }
    }
    throw new Error(`独立音视频合并失败：${error?.message ?? String(error)}`)
  } finally {
    if (FileManager.existsSync(jobDir)) {
      try {
        FileManager.removeSync(jobDir)
      } catch (cleanupError) {
        console.warn("[Video Downloader] 无法清理临时合并目录：", cleanupError)
      }
    }
  }
}
