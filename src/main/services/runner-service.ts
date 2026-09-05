/**
 * Agent Runtime 运行器：管理每个项目的 Python agent 子进程。
 *
 * 协议：与 agent/main.py 之间的换行分隔 JSON（见 agent/main.py 模块注释）。
 * 事件转发：所有 agent 事件通过 webContents.send('agent:event', {projectId, ...}) 广播给渲染层。
 * API key：主进程解密后仅在此处传入子进程启动参数，不落盘、不进渲染层。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { BrowserWindow, app, Notification } from 'electron'
import path from 'path'

import type { Stage } from './storage-service'
import { resolveSkillsForAgent } from './skill-service'

export type PermissionLevel = 'readonly' | 'ask' | 'workspace' | 'full'
export type EffortLevel = 'off' | 'low' | 'medium' | 'high'

export interface AgentSendInput {
  projectId: string
  text: string
  permission: PermissionLevel
  effort: EffortLevel
  /** 该项目当前所处阶段（决定用哪个阶段模型，空则用默认 provider） */
  stage?: Stage
  /** 对话里手动选择的模型 provider id（优先于 stage/默认） */
  providerId?: string
}

interface AgentProviderPayload {
  id: string
  type: string
  baseUrl: string
  model: string
  apiKey: string
}

type EventForwarder = (projectId: string, event: { name: string } & Record<string, unknown>) => void

class AgentRunner {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private stdoutBuffer = ''
  private permission: PermissionLevel
  private readonly projectId: string
  /** 创建本会话时用的 provider id，用于检测设置变更后重启会话 */
  readonly providerId: string

  constructor(
    private readonly input: AgentSendInput,
    private readonly provider: AgentProviderPayload,
    private readonly projectDir: string,
    private readonly runtimeDir: string,
    private readonly pythonPath: string,
    private readonly forward: EventForwarder
  ) {
    this.projectId = input.projectId
    this.permission = input.permission
    this.providerId = provider.id
  }

  async start(): Promise<void> {
    // 内置便携 TeX（vendor/texlive）存在时注入 PATH，Agent 的 latex_compile 工具即可使用
    const vendorTexBin = path.join(this.runtimeDir, 'vendor', 'texlive', 'bin', 'windows')
    const childEnv: NodeJS.ProcessEnv =
      existsSync(path.join(vendorTexBin, 'xelatex.exe')) && process.env.PATH !== undefined
        ? { ...process.env, PATH: `${vendorTexBin};${process.env.PATH}` }
        : { ...process.env }
    this.proc = spawn(this.pythonPath, ['-X', 'utf8', '-m', 'agent.main'], {
      cwd: this.runtimeDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv
    })
    this.proc.stdout.setEncoding('utf-8')
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    this.proc.stderr.setEncoding('utf-8')
    this.proc.stderr.on('data', (chunk: string) => {
      // Runtime 的 stderr 只用于诊断，不进协议
      console.log(`[agent:${this.projectId}] stderr:`, chunk.trim())
    })
    this.proc.on('exit', (code) => {
      this.proc = null
      this.rejectAll(new Error(`Agent 进程已退出（code=${code ?? 'signal'}）`))
      this.forward(this.projectId, { name: 'exit', code })
    })
    this.proc.on('error', (err) => {
      this.rejectAll(new Error(`Agent 进程启动失败：${err.message}`))
    })

    await this.request('initialize', {
      projectId: this.projectId,
      projectDir: this.projectDir,
      permission: this.input.permission,
      effort: this.input.effort,
      provider: this.provider,
      // 会话重启后重建上下文：回放最近的对话记录
      history: readRecentHistory(this.projectDir),
      // 技能目录：注入目录清单 + skill_load 工具按需取全文
      skills: resolveSkillsForAgent()
    })

    // ready 事件可能先于 initialize 应答到达，等待一拍确保子进程就绪
    await new Promise((r) => setTimeout(r, 100))
  }

  private onStdout(chunk: string) {
    this.stdoutBuffer += chunk
    let idx: number
    while ((idx = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, idx).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1)
      if (!line) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        console.warn(`[agent:${this.projectId}] 非 JSON 行：`, line.slice(0, 200))
        continue
      }
      if (typeof msg.result === 'object' && msg.result !== null && 'id' in msg) {
        const pending = this.pending.get(Number(msg.id))
        if (pending) {
          this.pending.delete(Number(msg.id))
          pending.resolve(msg.result as Record<string, unknown>)
        }
        continue
      }
      if ('error' in msg && 'id' in msg) {
        const pending = this.pending.get(Number(msg.id))
        if (pending) {
          this.pending.delete(Number(msg.id))
          pending.reject(new Error(String(msg.error)))
        }
        continue
      }
      if (msg.event && typeof msg.event === 'object') {
        const event = msg.event as { name: string } & Record<string, unknown>
        // 把 tool_call / approval_request 事件转给渲染层（附带 projectId 便于路由）
        this.forward(this.projectId, event)
      }
    }
  }

  private rejectAll(err: Error) {
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }

  private request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.proc) return Promise.reject(new Error('Agent 进程未启动'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc!.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`Agent 响应超时：${method}`))
        }
      }, 15_000)
    })
  }

  async send(text: string): Promise<void> {
    // 每条消息前同步最新技能表：用户增删改技能后立即生效，无需重启会话
    await this.request('set_skills', resolveSkillsForAgent()).catch(() => undefined)
    await this.request('message', { text })
  }

  async approve(requestId: string, approved: boolean): Promise<void> {
    await this.request('approval', { requestId, approved })
  }

  async setPermission(level: PermissionLevel): Promise<void> {
    this.permission = level
    await this.request('set_permission', { level })
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return
    const proc = this.proc
    this.proc = null
    try {
      proc.stdin.write(JSON.stringify({ id: this.nextId++, method: 'shutdown', params: {} }) + '\n')
    } catch {
      /* 进程可能已退出 */
    }
    const killer = setTimeout(() => proc.kill(), 3000)
    proc.once('exit', () => clearTimeout(killer))
  }

  isAlive(): boolean {
    return this.proc !== null
  }
}

