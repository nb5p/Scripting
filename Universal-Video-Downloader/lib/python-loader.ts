/**
 * Load and concatenate Python script files from disk.
 *
 * The Python files live in `lib/python/` relative to the script root.
 * Each runner script (quick_download.py, advanced_download.py) expects
 * shared.py to be prepended — shared.py provides `emit`, `number`,
 * `check_cancelled`, `first_media`, `existing_file`, `common_options`,
 * and `atomic_write_json` as globals.
 *
 * The MARKER constant is injected at the top because each runner uses
 * a different result marker string.
 */
import { Path } from "scripting"

/** Cached file contents keyed by filename. */
const scriptCache = new Map<string, string>()

/** Resolve the lib/python directory. Uses scriptsDirectory if available,
 *  falls back to deriving from the FileManager documents directory. */
function pythonDirectory(): string {
  let base: string
  try {
    // scriptsDirectory is a Scripting runtime global, but may not exist
    // in all execution contexts (e.g. scripting-ts CLI).
    base = (globalThis as Record<string, unknown>).scriptsDirectory as string
  } catch {
    base = undefined as unknown as string
  }
  if (!base) {
    // Fallback: scripts live under the iCloud Documents scripts directory.
    base = Path.join(FileManager.documentsDirectory, "scripts")
  }
  return Path.join(base, "Universal-Video-Downloader", "lib", "python")
}

function readPythonFile(name: string): string {
  const cached = scriptCache.get(name)
  if (cached !== undefined) return cached
  const filePath = Path.join(pythonDirectory(), name)
  const content = FileManager.readAsStringSync(filePath)
  scriptCache.set(name, content)
  return content
}

/**
 * Build the quick-download Python script (inspect / download / downloadSeparate).
 * Injects MARKER, prepends shared.py to quick_download.py.
 */
export function loadQuickDownloadScript(): string {
  const shared = readPythonFile("shared.py")
  const runner = readPythonFile("quick_download.py")
  return `MARKER = "__YTDLP_RESULT__="\n` + shared + "\n" + runner
}

/**
 * Build the advanced-download Python script (playlists, subtitles, thumbnails).
 * Injects MARKER, prepends shared.py to advanced_download.py.
 */
export function loadAdvancedDownloadScript(): string {
  const shared = readPythonFile("shared.py")
  const runner = readPythonFile("advanced_download.py")
  return `MARKER = "__ADVANCED_YTDLP_RESULT__="\n` + shared + "\n" + runner
}
