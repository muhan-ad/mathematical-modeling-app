import { app } from 'electron'
import { join, dirname, basename } from 'path'
import { spawn } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { randomUUID } from 'crypto'

/**
 * 项目管理服务
 *
 * 每个竞赛项目独立目录（design.md §6），便于备份/迁移：
 * <userData>/mathmodel-projects/<project_id>/
 * ├── meta.json                 # 项目元数据
 * ├── problem/                  # 题目原文 + 附件 + 解析结果
 * ├── workspace/                # 求解代码 / 输出 / 图表 / 笔记
 * ├── paper/                    # LaTeX 论文（模板初始化）
 * ├── state.json                # Agent 状态快照（Phase 2 使用）
 * └── conversation.jsonl        # 完整对话历史（追加写）
 */

const PROJECTS_DIR = 'mathmodel-projects'

export type CompetitionType = 'cumcm' | 'mcm' | 'huashu' | 'other'

export interface ProjectMeta {
  id: string
  name: string
  competition: CompetitionType
  createdAt: string
  updatedAt: string
  /** 当前所处阶段：understanding/modeling/solving/writing/review（Phase 2 状态机启用） */
  stage: string
}

/** 竞赛类型 → 展示名（渲染端也有一份映射，这里用于 service 层校验） */
const COMPETITION_TYPES: CompetitionType[] = ['cumcm', 'mcm', 'huashu', 'other']

interface MetaFile extends ProjectMeta {
  schemaVersion: 1
}

function getProjectsRoot(): string {
  return join(app.getPath('userData'), PROJECTS_DIR)
}

function getProjectDir(id: string): string {
  // 防路径穿越：id 只允许安全字符
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`非法的项目 ID：${id}`)
  }
  return join(getProjectsRoot(), id)
}

function nowISO(): string {
  return new Date().toISOString()
}

/** 校验项目名并清理非法文件名字符 */
function sanitizeName(name: string): string {
  // 除非法文件名字符外，顺带去掉换行/制表/其他控制字符，
  // 避免带换行的名字被直接拼进 LaTeX 注释/标题与 markdown 造成错乱。
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
  if (!cleaned) throw new Error('项目名称不能为空')
  if (cleaned.length > 100) throw new Error('项目名称过长（最多 100 字符）')
  return cleaned
}

/**
 * 把字符串转义成可安全嵌入 LaTeX 文本/参数（如 \title{…}）的内容。
 * TeX 特殊字符 % # & _ $ ^ ~ \ { } 需转义；控制字符/换行退化为空格。
 */
