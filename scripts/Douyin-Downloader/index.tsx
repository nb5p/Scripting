import {
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
  Path,
} from "scripting"
import {
  extractFirstUrl,
  parseDouyinShareText,
  downloadVideo,
  buildDocumentsPath,
  type ParseResult,
} from "./common"
import { t } from "./i18n"

type PageState =
  | { type: "idle" }
  | { type: "parsing" }
  | { type: "no_link"; clipText: string }
  | { type: "parsed"; info: ParseResult }
  | { type: "downloading"; info: ParseResult; withTranscription: boolean }
  | { type: "transcribing"; info: ParseResult; filePath: string }
  | { type: "success"; info: ParseResult; filePath: string; transcriptText?: string; transcriptPath?: string; transcriptError?: string; optimizedText?: string; optimizeError?: string; isOptimizing?: boolean }
  | { type: "error"; message: string }

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
        reject(new Error(t("segment_timeout")))
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
        reject(new Error(t("recognition_not_started")))
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
      const segPath = Path.join(tmpDir, "dy_seg_" + i + ".m4a")

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
  const path = buildDocumentsPath(title + "_transcript.txt")
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
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="large">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={24} padding={{ top: 48, bottom: 48 }}>
            <Text font="title2" bold={true}>
              {t("watermark_free_download")}
            </Text>
            <Button
              title={t("read_clipboard_parse")}
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
            title={t("debug")}
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
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="large">
      <Section>
        <LoadingView icon="magnifyingglass" title={t("parsing")} subtitle={t("parsing_subtitle")} />
      </Section>
    </List>
  )
}

