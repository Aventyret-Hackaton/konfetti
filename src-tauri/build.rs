fn main() {
    // Naming a command here takes it away from every window. The capability in tauri.conf.json
    // gives `location` and `save` back to the editor's window alone.
    let ours = tauri_build::AppManifest::new().commands(&["location", "save"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(ours)).expect("tauri-build failed");
}
