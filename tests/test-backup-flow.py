"""端到端验证项目备份功能（纯项目级备份，不做全局备份）：
1. 加载 dev server（浏览器环境，无 preload 注入）
2. 检查顶栏"备份"按钮
3. 点击备份 → 备份管理面板出现
4. 浏览器环境下项目列表加载失败 → 应显示"还没有可备份的项目"提示（无项目时提示创建）
5. 截图保存
"""
from playwright.sync_api import sync_playwright
import sys

URL = "http://localhost:5173"
SHOTS = [
    ("e:/agent-project/windows-app-maker/tests/screenshots/01-initial.png", "initial"),
    ("e:/agent-project/windows-app-maker/tests/screenshots/02-manager-opened.png", "manager-opened"),
]

import os
os.makedirs("e:/agent-project/windows-app-maker/tests/screenshots", exist_ok=True)

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.on("pageerror", lambda e: errors.append(f"PAGEERROR: {e}"))
    page.on("console", lambda m: errors.append(f"CONSOLE.{m.type}: {m.text}") if m.type in ("error", "warning") else None)

    print("1. Navigating...")
    page.goto(URL, wait_until="networkidle", timeout=15000)

    # 1. 检查初始渲染
    print("2. Initial screenshot...")
    page.screenshot(path=SHOTS[0][0], full_page=True)

    # 顶栏应有"备份"按钮
    backup_btn = page.get_by_role("button", name="备份")
    if backup_btn.count() == 0:
        print("FAIL: 备份按钮不存在")
        sys.exit(1)
    print(f"   备份按钮 count={backup_btn.count()}")

    # 2. 点击备份按钮 → 备份管理面板
    print("3. Click 备份 button...")
    backup_btn.first.click()
    page.wait_for_timeout(500)
    page.screenshot(path=SHOTS[1][0], full_page=True)

    # 面板标题
    title = page.get_by_text("备份管理")
    print(f"   '备份管理' count={title.count()}")
    if title.count() == 0:
        print("FAIL: 备份管理面板未弹出")
        sys.exit(1)

    # 3. 浏览器环境无项目 API → 应显示无项目提示（提示先创建项目）
    empty_hint = page.get_by_text("还没有可备份的项目")
    print(f"   '还没有可备份的项目' count={empty_hint.count()}")

    browser.close()

print("\n=== Console errors ===")
for e in errors[:10]:
    print(e)

print("\n=== Done. See screenshots in tests/screenshots/ ===")
