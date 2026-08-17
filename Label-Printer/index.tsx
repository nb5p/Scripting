import {
  Script,
  Navigation,
  NavigationStack,
  NavigationDestination,
  List,
  Section,
  Button,
  Text,
  TextField,
  Picker,
  HStack,
  VStack,
  ZStack,
  Stepper,
  Circle,
  RoundedRectangle,
  ScrollView,
  Spacer,
  ImageRenderer,
  Toolbar,
  ToolbarItem,
  useState,
  useEffect,
  useRef,
  useObservable,
  ProgressView,
  Toggle,
  Color,
} from "scripting"

// 常量与类型

const SAFE_MARGIN_MM = 1.5

const CONNECTION_TIMEOUT_MS = 8000

const C: Record<string, Color> = {
  card: "secondarySystemGroupedBackground",
  cardAlt: "secondarySystemFill",
  muted: "secondaryLabel",
  green: "systemGreen",
  grayDot: "tertiaryLabel",
  heroStart: "#2563eb",
  heroEnd: "#7c3aed",
  danger: "systemRed",
}

interface LabelTemplate {
  id: string
  widthMm: number
  heightMm: number
  gapMm: number
  shape: "square" | "circle"
  createdAt: number
}

interface AppSettings {
  ppi: number
  autoConnect: boolean
  lastPrinterId: string
}

interface PrinterSession {
  peripheral: BluetoothPeripheral
  writeChar: BluetoothCharacteristic
  name: string
  connectionToken: number
}

let printerSession: PrinterSession | null = null
let pendingTexts: string[] = []
let printing = false

type NavPath = ReturnType<typeof useObservable<string[]>>

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms))
}

function breakableId(value: string): string {
  return value.split("").join("\u200B")
}

// 持久化

interface KnownPrinter {
  id: string
  name: string
}

interface PersistedState {
  templates: LabelTemplate[]
  settings: AppSettings
  knownPrinters: KnownPrinter[]
}

function dataFilePath(): string {
  return FileManager.documentsDirectory + "/label_print_data.json"
}

function loadState(): PersistedState {
  try {
    if (FileManager.existsSync(dataFilePath())) {
      const obj = JSON.parse(FileManager.readAsStringSync(dataFilePath(), "utf8"))
      return {
        templates: Array.isArray(obj.templates) ? obj.templates : [],
        settings: { ppi: 300, autoConnect: false, lastPrinterId: "", ...(obj.settings ?? {}) },
        knownPrinters: Array.isArray(obj.knownPrinters) ? obj.knownPrinters : [],
      }
    }
  } catch (e) {
    console.log("读取模板失败", e)
  }
  return {
    templates: [],
    settings: { ppi: 300, autoConnect: false, lastPrinterId: "" },
    knownPrinters: [],
  }
}

function saveState(state: PersistedState) {
  try {
    FileManager.writeAsStringSync(dataFilePath(), JSON.stringify(state), "utf8")
  } catch (e) {
    console.log("保存模板失败", e)
  }
}

// 位图生成

function isInk(bytes: Uint8Array, o: number): boolean {
  const r = bytes[o]
  const g = bytes[o + 1]
  const b = bytes[o + 2]
  const a = bytes[o + 3]
  return a > 128 && (r + g + b) / 3 < 150
}

// 用系统平方字体把文本渲染成 1bit 位图（居中 / 自动最大字号 / 四周 1.5mm 留白）
async function renderTextBitmap(
  text: string,
  wMm: number,
  hMm: number,
  ppi: number
): Promise<{ bytesPerRow: number; height: number; hex: string } | null> {
  const pw = Math.max(8, Math.round((wMm / 25.4) * ppi))
  const ph = Math.max(8, Math.round((hMm / 25.4) * ppi))
  const margin = Math.max(1, Math.round((SAFE_MARGIN_MM / 25.4) * ppi))
  const sw = Math.max(1, pw - margin * 2)
  const sh = Math.max(1, ph - margin * 2)
  const scale = ppi / 72
  const wPt = sw / scale
  const hPt = sh / scale

  const view = (
    <Text
      font={400}
      foregroundStyle="#000000"
      lineLimit={1}
      multilineTextAlignment="center"
      minScaleFactor={0.01}
      frame={{ width: wPt, height: hPt }}
    >
      {text}
    </Text>
  )

  const img = await ImageRenderer.toUIImage(view, { opaque: false, scale })
  if (!img) return null
  const px = img.getPixelData()
  if (!px) return null
  const bytes = px.data.getBytes()
  if (!bytes) return null

  const W = px.width
  const H = px.height
  const bytesPerRow = Math.ceil(W / 8)
  const hexParts: string[] = []
  for (let y = 0; y < H; y++) {
    let row = ""
    for (let x = 0; x < bytesPerRow; x++) {
      let byte = 0
      for (let b = 0; b < 8; b++) {
        const pxX = x * 8 + b
        if (pxX >= W || !isInk(bytes, (y * W + pxX) * 4)) {
          byte |= 0x80 >> b
        }
      }
      row += byte.toString(16).padStart(2, "0")
    }
    hexParts.push(row)
  }
  return { bytesPerRow, height: H, hex: hexParts.join("") }
}

// TSPL

function hexToBase64(hex: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let result = ""
  for (let i = 0; i < hex.length; i += 6) {
    const a = parseInt(hex.slice(i, i + 2), 16)
    const b = i + 2 < hex.length ? parseInt(hex.slice(i + 2, i + 4), 16) : 0
    const c = i + 4 < hex.length ? parseInt(hex.slice(i + 4, i + 6), 16) : 0
    const remaining = Math.min(3, (hex.length - i) / 2)
    const n = (a << 16) | (b << 8) | c
    result += alphabet[(n >> 18) & 63]
    result += alphabet[(n >> 12) & 63]
    result += remaining > 1 ? alphabet[(n >> 6) & 63] : "="
    result += remaining > 2 ? alphabet[n & 63] : "="
  }
  return result
}

