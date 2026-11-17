param(
    # Shu kompyuter uchun alohida doimiy parol (hamma kompyuterda bir xil parol ishlatmang)
    [Parameter(Mandatory = $true)][string]$Password
)

$cfgPaths = @(
    'C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\RustDesk2.toml',
    "$env:APPDATA\RustDesk\config\RustDesk2.toml"
)
foreach ($cfg in $cfgPaths) {
    if (Test-Path $cfg) {
        $content = Get-Content $cfg -Raw
        # Remove old options if present to refresh cleanly
        $lines = $content -split "`r?`n"
        $newLines = @()
        $inOptions = $false
        foreach ($line in $lines) {
            if ($line.Trim() -eq '[options]') {
                $newLines += '[options]'
                $newLines += "direct-server = 'Y'"
                $newLines += "direct-access-port = '21118'"
                $newLines += "approve-mode = 'password'"
                $newLines += "verification-method = 'use-permanent-password'"
                $newLines += "allow-hide-cm = 'Y'"
                $inOptions = $true
            } elseif ($inOptions -and $line -match '^(direct-server|direct-access-port|approve-mode|verification-method|allow-hide-cm)\s*=') {
                # skip old ones to avoid duplicates
            } else {
                if ($line -match '^\[') { $inOptions = $false }
                $newLines += $line
            }
        }
        if ($content -notmatch '\[options\]') {
            $newLines += "`r`n[options]"
            $newLines += "direct-server = 'Y'"
            $newLines += "direct-access-port = '21118'"
            $newLines += "approve-mode = 'password'"
            $newLines += "verification-method = 'use-permanent-password'"
            $newLines += "allow-hide-cm = 'Y'"
        }
        Set-Content -Path $cfg -Value ($newLines -join "`r`n") -Encoding UTF8
        Write-Host "Updated $cfg with unattended access (approve-mode = 'password')"
    }
}

& "C:\Program Files\RustDesk\rustdesk.exe" --password $Password

Restart-Service -Name "RustDesk" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "SUCCESS: Unattended access configured!"
