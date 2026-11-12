// The app: the editor's own files (see `make app`) in a native window. Nothing here knows konfetti;
// the page is the same one the web version serves, and the two things it may ask of the app are
// `location`, for Wind, and `save`, for Save. Those are the system's: mac.rs on a Mac, other.rs on
// Linux and Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // no console window behind the app on Windows
use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(target_os = "macos", path = "mac.rs")]
#[cfg_attr(not(target_os = "macos"), path = "other.rs")]
mod native;

/// The app's windows show the app's own pages only. A link that leads elsewhere opens in the browser.
fn ours(url: &Url) -> bool {
    // Ours are tauri://localhost/..., and on Windows, where WebView2 has no schemes of its own, http://tauri.localhost/...
    let outside = matches!(url.scheme(), "http" | "https") && !(cfg!(windows) && url.host_str() == Some("tauri.localhost"));
    if outside {
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
        #[cfg(not(target_os = "macos"))]
        let _ = open::that_detached(url.as_str()); // xdg-open, or on Windows the shell itself: no console, no parsing
    }
    !outside
}

fn main() {
    // Linux: WebKitGTK's newer renderer leaves the meadow blank where there is no graphics card it
    // likes (a virtual machine, some drivers); the older one draws everywhere, as the release
    // workflow's pictures show. Setting the variable yourself, to 0 for the newer one, wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") }; // no other thread yet
    }
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(ours)
                // Docs asks for a new tab. Here that is a second window, so the confetti stays where it lies.
                // We make it, not WebKit: a window made from the editor's would share the editor's line to
                // the app, and `location` is for the editor alone.
                .on_new_window(move |_url, _features| {
                    if let Some(docs) = handle.get_webview_window("docs") {
                        let _ = docs.unminimize(); // set_focus does nothing to a window in the Dock
                        let _ = docs.set_focus();
                    } else {
                        let _ = WebviewWindowBuilder::new(&handle, "docs", WebviewUrl::App("web/docs.html".into()))
                            .title("konfetti guide")
                            .inner_size(960.0, 800.0)
                            .on_navigation(ours)
                            .build();
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        // The editor is the app: closing it quits, the guide too. Nothing in the guide leads back.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![native::location, native::save])
        .run(tauri::generate_context!())
        .expect("konfetti could not start");
}
