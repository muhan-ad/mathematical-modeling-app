import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUpToLine,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Send,
  Shield,
  Square,
  Wand2,
  Wrench,
  X
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Markdown } from '@/components/agent/Markdown'
import { cn } from '@/lib/utils'

export type PermissionLevel = 'readonly' | 'ask' | 'workspace' | 'full'
export type EffortLevel = 'off' | 'low' | 'medium' | 'high'

export const PERMISSION_OPTIONS: { value: PermissionLevel; label: string; hint: string }[] = [
  { value: 'readonly', label: '只读', hint: 'Agent 只能读取文件，不能写入或执行' },
  { value: 'ask', label: '逐次审批', hint: '每次写入/执行前都会弹窗征求你的同意' },
  { value: 'workspace', label: '项目内自动', hint: '项目目录内的文件操作自动放行，执行代码仍需审批' },
  { value: 'full', label: '全自动', hint: '全部自动放行（仅限项目目录内）' }
]

export const EFFORT_OPTIONS: { value: EffortLevel; label: string; hint?: string }[] = [
  { value: 'off', label: '关闭', hint: '直接回答，不进行扩展思考' },
  { value: 'low', label: '低', hint: '轻量思考，速度快' },
  { value: 'medium', label: '中', hint: '平衡速度与推理质量' },
  { value: 'high', label: '高', hint: '深度思考，适合复杂建模' }
]

