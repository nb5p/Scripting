import { useRef, useState } from "scripting"
import { CONNECTION_TIMEOUT_MS } from "../domain/constants"
import type {
  AppLogger,
  DiscoveredPrinter,
  KnownPrinter,
} from "../domain/types"
import {
  getPrinterSession,
  setPrinterSession,
} from "../services/printerTransport"
import { sleep } from "../utils/format"

interface PrinterControllerOptions {
  appLog: AppLogger
  onConnected: (id: string, name: string) => void
}

interface ConnectionAttempt {
  nextToken: number
  activeToken: number
  activePeripheral: BluetoothPeripheral | null
  timer: ReturnType<typeof setTimeout> | null
}

export function usePrinterController({
  appLog,
  onConnected,
}: PrinterControllerOptions) {
  const [devices, setDevices] = useState<DiscoveredPrinter[]>([])
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connectedName, setConnectedName] = useState("")
  const [connectedId, setConnectedId] = useState("")
  const [connectingName, setConnectingName] = useState("")
  const connectionRef = useRef<ConnectionAttempt>({
    nextToken: 0,
    activeToken: 0,
    activePeripheral: null,
    timer: null,
  })

  const beginConnection = (
    name: string,
    peripheral: BluetoothPeripheral | null = null,
  ): number => {
    const attempt = connectionRef.current
    attempt.nextToken += 1
    attempt.activeToken = attempt.nextToken
    attempt.activePeripheral = peripheral
    if (attempt.timer) clearTimeout(attempt.timer)
    setBusy(true)
    setConnectingName(name)

    const token = attempt.activeToken
    attempt.timer = setTimeout(() => {
      if (connectionRef.current.activeToken !== token) return
      const timedOutPeripheral = connectionRef.current.activePeripheral
      const previousSession = getPrinterSession()
      connectionRef.current.activeToken = 0
      connectionRef.current.activePeripheral = null
      connectionRef.current.timer = null
      setPrinterSession(null)
      setConnectedName("")
      setConnectedId("")
      setConnectingName("")
      setBusy(false)
      appLog(`连接 ${name} 超时，当前状态为未连接`)
      if (timedOutPeripheral) {
        BluetoothCentralManager.disconnect(timedOutPeripheral).catch(() => {})
      }
      if (previousSession && previousSession.peripheral.id !== timedOutPeripheral?.id) {
        BluetoothCentralManager.disconnect(previousSession.peripheral).catch(() => {})
      }
    }, CONNECTION_TIMEOUT_MS)
    return token
  }

  const isCurrentConnection = (token: number): boolean => {
    return connectionRef.current.activeToken === token
  }

  const finishConnection = (token: number): boolean => {
    const attempt = connectionRef.current
    if (attempt.activeToken !== token) return false
    if (attempt.timer) clearTimeout(attempt.timer)
    attempt.timer = null
    attempt.activeToken = 0
    attempt.activePeripheral = null
    setBusy(false)
    setConnectingName("")
    return true
  }

  const discoverWritableCharacteristic = async (
    peripheral: BluetoothPeripheral,
    token: number,
  ): Promise<BluetoothCharacteristic | null> => {
    let services: BluetoothService[] = []
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await peripheral.discoverServices()
      } catch (error) {
        appLog(`  第 ${attempt} 次发现服务出错: ${error}`)
      }
      if (!isCurrentConnection(token)) return null
      services = peripheral.services ?? []
      if (services.length > 0) {
        appLog(`共发现 ${services.length} 个服务（第 ${attempt} 次成功）`)
        break
      }
      if (attempt < 5) {
        appLog(`  第 ${attempt} 次发现 0 个服务，等 1 秒后重试…`)
        await sleep(1000)
        if (!isCurrentConnection(token)) return null
      }
    }

    if (services.length === 0) {
      appLog("⚠️ 始终没有发现任何服务，请重启打印机电源后重试")
      return null
    }

    for (const service of services) {
      if (!isCurrentConnection(token)) return null
      appLog(`  服务 ${service.uuid}`)
      let characteristics: BluetoothCharacteristic[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await peripheral.discoverCharacteristics(service)
        } catch (error) {
          appLog(`    第 ${attempt} 次发现特征出错: ${error}`)
        }
        if (!isCurrentConnection(token)) return null
        characteristics = service.characteristics ?? []
        if (characteristics.length > 0) break
        if (attempt < 3) {
          appLog(`    第 ${attempt} 次发现 0 个特征，等 1 秒后重试…`)
          await sleep(1000)
          if (!isCurrentConnection(token)) return null
        }
      }

      if (characteristics.length === 0) {
        appLog("    该服务没有发现任何特征")
        continue
      }
      for (const characteristic of characteristics) {
        appLog(`    特征 ${characteristic.uuid}  [${characteristic.properties.join(", ")}]`)
        if (
          characteristic.properties.includes("write")
          || characteristic.properties.includes("writeWithoutResponse")
        ) {
          appLog(`选定写入特征 ${characteristic.uuid} [${characteristic.properties.join(", ")}]`)
          return characteristic
        }
      }
    }

    appLog("⚠️ 没有找到可写特征，请把日志发给开发者排查")
    return null
  }

  const connectDeviceCore = async (
    peripheral: BluetoothPeripheral,
    name: string,
    token: number,
  ): Promise<void> => {
    if (!isCurrentConnection(token)) return
    const currentSession = getPrinterSession()
    if (currentSession && currentSession.peripheral.id !== peripheral.id) {
      appLog(`切换打印机：先断开 ${currentSession.name}（${currentSession.peripheral.id}）`)
      try {
        await BluetoothCentralManager.disconnect(currentSession.peripheral)
      } catch (error) {
        appLog(`断开旧设备失败: ${error}`)
      }
      if (!isCurrentConnection(token)) return
    }

    setPrinterSession(null)
    setConnectedName("")
    setConnectedId("")
    connectionRef.current.activePeripheral = peripheral
    peripheral.onDisconnected = (error) => {
      const session = getPrinterSession()
      if (
        !session
        || session.connectionToken !== token
        || session.peripheral !== peripheral
      ) return
      setPrinterSession(null)
      setConnectedName("")
      setConnectedId("")
      appLog(`设备 ${name} 已断开${error ? `（${error}）` : ""}`)
    }

    appLog(`连接 ${name} …`)
    await BluetoothCentralManager.connect(peripheral, { enableAutoReconnect: false })
    if (!isCurrentConnection(token)) {
      const activePeripheral = connectionRef.current.activePeripheral
      if (!activePeripheral || activePeripheral.id !== peripheral.id) {
        BluetoothCentralManager.disconnect(peripheral).catch(() => {})
      }
      return
    }

    appLog("已连接 ✓，发现服务…")
    const writeChar = await discoverWritableCharacteristic(peripheral, token)
    if (!writeChar || !isCurrentConnection(token)) {
      throw new Error("连接未完成")
    }

    setPrinterSession({ peripheral, writeChar, name, connectionToken: token })
    setConnectedName(name)
    setConnectedId(peripheral.id)
    appLog(`✅ 已连接：${name}，可以开始打印了`)
    onConnected(peripheral.id, name)
  }

  const disconnectPeripheralAfterFailure = (
    peripheral: BluetoothPeripheral | null,
  ): void => {
    if (!peripheral) return
    BluetoothCentralManager.disconnect(peripheral).catch(error => {
      appLog(`连接未完成，断开设备失败: ${error}`)
    })
  }

  const connectKnownPrinter = async (entry: KnownPrinter): Promise<void> => {
    if (busy) {
      appLog("正在处理中，本次连接请求已忽略")
      return
    }
    if (getPrinterSession()?.peripheral.id === entry.id) {
      appLog(`历史设备 ${entry.name} 已经连接，无需重复连接`)
      return
    }

    const token = beginConnection(entry.name)
    appLog(`开始连接历史设备 ${entry.name}（${entry.id}），超时 ${CONNECTION_TIMEOUT_MS / 1000} 秒`)
    try {
      let found: BluetoothPeripheral[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        found = await BluetoothCentralManager.retrievePeripherals([entry.id])
        if (!isCurrentConnection(token)) return
        appLog(`第 ${attempt} 次找回历史设备：${found.length > 0 ? "已找到" : "未找到"}`)
        if (found.length > 0) break
        if (attempt < 3) {
          await sleep(700)
          if (!isCurrentConnection(token)) return
        }
      }

      if (found.length === 0) {
        appLog("未找到历史设备，当前状态为未连接")
        finishConnection(token)
        return
      }
      const peripheral = found[0]
      connectionRef.current.activePeripheral = peripheral
      await connectDeviceCore(peripheral, peripheral.name ?? entry.name, token)
      finishConnection(token)
    } catch {
      if (isCurrentConnection(token)) {
        appLog("连接失败，当前状态为未连接")
        disconnectPeripheralAfterFailure(connectionRef.current.activePeripheral)
        finishConnection(token)
      }
    }
  }

  const connectDevice = async (entry: DiscoveredPrinter): Promise<void> => {
    if (busy) {
      appLog("正在处理中，本次连接请求已忽略")
      return
    }
    appLog(`选择扫描设备 ${entry.name}（${entry.peripheral.id}），RSSI=${entry.rssi}`)
    setScanning(false)
    BluetoothCentralManager.stopScan().catch(() => {})
    const token = beginConnection(entry.name, entry.peripheral)
    try {
      await connectDeviceCore(entry.peripheral, entry.name, token)
      if (isCurrentConnection(token)) finishConnection(token)
    } catch {
      if (isCurrentConnection(token)) {
        appLog("连接失败，当前状态为未连接")
        disconnectPeripheralAfterFailure(entry.peripheral)
        finishConnection(token)
      }
    }
  }

  const startScan = (): void => {
    const seenIds = new Set<string>()
    setDevices([])
    setScanning(true)
    appLog("开始扫描 BLE 设备…（首次使用请允许蓝牙权限）")
    BluetoothCentralManager.startScan((peripheral, advertisement, rssi) => {
      if (seenIds.has(peripheral.id)) return
      seenIds.add(peripheral.id)
      const name = peripheral.name ?? "(未命名)"
      appLog(`扫描发现 ${name}（${peripheral.id}），RSSI=${rssi}，服务=${(advertisement.serviceUUIDs ?? []).join(",") || "未广播"}`)
      setDevices(previous => {
        if (previous.some(device => device.peripheral.id === peripheral.id)) {
          return previous
        }
        return [...previous, {
          peripheral,
          name,
          rssi,
          advServices: advertisement.serviceUUIDs ?? [],
        }]
      })
    }, { allowDuplicates: false }).catch(error => {
      appLog(`扫描出错: ${error}`)
      setScanning(false)
    })
  }

  const stopScan = async (): Promise<void> => {
    try {
      await BluetoothCentralManager.stopScan()
    } catch (error) {
      appLog(`停止扫描出错: ${error}`)
    }
    setScanning(false)
    appLog("已停止扫描")
  }

  const disconnect = async (): Promise<void> => {
    const session = getPrinterSession()
    if (!session) {
      appLog("点击断开，但当前没有活动打印机连接")
      return
    }
    if (busy) {
      appLog("正在处理中，本次断开请求已忽略")
      return
    }

    setBusy(true)
    appLog(`手动断开 ${session.name}（${session.peripheral.id}）`)
    try {
      await BluetoothCentralManager.disconnect(session.peripheral)
      appLog("手动断开完成")
    } catch (error) {
      appLog(`手动断开失败: ${error}`)
    }
    if (getPrinterSession()?.peripheral.id === session.peripheral.id) {
      setPrinterSession(null)
    }
    setConnectedName("")
    setConnectedId("")
    setBusy(false)
  }

  return {
    devices,
    scanning,
    busy,
    connectedName,
    connectedId,
    connectingName,
    isConnected: connectedName !== "" && getPrinterSession() !== null,
    startScan,
    stopScan,
    connectKnownPrinter,
    connectDevice,
    disconnect,
  }
}
