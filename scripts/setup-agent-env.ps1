# Mathematical Modeling App - Agent environment setup
# Usage (from repo root, PowerShell):  .\scripts\setup-agent-env.ps1
# Effect: creates agent\.venv and installs all Agent Runtime Python deps
# Requires: Python 3.10+ on PATH

$ErrorActionPreference = "Stop"

$pythonCandidates = @("python", "python3", "py")
$python = $null
foreach ($cmd in $pythonCandidates) {
    try {
        $v = & $cmd --version 2>$null
        if ($LASTEXITCODE -eq 0) { $python = $cmd; Write-Host "Using Python: $v ($cmd)"; break }
    } catch { continue }
}
if (-not $python) {
    Write-Error "Python not found. Install Python 3.10+ and add to PATH first. (Tip: or run scripts\setup-python.ps1 to use an embedded Python.)"
    exit 1
}

Push-Location (Join-Path $PSScriptRoot "..")

Write-Host "[1/3] Creating virtual environment agent\.venv ..."
& $python -m venv agent\.venv
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create virtual environment"; exit 1 }

Write-Host "[2/3] Upgrading pip ..."
& agent\.venv\Scripts\python.exe -m pip install --upgrade pip -q

Write-Host "[3/3] Installing Agent dependencies (langgraph / numpy / scipy / pandas / matplotlib, ~500MB)..."
& agent\.venv\Scripts\python.exe -m pip install -r agent\requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Error "Dependency installation failed - check network and retry"; exit 1 }

Write-Host ""
Write-Host "Agent environment ready. Restart the app to use AI chat and solving." -ForegroundColor Green
Write-Host "Note: LaTeX compilation needs a TeX distribution (TeX Live / MiKTeX), optional."
Write-Host "Tip: scripts\setup-portable-tex.ps1 can set up an embedded portable TeX."

Pop-Location
