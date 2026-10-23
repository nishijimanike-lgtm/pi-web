use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::process_manager::ProcessManager;

fn get_startup_shortcut_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|appdata| {
        PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Startup")
            .join("pi-web-tray.lnk")
    })
}

fn is_autostart_enabled() -> bool {
    get_startup_shortcut_path().map(|p| p.exists()).unwrap_or(false)
}

fn set_autostart(enable: bool) {
    if let Some(shortcut_path) = get_startup_shortcut_path() {
        if !enable {
            let _ = std::fs::remove_file(&shortcut_path);
            log::info!("Autostart shortcut removed: {:?}", shortcut_path);
        } else {
            if let Ok(exe) = std::env::current_exe() {
                let target = exe.to_string_lossy().to_string();
                let shortcut = shortcut_path.to_string_lossy().to_string();
                let script = format!(
                    "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{}'); $s.TargetPath = '{}'; $s.Arguments = '--tray'; $s.Save()",
                    shortcut.replace("'", "''"),
                    target.replace("'", "''")
                );
                let _ = Command::new("powershell")
                    .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
                    .output();
                log::info!("Autostart shortcut created: {:?}", shortcut_path);
            }
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let pkg_version = app.package_info().version.to_string();
    let header_label = format!("Pi Web v{} (运行中)", pkg_version);

    let header_i = MenuItem::with_id(app, "header", &header_label, false, None::<&str>)?;
    let sep0 = PredefinedMenuItem::separator(app)?;

    let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏主窗口", true, None::<&str>)?;
    let browser_i = MenuItem::with_id(app, "open_browser", "在浏览器中打开 (Web 版)", true, None::<&str>)?;
    let copy_url_i = MenuItem::with_id(app, "copy_url", "复制 Web 地址", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    let restart_i = MenuItem::with_id(app, "restart_server", "重启后台服务", true, None::<&str>)?;
    let toggle_server_i = MenuItem::with_id(app, "toggle_server", "停止/启动后台服务", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let view_logs_i = MenuItem::with_id(app, "view_logs", "查看运行日志", true, None::<&str>)?;
    let edit_config_i = MenuItem::with_id(app, "edit_config", "编辑服务配置", true, None::<&str>)?;
    let open_folder_i = MenuItem::with_id(app, "open_folder", "打开工程目录", true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let autostart_checked = is_autostart_enabled();
    let autostart_i = CheckMenuItem::with_id(app, "autostart", "开机自动启动", true, autostart_checked, None::<&str>)?;
    let sep4 = PredefinedMenuItem::separator(app)?;

    let quit_i = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &header_i,
            &sep0,
            &show_i,
            &hide_i,
            &browser_i,
            &copy_url_i,
            &sep1,
            &restart_i,
            &toggle_server_i,
            &sep2,
            &view_logs_i,
            &edit_config_i,
            &open_folder_i,
            &sep3,
            &autostart_i,
            &sep4,
            &quit_i,
        ],
    )?;

    // Light purple tray icon
    let icon_bytes = include_bytes!("../icons/tray-32x32.png");
    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .unwrap_or_else(|_| app.default_window_icon().cloned().expect("Default icon not found"));

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .icon(icon)
        .tooltip("Pi Web")
        .on_menu_event(|app, event| {
            let pm_opt = app.try_state::<Arc<ProcessManager>>().map(|s| s.inner().clone());
            let config = pm_opt.as_ref().map(|pm| pm.load_config()).unwrap_or_default();
            let host = if config.hostname.is_empty() { "127.0.0.1" } else { &config.hostname };
            let server_url = format!("http://{}:{}", host, config.port);

            match event.id.as_ref() {
                "show" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                "hide" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.hide();
                    }
                }
                "open_browser" => {
                    let _ = open::that(&server_url);
                }
                "copy_url" => {
                    if let Ok(mut clipboard) = arboard::Clipboard::new() {
                        let _ = clipboard.set_text(&server_url);
                    }
                }
                "restart_server" => {
                    if let Some(pm) = pm_opt {
                        std::thread::spawn(move || {
                            if let Err(e) = pm.restart_managed_server() {
                                log::error!("Failed to restart server: {}", e);
                            }
                        });
                    }
                }
                "toggle_server" => {
                    if let Some(pm) = pm_opt {
                        std::thread::spawn(move || {
                            let port = pm.load_config().port;
                            if pm.is_port_listening(port) {
                                pm.stop_managed_server();
                            } else {
                                let _ = pm.ensure_server_running();
                            }
                        });
                    }
                }
                "view_logs" => {
                    if let Some(pm) = pm_opt {
                        let log_path = pm.get_log_path();
                        if !log_path.exists() {
                            if let Some(parent) = log_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            let _ = std::fs::write(&log_path, "");
                        }
                        let _ = open::that(log_path);
                    }
                }
                "edit_config" => {
                    if let Some(pm) = pm_opt {
                        let cfg_path = pm.get_config_path();
                        if !cfg_path.exists() {
                            if let Some(parent) = cfg_path.parent() {
                                let _ = std::fs::create_dir_all(parent);
                            }
                            let default_cfg = serde_json::to_string_pretty(&pm.load_config()).unwrap_or_default();
                            let _ = std::fs::write(&cfg_path, default_cfg);
                        }
                        let _ = open::that(cfg_path);
                    }
                }
                "open_folder" => {
                    if let Some(pm) = pm_opt {
                        let root = pm.find_project_root();
                        let _ = open::that(root);
                    }
                }
                "autostart" => {
                    let current = is_autostart_enabled();
                    set_autostart(!current);
                }
                "quit" => {
                    if let Some(pm) = pm_opt {
                        pm.stop_managed_server();
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                // Single left-click toggles main window
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    if let Some(win) = app.get_webview_window("main") {
                        let visible = win.is_visible().unwrap_or(false);
                        if visible {
                            let _ = win.hide();
                        } else {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                }
                // Double left-click opens in default browser (matches web tray behavior)
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    let pm_opt = app.try_state::<Arc<ProcessManager>>().map(|s| s.inner().clone());
                    let config = pm_opt.as_ref().map(|pm| pm.load_config()).unwrap_or_default();
                    let host = if config.hostname.is_empty() { "127.0.0.1" } else { &config.hostname };
                    let server_url = format!("http://{}:{}", host, config.port);
                    let _ = open::that(server_url);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
