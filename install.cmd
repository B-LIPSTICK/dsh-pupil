@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo  dsh-pupil one-click installer
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo [FAILED] see messages above.
  pause
  exit /b 1
)
echo.
echo Done. Restart dsh web to activate.
pause
