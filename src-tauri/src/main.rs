// DRL Champions — desktop (Tauri 2). Oculta la consola en release (Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    drl_champions_lib::run()
}
