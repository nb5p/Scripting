import { Path } from "scripting"
import { loadAdvancedDownloadScript } from "./python-loader"
import { USER_CANCELLED, isUserCancelledError } from "./downloader"

const RESULT_MARKER = "__ADVANCED_YTDLP_RESULT__="
const JOBS_FOLDER = ".advanced-download-jobs"
const DEFAULT_PROGRESS_INTERVAL_MS = 350

export type VideoQuality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "360"
export type VideoContainer = "mp4" | "webm" | "mkv" | "source"
export type VideoCodec = "auto" | "h264" | "hevc" | "av1" | "vp9"
export type AudioFormat = "source" | "m4a" | "mp3"
export type AudioBitrate = 128 | 192 | 256 | 320
export type SubtitleFormat = "best" | "vtt" | "srt" | "ttml"

export interface AdvancedDownloadOptions {
  mediaType?: "video" | "audio"
  quality?: VideoQuality
  container?: VideoContainer
  codec?: VideoCodec
  audioFormat?: AudioFormat
  audioBitrate?: AudioBitrate
  writeSubtitles?: boolean
  writeAutomaticSubtitles?: boolean
  subtitleLanguages?: string[]
  subtitleFormat?: SubtitleFormat
  writeThumbnail?: boolean
  playlist?: boolean
  playlistStart?: number
  playlistEnd?: number
  startTime?: number
  endTime?: number
  progressIntervalMs?: number
  cookieFilePath?: string
  cancelTokenPath?: string
}

export interface DownloadProgress {
  status: "preparing" | "downloading" | "processing" | "finished" | "error"
  stage: "metadata" | "media" | "subtitle" | "thumbnail" | "ffmpeg" | "publishing"
  itemIndex: number
  itemCount: number
  title: string
  filename?: string
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
  speed: number | null
  eta: number | null
  message?: string
}

export interface AdvancedArtifact {
  kind: "media" | "subtitle" | "thumbnail"
  role: "primary" | "video-stream" | "audio-stream" | "audio-source" | "subtitle" | "thumbnail"
  filePath: string
  fileSize: number
  extension: string
  title: string
  mediaId: string
  itemIndex: number
  language?: string
  automatic?: boolean
  requestedFormat?: string
  actualFormat?: string
  approximateTrim?: boolean
}

export interface AdvancedDownloadFailure {
  stage: "metadata" | "download" | "merge" | "convert" | "trim" | "subtitle" | "thumbnail" | "publish"
  message: string
  itemIndex?: number
  title?: string
  path?: string
  recoverable: boolean
}

export interface AdvancedDownloadResult {
  ok: boolean
  partial: boolean
  sourceUrl: string
  artifacts: AdvancedArtifact[]
  failures: AdvancedDownloadFailure[]
  requestedItems: number
  completedItems: number
  startedAt: string
  finishedAt: string
}

type NormalizedOptions = Required<Omit<AdvancedDownloadOptions, "startTime" | "endTime" | "cookieFilePath" | "cancelTokenPath">> & {
  startTime: number | null
  endTime: number | null
  cookieFilePath: string | null
  cancelTokenPath: string | null
}

type PythonFile = {
  path: string
  extension: string
  formatId?: string
  vcodec?: string
  acodec?: string
  unknownMuxed?: boolean
}

type PythonSubtitle = PythonFile & {
  language: string
  automatic: boolean
  requestedFormat: SubtitleFormat
}

type PythonThumbnail = PythonFile

type PythonItem = {
  itemIndex: number
  title: string
  mediaId: string
  webpageUrl: string
  video?: PythonFile
  audio?: PythonFile
  combined?: PythonFile
  audioOnly?: PythonFile
  subtitles: PythonSubtitle[]
  thumbnail?: PythonThumbnail
}

type PythonFailure = {
  stage: AdvancedDownloadFailure["stage"]
  message: string
  itemIndex?: number
  title?: string
  recoverable?: boolean
}

type PythonPayload = {
  ok: boolean
  error?: string
  requestedItems?: number
  items?: PythonItem[]
  failures?: PythonFailure[]
}

let _advancedRunnerCache: string | null = null

