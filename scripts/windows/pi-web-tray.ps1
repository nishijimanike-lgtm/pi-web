#Requires -Version 5.1
<#
.SYNOPSIS
    Native Windows System Tray Manager and Background Service for pi-web.
.DESCRIPTION
    Runs pi-web in the background without a terminal window, monitors server health,
    provides a system tray context menu, auto-restarts on crash, and manages Windows startup.
.PARAMETER Port
    HTTP port to bind (default 30141).
.PARAMETER Hostname
    Bind address (default 127.0.0.1).
.PARAMETER Mode
    Execution mode: "start" (production) or "dev" (development). Default "start".
.PARAMETER Startup
    Switch indicating invocation from Windows Startup (prevents opening browser).
.PARAMETER OpenBrowser
    Switch to open the default web browser once the server is responsive.
.PARAMETER ConfigPath
    Path to configuration JSON file (default ~/.pi/agent/web-service.json).
#>

param(
    [int]$Port = 0,
    [string]$Hostname = "",
    [string]$Mode = "",
    [switch]$Startup,
    [switch]$OpenBrowser,
    [string]$ConfigPath = "$env:USERPROFILE\.pi\agent\web-service.json"
)

# Load required .NET Windows Forms and Drawing assemblies
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# -----------------------------------------------------------------------------
# 1. Configuration & Resolution
# -----------------------------------------------------------------------------
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$PkgJsonPath = Join-Path $RepoRoot "package.json"
$PkgVersion = "0.0.0"
if (Test-Path $PkgJsonPath) {
    try {
        $pkg = Get-Content $PkgJsonPath -Raw | ConvertFrom-Json
        if ($pkg.version) { $PkgVersion = $pkg.version }
    } catch { }
}

$DefaultPort = 30141
$DefaultHostname = "127.0.0.1"
$DefaultMode = "start"
$DefaultAutostart = $true
$DefaultAutoRestart = $true

$Config = $null
if (Test-Path $ConfigPath) {
    try {
        $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    } catch { }
}

$EffectivePort = if ($Port -gt 0) { $Port } elseif ($Config -and $Config.port) { [int]$Config.port } else { $DefaultPort }
$EffectiveHostname = if (![string]::IsNullOrWhiteSpace($Hostname)) { $Hostname } elseif ($Config -and $Config.hostname) { [string]$Config.hostname } else { $DefaultHostname }
$EffectiveMode = if (![string]::IsNullOrWhiteSpace($Mode)) { $Mode } elseif ($Config -and $Config.mode) { [string]$Config.mode } else { $DefaultMode }
$EffectiveAutoRestart = if ($Config -and ($null -ne $Config.autoRestart)) { [bool]$Config.autoRestart } else { $DefaultAutoRestart }

$ShouldOpenBrowser = $false
if ($OpenBrowser) {
    $ShouldOpenBrowser = $true
} elseif (!$Startup -and $Config -and $Config.openBrowserOnLaunch) {
    $ShouldOpenBrowser = $true
}

$NextDir = Join-Path $RepoRoot ".next"
if ($EffectiveMode -eq "start" -and !(Test-Path $NextDir)) {
    $EffectiveMode = "dev"
}

$ServerUrl = if ($EffectiveHostname -eq "0.0.0.0" -or $EffectiveHostname -eq "::" -or [string]::IsNullOrWhiteSpace($EffectiveHostname)) {
    "http://localhost:$EffectivePort"
} else {
    "http://${EffectiveHostname}:${EffectivePort}"
}

# -----------------------------------------------------------------------------
# 2. Single-Instance Enforcement via Mutex
# -----------------------------------------------------------------------------
$MutexName = "Local\PiWebTray_Instance_Mutex"
$createdNew = $false
try {
    $script:AppMutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew)
} catch {
    $createdNew = $true
}

