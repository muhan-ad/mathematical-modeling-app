/**
 * 提示词优化：把用户的随意描述改写成专业、详细、结构化的提示词。
 * 使用独立配置的模型（settings 里「提示词优化模型」，缺省回退默认模型），
 * 一次性调用，不经过 Agent 子进程。
 */

import { completeOnce } from './llm-client'
import {
  resolveProviderById,
  resolveProviderForStage,
  resolvePromptOptimizer,
  type Stage
} from './storage-service'

const OPTIMIZER_SYSTEM = `你是提示词优化专家，专门为数学建模竞赛辅助 Agent 优化用户指令。

把用户输入的随意描述改写成一条专业、详细、结构化的提示词，要求：
1. 忠实保留用户的原始意图和目标，不新增用户没提的需求；
2. 补全上下文：明确任务背景、输入（文件/数据路径）、期望输出形式与保存位置；
3. 明确执行步骤与验收标准（如：先读题目 → 建模 → 写代码求解 → 结果存到 workspace/）；
4. 语言简练、指令清晰、用简体中文。

只输出改写后的提示词正文，不要任何解释、前言或代码块包裹。`

export interface PromptOptimizeContext {
  /** 对话当前手动选择的 provider id（「跟随设置」时为空） */
  providerId?: string
  /** 对话所处阶段（用于解析当前实际生效的模型） */
  stage?: Stage
}

export async function optimizePrompt(
  text: string,
  context: PromptOptimizeContext = {}
): Promise<{ success: boolean; text?: string; message: string }> {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, message: '请先在输入框里写下你的指令再优化' }
  }
  if (trimmed.length > 4000) {
    return { success: false, message: '指令过长（上限 4000 字符），请先精简' }
  }
  // 解析顺序：设置里固定指定的优化模型 > 对话当前使用的模型 > 阶段/默认模型
  const provider =
    (resolvePromptOptimizer() ?? null) ??
    (context.providerId ? resolveProviderById(context.providerId) : null) ??
    resolveProviderForStage(context.stage ?? 'understanding')
  if (!provider) {
    return { success: false, message: '尚未配置模型服务商，请先到「设置」里添加' }
  }
  try {
    const optimized = await completeOnce(provider, OPTIMIZER_SYSTEM, trimmed)
    return { success: true, text: optimized, message: '' }
  } catch (err) {
    return {
      success: false,
      message: `优化失败：${err instanceof Error ? err.message : String(err)}`
    }
  }
}
