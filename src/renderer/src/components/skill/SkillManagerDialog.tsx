import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FolderOpen, Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react'
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
import { Label } from '@/components/ui/label'

interface SkillMeta {
  id: string
  name: string
  description: string
  updatedAt: string
}

interface SkillEditorState {
  id?: string
  name: string
  description: string
  content: string
}

const EMPTY_EDITOR: SkillEditorState = { name: '', description: '', content: '' }

interface SkillManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 技能库管理（参照 DSH 的 skill 体系）：
 * 技能 = 名称 + 描述 + Markdown 操作指令。
 * 会话启动时把「目录」注入 Agent 系统提示词，模型按需用 skill_load 取全文。
 * 后续解题将主要依赖技能：把解题方法论沉淀成技能，Agent 自动按题调用。
 */
export function SkillManagerDialog({ open, onOpenChange }: SkillManagerDialogProps) {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [editor, setEditor] = useState<SkillEditorState | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSkills((await window.app?.skill?.list()) ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const handleEdit = useCallback(async (id: string) => {
    const detail = await window.app?.skill?.get(id)
    if (detail) {
      setEditor({ id: detail.id, name: detail.name, description: detail.description, content: detail.content })
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!editor) return
    if (!editor.name.trim()) {
      toast.error('请填写技能名称')
      return
    }
    setSaving(true)
    try {
      const result = await window.app!.skill.save({
        id: editor.id,
        name: editor.name.trim(),
        description: editor.description.trim(),
        content: editor.content
      })
      if (result.success) {
        toast.success(result.message)
        setEditor(null)
        await refresh()
      } else {
        toast.error('保存失败', { description: result.message })
      }
    } finally {
      setSaving(false)
    }
  }, [editor, refresh])

  const handleDelete = useCallback(
    async (skill: SkillMeta) => {
      if (!window.confirm(`确定删除技能「${skill.name}」？此操作不可恢复。`)) return
      const result = await window.app?.skill?.remove(skill.id)
      if (result?.success) {
        toast.success(result.message)
        await refresh()
      } else {
        toast.error('删除失败', { description: result?.message })
      }
    },
    [refresh]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] flex flex-col max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-5 text-primary" />
            技能库
          </DialogTitle>
          <DialogDescription>
            技能是沉淀给 Agent 的解题方法论（Markdown 指令）。对话时 Agent 会在任务匹配时自动加载对应技能。
          </DialogDescription>
        </DialogHeader>

        {editor ? (
          <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>技能名称</Label>
                <Input
                  value={editor.name}
                  placeholder="例如：回归分析"
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  maxLength={40}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>一句话描述（会显示给 Agent 的目录）</Label>
                <Input
                  value={editor.description}
                  placeholder="例如：一元/多元回归建模步骤与检验清单"
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  maxLength={80}
                />
              </div>
            </div>
            <div className="grid gap-1.5 flex-1 min-h-0">
              <Label>操作指令（Markdown，模型按此执行）</Label>
              <textarea
                value={editor.content}
                placeholder={'例如：\n1. 先做数据探查（缺失/异常/分布）\n2. 用 python_exec 拟合模型…'}
                onChange={(e) => setEditor({ ...editor, content: e.target.value })}
                className="min-h-[240px] rounded-md border bg-transparent px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto -mx-1 px-1">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> 加载中…
              </div>
            )}
            {!loading && skills.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <BookOpen className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  还没有技能。建议从「读题拆解」「回归建模」「聚类分析」这类可复用的解题方法开始沉淀。
                </p>
              </div>
            )}
            <div className="space-y-2">
              {skills.map((s) => (
                <div key={s.id} className="rounded-md border p-3 flex items-start gap-3">
                  <Zap className="size-4 mt-0.5 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 break-words">{s.description}</div>
                    )}
                    <div className="text-[11px] text-muted-foreground/70 mt-1">
                      {s.id} · 更新于 {new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => void handleEdit(s.id)} aria-label="编辑">
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(s)}
                    aria-label="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button variant="ghost" className="mr-auto" onClick={() => void window.app?.skill?.openDir()}>
            <FolderOpen className="size-4" /> 打开技能目录
          </Button>
          {editor ? (
            <>
              <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
                取消
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                保存技能
              </Button>
            </>
          ) : (
            <Button onClick={() => setEditor(EMPTY_EDITOR)}>
              <Plus className="size-4" /> 新建技能
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
