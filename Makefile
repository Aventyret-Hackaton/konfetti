# `make` builds the CLI and the wasm the editor loads. `make serve` runs the editor.
# `make app` builds the Mac app; it needs the Tauri CLI (`cargo install tauri-cli --version "^2" --locked`).
# The wasm comes first: the CLI embeds it for `konfetti build --html`.
all:
	cargo build --release --lib --target wasm32-unknown-unknown
	cp -p target/wasm32-unknown-unknown/release/konfetti.wasm web/
	cargo build --release

test:
	cargo test

serve: all
	python3 -m http.server 8137

# Tauri embeds src-tauri/dist: a copy, made here, of what the web version serves.
app: all
	rm -rf src-tauri/dist
	mkdir src-tauri/dist
	cp -Rp web lessons examples src-tauri/dist/
	cd src-tauri && cargo tauri build
	@echo "The app: src-tauri/target/release/bundle/macos/Konfetti.app"

.PHONY: all test serve app
