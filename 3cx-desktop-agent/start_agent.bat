@echo off
title 3CX Desktop Agent
cd /d "%~dp0"

echo ======================================================
echo  3CX Desktop Reject Monitor Agent
echo ======================================================
echo.

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Node.js topildi, Node.js orqali ishga tushirilmoqda...
    node agent.js
) else (
    echo [INFO] PowerShell orqali ishga tushirilmoqda...
    powershell -ExecutionPolicy Bypass -File "%~dp0agent.ps1"
)

pause
