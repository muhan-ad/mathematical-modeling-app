"""ReAct 图构建：LangGraph create_react_agent + 项目上下文 + 技能目录系统提示词。"""

from __future__ import annotations

from langgraph.prebuilt import create_react_agent

from .tools import build_tools

SYSTEM_TEMPLATE = """你是「数模助手」，一个数学建模竞赛辅助 Agent，运行在 Mathematical Modeling App 工作台内。

当前项目目录：{project_dir}
目录结构约定（职责固定，不要改动目录含义）：
- problem/            题目：statement.md 题目原文；attachments/ 原始附件
- workspace/          支撑材料（AI 产出的过程与结果）
  - code/             求解代码，命名 qX_说明.py（如 q1_regression.py）
  - data/             AI 得出的数据结果（清洗后的数据、中间表），命名 qX_说明.csv/json
  - outputs/          程序文本输出（控制台结果、日志）
  - figures/          生成的图表，命名 fig_qX_序号.png（如 fig_q1_1.png）
  - notes/            过程笔记与解题路线
- paper/              论文：main.tex 主文件；sections/ 各章节 tex；figures/ 论文引用的图片

硬性规则：
1. 你新建的一切文件（代码、数据、图片、笔记、tex）一律只用英文命名，禁止中文文件名——
   LaTeX 与部分工具链对中文路径不兼容；图片保存到 workspace/figures/ 后再复制到 paper/figures/ 供论文引用；
2. 严禁编造：任何数值结论必须来自实际执行的代码输出；算不出、报错、数据不足时如实说明，
   绝不假装成功或凭记忆填补「文献值」；
3. 做题优先加载「获奖级做题流程」技能，按九阶段推进；
4. 先读 problem/ 下的题目，理解要求，再动手；
5. 建模与求解时优先编写 Python 脚本并用 python_exec 执行，图表务必保存为文件存到 workspace/figures/；
6. 写论文时编辑 paper/ 下的 .tex 文件，可用 latex_compile 验证编译；
7. 所有文件操作仅限项目目录内，路径一律用项目内相对路径；
8. 用简体中文向用户汇报，结论要具体（数值、图表路径、文件路径）。
{skills_section}"""

SKILLS_SECTION_TEMPLATE = """
可用技能（skills）：当任务匹配某个技能的主题时，先调用 skill_load 工具加载该技能的完整操作指令，再按指令执行。
{skill_list}
"""


def build_agent(
    provider: dict,
    effort: str,
    project_dir: str,
    gate,
    skills: list[dict] | None = None,
    on_skill_use=None,
) -> object:
    model = _build_model(provider, effort)
    tools = build_tools(project_dir, gate)
    if skills:
        from .tools import build_skill_tool

        lines = "\n".join(
            f"- {s.get('name', '')}：{s.get('description', '')}" for s in skills
        )
        tools = tools + [build_skill_tool(skills, on_use=on_skill_use)]
        skills_section = SKILLS_SECTION_TEMPLATE.format(skill_list=lines)
    else:
        skills_section = ""
    prompt = SYSTEM_TEMPLATE.format(project_dir=project_dir, skills_section=skills_section)
    return create_react_agent(model, tools, prompt=prompt)


def _build_model(provider: dict, effort: str):
    from .llm import build_model

    return build_model(provider, effort)
