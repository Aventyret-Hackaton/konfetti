// macOS: `location` through CoreLocation and `save` through the Mac's save panel.
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_core_location::{
    CLAuthorizationStatus, CLLocation, CLLocationManager, CLLocationManagerDelegate, kCLLocationAccuracyThreeKilometers,
};
use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, ns_string};
use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;
use tauri::AppHandle;

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
pub async fn location(app: AppHandle) -> Result<Place, String> {
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

/// Save, for the editor. A download, the browser's way, would make the Mac ask about the Downloads
/// folder and tell the page nothing, so the app asks where with the Mac's save panel and writes the
/// text there itself. It answers the file's name, or nothing when the person cancels; the page
/// never learns the folder.
#[tauri::command]
pub async fn save(app: AppHandle, text: String) -> Result<Option<String>, String> {
    let (done, mut answer) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || {
        let panel = NSSavePanel::savePanel(MainThreadMarker::new().unwrap());
        panel.setNameFieldStringValue(ns_string!("program.kft"));
        let to = (panel.runModal() == NSModalResponseOK).then(|| panel.URL()).flatten().and_then(|url| url.to_file_path());
        let name = |to: &PathBuf| to.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let _ = done.try_send(to.map(|to| fs::write(&to, text).map(|()| name(&to)).map_err(|e| e.to_string())).transpose());
    })
    .map_err(|e| e.to_string())?;
    answer.recv().await.unwrap_or(Err("no answer".into()))
}
