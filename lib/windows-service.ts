import packageJson from "../package.json";
import { existsSync, promises as fs } from "fs";
import { homedir } from "os";
import * as path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { getAgentDir } from "./session-reader";

const execFileAsync = promisify(execFile);

export interface WebServiceConfig {
  port: number;
  hostname: string;
  mode: "start" | "dev";
  autostart: boolean;
  openBrowserOnLaunch: boolean;
  autoRestart: boolean;
}

export interface WebServiceStatus {
  isWindows: boolean;
  isInstalled: boolean;
  autostart: boolean;
  isRunning: boolean;
  port: number;
  hostname: string;
  mode: "start" | "dev";
  desktopShortcutExists: boolean;
  startMenuShortcutExists: boolean;
  startupShortcutExists: boolean;
  logFile: string;
  configFile: string;
  serviceUrl: string;
  version: string;
}

export const DEFAULT_WEB_SERVICE_CONFIG: WebServiceConfig = {
  port: 30141,
  hostname: "127.0.0.1",
  mode: "start",
  autostart: true,
  openBrowserOnLaunch: false,
  autoRestart: true,
};

export function getRepoRoot(): string {
  if (process.env.PI_WEB_PACKAGE_DIR && existsSync(process.env.PI_WEB_PACKAGE_DIR)) {
    return process.env.PI_WEB_PACKAGE_DIR;
  }
  const fromDirname = path.resolve(__dirname, "..");
  if (existsSync(path.join(fromDirname, "package.json"))) {
    return fromDirname;
  }
  const fromCwd = process.cwd();
  if (existsSync(path.join(fromCwd, "package.json"))) {
    return fromCwd;
  }
  return fromDirname;
}

export function getSystemRoot(): string {
  if (process.platform !== "win32") {
    return "C:\\Windows";
  }
  return (
    process.env.SystemRoot ||
    process.env.systemroot ||
    process.env.windir ||
    process.env.WINDIR ||
    "C:\\Windows"
  );
}

