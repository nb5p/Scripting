import {
  Button,
  Picker,
  ProgressView,
  ScrollView,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  useState,
  VStack,
} from "scripting"
import { Card } from "../components/Card"
import { LabelTextPreview } from "../components/LabelTextPreview"
import { COLORS } from "../domain/constants"
import type {
  AppLogger,
  LabelTemplate,
  NavigationPath,
} from "../domain/types"
import { printJobs } from "../services/printJobs"
import { setPrintDraft } from "../state/printDraft"
import { parseLabelLines } from "../utils/format"

interface TextInputPageProps {
  template: LabelTemplate
  ppi: number
  path: NavigationPath
  connected: boolean
  appLog: AppLogger
}

export function TextInputPage({
  template,
  ppi,
  path,
  connected,
  appLog,
}: TextInputPageProps) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<"adjust" | "direct">("direct")
  const [directPrinting, setDirectPrinting] = useState(false)
  const [directProgress, setDirectProgress] = useState(0)
  const [directProgressTotal, setDirectProgressTotal] = useState(1)
  const [directStatus, setDirectStatus] = useState("")
  const [alertShow, setAlertShow] = useState(false)
  const [alertTitle, setAlertTitle] = useState("")
  const [alertMessage, setAlertMessage] = useState("")
  const lines = parseLabelLines(text)

  const goConnect = () => {
    appLog("打开打印机选择页面")
    path.setValue([...path.value, "connect"])
  }

  const next = () => {
    if (lines.length === 0) {
      appLog("未输入标签内容，无法进入数量设置")
      return
    }
    setPrintDraft(lines)
    appLog(`进入数量设置：${lines.length} 项`)
    path.setValue([...path.value, `qty:${template.id}`])
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
    setDirectProgressTotal(Math.ceil(lines.length / template.columns))
    setDirectStatus("准备打印…")
    const updateStatus = (message: string) => {
      setDirectStatus(message)
      appLog(`[直接打印] ${message}`)
    }
    const jobs = lines.map(line => ({ text: line, count: 1 }))
    appLog(`开始直接打印：模板=${template.widthMm}×${template.heightMm}mm，${template.columns} 列，PPI=${ppi}，共 ${jobs.length} 项`)
    try {
      await printJobs(
        template,
        jobs,
        ppi,
        updateStatus,
        (completed, totalRows) => {
          setDirectProgress(completed)
          setDirectProgressTotal(totalRows)
        },
      )
      appLog(`直接打印完成：共 ${jobs.length} 项`)
      setAlertTitle("打印完成")
      setAlertMessage(jobs.map(job => job.text).join("，"))
      setAlertShow(true)
    } catch (error) {
      appLog(`直接打印失败: ${error}`)
      setAlertTitle("打印失败")
      setAlertMessage(String(error))
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
        message: <Text>{alertMessage}</Text>,
        actions: <Button title="好" action={() => setAlertShow(false)} />,
      }}
      toolbar={
        <Toolbar>
          {connected ? (
            <ToolbarItem placement="topBarTrailing">
              <Button title="更换打印机" buttonStyle="bordered" action={goConnect} />
            </ToolbarItem>
          ) : null}
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
            <Text font="footnote" foregroundStyle={COLORS.muted}>
              {directStatus}
            </Text>
            <ProgressView
              value={directProgress}
              total={directProgressTotal}
              progressViewStyle="linear"
              currentValueLabel={<Text>{directProgress}/{directProgressTotal} 行</Text>}
            />
          </Card>
        ) : null}

        <Card title="预览">
          <VStack frame={{ maxWidth: "infinity" }} alignment="center">
            <LabelTextPreview
              template={template}
              text={previewText}
              maxWidth={240}
              maxHeight={140}
            />
          </VStack>
        </Card>

        <Card
          title="输入文本"
          footer="每行一个标签内容。文字会自动水平垂直居中、自动用最大字号，四周留 1.5mm 安全距离。"
        >
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

        <Card
          title="打印设置"
          footer="调整数量：进入数量页逐个设置；直接打印：每行打印 1 张，跳过数量页。"
        >
          <Picker
            value={mode}
            onChanged={(value: string) => setMode(value as "adjust" | "direct")}
            pickerStyle="segmented"
            title="打印设置"
          >
            <Text tag="direct">直接打印</Text>
            <Text tag="adjust">调整数量</Text>
          </Picker>
        </Card>
      </VStack>
    </ScrollView>
  )
}