function getAdvancedRunner(): string {
  if (_advancedRunnerCache !== null) return _advancedRunnerCache
  _advancedRunnerCache = loadAdvancedDownloadScript()
  return _advancedRunnerCache
}

function normalizeOptions(options: AdvancedDownloadOptions): NormalizedOptions {
  const quality = options.quality ?? "best"
  const container = options.container ?? "source"
  const codec = options.codec ?? "auto"
  const audioFormat = options.audioFormat ?? "source"
  const audioBitrate = options.audioBitrate ?? 192
  const subtitleFormat = options.subtitleFormat ?? "best"
  const mediaType = options.mediaType ?? "video"

  const allowedQuality: VideoQuality[] = ["best", "2160", "1440", "1080", "720", "480", "360"]
  const allowedContainer: VideoContainer[] = ["mp4", "webm", "mkv", "source"]
  const allowedCodec: VideoCodec[] = ["auto", "h264", "hevc", "av1", "vp9"]
  const allowedAudioFormat: AudioFormat[] = ["source", "m4a", "mp3"]
  const allowedBitrate: AudioBitrate[] = [128, 192, 256, 320]
  const allowedSubtitleFormat: SubtitleFormat[] = ["best", "vtt", "srt", "ttml"]

  if (mediaType !== "video" && mediaType !== "audio") throw new Error("mediaType 必须是 video 或 audio。")
  if (!allowedQuality.includes(quality)) throw new Error("不支持的画质选项。")
  if (!allowedContainer.includes(container)) throw new Error("不支持的视频容器。")
  if (!allowedCodec.includes(codec)) throw new Error("不支持的视频编码。")
  if (!allowedAudioFormat.includes(audioFormat)) throw new Error("不支持的音频格式。")
  if (!allowedBitrate.includes(audioBitrate)) throw new Error("音频码率必须是 128、192、256 或 320 kbps。")
  if (!allowedSubtitleFormat.includes(subtitleFormat)) throw new Error("不支持的字幕格式。")

  const startTime = options.startTime == null ? null : Number(options.startTime)
  const endTime = options.endTime == null ? null : Number(options.endTime)
  if (startTime !== null && (!Number.isFinite(startTime) || startTime < 0)) {
    throw new Error("开始秒数必须是大于或等于 0 的有限数字。")
  }
  if (endTime !== null && (!Number.isFinite(endTime) || endTime <= 0)) {
    throw new Error("结束秒数必须是大于 0 的有限数字。")
  }
  if (startTime !== null && endTime !== null && endTime <= startTime) {
    throw new Error("结束秒数必须大于开始秒数。")
  }

  const requestedStart = Math.floor(Number(options.playlistStart ?? 1))
  if (!Number.isFinite(requestedStart) || requestedStart < 1) throw new Error("播放列表起始项必须大于或等于 1。")
  const playlist = options.playlist === true || options.playlistStart != null || options.playlistEnd != null
  const requestedEnd = Math.floor(Number(options.playlistEnd ?? (playlist ? requestedStart + 49 : requestedStart)))
  if (!Number.isFinite(requestedEnd) || requestedEnd < requestedStart) {
    throw new Error("播放列表结束项不能早于起始项。")
  }
  const playlistEnd = Math.min(requestedEnd, requestedStart + 49)
  const progressIntervalMs = Math.max(150, Math.min(2000, Math.round(options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS)))
  const languages = (options.subtitleLanguages ?? []).map(value => value.trim()).filter(Boolean)

  return {
    mediaType,
    quality,
    container,
    codec,
    audioFormat,
    audioBitrate,
    writeSubtitles: options.writeSubtitles === true,
    writeAutomaticSubtitles: options.writeAutomaticSubtitles === true,
    subtitleLanguages: languages,
    subtitleFormat,
    writeThumbnail: options.writeThumbnail === true,
    playlist,
    playlistStart: requestedStart,
    playlistEnd,
    startTime,
    endTime,
    progressIntervalMs,
    cookieFilePath: options.cookieFilePath ?? null,
    cancelTokenPath: options.cancelTokenPath ?? null,
  }
}

