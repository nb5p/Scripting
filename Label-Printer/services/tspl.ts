import { SAFE_MARGIN_MM } from "../domain/constants"
import type { BitmapData, LabelTemplate } from "../domain/types"

function hexToBase64(hex: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let result = ""
  for (let index = 0; index < hex.length; index += 6) {
    const first = parseInt(hex.slice(index, index + 2), 16)
    const second = index + 2 < hex.length ? parseInt(hex.slice(index + 2, index + 4), 16) : 0
    const third = index + 4 < hex.length ? parseInt(hex.slice(index + 4, index + 6), 16) : 0
    const remaining = Math.min(3, (hex.length - index) / 2)
    const value = (first << 16) | (second << 8) | third
    result += alphabet[(value >> 18) & 63]
    result += alphabet[(value >> 12) & 63]
    result += remaining > 1 ? alphabet[(value >> 6) & 63] : "="
    result += remaining > 2 ? alphabet[value & 63] : "="
  }
  return result
}

export function buildTspl(
  template: LabelTemplate,
  bitmapData: BitmapData,
  count: number,
  ppi: number,
): Data {
  const margin = Math.round((SAFE_MARGIN_MM / 25.4) * ppi)
  const bitmap = Data.fromBase64String(hexToBase64(bitmapData.hex))
  if (!bitmap) throw new Error("位图二进制数据构造失败")

  const expectedSize = bitmapData.bytesPerRow * bitmapData.height
  if (bitmap.size !== expectedSize) {
    throw new Error(`位图长度错误：得到 ${bitmap.size}B，应为 ${expectedSize}B`)
  }

  const prefix = Data.fromRawString([
    `SIZE ${template.widthMm} mm, ${template.heightMm} mm`,
    `GAP ${template.gapMm} mm, 0 mm`,
    "CLS",
    `BITMAP ${margin},${margin},${bitmapData.bytesPerRow},${bitmapData.height},0,`,
  ].join("\r\n"))
  const suffix = Data.fromRawString(`\r\nPRINT ${Math.max(1, count)},1\r\n`)
  if (!prefix || !suffix) throw new Error("TSPL 指令构造失败")
  prefix.append(bitmap)
  prefix.append(suffix)
  return prefix
}
