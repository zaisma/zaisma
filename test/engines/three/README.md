# Three.js sample

A Three.js game as a developer would ship it: the library from npm (`three@0.186.1`, `build/three.module.js` and `build/three.core.js`) in `build/lib/`, loaded through an import map, no bundler. A lit 3D scene with shadows, fog and 400 instanced crystals, and a camera that orbits with the mouse, a touch or the arrow keys.

To update Three.js, copy the new `build/three.module.js` and `build/three.core.js` from the npm package into `build/lib/`.
