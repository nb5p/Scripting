import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Path,
  Script,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { checkYtDlp, checkForUpdate, installYtDlp, type YtDlpState } from "./lib/installer"
import {
  downloadAndNativeMergeMedia,
  downloadMedia,
  inspectMedia,
  createCancelTokenPath,
  triggerCancel,
  cleanCancelToken,
  isUserCancelledError,
  type DownloadResult,
  type MediaInfo,
  type QuickDownloadProgress,
} from "./lib/downloader"
import {
  downloadAdvancedMedia,
  cleanupStaleAdvancedJobs,
  type AdvancedDownloadOptions,
  type AdvancedDownloadResult,
} from "./lib/advanced_downloader"
import { CookieManagerView } from "./components/CookieManagerView"
import { cleanupTempCookieFiles, removeTempCookieFile } from "./lib/cookie"
import type { HomeMode, PageState, UnifiedDownloadProgress, AdvancedPhotosStatus } from "./lib/types"
import { extractWebUrls } from "./utils/url"
import { toErrorMessage, resolveCookieFilePath } from "./utils/error"
import { mapQuickProgress, mapAdvancedProgress } from "./utils/progress"
import { LoadingCard } from "./components/LoadingCard"
import { DependencyView } from "./components/DependencyView"
import { CommonHomeView } from "./components/CommonHomeView"
import { AdvancedHomeView } from "./components/AdvancedHomeView"
import { ReadyView } from "./components/ReadyView"
import { DownloadProgressView } from "./components/DownloadProgressView"
import { SuccessView } from "./components/SuccessView"
import { AdvancedSuccessView } from "./components/AdvancedSuccessView"
import { ErrorView } from "./components/ErrorView"

declare function openURL(url: string): Promise<boolean>

// ─── Preferences ─────────────────────────────────────────────

const PREFERENCES_DIRECTORY = Path.join(
  FileManager.appGroupDocumentsDirectory,
  "universal-video-downloader",
)
const PREFERENCES_PATH = Path.join(PREFERENCES_DIRECTORY, "preferences.json")

function loadPreferredMode(): HomeMode {
  try {
    if (!FileManager.isFileSync(PREFERENCES_PATH)) return "common"
    const parsed = JSON.parse(FileManager.readAsStringSync(PREFERENCES_PATH))
    return parsed?.homeMode === "advanced" ? "advanced" : "common"
  } catch (error) {
    console.warn("[Video Downloader] 无法读取首页模式偏好：", error)
    return "common"
  }
}

function savePreferredMode(mode: HomeMode): void {
  try {
    FileManager.createDirectorySync(PREFERENCES_DIRECTORY, true)
    FileManager.writeAsStringSync(PREFERENCES_PATH, JSON.stringify({
      homeMode: mode,
      updatedAt: new Date().toISOString(),
    }))
  } catch (error) {
    console.warn("[Video Downloader] 无法保存首页模式偏好：", error)
  }
}

const INITIAL_HOME_MODE = loadPreferredMode()

// ─── App ─────────────────────────────────────────────────────

