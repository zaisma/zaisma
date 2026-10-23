# Engine samples

One web export from each engine Zaisma says runs unchanged: Godot, Unity, Phaser, Three.js, Bevy and macroquad. Each `build/` is exactly what the engine (or a developer, for the libraries) ships, and each sample says it started by setting `window.zaismaEngineSample = { engine, version, started: true }`.

- `test/node/engines.test.ts`: `zaisma check` finds nothing the upload command doesn't fix, and the scan's own stage holds nothing.
- `npm run preview:start -- --reset --engines-only` (the full `--reset` seeds them first too) uploads each one with the upload command and leaves it to the scan; then `npm run engines:play` checks that the scan passed it and plays it on its game page in headless Chrome: it starts, draws, and nothing is thrown or refused. GitHub's "Engine exports" jobs run both, each with its share of the samples (`ENGINE_SAMPLE_SHARD`, `scripts/engines/samples.mjs`), on a pull request only when its branch changes something they run (`scripts/affected-tests.mjs`), and on every push to main.

A new engine is a folder here with `build/index.html` and a `README.md` on how to rebuild it.
