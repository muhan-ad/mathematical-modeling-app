import { contextBridge, ipcRenderer } from 'electron'

// Expose a minimal, type-safe API to the renderer
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}

export type AppApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('app', api)
  } catch (error) {
    console.error('Failed to expose API:', error)
  }
} else {
  // @ts-ignore (define on window when context isolation disabled)
  window.app = api
}
