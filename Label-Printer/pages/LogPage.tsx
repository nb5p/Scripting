import { ScrollView, Text } from "scripting"

interface LogPageProps {
  logs: string[]
}

export function LogPage({ logs }: LogPageProps) {
  const content = logs.length > 0 ? logs.join("\n") : "暂无日志"
  return (
    <ScrollView navigationTitle="日志" navigationBarTitleDisplayMode="inline">
      <Text
        font="footnote"
        foregroundStyle="label"
        multilineTextAlignment="leading"
        textSelection
        frame={{ maxWidth: "infinity", alignment: "leading" }}
        padding={16}
      >
        {content}
      </Text>
    </ScrollView>
  )
}
