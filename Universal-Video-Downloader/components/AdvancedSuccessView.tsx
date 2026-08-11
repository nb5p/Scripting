import { Button, HStack, Image, List, Section, Spacer, Text, VStack } from "scripting"
import type { AdvancedDownloadResult } from "../lib/advanced_downloader"
import type { AdvancedPhotosStatus } from "../lib/types"
import { InfoRow } from "./InfoRow"

export function AdvancedSuccessView(props: {
  result: AdvancedDownloadResult
  photos: AdvancedPhotosStatus
  onReadAgain: () => void
  onShareAll: () => void
  onOpenPhotos: () => void
}) {
  const partial = props.result.partial || !props.result.ok
  const paths = props.result.artifacts.map(artifact => artifact.filePath)

  return (
    <List navigationTitle={partial ? "部分完成" : "下载完成"} navigationBarTitleDisplayMode="inline">
      <Section>
        <HStack>
          <Spacer />
          <VStack alignment="center" spacing={10} padding={{ top: 20, bottom: 14 }}>
            <Image
              systemName={partial ? "exclamationmark.circle.fill" : "checkmark.circle.fill"}
              font="largeTitle"
              foregroundStyle={partial ? "systemOrange" : "systemGreen"}
            />
            <Text font="headline">{partial ? "高级下载部分完成" : "高级下载完成"}</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
              共生成 {props.result.artifacts.length} 个文件
            </Text>
          </VStack>
          <Spacer />
        </HStack>
      </Section>

      <Section header={<Text>结果概览</Text>}>
        <InfoRow label="请求项目" value={`${props.result.requestedItems} 项`} />
        <InfoRow label="完成项目" value={`${props.result.completedItems} 项`} />
        <InfoRow label="生成产物" value={`${props.result.artifacts.length} 个`} />
        <InfoRow label="失败记录" value={`${props.result.failures.length} 条`} />
        {paths.length > 0 && <InfoRow label="首个文件路径" value={paths[0]} selectable={true} />}
      </Section>

      {paths.length > 1 && (
        <Section header={<Text>全部文件路径</Text>}>
          <Text font="footnote" textSelection={true}>{paths.join("\n")}</Text>
        </Section>
      )}

      {props.result.failures.length > 0 && (
        <Section header={<Text>部分失败</Text>} footer={<Text>成功发布的文件不受这些失败记录影响。</Text>}>
          {props.result.failures.map((failure, index) => (
            <InfoRow
              label={`失败 ${index + 1} · ${failure.stage}`}
              value={`${failure.itemIndex ? `第 ${failure.itemIndex} 项 · ` : ""}${failure.message}`}
              selectable={true}
            />
          ))}
        </Section>
      )}

      <Section header={<Text>照片 App</Text>} footer={<Text>音频、字幕、缩略图及非兼容容器只保留在 Files。</Text>}>
        <HStack alignment="top" spacing={10}>
          <Image
            systemName={props.photos.attempted > 0 && props.photos.saved === props.photos.attempted ? "checkmark.circle.fill" : "folder.fill"}
            foregroundStyle={props.photos.attempted > 0 && props.photos.saved === props.photos.attempted ? "systemGreen" : "systemBlue"}
          />
          <Text>{props.photos.message}</Text>
        </HStack>
      </Section>

      <Section header={<Text>操作</Text>}>
        {props.photos.saved > 0 && (
          <Button title="打开照片 App" systemImage="photo.fill.on.rectangle.fill" action={props.onOpenPhotos} />
        )}
        {paths.length > 0 && (
          <Button title="分享全部产物" systemImage="square.and.arrow.up.on.square" action={props.onShareAll} />
        )}
        <Button title="继续下载" systemImage="house" action={props.onReadAgain} />
      </Section>
    </List>
  )
}
