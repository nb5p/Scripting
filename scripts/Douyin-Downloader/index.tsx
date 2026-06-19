import {
  fetch,
  VStack,
  HStack,
  Text,
  Button,
  ProgressView,
  Spacer,
  useState,
  Navigation,
  NavigationStack,
  List,
  Section,
  Script,
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

type PageState =
  | { type: "idle" }
  | { type: "parsing" }
  | { type: "no_link"; clipText: string }
  | { type: "parsed"; info: ParseResult }
  | { type: "downloading"; info: ParseResult; withTranscription: boolean }
  | { type: "transcribing"; info: ParseResult; filePath: string }
  | { type: "success"; info: ParseResult; filePath: string; transcriptText?: string; transcriptPath?: string; transcriptError?: string; optimizedText?: string; isOptimizing?: boolean }
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
  const desc = (item?.desc || "").trim() || ("douyin_" + videoId)
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

function pickLocale(): string {
  const supported = SpeechRecognition.supportedLocales
  if (supported.includes("zh-CN")) return "zh-CN"
  const devLang = Device.systemLanguageCode
  if (devLang && supported.includes(devLang)) return devLang
  if (supported.includes("en-US")) return "en-US"
  return supported[0] || "en-US"
}

async function getVideoDurationSeconds(filePath: string): Promise<number> {
  const asset = new AVAsset(filePath)
  try {
    const dur = await asset.loadDuration()
    return dur.seconds
  } finally {
    asset.dispose()
  }
}

function transcribeSegment(
  filePath: string,
  locale: string,
  timeoutMs: number
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        SpeechRecognition.stop().catch(() => {})
        reject(new Error(L("段落转录超时", "Segment transcription timed out")))
      }
    }, timeoutMs)

    SpeechRecognition.recognizeFile({
      filePath,
      locale,
      addsPunctuation: true,
      taskHint: "dictation",
      onResult: (result: SpeechRecognitionResult) => {
        if (result.isFinal) {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve((result.text || "").trim())
        }
      },
    }).then((started) => {
      if (!started && !done) {
        done = true
        clearTimeout(timer)
        reject(new Error(L("语音识别未能启动", "Speech recognition failed to start")))
      }
    }).catch((e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(e)
      }
    })
  })
}

async function transcribeMediaFile(filePath: string): Promise<string> {
  const locale = pickLocale()
  const SEGMENT_SECONDS = 50

  let totalDuration: number
  try {
    totalDuration = await getVideoDurationSeconds(filePath)
  } catch {
    totalDuration = 0
  }

  if (totalDuration <= 0 || totalDuration <= SEGMENT_SECONDS) {
    const segDur = totalDuration > 0 ? totalDuration : 60
    const timeoutMs = Math.max(segDur * 1200 + 30000, 180000)
    return transcribeSegment(filePath, locale, timeoutMs)
  }

  const tmpDir = FileManager.temporaryDirectory
  const asset = new AVAsset(filePath)
  const segments: string[] = []
  try {
    const segCount = Math.ceil(totalDuration / SEGMENT_SECONDS)
    for (let i = 0; i < segCount; i++) {
      const start = i * SEGMENT_SECONDS
      const dur = Math.min(SEGMENT_SECONDS, totalDuration - start)
      const segPath = tmpDir + "/dy_seg_" + i + ".m4a"

      const session = new AVAssetExportSession(asset, "AppleM4A")
      session.outputFileType = "m4a"
      session.setTimeRange({
        start: MediaTime.make({ seconds: start, preferredTimescale: 600 }),
        duration: MediaTime.make({ seconds: dur, preferredTimescale: 600 }),
      })
      await session.exportTo(segPath)
      session.dispose()

      const segTimeout = Math.max(dur * 1200 + 30000, 120000)
      const segText = await transcribeSegment(segPath, locale, segTimeout)
      if (segText) segments.push(segText)
      FileManager.removeSync(segPath)
    }
  } finally {
    asset.dispose()
  }

  return segments.join("\n").trim()
}

function saveTranscriptToFile(title: string, text: string): string {
  const path = FileManager.documentsDirectory + "/" + title + "_transcript.txt"
  FileManager.writeAsStringSync(path, text)
  return path
}

function InfoRow(props: { label: string; value: string }) {
  return (
    <VStack alignment="leading" spacing={2}>
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        {props.label}
      </Text>
      <Text font="callout">{props.value}</Text>
    </VStack>
  )
}

