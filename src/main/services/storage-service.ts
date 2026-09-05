import { app, safeStorage, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

/**
 * 设置与安全存储服务（design.md §7.2）
 *
 * - 配置整体存 userData/config.json
 * - API key 用 safeStorage（Windows DPAPI）加密后 base64 落盘，明文永不出主进程
 * - 渲染端只能拿到 hasApiKey 布尔值，拿不到密文更拿不到明文
 * - Agent Runtime 启动时由主进程解密后通过受控通道注入
 */

const CONFIG_FILE = 'config.json'

export type ProviderType = 'openai_compat' | 'anthropic' | 'gemini'

/** 5 个 Agent 阶段（design.md §5） */
export type Stage = 'understanding' | 'modeling' | 'solving' | 'writing' | 'review'

export const STAGES: Stage[] = ['understanding', 'modeling', 'solving', 'writing', 'review']

export interface ProviderConfig {
  id: string
  type: ProviderType
  /** OpenAI 兼容/自建网关地址；anthropic/gemini 可留空用官方默认 */
  baseUrl: string
  model: string
  /** safeStorage 加密后的 base64，永不出主进程 */
  apiKeyEncrypted?: string
  createdAt: string
  updatedAt: string
}

export interface SearchConfig {
  enabled: boolean
  provider: 'tavily' | 'serpapi'
  apiKeyEncrypted?: string
}

interface ConfigFile {
  schemaVersion: 1
  providers: Record<string, ProviderConfig>
  defaultProvider: string | null
  /** 每阶段指定 provider（缺省用 defaultProvider） */
  perStage: Partial<Record<Stage, string>>
  search: SearchConfig
  /** 提示词优化用的 provider（缺省用 defaultProvider） */
  promptOptimizer: { providerId: string | null }
}

/** 发给渲染端的 provider 视图：无密钥内容，只有布尔标记 */
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

function emptyConfig(): ConfigFile {
  return {
    schemaVersion: 1,
    providers: {},
    defaultProvider: null,
    perStage: {},
    search: { enabled: true, provider: 'tavily' },
    promptOptimizer: { providerId: null }
  }
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

function readConfig(): ConfigFile {
  const p = getConfigPath()
  if (!existsSync(p)) return emptyConfig()
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as ConfigFile
    // 基本形状防御：字段缺失时补默认值
    return {
      schemaVersion: 1,
      providers: raw.providers ?? {},
      defaultProvider: raw.defaultProvider ?? null,
      perStage: raw.perStage ?? {},
      search: { enabled: raw.search?.enabled ?? true, provider: raw.search?.provider ?? 'tavily', apiKeyEncrypted: raw.search?.apiKeyEncrypted },
      promptOptimizer: { providerId: raw.promptOptimizer?.providerId ?? null }
    }
  } catch {
    // 配置损坏时不覆盖原文件，先返回空配置（写操作时由调用方重新落盘）
    console.warn('[storage] config.json 损坏，使用默认配置')
    return emptyConfig()
  }
}

function writeConfig(config: ConfigFile): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * 在资源管理器中定位模型 API 配置文件（config.json）
 * 文件不存在时先写入空配置，保证能定位到
 */
export async function openConfigDir(): Promise<{ success: boolean; message: string }> {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    writeConfig(emptyConfig())
  }
  shell.showItemInFolder(configPath)
  return { success: true, message: '已在资源管理器中打开' }
}

function encryptApiKey(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统不支持安全加密存储（safeStorage 不可用），无法保存 API key')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function decryptApiKey(encryptedB64: string): string {
  return safeStorage.decryptString(Buffer.from(encryptedB64, 'base64'))
}

function toView(p: ProviderConfig): ProviderView {
  return {
    id: p.id,
    type: p.type,
    baseUrl: p.baseUrl,
    model: p.model,
    hasApiKey: Boolean(p.apiKeyEncrypted),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }
}

/** 读取设置视图（渲染端安全格式，无任何密钥内容） */
export function getSettings(): SettingsView {
  const config = readConfig()
  return {
    providers: Object.values(config.providers)
      .map(toView)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    defaultProvider: config.defaultProvider,
    perStage: config.perStage,
    search: {
      enabled: config.search.enabled,
      provider: config.search.provider,
      hasApiKey: Boolean(config.search.apiKeyEncrypted)
    },
    promptOptimizer: { providerId: config.promptOptimizer.providerId },
    safeStorageAvailable: safeStorage.isEncryptionAvailable()
  }
}

/** 设置提示词优化用的 provider（null = 跟随默认模型） */
export function setPromptOptimizerProvider(id: string | null): { success: boolean; message: string } {
  const config = readConfig()
  if (id !== null && !config.providers[id]) {
    return { success: false, message: '该 provider 不存在' }
  }
  config.promptOptimizer.providerId = id
  writeConfig(config)
  return { success: true, message: '已更新提示词优化模型' }
}

