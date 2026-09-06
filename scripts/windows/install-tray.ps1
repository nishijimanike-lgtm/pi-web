#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the Windows Background Service and System Tray shortcuts for pi-web.
.PARAMETER Port
    HTTP port to bind (default 30141).
.PARAMETER Hostname
    Bind address (default 127.0.0.1).
.PARAMETER Mode
    Execution mode: "start" (production) or "dev" (development). Default "start".
.PARAMETER NoAutostart
    Do not add to Windows Startup / Task Scheduler.
.PARAMETER StartImmediately
    Launch the tray app / service immediately upon installation.
.PARAMETER Quiet
    Suppress non-error console output.
#>

param(
    [int]$Port = 30141,
    [string]$Hostname = "127.0.0.1",
    [string]$Mode = "start",
    [switch]$NoAutostart,
    [switch]$StartImmediately,
    [switch]$Quiet
)

$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path

function Log-Message([string]$msg) {
    if (!$Quiet) {
        Write-Host $msg
    }
}

# -----------------------------------------------------------------------------
# 1. Icon Generation
# -----------------------------------------------------------------------------
$IconsDir = Join-Path $RepoRoot "public\icons"
if (!(Test-Path $IconsDir)) {
    New-Item -Path $IconsDir -ItemType Directory -Force | Out-Null
}
$IcoPath = Join-Path $IconsDir "pi-web.ico"
$PngPath = Join-Path $IconsDir "icon-512.png"
if (!(Test-Path $PngPath)) {
    $PngPath = Join-Path $IconsDir "icon-192.png"
}
$FaviconPath = Join-Path $RepoRoot "app\favicon.ico"

function Ensure-IconFile {
    if (Test-Path $IcoPath) { return }
    if (!(Test-Path $PngPath)) { return }

    try {
        Add-Type -AssemblyName System.Drawing

        $srcBmp = [System.Drawing.Bitmap]::FromFile($PngPath)
        $sizes = @(16, 32, 48, 64, 128, 256)
        $images = [System.Collections.Generic.List[psobject]]::new()

        foreach ($s in $sizes) {
            $resized = New-Object System.Drawing.Bitmap($s, $s)
            $g = [System.Drawing.Graphics]::FromImage($resized)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.DrawImage($srcBmp, 0, 0, $s, $s)
            $g.Dispose()

            $ms = New-Object System.IO.MemoryStream
            $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $pngBytes = $ms.ToArray()
            $ms.Dispose()
            $resized.Dispose()

            $images.Add([pscustomobject]@{
                Width = if ($s -eq 256) { 0 } else { $s }
                Height = if ($s -eq 256) { 0 } else { $s }
                Data = $pngBytes
            })
        }
        $srcBmp.Dispose()

        $fs = New-Object System.IO.FileStream($IcoPath, [System.IO.FileMode]::Create)
        $bw = New-Object System.IO.BinaryWriter $fs

        # Header: Reserved (0), Type (1 = ICO), Count
        $bw.Write([uint16]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]$images.Count)

        $offset = 6 + (16 * $images.Count)

        foreach ($img in $images) {
            $bw.Write([byte]$img.Width)
            $bw.Write([byte]$img.Height)
            $bw.Write([byte]0) # Color count
            $bw.Write([byte]0) # Reserved
            $bw.Write([uint16]1) # Planes
            $bw.Write([uint16]32) # Bit count
            $bw.Write([uint32]$img.Data.Length)
            $bw.Write([uint32]$offset)
            $offset += $img.Data.Length
        }

        foreach ($img in $images) {
            $bw.Write($img.Data)
        }

        $bw.Flush()
        $bw.Dispose()
        $fs.Dispose()

        Log-Message "  [OK] Generated multi-size icon at: $IcoPath"
    } catch {
        Log-Message "  [WARN] Failed to generate .ico from PNG: $($_.Exception.Message)"
    }
}

Log-Message "Installing pi-web Windows System Tray & Background Service..."
Ensure-IconFile

# -----------------------------------------------------------------------------
# 2. Initialize Service Configuration
# -----------------------------------------------------------------------------
$AgentDir = Join-Path $env:USERPROFILE ".pi\agent"
if (!(Test-Path $AgentDir)) {
    New-Item -Path $AgentDir -ItemType Directory -Force | Out-Null
}
$ConfigPath = Join-Path $AgentDir "web-service.json"

$configData = @{
    port = $Port
    hostname = $Hostname
    mode = $Mode
    autostart = (!$NoAutostart)
    openBrowserOnLaunch = $false
    autoRestart = $true
}

if (Test-Path $ConfigPath) {
    try {
        $existing = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($existing.openBrowserOnLaunch -ne $null) { $configData.openBrowserOnLaunch = [bool]$existing.openBrowserOnLaunch }
        if ($existing.autoRestart -ne $null) { $configData.autoRestart = [bool]$existing.autoRestart }
    } catch { }
}

$configData | ConvertTo-Json -Depth 4 | Set-Content -Path $ConfigPath -Force
Log-Message "  [OK] Configuration written to: $ConfigPath"

# -----------------------------------------------------------------------------
# 3. Create Windows Shortcuts
# -----------------------------------------------------------------------------
$wsh = New-Object -ComObject WScript.Shell
$wscriptExe = Join-Path $env:SystemRoot "System32\wscript.exe"
if (!(Test-Path $wscriptExe)) {
    $wscriptExe = "wscript.exe"
}
$LaunchVbs = Join-Path $RepoRoot "scripts\windows\launch-tray.vbs"
$nativeExe = Join-Path $RepoRoot "bin\pi-web-tray.exe"
$useNative = Test-Path $nativeExe