function buildTspl(
  tpl: LabelTemplate,
  bmp: { bytesPerRow: number; height: number; hex: string },
  count: number,
  ppi: number
): Data {
  const margin = Math.round((SAFE_MARGIN_MM / 25.4) * ppi)
  const bitmap = Data.fromBase64String(hexToBase64(bmp.hex))
  if (!bitmap) throw new Error("位图二进制数据构造失败")
  const expectedSize = bmp.bytesPerRow * bmp.height
  if (bitmap.size !== expectedSize) {
    throw new Error(`位图长度错误：得到 ${bitmap.size}B，应为 ${expectedSize}B`)
  }

  const prefix = Data.fromRawString([
    `SIZE ${tpl.widthMm} mm, ${tpl.heightMm} mm`,
    `GAP ${tpl.gapMm} mm, 0 mm`,
    "CLS",
    `BITMAP ${margin},${margin},${bmp.bytesPerRow},${bmp.height},0,`,
  ].join("\r\n"))
  const suffix = Data.fromRawString(`\r\nPRINT ${Math.max(1, count)},1\r\n`)
  if (!prefix || !suffix) throw new Error("TSPL 指令构造失败")
  prefix.append(bitmap)
  prefix.append(suffix)
  return prefix
}

// 打印

async function writeToPrinter(data: Data, onLog?: (msg: string) => void): Promise<void> {
  const s = printerSession
  if (!s) throw new Error("未连接打印机")
  if (printing) throw new Error("正在打印中，请稍候")
  printing = true
  try {
    const char = s.writeChar
    const writeType = char.properties.includes("writeWithoutResponse")
      ? "withoutResponse"
      : "withResponse"
    const maxLen = Math.min(20, Math.max(1, s.peripheral.maxWriteValueLength(writeType)))
    onLog?.(`当前打印机：${s.name}（${s.peripheral.id}），系统状态=${s.peripheral.isConnected ? "已连接" : "未确认"}`)
    onLog?.(`写入 ${data.size}B，类型=${writeType}，块大小=${maxLen}`)
    for (let i = 0; i < data.size; i += maxLen) {
      const end = Math.min(i + maxLen, data.size)
      await s.peripheral.writeValue(char, data.slice(i, end), writeType)
      if (writeType === "withoutResponse") await sleep(40)
      if (i === 0 || end === data.size || end % 1000 < maxLen) {
        onLog?.(`写入进度 ${end}/${data.size}B`)
      }
    }
    onLog?.(`写入完成（${data.size}B）`)
  } finally {
    printing = false
  }
}

async function printJobs(
  tpl: LabelTemplate,
  jobs: { text: string; count: number }[],
  ppi: number,
  onLog: (msg: string) => void,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  for (const job of jobs) {
    onLog(`生成位图：${job.text}…`)
    const bmp = await renderTextBitmap(job.text, tpl.widthMm, tpl.heightMm, ppi)
    if (!bmp) throw new Error(`“${job.text}”位图生成失败`)
    const cmd = buildTspl(tpl, bmp, job.count, ppi)
    onLog(`发送 ${job.text} × ${job.count}（${cmd.size}B，二进制位图）`)
    await writeToPrinter(cmd, onLog)
    onLog(`完成 ${job.text} ✓`)
    onProgress?.(jobs.indexOf(job) + 1, jobs.length)
  }
}

// 通用小部件

// 按标签实际比例缩放的形状预览
function LabelShape({ tpl, maxWidth, maxHeight }: {
  tpl: Pick<LabelTemplate, "widthMm" | "heightMm" | "shape">
  maxWidth: number
  maxHeight: number
}) {
  const s = Math.min(maxWidth / tpl.widthMm, maxHeight / tpl.heightMm)
  const w = tpl.widthMm * s
  const h = tpl.heightMm * s
  return (
    <VStack frame={{ width: w, height: h }}>
      {tpl.shape === "circle"
        ? <Circle fill="#d4d4d8" />
        : <RoundedRectangle cornerRadius={3} fill="#d4d4d8" />}
    </VStack>
  )
}

// 按标签实际比例缩放、形状 + 居中文字的排版预览
function LabelTextPreview({ template, text, maxWidth, maxHeight }: {
  template: Pick<LabelTemplate, "widthMm" | "heightMm" | "shape">
  text: string
  maxWidth: number
  maxHeight: number
}) {
  const s = Math.min(maxWidth / template.widthMm, maxHeight / template.heightMm)
  const pw = template.widthMm * s
  const ph = template.heightMm * s
  const marginPt = SAFE_MARGIN_MM * s
  const innerW = Math.max(1, pw - marginPt * 2)
  const innerH = Math.max(1, ph - marginPt * 2)
  return (
    <ZStack frame={{ width: pw, height: ph }}>
      <VStack frame={{ width: pw, height: ph }}>
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
        frame={{ width: innerW, height: innerH }}
      >
        {text}
      </Text>
    </ZStack>
  )
}

// 卡片容器
function Card({ title, footer, children }: {
  title?: string
  footer?: string
  children?: any
}) {
  return (
    <VStack
      alignment="leading"
      spacing={12}
      padding={16}
      background={C.card}
      clipShape={{ type: "rect", cornerRadius: 16 }}
      shadow={{ color: "rgba(0,0,0,0.06)", radius: 8, y: 2 }}
      frame={{ maxWidth: "infinity" }}
    >
      {title ? <Text font={18} fontWeight="bold">{title}</Text> : null}
      {children}
      {footer ? <Text font="footnote" foregroundStyle={C.muted}>{footer}</Text> : null}
    </VStack>
  )
}

