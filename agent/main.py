"""Agent Runtime 入口：stdio 上跑换行分隔的 JSON 协议。

客户端 → Runtime（请求）：{"id": "...", "method": "...", "params": {...}}
  initialize {projectId, projectDir, permission, effort, provider}
  message    {text}
  approval   {requestId, approved}
  shutdown   {}

Runtime → 客户端：
  {"id": "...", "result": ...}          对请求的应答
  {"event": "...", "params": {...}}     事件流
  ready / message_start / message_delta / tool_result
  / approval_request / error / done
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from .permission import PermissionGate  # noqa: E402

_write_lock = threading.Lock()


def write_msg(obj: dict) -> None:
    line = json.dumps(obj, ensure_ascii=False)
    with _write_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def emit(key: str, payload: dict) -> None:
    write_msg({key: payload})


def emit_event(event: str, params: dict) -> None:
    emit("event", {"name": event, **params})


class Session:
    def __init__(self) -> None:
        self.project_id: str | None = None
        self.project_dir: str | None = None
        self.effort: str = "off"
        self.provider: dict = {}
        self.gate: PermissionGate | None = None
        self.agent = None
        self.busy = False

    def initialize(self, params: dict) -> dict:
        self.project_id = params["projectId"]
        self.project_dir = params["projectDir"]
        self.effort = params.get("effort", "off")
        self.provider = params.get("provider", {})
        self.gate = PermissionGate(
            level=params.get("permission", "ask"),
            project_dir=self.project_dir,
            emit=lambda name, p: emit_event(name, p),
        )
        # 会话重启后的上下文重建：最近对话回放到首轮输入
        self.pending_history = [
            h for h in params.get("history", []) if h.get("role") in ("user", "assistant") and h.get("content")
        ]
        # 技能系统：目录注入提示词，skill_load 按名称查各自目录取全文（含插件技能）
        skills_payload = params.get("skills", {}) or {}
        self.skills = skills_payload.get("skills", [])
        # 本轮对话实际调用过的技能（done 事件里回传给界面展示）
        self.skills_used: list[str] = []
        self.agent = None  # 首条消息时按需构建（构建失败能即时回报错误）
        return {"ok": True, "projectId": self.project_id, "history": len(self.pending_history)}

    def ensure_agent(self):
        if self.agent is None:
            from .graph import build_agent

            self.agent = build_agent(
                self.provider,
                self.effort,
                self.project_dir,
                self.gate,
                skills=self.skills,
                on_skill_use=self._record_skill_use,
            )
        return self.agent

    def _record_skill_use(self, name: str) -> None:
        if name not in self.skills_used:
            self.skills_used.append(name)

    def set_skills(self, params: dict) -> dict:
        """技能表热更新：用户增删改技能/安装插件后，下一条消息立即使用最新目录。"""
        payload = params or {}
        new_skills = payload.get("skills", [])
        if new_skills != self.skills:
            self.skills = new_skills
            self.agent = None  # 下一条消息按新目录重建图
        return {"ok": True, "skills": len(self.skills)}

    def set_permission(self, level: str) -> dict:
        self.gate.set_level(level)
        return {"ok": True, "permission": level}

    def run_message(self, text: str) -> None:
        """在独立线程中跑一轮 ReAct；期间 stdout 持续发事件。"""
        if self.busy:
            emit_event("error", {"message": "上一轮对话尚未结束"})
            return
        self.busy = True
        try:
            self._run_message(text)
        except Exception as err:  # noqa: BLE001
            emit_event("error", {"message": f"Agent 运行出错：{err}", "detail": traceback.format_exc()[-2000:]})
        finally:
            self.busy = False

    def _run_message(self, text: str) -> None:
        agent = self.ensure_agent()
        self.skills_used = []  # 每轮重置技能调用统计
        emit_event("message_start", {})
        self._append_conversation({"role": "user", "content": text, "ts": _now()})

        # 首轮（或进程重启后首轮）带上历史，之后 LangGraph 状态自行延续
        input_messages: list = []
        if self.pending_history:
            from langchain_core.messages import AIMessage, HumanMessage

            for h in self.pending_history:
                if h["role"] == "user":
                    input_messages.append(HumanMessage(content=h["content"]))
                else:
                    input_messages.append(AIMessage(content=h["content"]))
            input_messages.append(("user", text))
            self.pending_history = []
        else:
            input_messages = [("user", text)]

        final_text = ""
        try:
            for chunk, _meta in agent.stream(
                {"messages": input_messages},
                stream_mode="messages",
            ):
                ctype = type(chunk).__name__
                if ctype == "ToolMessage":
                    content = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
                    emit_event(
                        "tool_result",
                        {"tool": getattr(chunk, "name", "") or "tool", "output": content[:2000]},
                    )
                    final_text = ""
                elif ctype in ("AIMessageChunk", "AIMessage"):
                    delta = _chunk_text(chunk)
                    if delta:
                        final_text += delta
                        emit_event("message_delta", {"delta": delta})
                # 其余类型（AIMessage 聚合等）忽略
        except Exception as err:  # noqa: BLE001
            emit_event("error", {"message": f"模型调用失败：{err}"})
            emit_event("done", {"text": final_text, "ok": False})
            return

        emit_event("done", {"text": final_text, "ok": True, "skillsUsed": self.skills_used})
        self._append_conversation(
            {
                "role": "assistant",
                "content": final_text,
                "ts": _now(),
                "skillsUsed": self.skills_used,
            }
        )

    def _append_conversation(self, record: dict) -> None:
        try:
            path = Path(self.project_dir) / "conversation.jsonl"
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def handle(self, method: str, params: dict) -> dict:
        if method == "initialize":
            return self.initialize(params)
        if method == "message":
            text = params.get("text", "")
            threading.Thread(target=self.run_message, args=(text,), daemon=True).start()
            return {"ok": True}
        if method == "approval":
            self.gate.resolve_approval(params["requestId"], bool(params.get("approved")))
            return {"ok": True}
        if method == "set_permission":
            return self.set_permission(params["level"])
        if method == "set_skills":
            return self.set_skills(params)
        if method == "shutdown":
            return {"ok": True}
        raise ValueError(f"未知方法：{method}")


def _chunk_text(chunk) -> str:
    content = chunk.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""


def _now() -> str:
    from datetime import datetime

    return datetime.now().isoformat(timespec="seconds")


def main() -> int:
    session = Session()
    emit_event("ready", {"pid": __import__("os").getpid()})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            result = session.handle(request.get("method", ""), request.get("params", {}) or {})
        except Exception as err:  # noqa: BLE001
            result = {"error": f"{type(err).__name__}: {err}"}
            traceback.print_exc(file=sys.stderr)
        req_id = request.get("id") if isinstance(request, dict) else None
        if req_id is not None:
            # 应答格式与请求对偶：{"id": N, "result": {...}} / {"id": N, "error": "..."}
            if "error" in result:
                write_msg({"id": req_id, "error": result["error"]})
            else:
                write_msg({"id": req_id, "result": result})
        if isinstance(request, dict) and request.get("method") == "shutdown":
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
