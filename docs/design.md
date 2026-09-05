# 数模解题 Agent 桌面应用 — 方案设计

> 版本：v0.1（初稿，待决策点确认后细化）
> 日期：2026-09-05

## 1. 产品定位

**目标用户**：参加数学建模竞赛的大学生（国赛 CUMCM / 美赛 MCM/ICM / 校赛省赛）。

**核心价值**：让 LLM Agent 全流程辅助数模比赛——从读题、建模、求解到生成可提交的 LaTeX PDF 论文。Agent 不是替代人类思考，而是作为"协作队友"加速每个阶段，让人聚焦于决策与审查。

**与通用 LLM 对话的区别**：
- 工具增强（执行 Python/MATLAB 求解、绘制图表、编译 LaTeX）
- 长程项目状态（不丢失上下文，跨阶段引用）
- 产物落盘（每一步的代码、图、章节都进项目目录）
- 多 Agent 分工（每个阶段专职 Agent，比单 prompt 更稳）

## 2. 用户场景

### 2.1 比赛工作流

```
比赛开始
   ↓
[1] 创建项目 → 粘贴/上传题目 PDF + 数据附件
   ↓
[2] 题目理解 Agent → 拆解问题、识别题型、制定计划
   ↓
[3] 建模 Agent → 提出模型方案（用户可干预/修改）
   ↓
[4] 求解 Agent → 写 Python/MATLAB 代码、运行、迭代
   ↓                    （失败回传，自动 debug）
[5] 论文写作 Agent → 生成 LaTeX 章节（含公式、图、表）
   ↓
[6] 校对编译 Agent → 检查引用、公式、逻辑 → 编译 PDF
   ↓
[7] 用户预览 PDF → 反馈 → 任意阶段回滚重做
   ↓
比赛结束提交
```

### 2.2 关键交互模式

- **对话式**：用户随时与 Agent 对话（建议/质疑/纠错）
- **审批门**：每个阶段产出后，用户必须 approve 才进入下一阶段（可关闭门控快速跑）
- **手动接管**：用户可直接编辑项目目录里任何文件（代码/tex），Agent 在下次执行时读取最新版

## 3. 前置依赖（已就绪）

| 依赖 | 现状 | 说明 |
|------|------|------|
| Electron 31 + Vite + React + TS + Tailwind + shadcn | ✓ 已搭 | 桌面应用基座 |
| MiKTeX（pdflatex/xelatex/latexmk） | ✓ `E:\miktex\miktex\bin\x64\` | LaTeX 编译 |
| Python 3.13.14 | ✓ | 求解与数据处理 |
| numpy/pandas/scipy/matplotlib/sympy/sklearn/statsmodels/networkx | ✓ 全装 | 数模工具链 |
| MATLAB | ✓ `D:\app\bin\matlab.exe` | 备用求解器（部分赛题必需） |
| Node.js 22 + pnpm 11 | ✓ | 主进程运行时 |

**结论**：环境齐备，无需装 Docker/虚拟环境，可直接本地跑全流程。

## 4. 系统架构

### 4.1 进程模型

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (Electron window)                 │
│  React + shadcn/ui                                  │
│  - 项目列表 / 向导 / 对话 / 论文预览 / 文件浏览      │
└───────────────┬─────────────────────────────────────┘
                │ IPC (preload contextBridge)
┌───────────────┴─────────────────────────────────────┐
│  Main Process (Node.js)                              │
│  - 项目管理（CRUD、目录结构初始化）                  │
│  - 配置存储（safeStorage 加密 API key）              │
│  - 子进程调度（Python / MATLAB / latexmk）          │
│  - 文件监听（chokidar）                              │
│  - LaTeX 编译流水线                                  │
└───────────────┬─────────────────────────────────────┘
                │ stdio / JSON-RPC over stdin-stdout
┌───────────────┴─────────────────────────────────────┐
│  Agent Runtime (独立子进程，Python)                  │
│  - LangGraph 状态机                                 │
│  - 多 Agent 节点（理解/建模/求解/写作/校对）         │
│  - 工具调用（execute_python / search / file_io）     │
│  - Skill 加载器（Markdown 定义 + 动态加载）          │
│  - LLM 客户端（多 provider 适配层）                 │
└─────────────────────────────────────────────────────┘
```

