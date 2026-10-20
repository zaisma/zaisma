/*
 * Glass resting in the scene (docs/DECISIONS.md, "3D carries the awe; text stays real"): for a few lead moments
 * on Zaisma's own scenes, a component rests on something in the world, lit by its sun, casting a shadow, and turns
 * to face you squarely when you point at it or focus it. It's the same page text and controls either way, so
 * screen readers, autofill, password managers, translation and find-in-page need nothing.
 *
 * A component a scene may hold is marked data-scene-anchor="<anchor name>" and sits in the scene's own layer
 * ([data-scene-layer], the box its canvas fills). It keeps its normal place on the page, glass in front, and moves
 * into the scene only while <html data-scene="on">. A page's scene script sets that only when WebGL started, the
 * pointer is fine, the window is at least 760px wide, reduced motion is off and the frame rate holds at about 42
 * a second or more; it removes it when any of those stops holding.
 *
 * The scene calls window.zaismaScene.place(anchorName, { matrix, lightX, lightY, isVisible }) once a frame per anchor:
 * - matrix: 16 numbers for CSS matrix3d, mapping the component's flat box (its own pixels, from its top left) onto
 *   the surface it rests on, in the layer's 3D space; the scene sets the layer's perspective to its camera's.
 * - lightX, lightY: the sun's direction on screen, from -1 to 1 (right and up).
 * - isVisible: false while the component is behind something or out of view.
 * Readable, whatever the scene asks: the placed box is never smaller on screen than the flat one, and never tilted
 * more than 25° from facing the screen.
 */

export const SCENE_STYLES = `
/* Glass resting in the scene: only while the scene is on. Otherwise its layer is an ordinary box, the components glass in front. */
[data-scene="on"] [data-scene-layer] { position: absolute; inset: 0; perspective-origin: 50% 50%; pointer-events: none; }
[data-scene="on"] [data-scene-anchor] { position: absolute; left: 0; top: 0; margin: 0; transform-origin: 0 0; pointer-events: auto; will-change: transform; }
.scene-anchor { position: relative; display: block; width: max-content; }
/* Its shadow falls away from the sun. (The scene draws the real one on the surface; this is the soft one close under it.) */
[data-scene="on"] .scene-anchor::before { content: ""; position: absolute; inset: 8% 6%; z-index: -1; pointer-events: none; background: rgba(8, 18, 36, 0.3); filter: blur(14px);
  transform: translate(calc(var(--light-x, 0) * -18px), calc(var(--light-y, 1) * 18px)); }
`;

