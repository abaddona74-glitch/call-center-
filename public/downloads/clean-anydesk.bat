@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title AnyDesk Keshini Tozalash
color 0b

REM Log fayli skript joylashgan papkada va Ish stolida yaratiladi
set "LOG_FILE=%~dp0anydesk_tozalash_log.txt"
if "%~dp0"=="" set "LOG_FILE=%TEMP%\anydesk_tozalash_log.txt"
set "DESKTOP_LOG=%USERPROFILE%\Desktop\anydesk_tozalash_log.txt"

echo ========================================================
echo   ANYDESK KESHINI TOZALASH VA QAYTA ISHGA TUSHIRISH
echo ========================================================
echo.

echo ======================================================== > "%LOG_FILE%"
echo   ANYDESK TOZALASH LOGI - %DATE% %TIME% >> "%LOG_FILE%"
echo ======================================================== >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

set "HAS_ERROR=0"

REM 1. AnyDesk Service va jarayonlarini to'xtatish
echo [1/3] AnyDesk xizmat va jarayonlari tekshirilmoqda...
echo [1/3] AnyDesk xizmat va jarayonlari tekshirilmoqda... >> "%LOG_FILE%"

sc query "AnyDesk" 2>&1 | find /I "RUNNING" >nul
if "%ERRORLEVEL%"=="0" (
    echo [!] AnyDesk Windows xizmati aniqlandi. To'xtatilmoqda...
    echo [!] AnyDesk Windows xizmati to'xtatilmoqda... >> "%LOG_FILE%"
    net stop "AnyDesk" >> "%LOG_FILE%" 2>&1
    timeout /t 1 /nobreak >nul
)

tasklist /FI "IMAGENAME eq AnyDesk.exe" 2>NUL | find /I "AnyDesk.exe" >nul
if "%ERRORLEVEL%"=="0" (
    echo [!] AnyDesk dasturi ishlab turibdi. Majburiy to'xtatilmoqda...
    echo [!] AnyDesk dasturi to'xtatilmoqda... >> "%LOG_FILE%"
    taskkill /F /IM AnyDesk.exe /T >> "%LOG_FILE%" 2>&1
    timeout /t 1 /nobreak >nul
) else (
    echo [*] AnyDesk jarayoni ochiq emas.
    echo [*] AnyDesk jarayoni ochiq emas. >> "%LOG_FILE%"
)

tasklist /FI "IMAGENAME eq AnyDesk.exe" 2>NUL | find /I "AnyDesk.exe" >nul
if "%ERRORLEVEL%"=="0" (
    echo [XATO] AnyDesk.exe jarayonini to'xtatib bo'lmadi! Administrator huquqi kerak.
    echo [XATO] AnyDesk.exe jarayonini to'xtatib bo'lmadi! Administrator huquqi kerak. >> "%LOG_FILE%"
    set "HAS_ERROR=1"
) else (
    echo [OK] AnyDesk jarayonlari to'liq to'xtatildi.
    echo [OK] AnyDesk jarayonlari to'liq to'xtatildi. >> "%LOG_FILE%"
)
echo.
echo. >> "%LOG_FILE%"

REM 2. AppData AnyDesk papkasini o'chirish
echo [2/3] AnyDesk ma'lumotlar papkasi tekshirilmoqda...
echo [2/3] AnyDesk ma'lumotlar papkasi tekshirilmoqda: %AppData%\AnyDesk >> "%LOG_FILE%"

set "ANYDESK_DIR=%AppData%\AnyDesk"

