@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 --version >nul 2>&1
if not errorlevel 1 (
  py -3 "%~dp0backend\server.py"
  pause
  exit /b
)
python --version >nul 2>&1
if not errorlevel 1 (
  python "%~dp0backend\server.py"
  pause
  exit /b
)
echo Python 3.10 or newer was not found.
echo Install Python from https://www.python.org/downloads/windows/
echo Then double-click this file again. No pip packages are required.
pause
