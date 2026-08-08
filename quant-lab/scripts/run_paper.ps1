# Heehaw's Lab — dashboard + paper-trading keeper (Windows)
#
# Runs `quant-lab serve` in an endless supervision loop: the dashboard and the
# paper fleet live in one process, and if it exits for any reason (crash,
# network death, update) it restarts after 60s. All output is appended to
# data\paper_run.log.
#
# While this is running, the dashboard is at http://127.0.0.1:8787/ — open it
# any time to watch trades and to press Start/Stop.
#
# Normally launched by the scheduled task that install_autostart.ps1 creates;
# can also be run by hand:  powershell -ExecutionPolicy Bypass -File scripts\run_paper.ps1

param(
    [int]$Interval = 3600,
    [int]$Port = 0          # 0 = use dashboard.port from config/config.yaml
)

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

$ServeArgs = @("-m", "quant_lab.cli", "serve", "--interval", "$Interval")
if ($Port -gt 0) { $ServeArgs += @("--port", "$Port") }

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $Log -Value "[$ts] [keeper] $msg"
}

Write-Log "keeper started (python: $Python, root: $Root)"

while ($true) {
    Write-Log "launching dashboard + paper fleet"
    try {
        & $Python @ServeArgs 2>&1 |
            ForEach-Object { Add-Content -Path $Log -Value $_ }
    } catch {
        Write-Log "launch failed: $_"
    }
    Write-Log "process exited; restarting in 60s (Ctrl+C or delete the scheduled task to stop)"
    Start-Sleep -Seconds 60
}