### 4.2 为什么 Agent Runtime 用 Python 而不是 Node.js

- 数模工具链生态几乎全在 Python（numpy/pandas/scipy/sympy/statsmodels）
- LangGraph / LlamaIndex 等 Agent 框架 Python 版本更成熟
- Python 子进程内可直接 `import` 工具，避免跨语言序列化
- Electron 主进程只做"协调与 IO"，重逻辑放 Python，职责清晰

**通信**：Agent Runtime 作为子进程启动，stdin/stdout 走 JSON-RPC。流式 token 通过 stdout 逐行推送，主进程转发给 renderer。

### 4.3 模块分层

```
src/
├── main/                     # Electron 主进程
│   ├── index.ts              # 入口
│   ├── ipc/                  # 各 IPC handler
│   ├── project/              # 项目管理
│   ├── runner/               # Agent runtime 子进程管理
│   ├── latex/               # LaTeX 编译流水线
│   ├── storage/             # 配置与加密
│   └── tools/              # 子进程工具调用封装
├── preload/                  # 安全桥接
└── renderer/                 # UI
    └── src/
        ├── pages/            # 项目列表、向导、工作台、预览
        ├── components/       # shadcn 组件 + 自定义
        ├── stores/           # Zustand 状态
        └── lib/             # 工具函数

agent/                        # Python Agent Runtime（独立目录）
├── runtime/
│   ├── graph.py              # LangGraph 状态机定义
│   ├── agents/               # 各 Agent 节点
│   │   ├── understanding.py  # 题目理解
│   │   ├── modeling.py       # 建模
│   │   ├── solving.py        # 求解
│   │   ├── writing.py        # 写作
│   │   └── reviewing.py      # 校对
│   ├── tools/                # 工具实现
│   │   ├── python_exec.py
│   │   ├── matlab_exec.py
│   │   ├── plot.py
│   │   ├── file_io.py
│   │   └── latex_compile.py
│   ├── skills/               # Skill 定义（Markdown）
│   │   ├── data-analysis.md
│   │   ├── optimization.md
│   │   ├── statistics.md
│   │   ├── latex-writing.md
│   │   └── reference.md
│   ├── llm/                  # 多 provider 适配
│   │   ├── base.py
│   │   ├── openai_compat.py  # OpenAI/DeepSeek/Kimi/智谱/通义
│   │   ├── anthropic.py      # Claude
│   │   └── gemini.py
│   └── server.py             # JSON-RPC 入口
```

## 5. Agent 编排方案

采用 **LangGraph 多阶段状态机**，每个阶段一个 Agent 节点，状态在节点间显式传递。

### 5.1 状态对象

```python
class ProjectState(TypedDict):
    project_id: str
    problem: dict              # 题目原文 + 解析结构
    plan: list[Stage]          # 计划的阶段列表
    current_stage: str        # understanding/modeling/...
    model_draft: str          # 当前模型方案（含假设、公式、变量）
    code_artifacts: list[File]# 生成的代码与运行结果
    figures: list[File]       # 图表
    paper_sections: dict[str, str]  # section_id -> LaTeX 内容
    review_issues: list[Issue]
    messages: list[Message]   # 跨阶段对话历史（按 token 预算压缩）
    user_feedback: list[str]  # 用户审批意见
```

### 5.2 各 Agent 职责

| Agent | 输入 | 产出 | 工具 |
|-------|------|------|------|
| **理解** | 题目原文 + 附件 | `problem` 结构化拆解、`plan` 阶段计划 | file_io（读 PDF/Excel）、search |
| **建模** | `problem` | `model_draft`（假设、变量、公式、求解策略） | 无（纯推理） |
| **求解** | `model_draft` + `problem` | `code_artifacts` + `figures` | python_exec、matlab_exec、plot |
| **写作** | 全部上游产物 | `paper_sections`（按节 LaTeX） | latex_compile（试编译单节） |
| **校对** | `paper_sections` | `review_issues` + 修订建议 | latex_compile（全文编译） |

### 5.3 流转与门控

