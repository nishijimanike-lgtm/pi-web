# Unified System Tray for Pi Web Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate Pi Web's C# web tray and Tauri desktop tray into a single unified Tauri-based tray application, providing window controls, browser access, process management, config synchronization, and autostart capabilities while decommissioning the C# codebase.

**Architecture:** Extend the existing Tauri v2 Rust application (`src-tauri`) with full tray menu features (matching and surpassing the C# version), a configuration loader for `~/.pi/agent/web-service.json`, Windows Job Object cleanup, health monitoring, and a `--tray` / `--minimized` startup flag. Redirect `bin/pi-web-tray.js` and `lib/windows-service.ts` to the unified Tauri executable and decommission `native/tray`.

**Tech Stack:** Tauri v2, Rust (with `serde_json`, `tauri`, `open`, `arboard`), TypeScript/Node.js for CLI integration, Windows Win32 APIs for Job Object and Process handling.

---

### Task 1: Add Dependencies to `src-tauri/Cargo.toml`

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Update Cargo.toml with arboard and winapi/windows crates**
Add `arboard = "3.4"` for clipboard operations and ensure required dependencies are present.

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.12.3", features = ["tray-icon", "image-png", "image-ico"] }
tauri-plugin-log = "2"
tauri-plugin-single-instance = "2"
open = "5.3"
arboard = "3.4"
```

**Step 2: Verify compilation of Cargo dependencies**
Run `cargo check` in `src-tauri/` to verify dependencies resolve properly.

---

### Task 2: Enhance Process Manager & Config Reader in `src-tauri/src/process_manager.rs`

**Files:**
- Modify: `src-tauri/src/process_manager.rs`

**Step 1: Implement WebServiceConfig struct & parser**
- Struct for `~/.pi/agent/web-service.json`: `port`, `hostname`, `mode`, `autostart`, `auto_restart`, etc.
- Safe loader reading from `~/.pi/agent/web-service.json` with fallback defaults (`port = 30141`, `hostname = "127.0.0.1"`, `mode = "start"`, `auto_restart = true`).
- Smart mode selection: if mode is `start` but `.next` directory does not exist, fallback to `dev`.

**Step 2: Add port release check and graceful restart**
- Wait for port to become unbound (up to 5 seconds) before restarting Node server to prevent `EADDRINUSE`.
- Expose `get_config()`, `start_managed_server()`, `stop_managed_server()`, `restart_managed_server()`.

**Step 3: Verification**
Verify with `cargo check` in `src-tauri/`.

---

### Task 3: Build Unified Tray Context Menu in `src-tauri/src/tray.rs`

**Files:**
- Modify: `src-tauri/src/tray.rs`

**Step 1: Construct Full Menu Hierarchy**
Construct menu items:
- Header: Version & status label (`Pi Web v...`)
- Window Controls: `显示主窗口` / `隐藏主窗口`
- Web Access: `在浏览器中打开 (Web 版)`, `复制 Web 地址`
- Server Control: `重启后台服务`, `停止/启动后台服务`
- System & Diagnostics: `查看运行日志`, `编辑服务配置`, `打开工程目录`
- Startup: `开机自动启动`
- Quit: `彻底退出`

**Step 2: Implement Click Handlers**
- Left Click Single: Toggle `main` window visibility (focus if hidden, hide if visible).
- Left Click Double: Open default browser with `http://127.0.0.1:30141`.
- Menu Actions:
  - `show_window`: show and focus main window
  - `open_browser`: `open::that(&url)`
  - `copy_url`: copy via `arboard::Clipboard`
  - `restart_server`: call `process_manager.restart()`
  - `toggle_server`: start/stop managed server
  - `view_logs`: open notepad with `~/.pi/agent/logs/pi-web-service.log`
  - `edit_config`: open notepad with `~/.pi/agent/web-service.json`
  - `open_folder`: open explorer with project root
  - `toggle_autostart`: toggle startup shortcut in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\pi-web-tray.lnk`
  - `quit`: stop managed server and `app.exit(0)`

**Step 3: Verification**
Verify with `cargo check` in `src-tauri/`.

---

### Task 4: Support Silent / Tray-Only Startup in `src-tauri/src/lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Parse Command Line Arguments**
Check if CLI args include `--tray`, `--minimized`, or `-s`.
If present:
- Do not show the main window on startup.
- Only show the tray icon.
If absent:
- Show main window normally on startup.

**Step 2: Ensure Window Event Interception**
Ensure closing the window hides it instead of quitting:
```rust
if let WindowEvent::CloseRequested { api, .. } = event {
    api.prevent_close();
    let _ = win_clone.hide();
}
```

**Step 3: Single Instance Focus Handling**
When a secondary instance is launched without `--tray`, bring the existing window to the foreground and focus it.

---

### Task 5: Redirect CLI & Windows Service to Tauri Executable

**Files:**
- Modify: `bin/pi-web-tray.js`
- Modify: `lib/windows-service.ts`
- Modify: `package.json`

**Step 1: Update `bin/pi-web-tray.js` and `lib/windows-service.ts`**
- Change tray executable path detection to look for the Tauri binary (`src-tauri/target/release/pi-web.exe` or `bin/pi-web.exe`).
- Change process query from `pi-web-tray.exe` to `pi-web.exe`.
- Update shortcut creation to launch `pi-web.exe --tray`.

**Step 2: Update `package.json`**
- Update or alias `tray:build` to build Tauri (`npm run desktop:build` or `tauri build`).
- Remove reference to `native/tray/tray.csproj`.

**Step 3: Decommission `native/tray`**
- Archive or remove `native/tray` directory.

---

### Task 6: End-to-End Build & Validation

**Step 1: Check TypeScript Types**
Run `node_modules/.bin/tsc --noEmit` and `npm run lint`.

**Step 2: Check Rust Compilation**
Run `cargo check` in `src-tauri/`.

**Step 3: Test Runtime Behavior**
Verify `pi-web-tray` CLI commands, startup behavior, and process cleanup.
