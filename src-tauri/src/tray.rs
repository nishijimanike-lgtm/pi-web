use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let browser_i = MenuItem::with_id(app, "open_browser", "在浏览器中打开", true, None::<&str>)?;
    let restart_i = MenuItem::with_id(app, "restart_server", "重启后台服务", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_i, &browser_i, &restart_i, &sep, &quit_i])?;

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
            match event.id.as_ref() {
                "show" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                "open_browser" => {
                    let _ = open::that("http://127.0.0.1:30141");
                }
                "restart_server" => {
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        if let Some(state) = app_clone.try_state::<std::sync::Arc<crate::process_manager::ProcessManager>>() {
                            state.stop_managed_server();
                            let _ = state.ensure_server_running(30141);
                        }
                    });
                }
                "quit" => {
                    if let Some(state) = app.try_state::<std::sync::Arc<crate::process_manager::ProcessManager>>() {
                        state.stop_managed_server();
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
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
        })
        .build(app)?;

    Ok(())
}
