import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Loader2 } from 'lucide-react'

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
import {
  PROVIDER_QUICK_PRESETS,
  PROVIDER_TYPE_HINTS,
  PROVIDER_TYPE_LABELS,
  PROVIDER_TYPE_PRESETS,
  getSettingsApi,
  type ProviderType,
  type ProviderView
} from '@/lib/settings'

interface ProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑时传入已有 provider；新增传 null */
  editing: ProviderView | null
  onSaved: () => void
}

export function ProviderDialog({ open, onOpenChange, editing, onSaved }: ProviderDialogProps) {
  const [type, setType] = useState<ProviderType>('openai_compat')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setType(editing.type)
      setBaseUrl(editing.baseUrl)
      setModel(editing.model)
      setApiKey('')
    } else {
      const preset = PROVIDER_TYPE_PRESETS['openai_compat']
      setType('openai_compat')
      setBaseUrl(preset.baseUrl)
      setModel(preset.model)
      setApiKey('')
    }
  }, [open, editing])

  const handleTypeChange = (next: ProviderType) => {
    setType(next)
    const preset = PROVIDER_TYPE_PRESETS[next]
    // 仅在字段为空或等于另一预设时切换预填，避免覆盖用户自定义值
    const knownValues = Object.values(PROVIDER_TYPE_PRESETS).flatMap((p) => [p.baseUrl, p.model])
    if (!baseUrl || knownValues.includes(baseUrl)) setBaseUrl(preset.baseUrl)
    if (!model || knownValues.includes(model)) setModel(preset.model)
  }

  /** 快选预设：直接填入 baseUrl + model */
  const handleQuickPreset = (preset: (typeof PROVIDER_QUICK_PRESETS)[number]) => {
    setType(preset.type)
    setBaseUrl(preset.baseUrl)
    setModel(preset.model)
  }

  const quickPresets = PROVIDER_QUICK_PRESETS.filter((p) => p.type === type)

  const handleSave = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      toast.error('Base URL 和模型 ID 不能为空')
      return
    }
    if (!editing && !apiKey.trim()) {
      toast.error('请输入 API Key')
      return
    }
    setSaving(true)
    try {
      await getSettingsApi().saveProvider({
        id: editing?.id,
        type,
        baseUrl,
        model,
        // 编辑时留空 = 保留原 key
        apiKey: apiKey.trim() === '' && editing ? undefined : apiKey.trim()
      })
      toast.success(editing ? 'Provider 已更新' : 'Provider 已添加')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑模型服务商' : '添加模型服务商'}</DialogTitle>
          <DialogDescription>
            API Key 通过系统级加密（DPAPI）存储，明文不会离开主进程
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>协议类型</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PROVIDER_TYPE_LABELS) as ProviderType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  title={PROVIDER_TYPE_HINTS[t]}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    type === t
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {PROVIDER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{PROVIDER_TYPE_HINTS[type]}</p>
          </div>

          {quickPresets.length > 0 && (
            <div className="space-y-2">
              <Label>常用预设</Label>
              <div className="flex flex-wrap gap-2">
                {quickPresets.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handleQuickPreset(p)}
                    className={cn(
                      'rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground',
                      'transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary'
                    )}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="provider-base-url">Base URL</Label>
            <Input
              id="provider-base-url"
              value={baseUrl}
              placeholder="https://api.example.com"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-model">模型 ID</Label>
            <Input
              id="provider-model"
              value={model}
              placeholder="例如 deepseek-chat"
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-api-key">API Key</Label>
            <Input
              id="provider-api-key"
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder={editing?.hasApiKey ? '已保存（留空保留原值）' : 'sk-...'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            title="在资源管理器中定位 config.json（模型 API 配置）"
            onClick={async () => {
              try {
                const res = await getSettingsApi().openDir()
                if (!res.success) toast.error(res.message)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : '打开失败')
              }
            }}
          >
            <FolderOpen className="size-4" /> 打开配置文件夹
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
