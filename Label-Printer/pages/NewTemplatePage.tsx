import {
  Button,
  HStack,
  Picker,
  ScrollView,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  useState,
  VStack,
} from "scripting"
import { Card } from "../components/Card"
import { LabelShape } from "../components/LabelShape"
import { COLORS } from "../domain/constants"
import type { LabelTemplate } from "../domain/types"
import { limitDigits } from "../utils/format"

interface NewTemplatePageProps {
  onSave: (template: LabelTemplate) => void
}

export function NewTemplatePage({ onSave }: NewTemplatePageProps) {
  const [widthText, setWidthText] = useState("40")
  const [heightText, setHeightText] = useState("30")
  const [gapText, setGapText] = useState("1")
  const [columns, setColumns] = useState<1 | 2>(1)
  const [shape, setShape] = useState<"square" | "circle">("square")
  const [error, setError] = useState("")

  const widthMm = parseFloat(widthText)
  const heightMm = parseFloat(heightText)
  const previewTemplate: LabelTemplate = {
    id: "preview",
    widthMm: widthMm > 0 ? widthMm : 40,
    heightMm: heightMm > 0 ? heightMm : 30,
    gapMm: parseFloat(gapText) || 0,
    columns,
    shape,
    createdAt: 0,
  }

  const save = () => {
    if (!(widthMm > 0) || !(heightMm > 0)) {
      setError("宽高必须是大于 0 的数字")
      return
    }
    if (!(parseFloat(gapText) >= 0)) {
      setError("间距必须是不小于 0 的数字")
      return
    }
    setError("")
    const now = Date.now()
    onSave({
      id: now.toString(),
      widthMm,
      heightMm,
      gapMm: parseFloat(gapText),
      columns,
      shape,
      createdAt: now,
    })
  }

  return (
    <ScrollView
      navigationTitle="新建标签模板"
      navigationBarTitleDisplayMode="inline"
      toolbar={
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            <Button title="保存" buttonStyle="borderedProminent" action={save} />
          </ToolbarItem>
        </Toolbar>
      }
    >
      <VStack spacing={16} padding={16}>
        <Card title="预览" footer="按标签实际比例显示">
          <VStack frame={{ maxWidth: "infinity" }}>
            <LabelShape tpl={previewTemplate} maxWidth={220} maxHeight={140} />
          </VStack>
        </Card>

        <Card title="尺寸与间距（毫米）">
          <HStack
            spacing={6}
            frame={{ maxWidth: "infinity", minHeight: 52, alignment: "center" }}
          >
            <HStack spacing={6} frame={{ width: 92, alignment: "center" }}>
              <Text font="footnote" fontWeight="semibold" fixedSize>宽度</Text>
              <TextField
                label={<Text> </Text>}
                value={widthText}
                onChanged={value => setWidthText(limitDigits(value, 4))}
                keyboardType="numberPad"
                textFieldStyle="roundedBorder"
                frame={{ maxWidth: "infinity" }}
              />
            </HStack>
            <Text foregroundStyle={COLORS.muted} fixedSize>×</Text>
            <HStack spacing={6} frame={{ width: 92, alignment: "center" }}>
              <Text font="footnote" fontWeight="semibold" fixedSize>高度</Text>
              <TextField
                label={<Text> </Text>}
                value={heightText}
                onChanged={value => setHeightText(limitDigits(value, 4))}
                keyboardType="numberPad"
                textFieldStyle="roundedBorder"
                frame={{ maxWidth: "infinity" }}
              />
            </HStack>
            <HStack spacing={4} frame={{ width: 88, alignment: "center" }}>
              <Text font="footnote" fontWeight="semibold" fixedSize>间距</Text>
              <TextField
                label={<Text> </Text>}
                value={gapText}
                onChanged={value => setGapText(limitDigits(value, 1))}
                keyboardType="numberPad"
                textFieldStyle="roundedBorder"
                frame={{ maxWidth: "infinity" }}
              />
            </HStack>
          </HStack>
        </Card>

        <Card title="列数">
          <Picker
            value={String(columns)}
            onChanged={(value: string) => setColumns(value === "2" ? 2 : 1)}
            pickerStyle="segmented"
            title="列数"
          >
            <Text tag="1">1 列</Text>
            <Text tag="2">2 列</Text>
          </Picker>
        </Card>

        <Card title="形状">
          <Picker
            value={shape}
            onChanged={(value: string) => setShape(value as "square" | "circle")}
            pickerStyle="segmented"
            title="形状"
          >
            <Text tag="square">方形</Text>
            <Text tag="circle">圆形</Text>
          </Picker>
        </Card>

        {error ? (
          <Text font="footnote" foregroundStyle={COLORS.danger}>{error}</Text>
        ) : null}
      </VStack>
    </ScrollView>
  )
}
