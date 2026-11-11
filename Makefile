# `make` builds the CLI and the wasm the editor loads. `make serve` runs the editor.
all:
	cargo build --release
	cargo build --release --lib --target wasm32-unknown-unknown
	cp target/wasm32-unknown-unknown/release/konfetti.wasm web/

test:
	cargo test

serve: all
	python3 -m http.server 8137

.PHONY: all test serve