function NoLinkView(props: { clipText: string; onParse: () => void }) {
  return (
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="large">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={16} padding={{ top: 48, bottom: 48 }}>
            <Text font="headline">{t("no_link_found")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {t("no_link_hint")}
            </Text>
            <Button title={t("read_again")} action={props.onParse} />
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
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="inline">
      <Section header={<Text>{t("video_info")}</Text>}>
        <InfoRow label={t("title")} value={info.title} />
        <InfoRow label="ID" value={info.videoId} />
        <InfoRow label={t("type")} value={info.type === "images" ? t("type_images") : t("type_video")} />
      </Section>

      <Section header={<Text>{t("actions")}</Text>}>
        <Button
          title={t("download_watermark_free")}
          action={() => props.onDownload(info, false)}
        />
        {info.type === "video" && (
          <Button
            title={t("download_and_transcribe")}
            action={() => props.onDownload(info, true)}
          />
        )}
      </Section>

      <Section>
        <Button
          title={t("parse_again")}
          action={props.onReParse}
        />
      </Section>
    </List>
  )
}

function DownloadingView(props: { info: ParseResult; withTranscription: boolean }) {
  return (
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="inline">
      <Section>
        <LoadingView
          icon="arrow.down.circle.fill"
          title={t("downloading")}
          subtitle={props.withTranscription ? t("downloading_transcribe_hint") : props.info.title}
        />
      </Section>
    </List>
  )
}

function TranscribingView(props: { info: ParseResult }) {
  return (
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="inline">
      <Section>
        <LoadingView
          icon="waveform"
          title={t("transcribing")}
          subtitle={t("transcribing_subtitle")}
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
  optimizeError?: string
  isOptimizing?: boolean
  onOptimize: (text: string) => void
  onReParse: () => void
}) {
  const hasTranscript = !!props.transcriptText && !props.transcriptError
  const showOptimizeBtn = hasTranscript && !props.optimizedText && !props.isOptimizing

  return (
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="inline">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={12} padding={{ top: 16, bottom: 8 }}>
            <Text font="headline">{t("download_complete")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {props.info.title}
            </Text>
          </VStack>
          <Spacer />
        </HStack>
      </Section>

      <Section header={<Text>{t("saved_to")}</Text>}>
        <InfoRow label={t("photos")} value={t("saved_to_photos")} />
      </Section>

      {!!props.transcriptPath && (
        <Section header={<Text>{t("transcript")}</Text>}>
          <InfoRow label={t("saved")} value={props.transcriptPath} />
        </Section>
      )}

      {!!props.transcriptError && (
        <Section header={<Text>{t("transcription_status")}</Text>}>
          <Text font="footnote" foregroundStyle="systemOrange" textSelection={true}>
            {props.transcriptError}
          </Text>
        </Section>
      )}

      {!!props.transcriptText && (
        <Section header={<Text>{t("original_transcript")}</Text>}>
          <Text font="callout" textSelection={true}>{props.transcriptText}</Text>
        </Section>
      )}

      {showOptimizeBtn && (
        <Section header={<Text>{t("ai_polishing")}</Text>}>
          <Button
            title={t("polish_with_ai")}
            action={() => props.onOptimize(props.transcriptText!)}
          />
        </Section>
      )}

      {props.isOptimizing && (
        <Section header={<Text>{t("ai_polishing")}</Text>}>
          <HStack alignment="center">
            <Spacer />
            <VStack alignment="center" spacing={12} padding={{ top: 8, bottom: 8 }}>
              <ProgressView />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {t("polishing_in_progress")}
              </Text>
            </VStack>
            <Spacer />
          </HStack>
        </Section>
      )}

      {!!props.optimizeError && !props.isOptimizing && (
        <Section header={<Text>{t("ai_polishing")}</Text>}>
          <Text font="footnote" foregroundStyle="systemOrange" textSelection={true}>
            {props.optimizeError}
          </Text>
          <Button
            title={t("retry")}
            action={() => props.onOptimize(props.transcriptText!)}
          />
        </Section>
      )}

      {!!props.optimizedText && (
        <Section header={<Text>{t("ai_polished_result")}</Text>}>
          <Text font="callout" textSelection={true}>{props.optimizedText}</Text>
        </Section>
      )}

      <Section>
        <Button title={t("parse_again")} action={props.onReParse} />
      </Section>
    </List>
  )
}

function ErrorView(props: { message: string; onRetry: () => void }) {
  return (
    <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="large">
      <Section>
        <HStack alignment="center">
          <Spacer />
          <VStack alignment="center" spacing={16} padding={{ top: 48, bottom: 48 }}>
            <Text font="headline">{t("parse_failed_title")}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {props.message}
            </Text>
            <Button title={t("retry")} action={props.onRetry} />
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
      title: t("debug_options"),
      actions: [
        { label: t("debug_transcription") },
      ],
    })
    if (index !== 0) return

    const results = await Photos.pick({ limit: 1 })
    if (!results || results.length === 0) return

    const videoPath = await results[0].videoPath()
    if (!videoPath) {
      setPageState({ type: "error", message: t("not_a_video") })
      return
    }

    const fakeInfo: ParseResult = {
      videoId: "debug_" + Date.now(),
      title: t("debug_video"),
      downloadUrl: videoPath,
      shareUrl: videoPath,
      type: "video",
    }

    setPageState({ type: "transcribing", info: fakeInfo, filePath: videoPath })
    try {
      const transcriptText = await transcribeMediaFile(videoPath)
      const safeText = transcriptText || t("no_usable_text")
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
        transcriptError: t("transcription_failed") + ": " + (e?.message || String(e)),
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

      console.log("[Douyin] Parsed link:", shareUrl)

      const info = await parseDouyinShareText(clipText)
      setPageState({ type: "parsed", info })
    } catch (e: any) {
      console.error("[Douyin] Parse error:", e?.message || e)
      setPageState({ type: "error", message: t("parse_failed") + ": " + (e?.message || String(e)) })
    }
  }

  async function handleDownload(info: ParseResult, withTranscription: boolean) {
    const outputPath = buildDocumentsPath(info.title + ".mp4")
    setPageState({ type: "downloading", info, withTranscription })

    try {
      const filePath = await downloadVideo(info.downloadUrl, outputPath)
      console.log("[Douyin] Download complete:", filePath)

      try {
        await Photos.saveVideo(filePath)
        console.log("[Douyin] Saved to Photos")
      } catch (e: any) {
        console.log("[Douyin] Photos save failed:", e?.message || e)
      }

      if (!withTranscription) {
        setPageState({ type: "success", info, filePath })
        return
      }

      setPageState({ type: "transcribing", info, filePath })
      try {
        const transcriptText = await transcribeMediaFile(filePath)
        const safeText = transcriptText || t("no_usable_text")
        const transcriptPath = saveTranscriptToFile(info.title, safeText)
        setPageState({ type: "success", info, filePath, transcriptText: safeText, transcriptPath })
      } catch (e: any) {
        setPageState({
          type: "success",
          info,
          filePath,
          transcriptError: t("transcription_failed") + ": " + (e?.message || String(e)),
        })
      }
    } catch (e: any) {
      console.error("[Douyin] Download error:", e?.message || e)
      setPageState({ type: "error", message: t("download_failed") + ": " + (e?.message || String(e)) })
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
      setPageState({ ...stateBase, isOptimizing: false, optimizeError: t("ai_unavailable") })
      return
    }

    try {
      const prompt = `You are a professional speech-to-text content optimization assistant. Please optimize the following speech recognition transcript with these requirements:
1. Fix all punctuation errors; correctly use commas, periods, question marks, and exclamation marks.
2. Break sentences and paragraphs reasonably to make the content clear and easy to read.
3. Remove meaningless filler words and repetitions (such as "you know", "like", "um", "ah", "right", etc.).
4. Keep the original semantics and expression style unchanged; do not add information not present in the original.
5. Output the optimized text directly, without any explanation or prefix.`

      const stream = await Assistant.requestStreaming({
        systemPrompt: prompt,
        messages: [{ role: "user", content: t("optimize_prompt_prefix") + "\n\n" + transcriptText }]
      })

      let result = ""
      for await (const chunk of stream) {
        if (chunk.type === "text") {
          result += chunk.content
        }
      }

      const trimmed = result.trim()
      if (trimmed) {
        setPageState({ ...stateBase, isOptimizing: false, optimizedText: trimmed })
      } else {
        setPageState({ ...stateBase, isOptimizing: false, optimizeError: t("ai_no_content") })
      }
    } catch (e: any) {
      console.error("[Douyin] AI optimize error:", e?.message || e)
      setPageState({ ...stateBase, isOptimizing: false, optimizeError: t("ai_polishing_failed") + ": " + (e?.message || String(e)) })
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
                optimizeError={pageState.optimizeError}
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
  console.log("[Douyin] run error:", e?.message || e)
})