# Mathematical Modeling App - Portable LaTeX environment setup (TinyTeX distribution)
# Usage (from repo root, PowerShell):  .\scripts\setup-portable-tex.ps1 [-Mirror tuna]
# Effect: downloads TinyTeX-1 into vendor\texlive\ (preferred by the app) and
#         installs Chinese typesetting (ctex) plus common packages.
# The repo never contains TeX binaries (vendor/ is gitignored).
# App lookup order: vendor\texlive -> system PATH xelatex -> friendly error.

param(
    [string]$Mirror = ""   # pass "tuna" to use the Tsinghua CTAN mirror
)

$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
$vendor = Join-Path $root "vendor"
$target = Join-Path $vendor "texlive"
$targetBin = Join-Path $target "bin\windows"
$targetXelatex = Join-Path $targetBin "xelatex.exe"

if (Test-Path $targetXelatex) {
    Write-Host "Portable TeX already exists at $target - nothing to do." -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Force -Path $vendor | Out-Null

# 1. Download TinyTeX-1 (~100MB, includes xelatex + common packages)
$zip = Join-Path $env:TEMP "TinyTeX-1.zip"
$url = "https://github.com/rstudio/tinytex-releases/releases/latest/download/TinyTeX-1.zip"
Write-Host "[1/4] Downloading TinyTeX-1 (~100MB)..."
Invoke-WebRequest -Uri $url -OutFile $zip

# 2. Extract to vendor\ and rename inner TinyTeX dir to texlive
Write-Host "[2/4] Extracting to vendor\ ..."
Expand-Archive -Path $zip -DestinationPath $vendor -Force
$inner = Join-Path $vendor "TinyTeX"
if (-not (Test-Path (Join-Path $inner "bin\windows\xelatex.exe"))) {
    Write-Error "xelatex.exe not found after extraction - download may be incomplete"
    exit 1
}
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Move-Item $inner $target
Remove-Item $zip -Force

# 3. Optional mirror
$tlmgr = Join-Path $targetBin "tlmgr.bat"
if ($Mirror -eq "tuna") {
    Write-Host "[3/4] Switching to Tsinghua CTAN mirror..."
    & $tlmgr option repository https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet
} else {
    Write-Host "[3/4] Using default CTAN repository..."
}

# 4. Install Chinese typesetting + common packages (ctex pulls xecjk/zhnumber deps)
Write-Host "[4/4] Installing ctex + common packages (10-20 min depending on network)..."
& $tlmgr install ctex booktabs multirow titlesec enumitem siunitx
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Package install returned non-zero. Retry with: & `"$tlmgr`" install ctex"
    exit 1
}

Write-Host ""
Write-Host "Portable TeX environment ready: $target" -ForegroundColor Green
Write-Host "The app Compile button will now prefer this environment (no MiKTeX/TeX Live needed)."
