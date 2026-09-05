"""Agent Runtime 协议闭环测试（mock 模型，不需要真实 API key）。

验证链路：initialize → message → 模型发起 file_create → 权限门(ask)发 approval_request
→ 客户端放行 → 文件落盘 → done。

用法：python tests/agent-protocol-test.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / "agent" / ".venv" / "Scripts" / "python.exe"


def main() -> int:
    if not PYTHON.exists():
        print(f"[FAIL] 未找到 venv python：{PYTHON}")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        project_dir = Path(tmp) / "proj-test"
        for sub in ("problem", "workspace/code", "workspace/notes", "paper"):
            (project_dir / sub).mkdir(parents=True)

        proc = subprocess.Popen(
            [str(PYTHON), "-X", "utf8", "-m", "agent.main"],
            cwd=str(ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )

        def send(method: str, params: dict, req_id: int) -> None:
            proc.stdin.write(json.dumps({"id": req_id, "method": method, "params": params}) + "\n")
            proc.stdin.flush()

        def read_line(timeout: float = 60) -> dict | None:
            deadline = time.time() + timeout
            # stdout 有缓冲读不便设超时，测试里用 stderr watchdog 兜底
            import threading

            result: list[str] = []

            def reader() -> None:
                line = proc.stdout.readline()
                result.append(line)

            t = threading.Thread(target=reader, daemon=True)
            t.start()
            t.join(timeout)
            if not result or not result[0].strip():
                print(f"[FAIL] 等待输出超时（{timeout}s）")
                return None
            return json.loads(result[0])

        def expect_event(name: str, timeout: float = 60) -> dict | None:
            while True:
                msg = read_line(timeout)
                if msg is None:
                    return None
                if "event" in msg and msg["event"]["name"] == name:
                    return msg["event"]
                # 其他事件/应答打出来便于诊断
                kind = "event" if "event" in msg else "result"
                print(f"  < {kind}: {json.dumps(msg.get(kind), ensure_ascii=False)[:160]}")

        # 1. ready
        ready = expect_event("ready")
        if not ready:
            print("[FAIL] 未收到 ready")
            print(proc.stderr.read()[-2000:])
            return 1
        print("[OK] 1/5 ready")

        # 2. initialize（mock provider + ask 权限）
        send(
            "initialize",
            {
                "projectId": "test123",
                "projectDir": str(project_dir),
                "permission": "ask",
                "effort": "off",
                "provider": {"type": "mock", "model": "mock-1", "baseUrl": "", "apiKey": ""},
            },
            1,
        )
        msg = read_line()
        if not msg or "result" not in msg or not msg["result"].get("ok"):
            print(f"[FAIL] initialize 失败：{msg}")
            print(proc.stderr.read()[-2000:])
            return 1
        print("[OK] 2/5 initialize")

        # 2.5 技能表热更新（set_skills）
        send("set_skills", {"skills": [{"name": "demo", "description": "测试技能"}], "dir": str(project_dir)}, 10)
        msg = read_line()
        if not msg or "result" not in msg or not msg["result"].get("ok"):
            print(f"[FAIL] set_skills 失败：{msg}")
            return 1
        print("[OK] 2.5 set_skills 热更新")

        # 3. 发消息 → 应触发 approval_request（file_create，ask 权限）
        send("message", {"text": "请创建一个测试文件"}, 2)
        approval = expect_event("approval_request")
        if not approval:
            print("[FAIL] 未收到 approval_request")
            print(proc.stderr.read()[-2000:])
            return 1
        print(f"[OK] 3/5 approval_request（tool={approval['tool']}）")

        # 4. 放行 → 文件应落盘 → done
        send("approval", {"requestId": approval["requestId"], "approved": True}, 3)
        done = expect_event("done")
        if not done or not done.get("ok"):
            print(f"[FAIL] done 异常：{done}")
            print(proc.stderr.read()[-2000:])
            return 1
        if "skillsUsed" not in done:
            print(f"[FAIL] done 事件缺少 skillsUsed 字段：{done}")
            return 1
        target = project_dir / "workspace/notes/mock.txt"
        if not target.exists() or "mock" not in target.read_text("utf-8"):
            print("[FAIL] 文件未落盘或内容不对")
            return 1
        print("[OK] 4/5 文件落盘 + done")

        # 5. 会话记录 + 拒绝路径
        conv = (project_dir / "conversation.jsonl").read_text("utf-8").strip().splitlines()
        if len(conv) < 2:
            print(f"[FAIL] conversation.jsonl 记录不足：{len(conv)} 条")
            return 1
        # 再来一轮：拒绝执行
        send("message", {"text": "再创建一个文件"}, 4)
        approval2 = expect_event("approval_request")
        if not approval2:
            print("[FAIL] 第二轮未收到 approval_request")
            return 1
        send("approval", {"requestId": approval2["requestId"], "approved": False}, 5)
        done2 = expect_event("done")
        if not done2:
            print("[FAIL] 第二轮未收到 done")
            return 1
        print("[OK] 5/5 拒绝路径 + 会话记录")

        send("shutdown", {}, 6)
        proc.wait(timeout=10)
        print("\n[PASS] Agent Runtime 协议闭环测试全部通过")
        return 0


if __name__ == "__main__":
    sys.exit(main())
