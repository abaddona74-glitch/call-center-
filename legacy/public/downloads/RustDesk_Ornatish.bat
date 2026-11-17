@echo off
chcp 65001 > nul
title Call Center - Masofaviy Yordam (RustDesk) O'rnatish
color 0b

echo =====================================================================
echo    CALL CENTER AI - MASOFAVIY YORDAM (RUSTDESK) AVTO-O'RNATISH
echo =====================================================================
echo.
echo [1/5] Administrator huquqlari tekshirilmoqda...

REM Administrator huquqini tekshirish
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Administrator huquqi talab qilinadi. Ruxsat so'ralmoqda...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

REM Eski xotirada qotib qolgan barcha RustDesk jarayonlarini to'liq tozalash (terminate)
echo [*] Eski RustDesk jarayonlari to'liq to'xtatilmoqda...
taskkill /f /im rustdesk.exe > nul 2>&1
net stop "RustDesk" > nul 2>&1
net stop "RustDesk Service" > nul 2>&1
ping 127.0.0.1 -n 2 > nul

REM Standart C:\ diskida papka yaratish
set "INSTALL_DIR=C:\ProgramData\RustDeskSetup"
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
set "EXE_PATH=%INSTALL_DIR%\rustdesk.exe"

REM Agar allaqachon kompyuterda o'rnatilgan bo'lsa, qayta yuklash shart emas
if exist "C:\Program Files\RustDesk\rustdesk.exe" (
    echo [2/5] RustDesk dasturi tizimda mavjud. Sozlamalarni yangilashga o'tilmoqda...
    goto :SOZLAMALAR
)

echo [2/5] RustDesk dasturi yuklanmoqda (iltimos kuting, ~30 MB)...

REM 1-usul: curl.exe orqali yuklash
if exist "%SystemRoot%\System32\curl.exe" (
    "%SystemRoot%\System32\curl.exe" -k -L -f -s -S -o "%EXE_PATH%" "https://uniconsoft.ddns.net:3005/downloads/rustdesk.exe"
)

REM 2-usul: PowerShell orqali yuklash
if not exist "%EXE_PATH%" (
    powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri 'https://uniconsoft.ddns.net:3005/downloads/rustdesk.exe' -OutFile '%EXE_PATH%' -UseBasicParsing } catch { Invoke-WebRequest -Uri 'http://213.230.110.9:3535/downloads/rustdesk.exe' -OutFile '%EXE_PATH%' -UseBasicParsing }"
)

REM 3-usul: Zaxira rasmiy manzil
if not exist "%EXE_PATH%" (
    powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/rustdesk/rustdesk/releases/download/1.5.1/rustdesk-1.5.1-x86_64.exe' -OutFile '%EXE_PATH%' -UseBasicParsing"
)

if not exist "%EXE_PATH%" (
    echo [X] Xatolik: RustDesk yuklab olinmadi. Internet yoki server bilan aloqani tekshiring.
    pause
    exit /b
)

echo [3/5] Tizimga jimgina (silent) o'rnatilmoqda...
"%EXE_PATH%" --silent-install
ping 127.0.0.1 -n 3 > nul

:SOZLAMALAR
REM Sozlamalarni yozishdan oldin xotiradagi GUI jarayonlarini to'xtatish
taskkill /f /im rustdesk.exe > nul 2>&1
net stop "RustDesk" > nul 2>&1
ping 127.0.0.1 -n 2 > nul

echo [4/5] Ruxsat (Approve) va Doimiy Parol sozlanmoqda...

REM XAVFSIZLIK: har bir kompyuter uchun alohida tasodifiy parol (avval hamma kompyuterda bir xil parol edi).
REM Parol oxirida ekranga chiqariladi - uni darhol parol menejeriga yozib qo'ying.
set "RD_PASS="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$b = New-Object byte[] 12; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b)) -replace '[+/=]', 'x'"`) do set "RD_PASS=%%P"
if not defined RD_PASS (
    echo [XATO] Tasodifiy parol yaratib bo'lmadi. O'rnatish to'xtatildi.
    pause
    exit /b 1
)