- 默认每阶段结束**暂停等用户 approve**（可设"自动跑全流程"开关）
- 失败回退：求解 Agent 报错 → 回到建模 Agent 带错误反馈重试（最多 3 次）
- 用户随时可注入反馈：写入 `user_feedback`，当前 Agent 下一轮读取

### 5.4 上下文管理

数模项目信息量大，单 prompt 装不下：
- **分层总结**：每阶段结束生成 200 字摘要入 `messages`，原始对话归档到磁盘
- **RAG 检索**：长附件（PDF/数据字典）切片向量化（ChromaDB 本地），Agent 按需检索
- **代码产物路径化**：代码不进 prompt，只传路径 + 输出摘要

## 6. 项目目录结构

每个项目独立目录，便于备份/迁移：

```
<userData>/mathmodel-projects/<project_id>/
├── meta.json                 # 项目元数据（名称、创建时间、赛题类型）
├── problem/
│   ├── statement.md          # 题目原文（用户粘贴或 OCR）
│   ├── attachments/          # 原始附件（PDF/Excel/图片）
│   └── parsed.json          # Agent 解析后的结构化题目
├── workspace/
│   ├── code/                 # Agent 生成的 .py / .m
│   ├── outputs/              # 运行输出（csv/txt/log）
│   ├── figures/              # 图表 png/pdf
│   └── notes/                # 中间推理 Markdown
├── paper/
│   ├── main.tex              # 主文件
│   ├── sections/
│   │   ├── abstract.tex
│   │   ├── introduction.tex
│   │   ├── model.tex
│   │   ├── solution.tex
│   │   ├── results.tex
│   │   └── conclusion.tex
│   ├── figures/              # 软链接到 workspace/figures
│   ├── references.bib
│   └── main.pdf              # 编译产物
├── state.json                # LangGraph 状态快照
└── conversation.jsonl        # 完整对话历史（追加写）
```

## 7. 模型接入层

### 7.1 Provider 适配

设计 provider-agnostic 的 `LLMClient`，统一接口 `chat(messages, tools) -> stream[chunk]`：

| Provider | 协议 | 覆盖模型 |
|----------|------|----------|
| `openai_compat` | OpenAI Chat Completions | OpenAI、DeepSeek、Kimi、智谱 GLM、通义千问、Moonshot、本地 vLLM/Ollama |
| `anthropic` | Anthropic Messages | Claude 3.5/3.7/4 系列 |
| `gemini` | Google Generative Language | Gemini 1.5/2 系列 |

用户在设置页填 `base_url` + `api_key` + `model_id`，配置示例：
```json
{
  "providers": {
    "deepseek": { "base_url": "https://api.deepseek.com", "api_key": "...", "model": "deepseek-chat" },
    "claude":   { "base_url": "https://api.anthropic.com", "api_key": "...", "model": "claude-sonnet-4-5" }
  },
  "default": "deepseek",
  "per_stage": {
    "modeling": "claude",      # 推理强的用于建模
    "writing":  "deepseek"     # 便宜的用于写作
  }
}
```

支持**每阶段指定不同模型**——成本与质量平衡（建模用强模型，写作用便宜模型）。

### 7.2 安全存储

- API key 用 Electron `safeStorage`（Windows DPAPI 加密）落盘
- 主进程内存持有解密 key，renderer 永远拿不到明文
- API 调用全部在主进程或 Agent Runtime 子进程发起，renderer 只看流式 chunk

## 8. 工具与 Skill 清单

### 8.1 工具（Agent 可调用）

| 工具 | 作用 | 实现 |
|------|------|------|
| `execute_python` | 跑 .py 脚本，返回 stdout/stderr/文件产物 | subprocess + venv 隔离 |
| `execute_matlab` | 跑 .m 脚本 | matlab -batch |
| `read_file` / `write_file` | 项目目录内 IO | 限制在项目根 |
| `parse_attachment` | PDF/Excel/Word 转文本/表格 | pdfplumber / openpyxl / python-docx |
| `make_plot` | 生成图表 | matplotlib + 自动套用数模配色 |
| `latex_compile` | 编译 .tex → PDF | latexmk -xelatex |
| `web_search` | 检索参考文献/算法 | 可选（接 SerpAPI/Tavily） |
| `query_vector_db` | 检索长附件 | ChromaDB 本地 |