function App() {
  const [pageState, setPageState] = useState<PageState>({ type: "checking" })
  const [homeMode, setHomeMode] = useState<HomeMode>(INITIAL_HOME_MODE)
  const [linkText, setLinkText] = useState("")
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null)
  const [cookieConfigId, setCookieConfigId] = useState<string | null>(null)
  const [cookieConfigName, setCookieConfigName] = useState<string | null>(null)

  function changeLinkText(value: string) {
    setLinkText(value)
    setClipboardMessage(null)
  }

  function switchHomeMode(mode: HomeMode) {
    setHomeMode(mode)
    savePreferredMode(mode)
    setClipboardMessage(null)
  }

  function returnHome(version?: string) {
    const resolvedVersion = version ?? currentVersion()
    if (resolvedVersion) setPageState({ type: "idle", version: resolvedVersion })
    else void checkDependency()
  }

  async function checkDependency() {
    setPageState({ type: "checking" })
    try {
      const state = await checkYtDlp()
      applyDependencyState(state)
    } catch (error: any) {
      setPageState({ type: "error", message: toErrorMessage(error) })
    }
  }

  function applyDependencyState(state: YtDlpState) {
    if (state.kind === "installed") {
      setPageState({ type: "idle", version: state.version })
    } else if (state.kind === "missing") {
      setPageState({ type: "missing" })
    } else if (state.kind === "error") {
      setPageState({ type: "error", message: state.message })
    } else {
      setPageState({ type: "checking" })
    }
  }

  async function checkForUpdateAction() {
    const previousVersion = currentVersion() ?? ""
    setPageState({ type: "installing" })
    try {
      const result = await checkForUpdate()
      if (result.kind === "upToDate") {
        setPageState({
          type: "updateCheck",
          version: result.version,
          message: `yt-dlp ${result.version} 已是最新版本。`,
          isError: false,
          updateAvailable: false,
        })
      } else if (result.kind === "updateAvailable") {
        setPageState({
          type: "updateCheck",
          version: result.currentVersion,
          message: `发现新版本 ${result.latestVersion}（当前 ${result.currentVersion}）。`,
          isError: false,
          updateAvailable: true,
        })
      } else if (result.kind === "missing") {
        setPageState({
          type: "updateCheck",
          version: "",
          message: "yt-dlp 尚未安装。",
          isError: true,
          updateAvailable: false,
        })
      } else {
        setPageState({
          type: "updateCheck",
          version: previousVersion,
          message: result.message,
          isError: true,
          updateAvailable: false,
        })
      }
    } catch (error: any) {
      setPageState({
        type: "updateCheck",
        version: previousVersion,
        message: toErrorMessage(error),
        isError: true,
        updateAvailable: false,
      })
    }
  }

  async function forceReinstall() {
    const previousVersion = currentVersion() ?? ""
    setPageState({ type: "installing" })
    try {
      const result = await installYtDlp()
      if (result.state.kind === "installed") {
        const wasUpdate = previousVersion && previousVersion !== result.state.version
        const message = wasUpdate
          ? `已从 ${previousVersion} 更新到 ${result.state.version}。`
          : `yt-dlp ${result.state.version} 安装完成。`
        setPageState({
          type: "updateCheck",
          version: result.state.version,
          message,
          isError: false,
          updateAvailable: false,
        })
      } else if (result.state.kind === "error") {
        setPageState({
          type: "updateCheck",
          version: previousVersion,
          message: result.state.message,
          isError: true,
          updateAvailable: false,
        })
      } else {
        applyDependencyState(result.state)
      }
    } catch (error: any) {
      setPageState({
        type: "updateCheck",
        version: previousVersion,
        message: toErrorMessage(error),
        isError: true,
        updateAvailable: false,
      })
    }
  }

  function currentVersion(): string | undefined {
    if ("version" in pageState) return pageState.version
    return undefined
  }

  async function pasteClipboardIntoEditor() {
    try {
      const text = await Pasteboard.getString()
      setLinkText(text ?? "")
      if (!text?.trim()) {
        setClipboardMessage("剪贴板中没有文本内容。")
        return
      }
      const count = extractWebUrls(text).length
      setClipboardMessage(
        count > 0
          ? `已填入剪贴板内容，识别到 ${count} 个链接；请确认后再继续。`
          : "已填入剪贴板内容，但暂未识别到 HTTP 或 HTTPS 链接。",
      )
    } catch (error: any) {
      setClipboardMessage(`无法读取剪贴板：${toErrorMessage(error)}`)
    }
  }

  async function openCookieManager() {
    await Navigation.present({
      element: <CookieManagerView
        currentConfigId={cookieConfigId}
        onSelectConfig={(id, name) => {
          setCookieConfigId(id)
          setCookieConfigName(name)
        }}
      />,
    })
  }

  async function readClipboardAndParseCommon() {
    const version = currentVersion()
    if (!version) {
      await checkDependency()
      return
    }

    // Immediately transition to inspecting to prevent double-click re-entry.
    setPageState({ type: "inspecting", url: "", version })

    let text: string | null
    try {
      text = await Pasteboard.getString()
    } catch (error: any) {
      setPageState({
        type: "error",
        version,
        message: `无法读取剪贴板：${toErrorMessage(error)}`,
      })
      return
    }

    const url = extractWebUrls(text ?? "")[0]
    if (!url) {
      setPageState({
        type: "error",
        version,
        message: "剪贴板中没有找到有效的 HTTP 或 HTTPS 视频链接。请先复制网站链接或包含链接的分享文案。",
      })
      return
    }

    let cookieFilePath: string | undefined
    try {
      cookieFilePath = resolveCookieFilePath(cookieConfigId)
      const info = await inspectMedia(url, cookieFilePath)
      setPageState({ type: "ready", url, info, version })
    } catch (error: any) {
      setPageState({
        type: "error",
        version,
        url,
        message: toErrorMessage(error),
      })
    } finally {
      if (cookieFilePath) removeTempCookieFile(cookieFilePath)
    }
  }

  async function startDownload(
    url: string,
    info: MediaInfo,
    version: string,
    mode: "compatible" | "nativeMerge",
  ) {
    const cancelTokenPath = createCancelTokenPath()
    const initialProgress: UnifiedDownloadProgress = {
      stage: "准备下载",
      message: "正在创建快捷下载任务",
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      speed: null,
      eta: null,
    }
    setPageState({ type: "downloading", url, info, version, mode, progress: initialProgress, cancelTokenPath, cancelling: false })
    let cookieFilePath: string | undefined
    try {
      cookieFilePath = resolveCookieFilePath(cookieConfigId)
      const onProgress = (progress: QuickDownloadProgress) => {
        setPageState(prev =>
          prev.type === "downloading" && prev.cancelTokenPath === cancelTokenPath
            ? { ...prev, progress: mapQuickProgress(progress) }
            : prev,
        )
      }
      const result = mode === "nativeMerge"
        ? await downloadAndNativeMergeMedia(url, onProgress, cookieFilePath, cancelTokenPath)
        : await downloadMedia(url, onProgress, cookieFilePath, cancelTokenPath)
      let savedToPhotos = false
      let photosMessage: string | undefined
      try {
        savedToPhotos = await Photos.saveVideo(result.filePath)
        if (!savedToPhotos) {
          photosMessage = "照片 App 未接受此媒体格式，文件仍保留在下载目录。"
        }
      } catch (error: any) {
        photosMessage = `保存到照片 App 失败：${toErrorMessage(error)}`
      }
      setPageState({ type: "success", result, version, savedToPhotos, photosMessage })
    } catch (error: any) {
      if (isUserCancelledError(error)) {
        setPageState({ type: "idle", version })
      } else {
        setPageState({
          type: "error",
          version,
          url,
          message: toErrorMessage(error),
        })
      }
    } finally {
      cleanCancelToken(cancelTokenPath)
      if (cookieFilePath) removeTempCookieFile(cookieFilePath)
    }
  }

  async function startAdvancedBatch(
    urls: string[],
    version: string,
    options: AdvancedDownloadOptions,
  ) {
    const cancelTokenPath = createCancelTokenPath()
    const firstUrl = urls[0]
    const placeholderInfo: MediaInfo = {
      title: urls.length > 1 ? `批量任务（${urls.length} 个链接）` : "高级下载任务",
      mediaId: "",
      site: "",
      uploader: "",
      duration: null,
      webpageUrl: firstUrl,
      thumbnail: null,
      extension: null,
      nativeMergeAvailable: false,
      nativeVideoHeight: null,
    }
    const initialProgress: UnifiedDownloadProgress = {
      stage: "准备高级下载",
      message: `正在创建批量任务，共 ${urls.length} 个链接`,
      percent: null,
      downloadedBytes: 0,
      totalBytes: null,
      speed: null,
      eta: null,
      batchIndex: 1,
      batchCount: urls.length,
    }
    setPageState({
      type: "downloading",
      url: firstUrl,
      info: placeholderInfo,
      version,
      mode: "advanced",
      progress: initialProgress,
      cancelTokenPath,
      cancelling: false,
    })

    let cookieFilePath: string | undefined
    try {
      cookieFilePath = resolveCookieFilePath(cookieConfigId)

      const startedAt = new Date().toISOString()
      const artifacts: AdvancedDownloadResult["artifacts"] = []
      const failures: AdvancedDownloadResult["failures"] = []
      let requestedItems = 0
      let completedItems = 0

      for (let index = 0; index < urls.length; index += 1) {
        const url = urls[index]
        try {
          const result = await downloadAdvancedMedia(url, { ...options, cookieFilePath, cancelTokenPath }, progress => {
            const mapped = mapAdvancedProgress(progress)
            setPageState(prev =>
              prev.type === "downloading" && prev.cancelTokenPath === cancelTokenPath
                ? {
                    ...prev,
                    url,
                    progress: {
                      ...mapped,
                      message: `链接 ${index + 1}/${urls.length} · ${mapped.message}`,
                      title: mapped.title || url,
                      batchIndex: index + 1,
                      batchCount: urls.length,
                    },
                  }
                : prev,
            )
          })
          const itemOffset = requestedItems
          const resultItemCount = Math.max(1, result.requestedItems)
          requestedItems += resultItemCount
          completedItems += result.completedItems
          artifacts.push(...result.artifacts.map(artifact => ({
            ...artifact,
            itemIndex: artifact.itemIndex + itemOffset,
          })))
          failures.push(...result.failures.map(failure => ({
            ...failure,
            itemIndex: failure.itemIndex === undefined ? undefined : failure.itemIndex + itemOffset,
            message: `链接 ${index + 1}/${urls.length}：${failure.message}`,
          })))
          if (!result.ok && result.failures.length === 0) {
            failures.push({
              stage: "download",
              message: `链接 ${index + 1}/${urls.length}：没有生成可用文件。`,
              recoverable: true,
            })
          }
        } catch (error: any) {
          if (isUserCancelledError(error)) {
            if (artifacts.length > 0) {
              const partialResult: AdvancedDownloadResult = {
                ok: true,
                partial: true,
                sourceUrl: firstUrl,
                artifacts,
                failures,
                requestedItems,
                completedItems,
                startedAt,
                finishedAt: new Date().toISOString(),
              }
              setPageState({
                type: "advancedSuccess",
                result: partialResult,
                version,
                photos: { attempted: 0, saved: 0, message: "下载已取消；已完成的文件保留在 Files 中。" },
              })
            } else {
              setPageState({ type: "idle", version })
            }
            return
          }
          const estimatedItems = options.playlist && options.playlistStart && options.playlistEnd
            ? Math.max(1, options.playlistEnd - options.playlistStart + 1)
            : 1
          requestedItems += estimatedItems
          failures.push({
            stage: "download",
            message: `链接 ${index + 1}/${urls.length}：${toErrorMessage(error)}`,
            recoverable: true,
          })
        }
      }

      const result: AdvancedDownloadResult = {
        ok: artifacts.length > 0,
        partial: failures.length > 0 || completedItems < requestedItems,
        sourceUrl: firstUrl,
        artifacts,
        failures,
        requestedItems,
        completedItems,
        startedAt,
        finishedAt: new Date().toISOString(),
      }

      if (!result.ok) {
        const details = result.failures
          .slice(0, 3)
          .map(failure => failure.message)
          .join("；")
        setPageState({
          type: "error",
          version,
          message: details || "高级批量下载没有生成可用文件。",
        })
        return
      }

      const photoCandidates = options.mediaType === "video"
        ? result.artifacts.filter(artifact =>
            artifact.role === "primary" && ["mp4", "mov", "m4v"].includes(artifact.extension.toLowerCase()),
          )
        : []
      let saved = 0
      for (const artifact of photoCandidates) {
        try {
          if (await Photos.saveVideo(artifact.filePath)) saved += 1
        } catch (error) {
          console.warn("[Video Downloader] 高级视频保存到照片失败：", error)
        }
      }
      const photos: AdvancedPhotosStatus = {
        attempted: photoCandidates.length,
        saved,
        message: photoCandidates.length === 0
          ? "没有符合照片 App 保存条件的主视频；全部产物已保留在 Files。"
          : saved === photoCandidates.length
            ? `已将 ${saved} 个主视频保存到照片 App；Files 中仍保留原文件。`
            : `尝试保存 ${photoCandidates.length} 个主视频，成功 ${saved} 个；全部原文件仍保留在 Files。`,
      }
      setPageState({ type: "advancedSuccess", result, version, photos })
    } finally {
      cleanCancelToken(cancelTokenPath)
      if (cookieFilePath) removeTempCookieFile(cookieFilePath)
    }
  }

  async function retryCurrentUrl(url: string, version: string) {
    setPageState({ type: "inspecting", url, version })
    let cookieFilePath: string | undefined
    try {
      cookieFilePath = resolveCookieFilePath(cookieConfigId)
      const info = await inspectMedia(url, cookieFilePath)
      setPageState({ type: "ready", url, info, version })
    } catch (error: any) {
      setPageState({ type: "error", version, url, message: toErrorMessage(error) })
    } finally {
      if (cookieFilePath) removeTempCookieFile(cookieFilePath)
    }
  }

  useEffect(() => {
    void checkDependency()
  }, [])

  return (
    <NavigationStack>
      {(() => {
        switch (pageState.type) {
          case "checking":
            return (
              <List navigationTitle="视频下载器" navigationBarTitleDisplayMode="large">
                <Section>
                  <LoadingCard title="正在准备…" subtitle="正在检查 yt-dlp 下载核心。" />
                </Section>
              </List>
            )
          case "missing":
            return (
              <DependencyView
                installing={false}
                onInstall={forceReinstall}
                onCheck={checkDependency}
              />
            )
          case "installing":
            return (
              <DependencyView
                installing={true}
                onInstall={forceReinstall}
                onCheck={checkDependency}
              />
            )
          case "updateCheck": {
            const isInstalled = pageState.version !== ""
            return (
              <List navigationTitle="检查更新" navigationBarTitleDisplayMode="inline">
                <Section>
                  <HStack alignment="top" spacing={12}>
                    <Image
                      systemName={pageState.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"}
                      foregroundStyle={pageState.isError ? "systemRed" : "systemGreen"}
                    />
                    <VStack alignment="leading" spacing={4}>
                      <Text font="headline">
                        {pageState.isError
                          ? isInstalled ? "更新检查失败" : "需要安装 yt-dlp"
                          : pageState.updateAvailable ? "发现新版本" : "已是最新版本"}
                      </Text>
                      <Text font="footnote" foregroundStyle="secondaryLabel" textSelection={true}>
                        {pageState.message}
                      </Text>
                    </VStack>
                  </HStack>
                </Section>
                <Section>
                  {!pageState.isError && pageState.updateAvailable && (
                    <Button
                      title="立即更新"
                      systemImage="arrow.down.circle"
                      action={() => void forceReinstall()}
                    />
                  )}
                  {pageState.isError && !isInstalled && (
                    <Button
                      title="立即安装"
                      systemImage="arrow.down.circle"
                      action={() => void forceReinstall()}
                    />
                  )}
                  {isInstalled && (
                    <Button
                      title="强制重新安装"
                      systemImage="arrow.clockwise"
                      action={() => void forceReinstall()}
                    />
                  )}
                  {isInstalled && (
                    <Button
                      title="返回首页"
                      systemImage="house"
                      action={() => returnHome(pageState.version)}
                    />
                  )}
                </Section>
              </List>
            )
          }
          case "idle":
            return homeMode === "advanced" ? (
              <AdvancedHomeView
                version={pageState.version}
                cookieConfigName={cookieConfigName}
                onOpenCookieManager={() => void openCookieManager()}
                linkText={linkText}
                clipboardMessage={clipboardMessage}
                onLinkTextChanged={changeLinkText}
                onPasteClipboard={() => void pasteClipboardIntoEditor()}
                onStart={(urls, options) => {
                  void startAdvancedBatch(urls, pageState.version, options)
                }}
                onSwitchMode={() => switchHomeMode("common")}
                onUpdate={checkForUpdateAction}
              />
            ) : (
              <CommonHomeView
                version={pageState.version}
                cookieConfigName={cookieConfigName}
                onOpenCookieManager={() => void openCookieManager()}
                onReadClipboardAndContinue={() => void readClipboardAndParseCommon()}
                onSwitchMode={() => switchHomeMode("advanced")}
                onUpdate={checkForUpdateAction}
              />
            )
          case "inspecting":
            return (
              <List navigationTitle="解析链接" navigationBarTitleDisplayMode="inline">
                <Section>
                  <LoadingCard
                    title="正在读取视频信息…"
                    subtitle="yt-dlp 正在识别网站和可用媒体格式。"
                  />
                </Section>
              </List>
            )
          case "ready":
            return (
              <ReadyView
                info={pageState.info}
                onCompatibleDownload={() =>
                  startDownload(pageState.url, pageState.info, pageState.version, "compatible")
                }
                onNativeMergeDownload={() =>
                  startDownload(pageState.url, pageState.info, pageState.version, "nativeMerge")
                }
                onReturnHome={() => returnHome(pageState.version)}
              />
            )
          case "downloading":
            return (
              <DownloadProgressView
                info={pageState.info}
                mode={pageState.mode}
                progress={pageState.progress}
                cancelling={pageState.cancelling}
                onCancel={() => {
                  triggerCancel(pageState.cancelTokenPath)
                  setPageState(prev =>
                    prev.type === "downloading" && !prev.cancelling
                      ? { ...prev, cancelling: true }
                      : prev,
                  )
                }}
              />
            )
          case "success":
            return (
              <SuccessView
                result={pageState.result}
                savedToPhotos={pageState.savedToPhotos}
                photosMessage={pageState.photosMessage}
                onReadAgain={() => returnHome(pageState.version)}
                onShare={() => ShareSheet.present([pageState.result.filePath])}
                onOpenPhotos={() => openURL("photos-redirect://")}
              />
            )
          case "advancedSuccess":
            return (
              <AdvancedSuccessView
                result={pageState.result}
                photos={pageState.photos}
                onReadAgain={() => returnHome(pageState.version)}
                onShareAll={() => ShareSheet.present(pageState.result.artifacts.map(artifact => artifact.filePath))}
                onOpenPhotos={() => openURL("photos-redirect://")}
              />
            )
          case "error": {
            const version = pageState.version
            const url = pageState.url
            if (!version) {
              return (
                <DependencyView
                  installing={false}
                  message={pageState.message}
                  onInstall={forceReinstall}
                  onCheck={checkDependency}
                />
              )
            }
            return (
              <ErrorView
                message={pageState.message}
                canRetry={!!url}
                onRetry={() => url && retryCurrentUrl(url, version)}
                onReset={() => returnHome(version)}
                onRepair={forceReinstall}
              />
            )
          }
        }
      })()}
    </NavigationStack>
  )
}

// ─── Entry ───────────────────────────────────────────────────

async function run() {
  cleanupTempCookieFiles()
  cleanupStaleAdvancedJobs()
  Script.enableMinimize()
  await Navigation.present({ element: <App /> })
  Script.exit()
}

run().catch((error: unknown) => {
  console.error("[Video Downloader]", toErrorMessage(error))
  Script.exit()
})
