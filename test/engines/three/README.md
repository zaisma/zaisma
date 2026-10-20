# Three.js sample

A Three.js game as a developer would ship it: the library from npm (`three@0.186.1`, `build/three.module.js` and `build/three.core.js`) in `build/lib/`, and five add-ons from its `examples/jsm` with what they import, in `build/lib/addons/` (`three/addons/` in the import map, as three's docs write it), no bundler. A 3D scene with shadows and fog: 360 crystals of dark glass that reflect a room three makes itself (`RoomEnvironment`), and 40 bright ones that glow and pulse through bloom (`EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`), and a camera that orbits with the mouse, a touch or the arrow keys.

To update Three.js, copy the new `build/three.module.js` and `build/three.core.js` from the npm package into `build/lib/`, and the same files from its `examples/jsm` into `build/lib/addons/`.
