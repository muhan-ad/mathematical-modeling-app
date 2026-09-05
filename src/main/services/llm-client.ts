/**
 * 主进程内的一次性 LLM 调用（非流式）。
 * 供「提示词优化」这类轻量功能使用，不经过 Agent 子进程。
 * API key 仅在主进程内使用，不出进程边界。
 */

export interface OnceProvider {
  type: string
  baseUrl: string
  model: string
  apiKey: string
}

const TIMEOUT_MS = 60_000

/** 把三类服务商的差异收敛成一个 completeOnce 调用 */
export async function completeOnce(
  provider: OnceProvider,
  system: string,
  userText: string
): Promise<string> {
  if (provider.type === 'anthropic') {
    return completeAnthropic(provider, system, userText)
  }
  if (provider.type === 'gemini') {
    return completeGemini(provider, system, userText)
  }
  return completeOpenAICompat(provider, system, userText)
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`)
    }
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

// ---------- OpenAI 兼容（DeepSeek / GPT / Kimi / GLM / MiMo 等） ----------

async function completeOpenAICompat(provider: OnceProvider, system: string, userText: string): Promise<string> {
  const base = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const data = (await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText }
      ]
    })
  })) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('模型返回为空')
  return content.trim()
}

// ---------- Anthropic Claude ----------

async function completeAnthropic(provider: OnceProvider, system: string, userText: string): Promise<string> {
  const base = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  const data = (await fetchJson(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userText }]
    })
  })) as { content?: { type: string; text?: string }[] }
  const text = data.content
    ?.filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (!text) throw new Error('模型返回为空')
  return text.trim()
}

// ---------- Google Gemini ----------

interface GeminiPart {
  text?: string
}

async function completeGemini(provider: OnceProvider, system: string, userText: string): Promise<string> {
  const model = provider.model || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(provider.apiKey)}`
  const data = (await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 2000 }
    })
  })) as { candidates?: { content?: { parts?: GeminiPart[] } }[] }
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
  if (!text) throw new Error('模型返回为空')
  return text.trim()
}