export function resolvePowerShellBin(): string {
  if (process.platform !== "win32") {
    return "powershell";
  }
  const sysRoot = getSystemRoot();
  const candidates = [
    path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path.join(sysRoot, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ...(process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe")] : []),
    ...(process.env["ProgramFiles(x86)"] ? [path.join(process.env["ProgramFiles(x86)"], "PowerShell", "7", "pwsh.exe")] : []),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "powershell.exe";
}

export function resolveWscriptBin(): string {
  if (process.platform !== "win32") {
    return "wscript";
  }
  const sysRoot = getSystemRoot();
  const candidates = [
    path.join(sysRoot, "System32", "wscript.exe"),
    path.join(sysRoot, "SysWOW64", "wscript.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "wscript.exe";
}

export function resolveTaskkillBin(): string {
  if (process.platform !== "win32") {
    return "taskkill";
  }
  const sysRoot = getSystemRoot();
  const candidate = path.join(sysRoot, "System32", "taskkill.exe");
  if (existsSync(candidate)) {
    return candidate;
  }
  return "taskkill.exe";
}

function getSafeAgentDir(): string {
  try {
    return getAgentDir();
  } catch {
    return path.join(homedir(), ".pi", "agent");
  }
}

export function getWebServiceConfigPath(): string {
  return path.join(getSafeAgentDir(), "web-service.json");
}

export function getWebServiceLogPath(): string {
  return path.join(getSafeAgentDir(), "logs", "pi-web-service.log");
}

export function getWindowsShortcutPaths(): {
  desktop: string;
  startMenu: string;
  startup: string;
} {
  const userProf = process.env.USERPROFILE || homedir();
  const appData = process.env.APPDATA || path.join(userProf, "AppData", "Roaming");

  let desktopPath = path.join(userProf, "Desktop");
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer;
  if (oneDrive && existsSync(path.join(oneDrive, "Desktop"))) {
    desktopPath = path.join(oneDrive, "Desktop");
  }

  const startMenuPath = path.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );
  const startupPath = path.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup"
  );

  return {
    desktop: path.join(desktopPath, "pi-web.lnk"),
    startMenu: path.join(startMenuPath, "pi-web.lnk"),
    startup: path.join(startupPath, "pi-web-tray.lnk"),
  };
}

export async function loadWebServiceConfig(): Promise<WebServiceConfig> {
  const configPath = getWebServiceConfigPath();
  if (existsSync(configPath)) {
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        port: typeof parsed.port === "number" ? parsed.port : DEFAULT_WEB_SERVICE_CONFIG.port,
        hostname: typeof parsed.hostname === "string" ? parsed.hostname : DEFAULT_WEB_SERVICE_CONFIG.hostname,
        mode: parsed.mode === "dev" ? "dev" : "start",
        autostart: typeof parsed.autostart === "boolean" ? parsed.autostart : DEFAULT_WEB_SERVICE_CONFIG.autostart,
        openBrowserOnLaunch: typeof parsed.openBrowserOnLaunch === "boolean" ? parsed.openBrowserOnLaunch : DEFAULT_WEB_SERVICE_CONFIG.openBrowserOnLaunch,
        autoRestart: typeof parsed.autoRestart === "boolean" ? parsed.autoRestart : DEFAULT_WEB_SERVICE_CONFIG.autoRestart,
      };
    } catch {
      // ignore invalid json and return default
    }
  }
  return { ...DEFAULT_WEB_SERVICE_CONFIG };
}

export async function saveWebServiceConfig(
  config: Partial<WebServiceConfig>
): Promise<WebServiceConfig> {
  const current = await loadWebServiceConfig();
  const merged: WebServiceConfig = {
    ...current,
    ...config,
  };

  const configPath = getWebServiceConfigPath();
  const dir = path.dirname(configPath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }

  await fs.writeFile(configPath, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function getWindowsExecutionEnv(): NodeJS.ProcessEnv {
  const sysRoot = getSystemRoot();
  const existingPath = process.env.PATH || process.env.Path || "";
  const standardPaths = [
    path.join(sysRoot, "System32"),
    sysRoot,
    path.join(sysRoot, "System32", "wbem"),
    path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0"),
  ];
  const combinedPath = [
    ...standardPaths.filter((p) => !existingPath.toLowerCase().includes(p.toLowerCase())),
    existingPath,
  ].join(path.delimiter);

  return {
    ...process.env,
    PATH: combinedPath,
    Path: combinedPath,
    SystemRoot: sysRoot,
    windir: sysRoot,
  };
}

let trayRunningCache: { running: boolean; expiresAt: number } | null = null;

export function invalidateTrayRunningCache(): void {
  trayRunningCache = null;
}

export async function isTrayProcessRunning(): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  if (trayRunningCache && trayRunningCache.expiresAt > Date.now()) {
    return trayRunningCache.running;
  }
  try {
    const psExe = resolvePowerShellBin();
    const { stdout } = await execFileAsync(
      psExe,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        '$native = Get-Process -Name "pi-web-tray" -ErrorAction SilentlyContinue; if ($native) { ($native | Measure-Object).Count } else { $scripts = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*pi-web-tray.ps1*" -or $_.CommandLine -like "*pi-web-service.ps1*" }; ($scripts | Measure-Object).Count }',
      ],
      { timeout: 4000, env: getWindowsExecutionEnv(), windowsHide: true }
    );
    const count = parseInt(stdout.trim(), 10);
    const isRunning = !isNaN(count) && count > 0;
    trayRunningCache = { running: isRunning, expiresAt: Date.now() + 1500 };
    return isRunning;
  } catch {
    return false;
  }
}

export async function getWebServiceStatus(): Promise<WebServiceStatus> {
  const isWindows = process.platform === "win32";
  const config = await loadWebServiceConfig();
  const shortcuts = getWindowsShortcutPaths();

  const desktopExists = isWindows && existsSync(shortcuts.desktop);
  const startMenuExists = isWindows && existsSync(shortcuts.startMenu);
  const startupExists = isWindows && existsSync(shortcuts.startup);

  const isInstalled = desktopExists || startMenuExists || startupExists || existsSync(getWebServiceConfigPath());
  let isRunning = await isTrayProcessRunning();

  if (!isRunning) {
    const host = config.hostname || "127.0.0.1";
    const port = config.port;
    const probeUrl = (host === "0.0.0.0" || host === "::" || !host) ? `http://127.0.0.1:${port}/api/models` : `http://${host}:${port}/api/models`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(probeUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status >= 200 && res.status < 500) {
        isRunning = true;
      }
    } catch {
      // not reachable
    }
  }

  const hostname = config.hostname || "127.0.0.1";
  const port = config.port || 30141;
  const serviceUrl =
    hostname === "0.0.0.0" || hostname === "::" || !hostname
      ? `http://localhost:${port}`
      : `http://${hostname}:${port}`;

  return {
    isWindows,
    isInstalled,
    autostart: config.autostart,
    isRunning,
    port,
    hostname,
    mode: config.mode,
    desktopShortcutExists: desktopExists,
    startMenuShortcutExists: startMenuExists,
    startupShortcutExists: startupExists,
    logFile: getWebServiceLogPath(),
    configFile: getWebServiceConfigPath(),
    serviceUrl,
    version: packageJson.version ?? "0.0.0",
  };
}

