using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;

namespace PiWebTray;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
        {
            var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "logs", "pi-web-service.log");
            try { File.AppendAllText(log, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [FATAL AppDomain] {e.ExceptionObject}\r\n"); } catch { }
        };

        Application.ThreadException += (s, e) =>
        {
            var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "logs", "pi-web-service.log");
            try { File.AppendAllText(log, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [FATAL ThreadException] {e.Exception}\r\n"); } catch { }
        };

        try
        {
            var portArg = 0;
            var hostnameArg = "";
            var modeArg = "";
            var configPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "web-service.json");
            var startup = false;
            var openBrowser = false;

            for (int i = 0; i < args.Length; i++)
            {
                var a = args[i];
                if (a == "-Port" || a == "--port" || a == "-p") { if (i + 1 < args.Length && int.TryParse(args[++i], out var p)) portArg = p; }
                else if (a == "-Hostname" || a == "--hostname" || a == "-H") { if (i + 1 < args.Length) hostnameArg = args[++i]; }
                else if (a == "-Mode" || a == "--mode") { if (i + 1 < args.Length) modeArg = args[++i]; }
                else if (a == "-ConfigPath") { if (i + 1 < args.Length) configPath = args[++i]; }
                else if (a == "-Startup" || a == "--startup") startup = true;
                else if (a == "-OpenBrowser" || a == "--open-browser") openBrowser = true;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var tray = new TrayApplication(portArg, hostnameArg, modeArg, configPath, startup, openBrowser);
            tray.Run();
        }
        catch (Exception ex)
        {
            var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "logs", "pi-web-service.log");
            try { File.AppendAllText(log, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [FATAL Main] {ex}\r\n"); } catch { }
        }
    }
}

class TrayApplication : IDisposable
{
    private readonly int _portArg;
    private readonly string _hostnameArg;
    private readonly string _modeArg;
    private readonly string _configPath;
    private readonly bool _startup;
    private bool _openBrowser;

    private readonly string _repoRoot;
    private readonly string _pkgVersion;
    private int _effectivePort;
    private string _effectiveHostname = "127.0.0.1";
    private string _effectiveMode = "start";
    private bool _effectiveAutoRestart = true;
    private string _serverUrl = "http://127.0.0.1:30141";

    private NotifyIcon _notifyIcon = null!;
    private ContextMenuStrip _contextMenu = null!;
    private ToolStripMenuItem _menuHeader = null!;
    private ToolStripMenuItem _menuStatus = null!;
    private ToolStripMenuItem _menuOpen = null!;
    private ToolStripMenuItem _menuCopy = null!;
    private ToolStripMenuItem _menuRestart = null!;
    private ToolStripMenuItem _menuToggle = null!;
    private ToolStripMenuItem _menuViewLogs = null!;
    private ToolStripMenuItem _menuConfig = null!;
    private ToolStripMenuItem _menuOpenFolder = null!;
    private ToolStripMenuItem _menuAutostart = null!;
    private ToolStripMenuItem _menuExit = null!;
    private System.Windows.Forms.Timer _timer = null!;
    private Mutex? _appMutex;
    private bool _createdNew;
    private Process? _childProcess;
    private int? _managedPid;
    private IntPtr _jobHandle = IntPtr.Zero;
    private string _state = "Starting";
    private readonly List<DateTime> _crashTimestamps = new();
    private bool _isExiting;
    private readonly string _logFile;
    private readonly object _logLock = new();
    private string? _nodeExe;
    private readonly string _icoPath;
    private readonly string _pngPath;

    public TrayApplication(int portArg, string hostnameArg, string modeArg, string configPath, bool startup, bool openBrowser)
    {
        _portArg = portArg;
        _hostnameArg = hostnameArg;
        _modeArg = modeArg;
        _configPath = configPath;
        _startup = startup;
        _openBrowser = openBrowser;

        _repoRoot = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        if (!Directory.Exists(Path.Combine(_repoRoot, "bin")) || !File.Exists(Path.Combine(_repoRoot, "package.json")))
        {
            var alt = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
            if (File.Exists(Path.Combine(alt, "package.json"))) _repoRoot = alt;
            else _repoRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", ".."));
            if (!Directory.Exists(Path.Combine(_repoRoot, "bin"))) _repoRoot = Directory.GetCurrentDirectory();
        }

        _pkgVersion = ReadPackageVersion();

        var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "logs");
        if (!Directory.Exists(logDir)) Directory.CreateDirectory(logDir);
        _logFile = Path.Combine(logDir, "pi-web-service.log");

        _icoPath = Path.Combine(_repoRoot, "public", "icons", "pi-web.ico");
        _pngPath = Path.Combine(_repoRoot, "public", "icons", "icon-512.png");
        if (!File.Exists(_pngPath))
        {
            _pngPath = Path.Combine(_repoRoot, "public", "icons", "icon-192.png");
        }

        RotateLogIfNeeded();
        ResolveSettings();
    }

    private string ReadPackageVersion()
    {
        try
        {
            var p = Path.Combine(_repoRoot, "package.json");
            if (File.Exists(p))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(p));
                if (doc.RootElement.TryGetProperty("version", out var v)) return v.GetString() ?? "0.0.0";
            }
        }
        catch { }
        return "0.0.0";
    }

    private void RotateLogIfNeeded()
    {
        try
        {
            if (File.Exists(_logFile))
            {
                var fi = new FileInfo(_logFile);
                if (fi.Length > 5 * 1024 * 1024)
                {
                    var old = Path.Combine(Path.GetDirectoryName(_logFile)!, "pi-web-service.old.log");
                    File.Move(_logFile, old, true);
                }
            }
        }
        catch { }
    }

    private void WriteLog(string msg)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {msg}";
        lock (_logLock)
        {
            try
            {
                File.AppendAllText(_logFile, line + Environment.NewLine);
            }
            catch { }
        }
    }

    private void ResolveSettings()
    {
        var defaultPort = 30141;
        var defaultHostname = "127.0.0.1";
        var defaultMode = "start";
        var defaultAutoRestart = true;

        JsonElement? configObj = null;
        if (File.Exists(_configPath))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(_configPath));
                configObj = doc.RootElement.Clone();
            }
            catch { }
        }

        _effectivePort = _portArg > 0 ? _portArg :
            (configObj?.TryGetProperty("port", out var p) == true && p.TryGetInt32(out var cp) ? cp : defaultPort);

        _effectiveHostname = !string.IsNullOrWhiteSpace(_hostnameArg) ? _hostnameArg :
            (configObj?.TryGetProperty("hostname", out var h) == true ? h.GetString() ?? defaultHostname : defaultHostname);

        _effectiveMode = !string.IsNullOrWhiteSpace(_modeArg) ? _modeArg :
            (configObj?.TryGetProperty("mode", out var m) == true ? m.GetString() ?? defaultMode : defaultMode);

        _effectiveAutoRestart = configObj?.TryGetProperty("autoRestart", out var ar) == true ? ar.GetBoolean() : defaultAutoRestart;

        var openBrowserConfig = configObj?.TryGetProperty("openBrowserOnLaunch", out var ob) == true && ob.GetBoolean();
        if (_openBrowser) _openBrowser = true;
        else if (!_startup && openBrowserConfig) _openBrowser = true;

        var nextDir = Path.Combine(_repoRoot, ".next");
        if (_effectiveMode == "start" && !Directory.Exists(nextDir))
        {
            _effectiveMode = "dev";
            WriteLog(".next directory not found. Automatically falling back to dev mode.");
        }

        _serverUrl = (_effectiveHostname == "0.0.0.0" || _effectiveHostname == "::" || string.IsNullOrWhiteSpace(_effectiveHostname))
            ? $"http://localhost:{_effectivePort}"
            : $"http://{_effectiveHostname}:{_effectivePort}";
    }

    public void Run()
    {
        WriteLog($"Starting Run(). Mutex check beginning...");
        // Mutex
        try
        {
            _appMutex = new Mutex(true, @"Local\PiWebTray_Instance_Mutex", out _createdNew);
        }
        catch (Exception ex)
        {
            WriteLog($"Mutex exception: {ex.Message}");
            _createdNew = true;
        }

        WriteLog($"Mutex createdNew={_createdNew}");
        if (!_createdNew)
        {
            WriteLog("Another instance is already running. Exiting.");
            if (_openBrowser)
            {
                try { Process.Start(new ProcessStartInfo(_serverUrl) { UseShellExecute = true }); } catch { }
            }
            return;
        }

        WriteLog("==========================================");
        WriteLog($"Pi Web System Tray Manager v{_pkgVersion} starting (native)");
        WriteLog($"Repository Root: {_repoRoot}");
        WriteLog($"Target: {_serverUrl} (Mode: {_effectiveMode}, Port: {_effectivePort})");
        WriteLog("==========================================");

        WriteLog("Loading icon...");
        // Icon
        Icon? icon = null;
        try
        {
            if (File.Exists(_icoPath))
            {
                WriteLog($"Loading ico from {_icoPath}");
                icon = new Icon(_icoPath);
            }
            else if (File.Exists(_pngPath))
            {
                WriteLog($"Loading png from {_pngPath}");
                using var bmp = new Bitmap(_pngPath);
                var h = bmp.GetHicon();
                icon = Icon.FromHandle(h);
            }
        }
        catch (Exception ex)
        {
            WriteLog($"Icon load exception: {ex}");
        }
        icon ??= SystemIcons.Application;
        WriteLog($"Icon loaded successfully: {icon}");

        WriteLog("Creating ContextMenuStrip and menu items...");
        _contextMenu = new ContextMenuStrip();

        _menuHeader = new ToolStripMenuItem($"Pi Web (v{_pkgVersion})") { Enabled = false, Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold) };
        _contextMenu.Items.Add(_menuHeader);

        _menuStatus = new ToolStripMenuItem($"  Status: Starting ({_effectivePort})") { Enabled = false };
        _contextMenu.Items.Add(_menuStatus);
        _contextMenu.Items.Add(new ToolStripSeparator());

        _menuOpen = new ToolStripMenuItem("Open in Browser", null, (s, e) => { try { Process.Start(new ProcessStartInfo(_serverUrl) { UseShellExecute = true }); } catch { } }) { Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold) };
        _contextMenu.Items.Add(_menuOpen);

        _menuCopy = new ToolStripMenuItem("Copy Web URL", null, (s, e) =>
        {
            try
            {
                Clipboard.SetText(_serverUrl);
                _notifyIcon.ShowBalloonTip(1500, "Pi Web", $"URL copied: {_serverUrl}", ToolTipIcon.Info);
            }
            catch { }
        });
        _contextMenu.Items.Add(_menuCopy);
        _contextMenu.Items.Add(new ToolStripSeparator());

        _menuRestart = new ToolStripMenuItem("Restart Server", null, (s, e) =>
        {
            WriteLog("Restart requested from tray.");
            StopWebServer();

            // Never spawn into a port that is still bound: that is what turned a
            // restart into an EADDRINUSE crash loop.
            if (!WaitForPortFree(8000))
            {
                var owner = FindPortOwnerPid();
                _state = "Error";
                UpdateTrayUI();
                WriteLog($"Restart aborted: port {_effectivePort} is still in use{(owner.HasValue ? $" (PID {owner.Value})" : "")}.");
                ShowBalloon("Pi Web", $"Port {_effectivePort} could not be released. Restart aborted - see logs.", ToolTipIcon.Error);
                return;
            }
            StartWebServer();
        });
        _contextMenu.Items.Add(_menuRestart);

        _menuToggle = new ToolStripMenuItem("Stop Server", null, (s, e) =>
        {
            if (ServerIsUp()) StopWebServer();
            else StartWebServer();
        });
        _contextMenu.Items.Add(_menuToggle);
        _contextMenu.Items.Add(new ToolStripSeparator());

        _menuViewLogs = new ToolStripMenuItem("View Logs", null, (s, e) => { try { Process.Start("notepad.exe", $"\"{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "logs", "pi-web-service.log")}\""); } catch { } });
        _contextMenu.Items.Add(_menuViewLogs);

        _menuConfig = new ToolStripMenuItem("Edit Configuration", null, (s, e) =>
        {
            var cfg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent", "web-service.json");
            if (!File.Exists(cfg))
            {
                SetAutostart(CheckAutostart());
            }
            try { Process.Start("notepad.exe", $"\"{cfg}\""); } catch { }
        });
        _contextMenu.Items.Add(_menuConfig);

        _menuOpenFolder = new ToolStripMenuItem("Open Project Folder", null, (s, e) => { try { Process.Start("explorer.exe", $"\"{_repoRoot}\""); } catch { } });
        _contextMenu.Items.Add(_menuOpenFolder);
        _contextMenu.Items.Add(new ToolStripSeparator());

        _menuAutostart = new ToolStripMenuItem("Start with Windows") { CheckOnClick = true, Checked = CheckAutostart() };
        _menuAutostart.Click += (s, e) => SetAutostart(_menuAutostart.Checked);
        _contextMenu.Items.Add(_menuAutostart);
        _contextMenu.Items.Add(new ToolStripSeparator());

        _menuExit = new ToolStripMenuItem("Exit Tray & Server", null, (s, e) =>
        {
            _isExiting = true;
            WriteLog("Exit requested from system tray menu.");
            StopWebServer();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _timer?.Stop();
            _timer?.Dispose();
            try { _appMutex?.ReleaseMutex(); } catch { }
            _appMutex?.Dispose();
            Application.Exit();
        });
        _contextMenu.Items.Add(_menuExit);

        WriteLog("Creating NotifyIcon...");
        _notifyIcon = new NotifyIcon
        {
            Icon = icon,
            ContextMenuStrip = _contextMenu,
            Text = $"Pi Web ({_state})",
            Visible = true
        };
        _notifyIcon.DoubleClick += (s, e) => { try { Process.Start(new ProcessStartInfo(_serverUrl) { UseShellExecute = true }); } catch { } };

        WriteLog("Setting up health check timer...");
        _timer = new System.Windows.Forms.Timer { Interval = 3000 };
        _timer.Tick += (s, e) =>
        {
            if (_isExiting) return;

            // If we have a child process that exited
            if (_childProcess != null && _childProcess.HasExited)
            {
                var code = _childProcess.ExitCode;
                WriteLog($"Child server process exited with code {code}.");
                _childProcess = null;
                if (_effectiveAutoRestart)
                {
                    var now = DateTime.Now;
                    _crashTimestamps.Add(now);
                    var cutoff = now.AddSeconds(-60);
                    _crashTimestamps.RemoveAll(t => t < cutoff);
                    if (_crashTimestamps.Count >= 3)
                    {
                        _state = "Error";
                        WriteLog("Server crashed repeatedly (3 times in 60s). Auto-restart suspended.");
                        _notifyIcon.ShowBalloonTip(3000, "Pi Web Service Error", "Server crashed repeatedly. Check logs for details.", ToolTipIcon.Error);
                    }
                    else
                    {
                        WriteLog($"Auto-restarting server (crash {_crashTimestamps.Count} of 3)...");
                        StartWebServer();
                    }
                }
                else _state = "Stopped";
                UpdateTrayUI();
                return;
            }

            // Check health
            var healthy = TestServerHealth();
            if (healthy)
            {
                if (_state != "Running")
                {
                    _state = "Running";
                    if (_childProcess == null && !_managedPid.HasValue)
                    {
                        _managedPid = FindPortOwnerPid();
                        if (_managedPid.HasValue) WriteLog($"Tracking externally started server PID {_managedPid}.");
                    }
                    _crashTimestamps.Clear();
                    WriteLog($"Server is healthy and responsive at {_serverUrl}");
                    UpdateTrayUI();
                    if (_openBrowser)
                    {
                        _openBrowser = false;
                        try { Process.Start(new ProcessStartInfo(_serverUrl) { UseShellExecute = true }); } catch { }
                    }
                }
            }
            else
            {
                if (_state == "Running")
                {
                    _state = _childProcess != null ? "Starting" : "Stopped";
                    UpdateTrayUI();
                }
            }
        };

        // If server is already running on port, adopt it
        if (TestServerHealth())
        {
            AdoptRunningServer($"Detected existing active server on {_serverUrl}. Adopting instance.");
            try
            {
                _notifyIcon.ShowBalloonTip(2000, "Pi Web Tray", $"Service is online: {_serverUrl}", ToolTipIcon.Info);
            }
            catch { }
            if (_openBrowser)
            {
                _openBrowser = false;
                try { Process.Start(new ProcessStartInfo(_serverUrl) { UseShellExecute = true }); } catch { }
            }
        }
        else
        {
            WriteLog("Calling StartWebServer()...");
            StartWebServer();
        }

        _timer.Start();

        WriteLog("Entering Application.Run()...");
        Application.Run();
        WriteLog("Application.Run() exited.");

        // Cleanup on exit
        if (!_isExiting)
        {
            StopWebServer();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _timer.Stop();
            _timer.Dispose();
            try { _appMutex?.ReleaseMutex(); } catch { }
            _appMutex?.Dispose();
        }
    }

    /// <summary>
    /// Whether a Pi Web server is currently up, however it was started. The menu
    /// must offer "Stop Server" whenever this is true - keying it off the child
    /// handle alone hid the stop option for every adopted server.
    /// </summary>
    private bool ServerIsUp()
    {
        if (_childProcess != null && !_childProcess.HasExited) return true;
        return _state == "Running" || _state == "Starting";
    }

    private void ShowBalloon(string title, string message, ToolTipIcon icon)
    {
        if (_notifyIcon == null) return;
        try { _notifyIcon.ShowBalloonTip(3000, title, message, icon); } catch { }
    }

    /// <summary>Adopt a server this tray did not spawn, and remember its PID so Stop can reach it.</summary>
    private void AdoptRunningServer(string reason)
    {
        _managedPid = FindPortOwnerPid();
        _state = "Running";
        WriteLog(reason + (_managedPid.HasValue ? $" Tracking PID {_managedPid}." : " Could not resolve the owning PID."));
        UpdateTrayUI();
    }

    private void UpdateTrayUI()
    {
        if (_notifyIcon == null) return;

        var text = $"Pi Web ({_state})";
        if (text.Length > 63) text = text.Substring(0, 63);
        _notifyIcon.Text = text;

        var pidSuffix = _managedPid.HasValue ? $", PID {_managedPid}" : "";
        _menuStatus.Text = _state == "Running"
            ? $"  Status: Running ({_effectivePort}{pidSuffix})"
            : (_state == "Starting" ? $"  Status: Starting ({_effectivePort})" : "  Status: Stopped");

        _menuToggle.Text = ServerIsUp() ? "Stop Server" : "Start Server";
        _menuOpen.Enabled = (_state == "Running");
    }

    private string FindNodeExecutable()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "where.exe",
                Arguments = "node.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p != null)
            {
                var outStr = p.StandardOutput.ReadToEnd();
                p.WaitForExit(1000);
                var lines = outStr.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                if (lines.Length > 0 && File.Exists(lines[0].Trim()))
                {
                    return lines[0].Trim();
                }
            }
        }
        catch { }

        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "node", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".bun", "bin", "node.exe")
        };

        foreach (var c in candidates)
        {
            if (File.Exists(c)) return c;
        }

        return "node.exe";
    }

    private void StartWebServer()
    {
        if (_childProcess != null && !_childProcess.HasExited) return;

        // Never spawn a duplicate onto a bound port.
        if (TestServerHealth())
        {
            AdoptRunningServer($"Server already answering at {_serverUrl}. Adopting instead of spawning a duplicate.");
            return;
        }

        var portOwner = FindPortOwnerPid();
        if (portOwner.HasValue)
        {
            var image = GetProcessImageName(portOwner.Value) ?? "unknown";
            _state = "Error";
            UpdateTrayUI();
            WriteLog($"Refusing to start: port {_effectivePort} is held by PID {portOwner.Value} ({image}) but is not responding. Use Restart Server to force-stop it.");
            ShowBalloon("Pi Web", $"Port {_effectivePort} is held by {image} (PID {portOwner.Value}). Use Restart Server to force-stop it.", ToolTipIcon.Error);
            return;
        }

        _state = "Starting";
        UpdateTrayUI();
        WriteLog($"Starting web server in {_effectiveMode} mode on {_effectiveHostname}:{_effectivePort}...");

        if (_nodeExe == null) _nodeExe = FindNodeExecutable();

        var psi = new ProcessStartInfo
        {
            FileName = _nodeExe,
            WorkingDirectory = _repoRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        if (_effectiveMode == "start")
        {
            var launcher = Path.Combine(_repoRoot, "bin", "pi-web.js");
            psi.Arguments = $"\"{launcher}\" -p {_effectivePort} -H {_effectiveHostname} --no-open";
        }
        else
        {
            var nextBin = Path.Combine(_repoRoot, "node_modules", "next", "dist", "bin", "next");
            psi.Arguments = $"\"{nextBin}\" dev -H {_effectiveHostname} -p {_effectivePort}";
        }

        psi.EnvironmentVariables["PI_WEB_PORT"] = _effectivePort.ToString();
        psi.EnvironmentVariables["PI_WEB_HOSTNAME"] = _effectiveHostname;
        psi.EnvironmentVariables["PI_WEB_SERVICE"] = "1";
        psi.EnvironmentVariables["PORT"] = _effectivePort.ToString();

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) WriteLog($"[STDOUT] {e.Data}"); };
        proc.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) WriteLog($"[STDERR] {e.Data}"); };

        try
        {
            if (proc.Start())
            {
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                _childProcess = proc;
                _managedPid = proc.Id;
                AssignToKillOnCloseJob(proc);
                WriteLog($"Child server process started with PID {proc.Id}");
            }
            else
            {
                _state = "Error";
                WriteLog("Failed to start child server process.");
                UpdateTrayUI();
            }
        }
        catch (Exception ex)
        {
            _state = "Error";
            WriteLog($"Exception starting child server: {ex.Message}");
            UpdateTrayUI();
        }
    }

    private void StopWebServer()
    {
        // Resolve the server by who owns the port, not only by the handle we
        // spawned. A server started outside this tray (or adopted after a tray
        // restart) has no child handle, and skipping it here is exactly what made
        // "Restart Server" collide with the still-listening process.
        int? pid = null;
        if (_childProcess != null && !_childProcess.HasExited) pid = _childProcess.Id;
        else if (_managedPid.HasValue && IsProcessAlive(_managedPid.Value)) pid = _managedPid;
        pid ??= FindPortOwnerPid();

        if (pid == null)
        {
            WriteLog("Stop requested, but no server process was found.");
        }
        else if (pid.Value == Environment.ProcessId)
        {
            WriteLog("Refusing to stop: the port owner is this tray process itself.");
        }
        else if (!IsLikelyPiWebServer(pid.Value))
        {
            var image = GetProcessImageName(pid.Value) ?? "unknown";
            WriteLog($"Refusing to stop PID {pid.Value} ({image}): it does not look like a Pi Web server.");
            ShowBalloon("Pi Web", $"Port {_effectivePort} is held by {image} (PID {pid.Value}), not a Pi Web server. Not stopped.", ToolTipIcon.Warning);
        }
        else
        {
            KillProcessTree(pid.Value);
        }

        try { _childProcess?.Dispose(); } catch { }
        _childProcess = null;
        _managedPid = null;
        _state = WaitForPortFree(4000) ? "Stopped" : "Running";
        UpdateTrayUI();
        WriteLog(_state == "Stopped" ? "Server stopped." : $"Server is still listening on port {_effectivePort} after the stop request.");
    }

    private static bool IsProcessAlive(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
        catch { return false; }
    }

    private static string? GetProcessImageName(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return p.ProcessName; }
        catch { return null; }
    }

    private static bool IsLikelyPiWebServer(int pid)
    {
        var name = GetProcessImageName(pid)?.ToLowerInvariant();
        if (string.IsNullOrEmpty(name)) return false;
        return name.Contains("node") || name.Contains("pi-web") || name.Contains("bun") || name.Contains("deno");
    }

    private void KillProcessTree(int pid)
    {
        try
        {
            WriteLog($"Stopping server process (PID {pid}) and its children...");
            var killPsi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "taskkill.exe"),
                Arguments = $"/PID {pid} /T /F",
                CreateNoWindow = true,
                UseShellExecute = false
            };
            using var killProc = Process.Start(killPsi);
            killProc?.WaitForExit(5000);
        }
        catch (Exception ex)
        {
            WriteLog($"Error stopping server PID {pid}: {ex.Message}");
        }
    }

    /// <summary>True once nothing is listening on the configured port any more.</summary>
    private bool WaitForPortFree(int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (true)
        {
            if (FindPortOwnerPid() == null) return true;
            if (DateTime.UtcNow >= deadline) return false;
            Thread.Sleep(400);
        }
    }

    /// <summary>PID listening on the configured port, or null when the port is free.</summary>
    private int? FindPortOwnerPid()
    {
        return FindPortOwnerPidViaNetstat() ?? FindPortOwnerPidViaPowerShell();
    }

    private int? FindPortOwnerPidViaNetstat()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "netstat.exe"),
                Arguments = "-ano -p TCP",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p == null) return null;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(3000);

            foreach (var rawLine in output.Split('\n'))
            {
                var parts = rawLine.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5) continue;
                if (!parts[0].Equals("TCP", StringComparison.OrdinalIgnoreCase)) continue;
                if (!parts[3].Equals("LISTENING", StringComparison.OrdinalIgnoreCase)) continue;

                var local = parts[1];
                var separator = local.LastIndexOf(':');
                if (separator < 0) continue;
                if (!int.TryParse(local.Substring(separator + 1), out var port) || port != _effectivePort) continue;

                if (int.TryParse(parts[4], out var ownerPid) && ownerPid > 0 && ownerPid != Environment.ProcessId)
                    return ownerPid;
            }
        }
        catch (Exception ex)
        {
            WriteLog($"netstat port lookup failed: {ex.Message}");
        }
        return null;
    }

    private int? FindPortOwnerPidViaPowerShell()
    {
        try
        {
            var script = $"@(Get-NetTCPConnection -State Listen -LocalPort {_effectivePort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','";
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{script}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p == null) return null;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);

            foreach (var token in output.Split(new[] { ',', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (int.TryParse(token.Trim(), out var ownerPid) && ownerPid > 0 && ownerPid != Environment.ProcessId)
                    return ownerPid;
            }
        }
        catch (Exception ex)
        {
            WriteLog($"PowerShell port lookup failed: {ex.Message}");
        }
        return null;
    }

    /// <summary>
    /// Bind the spawned server to a kill-on-close job object so it dies with the
    /// tray even when the tray is force-killed. That was how the orphaned server
    /// holding the port - and therefore the adopted state - appeared at all.
    /// </summary>
    private void AssignToKillOnCloseJob(Process proc)
    {
        try
        {
            if (_jobHandle == IntPtr.Zero)
            {
                _jobHandle = JobObject.CreateKillOnClose();
                if (_jobHandle == IntPtr.Zero)
                {
                    WriteLog("Kill-on-close job object unavailable; the server may outlive the tray if the tray is force-killed.");
                    return;
                }
            }

            if (JobObject.AssignProcess(_jobHandle, proc.Handle))
                WriteLog($"Server PID {proc.Id} bound to kill-on-close job object.");
            else
                WriteLog($"Could not bind server PID {proc.Id} to the job object (Win32 error {Marshal.GetLastWin32Error()}).");
        }
        catch (Exception ex)
        {
            WriteLog($"Job object setup failed: {ex.Message}");
        }
    }

    private bool TestServerHealth()
    {
        try
        {
#pragma warning disable SYSLIB0014
            var req = (HttpWebRequest)WebRequest.Create(_serverUrl);
#pragma warning restore SYSLIB0014
            req.Timeout = 1500;
            req.Method = "GET";
            using var resp = (HttpWebResponse)req.GetResponse();
            return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 500;
        }
        catch
        {
            return false;
        }
    }

    private bool CheckAutostart()
    {
        var shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "pi-web-tray.lnk");
        return File.Exists(shortcut);
    }

    private void SetAutostart(bool enable)
    {
        var shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "pi-web-tray.lnk");
        try
        {
            if (!enable)
            {
                if (File.Exists(shortcut)) File.Delete(shortcut);
                WriteLog("Startup shortcut removed.");
            }
            else
            {
                var script = Path.Combine(_repoRoot, "scripts", "windows", "install-tray.ps1");
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -Port {_effectivePort} -Hostname \"{_effectiveHostname}\" -Mode \"{_effectiveMode}\"",
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                using var p = Process.Start(psi);
                p?.WaitForExit(5000);
                WriteLog("Startup shortcut created.");
            }
        }
        catch (Exception ex)
        {
            WriteLog($"Failed to toggle autostart: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _notifyIcon?.Dispose();
        _timer?.Dispose();
        _appMutex?.Dispose();
        _childProcess?.Dispose();
    }
}

/// <summary>Minimal wrapper around a Windows job object with KILL_ON_JOB_CLOSE.</summary>
internal static class JobObject
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInformationClass, IntPtr lpJobObjectInformation, uint cbJobObjectInformationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    /// <summary>Creates the job, or returns <see cref="IntPtr.Zero"/> when unavailable.</summary>
    public static IntPtr CreateKillOnClose()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;

        var info = new ExtendedLimitInformation();
        info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;

        var size = Marshal.SizeOf<ExtendedLimitInformation>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }

        return job;
    }

    public static bool AssignProcess(IntPtr job, IntPtr process)
        => AssignProcessToJobObject(job, process);
}