/** 下拉选择按钮（向上弹出菜单，仿 ZCode 控制行样式） */
function DropdownSelect({
  label,
  current,
  options,
  onChange
}: {
  label: string
  current: string
  options: { value: string; label: string; hint?: string }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const currentLabel = options.find((o) => o.value === current)?.label ?? current
  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 h-8 rounded-md border px-2.5 text-xs transition-colors min-w-0 w-full',
          open ? 'border-primary/50 bg-muted/60' : 'bg-background hover:bg-muted/50'
        )}
      >
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="font-medium truncate min-w-0 flex-1 text-left">{currentLabel}</span>
        <ChevronDown className={cn('size-3.5 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[220px] rounded-md border bg-popover py-1 shadow-lg">
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium flex items-center gap-2">
                    {o.label}
                    {current === o.value && <Check className="size-3.5 text-primary" />}
                  </div>
                  {o.hint && <div className="text-[11px] text-muted-foreground mt-0.5">{o.hint}</div>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool?: string
  args?: Record<string, unknown>
  /** 工具卡状态：running 执行中（转圈）/ waiting 等审批 / done 出结果 */
  state?: 'running' | 'waiting' | 'done'
  streaming?: boolean
  ok?: boolean
}

/** Agent 运行状态（状态栏展示用） */
type AgentStatus =
  | { state: 'idle' }
  | { state: 'thinking' }
  | { state: 'responding' }
  | { state: 'tool'; tool: string }
  | { state: 'waiting-approval' }

interface ApprovalState {
  requestId: string
  tool: string
  args: Record<string, unknown>
}

interface ProviderOption {
  id: string
  model: string
  baseUrl: string
}

interface AgentChatPanelProps {
  projectId: string
  /** 有事件（如一轮结束）时通知父组件刷新文件树 */
  onActivity?: () => void
}

let msgSeq = 0
const nextMsgId = () => `m${++msgSeq}-${Date.now()}`

const HISTORY_KEY = (id: string) => `wam-chat-${id}`
/** UI 历史最多保留条数（localStorage 防爆） */
const MAX_PERSISTED = 120

function loadHistory(projectId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    return Array.isArray(parsed)
      ? parsed
          .slice(-MAX_PERSISTED)
          .map((m) => ({
            ...m,
            streaming: false,
            // 旧版历史里的工具卡没有 state 字段，统一视为已完成
            state: m.role === 'tool' ? (m.state ?? 'done') : m.state
          }))
      : []
  } catch {
    return []
  }
}

function saveHistory(projectId: string, messages: ChatMessage[]) {
  try {
    const trimmed = messages.slice(-MAX_PERSISTED).map((m) => {
      const { streaming: _s, ...rest } = m
      // 未完成的工具卡在持久化后不可能再有结果，标记为中断，避免重载后永远"正在执行"
      if (rest.role === 'tool' && rest.state && rest.state !== 'done') {
        return { ...rest, state: 'done' as const, ok: false, content: '[会话中断，未取得结果]' }
      }
      return rest
    })
    localStorage.setItem(HISTORY_KEY(projectId), JSON.stringify(trimmed))
  } catch {
    /* 存储满时静默放弃 */
  }
}

/** 工具卡片的参数摘要（一行） */
function toolSummary(tool: string, args?: Record<string, unknown>): string {
  if (!args) return ''
  if (typeof args.path === 'string') return args.path
  if (typeof args.entry === 'string') return args.entry
  if (typeof args.name === 'string') return args.name
  if (typeof args.code === 'string') {
    const firstLine = args.code.split('\n').find((l) => l.trim())
    return firstLine ? firstLine.trim().slice(0, 60) : 'python 脚本'
  }
  return ''
}

/**
 * 工作台 Agent 聊天面板：
 * - 流式渲染回复 + 实时状态栏（思考中/回复中/执行工具）
 * - 消息排队：Agent 忙碌时输入不再被禁用，进入队列自动依次发送，支持插队
 * - 打断：随时终止当前执行（会话进程会被重启，上下文自动重建）
 * - 历史持久化：界面重挂载/应用重启后聊天记录保留，Agent 上下文自动重建
 */
export function AgentChatPanel({ projectId, onActivity }: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(projectId))
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [approval, setApproval] = useState<ApprovalState | null>(null)
  const [status, setStatus] = useState<AgentStatus>({ state: 'idle' })
  const [queue, setQueue] = useState<string[]>([])
  const [permission, setPermission] = useState<PermissionLevel>(
    () => (localStorage.getItem('wam-agent-permission') as PermissionLevel) || 'ask'
  )
  const [effort, setEffort] = useState<EffortLevel>(
    () => (localStorage.getItem('wam-agent-effort') as EffortLevel) || 'off'
  )
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [providerId, setProviderId] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(false)
  const queueRef = useRef<string[]>([])
  queueRef.current = queue

  // 输入框高度自适应：初始 96px，内容超过时自动扩展（上限 400px 后内部滚动）
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 96), 400)}px`
  }, [input])

  useEffect(() => {
    saveHistory(projectId, messages)
  }, [messages, projectId])

  // 拉取模型服务商列表（对话内手动选模型用；空 = 跟随设置里的阶段/默认配置）
  useEffect(() => {
    void (async () => {
      try {
        const s = await window.app?.settings?.get()
        setProviders(
          (s?.providers ?? []).map((p: { id: string; model: string; baseUrl: string }) => ({
            id: p.id,
            model: p.model,
            baseUrl: p.baseUrl
          }))
        )
      } catch {
        setProviders([])
      }
    })()
  }, [])

  const appendMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    const id = nextMsgId()
    setMessages((prev) => [...prev, { ...msg, id }])
    return id
  }, [])

  const updateLastStreaming = useCallback((updater: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].streaming) {
          const next = [...prev]
          next[i] = updater(prev[i])
          return next
        }
      }
      return prev
    })
  }, [])

  // done 之后的收尾 + 队列调度
  const finishTurn = useCallback(
    (finalText: string, ok: boolean) => {
      busyRef.current = false
      setSending(false)
      setStatus({ state: 'idle' })
      updateLastStreaming((m) => ({ ...m, content: m.content || finalText, streaming: false, ok }))
      onActivity?.()
      // 队列里有排队的消息 → 依次发送
      const [next, ...rest] = queueRef.current
      if (next !== undefined) {
        setQueue(rest)
        setTimeout(() => void dispatchSendRef.current?.(next), 150)
      }
    },
    [onActivity, updateLastStreaming]
  )

  const dispatchSendRef = useRef<(text: string) => Promise<void>>(async () => {})

  // 事件订阅（挂载一次，按 projectId 过滤）
  useEffect(() => {
    const api = window.app?.agent
    if (!api) return
    const unsubscribe = api.onEvent((event) => {
      if (event.projectId !== projectId) return
      const name = event.name as string
      if (name === 'message_start') {
        setStatus({ state: 'responding' })
        appendMessage({ role: 'assistant', content: '', streaming: true })
      } else if (name === 'message_delta') {
        const delta = String(event.delta ?? '')
        if (delta) setStatus((s) => (s.state === 'tool' ? s : { state: 'responding' }))
        updateLastStreaming((m) => ({ ...m, content: m.content + delta }))
      } else if (name === 'tool_call') {
        const auto = Boolean(event.auto)
        const toolName = String(event.tool ?? '')
        if (!auto) setStatus({ state: 'waiting-approval' })
        else setStatus({ state: 'tool', tool: toolName })
        // 实时工具卡：出现即带加载图标，出结果后原地更新
        appendMessage({
          role: 'tool',
          tool: toolName,
          args: (event.args as Record<string, unknown>) ?? {},
          content: auto ? '执行中…' : '等待审批…',
          state: auto ? 'running' : 'waiting'
        })
      } else if (name === 'tool_result') {
        const output = String(event.output ?? '')
        const denied = output.startsWith('[权限拦截]')
        const toolName = String(event.tool ?? '')
        setStatus({ state: 'thinking' })
        setMessages((prev) => {
          const next = [...prev]
          // 找同工具最近一张未完成的卡，原地填充结果
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === 'tool' && (!toolName || m.tool === toolName) && m.state !== 'done') {
              next[i] = {
                ...m,
                content: output,
                state: 'done',
                ok: !denied
              }
              return next
            }
          }
          next.push({
            id: nextMsgId(),
            role: 'tool',
            tool: toolName,
            content: output,
            state: 'done',
            ok: !denied
          })
          return next
        })
      } else if (name === 'approval_request') {
        setStatus({ state: 'waiting-approval' })
        setApproval({
          requestId: String(event.requestId ?? ''),
          tool: String(event.tool ?? ''),
          args: (event.args as Record<string, unknown>) ?? {}
        })
      } else if (name === 'done') {
        finishTurn(String(event.text ?? ''), event.ok !== false)
        // 技能调用统计：明确展示本轮用了哪些技能，便于验证是否命中有效技能
        const skillsUsed = Array.isArray(event.skillsUsed) ? (event.skillsUsed as string[]) : []
        appendMessage({
          role: 'system',
          content: skillsUsed.length
            ? `⚡ 本轮调用技能：${skillsUsed.join('、')}`
            : '本轮未调用技能'
        })
        if (event.ok !== false) {
          toast.success('此轮任务已完成', { description: '结果已在对话中更新' })
        }
      } else if (name === 'error') {
        updateLastStreaming((m) => ({ ...m, streaming: false }))
        appendMessage({ role: 'system', content: String(event.message ?? '未知错误'), ok: false })
      } else if (name === 'exit') {
        busyRef.current = false
        setSending(false)
        setStatus({ state: 'idle' })
        updateLastStreaming((m) => ({ ...m, streaming: false }))
        appendMessage({ role: 'system', content: 'Agent 会话已结束（进程退出），下次发送将重建上下文' })
      }
    })
    return unsubscribe
  }, [projectId, appendMessage, updateLastStreaming, finishTurn])

  const dispatchSend = useCallback(
    async (text: string) => {
      const api = window.app?.agent
      if (!api) {
        toast.error('Agent 不可用', { description: '请在桌面应用内使用（浏览器预览无 Agent 运行时）' })
        return
      }
      busyRef.current = true
      setSending(true)
      setStatus({ state: 'thinking' })
      appendMessage({ role: 'user', content: text })
      try {
        const result = await api.send({ projectId, text, permission, effort, providerId: providerId || undefined })
        if (!result.success) {
          toast.error('发送失败', { description: result.message })
          appendMessage({ role: 'system', content: result.message, ok: false })
          busyRef.current = false
          setSending(false)
          setStatus({ state: 'idle' })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error('发送失败', { description: msg })
        appendMessage({ role: 'system', content: `发送失败：${msg}`, ok: false })
        busyRef.current = false
        setSending(false)
        setStatus({ state: 'idle' })
      }
    },
    [projectId, permission, effort, providerId, appendMessage]
  )
  dispatchSendRef.current = dispatchSend

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setInput('')
    if (busyRef.current || sending) {
      // Agent 忙碌：进入队列（仿 DSH 排队）
      setQueue((q) => [...q, text])
      toast.info('已加入队列', { description: 'Agent 完成当前任务后自动发送；也可点 ↑ 插队' })
      return
    }
    void dispatchSend(text)
  }, [input, sending, dispatchSend])

  const jumpQueue = useCallback((index: number) => {
    setQueue((q) => {
      if (index < 0 || index >= q.length) return q
      const [item] = q.splice(index, 1)
      return [item, ...q]
    })
  }, [])

  const removeQueued = useCallback((index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index))
  }, [])

  const handleInterrupt = useCallback(async () => {
    try {
      await window.app?.agent?.stop(projectId)
      busyRef.current = false
      setSending(false)
      setStatus({ state: 'idle' })
      updateLastStreaming((m) => ({ ...m, streaming: false }))
      appendMessage({ role: 'system', content: '已打断当前执行（上下文将在下次发送时重建）' })
    } catch (err) {
      toast.error('打断失败', { description: err instanceof Error ? err.message : String(err) })
    }
  }, [projectId, appendMessage, updateLastStreaming])

  // 进入页面/切换项目时直接定位到最新消息（底部）
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    })
    return () => cancelAnimationFrame(id)
  }, [projectId])

  // 消息更新时自动滚到底（仅当用户本来就贴近底部时，避免打断回看）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTo({ top: el.scrollHeight })
  }, [messages, queue])

  const handleApprove = useCallback(
    async (approved: boolean) => {
      const current = approval
      setApproval(null)
      if (!current) return
      if (approved) {
        // 对应工具卡：等待审批 → 执行中（转圈），结果由 tool_result 事件回填
        setMessages((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === 'tool' && m.tool === current.tool && m.state === 'waiting') {
              next[i] = { ...m, state: 'running', content: '执行中…' }
              break
            }
          }
          return next
        })
      }
      try {
        await window.app?.agent?.approve(projectId, current.requestId, approved)
      } catch (err) {
        toast.error('审批操作失败', { description: err instanceof Error ? err.message : String(err) })
      }
    },
    [approval, projectId]
  )

  const changePermission = useCallback(
    async (level: PermissionLevel) => {
      setPermission(level)
      localStorage.setItem('wam-agent-permission', level)
      try {
        await window.app?.agent?.setPermission(projectId, level)
      } catch {
        /* 会话未启动时由下次 send 带上 */
      }
    },
    [projectId]
  )

  const changeEffort = useCallback((level: EffortLevel) => {
    setEffort(level)
    localStorage.setItem('wam-agent-effort', level)
  }, [])

  // 提示词优化：交给独立配置的优化模型改写，成功后直接替换输入框内容
  const handleOptimize = useCallback(async () => {
    const text = input.trim()
    if (!text) {
      toast.error('请先在输入框里写下你的指令')
      return
    }
    if (optimizing) return
    setOptimizing(true)
    try {
      // 默认跟随当前对话使用的模型；设置里固定了优化模型时由主进程优先采用
      const result = await window.app?.prompt?.optimize(text, {
        providerId: providerId || undefined
      })
      if (result?.success && result.text) {
        setInput(result.text)
        toast.success('提示词已优化', { description: '已替换输入框内容，可继续修改后发送' })
      } else {
        toast.error('优化失败', { description: result?.message })
      }
    } catch (err) {
      toast.error('优化失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setOptimizing(false)
    }
  }, [input, optimizing])

  const permissionHint = useMemo(
    () => PERMISSION_OPTIONS.find((o) => o.value === permission)?.hint ?? '',
    [permission]
  )

  const statusView = useMemo(() => {
    switch (status.state) {
      case 'thinking':
        return { icon: <Loader2 className="size-3 animate-spin" />, text: '模型思考中…', tone: 'text-primary' }
      case 'responding':
        return { icon: <Loader2 className="size-3 animate-spin" />, text: '正在回复…', tone: 'text-primary' }
      case 'tool':
        return {
          icon: <Wrench className="size-3" />,
          text: `正在执行：${status.tool}`,
          tone: 'text-warning'
        }
      case 'waiting-approval':
        return { icon: <Shield className="size-3" />, text: '等待你的审批…', tone: 'text-warning' }
      default:
        return { icon: <CheckCircle2 className="size-3" />, text: '空闲', tone: 'text-muted-foreground' }
    }
  }, [status])

  const busy = status.state !== 'idle'

  return (
    <section className="flex flex-col min-h-0 min-w-0 border-x">
      {/* 消息流（独立滚动区） */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-sm leading-6">
              和 Agent 说说这轮想做什么：例如「读一下题目，拆解问题」「对第二问建一个回归模型」。
              <br />
              工具调用会按下方权限等级受控执行，产出的代码 / 数据 / 图表见左侧支撑材料。
            </p>
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
      </div>

      {/* 队列区（仿 DSH：Agent 忙碌时发送的消息排队，可插队/删除） */}
      {queue.length > 0 && (
        <div className="shrink-0 border-t bg-muted/20 px-3 py-2 space-y-1">
          {queue.map((q, i) => (
            <div key={`${i}-${q.slice(0, 12)}`} className="flex items-center gap-2 text-xs">
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground shrink-0">
                {i === 0 ? '下一个' : `#${i + 1}`}
              </span>
              <span className="truncate flex-1">{q}</span>
              {i > 0 && (
                <button
                  className="text-muted-foreground hover:text-primary shrink-0"
                  title="插队到最前"
                  onClick={() => jumpQueue(i)}
                >
                  <ArrowUpToLine className="size-3.5" />
                </button>
              )}
              <button
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="移除"
                onClick={() => removeQueued(i)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 状态栏 */}
      <div className="h-7 shrink-0 border-t flex items-center gap-2 px-3 text-[11px]">
        <span className={cn('flex items-center gap-1.5', statusView.tone)}>
          {statusView.icon}
          {statusView.text}
        </span>
        {queue.length > 0 && (
          <span className="text-muted-foreground">· 队列 {queue.length} 条（Enter 继续追加）</span>
        )}
      </div>

      {/* 输入区（仿 ZCode：高输入框 + 底部控制行） */}
      <div className="shrink-0 border-t p-3 space-y-2">
        <textarea
          value={input}
          placeholder={busy ? 'Agent 工作中…现在输入会进入队列' : '输入指令，Enter 发送 / Shift+Enter 换行'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSend()
            }
          }}
          ref={inputRef}
          rows={1}
          className={cn(
            'w-full resize-none overflow-y-auto rounded-md border bg-transparent px-3 py-2.5 text-sm leading-6 h-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60 transition-colors',
            optimizing && 'text-muted-foreground/50 animate-pulse border-primary/40'
          )}
        />

        {/* 控制行：模型 / 权限 / 推理深度（下拉菜单，按容器宽度等比伸缩）+ 优化/发送（成组靠右）
            三个下拉各占 20% 宽（最小 80px），窗口变窄时同步收缩不越界 */}
        <div className="flex items-center gap-2 text-xs flex-nowrap min-w-0">
          <div className="min-w-[80px] max-w-[180px]" style={{ width: '20%' }}>
            <DropdownSelect
              label="模型"
              current={providerId}
              options={[
                { value: '', label: '跟随设置', hint: '使用设置页里的阶段/默认模型' },
                ...providers.map((p) => ({ value: p.id, label: p.model }))
              ]}
              onChange={(v) => setProviderId(v)}
            />
          </div>

          <div className="min-w-[80px] max-w-[180px]" style={{ width: '20%' }}>
            <DropdownSelect
              label="权限"
              current={permission}
              options={PERMISSION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) => void changePermission(v as PermissionLevel)}
            />
          </div>

          <div className="min-w-[80px] max-w-[180px]" style={{ width: '20%' }}>
            <DropdownSelect
              label="深度"
              current={effort}
              options={EFFORT_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
              onChange={(v) => changeEffort(v as EffortLevel)}
            />
          </div>

          {/* 优化 + 发送 成组紧靠右侧 */}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <Button
              className="h-8"
              variant="outline"
              title="优化提示词：用独立配置的模型把指令改写成专业详细的版本"
              aria-label="优化提示词"
              disabled={optimizing || !input.trim()}
              onClick={() => void handleOptimize()}
            >
              {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              优化
            </Button>

            <Button
              className="h-8 min-w-[76px]"
              title={busy ? '打断当前执行' : '发送（Enter）'}
              aria-label={busy ? '打断当前执行' : '发送'}
              onClick={() => {
                if (busy) {
                  void handleInterrupt()
                } else {
                  handleSend()
                }
              }}
              disabled={!busy && !input.trim()}
            >
              {busy ? (
                <>
                  <Square className="size-3 fill-current" />
                  打断
                </>
              ) : sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  发送中
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  发送
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 审批弹窗 */}
      <Dialog open={!!approval} onOpenChange={(v) => !v && void handleApprove(false)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-warning" />
              Agent 请求执行操作
            </DialogTitle>
            <DialogDescription>
              当前权限为「逐次审批」，该操作需要你的确认后才会执行。
            </DialogDescription>
          </DialogHeader>
          {approval && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <Wrench className="size-4 text-primary" />
                工具：{approval.tool}
              </div>
              <pre className="text-xs bg-muted/60 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                {JSON.stringify(approval.args, null, 2)}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleApprove(false)}>
              <X className="size-4" /> 拒绝
            </Button>
            <Button onClick={() => void handleApprove(true)}>
              <CheckCircle2 className="size-4" /> 允许执行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    )
  }
  if (message.role === 'tool') {
    const summary = toolSummary(message.tool ?? '', message.args)
    const running = message.state === 'running'
    const waiting = message.state === 'waiting'
    const failed = message.state === 'done' && message.ok === false
    return (
      <div className="text-xs leading-6">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
          ) : waiting ? (
            <Shield className="size-3.5 animate-pulse text-warning shrink-0" />
          ) : failed ? (
            <AlertCircle className="size-3.5 text-destructive shrink-0" />
          ) : (
            <CheckCircle2 className="size-3.5 text-success shrink-0" />
          )}
          <span className={cn('shrink-0', failed ? 'text-destructive' : 'text-muted-foreground')}>
            {running ? '正在执行' : waiting ? '等待审批' : failed ? '被拦截' : '执行完成'}
          </span>
          <span className="text-muted-foreground/70 shrink-0">·</span>
          <span className="font-medium text-foreground shrink-0">{message.tool}</span>
          {summary && (
            <span className="text-muted-foreground truncate font-mono" title={summary}>
              {summary}
            </span>
          )}
        </div>
        {message.content && message.state === 'done' && (
          <pre className="mt-1 ml-5.5 pl-4 border-l border-border whitespace-pre-wrap break-all max-h-44 overflow-auto text-muted-foreground font-mono">
            {message.content}
          </pre>
        )}
      </div>
    )
  }
  if (message.role === 'system') {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 justify-center py-1">
        {message.ok === false && <AlertCircle className="size-3.5 text-destructive" />}
        {message.content}
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <Bot className="size-5 shrink-0 mt-1 text-primary" />
      <div className="min-w-0 flex-1">
        <Markdown content={message.content || (message.streaming ? '' : '（空回复）')} />
        {message.streaming && <Loader2 className="inline size-3.5 ml-1 animate-spin text-muted-foreground" />}
      </div>
    </div>
  )
}
