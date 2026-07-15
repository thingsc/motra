@echo off
rem ============================================================
rem  One-click offline test (no hardware needed, run from THIS folder)
rem    1) codec unit tests (pytest)
rem    2) mock-target selftest
rem ============================================================
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found. Install Python and add it to PATH.
  pause
  exit /b 1
)

echo === [1/2] unit tests (pytest) ===
python -m pytest tests/ -q
set "RC=%errorlevel%"

echo.
echo === [2/2] mock-target selftest ===
python tools\mock_target.py --selftest
if errorlevel 1 set "RC=1"

echo.
if "%RC%"=="0" (
  echo RESULT: ALL PASSED
) else (
  echo RESULT: FAILURES ABOVE
)
pause
exit /b %RC%
