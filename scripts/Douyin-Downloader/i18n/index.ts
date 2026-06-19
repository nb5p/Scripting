// i18n loader.
// To add a new language, create a new file (e.g. ja.ts) exporting the same keys,
// then register it in the `locales` map below.

import zh from "./zh"
import en from "./en"

export type StringKey = keyof typeof en

type Strings = Record<StringKey, string>

const locales: Record<string, Strings> = {
  zh,
  en,
}

function detectLocale(): string {
  const code = Device.systemLanguageCode.toLowerCase()
  if (code.startsWith("zh")) return "zh"
  if (code.startsWith("en")) return "en"
  // Fallback: match any registered locale by language code prefix.
  for (const key of Object.keys(locales)) {
    if (code.startsWith(key)) return key
  }
  return "en"
}

const activeLocale = detectLocale()
const activeStrings = locales[activeLocale] ?? en

// Translate a string key. Falls back to English, then to the key itself.
export function t(key: StringKey): string {
  return activeStrings[key] ?? en[key] ?? key
}