# Desktop Shortcut
$desktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$desktopLnk = Join-Path $desktopDir "pi-web.lnk"
try {
    $sc = $wsh.CreateShortcut($desktopLnk)
    if ($useNative) {
        $sc.TargetPath = $nativeExe
        $sc.Arguments = "-OpenBrowser"
    } else {
        $sc.TargetPath = $wscriptExe
        $sc.Arguments = "`"$LaunchVbs`" -OpenBrowser"
    }
    $sc.WorkingDirectory = $RepoRoot
    if (Test-Path $IcoPath) { $sc.IconLocation = "$IcoPath,0" }
    $sc.Description = "Open Pi Web AI Coding Agent Web Interface"
    $sc.Save()
    Log-Message "  [OK] Desktop shortcut created: $desktopLnk $(if ($useNative) { '(native tray)' } else { '' })"
} catch {
    Log-Message "  [FAIL] Failed to create desktop shortcut: $($_.Exception.Message)"
}

# Start Menu Shortcut
$programsDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)
$startMenuLnk = Join-Path $programsDir "pi-web.lnk"
try {
    $sc = $wsh.CreateShortcut($startMenuLnk)
    if ($useNative) {
        $sc.TargetPath = $nativeExe
        $sc.Arguments = "-OpenBrowser"
    } else {
        $sc.TargetPath = $wscriptExe
        $sc.Arguments = "`"$LaunchVbs`" -OpenBrowser"
    }
    $sc.WorkingDirectory = $RepoRoot
    if (Test-Path $IcoPath) { $sc.IconLocation = "$IcoPath,0" }
    $sc.Description = "Pi Web System Tray & Web Interface"
    $sc.Save()
    Log-Message "  [OK] Start Menu shortcut created: $startMenuLnk $(if ($useNative) { '(native tray)' } else { '' })"
} catch {
    Log-Message "  [FAIL] Failed to create Start Menu shortcut: $($_.Exception.Message)"
}

# Startup Shortcut (if autostart enabled)
$startupDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Startup)
$startupLnk = Join-Path $startupDir "pi-web-tray.lnk"
if (!$NoAutostart) {
    try {
        $sc = $wsh.CreateShortcut($startupLnk)
        if ($useNative) {
            $sc.TargetPath = $nativeExe
            $sc.Arguments = "-Startup"
        } else {
            $sc.TargetPath = $wscriptExe
            $sc.Arguments = "`"$LaunchVbs`" -Startup"
        }
        $sc.WorkingDirectory = $RepoRoot
        if (Test-Path $IcoPath) { $sc.IconLocation = "$IcoPath,0" }
        $sc.Description = "Pi Web Background Tray Service"
        $sc.Save()
        Log-Message "  [OK] Windows Startup shortcut created: $startupLnk $(if ($useNative) { '(native tray)' } else { '' })"
    } catch {
        Log-Message "  [FAIL] Failed to create Startup shortcut: $($_.Exception.Message)"
    }
} else {
    if (Test-Path $startupLnk) {
        Remove-Item -Path $startupLnk -Force -ErrorAction SilentlyContinue
    }
}

# -----------------------------------------------------------------------------
# 3b. Register Scheduled Task for headless service
# -----------------------------------------------------------------------------
$ServicePs1 = Join-Path $RepoRoot "scripts\windows\pi-web-service.ps1"
if (!$NoAutostart -and (Test-Path $ServicePs1)) {
    try {
        $taskName = "pi-web"
        $actionArg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ServicePs1`""
        $createArgs = "/create /tn `"$taskName`" /tr `"powershell $actionArg`" /sc onlogon /f"
        $proc = Start-Process -FilePath "schtasks.exe" -ArgumentList $createArgs -WindowStyle Hidden -Wait -PassThru -ErrorAction SilentlyContinue
        if ($proc.ExitCode -eq 0) {
            Log-Message "  [OK] Scheduled Task created: $taskName (ONLOGON)"
        } else {
            try {
                $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArg
                $trigger = New-ScheduledTaskTrigger -AtLogOn
                $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
                $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
                Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
                Log-Message "  [OK] Scheduled Task created via PowerShell: $taskName"
            } catch {
                Log-Message "  [WARN] Failed to create Scheduled Task: $($_.Exception.Message)"
            }
        }
    } catch {
        Log-Message "  [WARN] Scheduled Task creation failed: $($_.Exception.Message)"
    }
} elseif ($NoAutostart) {
    try { schtasks /delete /tn "pi-web" /f 2>$null | Out-Null } catch { }
}

Log-Message ""
Log-Message "Installation complete!"
Log-Message "Live server URL : http://${Hostname}:${Port}"
Log-Message "Tray Executable : $(if ($useNative) { $nativeExe } else { $LaunchVbs })"

# -----------------------------------------------------------------------------
# 4. Optional Immediate Launch
# -----------------------------------------------------------------------------
if ($StartImmediately) {
    Log-Message "Starting background service and opening browser..."
    if ($useNative) {
        Start-Process -FilePath $nativeExe -ArgumentList "-OpenBrowser" -WorkingDirectory $RepoRoot
    } else {
        $wsh.Run("`"$wscriptExe`" `"$LaunchVbs`" -OpenBrowser", 0, $false)
    }
}