REM Barcha profillarga (Service + Barcha Windows foydalanuvchilari) TOML parametrlarini yozish
powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand JABjAGYAZwBEAGkAcgBzACAAPQAgAEAAKAAKACAAIAAgACAAJwBDADoAXABXAGkAbgBkAG8AdwBzAFwAUwBlAHIAdgBpAGMAZQBQAHIAbwBmAGkAbABlAHMAXABMAG8AYwBhAGwAUwBlAHIAdgBpAGMAZQBcAEEAcABwAEQAYQB0AGEAXABSAG8AYQBtAGkAbgBnAFwAUgB1AHMAdABEAGUAcwBrAFwAYwBvAG4AZgBpAGcAJwAsAAoAIAAgACAAIAAnAEMAOgBcAFcAaQBuAGQAbwB3AHMAXABTAHkAcwB0AGUAbQAzADIAXABjAG8AbgBmAGkAZwBcAHMAeQBzAHQAZQBtAHAAcgBvAGYAaQBsAGUAXABBAHAAcABEAGEAdABhAFwAUgBvAGEAbQBpAG4AZwBcAFIAdQBzAHQARABlAHMAawBcAGMAbwBuAGYAaQBnACcALAAKACAAIAAgACAAIgAkACgAJABlAG4AdgA6AEEAUABQAEQAQQBUAEEAKQBcAFIAdQBzAHQARABlAHMAawBcAGMAbwBuAGYAaQBnACIACgApAAoARwBlAHQALQBDAGgAaQBsAGQASQB0AGUAbQAgAC0AUABhAHQAaAAgACIAQwA6AFwAVQBzAGUAcgBzACIAIAAtAEQAaQByAGUAYwB0AG8AcgB5ACAALQBFAHIAcgBvAHIAQQBjAHQAaQBvAG4AIABTAGkAbABlAG4AdABsAHkAQwBvAG4AdABpAG4AdQBlACAAfAAgAEYAbwByAEUAYQBjAGgALQBPAGIAagBlAGMAdAAgAHsACgAgACAAIAAgACQAdQBEAGkAcgAgAD0AIABKAG8AaQBuAC0AUABhAHQAaAAgACQAXwAuAEYAdQBsAGwATgBhAG0AZQAgACIAQQBwAHAARABhAHQAYQBcAFIAbwBhAG0AaQBuAGcAXABSAHUAcwB0AEQAZQBzAGsAXABjAG8AbgBmAGkAZwAiAAoAIAAgACAAIAAkAGMAZgBnAEQAaQByAHMAIAArAD0AIAAkAHUARABpAHIACgB9AAoACgAkAG4AZQBlAGQAZQBkACAAPQAgAFsAbwByAGQAZQByAGUAZABdAEAAewAKACAAIAAgACAAJwBkAGkAcgBlAGMAdAAtAHMAZQByAHYAZQByACcAIAA9ACAAIgAnAFkAJwAiAAoAIAAgACAAIAAnAGQAaQByAGUAYwB0AC0AYQBjAGMAZQBzAHMALQBwAG8AcgB0ACcAIAA9ACAAIgAnADIAMQAxADEAOAAnACIACgAgACAAIAAgACcAYQBwAHAAcgBvAHYAZQAtAG0AbwBkAGUAJwAgAD0AIAAiACcAcABhAHMAcwB3AG8AcgBkAC0AYwBsAGkAYwBrACcAIgAKACAAIAAgACAAJwB2AGUAcgBpAGYAaQBjAGEAdABpAG8AbgAtAG0AZQB0AGgAbwBkACcAIAA9ACAAIgAnAHUAcwBlAC0AYgBvAHQAaAAtAHAAYQBzAHMAdwBvAHIAZABzACcAIgAKACAAIAAgACAAJwBhAGwAbABvAHcALQBoAGkAZABlAC0AYwBtACcAIAA9ACAAIgAnAFkAJwAiAAoAfQAKAAoAZgBvAHIAZQBhAGMAaAAgACgAJABkAGkAcgAgAGkAbgAgACgAJABjAGYAZwBEAGkAcgBzACAAfAAgAFMAZQBsAGUAYwB0AC0ATwBiAGoAZQBjAHQAIAAtAFUAbgBpAHEAdQBlACkAKQAgAHsACgAgACAAIAAgAGkAZgAgACgALQBuAG8AdAAgACgAVABlAHMAdAAtAFAAYQB0AGgAIAAkAGQAaQByACkAKQAgAHsACgAgACAAIAAgACAAIAAgACAATgBlAHcALQBJAHQAZQBtACAALQBJAHQAZQBtAFQAeQBwAGUAIABEAGkAcgBlAGMAdABvAHIAeQAgAC0ARgBvAHIAYwBlACAALQBQAGEAdABoACAAJABkAGkAcgAgAHwAIABPAHUAdAAtAE4AdQBsAGwACgAgACAAIAAgAH0ACgAgACAAIAAgACQAYwBmAGcAIAA9ACAASgBvAGkAbgAtAFAAYQB0AGgAIAAkAGQAaQByACAAJwBSAHUAcwB0AEQAZQBzAGsAMgAuAHQAbwBtAGwAJwAKACAAIAAgACAAJABjAG8AbgB0AGUAbgB0ACAAPQAgAGkAZgAgACgAVABlAHMAdAAtAFAAYQB0AGgAIAAkAGMAZgBnACkAIAB7ACAARwBlAHQALQBDAG8AbgB0AGUAbgB0ACAAJABjAGYAZwAgAC0AUgBhAHcAIAB9ACAAZQBsAHMAZQAgAHsAIAAiACIAIAB9AAoAIAAgACAAIABpAGYAIAAoACQAbgB1AGwAbAAgAC0AZQBxACAAJABjAG8AbgB0AGUAbgB0ACkAIAB7ACAAJABjAG8AbgB0AGUAbgB0ACAAPQAgACIAIgAgAH0ACgAKACAAIAAgACAAaQBmACAAKAAkAGMAbwBuAHQAZQBuAHQAIAAtAG4AbwB0AG0AYQB0AGMAaAAgACcAXABbAG8AcAB0AGkAbwBuAHMAXABdACcAKQAgAHsACgAgACAAIAAgACAAIAAgACAAJABjAG8AbgB0AGUAbgB0ACAAKwA9ACAAIgBgAHIAYABuAFsAbwBwAHQAaQBvAG4AcwBdAGAAcgBgAG4AIgAKACAAIAAgACAAfQAKAAoAIAAgACAAIABmAG8AcgBlAGEAYwBoACAAKAAkAGsAZQB5ACAAaQBuACAAJABuAGUAZQBkAGUAZAAuAEsAZQB5AHMAKQAgAHsACgAgACAAIAAgACAAIAAgACAAJAB2AGEAbAAgAD0AIAAkAG4AZQBlAGQAZQBkAFsAJABrAGUAeQBdAAoAIAAgACAAIAAgACAAIAAgACQAcABhAHQAdABlAHIAbgAgAD0AIAAiACgAPwBtACkAXgAiACAAKwAgAFsAcgBlAGcAZQB4AF0AOgA6AEUAcwBjAGEAcABlACgAJABrAGUAeQApACAAKwAgACIAXABzACoAPQAuACoAJAAiAAoAIAAgACAAIAAgACAAIAAgAGkAZgAgACgAJABjAG8AbgB0AGUAbgB0ACAALQBtAGEAdABjAGgAIAAkAHAAYQB0AHQAZQByAG4AKQAgAHsACgAgACAAIAAgACAAIAAgACAAIAAgACAAIAAkAGMAbwBuAHQAZQBuAHQAIAA9ACAAWwByAGUAZwBlAHgAXQA6ADoAUgBlAHAAbABhAGMAZQAoACQAYwBvAG4AdABlAG4AdAAsACAAJABwAGEAdAB0AGUAcgBuACwAIAAiACQAawBlAHkAIAA9ACAAJAB2AGEAbAAiACkACgAgACAAIAAgACAAIAAgACAAfQAgAGUAbABzAGUAIAB7AAoAIAAgACAAIAAgACAAIAAgACAAIAAgACAAJABjAG8AbgB0AGUAbgB0ACAAPQAgACQAYwBvAG4AdABlAG4AdAAuAFIAZQBwAGwAYQBjAGUAKAAiAFsAbwBwAHQAaQBvAG4AcwBdACIALAAgACIAWwBvAHAAdABpAG8AbgBzAF0AYAByAGAAbgAkAGsAZQB5ACAAPQAgACQAdgBhAGwAIgApAAoAIAAgACAAIAAgACAAIAAgAH0ACgAgACAAIAAgAH0ACgAKACAAIAAgACAAWwBTAHkAcwB0AGUAbQAuAEkATwAuAEYAaQBsAGUAXQA6ADoAVwByAGkAdABlAEEAbABsAFQAZQB4AHQAKAAkAGMAZgBnACwAIAAkAGMAbwBuAHQAZQBuAHQALgBUAHIAaQBtACgAKQAgACsAIAAiAGAAcgBgAG4AIgAsACAAWwBTAHkAcwB0AGUAbQAuAFQAZQB4AHQALgBFAG4AYwBvAGQAaQBuAGcAXQA6ADoAVQBUAEYAOAApAAoAfQA= > nul

