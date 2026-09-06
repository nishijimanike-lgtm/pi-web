#Requires -Version 5.1
<#
.SYNOPSIS
    Headless pi-web background service (no System Tray UI).
    Used by Task Scheduler for reliable autostart without desktop-heap issues.
#>
param(
    [int]$Port = 0,
    [string]$Hostname = "",
    [string]$Mode = "",
    [string]$ConfigPath = "$env:USERPROFILE\.pi\agent\web-service.json"
)

$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$PkgJsonPath = Join-Path $RepoRoot "package.json"
$PkgVersion = "0.0.0"
if (Test-Path $PkgJsonPath) {
    try { $pkg = Get-Content $PkgJsonPath -Raw | ConvertFrom-Json; if ($pkg.version) { $PkgVersion = $pkg.version } } catch { }
}
$DefaultPort = 30141
$DefaultHostname = "127.0.0.1"
$DefaultMode = "start"
$DefaultAutoRestart = $true

$Config = $null
if (Test-Path $ConfigPath) { try { $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { } }

$EffectivePort = if ($Port -gt 0) { $Port } elseif ($Config -and $Config.port) { [int]$Config.port } else { $DefaultPort }
$EffectiveHostname = if (![string]::IsNullOrWhiteSpace($Hostname)) { $Hostname } elseif ($Config -and $Config.hostname) { [string]$Config.hostname } else { $DefaultHostname }
$EffectiveMode = if (![string]::IsNullOrWhiteSpace($Mode)) { $Mode } elseif ($Config -and $Config.mode) { [string]$Config.mode } else { $DefaultMode }
$EffectiveAutoRestart = if ($Config -and ($null -ne $Config.autoRestart)) { [bool]$Config.autoRestart } else { $DefaultAutoRestart }

$NextDir = Join-Path $RepoRoot ".next"
if ($EffectiveMode -eq "start" -and !(Test-Path $NextDir)) {
    $EffectiveMode = "dev"
}
$ServerUrl = if ($EffectiveHostname -eq "0.0.0.0" -or $EffectiveHostname -eq "::" -or [string]::IsNullOrWhiteSpace($EffectiveHostname)) { "http://localhost:$EffectivePort" } else { "http://${EffectiveHostname}:$EffectivePort" }

# Mutex to prevent duplicate service instances
$MutexName = "Local\PiWebService_Instance_Mutex"
$createdNew = $false
try { $script:AppMutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew) } catch { $createdNew = $true }
if (!$createdNew) { Exit 0 }

# Logging
$LogDir = Join-Path $env:USERPROFILE ".pi\agent\logs"
if (!(Test-Path $LogDir)) { New-Item -Path $LogDir -ItemType Directory -Force | Out-Null }
$LogFile = Join-Path $LogDir "pi-web-service.log"
$OldLogFile = Join-Path $LogDir "pi-web-service.old.log"
if (Test-Path $LogFile) {
    try {
        $logItem = Get-Item $LogFile
        if ($logItem.Length -gt 5 * 1024 * 1024) { Move-Item -Path $LogFile -Destination $OldLogFile -Force -ErrorAction SilentlyContinue }
    } catch { }
}
$script:LogLock = New-Object object
function Write-ServiceLog([string]$message) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $line = "[$timestamp] $message"
    [System.Threading.Monitor]::Enter($script:LogLock)
    try { [System.IO.File]::AppendAllText($LogFile, "$line`r`n") } catch { }
    finally { [System.Threading.Monitor]::Exit($script:LogLock) }
}
Write-ServiceLog "=========================================="
Write-ServiceLog "pi-web Service v$PkgVersion starting (headless)"
Write-ServiceLog "Repository Root: $RepoRoot"
Write-ServiceLog "Target: $ServerUrl (Mode: $EffectiveMode, Port: $EffectivePort)"
Write-ServiceLog "=========================================="

$script:ChildProcess = $null
$script:IsExiting = $false
$script:CrashTimestamps = [System.Collections.Generic.List[datetime]]::new()

