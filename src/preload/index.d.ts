import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openExternal: (url: string) => Promise<void>
      scrapeHltvPlayer?: (url: string) => Promise<any>
      scrapeHltvTeam?: (url: string) => Promise<any>
      onUpdateAvailable: (callback: (version: string) => void) => void
    }
  }
}