REM Brandmauerda 21118-portni ochish
netsh advfirewall firewall delete rule name="RustDesk_LAN_21118" > nul 2>&1
netsh advfirewall firewall add rule name="RustDesk_LAN_21118" dir=in action=allow protocol=TCP localport=21118 > nul 2>&1
netsh advfirewall firewall add rule name="RustDesk_LAN_21118_UDP" dir=in action=allow protocol=UDP localport=21118 > nul 2>&1

REM RustDesk xizmatini ishga tushirish
net start "RustDesk" > nul 2>&1
net start "RustDesk Service" > nul 2>&1
ping 127.0.0.1 -n 3 > nul

REM Doimiy parolni (shu kompyuter uchun yaratilgan RD_PASS) xizmat orqali o'rnatish
if exist "C:\Program Files\RustDesk\rustdesk.exe" (
    cd /d "C:\Program Files\RustDesk"
    rustdesk.exe --password "%RD_PASS%"
)
if exist "%EXE_PATH%" (
    "%EXE_PATH%" --password "%RD_PASS%"
)

REM Xizmatni yangi parol bilan qayta yuklash (restart)
net stop "RustDesk" > nul 2>&1
ping 127.0.0.1 -n 2 > nul
net start "RustDesk" > nul 2>&1
ping 127.0.0.1 -n 2 > nul

