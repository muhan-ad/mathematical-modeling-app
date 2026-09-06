/**
 * 技能（Skill）管理：参照 DSH 的"目录 + YAML frontmatter + 按需加载"模式。
 *
 * 存储：用户技能 <userData>/skills/<ascii-id>/SKILL.md
 *       插件技能 <userData>/plugins/<plugin-id>/skills/<dir>/SKILL.md
 *   ---
 *   name: 回归分析          ← 中文名（展示/调用用）
 *   description: ...
 *   ---
 *
 * 路径规范：目录名一律 ASCII（应用内禁止中文路径）；中文只存在 frontmatter。
 * Agent 接入：目录（名称 + 描述 + 所属目录）注入系统提示词；skill_load 按
 * 「名称 → 目录」映射取全文，用户技能与插件技能统一。
 */

import { app, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface SkillMeta {
  /** ASCII 目录名（用户技能的唯一标识） */
  id: string
  /** 技能名（frontmatter 里的 name，可为中文；skill_load 的调用键） */
  name: string
  description: string
  updatedAt: string
  /** SKILL.md 所在目录（绝对路径）——插件技能与用户技能目录不同 */
  dir: string
  /** 来源：user 用户技能 / plugin 插件技能（插件技能只读） */
  source: 'user' | 'plugin'
  /** 来源插件名（source=plugin 时有值） */
  pluginName?: string
}

export interface SkillDetail extends SkillMeta {
  content: string
}

function getSkillsRoot(): string {
  return join(app.getPath('userData'), 'skills')
}

function getPluginsRoot(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** 随包内置技能的根目录（打包后位于 resources/skills，开发态位于仓库 resources/skills） */
function getBundledSkillsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath ?? '', 'skills')
    : join(app.getAppPath(), 'resources', 'skills')
}

/** 首次运行把随包内置技能播种到用户技能库（用 marker 只执行一次，尊重用户之后的删除） */
function ensureBundledSkills(): void {
  try {
    const userRoot = getSkillsRoot()
    const marker = join(userRoot, '.bundled-seed-v1')
    if (existsSync(marker)) return
    const bundledRoot = getBundledSkillsRoot()
    if (!existsSync(bundledRoot)) return
    mkdirSync(userRoot, { recursive: true })
    for (const d of readdirSync(bundledRoot, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const src = join(bundledRoot, d.name, 'SKILL.md')
      if (!existsSync(src)) continue
      const destDir = join(userRoot, d.name)
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
        copyFileSync(src, join(destDir, 'SKILL.md'))
      }
    }
    writeFileSync(marker, new Date().toISOString(), 'utf-8')
  } catch {
    /* 播种失败不阻塞应用启动 */
  }
}

/** 目录名只允许 ASCII：字母/数字/下划线/连字符 */
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').trim()
  if (!cleaned) {
    // 全中文等无法转写时生成 ASCII 兜底 ID
    return `skill-${Date.now().toString(36)}`
  }
  if (cleaned.length > 60) return cleaned.slice(0, 60)
  return cleaned
}

function parseFrontmatter(raw: string): { name: string; description: string; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { name: '', description: '', content: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return { name: meta.name ?? '', description: meta.description ?? '', content: match[2].trim() }
}

function serializeFrontmatter(name: string, description: string, content: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${content.trim()}\n`
}

interface LoadedSkill extends SkillMeta {
  content: string
}

function loadSkillFrom(skillFile: string, id: string, source: SkillMeta['source'], pluginName?: string): LoadedSkill | null {
  try {
    const parsed = parseFrontmatter(readFileSync(skillFile, 'utf-8'))
    return {
      id,
      name: parsed.name || id,
      description: parsed.description,
      updatedAt: statSync(skillFile).mtime.toISOString(),
      dir: join(skillFile, '..'),
      source,
      pluginName,
      content: parsed.content
    }
  } catch {
    return null
  }
}

/** 列出全部技能：用户技能 + 各插件携带的技能（同名时用户技能优先） */
export function listSkills(): SkillMeta[] {
  ensureBundledSkills()
  const out = new Map<string, SkillMeta>()
  const userRoot = getSkillsRoot()
  if (existsSync(userRoot)) {
    for (const d of readdirSync(userRoot, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const file = join(userRoot, d.name, 'SKILL.md')
      if (!existsSync(file)) continue
      const loaded = loadSkillFrom(file, d.name, 'user')
      if (loaded) out.set(loaded.name, loaded)
    }
  }
  // 插件技能：<plugins>/<plugin>/skills/*/
  const pluginsRoot = getPluginsRoot()
  if (existsSync(pluginsRoot)) {
    for (const pd of readdirSync(pluginsRoot, { withFileTypes: true })) {
      if (!pd.isDirectory()) continue
      const pluginSkills = join(pluginsRoot, pd.name, 'skills')
      if (!existsSync(pluginSkills)) continue
      let pluginName = pd.name
      const manifestFile = join(pluginsRoot, pd.name, 'plugin.json')
      if (existsSync(manifestFile)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8')) as { name?: string }
          if (manifest.name) pluginName = manifest.name
        } catch {
          /* 清单损坏时用目录名 */
        }
      }
      for (const d of readdirSync(pluginSkills, { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        const file = join(pluginSkills, d.name, 'SKILL.md')
        if (!existsSync(file)) continue
        const loaded = loadSkillFrom(file, `${pd.name}/${d.name}`, 'plugin', pluginName)
        if (loaded && !out.has(loaded.name)) out.set(loaded.name, loaded)
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function getSkill(id: string): SkillDetail | null {
  // 支持两种 id：用户技能的目录名 / 插件技能的 "<plugin>/<dir>"
  const all = listSkills()
  const found = all.find((s) => s.id === id)
  if (!found) return null
  const skillFile = join(found.dir, 'SKILL.md')
  if (!existsSync(skillFile)) return null
  const parsed = parseFrontmatter(readFileSync(skillFile, 'utf-8'))
  return { ...found, content: parsed.content }
}

export function saveSkill(input: { id?: string; name: string; description: string; content: string }): {
  success: boolean
  id?: string
  message: string
} {
  try {
    const name = input.name.trim()
    if (!name) return { success: false, message: '技能名称不能为空' }
    const id = sanitizeId(input.id?.trim() || name)
    const dir = join(getSkillsRoot(), id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), serializeFrontmatter(name, input.description.trim(), input.content), 'utf-8')
    return { success: true, id, message: '技能已保存' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function deleteSkill(id: string): { success: boolean; message: string } {
  try {
    if (id.includes('/')) {
      return { success: false, message: '插件技能只能在插件管理里随插件卸载' }
    }
    const dir = join(getSkillsRoot(), sanitizeId(id))
    if (!existsSync(dir)) return { success: false, message: `技能不存在：${id}` }
    rmSync(dir, { recursive: true, force: true })
    return { success: true, message: '技能已删除' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Agent Runtime 用：名称 + 描述 + 各自所属目录（skill_load 按名称查目录取全文） */
export function resolveSkillsForAgent(): {
  dir: string
  skills: { name: string; description: string; dir: string }[]
} {
  const skills = listSkills().map((s) => ({
    name: s.name,
    description: s.description,
    dir: s.dir
  }))
  return { dir: getSkillsRoot(), skills }
}

/** 在资源管理器中打开技能目录（不存在则先建） */
export async function openSkillsDir(): Promise<{ success: boolean; message: string }> {
  const root = getSkillsRoot()
  mkdirSync(root, { recursive: true })
  await shell.openPath(root)
  return { success: true, message: '已在资源管理器中打开' }
}
