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

Write-Host "============================================"
Write-Host " dsh-pupil 一键安装（profile: $Profile）"
Write-Host "============================================"

# 1. 检查环境
$nodeOk = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeOk) { Write-Host "❌ 未找到 node。请先安装 Node.js 18+：https://nodejs.org"; exit 1 }
Write-Host "✅ node: $((node --version))"

$dshOk = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dshOk) {
  Write-Host "❌ 未找到 dsh 命令。请先安装 DeepSeek Harness CLI：npm install -g @deepseek-ai/dsh"
  exit 1
}
Write-Host "✅ dsh: $((dsh --version 2>$null))"

if ($DryRun) { Write-Host "[DryRun] 环境检查通过，停止。"; return }

# 2. 打包插件（本地 npm pack，无需发布）
Write-Host "`n[1/3] 打包插件..."
$tgz = & npm pack "$here" --pack-destination "$here" 2>&1 | Select-Object -Last 1
if (-not $tgz -or -not (Test-Path (Join-Path $here $tgz))) {
  Write-Host "❌ npm pack 失败：$tgz"
  exit 1
}
$tgzPath = Join-Path $here $tgz
Write-Host "✅ 打包完成：$tgz"

# 3. 安装到 profile
Write-Host "`n[2/3] 安装到 profile '$Profile'..."
& dsh plugin --profile $Profile add $tgzPath
if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ dsh plugin add 失败（退出码 $LASTEXITCODE）。"
  Write-Host "   可尝试手动执行：dsh plugin --profile $Profile add $tgzPath"
  exit 1
}
Write-Host "✅ 插件已注册到 profile '$Profile'"
Write-Host "   （保留 $tgz 供 pnpm 后续解析；升级请重新运行本脚本）"

# 4. 配置向导
if (-not $SkipSetup) {
  Write-Host "`n[3/3] 配置向导（可全部回车用免费默认）..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "setup.ps1")
  if ($LASTEXITCODE -ne 0) { Write-Host "⚠️ 配置向导未完成，可稍后手动运行 setup.ps1" }
} else {
  Write-Host "`n[3/3] 已跳过配置向导（-SkipSetup）"
}

Write-Host ""
Write-Host "============================================"
Write-Host " ✅ 安装完成！"
Write-Host " 最后一步：重启 dsh web（关闭窗口后重新运行 dsh web）"
Write-Host " 然后用任意模型直接【粘贴/上传图片】即可——"
Write-Host " 对话里照常显示图片，模型会自动识别内容并回答。"
Write-Host "============================================"
