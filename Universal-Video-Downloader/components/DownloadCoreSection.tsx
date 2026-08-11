import { Button, HStack, Section, Spacer, Text } from "scripting"

/** Shared "yt-dlp core" section used by both home views. */
export function DownloadCoreSection(props: { version: string; onUpdate: () => void }) {
  return (
    <Section header={<Text>下载核心</Text>} footer={<Text>更新不是必需操作；遇到网站规则变化时可尝试更新。</Text>}>
      <HStack>
        <Text>yt-dlp</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">{props.version}</Text>
      </HStack>
      <Button
        title="检查更新"
        systemImage="arrow.triangle.2.circlepath"
        action={props.onUpdate}
      />
    </Section>
  )
}
