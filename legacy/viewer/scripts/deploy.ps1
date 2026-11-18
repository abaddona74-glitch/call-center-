# ==============================================================================
# Call Center Viewer - Zero-Dependency Production Deployment (PowerShell)
# Works natively on Windows without requiring Node.js to be installed!
# ==============================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$viewerDir = Resolve-Path (Join-Path $scriptDir "..")
$rootDir   = Resolve-Path (Join-Path $viewerDir "..")
$envFile   = Join-Path $rootDir ".env"
$scratch   = Join-Path $rootDir "scratch"
if (!(Test-Path $scratch)) { New-Item -ItemType Directory -Path $scratch -Force | Out-Null }

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "🚀 CALL CENTER VIEWER (3005) — NATIVE DEPLOYMENT" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Read Server credentials from .env
$serverHost = ""
$serverUser = "root"
$serverPass = ""
$serverPort = 22

if (Test-Path $envFile) {
    foreach ($line in (Get-Content $envFile)) {
        if ($line -match "^DEPLOY_HOST=(.*)$") { $serverHost = $matches[1].Trim().Trim('"').Trim("'") }
        if ($line -match "^DEPLOY_USER=(.*)$") { $serverUser = $matches[1].Trim().Trim('"').Trim("'") }
        if ($line -match "^DEPLOY_PASS=(.*)$") { $serverPass = $matches[1].Trim().Trim('"').Trim("'") }
        if ($line -match "^DEPLOY_PORT=(.*)$") { $serverPort = [int]($matches[1].Trim().Trim('"').Trim("'")) }
    }
}

if ([string]::IsNullOrWhiteSpace($serverHost)) {
    Write-Host "❌ Xatolik: .env faylida DEPLOY_HOST topilmadi!" -ForegroundColor Red
    exit 1
}

Write-Host "🎯 Server: $serverUser@$serverHost`:$serverPort" -ForegroundColor Gray
Write-Host "📂 Remote: /opt/call-center-viewer" -ForegroundColor Gray
Write-Host ""

# 2. Update version.json
$versionFile = Join-Path $viewerDir "public\version.json"
$buildId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$versionJson = @"
{
  "buildId": "$buildId",
  "buildTime": "$(Get-Date -Format o)",
  "version": "2.4.0",
  "app": "call-center-viewer"
}
"@
[System.IO.File]::WriteAllText($versionFile, $versionJson, [System.Text.Encoding]::UTF8)
Write-Host "🏷️  Viewer versiya yangilandi: Build $buildId" -ForegroundColor Green

# 3. Archive files using Windows native tar.exe
$archiveFile = Join-Path $scratch "viewer_payload.tar.gz"
if (Test-Path $archiveFile) { Remove-Item $archiveFile -Force }

Write-Host "📦 [1/3] Fayllar arxivlanmoqda..." -ForegroundColor Yellow
$tarArgs = @(
    "-czf", $archiveFile,
    "-C", $viewerDir,
    "--exclude=node_modules",
    "--exclude=*.log",
    "app.js", "config.js", "package.json", "services", "public"
)
if (Test-Path (Join-Path $viewerDir ".env")) { $tarArgs += ".env" }
if (Test-Path (Join-Path $viewerDir "ssl"))  { $tarArgs += "ssl" }

& tar.exe @tarArgs
$sizeMb = ((Get-Item $archiveFile).Length / 1MB).ToString("0.00")
Write-Host "✅ Arxiv tayyor: $sizeMb MB" -ForegroundColor Green
Write-Host ""

# 4. Compile temporary SSH_ASKPASS helper
$askPassSrc = @"
using System;
class Program {
    static void Main(string[] args) {
        Console.Write("$serverPass");
    }
}
"@
$askPassExe = Join-Path $scratch "askpass_$([System.IO.Path]::GetRandomFileName().Substring(0,5)).exe"
Add-Type -TypeDefinition $askPassSrc -OutputAssembly $askPassExe -OutputType ConsoleApplication

$prevAskPass = $env:SSH_ASKPASS
$prevAskPassReq = $env:SSH_ASKPASS_REQUIRE
$prevDisplay = $env:DISPLAY

$env:SSH_ASKPASS = (Resolve-Path $askPassExe).Path
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy:0"

try {
    # 5. SCP Upload to remote /tmp
    Write-Host "📡 [2/3] Serverga yuklanmoqda ($serverHost)..." -ForegroundColor Yellow
    $scpArgs = @(
        "-P", "$serverPort",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=15",
        $archiveFile,
        "$serverUser@$($serverHost):/tmp/viewer_payload.tar.gz"
    )
    & scp.exe @scpArgs
    if ($LASTEXITCODE -ne 0) { throw "SCP yuklashda xatolik yuz berdi" }
    Write-Host "✅ Fayllar serverga yuklandi!" -ForegroundColor Green
    Write-Host ""

    # 6. Extract & Restart PM2 on Server
    Write-Host "⚙️ [3/3] Serverda ochilmoqda va PM2 qayta ishga tushirilmoqda..." -ForegroundColor Yellow
    $remoteScript = "mkdir -p /opt/call-center-viewer && " +
                    "tar -xzf /tmp/viewer_payload.tar.gz -C /opt/call-center-viewer && " +
                    "rm -f /tmp/viewer_payload.tar.gz && " +
                    "cd /opt/call-center-viewer && " +
                    "(pm2 reload call-center-viewer --force || pm2 restart call-center-viewer --update-env || pm2 start app.js --name 'call-center-viewer' --time) && " +
                    "pm2 save"

    $sshArgs = @(
        "-p", "$serverPort",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=15",
        "$serverUser@$serverHost",
        $remoteScript
    )
    & ssh.exe @sshArgs
    if ($LASTEXITCODE -ne 0) { throw "Serverda buyruqlarni bajarishda xatolik yuz berdi" }

    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host "🎉 VIEWER DEPLOY MUVAFFAQIYATLI YAKUNLANDI!" -ForegroundColor Green
    Write-Host "🌐 Viewer Manzili: http://$($serverHost):3005" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Green
} finally {
    $env:SSH_ASKPASS = $prevAskPass
    $env:SSH_ASKPASS_REQUIRE = $prevAskPassReq
    $env:DISPLAY = $prevDisplay
    if (Test-Path $askPassExe) { Remove-Item $askPassExe -Force -ErrorAction SilentlyContinue }
    if (Test-Path $archiveFile) { Remove-Item $archiveFile -Force -ErrorAction SilentlyContinue }
}
