import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  File as FileIcon,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  FileUp,
  HardDriveDownload,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Resizable } from 're-resizable'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ProjectBackupDialog } from '@/components/backup/ProjectBackupDialog'
import { AgentChatPanel } from '@/components/agent/AgentChatPanel'
import { Markdown } from '@/components/agent/Markdown'
import { COMPETITION_LABELS, STAGE_LABELS, type ProjectMeta } from '@/lib/projects'
import { cn } from '@/lib/utils'

interface FileEntry {
  path: string
  type: 'file' | 'dir'
  size: number
}

interface WorkspacePageProps {
  project: ProjectMeta
  onBack: () => void
}

/**
 * 工作台：左（项目文件）/ 中（Agent 对话）/ 右（预览占位）
 * 见 docs/ui-design.md §6
 */
/** 非法文件名字符（与主进程校验呼应） */
const INVALID_NAME = /[\\/:*?"<>|]/

export function WorkspacePage({ project, onBack }: WorkspacePageProps) {
  const [backupOpen, setBackupOpen] = useState(false)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  /** 可拖拽栏宽（记忆在本地；re-resizable 处理拖拽边界与指针捕获） */
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem('wam-left-width')) || 260)
  /** 可拖拽栏宽（记忆在本地；首次使用时预览面板取窗口宽的 65%） */
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = Number(localStorage.getItem('wam-right-width'))
    if (saved > 0) return saved
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
    return Math.round(winW * 0.65)
  })

  useEffect(() => {
    // 版本升级：清除旧默认值，让 65% 初始宽度生效一次
    if (localStorage.getItem('wam-right-width') === '300') {
      localStorage.removeItem('wam-right-width')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('wam-left-width', String(leftWidth))
  }, [leftWidth])
  useEffect(() => {
    localStorage.setItem('wam-right-width', String(rightWidth))
  }, [rightWidth])
  /** 收起的目录集合 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** 行内操作菜单展开的行 */
  const [menuPath, setMenuPath] = useState<string | null>(null)
  /** 重命名对话框 */
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)
  /** 上传/编译进行中 */
  const [importing, setImporting] = useState(false)
  const [compiling, setCompiling] = useState(false)
  /** 编译结果对话框 */
  const [latexResult, setLatexResult] = useState<{
    success: boolean
    pdfGenerated: boolean
    pdfPath: string
    logTail: string
    message: string
  } | null>(null)
  /** 文件预览（右栏） */
  const [preview, setPreview] = useState<{
    kind: 'image' | 'pdf' | 'md' | 'text' | 'unsupported'
    dataUrl?: string
    text?: string
    name: string
    size: number
    mtime: string
    message?: string
  } | null>(null)
  const [previewPath, setPreviewPath] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)
  /** 全屏预览模式 */
  const [fullscreen, setFullscreen] = useState(false)
  /** 右栏拖宽进行中 */
  const [rightResizing, setRightResizing] = useState(false)

  const refreshFiles = useCallback(async () => {
    setFilesLoading(true)
    try {
      const list = await window.app?.project?.files?.(project.id)
      setFiles(list ?? [])
    } catch {
      setFiles([])
    } finally {
      setFilesLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    setCollapsed(new Set())
    setMenuPath(null)
    void refreshFiles()
  }, [refreshFiles])

  /** 过滤掉收起目录的后代 */
  const visibleFiles = useMemo(
    () =>
      files.filter((f) => {
        const parts = f.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          if (collapsed.has(parts.slice(0, i).join('/'))) return false
        }
        return true
      }),
    [files, collapsed]
  )

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleCopyPath = useCallback(
    async (path: string) => {
      setMenuPath(null)
      const res = await window.app?.project?.copyPath?.(project.id, path)
      if (res?.success) toast.success('路径已复制', { description: path })
      else toast.error('复制失败', { description: res?.message })
    },
    [project.id]
  )

  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      setMenuPath(null)
      const what = entry.type === 'dir' ? '文件夹及其全部内容' : '文件'
      if (!window.confirm(`确定删除${what}「${entry.path}」？此操作直接作用于本地磁盘，不可恢复。`)) return
      const res = await window.app?.project?.deleteFile?.(project.id, entry.path)
      if (res?.success) {
        toast.success(res.message)
        await refreshFiles()
      } else {
        toast.error('删除失败', { description: res?.message })
      }
    },
    [project.id, refreshFiles]
  )

  /** 选中文件 → 右栏预览 */
  const handleSelectFile = useCallback(
    async (path: string) => {
      setPreviewPath(path)
      setPreviewLoading(true)
      setPreview(null)
      try {
        const res = await window.app?.project?.readPreview?.(project.id, path)
        setPreview(res ?? null)
      } catch (err) {
        toast.error('预览加载失败', { description: err instanceof Error ? err.message : String(err) })
      } finally {
        setPreviewLoading(false)
      }
    },
    [project.id]
  )

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name || INVALID_NAME.test(name)) {
      toast.error('名称为空或含非法字符（\\ / : * ? " < > |）')
      return
    }
    const parent = renaming.path.includes('/')
      ? renaming.path.slice(0, renaming.path.lastIndexOf('/') + 1)
      : ''
    const newPath = parent + name
    if (newPath === renaming.path) {
      setRenaming(null)
      return
    }
    setRenameSaving(true)
    try {
      const res = await window.app?.project?.renameFile?.(project.id, renaming.path, newPath)
      if (res?.success) {
        toast.success(`已重命名为 ${newPath}`)
        setRenaming(null)
        await refreshFiles()
      } else {
        toast.error('重命名失败', { description: res?.message })
      }
    } finally {
      setRenameSaving(false)
    }
  }, [renaming, project.id, refreshFiles])

  /** 上传题目：多选文件 → problem/attachments/（md/txt 同步 statement.md） */
  const handleImportProblem = useCallback(async () => {
    if (importing) return
    setImporting(true)
    try {
      const res = await window.app?.project?.importProblem?.(project.id)
      if (res?.success) {
        toast.success('题目已导入', { description: res.message })
        if (res.statementUpdated) toast.info('题目原文 statement.md 已更新，AI 可直接读取')
        await refreshFiles()
      } else if (res?.message) {
        toast.error('导入失败', { description: res.message })
      }
    } finally {
      setImporting(false)
    }
  }, [importing, project.id, refreshFiles])

  /** 编译论文：等待完成后展示日志 */
  const handleCompile = useCallback(
    async (opts?: { openInPreview?: boolean; silent?: boolean }) => {
      if (compiling) return
      setCompiling(true)
      if (!opts?.silent) toast.info('正在编译论文（xelatex）…首次编译可能较慢')
      try {
        const res = await window.app?.project?.compileLatex?.(project.id)
        if (res) {
          setLatexResult(res)
          await refreshFiles()
          if (res.success && res.pdfGenerated && opts?.openInPreview) {
            // 编译成功 → 自动在预览面板打开 paper/main.pdf
            setPreviewPath('paper/main.pdf')
            setPreviewLoading(true)
            try {
              const pv = await window.app?.project?.readPreview?.(project.id, 'paper/main.pdf')
              setPreview(pv ?? null)
            } finally {
              setPreviewLoading(false)
            }
          }
        }
      } finally {
        setCompiling(false)
      }
    },
    [compiling, project.id, refreshFiles]
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 工作台顶栏 */}
      <div className="h-12 border-b flex items-center gap-3 px-4 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> 项目列表
        </Button>
        <div className="h-5 w-px bg-border" />
        <h2 className="font-medium truncate">{project.name}</h2>
        <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium shrink-0">
          {COMPETITION_LABELS[project.competition]}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground shrink-0">
          {STAGE_LABELS[project.stage] ?? project.stage}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => void handleImportProblem()}
          disabled={importing}
          title="上传题目文件（md/txt 写入题目原文，其余进附件）"
        >
          <FileUp className="size-4" /> 上传题目
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void handleCompile({ openInPreview: true })}
          disabled={compiling}
          title="用 xelatex 编译 paper/main.tex"
        >
          <FileText className="size-4" /> {compiling ? '编译中…' : '编译论文'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setBackupOpen(true)}
        >
          <HardDriveDownload className="size-4" /> 备份本项目
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setLeftOpen((v) => !v)}
          aria-label={leftOpen ? '收起文件面板' : '展开文件面板'}
          title={leftOpen ? '收起文件面板' : '展开文件面板'}
        >
          {leftOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => setRightOpen((v) => !v)}
          aria-label={rightOpen ? '收起预览面板' : '展开预览面板'}
          title={rightOpen ? '收起预览面板' : '展开预览面板'}
        >
          {rightOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
      </div>

      {/* 三栏（左右可收起 + re-resizable 拖拽调宽；三栏容器 relative，供右栏 absolute 右钉） */}
      <div className="flex-1 flex min-h-0 min-w-0 relative">
        {/* 左：项目文件（re-resizable：指针捕获 + 边界钳制，鼠标出窗/最大化均正常） */}
        {leftOpen && (
          <Resizable
            size={{ width: leftWidth, height: '100%' }}
            minWidth={160}
            maxWidth={480}
            enable={{ right: true }}
            handleClasses={{ right: 'cursor-col-resize bg-transparent hover:bg-primary/30 transition-colors' }}
            handleStyles={{ right: { width: 5, right: -3 } }}
            onResizeStop={(_e, _dir, _ref, d) => {
              setLeftWidth((w) => Math.min(480, Math.max(160, w + d.width)))
            }}
            className="shrink-0"
          >
            <aside className="w-full h-full flex flex-col min-h-0 border-r overflow-hidden">
            <div className="h-9 shrink-0 border-b flex items-center justify-between px-3">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <FolderTree className="size-3.5" /> 项目文件
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => void refreshFiles()}
                disabled={filesLoading}
                aria-label="刷新文件列表"
              >
                <RefreshCw className={cn('size-3.5', filesLoading && 'animate-spin')} />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 text-xs" onClick={() => setMenuPath(null)}>
              {files.length === 0 && !filesLoading && (
                <p className="text-muted-foreground text-center mt-8">暂无文件</p>
              )}
              {visibleFiles.map((f) => (
                <FileRow
                  key={f.path}
                  entry={f}
                  collapsed={collapsed.has(f.path)}
                  menuOpen={menuPath === f.path}
                  selected={previewPath === f.path}
                  projectId={project.id}
                  onToggleDir={toggleDir}
                  onSelectFile={handleSelectFile}
                  onMenuToggle={(path) => setMenuPath((prev) => (prev === path ? null : path))}
                  onCopyPath={handleCopyPath}
                  onDelete={handleDelete}
                  onRename={(entry) => {
                    setMenuPath(null)
                    setRenaming({ path: entry.path, name: entry.path.split('/').pop() ?? '' })
                  }}
                />
              ))}
            </div>
          </aside>
          </Resizable>
        )}

        {/* 中：Agent 对话 */}
        <AgentChatPanel projectId={project.id} onActivity={() => void refreshFiles()} />

        {/* 右栏拖拽手柄：贴在预览面板左边缘（即预览的左边界），拖动只改预览宽度 */}
        <div
          role="separator"
          aria-orientation="vertical"
          className="w-1.5 shrink-0 cursor-col-resize z-20 bg-transparent hover:bg-primary/30 transition-colors"
          title="拖动调整预览面板宽度（向右拖变窄，向左拖变宽；拖到最右收起）"
          onPointerDown={(e) => {
            e.preventDefault()
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            setRightResizing(true)
          }}
          onPointerMove={(e) => {
            if (!rightResizing) return
            const container = e.currentTarget.parentElement
            if (!container) return
            const w = container.getBoundingClientRect().right - e.clientX
            if (w <= 24) {
              // 拖过阈值：收起面板
              setRightOpen(false)
              setRightResizing(false)
            } else {
              setRightOpen(true)
              setRightWidth(Math.min(1200, Math.max(200, w)))
            }
          }}
          onPointerUp={() => setRightResizing(false)}
        />

        {/* 右：预览面板（普通 flex 成员：右缘天然钉住右边框，收起即完全消失） */}
        {rightOpen && (
          <aside
            style={{ width: rightWidth }}
            className="shrink-0 flex flex-col min-h-0 border-l ml-2 overflow-hidden"
          >
            <div className="h-9 shrink-0 border-b flex items-center justify-between px-3 gap-2">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 min-w-0">
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{previewPath ? previewPath : '预览面板'}</span>
              </span>
              {previewPath && (
                <div className="flex items-center gap-1 shrink-0">
                  {previewPath === 'paper/main.pdf' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => void handleCompile({ openInPreview: true, silent: true })}
                      disabled={compiling}
                      aria-label="重新编译论文"
                      title="重新编译论文并刷新预览"
                    >
                      <RefreshCw className={cn('size-3', compiling && 'animate-spin')} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => void handleCopyPath(previewPath)}
                    aria-label="复制路径"
                    title="复制路径"
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3 min-h-0 flex flex-col [&>*]:w-full">
              {previewLoading && <p className="text-xs text-muted-foreground text-center mt-8">加载中…</p>}
              {!previewLoading && !preview && !previewPath && (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground p-4 text-center">
                  <FileText className="size-6" />
                  <p className="text-xs">点击左侧文件预览</p>
                  <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
                    <Sparkles className="size-3" /> 支持图片 / PDF / Markdown / 文本
                  </p>
                </div>
              )}
              {!previewLoading && preview?.kind === 'image' && preview.dataUrl && (
                <img src={preview.dataUrl} alt={preview.name} className="w-full h-auto object-contain rounded border" />
              )}
              {!previewLoading && preview?.kind === 'pdf' && preview.dataUrl && (
                <iframe src={preview.dataUrl} title={preview.name} className="w-full flex-1 min-h-[400px] rounded border" />
              )}
              {!previewLoading && preview?.kind === 'md' && preview.text !== undefined && (
                <div className="w-full">
                  <Markdown content={preview.text} />
                </div>
              )}
              {!previewLoading && preview?.kind === 'text' && preview.text !== undefined && (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-5 w-full">{preview.text}</pre>
              )}
              {!previewLoading && preview && (preview.kind === 'unsupported' || preview.message) && (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
                  <FileText className="size-6 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {preview.message ?? '暂不支持预览该类型'}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void handleCopyPath(previewPath)}>
                    <Copy className="size-3.5" /> 复制文件路径
                  </Button>
                </div>
              )}
            </div>
            {/* 全屏预览入口 */}
            {preview && !previewLoading && (
              <div className="shrink-0 border-t p-2">
                <Button variant="outline" size="sm" className="w-full" onClick={() => setFullscreen(true)}>
                  全屏预览
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* 全屏预览覆盖层 */}
      {fullscreen && preview && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="h-12 shrink-0 border-b flex items-center gap-3 px-4">
            <span className="text-sm font-medium truncate flex-1">{previewPath}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {preview.size ? `${(preview.size / 1024).toFixed(1)} KB` : ''}
            </span>
            {preview.kind === 'image' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const img = document.querySelector<HTMLImageElement>('#fullscreen-preview img')
                  if (img) {
                    img.style.maxWidth = img.style.maxWidth === 'none' ? '100%' : 'none'
                    img.style.width = img.style.width === '100%' ? 'auto' : '100%'
                  }
                }}
              >
                100% / 适应
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setFullscreen(false)}>
              退出全屏
            </Button>
          </div>
          <div id="fullscreen-preview" className="flex-1 overflow-auto p-4 flex flex-col [&>*]:w-full">
            {preview.kind === 'image' && preview.dataUrl && (
              <img src={preview.dataUrl} alt={preview.name} className="w-full h-auto object-contain" />
            )}
            {preview.kind === 'pdf' && preview.dataUrl && (
              <iframe src={preview.dataUrl} title={preview.name} className="w-full flex-1 rounded border" />
            )}
            {preview.kind === 'md' && preview.text !== undefined && (
              <div className="w-full max-w-4xl mx-auto">
                <Markdown content={preview.text} />
              </div>
            )}
            {preview.kind === 'text' && preview.text !== undefined && (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-5 w-full">{preview.text}</pre>
            )}
            {preview.kind === 'unsupported' && (
              <p className="text-sm text-muted-foreground m-auto">{preview.message ?? '暂不支持预览'}</p>
            )}
          </div>
        </div>
      )}

      {/* 项目备份对话框 */}
      <ProjectBackupDialog open={backupOpen} onOpenChange={setBackupOpen} project={project} />

      {/* 重命名对话框（直接作用于本地磁盘） */}
      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
            <DialogDescription>
              {renaming?.path}
              <br />
              将直接重命名本地磁盘上的文件/文件夹（标准结构受保护）。
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renaming?.name ?? ''}
            onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleRenameSubmit()
            }}
            maxLength={120}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)} disabled={renameSaving}>
              取消
            </Button>
            <Button onClick={() => void handleRenameSubmit()} disabled={renameSaving || !renaming?.name.trim()}>
              确认重命名
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编译结果对话框 */}
      <Dialog open={!!latexResult} onOpenChange={(v) => !v && setLatexResult(null)}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle className={latexResult?.success ? 'text-success' : 'text-destructive'}>
              {latexResult?.message}
            </DialogTitle>
            <DialogDescription>
              {latexResult?.pdfGenerated
                ? `PDF 已生成：${latexResult.pdfPath}`
                : '未生成 PDF，可查看下方日志定位错误'}
            </DialogDescription>
          </DialogHeader>
          {latexResult?.logTail && (
            <pre className="text-xs font-mono bg-muted/60 rounded-md p-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
              {latexResult.logTail}
            </pre>
          )}
          <DialogFooter>
            {latexResult?.pdfGenerated && (
              <>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const res = await window.app?.project?.openFile?.(project.id, 'paper/main.pdf')
                    if (res && !res.success) toast.error('打开失败', { description: res.message })
                  }}
                >
                  <FileText className="size-4" /> 打开 PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setLatexResult(null)
                    setPreviewPath('paper/main.pdf')
                    void (async () => {
                      setPreviewLoading(true)
                      try {
                        const pv = await window.app?.project?.readPreview?.(project.id, 'paper/main.pdf')
                        setPreview(pv ?? null)
                      } finally {
                        setPreviewLoading(false)
                      }
                    })()
                  }}
                >
                  在预览中查看
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void window.app?.project?.copyPath?.(project.id, 'paper/main.pdf')}
                >
                  <Copy className="size-4" /> 复制路径
                </Button>
              </>
            )}
            <Button onClick={() => setLatexResult(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 标准目录的中文注解（左侧文件面板展示用） */
const DIR_LABELS: Record<string, string> = {
  problem: '题目',
  'problem/attachments': '原始附件',
  workspace: '支撑材料',
  'workspace/code': '求解代码',
  'workspace/data': '数据结果',
  'workspace/outputs': '运行输出',
  'workspace/figures': '生成图表',
  'workspace/notes': '过程笔记',
  paper: '论文',
  'paper/sections': '论文章节',
  'paper/figures': '论文图片'
}

interface FileRowProps {
  entry: FileEntry
  collapsed: boolean
  menuOpen: boolean
  selected: boolean
  projectId: string
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
  onMenuToggle: (path: string) => void
  onCopyPath: (path: string) => void
  onDelete: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
}

function FileRow({
  entry,
  collapsed,
  menuOpen,
  selected,
  onToggleDir,
  onSelectFile,
  onMenuToggle,
  onCopyPath,
  onDelete,
  onRename
}: FileRowProps) {
  const isDir = entry.type === 'dir'
  const depth = entry.path.split('/').length - 1
  const label = isDir ? DIR_LABELS[entry.path] : undefined
  return (
    <div
      className={cn(
        'group flex items-center gap-1 py-0.5 rounded px-1 min-w-0',
        selected ? 'bg-primary/15' : 'hover:bg-muted/50'
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      {/* 目录：点击整行折叠/展开；文件：点击预览 */}
      <div
        className={cn('flex items-center gap-1.5 min-w-0 flex-1', isDir && 'cursor-pointer')}
        onClick={isDir ? () => onToggleDir(entry.path) : () => onSelectFile(entry.path)}
      >
        {isDir ? (
          <>
            {collapsed ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {collapsed ? (
              <Folder className="size-3.5 shrink-0 text-primary/70" />
            ) : (
              <FolderOpen className="size-3.5 shrink-0 text-primary/70" />
            )}
          </>
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground ml-[14px]" />
        )}
        <span className={cn('truncate cursor-pointer', isDir && 'font-medium')} title={entry.path}>
          {entry.path.split('/').pop()}
        </span>
        {label && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">{label}</span>
        )}
      </div>

      {/* 行内操作菜单（悬停显示 ⋯） */}
      <div className="relative shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="文件操作"
          onClick={(e) => {
            e.stopPropagation()
            onMenuToggle(entry.path)
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => onMenuToggle(entry.path)} />
            <div className="absolute right-0 top-full z-50 mt-0.5 min-w-[120px] rounded-md border bg-popover py-1 shadow-lg">
              <MenuItem icon={Copy} text="复制路径" onClick={() => onCopyPath(entry.path)} />
              <MenuItem icon={Pencil} text="重命名" onClick={() => onRename(entry)} />
              <MenuItem icon={Trash2} text="删除" danger onClick={() => onDelete(entry)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MenuItem({
  icon: Icon,
  text,
  danger,
  onClick
}: {
  icon: typeof Copy
  text: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60',
        danger ? 'text-destructive hover:text-destructive' : 'text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      {text}
    </button>
  )
}
