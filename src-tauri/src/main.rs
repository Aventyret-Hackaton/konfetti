// The Mac app: the editor's own files (see `make app`) in a native window. Nothing here knows
// konfetti; the page is the same one the web version serves, and the one thing it may ask of the
// app is `location`, for Wind.
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_core_location::{
    CLAuthorizationStatus, CLLocation, CLLocationManager, CLLocationManagerDelegate, kCLLocationAccuracyThreeKilometers,
};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol};
use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::process::Command;
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Seconds a `location` call waits: for a position, and for a person to answer the Mac's question.
const FIX: u64 = 10;
const ANSWER: u64 = 60;

/// A browser's `coords`, already rounded to one decimal (about 10 km). Nothing finer leaves this file.
type Place = HashMap<&'static str, f64>;

/// What a waiting `location` call hears: wait this many seconds more, or the answer.
enum Word {
    Wait(u64),
    Done(Result<Place, String>),
}

// The main thread's, as CoreLocation wants. One manager for the app's life, made at the first
// press of Wind, and its delegate, which the manager does not keep alive itself.
thread_local! {
    static MAC: OnceCell<(Retained<CLLocationManager>, Retained<Delegate>)> = const { OnceCell::new() };
    static WAITING: RefCell<Vec<Sender<Word>>> = const { RefCell::new(Vec::new()) };
}

define_class!(
    // SAFETY: NSObject asks nothing of a subclass, and `Delegate` has no `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    // SAFETY: the signatures are CLLocationManagerDelegate's.
    unsafe impl CLLocationManagerDelegate for Delegate {
        // The person answered the Mac's question (or changed the answer in System Settings).
        #[unsafe(method(locationManagerDidChangeAuthorization:))]
        fn answered(&self, mac: &CLLocationManager) {
            go_on(mac);
        }

        #[unsafe(method(locationManager:didUpdateLocations:))]
        fn found(&self, _mac: &CLLocationManager, places: &NSArray<CLLocation>) {
            let tenth = |degrees: f64| (degrees * 10.0).round() / 10.0;
            tell(places.lastObject().ok_or("no position".into()).map(|place| {
                let at = unsafe { place.coordinate() };
                [("latitude", tenth(at.latitude)), ("longitude", tenth(at.longitude))].into()
            }));
        }

        #[unsafe(method(locationManager:didFailWithError:))]
        fn failed(&self, _mac: &CLLocationManager, error: &NSError) {
            tell(Err(format!("CoreLocation error {}", error.code())));
        }
    }
);

/// Ends every waiting call with this answer.
fn tell(answer: Result<Place, String>) {
    for call in WAITING.take() {
        let _ = call.send(Word::Done(answer.clone()));
    }
}

/// Takes the waiting calls one step on: asks the person, asks for the position, or gives up.
fn go_on(mac: &CLLocationManager) {
    // Telling them how long the step may take also drops the calls that gave up: nobody waiting, nothing asked.
    let waiting = |secs| {
        WAITING.with_borrow_mut(|calls| {
            calls.retain(|call| call.send(Word::Wait(secs)).is_ok());
            !calls.is_empty()
        })
    };
    match unsafe { mac.authorizationStatus() } {
        // The Mac asks once, with the sentence in Info.plist under its question, and remembers the answer.
        CLAuthorizationStatus::NotDetermined => {
            if waiting(ANSWER) {
                unsafe { mac.requestWhenInUseAuthorization() }
            }
        }
        // Denied is also what Location Services switched off looks like.
        CLAuthorizationStatus::Denied | CLAuthorizationStatus::Restricted => tell(Err("location not allowed".into())),
        _ => {
            if waiting(FIX) {
                unsafe { mac.requestLocation() }
            }
        }
    }
}

/// Where the Mac is, for Wind. It always answers: a place, or an error when the person or the Mac
/// says no or nothing comes in time, and then the page makes up a wind as it does in a browser.
#[tauri::command]
async fn location(app: AppHandle) -> Result<Place, String> {
    let (call, word) = channel();
    app.run_on_main_thread(move || {
        WAITING.with_borrow_mut(|calls| calls.push(call));
        MAC.with(|mac| {
            let (mac, _) = mac.get_or_init(|| unsafe {
                let mac = CLLocationManager::new();
                let delegate: Retained<Delegate> = msg_send![Delegate::alloc(MainThreadMarker::new().unwrap()), init];
                mac.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                mac.setDesiredAccuracy(kCLLocationAccuracyThreeKilometers); // coarse is quick, and all Wind needs
                (mac, delegate)
            });
            go_on(mac);
        });
    })
    .map_err(|e| e.to_string())?;
    let wait = move || {
        let mut secs = FIX;
        loop {
            match word.recv_timeout(Duration::from_secs(secs)) {
                Ok(Word::Wait(more)) => secs = more,
                Ok(Word::Done(answer)) => return answer,
                Err(_) => return Err("no answer in time".into()),
            }
        }
    };
    tauri::async_runtime::spawn_blocking(wait).await.map_err(|e| e.to_string())?
}

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
        .invoke_handler(tauri::generate_handler![location])
        .run(tauri::generate_context!())
        .expect("konfetti could not start");
}
