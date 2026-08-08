# Heehaw's Lab — install (or remove) the auto-start scheduled task (Windows)
#
# Registers a Windows Scheduled Task that launches scripts\run_paper.ps1 in a
# hidden window every time you log on, and starts it immediately. Combined
# with the keeper's own restart loop, the paper fleet survives reboots,
# crashes, and network outages. State is in SQLite, so restarts never lose
# the track record.
#
# Run from an ADMINISTRATOR PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\install_autostart.ps1
# Remove with:
#   powershell -ExecutionPolicy Bypass -File scripts\install_autostart.ps1 -Remove

param([switch]$Remove)

$TaskName = "Heehaws Lab Paper Trading"
$Keeper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run_paper.ps1"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$TaskName' (if it existed)."
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
    -Settings $Settings -Description "Heehaw's Lab paper-trading fleet (auto-restart keeper)" `
    -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName' (runs hidden at every logon)."
Start-ScheduledTask -TaskName $TaskName
Write-Host "Started it now. Watch progress in data\paper_run.log or via:"
Write-Host "    py -m quant_lab.cli status"
Write-Host "    py -m quant_lab.cli dashboard --open"
Write-Host ""
Write-Host "NOTE: it runs while you are logged on. To have it run even when"
Write-Host "logged out, open Task Scheduler, find the task, and choose"
Write-Host "'Run whether user is logged on or not' (Windows will ask for your"
Write-Host "password to store)."
