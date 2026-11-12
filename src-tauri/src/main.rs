// The Mac app: the editor's own files (see `make app`) in a native window. Nothing here knows
// konfetti; the page is the same one the web version serves, and it gets no Tauri API at all.
use std::process::Command;
use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// The app's windows show the app's own pages only. A link that leads elsewhere opens in the browser.
fn ours(url: &Url) -> bool {
    let outside = matches!(url.scheme(), "http" | "https"); // ours are tauri://localhost/...
    if outside {
        let _ = Command::new("open").arg(url.as_str()).spawn();
    }
    !outside
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(ours)
                // Docs asks for a new tab. Here that is a second window, so the confetti stays where it lies.
                .on_new_window(move |_url, features| {
                    if let Some(docs) = handle.get_webview_window("docs") {
                        let _ = docs.unminimize(); // set_focus does nothing to a window in the Dock
                        let _ = docs.set_focus();
                        return NewWindowResponse::Deny;
                    }
                    // WebKit loads the page itself, into a webview made the way `features` says.
                    WebviewWindowBuilder::new(&handle, "docs", WebviewUrl::External("about:blank".parse().unwrap()))
                        .window_features(features)
                        .title("konfetti guide")
                        .inner_size(960.0, 800.0)
                        .on_navigation(ours)
                        .build()
                        .map_or(NewWindowResponse::Deny, |window| NewWindowResponse::Create { window })
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
        .run(tauri::generate_context!())
        .expect("konfetti could not start");
}
