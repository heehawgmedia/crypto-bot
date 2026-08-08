# Heehaw's Lab — install (or remove) the auto-start scheduled task (Windows)
#
# Registers a Windows Scheduled Task that launches scripts\run_paper.ps1 in a
# hidden window every time you log on, and starts it immediately. That keeper
# runs `quant-lab serve`: the dashboard AND the paper fleet in one process.
# Combined with the keeper's restart loop, the bot survives reboots, crashes,
# and network outages. State is in SQLite, so restarts never lose the track
# record — and a bot you stopped from the dashboard stays stopped.
#
# A desktop shortcut to the dashboard is created too.
#
# Run from an ADMINISTRATOR PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\install_autostart.ps1
# Remove with:
#   powershell -ExecutionPolicy Bypass -File scripts\install_autostart.ps1 -Remove

param(
    [switch]$Remove,
    [int]$Port = 8787
)

$TaskName = "Heehaws Lab Paper Trading"
$Keeper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run_paper.ps1"
$Url = "http://127.0.0.1:$Port/"
$Shortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Heehaw's Lab.url"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$TaskName' (if it existed)."
    Remove-Item -Path $Shortcut -ErrorAction SilentlyContinue
    Write-Host "If the keeper is currently running, close its PowerShell process too."
    exit 0
}

if (-not (Test-Path $Keeper)) {
    Write-Error "run_paper.ps1 not found next to this script ($Keeper)"
    exit 1
}

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Keeper`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 2) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
    -Settings $Settings -Description "Heehaw's Lab dashboard + paper-trading fleet" `
    -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName' (runs hidden at every logon)."
Start-ScheduledTask -TaskName $TaskName

# Desktop shortcut so the dashboard is always one double-click away.
try {
    Set-Content -Path $Shortcut -Value "[InternetShortcut]`r`nURL=$Url" -Encoding ASCII
    Write-Host "Desktop shortcut created: Heehaw's Lab"
} catch {
    Write-Host "(Could not create the desktop shortcut: $_)"
}

Write-Host ""
Write-Host "Started it now. Give it about 20 seconds, then open:"
Write-Host "    $Url"
Write-Host "The dashboard has Start/Stop buttons and refreshes itself."
Write-Host ""
Write-Host "Other ways to check in:"
Write-Host "    py -m quant_lab.cli status"
Write-Host "    Get-Content data\paper_run.log -Tail 20"
Write-Host ""
Write-Host "NOTE: it runs while you are logged on. To have it run even when"
Write-Host "logged out, open Task Scheduler, find the task, and choose"
Write-Host "'Run whether user is logged on or not' (Windows will ask for your"
Write-Host "password to store)."
