import { Button, HStack, Image, List, Section, Spacer, Text, VStack } from "scripting"
import type { DownloadResult } from "../lib/downloader"
import { formatBytes, formatDownloadMode } from "../utils/format"
import { InfoRow } from "./InfoRow"

export function SuccessView(props: {
  result: DownloadResult
  savedToPhotos: boolean
  photosMessage?: string
  onReadAgain: () => void
  onShare: () => void
  onOpenPhotos: () => void
}) {
  return (
    <List navigationTitle="下载完成" navigationBarTitleDisplayMode="inline">
      <Section>
        <HStack>
          <Spacer />
          <VStack alignment="center" spacing={10} padding={{ top: 20, bottom: 14 }}>
            <Image systemName="checkmark.circle.fill" font="largeTitle" foregroundStyle="systemGreen" />
            <Text font="headline">视频已下载</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              {props.result.title}
            </Text>
          </VStack>
          <Spacer />
        </HStack>
      </Section>

      <Section header={<Text>文件</Text>}>
        <InfoRow label="下载方式" value={formatDownloadMode(props.result.downloadMode)} />
        <InfoRow label="保存路径" value={props.result.filePath} selectable={true} />
        <InfoRow label="文件大小" value={formatBytes(props.result.fileSize)} />
        <InfoRow label="格式" value={(props.result.extension || "未知").toUpperCase()} />
      </Section>

      <Section header={<Text>照片 App</Text>}>
        <HStack spacing={10}>
          <Image
            systemName={props.savedToPhotos ? "checkmark.circle.fill" : "exclamationmark.circle.fill"}
            foregroundStyle={props.savedToPhotos ? "systemGreen" : "systemOrange"}
          />
          <Text>{props.savedToPhotos ? "已保存到照片 App" : props.photosMessage || "未能保存到照片 App，文件仍保留在下载目录。"}</Text>
        </HStack>
      </Section>

      <Section header={<Text>操作</Text>}>
        {props.savedToPhotos && (
          <Button title="打开照片 App" systemImage="photo.fill.on.rectangle.fill" action={props.onOpenPhotos} />
        )}
        <Button title="分享文件" systemImage="square.and.arrow.up" action={props.onShare} />
        <Button title="继续下载" systemImage="house" action={props.onReadAgain} />
      </Section>
    </List>
  )
}