function LoadingView(props: { icon: string; title: string; subtitle?: string }) {
  return (
    <HStack alignment="center">
      <Spacer />
      <VStack alignment="center" spacing={16} padding={{ top: 60, bottom: 60 }}>
        <ProgressView />
        <VStack alignment="center" spacing={4}>
          <Text font="headline">{props.title}</Text>
          {!!props.subtitle && (
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {props.subtitle}
            </Text>
          )}
        </VStack>
      </VStack>
      <Spacer />
    </HStack>
  )
}

function IdleView(props: { onParse: () => void; onDebug: () => void }) {
  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="large">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={24} padding={{ top: 48, bottom: 48 }}>
            <Text font="title2" bold={true}>
              {L("无水印视频下载", "Watermark-free Video Download")}
            </Text>
            <Button
              title={L("读取剪切板并解析", "Read Clipboard and Parse")}
              action={props.onParse}
            />
          </VStack>
          <Spacer />
        </HStack>
      </Section>
      <Section>
        <HStack alignment="center">
          <Spacer />
          <Button
            title={L("调试", "Debug")}
            action={props.onDebug}
          />
          <Spacer />
        </HStack>
      </Section>
    </List>
  )
}

function ParsingView() {
  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="large">
      <Section>
        <LoadingView icon="magnifyingglass" title={L("正在解析", "Parsing")} subtitle={L("从剪切板读取并解析抖音链接...", "Reading and parsing Douyin link from clipboard...")} />
      </Section>
    </List>
  )
}

function NoLinkView(props: { clipText: string; onParse: () => void }) {
  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="large">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={16} padding={{ top: 48, bottom: 48 }}>
            <Text font="headline">{L("未检测到抖音链接", "No Douyin Link Found")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {L("剪切板中没有找到抖音分享链接\n请先在抖音 App 中复制分享链接", "No Douyin share link was found in the clipboard.\nCopy a share link from the Douyin app first.")}
            </Text>
            <Button title={L("重新读取", "Read Again")} action={props.onParse} />
          </VStack>
          <Spacer />
        </HStack>
      </Section>
    </List>
  )
}

function ParsedView(props: {
  info: ParseResult
  onDownload: (info: ParseResult, withTranscription: boolean) => void
  onReParse: () => void
}) {
  const info = props.info

  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="inline">
      <Section header={<Text>{L("视频信息", "Video Info")}</Text>}>
        <InfoRow label={L("标题", "Title")} value={info.title} />
        <InfoRow label="ID" value={info.videoId} />
        <InfoRow label={L("类型", "Type")} value={info.type === "images" ? L("图集", "Images") : L("视频", "Video")} />
      </Section>

      <Section header={<Text>{L("操作", "Actions")}</Text>}>
        <Button
          title={L("下载无水印视频", "Download Watermark-free Video")}
          action={() => props.onDownload(info, false)}
        />
        {info.type === "video" && (
          <Button
            title={L("下载并转录文本", "Download and Transcribe")}
            action={() => props.onDownload(info, true)}
          />
        )}
      </Section>

      <Section>
        <Button
          title={L("重新解析", "Parse Again")}
          action={props.onReParse}
        />
      </Section>
    </List>
  )
}

function DownloadingView(props: { info: ParseResult; withTranscription: boolean }) {
  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="inline">
      <Section>
        <LoadingView
          icon="arrow.down.circle.fill"
          title={L("正在下载", "Downloading")}
          subtitle={props.withTranscription ? L("下载完成后将自动转录...", "Transcription will start after download...") : props.info.title}
        />
      </Section>
    </List>
  )
}

function TranscribingView(props: { info: ParseResult }) {
  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="inline">
      <Section>
        <LoadingView
          icon="waveform"
          title={L("正在转录", "Transcribing")}
          subtitle={L("语音识别中，请稍候...", "Recognizing speech, please wait...")}
        />
      </Section>
    </List>
  )
}

