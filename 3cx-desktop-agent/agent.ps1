# ==============================================================================
# 3CX Desktop Agent (PowerShell)
# Ushbu skript operator kompyuterida fonda ishlaydi va 3CX jurnalini kuzatib,
# qo'ng'iroqlar (qabul qilingan, o'tkazib yuborilgan, davomiyligi) bo'yicha ma'lumotlarni
# real-vaqtda asosiy Call Center Dashboard serveriga uzatadi.
# ==============================================================================

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $scriptDir "config.json"

if (Test-Path $configFile) {
    $raw = Get-Content $configFile -Raw -Encoding UTF8
    $config = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
} else {
    $config = @{
        serverUrl = "http://192.168.0.16:3000"
        operatorId = "101"
        heartbeatIntervalSec = 30
    }
}

$serverUrl = $config.serverUrl.TrimEnd('/')
$operatorId = [string]($config.operatorId)

# 3CX Log va Tarix fayllarini izlash
$possibleLogs = @()
if (![string]::IsNullOrEmpty($config.customLogPath)) {
    $possibleLogs += $config.customLogPath
}

# 3CX VoIP Phone History fayllari (callHistory*.txt)
$voipHistoryDir = "$env:LOCALAPPDATA\3CX VoIP Phone\History"
if (Test-Path $voipHistoryDir) {
    $histFiles = Get-ChildItem -Path $voipHistoryDir -Filter "callHistory*.txt" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    foreach ($hf in $histFiles) {
        $possibleLogs += $hf.FullName
    }
}

$possibleLogs += @(
    "$env:APPDATA\3CXPhone for Windows\Logs\3CXWin8Phone.log",
    "$env:APPDATA\3CX Desktop App\logs\app.log",
    "$env:LOCALAPPDATA\3CX Desktop App\logs\app.log",
    "$env:LOCALAPPDATA\3CXPhone for Windows\Logs\3CXWin8Phone.log",
    "$env:PROGRAMDATA\3CXPhone for Windows\Logs\3CXWin8Phone.log"
)

$targetLog = $null
foreach ($path in $possibleLogs) {
    if (![string]::IsNullOrEmpty($path) -and (Test-Path $path)) {
        $targetLog = $path
        break
    }
}

