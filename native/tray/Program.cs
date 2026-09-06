using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
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
            Thread.Sleep(500);
            StartWebServer();
        });
        _contextMenu.Items.Add(_menuRestart);

        _menuToggle = new ToolStripMenuItem("Stop Server", null, (s, e) =>
        {
            if (_state == "Running" || _state == "Starting") StopWebServer();
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
            _state = "Running";
            WriteLog($"Detected existing active server on {_serverUrl}. Adopting instance.");
            UpdateTrayUI();
            try
            {
                _notifyIcon.ShowBalloonTip(2000, "Pi Web 托盘管理", $"服务已在线: {_serverUrl}", ToolTipIcon.Info);
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

    private void UpdateTrayUI()
    {
        var text = $"Pi Web ({_state})";
        if (text.Length > 63) text = text.Substring(0, 63);
        _notifyIcon.Text = text;

        _menuStatus.Text = _state == "Running"
            ? $"  Status: Running ({_effectivePort})"
            : (_state == "Starting" ? "  Status: Starting..." : "  Status: Stopped");

        _menuToggle.Text = (_childProcess != null && !_childProcess.HasExited) ? "Stop Server" : "Start Server";
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
        if (_childProcess == null) return;
        try
        {
            WriteLog($"Stopping child server process (PID {_childProcess.Id})...");
            var pid = _childProcess.Id;
            var killPsi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "taskkill.exe"),
                Arguments = $"/PID {pid} /T /F",
                CreateNoWindow = true,
                UseShellExecute = false
            };
            using var killProc = Process.Start(killPsi);
            killProc?.WaitForExit(3000);
        }
        catch (Exception ex)
        {
            WriteLog($"Error stopping child server: {ex.Message}");
        }
        finally
        {
            try { _childProcess.Dispose(); } catch { }
            _childProcess = null;
            _state = "Stopped";
            UpdateTrayUI();
            WriteLog("Child server stopped.");
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