function SuccessView(props: {
  info: ParseResult
  filePath: string
  transcriptText?: string
  transcriptPath?: string
  transcriptError?: string
  optimizedText?: string
  isOptimizing?: boolean
  onOptimize: (text: string) => void
  onReParse: () => void
}) {
  const hasTranscript = !!props.transcriptText && !props.transcriptError
  const showOptimizeBtn = hasTranscript && !props.optimizedText && !props.isOptimizing

  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="inline">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={12} padding={{ top: 16, bottom: 8 }}>
            <Text font="headline">{L("下载完成", "Download Complete")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {props.info.title}
            </Text>
          </VStack>
          <Spacer />
        </HStack>
      </Section>

      <Section header={<Text>{L("保存位置", "Saved To")}</Text>}>
        <InfoRow label={L("相册", "Photos")} value={L("已保存到系统相册", "Saved to Photos")} />
      </Section>

      {!!props.transcriptPath && (
        <Section header={<Text>{L("转录文本", "Transcript")}</Text>}>
          <InfoRow label={L("已保存", "Saved")} value={props.transcriptPath} />
        </Section>
      )}

      {!!props.transcriptError && (
        <Section header={<Text>{L("转录状态", "Transcription Status")}</Text>}>
          <Text font="footnote" foregroundStyle="systemOrange">
            {props.transcriptError}
          </Text>
        </Section>
      )}

      {!!props.transcriptText && (
        <Section header={<Text>{L("转录原文", "Original Transcript")}</Text>}>
          <Text font="callout">{props.transcriptText}</Text>
        </Section>
      )}

      {showOptimizeBtn && (
        <Section header={<Text>{L("AI 优化", "AI Polishing")}</Text>}>
          <Button
            title={L("AI 优化文本", "Polish with AI")}
            action={() => props.onOptimize(props.transcriptText!)}
          />
        </Section>
      )}

      {props.isOptimizing && (
        <Section header={<Text>{L("AI 优化", "AI Polishing")}</Text>}>
          <HStack alignment="center">
            <Spacer />
            <VStack alignment="center" spacing={12} padding={{ top: 8, bottom: 8 }}>
              <ProgressView />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {L("正在调用 AI 优化转录文本...", "Polishing transcript with AI...")}
              </Text>
            </VStack>
            <Spacer />
          </HStack>
        </Section>
      )}

      {!!props.optimizedText && (
        <Section header={<Text>{L("AI 优化结果", "AI Polished Result")}</Text>}>
          <Text font="callout">{props.optimizedText}</Text>
        </Section>
      )}

      <Section>
        <Button title={L("重新解析", "Parse Again")} action={props.onReParse} />
      </Section>
    </List>
  )
}

