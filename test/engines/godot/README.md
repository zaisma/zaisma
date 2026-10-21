# Godot sample

A Godot 4.4.1 web export, as the editor writes it: boxes rain onto a floor in a lit 3D scene with shadows and physics, the camera orbits with the arrow keys or a drag, and the best pile is kept in the game's own save (`user://`).

- `source/`: the project (GL Compatibility renderer, which web exports use).
- `build/`: its export, preset "Web" in `source/export_presets.cfg`: Thread Support off, the default since Godot 4.3, as `zaisma check` asks.

Rebuild it after changing `source/`, with the Web export templates for the editor's version installed:

```bash
godot --headless --path test/engines/godot/source --import
godot --headless --path test/engines/godot/source --export-release Web ../build/index.html
```

`debug-loader.js` is the loader (`index.js`) of the same project exported with Export With Debug ticked (`--export-debug Web`), kept on its own for the asset notes' `development_build` test (`test/node/performance-notes.test.ts`); its engine file isn't kept.
