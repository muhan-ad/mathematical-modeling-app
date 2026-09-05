/**
 * 主题切换：暗色（默认）/ 浅色
 * 通过切换 html 元素的 dark 类生效（tailwind darkMode: 'class'）
 * 选择持久化在 localStorage（纯 UI 偏好，不进主进程配置）
 */

export type ThemeName = 'dark' | 'light'

const STORAGE_KEY = 'wam-theme'

export function getTheme(): ThemeName {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: ThemeName): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  localStorage.setItem(STORAGE_KEY, theme)
}

/** 应用启动时调用，在首帧前恢复上次选择 */
export function initTheme(): ThemeName {
  const theme = getTheme()
  applyTheme(theme)
  return theme
}
