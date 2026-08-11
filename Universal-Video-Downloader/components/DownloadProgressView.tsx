import {
  Button,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Text,
  VStack,
} from "scripting"
import type { MediaInfo } from "../lib/downloader"
import type { UnifiedDownloadProgress } from "../lib/types"
import { formatBytes, formatSpeed, formatEta } from "../utils/format"
import { InfoRow } from "./InfoRow"

export function DownloadProgressView(props: {
  info: MediaInfo
  mode: "compatible" | "nativeMerge" | "advanced"
  progress: UnifiedDownloadProgress
  cancelling: boolean
  onCancel: () => void
}) {
  const percent = props.progress.percent === null
    ? null
    : Math.max(0, Math.min(100, props.progress.percent))
  const playlistItemText = props.progress.itemCount && props.progress.itemCount > 0
    ? `${Math.max(1, props.progress.itemIndex || 1)} / ${props.progress.itemCount}`
    : null
  const batchItemText = props.progress.batchCount && props.progress.batchCount > 0
    ? `${Math.max(1, props.progress.batchIndex || 1)} / ${props.progress.batchCount}`
    : null

  return (
    <List navigationTitle="正在下载" navigationBarTitleDisplayMode="inline">
      <Section>
        <VStack alignment="leading" spacing={12} padding={{ top: 18, bottom: 12 }}>
          <HStack spacing={10}>
            <Image systemName="arrow.down.circle.fill" foregroundStyle="systemBlue" />
            <VStack alignment="leading" spacing={3}>
              <Text font="headline">{props.progress.stage}</Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {props.progress.message}
              </Text>
            </VStack>
          </HStack>
          {percent === null ? (
            <ProgressView />
          ) : (
            <ProgressView
              value={percent}
              total={100}
              currentValueLabel={<Text font="caption">{percent.toFixed(1)}%</Text>}
            />
          )}
        </VStack>
      </Section>

      <Section header={<Text>实时状态</Text>}>
        <InfoRow label="阶段" value={props.progress.stage} />
        <InfoRow label="进度" value={percent === null ? "不确定（等待总量或正在处理）" : `${percent.toFixed(1)}%`} />
        <InfoRow
          label="已下载 / 总大小"
          value={`${formatBytes(props.progress.downloadedBytes)} / ${formatBytes(props.progress.totalBytes)}`}
        />
        <InfoRow label="速度" value={formatSpeed(props.progress.speed)} />
        <InfoRow label="预计剩余时间（ETA）" value={formatEta(props.progress.eta)} />
        {!!batchItemText && <InfoRow label="批量链接" value={batchItemText} />}
        {!!playlistItemText && <InfoRow label="播放列表项目" value={playlistItemText} />}
      </Section>

      <Section header={<Text>当前媒体</Text>}>
        <InfoRow label="标题" value={props.progress.title || props.info.title} />
        <InfoRow
          label="模式"
          value={props.mode === "advanced" ? "高级模式" : props.mode === "nativeMerge" ? "高清合并" : "兼容模式"}
        />
      </Section>

      <Section
        header={<Text>操作</Text>}
        footer={<Text>{props.cancelling ? "正在等待下载进程响应取消请求…" : props.mode === "advanced" ? "放弃后当前链接会尽快停止；已完成的链接产物保留在 Files 中。可以最小化页面并稍后从运行中的脚本返回；请勿强制结束 Scripting。" : "放弃后下载会尽快停止，已下载的部分文件将被清理。可以最小化页面并稍后从运行中的脚本返回；请勿强制结束 Scripting。"}</Text>}
      >
        {props.cancelling ? (
          <HStack spacing={8}>
            <ProgressView />
            <Text foregroundStyle="systemOrange">正在取消…</Text>
          </HStack>
        ) : (
          <Button
            title="放弃下载"
            systemImage="xmark.circle.fill"
            action={props.onCancel}
          />
        )}
      </Section>
    </List>
  )
}
