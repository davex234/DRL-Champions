// DRL Champions — runtime de escritorio (Tauri 2).
//
// Solo PLATAFORMA: ventana + plugins (fs/dialog/notification/updater/deep-link/
// single-instance). NO contiene lógica de juego: el juego es la app Next existente
// servida en el WebView. Una sola ventana, un solo WebView (ligero).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Una sola instancia: si se reabre, enfoca la ventana existente.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error al iniciar DRL Champions");
}
