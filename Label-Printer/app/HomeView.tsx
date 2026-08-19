import {
  Button,
  HStack,
  List,
  NavigationDestination,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  Toggle,
  useEffect,
  useObservable,
  useState,
  VStack,
} from "scripting"
import { HeroCard } from "../components/HeroCard"
import { LabelShape } from "../components/LabelShape"
import { usePrinterController } from "../controllers/usePrinterController"
import { COLORS } from "../domain/constants"
import type {
  LabelTemplate,
  PersistedState,
} from "../domain/types"
import { ConnectPage } from "../pages/ConnectPage"
import { LogPage } from "../pages/LogPage"
import { NewTemplatePage } from "../pages/NewTemplatePage"
import { QuantitiesPage } from "../pages/QuantitiesPage"
import { ScanPage } from "../pages/ScanPage"
import { TextInputPage } from "../pages/TextInputPage"
import { loadState, saveState } from "../services/persistence"

export function HomeView() {
  const path = useObservable<string[]>([])
  const [state, setState] = useState<PersistedState>(() => loadState())
  const [logs, setLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] 应用已启动，等待连接打印机…`,
  ])

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString()
    setLogs(previous => [...previous, `[${time}] ${message}`])
  }

  const addKnownPrinter = (id: string, name: string) => {
    setState(previous => {
      const exists = previous.knownPrinters.some(printer => printer.id === id)
      const next: PersistedState = {
        ...previous,
        settings: { ...previous.settings, lastPrinterId: id },
        knownPrinters: exists
          ? previous.knownPrinters.map(printer => (
              printer.id === id && printer.name !== name
                ? { ...printer, name }
                : printer
            ))
          : [...previous.knownPrinters, { id, name }],
      }
      saveState(next)
      return next
    })
  }

  const printer = usePrinterController({
    appLog: addLog,
    onConnected: addKnownPrinter,
  })

  const updatePpi = (ppi: number) => {
    const next = { ...state, settings: { ...state.settings, ppi } }
    setState(next)
    saveState(next)
    addLog(`打印精度已改为 ${ppi} PPI`)
  }

  const setAutoConnect = (autoConnect: boolean) => {
    const next = {
      ...state,
      settings: { ...state.settings, autoConnect },
    }
    setState(next)
    saveState(next)
    addLog(`打开App自动连接上次设备：${autoConnect ? "开启" : "关闭"}`)
  }

  const deleteTemplate = (id: string) => {
    const template = state.templates.find(item => item.id === id)
    const next = {
      ...state,
      templates: state.templates.filter(item => item.id !== id),
    }
    setState(next)
    saveState(next)
    addLog(`已删除模板 ${template ? `${template.widthMm}×${template.heightMm}mm` : id}`)
  }

  const removeKnownPrinter = (id: string) => {
    const knownPrinter = state.knownPrinters.find(item => item.id === id)
    const next = {
      ...state,
      settings: state.settings.lastPrinterId === id
        ? { ...state.settings, lastPrinterId: "" }
        : state.settings,
      knownPrinters: state.knownPrinters.filter(item => item.id !== id),
    }
    setState(next)
    saveState(next)
    addLog(`已移除历史打印机 ${knownPrinter?.name ?? id}（${id}）`)
  }

  const clearLogs = () => {
    const time = new Date().toLocaleTimeString()
    setLogs([`[${time}] 日志已清空`])
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

  const saveTemplate = (template: LabelTemplate) => {
    const next = { ...state, templates: [...state.templates, template] }
    setState(next)
    saveState(next)
    addLog(`已创建模板 ${template.widthMm}×${template.heightMm}mm，${template.columns} 列`)
    path.setValue([])
  }

  const openConnectPage = () => {
    addLog("打开打印机管理页面")
    path.setValue(["connect"])
  }

  useEffect(() => {
    if (
      !state.settings.autoConnect
      || !state.settings.lastPrinterId
      || printer.isConnected
    ) return

    const entry = state.knownPrinters.find(
      knownPrinter => knownPrinter.id === state.settings.lastPrinterId,
    )
    if (!entry) {
      addLog(`自动连接跳过：上次设备记录不存在（${state.settings.lastPrinterId}）`)
      return
    }
    addLog(`打开App，自动连接上次设备：${entry.name}`)
    printer.connectKnownPrinter(entry)
  }, [])

  return (
    <NavigationStack path={path}>
      <List
        navigationTitle="标签打印"
        navigationBarTitleDisplayMode="inline"
        listStyle="insetGroup"
        contentMargins={{
          edges: "top",
          insets: { top: 2, leading: 0, bottom: 0, trailing: 0 },
        }}
        navigationDestination={
          <NavigationDestination>
            {page => {
              if (page === "new") {
                return <NewTemplatePage onSave={saveTemplate} />
              }
              if (page === "logs") {
                return <LogPage logs={logs} />
              }
              if (page === "connect") {
                return (
                  <ConnectPage
                    busy={printer.busy}
                    connectedName={printer.connectedName}
                    connectedId={printer.connectedId}
                    connectingName={printer.connectingName}
                    knownPrinters={state.knownPrinters}
                    onScanPage={() => {
                      addLog("打开扫描打印机页面")
                      path.setValue([...path.value, "scan"])
                    }}
                    connectKnownPrinter={printer.connectKnownPrinter}
                    removeKnownPrinter={removeKnownPrinter}
                    disconnect={printer.disconnect}
                  />
                )
              }
              if (page === "scan") {
                return (
                  <ScanPage
                    devices={printer.devices}
                    scanning={printer.scanning}
                    busy={printer.busy}
                    startScan={printer.startScan}
                    stopScan={printer.stopScan}
                    connectDevice={printer.connectDevice}
                  />
                )
              }
              if (page.startsWith("tpl:")) {
                const template = state.templates.find(
                  item => item.id === page.slice(4),
                )
                if (!template) return <Text>模板不存在</Text>
                return (
                  <TextInputPage
                    template={template}
                    ppi={state.settings.ppi}
                    path={path}
                    connected={printer.isConnected}
                    appLog={addLog}
                  />
                )
              }
              if (page.startsWith("qty:")) {
                const template = state.templates.find(
                  item => item.id === page.slice(4),
                )
                if (!template) return <Text>模板不存在</Text>
                return (
                  <QuantitiesPage
                    template={template}
                    ppi={state.settings.ppi}
                    path={path}
                    connected={printer.isConnected}
                    appLog={addLog}
                  />
                )
              }
              return <Text>未知页面</Text>
            }}
          </NavigationDestination>
        }
      >
        <HeroCard
          connected={printer.isConnected}
          connectingName={printer.connectingName}
          onConnect={openConnectPage}
        />

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
              <Text font="footnote" foregroundStyle={COLORS.muted}>
                还没有模板，点上面的「新建模板」创建第一个
              </Text>
              <Spacer />
            </HStack>
          ) : null}
          {state.templates.map(template => (
            <HStack
              key={template.id}
              trailingSwipeActions={{
                allowsFullSwipe: false,
                actions: [
                  <Button
                    title="删除"
                    role="destructive"
                    action={() => deleteTemplate(template.id)}
                  />,
                ],
              }}
            >
              <Button
                buttonStyle="borderless"
                frame={{ maxWidth: "infinity" }}
                action={() => {
                  addLog(`打开模板 ${template.widthMm}×${template.heightMm}mm，${template.columns} 列`)
                  path.setValue([`tpl:${template.id}`])
                }}
              >
                <HStack spacing={12} padding={{ vertical: 6 }}>
                  <VStack
                    padding={8}
                    background={COLORS.cardAlt}
                    clipShape={{ type: "rect", cornerRadius: 12 }}
                  >
                    <LabelShape tpl={template} maxWidth={40} maxHeight={40} />
                  </VStack>
                  <VStack
                    alignment="leading"
                    spacing={3}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                  >
                    <Text font={17} fontWeight="semibold">
                      {template.widthMm}×{template.heightMm}mm
                    </Text>
                    <Text font="footnote" foregroundStyle={COLORS.muted}>
                      间距 {template.gapMm}mm · {template.columns} 列 · {template.shape === "circle" ? "圆形" : "方形"}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text foregroundStyle={COLORS.muted}>›</Text>
                </HStack>
              </Button>
            </HStack>
          ))}
        </Section>

        <Section header={<Text fontWeight="bold">设置</Text>}>
          <HStack spacing={12}>
            <Text fontWeight="semibold">打印分辨率</Text>
            <Picker
              value={String(state.settings.ppi)}
              onChanged={(value: string) => updatePpi(parseInt(value, 10))}
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

        <Section
          header={<Text fontWeight="bold">日志</Text>}
          footer={<Text>共 {logs.length} 条 · 点「查看日志」在新窗口查看内容</Text>}
        >
          <HStack spacing={12}>
            <Button
              title="查看日志"
              buttonStyle="borderedProminent"
              frame={{ maxWidth: "infinity" }}
              action={() => path.setValue(["logs"])}
            />
            <Button
              title="清空日志"
              buttonStyle="bordered"
              frame={{ maxWidth: "infinity" }}
              action={clearLogs}
            />
            <Button
              title="复制日志"
              buttonStyle="bordered"
              frame={{ maxWidth: "infinity" }}
              action={copyLogs}
            />
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}
