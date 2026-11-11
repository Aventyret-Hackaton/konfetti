# `make` builds the CLI and the wasm the editor loads. `make serve` runs the editor.
# The wasm comes first: the CLI embeds it for `konfetti build --html`.
all:
	cargo build --release --lib --target wasm32-unknown-unknown
	cp -p target/wasm32-unknown-unknown/release/konfetti.wasm web/
	cargo build --release

test:
	cargo test

serve: all
	python3 -m http.server 8137

.PHONY: all test serve
