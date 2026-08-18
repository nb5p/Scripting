let pendingTexts: string[] = []

export function setPrintDraft(texts: string[]): void {
  pendingTexts = [...texts]
}

export function getPrintDraft(): string[] {
  return [...pendingTexts]
}
