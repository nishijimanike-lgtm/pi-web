$port = 30141
$Host.UI.RawUI.WindowTitle = "Pi Web (Port $port)"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Pi Web Launcher (Port $port)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

Write-Host "[1/3] Closing lingering processes on port $port..." -ForegroundColor Yellow
$pids = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($pids.Count -gt 0) {
    foreach ($p in $pids) {
        Write-Host "  Terminating PID: $p ..." -ForegroundColor Yellow
        cmd /c "taskkill /PID $p /T /F >nul 2>&1"
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "  Port $port is free." -ForegroundColor Green
}

Write-Host "[2/3] Opening browser at http://127.0.0.1:$port ..." -ForegroundColor Green
Start-Process "http://127.0.0.1:$port"

Write-Host "[3/3] Starting dev server (npm run dev)..." -ForegroundColor Cyan
Write-Host "Note: Closing this console window will stop Pi Web server.`n" -ForegroundColor DarkGray

& npm run dev
