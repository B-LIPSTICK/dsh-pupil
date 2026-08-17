# dsh-pupil · 配置向导（可独立运行；install.ps1 安装完成后会自动调用）
[CmdletBinding()]
param(
  [switch]$DryRun          # 只预览，不写入
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $HOME ".dsh-eye.json"

function Read-Key([string]$prompt) {
  $sec = Read-Host -Prompt $prompt -AsSecureString
  if ($null -eq $sec) { return "" }
  $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host ""
Write-Host "============================================"
Write-Host " dsh-pupil 配置向导"
Write-Host "============================================"
Write-Host " 看图（vision）：描述 / 问答 / OCR + 粘贴图片自动识别"
Write-Host " 画图（generate）：文字生成图片"
Write-Host " 两套后端独立配置；全部可回车用免费默认（智谱）。"
Write-Host ""

# ---- 看图 ----
Write-Host "【看图后端】"
Write-Host "  1) 智谱 glm（免费：glm-4v-flash）  ← 推荐，回车默认"
Write-Host "  2) 阿里云 qwen（qwen-vl-max）"
Write-Host "  3) OpenAI（gpt-4o，需代理）"
Write-Host "  4) 本地 Ollama（llava，离线免费）"
$visionChoice = Read-Host "选择 [1]"
$visionPreset = switch ($visionChoice) {
  "2" { "qwen" }
  "3" { "openai" }
  "4" { "ollama" }
  default { "glm" }
}
if ($visionPreset -eq "ollama") {
  Write-Host "  本地 Ollama 无需 Key，请确保 Ollama 已安装并拉取 llava。"
  $visionKey = ""
  $visionBase = ""
  $visionModel = ""
} else {
  $visionKey = Read-Key "看图 API Key（回车跳过 = 稍后手动填，或选 ollama）"
  $visionBase = Read-Host "看图 API 地址（回车用预设默认）"
  $visionModel = Read-Host "看图模型名（回车用预设默认）"
}

# ---- 画图 ----
Write-Host ""
Write-Host "【画图后端】（可留空复用看图配置）"
Write-Host "  1) 智谱 glm（cogview-3-flash 免费）  ← 回车默认"
Write-Host "  2) 阿里云 qwen（wanx2.1-t2i-flash）"
Write-Host "  3) OpenAI（gpt-image-1）"
Write-Host "  0) 不配置画图"
$genChoice = Read-Host "选择 [1]"
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
  $genKey = Read-Key "画图 API Key（回车复用看图 Key）"
  $genBase = Read-Host "画图 API 地址（回车用预设默认）"
  $genModel = Read-Host "画图模型名（回车用预设默认）"
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

# 合并已有配置
$existing = @{}
if (Test-Path $configPath) {
  try { $existing = Get-Content $configPath -Raw | ConvertFrom-Json -AsHashtable } catch { $existing = @{} }
}
foreach ($k in $envMap.Keys) { $existing[$k] = $envMap[$k] }

Write-Host ""
Write-Host "将要写入 $configPath ："
foreach ($k in $existing.Keys | Sort-Object) {
  $v = $existing[$k]
  if ($k -match "KEY") { $v = "***" }
  Write-Host ("  {0} = {1}" -f $k, $v)
}

if ($DryRun) {
  Write-Host ""
  Write-Host "[DryRun] 未写入任何文件。"
  return
}

$json = $existing | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host ""
Write-Host "✅ 配置已保存到 $configPath （插件与 dsh-eye 技能共用）"
Write-Host "   重启 dsh web 后即可直接粘贴图片使用。"
