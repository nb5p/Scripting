import { Circle, RoundedRectangle, VStack } from "scripting"
import type { LabelTemplate } from "../domain/types"

interface LabelShapeProps {
  tpl: Pick<LabelTemplate, "widthMm" | "heightMm" | "shape">
  maxWidth: number
  maxHeight: number
}

export function LabelShape({ tpl, maxWidth, maxHeight }: LabelShapeProps) {
  const scale = Math.min(maxWidth / tpl.widthMm, maxHeight / tpl.heightMm)
  const width = tpl.widthMm * scale
  const height = tpl.heightMm * scale
  return (
    <VStack frame={{ width, height }}>
      {tpl.shape === "circle"
        ? <Circle fill="#d4d4d8" />
        : <RoundedRectangle cornerRadius={3} fill="#d4d4d8" />}
    </VStack>
  )
}
