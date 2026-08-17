# dsh-eye · 配置向导（可独立运行；install.ps1 安装完成后会自动调用）
[CmdletBinding()]
param(
  [switch]$DryRun          # 只预览，不写入
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $HOME ".dsh-eye.json"

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   [!] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host "   [x] $msg" -ForegroundColor Red }

function Read-Key([string]$prompt) {
  $sec = Read-Host -Prompt $prompt -AsSecureString
  if ($null -eq $sec) { return "" }
  $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   dsh-eye 配置向导" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   看图（vision）：描述 / 问答 / OCR + 粘贴图片自动识别" -ForegroundColor DarkGray
Write-Host "   画图（generate）：文字生成图片" -ForegroundColor DarkGray
Write-Host "   两套后端独立配置；全部可回车用免费默认（智谱）。" -ForegroundColor DarkGray
Write-Host ""

# ---- 看图 ----
Write-Step "配置看图后端"
Write-Host "   1) 智谱 glm（免费：glm-4v-flash）  ← 推荐，回车默认" -ForegroundColor Green
Write-Host "   2) 阿里云 qwen（qwen-vl-max）" -ForegroundColor Gray
Write-Host "   3) OpenAI（gpt-4o，需代理）" -ForegroundColor Gray
Write-Host "   4) 本地 Ollama（llava，离线免费）" -ForegroundColor Gray
$visionChoice = Read-Host "   选择 [1]"
$visionPreset = switch ($visionChoice) {
  "2" { "qwen" }
  "3" { "openai" }
  "4" { "ollama" }
  default { "glm" }
}
if ($visionPreset -eq "ollama") {
  Write-OK "本地 Ollama 无需 Key（请确保已安装并拉取 llava）"
  $visionKey = ""
  $visionBase = ""
  $visionModel = ""
} else {
  $visionKey = Read-Key "   看图 API Key（回车跳过 = 稍后手动填）"
  $visionBase = Read-Host "   看图 API 地址（回车用预设默认）"
  $visionModel = Read-Host "   看图模型名（回车用预设默认）"
}
Write-OK "看图：$($visionPreset) / $($visionModel)"

# ---- 画图 ----
Write-Step "配置画图后端"
Write-Host "   1) 智谱 glm（cogview-3-flash 免费）  ← 回车默认" -ForegroundColor Green
Write-Host "   2) 阿里云 qwen（wanx2.1-t2i-flash）" -ForegroundColor Gray
Write-Host "   3) OpenAI（gpt-image-1）" -ForegroundColor Gray
Write-Host "   0) 不配置画图" -ForegroundColor Gray
$genChoice = Read-Host "   选择 [1]"
$genPreset = switch ($genChoice) {
  "2" { "qwen" }
  "3" { "openai" }
  "0" { "" }
  default { "glm" }
}
$genKey = ""
$genBase = ""
$genModel = ""
if ($genPreset -ne "") {
  $genKey = Read-Key "   画图 API Key（回车复用看图 Key）"
  $genBase = Read-Host "   画图 API 地址（回车用预设默认）"
  $genModel = Read-Host "   画图模型名（回车用预设默认）"
  Write-OK "画图：$($genPreset) / $($genModel)"
} else {
  Write-Warn "未配置画图（之后可重跑本向导）"
}

# ---- 写入 ----
$envMap = @{
  DASHEYE_PRESET = $visionPreset
  DASHEYE_GEN_PRESET = if ($genPreset) { $genPreset } else { "openai" }
}
if ($visionKey) { $envMap.DASHEYE_API_KEY = $visionKey }
if ($visionBase) { $envMap.DASHEYE_BASE_URL = $visionBase }
if ($visionModel) { $envMap.DASHEYE_MODEL = $visionModel }
if ($genKey) { $envMap.DASHEYE_GEN_API_KEY = $genKey }
if ($genBase) { $envMap.DASHEYE_GEN_BASE_URL = $genBase }
if ($genModel) { $envMap.DASHEYE_GEN_MODEL = $genModel }

# 合并已有配置（不覆盖未涉及的键）
$existing = @{}
if (Test-Path $configPath) {
  try { $existing = Get-Content $configPath -Raw | ConvertFrom-Json -AsHashtable } catch { $existing = @{} }
}
foreach ($k in $envMap.Keys) { $existing[$k] = $envMap[$k] }

Write-Step "写入配置（$configPath）"
foreach ($k in $existing.Keys | Sort-Object) {
  $v = $existing[$k]
  if ($k -match "KEY") { $v = "***" }
  Write-Host "   $k = $v" -ForegroundColor DarkGray
}

if ($DryRun) {
  Write-Warn "DryRun：未写入任何文件。"
  return
}

$json = $existing | ConvertTo-Json
# 必须无 BOM 写入（带 BOM 的 JSON 会被脚本/工具 JSON.parse 拒绝）
[System.IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-OK "配置已保存（插件与 dsh-eye 技能共用）"

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   配置完成！" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   下一步：重启 dsh web 后直接粘贴图片即可使用。" -ForegroundColor DarkGray
Write-Host "   想改配置？重跑本向导即可。" -ForegroundColor DarkGray
Write-Host ""
