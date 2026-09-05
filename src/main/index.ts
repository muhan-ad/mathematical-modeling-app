import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import {
  createProjectBackup,
  deleteBackup,
  getBackupDir,
  getProjectBackupCount,
  listBackups,
  openBackupDir,
  setBackupDir
} from './services/backup-service'
import {
  compileProjectPaper,
  createProject,
  deleteProject,
  deleteProjectFile,
  getProject,
  getProjectDirectory,
  getProjectFileAbsPath,
  importProblemFiles,
  listProjectFiles,
  listProjects,
  readProjectFilePreview,
  renameProjectFile,
  updateProject,
  type CompetitionType,
  type ProjectMeta
} from './services/project-service'
import {
  deleteProvider,
  getSettings,
  openConfigDir,
  resolveProviderById,
  resolveProviderForStage,
  saveProvider,
  saveSearchConfig,
  setDefaultProvider,
  setPromptOptimizerProvider,
  setStageProvider,
  type ProviderType,
  type SettingsView,
  type Stage,
  type ProviderView
} from './services/storage-service'
import { optimizePrompt } from './services/prompt-optimizer'
import {
  resolveAgentApproval,
  sendAgentMessage,
  setAgentPermission,
  stopAgentSession,
  stopAllAgentSessions,
  type EffortLevel,
  type PermissionLevel
} from './services/runner-service'
import {
  deleteSkill,
  getSkill,
  listSkills,
  openSkillsDir,
  saveSkill,
  type SkillDetail,
  type SkillMeta
} from './services/skill-service'
import {
  importPlugin,
  listPlugins,
  openPluginsDir,
  uninstallPlugin,
  type PluginMeta
} from './services/plugin-service'

const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Windows App Maker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Dev or preview: load from local dev server / preview file
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 项目备份 IPC handlers（备份只针对单个项目，不做全局备份）
ipcMain.handle('backup:createProject', async (_evt, projectId: string, backupName: string) => {
  try {
    return await createProjectBackup(projectId, backupName)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      backupName,
      count: 0,
      timestamp: '',
      filePath: '',
      fileSize: 0,
      message: `项目备份发生意外错误：${message}`
    }
  }
})

ipcMain.handle('backup:getCount', (_evt, projectId: string): number => {
  try {
    return getProjectBackupCount(projectId)
  } catch (err) {
    console.error('[backup:getCount] failed:', err)
    return 0
  }
})

ipcMain.handle('backup:list', () => {
  try {
    return listBackups()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[backup:list] failed:', message)
    return []
  }
})

