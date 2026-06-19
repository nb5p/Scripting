import {
  fetch,
  Intent,
  Script,
  Navigation,
  NavigationStack,
  VStack,
  HStack,
  Text,
  Button,
  ProgressView,
  Spacer,
  List,
  Section,
  useState,
  useEffect,
} from "scripting"

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1"

const DOUYIN_URL_REGEX =
  /https?:\/\/(?:v\.douyin\.com|www\.iesdouyin\.com|www\.douyin\.com)\/[^\s<>"{}|\\^`\[\]]+/

const IS_ZH = Device.systemLanguageCode.toLowerCase().startsWith("zh")

function L(zh: string, en: string): string {
  return IS_ZH ? zh : en
}

interface ParseResult {
  videoId: string
  title: string
  downloadUrl: string
  shareUrl: string
  type: "video" | "images"
}

type StepState =
  | { type: "loading"; message: string }
  | { type: "success"; info: ParseResult; filePath: string; albumSaved: boolean }
  | { type: "error"; message: string }

function extractFirstUrl(text: string): string | null {
  const match = text.match(DOUYIN_URL_REGEX)
  return match ? match[0] : null
}

function sanitizeTitle(title: string, videoId: string): string {
  let clean = title.replace(/[\\/:*?"<>|]/g, "_")
  if (clean.length > 30) {
    const topics = clean.match(/#(\w+)/g)
    if (topics && topics.length > 0) {
      clean = topics[0].replace("#", "")
    } else {
      const vidShort = videoId.length >= 4 ? videoId.slice(-4) : videoId
      clean = "dy_" + vidShort
    }
  }
  return clean
}

function parseVideoIdFromFinalUrl(finalUrl: string): string {
  const path = finalUrl.split("?")[0]
  const parts = path.split("/").filter((p) => p.length > 0)
  if (parts.length === 0) {
    throw new Error("重定向URL路径异常: " + finalUrl)
  }
  let last = parts[parts.length - 1]
  if ((last === "video" || last === "note") && parts.length >= 2) {
    last = parts[parts.length - 2]
  }
  return last
}

function extractRouterDataJson(html: string): any {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s)
  if (!match || !match[1]) {
    throw new Error("从HTML中解析视频信息失败（未找到 window._ROUTER_DATA）")
  }
  const raw = match[1].trim().replace(/;+$/, "")
  try {
    return JSON.parse(raw)
  } catch (e: any) {
    throw new Error("解析 JSON 失败: " + e.message)
  }
}

function pickVideoInfoRes(routerData: any): any {
  const loaderData = routerData?.loaderData
  if (!loaderData || typeof loaderData !== "object") {
    throw new Error("window._ROUTER_DATA 结构异常（缺少 loaderData）")
  }

  for (const key of ["video_(id)/page", "note_(id)/page"]) {
    if (loaderData[key]?.videoInfoRes) {
      return loaderData[key].videoInfoRes
    }
  }

  for (const v of Object.values(loaderData)) {
    if (v && typeof v === "object" && (v as any).videoInfoRes) {
      return (v as any).videoInfoRes
    }
  }

  throw new Error("无法从 loaderData 中定位 videoInfoRes")
}

async function parseDouyinShareText(shareText: string): Promise<ParseResult> {
  const shareUrl = extractFirstUrl(shareText)
  if (!shareUrl) {
    throw new Error("未找到有效的分享链接")
  }

  const resp1 = await fetch(shareUrl, {
    headers: { "User-Agent": IPHONE_UA },
    timeout: 30,
    allowInsecureRequest: true,
  })
  if (!resp1.ok) {
    throw new Error("访问分享链接失败: HTTP " + resp1.status)
  }

  const finalUrl = resp1.url
  const videoId = parseVideoIdFromFinalUrl(finalUrl)

  const pageUrl = "https://www.iesdouyin.com/share/video/" + videoId
  const resp2 = await fetch(pageUrl, {
    headers: { "User-Agent": IPHONE_UA },
    timeout: 30,
    allowInsecureRequest: true,
  })
  if (!resp2.ok) {
    throw new Error("访问分享页失败: HTTP " + resp2.status)
  }

  const html = await resp2.text()
  const routerData = extractRouterDataJson(html)
  const videoInfoRes = pickVideoInfoRes(routerData)

  const itemList = videoInfoRes?.item_list
  if (!itemList || itemList.length === 0) {
    throw new Error("无法读取视频数据")
  }

  const item = itemList[0]
  const urlList: string[] = item?.video?.play_addr?.url_list
  if (!urlList || urlList.length === 0) {
    throw new Error("无法读取播放地址")
  }

  const rawPlayUrl = urlList[0]
  const desc = (item?.desc || "").trim() || "douyin_" + videoId
  const title = sanitizeTitle(desc, videoId)
  // Douyin watermark URLs usually contain "playwm"; replacing it with "play" returns the clean video URL.
  const downloadUrl = rawPlayUrl.replace("playwm", "play")

  return {
    videoId,
    title,
    downloadUrl,
    shareUrl,
    type: "video",
  }
}

async function downloadVideo(url: string, outputPath: string): Promise<string> {
  const lastSlash = outputPath.lastIndexOf("/")
  if (lastSlash > 0) {
    const dir = outputPath.substring(0, lastSlash)
    FileManager.createDirectorySync(dir, true)
  }

  const resp = await fetch(url, {
    headers: {
      "User-Agent": IPHONE_UA,
      Referer: "https://www.douyin.com/",
    },
    timeout: 120,
    allowInsecureRequest: true,
  })

  if (!resp.ok) {
    throw new Error("下载失败: HTTP " + resp.status)
  }

  const data = await resp.data()
  FileManager.writeAsDataSync(outputPath, data)
  return outputPath
}

function getInputText(): string | null {
  const sp = Intent.shortcutParameter
  if (sp) {
    if (sp.type === "text" && typeof sp.value === "string" && sp.value.trim()) {
      return sp.value
    }
    if (sp.type === "fileURL" && typeof sp.value === "string" && sp.value.trim()) {
      return sp.value
    }
    if (sp.type === "json") {
      const v: any = sp.value
      if (typeof v === "string" && v.trim()) return v
      if (typeof v === "object" && v !== null) {
        const textVal = v.text || v.url || v.content || v.input
        if (typeof textVal === "string" && textVal.trim()) return textVal
      }
    }
  }

  if (Intent.urlsParameter && Intent.urlsParameter.length > 0) {
    return Intent.urlsParameter[0]
  }

  if (Intent.textsParameter && Intent.textsParameter.length > 0) {
    return Intent.textsParameter[0]
  }

  return null
}

let exitMessage = L("处理完成", "Done")
let exitResult: any = null

function IntentView() {
  const [step, setStep] = useState<StepState>({ type: "loading", message: L("正在准备...", "Preparing...") })
  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    process()
  }, [])

  async function process() {
    let inputText = getInputText()
    if (!inputText) {
      try {
        inputText = (await Pasteboard.getString()) || ""
      } catch {
        inputText = ""
      }
    }

    if (!inputText.trim()) {
      exitMessage = L("未收到任何输入，且剪切板为空", "No input received, and the clipboard is empty")
      setStep({ type: "error", message: exitMessage })
      return
    }

    const url = extractFirstUrl(inputText)
    if (!url) {
      exitMessage = L("输入文本中未找到抖音链接", "No Douyin link was found in the input text")
      setStep({ type: "error", message: exitMessage })
      return
    }

    setStep({ type: "loading", message: L("正在解析链接...", "Parsing link...") })
    let info: ParseResult
    try {
      info = await parseDouyinShareText(inputText)
    } catch (e: any) {
      exitMessage = L("解析失败: ", "Parse failed: ") + (e?.message || String(e))
      setStep({ type: "error", message: exitMessage })
      return
    }

    setStep({ type: "loading", message: `${L("正在下载", "Downloading")}: ${info.title}` })
    const outputPath = FileManager.documentsDirectory + "/" + info.title + ".mp4"
    let filePath: string
    try {
      filePath = await downloadVideo(info.downloadUrl, outputPath)
    } catch (e: any) {
      exitMessage = L("下载失败: ", "Download failed: ") + (e?.message || String(e))
      setStep({ type: "error", message: exitMessage })
      return
    }

    let albumSaved = false
    try {
      await Photos.saveVideo(filePath)
      albumSaved = true
    } catch {
      // Keep the downloaded file available even if saving to Photos fails.
    }

    exitMessage = `✅ ${L("下载完成", "Download complete")}: ${info.title}`
    exitResult = {
      success: true,
      title: info.title,
      videoId: info.videoId,
      filePath,
      albumSaved,
    }
    setStep({ type: "success", info, filePath, albumSaved })
  }

  function handleDone() {
    dismiss()
  }

  if (step.type === "loading") {
    return (
      <NavigationStack>
        <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="large">
          <Section>
            <HStack alignment="center">
              <Spacer />
              <VStack alignment="center" spacing={16} padding={{ top: 60, bottom: 60 }}>
                <ProgressView />
                <VStack alignment="center" spacing={4}>
                  <Text font="headline">{L("快捷指令模式", "Shortcut Mode")}</Text>
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    {step.message}
                  </Text>
                </VStack>
              </VStack>
              <Spacer />
            </HStack>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  if (step.type === "error") {
    return (
      <NavigationStack>
        <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="large">
          <Section>
            <HStack alignment="center">
              <Spacer />
              <VStack alignment="center" spacing={16} padding={{ top: 48, bottom: 48 }}>
                <Text font="headline">❌ {L("处理失败", "Failed")}</Text>
                <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                  {step.message}
                </Text>
                <Button title={L("完成", "Done")} action={handleDone} />
              </VStack>
              <Spacer />
            </HStack>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="inline">
        <Section>
          <HStack alignment="center">
            <Spacer />
            <VStack alignment="center" spacing={12} padding={{ top: 24, bottom: 16 }}>
              <Text font="title2" bold={true}>✅ {L("下载完成", "Download Complete")}</Text>
              <Text font="callout">{step.info.title}</Text>
              {step.albumSaved ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {L("已保存到系统相册", "Saved to Photos")}
                </Text>
              ) : (
                <Text font="caption" foregroundStyle="systemOrange">
                  {L("相册保存失败，文件已保存到：", "Failed to save to Photos. File saved at: ")}{step.filePath}
                </Text>
              )}
            </VStack>
            <Spacer />
          </HStack>
        </Section>
        <Section header={<Text>{L("视频信息", "Video Info")}</Text>}>
          <VStack alignment="leading" spacing={2}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">ID</Text>
            <Text font="callout">{step.info.videoId}</Text>
          </VStack>
          <VStack alignment="leading" spacing={2}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">{L("类型", "Type")}</Text>
            <Text font="callout">{step.info.type === "images" ? L("图集", "Images") : L("视频", "Video")}</Text>
          </VStack>
        </Section>
        <Section>
          <Button title={L("完成", "Done")} action={handleDone} />
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({ element: <IntentView /> })
  if (exitResult) {
    Script.exit(Intent.json(exitResult))
  } else {
    Script.exit(Intent.text(exitMessage))
  }
}

run().catch((e: any) => {
  console.log("[Douyin Intent] error:", e?.message || e)
  Script.exit(Intent.text(L("异常: ", "Error: ") + (e?.message || String(e))))
})