export async function installTrayShortcuts(
  options: Partial<WebServiceConfig> & { startImmediately?: boolean } = {}
): Promise<{ success: boolean; message?: string }> {
  if (process.platform !== "win32") {
    return { success: false, message: "Windows service installation is only supported on Windows platforms." };
  }

  const savedConfig = await saveWebServiceConfig(options);
  const repoRoot = getRepoRoot();
  const installScript = path.join(repoRoot, "scripts", "windows", "install-tray.ps1");

  const psArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    installScript,
    "-Port",
    String(savedConfig.port),
    "-Hostname",
    savedConfig.hostname,
    "-Mode",
    savedConfig.mode,
  ];

  if (!savedConfig.autostart) {
    psArgs.push("-NoAutostart");
  }
  if (options.startImmediately) {
    psArgs.push("-StartImmediately");
  }

  try {
    const psBin = resolvePowerShellBin();
    const { stdout, stderr } = await execFileAsync(psBin, psArgs, {
      cwd: repoRoot,
      timeout: 30000,
      env: getWindowsExecutionEnv(),
      windowsHide: true,
    });
    invalidateTrayRunningCache();
    return {
      success: true,
      message: stdout || stderr || "Tray shortcuts and service installed successfully.",
    };
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return {
      success: false,
      message: err.message + (err.stderr ? `\nStderr: ${err.stderr}` : ""),
    };
  }
}

export async function uninstallTrayShortcuts(
  options: { cleanConfig?: boolean } = {}
): Promise<{ success: boolean; message?: string }> {
  if (process.platform !== "win32") {
    return { success: false, message: "Windows service uninstallation is only supported on Windows platforms." };
  }

  const repoRoot = getRepoRoot();
  const uninstallScript = path.join(repoRoot, "scripts", "windows", "uninstall-tray.ps1");

  const psArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    uninstallScript,
  ];

  if (options.cleanConfig) {
    psArgs.push("-CleanConfig");
  }

  try {
    const psBin = resolvePowerShellBin();
    const { stdout, stderr } = await execFileAsync(psBin, psArgs, {
      cwd: repoRoot,
      timeout: 20000,
      env: getWindowsExecutionEnv(),
      windowsHide: true,
    });
    invalidateTrayRunningCache();
    return {
      success: true,
      message: stdout || stderr || "Tray shortcuts and service removed successfully.",
    };
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return {
      success: false,
      message: err.message + (err.stderr ? `\nStderr: ${err.stderr}` : ""),
    };
  }
}

