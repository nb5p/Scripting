import type { PersistedState } from "../domain/types"

const DEFAULT_STATE: PersistedState = {
  templates: [],
  settings: { ppi: 300, autoConnect: false, lastPrinterId: "" },
  knownPrinters: [],
}

function dataFilePath(): string {
  return FileManager.documentsDirectory + "/label_print_data.json"
}

export function loadState(): PersistedState {
  try {
    if (FileManager.existsSync(dataFilePath())) {
      const value = JSON.parse(FileManager.readAsStringSync(dataFilePath(), "utf8"))
      return {
        templates: Array.isArray(value.templates) ? value.templates : [],
        settings: { ...DEFAULT_STATE.settings, ...(value.settings ?? {}) },
        knownPrinters: Array.isArray(value.knownPrinters) ? value.knownPrinters : [],
      }
    }
  } catch (error) {
    console.log("读取模板失败", error)
  }
  return {
    templates: [],
    settings: { ...DEFAULT_STATE.settings },
    knownPrinters: [],
  }
}

export function saveState(state: PersistedState): void {
  try {
    FileManager.writeAsStringSync(dataFilePath(), JSON.stringify(state), "utf8")
  } catch (error) {
    console.log("保存模板失败", error)
  }
}
