# macroquad sample

A macroquad 0.4.16 web build, as macroquad's docs ship it: four thousand particles drift around an attractor you steer with the arrow keys or by holding the mouse, with a particle and frame counter.

- `source/`: the Cargo project (`macroquad-sample`, `Cargo.lock` committed, release profile sized for the web).
- `build/`: `index.html`, `mq_js_bundle.js` (macroquad's loader, copied unchanged from the crate's `js/` folder, the version that matches the crate) and `macroquad-sample.wasm`. The page registers a small miniquad plugin so the game can tell the test it has drawn its first frame, and declares `var register_plugin;` before the bundle: 0.4.16's `quad_net` plugin assigns that name without declaring it, which throws in the bundle's strict mode and logs a `ReferenceError` on every macroquad page.

Rebuild it after changing `source/` with the Rust web target installed once (`rustup target add wasm32-unknown-unknown`):

```bash
cd test/engines/macroquad/source
cargo build --release --target wasm32-unknown-unknown
wasm-opt -Oz target/wasm32-unknown-unknown/release/macroquad-sample.wasm -o ../build/macroquad-sample.wasm
```

`wasm-opt` (from Binaryen) is optional: without it, copy the built `.wasm` into `build/` as it is. When you change the macroquad version in `Cargo.toml`, copy `mq_js_bundle.js` from that crate's `js/` folder (in `~/.cargo/registry/src/`) too: the loader and the crate have to be the same version, or the game logs a version mismatch.
