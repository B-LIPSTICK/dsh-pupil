# dsh-pupil · 配置向导：配置看图 / 画图后端与 API Key。
# 交互方式与 dsh-eye 技能（skill）完全一致：不选后端，直接填端点 / 模型 / Key，
# 全程回车用免费默认（智谱 glm-4v-flash / cogview-3-flash）。
# 写入位置与技能相同：用户级环境变量（注册表）+ ~/.dsh-eye.json，配置互通、可以共存。
# 用法：.\setup.ps1                 # 交互式向导
#       .\setup.ps1 -DryRun         # 预览（不写入）
#       .\setup.ps1 -Unset          # 清除 dsh-eye 相关配置
#       .\setup.ps1 -SkipGen        # 跳过画图配置
#       .\setup.ps1 -BaseUrl https://open.bigmodel.cn/api/paas/v4 -Model glm-4v-flash -ApiKey sk-xxx
[CmdletBinding()]
param(
  [string]$BaseUrl,
  [string]$Model,
  [string]$ApiKey,
  [string]$GenBaseUrl,
  [string]$GenModel,
  [string]$GenApiKey,
  [switch]$SkipGen,
  [switch]$DryRun,
  [switch]$Unset
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   [!] $msg" -ForegroundColor Yellow }

# 直接写注册表（快）；[Environment]::SetEnvironmentVariable 每次都要向所有窗口
# 广播 WM_SETTINGCHANGE，在部分机器上单次可达 7~8 秒 —— 全部写完再广播一次即可。
function Write-EnvVar([string]$name, [string]$value) {
  if ($DryRun) {
    Write-Host "   (dry-run) 设置用户环境变量 $name = $value"
    return
  }
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  try { $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::String) }
  finally { $key.Close() }
  Write-OK "已写入用户环境变量 $name"
}

function Remove-EnvVar([string]$name) {
  if ($DryRun) {
    Write-Host "   (dry-run) 清除用户环境变量 $name"
    return
  }
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  try { $key.DeleteValue($name, $false) } catch { }
  finally { $key.Close() }
  Write-OK "已清除用户环境变量 $name"
}

# 通知系统环境变量已变更（新开的终端 / 新启动的进程才能读到新值）
function Invoke-EnvBroadcast {
  Add-Type -Namespace DshEye -Name Native -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@ -ErrorAction SilentlyContinue
  $result = [UIntPtr]::Zero
  [DshEye.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, "Environment", 0x0002, 2000, [ref]$result) | Out-Null
}

$ConfigFilePath = Join-Path $env:USERPROFILE ".dsh-eye.json"

# 把当前 DASHEYE_* 汇总写入 ~/.dsh-eye.json。
# 技能脚本在受限沙箱里无法读注册表（子进程被拦），但纯文件读取不受限，
# 所以向导必须双写：注册表（普通终端）+ 配置文件（沙箱内脚本 / 插件）。
function Write-SkillConfigFile {
  if ($DryRun) {
    Write-Host "   (dry-run) 写入配置文件 $ConfigFilePath"
    return
  }
  $cfg = @{}
  foreach ($name in @(
    "DASHEYE_PRESET", "DASHEYE_API_KEY", "DASHEYE_BASE_URL", "DASHEYE_MODEL",
    "DASHEYE_GEN_PRESET", "DASHEYE_GEN_API_KEY", "DASHEYE_GEN_BASE_URL", "DASHEYE_GEN_MODEL", "DASHEYE_GEN_OUT"
  )) {
    $v = [Environment]::GetEnvironmentVariable($name, "User")
    if ($v) { $cfg[$name] = $v }
  }
  $json = $cfg | ConvertTo-Json
  [System.IO.File]::WriteAllText($ConfigFilePath, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-OK "已写入配置文件 $ConfigFilePath"
}

# ---------- 主流程 ----------

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   dsh-pupil 配置向导" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   看图（vision）：描述 / 问答 / OCR + 粘贴图片自动识别" -ForegroundColor DarkGray
Write-Host "   画图（generate）：文字生成图片" -ForegroundColor DarkGray
Write-Host "   与 dsh-eye 技能同款交互：除 API Key 外全程回车用免费默认（智谱）。" -ForegroundColor DarkGray

if ($Unset) {
  Write-Step "清除 dsh-eye 配置"
  foreach ($name in @(
    "DASHEYE_PRESET", "DASHEYE_API_KEY", "DASHEYE_BASE_URL", "DASHEYE_MODEL",
    "DASHEYE_GEN_PRESET", "DASHEYE_GEN_API_KEY", "DASHEYE_GEN_BASE_URL", "DASHEYE_GEN_MODEL", "DASHEYE_GEN_OUT"
  )) {
    Remove-EnvVar $name
  }
  if (-not $DryRun) {
    Remove-Item $ConfigFilePath -Force -ErrorAction SilentlyContinue
    Write-OK "已删除配置文件 $ConfigFilePath"
  }
  Write-Host "`n配置已清除。`n"
  exit 0
}

# 0. 前置检查
Write-Step "检查环境"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 Node.js。请先安装：https://nodejs.org" -ForegroundColor Red
  exit 1
}
Write-OK "Node.js 就绪"

