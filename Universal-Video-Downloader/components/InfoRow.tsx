import { Text, VStack } from "scripting"

export function InfoRow(props: { label: string; value: string; selectable?: boolean }) {
  return (
    <VStack alignment="leading" spacing={3}>
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        {props.label}
      </Text>
      <Text font="callout" textSelection={props.selectable ?? false}>
        {props.value}
      </Text>
    </VStack>
  )
}
