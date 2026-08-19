import { Circle, HStack, RoundedRectangle, VStack } from "scripting"
import type { LabelTemplate } from "../domain/types"

interface LabelShapeProps {
  tpl: Pick<
    LabelTemplate,
    "widthMm" | "heightMm" | "gapMm" | "columns" | "shape"
  >
  maxWidth: number
  maxHeight: number
}

export function LabelShape({ tpl, maxWidth, maxHeight }: LabelShapeProps) {
  const rowWidthMm = tpl.widthMm * tpl.columns + tpl.gapMm * (tpl.columns - 1)
  const scale = Math.min(maxWidth / rowWidthMm, maxHeight / tpl.heightMm)
  const labelWidth = tpl.widthMm * scale
  const labelHeight = tpl.heightMm * scale
  const gap = tpl.gapMm * scale

  return (
    <HStack spacing={gap} frame={{ width: rowWidthMm * scale, height: labelHeight }}>
      {Array.from({ length: tpl.columns }, (_, index) => (
        <VStack key={index} frame={{ width: labelWidth, height: labelHeight }}>
          {tpl.shape === "circle"
            ? <Circle fill="#d4d4d8" />
            : <RoundedRectangle cornerRadius={3} fill="#d4d4d8" />}
        </VStack>
      ))}
    </HStack>
  )
}
