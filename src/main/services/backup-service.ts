import { app, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'fs'
import { ZipArchive } from 'archiver'
import { createWriteStream } from 'fs'
import { getProject } from './project-service'

/**
 * 项目备份服务
 *
 * 备份只针对单个竞赛项目（不做全局备份），将 <userData>/mathmodel-projects/<id>/
 * 打包为 zip，保存到备份目录（默认 userData/backups/，可自定义）。
 *
 * 设计要点：
 * - 文件名携带项目 ID，格式固定：
 *   "[备份名称]_[项目<项目名>]_[id<projectId>]_[第N次]_[时间戳].zip"
 * - 计数按项目独立，持久化在 userData/backup-counters.json
 * - 计数与磁盘现存文件自愈对齐：删除（无论通过 UI 还是手动删文件）后自动归位
 * - 时间格式 "YYYY-MM-DD HH:MM:SS"
 */

const BACKUP_DIR_NAME = 'backups'
const SETTINGS_FILE = 'backup-settings.json'
const COUNTERS_FILE = 'backup-counters.json'
const PROJECTS_DIR = 'mathmodel-projects'

interface BackupResult {
  success: boolean
  backupName: string
  count: number
  timestamp: string
  filePath: string
  fileSize: number
  message: string
}

export interface BackupListItem {
  name: string
  size: number
  createdAt: Date
  /** 从文件名解析的备份名称 */
  backupName: string | null
  projectName: string | null
  projectId: string | null
  count: number | null
}

interface BackupManifest {
  backupName: string
  kind: 'project'
  projectId: string
  projectName: string
  count: number
  timestamp: string
  timestampISO: string
  appVersion: string
  electronVersion: string
  isEmpty: boolean
}

/** 文件名 → 元信息解析
 *  新格式（全 ASCII）：wmbackup-<projectId>-<count 补零>-<YYYYMMDD-HHMMSS>.zip
 *  展示信息（备份名/项目名）存放在同名 .json sidecar，避免中文进入路径
 *  旧格式（含中文文件名）继续兼容解析
 */
const NAME_RE = /^\[(.+?)\]_\[项目(.+?)\]_\[id([A-Za-z0-9_-]+)\]_\[第(\d+)次\]_/
const ASCII_NAME_RE = /^wmbackup-([A-Za-z0-9_-]+)-(\d+)-(\d{8}-\d{6})\.zip$/

function parseBackupFileName(name: string): Omit<BackupListItem, 'name' | 'size' | 'createdAt'> {
  const m = name.match(NAME_RE)
  if (m) {
    return { backupName: m[1], projectName: m[2], projectId: m[3], count: Number(m[4]) }
  }
  const a = name.match(ASCII_NAME_RE)
  if (a) {
    // 展示信息从 sidecar 读取
    const sidecar = join(getBackupRoot(), name.replace(/\.zip$/, '.json'))
    let backupName: string | null = null
    let projectName: string | null = null
    if (existsSync(sidecar)) {
      try {
        const meta = JSON.parse(readFileSync(sidecar, 'utf-8')) as {
          backupName?: string
          projectName?: string
        }
        backupName = meta.backupName ?? null
        projectName = meta.projectName ?? null
      } catch {
        /* sidecar 损坏时展示为空 */
      }
    }
    return { backupName, projectName, projectId: a[1], count: Number(a[2]) }
  }
  return { backupName: null, projectName: null, projectId: null, count: null }
}

/**
 * 清理文件名中的非法字符（Windows 不允许 / \ : * ? " < > |）
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

/**
 * 格式化时间戳，符合 "YYYY-MM-DD HH:MM:SS"
 * 同时返回用于文件名的安全版本 "YYYYMMDD-HHMMSS"
 */
function formatTimestamp(date: Date): { display: string; safe: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return {
    display: `${y}-${mo}-${d} ${h}:${mi}:${s}`,
    safe: `${y}${mo}${d}-${h}${mi}${s}`
  }
}

/* ── 备份目录（支持自定义） ── */

interface BackupSettingsFile {
  /** 自定义备份目录绝对路径；null 表示用默认 */
  customDir: string | null
}

function readBackupSettings(): BackupSettingsFile {
  const p = join(app.getPath('userData'), SETTINGS_FILE)
  if (!existsSync(p)) return { customDir: null }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as BackupSettingsFile
    return { customDir: typeof raw.customDir === 'string' ? raw.customDir : null }
  } catch {
    return { customDir: null }
  }
}

function writeBackupSettings(settings: BackupSettingsFile): void {
  writeFileSync(join(app.getPath('userData'), SETTINGS_FILE), JSON.stringify(settings, null, 2), 'utf-8')
}

