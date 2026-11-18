# ==============================================================================
# Production Server Deploy Helper for Call Center & Viewer
# Target Server: 213.230.110.9
# ==============================================================================
param(
    [string[]]$Files,
    [switch]$All,
    [switch]$Restart
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$serverHost = "213.230.110.9"
$serverUser = "root"
$serverPort = 22

$rootDir = Split-Path -Parent $PSScriptRoot
$scratchDir = Join-Path $rootDir "scratch"
$askPassExe = Join-Path $scratchDir "askpass_n.exe"

if (!(Test-Path $askPassExe)) {
    throw "SSH askpass helper topilmadi: $askPassExe"
}

$env:SSH_ASKPASS = (Resolve-Path $askPassExe).Path
$env:SSH_ASKPASS_REQUIRE = "force"
$env:DISPLAY = "dummy:0"

Write-Host "Server Deploy jarayoni boshlandi..." -ForegroundColor Cyan

# 1. Agar aniq fayllar berilgan bo'lsa
if ($Files -and $Files.Count -gt 0) {
    $staticViewerFiles = @()
    $backendFiles = @()

    foreach ($f in $Files) {
        $abs = if ([System.IO.Path]::IsPathRooted($f)) { $f } else { Join-Path $rootDir $f }
        if (!(Test-Path $abs)) {
            Write-Host "Fayl topilmadi: $f" -ForegroundColor Yellow
            continue
        }

        $rel = $abs.Substring($rootDir.Length).TrimStart('\', '/')

        if ($rel -like "viewer\public\*" -or $rel -like "viewer/public/*") {
            $subRel = $rel.Substring("viewer\public\".Length)
            $staticViewerFiles += @{ Source = $abs; SubRel = $subRel }
        } else {
            $backendFiles += @{ Source = $abs; Rel = $rel }
        }
    }

    if ($staticViewerFiles.Count -gt 0 -or $backendFiles.Count -gt 0) {
        $patchArchive = Join-Path $scratchDir "patch_$([System.IO.Path]::GetRandomFileName().Substring(0,5)).tar.gz"
        $stagingDir = Join-Path $scratchDir "staging_patch"
        if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
        New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

        foreach ($sf in $staticViewerFiles) {
            $dest = Join-Path $stagingDir "viewer_public\$($sf.SubRel)"
            $destDir = Split-Path -Parent $dest
            if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            Copy-Item $sf.Source $dest -Force
            Write-Host "Statik fayl qo'shildi: $($sf.SubRel)" -ForegroundColor Gray
        }

        foreach ($bf in $backendFiles) {
            $dest = Join-Path $stagingDir "backend\$($bf.Rel)"
            $destDir = Split-Path -Parent $dest
            if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            Copy-Item $bf.Source $dest -Force
            Write-Host "Backend fayl qo'shildi: $($bf.Rel)" -ForegroundColor Gray
        }

        # Arxiv yaratish
        & tar.exe -czf $patchArchive -C $stagingDir .
        Remove-Item $stagingDir -Recurse -Force

        # Yagona SCP orqali yuklash
        Write-Host "Serverga yuklanmoqda..." -ForegroundColor Yellow
        & scp.exe -P $serverPort -o StrictHostKeyChecking=no -o ConnectTimeout=15 $patchArchive "$serverUser@$($serverHost):/tmp/patch_deploy.tar.gz"
        if ($LASTEXITCODE -ne 0) { throw "SCP uzatishda xatolik yuz berdi" }
        Remove-Item $patchArchive -Force -ErrorAction SilentlyContinue

        # Serverda bitta SSH orqali ochish va PM2 ni yangilash
        Start-Sleep -Seconds 2
        $cmdParts = @(
            "mkdir -p /tmp/patch_unpack",
            "tar -xzf /tmp/patch_deploy.tar.gz -C /tmp/patch_unpack",
            "[ -d /tmp/patch_unpack/viewer_public ] && cp -r /tmp/patch_unpack/viewer_public/* /opt/call-center-viewer/public/ || true",
            "[ -d /tmp/patch_unpack/backend/viewer ] && cp -r /tmp/patch_unpack/backend/viewer/* /opt/call-center-viewer/ || true",
            "[ -d /tmp/patch_unpack/backend ] && cp -r /tmp/patch_unpack/backend/* /opt/call-center/ 2>/dev/null || true",
            "rm -rf /tmp/patch_unpack /tmp/patch_deploy.tar.gz"
        )
        if ($Restart -or $backendFiles.Count -gt 0) {
            $cmdParts += "pm2 reload call-center-viewer"
        }
        $remoteCmd = $cmdParts -join " ; "

        & ssh.exe -n -p $serverPort -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$serverUser@$serverHost" $remoteCmd
        if ($LASTEXITCODE -ne 0) { throw "Serverda o'rnatishda xatolik yuz berdi" }
        Write-Host "O'zgarishlar serverga muvaffaqiyatli tatbiq etildi!" -ForegroundColor Green
    }
} else {
    Write-Host "Oxirgi o'zgargan fayllar qidirilmoqda..." -ForegroundColor Yellow
    $cutoff = (Get-Date).AddHours(-3)
    $modified = Get-ChildItem -Path $rootDir -Recurse -File | Where-Object {
        $_.LastWriteTime -gt $cutoff -and
        $_.FullName -notmatch '\\(\.git|node_modules|scratch|\.agents)\\'
    }

    if (!$modified -or $modified.Count -eq 0) {
        Write-Host "O'zgargan fayllar topilmadi." -ForegroundColor Green
        exit 0
    }

    $modFiles = $modified | ForEach-Object { $_.FullName }
    & $PSCommandPath -Files $modFiles -Restart:$Restart
}

Write-Host "DEPLOY TO'LIQ YAKUNLANDI!" -ForegroundColor Green
