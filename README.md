# Mathematical Modeling App

> 面向大学生数学建模竞赛的 **AI 协作桌面应用**——从读题、建模、求解到 LaTeX 论文生成与 PDF 编译，全程让 LLM Agent 当你的「协作队友」，你专注决策与审查。

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-31-47848F?logo=electron">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.10+-3776AB?logo=python">
  <img alt="License" src="https://img.shields.io/badge/License-GPL--3.0-blue">
</p>

## 它能做什么

按「数模比赛工作流」编排，Agent 逐阶段辅助：

```
① 创建项目 → 上传题目 PDF + 数据附件
② 题目理解 Agent → 拆解问题、识别题型、制定计划
③ 建模 Agent   → 提出模型方案（你可随时介入修改）
④ 求解 Agent   → 写 Python 代码、运行、迭代
⑤ 论文写作 Agent → 生成 LaTeX 章节（含公式、图、表）
⑥ 校对编译 Agent → 检查引用/公式/逻辑 → 编译 PDF
⑦ 你预览 PDF → 反馈 → 任意阶段回滚重做
```

内置完整工作台：**AI 聊天面板**（Markdown + KaTeX 公式、实时工具调用卡、消息排队/插队/打断）、**可拖拽三栏布局**、**文件管理/预览**、**技能与插件系统**、**项目级备份**、首页仪表盘。

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron |
| 构建 | electron-vite + Vite |
| UI | React + TypeScript + Tailwind CSS + shadcn/ui |
| Agent 引擎 | Python + LangGraph（stdio JSON-RPC 子进程） |
| LLM 接入 | OpenAI 兼容协议 / Anthropic / Gemini（三类服务商） |
| 数学工具 | numpy / pandas / scipy / sympy / statsmodels（Agent 可选） |
| LaTeX 编译 | MiKTeX / TeX Live（`xelatex`，可选） |
| 进程通信 | JSON-RPC over stdin/stdout |

## 环境要求

- **Windows 10（19045+）/ Windows 11**
- **Node.js 20+**（推荐 22）
- **pnpm 9+**
- **Python 3.10+**（Agent 运行时必需）
- **MiKTeX / TeX Live**（含 `xelatex`，仅论文编译需要；未装则其余功能不受影响）

## 快速开始

### 1. 安装前端依赖

```bash
pnpm install
```

> 国内网络可设 Electron 镜像加速：
> ```powershell
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> pnpm install
> ```

### 2. 配置 Agent Python 环境（首次必做）

应用内置的 AI Agent 是 Python 进程（依赖清单见 `agent/requirements.txt`）。
在项目根目录用 **PowerShell** 执行一键配置脚本，创建 `agent/.venv` 并安装全部依赖（约 500MB）：

```powershell
.\scripts\setup-agent-env.ps1
```

> 国内网络建议先配置 pip 镜像，例如在脚本执行前设置：
> ```powershell
> $env:PIP_INDEX_URL = "https://pypi.tuna.tsinghua.edu.cn/simple"
> ```

### 3. 启动

```bash
pnpm run dev
```

> 首次使用：先在应用内「设置」添加你的模型服务商 API key，然后新建项目即可开始对话。

### 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm run dev` | 开发模式（Electron + Vite HMR） |
| `pnpm run typecheck` | TypeScript 类型检查 |
| `pnpm run build:win` | 打包 Windows 安装包（产物在 `release/`） |

> **打包须知**：electron-builder 按扁平 `node_modules` 结构扫描生产依赖。本项目已在 `pnpm-workspace.yaml` 配置 `nodeLinker: hoisted`,让 pnpm 产出扁平布局,确保 `archiver` 等库的**间接依赖**(如 `is-stream`)能完整打进安装包。若你**曾以旧版隔离布局装过依赖**,请先删除 `node_modules` 再 `pnpm install` 后重新打包,否则安装包会缺运行时依赖、启动报 `ERR_MODULE_NOT_FOUND: Cannot find package 'is-stream'`。

### 论文编译环境（LaTeX，可选但推荐）

> **声明**：为控制安装包体积，本应用**不内置 TeX 发行版**。「写论文 → 编译 PDF」依赖你本机安装的 TeX（应用通过系统 `PATH` 查找 `xelatex`）。
> 不装也能正常使用其余全部功能（读题 / 建模 / 求解 / 技能 / 预览）；只有"把论文编译成 PDF"这一步需要它。

**推荐：MiKTeX**（Windows 最简单，缺包时能自动联网补装）：

