import type {
  BitmapData,
  LabelTemplate,
  PrintJob,
} from "../domain/types"
import { renderTextBitmap } from "./bitmapRenderer"
import { writeToPrinter } from "./printerTransport"
import { buildTsplRow, type PositionedBitmap } from "./tspl"

export interface PrintRowGroup {
  texts: string[]
  repeatCount: number
}

function sameRow(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((text, index) => text === right[index])
}

function appendRowGroup(
  groups: PrintRowGroup[],
  texts: string[],
  repeatCount: number,
): void {
  if (repeatCount <= 0) return
  const previous = groups[groups.length - 1]
  if (previous && sameRow(previous.texts, texts)) {
    previous.repeatCount += repeatCount
    return
  }
  groups.push({ texts, repeatCount })
}

export function planPrintRows(
  jobs: PrintJob[],
  columns: 1 | 2,
): PrintRowGroup[] {
  const normalized = jobs
    .filter(job => job.count > 0)
    .map(job => ({ text: job.text, remaining: Math.max(1, Math.floor(job.count)) }))
  const groups: PrintRowGroup[] = []
  let jobIndex = 0

  while (jobIndex < normalized.length) {
    const current = normalized[jobIndex]
    if (current.remaining >= columns) {
      const fullRows = Math.floor(current.remaining / columns)
      appendRowGroup(
        groups,
        Array.from({ length: columns }, () => current.text),
        fullRows,
      )
      current.remaining -= fullRows * columns
      if (current.remaining === 0) jobIndex += 1
      continue
    }

    const row: string[] = []
    while (row.length < columns && jobIndex < normalized.length) {
      const job = normalized[jobIndex]
      row.push(job.text)
      job.remaining -= 1
      if (job.remaining === 0) jobIndex += 1
    }
    appendRowGroup(groups, row, 1)
  }

  return groups
}

export async function printJobs(
  template: LabelTemplate,
  jobs: PrintJob[],
  ppi: number,
  onLog: (message: string) => void,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const rowGroups = planPrintRows(jobs, template.columns)
  const totalRows = rowGroups.reduce(
    (total, group) => total + group.repeatCount,
    0,
  )
  const bitmapCache = new Map<string, BitmapData>()
  let completedRows = 0

  for (const group of rowGroups) {
    const positioned: PositionedBitmap[] = []
    for (let column = 0; column < group.texts.length; column++) {
      const text = group.texts[column]
      let bitmap = bitmapCache.get(text)
      if (!bitmap) {
        onLog(`生成位图：${text}…`)
        bitmap = await renderTextBitmap(
          text,
          template.widthMm,
          template.heightMm,
          ppi,
        ) ?? undefined
        if (!bitmap) throw new Error(`“${text}”位图生成失败`)
        bitmapCache.set(text, bitmap)
      }
      positioned.push({ column, bitmap })
    }

    const rowDescription = group.texts.join(" | ")
    const command = buildTsplRow(
      template,
      positioned,
      group.repeatCount,
      ppi,
    )
    onLog(`发送 ${rowDescription} × ${group.repeatCount} 行（${command.size}B，二进制位图）`)
    await writeToPrinter(command, onLog)
    completedRows += group.repeatCount
    onLog(`完成 ${rowDescription} ✓`)
    onProgress?.(completedRows, totalRows)
  }
}