// 连接时长格式化：毫秒 -> “X 分 Y 秒”
// 首页 hero 卡片：渐变内卡（大字状态 + 右下角连接按钮）
function HeroCard({ connected, deviceName, connectingName, onConnect }: {
  connected: boolean
  deviceName: string
  connectingName: string
  onConnect: () => void
}) {
  const bigText = connectingName
    ? `正在连接 ${connectingName}…`
    : connected
      ? "打印机已就绪"
      : "打印机未连接"
  return (
    <VStack
      padding={18}
      background={{ colors: [C.heroStart, C.heroEnd], startPoint: "topLeading", endPoint: "bottomTrailing" }}
      clipShape={{ type: "rect", cornerRadius: 16 }}
      listRowBackground={<VStack background="clear" />}
      listRowInsets={0}
      frame={{ maxWidth: "infinity", height: 132 }}
    >
      <HStack>
        <Text font={30} fontWeight="bold" foregroundStyle="#ffffff">{bigText}</Text>
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

// 首页

function HomeView() {
  const path = useObservable<string[]>([])
  const [state, setState] = useState<PersistedState>(() => loadState())

  const [devices, setDevices] = useState<{
    peripheral: BluetoothPeripheral
    name: string
    rssi: number
    advServices: string[]
  }[]>([])
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connectedName, setConnectedName] = useState("")
  const [connectedId, setConnectedId] = useState("")
  const [connectingName, setConnectingName] = useState("")
  const connectionRef = useRef<{
    nextToken: number
    activeToken: number
    activePeripheral: BluetoothPeripheral | null
    timer: ReturnType<typeof setTimeout> | null
  }>({ nextToken: 0, activeToken: 0, activePeripheral: null, timer: null })
  const beginConnection = (name: string, peripheral: BluetoothPeripheral | null = null): number => {
    const ref = connectionRef.current
    ref.nextToken += 1
    ref.activeToken = ref.nextToken
    ref.activePeripheral = peripheral
    if (ref.timer) clearTimeout(ref.timer)
    setBusy(true)
    setConnectingName(name)
    const token = ref.activeToken
    ref.timer = setTimeout(() => {
      if (connectionRef.current.activeToken !== token) return
      const timedOutPeripheral = connectionRef.current.activePeripheral
      const previousSession = printerSession
      connectionRef.current.activeToken = 0
      connectionRef.current.activePeripheral = null
      connectionRef.current.timer = null
      printerSession = null
      setConnectedName("")
      setConnectedId("")
      setConnectingName("")
      setBusy(false)
      addLog(`连接 ${name} 超时，当前状态为未连接`)
      if (timedOutPeripheral) BluetoothCentralManager.disconnect(timedOutPeripheral).catch(() => {})
      if (previousSession && previousSession.peripheral.id !== timedOutPeripheral?.id) {
        BluetoothCentralManager.disconnect(previousSession.peripheral).catch(() => {})
      }
    }, CONNECTION_TIMEOUT_MS)
    return ref.activeToken
  }

  const isCurrentConnection = (token: number): boolean => {
    const ref = connectionRef.current
    return ref.activeToken === token
  }

  const finishConnection = (token: number) => {
    const ref = connectionRef.current
    if (ref.activeToken !== token) return false
    if (ref.timer) clearTimeout(ref.timer)
    ref.timer = null
    ref.activeToken = 0
    ref.activePeripheral = null
    setBusy(false)
    setConnectingName("")
    return true
  }

  const [logs, setLogs] = useState<string[]>([`[${new Date().toLocaleTimeString()}] 应用已启动，等待连接打印机…`])
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, `[${time}] ${msg}`])
  }

  const updatePpi = (n: number) => {
    const next = { ...state, settings: { ...state.settings, ppi: n } }
    setState(next)
    saveState(next)
    addLog(`打印精度已改为 ${n} PPI`)
  }

  const clearLogs = () => {
    const time = new Date().toLocaleTimeString()
    setLogs([`[${time}] 日志已清空`])
  }

  const deleteTemplate = (id: string) => {
    const tpl = state.templates.find(t => t.id === id)
    const next = { ...state, templates: state.templates.filter(t => t.id !== id) }
    setState(next)
    saveState(next)
    addLog(`已删除模板 ${tpl ? `${tpl.widthMm}×${tpl.heightMm}mm` : id}`)
  }

  const addKnownPrinter = (id: string, name: string) => {
    setState(prev => {
      const exists = prev.knownPrinters.some(p => p.id === id)
      const next: PersistedState = {
        ...prev,
        settings: { ...prev.settings, lastPrinterId: id },
        knownPrinters: exists
          ? prev.knownPrinters.map(p => p.id === id && p.name !== name ? { ...p, name } : p)
          : [...prev.knownPrinters, { id, name }],
      }
      saveState(next)
      return next
    })
  }

  const setAutoConnect = (enabled: boolean) => {
    const next = { ...state, settings: { ...state.settings, autoConnect: enabled } }
    setState(next)
    saveState(next)
    addLog(`打开App自动连接上次设备：${enabled ? "开启" : "关闭"}`)
  }

  const removeKnownPrinter = (id: string) => {
    const printer = state.knownPrinters.find(p => p.id === id)
    const next = {
      ...state,
      settings: state.settings.lastPrinterId === id
        ? { ...state.settings, lastPrinterId: "" }
        : state.settings,
      knownPrinters: state.knownPrinters.filter(p => p.id !== id),
    }
    setState(next)
    saveState(next)
    addLog(`已移除历史打印机 ${printer?.name ?? id}（${id}）`)
  }

  const connectKnownPrinter = async (entry: KnownPrinter) => {
    if (busy) { addLog("正在处理中，本次连接请求已忽略"); return }
    if (printerSession?.peripheral.id === entry.id) {
      addLog(`历史设备 ${entry.name} 已经连接，无需重复连接`)
      return
    }
    const token = beginConnection(entry.name)
    addLog(`开始连接历史设备 ${entry.name}（${entry.id}），超时 ${CONNECTION_TIMEOUT_MS / 1000} 秒`)
    try {
      let found: BluetoothPeripheral[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        found = await BluetoothCentralManager.retrievePeripherals([entry.id])
        if (!isCurrentConnection(token)) return
        addLog(`第 ${attempt} 次找回历史设备：${found.length > 0 ? "已找到" : "未找到"}`)
        if (found.length > 0) break
        if (attempt < 3) {
          await sleep(700)
          if (!isCurrentConnection(token)) return
        }
      }
      if (found.length === 0) {
        addLog("未找到历史设备，当前状态为未连接")
        finishConnection(token)
        return
      }
      const periph = found[0]
      connectionRef.current.activePeripheral = periph
      await connectDeviceCore(periph, periph.name ?? entry.name, token)
      finishConnection(token)
    } catch (e) {
      if (isCurrentConnection(token)) {
        addLog(`连接失败，当前状态为未连接`)
        finishConnection(token)
      }
    }
  }

  const copyLogs = async () => {
    if (logs.length === 0) return
    await Pasteboard.setString([
      "=== 标签打印日志 ===",
      `时间：${new Date().toLocaleString()}`,
      "----------------------------",
      ...logs,
    ].join("\n"))
    addLog(`✅ 已复制 ${logs.length} 条日志`)
  }

  // ---- 扫描 / 连接 / 断开 ----
  const startScan = () => {
    const seenIds = new Set<string>()
    setDevices([])
    setScanning(true)
    addLog("开始扫描 BLE 设备…（首次使用请允许蓝牙权限）")
    BluetoothCentralManager.startScan((peripheral, adv, rssi) => {
      if (seenIds.has(peripheral.id)) return
      seenIds.add(peripheral.id)
      const name = peripheral.name ?? "(未命名)"
      addLog(`扫描发现 ${name}（${peripheral.id}），RSSI=${rssi}，服务=${(adv.serviceUUIDs ?? []).join(",") || "未广播"}`)
      setDevices(prev => {
        if (prev.some(d => d.peripheral.id === peripheral.id)) return prev
        return [...prev, {
          peripheral,
          name,
          rssi,
          advServices: adv.serviceUUIDs ?? [],
        }]
      })
    }, { allowDuplicates: false }).catch(e => {
      addLog(`扫描出错: ${e}`)
      setScanning(false)
    })
  }

  const stopScan = async () => {
    try { await BluetoothCentralManager.stopScan() } catch (e) { addLog(`停止扫描出错: ${e}`) }
    setScanning(false)
    addLog("已停止扫描")
  }

  const discoverAll = async (peripheral: BluetoothPeripheral, name: string, token: number): Promise<BluetoothCharacteristic | null> => {
    let services: BluetoothService[] = []
    for (let attempt = 1; attempt <= 5; attempt++) {
      try { await peripheral.discoverServices() } catch (e) { addLog(`  第 ${attempt} 次发现服务出错: ${e}`) }
      if (!isCurrentConnection(token)) return null
      services = peripheral.services ?? []
      if (services.length > 0) { addLog(`共发现 ${services.length} 个服务（第 ${attempt} 次成功）`); break }
      if (attempt < 5) {
        addLog(`  第 ${attempt} 次发现 0 个服务，等 1 秒后重试…`)
        await sleep(1000)
        if (!isCurrentConnection(token)) return null
      }
    }
    if (services.length === 0) {
      addLog("⚠️ 始终没有发现任何服务，请重启打印机电源后重试")
      return null
    }
    for (const service of services) {
      if (!isCurrentConnection(token)) return null
      addLog(`  服务 ${service.uuid}`)
      let chars: BluetoothCharacteristic[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await peripheral.discoverCharacteristics(service) } catch (e) { addLog(`    第 ${attempt} 次发现特征出错: ${e}`) }
        if (!isCurrentConnection(token)) return null
        chars = service.characteristics ?? []
        if (chars.length > 0) break
        if (attempt < 3) {
          addLog(`    第 ${attempt} 次发现 0 个特征，等 1 秒后重试…`)
          await sleep(1000)
          if (!isCurrentConnection(token)) return null
        }
      }
      if (chars.length === 0) { addLog("    该服务没有发现任何特征"); continue }
      for (const char of chars) {
        addLog(`    特征 ${char.uuid}  [${char.properties.join(", ")}]`)
        if (char.properties.includes("write") || char.properties.includes("writeWithoutResponse")) {
          addLog(`选定写入特征 ${char.uuid} [${char.properties.join(", ")}]`)
          return char
        }
      }
    }
    addLog("⚠️ 没有找到可写特征，请把日志发给开发者排查")
    return null
  }

  const connectDeviceCore = async (peripheral: BluetoothPeripheral, name: string, token: number) => {
    if (!isCurrentConnection(token)) return
    if (printerSession && printerSession.peripheral.id !== peripheral.id) {
      const previous = printerSession
      addLog(`切换打印机：先断开 ${previous.name}（${previous.peripheral.id}）`)
      try { await BluetoothCentralManager.disconnect(previous.peripheral) } catch (e) { addLog(`断开旧设备失败: ${e}`) }
      if (!isCurrentConnection(token)) return
    }
    printerSession = null
    setConnectedName("")
    setConnectedId("")
    connectionRef.current.activePeripheral = peripheral
    peripheral.onDisconnected = (error) => {
      const session = printerSession
      if (!session || session.connectionToken !== token || session.peripheral !== peripheral) return
      printerSession = null
      setConnectedName("")
      setConnectedId("")
      addLog(`设备 ${name} 已断开${error ? `（${error}）` : ""}`)
    }
    addLog(`连接 ${name} …`)
    await BluetoothCentralManager.connect(peripheral, { enableAutoReconnect: false })
    if (!isCurrentConnection(token)) {
      const activePeripheral = connectionRef.current.activePeripheral
      if (!activePeripheral || activePeripheral.id !== peripheral.id) {
        BluetoothCentralManager.disconnect(peripheral).catch(() => {})
      }
      return
    }
    addLog("已连接 ✓，发现服务…")
    const writeChar = await discoverAll(peripheral, name, token)
    if (!writeChar || !isCurrentConnection(token)) throw new Error("连接未完成")
    printerSession = { peripheral, writeChar, name, connectionToken: token }
    setConnectedName(name)
    setConnectedId(peripheral.id)
    addLog(`✅ 已连接：${name}，可以开始打印了`)
    addKnownPrinter(peripheral.id, name)
  }

  const connectDevice = async (entry: { peripheral: BluetoothPeripheral; name: string; rssi: number; advServices: string[] }) => {
    if (busy) { addLog("正在处理中，本次连接请求已忽略"); return }
    addLog(`选择扫描设备 ${entry.name}（${entry.peripheral.id}），RSSI=${entry.rssi}`)
    setScanning(false)
    BluetoothCentralManager.stopScan().catch(() => {})
    const token = beginConnection(entry.name, entry.peripheral)
    try {
      await connectDeviceCore(entry.peripheral, entry.name, token)
      if (isCurrentConnection(token)) finishConnection(token)
    } catch (e) {
      if (isCurrentConnection(token)) {
        addLog("连接失败，当前状态为未连接")
        finishConnection(token)
      }
    }
  }

  const disconnect = async () => {
    if (!printerSession) {
      addLog("点击断开，但当前没有活动打印机连接")
      return
    }
    if (busy) {
      addLog("正在处理中，本次断开请求已忽略")
      return
    }
    setBusy(true)
    const session = printerSession
    addLog(`手动断开 ${session.name}（${session.peripheral.id}）`)
    try {
      await BluetoothCentralManager.disconnect(session.peripheral)
      addLog("手动断开完成")
    } catch (e) {
      addLog(`手动断开失败: ${e}`)
    }
    if (printerSession?.peripheral.id === session.peripheral.id) printerSession = null
    setConnectedName("")
    setConnectedId("")
    setBusy(false)
  }

  useEffect(() => {
    if (!state.settings.autoConnect || !state.settings.lastPrinterId || printerSession) return
    const entry = state.knownPrinters.find(p => p.id === state.settings.lastPrinterId)
    if (!entry) {
      addLog(`自动连接跳过：上次设备记录不存在（${state.settings.lastPrinterId}）`)
      return
    }
    addLog(`打开App，自动连接上次设备：${entry.name}`)
    connectKnownPrinter(entry)
  }, [])

  return (
    <NavigationStack path={path}>
      <List
        navigationTitle="标签打印"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        contentMargins={{ edges: "top", insets: { top: 2, leading: 0, bottom: 0, trailing: 0 } }}
        navigationDestination={
          <NavigationDestination>
            {(page) => {
              if (page === "new") {
                return (
                  <NewTemplatePage
                    onSave={(tpl) => {
                      const next = { ...state, templates: [...state.templates, tpl] }
                      setState(next)
                      saveState(next)
                      addLog(`已创建模板 ${tpl.widthMm}×${tpl.heightMm}mm`)
                      path.setValue([])
                    }}
                  />
                )
              }
              if (page === "logs") {
                return <LogPage logs={logs} />
              }
              if (page === "connect") {
                return (
                  <ConnectPage
                    busy={busy}
                    connectedName={connectedName}
                    connectedId={connectedId}
                    connectingName={connectingName}
                    knownPrinters={state.knownPrinters}
                    onScanPage={() => {
                      addLog("打开扫描打印机页面")
                      path.setValue([...path.value, "scan"])
                    }}
                    connectKnownPrinter={connectKnownPrinter}
                    removeKnownPrinter={removeKnownPrinter}
                    disconnect={disconnect}
                  />
                )
              }
              if (page === "scan") {
                return (
                  <ScanPage
                    devices={devices}
                    scanning={scanning}
                    busy={busy}
                    startScan={startScan}
                    stopScan={stopScan}
                    connectDevice={connectDevice}
                  />
                )
              }
              if (page.startsWith("tpl:")) {
                const tpl = state.templates.find(t => t.id === page.slice(4))
                if (!tpl) return <Text>模板不存在</Text>
                return (
                  <TextInputPage
                    template={tpl}
                    ppi={state.settings.ppi}
                    path={path}
                    connected={connectedName !== ""}
                    appLog={addLog}
                  />
                )
              }
              if (page.startsWith("qty:")) {
                const tpl = state.templates.find(t => t.id === page.slice(4))
                if (!tpl) return <Text>模板不存在</Text>
                return (
                  <QuantitiesPage
                    template={tpl}
                    ppi={state.settings.ppi}
                    path={path}
                    connected={connectedName !== ""}
                    appLog={addLog}
                  />
                )
              }
              return <Text>未知页面</Text>
            }}
          </NavigationDestination>
        }
      >
        {/* Hero 区 */}
        <HeroCard
          connected={!!printerSession}
          deviceName={connectedName}
          connectingName={connectingName}
          onConnect={() => {
            addLog("打开打印机管理页面")
            path.setValue(["connect"])
          }}
        />

        {/* 我的模板 */}
        <Section
          header={
            <HStack>
              <Text fontWeight="bold">我的模板</Text>
              <Spacer />
              <Button
                title="新建模板"
                buttonStyle="borderedProminent"
                controlSize="small"
                action={() => {
                  addLog("打开新建模板页面")
                  path.setValue(["new"])
                }}
              />
            </HStack>
          }
        >
          {state.templates.length === 0 ? (
            <HStack>
              <Text font="footnote" foregroundStyle={C.muted}>还没有模板，点上面的「新建模板」创建第一个</Text>
              <Spacer />
            </HStack>
          ) : null}
          {state.templates.map(t => {
            const title = `${t.widthMm}×${t.heightMm}mm`
            return (
              <HStack
                key={t.id}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button title="删除" role="destructive" action={() => deleteTemplate(t.id)} />,
                  ],
                }}
              >
                <Button
                  buttonStyle="borderless"
                  frame={{ maxWidth: "infinity" }}
                  action={() => {
                    addLog(`打开模板 ${t.widthMm}×${t.heightMm}mm`)
                    path.setValue(["tpl:" + t.id])
                  }}
                >
                  <HStack spacing={12} padding={{ vertical: 6 }}>
                    <VStack padding={8} background={C.cardAlt} clipShape={{ type: "rect", cornerRadius: 12 }}>
                      <LabelShape tpl={t} maxWidth={40} maxHeight={40} />
                    </VStack>
                    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text font={17} fontWeight="semibold">{title}</Text>
                      <Text font="footnote" foregroundStyle={C.muted}>
                        间距 {t.gapMm}mm · {t.shape === "circle" ? "圆形" : "方形"}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Text foregroundStyle={C.muted}>›</Text>
                  </HStack>
                </Button>
              </HStack>
            )
          })}
        </Section>

        {/* 设置 */}
        <Section
          header={<Text fontWeight="bold">设置</Text>}
        >
          <HStack spacing={12}>
            <Text fontWeight="semibold">打印分辨率</Text>
            <Picker
              value={String(state.settings.ppi)}
              onChanged={(v: string) => updatePpi(parseInt(v, 10))}
              pickerStyle="segmented"
              title="打印分辨率"
              frame={{ maxWidth: "infinity" }}
            >
              <Text tag="200">200 PPI</Text>
              <Text tag="300">300 PPI</Text>
            </Picker>
          </HStack>
          <Toggle
            title="自动连接上次使用设备"
            value={state.settings.autoConnect}
            onChanged={setAutoConnect}
          />
        </Section>

        {/* 日志 */}
        <Section
          header={<Text fontWeight="bold">日志</Text>}
          footer={<Text>共 {logs.length} 条 · 点「查看日志」在新窗口查看内容</Text>}
        >
          <HStack spacing={12}>
            <Button title="查看日志" buttonStyle="borderedProminent" frame={{ maxWidth: "infinity" }} action={() => path.setValue(["logs"])} />
            <Button title="清空日志" buttonStyle="bordered" frame={{ maxWidth: "infinity" }} action={clearLogs} />
            <Button title="复制日志" buttonStyle="bordered" frame={{ maxWidth: "infinity" }} action={copyLogs} />
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

