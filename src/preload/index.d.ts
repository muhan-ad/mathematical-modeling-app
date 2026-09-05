// Preload API 类型从 ./index.ts 推导，供 renderer 通过 import 引用

export type ProjectMeta = {
  id: string
  name: string
  competition: 'cumcm' | 'mcm' | 'huashu' | 'other'
  createdAt: string
  updatedAt: string
  stage: string
}

export type AppApi = {
  platform: string
  versions: {
    electron: string
    chrome: string
    node: string
  }
  backup: {
    createProject: (projectId: string, backupName: string) => Promise<{
      success: boolean
      backupName: string
      count: number
      timestamp: string
      filePath: string
      fileSize: number
      message: string
    }>
    getCount: (projectId: string) => Promise<number>
    list: () => Promise<
      {
        name: string
        size: number
        createdAt: string
        backupName: string | null
        projectName: string | null
        projectId: string | null
        count: number | null
      }[]
    >
    remove: (fileName: string) => Promise<{ success: boolean; message: string }>
    getDir: () => Promise<string>
    setDir: (newDir: string | null) => Promise<{ success: boolean; message: string; path: string }>
    openDir: () => Promise<{ success: boolean; message: string }>
  }
  project: {
    create: (input: { name: string; competition: string }) => Promise<ProjectMeta>
    list: () => Promise<ProjectMeta[]>
    get: (id: string) => Promise<ProjectMeta | null>
    update: (
      id: string,
      patch: { name?: string; competition?: string; stage?: string }
    ) => Promise<ProjectMeta>
    delete: (id: string) => Promise<{ success: boolean; message: string }>
    files: (id: string) => Promise<{ path: string; type: 'file' | 'dir'; size: number }[]>
    renameFile: (
      id: string,
      oldPath: string,
      newPath: string
    ) => Promise<{ success: boolean; message: string }>
    deleteFile: (id: string, relPath: string) => Promise<{ success: boolean; message: string }>
    copyPath: (id: string, relPath: string) => Promise<{ success: boolean; message: string }>
    readPreview: (id: string, relPath: string) => Promise<{
      kind: 'image' | 'pdf' | 'md' | 'text' | 'unsupported'
      dataUrl?: string
      text?: string
      name: string
      size: number
      mtime: string
      message?: string
    }>
    reveal: (id: string, relPath: string) => Promise<{ success: boolean; message: string }>
    importProblem: (id: string) => Promise<{
      success: boolean
      message: string
      imported: string[]
      statementUpdated: boolean
    }>
    compileLatex: (id: string) => Promise<{
      success: boolean
      pdfGenerated: boolean
      pdfPath: string
      logTail: string
      message: string
    }>
  }
  agent: {
    send: (input: {
      projectId: string
      text: string
      permission: 'readonly' | 'ask' | 'workspace' | 'full'
      effort: 'off' | 'low' | 'medium' | 'high'
      stage?: string
      providerId?: string
    }) => Promise<{ success: boolean; message: string }>
    approve: (
      projectId: string,
      requestId: string,
      approved: boolean
    ) => Promise<{ success: boolean; message: string }>
    setPermission: (
      projectId: string,
      level: 'readonly' | 'ask' | 'workspace' | 'full'
    ) => Promise<{ success: boolean; message: string }>
    stop: (projectId: string) => Promise<{ success: boolean; message: string }>
    onEvent: (
      callback: (event: { projectId: string } & Record<string, unknown>) => void
    ) => () => void
  }
  skill: {
    list: () => Promise<{ id: string; name: string; description: string; updatedAt: string }[]>
    get: (id: string) => Promise<{
      id: string
      name: string
      description: string
      content: string
      updatedAt: string
    } | null>
    save: (input: {
      id?: string
      name: string
      description: string
      content: string
    }) => Promise<{ success: boolean; id?: string; message: string }>
    remove: (id: string) => Promise<{ success: boolean; message: string }>
    openDir: () => Promise<{ success: boolean; message: string }>
  }
  prompt: {
    optimize: (
      text: string,
      context?: { providerId?: string; stage?: string }
    ) => Promise<{ success: boolean; text?: string; message: string }>
  }
  plugin: {
    list: () => Promise<{
      id: string
      name: string
      version: string
      description: string
      type: string
      skills: string[]
      installedAt: string
    }[]>
    import: () => Promise<{ success: boolean; message: string }>
    uninstall: (id: string) => Promise<{ success: boolean; message: string }>
    openDir: () => Promise<{ success: boolean; message: string }>
  }
  settings: {
    get: () => Promise<{
      providers: {
        id: string
        type: 'openai_compat' | 'anthropic' | 'gemini'
        baseUrl: string
        model: string
        hasApiKey: boolean
        createdAt: string
        updatedAt: string
      }[]
      defaultProvider: string | null
      perStage: Partial<Record<string, string>>
      search: { enabled: boolean; provider: 'tavily' | 'serpapi'; hasApiKey: boolean }
      promptOptimizer: { providerId: string | null }
      safeStorageAvailable: boolean
    }>
    saveProvider: (input: {
      id?: string
      type: string
      baseUrl: string
      model: string
      apiKey?: string
    }) => Promise<{ id: string }>
    deleteProvider: (id: string) => Promise<{ success: boolean; message: string }>
    setDefault: (id: string) => Promise<{ success: boolean; message: string }>
    setStageProvider: (stage: string, id: string | null) => Promise<{ success: boolean; message: string }>
    saveSearch: (input: { enabled: boolean; provider: string; apiKey?: string }) => Promise<void>
    openDir: () => Promise<{ success: boolean; message: string }>
    setPromptOptimizer: (id: string | null) => Promise<{ success: boolean; message: string }>
  }
}
