import type { Color } from "scripting"

export const SAFE_MARGIN_MM = 1.5
export const CONNECTION_TIMEOUT_MS = 8000

export const COLORS: Record<string, Color> = {
  card: "secondarySystemGroupedBackground",
  cardAlt: "secondarySystemFill",
  muted: "secondaryLabel",
  green: "systemGreen",
  grayDot: "tertiaryLabel",
  heroStart: "#2563eb",
  heroEnd: "#7c3aed",
  danger: "systemRed",
}