// 备份管理系统 IPC handlers
ipcMain.handle('backup:delete', (_evt, fileName: string): { success: boolean; message: string } => {
  try {
    return deleteBackup(fileName)
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('backup:getDir', (): string => {
  return getBackupDir()
})

ipcMain.handle(
  'backup:setDir',
  (_evt, newDir: string | null): { success: boolean; message: string; path: string } => {
    return setBackupDir(newDir)
  }
)

ipcMain.handle('backup:openDir', async (): Promise<{ success: boolean; message: string }> => {
  return openBackupDir()
})

// 项目管理 IPC handlers
ipcMain.handle(
  'project:create',
  (_evt, input: { name: string; competition: CompetitionType }): ProjectMeta => {
    return createProject(input)
  }
)

ipcMain.handle('project:list', (): ProjectMeta[] => {
  return listProjects()
})

ipcMain.handle('project:get', (_evt, id: string): ProjectMeta | null => {
  return getProject(id)
})

ipcMain.handle(
  'project:update',
  (_evt, id: string, patch: Partial<Pick<ProjectMeta, 'name' | 'competition' | 'stage'>>): ProjectMeta => {
    return updateProject(id, patch)
  }
)

ipcMain.handle('project:delete', (_evt, id: string): { success: boolean; message: string } => {
  void stopAgentSession(id)
  return deleteProject(id)
})

// Agent Runtime IPC handlers（引擎：LangGraph 子进程，事件经 agent:event 广播）
ipcMain.handle(
  'agent:send',
  async (
    _evt,
    input: {
      projectId: string
      text: string
      permission: PermissionLevel
      effort: EffortLevel
      stage?: Stage
      providerId?: string
    }
  ): Promise<{ success: boolean; message: string }> => {
    return sendAgentMessage(
      input,
      (stage, providerId) =>
        (providerId ? resolveProviderById(providerId) : null) ?? resolveProviderForStage(stage ?? 'understanding'),
      (projectId) => getProjectDirectory(projectId)
    )
  }
)

ipcMain.handle(
  'agent:approve',
  async (_evt, projectId: string, requestId: string, approved: boolean) => {
    return resolveAgentApproval(projectId, requestId, approved)
  }
)

ipcMain.handle(
  'agent:setPermission',
  async (_evt, projectId: string, level: PermissionLevel) => {
    return setAgentPermission(projectId, level)
  }
)

ipcMain.handle('agent:stop', async (_evt, projectId: string) => {
  return stopAgentSession(projectId)
})

// 项目文件列表（工作台左侧文件面板）
ipcMain.handle('project:files', (_evt, id: string) => {
  return listProjectFiles(id)
})

// 文件管理：重命名（直接作用于本地磁盘）
ipcMain.handle(
  'project:renameFile',
  (_evt, id: string, oldPath: string, newPath: string): { success: boolean; message: string } => {
    return renameProjectFile(id, oldPath, newPath)
  }
)

// 文件管理：删除（直接作用于本地磁盘）
ipcMain.handle(
  'project:deleteFile',
  (_evt, id: string, relPath: string): { success: boolean; message: string } => {
    return deleteProjectFile(id, relPath)
  }
)

// 文件管理：复制绝对路径到剪贴板
ipcMain.handle(
  'project:copyPath',
  (_evt, id: string, relPath: string): { success: boolean; message: string } => {
    const res = getProjectFileAbsPath(id, relPath)
    if (!res.success || !res.path) return { success: false, message: res.message }
    clipboard.writeText(res.path)
    return { success: true, message: '路径已复制' }
  }
)

// 文件预览（右栏预览面板：图片/PDF dataUrl、md/text 直读）
ipcMain.handle(
  'project:readPreview',
  (_evt, id: string, relPath: string) => {
    return readProjectFilePreview(id, relPath)
  }
)

// 在资源管理器中显示文件（预览面板"不支持类型"的兜底动作）
ipcMain.handle(
  'project:reveal',
  (_evt, id: string, relPath: string): { success: boolean; message: string } => {
    try {
      const abs = getProjectFileAbsPath(id, relPath)
      if (!abs.success || !abs.path) return { success: false, message: abs.message }
      shell.showItemInFolder(abs.path)
      return { success: true, message: '' }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
)

// 题目上传：弹多选文件框 → 复制到 problem/attachments/（md/txt 同步 statement.md）
ipcMain.handle(
  'project:importProblem',
  async (
    _evt,
    id: string
  ): Promise<{ success: boolean; message: string; imported: string[]; statementUpdated: boolean }> => {
    const result = await dialog.showOpenDialog({
      title: '选择题目文件（md/txt 会写入题目原文，其余进 attachments/）',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '题目与附件', extensions: ['md', 'txt', 'markdown', 'pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip', 'xlsx', 'xls', 'csv'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '', imported: [], statementUpdated: false }
    }
    return importProblemFiles(id, result.filePaths)
  }
)

// LaTeX 编译：异步等待编译完成后一次性返回结果
ipcMain.handle(
  'project:compileLatex',
  async (
    _evt,
    id: string
  ): Promise<{ success: boolean; pdfGenerated: boolean; pdfPath: string; logTail: string; message: string }> => {
    return compileProjectPaper(id)
  }
)

// 技能（Skill）管理 IPC
ipcMain.handle('skill:list', (): SkillMeta[] => {
  return listSkills()
})

ipcMain.handle('skill:get', (_evt, id: string): SkillDetail | null => {
  return getSkill(id)
})

ipcMain.handle(
  'skill:save',
  (_evt, input: { id?: string; name: string; description: string; content: string }) => {
    return saveSkill(input)
  }
)

ipcMain.handle('skill:delete', (_evt, id: string): { success: boolean; message: string } => {
  return deleteSkill(id)
})

ipcMain.handle('skill:openDir', async (): Promise<{ success: boolean; message: string }> => {
  return openSkillsDir()
})

// 插件管理 IPC（插件 = 可导入的功能包，MVP 支持 skill-pack 技能包）
ipcMain.handle('plugin:list', (): PluginMeta[] => {
  return listPlugins()
})

ipcMain.handle('plugin:import', async () => {
  return importPlugin()
})

ipcMain.handle('plugin:uninstall', (_evt, id: string): { success: boolean; message: string } => {
  return uninstallPlugin(id)
})

ipcMain.handle('plugin:openDir', async (): Promise<{ success: boolean; message: string }> => {
  return openPluginsDir()
})

// 设置 IPC handlers（API key 永不出主进程：渲染端只见 hasApiKey 布尔值）
ipcMain.handle('settings:get', (): SettingsView => {
  return getSettings()
})

ipcMain.handle(
  'settings:saveProvider',
  (_evt, input: { id?: string; type: ProviderType; baseUrl: string; model: string; apiKey?: string }): ProviderView => {
    return saveProvider(input)
  }
)

ipcMain.handle('settings:deleteProvider', (_evt, id: string): { success: boolean; message: string } => {
  return deleteProvider(id)
})

ipcMain.handle('settings:setDefault', (_evt, id: string): { success: boolean; message: string } => {
  return setDefaultProvider(id)
})

ipcMain.handle(
  'settings:setStageProvider',
  (_evt, stage: Stage, id: string | null): { success: boolean; message: string } => {
    return setStageProvider(stage, id)
  }
)

ipcMain.handle(
  'settings:saveSearch',
  (_evt, input: { enabled: boolean; provider: 'tavily' | 'serpapi'; apiKey?: string }): void => {
    saveSearchConfig(input)
  }
)

ipcMain.handle('settings:openDir', async (): Promise<{ success: boolean; message: string }> => {
  return openConfigDir()
})

// 提示词优化 IPC（默认跟随对话当前模型；设置里可固定专用模型）
ipcMain.handle(
  'prompt:optimize',
  async (
    _evt,
    text: string,
    context?: { providerId?: string; stage?: Stage }
  ): Promise<{ success: boolean; text?: string; message: string }> => {
    return optimizePrompt(text, context ?? {})
  }
)

ipcMain.handle(
  'settings:setPromptOptimizer',
  (_evt, id: string | null): { success: boolean; message: string } => {
    return setPromptOptimizerProvider(id)
  }
)

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void stopAllAgentSessions()
  if (process.platform !== 'darwin') app.quit()
})
