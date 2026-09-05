export type ProviderType = 'openai_compat' | 'anthropic' | 'gemini'
export type Stage = 'understanding' | 'modeling' | 'solving' | 'writing' | 'review'

export interface ProviderView {
  id: string
  type: ProviderType
  baseUrl: string
  model: string
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

export interface SettingsView {
  providers: ProviderView[]
  defaultProvider: string | null
  perStage: Partial<Record<Stage, string>>
  search: { enabled: boolean; provider: 'tavily' | 'serpapi'; hasApiKey: boolean }
  promptOptimizer: { providerId: string | null }
  safeStorageAvailable: boolean
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  openai_compat: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  gemini: 'Gemini'
}

export const PROVIDER_TYPE_HINTS: Record<ProviderType, string> = {
  openai_compat: 'OpenAI GPT-5.5 / DeepSeek V4 / Kimi K3 / 智谱 GLM-5 / Ollama 等',
  anthropic: 'Claude Sonnet 5 / Opus 5 系列',
  gemini: 'Gemini 3.1 / 2.5 系列'
}

/**
 * 各协议类型打开对话框时的默认预填（2026-09 校准）：
 * DeepSeek 旧 ID deepseek-chat/deepseek-reasoner 已于 2026-07-24 停用
 */
export const PROVIDER_TYPE_PRESETS: Record<ProviderType, { baseUrl: string; model: string }> = {
  openai_compat: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.1-pro-preview' }
}

/** 常用服务商快选（点击直接填入 Base URL + 模型 ID） */
export const PROVIDER_QUICK_PRESETS: {
  type: ProviderType
  name: string
  baseUrl: string
  model: string
}[] = [
  { type: 'openai_compat', name: 'GPT-5.5', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' },
  { type: 'openai_compat', name: 'DeepSeek V4 Flash', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  { type: 'openai_compat', name: 'DeepSeek V4 Pro', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
  { type: 'openai_compat', name: 'Kimi K3', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3' },
  { type: 'openai_compat', name: '智谱 GLM-5', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5' },
  { type: 'openai_compat', name: '智谱 GLM-5.3', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3' },
  { type: 'anthropic', name: 'Claude Sonnet 5', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },
  { type: 'anthropic', name: 'Claude Opus 5', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5' },
  { type: 'gemini', name: 'Gemini 3.1 Pro', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.1-pro-preview' },
  { type: 'gemini', name: 'Gemini 3 Flash', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3-flash-preview' },
  { type: 'gemini', name: 'Gemini 2.5 Pro（稳定版）', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-pro' }
]

export const STAGE_LABELS: Record<Stage, string> = {
  understanding: '题目理解',
  modeling: '建模',
  solving: '求解',
  writing: '论文写作',
  review: '校对编译'
}

const fallbackSettingsApi = {
  get: async () => {
    throw new Error('设置功能仅在桌面应用中可用')
  },
  saveProvider: fallbackThrow,
  deleteProvider: fallbackThrow,
  setDefault: fallbackThrow,
  setStageProvider: fallbackThrow,
  saveSearch: fallbackThrow,
  openDir: fallbackThrow,
  setPromptOptimizer: fallbackThrow
}

function fallbackThrow(): Promise<never> {
  return Promise.reject(new Error('设置功能仅在桌面应用中可用'))
}

export function getSettingsApi() {
  return window.app?.settings ?? fallbackSettingsApi
}
