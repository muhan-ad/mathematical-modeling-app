# Windows App Maker - 便携 LaTeX 环境一键装配脚本（TinyTeX 发行版）
# 用法：在项目根目录用 PowerShell 执行  .\scripts\setup-portable-tex.ps1
# 效果：下载 TinyTeX-1 到 vendor\texlive\（应用优先使用），并安装中文排版支持
# 仓库本身不含 TeX 二进制（本目录已在 .gitignore 排除）
# 可选：国内加速  .\scripts\setup-portable-tex.ps1 -Mirror tuna

param(
    [string]$Mirror = ""   # 传 "tuna" 使用清华 CTAN 镜像，默认官方源
)

$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot ".."
$vendor = Join-Path $root "vendor"
$target = Join-Path $vendor "texlive"
$targetBin = Join-Path $target "bin\windows"
$targetXelatex = Join-Path $targetBin "xelatex.exe"

if (Test-Path $targetXelatex) {
    Write-Host "便携 TeX 已存在于 $target ，无需重复安装。" -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Force -Path $vendor | Out-Null

# 1. 下载 TinyTeX-1（约 100MB，含 xelatex 与常用宏包）
$zip = Join-Path $env:TEMP "TinyTeX-1.zip"
$url = "https://github.com/rstudio/tinytex-releases/releases/latest/download/TinyTeX-1.zip"
Write-Host "[1/4] 下载 TinyTeX-1（约 100MB）..."
Invoke-WebRequest -Uri $url -OutFile $zip

# 2. 解压到 vendor\，内层目录 TinyTeX 改名为 texlive
Write-Host "[2/4] 解压到 vendor\ ..."
Expand-Archive -Path $zip -DestinationPath $vendor -Force
$inner = Join-Path $vendor "TinyTeX"
if (-not (Test-Path (Join-Path $inner "bin\windows\xelatex.exe"))) {
    Write-Error "解压后未找到 xelatex.exe，下载包可能不完整"
    exit 1
}
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Move-Item $inner $target
Remove-Item $zip -Force

# 3. 可选：切换国内镜像
$tlmgr = Join-Path $targetBin "tlmgr.bat"
if ($Mirror -eq "tuna") {
    Write-Host "[3/4] 切换到清华 CTAN 镜像..."
    & $tlmgr option repository https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet
} else {
    Write-Host "[3/4] 使用默认 CTAN 源..."
}

# 4. 安装中文排版与数模常用宏包（ctex 会自动带上 xecjk/zhnumber 等依赖）
Write-Host "[4/4] 安装 ctex 中文排版与常用宏包（约 10-20 分钟，取决于网速）..."
& $tlmgr install ctex booktabs multirow titlesec enumitem siunitx
if ($LASTEXITCODE -ne 0) {
    Write-Warning "宏包安装返回非零，可重试：& `"$tlmgr`" install ctex"
    exit 1
}

Write-Host ""
Write-Host "便携 TeX 环境装配完成：$target" -ForegroundColor Green
Write-Host "应用「编译论文」按钮将优先使用该环境（无需系统安装 MiKTeX/TeX Live）。"
