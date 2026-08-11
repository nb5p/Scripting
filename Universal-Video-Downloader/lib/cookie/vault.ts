/** Encrypted Cookie vault: persistence, CRUD, and temp-file management. */

import { Path } from "scripting"
import { encryptText, decryptText } from "./crypto"
import { validateCookiesTxt } from "./format"
import type { CookieSource } from "./format"

// ─── Types ───────────────────────────────────────────────────

export type { CookieSource } from "./format"

/** 完整 Cookie 配置（包含加密内容），仅在内部使用 */
export interface CookieConfig {
  id: string
  name: string
  source: CookieSource
  domain: string
  /** 此配置覆盖的所有不重复域名（如 youtube.com、googlevideo.com 等） */
  domains: string[]
  cookieCount: number
  /** AES-GCM 加密后的 cookies.txt 文本（Base64） */
  encryptedCookies: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

/** Cookie 配置摘要（不含加密内容），用于列表展示 */
export interface CookieConfigSummary {
  id: string
  name: string
  source: CookieSource
  domain: string
  /** 此配置覆盖的所有不重复域名 */
  domains: string[]
  cookieCount: number
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

export type { CookieValidationResult } from "./format"

// ─── Constants ───────────────────────────────────────────────

const PREFERENCES_DIRECTORY = Path.join(
  FileManager.appGroupDocumentsDirectory,
  "universal-video-downloader",
)
const VAULT_PATH = Path.join(PREFERENCES_DIRECTORY, "cookie-vault.json")
const TEMP_COOKIE_DIR = Path.join(
  FileManager.documentsDirectory,
  "Video Downloads",
  ".cookie-tmp",
)

// ─── Vault persistence ───────────────────────────────────────

interface VaultData {
  configs: CookieConfig[]
}

function loadVault(): VaultData {
  try {
    if (!FileManager.isFileSync(VAULT_PATH)) return { configs: [] }
    return {
      configs: JSON.parse(FileManager.readAsStringSync(VAULT_PATH)).configs ?? [],
    }
  } catch (error) {
    console.warn("[Cookie Vault] 无法读取 Cookie 仓，返回空仓：", error)
    return { configs: [] }
  }
}

function saveVault(vault: VaultData): void {
  try {
    FileManager.createDirectorySync(PREFERENCES_DIRECTORY, true)
    FileManager.writeAsStringSync(VAULT_PATH, JSON.stringify(vault, null, 2))
  } catch (error) {
    console.error("[Cookie Vault] 无法保存 Cookie 仓：", error)
    throw new Error(`保存 Cookie 仓失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function toSummary(config: CookieConfig): CookieConfigSummary {
  return {
    id: config.id,
    name: config.name,
    source: config.source,
    domain: config.domain,
    domains: config.domains ?? [config.domain],
    cookieCount: config.cookieCount,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    lastUsedAt: config.lastUsedAt,
  }
}

// ─── Config CRUD ─────────────────────────────────────────────

export function listCookieConfigs(): CookieConfigSummary[] {
  return loadVault().configs.map(toSummary)
}

export function getCookieConfig(id: string): CookieConfig | null {
  return loadVault().configs.find(config => config.id === id) ?? null
}

export function getDecryptedCookies(id: string): string | null {
  const config = getCookieConfig(id)
  if (!config) return null
  return decryptText(config.encryptedCookies)
}

function generateId(): string {
  return `cookie-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function saveCookieConfig(params: {
  name: string
  source: CookieSource
  cookiesText: string
  domain?: string
  domains?: string[]
}): CookieConfigSummary {
  const name = params.name.trim() || "未命名 Cookie"
  const validation = validateCookiesTxt(params.cookiesText)
  if (!validation.valid) {
    throw new Error(validation.error || "cookies.txt 格式无效。")
  }
  if (validation.cookieCount === 0) {
    throw new Error("没有找到有效的 Cookie 条目。")
  }

  const domain = (params.domain?.trim() || validation.domains[0] || "未知域名")
  const domains = params.domains?.length ? params.domains : validation.domains
  const now = new Date().toISOString()
  const config: CookieConfig = {
    id: generateId(),
    name,
    source: params.source,
    domain,
    domains,
    cookieCount: validation.cookieCount,
    encryptedCookies: encryptText(params.cookiesText.trim()),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  }

  const vault = loadVault()
  vault.configs.push(config)
  saveVault(vault)
  return toSummary(config)
}

export function deleteCookieConfig(id: string): boolean {
  const vault = loadVault()
  const before = vault.configs.length
  vault.configs = vault.configs.filter(config => config.id !== id)
  if (vault.configs.length === before) return false
  saveVault(vault)
  return true
}

export function deleteAllCookieConfigs(): number {
  const vault = loadVault()
  const count = vault.configs.length
  vault.configs = []
  saveVault(vault)
  return count
}

export function touchLastUsed(id: string): void {
  const vault = loadVault()
  const config = vault.configs.find(item => item.id === id)
  if (!config) return
  config.lastUsedAt = new Date().toISOString()
  saveVault(vault)
}

// ─── Temp cookies.txt file management ────────────────────────

export function cleanupTempCookieFiles(): void {
  try {
    if (!FileManager.isDirectorySync(TEMP_COOKIE_DIR)) return
    const entries = FileManager.readDirectorySync(TEMP_COOKIE_DIR)
    for (const entry of entries ?? []) {
      const path = Path.join(TEMP_COOKIE_DIR, entry)
      try {
        FileManager.removeSync(path)
      } catch {
        // 忽略单个文件清理失败。
      }
    }
  } catch {
    // 忽略目录级清理失败。
  }
}

export function createTempCookieFile(configId: string): string | null {
  const cookiesText = getDecryptedCookies(configId)
  if (!cookiesText) return null

  FileManager.createDirectorySync(TEMP_COOKIE_DIR, true)
  const fileName = `cookies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  const filePath = Path.join(TEMP_COOKIE_DIR, fileName)
  FileManager.writeAsStringSync(filePath, cookiesText)
  // touchLastUsed only updates a timestamp; don't let it prevent returning
  // the already-written file path (which would leak the plaintext file).
  try {
    touchLastUsed(configId)
  } catch {
    // Ignore — the temp file is already written and usable.
  }
  return filePath
}

export function removeTempCookieFile(filePath: string): void {
  try {
    if (filePath && FileManager.existsSync(filePath)) {
      FileManager.removeSync(filePath)
    }
  } catch {
    // 忽略清理失败。
  }
}

// ─── WebView Cookie operations ───────────────────────────────

/** 获取持久 WebKit Cookie 仓中的所有 Cookie */
export async function getAllPersistentCookies(): Promise<
  { name: string; value: string; domain: string; path: string; isSecure: boolean; expiresDate?: Date | null }[]
> {
  const controller = new WebViewController()
  try {
    return await controller.getAllCookies()
  } finally {
    controller.dispose()
  }
}

/** 获取持久 WebKit Cookie 仓中匹配指定 URL 的 Cookie */
export async function getPersistentCookiesForUrl(
  url: string,
): Promise<
  { name: string; value: string; domain: string; path: string; isSecure: boolean; expiresDate?: Date | null }[]
> {
  const controller = new WebViewController()
  try {
    return await controller.getCookies(url)
  } finally {
    controller.dispose()
  }
}

/** 按 name/domain/path 精确删除持久 WebKit Cookie 仓中的 Cookie */
export async function deletePersistentCookie(
  name: string,
  domain: string,
  path: string,
): Promise<boolean> {
  const controller = new WebViewController()
  try {
    return await controller.deleteCookie({ name, domain, path })
  } finally {
    controller.dispose()
  }
}

/** 清除持久 WebKit Cookie 仓中的所有 Cookie（危险操作） */
export async function clearAllPersistentCookies(): Promise<void> {
  const controller = new WebViewController()
  try {
    await controller.clearAllCookies()
  } finally {
    controller.dispose()
  }
}
