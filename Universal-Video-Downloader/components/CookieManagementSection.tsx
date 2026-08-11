import { Button, HStack, Section, Spacer, Text } from "scripting"

/** Shared "Cookie management" section used by both home views. */
export function CookieManagementSection(props: {
  cookieConfigName: string | null
  onOpenCookieManager: () => void
  footerText?: string
}) {
  return (
    <Section
      header={<Text>Cookie 管理</Text>}
      footer={<Text>{props.footerText ?? "用于需要登录才能访问的视频。Cookie 内容以 AES-256 加密存储，仅在下载时解密使用。"}</Text>}
    >
      <HStack>
        <Text>当前 Cookie</Text>
        <Spacer />
        <Text foregroundStyle={props.cookieConfigName ? "systemGreen" : "secondaryLabel"}>
          {props.cookieConfigName ?? "未使用"}
        </Text>
      </HStack>
      <Button
        title="管理 Cookie"
        systemImage="lock.shield"
        action={props.onOpenCookieManager}
      />
    </Section>
  )
}
