/** AES-256-GCM encryption with Keychain-backed key management. */

declare function generateSymmetricKey(size?: number): Data
declare function encryptAESGCM(
  data: Data,
  key: Data,
  options?: { iv?: Data; aad?: Data },
): Data | null
declare function decryptAESGCM(data: Data, key: Data, aad?: Data): Data | null

const KEYCHAIN_KEY = "yt-dlp-cookie-vault-aes-key"

export function getOrCreateEncryptionKey(): Data {
  if (Keychain.contains(KEYCHAIN_KEY)) {
    const existing = Keychain.getData(KEYCHAIN_KEY)
    if (existing && existing.size > 0) return existing
  }
  const key = generateSymmetricKey(256)
  const ok = Keychain.setData(KEYCHAIN_KEY, key, { accessibility: "first_unlock_this_device" })
  if (!ok) throw new Error("无法将加密密钥写入 Keychain，Cookie 功能不可用。")
  return key
}

export function encryptText(plainText: string): string {
  const key = getOrCreateEncryptionKey()
  const data = Data.fromRawString(plainText)
  if (!data) throw new Error("无法将文本转换为加密数据。")
  const encrypted = encryptAESGCM(data, key)
  if (!encrypted) throw new Error("AES-GCM 加密失败。")
  return encrypted.toBase64String()
}

export function decryptText(encryptedBase64: string): string {
  const key = getOrCreateEncryptionKey()
  const encrypted = Data.fromBase64String(encryptedBase64)
  if (!encrypted) throw new Error("无法解析加密数据。")
  const decrypted = decryptAESGCM(encrypted, key)
  if (!decrypted) throw new Error("AES-GCM 解密失败。")
  const text = decrypted.toRawString()
  return text ?? ""
}