if exist "%ANYDESK_DIR%" (
    echo [*] Papka topildi: %ANYDESK_DIR%
    echo [*] Papka butunlay o'chirilmoqda...
    rd /s /q "%ANYDESK_DIR%" >> "%LOG_FILE%" 2>&1
    
    if exist "%ANYDESK_DIR%" (
        timeout /t 1 /nobreak >nul
        rd /s /q "%ANYDESK_DIR%" >> "%LOG_FILE%" 2>&1
    )
    
    if exist "%ANYDESK_DIR%" (
        echo [XATO] Papkani o'chirib bo'lmadi - fayllar band yoki ruxsat yetarli emas.
        echo [XATO] Papkani o'chirib bo'lmadi! >> "%LOG_FILE%"
        set "HAS_ERROR=1"
    ) else (
        echo [OK] AnyDesk kesh va ma'lumotlar papkasi muvaffaqiyatli o'chirildi!
        echo [OK] AnyDesk papkasi muvaffaqiyatli o'chirildi! >> "%LOG_FILE%"
    )
) else (
    echo [*] AnyDesk papkasi mavjud emas - allaqachon toza.
    echo [*] AnyDesk papkasi mavjud emas. >> "%LOG_FILE%"
)

REM LocalAppData kesh papkasi mavjud bo'lsa uni ham tozalash
if exist "%LocalAppData%\AnyDesk" (
    echo [*] Mahalliy kesh papkasi ham tozalanmoqda: %LocalAppData%\AnyDesk
    echo [*] Mahalliy kesh o'chirilmoqda: %LocalAppData%\AnyDesk >> "%LOG_FILE%"
    rd /s /q "%LocalAppData%\AnyDesk" >> "%LOG_FILE%" 2>&1
)
echo.
echo. >> "%LOG_FILE%"

REM 3. AnyDesk dasturini qayta ishga tushirish
echo [3/3] AnyDesk dasturini qidirish va qayta ishga tushirish...
echo [3/3] AnyDesk dasturini qidirish va qayta ishga tushirish... >> "%LOG_FILE%"

set "ANYDESK_EXE="
if exist "%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe" set "ANYDESK_EXE=%ProgramFiles(x86)%\AnyDesk\AnyDesk.exe"
if not defined ANYDESK_EXE if exist "%ProgramFiles%\AnyDesk\AnyDesk.exe" set "ANYDESK_EXE=%ProgramFiles%\AnyDesk\AnyDesk.exe"
if not defined ANYDESK_EXE if exist "%LocalAppData%\AnyDesk\AnyDesk.exe" set "ANYDESK_EXE=%LocalAppData%\AnyDesk\AnyDesk.exe"
if not defined ANYDESK_EXE if exist "%USERPROFILE%\Desktop\AnyDesk.exe" set "ANYDESK_EXE=%USERPROFILE%\Desktop\AnyDesk.exe"
if not defined ANYDESK_EXE if exist "%USERPROFILE%\Downloads\AnyDesk.exe" set "ANYDESK_EXE=%USERPROFILE%\Downloads\AnyDesk.exe"

if defined ANYDESK_EXE (
    echo [*] AnyDesk dasturi topildi: !ANYDESK_EXE!
    echo [*] AnyDesk topildi va ishga tushirilmoqda: !ANYDESK_EXE! >> "%LOG_FILE%"
    start "" "!ANYDESK_EXE!"
    echo [OK] AnyDesk yangi va toza holatda ishga tushirildi!
    echo [OK] AnyDesk ishga tushirildi. >> "%LOG_FILE%"
) else (
    echo [!] Standart papkalardan AnyDesk.exe topilmadi.
    echo [!] AnyDesk.exe topilmadi. >> "%LOG_FILE%"
)

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
    echo   Maslahat: Faylni sichqonchaning o'ng tugmasi bilan bosib,
    echo   Administrator sifatida ishga tushirish qilib ko'ring.
)
echo ========================================================
echo.

REM Nusxani Desktopga ham saqlash
if exist "%USERPROFILE%\Desktop" (
    copy /y "%LOG_FILE%" "%DESKTOP_LOG%" >nul 2>&1
)

echo [i] Log fayli quyidagi manzilda saqlandi:
echo     "%LOG_FILE%"
echo.
echo Log fayli ochilmoqda...
start notepad "%LOG_FILE%"
echo.
echo Oynani yopish uchun istalgan tugmani bosing...
pause >nul
