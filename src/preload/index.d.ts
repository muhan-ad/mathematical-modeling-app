import type { AppApi } from './index'

declare global {
  interface Window {
    app: AppApi
  }
}

export {}
