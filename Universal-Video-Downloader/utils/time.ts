/** Time-range and positive-integer parsing helpers for advanced options. */

export function parseTimeInput(value: string, label: string): number | null {
  const input = value.trim()
  if (!input) return null
  const parts = input.split(":")
  if (parts.length < 1 || parts.length > 3) {
    throw new Error(`${label}格式无效，请输入秒、MM:SS 或 HH:MM:SS。`)
  }
  const secondPattern = /^\d+(?:\.\d+)?$/
  const integerPattern = /^\d+$/
  if (parts.length === 1) {
    if (!secondPattern.test(parts[0])) {
      throw new Error(`${label}格式无效，请输入非负秒数。`)
    }
    const seconds = Number(parts[0])
    if (!Number.isFinite(seconds)) throw new Error(`${label}不是有限数字。`)
    return seconds
  }
  const secondsPart = parts[parts.length - 1]
  const minutesPart = parts[parts.length - 2]
  if (!secondPattern.test(secondsPart) || !integerPattern.test(minutesPart)) {
    throw new Error(`${label}格式无效，请输入 MM:SS 或 HH:MM:SS。`)
  }
  const seconds = Number(secondsPart)
  const minutes = Number(minutesPart)
  if (seconds >= 60) throw new Error(`${label}的秒数部分必须小于 60。`)
  if (parts.length === 2) return minutes * 60 + seconds
  if (!integerPattern.test(parts[0])) {
    throw new Error(`${label}格式无效，请输入 HH:MM:SS。`)
  }
  if (minutes >= 60) throw new Error(`${label}的分钟部分必须小于 60。`)
  return Number(parts[0]) * 3600 + minutes * 60 + seconds
}

export function parsePositiveInteger(value: string, label: string): number {
  const input = value.trim()
  if (!/^\d+$/.test(input)) throw new Error(`${label}必须是正整数。`)
  const number = Number(input)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${label}必须是正整数。`)
  return number
}
