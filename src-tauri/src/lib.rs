mod process_manager;
mod tray;

use process_manager::ProcessManager;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let process_mgr = Arc::new(ProcessManager::new());
    let process_mgr_setup = Arc::clone(&process_mgr);
    let process_mgr_exit = Arc::clone(&process_mgr);

    let is_tray_mode = std::env::args().any(|arg| {
        arg == "--tray" || arg == "--minimized" || arg == "-s" || arg == "--silent"
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a secondary instance is launched, focus the existing main window
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .manage(process_mgr)
        .setup(move |app| {
            if cfg!(debug_assertions) {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            let handle = app.handle().clone();
            let pm = Arc::clone(&process_mgr_setup);
            let config = pm.load_config();
            let host = if config.hostname.is_empty() { "127.0.0.1" } else { &config.hostname };
            let server_url = format!("http://{}:{}", host, config.port);
            let open_browser_on_launch = config.open_browser_on_launch;

            // Handle initial window visibility based on CLI arguments
            if let Some(main_win) = app.get_webview_window("main") {
                if is_tray_mode {
                    log::info!("Started with --tray; keeping main window in system tray.");
                    let _ = main_win.hide();
                }
                // Non-tray windows stay hidden (tauri.conf `visible: false`) until the
                // server answers, so a cold start never shows the webview error page.
            }

            // Ensure server is running in background thread so startup stays responsive
            let target_url = server_url.clone();
            std::thread::spawn(move || {
                let server_ready = pm.ensure_server_running();
                if let Err(e) = &server_ready {
                    log::error!("Failed to ensure server is running: {}", e);
                }

                if let Some(win) = handle.get_webview_window("main") {
                    // Point the window at the app only once the server is listening.
                    // The old guard compared the port in `location.href`, which also
                    // matched the PWA offline fallback (`/offline.html`) and left that
                    // page on screen after a cold start.
                    if server_ready.is_ok() {
                        match tauri::Url::parse(&target_url) {
                            Ok(url) => {
                                let _ = win.navigate(url);
                            }
                            Err(e) => log::error!("Invalid server URL {}: {}", target_url, e),
                        }
                    }
                    if !is_tray_mode {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }

                if server_ready.is_ok() && open_browser_on_launch {
                    let _ = open::that(target_url);
                }
            });

            // Set up system tray
            if let Err(e) = tray::setup_tray(app.handle()) {
                log::error!("Failed to setup tray: {}", e);
            }

            // Prevent window close from terminating the app; hide to tray instead
            if let Some(main_win) = app.get_webview_window("main") {
                let win_clone = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                process_mgr_exit.stop_managed_server();
            }
        });
}
