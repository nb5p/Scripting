import { Button, HStack, Image, List, Section, Spacer, Text, VStack } from "scripting"
import { DownloadCoreSection } from "./DownloadCoreSection"
import { CookieManagementSection } from "./CookieManagementSection"

export function CommonHomeView(props: {
  version: string
  cookieConfigName: string | null
  onOpenCookieManager: () => void
  onReadClipboardAndContinue: () => void
  onSwitchMode: () => void
  onUpdate: () => void
}) {
  return (
    <List navigationTitle="视频下载器" navigationBarTitleDisplayMode="large">
      <Section>
        <HStack>
          <Spacer />
          <VStack alignment="center" spacing={14} padding={{ top: 30, bottom: 26 }}>
            <Image systemName="arrow.down.circle.fill" font="largeTitle" foregroundStyle="systemBlue" />
            <VStack alignment="center" spacing={12}>
              <Button
                title="读取剪贴板并继续"
                action={props.onReadClipboardAndContinue}
              />
            </VStack>
          </VStack>
          <Spacer />
        </HStack>
      </Section>

      <Section
        header={<Text>说明</Text>}
        footer={<Text>实际支持范围由 yt-dlp 决定；登录内容、DRM 视频和部分需要额外 JavaScript 环境的网站可能无法下载。</Text>}
      >
        <HStack>
          <Text>下载位置</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">文件 App / Video Downloads</Text>
        </HStack>
        <HStack>
          <Text>当前模式</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">常用模式</Text>
        </HStack>
      </Section>

      <DownloadCoreSection version={props.version} onUpdate={props.onUpdate} />

      <CookieManagementSection
        cookieConfigName={props.cookieConfigName}
        onOpenCookieManager={props.onOpenCookieManager}
      />

      <Section footer={<Text>切换结果会被保存，下次启动时自动打开高级模式。</Text>}>
        <Button
          title="切换到高级模式"
          systemImage="slider.horizontal.3"
          action={props.onSwitchMode}
        />
      </Section>
    </List>
  )
}
