@echo off
rem Windows (cmd / PowerShell): .\sfp status  — то же, что ./sfp в Linux/macOS
chcp 65001 >nul
set PYTHONUTF8=1
where python >nul 2>nul && (python "%~dp0tools\sfp.py" %* & exit /b %errorlevel%)
where py >nul 2>nul && (py -3 "%~dp0tools\sfp.py" %* & exit /b %errorlevel%)
echo Python 3.11+ не найден: установите с python.org и отметьте "Add python.exe to PATH". 1>&2
exit /b 9009