function downloadsDirectory(): string {
  return Path.join(FileManager.documentsDirectory, "Video Downloads")
}

function createTaskDirectory(): string {
  const output = downloadsDirectory()
  const jobsRoot = Path.join(output, JOBS_FOLDER)
  FileManager.createDirectorySync(jobsRoot, true)
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  const taskDir = Path.join(jobsRoot, `job-${token}`)
  FileManager.createDirectorySync(taskDir, false)
  return taskDir
}

function isSafeTaskDirectory(path: string): boolean {
  const root = Path.join(downloadsDirectory(), JOBS_FOLDER)
  const prefix = root.endsWith("/") ? root : `${root}/`
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/")
}

/** Remove stale advanced-download job directories left over from crashed or killed runs. */
export function cleanupStaleAdvancedJobs(): void {
  try {
    const jobsRoot = Path.join(downloadsDirectory(), JOBS_FOLDER)
    if (!FileManager.isDirectorySync(jobsRoot)) return
    const entries = FileManager.readDirectorySync(jobsRoot) ?? []
    for (const entry of entries) {
      if (!entry.startsWith("job-")) continue
      try {
        FileManager.removeSync(Path.join(jobsRoot, entry))
      } catch {
        // Ignore individual cleanup failures.
      }
    }
  } catch {
    // Ignore directory-level failures.
  }
}

function safeFileName(title: string, mediaId: string, itemIndex: number): string {
  const cleanTitle = title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || `媒体 ${itemIndex}`
  const cleanId = mediaId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48)
  return cleanId ? `${cleanTitle} [${cleanId}]` : cleanTitle
}

