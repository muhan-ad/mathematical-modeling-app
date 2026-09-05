# Windows App Maker

> 面向大学生数学建模竞赛的 Agent 桌面应用——从读题、建模、求解到 LaTeX 论文生成，全流程 AI 协作。

## 项目状态

🚧 **早期开发阶段** — 当前已完成桌面应用基座与方案设计，业务功能在持续迭代中。

- ✅ 桌面应用基座（Electron + Vite + React + TypeScript + Tailwind + shadcn/ui）
- ✅ 方案设计文档（[docs/design.md](docs/design.md)）
- 🚧 Phase 1：项目管理 + Agent Runtime 雏形 + 3 家模型 provider 适配

## 产品定位

让 LLM Agent 全流程辅助数模比赛（CUMCM 国赛 / MCM 美赛 / 校赛省赛），作为"协作队友"加速每个阶段，让人聚焦于决策与审查：

```
[1] 创建项目 → 上传题目 PDF + 数据附件
[2] 题目理解 Agent → 拆解问题、识别题型、制定计划
[3] 建模 Agent → 提出模型方案（用户可干预/修改）
[4] 求解 Agent → 写 Python/MATLAB 代码、运行、迭代
[5] 论文写作 Agent → 生成 LaTeX 章节（含公式、图、表）
[6] 校对编译 Agent → 检查引用、公式、逻辑 → 编译 PDF
[7] 用户预览 PDF → 反馈 → 任意阶段回滚重做
```

完整设计见 [docs/design.md](docs/design.md)。

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron 31 |
| 构建 | electron-vite + Vite 5 |
| UI | React 18 + TypeScript 5 |
| 样式 | Tailwind CSS 3 + shadcn/ui |
| 主进程 | Node.js 22 |
| Agent Runtime | Python 3.13 + LangGraph |
| LLM 接入 | OpenAI 兼容协议 / Anthropic / Gemini |
| LaTeX 编译 | MiKTeX + latexmk |
| 数学工具 | numpy / pandas / scipy / sympy / statsmodels / networkx |
| 进程通信 | JSON-RPC over stdin/stdout |

## 环境要求

- Windows 10 19045+ / Windows 11
- Node.js 20+（推荐 22）
- pnpm 9+
- Python 3.10+
- MiKTeX 或 TeX Live（含 `xelatex` + `latexmk`）

## 快速开始

### 安装依赖

```bash
pnpm install
```

> 国内网络环境可设置 Electron 镜像加速：
> `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`

### 开发模式

```bash
pnpm run dev
```

启动 Electron 窗口 + Vite HMR，修改源码自动刷新。

### 打包 Windows 安装包

```bash
pnpm run build:win
```

产物位于 `release/` 目录（NSIS 安装包 + zip）。

### 类型检查

```bash
pnpm run typecheck
```

## 项目结构

```
.
├── docs/
│   ├── design.md              # 完整方案设计文档
│   ├── ui-design.md           # UI 设计规范（色彩/排版/组件/布局）
│   └── HANDOFF.md             # 项目上下文交接文档（新会话先读）
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── index.ts
│   │   └── services/          # 主进程服务（backup-service 等）
│   ├── preload/               # 安全桥接层
│   │   ├── index.ts
│   │   └── index.d.ts
│   └── renderer/              # React UI
│       ├── index.html
│       └── src/
│           ├── App.tsx
│           ├── components/ui/     # shadcn 组件
│           ├── components/backup/ # 备份业务组件
│           ├── lib/utils.ts       # cn() 工具
│           └── styles.css         # Tailwind + 主题变量
├── tests/                     # e2e 测试（Playwright）
├── math-modeling/             # 参考资料目录（Mrite 借鉴分析，见其 README.md）
├── electron.vite.config.ts    # 三段构建配置（main/preload/renderer）
├── electron-builder.yml       # 打包配置
├── tailwind.config.ts
├── components.json            # shadcn/ui 配置
└── package.json
```

## 实施路线

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | MVP：单 Agent ReAct + 5 工具 + 3 家 provider + LaTeX 编译闭环 | 🚧 进行中 |
| 2 | 多 Agent 编排：LangGraph 状态机 + 5 阶段 + 审批门 | ⏳ 待开始 |
| 3 | Skill 体系：Markdown Skill 加载 + 5 个核心 Skill | ⏳ 待开始 |
| 4 | 体验完善：官方模板 + 向量库 RAG + MATLAB + Skill 编辑 UI | ⏳ 待开始 |

详见 [docs/design.md § 13](docs/design.md#13-实施路线)。

## 安全说明

- API key 通过 Electron `safeStorage`（Windows DPAPI）加密存储，明文不出主进程
- LaTeX 编译启用 `--no-shell-escape`，禁止 `\write18` 任意命令
- 子进程工作目录强制限制在项目根，路径校验拒绝 `..` 跳出
- 用户项目数据（题目、附件）默认不上传，仅在本地处理

## 贡献

欢迎 Issue / PR。提交前请先跑 `pnpm run typecheck` 确保类型通过。

## 许可证

本项目采用 [GPL-3.0](LICENSE) 协议——允许商用、修改、分发，但衍生作品必须同样开源并保留版权声明。
