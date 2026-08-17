# dsh-pupil · 一键安装（PowerShell 版）
# 用法：  .\install.ps1            # 安装到 web profile（默认）
#         .\install.ps1 -Profile desktop
#         .\install.ps1 -SkipSetup # 跳过配置向导
[CmdletBinding()]
param(
  [string]$Profile = "web",
  [switch]$SkipSetup,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Err([string]$msg)  { Write-Host "   [x] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   dsh-pupil 一键安装（profile: $Profile）" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan

# 1. 检查环境
Write-Step "检查环境"
$nodeOk = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeOk) { Write-Err "未找到 node。请先安装 Node.js 18+：https://nodejs.org"; exit 1 }
Write-OK "node: $((node --version))"

$dshOk = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dshOk) {
  Write-Err "未找到 dsh 命令。请先安装 DeepSeek Harness CLI：npm install -g @deepseek-ai/dsh"
  exit 1
}
Write-OK "dsh: $((dsh --version 2>$null))"

if ($DryRun) { Write-Host "   [DryRun] 环境检查通过，停止。" -ForegroundColor Yellow; return }

# 2. 打包插件（本地 npm pack，无需发布）
Write-Step "[1/3] 打包插件"

# BOM 防护：package.json 若带 UTF-8 BOM，JSON.parse 会拒绝、dsh web 直接起不来。
# PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM，这里打包前强制剥离。
$pkgJson = Join-Path $here "package.json"
if (Test-Path $pkgJson) {
  $pkgBytes = [System.IO.File]::ReadAllBytes($pkgJson)
  if ($pkgBytes.Length -ge 3 -and $pkgBytes[0] -eq 0xEF -and $pkgBytes[1] -eq 0xBB -and $pkgBytes[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($pkgJson, $pkgBytes[3..($pkgBytes.Length - 1)])
    Write-Host "   [!] 检测到 package.json 带 UTF-8 BOM，已自动剥离（避免 dsh web 启动失败）。" -ForegroundColor Yellow
  }
}

$packOut = & npm pack "$here" --pack-destination "$here" 2>$null
$tgz = $packOut | Where-Object { $_ -match '\.tgz$' } | Select-Object -Last 1
if (-not $tgz -or -not (Test-Path (Join-Path $here $tgz))) {
  Write-Err "npm pack 失败：$tgz"
  exit 1
}
$tgzPath = Join-Path $here $tgz
Write-OK "打包完成：$tgz"

# 3. 安装到 profile
Write-Step "[2/3] 安装到 profile '$Profile'"
& dsh plugin --profile $Profile add $tgzPath
if ($LASTEXITCODE -ne 0) {
  Write-Err "dsh plugin add 失败（退出码 $LASTEXITCODE）。"
  Write-Host "   可尝试手动执行：dsh plugin --profile $Profile add $tgzPath"
  exit 1
}
Write-OK "插件已注册到 profile '$Profile'"
Write-Host "   （保留 $tgz 供 pnpm 后续解析；升级请重新运行本脚本）" -ForegroundColor DarkGray

# 4. 配置向导
Write-Step "[3/3] 配置向导（可全部回车用免费默认）"
if (-not $SkipSetup) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "setup.ps1")
  if ($LASTEXITCODE -ne 0) { Write-Host "   [!] 配置向导未完成，可稍后手动运行 setup.ps1" -ForegroundColor Yellow }
} else {
  Write-Host "   已跳过配置向导（-SkipSetup）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   ✅ 安装完成！" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   最后一步：重启 dsh web（关闭窗口后重新运行 dsh web）" -ForegroundColor DarkGray
Write-Host "   然后用任意模型直接【粘贴/上传图片】即可——" -ForegroundColor DarkGray
Write-Host "   对话里照常显示图片，模型会自动识别内容并回答。" -ForegroundColor DarkGray
Write-Host ""
