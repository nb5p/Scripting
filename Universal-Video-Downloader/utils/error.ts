/** Shared error and cookie-path helpers used across the app. */
import { createTempCookieFile } from "../lib/cookie"

/** Safely extract a human-readable message from any thrown value. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/** Resolve a temporary cookie file path from a config ID, or undefined if no config. */
export function resolveCookieFilePath(configId: string | null): string | undefined {
  return configId ? createTempCookieFile(configId) ?? undefined : undefined
}