function getBackupRoot(): string {
  const settings = readBackupSettings()
  if (settings.customDir) {
    try {
      mkdirSync(settings.customDir, { recursive: true })
      return settings.customDir
    } catch {
      console.warn('[backup] 自定义备份目录不可用，回退默认目录')
    }
  }
  return join(app.getPath('userData'), BACKUP_DIR_NAME)
}

/** 当前生效的备份目录（供 UI 展示） */
export function getBackupDir(): string {
  return getBackupRoot()
}

/**
 * 调整备份路径；传 null 恢复默认目录
 */
export function setBackupDir(newDir: string | null): { success: boolean; message: string; path: string } {
  if (newDir === null) {
    writeBackupSettings({ customDir: null })
    return { success: true, message: '已恢复默认备份目录', path: join(app.getPath('userData'), BACKUP_DIR_NAME) }
  }
  const cleaned = newDir.trim()
  if (!cleaned) {
    return { success: false, message: '路径不能为空', path: getBackupRoot() }
  }
  if (!/^[A-Za-z]:[\\/]/.test(cleaned) && !cleaned.startsWith('/')) {
    return { success: false, message: '请输入绝对路径（如 D:\\backups）', path: getBackupRoot() }
  }
  try {
    mkdirSync(cleaned, { recursive: true })
  } catch (err) {
    return { success: false, message: `无法创建目录：${(err as Error).message}`, path: getBackupRoot() }
  }
  writeBackupSettings({ customDir: cleaned })
  return { success: true, message: '备份目录已更新，之后的备份将保存到新位置（已有备份文件不会自动迁移）', path: cleaned }
}

/** 在系统文件管理器中打开备份目录 */
export async function openBackupDir(): Promise<{ success: boolean; message: string }> {
  const dir = getBackupRoot()
  mkdirSync(dir, { recursive: true })
  const result = await shell.openPath(dir)
  return result ? { success: false, message: result } : { success: true, message: '已打开' }
}

/* ── 按项目计数 ── */

type CounterMap = Record<string, number>

function readCounters(): CounterMap {
  const p = join(app.getPath('userData'), COUNTERS_FILE)
  if (!existsSync(p)) return {}
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as CounterMap
    return typeof raw === 'object' && raw !== null ? raw : {}
  } catch {
    return {}
  }
}

function writeCounters(map: CounterMap): void {
  writeFileSync(join(app.getPath('userData'), COUNTERS_FILE), JSON.stringify(map, null, 2), 'utf-8')
}

/**
 * 将某项目的计数与磁盘现存备份对齐（自愈）：
 * 取该项目现存文件中最大的「第 N 次」；没有文件则归零。
 */
function reconcileProjectCounter(projectId: string): number {
  const root = getBackupRoot()
  let maxCount = 0
  if (existsSync(root)) {
    try {
      for (const n of readdirSync(root)) {
        if (!n.endsWith('.zip')) continue
        const parsed = parseBackupFileName(n)
        if (parsed.projectId === projectId && parsed.count !== null) {
          maxCount = Math.max(maxCount, parsed.count)
        }
      }
    } catch {
      return readCounters()[projectId] ?? 0
    }
  }
  const counters = readCounters()
  const current = counters[projectId] ?? 0
  if (current !== maxCount) {
    counters[projectId] = maxCount
    writeCounters(counters)
  }
  return maxCount
}

/** 某项目当前备份次数（与现存备份数保持一致） */
export function getProjectBackupCount(projectId: string): number {
  return reconcileProjectCounter(projectId)
}

/* ── 创建 / 删除 / 列表 ── */

/**
 * 针对单个竞赛项目创建备份
 * @param projectId 项目 ID
 * @param backupName 用户输入的备份名称（已非空验证）
 */