// 打印机管理与扫描

function ConnectPage({ busy, connectedName, connectedId, connectingName, knownPrinters, onScanPage, connectKnownPrinter, removeKnownPrinter, disconnect }: {
  busy: boolean
  connectedName: string
  connectedId: string
  connectingName: string
  knownPrinters: KnownPrinter[]
  onScanPage: () => void
  connectKnownPrinter: (entry: KnownPrinter) => void
  removeKnownPrinter: (id: string) => void
  disconnect: () => void
}) {
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
          background={{ colors: [C.heroStart, C.heroEnd], startPoint: "topLeading", endPoint: "bottomTrailing" }}
          clipShape={{ type: "rect", cornerRadius: 16 }}
        >
          <HStack spacing={8}>
            <Text foregroundStyle="#ffffff">{connected ? "●" : "○"}</Text>
            <Text font={18} fontWeight="bold" foregroundStyle="#ffffff">{statusText}</Text>
            <Spacer />
            {connected ? <Button title="断开" role="destructive" action={disconnect} /> : null}
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
          {busy ? <Text font="footnote" foregroundStyle="#ffffff">正在连接…</Text> : null}
        </VStack>

        {knownPrinters.length > 0 ? (
          <Card title="历史打印机" footer="连接其他设备时会自动断开当前打印机。">
            {knownPrinters.map(p => {
              const isCurrent = connectedId === p.id
              return (
                <HStack key={p.id} spacing={8}>
                  <Text foregroundStyle={isCurrent ? C.green : C.grayDot}>{isCurrent ? "●" : "○"}</Text>
                  <VStack alignment="leading" spacing={3}>
                     <Text font={17} fontWeight="semibold">{p.name}</Text>
                     <Text
                       font="footnote"
                       foregroundStyle={C.muted}
                       multilineTextAlignment="leading"
                       frame={{ maxWidth: "infinity", alignment: "leading" }}
                     >
                       {breakableId(p.id)}
                     </Text>
                   </VStack>
                  <Spacer />
                  <Button
                    title={isCurrent ? "已连接" : "连接"}
                    buttonStyle="borderless"
                    action={() => connectKnownPrinter(p)}
                  />
                  <Button title="删除" role="destructive" action={() => removeKnownPrinter(p.id)} />
                </HStack>
              )
            })}
          </Card>
        ) : null}

      </VStack>
    </ScrollView>
  )
}

