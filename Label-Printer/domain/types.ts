export interface LabelTemplate {
  id: string
  widthMm: number
  heightMm: number
  gapMm: number
  columns: 1 | 2
  shape: "square" | "circle"
  createdAt: number
}

export interface AppSettings {
  ppi: number
  autoConnect: boolean
  lastPrinterId: string
}

export interface KnownPrinter {
  id: string
  name: string
}

export interface PersistedState {
  templates: LabelTemplate[]
  settings: AppSettings
  knownPrinters: KnownPrinter[]
}

export interface PrinterSession {
  peripheral: BluetoothPeripheral
  writeChar: BluetoothCharacteristic
  name: string
  connectionToken: number
}

export interface DiscoveredPrinter {
  peripheral: BluetoothPeripheral
  name: string
  rssi: number
  advServices: string[]
}

export interface BitmapData {
  bytesPerRow: number
  height: number
  hex: string
}

export interface PrintJob {
  text: string
  count: number
}

export interface NavigationPath {
  value: string[]
  setValue: (value: string[]) => void
}

export type AppLogger = (message: string) => void
