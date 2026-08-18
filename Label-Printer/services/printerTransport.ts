import type { PrinterSession } from "../domain/types"
import { sleep } from "../utils/format"

let activeSession: PrinterSession | null = null
let printing = false

export function getPrinterSession(): PrinterSession | null {
  return activeSession
}

export function setPrinterSession(session: PrinterSession | null): void {
  activeSession = session
}

export async function writeToPrinter(
  data: Data,
  onLog?: (message: string) => void,
): Promise<void> {
  const session = activeSession
  if (!session) throw new Error("未连接打印机")
  if (printing) throw new Error("正在打印中，请稍候")

  printing = true
  try {
    const characteristic = session.writeChar
    const writeType = characteristic.properties.includes("writeWithoutResponse")
      ? "withoutResponse"
      : "withResponse"
    const maxLength = Math.min(
      20,
      Math.max(1, session.peripheral.maxWriteValueLength(writeType)),
    )
    onLog?.(`当前打印机：${session.name}（${session.peripheral.id}），系统状态=${session.peripheral.isConnected ? "已连接" : "未确认"}`)
    onLog?.(`写入 ${data.size}B，类型=${writeType}，块大小=${maxLength}`)

    for (let offset = 0; offset < data.size; offset += maxLength) {
      const end = Math.min(offset + maxLength, data.size)
      await session.peripheral.writeValue(
        characteristic,
        data.slice(offset, end),
        writeType,
      )
      if (writeType === "withoutResponse") await sleep(40)
      if (offset === 0 || end === data.size || end % 1000 < maxLength) {
        onLog?.(`写入进度 ${end}/${data.size}B`)
      }
    }
    onLog?.(`写入完成（${data.size}B）`)
  } finally {
    printing = false
  }
}
