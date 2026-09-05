import { contextBridge, ipcRenderer } from 'electron'

// Expose a minimal, type-safe API to the renderer
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  // 项目备份 IPC（备份只针对单个项目，不做全局备份）
  backup: {
    /** 针对单个项目创建备份 */
    createProject: (projectId: string, backupName: string) =>
      ipcRenderer.invoke('backup:createProject', projectId, backupName),
    /** 获取某项目当前备份次数 */
    getCount: (projectId: string) => ipcRenderer.invoke('backup:getCount', projectId),
    /** 列出当前备份目录下所有项目备份 */
    list: () => ipcRenderer.invoke('backup:list'),
    /** 删除一条历史备份（传纯文件名） */
    remove: (fileName: string) => ipcRenderer.invoke('backup:delete', fileName),
    /** 获取当前备份目录 */
    getDir: () => ipcRenderer.invoke('backup:getDir'),
    /** 调整备份目录；null 恢复默认 */
    setDir: (newDir: string | null) => ipcRenderer.invoke('backup:setDir', newDir),
    /** 在系统文件管理器中打开备份目录 */
    openDir: () => ipcRenderer.invoke('backup:openDir')
  },
  // 项目管理 IPC
  project: {
    /** 创建项目并初始化目录结构 */
    create: (input: { name: string; competition: string }) =>
      ipcRenderer.invoke('project:create', input),
    /** 列出全部项目（按更新时间倒序） */
    list: () => ipcRenderer.invoke('project:list'),
    /** 获取单个项目元数据 */
    get: (id: string) => ipcRenderer.invoke('project:get', id),
    /** 更新项目（改名/类型/阶段） */
    update: (
      id: string,
      patch: { name?: string; competition?: string; stage?: string }
    ) => ipcRenderer.invoke('project:update', id, patch),
    /** 删除项目 */
    delete: (id: string) => ipcRenderer.invoke('project:delete', id),
    /** 列出项目目录树（文件面板用） */
    files: (id: string) => ipcRenderer.invoke('project:files', id),
    /** 重命名文件/文件夹（同步本地磁盘；标准结构受保护） */
    renameFile: (id: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('project:renameFile', id, oldPath, newPath),
    /** 删除文件/文件夹（同步本地磁盘；标准结构受保护） */
    deleteFile: (id: string, relPath: string) => ipcRenderer.invoke('project:deleteFile', id, relPath),
    /** 复制文件在磁盘上的绝对路径到剪贴板 */
    copyPath: (id: string, relPath: string) => ipcRenderer.invoke('project:copyPath', id, relPath),
    /** 读取文件预览内容（图片/PDF dataUrl、md/text 文本） */
    readPreview: (id: string, relPath: string) =>
      ipcRenderer.invoke('project:readPreview', id, relPath) as Promise<{
        kind: 'image' | 'pdf' | 'md' | 'text' | 'unsupported'
        dataUrl?: string
        text?: string
        name: string
        size: number
        mtime: string
        message?: string
      }>,
    /** 在资源管理器中显示文件 */
    reveal: (id: string, relPath: string) =>
      ipcRenderer.invoke('project:reveal', id, relPath) as Promise<{ success: boolean; message: string }>,
    /** 上传题目：弹多选文件框，复制到 problem/attachments/（md/txt 同步 statement.md） */
    importProblem: (id: string) =>
      ipcRenderer.invoke('project:importProblem', id) as Promise<{
        success: boolean
        message: string
        imported: string[]
        statementUpdated: boolean
      }>,
    /** 编译论文 paper/main.tex（等待完成后返回结果与日志尾部） */
    compileLatex: (id: string) =>
      ipcRenderer.invoke('project:compileLatex', id) as Promise<{
        success: boolean
        pdfGenerated: boolean
        pdfPath: string
        logTail: string
        message: string
      }>
  },
  // Agent Runtime IPC（权限等级 / 推理等级 / 审批都在这条链路上）
  agent: {
    /** 发送一条用户消息（首次会自动拉起 Agent 子进程） */
    send: (input: {
      projectId: string
      text: string
      permission: 'readonly' | 'ask' | 'workspace' | 'full'
      effort: 'off' | 'low' | 'medium' | 'high'
      stage?: string
      providerId?: string
    }) => ipcRenderer.invoke('agent:send', input),
    /** 对审批请求放行/拒绝 */
    approve: (projectId: string, requestId: string, approved: boolean) =>
      ipcRenderer.invoke('agent:approve', projectId, requestId, approved),
    /** 会话中途切换权限等级 */
    setPermission: (
      projectId: string,
      level: 'readonly' | 'ask' | 'workspace' | 'full'
    ) => ipcRenderer.invoke('agent:setPermission', projectId, level),
    /** 终止该项目的 Agent 会话 */
    stop: (projectId: string) => ipcRenderer.invoke('agent:stop', projectId),
    /** 订阅 agent 事件流；返回取消订阅函数 */
    onEvent: (callback: (event: { projectId: string } & Record<string, unknown>) => void) => {
      const handler = (_evt: unknown, payload: { projectId: string } & Record<string, unknown>) =>
        callback(payload)
      ipcRenderer.on('agent:event', handler)
      return () => {
        ipcRenderer.removeListener('agent:event', handler)
      }
    }
  },
  // 技能（Skill）管理 IPC
  skill: {
    /** 技能目录（name + description 清单） */
    list: () => ipcRenderer.invoke('skill:list'),
    /** 取技能全文 */
    get: (id: string) => ipcRenderer.invoke('skill:get', id),
    /** 新增/更新技能 */
    save: (input: { id?: string; name: string; description: string; content: string }) =>
      ipcRenderer.invoke('skill:save', input),
    /** 删除技能 */
    remove: (id: string) => ipcRenderer.invoke('skill:delete', id),
    /** 在资源管理器中打开技能目录 */
    openDir: () => ipcRenderer.invoke('skill:openDir')
  },
  // 提示词优化 IPC（默认跟随对话当前模型；设置里可固定专用模型）
  prompt: {
    /** 把输入框里的指令交给优化模型改写；context 描述对话当前用的模型 */
    optimize: (
      text: string,
      context?: { providerId?: string; stage?: string }
    ) =>
      ipcRenderer.invoke('prompt:optimize', text, context ?? {}) as Promise<{
        success: boolean
        text?: string
        message: string
      }>
  },
  // 插件管理 IPC（导入/列表/卸载；插件技能自动并入技能库）
  plugin: {
    list: () => ipcRenderer.invoke('plugin:list'),
    import: () => ipcRenderer.invoke('plugin:import'),
    uninstall: (id: string) => ipcRenderer.invoke('plugin:uninstall', id),
    openDir: () => ipcRenderer.invoke('plugin:openDir')
  },
  // 设置 IPC（API key 明文/密文均不出主进程，渲染端只见 hasApiKey）
  settings: {
    /** 读取设置视图（无密钥内容） */
    get: () => ipcRenderer.invoke('settings:get'),
    /** 新增/更新 provider；apiKey 为 undefined 表示保留旧值，空字符串表示清除 */
    saveProvider: (input: { id?: string; type: string; baseUrl: string; model: string; apiKey?: string }) =>
      ipcRenderer.invoke('settings:saveProvider', input),
    deleteProvider: (id: string) => ipcRenderer.invoke('settings:deleteProvider', id),
    setDefault: (id: string) => ipcRenderer.invoke('settings:setDefault', id),
    setStageProvider: (stage: string, id: string | null) =>
      ipcRenderer.invoke('settings:setStageProvider', stage, id),
    saveSearch: (input: { enabled: boolean; provider: string; apiKey?: string }) =>
      ipcRenderer.invoke('settings:saveSearch', input),
    /** 在资源管理器中定位模型 API 配置文件（config.json） */
    openDir: () => ipcRenderer.invoke('settings:openDir'),
    /** 设置提示词优化用的 provider（null = 跟随默认模型） */
    setPromptOptimizer: (id: string | null) => ipcRenderer.invoke('settings:setPromptOptimizer', id)
  }
}

export type AppApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('app', api)
  } catch (error) {
    console.error('Failed to expose API:', error)
  }
} else {
  // @ts-ignore (define on window when context isolation disabled)
  window.app = api
}
