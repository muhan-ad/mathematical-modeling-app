import { useState } from 'react'
import { Toaster } from 'sonner'
import { Settings, Plug, Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { BackupButton } from '@/components/backup/BackupButton'
import { BackupManagerDialog } from '@/components/backup/BackupManagerDialog'
import { SkillManagerDialog } from '@/components/skill/SkillManagerDialog'
import { PluginManagerDialog } from '@/components/plugin/PluginManagerDialog'
import { ProjectListPage } from '@/pages/ProjectListPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { SettingsPage } from '@/pages/SettingsPage'
import type { ProjectMeta } from '@/lib/projects'

export default function App() {
  const [backupOpen, setBackupOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [pluginsOpen, setPluginsOpen] = useState(false)
  /** 当前视图：项目列表 / 项目工作台 / 设置 */
  const [view, setView] = useState<'projects' | 'workspace' | 'settings'>('projects')
  const [activeProject, setActiveProject] = useState<ProjectMeta | null>(null)

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* 顶部全局栏：备份按钮任何页面可达（要求 #1） */}
      <header className="h-14 border-b flex items-center justify-between px-4 shrink-0 bg-card/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold">Mathematical Modeling App</span>
          {view === 'workspace' && activeProject && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setView('projects')}
            >
              {activeProject.name}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <BackupButton onClick={() => setBackupOpen(true)} />
          <Button
            variant="ghost"
            size="sm"
            aria-label="技能库"
            title="技能库：沉淀给 Agent 的解题方法论"
            onClick={() => setSkillsOpen(true)}
          >
            <Zap className="size-4" /> 技能
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="插件管理"
            title="插件管理：导入功能包（技能包等）"
            onClick={() => setPluginsOpen(true)}
          >
            <Plug className="size-4" /> 插件
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="设置"
            title="设置"
            onClick={() => setView('settings')}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {view === 'settings' ? (
        <main className="flex-1 overflow-y-auto min-h-0">
          <SettingsPage onBack={() => setView('projects')} />
        </main>
      ) : view === 'workspace' && activeProject ? (
        <WorkspacePage project={activeProject} onBack={() => setView('projects')} />
      ) : (
        <main className="flex-1 overflow-y-auto min-h-0">
          <ProjectListPage
            onOpenProject={(p) => {
              setActiveProject(p)
              setView('workspace')
            }}
            onOpenSettings={() => setView('settings')}
            onOpenSkills={() => setSkillsOpen(true)}
            onOpenBackup={() => setBackupOpen(true)}
          />
        </main>
      )}

      {/* 备份管理面板 */}
      <BackupManagerDialog open={backupOpen} onOpenChange={setBackupOpen} />

      {/* 技能库管理 */}
      <SkillManagerDialog open={skillsOpen} onOpenChange={setSkillsOpen} />

      {/* 插件管理 */}
      <PluginManagerDialog open={pluginsOpen} onOpenChange={setPluginsOpen} />

      {/* Toast 容器（要求 #6, #8 反馈） */}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          style: { fontFamily: 'inherit' }
        }}
      />
    </div>
  )
}