function ScanPage({ devices, scanning, busy, startScan, stopScan, connectDevice }: {
  devices: { peripheral: BluetoothPeripheral; name: string; rssi: number; advServices: string[] }[]
  scanning: boolean
  busy: boolean
  startScan: () => void
  stopScan: () => void
  connectDevice: (entry: { peripheral: BluetoothPeripheral; name: string; rssi: number; advServices: string[] }) => void
}) {
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
              : <Button title="重新扫描" buttonStyle="borderedProminent" action={startScan} />}
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        <Card title={`发现的设备（${devices.length}）`}>
          {busy ? <Text font="footnote" foregroundStyle={C.muted}>正在连接设备…</Text> : null}
          {devices.length === 0 ? (
            <Text font="footnote" foregroundStyle={C.muted}>
              {scanning ? "正在扫描附近的 BLE 设备…" : "没有发现设备，点右上角重新扫描"}
            </Text>
          ) : null}
          {devices.map(d => (
            <Button
              key={d.peripheral.id}
              buttonStyle="borderless"
              frame={{ maxWidth: "infinity" }}
              action={() => connectDevice(d)}
            >
              <HStack spacing={10} padding={{ vertical: 6 }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  {d.name === "(未命名)" ? (
                    <Text
                      font={17}
                      fontWeight="semibold"
                      multilineTextAlignment="leading"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {breakableId(d.peripheral.id)}
                    </Text>
                  ) : (
                    <Text font={17} fontWeight="semibold">{d.name}</Text>
                  )}
                  {d.name !== "(未命名)" ? (
                    <Text
                      font="footnote"
                      foregroundStyle={C.muted}
                      multilineTextAlignment="leading"
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      {breakableId(d.peripheral.id)}
                    </Text>
                  ) : null}
                  <Text font="footnote" foregroundStyle={C.muted}>RSSI {d.rssi}</Text>
                </VStack>
                <Spacer />
                <Text foregroundStyle={C.muted}>›</Text>
              </HStack>
            </Button>
          ))}
        </Card>
      </VStack>
    </ScrollView>
  )
}

