import { ImageRenderer, Text } from "scripting"
import { SAFE_MARGIN_MM } from "../domain/constants"
import type { BitmapData } from "../domain/types"

function isInk(bytes: Uint8Array, offset: number): boolean {
  const red = bytes[offset]
  const green = bytes[offset + 1]
  const blue = bytes[offset + 2]
  const alpha = bytes[offset + 3]
  return alpha > 128 && (red + green + blue) / 3 < 150
}

export async function renderTextBitmap(
  text: string,
  widthMm: number,
  heightMm: number,
  ppi: number,
): Promise<BitmapData | null> {
  const pixelWidth = Math.max(8, Math.round((widthMm / 25.4) * ppi))
  const pixelHeight = Math.max(8, Math.round((heightMm / 25.4) * ppi))
  const margin = Math.max(1, Math.round((SAFE_MARGIN_MM / 25.4) * ppi))
  const safeWidth = Math.max(1, pixelWidth - margin * 2)
  const safeHeight = Math.max(1, pixelHeight - margin * 2)
  const scale = ppi / 72

  const view = (
    <Text
      font={400}
      foregroundStyle="#000000"
      lineLimit={1}
      multilineTextAlignment="center"
      minScaleFactor={0.01}
      frame={{ width: safeWidth / scale, height: safeHeight / scale }}
    >
      {text}
    </Text>
  )

  const image = await ImageRenderer.toUIImage(view, { opaque: false, scale })
  if (!image) return null
  const pixels = image.getPixelData()
  if (!pixels) return null
  const bytes = pixels.data.getBytes()
  if (!bytes) return null

  const width = pixels.width
  const height = pixels.height
  const bytesPerRow = Math.ceil(width / 8)
  const rows: string[] = []
  for (let y = 0; y < height; y++) {
    let row = ""
    for (let x = 0; x < bytesPerRow; x++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = x * 8 + bit
        if (pixelX >= width || !isInk(bytes, (y * width + pixelX) * 4)) {
          byte |= 0x80 >> bit
        }
      }
      row += byte.toString(16).padStart(2, "0")
    }
    rows.push(row)
  }
  return { bytesPerRow, height, hex: rows.join("") }
}
