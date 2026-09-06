$port = 30141
Write-Host "[Pi Web] Checking listeners on port $port..." -ForegroundColor Cyan
$pids = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($pids.Count -eq 0) {
    Write-Host "[Pi Web] No active server found on port $port." -ForegroundColor Yellow
} else {
    foreach ($p in $pids) {
        Write-Host "[Pi Web] Terminating process PID: $p ..." -ForegroundColor Yellow
        cmd /c "taskkill /PID $p /T /F >nul 2>&1"
    }
    Start-Sleep -Seconds 1
    Write-Host "[Pi Web] Port $port freed successfully." -ForegroundColor Green
}
