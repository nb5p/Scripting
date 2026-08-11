import { Button, HStack, Image, List, Section, Text, VStack } from "scripting"

export function ErrorView(props: {
  message: string
  canRetry: boolean
  onRetry: () => void
  onReset: () => void
  onRepair: () => void
}) {
  return (
    <List navigationTitle="下载失败" navigationBarTitleDisplayMode="inline">
      <Section>
        <HStack alignment="top" spacing={12}>
          <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemRed" />
          <VStack alignment="leading" spacing={5}>
            <Text font="headline">操作没有完成</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel" textSelection={true}>
              {props.message}
            </Text>
          </VStack>
        </HStack>
      </Section>
      <Section>
        {props.canRetry && <Button title="重试当前链接" systemImage="arrow.clockwise" action={props.onRetry} />}
        <Button title="返回首页" systemImage="house" action={props.onReset} />
        <Button title="重新安装下载核心" systemImage="wrench.and.screwdriver" action={props.onRepair} />
      </Section>
    </List>
  )
}
