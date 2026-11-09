@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM =========================================================================
REM   ANYDESK KESHINI TOZALASH VA QAYTA ISHGA TUSHIRISH [V2.0 PRO]
REM   Xususiyatlari:
REM     - Avtomatik Administrator (UAC) so'rovi (Run as Administrator)
REM     - Moslashuvchan parametrlar (/silent, /norestart, /all, /nolog, /help)
REM     - Jarayon va xizmatlarni xavfsiz to'xtatish
REM     - Kesh va nosoz fayllarni to'liq tozalash
REM =========================================================================

title AnyDesk Keshini Tozalash

REM -------------------------------------------------------------------------
REM 0. PARAMETRLARNI TAHLIL QILISH
REM -------------------------------------------------------------------------
set "PARAM_SILENT=0"
set "PARAM_NORESTART=0"
set "PARAM_ALL=0"
set "PARAM_NOLOG=0"
set "PARAM_HELP=0"

for %%A in (%*) do (
    if /I "%%A"=="/silent"    set "PARAM_SILENT=1"
    if /I "%%A"=="-s"         set "PARAM_SILENT=1"
    if /I "%%A"=="/q"         set "PARAM_SILENT=1"
    if /I "%%A"=="/quiet"     set "PARAM_SILENT=1"
    
    if /I "%%A"=="/norestart" set "PARAM_NORESTART=1"
    if /I "%%A"=="-nr"        set "PARAM_NORESTART=1"
    if /I "%%A"=="/nr"        set "PARAM_NORESTART=1"
    
    if /I "%%A"=="/all"       set "PARAM_ALL=1"
    if /I "%%A"=="-a"         set "PARAM_ALL=1"
    if /I "%%A"=="/full"      set "PARAM_ALL=1"
    
    if /I "%%A"=="/nolog"     set "PARAM_NOLOG=1"
    if /I "%%A"=="-nl"        set "PARAM_NOLOG=1"
    
    if /I "%%A"=="/help"      set "PARAM_HELP=1"
    if /I "%%A"=="--help"     set "PARAM_HELP=1"
    if /I "%%A"=="-help"      set "PARAM_HELP=1"
    if /I "%%A"=="-h"         set "PARAM_HELP=1"
    if /I "%%A"=="/h"         set "PARAM_HELP=1"
    if /I "%%A"=="/?"         set "PARAM_HELP=1"
)

REM Yordam oynasi
if "!PARAM_HELP!"=="1" (
    color 0b
    echo ========================================================
    echo   ANYDESK KESHINI TOZALASH SKRIPTI [V2.0 PRO]
    echo ========================================================
    echo Foydalanish:
    echo   clean-anydesk.bat [PARAMETRLAR]
    echo.
    echo Mavjud parametrlar:
    echo   /silent, -s, /q     Jimjit rejim [savollarsiz, oyna ochilmasdan fonda ishlaydi]
    echo   /norestart, -nr     Tozalashdan keyin AnyDesk dasturini qayta ochmaydi
    echo   /all, -a, /full     To'liq tozalash: AppData bilan birga ProgramData xizmat keshini ham tozalaydi
    echo   /nolog, -nl         Jarayon yakunida Notepad orqali log faylini ochmaydi
    echo   /help, -h, /h       Ushbu yordam ma'lumotini ko'rsatish
    echo.
    echo Misollar:
    echo   clean-anydesk.bat             - Standart: 2 marta bosish [avto-admin, tozalash va ochish]
    echo   clean-anydesk.bat /silent     - Fonda jimgina tozalash
    echo   clean-anydesk.bat /all        - Tizim va foydalanuvchi keshini to'liq tozalash
    echo   clean-anydesk.bat /norestart  - Faqat tozalash, dasturni ochmaslik
    echo ========================================================
    exit /b 0
)

