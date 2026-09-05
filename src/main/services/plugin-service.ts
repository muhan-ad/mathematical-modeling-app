/**
 * 插件管理：插件 = 一个符合规范的文件夹，放入 <userData>/plugins/<ascii-id>/。
 *
 * 插件结构（MVP 支持 skill-pack 类型）：
 *   plugin.json            清单：{id, name, version, description, type: "skill-pack"}
 *   skills/<dir>/SKILL.md  插件携带的技能（自动并入技能目录，只读）
 *
 * 约束：插件目录名与内部目录一律 ASCII（应用内禁止中文路径）。
 */

import { app, dialog, shell } from 'electron'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { join, basename } from 'path'

import { listSkills } from './skill-service'

export interface PluginMeta {
  id: string
  name: string
  version: string
  description: string
  type: string
  /** 插件携带的技能名列表 */
  skills: string[]
  installedAt: string
}

function getPluginsRoot(): string {
  return join(app.getPath('userData'), 'plugins')
}

function readManifest(pluginDir: string, fallbackId: string): PluginMeta {
  const manifestFile = join(pluginDir, 'plugin.json')
  let raw: { id?: string; name?: string; version?: string; description?: string; type?: string } = {}
  if (existsSync(manifestFile)) {
    try {
      raw = JSON.parse(readFileSync(manifestFile, 'utf-8'))
    } catch {
      raw = {}
    }
  }
  // 统计插件携带的技能
  const skills: string[] = []
  const skillsDir = join(pluginDir, 'skills')
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const f = join(skillsDir, d.name, 'SKILL.md')
      if (!existsSync(f)) continue
      try {
        const raw2 = readFileSync(f, 'utf-8')
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw2)
        const nameLine = m?.[1].split(/\r?\n/).find((l) => l.startsWith('name:'))
        skills.push(nameLine ? nameLine.slice(5).trim() : d.name)
      } catch {
        continue
      }
    }
  }
  return {
    id: fallbackId,
    name: raw.name ?? fallbackId,
    version: raw.version ?? '0.0.0',
    description: raw.description ?? '',
    type: raw.type ?? 'skill-pack',
    skills,
    installedAt: statSync(pluginDir).mtime.toISOString()
  }
}

function asciiId(text: string): string {
  const cleaned = text
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || `plugin-${Date.now().toString(36)}`
}

export function listPlugins(): PluginMeta[] {
  const root = getPluginsRoot()
  if (!existsSync(root)) return []
  const out: PluginMeta[] = []
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const dir = join(root, d.name)
    try {
      out.push(readManifest(dir, d.name))
    } catch {
      continue
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** 从本地文件夹导入插件：文件夹需含 plugin.json（或 skills/ 目录） */
export async function importPlugin(): Promise<{
  success: boolean
  message: string
  plugin?: PluginMeta
}> {
  const result = await dialog.showOpenDialog({
    title: '选择插件文件夹（需包含 plugin.json 或 skills/ 目录）',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: '' }
  }
  const src = result.filePaths[0]
  const srcName = basename(src)
  if (!/^[A-Za-z0-9_-]+$/.test(srcName)) {
    return {
      success: false,
      message: `插件文件夹名必须为纯英文/数字（当前：${srcName}）。请先重命名文件夹再导入。`
    }
  }
  const hasManifest = existsSync(join(src, 'plugin.json'))
  const hasSkills = existsSync(join(src, 'skills'))
  if (!hasManifest && !hasSkills) {
    return { success: false, message: '所选文件夹缺少 plugin.json 或 skills/ 目录，不是有效插件' }
  }

  const root = getPluginsRoot()
  const id = asciiId(srcName)
  const dest = join(root, id)
  if (existsSync(dest)) {
    return { success: false, message: `插件「${id}」已存在，请先卸载后再导入` }
  }
  try {
    mkdirSync(root, { recursive: true })
    cpSync(src, dest, { recursive: true })
    // 导入后确保有清单（无 plugin.json 时生成一份）
    if (!existsSync(join(dest, 'plugin.json'))) {
      writeFileSync(
        join(dest, 'plugin.json'),
        JSON.stringify(
          { id, name: id, version: '1.0.0', description: '', type: 'skill-pack' },
          null,
          2
        ),
        'utf-8'
      )
    }
    const plugin = readManifest(dest, id)
    return { success: true, message: `插件「${plugin.name}」已安装`, plugin }
  } catch (err) {
    rmSync(dest, { recursive: true, force: true })
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function uninstallPlugin(id: string): { success: boolean; message: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return { success: false, message: '非法插件 ID' }
    const dir = join(getPluginsRoot(), id)
    if (!existsSync(dir)) return { success: false, message: '插件不存在' }
    rmSync(dir, { recursive: true, force: true })
    return { success: true, message: '插件已卸载' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** 插件携带的技能数（供状态卡片等展示） */
export function pluginSkillCount(): number {
  return listSkills().filter((s) => s.source === 'plugin').length
}

export async function openPluginsDir(): Promise<{ success: boolean; message: string }> {
  const root = getPluginsRoot()
  mkdirSync(root, { recursive: true })
  await shell.openPath(root)
  return { success: true, message: '已在资源管理器中打开' }
}
