// Linux and Windows: the same two commands as mac.rs, as far as these systems go.
use std::fs;
use tauri::WebviewWindow;

/// No position here: the page makes up a wind, as it does in a browser that says no.
#[tauri::command]
pub fn location() -> Result<(), String> {
    Err("no location on this system".into())
}

/// Save, as on the Mac: the system's save dialog with `program.kft` as the name. It answers the
/// file's name, or nothing when the person cancels; the page never learns the folder. The dialog is
/// made on the main thread, which GTK wants, and waited for off it, as Tauri's dialog plugin does.
#[tauri::command]
pub async fn save(window: WebviewWindow, text: String) -> Result<Option<String>, String> {
    let (done, mut answer) = tauri::async_runtime::channel(1);
    let over = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = done.try_send(rfd::AsyncFileDialog::new().set_parent(&over).set_file_name("program.kft").save_file());
        })
        .map_err(|e| e.to_string())?;
    let Some(to) = answer.recv().await.ok_or("no answer")?.await else { return Ok(None) };
    fs::write(to.path(), text).map_err(|e| e.to_string())?;
    Ok(Some(to.file_name()))
}
