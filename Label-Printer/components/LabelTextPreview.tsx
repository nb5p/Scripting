import { Circle, RoundedRectangle, Text, VStack, ZStack } from "scripting"
import { SAFE_MARGIN_MM } from "../domain/constants"
import type { LabelTemplate } from "../domain/types"

interface LabelTextPreviewProps {
  template: Pick<LabelTemplate, "widthMm" | "heightMm" | "shape">
  text: string
  maxWidth: number
  maxHeight: number
}

export function LabelTextPreview({
  template,
  text,
  maxWidth,
  maxHeight,
}: LabelTextPreviewProps) {
  const scale = Math.min(
    maxWidth / template.widthMm,
    maxHeight / template.heightMm,
  )
  const width = template.widthMm * scale
  const height = template.heightMm * scale
  const margin = SAFE_MARGIN_MM * scale
  const innerWidth = Math.max(1, width - margin * 2)
  const innerHeight = Math.max(1, height - margin * 2)

  return (
    <ZStack frame={{ width, height }}>
      <VStack frame={{ width, height }}>
        {template.shape === "circle"
          ? <Circle fill="#e5e7eb" />
          : <RoundedRectangle cornerRadius={3} fill="#e5e7eb" />}
      </VStack>
      <Text
        font={200}
        foregroundStyle="#000000"
        lineLimit={1}
        multilineTextAlignment="center"
        minScaleFactor={0.01}
        frame={{ width: innerWidth, height: innerHeight }}
      >
        {text}
      </Text>
    </ZStack>
  )
}
