# ==============================================================================
# Native PowerShell Visual AI / Telegram Bridge Watcher
# Runs locally on Windows without requiring Node.js!
# ==============================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "[BRIDGE] Visual AI & Telegram Bridge Watcher (v2)" -ForegroundColor Cyan
Write-Host "[BRIDGE] Server: https://213.230.110.9:3005 (ui_inbox_v2)" -ForegroundColor Gray
Write-Host "=============================================" -ForegroundColor Cyan

# Find the active Antigravity brain upload folder for this user
$brainDir = "C:\Users\rahmonov.s\.gemini\antigravity\brain"
$activeUploadsDir = Join-Path $brainDir "1bcca59a-8ef5-4ec3-a936-f2378b273dee\.user_uploaded"

if (Test-Path $brainDir) {
    $latestBrain = Get-ChildItem -Path $brainDir -Directory | Where-Object { $_.Name -notlike ".*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestBrain) {
        $activeUploadsDir = Join-Path $latestBrain.FullName ".user_uploaded"
    }
}
if (!(Test-Path $activeUploadsDir)) {
    New-Item -ItemType Directory -Path $activeUploadsDir -Force | Out-Null
}

$url = "https://213.230.110.9:3005/api/dev/bridge-inbox"
$ackUrl = "https://213.230.110.9:3005/api/dev/bridge-inbox/ack"

while ($true) {
    try {
        $raw = & curl.exe -k -s --connect-timeout 4 -m 6 $url
        if ($raw -and $raw.Trim()) {
            $resp = $raw | ConvertFrom-Json
            if ($resp -and $resp.success -and $resp.items) {
                $pending = $resp.items | Where-Object { $_.status -eq 'pending' } | Select-Object -First 1
                if ($pending) {
                    Write-Host ""
                    Write-Host "=============================================" -ForegroundColor Yellow
                    Write-Host "[TASK RECEIVED] Yangi vazifa keldi!" -ForegroundColor Green
                    Write-Host "ID: $($pending.id)" -ForegroundColor White
                    Write-Host "Manba: $($pending.source)" -ForegroundColor White
                    if ($pending.sender) { Write-Host "Yuboruvchi: $($pending.sender)" -ForegroundColor White }
                    Write-Host "Vazifa: $($pending.task)" -ForegroundColor Cyan
                    Write-Host ""
                    Write-Host "Full Prompt:" -ForegroundColor Gray
                    Write-Host "$($pending.prompt)" -ForegroundColor White

                    # Handle images
                    if ($pending.images -and $pending.images.Count -gt 0) {
                        Write-Host ""
                        Write-Host "[$($pending.images.Count) ta skrinshot/rasm biriktirilgan]:" -ForegroundColor Magenta
                        $idx = 1
                        foreach ($img in $pending.images) {
                            try {
                                $b64 = ""
                                if ($img.base64) { $b64 = $img.base64 } else { $b64 = [string]$img }
                                if ($b64 -match "^data:([^;]+);base64,(.+)$") {
                                    $mime = $matches[1]
                                    $ext = "png"
                                    if ($mime -like "*jpeg*") { $ext = "jpg" }
                                    $bytes = [Convert]::FromBase64String($matches[2])
                                    $fileName = "bridge_$($pending.id)_$idx.$ext"
                                    $filePath = Join-Path $activeUploadsDir $fileName
                                    [System.IO.File]::WriteAllBytes($filePath, $bytes)
                                    Write-Host "Rasm #$idx saqlandi: file:///$($filePath.Replace('\', '/'))" -ForegroundColor Green
                                }
                            } catch {
                                Write-Host "Rasm saqlashda xatolik: $_" -ForegroundColor Red
                            }
                            $idx++
                        }
                    }

                    # Acknowledge task to server as 'processing'
                    try {
                        $ackFile = Join-Path $activeUploadsDir "ack_$($pending.id).json"
                        (@{ id = $pending.id; status = 'processing' } | ConvertTo-Json -Compress) | Set-Content -Path $ackFile -Encoding UTF8
                        & curl.exe -k -s --connect-timeout 4 -m 6 -X POST $ackUrl -H "Content-Type: application/json" --data-binary "@$ackFile" | Out-Null
                        Remove-Item $ackFile -Force -ErrorAction SilentlyContinue
                        Write-Host "[ID: $($pending.id)] Serverda 'processing' holatiga o'tkazildi." -ForegroundColor Green
                    } catch {
                        Write-Host "Server holatini yangilashda xatolik: $_" -ForegroundColor Red
                    }

                    Write-Host "=============================================" -ForegroundColor Yellow
                    Write-Host "Antigravity AI avtomatik uyg'onmoqda..." -ForegroundColor Cyan
                    
                    # Exit with 0 to wake up Antigravity
                    exit 0
                }
            }
        }
    } catch {
        # Server temporarily unavailable or network jitter
    }

    Start-Sleep -Seconds 3
}
