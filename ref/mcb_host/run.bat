@echo off
rem ============================================================
rem  One-click launcher for the mcb_host GUI (run from THIS folder)
rem  Default COM3 / 1500000. Override by passing args, e.g.:
rem     run.bat --port COM5 --baud 115200
rem ============================================================
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found. Install Python and add it to PATH.
  pause
  exit /b 1
)

if "%~1"=="" (
  set "ARGS=--port COM3 --baud 1500000"
) else (
  set "ARGS=%*"
)

echo Launching: python __main__.py %ARGS%
python "%~dp0__main__.py" %ARGS%

if errorlevel 1 (
  echo.
  echo [HINT] Abnormal exit. Common causes: wrong/busy COM port, or baud not supported.
  pause
)
