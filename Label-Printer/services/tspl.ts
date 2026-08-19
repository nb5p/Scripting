import { SAFE_MARGIN_MM } from "../domain/constants"
import type { BitmapData, LabelTemplate } from "../domain/types"

export interface PositionedBitmap {
  column: number
  bitmap: BitmapData
}

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

function appendRaw(target: Data, value: string): void {
  const data = Data.fromRawString(value)
  if (!data) throw new Error("TSPL 指令构造失败")
  target.append(data)
}

export function buildTsplRow(
  template: LabelTemplate,
  bitmaps: PositionedBitmap[],
  repeatCount: number,
  ppi: number,
): Data {
  const margin = Math.round((SAFE_MARGIN_MM / 25.4) * ppi)
  const rowWidthMm = template.widthMm * template.columns
    + template.gapMm * (template.columns - 1)
  const columnStep = Math.round(((template.widthMm + template.gapMm) / 25.4) * ppi)
  const command = Data.fromRawString([
    `SIZE ${rowWidthMm} mm, ${template.heightMm} mm`,
    `GAP ${template.gapMm} mm, 0 mm`,
    "CLS",
    "",
  ].join("\r\n"))
  if (!command) throw new Error("TSPL 指令构造失败")

  for (const item of bitmaps) {
    if (item.column < 0 || item.column >= template.columns) {
      throw new Error(`标签列索引无效：${item.column}`)
    }
    const bitmap = Data.fromBase64String(hexToBase64(item.bitmap.hex))
    if (!bitmap) throw new Error("位图二进制数据构造失败")
    const expectedSize = item.bitmap.bytesPerRow * item.bitmap.height
    if (bitmap.size !== expectedSize) {
      throw new Error(`位图长度错误：得到 ${bitmap.size}B，应为 ${expectedSize}B`)
    }

    const x = margin + item.column * columnStep
    appendRaw(
      command,
      `BITMAP ${x},${margin},${item.bitmap.bytesPerRow},${item.bitmap.height},0,`,
    )
    command.append(bitmap)
    appendRaw(command, "\r\n")
  }

  appendRaw(command, `PRINT ${Math.max(1, repeatCount)},1\r\n`)
  return command
}
