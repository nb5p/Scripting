import {
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
import {
  extractFirstUrl,
  parseDouyinShareText,
  downloadVideo,
  buildDocumentsPath,
  type ParseResult,
} from "./common"
import { t } from "./i18n"

type StepState =
  | { type: "loading"; message: string }
  | { type: "success"; info: ParseResult; filePath: string; albumSaved: boolean }
  | { type: "error"; message: string }

// Extract the input text from the shortcut parameter, texts/urls parameters, or clipboard.
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

let exitMessage = t("done")
let exitResult: any = null

function IntentView() {
  const [step, setStep] = useState<StepState>({ type: "loading", message: t("preparing") })
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
      exitMessage = t("no_input_empty_clipboard")
      setStep({ type: "error", message: exitMessage })
      return
    }

    const url = extractFirstUrl(inputText)
    if (!url) {
      exitMessage = t("no_link_in_input")
      setStep({ type: "error", message: exitMessage })
      return
    }

    setStep({ type: "loading", message: t("parsing_link") })
    let info: ParseResult
    try {
      info = await parseDouyinShareText(inputText)
    } catch (e: any) {
      exitMessage = t("parse_failed") + ": " + (e?.message || String(e))
      setStep({ type: "error", message: exitMessage })
      return
    }

    setStep({ type: "loading", message: `${t("downloading")}: ${info.title}` })
    const outputPath = buildDocumentsPath(info.title + ".mp4")
    let filePath: string
    try {
      filePath = await downloadVideo(info.downloadUrl, outputPath)
    } catch (e: any) {
      exitMessage = t("download_failed") + ": " + (e?.message || String(e))
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

    exitMessage = `✅ ${t("download_complete_intent")}: ${info.title}`
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
        <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="large">
          <Section>
            <HStack alignment="center">
              <Spacer />
              <VStack alignment="center" spacing={16} padding={{ top: 60, bottom: 60 }}>
                <ProgressView />
                <VStack alignment="center" spacing={4}>
                  <Text font="headline">{t("shortcut_mode")}</Text>
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
        <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="large">
          <Section>
            <HStack alignment="center">
              <Spacer />
              <VStack alignment="center" spacing={16} padding={{ top: 48, bottom: 48 }}>
                <Text font="headline">❌ {t("failed")}</Text>
                <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                  {step.message}
                </Text>
                <Button title={t("done_btn")} action={handleDone} />
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
      <List navigationTitle={t("app_title")} navigationBarTitleDisplayMode="inline">
        <Section>
          <HStack alignment="center">
            <Spacer />
            <VStack alignment="center" spacing={12} padding={{ top: 24, bottom: 16 }}>
              <Text font="title2" bold={true}>✅ {t("download_complete")}</Text>
              <Text font="callout">{step.info.title}</Text>
              {step.albumSaved ? (
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {t("saved_to_photos")}
                </Text>
              ) : (
                <Text font="caption" foregroundStyle="systemOrange">
                  {t("album_save_failed")}{step.filePath}
                </Text>
              )}
            </VStack>
            <Spacer />
          </HStack>
        </Section>
        <Section header={<Text>{t("video_info")}</Text>}>
          <VStack alignment="leading" spacing={2}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">ID</Text>
            <Text font="callout">{step.info.videoId}</Text>
          </VStack>
          <VStack alignment="leading" spacing={2}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">{t("type")}</Text>
            <Text font="callout">{step.info.type === "images" ? t("type_images") : t("type_video")}</Text>
          </VStack>
        </Section>
        <Section>
          <Button title={t("done_btn")} action={handleDone} />
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
  Script.exit(Intent.text(t("error") + ": " + (e?.message || String(e))))
})