export async function createProjectBackup(projectId: string, backupName: string): Promise<BackupResult> {
  const cleanName = sanitizeFileName(backupName)
  if (!cleanName) {
    return {
      success: false,
      backupName,
      count: 0,
      timestamp: '',
      filePath: '',
      fileSize: 0,
      message: '备份名称不能为空'
    }
  }

  const project = getProject(projectId)
  if (!project) {
    return {
      success: false,
      backupName: cleanName,
      count: 0,
      timestamp: '',
      filePath: '',
      fileSize: 0,
      message: '项目不存在，请先创建项目'
    }
  }

  const cleanProjectName = sanitizeFileName(project.name) || '未命名项目'

  // 计数 +1（按项目独立）
  const counters = readCounters()
  const count = (counters[projectId] ?? 0) + 1

  const now = new Date()
  const ts = formatTimestamp(now)
  // 新格式：全 ASCII 文件名（中文展示信息放 sidecar json，路径里不出现中文）
  const fileName = `wmbackup-${projectId}-${String(count).padStart(4, '0')}-${ts.safe}.zip`
  const sidecarName = fileName.replace(/\.zip$/, '.json')

  const backupRoot = getBackupRoot()
  try {
    mkdirSync(backupRoot, { recursive: true })
  } catch (err) {
    return {
      success: false,
      backupName: cleanName,
      count,
      timestamp: ts.display,
      filePath: '',
      fileSize: 0,
      message: `无法创建备份目录：${(err as Error).message}`
    }
  }

  const filePath = join(backupRoot, fileName)

  const manifest: BackupManifest = {
    backupName: cleanName,
    kind: 'project',
    projectId,
    projectName: project.name,
    count,
    timestamp: ts.display,
    timestampISO: now.toISOString(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    isEmpty: false
  }

  const projectDir = join(app.getPath('userData'), PROJECTS_DIR, projectId)
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const output = createWriteStream(filePath)

  return new Promise<BackupResult>((resolve) => {
    let resolved = false
    const finish = (result: BackupResult) => {
      if (resolved) return
      resolved = true
      resolve(result)
    }

    output.on('close', () => {
      // 仅在成功后写入计数，避免失败导致计数错位
      counters[projectId] = count
      writeCounters(counters)
      // 同步写 sidecar（新格式的展示信息：备份名/项目名）
      try {
        writeFileSync(
          join(backupRoot, sidecarName),
          JSON.stringify({ backupName: cleanName, projectName: project.name }, null, 2),
          'utf-8'
        )
      } catch {
        /* sidecar 失败仅影响展示名称，备份本身有效 */
      }
      finish({
        success: true,
        backupName: cleanName,
        count,
        timestamp: ts.display,
        filePath,
        fileSize: statSync(filePath).size,
        message: `项目「${project.name}」第 ${count} 次备份 "${cleanName}" 已完成，时间 ${ts.display}`
      })
    })

    output.on('error', (err: NodeJS.ErrnoException) => {
      try { rmSync(filePath, { force: true }) } catch { /* noop */ }
      finish({
        success: false,
        backupName: cleanName,
        count,
        timestamp: ts.display,
        filePath,
        fileSize: 0,
        message: `备份文件写入失败：${err.message}`
      })
    })

    archive.on('error', (err: Error) => {
      try { rmSync(filePath, { force: true }) } catch { /* noop */ }
      finish({
        success: false,
        backupName: cleanName,
        count,
        timestamp: ts.display,
        filePath,
        fileSize: 0,
        message: `压缩失败：${err.message}`
      })
    })

    archive.on('warning', (err: Error) => {
      console.warn('[backup] archiver warning:', err)
    })

    archive.append(JSON.stringify(manifest, null, 2), { name: '__backup_manifest__.json' })
    archive.directory(projectDir, `${PROJECTS_DIR}/${projectId}`)
    archive.pipe(output)
    archive.finalize()
  })
}

/**
 * 删除一条历史备份（按文件名解析项目并同步其计数）
 * @param fileName 仅允许纯文件名（防路径穿越）
 */
export function deleteBackup(fileName: string): { success: boolean; message: string } {
  if (!/^[^\\/]+\.zip$/.test(fileName)) {
    return { success: false, message: '非法的备份文件名' }
  }
  const filePath = join(getBackupRoot(), fileName)
  if (!existsSync(filePath)) {
    return { success: false, message: '备份文件不存在（可能已被删除或目录已更改）' }
  }
  try {
    rmSync(filePath, { force: true })
    // 同步清理 sidecar（新格式）
    const sidecar = join(getBackupRoot(), fileName.replace(/\.zip$/, '.json'))
    if (existsSync(sidecar)) rmSync(sidecar, { force: true })
    // 计数与现存文件自愈对齐
    const parsed = parseBackupFileName(fileName)
    if (parsed.projectId) reconcileProjectCounter(parsed.projectId)
    return { success: true, message: `已删除 ${fileName}` }
  } catch (err) {
    return { success: false, message: `删除失败：${(err as Error).message}` }
  }
}

/**
 * 列出当前备份目录下的所有项目备份（按创建时间倒序）
 */
export function listBackups(): BackupListItem[] {
  const root = getBackupRoot()
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((n) => n.endsWith('.zip'))
    .map((n) => {
      const p = join(root, n)
      const stat = statSync(p)
      return { name: n, size: stat.size, createdAt: stat.mtime, ...parseBackupFileName(n) }
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}
