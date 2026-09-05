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
  /** 可拖拽栏宽（记忆在本地） */
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem('wam-left-width')) || 260)
  const [rightWidth, setRightWidth] = useState(() => Number(localStorage.getItem('wam-right-width')) || 300)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragSide = useRef<'left' | 'right' | null>(null)

  useEffect(() => {
    localStorage.setItem('wam-left-width', String(leftWidth))
  }, [leftWidth])
  useEffect(() => {
    localStorage.setItem('wam-right-width', String(rightWidth))
  }, [rightWidth])

  // 拖拽分隔条：mousemove 实时更新对应栏宽，抬起结束
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const side = dragSide.current
      const rect = containerRef.current?.getBoundingClientRect()
      if (!side || !rect) return
      if (side === 'left') {
        setLeftWidth(Math.min(Math.max(e.clientX - rect.left, 160), Math.min(480, rect.width - 320)))
      } else {
        setRightWidth(Math.min(Math.max(rect.right - e.clientX, 200), Math.min(560, rect.width - 380)))
      }
    }
    const onUp = () => {
      if (dragSide.current) {
        dragSide.current = null
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDrag = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    dragSide.current = side
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }
  /** 收起的目录集合 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** 行内操作菜单展开的行 */
  const [menuPath, setMenuPath] = useState<string | null>(null)
  /** 重命名对话框 */
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)

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

      {/* 三栏（左右可收起 + 可拖拽调整宽度） */}
      <div ref={containerRef} className="flex-1 flex min-h-0 min-w-0">
        {/* 左：项目文件 */}
        {leftOpen && (
          <aside style={{ width: leftWidth }} className="shrink-0 flex flex-col min-h-0 border-r overflow-hidden">
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
                  projectId={project.id}
                  onToggleDir={toggleDir}
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
        )}

        {/* 左侧拖拽分隔条 */}
        {leftOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={startDrag('left')}
            title="拖动调整左栏宽度"
          />
        )}

        {/* 中：Agent 对话 */}
        <AgentChatPanel projectId={project.id} onActivity={() => void refreshFiles()} />

        {/* 右侧拖拽分隔条 */}
        {rightOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={startDrag('right')}
            title="拖动调整右栏宽度"
          />
        )}

        {/* 右：预览面板（Phase 2 接 PDF/图片/Markdown 预览） */}
        {rightOpen && (
          <aside style={{ width: rightWidth }} className="shrink-0 flex flex-col items-center justify-center gap-2 text-muted-foreground p-4 text-center border-l overflow-hidden">
            <FileText className="size-6" />
            <p className="text-xs">预览面板（开发中）</p>
            <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
              <Sparkles className="size-3" /> 将支持论文 PDF / 图表 / 结果文件预览
            </p>
          </aside>
        )}
      </div>

      {/* 项目备份对话框 */}
      <ProjectBackupDialog open={backupOpen} onOpenChange={setBackupOpen} project={project} />

      {/* 重命名对话框（直接作用于本地磁盘） */}
      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-[420px]">
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
  projectId: string
  onToggleDir: (path: string) => void
  onMenuToggle: (path: string) => void
  onCopyPath: (path: string) => void
  onDelete: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
}

function FileRow({
  entry,
  collapsed,
  menuOpen,
  projectId: _projectId,
  onToggleDir,
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
      className="group flex items-center gap-1 py-0.5 rounded hover:bg-muted/50 px-1 min-w-0"
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      {/* 目录：点击整行折叠/展开 */}
      <div
        className={cn('flex items-center gap-1.5 min-w-0 flex-1', isDir && 'cursor-pointer')}
        onClick={isDir ? () => onToggleDir(entry.path) : undefined}
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
        <span className={cn('truncate', isDir && 'font-medium')} title={entry.path}>
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