// 新建模板页

function NewTemplatePage({ onSave }: {
  onSave: (t: LabelTemplate) => void
}) {
  const [w, setW] = useState("40")
  const [h, setH] = useState("30")
  const [gap, setGap] = useState("1")
  const [shape, setShape] = useState<"square" | "circle">("square")
  const [error, setError] = useState("")

  const limitDigits = (value: string, maxLength: number) => value.replace(/[^0-9]/g, "").slice(0, maxLength)
  const widthChanged = (value: string) => setW(limitDigits(value, 4))
  const heightChanged = (value: string) => setH(limitDigits(value, 4))
  const gapChanged = (value: string) => setGap(limitDigits(value, 1))

  const widthMm = parseFloat(w)
  const heightMm = parseFloat(h)
  const previewTpl: LabelTemplate = {
    id: "preview",
    widthMm: widthMm > 0 ? widthMm : 40,
    heightMm: heightMm > 0 ? heightMm : 30,
    gapMm: parseFloat(gap) || 0,
    shape,
    createdAt: 0,
  }

  const save = () => {
    if (!(widthMm > 0) || !(heightMm > 0)) { setError("宽高必须是大于 0 的数字"); return }
    if (!(parseFloat(gap) >= 0)) { setError("间距必须是不小于 0 的数字"); return }
    setError("")
    onSave({
      id: Date.now().toString(),
      widthMm,
      heightMm,
      gapMm: parseFloat(gap),
      shape,
      createdAt: Date.now(),
    })
  }

  return (
    <ScrollView
      navigationTitle="新建标签模板"
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            <Button title="保存" buttonStyle="borderedProminent" action={save} />
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        <Card title="预览" footer="按标签实际比例显示">
          <VStack frame={{ maxWidth: "infinity" }}>
            <LabelShape tpl={previewTpl} maxWidth={220} maxHeight={140} />
          </VStack>
        </Card>

        <Card title="尺寸与间距（毫米）">
          <HStack spacing={6} frame={{ maxWidth: "infinity", minHeight: 52, alignment: "center" }}>
            <HStack spacing={6} frame={{ width: 92, alignment: "center" }}>
              <Text font="footnote" fontWeight="semibold" fixedSize>宽度</Text>
              <TextField
                label={<Text> </Text>}
                value={w}
                onChanged={widthChanged}
                keyboardType="numberPad"
                textFieldStyle="roundedBorder"
                frame={{ maxWidth: "infinity" }}
              />
            </HStack>
            <Text foregroundStyle={C.muted} fixedSize>×</Text>
            <HStack spacing={6} frame={{ width: 92, alignment: "center" }}>
              <Text font="footnote" fontWeight="semibold" fixedSize>高度</Text>
              <TextField
                label={<Text> </Text>}
                value={h}
                onChanged={heightChanged}
                keyboardType="numberPad"
                textFieldStyle="roundedBorder"
                frame={{ maxWidth: "infinity" }}
              />
            </HStack>
            <HStack spacing={4} frame={{ width: 88, alignment: "center" }}>
              <Text font="footnote" fontWeight="semibold" fixedSize>间距</Text>
              <TextField
                label={<Text> </Text>}
                value={gap}
                onChanged={gapChanged}
                keyboardType="numberPad"
                textFieldStyle="roundedBorder"
                frame={{ maxWidth: "infinity" }}
              />
            </HStack>
          </HStack>
        </Card>

        <Card title="形状">
          <Picker value={shape} onChanged={(v: string) => setShape(v as "square" | "circle")} pickerStyle="segmented" title="形状">
            <Text tag="square">方形</Text>
            <Text tag="circle">圆形</Text>
          </Picker>
        </Card>

        {error ? (
          <Text font="footnote" foregroundStyle={C.danger}>{error}</Text>
        ) : null}

      </VStack>
    </ScrollView>
  )
}

