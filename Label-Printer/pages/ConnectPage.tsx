import {
  Button,
  HStack,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
} from "scripting"
import { Card } from "../components/Card"
import { COLORS } from "../domain/constants"
import type { KnownPrinter } from "../domain/types"
import { breakableId } from "../utils/format"

interface ConnectPageProps {
  busy: boolean
  connectedName: string
  connectedId: string
  connectingName: string
  knownPrinters: KnownPrinter[]
  onScanPage: () => void
  connectKnownPrinter: (entry: KnownPrinter) => void
  removeKnownPrinter: (id: string) => void
  disconnect: () => void
}

export function ConnectPage({
  busy,
  connectedName,
  connectedId,
  connectingName,
  knownPrinters,
  onScanPage,
  connectKnownPrinter,
  removeKnownPrinter,
  disconnect,
}: ConnectPageProps) {
  const connected = connectedName !== ""
  const statusText = connectingName
    ? `正在连接 ${connectingName}…`
    : connected
      ? connectedName
      : "未连接打印机"

  return (
    <ScrollView
      navigationTitle="打印机管理"
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            <Button title="配对设备" buttonStyle="borderless" action={onScanPage} />
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        <VStack
          spacing={8}
          padding={16}
          background={{
            colors: [COLORS.heroStart, COLORS.heroEnd],
            startPoint: "topLeading",
            endPoint: "bottomTrailing",
          }}
          clipShape={{ type: "rect", cornerRadius: 16 }}
        >
          <HStack spacing={8}>
            <Text foregroundStyle="#ffffff">{connected ? "●" : "○"}</Text>
            <Text font={18} fontWeight="bold" foregroundStyle="#ffffff">
              {statusText}
            </Text>
            <Spacer />
            {connected ? (
              <Button title="断开" role="destructive" action={disconnect} />
            ) : null}
          </HStack>
          {connected ? (
            <Text
              font="footnote"
              foregroundStyle="#ffffff"
              multilineTextAlignment="leading"
              frame={{ maxWidth: "infinity", alignment: "leading" }}
            >
              {breakableId(connectedId)}
            </Text>
          ) : null}
          {busy ? (
            <Text font="footnote" foregroundStyle="#ffffff">正在连接…</Text>
          ) : null}
        </VStack>

        {knownPrinters.length > 0 ? (
          <Card title="历史打印机" footer="连接其他设备时会自动断开当前打印机。">
            {knownPrinters.map(printer => {
              const isCurrent = connectedId === printer.id
              return (
                <HStack key={printer.id} spacing={8}>
                  <Text foregroundStyle={isCurrent ? COLORS.green : COLORS.grayDot}>
                    {isCurrent ? "●" : "○"}
                  </Text>
                  <VStack alignment="leading" spacing={3}>
                    <Text font={17} fontWeight="semibold">{printer.name}</Text>
                    <Text
                      font="footnote"
                      foregroundStyle={COLORS.muted}
                      multilineTextAlignment="leading"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {breakableId(printer.id)}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Button
                    title={isCurrent ? "已连接" : "连接"}
                    buttonStyle="borderless"
                    action={() => connectKnownPrinter(printer)}
                  />
                  <Button
                    title="删除"
                    role="destructive"
                    action={() => removeKnownPrinter(printer.id)}
                  />
                </HStack>
              )
            })}
          </Card>
        ) : null}
      </VStack>
    </ScrollView>
  )
}