function normalizeExtension(extension: string | undefined, fallback = "bin"): string {
  const clean = (extension ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
  return clean || fallback
}

function uniqueOutputPath(baseName: string, extension: string): string {
  const dir = downloadsDirectory()
  FileManager.createDirectorySync(dir, true)
  const ext = normalizeExtension(extension)
  let candidate = Path.join(dir, `${baseName}.${ext}`)
  let suffix = 2
  while (FileManager.existsSync(candidate)) {
    candidate = Path.join(dir, `${baseName} (${suffix}).${ext}`)
    suffix += 1
  }
  return candidate
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function fileIsUsable(path: string): boolean {
  return FileManager.isFileSync(path) && FileManager.statSync(path).size > 0
}

async function runShellFfmpeg(args: string[], outputPath: string, timeout = 1800): Promise<{ ok: boolean; output: string }> {
  const result = await Shell.run(["ffmpeg", "-hide_banner", "-y", ...args, shellQuote(outputPath)].join(" "), { timeout })
  return {
    ok: result.exitCode === 0 && !result.cancelled && !result.timedOut && fileIsUsable(outputPath),
    output: result.output,
  }
}

function trimArguments(options: NormalizedOptions): string[] {
  const args: string[] = []
  if (options.startTime !== null) args.push("-ss", String(options.startTime))
  if (options.endTime !== null) {
    const duration = options.endTime - (options.startTime ?? 0)
    args.push("-t", String(duration))
  }
  return args
}

function sourceVideoContainer(item: PythonItem): string {
  if (item.combined) return normalizeExtension(item.combined.extension, "mkv")
  const videoExt = normalizeExtension(item.video?.extension, "mkv")
  const audioExt = normalizeExtension(item.audio?.extension, "")
  if (videoExt === "webm" && audioExt === "webm") return "webm"
  if ((videoExt === "mp4" || videoExt === "m4v") && ["m4a", "mp4", "aac"].includes(audioExt)) return "mp4"
  if (!item.audio) return videoExt
  return "mkv"
}

function asArtifact(
  path: string,
  item: PythonItem,
  kind: AdvancedArtifact["kind"],
  role: AdvancedArtifact["role"],
  extra: Partial<AdvancedArtifact> = {},
): AdvancedArtifact {
  return {
    kind,
    role,
    filePath: path,
    fileSize: FileManager.statSync(path).size,
    extension: normalizeExtension(path.split(".").pop()),
    title: item.title,
    mediaId: item.mediaId,
    itemIndex: item.itemIndex,
    ...extra,
  }
}

function publishExisting(
  sourcePath: string,
  item: PythonItem,
  suffix: string,
  extension: string,
): string {
  if (!fileIsUsable(sourcePath)) throw new Error("待发布文件不存在或为空。")
  const base = `${safeFileName(item.title, item.mediaId, item.itemIndex)}${suffix}`
  const destination = uniqueOutputPath(base, extension)
  FileManager.renameSync(sourcePath, destination)
  if (!fileIsUsable(destination)) throw new Error("文件无法移动到 Video Downloads。")
  return destination
}

let cachedFfmpegEncoders: Set<string> | null = null

async function ffmpegEncoders(): Promise<Set<string>> {
  if (cachedFfmpegEncoders) return cachedFfmpegEncoders
  const result = await Shell.run("ffmpeg -hide_banner -encoders", { timeout: 60 })
  const encoders = new Set<string>()
  for (const line of result.output.split("\n")) {
    const match = line.match(/^\s*[VAS][.A-Z]{5}\s+([A-Za-z0-9_]+)/)
    if (match) encoders.add(match[1])
  }
  cachedFfmpegEncoders = encoders
  return encoders
}

async function mp3Encoder(): Promise<string | null> {
  const encoders = await ffmpegEncoders()
  for (const candidate of ["libmp3lame", "libshine", "mp3"]) {
    if (encoders.has(candidate)) return candidate
  }
  return null
}

function failure(
  stage: AdvancedDownloadFailure["stage"],
  message: string,
  item?: PythonItem,
  path?: string,
): AdvancedDownloadFailure {
  return {
    stage,
    message,
    itemIndex: item?.itemIndex,
    title: item?.title,
    path,
    recoverable: true,
  }
}

async function preserveMediaInputs(
  item: PythonItem,
  artifacts: AdvancedArtifact[],
  failures: AdvancedDownloadFailure[],
): Promise<void> {
  const inputs: Array<{ file?: PythonFile; role: AdvancedArtifact["role"]; suffix: string }> = [
    { file: item.combined, role: "video-stream", suffix: " (原始媒体)" },
    { file: item.video, role: "video-stream", suffix: " (视频流)" },
    { file: item.audio, role: "audio-stream", suffix: " (音频流)" },
    { file: item.audioOnly, role: "audio-source", suffix: " (原始音频)" },
  ]
  for (const input of inputs) {
    if (!input.file || !fileIsUsable(input.file.path)) continue
    try {
      const path = publishExisting(input.file.path, item, input.suffix, input.file.extension)
      artifacts.push(asArtifact(path, item, "media", input.role, {
        actualFormat: normalizeExtension(input.file.extension),
      }))
    } catch (error: any) {
      failures.push(failure("publish", `无法保留原始媒体流：${error?.message ?? String(error)}`, item, input.file.path))
    }
  }
}

async function processVideoItem(
  item: PythonItem,
  options: NormalizedOptions,
  taskDir: string,
  artifacts: AdvancedArtifact[],
  failures: AdvancedDownloadFailure[],
  onProgress?: (progress: DownloadProgress) => void | Promise<void>,
): Promise<boolean> {
  const primary = item.combined ?? item.video
  if (!primary || !fileIsUsable(primary.path)) {
    failures.push(failure("download", "没有可处理的视频文件。", item))
    return false
  }
  const extension = options.container === "source" ? sourceVideoContainer(item) : options.container
  const staging = Path.join(taskDir, `processed-${item.itemIndex}.${extension}`)
  const emit = (message: string) => onProgress?.({
    status: "processing",
    stage: "ffmpeg",
    itemIndex: item.itemIndex,
    itemCount: 0,
    title: item.title,
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
    speed: null,
    eta: null,
    message,
  })
  await emit(item.audio ? "正在用 FFmpeg 无损合并音视频流" : "正在用 FFmpeg 无损封装媒体")

  const trim = trimArguments(options)
  const args = item.audio
    ? [...trim, "-i", shellQuote(primary.path), ...trim, "-i", shellQuote(item.audio.path), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy"]
    : [...trim, "-i", shellQuote(primary.path), "-map", "0:v:0", "-map", shellQuote("0:a:0?"), "-c", "copy"]
  if (extension === "mp4") args.push("-movflags", "+faststart")
  const result = await runShellFfmpeg(args, staging)
  if (!result.ok) {
    failures.push(failure(
      item.audio ? "merge" : (options.startTime !== null || options.endTime !== null ? "trim" : "merge"),
      `FFmpeg 无损处理失败：${result.output.slice(-1200) || "没有错误详情"}`,
      item,
    ))
    await preserveMediaInputs(item, artifacts, failures)
    return false
  }

  try {
    const path = publishExisting(staging, item, "", extension)
    artifacts.push(asArtifact(path, item, "media", "primary", {
      requestedFormat: options.container,
      actualFormat: extension,
      approximateTrim: options.startTime !== null || options.endTime !== null,
    }))
    return true
  } catch (error: any) {
    failures.push(failure("publish", error?.message ?? String(error), item, staging))
    await preserveMediaInputs(item, artifacts, failures)
    return false
  }
}

async function processAudioItem(
  item: PythonItem,
  options: NormalizedOptions,
  taskDir: string,
  artifacts: AdvancedArtifact[],
  failures: AdvancedDownloadFailure[],
  onProgress?: (progress: DownloadProgress) => void | Promise<void>,
): Promise<boolean> {
  const source = item.audioOnly
  if (!source || !fileIsUsable(source.path)) {
    failures.push(failure("download", "没有可处理的音频文件。", item))
    return false
  }
  const needsTrim = options.startTime !== null || options.endTime !== null
  const sourceHasVideo = source.unknownMuxed === true || (source.vcodec ?? "none").toLowerCase() !== "none"
  if (options.audioFormat === "source" && !needsTrim && !sourceHasVideo) {
    try {
      const path = publishExisting(source.path, item, "", source.extension)
      artifacts.push(asArtifact(path, item, "media", "primary", {
        requestedFormat: "source",
        actualFormat: source.extension,
      }))
      return true
    } catch (error: any) {
      failures.push(failure("publish", error?.message ?? String(error), item, source.path))
      return false
    }
  }

  let encoder: string | null = null
  if (options.audioFormat === "m4a") encoder = "aac"
  if (options.audioFormat === "mp3") encoder = await mp3Encoder()
  if (options.audioFormat === "mp3" && !encoder) {
    failures.push(failure("convert", "内置 FFmpeg 没有 MP3 编码器；已保留原始音频。", item))
    await preserveMediaInputs(item, artifacts, failures)
    return false
  }

  const extension = options.audioFormat === "source" ? normalizeExtension(source.extension) : options.audioFormat
  const staging = Path.join(taskDir, `processed-${item.itemIndex}.${extension}`)
  await onProgress?.({
    status: "processing",
    stage: "ffmpeg",
    itemIndex: item.itemIndex,
    itemCount: 0,
    title: item.title,
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
    speed: null,
    eta: null,
    message: encoder ? `正在转换为 ${options.audioFormat.toUpperCase()}` : "正在快速近似裁剪音频",
  })
  const args = [
    ...trimArguments(options),
    "-i", shellQuote(source.path),
    "-vn",
    "-c:a", encoder ?? "copy",
  ]
  if (encoder) args.push("-b:a", `${options.audioBitrate}k`)
  const result = await runShellFfmpeg(args, staging)
  if (!result.ok) {
    failures.push(failure(
      encoder ? "convert" : "trim",
      `FFmpeg 音频处理失败：${result.output.slice(-1200) || "没有错误详情"}`,
      item,
    ))
    await preserveMediaInputs(item, artifacts, failures)
    return false
  }

  try {
    const path = publishExisting(staging, item, "", extension)
    artifacts.push(asArtifact(path, item, "media", "primary", {
      requestedFormat: options.audioFormat,
      actualFormat: extension,
      approximateTrim: needsTrim,
    }))
    return true
  } catch (error: any) {
    failures.push(failure("publish", error?.message ?? String(error), item, staging))
    await preserveMediaInputs(item, artifacts, failures)
    return false
  }
}

async function publishSideArtifacts(
  item: PythonItem,
  taskDir: string,
  artifacts: AdvancedArtifact[],
  failures: AdvancedDownloadFailure[],
  onProgress?: (progress: DownloadProgress) => void | Promise<void>,
): Promise<void> {
  for (let subtitleIndex = 0; subtitleIndex < (item.subtitles ?? []).length; subtitleIndex += 1) {
    const subtitle = item.subtitles[subtitleIndex]
    let sourcePath = subtitle.path
    let extension = normalizeExtension(subtitle.extension)
    const requested = subtitle.requestedFormat
    if (requested !== "best" && requested !== extension) {
      await onProgress?.({
        status: "processing",
        stage: "ffmpeg",
        itemIndex: item.itemIndex,
        itemCount: 0,
        title: item.title,
        downloadedBytes: 0,
        totalBytes: null,
        percent: null,
        speed: null,
        eta: null,
        message: `正在转换 ${subtitle.language} 字幕为 ${requested.toUpperCase()}`,
      })
      const convertedPath = Path.join(taskDir, `subtitle-converted-${item.itemIndex}-${subtitleIndex}.${requested}`)
      const subtitleCodec: Record<Exclude<SubtitleFormat, "best">, string> = {
        vtt: "webvtt",
        srt: "srt",
        ttml: "ttml",
      }
      const converted = await runShellFfmpeg([
        "-i", shellQuote(subtitle.path),
        "-map", "0:s:0",
        "-c:s", subtitleCodec[requested],
      ], convertedPath, 300)
      if (converted.ok) {
        sourcePath = convertedPath
        extension = requested
      } else {
        failures.push(failure(
          "subtitle",
          `无法将 ${subtitle.extension.toUpperCase()} 字幕转换为 ${requested.toUpperCase()}，已保留原始格式：${converted.output.slice(-800) || "FFmpeg 不支持此字幕输入"}`,
          item,
          subtitle.path,
        ))
      }
    }

    try {
      const automatic = subtitle.automatic ? " 自动字幕" : " 字幕"
      const suffix = ` (${subtitle.language}${automatic})`
      const path = publishExisting(sourcePath, item, suffix, extension)
      artifacts.push(asArtifact(path, item, "subtitle", "subtitle", {
        language: subtitle.language,
        automatic: subtitle.automatic,
        requestedFormat: requested,
        actualFormat: extension,
      }))
    } catch (error: any) {
      failures.push(failure("publish", `字幕发布失败：${error?.message ?? String(error)}`, item, sourcePath))
    }
  }
  if (item.thumbnail) {
    try {
      const path = publishExisting(item.thumbnail.path, item, " (缩略图)", item.thumbnail.extension)
      artifacts.push(asArtifact(path, item, "thumbnail", "thumbnail", {
        actualFormat: item.thumbnail.extension,
      }))
    } catch (error: any) {
      failures.push(failure("publish", `缩略图发布失败：${error?.message ?? String(error)}`, item, item.thumbnail.path))
    }
  }
}

function parsePythonPayload(output: string): PythonPayload | undefined {
  const line = output.split("\n").reverse().find(value => value.startsWith(RESULT_MARKER))
  if (!line) return undefined
  try {
    return JSON.parse(line.slice(RESULT_MARKER.length)) as PythonPayload
  } catch {
    return undefined
  }
}

function startProgressPolling(
  progressPath: string,
  intervalMs: number,
  callback?: (progress: DownloadProgress) => void | Promise<void>,
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
      lastSnapshot = snapshot
      const progress = JSON.parse(snapshot) as DownloadProgress
      callbackQueue = callbackQueue
        .then(() => callback(progress))
        .catch(error => {
          console.warn("[Advanced Downloader] 进度回调失败：", error)
        })
    } catch {
      // 原子替换仍可能与文件系统元数据更新短暂交错；下一轮会重试。
    }
  }

  const poll = () => {
    if (stopped) return
    readSnapshot()
    timer = setTimeout(poll, intervalMs)
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

function pythonError(output: string, payload?: PythonPayload): string {
  const message = payload?.error || output.trim() || "yt-dlp 没有返回错误详情"
  const lower = message.toLowerCase()
  if (lower.includes("unsupported url")) return "当前 yt-dlp 不支持这个链接。"
  if (lower.includes("private") || lower.includes("sign in") || lower.includes("login")) {
    return "该内容需要登录或账号权限。请在首页配置 Cookie 后重试。"
  }
  if (lower.includes("drm")) return "该内容受 DRM 保护，无法下载。"
  return message
}

export async function downloadAdvancedMedia(
  url: string,
  options: AdvancedDownloadOptions = {},
  onProgress?: (progress: DownloadProgress) => void | Promise<void>,
): Promise<AdvancedDownloadResult> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error("没有收到有效的下载链接。")
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("高级下载仅支持 HTTP(S) 链接。")
  }

  const normalized = normalizeOptions(options)
  const startedAt = new Date().toISOString()
  const taskDir = createTaskDirectory()
  const progressPath = Path.join(taskDir, "progress.json")
  const stopPolling = startProgressPolling(progressPath, normalized.progressIntervalMs, onProgress)
  const artifacts: AdvancedArtifact[] = []
  const failures: AdvancedDownloadFailure[] = []
  let requestedItems = 0
  let completedItems = 0

  try {
    const run = await Python.run(getAdvancedRunner(), {
      queryParameters: {
        url: parsedUrl.toString(),
        taskDir,
        progressPath,
        options: normalized,
        ...(options.cookieFilePath ? { cookieFilePath: options.cookieFilePath } : {}),
        ...(normalized.cancelTokenPath ? { cancelTokenPath: normalized.cancelTokenPath } : {}),
      },
    })
    await stopPolling()
    const payload = parsePythonPayload(run.output)
    if (normalized.cancelTokenPath && FileManager.existsSync(normalized.cancelTokenPath)) {
      throw new Error(USER_CANCELLED)
    }
    if (run.cancelled) throw new Error("高级下载已取消。")
    if (run.timedOut) throw new Error("高级下载超时，请检查网络后重试。")
    if (run.exitCode !== 0 || !payload?.ok) {
      if (payload?.error === USER_CANCELLED) throw new Error(USER_CANCELLED)
      throw new Error(pythonError(run.output, payload))
    }

    requestedItems = payload.requestedItems ?? 0
    for (const itemFailure of payload.failures ?? []) {
      failures.push({
        stage: itemFailure.stage,
        message: itemFailure.message,
        itemIndex: itemFailure.itemIndex,
        title: itemFailure.title,
        recoverable: itemFailure.recoverable !== false,
      })
    }

    for (const item of payload.items ?? []) {
      let primaryComplete = false
      try {
        primaryComplete = normalized.mediaType === "audio"
          ? await processAudioItem(item, normalized, taskDir, artifacts, failures, onProgress)
          : await processVideoItem(item, normalized, taskDir, artifacts, failures, onProgress)
      } catch (error: any) {
        failures.push(failure("publish", error?.message ?? String(error), item))
        await preserveMediaInputs(item, artifacts, failures)
      }
      await publishSideArtifacts(item, taskDir, artifacts, failures, onProgress)
      if (primaryComplete) completedItems += 1
    }

    const ok = completedItems > 0 || artifacts.length > 0
    const partial = failures.length > 0 || completedItems < requestedItems
    await onProgress?.({
      status: failures.length > 0 && !ok ? "error" : "finished",
      stage: "publishing",
      itemIndex: requestedItems,
      itemCount: requestedItems,
      title: "",
      downloadedBytes: 0,
      totalBytes: null,
      percent: 100,
      speed: null,
      eta: 0,
      message: partial ? "下载完成，但有部分项目或产物失败" : "全部下载完成",
    })
    return {
      ok,
      partial,
      sourceUrl: parsedUrl.toString(),
      artifacts,
      failures,
      requestedItems,
      completedItems,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
  } finally {
    await stopPolling()
    if (isSafeTaskDirectory(taskDir) && FileManager.existsSync(taskDir)) {
      try {
        FileManager.removeSync(taskDir)
      } catch (error) {
        console.warn("[Advanced Downloader] 无法清理任务目录：", error)
      }
    }
  }
}