if ($targetLog -and ($targetLog -match 'callHistory(\d+)@')) {
    $operatorId = $Matches[1]
    Write-Host "🎯 Operator raqami fayldan avtomatik aniqlandi: $operatorId" -ForegroundColor Cyan
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "🚀 3CX Desktop Agent ishga tushdi!" -ForegroundColor Green
Write-Host "🖥️ Operator: $operatorId" -ForegroundColor Yellow
Write-Host "🌐 Server  : $serverUrl" -ForegroundColor Yellow
if ($targetLog) {
    Write-Host "📄 3CX Jurnali topildi: $targetLog" -ForegroundColor Green
} else {
    Write-Host "⚠️ 3CX log fayli topilmadi. Qayta qidirilmoqda..." -ForegroundColor DarkYellow
}
Write-Host "======================================================" -ForegroundColor Cyan

# Heartbeat yuborish funksiyasi
function Send-Heartbeat {
    try {
        $body = @{
            operatorId = $operatorId
            hostname   = $env:COMPUTERNAME
            appVersion = "1.0.0"
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$serverUrl/api/agent/heartbeat" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
    } catch {}
}

# Qo'ng'iroq hodisasini serverga jo'natish
function Send-CallEvent($eventType, $callerId, $durationSec = 0, $details = "", $startTime = $null) {
    try {
        $body = @{
            operatorId  = $operatorId
            eventType   = $eventType
            callerId    = if ($callerId) { $callerId } else { "Yashirin raqam" }
            durationSec = [int]$durationSec
            startTime   = if ($startTime) { $startTime } else { (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }
            hostname    = $env:COMPUTERNAME
            details     = $details
            timestamp   = (Get-Date).ToString("o")
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "$serverUrl/api/agent/call-event" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 5 -ErrorAction SilentlyContinue | Out-Null
        Write-Host "📡 [$eventType] $callerId | Davomiyligi: ${durationSec}s | $details" -ForegroundColor Green
    } catch {
        # xatolik e'tiborsiz qoldiriladi
    }
}

Send-Heartbeat
$lastHeartbeat = [DateTime]::UtcNow
$lastPosition = 0
$processedKeys = New-Object System.Collections.Generic.HashSet[string]

# Agar fayl callHistory*.txt bo'lsa, mavjud yozuvlarni ham o'qib olish uchun 0 dan boshlaymiz
if ($targetLog -and (Test-Path $targetLog)) {
    if ($targetLog.ToLower().EndsWith(".txt")) {
        $lastPosition = 0
    } else {
        $lastPosition = (Get-Item $targetLog).Length
    }
}

$ringingCaller = $null

Write-Host "👀 Qo'ng'iroqlar jurnali kuzatilmoqda... (Tayyor)" -ForegroundColor Green

while ($true) {
    Start-Sleep -Milliseconds 500

    # Heartbeat tekshiruvi (har 30s)
    if (([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge 30) {
        Send-Heartbeat
        $lastHeartbeat = [DateTime]::UtcNow
    }

    if (!$targetLog -or !(Test-Path $targetLog)) {
        # Qayta izlash
        foreach ($path in $possibleLogs) {
            if (![string]::IsNullOrEmpty($path) -and (Test-Path $path)) {
                $targetLog = $path
                if ($targetLog -match 'callHistory(\d+)@') {
                    $operatorId = $Matches[1]
                }
                $lastPosition = if ($targetLog.ToLower().EndsWith(".txt")) { 0 } else { (Get-Item $targetLog).Length }
                Write-Host "📄 3CX Jurnali topildi: $targetLog" -ForegroundColor Green
                break
            }
        }
        continue
    }

    try {
        $fileItem = Get-Item $targetLog
        $currentLength = $fileItem.Length

        if ($currentLength -lt $lastPosition) {
            $lastPosition = 0
        }

        if ($currentLength -gt $lastPosition) {
            $bytesToRead = $currentLength - $lastPosition
            $fs = [System.IO.File]::Open($targetLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $fs.Seek($lastPosition, [System.IO.SeekOrigin]::Begin) | Out-Null
            $buffer = New-Object byte[] $bytesToRead
            $fs.Read($buffer, 0, $bytesToRead) | Out-Null
            $lastPosition = $fs.Position
            $fs.Close()

            $isUtf16 = $targetLog.ToLower().EndsWith(".txt")
            $encoding = if ($isUtf16) { [System.Text.Encoding]::Unicode } else { [System.Text.Encoding]::UTF8 }
            $newText = $encoding.GetString($buffer).TrimStart([char]0xFEFF)

            $lines = $newText -split "`r?`n"
            foreach ($line in $lines) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }

                # 3CX VoIP Phone History (tab-separated: 0\t950460242\t2026/09/03 12:16:37\t...)
                if ($line.Contains("`t")) {
                    $parts = $line.Split("`t")
                    if ($parts.Length -ge 3) {
                        $statusCode = $parts[0].Trim()
                        $caller = if ($parts[1].Trim()) { $parts[1].Trim() } else { "Yashirin raqam" }
                        $timeStr = $parts[2].Trim()
                        $dur = 0
                        if ($parts.Length -ge 4) { [int]::TryParse($parts[3].Trim(), [ref]$dur) | Out-Null }

                        $key = "${caller}_${timeStr}"
                        if ($processedKeys.Contains($key)) { continue }
                        $processedKeys.Add($key) | Out-Null

                        # Faqat bugungi qo'ng'iroqlarni serverga yuborish
                        $todayPrefix = (Get-Date).ToString("yyyy/MM/dd")
                        if ($timeStr -and !$timeStr.StartsWith($todayPrefix)) {
                            continue
                        }

                        if ($statusCode -eq "2" -or ($dur -gt 0 -and $statusCode -ne "1")) {
                            Send-CallEvent "ANSWERED" $caller $dur "3CX Qabul qilindi: $timeStr" $timeStr
                        } elseif ($statusCode -eq "0") {
                            Send-CallEvent "MISSED" $caller 0 "3CX O'tkazib yuborildi: $timeStr" $timeStr
                        } elseif ($statusCode -eq "1") {
                            Send-CallEvent "DIALLED" $caller $dur "3CX Chiquvchi: $timeStr" $timeStr
                        } else {
                            Send-CallEvent "ANSWERED" $caller $dur "3CX Qabul qilindi: $timeStr" $timeStr
                        }
                        continue
                    }
                }

                # 1. Kiruvchi qo'ng'iroq / Jiringlash
                if ($line -match "Incoming call|Ringing|Call from\s+([0-9\+]+)|caller:\s*([0-9\+]+)") {
                    if ($Matches[1]) { $ringingCaller = $Matches[1] }
                    elseif ($Matches[2]) { $ringingCaller = $Matches[2] }
                    Send-CallEvent "RINGING" $ringingCaller 0 "Jiringlayapti"
                }

                # 2. Suhbat boshlandi
                if ($line -match "Connected|Answered|Established") {
                    Send-CallEvent "ANSWERED" $ringingCaller 0 "Suhbat boshlandi"
                }

                # 3. Qo'ng'iroq yakunlandi
                if ($line -match "Call ended|Hangup|Terminated") {
                    Send-CallEvent "ENDED" $ringingCaller 0 "Suhbat tugadi"
                    $ringingCaller = $null
                }
            }
        }
    } catch {
        # xatolik e'tiborsiz qoldiriladi
    }
}
