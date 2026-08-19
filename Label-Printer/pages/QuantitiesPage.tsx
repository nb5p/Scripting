import {
  Button,
  HStack,
  ProgressView,
  ScrollView,
  Spacer,
  Stepper,
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
import { getPrintDraft } from "../state/printDraft"
import { parsePositiveCount } from "../utils/format"

interface QuantitiesPageProps {
  template: LabelTemplate
  ppi: number
  path: NavigationPath
  connected: boolean
  appLog: AppLogger
}

export function QuantitiesPage({
  template,
  ppi,
  path,
  connected,
  appLog,
}: QuantitiesPageProps) {
  const lines = getPrintDraft()
  const [countTexts, setCountTexts] = useState<string[]>(lines.map(() => "1"))
  const [printing, setPrinting] = useState(false)
  const [printProgress, setPrintProgress] = useState(0)
  const [printProgressTotal, setPrintProgressTotal] = useState(1)
  const [printStatus, setPrintStatus] = useState("")
  const [alertShow, setAlertShow] = useState(false)
  const [alertTitle, setAlertTitle] = useState("")
  const [alertMessage, setAlertMessage] = useState("")

  const setCountText = (index: number, value: string) => {
    setCountTexts(previous => previous.map((count, currentIndex) => (
      currentIndex === index ? value : count
    )))
  }

  const bump = (index: number, delta: number) => {
    setCountTexts(previous => previous.map((count, currentIndex) => {
      if (currentIndex !== index) return count
      return String(Math.max(1, parsePositiveCount(count) + delta))
    }))
  }

  const total = countTexts.reduce(
    (sum, count) => sum + parsePositiveCount(count),
    0,
  )

  const goConnect = () => {
    path.setValue([...path.value, "connect"])
  }

  const doPrint = async () => {
    if (!connected) {
      appLog("数量页点击开始打印时未连接打印机，转到打印机选择页面")
      goConnect()
      return
    }
    if (printing) {
      appLog("打印任务仍在进行，本次点击已忽略")
      return
    }

    setPrinting(true)
    setPrintProgress(0)
    setPrintProgressTotal(Math.ceil(total / template.columns))
    setPrintStatus("准备打印…")
    const updateStatus = (message: string) => {
      setPrintStatus(message)
      appLog(`[数量打印] ${message}`)
    }
    const jobs = lines.map((line, index) => ({
      text: line,
      count: parsePositiveCount(countTexts[index] ?? "1"),
    }))
    appLog(`开始数量打印：模板=${template.widthMm}×${template.heightMm}mm，${template.columns} 列，PPI=${ppi}，${jobs.length} 项，共 ${total} 张`)
    try {
      await printJobs(
        template,
        jobs,
        ppi,
        updateStatus,
        (completed, totalRows) => {
          setPrintProgress(completed)
          setPrintProgressTotal(totalRows)
        },
      )
      appLog(`数量打印完成：${jobs.length} 项，共 ${total} 张`)
      setAlertTitle("打印完成")
      setAlertMessage(jobs.map(job => `${job.text} × ${job.count}`).join("，"))
      setAlertShow(true)
    } catch (error) {
      appLog(`数量打印失败: ${error}`)
      setAlertTitle("打印失败")
      setAlertMessage(String(error))
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
            {connected ? (
              <Button
                title={printing ? "打印中…" : "打印"}
                buttonStyle="borderedProminent"
                action={doPrint}
              />
            ) : (
              <Button
                title="连接打印机"
                buttonStyle="borderedProminent"
                action={goConnect}
              />
            )}
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        {printing ? (
          <Card title="当前状态">
            <Text font="footnote" foregroundStyle={COLORS.muted}>
              {printStatus}
            </Text>
            <ProgressView
              value={printProgress}
              total={printProgressTotal}
              progressViewStyle="linear"
              currentValueLabel={<Text>{printProgress}/{printProgressTotal} 行</Text>}
            />
          </Card>
        ) : null}

        <Card title="内容与数量">
          {lines.map((line, index) => (
            <HStack key={index} spacing={12}>
              <LabelTextPreview
                template={template}
                text={line}
                maxWidth={88}
                maxHeight={60}
              />
              <Spacer />
              <Stepper
                onIncrement={() => bump(index, 1)}
                onDecrement={() => bump(index, -1)}
              >
                <TextField
                  title="数量"
                  keyboardType="numberPad"
                  textFieldStyle="roundedBorder"
                  frame={{ width: 64 }}
                  value={countTexts[index] ?? "1"}
                  onChanged={(value: string) => setCountText(index, value)}
                />
              </Stepper>
            </HStack>
          ))}
        </Card>
      </VStack>
    </ScrollView>
  )
}