function escapeLatex(text: string): string {
  return text
    .replace(/([\\{}&$#%_^~])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
}

function validateCompetition(c: unknown): CompetitionType {
  if (typeof c === 'string' && COMPETITION_TYPES.includes(c as CompetitionType)) {
    return c as CompetitionType
  }
  throw new Error(`未知的竞赛类型：${String(c)}`)
}

/**
 * 通用 LaTeX 论文骨架（ctex + xelatex，design.md §9）
 * Phase 1 使用通用模板；国赛/美赛官方模板在 Phase 4 接入
 */
function paperMainTex(projectName: string): string {
  return `% ${projectName} — 主文件（xelatex 编译）
\\documentclass[UTF8]{ctexart}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{geometry}
\\usepackage{hyperref}
\\geometry{a4paper,margin=2.5cm}

\\title{${escapeLatex(projectName)}}
\\author{}
\\date{}

\\begin{document}
\\maketitle

\\begin{abstract}
\\end{abstract}

\\input{sections/analysis}
\\input{sections/model}
\\input{sections/solution}
\\input{sections/results}
\\input{sections/conclusion}

\\end{document}
`
}

const SECTION_STUBS: Record<string, string> = {
  'analysis.tex': '% 问题分析\n\\section{问题分析}\n',
  'model.tex': '% 模型建立\n\\section{模型建立}\n',
  'solution.tex': '% 模型求解\n\\section{模型求解}\n',
  'results.tex': '% 结果与讨论\n\\section{结果与讨论}\n',
  'conclusion.tex': '% 结论\n\\section{结论}\n'
}

/** 初始化单个项目的完整目录结构
 *
 * 规范（全部英文命名，避免中文路径在 LaTeX/工具链下的兼容问题）：
 * - problem/       题目：statement.md 题目原文、attachments/ 原始附件（保持原文件名）
 * - workspace/     支撑材料：code/ 求解代码、data/ AI 得出的数据结果、
 *                  outputs/ 程序文本输出、figures/ 生成的图表、notes/ 过程笔记
 * - paper/         论文：main.tex 主文件、sections/ 章节、figures/ 论文引用的图片
 */
function initProjectStructure(id: string, name: string, competition: CompetitionType): void {
  const root = getProjectDir(id)
  const dirs = [
    join(root, 'problem', 'attachments'),
    join(root, 'workspace', 'code'),
    join(root, 'workspace', 'data'),
    join(root, 'workspace', 'outputs'),
    join(root, 'workspace', 'figures'),
    join(root, 'workspace', 'notes'),
    join(root, 'paper', 'sections'),
    join(root, 'paper', 'figures')
  ]
  for (const d of dirs) mkdirSync(d, { recursive: true })

  // meta.json
  const meta: MetaFile = {
    schemaVersion: 1,
    id,
    name,
    competition,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    stage: 'understanding'
  }
  writeFileSync(join(root, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  // problem/statement.md 占位
  writeFileSync(
    join(root, 'problem', 'statement.md'),
    `# ${name}\n\n> 在此粘贴题目原文，或把题目 PDF 放入 attachments/ 目录。\n`,
    'utf-8'
  )

  // paper：主文件 + 章节骨架
  writeFileSync(join(root, 'paper', 'main.tex'), paperMainTex(name), 'utf-8')
  for (const [file, content] of Object.entries(SECTION_STUBS)) {
    writeFileSync(join(root, 'paper', 'sections', file), content, 'utf-8')
  }
  writeFileSync(join(root, 'paper', 'references.bib'), '', 'utf-8')

  // state.json / conversation.jsonl（空初始状态）
  writeFileSync(join(root, 'state.json'), JSON.stringify({ stage: 'understanding' }, null, 2), 'utf-8')
  writeFileSync(join(root, 'conversation.jsonl'), '', 'utf-8')
}

function readMeta(id: string): ProjectMeta {
  const metaPath = join(getProjectDir(id), 'meta.json')
  const raw = readFileSync(metaPath, 'utf-8')
  const data = JSON.parse(raw) as MetaFile
  // 只回传稳定字段，避免内部字段泄漏到渲染端
  return {
    id: data.id,
    name: data.name,
    competition: data.competition,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    stage: data.stage
  }
}

function writeMeta(id: string, meta: ProjectMeta): void {
  const data: MetaFile = { ...meta, schemaVersion: 1 }
  writeFileSync(join(getProjectDir(id), 'meta.json'), JSON.stringify(data, null, 2), 'utf-8')
}

/** 创建项目，返回元数据 */
export function createProject(input: {
  name: string
  competition: CompetitionType
}): ProjectMeta {
  const name = sanitizeName(input.name)
  const competition = validateCompetition(input.competition)

  const root = getProjectsRoot()
  mkdirSync(root, { recursive: true })

  // id 用 uuid 短格式，天然不冲突
  const id = randomUUID().split('-')[0]
  initProjectStructure(id, name, competition)
  return readMeta(id)
}

/** 列出全部项目，按更新时间倒序 */
export function listProjects(): ProjectMeta[] {
  const root = getProjectsRoot()
  if (!existsSync(root)) return []
  const projects: ProjectMeta[] = []
  for (const entry of readdirSync(root)) {
    const metaPath = join(root, entry, 'meta.json')
    if (!existsSync(metaPath)) continue
    try {
      projects.push(readMeta(entry))
    } catch {
      // 损坏的 meta.json 跳过，不阻塞列表
      console.warn(`[project:list] 跳过损坏的项目目录：${entry}`)
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 获取单个项目元数据，不存在返回 null */
export function getProject(id: string): ProjectMeta | null {
  if (!existsSync(getProjectDir(id))) return null
  return readMeta(id)
}

/** 更新项目（当前支持改名/改类型/改阶段） */
export function updateProject(
  id: string,
  patch: Partial<Pick<ProjectMeta, 'name' | 'competition' | 'stage'>>
): ProjectMeta {
  const existing = getProject(id)
  if (!existing) throw new Error(`项目不存在：${id}`)
  const next: ProjectMeta = {
    ...existing,
    name: patch.name !== undefined ? sanitizeName(patch.name) : existing.name,
    competition:
      patch.competition !== undefined ? validateCompetition(patch.competition) : existing.competition,
    stage: patch.stage ?? existing.stage,
    updatedAt: nowISO()
  }
  writeMeta(id, next)
  return next
}

/** 删除项目（整个目录） */
export function deleteProject(id: string): { success: boolean; message: string } {
  const dir = getProjectDir(id)
  if (!existsSync(dir)) {
    return { success: false, message: `项目不存在：${id}` }
  }
  rmSync(dir, { recursive: true, force: true })
  return { success: true, message: '项目已删除' }
}

/** 主进程内部/runner 使用：项目根目录绝对路径（供 Agent Runtime 的工作区约束） */
export function getProjectDirectory(id: string): string {
  return getProjectDir(id)
}

export interface ProjectFileEntry {
  /** 相对项目根目录的路径（POSIX 分隔） */
  path: string
  type: 'file' | 'dir'
  size: number
}

/** 列出项目目录树（供工作台文件面板；上限 500 条防超大项目卡顿）
 *  排序规则：每层内文件夹优先、文件在后，同类型按名称排序
 */
export function listProjectFiles(id: string): ProjectFileEntry[] {
  const root = getProjectDir(id)
  if (!existsSync(root)) return []
  const out: ProjectFileEntry[] = []
  const walk = (dir: string, prefix: string) => {
    if (out.length >= 500) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    // 文件夹优先、文件在后，各自按名称排序
    const dirNames: string[] = []
    const fileNames: string[] = []
    for (const name of entries) {
      try {
        if (statSync(join(dir, name)).isDirectory()) dirNames.push(name)
        else fileNames.push(name)
      } catch {
        continue
      }
    }
    dirNames.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    fileNames.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    for (const name of [...dirNames, ...fileNames]) {
      if (out.length >= 500) return
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      try {
        const st = statSync(full)
        if (st.isDirectory()) {
          out.push({ path: rel, type: 'dir', size: 0 })
          walk(full, rel)
        } else {
          out.push({ path: rel, type: 'file', size: st.size })
        }
      } catch {
        continue
      }
    }
  }
  walk(root, '')
  return out
}

// ---------- 文件预览（右栏预览面板） ----------

export interface FilePreview {
  kind: 'image' | 'pdf' | 'md' | 'text' | 'unsupported'
  /** 图片/PDF 用 dataUrl；文本类用 text */
  dataUrl?: string
  text?: string
  name: string
  size: number
  mtime: string
  message?: string
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const TEXT_EXTS = new Set([
  '.md', '.markdown', '.tex', '.txt', '.csv', '.json', '.py', '.js', '.ts',
  '.bib', '.log', '.yml', '.yaml', '.html', '.css', '.xml', '.m', '.r', '.ipynb'
])
const PREVIEW_SIZE_CAP = 8 * 1024 * 1024 // 8MB（图片/PDF dataUrl 上限）
const TEXT_CAP = 200 * 1024 // 文本预览截断上限

/** 读取项目内文件的预览内容（图片/PDF 转 dataUrl，文本类直读） */
export function readProjectFilePreview(id: string, relPath: string): FilePreview {
  const base = (extra: Partial<FilePreview>): FilePreview => ({
    kind: 'unsupported',
    name: relPath.split('/').pop() ?? relPath,
    size: 0,
    mtime: '',
    ...extra
  })
  try {
    const abs = safeResolve(id, relPath)
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return base({ message: '文件不存在' })
    }
    const st = statSync(abs)
    const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase()
    const head = base({ size: st.size, mtime: st.mtime.toISOString() })

    if (IMAGE_EXTS.has(ext)) {
      if (st.size > PREVIEW_SIZE_CAP) return { ...head, kind: 'image', message: '图片过大（>8MB），请在资源管理器中打开' }
      const mime =
        ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`
      return {
        ...head,
        kind: 'image',
        dataUrl: `data:${mime};base64,${readFileSync(abs).toString('base64')}`
      }
    }
    if (ext === '.pdf') {
      if (st.size > PREVIEW_SIZE_CAP) return { ...head, kind: 'pdf', message: 'PDF 过大（>8MB），请在资源管理器中打开' }
      return {
        ...head,
        kind: 'pdf',
        dataUrl: `data:application/pdf;base64,${readFileSync(abs).toString('base64')}`
      }
    }
    if (ext === '.doc' || ext === '.docx' || ext === '.xlsx' || ext === '.xls' || ext === '.zip') {
      return { ...head, kind: 'unsupported', message: '该类型不支持预览，请在资源管理器中打开' }
    }
    if (TEXT_EXTS.has(ext)) {
      const buf = readFileSync(abs)
      const text = buf.toString('utf-8', 0, Math.min(buf.length, TEXT_CAP))
      return {
        ...head,
        kind: ext === '.md' || ext === '.markdown' ? 'md' : 'text',
        text: buf.length > TEXT_CAP ? `${text}\n\n…[文件过大，仅显示前 200KB]` : text
      }
    }
    return { ...head, kind: 'unsupported', message: '暂不支持预览该类型文件' }
  } catch (err) {
    return base({ message: err instanceof Error ? err.message : String(err) })
  }
}

/** 标准结构：不允许重命名/删除，保证项目规范不被破坏 */
const PROTECTED_PATHS = new Set([
  'problem',
  'problem/attachments',
  'problem/statement.md',
  'workspace',
  'workspace/code',
  'workspace/data',
  'workspace/outputs',
  'workspace/figures',
  'workspace/notes',
  'paper',
  'paper/sections',
  'paper/figures',
  'state.json',
  'meta.json',
  'conversation.jsonl'
])

/** 校验项目内相对路径：拒绝越界、非法段；返回绝对路径 */
function safeResolve(id: string, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\\')) {
    throw new Error('非法路径')
  }
  const segments = rel.split('/')
  if (segments.some((s) => !s || s === '.' || s === '..')) {
    throw new Error('非法路径')
  }
  const root = getProjectDir(id)
  const abs = join(root, ...segments)
  if (!abs.startsWith(root)) {
    throw new Error('路径越界')
  }
  return abs
}

export function renameProjectFile(
  id: string,
  oldPath: string,
  newPath: string
): { success: boolean; message: string } {
  try {
    if (PROTECTED_PATHS.has(oldPath)) {
      return { success: false, message: '「' + oldPath + '」是标准结构，不允许重命名' }
    }
    const from = safeResolve(id, oldPath)
    const to = safeResolve(id, newPath)
    if (!existsSync(from)) return { success: false, message: '文件不存在' }
    if (existsSync(to)) return { success: false, message: '目标路径已存在' }
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
    return { success: true, message: '已重命名' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export function deleteProjectFile(id: string, relPath: string): { success: boolean; message: string } {
  try {
    if (PROTECTED_PATHS.has(relPath)) {
      return { success: false, message: '「' + relPath + '」是标准结构，不允许删除' }
    }
    const abs = safeResolve(id, relPath)
    if (!existsSync(abs)) return { success: false, message: '文件不存在' }
    rmSync(abs, { recursive: true, force: false })
    return { success: true, message: '已删除' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** 取项目内文件的绝对路径（复制路径用）；文件可不存在（允许复制目录路径） */
export function getProjectFileAbsPath(id: string, relPath: string): { success: boolean; path?: string; message: string } {
  try {
    const abs = safeResolve(id, relPath)
    return { success: true, path: abs, message: '' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- 题目上传 ----------

const STATEMENT_EXTS = ['.md', '.txt', '.markdown']
const PROBLEM_EXTS = ['.md', '.txt', '.markdown', '.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.zip', '.xlsx', '.xls', '.csv']

/**
 * 导入题目文件：所选文件复制到 problem/attachments/（保持原名）；
 * 其中 .md/.txt 额外写入 problem/statement.md 作为题目原文。
 */
export function importProblemFiles(id: string, sourcePaths: string[]): {
  success: boolean
  message: string
  imported: string[]
  statementUpdated: boolean
} {
  const imported: string[] = []
  let statementUpdated = false
  try {
    const root = getProjectDir(id)
    const attachDir = join(root, 'problem', 'attachments')
    mkdirSync(attachDir, { recursive: true })
    for (const src of sourcePaths) {
      if (!existsSync(src) || !statSync(src).isFile()) continue
      const name = basename(src)
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
      if (!PROBLEM_EXTS.includes(ext)) {
        return { success: false, message: `不支持的文件类型：${name}`, imported, statementUpdated }
      }
      const dest = join(attachDir, sanitizeFileNameSafe(name))
      cpSyncIgnoreMissing(src, dest)
      imported.push(`problem/attachments/${name}`)
      if (STATEMENT_EXTS.includes(ext)) {
        copyFileSync(src, join(root, 'problem', 'statement.md'))
        statementUpdated = true
      }
    }
    if (imported.length === 0) return { success: false, message: '没有可导入的文件', imported, statementUpdated }
    touchProject(id)
    return {
      success: true,
      message: statementUpdated
        ? `已导入 ${imported.length} 个文件，题目原文（statement.md）已更新`
        : `已导入 ${imported.length} 个附件`,
      imported,
      statementUpdated
    }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err), imported, statementUpdated }
  }
}

function sanitizeFileNameSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function cpSyncIgnoreMissing(src: string, dest: string): void {
  cpSync(src, dest)
}

function copyFileSync(src: string, dest: string): void {
  writeFileSync(dest, readFileSync(src))
}

/** 项目有实质变更时刷新 updatedAt（上传题目等操作调用） */
function touchProject(id: string): void {
  try {
    const metaFile = join(getProjectDir(id), 'meta.json')
    if (existsSync(metaFile)) {
      const meta = JSON.parse(readFileSync(metaFile, 'utf-8')) as ProjectMeta
      meta.updatedAt = nowISO()
      writeFileSync(metaFile, JSON.stringify({ ...meta, schemaVersion: 1 }, null, 2), 'utf-8')
    }
  } catch {
    /* meta 刷新失败不影响导入 */
  }
}

// ---------- LaTeX 编译 ----------

export interface LatexCompileResult {
  success: boolean
  pdfGenerated: boolean
  pdfPath: string
  logTail: string
  message: string
}

/** TeX 解析：优先内置便携环境 vendor/texlive（setup-portable-tex.ps1 装配），否则系统 PATH */
function resolveTexEnv(): { cmd: string; env: NodeJS.ProcessEnv } {
  const vendorBin = join(app.getAppPath(), 'vendor', 'texlive', 'bin', 'windows')
  if (existsSync(join(vendorBin, 'xelatex.exe'))) {
    return {
      cmd: join(vendorBin, 'xelatex.exe'),
      env: { ...process.env, PATH: `${vendorBin};${process.env.PATH ?? ''}` }
    }
  }
  return { cmd: 'xelatex', env: { ...process.env } }
}

/** 编译论文主文件 paper/main.tex（xelatex，仅项目目录内，异步等待完成） */
export function compileProjectPaper(id: string): Promise<LatexCompileResult> {
  const fail = (message: string): LatexCompileResult => ({
    success: false,
    pdfGenerated: false,
    pdfPath: '',
    logTail: '',
    message
  })
  return new Promise((resolve) => {
    let paperDir: string
    let entry: string
    try {
      paperDir = getProjectDir(id)
      entry = join(paperDir, 'paper', 'main.tex')
      paperDir = join(paperDir, 'paper')
    } catch (err) {
      resolve(fail(err instanceof Error ? err.message : String(err)))
      return
    }
    if (!existsSync(entry)) {
      resolve(fail(`找不到论文主文件：paper/main.tex`))
      return
    }
    const tex = resolveTexEnv()
    const proc = spawn(
      tex.cmd,
      ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'main.tex'],
      { cwd: paperDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: tex.env }
    )
    let log = ''
    let settled = false
    const finish = (result: LatexCompileResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timer = setTimeout(() => {
      proc.kill()
      finish(fail('编译超时（上限 300 秒）'))
    }, 300_000)
    proc.stdout?.on('data', (d: Buffer) => {
      log += d.toString('utf-8')
      if (log.length > 60_000) log = log.slice(-30_000)
    })
    proc.stderr?.on('data', (d: Buffer) => {
      log += d.toString('utf-8')
    })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      finish(
        fail(
          err.code === 'ENOENT'
            ? '未检测到 xelatex，请先安装 TeX 发行版（TeX Live / MiKTeX）'
            : `编译启动失败：${err.message}`
        )
      )
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      const pdf = join(paperDir, 'main.pdf')
      const pdfGenerated = existsSync(pdf)
      finish({
        success: code === 0 && pdfGenerated,
        pdfGenerated,
        pdfPath: pdfGenerated ? pdf : '',
        logTail: log.slice(-4000),
        message:
          code === 0 && pdfGenerated
            ? '编译成功'
            : `编译失败（exit=${code ?? 'signal'}），详见日志`
      })
    })
  })
}
