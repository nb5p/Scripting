export function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms))
}

export function breakableId(value: string): string {
  return value.split("").join("\u200B")
}

export function limitDigits(value: string, maxLength: number): string {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength)
}

export function parsePositiveCount(value: string): number {
  const count = parseInt(value, 10)
  return Number.isFinite(count) && count > 0 ? count : 1
}

export function parseLabelLines(value: string): string[] {
  return value.split("\n").map(line => line.trim()).filter(line => line.length > 0)
}
