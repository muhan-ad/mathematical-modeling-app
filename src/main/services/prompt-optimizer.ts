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
import { resolveEnabledOptimizerSkillText } from './optimizer-skill-service'

const OPTIMIZER_SYSTEM = `你是提示词优化专家，专门为数学建模竞赛辅助 Agent 优化用户指令。

把用户输入的随意描述改写成一条专业、详细、结构化的提示词，要求：
1. 忠实保留用户的原始意图和目标，不新增用户没提的需求；
2. 补全上下文：明确任务背景、输入（文件/数据路径）、期望输出形式与保存位置；
3. 明确执行步骤与验收标准（如：先读题目 → 建模 → 写代码求解 → 结果存到 workspace/）；
4. 语言简练、指令清晰、用简体中文。

只输出改写后的提示词正文，不要任何解释、前言或代码块包裹。`

/** 主力 Agent 的固定事实：写入优化系统提示词，让产出的指令天然贴合应用规范 */
const AGENT_FACTS = `以下是执行该提示词的 Agent 的固定背景（优化时必须符合这些规范）：
- 项目目录结构（英文命名）：problem/（题目 statement.md 与 attachments/ 附件）、
  workspace/（code 求解代码、data 数据结果、outputs 运行输出、figures 生成图表、notes 过程笔记）、
  paper/（main.tex、sections/ 章节、figures/ 论文图片）
- 可用工具：file_read（支持 PDF 文本抽取）、file_create/file_write/file_delete/file_list、
  python_exec（环境已装 numpy/scipy/pandas/matplotlib/sympy/networkx/SciencePlots）、
  latex_compile（xelatex 编译 paper/main.tex）、skill_load（按需加载技能）
- 硬性规则：新建文件一律英文命名；数值结论必须来自真实代码执行；图片先存 workspace/figures/ 再复制到 paper/figures/
- Agent 带有可加载的技能库（读题拆解、获奖级做题流程、图表选型等），提示词可在合适环节要求 Agent 加载对应技能`

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
    // 启用的专属技能（设置页管理）注入优化提示词，让产出贴合用户自己的工作流
    const skillText = resolveEnabledOptimizerSkillText()
    const system = skillText ? `${OPTIMIZER_SYSTEM}\n\n${AGENT_FACTS}\n\n${skillText}` : `${OPTIMIZER_SYSTEM}\n\n${AGENT_FACTS}`
    const optimized = await completeOnce(provider, system, trimmed)
    return { success: true, text: optimized, message: '' }
  } catch (err) {
    return {
      success: false,
      message: `优化失败：${err instanceof Error ? err.message : String(err)}`
    }
  }
}
