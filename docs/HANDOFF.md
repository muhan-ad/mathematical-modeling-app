# 项目上下文交接文档（HANDOFF）

> 用途：供开发者 / 下一任 AI（或新会话）快速理解本仓库的架构与约定，无需重新探查。
> 本文面向**公开仓库的贡献者**，不含任何本机路径、账号或私密配置。更新时间：2026-09-06。

---

## 1. 一句话项目状态

面向大学生数学建模竞赛的 AI 协作桌面应用，已完成：Agent Runtime（Python+LangGraph，stdio JSON-RPC 子进程）+ 完整工作台 UI（聊天/审批/排队/技能/插件/文件管理）+ 首页仪表盘 + 题目上传建项 + LaTeX 编译入口 + 文件预览面板。

---

## 2. 项目基本信息

| 项 | 值 |
|----|----|
| 技术栈 | Electron + electron-vite + React + TS + Tailwind + shadcn/ui（已锁定） |
| Agent 引擎 | Python + LangGraph `create_react_agent`，随会话运行的独立 venv（`agent/.venv`） |
| LLM 接入 | 三类服务商适配：OpenAI 兼容协议 / Anthropic / Gemini（统一抽象） |
| 用户数据 | 全部存系统 userData，不进入仓库（见 §6） |

---

## 3. 开发者约定（维护时请遵守）

1. **未经仓库维护者明确许可，不主动 `git push` / 大幅 `commit`**。
2. **应用内一切路径禁止中文**（LaTeX/工具链兼容性）：技能目录、备份文件名、项目目录一律 ASCII 化；中文展示文本放 frontmatter / sidecar json。
3. 标准项目结构受保护（文件面板禁止重命名/删除）：`problem`(+attachments, statement.md)、`workspace/{code,data,outputs,figures,notes}`、`paper/{sections,figures}`、`state.json`、`meta.json`、`conversation.jsonl`。
4. 重启 dev 前先 `taskkill //F //IM electron.exe` 清理孤儿进程。
5. 主进程/preload 改动后 HMR 无效，需重启 electron；渲染层改动 HMR 即时生效。
6. 技术选型已锁定，勿推翻。

---

## 4. 架构速查

```
渲染层(React) ──IPC(window.app.*)── 主进程(Electron) ──stdio JSON-RPC── agent/*.py (LangGraph)
                                                                    └─ 真实 LLM（三类服务商）
```

- **协议**：请求 `{id,method,params}` → 应答 `{"id","result"|"error"}`；事件 `{"event",{name,...}}`。事件经 `src/main/services/runner-service.ts` 广播 `agent:event` 给渲染层。
- **会话**：每项目一个 Python 子进程（AgentRunner 注册表）；provider 变更自动重启会话；会话重启时从 `conversation.jsonl` 回放最近 40 条重建上下文。
- **权限四档**：`readonly/ask/workspace/full`（`agent/permission.py` 在工具执行前拦截；ask 档发 `approval_request` 事件，UI 弹窗审批）。
- **技能**：用户技能存 `userData/skills/<ascii-id>/SKILL.md`（frontmatter `name`/`description`，name 可中文）+ 插件技能 `userData/plugins/<id>/skills/`。目录注入系统提示词；`skill_load(name)` 按 name→dir 映射取全文；每条消息前 runner 下发 `set_skills` 热更新；done 事件带 `skillsUsed`，UI 显示本轮调用技能。
- **插件**：`userData/plugins/<ascii-id>/`（plugin.json + skills/），导入文件夹自动并入技能库（只读），UI 在 `src/renderer/src/components/plugin/PluginManagerDialog.tsx`。
- **工具集**（`agent/tools.py`）：`file_read/create/write/delete/list`、`python_exec`、`latex_compile`、`skill_load`。子进程统一 `creationflags=CREATE_NO_WINDOW` + `input=""`（避免 Electron 环境挂起）。
- **提示词优化**：`src/main/services/prompt-optimizer.ts` + `src/main/services/llm-client.ts`（主进程一次性 LLM 调用）；模型解析顺序 = 设置固定 > 对话当前模型 > 阶段/默认。

---

## 5. 功能清单（当前已实现）

- 工作台三栏：可拖拽调宽（localStorage 记忆）+ 左右栏收起；文件树可折叠 + 文件夹优先排序 + 中文注解标签；文件操作菜单（复制路径/重命名/删除，直接操作磁盘）。
- 聊天：Markdown + KaTeX 公式渲染（`$$`/`$`/`\(\)` 归一化，`components/agent/Markdown.tsx`）、实时工具卡、消息排队/插队/打断、输入框高度自适应、优化期间闪烁反馈。
- 状态栏：思考中/回复中/执行工具/等待审批/空闲；完成通知简洁版。
- 历史持久化：localStorage（UI 层，中断工具卡标记为会话中断）+ `conversation.jsonl` 回放（Agent 层）。
- 首页仪表盘：时段问候、最近项目、工作台状态卡（模型/技能/备份，点击直达管理）、未配模型时的上手引导。
- 设置：模型服务商（三类型）、每阶段模型、提示词优化模型、搜索、深浅主题。
- 备份：项目级 zip（`wmbackup-<id>-<count>-<ts>.zip` + sidecar json），旧中文文件名格式兼容解析。
- 题目上传建项 + LaTeX 编译入口 + 文件预览面板。
- 测试：`tests/agent-protocol-test.py`（mock 模型闭环）、`tests/test-backup-flow.py`（Playwright 端到端）。

---

## 6. 数据存哪（重要：仓库不携带任何用户数据）

应用运行数据、项目、技能、插件全部存放在系统 `userData`（Windows：`%APPDATA%/<app>`），由 `app.getPath('userData')` 解析，**平台中立、随用户环境而定**。因此：克隆仓库后首次运行得到的是自己的空数据目录，仓库内不出现任何用户题目、附件、API key。技能/插件需在应用内创建或从他人处导入（见 README）。

---

## 7. 已知注意点

- `python_exec` 曾在 Electron 环境挂起：用 `CREATE_NO_WINDOW` + `input=""` 已修复并验证；若复发，先排查杀软对新写脚本的扫描。
- 后台智能体并发受限时，重试改为单实例运行。