| 项 | 内容 |
|----|------|
| 官方网址 | https://miktex.org |
| 下载页面 | https://miktex.org/download |
| 版本 | 下载页面提供的**最新稳定版**（建议选 "Windows 安装包 Basic/Full"） |
| 安装位置 | 选 **“仅为我安装（per-user）”**，默认装到 `C:\Users\<你的用户名>\AppData\Local\Programs\MiKTeX`，无需管理员权限；勾选安装完成后自动把 `xelatex` 加入 `PATH` |

**备选：TeX Live**（全量，体积大但更全）：

| 项 | 内容 |
|----|------|
| 官方网址 | https://tug.org/texlive/ |
| Windows 安装 | https://tug.org/texlive/windows.html（install-tl-windows） |
| 版本 | 每年一版（如 TeX Live 2025），装最新版即可 |
| 安装位置 | 默认 `C:\texlive\<年份>\`，安装时勾选加入系统 `PATH` |

**安装后**：重启应用（或重开对话），Agent 的 `latex_compile` 工具会自动检测到 `xelatex` 即可编译出 PDF。可用 `xelatex --version` 在终端自检是否就绪。

> 国内网络下载 TeX 发行版可能较慢，可用镜像：
> MiKTeX 官方提供地区镜像；TeX Live 可参考清华镜像 `https://mirrors.tuna.tsinghua.edu.cn/CTAN/`。

## 你的数据存在哪（重要）

应用运行数据、竞赛项目、技能、插件**全部存放在系统 userData 目录**，由 Electron `app.getPath('userData')` 解析
（Windows 上通常为 `%APPDATA%\<app名>`），**不写入仓库、不随代码分发**。

- **竞赛项目**（题目、附件、代码、生成的 LaTeX/PDF）：`userData/mathmodel-projects/<项目ID>/`
- **你的技能**：`userData/skills/<技能ID>/SKILL.md`
- **导入的插件**：`userData/plugins/<插件ID>/`

因此：**克隆仓库后首次运行得到的是你自己的空数据目录**，仓库内不会出现任何用户题目、附件或 API key。

## 技能 / 插件

仓库在 `resources/skills/` 内置了**一支覆盖数模全流程的入门技能集**（对齐工作流阶段）：

| 技能目录 | 名称 | 作用 |
|----------|------|------|
| `read-question-decompose` | 读题拆解 | 拆解问题、识别题型、规划解题路线 |
| `model-design` | 建模方案设计 | 逐问设计可解释、可求解的数学模型 |
| `solve-code` | 求解与代码迭代 | 用 Python 实现模型、运行并产出数值与图表 |
| `paper-writing` | 论文写作与排版 | 把结果整理为规范 LaTeX 论文 |
| `proof-compile` | 校对与编译成稿 | 交稿前一致性校对并编译出 PDF |

技能存于**每个用户的 `userData/skills/`**（不随代码写入用户项目）。

- **打包版（Release 安装包）**：首次运行时应用**自动把这些内置技能播种**到你的技能库，开箱即用、无需手动操作；之后你仍可自由编辑或删除。
- **源码版（clone 开发）**：请把 `resources/skills/` 下某个技能文件夹（含 `SKILL.md`）整体复制到你的技能库目录
  （Windows 通常为 `%APPDATA%\mathematical-modeling-app\skills\`）即可启用，也可在应用内「技能」管理界面自建/编辑。

- **新建技能**：应用内「技能」管理界面，创建一个含 `name`/`description` 元信息的 `SKILL.md` 即生效。
- **导入插件**：「插件」管理界面导入一个符合规范的插件文件夹（`plugin.json` + `skills/`），自动并入技能库。
- 详细目录规范与架构见 [docs/design.md](docs/design.md) 与 [docs/HANDOFF.md](docs/HANDOFF.md)（面向开发者）。

## 安全说明

- API key 通过 Electron `safeStorage`（Windows DPAPI）**加密**存储，明文不出主进程。
- LaTeX 编译启用 `--no-shell-escape`，禁止 `\write18` 任意命令执行。
- Agent 子进程工作目录强制限制在项目根内，路径校验拒绝 `..` 越界。
- 用户数据（题目、附件）默认本地处理，不上传。

## 许可证

[GPL-3.0](LICENSE)——允许商用、修改、分发，但衍生作品必须同样开源并保留版权声明。

## 贡献

欢迎 Issue / PR。提交前请先跑 `pnpm run typecheck` 确保类型通过。开发者架构交接与维护约定见 [docs/HANDOFF.md](docs/HANDOFF.md)。
