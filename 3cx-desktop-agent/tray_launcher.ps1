# 3CX Agent Tray Launcher
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$cfgPath   = Join-Path $scriptDir "config.json"
$opId      = "???"
$opName    = "Operator"

if (Test-Path $cfgPath) {
    try {
        $raw = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8)
        $rawClean = $raw.Trim().Trim([char]0xFEFF)
        $cfg = $rawClean | ConvertFrom-Json
        if ($cfg.operatorId) { $opId = [string]$cfg.operatorId }
    } catch {}
}

$names = @{ "101"="Oybek"; "103"="Feruza"; "106"="Gulchehra"; "111"="Nozima"; "114"="Maxmudbek"; "116"="Ibrohim"; "119"="Muattar"; "120"="Navruzoy" }
if ($names.ContainsKey($opId)) { $opName = $names[$opId] }

# Tray icon
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Text = "3CX Agent: $opName ($opId)"
$tray.Visible = $true

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$titleItem = $menu.Items.Add("Operator: $opName ($opId)")
$titleItem.Enabled = $false
$titleItem.Font = New-Object System.Drawing.Font($titleItem.Font, [System.Drawing.FontStyle]::Bold)

$statusItem = $menu.Items.Add("Holati: Faol (Ishlamoqda)")
$statusItem.Enabled = $false

$menu.Items.Add("-") | Out-Null

$exitItem = $menu.Items.Add("Chiqish (Exit)")

# Agent exe ni yashirin ishga tushirish (UseShellExecute = true bilan)
$agentExe  = Join-Path $scriptDir "agent.exe"
$agentProc = $null
if (Test-Path $agentExe) {
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = $agentExe
    $pinfo.WorkingDirectory = $scriptDir
    $pinfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $pinfo.UseShellExecute = $true
    $agentProc = [System.Diagnostics.Process]::Start($pinfo)
}

# Chiqish tugmasi bosilganda
$exitItem.add_Click({
    $tray.Visible = $false
    if ($agentProc -and -not $agentProc.HasExited) {
        try { $agentProc.Kill() } catch {}
    }
    [System.Windows.Forms.Application]::Exit()
})

$tray.ContextMenuStrip = $menu

# Bildirishnoma (Balloon)
$tray.BalloonTipTitle = "3CX Agent"
$tray.BalloonTipText  = "$opName ($opId) - Ishga tushdi"
$tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
$tray.ShowBalloonTip(3000)

# Tray loop
[System.Windows.Forms.Application]::Run()