/** 项目元数据（与 src/main/services/project-service.ts 的 ProjectMeta 保持一致） */
export type ProjectMeta = {
  id: string
  name: string
  competition: 'cumcm' | 'mcm' | 'huashu' | 'other'
  createdAt: string
  updatedAt: string
  stage: string
}

export type CompetitionType = ProjectMeta['competition']

/** 竞赛类型 → 展示名 */
export const COMPETITION_LABELS: Record<CompetitionType, string> = {
  cumcm: '国赛 CUMCM',
  mcm: '美赛 MCM/ICM',
  huashu: '华数杯',
  other: '其他竞赛'
}

export const COMPETITION_OPTIONS = (Object.keys(COMPETITION_LABELS) as CompetitionType[]).map(
  (value) => ({ value, label: COMPETITION_LABELS[value] })
)

/** 阶段 → 展示名（Phase 2 状态机启用前的静态映射） */
export const STAGE_LABELS: Record<string, string> = {
  understanding: '题目理解',
  modeling: '建模',
  solving: '求解',
  writing: '论文写作',
  review: '校对编译'
}

/**
 * Electron 外（浏览器/Playwright）使用的 fallback：项目 API 不可用，
 * list 返回空、写操作全部 reject，由调用方 catch 后 toast 提示
 */
const fallbackProjectApi = {
  create: async () => {
    throw new Error('项目功能仅在桌面应用中可用')
  },
  list: async () => [] as ProjectMeta[],
  get: async () => null,
  update: async () => {
    throw new Error('项目功能仅在桌面应用中可用')
  },
  delete: async () => {
    throw new Error('项目功能仅在桌面应用中可用')
  }
}

export function getProjectApi() {
  return (
    window.app?.project ?? {
      create: fallbackProjectApi.create,
      list: fallbackProjectApi.list,
      get: fallbackProjectApi.get,
      update: fallbackProjectApi.update,
      delete: fallbackProjectApi.delete
    }
  )
}

/** ISO 时间 → 本地短格式 "2026-09-05 18:30" */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
