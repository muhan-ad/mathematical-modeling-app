import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Bot,
  ChevronRight,
  FileUp,
  FolderOpen,
  HardDriveDownload,
  Plus,
  Trash2,
  Zap
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog'
import { cn } from '@/lib/utils'
import {
  COMPETITION_LABELS,
  STAGE_LABELS,
  formatTime,
  getProjectApi,
  type ProjectMeta
} from '@/lib/projects'
import { PROVIDER_TYPE_LABELS, getSettingsApi } from '@/lib/settings'

interface ProjectListPageProps {
  /** 打开项目（进入工作台） */
  onOpenProject: (project: ProjectMeta) => void
  /** 打开设置页 */
  onOpenSettings: () => void
  /** 打开技能库对话框 */
  onOpenSkills: () => void
  /** 打开备份管理对话框 */
  onOpenBackup: () => void
}

/** 工作台状态卡片（模型 / 技能 / 备份） */
function StatusCard({
  icon: Icon,
  title,
  main,
  sub,
  warning,
  onClick
}: {
  icon: typeof Bot
  title: string
  main: string
  sub: string
  warning?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border bg-card p-4 flex flex-col gap-1.5 text-left transition-colors hover:border-primary/50 cursor-pointer',
        warning && 'border-warning/40'
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </span>
      <span className={cn('text-sm font-medium', warning && 'text-warning')}>{main}</span>
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        {sub} <ChevronRight className="size-3" />
      </span>
    </button>
  )
}

export function ProjectListPage({
  onOpenProject,
  onOpenSettings,
  onOpenSkills,
  onOpenBackup
}: ProjectListPageProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  /** 工作台状态 */
  const [providerCount, setProviderCount] = useState(0)
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [skillCount, setSkillCount] = useState(0)
  const [lastBackup, setLastBackup] = useState<string>('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await getProjectApi().list())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载项目列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getSettingsApi().get()
      setProviderCount(s.providers.length)
      const def = s.providers.find((p: { id: string }) => p.id === s.defaultProvider)
      setDefaultModel(def ? def.model : '')
    } catch {
      /* 浏览器预览时无此 API */
    }
    try {
      const skills = await window.app?.skill?.list()
      setSkillCount(skills?.length ?? 0)
    } catch {
      setSkillCount(0)
    }
    try {
      const backups = await window.app?.backup?.list()
      const latest = (backups ?? [])
        .sort((a: { createdAt: string }, b: { createdAt: string }) =>
          b.createdAt.localeCompare(a.createdAt)
        )[0]
      setLastBackup(latest ? formatTime(latest.createdAt) : '')
    } catch {
      setLastBackup('')
    }
  }, [])

  useEffect(() => {
    refresh()
    refreshStatus()
  }, [refresh, refreshStatus])

  const handleDelete = async (project: ProjectMeta) => {
    // 二次确认，防误删整个项目目录
    if (!window.confirm(`确定删除项目「${project.name}」吗？\n该操作会删除项目的全部题目、代码与论文文件，不可恢复。`)) {
      return
    }
    setDeletingId(project.id)
    try {
      const res = await getProjectApi().delete(project.id)
      if (res.success) {
        toast.success(`项目「${project.name}」已删除`)
        await refresh()
      } else {
        toast.error(res.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const noProviders = providerCount === 0

  return (
    <div className="mx-auto max-w-5xl w-full px-6 py-8">
      {/* 三步上手（未配置模型时显示） */}
      {noProviders && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 mb-8">
          <h2 className="text-sm font-semibold text-primary mb-3">三步开始使用</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { step: '1', title: '配置模型服务', desc: '添加 DeepSeek / GPT / Claude 等任一服务商的 API', action: onOpenSettings, actionText: '去设置' },
              { step: '2', title: '创建竞赛项目', desc: '选择竞赛类型，自动建立规范的题目/支撑材料/论文目录', action: () => setCreateOpen(true), actionText: '新建项目' },
              { step: '3', title: '开始对话求解', desc: '在对话里让 AI 读题、建模、写代码、写论文', action: onOpenSkills, actionText: '先看看技能库' }
            ].map((s) => (
              <div key={s.step} className="rounded-md border bg-card p-3 flex flex-col gap-1.5">
                <span className="size-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-semibold">
                  {s.step}
                </span>
                <span className="text-sm font-medium">{s.title}</span>
                <span className="text-xs text-muted-foreground leading-5">{s.desc}</span>
                <button className="text-xs text-primary text-left hover:underline" onClick={s.action}>
                  {s.actionText} →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近项目 + 快速操作 */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground">最近项目</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled title="即将上线：上传题目 PDF 自动创建项目">
            <FileUp className="size-4" /> 上传题目建项
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> 新建项目
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 flex flex-col items-center gap-3 text-center mb-8">
          <p className="text-muted-foreground text-sm">还没有项目，创建第一个竞赛项目开始吧</p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> 新建项目
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group rounded-lg border bg-card p-5 flex flex-col gap-3 transition-colors hover:border-primary/50 cursor-pointer"
              onClick={() => onOpenProject(p)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium leading-snug line-clamp-2">{p.name}</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`删除项目 ${p.name}`}
                  className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={deletingId === p.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(p)
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-primary/10 text-primary px-2 py-0.5 font-medium">
                  {COMPETITION_LABELS[p.competition]}
                </span>
                <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  {STAGE_LABELS[p.stage] ?? p.stage}
                </span>
              </div>
              <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                <span>更新于 {formatTime(p.updatedAt)}</span>
                <span className={cn('flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100')}>
                  <FolderOpen className="size-3.5" /> 打开
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 工作台状态 */}
      <h2 className="text-sm font-semibold text-muted-foreground mb-3">工作台状态</h2>
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <StatusCard
          icon={Bot}
          title="模型服务"
          main={noProviders ? '未配置模型' : defaultModel || `${providerCount} 个服务商`}
          sub={noProviders ? '点此去配置 →' : `${providerCount} 个服务商 · 管理`}
          warning={noProviders}
          onClick={onOpenSettings}
        />
        <StatusCard
          icon={Zap}
          title="技能库"
          main={skillCount ? `${skillCount} 个技能` : '还没有技能'}
          sub={skillCount ? '沉淀解题方法论 · 管理' : '沉淀你的解题方法论 →'}
          onClick={onOpenSkills}
        />
        <StatusCard
          icon={HardDriveDownload}
          title="备份"
          main={lastBackup ? `最近备份 ${lastBackup}` : '还没有备份'}
          sub="备份历史与路径 · 管理"
          onClick={onOpenBackup}
        />
      </div>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(project) => onOpenProject(project)}
      />
    </div>
  )
}
