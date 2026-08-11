import {
  HStack,
  ProgressView,
  Spacer,
  Text,
  VStack,
} from "scripting"

export function LoadingCard(props: { title: string; subtitle: string }) {
  return (
    <HStack>
      <Spacer />
      <VStack alignment="center" spacing={14} padding={{ top: 44, bottom: 44 }}>
        <ProgressView />
        <VStack alignment="center" spacing={4}>
          <Text font="headline">{props.title}</Text>
          <Text
            font="footnote"
            foregroundStyle="secondaryLabel"
            multilineTextAlignment="center"
          >
            {props.subtitle}
          </Text>
        </VStack>
      </VStack>
      <Spacer />
    </HStack>
  )
}
