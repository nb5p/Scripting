import { Button, HStack, Spacer, Text, VStack } from "scripting"
import { COLORS } from "../domain/constants"

interface HeroCardProps {
  connected: boolean
  connectingName: string
  onConnect: () => void
}

export function HeroCard({
  connected,
  connectingName,
  onConnect,
}: HeroCardProps) {
  const status = connectingName
    ? `正在连接 ${connectingName}…`
    : connected
      ? "打印机已就绪"
      : "打印机未连接"

  return (
    <VStack
      padding={18}
      background={{
        colors: [COLORS.heroStart, COLORS.heroEnd],
        startPoint: "topLeading",
        endPoint: "bottomTrailing",
      }}
      clipShape={{ type: "rect", cornerRadius: 16 }}
      listRowBackground={<VStack background="clear" />}
      listRowInsets={0}
      frame={{ maxWidth: "infinity", height: 132 }}
    >
      <HStack>
        <Text font={30} fontWeight="bold" foregroundStyle="#ffffff">
          {status}
        </Text>
        <Spacer />
      </HStack>
      <Spacer />
      <HStack>
        <Spacer />
        <Button action={onConnect}>
          <Text
            font={15}
            fontWeight="semibold"
            foregroundStyle="#000000"
            padding={{ horizontal: 18, vertical: 8 }}
            background="#ffffff"
            clipShape={{ type: "rect", cornerRadius: 999 }}
          >
            {connected ? "管理打印机" : "连接打印机"}
          </Text>
        </Button>
      </HStack>
    </VStack>
  )
}
