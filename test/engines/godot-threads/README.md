# Godot sample with threads

The threaded build of the Godot sample (`test/engines/godot/source`): the same project, exported with preset "Web Threads" in `source/export_presets.cfg` (Thread Support on, PWA off). It runs only where the game's frame is cross-origin isolated, which Zaisma gives every game in Chrome and Edge (Document-Isolation-Policy), so `npm run engines:play` also checks the frame has `crossOriginIsolated` and SharedArrayBuffer. `zaisma check` finds `needs_threads` in it, as it should.

Rebuild it after changing the Godot sample's `source/`, with the Web export templates (threaded ones too: `web_release.zip`) for the editor's version installed:

```bash
godot --headless --path test/engines/godot/source --export-release "Web Threads" ../../godot-threads/build/index.html
```