### 8.2 Skill（Anthropic-style Markdown 定义）

每个 Skill 是一份 Markdown 指南，定义"在什么场景下、按什么流程、产出什么"。Agent 加载后按指南执行：

- `data-analysis.md` — 数据清洗、EDA、异常检测标准流程
- `optimization.md` — LP/MILP/非线性规划建模模板（scipy.optimize / pulp）
- `statistics.md` — 假设检验、回归、时间序列
- `simulation.md` — 蒙特卡洛、离散事件仿真
- `graph-network.md` — 图论模型（networkx）
- `latex-writing.md` — 数模论文写作规范（结构、公式、引用、图表标号）
- `reference.md` — 参考文献管理（BibTeX）

Skill 是纯文本，用户可自己编辑/添加，无需改代码。

## 9. LaTeX 编译流水线

### 9.1 模板系统

内置官方模板：
- **CUMCM**（国赛）— 国赛标准模板（含封口、承诺书）
- **MCM/ICM**（美赛）— 美赛 MS Word/LaTeX 模板
- **通用** — 简洁模板

模板放在 `app/templates/<template_id>/`，创建项目时复制到 `paper/` 目录。

### 9.2 编译策略

- **单节试编译**：写作 Agent 每写完一节，调用 `latex_compile` 在沙盒小文件上试编译，捕获缺失宏包/语法错误立即修
- **全文编译**：校对阶段 latexmk 全文编译，错误回传 Agent
- **中文支持**：用 `xelatex` + `ctex` 宏包（MiKTeX 已支持）
- **安全**：`latexmk -xelatex -interaction=nonstopmode -halt-on-error --no-shell-escape`，禁止 `\write18` 任意命令

### 9.3 错误恢复

编译失败 → 解析 `.log` 提取错误行 → 注入 Agent 上下文 → Agent 修源文件 → 重试（最多 5 次）。

## 10. 安全与权限

| 风险 | 缓解 |
|------|------|
| API key 泄露 | safeStorage 加密 + 主进程独占访问 |
| Agent 写危险文件 | 工具层强制限制工作目录在项目根，路径校验拒绝 `..` 跳出 |
| LaTeX 任意命令 | `--no-shell-escape` 全局开启 |
| Python 子进程越权 | 项目级 venv，禁用网络（除非用户开启 search 工具） |
| 长输出爆显存 | stdout 截断 + 文件产物路径化 |
| API 滥用 | 每项目 token 预算配置，超限提示用户 |

## 11. UI 与交互

### 11.1 主要页面

- **项目列表**（首页）：卡片式展示已有项目，新建按钮
- **创建向导**：填名称 → 选赛题类型 → 选模板 → 上传题目/附件 → 选模型 provider
- **工作台**（核心）：三栏布局
  - 左：文件树（项目目录）
  - 中：对话流（与 Agent 交互）+ 阶段进度条
  - 右：当前产物预览（代码/图/PDF）
- **设置**：模型 provider 配置、Skill 编辑、模板管理
- **PDF 预览**：内嵌 PDF.js 或调用系统查看器

### 11.2 关键交互细节

- **阶段进度条**：5 个阶段节点显示状态（未开始/进行中/待审批/完成/失败）
- **审批门卡片**：每阶段产出展示，"通过/打回"按钮
- **流式渲染**：Agent 输出按 token 流式显示
- **代码块执行按钮**：用户可手动跑 Agent 生成的代码片段
- **Diff 视图**：用户编辑 tex 后高亮 Agent 版本的差异

## 12. 技术栈汇总

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron 31 |
| 构建 | electron-vite + Vite 5 |
| UI | React 18 + TypeScript 5 |
| 样式 | Tailwind 3 + shadcn/ui |
| 状态 | Zustand |
| 路由 | React Router（多页面） |
| 主进程 | Node.js 22 + TypeScript |
| 文件监听 | chokidar |
| 加密 | Electron safeStorage（Windows DPAPI） |
| PDF 预览 | pdfjs-dist |
| Agent Runtime | Python 3.13 + LangGraph |
| LLM SDK | openai (Python SDK，兼容多 provider) + anthropic + google-genai |
| 向量库 | ChromaDB（本地持久化） |
| LaTeX | MiKTeX + latexmk |
| 数学工具 | numpy/pandas/scipy/sympy/statsmodels/networkx + MATLAB |
| 附件解析 | pdfplumber/openpyxl/python-docx |
| 进程通信 | JSON-RPC over stdin/stdout |

