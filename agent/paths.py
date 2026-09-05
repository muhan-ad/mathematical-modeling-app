"""项目目录安全约束：所有文件工具的路径必须落在项目目录内。"""

from __future__ import annotations

from pathlib import Path


def resolve_in_project(project_dir: str, user_path: str) -> Path:
    """把用户传入的相对/绝对路径解析到项目目录内。

    相对路径以项目目录为根；绝对路径若不在项目目录内则抛出 ValueError。
    """
    root = Path(project_dir).resolve()
    candidate = Path(user_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"路径越界：{user_path} 不在项目目录内")
    return resolved


def is_within_project(project_dir: str, user_path: str) -> bool:
    try:
        resolve_in_project(project_dir, user_path)
        return True
    except (ValueError, OSError):
        return False
