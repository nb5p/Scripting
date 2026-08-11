/** Cookie module — re-exports from submodules. */

export type { CookieSource, CookieValidationResult } from "./format"
export type { CookieConfig, CookieConfigSummary } from "./vault"

export {
  encryptText,
  decryptText,
} from "./crypto"

export {
  validateCookiesTxt,
  webkitCookiesToNetscape,
  inferDomainFromUrl,
  inferDomainFromCookiesText,
  extractRootDomain,
  filterCookiesByDomain,
} from "./format"

export {
  listCookieConfigs,
  getCookieConfig,
  getDecryptedCookies,
  saveCookieConfig,
  deleteCookieConfig,
  deleteAllCookieConfigs,
  touchLastUsed,
  cleanupTempCookieFiles,
  createTempCookieFile,
  removeTempCookieFile,
  getAllPersistentCookies,
  getPersistentCookiesForUrl,
  deletePersistentCookie,
  clearAllPersistentCookies,
} from "./vault"
