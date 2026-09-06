@echo off
rem Start DSH Web server and open browser
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { ^
  $port = 3080; ^
  $healthy = $false; ^
  try { ^
    $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3080/' -TimeoutSec 2; ^
    if ($resp.StatusCode -eq 200) { $healthy = $true } ^
  } catch {}; ^
  if (-not $healthy) { ^
    Write-Host '[DSH Web] Starting DSH Web on port 3080...' -ForegroundColor Cyan; ^
    Start-Process -FilePath 'dsh' -ArgumentList 'web' -WindowStyle Hidden; ^
    Start-Sleep -Seconds 2; ^
  } else { ^
    Write-Host '[DSH Web] Server is already running on port 3080.' -ForegroundColor Green; ^
  }; ^
  Start-Process 'http://127.0.0.1:3080'; ^
}"