/** 主进程内部：取提示词优化「固定模式」指定的 provider；未固定时返回 null（由调用方回退到对话当前模型） */
export function resolvePromptOptimizer(): {
  id: string
  type: ProviderType
  baseUrl: string
  model: string
  apiKey: string
} | null {
  const config = readConfig()
  const targetId = config.promptOptimizer.providerId
  if (!targetId) return null
  const provider = config.providers[targetId]
  if (!provider) return null
  return {
    id: provider.id,
    type: provider.type,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: provider.apiKeyEncrypted ? decryptApiKey(provider.apiKeyEncrypted) : ''
  }
}

/** 新增或更新 provider；apiKey 传空字符串表示清除，undefined 表示保留旧值 */
export function saveProvider(input: {
  id?: string
  type: ProviderType
  baseUrl: string
  model: string
  apiKey?: string
}): ProviderView {
  const config = readConfig()
  const now = new Date().toISOString()

  let provider: ProviderConfig
  if (input.id && config.providers[input.id]) {
    provider = config.providers[input.id]
    provider.type = input.type
    provider.baseUrl = input.baseUrl.trim()
    provider.model = input.model.trim()
    provider.updatedAt = now
  } else {
    const id = input.id ?? `prov_${Date.now().toString(36)}`
    provider = {
      id,
      type: input.type,
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      createdAt: now,
      updatedAt: now
    }
    config.providers[id] = provider
  }

  if (input.apiKey !== undefined) {
    provider.apiKeyEncrypted = input.apiKey === '' ? undefined : encryptApiKey(input.apiKey)
  }

  // 第一个 provider 自动设为默认
  if (!config.defaultProvider) {
    config.defaultProvider = provider.id
  }

  writeConfig(config)
  return toView(provider)
}

export function deleteProvider(id: string): { success: boolean; message: string } {
  const config = readConfig()
  if (!config.providers[id]) {
    return { success: false, message: '该 provider 不存在' }
  }
  delete config.providers[id]
  if (config.defaultProvider === id) {
    config.defaultProvider = Object.keys(config.providers)[0] ?? null
  }
  for (const stage of STAGES) {
    if (config.perStage[stage] === id) {
      delete config.perStage[stage]
    }
  }
  writeConfig(config)
  return { success: true, message: '已删除' }
}

/** 主进程内部使用：按 id 取 provider 明文配置（工作台对话里手动选模型时用） */
export function resolveProviderById(
  id: string
): { id: string; type: ProviderType; baseUrl: string; model: string; apiKey: string } | null {
  const provider = readConfig().providers[id]
  if (!provider) return null
  return {
    id: provider.id,
    type: provider.type,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: provider.apiKeyEncrypted ? decryptApiKey(provider.apiKeyEncrypted) : ''
  }
}

export function setDefaultProvider(id: string): { success: boolean; message: string } {
  const config = readConfig()
  if (!config.providers[id]) return { success: false, message: '该 provider 不存在' }
  config.defaultProvider = id
  writeConfig(config)
  return { success: true, message: '已设为默认' }
}

export function setStageProvider(stage: Stage, id: string | null): { success: boolean; message: string } {
  if (!STAGES.includes(stage)) return { success: false, message: `未知阶段：${stage}` }
  const config = readConfig()
  if (id !== null && !config.providers[id]) {
    return { success: false, message: '该 provider 不存在' }
  }
  if (id === null) {
    delete config.perStage[stage]
  } else {
    config.perStage[stage] = id
  }
  writeConfig(config)
  return { success: true, message: '已更新阶段模型' }
}

export function saveSearchConfig(input: { enabled: boolean; provider: 'tavily' | 'serpapi'; apiKey?: string }): void {
  const config = readConfig()
  config.search.enabled = input.enabled
  config.search.provider = input.provider
  if (input.apiKey !== undefined) {
    config.search.apiKeyEncrypted = input.apiKey === '' ? undefined : encryptApiKey(input.apiKey)
  }
  writeConfig(config)
}

/**
 * 主进程内部使用：取某阶段实际生效的 provider 明文配置（含解密后的 key）
 * 仅供 spawn Agent Runtime / 主进程发起 LLM 请求时调用
 */
export function resolveProviderForStage(
  stage: Stage
): { id: string; type: ProviderType; baseUrl: string; model: string; apiKey: string } | null {
  const config = readConfig()
  const targetId = config.perStage[stage] ?? config.defaultProvider
  if (!targetId) return null
  const provider = config.providers[targetId]
  if (!provider) return null
  return {
    id: provider.id,
    type: provider.type,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: provider.apiKeyEncrypted ? decryptApiKey(provider.apiKeyEncrypted) : ''
  }
}

/** 主进程内部使用：搜索配置（含解密 key） */
export function resolveSearchConfig(): { enabled: boolean; provider: 'tavily' | 'serpapi'; apiKey: string } {
  const config = readConfig()
  return {
    enabled: config.search.enabled,
    provider: config.search.provider,
    apiKey: config.search.apiKeyEncrypted ? decryptApiKey(config.search.apiKeyEncrypted) : ''
  }
}
