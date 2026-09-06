import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Check, KeyRound, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProviderDialog } from '@/components/settings/ProviderDialog'
import { cn } from '@/lib/utils'
import { applyTheme, getTheme, type ThemeName } from '@/lib/theme'
import {
  PROVIDER_TYPE_LABELS,
  STAGE_LABELS,
  getSettingsApi,
  type ProviderView,
  type SettingsView,
  type Stage
} from '@/lib/settings'

interface SettingsPageProps {
  onBack: () => void
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderView | null>(null)
  const [searchEnabled, setSearchEnabled] = useState(true)
  const [searchProvider, setSearchProvider] = useState<'tavily' | 'serpapi'>('tavily')
  const [searchKey, setSearchKey] = useState('')
  const [savingSearch, setSavingSearch] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => getTheme())
  /** 优化 AI 专属技能（独立于主技能库） */
  const [optSkills, setOptSkills] = useState<
    { id: string; name: string; description: string; enabled: boolean; updatedAt: string }[] | null
  >(null)
  const [optSkillEditor, setOptSkillEditor] = useState<{
    id?: string
    name: string
    description: string
    content: string
  } | null>(null)

  const handleThemeChange = (next: ThemeName) => {
    setTheme(next)
    applyTheme(next)
  }

  const refresh = useCallback(async () => {
    try {
      const s = await getSettingsApi().get()
      setSettings(s)
      setSearchEnabled(s.search.enabled)
      setSearchProvider(s.search.provider)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载设置失败')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    void (async () => {
      try {
        setOptSkills(await window.app?.optskill?.list())
      } catch {
        setOptSkills([])
      }
    })()
  }, [])

  const handleDelete = async (p: ProviderView) => {
    if (!window.confirm(`确定删除服务商「${PROVIDER_TYPE_LABELS[p.type]} · ${p.model}」吗？`)) return
    try {
      const res = await getSettingsApi().deleteProvider(p.id)
      if (res.success) {
        toast.success('已删除')
        await refresh()
      } else {
        toast.error(res.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      const res = await getSettingsApi().setDefault(id)
      if (res.success) {
        toast.success('已设为默认服务商')
        await refresh()
      } else {
        toast.error(res.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleStageChange = async (stage: Stage, id: string) => {
    try {
      const res = await getSettingsApi().setStageProvider(stage, id === '' ? null : id)
      if (res.success) {
        await refresh()
      } else {
        toast.error(res.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleSaveSearch = async () => {
    setSavingSearch(true)
    try {
      await getSettingsApi().saveSearch({
        enabled: searchEnabled,
        provider: searchProvider,
        apiKey: searchKey.trim() === '' ? undefined : searchKey.trim()
      })
      toast.success('搜索配置已保存')
      setSearchKey('')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingSearch(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl w-full px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> 返回
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
      </div>

      {/* 模型服务商 */}
      <section className="rounded-lg border bg-card p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-primary">模型服务商</h2>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="size-4" /> 添加
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          支持 OpenAI 兼容协议（DeepSeek / Kimi / 智谱 GLM 等）、Anthropic、Gemini 三类
        </p>

        {!settings ? (
          <p className="text-sm text-muted-foreground py-4">加载中…</p>
        ) : settings.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-md border border-dashed p-6 text-center">
            还没有配置服务商。添加一个并填入 API Key 后即可开始使用 Agent。
          </p>
        ) : (
          <ul className="space-y-3">
            {settings.providers.map((p) => {
              const isDefault = settings.defaultProvider === p.id
              return (
                <li
                  key={p.id}
                  className={cn(
                    'rounded-md border p-4 flex items-center gap-4',
                    isDefault ? 'border-primary/60 bg-primary/5' : 'border-border'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{PROVIDER_TYPE_LABELS[p.type]}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{p.model}</code>
                      {isDefault && (
                        <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">默认</span>
                      )}
                      {p.hasApiKey && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <KeyRound className="size-3" /> 密钥已保存
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate font-mono">{p.baseUrl}</p>
                  </div>
                  {!isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="设为默认"
                      onClick={() => handleSetDefault(p.id)}
                    >
                      <Star className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="编辑"
                    onClick={() => {
                      setEditing(p)
                      setDialogOpen(true)
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="删除"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(p)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 每阶段模型 */}
      <section className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-base font-semibold text-primary mb-1">每阶段模型</h2>
        <p className="text-sm text-muted-foreground mb-4">
          可为不同阶段指定不同服务商——建模用强模型、写作用便宜模型；不指定则使用默认
        </p>
        {!settings || settings.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">先添加一个模型服务商</p>
        ) : (
          <div className="space-y-3">
            {(Object.keys(STAGE_LABELS) as Stage[]).map((stage) => (
              <div key={stage} className="flex items-center justify-between gap-4">
                <Label htmlFor={`stage-${stage}`} className="text-sm">
                  {STAGE_LABELS[stage]}
                </Label>
                <select
                  id={`stage-${stage}`}
                  className={selectClass}
                  value={settings.perStage[stage] ?? ''}
                  onChange={(e) => handleStageChange(stage, e.target.value)}
                >
                  <option value="">跟随默认</option>
                  {settings.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {PROVIDER_TYPE_LABELS[p.type]} · {p.model}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 联网搜索 */}
      <section className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-base font-semibold text-primary mb-1">联网搜索</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Agent 求解时可查询网络资料（默认开启，决策 #4）
        </p>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={searchEnabled}
              onChange={(e) => setSearchEnabled(e.target.checked)}
            />
            启用联网搜索工具
          </label>

          <div className="flex items-center gap-3">
            <Label htmlFor="search-provider" className="text-sm shrink-0">
              搜索服务
            </Label>
            <select
              id="search-provider"
              className={selectClass}
              value={searchProvider}
              onChange={(e) => setSearchProvider(e.target.value as 'tavily' | 'serpapi')}
              disabled={!searchEnabled}
            >
              <option value="tavily">Tavily</option>
              <option value="serpapi">SerpAPI</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="search-key" className="text-sm shrink-0">
              Search API Key
            </Label>
            <Input
              id="search-key"
              type="password"
              autoComplete="off"
              className="flex-1"
              placeholder={settings?.search.hasApiKey ? '已保存（填写新值将覆盖）' : '在搜索服务商官网申请'}
              value={searchKey}
              disabled={!searchEnabled}
              onChange={(e) => setSearchKey(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSaveSearch} disabled={savingSearch || !searchEnabled}>
              <Search className="size-4" /> 保存搜索配置
            </Button>
            {settings?.search.hasApiKey && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3" /> 密钥已保存
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 提示词优化 */}
      <section className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-base font-semibold text-primary mb-1">提示词优化模型</h2>
        <p className="text-sm text-muted-foreground mb-4">
          对话输入框旁的「优化」按钮会把你的随手描述改写成专业详细的提示词。默认跟随当前对话使用的模型；在下面选定一个即切换为固定模式，始终用该模型优化。
        </p>
        <div className="flex items-center gap-3">
          <Label htmlFor="prompt-optimizer" className="text-sm shrink-0">
            优化模型
          </Label>
          <select
            id="prompt-optimizer"
            className={`${selectClass} min-w-[320px]`}
            value={settings?.promptOptimizer.providerId ?? ''}
            onChange={async (e) => {
              const id = e.target.value === '' ? null : e.target.value
              try {
                const res = await getSettingsApi().setPromptOptimizer(id)
                if (res.success) {
                  toast.success(res.message)
                  await refresh()
                } else {
                  toast.error(res.message)
                }
              } catch (err) {
                toast.error(err instanceof Error ? err.message : '操作失败')
              }
            }}
          >
            <option value="">跟随当前对话模型（默认）</option>
            {(settings?.providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                固定：{PROVIDER_TYPE_LABELS[p.type]} · {p.model}
              </option>
            ))}
          </select>
        </div>

        {/* 优化 AI 专属技能（独立于主技能库） */}
        <div className="mt-5 pt-4 border-t">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-medium">优化 AI 专属技能</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                只作用于优化 AI 的指导规则（如项目目录规范、主力 Agent 的技能生态），与主技能库互不相通。启用的技能会注入优化提示词。
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setOptSkillEditor({ name: '', description: '', content: '' })}>
              <Plus className="size-3.5" /> 新建
            </Button>
          </div>
          <div className="space-y-2">
            {(optSkills ?? []).map((s) => (
              <div key={s.id} className="rounded-md border p-2.5 flex items-center gap-2.5 text-xs">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[hsl(var(--primary))] cursor-pointer"
                  checked={s.enabled}
                  onChange={async (e) => {
                    try {
                      const res = await window.app!.optskill.setEnabled(s.id, e.target.checked)
                      if (res.success) {
                        setOptSkills(await window.app!.optskill.list())
                      } else toast.error(res.message)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : '操作失败')
                    }
                  }}
                  aria-label={`启用 ${s.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{s.name}</div>
                  {s.description && <div className="text-muted-foreground mt-0.5 truncate">{s.description}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={async () => {
                    const d = await window.app?.optskill?.get(s.id)
                    if (d) setOptSkillEditor({ id: d.id, name: d.name, description: d.description, content: d.content })
                  }}
                >
                  <Pencil className="size-3" /> 编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-destructive hover:text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`删除专属技能「${s.name}」？`)) return
                    const res = await window.app!.optskill.remove(s.id)
                    if (res.success) {
                      toast.success(res.message)
                      setOptSkills(await window.app!.optskill.list())
                    } else toast.error(res.message)
                  }}
                >
                  <Trash2 className="size-3" /> 删除
                </Button>
              </div>
            ))}
            {optSkills && optSkills.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">还没有专属技能。可新建，例如「路径描述规范」——让优化产出的提示词严格使用英文相对路径。</p>
            )}
          </div>

          {/* 专属技能编辑器 */}
          {optSkillEditor && (
            <div className="mt-3 rounded-md border p-3 space-y-2 bg-muted/20">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="技能名称"
                  value={optSkillEditor.name}
                  onChange={(e) => setOptSkillEditor({ ...optSkillEditor, name: e.target.value })}
                  maxLength={40}
                />
                <Input
                  placeholder="一句话描述"
                  value={optSkillEditor.description}
                  onChange={(e) => setOptSkillEditor({ ...optSkillEditor, description: e.target.value })}
                  maxLength={80}
                />
              </div>
              <textarea
                placeholder="技能正文：给优化 AI 的指导规则（Markdown）"
                value={optSkillEditor.content}
                onChange={(e) => setOptSkillEditor({ ...optSkillEditor, content: e.target.value })}
                className="w-full min-h-[160px] rounded-md border bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setOptSkillEditor(null)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!optSkillEditor.name.trim()) {
                      toast.error('请填写名称')
                      return
                    }
                    try {
                      const res = await window.app!.optskill.save({
                        id: optSkillEditor.id,
                        name: optSkillEditor.name.trim(),
                        description: optSkillEditor.description.trim(),
                        content: optSkillEditor.content
                      })
                      if (res.success) {
                        toast.success(res.message)
                        setOptSkillEditor(null)
                        setOptSkills(await window.app!.optskill.list())
                      } else toast.error(res.message)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : '保存失败')
                    }
                  }}
                >
                  保存
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 外观 */}
      <section className="rounded-lg border bg-card p-6 mb-6">
        <h2 className="text-base font-semibold text-primary mb-1">外观</h2>
        <p className="text-sm text-muted-foreground mb-4">界面配色主题，切换立即生效</p>
        <div className="flex gap-2">
          {(
            [
              { value: 'dark' as ThemeName, label: '深色', hint: '默认 · 适合长时间编码' },
              { value: 'light' as ThemeName, label: '浅色', hint: '明亮环境 / 打印友好' }
            ]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.hint}
              onClick={() => handleThemeChange(opt.value)}
              className={cn(
                'rounded-md border px-4 py-2 text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                theme === opt.value
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {!settings?.safeStorageAvailable && (
        <p className="text-xs text-destructive">
          ⚠️ 当前系统不支持 safeStorage 加密，API Key 无法保存。
        </p>
      )}

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={refresh}
      />
    </div>
  )
}
