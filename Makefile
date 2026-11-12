# `make` builds the CLI and the wasm the editor loads. `make serve` runs the editor.
# `make app` builds the desktop app for this machine; it needs the Tauri CLI (`cargo install tauri-cli --version "^2" --locked`).
# The wasm comes first: the CLI embeds it for `konfetti build --html`.
all:
	cargo build --release --lib --target wasm32-unknown-unknown
	cp -p target/wasm32-unknown-unknown/release/konfetti.wasm web/
	cargo build --release

test:
	cargo test

serve: all
	python3 -m http.server 8137

# Tauri embeds src-tauri/dist, which dist.sh fills. The installers for all three systems are built
# by .github/workflows/release.yml, not here.
app: all
	sh src-tauri/dist.sh
	cd src-tauri && cargo tauri build
	@echo "The app: under src-tauri/target/release/ (on a Mac, bundle/macos/Konfetti.app)"

.PHONY: all test serve app
