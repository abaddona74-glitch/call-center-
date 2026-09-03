# ==============================================================================
# 3CX Desktop Reject Monitor Agent (PowerShell)
# Ushbu skript operator kompyuterida fonda ishlaydi va 3CX jurnalini kuzatib,
# operator "Reject / Qizil tugma" bosganda asosiy dashboardga xabar yuboradi.
# ==============================================================================

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configFile = Join-Path $scriptDir "config.json"

if (Test-Path $configFile) {
    $config = Get-Content $configFile -Raw | ConvertFrom-Json
} else {
    $config = @{
        serverUrl = "http://localhost:3000"
        operatorId = "101"
        heartbeatIntervalSec = 30
    }
}

$serverUrl = $config.serverUrl.TrimEnd('/')
$operatorId = $config.operatorId

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "🚀 3CX Desktop Agent ishga tushdi!" -ForegroundColor Green
Write-Host "🖥️ Operator: $operatorId" -ForegroundColor Yellow
Write-Host "🌐 Server: $serverUrl" -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Cyan

# 3CX Log fayllarini izlash
$possibleLogs = @(
    $config.customLogPath,
    "$env:APPDATA\3CXPhone for Windows\Logs\3CXWin8Phone.log",
    "$env:APPDATA\3CX Desktop App\logs\app.log",
    "$env:LOCALAPPDATA\3CX Desktop App\logs\app.log",
    "$env:PROGRAMDATA\3CXPhone for Windows\Logs\3CXWin8Phone.log"
)

$targetLog = $null
foreach ($path in $possibleLogs) {
    if (![string]::IsNullOrEmpty($path) -and (Test-Path $path)) {
        $targetLog = $path
        break
    }
}

if ($targetLog) {
    Write-Host "📄 3CX Jurnali topildi: $targetLog" -ForegroundColor Green
} else {
    Write-Host "⚠️ Aniq 3CX log fayli topilmadi. Standart papka kuzatiladi." -ForegroundColor DarkYellow
}

# Heartbeat yuborish funksiyasi
function Send-Heartbeat {
    try {
        $body = @{
            operatorId = $operatorId
            hostname = $env:COMPUTERNAME
            appVersion = "1.0.0"
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$serverUrl/api/agent/heartbeat" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
    } catch {}
}

# Reject hodisasini serverga jo'natish
function Send-RejectEvent($callerId, $reason) {
    try {
        $body = @{
            operatorId = $operatorId
            callerId = $callerId
            reason = $reason
            timestamp = (Get-Date).ToString("o")
        } | ConvertTo-Json

        $res = Invoke-RestMethod -Uri "$serverUrl/api/agent/reject" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5
        Write-Host "🚫 [REJECT] Operator $operatorId rad etdi! Raqam: $callerId | Server javobi: $($res.success)" -ForegroundColor Red
    } catch {
        Write-Host "❌ Serverga jo'natishda xatolik: $($_.Exception.Message)" -ForegroundColor DarkRed
    }
}

Send-Heartbeat
$lastHeartbeat = [DateTime]::UtcNow
$lastPosition = 0

if ($targetLog -and (Test-Path $targetLog)) {
    $lastPosition = (Get-Item $targetLog).Length
}

$ringingCaller = $null

Write-Host "👀 Qo'ng'iroqlar jurnali kuzatilmoqda... (Tayyor)" -ForegroundColor Green

while ($true) {
    Start-Sleep -Milliseconds 500

    # Heartbeat tekshiruvi
    if (([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge 30) {
        Send-Heartbeat
        $lastHeartbeat = [DateTime]::UtcNow
    }

    if (!$targetLog -or !(Test-Path $targetLog)) {
        # Qayta izlash
        foreach ($path in $possibleLogs) {
            if (![string]::IsNullOrEmpty($path) -and (Test-Path $path)) {
                $targetLog = $path
                $lastPosition = (Get-Item $targetLog).Length
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
            # Log aylandi (rotated)
            $lastPosition = 0
        }

        if ($currentLength -gt $lastPosition) {
            $stream = [System.IO.File]::Open($targetLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $stream.Seek($lastPosition, [System.IO.SeekOrigin]::Begin) | Out-Null
            $reader = New-Object System.IO.StreamReader($stream)
            $newText = $reader.ReadToEnd()
            $lastPosition = $stream.Position
            $reader.Close()
            $stream.Close()

            $lines = $newText -split "`r?`n"
            foreach ($line in $lines) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }

                # 1. Kiruvchi qo'ng'iroq / Jiringlashni aniqlash
                if ($line -match "Incoming call|Ringing|Call from\s+([0-9\+]+)|caller:\s*([0-9\+]+)") {
                    if ($Matches[1]) { $ringingCaller = $Matches[1] }
                    elseif ($Matches[2]) { $ringingCaller = $Matches[2] }
                }

                # 2. Operator Reject / Decline / Qizil tugma bosilganini aniqlash
                if ($line -match "Reject|Declined|UserBusy|CallRejected|BusyHere|EndCall.*Ringing|486 Busy") {
                    $caller = if ($ringingCaller) { $ringingCaller } else { "3CX Jurnali" }
                    Send-RejectEvent -callerId $caller -reason "User Rejected in 3CX"
                    $ringingCaller = $null
                }

                # 3. Agar javob berilgan bo'lsa yoki normal tugagan bo'lsa
                if ($line -match "Connected|Answered|Established|Call ended") {
                    $ringingCaller = $null
                }
            }
        }
    } catch {
        # File lock bo'lsa e'tiborsiz qoldirish
    }
}
