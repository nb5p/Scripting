import {
  Button,
  Form,
  HStack,
  Image,
  List,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  useState,
  VStack,
} from "scripting"
import {
  type AdvancedDownloadOptions,
  type AudioBitrate,
  type AudioFormat,
  type SubtitleFormat,
  type VideoCodec,
  type VideoContainer,
  type VideoQuality,
} from "../lib/advanced_downloader"
import { extractWebUrls } from "../utils/url"
import { parseTimeInput, parsePositiveInteger } from "../utils/time"
import { toErrorMessage } from "../utils/error"
import { InfoRow } from "./InfoRow"
import { DownloadCoreSection } from "./DownloadCoreSection"
import { CookieManagementSection } from "./CookieManagementSection"

export function AdvancedHomeView(props: {
  version: string
  cookieConfigName: string | null
  onOpenCookieManager: () => void
  linkText: string
  clipboardMessage: string | null
  onLinkTextChanged: (value: string) => void
  onPasteClipboard: () => void
  onStart: (urls: string[], options: AdvancedDownloadOptions) => void
  onSwitchMode: () => void
  onUpdate: () => void
}) {
  const [mediaType, setMediaType] = useState<"video" | "audio">("video")
  const [quality, setQuality] = useState<VideoQuality>("best")
  const [container, setContainer] = useState<VideoContainer>("source")
  const [codec, setCodec] = useState<VideoCodec>("auto")
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("source")
  const [audioBitrate, setAudioBitrate] = useState<AudioBitrate>(192)
  const [writeSubtitles, setWriteSubtitles] = useState(false)
  const [writeAutomaticSubtitles, setWriteAutomaticSubtitles] = useState(false)
  const [subtitleLanguages, setSubtitleLanguages] = useState("")
  const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>("best")
  const [writeThumbnail, setWriteThumbnail] = useState(false)
  const [playlist, setPlaylist] = useState(false)
  const [playlistStart, setPlaylistStart] = useState("1")
  const [playlistEnd, setPlaylistEnd] = useState("50")
  const [customTime, setCustomTime] = useState(false)
  const [startTime, setStartTime] = useState("0")
  const [endTime, setEndTime] = useState("")
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  function submit() {
    try {
      const urls = extractWebUrls(props.linkText)
      if (urls.length === 0) {
        throw new Error("请先输入至少一个有效的 HTTP 或 HTTPS 链接。")
      }
      const options: AdvancedDownloadOptions = {
        mediaType,
        writeSubtitles,
        writeAutomaticSubtitles,
        subtitleLanguages: subtitleLanguages
          .split(/[,，;；\s]+/)
          .map(value => value.trim())
          .filter(Boolean),
        subtitleFormat,
        writeThumbnail,
      }
      if (mediaType === "video") {
        options.quality = quality
        options.container = container
        options.codec = codec
      } else {
        options.audioFormat = audioFormat
        options.audioBitrate = audioBitrate
      }
      if (playlist) {
        const start = parsePositiveInteger(playlistStart, "播放列表起始项")
        const end = parsePositiveInteger(playlistEnd, "播放列表结束项")
        if (end < start) throw new Error("播放列表结束项不能早于起始项。")
        if (end - start + 1 > 50) throw new Error("单次播放列表下载最多 50 项，请缩小起止范围。")
        options.playlist = true
        options.playlistStart = start
        options.playlistEnd = end
      }
      if (customTime) {
        const start = parseTimeInput(startTime, "开始时间")
        const end = parseTimeInput(endTime, "结束时间")
        if (start === null && end === null) throw new Error("启用自定义时间后，请至少填写开始或结束时间。")
        if (end !== null && end <= 0) throw new Error("结束时间必须大于 0。")
        if (start !== null && end !== null && end <= start) {
          throw new Error("结束时间必须晚于开始时间。")
        }
        if (start !== null) options.startTime = start
        if (end !== null) options.endTime = end
      }
      setValidationMessage(null)
      props.onStart(urls, options)
    } catch (error: any) {
      setValidationMessage(toErrorMessage(error))
    }
  }

  return (
    <Form navigationTitle="视频下载器" navigationBarTitleDisplayMode="large">
      <Section
        header={<Text>批量链接</Text>}
        footer={<Text>每行可输入一个链接，也可以粘贴包含多个链接的分享文案；程序会提取并去除重复链接。获取剪贴板只会填充编辑框，不会自动解析或下载。</Text>}
      >
        <TextField
          title="链接或分享文案"
          prompt={"https://example.com/video/1\nhttps://example.com/video/2"}
          axis="vertical"
          lineLimit={{ min: 5, max: 10, reservesSpace: true }}
          value={props.linkText}
          onChanged={props.onLinkTextChanged}
        />
        <Button
          title="从剪贴板获取"
          systemImage="doc.on.clipboard"
          action={props.onPasteClipboard}
        />
        {!!props.clipboardMessage && (
          <Text
            font="footnote"
            foregroundStyle={props.clipboardMessage.startsWith("无法") ? "systemRed" : "secondaryLabel"}
          >
            {props.clipboardMessage}
          </Text>
        )}
        <InfoRow label="已识别链接" value={`${extractWebUrls(props.linkText).length} 个`} />
      </Section>
        <Section header={<Text>媒体</Text>}>
          <Picker
            title="媒体类型"
            value={mediaType}
            onChanged={(value: string) => setMediaType(value as "video" | "audio")}
          >
            <Text tag="video">视频</Text>
            <Text tag="audio">仅音频</Text>
          </Picker>
        </Section>

        {mediaType === "video" ? (
          <Section header={<Text>视频格式</Text>}>
            <Picker title="画质" value={quality} onChanged={(value: string) => setQuality(value as VideoQuality)}>
              <Text tag="best">最佳画质</Text>
              <Text tag="2160">2160p</Text>
              <Text tag="1440">1440p</Text>
              <Text tag="1080">1080p</Text>
              <Text tag="720">720p</Text>
              <Text tag="480">480p</Text>
              <Text tag="360">360p</Text>
            </Picker>
            <Picker title="容器" value={container} onChanged={(value: string) => setContainer(value as VideoContainer)}>
              <Text tag="source">跟随源格式</Text>
              <Text tag="mp4">MP4</Text>
              <Text tag="webm">WebM</Text>
              <Text tag="mkv">MKV</Text>
            </Picker>
            <Picker title="编码" value={codec} onChanged={(value: string) => setCodec(value as VideoCodec)}>
              <Text tag="auto">自动</Text>
              <Text tag="h264">H.264</Text>
              <Text tag="hevc">HEVC</Text>
              <Text tag="av1">AV1</Text>
              <Text tag="vp9">VP9</Text>
            </Picker>
          </Section>
        ) : (
          <Section header={<Text>音频格式</Text>}>
            <Picker title="格式" value={audioFormat} onChanged={(value: string) => setAudioFormat(value as AudioFormat)}>
              <Text tag="source">跟随源格式</Text>
              <Text tag="m4a">M4A</Text>
              <Text tag="mp3">MP3</Text>
            </Picker>
            <Picker title="码率" value={audioBitrate} onChanged={(value: number) => setAudioBitrate(value as AudioBitrate)}>
              <Text tag={128}>128 kbps</Text>
              <Text tag={192}>192 kbps</Text>
              <Text tag={256}>256 kbps</Text>
              <Text tag={320}>320 kbps</Text>
            </Picker>
          </Section>
        )}

        <Section
          header={<Text>字幕与附加文件</Text>}
          footer={<Text>语言可用逗号或空格分隔，例如 zh-Hans, en；留空表示下载匹配类型的全部可用语言。</Text>}
        >
          <Toggle title="人工字幕" value={writeSubtitles} onChanged={setWriteSubtitles} />
          <Toggle title="自动字幕" value={writeAutomaticSubtitles} onChanged={setWriteAutomaticSubtitles} />
          {(writeSubtitles || writeAutomaticSubtitles) && (
            <TextField
              title="字幕语言"
              prompt="zh-Hans, en（留空表示全部）"
              value={subtitleLanguages}
              onChanged={setSubtitleLanguages}
            />
          )}
          {(writeSubtitles || writeAutomaticSubtitles) && (
            <Picker title="字幕格式" value={subtitleFormat} onChanged={(value: string) => setSubtitleFormat(value as SubtitleFormat)}>
              <Text tag="best">最佳可用格式</Text>
              <Text tag="vtt">VTT</Text>
              <Text tag="srt">SRT</Text>
              <Text tag="ttml">TTML</Text>
            </Picker>
          )}
          <Toggle title="下载缩略图" value={writeThumbnail} onChanged={setWriteThumbnail} />
        </Section>

        <Section
          header={<Text>播放列表</Text>}
          footer={<Text>启用后按起止序号下载；单次最多 50 项。</Text>}
        >
          <Toggle title="下载播放列表" value={playlist} onChanged={setPlaylist} />
          {playlist && (
            <TextField title="起始项" prompt="1" value={playlistStart} onChanged={setPlaylistStart} />
          )}
          {playlist && (
            <TextField title="结束项" prompt="50" value={playlistEnd} onChanged={setPlaylistEnd} />
          )}
        </Section>

        <Section
          header={<Text>时间范围</Text>}
          footer={<Text>支持秒、MM:SS、HH:MM:SS。时间裁剪可能落在相邻关键帧。</Text>}
        >
          <Toggle title="自定义时间" value={customTime} onChanged={setCustomTime} />
          {customTime && (
            <TextField title="开始时间" prompt="0 或 00:00" value={startTime} onChanged={setStartTime} />
          )}
          {customTime && (
            <TextField title="结束时间" prompt="例如 01:30" value={endTime} onChanged={setEndTime} />
          )}
        </Section>

        {!!validationMessage && (
          <Section header={<Text>请检查设置</Text>}>
            <Text foregroundStyle="systemRed">{validationMessage}</Text>
          </Section>
        )}

      <Section footer={<Text>将按输入顺序逐个处理链接；每个链接内部仍可按设置处理播放列表。下载期间可以最小化页面，请勿强制结束脚本。</Text>}>
        <Button title="开始高级下载" systemImage="arrow.down.circle.fill" action={submit} />
      </Section>

      <DownloadCoreSection version={props.version} onUpdate={props.onUpdate} />

      <CookieManagementSection
        cookieConfigName={props.cookieConfigName}
        onOpenCookieManager={props.onOpenCookieManager}
        footerText="用于需要登录才能访问的视频。Cookie 以 AES-256 加密存储。"
      />

      <Section footer={<Text>切换结果会被保存，下次启动时自动打开常用模式。</Text>}>
        <Button
          title="切换回常用模式"
          systemImage="rectangle.compress.vertical"
          action={props.onSwitchMode}
        />
      </Section>
    </Form>
  )
}
