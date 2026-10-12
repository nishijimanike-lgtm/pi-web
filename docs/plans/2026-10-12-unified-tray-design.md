# Unified System Tray Design Document: Merging Web & Desktop Trays

**Date**: 2026-10-12  
**Status**: Approved  
**Topic**: Unified System Tray for Pi Web (Consolidating C# Web Tray and Tauri Desktop Tray)

---

## 1. Context & Motivation

Pi Web previously maintained two distinct system tray implementations:
1. **Web Background Service Tray**: Written in C# (.NET WinForms in `native/tray`), managing the Next.js backend server, shortcuts, autostart, and browser launch.
2. **Desktop Client Tray**: Written in Rust (`src-tauri` using Tauri v2), managing the WebView window lifecycle and a minimal tray menu.

This dual-tray approach caused several issues:
- Process confusion when both the desktop app and the background web service were running simultaneously.
- Duplicate and divergent maintenance costs between .NET and Rust codebases.
- Inconsistent user experience between desktop and web entrypoints.

The goal is to **merge both trays into a single Tauri-based application**, eliminating the C# `native/tray` project while retaining and upgrading all capabilities.

---

## 2. Target Architecture

```
                 +----------------------------------------------+
                 |       Tauri 统一客户端 (Rust / Tauri v2)       |
                 +----------------------------------------------+
                  /                       |                    \
        [托盘图标 & 上下文菜单]    [桌面 WebView 主窗口]   [后台 Node 服务守护进程]
        - 左键: 切换窗口显示/隐藏   - 加载 Web 界面         - 监听 30141 (可配置)
        - 右键: 完整管理菜单       - 隐藏/关闭拦截到托盘    - 崩溃监控与自动重启
        - 双击: 打开默认浏览器网页                          - 绑定 Windows Job 对象
                  \                       |                    /
                   +------------------------------------------+
                   | 配置文件 ~/.pi/agent/web-service.json    |
                   | 快捷方式 / 注册表开机自启 (带 --tray 参数) |
                   +------------------------------------------+
```

### Key Architectural Decisions:
1. **Single Binary Strategy**: The Tauri desktop executable (`pi-web.exe`) serves both as the rich desktop client and as the lightweight background system tray manager.
2. **Startup Modes**:
   - **Default Launch**: Shows the desktop WebView window and docks into the tray.
   - **Silent / Autostart Launch (`--tray` or `--minimized`)**: Hides the desktop window at launch and docks quietly into the system tray.
3. **Graceful Window Close**: Closing the main window intercepts `CloseRequested` and hides to the tray instead of terminating the app or server.
4. **Configuration Compatibility**: Reads `~/.pi/agent/web-service.json` for port, hostname, mode (`start` vs `dev`), autostart, and auto-restart options.

---

## 3. Tray Interaction & Menu Specification

- **Left-Click Single**: Toggle main window visibility (restore & focus if hidden/minimized; hide if visible).
- **Left-Click Double**: Open Pi Web in the user's default browser (e.g. `http://127.0.0.1:30141`).
- **Right-Click Context Menu**:
  1. **Header Item** (Disabled): `Pi Web v<version> (<Status> / Port <port>)`
  2. **Separator**
  3. **Show / Hide Main Window**: `显示桌面窗口` / `隐藏桌面窗口`
  4. **Open in Default Browser**: `在浏览器中打开 (Web 版)`
  5. **Copy URL**: `复制 Web 地址`
  6. **Separator**
  7. **Restart Server**: `重启后台服务` (releases port cleanly before relaunching)
  8. **Toggle Server**: `停止后台服务` / `启动后台服务`
  9. **Separator**
  10. **View Logs**: `查看运行日志` (opens `~/.pi/agent/logs/pi-web-service.log` with default editor)
  11. **Edit Config**: `编辑服务配置` (opens `~/.pi/agent/web-service.json`)
  12. **Open Project Folder**: `打开工程目录` (opens project directory in File Explorer)
  13. **Separator**
  14. **Start with Windows**: `开机自动启动` (Checkbox toggle, updates registry / startup shortcuts)
  15. **Separator**
  16. **Quit**: `彻底退出` (terminates child node server and exits app)

---

## 4. Backend Process & Configuration Management

### 4.1 Process Isolation & Cleanup
- Windows `JobObject` (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) ensures all child processes spawned by Node.js / npm are cleanly terminated when the Tauri process exits.
- Port listening pre-checks: Prevents starting conflicting duplicate servers if the port is already owned.
- Restart procedure: Sends termination signal -> loops up to 5s until port is unbound -> spawns new process.

### 4.2 Configuration Loading
- Path: `~/.pi/agent/web-service.json`
- Fallback Defaults:
  ```json
  {
    "port": 30141,
    "hostname": "127.0.0.1",
    "mode": "start",
    "autostart": true,
    "openBrowserOnLaunch": false,
    "autoRestart": true
  }
  ```
- Mode Fallback: If `mode == "start"` but `.next` directory is absent, automatically fallback to `npm run dev`.

---

## 5. Migration & Deprecation Plan

1. **Remove C# Codebase**:
   - Deprecate/remove `native/tray` directory.
   - Remove `tray.csproj` build scripts from `package.json`.
2. **Update Scripts & CLI**:
   - `bin/pi-web-tray.js`: Point to the Tauri executable `pi-web.exe`.
   - `lib/windows-service.ts`: Update detection logic from `pi-web-tray.exe` to `pi-web.exe`.
3. **Verification**:
   - Run typecheck and cargo checks.
   - Test regular startup, `--tray` silent startup, tray menu triggers, port releasing, and app exit.
