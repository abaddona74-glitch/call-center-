@echo off
chcp 65001 > nul
echo ====================================================
echo  Call Center Viewer (Port 3005) Serverga Joylash
echo ====================================================
echo.

where node >nul 2>nul
if %errorlevel% equ 0 (
    node scripts/deploy.js
) else (
    echo [INFO] Node.js topilmadi. PowerShell orqali to'g'ridan-to'g'ri deploy qilinmoqda...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1"
)

echo.
pause