REM -------------------------------------------------------------------------
REM 1. AVTOMATIK ADMINISTRATOR HUQUQINI SO'RASH (AUTO RUN AS ADMINISTRATOR)
REM -------------------------------------------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
    if "!PARAM_SILENT!"=="0" (
        color 0e
        echo [!] Administrator huquqi talab qilinadi...
        echo [*] Administrator sifatida ishga tushirish uchun UAC oynasi ochilmoqda...
    )
    if "%*"=="" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    ) else (
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
    )
    exit /b 0
)

REM Ishchi papkani skript joylashgan joyga yo'naltirish (System32 ga tushib qolmasligi uchun)
cd /d "%~dp0"

if "!PARAM_SILENT!"=="0" color 0b

REM Log fayli
set "LOG_FILE=%~dp0anydesk_tozalash_log.txt"
if "%~dp0"=="" set "LOG_FILE=%TEMP%\anydesk_tozalash_log.txt"
set "DESKTOP_LOG=%USERPROFILE%\Desktop\anydesk_tozalash_log.txt"

if "!PARAM_SILENT!"=="0" (
    echo ========================================================
    echo   ANYDESK KESHINI TOZALASH VA QAYTA ISHGA TUSHIRISH
    echo   (Administrator huquqi bilan ishga tushirildi)
    echo ========================================================
    echo.
)

echo ======================================================== > "%LOG_FILE%"
echo   ANYDESK TOZALASH LOGI - %DATE% %TIME% >> "%LOG_FILE%"
echo   Ishga tushirish huquqi: Administrator >> "%LOG_FILE%"
echo   Parametrlar: SILENT=!PARAM_SILENT! NORESTART=!PARAM_NORESTART! ALL=!PARAM_ALL! NOLOG=!PARAM_NOLOG! >> "%LOG_FILE%"
echo ======================================================== >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

set "HAS_ERROR=0"

REM -------------------------------------------------------------------------
REM 2. ANYDESK XIZMAT VA JARAYONLARINI TO'XTATISH
REM -------------------------------------------------------------------------
if "!PARAM_SILENT!"=="0" echo [1/3] AnyDesk xizmat va jarayonlari tekshirilmoqda...
echo [1/3] AnyDesk xizmat va jarayonlari tekshirilmoqda... >> "%LOG_FILE%"

sc query "AnyDesk" 2>&1 | find /I "RUNNING" >nul
if "%ERRORLEVEL%"=="0" (
    if "!PARAM_SILENT!"=="0" echo [!] AnyDesk Windows xizmati aniqlandi. To'xtatilmoqda...
    echo [!] AnyDesk Windows xizmati to'xtatilmoqda... >> "%LOG_FILE%"
    net stop "AnyDesk" >> "%LOG_FILE%" 2>&1
    timeout /t 1 /nobreak >nul
)

tasklist /FI "IMAGENAME eq AnyDesk.exe" 2>NUL | find /I "AnyDesk.exe" >nul
if "%ERRORLEVEL%"=="0" (
    if "!PARAM_SILENT!"=="0" echo [!] AnyDesk dasturi ishlab turibdi. Majburiy to'xtatilmoqda...
    echo [!] AnyDesk dasturi to'xtatilmoqda... >> "%LOG_FILE%"
    taskkill /F /IM AnyDesk.exe /T >> "%LOG_FILE%" 2>&1
    timeout /t 1 /nobreak >nul
) else (
    if "!PARAM_SILENT!"=="0" echo [*] AnyDesk jarayoni ochiq emas.
    echo [*] AnyDesk jarayoni ochiq emas. >> "%LOG_FILE%"
)