export const SCENE_ANCHOR_SCRIPT = `/* scene anchors */(function () {
  var TILT_LIMIT = 25 * Math.PI / 180, FACE_MS = 350;
  var anchors = {};
  // The spring, cubic-bezier(.3, 1.2, .4, 1), solved for time.
  function spring(t) {
    var x1 = 0.3, y1 = 1.2, x2 = 0.4, y2 = 1, lo = 0, hi = 1, u = t;
    for (var i = 0; i < 20; i++) { var x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u; if (x < t) lo = u; else hi = u; u = (lo + hi) / 2; }
    return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function length(a) { return Math.sqrt(dot(a, a)); }
  function rotate(v, axis, angle) { // Rodrigues
    var c = Math.cos(angle), s = Math.sin(angle);
    return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
  }
  // A frame: where the box's top left lands (origin) and where its x and y pixel steps go (x, y), in the layer's space.
  function frameOf(m) { return { x: [m[0], m[1], m[2]], y: [m[4], m[5], m[6]], origin: [m[12], m[13], m[14]] }; }
  function matrixOf(f) {
    var z = cross(f.x, f.y), zl = length(z) || 1; z = scale(z, length(f.x) / zl);
    return [f.x[0], f.x[1], f.x[2], 0, f.y[0], f.y[1], f.y[2], 0, z[0], z[1], z[2], 0, f.origin[0], f.origin[1], f.origin[2], 1];
  }
  function at(f, px, py) { return add(f.origin, add(scale(f.x, px), scale(f.y, py))); }
  // Where a point of the layer's space shows on screen, through the layer's perspective (relative to the layer's top left).
  function project(p, view) { var k = view.perspective / Math.max(1, view.perspective - p[2]); return [view.cx + (p[0] - view.cx) * k, view.cy + (p[1] - view.cy) * k]; }
  function screenArea(f, w, h, view) {
    var c = [project(at(f, 0, 0), view), project(at(f, w, 0), view), project(at(f, w, h), view), project(at(f, 0, h), view)], area = 0;
    for (var i = 0; i < 4; i++) { var a = c[i], b = c[(i + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(area) / 2;
  }
  // Grow the frame about the box's centre, keeping the centre where it is.
  function grow(f, w, h, k) { var centre = at(f, w / 2, h / 2), x = scale(f.x, k), y = scale(f.y, k); return { x: x, y: y, origin: sub(centre, add(scale(x, w / 2), scale(y, h / 2))) }; }
  // Never more than 25° from facing the screen: turn the frame back about its centre.
  function limitTilt(f, w, h) {
    var normal = cross(f.x, f.y), nl = length(normal); if (!nl) return f;
    normal = scale(normal, 1 / nl);
    var angle = Math.acos(Math.max(-1, Math.min(1, normal[2])));
    if (angle <= TILT_LIMIT) return f;
    var axis = cross(normal, [0, 0, 1]), al = length(axis);
    axis = al > 1e-6 ? scale(axis, 1 / al) : [1, 0, 0];
    var turn = angle - TILT_LIMIT, centre = at(f, w / 2, h / 2), x = rotate(f.x, axis, turn), y = rotate(f.y, axis, turn);
    return { x: x, y: y, origin: sub(centre, add(scale(x, w / 2), scale(y, h / 2))) };
  }
  function readable(f, w, h, view) {
    f = limitTilt(f, w, h);
    // Never smaller on screen than flat: grow it until it's at least as big (twice over, since perspective isn't linear).
    for (var i = 0; i < 2; i++) { var area = screenArea(f, w, h, view); if (area > 0 && area < w * h) f = grow(f, w, h, Math.sqrt(w * h / area)); }
    return f;
  }
  // Facing you: the flat box, unrotated, at the same place on screen. The layer's z = 0 is the screen itself.
  function facing(f, w, h, view) { var centre = project(at(f, w / 2, h / 2), view); return { x: [1, 0, 0], y: [0, 1, 0], origin: [centre[0] - w / 2, centre[1] - h / 2, 0] }; }
  function blend(a, b, t) { var mix = function (u, v) { return add(u, scale(sub(v, u), t)); }; return { x: mix(a.x, b.x), y: mix(a.y, b.y), origin: mix(a.origin, b.origin) }; }

  function anchorNamed(name) {
    var el = document.querySelector('[data-scene-anchor="' + name + '"]'); if (!el) return null;
    if (anchors[name] && anchors[name].el === el) return anchors[name];
    var anchor = { el: el, rest: null, faceFrom: 0, faceTo: 0, faceAt: 0 };
    function turn(toward) { var now = performance.now(), current = facedBy(anchor, now); anchor.faceFrom = current; anchor.faceTo = toward ? 1 : 0; anchor.faceAt = now; el.classList.toggle("is-facing", toward); }
    el.addEventListener("pointerenter", function () { turn(true); });
    el.addEventListener("pointerleave", function () { if (!el.contains(document.activeElement)) turn(false); });
    el.addEventListener("focusin", function () { turn(true); });
    el.addEventListener("focusout", function (event) { if (!el.contains(event.relatedTarget) && !el.matches(":hover")) turn(false); });
    anchors[name] = anchor;
    return anchor;
  }
  function facedBy(anchor, now) { var t = Math.min(1, (now - anchor.faceAt) / FACE_MS); return anchor.faceFrom + (anchor.faceTo - anchor.faceFrom) * (t >= 1 ? 1 : spring(t)); }
  function viewOf(el) {
    var layer = el.parentElement, perspective = parseFloat(layer.style.perspective) || parseFloat(getComputedStyle(layer).perspective) || 1000;
    return { perspective: perspective, cx: layer.clientWidth / 2, cy: layer.clientHeight / 2 };
  }
  // The rim's bright edge turns toward the sun.
  function lightRim(el, lightX, lightY) {
    el.style.setProperty("--light-x", lightX.toFixed(3)); el.style.setProperty("--light-y", lightY.toFixed(3));
    var x1 = (0.5 - lightX * 0.5).toFixed(3), y1 = (0.5 - lightY * 0.5).toFixed(3), x2 = (0.5 + lightX * 0.5).toFixed(3), y2 = (0.5 + lightY * 0.5).toFixed(3);
    el.querySelectorAll('.edge linearGradient[id$="rim"], .edge linearGradient[id$="bev"]').forEach(function (gradient) {
      gradient.setAttribute("x1", x2); gradient.setAttribute("y1", y1); gradient.setAttribute("x2", x1); gradient.setAttribute("y2", y2);
    });
  }

  window.zaismaScene = {
    place: function (anchorName, placement) {
      if (document.documentElement.getAttribute("data-scene") !== "on") return;
      var anchor = anchorNamed(anchorName); if (!anchor) return;
      var el = anchor.el, w = el.offsetWidth, h = el.offsetHeight, view = viewOf(el);
      el.style.visibility = placement.isVisible ? "" : "hidden";
      lightRim(el, placement.lightX, placement.lightY);
      if (!w || !h) return;
      // While it faces you, the scene moves only where its centre is.
      anchor.rest = readable(frameOf(placement.matrix), w, h, view);
      var faced = facedBy(anchor, performance.now()), frame = faced > 0 ? readable(blend(anchor.rest, facing(anchor.rest, w, h, view), faced), w, h, view) : anchor.rest;
      el.style.transform = "matrix3d(" + matrixOf(frame).map(function (n) { return n.toFixed(5); }).join(",") + ")";
    }
  };
  // Back in front: every anchor returns to its normal place.
  new MutationObserver(function () {
    if (document.documentElement.getAttribute("data-scene") === "on") return;
    document.querySelectorAll("[data-scene-anchor]").forEach(function (el) { el.style.transform = ""; el.style.visibility = ""; el.classList.remove("is-facing"); });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-scene"] });
})();
`;