if (!$createdNew) {
    if ($ShouldOpenBrowser) {
        Start-Process $ServerUrl
    }
    [System.Windows.Forms.MessageBox]::Show(
        "Pi Web Tray is already running in your notification area.",
        "Pi Web Tray",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    Exit 0
}

# -----------------------------------------------------------------------------
# 3. Logging Setup
# -----------------------------------------------------------------------------
$LogDir = Join-Path $env:USERPROFILE ".pi\agent\logs"
if (!(Test-Path $LogDir)) {
    New-Item -Path $LogDir -ItemType Directory -Force | Out-Null
}
$LogFile = Join-Path $LogDir "pi-web-service.log"
$OldLogFile = Join-Path $LogDir "pi-web-service.old.log"

if (Test-Path $LogFile) {
    try {
        $logItem = Get-Item $LogFile
        if ($logItem.Length -gt 5 * 1024 * 1024) {
            Move-Item -Path $LogFile -Destination $OldLogFile -Force -ErrorAction SilentlyContinue
        }
    } catch { }
}

$script:LogLock = New-Object object
function Write-ServiceLog([string]$message) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $line = "[$timestamp] $message"
    [System.Threading.Monitor]::Enter($script:LogLock)
    try {
        [System.IO.File]::AppendAllText($LogFile, "$line`r`n")
    } catch { }
    finally {
        [System.Threading.Monitor]::Exit($script:LogLock)
    }
}

Write-ServiceLog "=========================================="
Write-ServiceLog "Pi Web Tray v$PkgVersion starting (PowerShell UI)"
Write-ServiceLog "Repository Root: $RepoRoot"
Write-ServiceLog "Target: $ServerUrl (Mode: $EffectiveMode, Port: $EffectivePort)"
Write-ServiceLog "=========================================="

# -----------------------------------------------------------------------------
# 4. Process State & Node Resolution
# -----------------------------------------------------------------------------
$script:ChildProcess = $null
$script:ManagedPid = $null
$script:ServerState = "Starting"
$script:CrashTimestamps = [System.Collections.Generic.List[datetime]]::new()
$script:IsExiting = $false

function Find-NodeExecutable {
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCmd -and (Test-Path $nodeCmd.Source)) { return $nodeCmd.Source }
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\node\node.exe",
        "$env:USERPROFILE\.bun\bin\node.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return "node.exe"
}
$NodeExe = Find-NodeExecutable

function Test-ServerHealth {
    try {
        $req = [System.Net.WebRequest]::Create($ServerUrl)
        $req.Timeout = 1500
        $req.Method = "GET"
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

# The server is identified by who owns the listening port, not only by the child
# handle we spawned. An adopted server has no child handle, and treating "no
# handle" as "no server" is what hid the stop option and made restart collide.
function Get-PortOwnerPid {
    try {
        $conns = Get-NetTCPConnection -State Listen -LocalPort $EffectivePort -ErrorAction SilentlyContinue
        if ($conns) {
            $owners = @($conns | Select-Object -ExpandProperty OwningProcess -Unique |
                Where-Object { $_ -and $_ -gt 0 -and $_ -ne $PID })
            if ($owners.Count -gt 0) { return [int]$owners[0] }
        }
    } catch { }
    return $null
}

function Test-PiWebProcess {
    param([int]$TargetPid)
    if ($TargetPid -le 0 -or $TargetPid -eq $PID) { return $false }
    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (!$proc) { return $false }
    $name = $proc.ProcessName.ToLowerInvariant()
    return ($name -like "*node*" -or $name -like "*pi-web*" -or $name -like "*bun*" -or $name -like "*deno*")
}

function Wait-ForPortFree {
    param([int]$TimeoutMs = 8000)
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    while ($true) {
        if (!(Get-PortOwnerPid)) { return $true }
        if ((Get-Date) -ge $deadline) { return $false }
        Start-Sleep -Milliseconds 400
    }
}

function Start-WebServer {
    if (Test-ServerHealth) {
        $script:ManagedPid = Get-PortOwnerPid
        $script:ServerState = "Running"
        Update-TrayMenu
        Write-ServiceLog "Existing server is already active at $ServerUrl. Adopting monitoring (PID $($script:ManagedPid))."
        return
    }
    if ($script:ChildProcess -and !$script:ChildProcess.HasExited) { return }

    $portOwner = Get-PortOwnerPid
    if ($portOwner) {
        $script:ServerState = "Error"
        Update-TrayMenu
        Write-ServiceLog "Refusing to start: port $EffectivePort is held by PID $portOwner but is not responding. Use Restart Service to force-stop it."
        return
    }

    $script:ServerState = "Starting"
    Update-TrayMenu
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
            $script:ManagedPid = $proc.Id
            Write-ServiceLog "Child server process started with PID $($proc.Id)"
        } else {
            $script:ServerState = "Error"
            Write-ServiceLog "Failed to start child server process."
            Update-TrayMenu
        }
    } catch {
        $script:ServerState = "Error"
        Write-ServiceLog "Exception starting child server: $($_.Exception.Message)"
        Update-TrayMenu
    }
}

