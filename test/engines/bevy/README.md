# Bevy sample

A Bevy 0.20.0 web build, bundled with Trunk 0.22.0: a ring of coloured cubes spins and bobs over a floor in a lit 3D scene with shadows, and the camera orbits with the arrow keys or a drag. It renders with WebGL2, which runs in every browser.

- `source/`: the Cargo project (`bevy-sample`, `Cargo.lock` committed, release profile sized for the web) and Trunk's source page `index.html`.
- `build/`: Trunk's output as it writes it, with hashed file names: `index.html`, the wasm-bindgen glue (`bevy-sample-<hash>.js`) and `bevy-sample-<hash>_bg.wasm`.

Set up once, then rebuild after changing `source/`:

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked trunk
cd test/engines/bevy/source
trunk build --release --public-url ./
rm -rf ../build && mkdir ../build && cp dist/index.html dist/*.js dist/*.wasm ../build/
```

`--public-url ./` keeps the paths relative, so the sample runs under any path (the preview serves games under `/<slug>/`); live, Trunk's default `/` works too, since each game has its own subdomain. A release build takes several minutes. Bevy needs a recent Rust (`cargo info bevy` shows the version).