function ErrorView(props: { message: string; onRetry: () => void }) {
  return (
    <List navigationTitle={L("抖音下载", "Douyin Download")} navigationBarTitleDisplayMode="large">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={16} padding={{ top: 48, bottom: 48 }}>
            <Text font="headline">{L("解析失败", "Parse Failed")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {props.message}
            </Text>
            <Button title={L("重试", "Retry")} action={props.onRetry} />
          </VStack>
          <Spacer />
        </HStack>
      </Section>
    </List>
  )
}

function App() {
  const [pageState, setPageState] = useState<PageState>({ type: "idle" })

  // Debug helper: pick a local video and test speech transcription.
  async function handleDebug() {
    const index = await Dialog.actionSheet({
      title: L("调试选项", "Debug Options"),
      actions: [
        { label: L("调试转录（从相册选视频）", "Debug Transcription (Pick Video from Photos)") },
      ],
    })
    if (index !== 0) return

    const results = await Photos.pick({ limit: 1 })
    if (!results || results.length === 0) return

    const videoPath = await results[0].videoPath()
    if (!videoPath) {
      setPageState({ type: "error", message: "所选内容不是视频，请重新选择" })
      return
    }

    const fakeInfo: ParseResult = {
      videoId: "debug_" + Date.now(),
      title: "调试视频",
      downloadUrl: videoPath,
      shareUrl: videoPath,
      type: "video",
    }

    setPageState({ type: "transcribing", info: fakeInfo, filePath: videoPath })
    try {
      const transcriptText = await transcribeMediaFile(videoPath)
      const safeText = transcriptText || "(未识别到可用文本)"
      const transcriptPath = saveTranscriptToFile("debug_" + Date.now(), safeText)
      setPageState({
        type: "success",
        info: fakeInfo,
        filePath: videoPath,
        transcriptText: safeText,
        transcriptPath,
      })
    } catch (e: any) {
      setPageState({
        type: "success",
        info: fakeInfo,
        filePath: videoPath,
        transcriptError: "转录失败: " + (e?.message || String(e)),
      })
    }
  }

  async function handleParse() {
    setPageState({ type: "parsing" })

    try {
      const clipText = await Pasteboard.getString()
      if (!clipText) {
        setPageState({ type: "no_link", clipText: "" })
        return
      }

      const shareUrl = extractFirstUrl(clipText)
      if (!shareUrl) {
        setPageState({ type: "no_link", clipText: clipText })
        return
      }

      console.log("[Douyin] 解析链接:", shareUrl)

      const info = await parseDouyinShareText(clipText)
      setPageState({ type: "parsed", info })
    } catch (e: any) {
      console.error("[Douyin] 解析错误:", e?.message || e)
      setPageState({ type: "error", message: "解析失败: " + (e?.message || String(e)) })
    }
  }

  async function handleDownload(info: ParseResult, withTranscription: boolean) {
    const outputPath = FileManager.documentsDirectory + "/" + info.title + ".mp4"
    setPageState({ type: "downloading", info, withTranscription })

    try {
      const filePath = await downloadVideo(info.downloadUrl, outputPath)
      console.log("[Douyin] 下载完成:", filePath)

      try {
        await Photos.saveVideo(filePath)
        console.log("[Douyin] 已保存到相册")
      } catch (e: any) {
        console.log("[Douyin] 相册保存失败:", e?.message || e)
      }

      if (!withTranscription) {
        setPageState({ type: "success", info, filePath })
        return
      }

      setPageState({ type: "transcribing", info, filePath })
      try {
        const transcriptText = await transcribeMediaFile(filePath)
        const safeText = transcriptText || "(未识别到可用文本)"
        const transcriptPath = saveTranscriptToFile(info.title, safeText)
        setPageState({ type: "success", info, filePath, transcriptText: safeText, transcriptPath })
      } catch (e: any) {
        setPageState({
          type: "success",
          info,
          filePath,
          transcriptError: "转录失败: " + (e?.message || String(e)),
        })
      }
    } catch (e: any) {
      console.error("[Douyin] 下载错误:", e?.message || e)
      setPageState({ type: "error", message: "下载失败: " + (e?.message || String(e)) })
    }
  }

  async function handleOptimize(transcriptText: string) {
    const current = pageState as any
    if (current.type !== "success") return

    const stateBase = {
      type: "success" as const,
      info: current.info,
      filePath: current.filePath,
      transcriptText: current.transcriptText,
      transcriptPath: current.transcriptPath,
      transcriptError: current.transcriptError,
    }

    setPageState({ ...stateBase, isOptimizing: true })

    if (!Assistant.isAvailable) {
      setPageState({ ...stateBase, isOptimizing: false, optimizedText: "AI 助手不可用，请先在 Scripting 中配置 AI 服务" })
      return
    }

    try {
      const prompt = `你是一个专业的语音转文字内容优化助手。请对以下语音识别转录文本进行优化，要求：
1. 修正所有标点符号错误，正确使用逗号、句号、问号、感叹号
2. 合理断句和分段，使内容层次清晰、易于阅读
3. 去除无意义的口水词和重复词（如"就是说" "然后" "这是" "那个" "嗯" "啊" "对吧"等）
4. 保持原文的语义和表达风格不变，不要添加原文没有的信息
5. 直接输出优化后的文本，不要加任何解释或前缀`

      const stream = await Assistant.requestStreaming({
        systemPrompt: prompt,
        messages: [{ role: "user", content: "请优化以下转录文本：\n\n" + transcriptText }]
      })

      let result = ""
      for await (const chunk of stream) {
        if (chunk.type === "text") {
          result += chunk.content
        }
      }

      setPageState({ ...stateBase, isOptimizing: false, optimizedText: result.trim() || "(AI 优化未返回有效内容)" })
    } catch (e: any) {
      console.error("[Douyin] AI优化错误:", e?.message || e)
      setPageState({ ...stateBase, isOptimizing: false, optimizedText: "AI 优化失败: " + (e?.message || String(e)) })
    }
  }

  return (
    <NavigationStack>
      {(() => {
        switch (pageState.type) {
          case "idle":
            return <IdleView onParse={handleParse} onDebug={handleDebug} />
          case "parsing":
            return <ParsingView />
          case "no_link":
            return <NoLinkView clipText={pageState.clipText} onParse={handleParse} />
          case "parsed":
            return <ParsedView info={pageState.info} onDownload={handleDownload} onReParse={handleParse} />
          case "downloading":
            return <DownloadingView info={pageState.info} withTranscription={pageState.withTranscription} />
          case "transcribing":
            return <TranscribingView info={pageState.info} />
          case "success":
            return (
              <SuccessView
                info={pageState.info}
                filePath={pageState.filePath}
                transcriptText={pageState.transcriptText}
                transcriptPath={pageState.transcriptPath}
                transcriptError={pageState.transcriptError}
                optimizedText={pageState.optimizedText}
                isOptimizing={pageState.isOptimizing}
                onOptimize={handleOptimize}
                onReParse={handleParse}
              />
            )
          case "error":
            return <ErrorView message={pageState.message} onRetry={handleParse} />
        }
      })()}
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({
    element: <App />,
  })
  Script.exit()
}

run().catch((e: any) => {
  console.log("[Douyin] run异常:", e?.message || e)
})
