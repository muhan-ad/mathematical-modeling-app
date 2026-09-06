/**
 * 提示词优化 AI 的专属技能（与主技能库完全隔离）。
 *
 * 存储：<userData>/prompt-optimizer-skills/*.md（单文件技能，frontmatter 同格式）
 * 用途：优化提示词时，把启用的专属技能正文附加到优化模型的系统提示词，
 *       让优化产出的指令更贴合主力 Agent 的目录规范/工具集/技能生态。
 * 管理入口：设置页「提示词优化」区块（不在主技能库管理里）。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface OptimizerSkillMeta {
  id: string
  name: string
  description: string
  /** 启用后才注入优化提示词 */
  enabled: boolean
  updatedAt: string
}

export interface OptimizerSkillDetail extends OptimizerSkillMeta {
  content: string
}

function getRoot(): string {
  return join(app.getPath('userData'), 'prompt-optimizer-skills')
}

function getEnabledFile(): string {
  return join(getRoot(), '_enabled.json')
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || `opt-skill-${Date.now().toString(36)}`
}

function parseFrontmatter(raw: string): { name: string; description: string; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { name: '', description: '', content: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { name: meta.name ?? '', description: meta.description ?? '', content: match[2].trim() }
}

function readEnabled(): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(getEnabledFile(), 'utf-8')) as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeEnabled(map: Record<string, boolean>): void {
  mkdirSync(getRoot(), { recursive: true })
  writeFileSync(getEnabledFile(), JSON.stringify(map, null, 2), 'utf-8')
}

export function listOptimizerSkills(): OptimizerSkillMeta[] {
  const root = getRoot()
  if (!existsSync(root)) return []
  const enabled = readEnabled()
  const out: OptimizerSkillMeta[] = []
  for (const f of readdirSync(root)) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue
    const id = f.slice(0, -3)
    try {
      const parsed = parseFrontmatter(readFileSync(join(root, f), 'utf-8'))
      out.push({
        id,
        name: parsed.name || id,
        description: parsed.description,
        enabled: enabled[id] ?? false,
        updatedAt: statSync(join(root, f)).mtime.toISOString()
      })
    } catch {
      continue
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function getOptimizerSkill(id: string): OptimizerSkillDetail | null {
  const safe = sanitizeId(id)
  const file = join(getRoot(), `${safe}.md`)
  if (!existsSync(file)) return null
  const parsed = parseFrontmatter(readFileSync(file, 'utf-8'))
  const enabled = readEnabled()[safe] ?? false
  return {
    id: safe,
    name: parsed.name || safe,
    description: parsed.description,
    enabled,
    updatedAt: statSync(file).mtime.toISOString(),
    content: parsed.content
  }
}

export function saveOptimizerSkill(input: {
  id?: string
  name: string
  description: string
  content: string
}): { success: boolean; id?: string; message: string } {
  try {
    const name = input.name.trim()
    if (!name) return { success: false, message: '名称不能为空' }
    const id = sanitizeId(input.id?.trim() || name)
    mkdirSync(getRoot(), { recursive: true })
    writeFileSync(
      join(getRoot(), `${id}.md`),
      `---\nname: ${name}\ndescription: ${input.description.trim()}\n---\n\n${input.content.trim()}\n`,
      'utf-8'
    )
    return { success: true, id, message: '专属技能已保存' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function deleteOptimizerSkill(id: string): { success: boolean; message: string } {
  try {
    const safe = sanitizeId(id)
    const file = join(getRoot(), `${safe}.md`)
    if (!existsSync(file)) return { success: false, message: '技能不存在' }
    rmSync(file, { force: true })
    const enabled = readEnabled()
    delete enabled[safe]
    writeEnabled(enabled)
    return { success: true, message: '专属技能已删除' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function setOptimizerSkillEnabled(id: string, enabled: boolean): { success: boolean; message: string } {
  try {
    const safe = sanitizeId(id)
    if (!existsSync(join(getRoot(), `${safe}.md`))) return { success: false, message: '技能不存在' }
    const map = readEnabled()
    map[safe] = enabled
    writeEnabled(map)
    return { success: true, message: enabled ? '已启用' : '已停用' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** 优化调用时取所有启用技能的正文拼接（prompt-optimizer.ts 使用） */
export function resolveEnabledOptimizerSkillText(): string {
  const parts: string[] = []
  for (const s of listOptimizerSkills()) {
    if (!s.enabled) continue
    const detail = getOptimizerSkill(s.id)
    if (detail?.content) {
      parts.push(`### 专属指导：${detail.name}\n${detail.content}`)
    }
  }
  return parts.join('\n\n')
}
