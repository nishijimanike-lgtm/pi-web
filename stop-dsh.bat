@echo off
rem Stop DSH Web server on port 3080
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { ^
  $port = 3080; ^
  $pids = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); ^
  if ($pids.Count -eq 0) { ^
    Write-Host '[DSH Web] No active server found on port 3080.' -ForegroundColor Yellow; ^
  } else { ^
    foreach ($p in $pids) { ^
      Write-Host \"[DSH Web] Stopping process $p on port $port...\" -ForegroundColor Cyan; ^
      cmd /c \"taskkill /PID $p /T /F >nul 2>&1\"; ^
    }; ^
    Write-Host '[DSH Web] Server stopped successfully.' -ForegroundColor Green; ^
  } ^
}"
