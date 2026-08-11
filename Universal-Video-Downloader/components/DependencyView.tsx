import { Button, HStack, Image, List, Section, Text, VStack } from "scripting"
import { LoadingCard } from "./LoadingCard"

export function DependencyView(props: {
  installing: boolean
  message?: string
  onInstall: () => void
  onCheck: () => void
}) {
  return (
    <List navigationTitle="视频下载器" navigationBarTitleDisplayMode="large">
      <Section>
        {props.installing ? (
          <LoadingCard
            title="正在安装 yt-dlp…"
            subtitle="正在安装通用网站解析核心，请保持网络连接。"
          />
        ) : (
          <HStack alignment="top" spacing={12}>
            <Image
              systemName={props.message ? "exclamationmark.triangle.fill" : "shippingbox.fill"}
              foregroundStyle={props.message ? "systemRed" : "systemOrange"}
            />
            <VStack alignment="leading" spacing={4}>
              <Text font="headline">
                {props.message ? "依赖检测失败" : "需要初始化下载核心"}
              </Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {props.message || "首次使用前安装一次 yt-dlp 核心包，之后即可直接下载。"}
              </Text>
            </VStack>
          </HStack>
        )}
      </Section>

      {!props.installing && (
        <Section header={<Text>初始化</Text>}>
          <Button title="安装 yt-dlp" systemImage="arrow.down.circle" action={props.onInstall} />
          <Button title="重新检测" systemImage="arrow.clockwise" action={props.onCheck} />
        </Section>
      )}

      <Section footer={<Text>只安装跨平台 Python 核心，不安装需要本地编译的可选依赖。</Text>}>
        <Text font="footnote" foregroundStyle="secondaryLabel">
          安装是下载器的初始化步骤，不会读取剪贴板，也不会自动开始下载。
        </Text>
      </Section>
    </List>
  )
}