function Stop-WebServer {
    $targetPid = $null
    if ($script:ChildProcess -and !$script:ChildProcess.HasExited) {
        $targetPid = $script:ChildProcess.Id
    } elseif ($script:ManagedPid -and (Get-Process -Id $script:ManagedPid -ErrorAction SilentlyContinue)) {
        $targetPid = $script:ManagedPid
    } else {
        $targetPid = Get-PortOwnerPid
    }

    if (!$targetPid) {
        Write-ServiceLog "Stop requested, but no server process was found."
    } elseif (!(Test-PiWebProcess -TargetPid $targetPid)) {
        $image = "unknown"
        $ownerProc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
        if ($ownerProc) { $image = $ownerProc.ProcessName }
        Write-ServiceLog "Refusing to stop PID $targetPid ($image): it does not look like a Pi Web server."
    } else {
        try {
            Write-ServiceLog "Stopping server process (PID $targetPid) and its children..."
            $taskkillExe = Join-Path $env:SystemRoot "System32\taskkill.exe"
            if (!(Test-Path $taskkillExe)) { $taskkillExe = "taskkill.exe" }
            Start-Process -FilePath $taskkillExe -ArgumentList "/PID $targetPid /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
        } catch {
            Write-ServiceLog "Error killing server process: $($_.Exception.Message)"
        }
    }

    $script:ChildProcess = $null
    $script:ManagedPid = $null
    if (Wait-ForPortFree -TimeoutMs 4000) {
        $script:ServerState = "Stopped"
        Write-ServiceLog "Server stopped."
    } else {
        $script:ServerState = "Running"
        Write-ServiceLog "Server is still listening on port $EffectivePort after the stop request."
    }
    Update-TrayMenu
}

function Restart-WebServer {
    Write-ServiceLog "Restart requested from tray."
    Stop-WebServer

    # Never spawn into a port that is still bound: that is what turned a restart
    # into an EADDRINUSE crash loop.
    if (!(Wait-ForPortFree -TimeoutMs 8000)) {
        $owner = Get-PortOwnerPid
        $ownerText = ""
        if ($owner) { $ownerText = " (PID $owner)" }
        $script:ServerState = "Error"
        Update-TrayMenu
        Write-ServiceLog "Restart aborted: port $EffectivePort is still in use$ownerText."
        if ($Tray) {
            $Tray.ShowBalloonTip(3000, "Pi Web", "Port $EffectivePort could not be released. Restart aborted - see logs.", [System.Windows.Forms.ToolTipIcon]::Error)
        }
        return
    }

    Start-WebServer
}

# -----------------------------------------------------------------------------
# 5. System Tray UI Construction
# -----------------------------------------------------------------------------
$IcoPath = Join-Path $RepoRoot "public\icons\pi-web.ico"
$FaviconPath = Join-Path $RepoRoot "app\favicon.ico"
$PngPath = Join-Path $RepoRoot "public\icons\icon-512.png"
if (!(Test-Path $PngPath)) { $PngPath = Join-Path $RepoRoot "public\icons\icon-192.png" }

$AppIcon = $null
if (Test-Path $IcoPath) {
    try { $AppIcon = New-Object System.Drawing.Icon($IcoPath) } catch { }
}
if (!$AppIcon -and (Test-Path $FaviconPath)) {
    try { $AppIcon = New-Object System.Drawing.Icon($FaviconPath) } catch { }
}
if (!$AppIcon -and (Test-Path $PngPath)) {
    try {
        $bmp = [System.Drawing.Bitmap]::FromFile($PngPath)
        $hIcon = $bmp.GetHicon()
        $AppIcon = [System.Drawing.Icon]::FromHandle($hIcon)
    } catch { }
}
if (!$AppIcon) {
    $AppIcon = [System.Drawing.SystemIcons]::Application
}

$Tray = New-Object System.Windows.Forms.NotifyIcon
$Tray.Icon = $AppIcon
$Tray.Text = "Pi Web v$PkgVersion ($($script:ServerState))"
$Tray.Visible = $true

$Menu = New-Object System.Windows.Forms.ContextMenuStrip

