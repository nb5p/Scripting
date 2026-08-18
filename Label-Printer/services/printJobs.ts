import type { LabelTemplate, PrintJob } from "../domain/types"
import { renderTextBitmap } from "./bitmapRenderer"
import { writeToPrinter } from "./printerTransport"
import { buildTspl } from "./tspl"

export async function printJobs(
  template: LabelTemplate,
  jobs: PrintJob[],
  ppi: number,
  onLog: (message: string) => void,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]
    onLog(`生成位图：${job.text}…`)
    const bitmap = await renderTextBitmap(
      job.text,
      template.widthMm,
      template.heightMm,
      ppi,
    )
    if (!bitmap) throw new Error(`“${job.text}”位图生成失败`)

    const command = buildTspl(template, bitmap, job.count, ppi)
    onLog(`发送 ${job.text} × ${job.count}（${command.size}B，二进制位图）`)
    await writeToPrinter(command, onLog)
    onLog(`完成 ${job.text} ✓`)
    onProgress?.(index + 1, jobs.length)
  }
}
