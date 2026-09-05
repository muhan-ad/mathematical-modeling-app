# 项目上下文交接文档（HANDOFF）

> 用途：供下一任 AI（或新会话）快速接管项目，无需重新探查。
> 更新时间：2026-09-05 晚（第三轮大迭代后，全面取代旧版）

---

## 0. 一句话项目状态

Electron 数模辅助应用已完成：Agent Runtime（Python+LangGraph，stdio JSON-RPC 子进程）+ 完整工作台 UI（聊天/审批/排队/技能/插件/文件管理）+ 仪表盘首页。功能全部实测可用，**待 commit**；剩余大项：题目上传+LaTeX 入口、内置 Python（打包阶段）。

---

## 1. 项目基本信息

| 项 | 值 |
|----|----|
| 项目名 | windows-app-maker |
| 工作目录 | `E:\agent-project\windows-app-maker` |
| 技术栈 | Electron 31 + electron-vite + React 18 + TS + Tailwind + shadcn/ui（已锁定，勿推翻） |
| Agent 引擎 | Python 3.13 + LangGraph `create_react_agent`（venv: `agent/.venv`；已装 langgraph/langchain-{core,openai,anthropic,google-genai}/pydantic；**未装 scipy/pandas/matplotlib，待补**） |
| 用户已配模型 | 小米 MiMo（openai_compat，`https://api.xiaomimimo.com/v1`，model `mimo-v2.5`，key 已存 safeStorage） |
| 公开仓库 | github.com/muhan-ad/windows-app-maker.git（配好 remote，**未 push**，大量未提交改动） |
| 参考源码 | `agent-framework/dsh-desktop-master`（DSH 桌面壳源码）、`agent-framework/langgraph-main` |

---

## 2. 铁律（务必遵守）

1. **严禁主动 git push**（用户原话："没我的许可你不许私自推送到仓库"）。**commit 也需用户明确许可**。
2. **应用内一切路径禁止中文**（LaTeX/工具链兼容性）：技能目录、备份文件名、项目目录均已 ASCII 化；中文展示信息放 frontmatter / sidecar json。
3. 标准项目结构受保护（文件面板禁止重命名/删除）：problem(+attachments,statement.md)、workspace/{code,data,outputs,figures,notes}、paper/{sections,figures}、state.json、meta.json、conversation.jsonl。
4. 重启 dev 前先 `taskkill //F //IM electron.exe` 清孤儿进程（曾积攒 4 个）。
5. 主进程/preload 改动后 HMR 无效，必须重启 electron；渲染层改动 HMR 即时生效。
6. 技术选型已锁定（Electron 方案、Agent 用 Python+LangGraph 主引擎 + DSH 备选），勿推翻。

---

## 3. 架构速查

```
渲染层(React) ──IPC(window.app.*)── 主进程(Electron) ──stdio JSON-RPC── agent/*.py (LangGraph)
                                                                    └─ 真实 LLM（三类服务商）
```

- **协议**：请求 `{id,method,params}` → 应答 `{"id","result"|"error"}`；事件 `{"event",{name,...}}`。事件经 `src/main/services/runner-service.ts` 广播 `agent:event` 给渲染层。
- **会话**：每项目一个 Python 子进程（AgentRunner 注册表）；provider 变更自动重启会话；会话重启时从 conversation.jsonl 回放最近 40 条重建上下文。
- **权限四档**：readonly/ask/workspace/full（`agent/permission.py` 在工具执行前拦截；ask 档发 approval_request 事件，UI 弹窗审批）。
- **技能**：`skills/<ascii-id>/SKILL.md`（frontmatter name/description，name 可中文）+ 插件技能 `plugins/<id>/skills/`。目录注入系统提示词；`skill_load(name)` 按 name→dir 映射取全文；每条消息前 runner 下发 set_skills 热更新；done 事件带 `skillsUsed`，UI 显示「⚡ 本轮调用技能：…」。
- **插件**：`plugins/<ascii-id>/`（plugin.json + skills/），导入文件夹自动并入技能库（只读），UI 在 `components/plugin/PluginManagerDialog.tsx`。
- **工具集**（agent/tools.py）：file_read/create/write/delete/list、python_exec、latex_compile、skill_load。所有子进程统一 `creationflags=CREATE_NO_WINDOW` + `input=""`（已修复 Electron 环境挂起问题）。
- **提示词优化**：`prompt-optimizer.ts` + `llm-client.ts`（主进程一次性 LLM 调用，三类服务商）；模型解析顺序=设置固定 > 对话当前模型 > 阶段/默认。

---

## 4. 已完成功能（本轮迭代，均实测）

- 工作台三栏：**可拖拽调宽**（localStorage 记忆）+ 左右栏收起；文件树**可折叠 + 文件夹优先排序** + 中文注解标签；文件操作菜单（复制路径/重命名/删除，直接操作磁盘）
- 聊天：Markdown+KaTeX 公式渲染（`$$`/`$`/`\(\)` 归一化，`components/agent/Markdown.tsx`）、实时工具卡（转圈→结果原地更新）、消息排队+插队+打断（发送按钮两态）、输入框高度自适应（96→400px）、优化期间闪烁反馈
- 状态栏：思考中/回复中/执行工具/等待审批/空闲；完成通知为简洁版（不含内容）
- 历史持久化：localStorage（UI 层，中断工具卡标记为会话中断）+ conversation.jsonl 回放（Agent 层）
- 首页仪表盘：时段问候、最近项目、工作台状态三卡（模型/技能/备份，点击直达管理）、未配模型时三步上手引导
- 设置：模型服务商（三类型）、每阶段模型、提示词优化模型、搜索、深浅主题
- 备份：项目级 zip，文件名 ASCII 化（`wmbackup-<id>-<count>-<ts>.zip` + sidecar json），旧中文文件名格式兼容解析
- 进入对话自动滚到底部；用户消息浅灰气泡；AI 回复无气泡纯排版；底部控制行三个等比下拉（模型/权限/深度）+ 优化/发送按钮组
- 测试：`tests/agent-protocol-test.py`（mock 模型闭环：初始化/set_skills 热更新/审批/拒绝/会话记录/skillsUsed 字段）

---

## 5. 待办（按优先级）

1. **commit**（等用户许可！改动极大）
2. **题目上传 + LaTeX 编译入口**（latex_compile 工具已就绪；需装 TeX 发行版才能真编译）
3. **预览面板激活**（点击文件右栏预览图/PDF/MD/tex）——用户已知悉
4. **右上角「?」帮助按钮**：待用户三选一（帮助+关于 / 只快捷键 / 移除）
5. **内置 Python**（打包阶段）：方案已定 = python-build-standalone 放 resources + 预装科学计算库，+400MB；开发期继续用 .venv
6. **Agent 依赖缺口**：venv 需补装 scipy/pandas/matplotlib（用户真用求解时必踩 ImportError）
7. 文件共享（.mmshare 快照包）——**用户已明确不做**，设计已存档于此前的会话记录

---

## 6. 已知问题/注意

- `python_exec` 曾在 Electron 环境挂起（CREATE_NO_WINDOW 已修复并验证）；复发先怀疑杀软扫描新写脚本
- Explore 后台智能体曾因并发限制失败，重试时单实例运行即可
- venv 里无 scipy/pandas/matplotlib：AI 写画图代码会 ImportError（待办 #6）