export async function toggleAutostart(enable: boolean): Promise<{ success: boolean; autostart: boolean; message?: string }> {
  if (process.platform !== "win32") {
    return { success: false, autostart: false, message: "Autostart is only supported on Windows." };
  }

  await saveWebServiceConfig({ autostart: enable });
  const repoRoot = getRepoRoot();
  const nativeExe = path.join(repoRoot, "bin", "pi-web-tray.exe");
  const useNative = existsSync(nativeExe);
  const launchVbs = path.join(repoRoot, "scripts", "windows", "launch-tray.vbs");
  const icoPath = path.join(repoRoot, "public", "icons", "pi-web.ico");
  const { startup: startupLnk } = getWindowsShortcutPaths();

  try {
    if (enable) {
      const wscriptExe = resolveWscriptBin();
      const psCommand = useNative ? `
        $wsh = New-Object -ComObject WScript.Shell
        $sc = $wsh.CreateShortcut('${startupLnk.replace(/'/g, "''")}')
        $sc.TargetPath = '${nativeExe.replace(/'/g, "''")}'
        $sc.Arguments = '-Startup'
        $sc.WorkingDirectory = '${repoRoot.replace(/'/g, "''")}'
        if (Test-Path '${icoPath.replace(/'/g, "''")}') { $sc.IconLocation = '${icoPath.replace(/'/g, "''")},0' }
        $sc.Description = 'pi-web Background Tray Service'
        $sc.Save()
      ` : `
        $wsh = New-Object -ComObject WScript.Shell
        $sc = $wsh.CreateShortcut('${startupLnk.replace(/'/g, "''")}')
        $sc.TargetPath = '${wscriptExe.replace(/'/g, "''")}'
        $sc.Arguments = '"${launchVbs.replace(/"/g, '`"')}" -Startup'
        $sc.WorkingDirectory = '${repoRoot.replace(/'/g, "''")}'
        if (Test-Path '${icoPath.replace(/'/g, "''")}') { $sc.IconLocation = '${icoPath.replace(/'/g, "''")},0' }
        $sc.Description = 'pi-web Background Tray Service'
        $sc.Save()
      `;

      const psBin = resolvePowerShellBin();
      await execFileAsync(psBin, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], {
        timeout: 5000,
        env: getWindowsExecutionEnv(),
        windowsHide: true,
      });
      return { success: true, autostart: true, message: "Autostart enabled." };
    } else {
      if (existsSync(startupLnk)) {
        await fs.unlink(startupLnk);
      }
      return { success: true, autostart: false, message: "Autostart disabled." };
    }
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, autostart: false, message: err.message };
  }
}

export async function startTrayService(options: { openBrowser?: boolean } = {}): Promise<{ success: boolean; message?: string }> {
  if (process.platform !== "win32") {
    return { success: false, message: "Tray service can only be started on Windows." };
  }

  const repoRoot = getRepoRoot();
  const nativeExe = path.join(repoRoot, "bin", "pi-web-tray.exe");

  if (existsSync(nativeExe)) {
    try {
      const args: string[] = [];
      if (options.openBrowser) args.push("-OpenBrowser");
      // Must use UseShellExecute (shell:true) so the WinExe gets a proper
      // Desktop Window Manager session for NotifyIcon registration.
      // 'windowsHide: true' would pass SW_HIDE and suppress tray icon — never use it here.
      const child = spawn(nativeExe, args, {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore",
        shell: false,
        // No windowsHide — WinForms needs the default CreateProcess window flags
      });
      child.unref();
      invalidateTrayRunningCache();
      return { success: true, message: "Native tray application started." };
    } catch (e: unknown) {
      const err = e as Error;
      return { success: false, message: `Failed to launch native tray: ${err.message}` };
    }
  }

  // Fallback to launch-tray.vbs
  const launchVbs = path.join(repoRoot, "scripts", "windows", "launch-tray.vbs");
  if (!existsSync(launchVbs)) {
    return { success: false, message: `Launcher not found at ${launchVbs}` };
  }

  const wscriptExe = resolveWscriptBin();
  const vbsArgs = [launchVbs];
  if (options.openBrowser) {
    vbsArgs.push("-OpenBrowser");
  }

  try {
    const child = spawn(wscriptExe, vbsArgs, {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    invalidateTrayRunningCache();
    return { success: true, message: "Background system tray launched via VBS." };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, message: err.message };
  }
}

export async function stopTrayService(): Promise<{ success: boolean; message?: string }> {
  if (process.platform !== "win32") {
    return { success: false, message: "Only supported on Windows." };
  }
  try {
    // Try to end Scheduled Task first (headless service)
    try {
      await execFileAsync("schtasks.exe", ["/end", "/tn", "pi-web"], { timeout: 3000, env: getWindowsExecutionEnv(), windowsHide: true });
    } catch { }
    const taskkillExe = resolveTaskkillBin();
    const psCommand = `
      $trayProcs = Get-CimInstance Win32_Process -Filter "Name LIKE '%powershell%' OR Name LIKE '%pwsh%' OR Name LIKE '%pi-web-tray%'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID -and ($_.CommandLine -like '*pi-web-tray.ps1*' -or $_.CommandLine -like '*pi-web-service.ps1*' -or $_.CommandLine -like '*pi-web-tray.exe*') }
      foreach ($p in $trayProcs) {
          Start-Process -FilePath '${taskkillExe.replace(/'/g, "''")}' -ArgumentList "/PID $($p.ProcessId) /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
      }
      $nativeProcs = Get-CimInstance Win32_Process -Filter "Name = 'pi-web-tray.exe'" -ErrorAction SilentlyContinue
      foreach ($p in $nativeProcs) {
          Start-Process -FilePath '${taskkillExe.replace(/'/g, "''")}' -ArgumentList "/PID $($p.ProcessId) /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
      }
    `;
    const psBin = resolvePowerShellBin();
    await execFileAsync(psBin, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], {
      timeout: 10000,
      env: getWindowsExecutionEnv(),
      windowsHide: true,
    });
    invalidateTrayRunningCache();
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, message: err.message };
  }
}

export async function restartTrayService(): Promise<{ success: boolean; message?: string }> {
  await stopTrayService();
  await new Promise((resolve) => setTimeout(resolve, 800));
  return startTrayService({ openBrowser: false });
}
