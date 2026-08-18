import {
  Button,
  HStack,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  useEffect,
  VStack,
} from "scripting"
import { Card } from "../components/Card"
import { COLORS } from "../domain/constants"
import type { DiscoveredPrinter } from "../domain/types"
import { breakableId } from "../utils/format"

interface ScanPageProps {
  devices: DiscoveredPrinter[]
  scanning: boolean
  busy: boolean
  startScan: () => void
  stopScan: () => void
  connectDevice: (entry: DiscoveredPrinter) => void
}

export function ScanPage({
  devices,
  scanning,
  busy,
  startScan,
  stopScan,
  connectDevice,
}: ScanPageProps) {
  useEffect(() => {
    if (!scanning) startScan()
    return () => { stopScan() }
  }, [])

  return (
    <ScrollView
      navigationTitle="扫描打印机"
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            {scanning
              ? <Button title="停止扫描" action={stopScan} />
              : (
                <Button
                  title="重新扫描"
                  buttonStyle="borderedProminent"
                  action={startScan}
                />
              )}
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        <Card title={`发现的设备（${devices.length}）`}>
          {busy ? (
            <Text font="footnote" foregroundStyle={COLORS.muted}>
              正在连接设备…
            </Text>
          ) : null}
          {devices.length === 0 ? (
            <Text font="footnote" foregroundStyle={COLORS.muted}>
              {scanning ? "正在扫描附近的 BLE 设备…" : "没有发现设备，点右上角重新扫描"}
            </Text>
          ) : null}
          {devices.map(device => (
            <Button
              key={device.peripheral.id}
              buttonStyle="borderless"
              frame={{ maxWidth: "infinity" }}
              action={() => connectDevice(device)}
            >
              <HStack
                spacing={10}
                padding={{ vertical: 6 }}
                frame={{ maxWidth: "infinity", alignment: "leading" }}
              >
                <VStack
                  alignment="leading"
                  spacing={3}
                  frame={{ maxWidth: "infinity", alignment: "leading" }}
                >
                  {device.name === "(未命名)" ? (
                    <Text
                      font={17}
                      fontWeight="semibold"
                      multilineTextAlignment="leading"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {breakableId(device.peripheral.id)}
                    </Text>
                  ) : (
                    <Text font={17} fontWeight="semibold">{device.name}</Text>
                  )}
                  {device.name !== "(未命名)" ? (
                    <Text
                      font="footnote"
                      foregroundStyle={COLORS.muted}
                      multilineTextAlignment="leading"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {breakableId(device.peripheral.id)}
                    </Text>
                  ) : null}
                  <Text font="footnote" foregroundStyle={COLORS.muted}>
                    RSSI {device.rssi}
                  </Text>
                </VStack>
                <Spacer />
                <Text foregroundStyle={COLORS.muted}>›</Text>
              </HStack>
            </Button>
          ))}
        </Card>
      </VStack>
    </ScrollView>
  )
}
