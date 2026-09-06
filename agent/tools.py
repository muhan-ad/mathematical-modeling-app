"""Agent 工具集：文件读写、代码执行、LaTeX 编译。

所有工具经 PermissionGate 包装后注册进 LangGraph；
路径一律通过 paths.resolve_in_project 约束在项目目录内。
注意：@tool 按 args_schema 字段名拆包调用，函数参数必须与模型字段一一对应。
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from .permission import PermissionGate, gate_tool

MAX_OUTPUT_CHARS = 8000

# Windows 下：Agent 进程本身由 Electron 以 CREATE_NO_WINDOW 启动，
# 其子进程若不显式声明同样标志，会尝试分配新控制台导致挂起。
_SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-limit // 2 :]
    return f"{head}\n…[输出过长，已截断，共 {len(text)} 字符]…\n{tail}"


# ---------- 参数模型 ----------


class ReadFileArgs(BaseModel):
    path: str = Field(description="项目内相对路径，如 problem/statement.md")


class WriteFileArgs(BaseModel):
    path: str = Field(description="项目内相对路径")
    content: str = Field(description="要写入的完整内容（覆盖原文件）")


class DeleteFileArgs(BaseModel):
    path: str = Field(description="项目内相对路径")


class ListFilesArgs(BaseModel):
    path: str = Field(default=".", description="项目内相对目录，默认列出全部")


class PythonExecArgs(BaseModel):
    code: str = Field(description="要执行的 Python 代码（求解/绘图脚本）")


class LatexCompileArgs(BaseModel):
    entry: str = Field(default="paper/main.tex", description="主 tex 文件的项目内相对路径")


class SkillLoadArgs(BaseModel):
    name: str = Field(description="技能名称（技能目录里列出的名称）")


def build_skill_tool(skills: list[dict], on_use=None):
    """skill_load：按需加载技能全文（DSH 模式：目录进提示词，正文用工具取）。

    skills：[{name, description, dir}]，name → dir 映射由主进程解析
    （用户技能与插件技能目录不同，统一由映射表给出）。
    on_use(name)：每次成功发起加载时回调，用于统计本轮实际用到的技能。
    """
    dir_by_name = {s.get("name", ""): s.get("dir", "") for s in skills}

    @tool("skill_load", args_schema=SkillLoadArgs)
    def skill_load(name: str) -> str:
        """加载一个技能的完整操作指令。当任务匹配技能目录中的主题时先调用本工具。"""
        from pathlib import Path as _Path

        if not name or any(ch in name for ch in '\\/:*?"<>|'):
            return f"[错误] 非法的技能名称：{name}"
        skill_dir = dir_by_name.get(name)
        if not skill_dir:
            return f"[错误] 技能不存在：{name}（可用技能：{'、'.join(dir_by_name) or '无'}）"
        skill_file = _Path(skill_dir) / "SKILL.md"
        if not skill_file.exists():
            return f"[错误] 技能文件缺失：{name}"
        if on_use is not None:
            try:
                on_use(name)
            except Exception:
                pass
        return _truncate(skill_file.read_text("utf-8", errors="replace"), limit=16000)

    return skill_load


def build_tools(project_dir: str, gate: PermissionGate) -> list:
    """为指定项目会话构建（已接权限门的）工具列表。"""

    @tool("file_read", args_schema=ReadFileArgs)
    def file_read(path: str) -> str:
        """读取项目内的一个文本文件内容（题目、代码、论文、数据均可）。PDF 自动抽取文本。"""
        from .paths import resolve_in_project

        def run() -> str:
            p = resolve_in_project(project_dir, path)
            if not p.exists() or not p.is_file():
                return f"[错误] 文件不存在：{path}"
            if p.suffix.lower() == ".pdf":
                try:
                    from pypdf import PdfReader

                    reader = PdfReader(str(p))
                    pages = []
                    for i, page in enumerate(reader.pages):
                        text = page.extract_text() or ""
                        pages.append(f"--第 {i + 1}/{len(reader.pages)} 页--\n{text}")
                    return _truncate("\n".join(pages))
                except ImportError:
                    return "[错误] 环境缺少 pypdf，无法读取 PDF 文本"
                except Exception as e:
                    return f"[错误] PDF 解析失败：{e}（扫描版 PDF 无文本层，需人工转写）"
            return _truncate(p.read_text("utf-8", errors="replace"))

        return gate_tool(gate, "file_read", {"path": path}, run)

    @tool("file_create", args_schema=WriteFileArgs)
    def file_create(path: str, content: str) -> str:
        """创建一个新文件（已存在则报错）。用于写求解脚本、笔记、论文章节等。"""
        from .paths import resolve_in_project

        def run() -> str:
            p = resolve_in_project(project_dir, path)
            if p.exists():
                return f"[错误] 文件已存在，请改用 file_write 覆盖：{path}"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, "utf-8")
            return f"已创建 {path}（{len(content)} 字符）"

        return gate_tool(gate, "file_create", {"path": path}, run)

    @tool("file_write", args_schema=WriteFileArgs)
    def file_write(path: str, content: str) -> str:
        """写入（新建或覆盖）项目内的一个文件。"""
        from .paths import resolve_in_project

        def run() -> str:
            p = resolve_in_project(project_dir, path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, "utf-8")
            return f"已写入 {path}（{len(content)} 字符）"

        return gate_tool(gate, "file_write", {"path": path}, run)

    @tool("file_delete", args_schema=DeleteFileArgs)
    def file_delete(path: str) -> str:
        """删除项目内的一个文件（不删目录）。"""
        from .paths import resolve_in_project

        def run() -> str:
            p = resolve_in_project(project_dir, path)
            if not p.exists():
                return f"[错误] 文件不存在：{path}"
            p.unlink()
            return f"已删除 {path}"

        return gate_tool(gate, "file_delete", {"path": path}, run)

    @tool("file_list", args_schema=ListFilesArgs)
    def file_list(path: str = ".") -> str:
        """列出项目内某目录下的文件与子目录（不含内容）。"""
        from .paths import resolve_in_project

        def run() -> str:
            root = resolve_in_project(project_dir, path)
            if not root.exists():
                return f"[错误] 目录不存在：{path}"
            lines: list[str] = []
            for p in sorted(root.rglob("*")):
                rel = p.relative_to(root).as_posix()
                lines.append(f"{'d' if p.is_dir() else 'f'} {rel}")
            return _truncate("\n".join(lines) or "(空目录)")

        return gate_tool(gate, "file_list", {"path": path}, run)

    @tool("python_exec", args_schema=PythonExecArgs)
    def python_exec(code: str) -> str:
        """在项目 workspace/code 下执行一段 Python 代码，返回 stdout/stderr。用于建模求解与绘图。"""
        from .paths import resolve_in_project

        def run() -> str:
            code_dir = resolve_in_project(project_dir, "workspace/code")
            code_dir.mkdir(parents=True, exist_ok=True)
            script = code_dir / f"_snippet_{int(time.time() * 1000)}.py"
            script.write_text(code, "utf-8")
            try:
                proc = subprocess.run(
                    [sys.executable, "-X", "utf8", script.name],
                    cwd=str(code_dir),
                    input="",
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=180,
                    creationflags=_SUBPROCESS_FLAGS,
                )
                output = f"exit={proc.returncode}\n--stdout--\n{proc.stdout}\n--stderr--\n{proc.stderr}"
                return _truncate(output)
            except subprocess.TimeoutExpired:
                return "[错误] 执行超时（上限 180 秒）"
            finally:
                script.unlink(missing_ok=True)

        return gate_tool(gate, "python_exec", {"code": "<python 源码>"}, run)

    @tool("latex_compile", args_schema=LatexCompileArgs)
    def latex_compile(entry: str = "paper/main.tex") -> str:
        """用 xelatex 编译论文主文件，返回编译日志摘要。"""
        from .paths import resolve_in_project

        def run() -> str:
            tex = resolve_in_project(project_dir, entry)
            paper_dir = tex.parent
            if not tex.exists():
                return f"[错误] 找不到 {entry}"
            try:
                proc = subprocess.run(
                    ["xelatex", "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", tex.name],
                    cwd=str(paper_dir),
                    input="",
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=300,
                    creationflags=_SUBPROCESS_FLAGS,
                )
                pdf = tex.with_suffix(".pdf")
                result = f"exit={proc.returncode}\n"
                result += (
                    f"PDF 生成：{pdf.name}（{pdf.stat().st_size} 字节）\n"
                    if pdf.exists()
                    else "未生成 PDF\n"
                )
                return _truncate(result + "--日志尾部--\n" + (proc.stdout or "")[-3000:])
            except FileNotFoundError:
                return "[错误] 未检测到 xelatex，请先安装 TeX 发行版（如 TeX Live / MiKTeX）"
            except subprocess.TimeoutExpired:
                return "[错误] 编译超时（上限 300 秒）"

        return gate_tool(gate, "latex_compile", {"entry": entry}, run)

    return [file_read, file_create, file_write, file_delete, file_list, python_exec, latex_compile]
