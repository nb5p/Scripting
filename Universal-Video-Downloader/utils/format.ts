/** Format helpers for download progress display. */

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "未知"
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "未知"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatSpeed(speed: number | null): string {
  return speed !== null && Number.isFinite(speed) && speed >= 0
    ? `${formatBytes(speed)}/秒`
    : "未知"
}

export function formatEta(eta: number | null): string {
  return eta !== null && Number.isFinite(eta) && eta >= 0 ? formatDuration(eta) : "未知"
}

/** Display name for a quick-download mode. */
export function formatDownloadMode(mode: "ffmpeg" | "nativeMerge" | "compatible"): string {
  if (mode === "ffmpeg") return "Scripting 内置 FFmpeg 无损封装合并"
  if (mode === "nativeMerge") return "iOS MediaComposer 原生重新编码"
  return "兼容单文件下载"
}
