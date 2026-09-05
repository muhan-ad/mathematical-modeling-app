/// <reference types="vite/client" />

import type { AppApi } from '../../preload/index'

// Window.app 类型声明（与 preload/index.ts 中的 api 对应）
// 在 Electron 上下文里由 preload 注入；浏览器/Playwright 测试时 fallback 由 App.tsx 提供
declare global {
  interface Window {
    app?: AppApi
  }
}

export {}
