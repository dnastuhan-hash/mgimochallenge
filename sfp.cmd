@echo off
rem Windows wrapper (cmd / PowerShell): .\sfp.cmd status  -- same as ./sfp on Linux/macOS
setlocal
set PYTHONUTF8=1
chcp 65001 >nul
set "PYEXE="
rem Check by running Python: the Microsoft Store stub "python.exe" fails here and is skipped
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PYEXE=python"
if not defined PYEXE (py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PYEXE=py -3")
if not defined PYEXE (
  echo Python 3.11+ not found. Install it from python.org and tick "Add python.exe to PATH". 1>&2
  exit /b 9009
)
%PYEXE% "%~dp0tools\sfp.py" %*
exit /b %errorlevel%