// 文本输入页

function TextInputPage({ template, ppi, path, connected, appLog }: {
  template: LabelTemplate
  ppi: number
  path: NavPath
  connected: boolean
  appLog: (message: string) => void
}) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<"adjust" | "direct">("direct")
  const [directPrinting, setDirectPrinting] = useState(false)
  const [directProgress, setDirectProgress] = useState(0)
  const [directStatus, setDirectStatus] = useState("")
  const [alertShow, setAlertShow] = useState(false)
  const [alertTitle, setAlertTitle] = useState("")
  const [alertMsg, setAlertMsg] = useState("")
  const lines = text.split("\n").map(s => s.trim()).filter(s => s.length > 0)

  const next = () => {
    if (lines.length === 0) {
      appLog("未输入标签内容，无法进入数量设置")
      return
    }
    pendingTexts = lines
    appLog(`进入数量设置：${lines.length} 项`)
    path.setValue([...path.value, "qty:" + template.id])
  }

  const goConnect = () => {
    appLog("打开打印机选择页面")
    path.setValue([...path.value, "connect"])
  }

  const doDirectPrint = async () => {
    if (directPrinting) {
      appLog("直接打印任务仍在进行，本次点击已忽略")
      return
    }
    if (lines.length === 0) {
      appLog("点击开始打印，但没有可打印的标签内容")
      return
    }
    if (!connected) {
      appLog("点击开始打印时未连接打印机，转到打印机选择页面")
      goConnect()
      return
    }
    setDirectPrinting(true)
    setDirectProgress(0)
    setDirectStatus("准备打印…")
    const add = (m: string) => {
      setDirectStatus(m)
      appLog(`[直接打印] ${m}`)
    }
    const jobs = lines.map(text => ({ text, count: 1 }))
    appLog(`开始直接打印：模板=${template.widthMm}×${template.heightMm}mm，PPI=${ppi}，共 ${jobs.length} 项`)
    try {
      await printJobs(template, jobs, ppi, add, (completed) => setDirectProgress(completed))
      appLog(`直接打印完成：共 ${jobs.length} 项`)
      setAlertTitle("打印完成")
      setAlertMsg(jobs.map(j => j.text).join("，"))
      setAlertShow(true)
    } catch (e) {
      appLog(`直接打印失败: ${e}`)
      setAlertTitle("打印失败")
      setAlertMsg(String(e))
      setAlertShow(true)
    } finally {
      setDirectPrinting(false)
    }
  }

  const toolbarTitle = mode === "adjust"
    ? (lines.length > 0 ? `下一步（${lines.length} 项）` : "下一步")
    : connected
      ? (directPrinting ? "打印中…" : "打印")
      : "连接打印机"
  const toolbarAction = mode === "adjust"
    ? next
    : connected
      ? doDirectPrint
      : goConnect

  const previewText = lines[0] ?? "预览"

  return (
    <ScrollView
      navigationTitle="编辑标签"
      navigationBarTitleDisplayMode="inline"
      alert={{
        isPresented: alertShow,
        onChanged: setAlertShow,
        title: alertTitle,
        message: <Text>{alertMsg}</Text>,
        actions: <Button title="好" action={() => setAlertShow(false)} />,
      }}
      toolbar={
        <Toolbar>
          {connected
            ? (
              <ToolbarItem placement="topBarTrailing">
                <Button title="更换打印机" buttonStyle="bordered" action={goConnect} />
              </ToolbarItem>
            )
            : null}
          <ToolbarItem placement="topBarTrailing">
            <Button
              title={toolbarTitle}
              buttonStyle="borderedProminent"
              action={toolbarAction}
            />
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        {directPrinting ? (
          <Card title="当前状态">
            <Text font="footnote" foregroundStyle={C.muted}>{directStatus}</Text>
            <ProgressView
              value={directProgress}
              total={Math.max(1, lines.length)}
              progressViewStyle="linear"
              currentValueLabel={<Text>{directProgress}/{lines.length} 项</Text>}
            />
          </Card>
        ) : null}

        <Card title="预览">
          <VStack frame={{ maxWidth: "infinity" }} alignment="center">
            <LabelTextPreview template={template} text={previewText} maxWidth={240} maxHeight={140} />
          </VStack>
        </Card>

        <Card title="输入文本" footer="每行一个标签内容。文字会自动水平垂直居中、自动用最大字号，四周留 1.5mm 安全距离。">
          <TextField
            title="文本内容"
            prompt={"每行一个，例如：\n洗手液\n沐浴露"}
            axis="vertical"
            textFieldStyle="roundedBorder"
            lineLimit={{ min: 10, max: 20, reservesSpace: true }}
            frame={{ maxWidth: "infinity", minHeight: 200 }}
            value={text}
            onChanged={setText}
          />
        </Card>

        <Card title="打印设置" footer="调整数量：进入数量页逐个设置；直接打印：每行打印 1 张，跳过数量页。">
          <Picker value={mode} onChanged={(v: string) => setMode(v as "adjust" | "direct")} pickerStyle="segmented" title="打印设置">
            <Text tag="direct">直接打印</Text>
            <Text tag="adjust">调整数量</Text>
          </Picker>
        </Card>

      </VStack>
    </ScrollView>
  )
}

