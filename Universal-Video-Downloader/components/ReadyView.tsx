import { Button, List, Section, Text } from "scripting"
import type { MediaInfo } from "../lib/downloader"
import { formatDuration } from "../utils/format"
import { InfoRow } from "./InfoRow"

export function ReadyView(props: {
  info: MediaInfo
  onCompatibleDownload: () => void
  onNativeMergeDownload: () => void
  onReturnHome: () => void
}) {
  return (
    <List navigationTitle="确认下载" navigationBarTitleDisplayMode="inline">
      <Section header={<Text>视频信息</Text>}>
        <InfoRow label="标题" value={props.info.title} />
        <InfoRow label="网站" value={props.info.site} />
        {!!props.info.uploader && <InfoRow label="作者 / 频道" value={props.info.uploader} />}
        <InfoRow label="时长" value={formatDuration(props.info.duration)} />
        {!!props.info.mediaId && <InfoRow label="媒体 ID" value={props.info.mediaId} selectable={true} />}
      </Section>

      <Section
        header={<Text>快捷下载</Text>}
        footer={
          <Text>
            高清合并会分别下载较高画质的 MP4 视频流和 AAC 音频流，优先使用
            Scripting 内置 FFmpeg 无损封装；若失败，再回退 iOS MediaComposer 重新编码。
            该模式需要额外临时空间。
          </Text>
        }
      >
        {props.info.nativeMergeAvailable && (
          <Button
            title={`高清音视频合并下载${props.info.nativeVideoHeight ? `（${props.info.nativeVideoHeight}p）` : ""}`}
            systemImage="wand.and.stars"
            action={props.onNativeMergeDownload}
          />
        )}
        <Button
          title="兼容模式下载"
          systemImage="arrow.down.circle.fill"
          action={props.onCompatibleDownload}
        />
        {!props.info.nativeMergeAvailable && (
          <Text font="footnote" foregroundStyle="systemOrange">
            没有找到兼容的 MP4 独立视频流和 AAC 音频流，仍可尝试兼容模式。
          </Text>
        )}
      </Section>

      <Section
        header={<Text>其他操作</Text>}
        footer={<Text>如需批量链接、格式、字幕、缩略图或时间范围，请返回首页后切换到高级模式。</Text>}
      >
        <Button
          title="返回首页"
          systemImage="house"
          action={props.onReturnHome}
        />
      </Section>
    </List>
  )
}
