@echo off
title 3CX Agent Startup Installer
cd /d "%~dp0"

echo ======================================================
echo  3CX Agentni Windows Avto-Yuklanishga (Startup) Qoyish
echo ======================================================
echo.

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_VBS=%~dp0start_agent_hidden.vbs"
set "SHORTCUT_PATH=%STARTUP_DIR%\3CX_CallCenter_Agent.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [MUVAFFAQIYATLI] 3CX Agent kompyuter yonganda avtomatik fonda ishga tushadigan qilindi!
    echo Joylashuv: %SHORTCUT_PATH%
    echo.
    echo Hozir fonda ishga tushirish uchun start_agent_hidden.vbs ishga tushirilmoqda...
    start "" wscript.exe "%TARGET_VBS%"
) else (
    echo [XATOLIK] Startup faylini yaratib bolmadi.
)

echo.
pause