REM Operator ish stoli (Tray) da RustDesk ni toza rejimda ishga tushirish va Avto-Yuklanishga qo'shish
powershell -NoProfile -Command "$wsh = New-Object -ComObject WScript.Shell; $sc = $wsh.CreateShortcut('C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\RustDesk.lnk'); $sc.TargetPath = 'C:\Program Files\RustDesk\rustdesk.exe'; $sc.Arguments = '--tray'; $sc.Save()" > nul 2>&1
if exist "C:\Program Files\RustDesk\rustdesk.exe" (
    start "" "C:\Program Files\RustDesk\rustdesk.exe" --tray
)

echo [5/5] Serverga o'rnatilganlik holati (Yashil indikator) yuborilmoqda...
powershell -NoProfile -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "try { " ^
  "  $ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } | Select-Object -ExpandProperty IPAddress); " ^
  "  $ip = ($ips | Select-Object -First 1); " ^
  "  $body = @{ ip = $ip; hostname = $env:COMPUTERNAME; installed = $true } | ConvertTo-Json; " ^
  "  Invoke-RestMethod -Uri 'https://uniconsoft.ddns.net:3005/api/remote-desktop/report-installed' -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing; " ^
  "} catch {}"

echo.
echo =====================================================================
echo  [OK] RUSTDESK MUVAFFAQIYATLI SOZLANDI!
echo  Rejim: Ham Ruxsat (Approve), ham Doimiy Parol
echo.
echo  SHU KOMPYUTERNING RUSTDESK PAROLI: %RD_PASS%
echo  Kompyuter: %COMPUTERNAME%
echo  Parolni hozir parol menejeriga yozib oling - u boshqa joyda saqlanmaydi!
echo  Port:  21118 (LAN faol)
echo =====================================================================
echo.
pause
exit
