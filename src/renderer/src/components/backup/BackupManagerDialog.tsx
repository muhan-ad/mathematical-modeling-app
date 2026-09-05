import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Package,
  RotateCcw,
  Trash2
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { getProjectApi, type ProjectMeta } from '@/lib/projects'

interface BackupManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface BackupResult {
  success: boolean
  backupName: string
  count: number
  timestamp: string
  filePath: string
  fileSize: number
  message: string
}

interface BackupListItem {
  name: string
  size: number
  createdAt: string
  backupName: string | null
  projectName: string | null
  projectId: string | null
  count: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BackupManagerDialog({ open, onOpenChange }: BackupManagerDialogProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  /** 当前选中的项目 id；'' 表示还没有可选项目 */
  const [projectId, setProjectId] = useState('')
  const [projectCount, setProjectCount] = useState(0)

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<BackupResult | null>(null)

  const [items, setItems] = useState<BackupListItem[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  const [backupDir, setBackupDir] = useState('')
  const [dirInput, setDirInput] = useState('')
  const [savingDir, setSavingDir] = useState(false)

  const backupApi = window.app?.backup
  const selectedProject = projects.find((p) => p.id === projectId) ?? null

  /** 拉取历史列表 + 当前路径 */
  const refreshList = useCallback(async () => {
    if (!backupApi) return
    try {
      setItems(await backupApi.list())
      setBackupDir(await backupApi.getDir())
    } catch (err) {
      console.error('[backup-manager] 刷新列表失败:', err)
    }
  }, [backupApi])

  /** 切换项目后刷新该项目的备份计数 */
  const refreshCount = useCallback(
    async (pid: string) => {
      if (!backupApi || !pid) {
        setProjectCount(0)
        return
      }
      try {
        setProjectCount(await backupApi.getCount(pid))
      } catch {
        setProjectCount(0)
      }
    },
    [backupApi]
  )

  // 每次打开对话框：重置表单 + 拉项目/列表
  useEffect(() => {
    if (!open) return
    setLastResult(null)
    setError(null)
    setName('')
    setDirInput('')
    setItems([])
    void (async () => {
      let list: ProjectMeta[] = []
      try {
        list = await getProjectApi().list()
      } catch {
        list = []
      }
      setProjects(list)
      setProjectsLoaded(true)
      // 默认选中最近更新的第一个项目
      setProjectId(list[0]?.id ?? '')
      void refreshCount(list[0]?.id ?? '')
      await refreshList()
    })()
  }, [open, backupApi, refreshList, refreshCount])

  const handleProjectChange = (pid: string) => {
    setProjectId(pid)
    void refreshCount(pid)
  }

  const handleSubmit = useCallback(async () => {
    if (!selectedProject) {
      setError('请先选择一个项目')
      return
    }
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入备份名称')
      return
    }
    if (trimmed.length > 80) {
      setError('备份名称过长（最多 80 字符）')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      // 无 preload（浏览器/测试环境）走 catch 显示失败 toast
      const result = backupApi
        ? await backupApi.createProject(projectId, trimmed)
        : await Promise.reject(new Error('备份功能仅在桌面应用中可用'))

      setLastResult(result)
      if (result.success) {
        setProjectCount(result.count)
        toast.success('项目备份成功', {
          description: `项目「${selectedProject.name}」第 ${result.count} 次备份 "${result.backupName}" 已于 ${result.timestamp} 完成`
        })
        await refreshList()
      } else {
        toast.error('备份失败', { description: result.message })
      }
    } catch (err) {
      toast.error('备份失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }, [name, projectId, selectedProject, backupApi, refreshList])

  const handleDelete = useCallback(
    async (item: BackupListItem) => {
      if (!backupApi) return
      if (!window.confirm(`确定删除备份「${item.name}」吗？删除后不可恢复。`)) return
      setDeleting(item.name)
      try {
        const res = await backupApi.remove(item.name)
        if (res.success) {
          toast.success(res.message)
          await refreshList()
          // 被删备份所属项目的计数可能变化，同步刷新当前项目的计数
          await refreshCount(projectId)
        } else {
          toast.error(res.message)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '删除失败')
      } finally {
        setDeleting(null)
      }
    },
    [backupApi, refreshList, refreshCount, projectId]
  )

  const handleOpenDir = useCallback(async () => {
    if (!backupApi) return
    try {
      const res = await backupApi.openDir()
      if (!res.success) toast.error(res.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件夹失败')
    }
  }, [backupApi])

  const handleSaveDir = useCallback(async () => {
    if (!backupApi) return
    setSavingDir(true)
    try {
      const res = await backupApi.setDir(dirInput.trim() === '' ? null : dirInput.trim())
      if (res.success) {
        toast.success(res.message)
        setDirInput('')
        await refreshList()
      } else {
        toast.error(res.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改路径失败')
    } finally {
      setSavingDir(false)
    }
  }, [backupApi, dirInput, refreshList])

  const noProjects = projectsLoaded && projects.length === 0
  const isCustomDir = backupDir && !backupDir.endsWith('backups')

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-5 w-5 text-primary" />
            备份管理
          </DialogTitle>
          <DialogDescription>
            针对单个竞赛项目备份（题目 / 求解 / 论文），管理历史备份与保存位置。
          </DialogDescription>
        </DialogHeader>

        {noProjects ? (
          /* ── 无项目：提示先创建 ── */
          <div className="rounded-md border border-dashed p-8 text-center space-y-2">
            <Package className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">还没有可备份的项目</p>
            <p className="text-sm text-muted-foreground">
              备份功能针对单个项目使用。请先回到项目列表创建一个竞赛项目，再来备份。
            </p>
          </div>
        ) : (
          <>
            {/* ── 创建项目备份 ── */}
            <section className="rounded-md border bg-muted/30 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-primary">创建项目备份</h3>

              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
                <Label htmlFor="backup-scope" className="text-sm">目标项目</Label>
                <select
                  id="backup-scope"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={projectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  disabled={submitting}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <Label htmlFor="backup-name" className="text-sm">备份名称</Label>
                <div>
                  <Input
                    id="backup-name"
                    placeholder="例如：第一问完成 / 编译失败前 / 提交前终稿"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      if (error) setError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !submitting) void handleSubmit()
                    }}
                    aria-invalid={!!error}
                    disabled={submitting}
                    maxLength={80}
                  />
                  {error && (
                    <p className="mt-1 text-sm text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {error}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {selectedProject ? (
                    <>
                      「{selectedProject.name}」本次将是{' '}
                      <span className="font-semibold text-primary">第 {projectCount + 1} 次备份</span>
                      （删除备份时计数会同步减少）
                    </>
                  ) : (
                    '选择一个项目后开始备份'
                  )}
                </span>
                <Button size="sm" onClick={handleSubmit} disabled={submitting || !selectedProject}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      备份中...
                    </>
                  ) : (
                    <>
                      <HardDriveDownload className="h-4 w-4" />
                      立即备份
                    </>
                  )}
                </Button>
              </div>

              {lastResult && (
                <div
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm',
                    lastResult.success
                      ? 'border-success/30 bg-success/10 text-foreground'
                      : 'border-destructive/30 bg-destructive/10 text-destructive'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {lastResult.success ? (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">{lastResult.success ? '备份成功' : '备份失败'}</div>
                      <div className="text-xs mt-0.5 break-words">{lastResult.message}</div>
                      {lastResult.success && (
                        <div className="text-xs mt-1 text-muted-foreground break-all">文件：{lastResult.filePath}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* ── 历史备份 ── */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-primary">历史备份（{items.length}）</h3>
              {!backupApi ? (
                <p className="text-sm text-muted-foreground">桌面应用中可用</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center">
                  当前目录还没有备份文件
                </p>
              ) : (
                <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <li key={item.name} className="rounded-md border p-3 flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate max-w-[240px]">
                            {item.backupName ?? item.name}
                          </span>
                          {item.projectName && (
                            <span className="rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs font-medium">
                              {item.projectName}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {item.count !== null && `第 ${item.count} 次 · `}
                          {formatBytes(item.size)} · {formatTime(item.createdAt)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="删除此备份"
                        aria-label={`删除备份 ${item.name}`}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        disabled={deleting === item.name}
                        onClick={() => handleDelete(item)}
                      >
                        {deleting === item.name ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* ── 备份路径 ── */}
        {backupApi && (
          <section className="rounded-md border bg-muted/30 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-primary">备份路径</h3>
            <p className="text-xs text-muted-foreground break-all font-mono" title={backupDir}>
              {backupDir}
              {isCustomDir && '（自定义）'}
            </p>
            <div className="flex items-center gap-2">
              <Input
                placeholder="输入新目录的绝对路径，如 D:\\backups"
                value={dirInput}
                onChange={(e) => setDirInput(e.target.value)}
                disabled={savingDir}
                maxLength={260}
              />
              <Button variant="outline" size="sm" onClick={handleSaveDir} disabled={savingDir}>
                {savingDir ? <Loader2 className="h-4 w-4 animate-spin" /> : '修改'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleOpenDir}>
                <FolderOpen className="h-4 w-4" /> 打开文件夹
              </Button>
              {isCustomDir && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDirInput('')
                    void backupApi.setDir(null).then((res) => {
                      if (res.success) {
                        toast.success(res.message)
                        void refreshList()
                      } else {
                        toast.error(res.message)
                      }
                    })
                  }}
                >
                  <RotateCcw className="h-4 w-4" /> 恢复默认
                </Button>
              )}
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                <ExternalLink className="h-3 w-3" /> 已有备份不会自动迁移
              </span>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
