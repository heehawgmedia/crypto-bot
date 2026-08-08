# Heehaw's Lab — paper-trading keeper (Windows)
#
# Runs the paper fleet in an endless supervision loop: if the process exits
# for any reason (crash, network death, update), it restarts after 60s.
# All output is appended to data\paper_run.log.
#
# Normally launched by the scheduled task that install_autostart.ps1 creates;
# can also be run by hand:  powershell -ExecutionPolicy Bypass -File scripts\run_paper.ps1

$ErrorActionPreference = "Continue"

# Repo layout: this file lives in <quant-lab>\scripts\
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$LogDir = Join-Path $Root "data"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir "paper_run.log"

# Prefer the project venv's python; fall back to the py launcher.
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $Python = $VenvPython
} else {
    $Python = "py"
}

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $Log -Value "[$ts] [keeper] $msg"
}

Write-Log "keeper started (python: $Python, root: $Root)"

while ($true) {
    Write-Log "launching paper fleet"
    try {
        & $Python -m quant_lab.cli paper run --interval 3600 2>&1 |
            ForEach-Object { Add-Content -Path $Log -Value $_ }
    } catch {
        Write-Log "launch failed: $_"
    }
    Write-Log "paper fleet exited; restarting in 60s (Ctrl+C or delete the scheduled task to stop)"
    Start-Sleep -Seconds 60
}