$MenuHeader = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuHeader.Text = "Pi Web v$PkgVersion"
$MenuHeader.Font = New-Object System.Drawing.Font($MenuHeader.Font, [System.Drawing.FontStyle]::Bold)
$MenuHeader.Enabled = $false
$Menu.Items.Add($MenuHeader) | Out-Null

$MenuStatus = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuStatus.Text = "Status: Starting..."
$MenuStatus.Enabled = $false
$Menu.Items.Add($MenuStatus) | Out-Null

$Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$MenuOpen = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuOpen.Text = "🌐 Open in Browser"
$MenuOpen.Font = New-Object System.Drawing.Font($MenuOpen.Font, [System.Drawing.FontStyle]::Bold)
$MenuOpen.Add_Click({ Start-Process $ServerUrl })
$Menu.Items.Add($MenuOpen) | Out-Null

$MenuCopy = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuCopy.Text = "📋 Copy URL"
$MenuCopy.Add_Click({
    [System.Windows.Forms.Clipboard]::SetText($ServerUrl)
    $Tray.ShowBalloonTip(2000, "Pi Web", "Copied $ServerUrl to clipboard", [System.Windows.Forms.ToolTipIcon]::Info)
})
$Menu.Items.Add($MenuCopy) | Out-Null

$MenuRestart = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuRestart.Text = "🔄 Restart Service"
$MenuRestart.Add_Click({ Restart-WebServer })
$Menu.Items.Add($MenuRestart) | Out-Null

$MenuToggle = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuToggle.Text = "⏸ Stop Service"
$MenuToggle.Add_Click({
    if ($script:ServerState -eq "Running" -or $script:ServerState -eq "Starting" -or ($script:ChildProcess -and !$script:ChildProcess.HasExited)) {
        Stop-WebServer
    } else {
        Start-WebServer
    }
})
$Menu.Items.Add($MenuToggle) | Out-Null

$Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$MenuViewLogs = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuViewLogs.Text = "📜 View Logs"
$MenuViewLogs.Add_Click({
    if (Test-Path $LogFile) {
        Start-Process "notepad.exe" "`"$LogFile`""
    } else {
        [System.Windows.Forms.MessageBox]::Show("Log file does not exist yet.", "Pi Web Tray") | Out-Null
    }
})
$Menu.Items.Add($MenuViewLogs) | Out-Null

$MenuConfig = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuConfig.Text = "⚙️ Edit Config"
$MenuConfig.Add_Click({
    if (Test-Path $ConfigPath) {
        Start-Process "notepad.exe" "`"$ConfigPath`""
    } else {
        [System.Windows.Forms.MessageBox]::Show("Config file not found at:`n$ConfigPath", "Pi Web Tray") | Out-Null
    }
})
$Menu.Items.Add($MenuConfig) | Out-Null

$MenuOpenFolder = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuOpenFolder.Text = "📂 Open Project Folder"
$MenuOpenFolder.Add_Click({ Start-Process "explorer.exe" "`"$RepoRoot`"" })
$Menu.Items.Add($MenuOpenFolder) | Out-Null

$Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$StartupLnk = Join-Path ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Startup)) "pi-web-tray.lnk"
$MenuAutostart = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuAutostart.Text = "🚀 Run at Startup"
$MenuAutostart.CheckOnClick = $true
$MenuAutostart.Checked = (Test-Path $StartupLnk)
$MenuAutostart.Add_Click({
    $shouldEnable = $MenuAutostart.Checked
    try {
        if ($shouldEnable) {
            $installScript = Join-Path $RepoRoot "scripts\windows\install-tray.ps1"
            Start-Process "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$installScript`" -Port $EffectivePort -Hostname `"$EffectiveHostname`" -Mode `"$EffectiveMode`"" -WindowStyle Hidden -Wait
        } else {
            if (Test-Path $StartupLnk) { Remove-Item -Path $StartupLnk -Force }
        }
    } catch { }
})
$Menu.Items.Add($MenuAutostart) | Out-Null

$MenuExit = New-Object System.Windows.Forms.ToolStripMenuItem
$MenuExit.Text = "❌ Exit"
$MenuExit.Add_Click({
    $script:IsExiting = $true
    Write-ServiceLog "Exiting Pi Web Tray..."
    $HealthTimer.Stop()
    Stop-WebServer
    $Tray.Visible = $false
    $Tray.Dispose()
    if ($script:AppMutex) {
        try { $script:AppMutex.ReleaseMutex() } catch { }
        $script:AppMutex.Dispose()
    }
    [System.Windows.Forms.Application]::Exit()
})
$Menu.Items.Add($MenuExit) | Out-Null