// ---------- 会话注册表（projectId → runner） ----------

const runners = new Map<string, AgentRunner>()

function resolveRuntimePaths(): { runtimeDir: string; pythonPath: string } {
  // 开发态：runtime 即项目根目录（agent/ 包所在处）；打包后再接 resources 布局
  const runtimeDir = app.isPackaged
    ? path.join(process.resourcesPath!, 'agent')
    : app.getAppPath()
  const bundledPython = process.env.WAM_PYTHON
  const venvPython = path.join(runtimeDir, 'agent', '.venv', 'Scripts', 'python.exe')
  const pythonPath = bundledPython && existsSync(bundledPython)
    ? bundledPython
    : existsSync(venvPython)
      ? venvPython
      : 'python'
  return { runtimeDir, pythonPath }
}

function forwardEvent(projectId: string, event: { name: string } & Record<string, unknown>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agent:event', { projectId, ...event })
    }
  }
  // 任务完成时若用户不在应用内，弹系统通知（不泄露内容，仅提示）
  if (event.name === 'done' && BrowserWindow.getAllWindows().every((w) => !w.isFocused())) {
    try {
      new Notification({
        title: '数模助手',
        body: '您的 AI 已完成一个任务，回来看看结果吧'
      }).show()
    } catch {
      /* 通知失败不影响主流程 */
    }
  }
}

/** 读取项目 conversation.jsonl 的最近记录，供会话重启后重建上下文 */
function readRecentHistory(projectDir: string, maxRecords = 40): { role: string; content: string }[] {
  try {
    const file = path.join(projectDir, 'conversation.jsonl')
    if (!existsSync(file)) return []
    const lines = readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim())
    return lines
      .slice(-maxRecords)
      .map((l) => {
        try {
          const rec = JSON.parse(l) as { role?: string; content?: string }
          if ((rec.role === 'user' || rec.role === 'assistant') && rec.content) {
            return { role: rec.role, content: rec.content }
          }
          return null
        } catch {
          return null
        }
      })
      .filter((r): r is { role: string; content: string } => r !== null)
  } catch {
    return []
  }
}

/**
 * 发送一条用户消息：懒启动子进程（复用既有会话），返回 provider 是否可用。
 */
export async function sendAgentMessage(
  input: AgentSendInput,
  resolveProvider: (stage?: Stage, providerId?: string) => AgentProviderPayload | null,
  getProjectDir: (projectId: string) => string
): Promise<{ success: boolean; message: string }> {
  const provider = resolveProvider(input.stage, input.providerId)
  if (!provider) {
    return { success: false, message: '尚未配置模型服务商，请先到「设置」里添加并设为默认' }
  }

  let runner = runners.get(input.projectId)
  if (runner && !runner.isAlive()) {
    runners.delete(input.projectId)
    runner = undefined
  }
  if (runner && runner.providerId !== provider.id) {
    // 设置里的模型服务商变了：重启会话以加载新配置
    await runner.shutdown()
    runners.delete(input.projectId)
    runner = undefined
  }
  if (!runner) {
    const { runtimeDir, pythonPath } = resolveRuntimePaths()
    runner = new AgentRunner(
      input,
      provider,
      getProjectDir(input.projectId),
      runtimeDir,
      pythonPath,
      forwardEvent
    )
    try {
      await runner.start()
    } catch (err) {
      runners.delete(input.projectId)
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, message: `Agent 启动失败：${msg}` }
    }
    runners.set(input.projectId, runner)
  } else if (input.permission !== undefined) {
    // 权限等级在会话中途可切换
    await runner.setPermission(input.permission).catch(() => undefined)
  }
  await runner.send(input.text)
  return { success: true, message: '' }
}

export async function resolveAgentApproval(
  projectId: string,
  requestId: string,
  approved: boolean
): Promise<{ success: boolean; message: string }> {
  const runner = runners.get(projectId)
  if (!runner) return { success: false, message: '该项目没有运行中的 Agent 会话' }
  await runner.approve(requestId, approved)
  return { success: true, message: '' }
}

export async function setAgentPermission(
  projectId: string,
  level: PermissionLevel
): Promise<{ success: boolean; message: string }> {
  const runner = runners.get(projectId)
  if (!runner) return { success: true, message: '会话未启动，权限将在下次启动时生效' }
  await runner.setPermission(level)
  return { success: true, message: '' }
}

export async function stopAgentSession(projectId: string): Promise<{ success: boolean; message: string }> {
  const runner = runners.get(projectId)
  if (!runner) return { success: true, message: '' }
  await runner.shutdown()
  runners.delete(projectId)
  return { success: true, message: '' }
}

/** 项目被删除时顺带清理会话 */
export async function stopAllAgentSessions(): Promise<void> {
  for (const [, runner] of runners) {
    await runner.shutdown()
  }
  runners.clear()
}