tasklist /FI "IMAGENAME eq AnyDesk.exe" 2>NUL | find /I "AnyDesk.exe" >nul
if "%ERRORLEVEL%"=="0" (
    if "!PARAM_SILENT!"=="0" echo [XATO] AnyDesk.exe jarayonini to'xtatib bo'lmadi!
    echo [XATO] AnyDesk.exe jarayonini to'xtatib bo'lmadi! >> "%LOG_FILE%"
    set "HAS_ERROR=1"
) else (
    if "!PARAM_SILENT!"=="0" echo [OK] AnyDesk jarayonlari to'liq to'xtatildi.
    echo [OK] AnyDesk jarayonlari to'liq to'xtatildi. >> "%LOG_FILE%"
)

if "!PARAM_SILENT!"=="0" echo.
echo. >> "%LOG_FILE%"

REM -------------------------------------------------------------------------
REM 3. KESH VA MA'LUMOTLAR PAPKASINI O'CHIRISH
REM -------------------------------------------------------------------------
if "!PARAM_SILENT!"=="0" echo [2/3] AnyDesk ma'lumotlar papkasi tekshirilmoqda...
echo [2/3] AnyDesk ma'lumotlar papkasi tekshirilmoqda: %AppData%\AnyDesk >> "%LOG_FILE%"

set "ANYDESK_DIR=%AppData%\AnyDesk"

if exist "%ANYDESK_DIR%" (
    if "!PARAM_SILENT!"=="0" (
        echo [*] Papka topildi: %ANYDESK_DIR%
        echo [*] Papka butunlay o'chirilmoqda...
    )
    rd /s /q "%ANYDESK_DIR%" >> "%LOG_FILE%" 2>&1
    
    if exist "%ANYDESK_DIR%" (
        timeout /t 1 /nobreak >nul
        rd /s /q "%ANYDESK_DIR%" >> "%LOG_FILE%" 2>&1
    )
    
    if exist "%ANYDESK_DIR%" (
        if "!PARAM_SILENT!"=="0" echo [XATO] Papkani o'chirib bo'lmadi - fayllar band yoki ruxsat yetarli emas.
        echo [XATO] Papkani o'chirib bo'lmadi! >> "%LOG_FILE%"
        set "HAS_ERROR=1"
    ) else (
        if "!PARAM_SILENT!"=="0" echo [OK] AnyDesk kesh va ma'lumotlar papkasi muvaffaqiyatli o'chirildi!
        echo [OK] AnyDesk papkasi muvaffaqiyatli o'chirildi! >> "%LOG_FILE%"
    )
) else (
    if "!PARAM_SILENT!"=="0" echo [*] AnyDesk papkasi mavjud emas - allaqachon toza.
    echo [*] AnyDesk papkasi mavjud emas. >> "%LOG_FILE%"
)

REM LocalAppData kesh papkasi
if exist "%LocalAppData%\AnyDesk" (
    if "!PARAM_SILENT!"=="0" echo [*] Mahalliy kesh papkasi ham tozalanmoqda: %LocalAppData%\AnyDesk
    echo [*] Mahalliy kesh o'chirilmoqda: %LocalAppData%\AnyDesk >> "%LOG_FILE%"
    rd /s /q "%LocalAppData%\AnyDesk" >> "%LOG_FILE%" 2>&1
)

REM Agar /all parametri berilgan bo'lsa, ProgramData xizmat keshini ham tozalash
if "!PARAM_ALL!"=="1" (
    if exist "%ProgramData%\AnyDesk" (
        if "!PARAM_SILENT!"=="0" echo [*] /all parametri: ProgramData tizim xizmat keshi tozalanmoqda: %ProgramData%\AnyDesk
        echo [*] /all parametri: ProgramData tizim keshi o'chirilmoqda: %ProgramData%\AnyDesk >> "%LOG_FILE%"
        rd /s /q "%ProgramData%\AnyDesk" >> "%LOG_FILE%" 2>&1
    )
)

if "!PARAM_SILENT!"=="0" echo.
echo. >> "%LOG_FILE%"