## 13. 实施路线

### Phase 1 — MVP

目标：跑通"上传题目 → 单 Agent ReAct → 出 LaTeX PDF"最小闭环，但模型层与搜索工具一次性做到位。

- [ ] 项目管理（创建/列表/打开）+ 目录结构初始化
- [ ] 设置页：3 类 provider 配置（OpenAI 兼容 + Anthropic + Gemini），含每阶段指定模型
- [ ] Agent Runtime 雏形（Python 子进程）：单 Agent + ReAct + 5 个工具（python_exec、file_io、latex_compile、make_plot、web_search）
- [ ] 工作台 UI：对话流 + 文件树 + PDF 预览
- [ ] 单 LaTeX 模板（通用模板）+ latexmk 调用
- [ ] 流式输出 + 子进程管理（JSON-RPC over stdio）
- [ ] safeStorage 加密 API key

### Phase 2 — 多 Agent 编排（+3 周）

- [ ] LangGraph 状态机，5 个 Agent 节点
- [ ] 阶段进度条 + 审批门（默认暂停）
- [ ] 状态快照与回滚
- [ ] 长上下文压缩（每阶段摘要）

### Phase 3 — Skill 体系（+2 周）

- [ ] Skill Markdown 加载器
- [ ] 5 个核心 Skill（数据分析/优化/统计/仿真/写作）
- [ ] Skill 文件式加载（UI 编辑放 Phase 4）

### Phase 4 — 体验完善（+3 周）

- [ ] 国赛/美赛官方模板
- [ ] 向量库 RAG（ChromaDB 长附件检索）
- [ ] MATLAB 集成
- [ ] Skill 编辑 UI
- [ ] 错误恢复自动化
- [ ] token 预算与成本统计

## 14. 决策记录（已拍板）

| # | 问题 | 决策 | 备注 |
|---|------|------|------|
| 1 | Agent Runtime 语言 | **Python** | 生态优势 + 工具链契合，独立子进程 + JSON-RPC IPC |
| 2 | MVP 模型 provider 范围 | **三家全做**（OpenAI 兼容 + Anthropic + Gemini） | MVP 工作量加大，但用户灵活度最高 |
| 3 | 审批门默认行为 | **默认每阶段暂停** | 高级用户可一键关，安全优先 |
| 4 | 联网搜索工具默认 | **默认开启** | 接 SerpAPI/Tavily（需用户在设置页填 search API key），用户可关 |

### 仍按推荐方案执行

5. **Skill 编辑 UI**：Phase 3 只支持文件式加载，UI 编辑放 Phase 4
6. **向量库**：MVP 不引入 ChromaDB，长附件用全文塞 prompt 或切片摘要；Phase 4 接入
7. **MATLAB 集成**：Phase 4 才接，MVP 不做（Python 工具链覆盖大部分赛题）

### 决策对实施路线的影响

- **Phase 1 工作量上浮**：MVP 阶段就要完成 3 家 provider 适配 + 联网搜索工具实现
- **Phase 1 新增项**：`web_search` 工具进 MVP 工具集
- **Phase 4 卸载项**：多 provider 接入、联网搜索 已在 Phase 1 完成，Phase 4 仅余向量库 RAG + MATLAB + Skill 编辑 UI

## 15. 风险与不确定性

- **LaTeX 编译失败率**：LLM 写 tex 易出宏包/语法错，靠试编译 + 错误回传能控制在可接受范围，但极端情况需要人工修
- **长程一致性**：跨阶段符号、变量名容易漂移，靠 `state.json` 显式传递 + 校对 Agent 兜底
- **求解正确性**：LLM 写的代码可能有数值错误，用户必须验证关键结果（不替代人审）
- **比赛公平性**：工具是辅助工具，用户需自行确认符合各赛事对 AI 工具使用的规则