$Tray.ContextMenuStrip = $Menu
$Tray.Add_DoubleClick({ Start-Process $ServerUrl })

function Update-TrayMenu {
    $text = "Pi Web v$PkgVersion ($($script:ServerState))"
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
    $Tray.Text = $text

    if ($script:ServerState -eq "Running") {
        $MenuStatus.Text = "● Running ($EffectivePort)"
        $MenuOpen.Enabled = $true
        $MenuToggle.Text = "⏸ Stop Service"
    } elseif ($script:ServerState -eq "Starting") {
        $MenuStatus.Text = "○ Starting..."
        $MenuOpen.Enabled = $false
        $MenuToggle.Text = "⏸ Stop Service"
    } else {
        $MenuStatus.Text = "○ Stopped"
        $MenuOpen.Enabled = $false
        $MenuToggle.Text = "▶ Start Service"
    }
    $MenuCopy.Text = "📋 Copy URL ($ServerUrl)"
}

# -----------------------------------------------------------------------------
# 6. Health Monitoring & Crash Supervision Timer
# -----------------------------------------------------------------------------
$script:InitialBrowserOpened = $false

$HealthTimer = New-Object System.Windows.Forms.Timer
$HealthTimer.Interval = 3000
$HealthTimer.Add_Tick({
    if ($script:IsExiting) { return }

    $isHealthy = Test-ServerHealth

    if ($isHealthy) {
        if ($script:ServerState -ne "Running") {
            $script:ServerState = "Running"
            if (!$script:ChildProcess -and !$script:ManagedPid) {
                $script:ManagedPid = Get-PortOwnerPid
                Write-ServiceLog "Tracking externally started server PID $($script:ManagedPid)."
            }
            $script:CrashTimestamps.Clear()
            Write-ServiceLog "Server is responsive at $ServerUrl"
            Update-TrayMenu

            if ($ShouldOpenBrowser -and !$script:InitialBrowserOpened) {
                $script:InitialBrowserOpened = $true
                Start-Process $ServerUrl
            }
        }
        return
    }

    if ($script:ChildProcess -and $script:ChildProcess.HasExited) {
        Write-ServiceLog "Child server process exited with code $($script:ChildProcess.ExitCode)."
        $script:ChildProcess = $null

        if (!$EffectiveAutoRestart) {
            $script:ServerState = "Stopped"
            Update-TrayMenu
            return
        }

        $now = Get-Date
        $script:CrashTimestamps.Add($now)
        $cutoff = $now.AddSeconds(-30)
        $script:CrashTimestamps = [System.Collections.Generic.List[datetime]]($script:CrashTimestamps | Where-Object { $_ -gt $cutoff })

        if ($script:CrashTimestamps.Count -ge 3) {
            $script:ServerState = "Error"
            Update-TrayMenu
            Write-ServiceLog "CRASH LOOP: Server crashed 3 times within 30 seconds. Disabling auto-restart."
            $Tray.ShowBalloonTip(5000, "Pi Web Service Alert", "Server crashed repeatedly. Please check logs.", [System.Windows.Forms.ToolTipIcon]::Error)
            return
        }

        Write-ServiceLog "Server process is down. Triggering auto-restart..."
        Start-WebServer
        return
    }

    if (!$script:ChildProcess) {
        # Do nothing if it's already in Error or Stopped state
        if ($script:ServerState -ne "Error" -and $script:ServerState -ne "Stopped") {
            $script:ServerState = "Stopped"
            Update-TrayMenu
        }
    } else {
        if ($script:ServerState -ne "Starting") {
            $script:ServerState = "Starting"
            Update-TrayMenu
        }
    }
})

# Start Web Server & Begin Loop
if (Test-ServerHealth) {
    $script:ServerState = "Running"
    Update-TrayMenu
    Write-ServiceLog "Existing server detected at $ServerUrl, adopting monitoring without spawning duplicate process."
    if ($ShouldOpenBrowser -and !$script:InitialBrowserOpened) {
        $script:InitialBrowserOpened = $true
        Start-Process $ServerUrl
    }
} else {
    Start-WebServer
}
$HealthTimer.Start()
[System.Windows.Forms.Application]::Run()
