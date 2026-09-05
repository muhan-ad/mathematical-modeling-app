import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

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
import { cn } from '@/lib/utils'
import { COMPETITION_OPTIONS, getProjectApi, type CompetitionType, type ProjectMeta } from '@/lib/projects'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 创建成功后回调（返回新项目元数据） */
  onCreated: (project: ProjectMeta) => void
}

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState('')
  const [competition, setCompetition] = useState<CompetitionType>('cumcm')
  const [creating, setCreating] = useState(false)

  const reset = () => {
    setName('')
    setCompetition('cumcm')
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('请输入项目名称')
      return
    }
    setCreating(true)
    try {
      const project = await getProjectApi().create({ name: name.trim(), competition })
      toast.success(`项目「${project.name}」已创建`)
      reset()
      onOpenChange(false)
      onCreated(project)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建项目失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建竞赛项目</DialogTitle>
          <DialogDescription>
            将创建独立的题目 / 求解 / 论文目录结构
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="project-name">项目名称</Label>
            <Input
              id="project-name"
              placeholder="例如：2026 高教社杯 A 题"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !creating) handleCreate()
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>竞赛类型</Label>
            <div className="flex flex-wrap gap-2">
              {COMPETITION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCompetition(opt.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    competition === opt.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating && <Loader2 className="size-4 animate-spin" />}
            创建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