REM -------------------------------------------------------------------------
REM 4. ANYDESK DASTURINI QAYTA ISHGA TUSHIRISH
REM -------------------------------------------------------------------------
if "!PARAM_NORESTART!"=="1" (
    if "!PARAM_SILENT!"=="0" echo [3/3] /norestart parametri aniqlandi: AnyDesk qayta ishga tushirilmaydi.
    echo [3/3] /norestart parametri: AnyDesk ochilmadi. >> "%LOG_FILE%"
) else (
    if "!PARAM_SILENT!"=="0" echo [3/3] AnyDesk dasturini qidirish va qayta ishga tushirish...
    echo [3/3] AnyDesk dasturini qidirish va qayta ishga tushirish... >> "%LOG_FILE%"

    set "ANYDESK_EXE="
    if exist "%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe" set "ANYDESK_EXE=%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"
    if not defined ANYDESK_EXE if exist "%ProgramFiles%\AnyDesk\AnyDesk.exe" set "ANYDESK_EXE=%ProgramFiles%\AnyDesk\AnyDesk.exe"
    if not defined ANYDESK_EXE if exist "%LocalAppData%\AnyDesk\AnyDesk.exe" set "ANYDESK_EXE=%LocalAppData%\AnyDesk\AnyDesk.exe"
    if not defined ANYDESK_EXE if exist "%USERPROFILE%\Desktop\AnyDesk.exe" set "ANYDESK_EXE=%USERPROFILE%\Desktop\AnyDesk.exe"
    if not defined ANYDESK_EXE if exist "%USERPROFILE%\Downloads\AnyDesk.exe" set "ANYDESK_EXE=%USERPROFILE%\Downloads\AnyDesk.exe"

    if defined ANYDESK_EXE (
        if "!PARAM_SILENT!"=="0" (
            echo [*] AnyDesk dasturi topildi: !ANYDESK_EXE!
            echo [OK] AnyDesk yangi va toza holatda ishga tushirildi!
        )
        echo [*] AnyDesk topildi va ishga tushirilmoqda: !ANYDESK_EXE! >> "%LOG_FILE%"
        start "" "!ANYDESK_EXE!"
        echo [OK] AnyDesk ishga tushirildi. >> "%LOG_FILE%"
    ) else (
        if "!PARAM_SILENT!"=="0" echo [!] Standart papkalardan AnyDesk.exe topilmadi.
        echo [!] AnyDesk.exe topilmadi. >> "%LOG_FILE%"
    )
)

if "!PARAM_SILENT!"=="0" (
    echo.
    echo. >> "%LOG_FILE%"
    echo ========================================================
    echo ======================================================== >> "%LOG_FILE%"

    if "!HAS_ERROR!"=="0" (
        color 0a
        echo   [MUVAFFAQIYATLI] BARCHA AMALLAR TO'LIQ BAJARILDI!
        echo   [MUVAFFAQIYATLI] BARCHA AMALLAR TO'LIQ BAJARILDI! >> "%LOG_FILE%"
    ) else (
        color 0c
        echo   [DIQQAT] AYRIM AMALLARDA XATOLIK YUZ BERDI!
        echo   [DIQQAT] AYRIM AMALLARDA XATOLIK YUZ BERDI! >> "%LOG_FILE%"
    )
    echo ========================================================
    echo.
)

REM Nusxani Desktopga ham saqlash
if exist "%USERPROFILE%\Desktop" (
    copy /y "%LOG_FILE%" "%DESKTOP_LOG%" >nul 2>&1
)

REM Silent bo'lmasa va nolog bo'lmasa Notepad ochish
if "!PARAM_SILENT!"=="0" (
    echo [i] Log fayli quyidagi manzilda saqlandi:
    echo     "%LOG_FILE%"
    echo.
    if "!PARAM_NOLOG!"=="0" (
        echo Log fayli ochilmoqda...
        start notepad "%LOG_FILE%"
    )
    echo.
    echo Oynani yopish uchun istalgan tugmani bosing...
    pause >nul
)

exit /b !HAS_ERROR!
