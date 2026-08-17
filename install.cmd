# dsh-eye · 一键安装脚本（cmd 入口，双击 / 命令行通用）
@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo  dsh-eye 一键安装
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo [安装失败] 请查看上方错误信息。
  pause
  exit /b 1
)
echo.
echo 安装完成！请重启 dsh web（关闭窗口后重新运行 dsh web）。
pause
