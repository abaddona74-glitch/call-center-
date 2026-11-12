const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// 1. Operatorlar ro'yxati (Asosiy 100-120 va Zangiota 200-209)
const OPERATORS = [
    { id: '101', name: 'Oybek', folder: 'Oybek_101' },
    { id: '103', name: 'Feruza', folder: 'Feruza_103' },
    { id: '106', name: 'Gulchehra', folder: 'Gulchehra_106' },
    { id: '111', name: 'Nozima', folder: 'Nozima_111' },
    { id: '114', name: 'Maxmudbek', folder: 'Maxmudbek_114' },
    { id: '116', name: 'Ibrohim', folder: 'Ibrohim_116' },
    { id: '119', name: 'Muattar', folder: 'Muattar_119' },
    { id: '120', name: 'Navruzoy', folder: 'Navruzoy_120' },
    { id: '200', name: 'Operator 200 (Zangiota)', folder: 'Operator_200' },
    { id: '201', name: 'Operator 201 (Zangiota)', folder: 'Operator_201' },
    { id: '202', name: 'Operator 202 (Zangiota)', folder: 'Operator_202' },
    { id: '203', name: 'Operator 203 (Zangiota)', folder: 'Operator_203' },
    { id: '204', name: 'Operator 204 (Zangiota)', folder: 'Operator_204' },
    { id: '205', name: 'Operator 205 (Zangiota)', folder: 'Operator_205' },
    { id: '206', name: 'Operator 206 (Zangiota)', folder: 'Operator_206' },
    { id: '207', name: 'Operator 207 (Zangiota)', folder: 'Operator_207' },
    { id: '208', name: 'Operator 208 (Zangiota)', folder: 'Operator_208' },
    { id: '209', name: 'Operator 209 (Zangiota)', folder: 'Operator_209' },
    { id: '', name: 'Custom (Universal)', folder: 'custom' }
];

const AGENT_ROOT = path.join(__dirname);
const DIST_DIR = path.join(AGENT_ROOT, 'dist');
const BASE_EXE = path.join(DIST_DIR, 'agent.exe');

if (!fs.existsSync(BASE_EXE)) {
    console.error('Base agent.exe topilmadi:', BASE_EXE);
    process.exit(1);
}

// Tray launcher template
function getTrayLauncherContent(opId, opName) {
    return `# 3CX Agent Tray Launcher
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$cfgPath   = Join-Path $scriptDir "config.json"
$opId      = "${opId || '???'}"
$opName    = "${opName || 'Operator'}"

if (Test-Path $cfgPath) {
    try {
        $raw = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8)
        $rawClean = $raw.Trim().Trim([char]0xFEFF)
        $cfg = $rawClean | ConvertFrom-Json
        if ($cfg.operatorId) { $opId = [string]$cfg.operatorId }
    } catch {}
}

$names = @{ 
    "101"="Oybek"; "103"="Feruza"; "106"="Gulchehra"; "111"="Nozima"; 
    "114"="Maxmudbek"; "116"="Ibrohim"; "119"="Muattar"; "120"="Navruzoy";
    "200"="Operator 200"; "201"="Operator 201"; "202"="Operator 202"; "203"="Operator 203";
    "204"="Operator 204"; "205"="Operator 205"; "206"="Operator 206"; "207"="Operator 207";
    "208"="Operator 208"; "209"="Operator 209"
}
if ($names.ContainsKey($opId)) { $opName = $names[$opId] }

$verPath = Join-Path $scriptDir "version.txt"
$agentVer = "v1.0.1"
if (Test-Path $verPath) {
    try {
        $rawVer = [System.IO.File]::ReadAllText($verPath, [System.Text.Encoding]::UTF8).Trim()
        if ($rawVer) { $agentVer = if ($rawVer.StartsWith("v")) { $rawVer } else { "v$rawVer" } }
    } catch {}
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Text = "3CX Agent: $opName ($opId) [$agentVer]"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$titleItem = $menu.Items.Add("Operator: $opName ($opId)")
$titleItem.Enabled = $false
$titleItem.Font = New-Object System.Drawing.Font($titleItem.Font, [System.Drawing.FontStyle]::Bold)

$versionItem = $menu.Items.Add("Versiya: $agentVer")
$versionItem.Enabled = $false

$statusItem = $menu.Items.Add("Holati: Faol (Ishlamoqda)")
$statusItem.Enabled = $false

$sep1 = $menu.Items.Add("-")

$openItem = $menu.Items.Add("📊 Dashboardni ochish")
$openItem.add_Click({
    Start-Process "http://213.230.110.9:3005"
})

$restartItem = $menu.Items.Add("🔄 Agentni qayta ishga tushirish")
$restartItem.add_Click({
    $vbsPath = Join-Path $scriptDir "start.vbs"
    Start-Process "wscript.exe" -ArgumentList ('\"' + $vbsPath + '\"')
    $tray.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$sep2 = $menu.Items.Add("-")

$exitItem = $menu.Items.Add("❌ Chiqish")
$exitItem.add_Click({
    Get-Process -Name "agent" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$scriptDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    $tray.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$tray.ContextMenuStrip = $menu

# Agent jarayonini ishga tushirish (agar ishlamayotgan bo'lsa)
$agentProc = Get-Process -Name "agent" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$scriptDir*" }
if (-not $agentProc) {
    $exePath = Join-Path $scriptDir "agent.exe"
    if (Test-Path $exePath) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $exePath
        $psi.WorkingDirectory = $scriptDir
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false
        [System.Diagnostics.Process]::Start($psi) | Out-Null
    }
}

[System.Windows.Forms.Application]::Run()
`;
}