# 1. 看图配置（默认：智谱免费）
Write-Step "配置看图（vision，直接回车用免费默认）"
$vision = @{}
$vision.baseUrl = $BaseUrl
if (-not $vision.baseUrl) {
  $vision.baseUrl = Read-Host "看图端点地址（回车 = 智谱免费）"
  if (-not $vision.baseUrl) { $vision.baseUrl = "https://open.bigmodel.cn/api/paas/v4" }
}
$vision.model = $Model
if (-not $vision.model) {
  $vision.model = Read-Host "看图模型名（回车 = glm-4v-flash）"
  if (-not $vision.model) { $vision.model = "glm-4v-flash" }
}
$vision.apiKey = $ApiKey
if (-not $vision.apiKey) {
  $vision.apiKey = Read-Host "看图 API Key（必填；本地模型可留空）"
}
Write-OK "看图：$($vision.baseUrl) / $($vision.model)"

# 2. 画图配置（可选，默认开启并复用看图）
$gen = $null
if (-not $SkipGen) {
  if ($GenModel) {
    $gen = @{
      baseUrl = if ($GenBaseUrl) { $GenBaseUrl } else { $vision.baseUrl }
      model   = $GenModel
      apiKey  = if ($GenApiKey) { $GenApiKey } else { $vision.apiKey }
    }
    Write-OK "画图：$($gen.baseUrl) / $($gen.model)（$(if ($GenBaseUrl) { '独立端点' } else { '复用看图端点' })）"
  } else {
    $wantGen = Read-Host "`n是否配置画图功能？[Y/n]（回车 = 配置）"
    if ($wantGen -eq "" -or $wantGen -match "^(y|yes|是)$") {
      $reuse = Read-Host "画图是否复用看图的端点与 Key？[Y/n]（回车 = 复用）"
      if ($reuse -eq "" -or $reuse -match "^(y|yes|是)$") {
        $genModel = Read-Host "画图模型名（回车 = cogview-3-flash）"
        if (-not $genModel) { $genModel = "cogview-3-flash" }
        $gen = @{ baseUrl = $vision.baseUrl; model = $genModel; apiKey = $vision.apiKey }
        Write-OK "画图复用看图端点：$($gen.baseUrl) / $($gen.model)"
      } else {
        $genBaseUrl = Read-Host "画图端点地址"
        $genModel   = Read-Host "画图模型名"
        $genApiKey  = Read-Host "画图 API Key（回车复用看图 Key）"
        $gen = @{
          baseUrl = $genBaseUrl
          model   = $genModel
          apiKey  = if ($genApiKey) { $genApiKey } else { $vision.apiKey }
        }
        Write-OK "画图：$($gen.baseUrl) / $($gen.model)"
      }
    }
  }
}
if (-not $gen) {
  Write-Warn "未配置画图（之后可重跑本向导，或手动设置 DASHEYE_GEN_* 环境变量）"
}

# 3. 写入用户环境变量
Write-Step "写入配置（用户级环境变量，永久生效）"
if ($vision.baseUrl) { Write-EnvVar "DASHEYE_BASE_URL" $vision.baseUrl }
if ($vision.model)   { Write-EnvVar "DASHEYE_MODEL" $vision.model }
if ($vision.apiKey)  { Write-EnvVar "DASHEYE_API_KEY" $vision.apiKey }
if ($gen) {
  if ($gen.baseUrl) { Write-EnvVar "DASHEYE_GEN_BASE_URL" $gen.baseUrl }
  if ($gen.model)   { Write-EnvVar "DASHEYE_GEN_MODEL" $gen.model }
  if ($gen.apiKey)  { Write-EnvVar "DASHEYE_GEN_API_KEY" $gen.apiKey }
}
if (-not $DryRun) {
  Invoke-EnvBroadcast
  Write-OK "已通知系统刷新环境变量"
}
Write-SkillConfigFile

# 4. 完成
Write-Host "`n  ============================================" -ForegroundColor Green
Write-Host "   配置完成！" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  下一步："
Write-Host "   1. 重启 dsh web（新进程才会读到新环境变量）"
Write-Host "   2. 任意对话直接粘贴图片即可；模型会自动识别并回答"
Write-Host ""
Write-Host "  手动验证："
Write-Host "   在 dsh web 里粘贴一张图片，模型应能描述其内容"
Write-Host ""
