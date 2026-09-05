import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, PackageOpen, Plug, Trash2 } from 'lucide-react'
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

interface PluginMeta {
  id: string
  name: string
  version: string
  description: string
  type: string
  skills: string[]
  installedAt: string
}

interface PluginManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 插件管理：插件 = 符合规范的功能包文件夹（MVP 支持 skill-pack 技能包）。
 * 导入后其携带的技能自动并入技能库（只读），Agent 下一条消息即可使用。
 */
export function PluginManagerDialog({ open, onOpenChange }: PluginManagerDialogProps) {
  const [plugins, setPlugins] = useState<PluginMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setPlugins((await window.app?.plugin?.list()) ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const handleImport = useCallback(async () => {
    setImporting(true)
    try {
      const res = await window.app?.plugin?.import()
      if (res?.success) {
        toast.success(res.message, { description: '其携带的技能已并入技能库' })
        await refresh()
      } else if (res?.message) {
        toast.error('导入失败', { description: res.message })
      }
    } finally {
      setImporting(false)
    }
  }, [refresh])

  const handleUninstall = useCallback(
    async (plugin: PluginMeta) => {
      if (!window.confirm(`确定卸载插件「${plugin.name}」？其携带的技能将一并移除。`)) return
      const res = await window.app?.plugin?.uninstall(plugin.id)
      if (res?.success) {
        toast.success(res.message)
        await refresh()
      } else {
        toast.error('卸载失败', { description: res?.message })
      }
    },
    [refresh]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] flex flex-col max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="size-5 text-primary" />
            插件管理
          </DialogTitle>
          <DialogDescription>
            插件是可导入的功能包（当前支持技能包）。插件文件夹名必须为纯英文/数字，
            内含 plugin.json 或 skills/ 目录；导入后携带的技能自动并入技能库。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto -mx-1 px-1">
          {loading && <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>}
          {!loading && plugins.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <PackageOpen className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-sm leading-6">
                还没有安装插件。把符合规范的插件文件夹准备好（文件夹名纯英文），
                点「导入插件」选择该文件夹即可。
              </p>
            </div>
          )}
          <div className="space-y-2">
            {plugins.map((p) => (
              <div key={p.id} className="rounded-md border p-3 flex items-start gap-3">
                <Plug className="size-4 mt-0.5 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {p.name}
                    <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                      v{p.version}
                    </span>
                    <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                      {p.type}
                    </span>
                  </div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 break-words">{p.description}</div>
                  )}
                  <div className="text-[11px] text-muted-foreground/70 mt-1">
                    ID：{p.id}
                    {p.skills.length > 0 && ` · 携带技能：${p.skills.join('、')}`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => void handleUninstall(p)}
                  aria-label="卸载"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" className="mr-auto" onClick={() => void window.app?.plugin?.openDir()}>
            <FolderOpen className="size-4" /> 打开插件目录
          </Button>
          <Button onClick={() => void handleImport()} disabled={importing}>
            <PackageOpen className="size-4" />
            {importing ? '导入中…' : '导入插件'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
