/** Map quick/advanced progress payloads to the unified progress shape. */
import type { QuickDownloadProgress } from "../lib/downloader"
import type { DownloadProgress } from "../lib/advanced_downloader"
import type { UnifiedDownloadProgress } from "../lib/types"

function quickStageName(stage: QuickDownloadProgress["stage"]): string {
  const names: Record<QuickDownloadProgress["stage"], string> = {
    media: "下载媒体",
    video: "下载视频流",
    audio: "下载音频流",
    validating: "验证媒体",
    mergingFfmpeg: "FFmpeg 合并",
    mergingNative: "iOS 原生合并",
    publishing: "发布文件",
  }
  return names[stage]
}

function advancedStageName(stage: DownloadProgress["stage"]): string {
  const names: Record<DownloadProgress["stage"], string> = {
    metadata: "解析媒体信息",
    media: "下载媒体",
    subtitle: "下载字幕",
    thumbnail: "下载缩略图",
    ffmpeg: "处理 / 合并",
    publishing: "发布文件",
  }
  return names[stage]
}

export function mapQuickProgress(progress: QuickDownloadProgress): UnifiedDownloadProgress {
  const merging = progress.stage === "mergingFfmpeg" || progress.stage === "mergingNative"
  return {
    stage: quickStageName(progress.stage),
    message: progress.message,
    percent: merging ? null : progress.percent,
    downloadedBytes: progress.bytes,
    totalBytes: progress.total,
    speed: progress.speed,
    eta: progress.eta,
  }
}

export function mapAdvancedProgress(progress: DownloadProgress): UnifiedDownloadProgress {
  return {
    stage: advancedStageName(progress.stage),
    message: progress.message || advancedStageName(progress.stage),
    percent: progress.stage === "ffmpeg" || progress.status === "processing"
      ? null
      : progress.percent,
    downloadedBytes: progress.downloadedBytes,
    totalBytes: progress.totalBytes,
    speed: progress.speed,
    eta: progress.eta,
    itemIndex: progress.itemIndex,
    itemCount: progress.itemCount,
    title: progress.title,
  }
}
