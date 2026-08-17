# dsh-pupil · 配置向导 cmd 入口
@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 (
  echo.
  echo [配置失败] 请查看上方错误信息。
  pause
  exit /b 1
)
pause
