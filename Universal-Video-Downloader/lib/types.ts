/** Shared types used across the app. */

export type HomeMode = "common" | "advanced"

/** Unified progress shape for both quick and advanced downloads. */
export type UnifiedDownloadProgress = {
  stage: string
  message: string
  percent: number | null
  downloadedBytes: number
  totalBytes: number | null
  speed: number | null
  eta: number | null
  itemIndex?: number
  itemCount?: number
  batchIndex?: number
  batchCount?: number
  title?: string
}

export type AdvancedPhotosStatus = {
  attempted: number
  saved: number
  message: string
}

export type PageState =
  | { type: "checking" }
  | { type: "missing" }
  | { type: "installing" }
  | { type: "updateCheck"; message: string; isError: boolean; version: string; updateAvailable: boolean }
  | { type: "idle"; version: string }
  | { type: "inspecting"; url: string; version: string }
  | { type: "ready"; url: string; info: import("./downloader").MediaInfo; version: string }
  | {
      type: "downloading"
      url: string
      info: import("./downloader").MediaInfo
      version: string
      mode: "compatible" | "nativeMerge" | "advanced"
      progress: UnifiedDownloadProgress
      cancelTokenPath: string
      cancelling: boolean
    }
  | {
      type: "success"
      result: import("./downloader").DownloadResult
      version: string
      savedToPhotos: boolean
      photosMessage?: string
    }
  | {
      type: "advancedSuccess"
      result: import("./advanced_downloader").AdvancedDownloadResult
      version: string
      photos: AdvancedPhotosStatus
    }
  | { type: "error"; message: string; version?: string; url?: string }
