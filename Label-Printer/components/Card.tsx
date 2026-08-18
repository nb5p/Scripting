import { Text, VStack } from "scripting"
import { COLORS } from "../domain/constants"

interface CardProps {
  title?: string
  footer?: string
  children?: any
}

export function Card({ title, footer, children }: CardProps) {
  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={16}
      background={COLORS.card}
      clipShape={{ type: "rect", cornerRadius: 16 }}
      shadow={{ color: "rgba(0,0,0,0.06)", radius: 8, y: 2 }}
      frame={{ maxWidth: "infinity" }}
    >
      {title ? <Text font={18} fontWeight="bold">{title}</Text> : null}
      {children}
      {footer ? (
        <Text font="footnote" foregroundStyle={COLORS.muted}>{footer}</Text>
      ) : null}
    </VStack>
  )
}
