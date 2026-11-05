@echo off
chcp 65001 >nul
title AnyDesk Keshini Tozalash
color 0b

echo ========================================================
echo   🧹 ANYDESK KESHINI TOZALASH VA QAYTA ISHGA TUSHIRISH
echo ========================================================
echo.

:: 1. AnyDesk ishlab turganini tekshirish va barcha jarayonlarini to'xtatish
tasklist /FI "IMAGENAME eq AnyDesk.exe" 2>NUL | find /I /N "AnyDesk.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [!] AnyDesk jarayoni aniqlandi. To'xtatilmoqda...
    taskkill /F /IM AnyDesk.exe /T >nul 2>&1
    timeout /t 1 /nobreak >nul
) else (
    echo [*] AnyDesk ochiq emas, tozalashga tayyor.
)

:: Qoldiq processlarni ham butkul tozalash
taskkill /F /IM AnyDesk.exe >nul 2>&1

:: 2. %AppData%\AnyDesk papkasini butkul o'chirish
set "ANYDESK_DIR=%AppData%\AnyDesk"

if exist "%ANYDESK_DIR%" (
    echo [*] AnyDesk papkasi topildi: %ANYDESK_DIR%
    echo [*] Papka butunlay o'chirilmoqda...
    rd /s /q "%ANYDESK_DIR%" >nul 2>&1
    if exist "%ANYDESK_DIR%" (
        timeout /t 1 /nobreak >nul
        rd /s /q "%ANYDESK_DIR%" >nul 2>&1
    )
    echo [OK] AnyDesk papkasi muvaffaqiyatli o'chirildi!
) else (
    echo [*] AnyDesk papkasi allaqachon toza.
)

echo.
echo ========================================================
echo   ✅ TOZALASH YAKUNLANDI! ANYDESK ISHGA TUSHIRILMOQDA...
echo ========================================================

:: 3. AnyDesk'ni qayta toza holatda ishga tushirish (agar o'rnatilgan bo'lsa)
if exist "%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe" (
    start "" "%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"
) else if exist "%ProgramFiles%\AnyDesk\AnyDesk.exe" (
    start "" "%ProgramFiles%\AnyDesk\AnyDesk.exe"
)

timeout /t 2 >nul
exit

