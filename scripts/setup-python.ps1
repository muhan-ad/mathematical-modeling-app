# Mathematical Modeling App - Embedded Python environment setup
# Usage (from repo root, PowerShell):  .\scripts\setup-python.ps1
# Effect: downloads python-build-standalone CPython into vendor\python\
#         and installs agent/requirements.txt into it.
# The repo never contains Python binaries (vendor/ is gitignored).
# App lookup order: vendor\python (embedded) -> agent\.venv -> system python.

$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
$vendor = Join-Path $root "vendor"
$target = Join-Path $vendor "python"
$targetPython = Join-Path $target "python.exe"

if (Test-Path $targetPython) {
    Write-Host "Embedded Python already exists at $target - skipping download." -ForegroundColor Green
} else {
    New-Item -ItemType Directory -Force -Path $vendor | Out-Null

    # 1. Discover latest CPython 3.13 Windows build from python-build-standalone
    Write-Host "[1/4] Querying latest python-build-standalone release..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest" `
        -Headers @{ "User-Agent" = "mathematical-modeling-app-setup" }
    $asset = $release.assets | Where-Object { $_.name -like "cpython-3.13*-x86_64-pc-windows-msvc-install_only.tar.gz" } |
        Select-Object -First 1
    if (-not $asset) { Write-Error "No matching CPython 3.13 Windows asset found"; exit 1 }
    Write-Host "    Found: $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)"

    # 2. Download
    $tgz = Join-Path $env:TEMP $asset.name
    Write-Host "[2/4] Downloading..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tgz

    # 3. Extract (tarball top-level dir is python\ -> lands at vendor\python)
    Write-Host "[3/4] Extracting to vendor\python ..."
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    tar -xzf $tgz -C $vendor
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $vendor "python"))) {
        Remove-Item $tgz -Force -ErrorAction SilentlyContinue
        Write-Error "tar extraction failed (exit=$LASTEXITCODE). Fallback: run scripts\setup-python.ps1 again, or extract manually with python -m tarfile"
        exit 1
    }
    Remove-Item $tgz -Force
    if (-not (Test-Path $targetPython)) { Write-Error "python.exe not found after extraction"; exit 1 }
}

# 4. Install Agent dependencies into the embedded environment
Write-Host "[4/4] Installing Agent dependencies (langgraph / numpy / scipy / pandas / matplotlib, ~500MB)..."
& $targetPython -m pip install -r (Join-Path $root "agent\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Error "Dependency installation failed - check network and retry"; exit 1 }

& $targetPython --version
Write-Host ""
Write-Host "Embedded Python environment ready: $target" -ForegroundColor Green
Write-Host "The app will prefer this environment (no system Python needed)."