function getIshgaTushirishBat(opName, opId) {
    return `@echo off
title 3CX Desktop Agent
cd /d "%~dp0"

echo ======================================================
echo  3CX Desktop Agent - O'rnatish va Ishga Tushirish
echo  Operator: ${opName} (${opId || 'Universal'})
echo ======================================================
echo.

:: 1. Blokirovkadan yechish (Mark of the Web / "Zapustit qilaymi?" so'rovlarini olib tashlash)
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"

set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\\3CX_Agent_AutoStart.lnk"
set "TARGET_VBS=%~dp0start.vbs"

:: 2. Windows 11/10 uchun 100% yashirin Startup yorlig'i (wscript orqali qora oyna chiqmaydi)
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

:: 3. Hozir fonda (Tray menyusida) ishga tushirish
start "" wscript.exe "%TARGET_VBS%"

echo [MUVAFFAQIYATLI] 3CX Agent ishga tushdi va avto-yuklanishga o'rnatildi!
echo Soat yonida (Tray menyusida) 3CX ikonkasini ko'rishingiz mumkin.
echo.
timeout /t 3
`;
}

function getOchirishBat() {
    return `@echo off
title 3CX Desktop Agent - O'chirish
cd /d "%~dp0"

echo 3CX Agent jarayonlari to'xtatilmoqda...
taskkill /F /IM agent.exe >nul 2>&1
powershell -Command "Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*tray_launcher.ps1*' } | Stop-Process -Force" >nul 2>&1

set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
if exist "%STARTUP_DIR%\\3CX_Agent_AutoStart.lnk" (
    del /F /Q "%STARTUP_DIR%\\3CX_Agent_AutoStart.lnk"
    echo Avto-yuklanish (Startup) yorlig'i o'chirildi.
)

echo.
echo [OK] 3CX Agent to'xtatildi va o'chirildi.
pause
`;
}

function getStartVbs() {
    return `Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript = scriptDir & "\\tray_launcher.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psScript & """"
WshShell.Run cmd, 0, False
`;
}

function getReadmeTxt(opName, opId) {
    return `======================================================
3CX DESKTOP AGENT - O'RNATISH YO'RIQNOMASI
Operator: ${opName} (${opId || 'Universal'})
======================================================

1. Ushbu arxivni kompyuteringizdagi istalgan xavfsiz papkaga 
   oching (masalan: C:\\3CX_Agent\\).

2. "Ishga_tushirish.bat" faylini sichqoncha bilan 2 marta bosing.

3. Bo'ldi! Dastur kompyuter yoqilganda avtomatik fonda 
   ishga tushadi va soat yonidagi (Tray) menyuda paydo bo'ladi.

4. Agar agentni o'chirmoqchi bo'lsangiz:
   "Ochirish.bat" faylini bosing.
`;
}

// Barcha operatorlar uchun papka va fayllarni yaratish
async function generateAll() {
    console.log(`Boshlandi: ${OPERATORS.length} ta operator uchun paketlar yaratilmoqda...`);

    for (const op of OPERATORS) {
        const opDir = path.join(DIST_DIR, op.folder);
        if (!fs.existsSync(opDir)) {
            fs.mkdirSync(opDir, { recursive: true });
        }

        // 1. agent.exe nusxalash
        const destExe = path.join(opDir, 'agent.exe');
        if (!fs.existsSync(destExe) || fs.statSync(destExe).size !== fs.statSync(BASE_EXE).size) {
            fs.copyFileSync(BASE_EXE, destExe);
        }

        // 2. config.json
        const configData = {
            heartbeatIntervalSec: 5,
            operatorId: op.id,
            serverUrl: "http://213.230.110.9:3535",
            serverUrls: ["http://213.230.110.9:3535", "http://192.168.0.2:3535"],
            customLogPath: "",
            devServerUrl: ""
        };
        fs.writeFileSync(path.join(opDir, 'config.json'), JSON.stringify(configData, null, 2), 'utf8');

        // 3. Ishga_tushirish.bat
        fs.writeFileSync(path.join(opDir, 'Ishga_tushirish.bat'), getIshgaTushirishBat(op.name, op.id), 'utf8');

        // 4. Ochirish.bat
        fs.writeFileSync(path.join(opDir, 'Ochirish.bat'), getOchirishBat(), 'utf8');

        // 5. start.vbs
        fs.writeFileSync(path.join(opDir, 'start.vbs'), getStartVbs(), 'utf8');

        // 6. tray_launcher.ps1
        fs.writeFileSync(path.join(opDir, 'tray_launcher.ps1'), getTrayLauncherContent(op.id, op.name), 'utf8');

        // 7. version.txt
        fs.writeFileSync(path.join(opDir, 'version.txt'), '1.0.1', 'utf8');

        // 8. README.txt
        fs.writeFileSync(path.join(opDir, 'README.txt'), getReadmeTxt(op.name, op.id), 'utf8');

        // 9. Zip arxiv yaratish
        const zipFile = path.join(DIST_DIR, `${op.folder}.zip`);
        await createZip(opDir, zipFile);
        console.log(`✅ [${op.folder}] Tayyorlandi -> ${op.folder}.zip (${(fs.statSync(zipFile).size / 1024 / 1024).toFixed(2)} MB)`);
    }

    console.log('🎉 Barcha operatorlar paketlari muvaffaqiyatli tayyorlandi!');
}

function createZip(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

generateAll().catch(console.error);
