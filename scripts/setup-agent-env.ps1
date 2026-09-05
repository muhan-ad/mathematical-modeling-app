# Windows App Maker - Agent 环境一键配置脚本
# 用法：在项目根目录用 PowerShell 执行  .\scripts\setup-agent-env.ps1
# 作用：创建 agent/.venv 并安装 Agent Runtime 全部 Python 依赖
# 要求：本机已安装 Python 3.10+（python 在 PATH 中）

$ErrorActionPreference = "Stop"

$pythonCandidates = @("python", "python3", "py")
$python = $null
foreach ($cmd in $pythonCandidates) {
    try {
        $v = & $cmd --version 2>$null
        if ($LASTEXITCODE -eq 0) { $python = $cmd; Write-Host "使用 Python：$v ($cmd)"; break }
    } catch { continue }
}
if (-not $python) {
    Write-Error "未找到 Python。请安装 Python 3.10+ 并加入 PATH 后重试。"
    exit 1
}

Push-Location (Join-Path $PSScriptRoot "..")

Write-Host "[1/3] 创建虚拟环境 agent/.venv ..."
& $python -m venv agent\.venv
if ($LASTEXITCODE -ne 0) { Write-Error "创建虚拟环境失败"; exit 1 }

Write-Host "[2/3] 升级 pip ..."
& agent\.venv\Scripts\python.exe -m pip install --upgrade pip -q

Write-Host "[3/3] 安装 Agent 依赖（langgraph / langchain / numpy / scipy / pandas / matplotlib 等，约 500MB，请耐心等待）..."
& agent\.venv\Scripts\python.exe -m pip install -r agent\requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Error "依赖安装失败，请检查网络后重试"; exit 1 }

Write-Host ""
Write-Host "Agent 环境配置完成。重新启动应用即可使用 AI 对话与求解功能。" -ForegroundColor Green
Write-Host "注意：LaTeX 编译功能需另装 TeX 发行版（TeX Live / MiKTeX），可选。"

Pop-Location
