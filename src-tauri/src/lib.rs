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

    tauri::Builder::default()
        .manage(process_mgr)
        .setup(move |app| {
            if cfg!(debug_assertions) {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            // Ensure server is running in background thread so startup stays responsive
            let handle = app.handle().clone();
            let pm = Arc::clone(&process_mgr_setup);
            std::thread::spawn(move || {
                if let Err(e) = pm.ensure_server_running(30141) {
                    log::error!("Failed to ensure server is running: {}", e);
                } else if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.eval("if (!window.location.href.includes('30141')) { window.location.href = 'http://127.0.0.1:30141'; }");
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