// 数量页

function QuantitiesPage({ template, ppi, path, connected, appLog }: {
  template: LabelTemplate
  ppi: number
  path: NavPath
  connected: boolean
  appLog: (message: string) => void
}) {
  const lines = pendingTexts
  const [countTexts, setCountTexts] = useState<string[]>(lines.map(() => "1"))
  const [printing, setPrinting] = useState(false)
  const [printProgress, setPrintProgress] = useState(0)
  const [printStatus, setPrintStatus] = useState("")
  const [alertShow, setAlertShow] = useState(false)
  const [alertTitle, setAlertTitle] = useState("")
  const [alertMsg, setAlertMsg] = useState("")

  const parseCount = (s: string) => {
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n > 0 ? n : 1
  }

  const setCountText = (i: number, v: string) => {
    setCountTexts(prev => prev.map((c, idx) => (idx === i ? v : c)))
  }

  const bump = (i: number, delta: number) => {
    setCountTexts(prev => prev.map((c, idx) => {
      if (idx !== i) return c
      return String(Math.max(1, parseCount(c) + delta))
    }))
  }

  const total = countTexts.reduce((a, s) => a + parseCount(s), 0)

  const doPrint = async () => {
    if (!connected) {
      appLog("数量页点击开始打印时未连接打印机，转到打印机选择页面")
      path.setValue([...path.value, "connect"])
      return
    }
    if (printing) {
      appLog("打印任务仍在进行，本次点击已忽略")
      return
    }
    setPrinting(true)
    setPrintProgress(0)
    setPrintStatus("准备打印…")
    const add = (m: string) => {
      setPrintStatus(m)
      appLog(`[数量打印] ${m}`)
    }
    const jobs = lines.map((text, i) => ({ text, count: parseCount(countTexts[i] ?? "1") }))
    appLog(`开始数量打印：模板=${template.widthMm}×${template.heightMm}mm，PPI=${ppi}，${jobs.length} 项，共 ${total} 张`)
    try {
      await printJobs(template, jobs, ppi, add, (completed) => setPrintProgress(completed))
      appLog(`数量打印完成：${jobs.length} 项，共 ${total} 张`)
      setAlertTitle("打印完成")
      setAlertMsg(jobs.map(j => `${j.text} × ${j.count}`).join("，"))
      setAlertShow(true)
    } catch (e) {
      appLog(`数量打印失败: ${e}`)
      setAlertTitle("打印失败")
      setAlertMsg(String(e))
      setAlertShow(true)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <ScrollView
      navigationTitle={`共 ${total} 张标签`}
      navigationBarTitleDisplayMode="inline"
      alert={{
        isPresented: alertShow,
        onChanged: setAlertShow,
        title: alertTitle,
        message: <Text>{alertMsg}</Text>,
        actions: <Button title="好" action={() => setAlertShow(false)} />,
      }}
      toolbar={
        <Toolbar>
          {connected
            ? (
              <ToolbarItem placement="topBarTrailing">
                <Button title="更换打印机" buttonStyle="bordered" action={() => path.setValue([...path.value, "connect"])} />
              </ToolbarItem>
            )
            : null}
          <ToolbarItem placement="topBarTrailing">
            {connected
              ? <Button
                  title={printing ? "打印中…" : "打印"}
                  buttonStyle="borderedProminent"
                  action={doPrint}
                />
              : <Button
                  title="连接打印机"
                  buttonStyle="borderedProminent"
                  action={() => path.setValue([...path.value, "connect"])}
                />}
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        {printing ? (
          <Card title="当前状态">
            <Text font="footnote" foregroundStyle={C.muted}>{printStatus}</Text>
            <ProgressView
              value={printProgress}
              total={Math.max(1, lines.length)}
              progressViewStyle="linear"
              currentValueLabel={<Text>{printProgress}/{lines.length} 项</Text>}
            />
          </Card>
        ) : null}

        <Card title="内容与数量">
          {lines.map((line, i) => (
            <HStack key={i} spacing={12}>
              <LabelTextPreview template={template} text={line} maxWidth={88} maxHeight={60} />
              <Spacer />
              <Stepper onIncrement={() => bump(i, 1)} onDecrement={() => bump(i, -1)}>
                <TextField
                  title="数量"
                  keyboardType="numberPad"
                  textFieldStyle="roundedBorder"
                  frame={{ width: 64 }}
                  value={countTexts[i] ?? "1"}
                  onChanged={(v: string) => setCountText(i, v)}
                />
              </Stepper>
            </HStack>
          ))}
        </Card>

      </VStack>
    </ScrollView>
  )
}

// 日志页

function LogPage({ logs }: { logs: string[] }) {
  const content = logs.length > 0 ? logs.join("\n") : "暂无日志"
  return (
    <ScrollView navigationTitle="日志" navigationBarTitleDisplayMode="inline">
      <Text
        font="footnote"
        foregroundStyle="label"
        multilineTextAlignment="leading"
        textSelection
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        padding={16}
      >
        {content}
      </Text>
    </ScrollView>
  )
}

// 入口

async function run() {
  await Navigation.present(<HomeView />)
  Script.exit()
}

run()

export default HomeView
