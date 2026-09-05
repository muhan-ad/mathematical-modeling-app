"""权限门：Agent 工具执行前的分级控制。

权限等级（与渲染端选择器一一对应）：
- readonly  只读：仅允许读取类工具，写/执行一律拒绝
- ask       逐次审批：除读取外，每次执行前都发 approval_request 等用户放行
- workspace 项目内自动：项目目录内的文件操作自动放行；执行类（python/latex）仍需审批
- full      全自动：全部自动放行（路径仍被限制在项目目录内）
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

READ_TOOLS = frozenset({"file_read", "file_list"})
WRITE_TOOLS = frozenset({"file_write", "file_create", "file_delete"})
EXEC_TOOLS = frozenset({"python_exec", "latex_compile"})

PERMISSION_LEVELS = ("readonly", "ask", "workspace", "full")

# 审批等待上限（秒）：超时视为拒绝，避免会话永久卡死
APPROVAL_TIMEOUT_SECONDS = 600


@dataclass
class Decision:
    allowed: bool
    needs_approval: bool
    reason: str


class PermissionGate:
    """根据权限等级决定工具是否放行；需要审批时通过 emit 回调发起请求并阻塞等待。"""

    def __init__(
        self,
        level: str,
        project_dir: str,
        emit: Callable[[str, dict], None],
    ) -> None:
        if level not in PERMISSION_LEVELS:
            raise ValueError(f"未知权限等级：{level}")
        self.level = level
        self.project_dir = project_dir
        self._emit = emit
        self._lock = threading.Lock()
        self._pending: dict[str, threading.Event] = {}
        self._results: dict[str, bool] = {}
        self.aborted = False

    def set_level(self, level: str) -> None:
        if level not in PERMISSION_LEVELS:
            raise ValueError(f"未知权限等级：{level}")
        self.level = level

    def decide(self, tool_name: str, args: dict) -> Decision:
        inside_project = _args_within_project(tool_name, args, self.project_dir)
        if tool_name in READ_TOOLS:
            return Decision(True, False, "")
        if self.level == "readonly":
            return Decision(False, False, "当前权限为「只读」，不允许写入或执行操作")
        if self.level == "ask":
            return Decision(True, True, "当前权限为「逐次审批」")
        if self.level == "workspace":
            if tool_name in EXEC_TOOLS:
                return Decision(True, True, "当前权限为「项目内自动」，执行代码仍需审批")
            if not inside_project:
                return Decision(False, False, "目标路径在项目目录之外，「项目内自动」权限不允许")
            return Decision(True, False, "")
        # full
        if not inside_project:
            return Decision(False, False, "目标路径在项目目录之外，已被安全策略拦截")
        return Decision(True, False, "")

    def request(self, tool_name: str, args: dict) -> tuple[bool, str]:
        """工具入口统一走这里。返回 (是否放行, 拒绝原因)。"""

        decision = self.decide(tool_name, args)
        if not decision.allowed:
            return False, decision.reason
        if not decision.needs_approval:
            self._emit("tool_call", {"tool": tool_name, "args": args, "auto": True})
            return True, ""

        request_id = uuid.uuid4().hex[:12]
        event = threading.Event()
        with self._lock:
            self._pending[request_id] = event
        self._emit(
            "tool_call",
            {"tool": tool_name, "args": args, "auto": False, "requestId": request_id},
        )
        self._emit(
            "approval_request",
            {
                "requestId": request_id,
                "tool": tool_name,
                "args": args,
                "reason": decision.reason,
            },
        )
        approved = event.wait(APPROVAL_TIMEOUT_SECONDS) and self._results.pop(request_id, False)
        with self._lock:
            self._pending.pop(request_id, None)
            self._results.pop(request_id, None)
        if not approved:
            return False, "用户拒绝了本次操作（或等待审批超时）"
        return True, ""

    def resolve_approval(self, request_id: str, approved: bool) -> None:
        with self._lock:
            event = self._pending.get(request_id)
            if event is not None:
                self._results[request_id] = approved
                event.set()


def _args_within_project(tool_name: str, args: dict, project_dir: str) -> bool:
    from .paths import is_within_project

    for key in ("path", "file_path", "workdir"):
        value = args.get(key)
        if isinstance(value, str) and value:
            if not is_within_project(project_dir, value):
                return False
    return True


def gate_tool(
    gate: PermissionGate,
    tool_name: str,
    args: dict,
    run: Callable[[], str],
) -> str:
    """工具包装器：先过权限门，被拒绝时返回给模型一段可读的拒绝说明。"""

    allowed, reason = gate.request(tool_name, args)
    if not allowed:
        return f"[权限拦截] {reason}"
    result = run()
    return result
