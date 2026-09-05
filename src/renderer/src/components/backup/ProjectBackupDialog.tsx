import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, HardDriveDownload, Loader2 } from 'lucide-react'

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
import { Label } from '@/components/ui/label'
import type { ProjectMeta } from '@/lib/projects'

interface ProjectBackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectMeta
}

/** 工作台内针对当前项目的快速备份对话框 */
export function ProjectBackupDialog({ open, onOpenChange, project }: ProjectBackupDialogProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
    }
  }, [open])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入备份名称')
      return
    }
    setSubmitting(true)
    try {
      const api = window.app?.backup
      const result = api
        ? await api.createProject(project.id, trimmed)
        : await Promise.reject(new Error('备份功能仅在桌面应用中可用'))
      if (result.success) {
        toast.success('项目备份成功', {
          description: `第 ${result.count} 次备份 "${result.backupName}"（项目：${project.name}）已完成`
        })
        onOpenChange(false)
      } else {
        toast.error('备份失败', { description: result.message })
      }
    } catch (err) {
      toast.error('备份失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDriveDownload className="h-5 w-5 text-primary" />
            备份本项目
          </DialogTitle>
          <DialogDescription>
            将项目「{project.name}」的题目、代码与论文打包成 zip
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="project-backup-name">备份名称</Label>
          <Input
            id="project-backup-name"
            autoFocus
            placeholder="例如：第一问完成 / 提交前终稿"
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
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
