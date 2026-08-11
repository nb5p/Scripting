export type YtDlpState =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "installed"; version: string }
  | { kind: "error"; message: string }

export type UpdateCheckResult =
  | { kind: "upToDate"; version: string }
  | { kind: "updateAvailable"; currentVersion: string; latestVersion: string }
  | { kind: "missing" }
  | { kind: "error"; message: string }

const VERSION_MARKER = "__YT_DLP_VERSION__="

/** Parse yt-dlp's version from pip's `Would install` summary line. */
function extractWouldInstallVersion(output: string): string | null {
  const summaryLine = output
    .split(/\r?\n/)
    .find(line => /\bWould install\b/i.test(line))

  if (!summaryLine) return null

  const packageToken = summaryLine
    .trim()
    .split(/\s+/)
    .find(token => /^yt[-_]dlp-[0-9]/i.test(token))

  if (!packageToken) return null

  const version = packageToken.replace(/^yt[-_]dlp-/i, "").trim()
  return version || null
}

/**
 * Detect yt-dlp in Scripting's shared embedded-Python environment.
 */
export async function checkYtDlp(): Promise<YtDlpState> {
  const result = await Python.run(`
import importlib.metadata

try:
    import yt_dlp
    version = importlib.metadata.version("yt-dlp")
except ModuleNotFoundError:
    # Captures both the import yt_dlp failure (not installed) and
    # the importlib.metadata.version() PackageNotFoundError (a subclass).
    raise SystemExit(3)
except Exception as error:
    print("yt-dlp 导入失败：" + str(error))
    raise SystemExit(4)

print("${VERSION_MARKER}" + version)
`)

  if (result.exitCode === 3) {
    return { kind: "missing" }
  }

  if (result.exitCode !== 0) {
    return {
      kind: "error",
      message: result.output.trim() || `检测失败（退出码 ${result.exitCode}）`,
    }
  }

  const markerLine = result.output
    .split("\n")
    .find(line => line.startsWith(VERSION_MARKER))

  if (!markerLine) {
    return { kind: "error", message: "已运行检测，但没有读到版本号。" }
  }

  return {
    kind: "installed",
    version: markerLine.slice(VERSION_MARKER.length).trim(),
  }
}

/**
 * Install/update only yt-dlp's platform-independent core wheel.
 *
 * --no-deps is intentional: yt-dlp's optional default dependencies include
 * packages with native extensions that cannot be built in the iOS sandbox.
 */
export async function installYtDlp(): Promise<{
  state: YtDlpState
  log: string
}> {
  const result = await Shell.run(
    "python -m pip install --disable-pip-version-check --no-input --no-deps --upgrade yt-dlp",
    { timeout: 300 },
  )

  const log = result.output.trim()

  if (result.cancelled) {
    return {
      state: { kind: "error", message: "安装已取消。" },
      log,
    }
  }

  if (result.timedOut) {
    return {
      state: { kind: "error", message: "安装超时，请检查网络后重试。" },
      log,
    }
  }

  if (result.exitCode !== 0) {
    return {
      state: {
        kind: "error",
        message: log || `pip 安装失败（退出码 ${result.exitCode}）。`,
      },
      log,
    }
  }

  const state = await checkYtDlp()
  return { state, log }
}

/** Check for a newer yt-dlp version via pip without installing. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = await checkYtDlp()
  if (current.kind === "missing") return { kind: "missing" }
  if (current.kind === "error") return { kind: "error", message: current.message }
  if (current.kind !== "installed") return { kind: "error", message: "无法检测当前 yt-dlp 版本。" }

  // Use pip to query the latest available version.
  const result = await Shell.run(
    "python -m pip install --disable-pip-version-check --no-input --no-deps --upgrade --dry-run yt-dlp",
    { timeout: 120 },
  )

  if (result.cancelled) return { kind: "error", message: "检查已取消。" }
  if (result.timedOut) return { kind: "error", message: "检查超时，请检查网络后重试。" }

  // pip --dry-run output contains "Would install" if an update is available.
  const output = result.output.trim()
  const wouldInstall = output.includes("Would install")
  if (!wouldInstall && result.exitCode !== 0) {
    return { kind: "error", message: output || `pip 检查失败（退出码 ${result.exitCode}）` }
  }

  if (wouldInstall) {
    // Typical output: "Would install yt-dlp-2026.7.4". pip may
    // normalize the distribution name to either yt-dlp or yt_dlp.
    const latestVersion = extractWouldInstallVersion(output)
    if (!latestVersion) {
      return {
        kind: "error",
        message: "检测到 yt-dlp 有新版本，但无法从 pip 输出中解析版本号。请稍后重试。",
      }
    }

    return { kind: "updateAvailable", currentVersion: current.version, latestVersion }
  }

  return { kind: "upToDate", version: current.version }
}