function Find-NodeExecutable {
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCmd -and (Test-Path $nodeCmd.Source)) { return $nodeCmd.Source }
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\node\node.exe",
        "$env:USERPROFILE\.bun\bin\node.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return "node.exe"
}
$NodeExe = Find-NodeExecutable

function Test-ServerHealth {
    try {
        $req = [System.Net.WebRequest]::Create($ServerUrl)
        $req.Timeout = 2000
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch { return $false }
}

function Start-WebServer {
    if ($script:ChildProcess -and !$script:ChildProcess.HasExited) { return }
    Write-ServiceLog "Starting web server in $EffectiveMode mode on ${EffectiveHostname}:${EffectivePort}..."

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodeExe
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    if ($EffectiveMode -eq "start") {
        $launcher = Join-Path $RepoRoot "bin\pi-web.js"
        $psi.Arguments = "`"$launcher`" -p $EffectivePort -H $EffectiveHostname --no-open"
    } else {
        $nextBin = Join-Path $RepoRoot "node_modules\next\dist\bin\next"
        $psi.Arguments = "`"$nextBin`" dev -H $EffectiveHostname -p $EffectivePort"
    }

    $psi.EnvironmentVariables["PI_WEB_PORT"] = [string]$EffectivePort
    $psi.EnvironmentVariables["PI_WEB_HOSTNAME"] = [string]$EffectiveHostname
    $psi.EnvironmentVariables["PI_WEB_SERVICE"] = "1"
    $psi.EnvironmentVariables["PORT"] = [string]$EffectivePort

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
        if ($EventArgs.Data) { Write-ServiceLog "[STDOUT] $($EventArgs.Data)" }
    } | Out-Null
    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
        if ($EventArgs.Data) { Write-ServiceLog "[STDERR] $($EventArgs.Data)" }
    } | Out-Null

    try {
        if ($proc.Start()) {
            $proc.BeginOutputReadLine()
            $proc.BeginErrorReadLine()
            $script:ChildProcess = $proc
            Write-ServiceLog "Child server process started with PID $($proc.Id)"
        } else {
            Write-ServiceLog "Failed to start child server process."
        }
    } catch {
        Write-ServiceLog "Exception starting child server: $($_.Exception.Message)"
    }
}

function Stop-WebServer {
    if (!$script:ChildProcess) { return }
    try {
        Write-ServiceLog "Stopping child server process (PID $($script:ChildProcess.Id))..."
        $taskkillExe = Join-Path $env:SystemRoot "System32\taskkill.exe"
        if (!(Test-Path $taskkillExe)) { $taskkillExe = "taskkill.exe" }
        Start-Process -FilePath $taskkillExe -ArgumentList "/PID $($script:ChildProcess.Id) /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    } catch {
        Write-ServiceLog "Error stopping child server: $($_.Exception.Message)"
    } finally {
        $script:ChildProcess = $null
        Write-ServiceLog "Child server stopped."
    }
}

Start-WebServer

while (!$script:IsExiting) {
    Start-Sleep -Seconds 3
    $healthy = Test-ServerHealth

    if ($healthy) {
        continue
    }

    if (!$script:ChildProcess -or $script:ChildProcess.HasExited) {
        if ($script:ChildProcess -and $script:ChildProcess.HasExited) {
            Write-ServiceLog "Child server process exited with code $($script:ChildProcess.ExitCode)."
            $script:ChildProcess = $null
        }

        if (!$EffectiveAutoRestart) {
            continue
        }

        $now = Get-Date
        $script:CrashTimestamps.Add($now)
        $cutoff = $now.AddSeconds(-30)
        $script:CrashTimestamps = [System.Collections.Generic.List[datetime]]($script:CrashTimestamps | Where-Object { $_ -gt $cutoff })

        if ($script:CrashTimestamps.Count -ge 3) {
            Write-ServiceLog "CRASH LOOP: Server crashed 3 times within 30 seconds. Disabling auto-restart."
            break
        }

        Write-ServiceLog "Server process is down. Triggering auto-restart..."
        Start-WebServer
    }
}

Stop-WebServer
if ($script:AppMutex) {
    try { $script:AppMutex.ReleaseMutex() } catch { }
    $script:AppMutex.Dispose()
}
