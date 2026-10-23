/*
 * Shader backgrounds: a background written as one small function that paints each pixel, given the time and the screen's size.
 * It's the common form (Shadertoy's mainImage), which AI writes well: `void mainImage(out vec4 color, in vec2 pixel)`, with
 * iResolution (pixels), iTime (seconds) and iDark (0 on light, 1 on dark, easing between) to read, and SHADER_HELPERS' noise and
 * motes to call. Zaisma's own background is one, and so are the stand-in games' in the gallery.
 */

/** What every shader may call: hashes, value noise, fractal noise, and soft motes scattered in a grid. */
export const SHADER_HELPERS = `
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }
// Soft particles in a grid of cells: each cell holds at most one, at a random spot, drifting with the grid.
float motes(vec2 p, float size, float chance, float seed) {
  vec2 id = floor(p), f = fract(p) - 0.5; vec2 r = h22(id + seed) - 0.5;
  float on = step(1.0 - chance, h2(id + seed * 1.3));
  float d = length(f - r * 0.7);
  return on * smoothstep(size, 0.0, d);
}
`;

/**
 * Zaisma's own background: a plane of glass facets drifting slowly, a soft light gliding across them, and orange nodes wandering over
 * them on slow curving paths, breathing, their light running along the seams near them. Pearl white on light; graphite lit like
 * moonlight on dark, the nodes glowing. iDark eases between the two, so a change of theme fades.
 */
export const ZAISMA_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; float t = iTime;
  vec2 p = vec2(uv.x * ar, uv.y) * 3.6;
  vec2 g = floor(p), fr = fract(p); float d1 = 8.0, d2 = 8.0; vec2 cid = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o2 = vec2(float(i), float(j)); vec2 h = h22(g + o2);
    vec2 pt = o2 + 0.5 + 0.36 * sin(t * 0.11 + 6.2831 * h);
    vec2 r = pt - fr; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = g + o2; } else if (d < d2) d2 = d;
  }
  vec2 tilt = h22(cid * 1.7) - 0.5;
  vec2 sun = vec2(cos(t * 0.04), sin(t * 0.04));
  float shade = 0.5 + 0.5 * dot(normalize(tilt + 0.001), sun) * length(tilt) * 1.6;
  float sweep = exp(-pow(uv.x * 0.8 + uv.y * 0.5 - (fract(t * 0.025) * 2.4 - 0.4), 2.0) * 24.0);
  float edge = sqrt(d2) - sqrt(d1);
  vec3 orange = vec3(0.969, 0.576, 0.102);
  vec2 P = vec2(uv.x * ar, uv.y); float core = 0.0, glow = 0.0, near = 0.0;
  for (int k = 0; k < 7; k++) {
    float fk = float(k); vec2 hk = h22(vec2(fk * 7.13 + 1.0, fk * 3.71 + 2.0)); float sp = 0.05 + 0.06 * hk.x;
    vec2 c = vec2(ar * (0.5 + 0.38 * sin(t * sp + 6.2831 * hk.y) + 0.1 * sin(t * sp * 2.3 + fk * 1.7)),
                  0.5 + 0.34 * cos(t * sp * 0.83 + 6.2831 * hk.x) + 0.1 * sin(t * sp * 1.9 + fk * 2.9));
    vec2 q = P - c; float dia = abs(q.x) + abs(q.y); float br = 0.6 + 0.4 * sin(t * 0.9 + fk * 1.3);
    core = max(core, smoothstep(0.015, 0.0105, dia));
    glow += exp(-dia * 36.0) * br;
    near += exp(-length(q) * 7.0) * br;
  }
  float seam = 1.0 - smoothstep(0.0, 0.024, edge);
  // Light: pearl-white facets.
  vec3 light = mix(vec3(0.885, 0.905, 0.94), vec3(1.0), shade);
  light += vec3(1.0, 0.97, 0.92) * sweep * 0.05;
  light = mix(light, vec3(1.0), (1.0 - smoothstep(0.0, 0.04, edge)) * 0.75);
  light -= (1.0 - smoothstep(0.0, 0.012, edge)) * 0.045;
  light = mix(light, orange, seam * min(near, 1.0) * 0.4);
  light += orange * glow * 0.28;
  light = mix(light, orange, core);
  light *= 0.975 + 0.04 * uv.y;
  // Dark: graphite facets under a cool sweep, the nodes glowing onto them.
  vec3 dark = mix(vec3(0.062, 0.072, 0.092), vec3(0.135, 0.152, 0.188), shade);
  dark += vec3(0.55, 0.66, 0.9) * sweep * 0.045;
  dark = mix(dark, vec3(0.27, 0.3, 0.36), (1.0 - smoothstep(0.0, 0.03, edge)) * 0.55);
  dark -= (1.0 - smoothstep(0.0, 0.01, edge)) * 0.03;
  dark += orange * min(near, 1.5) * 0.07;
  dark += orange * seam * min(near, 1.0) * 0.85;
  dark += orange * glow * 0.7;
  dark = mix(dark, vec3(1.0, 0.74, 0.34), core);
  dark *= 0.88 + 0.16 * uv.y;
  o = vec4(mix(light, dark, iDark), 1.0);
}`;

/** The gallery's simplest shader: a dusk gradient whose horizon breathes. Four lines. */
export const DUSK_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy;
  float horizon = uv.y + 0.06 * sin(iTime * 0.4 + uv.x * 3.0);
  o = vec4(mix(vec3(0.98, 0.52, 0.3), vec3(0.12, 0.13, 0.34), smoothstep(0.0, 1.0, horizon)), 1.0);
}`;

/** A simple one with noise: soft clouds drifting across a sky. */
export const CLOUDS_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; vec2 p = vec2(uv.x * iResolution.x / iResolution.y, uv.y) * 2.5;
  float clouds = fbm(p + vec2(iTime * 0.04, 0.0) + fbm(p - iTime * 0.02));
  vec3 sky = mix(vec3(0.42, 0.62, 0.9), vec3(0.2, 0.38, 0.75), uv.y);
  o = vec4(mix(sky, vec3(0.97, 0.98, 1.0), smoothstep(0.45, 0.8, clouds)), 1.0);
}`;

/**
 * The stand-in games' backgrounds (STAND_IN_GAMES in panes.ts), each the world its cover shows, as its studio might paint it for a
 * title screen: the complex end of what a shader background can be. They're games' own, so they don't follow Zaisma's look, and like
 * any game's they look the same in light and dark (no iDark: the glass over them adapts instead). Each stays within what Zaisma lets a
 * game's shader cost; the preview sends them to its test games as a game would, with the helpers written in.
 */
/** Ashen Crown: A ruined citadel on a crag against a swollen dying sun, the dusk burning behind it, embers rising and ash falling. */
export const ASHEN_CROWN_SHADER = `
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// Hash and value noise without sin.
float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; return fract(p * (p + p)); }
float hash2(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), e = vec2(1.0, 0.0); f *= f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + e), f.x), mix(hash2(i + e.yx), hash2(i + 1.0), f.x), f.y); }
// A tower: half width w, wall height h, spire height s.
float tower(vec2 q, float w, float h, float s) {
  vec2 r = vec2(abs(q.x), q.y - h - s);
  return min(box(q - vec2(0.0, h * 0.5), vec2(w, h * 0.5)), max(r.x + r.y * (w < 0.03 ? w * 1.2 : w) / s, h - q.y));
}
// The citadel as a distance (q: 0 at its gate).
float citadel(vec2 q) {
  float d = box(q - vec2(-0.015, -0.11), vec2(0.17 - min(q.y, 0.0) * 0.3, 0.17)); // walls battered down the rock
  d = min(d, max(box(q - vec2(-0.015, 0.065), vec2(0.17, 0.006)), (0.25 - abs(fract(q.x * 55.0) - 0.5)) / 55.0)); // crenels
  d = min(d, tower(q - vec2(-0.01, 0.0), 0.06, 0.1, 0.1)); // great hall
  d = min(d, tower(q - vec2(0.025, 0.0), 0.019, 0.29, 0.17)); // the great spire
  d = min(d, tower(q - vec2(-0.062, 0.0), 0.015, 0.21, 0.11));
  d = min(d, tower(q - vec2(0.088, 0.0), 0.014, 0.16, 0.08));
  d = min(d, tower(q - vec2(-0.15, 0.0), 0.012, 0.12, 0.06));
  return min(d, max(box(q - vec2(0.15, 0.07), vec2(0.016, 0.07)), q.y - 0.11 - (q.x - 0.15) * 1.6)); // broken tower
}
// Mountains: a triangular peak per cell, random spot, height and slope.
float peaks(float x, float seed) {
  float c = floor(x), h = 0.0;
  for (int j = 0; j < 2; j++) {
    float id = c + (j == 0 ? 0.0 : sign(fract(x) - 0.5)), a = hash(id + seed * 13.0), b = hash(id * 1.7 + seed * 31.0);
    h = max(h, 0.35 + 0.65 * b * b - abs(x - id - 0.15 - 0.7 * a) * (1.1 + 1.2 * fract(a * 7.0)));
  }
  return h;
}
// Sky without clouds: violet, magenta, crimson, amber horizon hottest under the sun.
vec3 skyAt(vec2 p, vec2 sun, float hor) {
  float y = p.y - hor;
  vec3 c = mix(vec3(1.0, 0.5, 0.2), vec3(0.72, 0.15, 0.17), smoothstep(-0.02, 0.22 + 0.1 * exp(-abs(p.x - sun.x) * 1.2), y));
  c = mix(c, vec3(0.34, 0.07, 0.26), smoothstep(0.15, 0.45, y));
  c = mix(c, vec3(0.08, 0.025, 0.16), smoothstep(0.35, 0.75, y));
  return c + vec3(1.0, 0.42, 0.14) * exp(-length(p - sun) * 4.0) * 0.75;
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y);
  float px = 1.5 / iResolution.y, t = iTime;
  // Focal point: right of centre on wide, upper half on portrait.
  float wide = smoothstep(0.8, 1.4, ar), cs = mix(0.78, 0.95, wide), cx = ar * mix(0.56, 0.68, wide), base = mix(0.55, 0.37, wide), hor = base - 0.02;
  vec2 sun = vec2(cx + 0.015 * cs, base + 0.12 * cs); float sr = 0.17 * cs;
  vec2 d = p - sun; float r = length(d), near = exp(-abs(d.x) * 1.1);
  float fog = vn(vec2(p.x * 2.2 - t * 0.04, uv.y * 8.0));
  vec3 haze = skyAt(vec2(p.x, hor + 0.03), sun, hor);
  // The citadel, black against the sun, two windows still burning.
  vec2 q = (p - vec2(cx, base)) / cs; float fort = 0.0, win = 0.0, man = 0.0, cq = q.x, wq = p.x - cx + 0.46 * cs;
  if (abs(q.x) < 0.29 && q.y < 0.5 && q.y > -0.3) {
    fort = smoothstep(px, -px, citadel(q) * cs);
    win = smoothstep(0.003, 0.0, min(box(q - vec2(0.025, 0.14), vec2(0.0035, 0.01)), box(q - vec2(-0.02, 0.05), vec2(0.005, 0.009))));
  }
  // The wanderer: hooded, cloaked, with a staff, his cloak stirring.
  vec2 w = vec2(wq, p.y - 0.19) / cs;
  if (abs(w.x) < 0.05 && w.y < 0.1) {
    float fd = max(box(w - vec2(sin(t * 1.4 + w.y * 40.0) * 0.003 * (w.y * 16.0 - 1.0), 0.025), vec2(0.008 + (0.05 - w.y) * 0.16, 0.025)), -w.y);
    man = smoothstep(px, -px, min(min(fd, length(w - vec2(0.002, 0.056)) - 0.008), box(w - vec2(0.016, 0.04), vec2(0.0013, 0.04))) * cs);
  }
  // Ridges nearest first, each covering its share of what's still open; then the sky.
  vec3 col = vec3(0.0); float rem = 1.0, air = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i), k = fi / 4.0;
    float x = p.x * mix(2.2, 6.0, k) + fi * 7.3;
    float h = mix(0.0, hor - 0.03, k) + mix(0.13, 0.09, k) * (peaks(x, fi) + 0.3 * peaks(x * 2.7 + 5.0, fi + 2.0)); // peaks on peaks
    if (i == 0) h = max(h, 0.19 - 5.0 * wq * wq); // the wanderer's knoll
    if (i == 2) h = max(h, base + cs * (max(max(-0.11 - 1.3 * abs(cq + 0.13), -0.05 - 1.25 * abs(cq - 0.01)), -0.13 - 1.1 * abs(cq - 0.17)) + 0.04 * peaks(p.x * 20.0, 4.0)));
    float dh = h - uv.y, cover = smoothstep(-px, px, dh);
    float mist = smoothstep(0.0, 0.2, dh) * (1.0 - 2.0 * abs(fract(fog + fi * 0.33) - 0.5));
    vec3 rock = mix(mix(vec3(0.04, 0.015, 0.07), haze, 0.03 + 0.8 * k * k), mix(haze, vec3(0.9, 0.32, 0.3), 0.3), mist * (0.12 + 0.55 * k));
    float rim = clamp(1.0 - dh * 60.0, 0.0, 1.0) * near;
    rock += vec3(1.0, 0.55, 0.25) * rim * rim * (0.75 - 0.5 * k); // rim light
    if (i == 2) {
      rock = mix(rock, vec3(0.04, 0.015, 0.06), smoothstep(0.37, 0.12, abs(cq)) * (1.0 - mist * 0.6)); // the crag, dark against the sun
      rock = mix(rock, vec3(0.035, 0.013, 0.055) + vec3(1.0, 0.55, 0.18) * win, fort * (1.0 - cover)); cover = max(cover, fort);
    }
    if (i == 0) { rock = mix(rock, vec3(0.02, 0.008, 0.03), man * (1.0 - cover)); cover = max(cover, man); }
    col += rem * cover * rock;
    if (i >= 2) air += rem * (1.0 - cover) * 0.3;
    rem *= 1.0 - cover;
    if (rem < 0.002) break;
  }
  if (rem > 0.002) {
    vec3 sky = skyAt(p, sun, hor);
    // Clouds on a ceiling receding to the horizon, burning on the side facing the sun.
    float depth = 1.0 / (uv.y - hor + 0.1);
    vec2 kq = vec2((p.x - sun.x) * depth * 1.3 + t * 0.012, depth * 2.2 - t * 0.01), sq = kq + vec2(-d.x * 0.6, 0.35);
    float c1 = vn(kq) * 0.55 + vn(kq * 2.3 + 5.0) * 0.3 + vn(kq * 5.1 - 2.0) * 0.15;
    float c2 = vn(sq) * 0.6 + vn(sq * 2.3 + 5.0) * 0.4;
    float dens = smoothstep(0.4, 0.66, c1) * smoothstep(hor + 0.06, hor + 0.3, uv.y);
    float lit = clamp((c1 - c2) * 3.5 + 0.3, 0.0, 1.0);
    sky = mix(sky, mix(vec3(0.09, 0.03, 0.13), mix(vec3(0.85, 0.2, 0.2), vec3(1.0, 0.62, 0.3), exp(-r * 2.2)), lit * (0.2 + 0.8 * exp(-r * 1.3))), dens * 0.92);
    // The dying sun: swollen, limb-darkened, veiled, haloed.
    float disc = smoothstep(sr + px, sr - px, r);
    sky = mix(sky, mix(vec3(1.4, 1.1, 0.7), vec3(1.0, 0.3, 0.08), r * r / (sr * sr)), disc * (1.0 - dens * 0.55));
    sky += vec3(1.0, 0.5, 0.2) * exp(-max(r - sr, 0.0) * 16.0) * 0.45 * (1.0 - disc);
    col += rem * sky;
  }
  // Shafts of light through the air over the far ridges.
  float shaft = vn(d / max(r, 1e-4) * 5.0 + t * 0.02);
  col += vec3(1.0, 0.5, 0.22) * smoothstep(0.35, 0.8, shaft) * exp(-r * 2.6) * smoothstep(sr, sr * 1.8, r) * (rem * 0.06 + air);
  // Embers rising, grey ash falling.
  vec2 a = vec2(p.x * 8.0 - t * 0.4 + sin(p.y * 3.0 + t * 0.35) * 0.6, p.y * 8.0 - t * 0.5);
  col += vec3(1.0, 0.48, 0.14) * motes(a, 0.12, 0.4, 0.0) * (0.7 + 0.3 * sin(t * 1.6 + a.y - a.x));
  col += vec3(0.6, 0.5, 0.55) * motes(vec2(p.x * 11.0 - t * 0.5 + sin(p.y * 4.0 + t * 0.5) * 0.4, p.y * 11.0 + t * 0.4), 0.1, 0.3, 5.0) * 0.3;
  // Grade: soft shoulder, edges sinking into violet.
  col = col / (1.0 + col * 0.28);
  vec2 vg = (uv - vec2(0.62, 0.5)) * vec2(0.9, 1.2);
  color = vec4(mix(col, col * vec3(0.45, 0.32, 0.62), clamp(dot(vg, vg) * 0.9, 0.0, 1.0)), 1.0);
}
`;

/** Neon Drift: A rain-slick skyway over a black bay into a towering neon city, light trails streaming both ways. */
export const NEON_DRIFT_SHADER = `
const float CAM = 0.55;  // camera height over the road (a lane is 0.5 wide)
float hs1(float n) { n = fract(n * 0.1031); n *= n + 33.33; return fract(n * (n + n)); }

// The city at q (from the vanishing point), drawn front to back so hidden layers cost nothing; full = 0 for reflections.
vec3 city(vec2 q, float px, float t, float full) {
  vec3 glow = vec3(1.0, 0.26, 0.58), acc = vec3(0.0), add = vec3(0.0);
  float T = 1.0, xs = abs(q.x);
  for (int j = 0; j < 4; j++) {
    if (T < 0.003) break;
    if (j == 2) {
      // The arcology at the road's end: tiers, a needle, a holo ring, a beacon
      if (xs > 0.17) continue;
      float d = min(min(max(xs - 0.07, q.y - 0.17), max(xs - 0.048, q.y - 0.36)), min(max(xs - 0.03, q.y - 0.5), max(xs - 0.004, q.y - 0.6)));
      float m = smoothstep(px, -px, d), w = q.y < 0.17 ? 0.07 : (q.y < 0.36 ? 0.048 : 0.03), fade = smoothstep(0.17, 0.11, xs);
      vec3 tc = vec3(0.07, 0.02, 0.14) + vec3(0.25, 0.9, 1.0) * smoothstep(0.005, 0.0, abs(xs - w + 0.005)) * 0.9;
      tc += vec3(1.0, 0.3, 0.75) * smoothstep(0.55, 0.8, abs(fract(q.y * 24.0) - 0.5) * 2.0) * 0.25 * (1.0 - xs / w * 0.6);
      tc += vec3(1.0, 0.75, 0.95) * smoothstep(0.01, 0.0, min(min(abs(q.y - 0.166), abs(q.y - 0.356)), abs(q.y - 0.496))) * 0.7;
      vec2 e = vec2(q.x / 0.12, (q.y - 0.41) / 0.024);
      float rd = abs(length(e) - 1.0) * 0.024, arc = full > 0.5 ? 0.35 + 0.65 * smoothstep(0.3, 1.0, sin(atan(e.y, e.x) * 3.0 - t * 0.9)) : 0.8;
      add += T * (vec3(0.9, 0.3, 0.8) * exp(-abs(d) / 0.03) * 0.12 * fade + vec3(1.0, 0.1, 0.2) * smoothstep(0.006, 0.0, length(q - vec2(0.0, 0.605))) * (0.6 + 0.4 * sin(t * 3.0))
        + vec3(0.3, 1.0, 0.95) * (smoothstep(px * 2.0, 0.0, rd) * arc * (e.y < 0.0 ? 1.0 : 1.0 - m * 0.8) + exp(-rd / 0.012) * 0.12 * fade));
      acc += T * m * mix(tc, glow * 0.8, smoothstep(0.15, 0.0, q.y) * 0.6); T *= 1.0 - m;
      continue;
    }
    // Towers, near to far, rising toward the edges like a canyon (reflections skip the farthest)
    float fi = j == 0 ? 2.0 : (j == 1 ? 1.0 : 0.0);
    if (q.y > 0.33 + fi * 0.14 + xs * (0.06 + fi * 0.22) || (full < 0.5 && j == 3)) continue;
    float sc = 16.0 - fi * 5.0, off = fi * 7.31, cx = q.x * sc + off, id = floor(cx), fx = fract(cx) - 0.5;
    float r = hs1(id + fi * 13.7), r2 = fract(r * 13.1 + 0.3), wid = 0.3 + 0.14 * r2;
    float top = 0.04 + fi * 0.04 + (0.07 + fi * 0.06) * r + abs(id + 0.5 - off) / sc * (0.06 + fi * 0.22);
    float m = smoothstep(px, -px, min(max((abs(fx) - wid) / sc, q.y - top), max((abs(fx) - wid * 0.6) / sc, q.y - top - (0.015 + 0.03 * r) * step(0.5, r2))));
    vec3 bc = mix(mix(vec3(0.42, 0.1, 0.42), vec3(0.03, 0.01, 0.07), 0.4 + fi * 0.28), glow * 0.75, smoothstep(0.14, 0.0, q.y) * (0.75 - fi * 0.2));
    vec3 nc = mix(vec3(1.0, 0.2, 0.7), vec3(0.2, 0.95, 1.0), step(0.7, r));
    // Neon signs: strips or bands, tubes brightest at the rim
    float band = step(0.8, r2), on = step(0.45, r) * step(0.5, fi);
    float sd = max((abs(fx - (r - 0.5) * wid * (1.0 - band)) - mix(0.05, 0.3, band)) / sc, abs(q.y - top * (0.35 + 0.3 * r2)) - top * mix(0.18, 0.05, band));
    if (fi > 0.5 && m > 0.0) {
      bc += mix(glow, nc, 0.5) * smoothstep(px * 2.0, 0.0, (fx * sign(-q.x) + wid) / sc) * 0.35 + nc * smoothstep(px, -px, sd) * (0.45 + 0.55 * smoothstep(-0.006, -0.001, sd)) * on;
      if (full > 0.5) {
        // Strips of lit windows; crown lights on the roof
        vec2 wc = vec2(fx * 6.0, q.y * sc * 8.0); float wh = h2(floor(wc) + id * 3.1);
        float lit = step(0.62, wh) * smoothstep(0.5, 0.3, abs(fract(wc.y) - 0.5)) * smoothstep(0.5, 0.42, abs(fract(wc.x) - 0.5)) * step(abs(fx), wid - 0.04);
        bc += mix(vec3(1.0, 0.55, 0.8), vec3(0.4, 0.85, 1.0), step(0.85, wh)) * lit * (0.04 + fi * 0.06) + nc * smoothstep(0.005, 0.0, abs(q.y - top + 0.004)) * step(abs(fx), wid) * 0.5;
      }
    }
    add += T * nc * exp(-max(sd, 0.0) * 160.0) * on * 0.25 * (1.0 - m * 0.5);
    acc += T * m * bc; T *= 1.0 - m;
  }
  if (T > 0.003) {
    // Sky: the city's glow under violet night, smog lit from below
    vec3 col = mix(mix(glow, vec3(0.3, 0.06, 0.44), smoothstep(0.0, 0.28, q.y)), vec3(0.035, 0.012, 0.09), smoothstep(0.22, 0.85, q.y));
    col += vec3(1.0, 0.55, 0.8) * exp(-length(vec2(q.x * 0.5, q.y)) * 8.0) * 0.45;
    float c = noise(vec2(q.x * 2.0 + t * 0.012, q.y * 6.0)) * 0.65 + 0.17;
    if (full > 0.5) c += noise(vec2(q.x * 5.5 - t * 0.03, q.y * 15.0)) * 0.35 - 0.17;
    acc += T * (col + mix(vec3(0.85, 0.18, 0.6), vec3(0.35, 0.1, 0.55), smoothstep(0.0, 0.5, q.y)) * smoothstep(0.35, 0.85, c) * (smoothstep(1.1, 0.05, q.y) * 0.75 + 0.12));
  }
  return acc + add;
}

// Street lamps along both barriers; reflections pass the mirrored point.
float lamps(vec2 q, float px) {
  float dx = abs(q.x), zn = max(floor(0.36 / max(dx, 0.001) + 0.5), 1.0) * 3.0;
  float d = length(vec2(dx, q.y) - vec2(1.08, 1.05 - CAM) / zn), size = max(0.05 / zn, px);
  return (smoothstep(size, 0.0, d) + exp(-d / (size * 3.0)) * 0.35) * smoothstep(60.0, 20.0, zn);
}

void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y, t = iTime, wide = clamp((ar - 0.6) / 1.0, 0.0, 1.0);
  float hz = mix(0.5, 0.4, wide), s = mix(0.8, 1.0, wide), px = 1.5 / iResolution.y / s;
  vec2 q = (vec2(uv.x * ar, uv.y) - vec2(ar * mix(0.5, 0.6, wide), hz)) / s;  // scene units from the vanishing point
  vec3 col;
  if (q.y > 0.0) col = city(q, px, t, 1.0);
  else {
    // The deck (depth z, lateral X) and the bay beyond mirror the city, stretched and rippled by rain
    float z = CAM / -q.y, X = q.x * z, bay = step(1.08, abs(X));
    float rip = (noise(vec2(mix(X * 3.0, q.x * 40.0, bay), z * 1.5 - t * 0.6)) - 0.5) * mix(0.012 / (1.0 + z * 0.1), 0.007, bay);
    vec2 m = vec2(q.x + rip, -q.y * mix(0.4, 0.9, bay));
    vec3 refl = city(m, px * 2.0, t, 0.0) + vec3(0.9, 0.85, 1.0) * lamps(m, px * 3.0);
    vec3 road = vec3(0.02, 0.01, 0.04) + refl * (0.3 + 0.45 * smoothstep(1.5, 12.0, z));
    if (bay < 0.5) {
      // Lane dashes, fading with distance
      road += vec3(0.6, 0.5, 0.7) * smoothstep(px + 0.01 / z, 0.01 / z - px, abs(fract(X * 2.0 + 0.5) - 0.5) / 2.0 / z) * step(0.55, fract(z * 0.35)) * step(abs(X), 0.75) * 0.3 * smoothstep(25.0, 4.0, z);
      // Light trails: headlights coming on the left, tail lights going on the right, a pair of lamps per car
      for (int k = 0; k < 4; k++) {
        float fk = float(k), xc = -0.75 + fk * 0.5, away = step(1.5, fk), w = 0.022 / z, wd = max(w, px * 0.5), dl = abs(abs(X - xc) - 0.07) / z;
        float u = z * 0.11 + (1.0 - 2.0 * away) * t * (0.3 + 0.06 * fk) + fk * 0.37, ph = mix(fract(u), 1.0 - fract(u), away);
        float comet = smoothstep(0.0, 0.025, ph) * pow(max(1.0 - ph / (0.25 + 0.5 * hs1(floor(u) + fk * 7.0)), 0.0), 1.5);
        vec3 tc = mix(vec3(0.7, 0.97, 1.0), vec3(1.0, 0.12, 0.42), away);
        road += tc * (0.1 + 2.4 * comet) * min(1.0, w / wd) * (smoothstep(wd + px, wd - px, dl) + exp(-dl / (wd * 4.0 + 0.003)) * 0.3);
        road += mix(tc, vec3(1.0), 0.4) * smoothstep(0.0, 0.05, ph) * exp(-ph * 10.0) * exp(-abs(X - xc) / z / (w * 8.0 + 0.008)) * 0.25;
      }
    } else {
      // Barriers with an LED strip, the drop to the bay beyond
      float zb = 1.08 / max(abs(q.x), 0.001);
      road = q.y > -CAM / zb ? vec3(0.06, 0.025, 0.1) + refl * 0.06 : vec3(0.008, 0.004, 0.025) + refl * 0.8;
      road += vec3(0.3, 0.95, 1.0) * smoothstep(px * 1.5 + 0.008 / zb, 0.0, abs(q.y + (CAM - 0.14) / zb)) * 0.9;
    }
    col = mix(road, vec3(0.85, 0.25, 0.55), mix((1.0 - exp(-z * 0.035)) * 0.8, exp(q.y * 40.0) * 0.5, bay));
  }
  col += vec3(0.85, 0.8, 1.0) * lamps(q, px);
  // Rain: two layers of long slanted streaks
  for (int j = 0; j < 2; j++) {
    float fj = float(j), sc = 22.0 + fj * 16.0;
    vec2 r = vec2((uv.x * ar + uv.y * 0.12) * sc, uv.y * sc * 0.05 + t * (1.6 + fj * 0.6));
    float rr = hs1(floor(r.x) + fj * 9.0), drop = fract(r.y + rr * 7.0);
    col += vec3(0.6, 0.75, 1.0) * smoothstep(0.0, 0.04, drop) * smoothstep(0.45, 0.04, drop) * step(0.4, rr) * smoothstep(0.14, 0.04, abs(fract(r.x) - 0.5 - (rr - 0.5) * 0.6)) * (0.1 + fj * 0.06);
  }
  // Grade: violet blacks, vignette
  col = col / (1.0 + col * 0.35) + vec3(0.012, 0.0, 0.03);
  color = vec4(col * (1.0 - 0.3 * pow(length(uv - 0.5) * 1.2, 2.0)), 1.0);
}
`;

/** Hollow Tide: At the waterline: a lighthouse sweeps the sea fog under the moon, and below, the drowned drift past something vast. */
export const HOLLOW_TIDE_SHADER = `
float sat(float x) { return clamp(x, 0.0, 1.0); }
float fill(float d, float e) { return smoothstep(e, -e, d); }
// Distance to a capsule from a to b.
float seg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * sat(dot(pa, ba) / dot(ba, ba))) - r;
}
// A lamp beam at angle a around the tower (0 = right, pi/2 = toward us).
float beam(vec2 q, float a) {
  float c = cos(a), u = q.x * sign(c), w = 0.005 + max(u, 0.0) * (0.48 - 0.4 * abs(c)), y = q.y + u * 0.035;
  return exp(-y * y / (w * w) - max(u, 0.0) / (0.06 + 1.4 * abs(c))) * smoothstep(-0.004, 0.012, u) * (0.5 + 0.4 * sin(a));
}
void mainImage(out vec4 color, in vec2 pixel) {
  float ar = iResolution.x / iResolution.y, wide = smoothstep(0.7, 1.5, ar), px = 1.5 / iResolution.y, t = iTime;
  vec2 p = pixel / iResolution.y;
  float wl0 = mix(0.6, 0.46, wide);                                 // the waterline, rolling
  float wl = wl0 + 0.011 * sin(p.x * 5.0 - t * 0.9) + 0.005 * sin(p.x * 13.0 + t * 1.3) + 0.0025 * sin(p.x * 29.0 - t * 2.1);
  vec2 moon = vec2(mix(0.26, 0.42, wide) * ar, mix(0.91, 0.69, wide));
  float lx = mix(0.68, 0.7, wide) * ar, rx = p.x - lx, dm = length(p - moon), top = wl0 + mix(0.21, 0.22, wide);
  vec2 lamp = vec2(lx, top + 0.016);
  float fogN = noise(vec2(p.x * 2.2 - t * 0.045, p.y * 6.0 + sin(p.x * 1.3 + t * 0.03))) * 0.6 + noise(vec2(p.x * 5.0 - t * 0.085, p.y * 13.0)) * 0.4;
  vec3 col;
  if (p.y > wl) {
    // Sky: teal haze into green-black, halo, slow stars, cloud streaks, the moon.
    float k = sat((p.y - wl0) / (1.0 - wl0));
    col = mix(vec3(0.08, 0.27, 0.27), vec3(0.008, 0.035, 0.045), pow(k, 0.6)) + vec3(0.12, 0.22, 0.21) * exp(-dm * 3.5) + vec3(0.36, 0.42, 0.4) * (exp(-dm * 16.0) + exp(-dm * 45.0));
    vec2 sg = p * 70.0;
    col += vec3(0.8, 0.95, 0.95) * motes(sg, 0.13, 0.08, 3.0) * (0.6 + 0.4 * sin(t * 1.1 + h2(floor(sg)) * 40.0)) * smoothstep(0.2, 0.5, k) * smoothstep(0.12, 0.3, dm);
    col = mix(col, vec3(0.08, 0.17, 0.18) + vec3(0.6, 0.72, 0.68) * exp(-dm * 4.5), smoothstep(0.5, 0.8, fogN) * smoothstep(1.0, 0.7, p.y) * smoothstep(wl0 + 0.1, wl0 + 0.2, p.y) * 0.6);
    vec2 mq = (p - moon) / 0.046;
    col = mix(col, vec3(0.95, 0.97, 0.9) - 0.09 * smoothstep(0.45, 0.75, noise(mq * 2.2 + 3.0)) - 0.05 * dot(mq, mq), fill(dm - 0.046, px));
    // The crag, moon-rimmed; the banded tower, gallery, roof and lamp.
    float sh = sat(1.0 - pow(rx / (0.115 * mix(0.8, 1.0, wide)), 2.0)), rockTop = wl0 + sh * (0.045 + 0.022 * abs(sin(rx * 30.0 + 1.0)) + 0.006 * sin(rx * 97.0));
    col = mix(col, vec3(0.01, 0.022, 0.026) + vec3(0.12, 0.2, 0.19) * smoothstep(0.012, 0.0, rockTop - p.y) * sat(0.5 - rx * 8.0), fill(p.y - rockTop, px) * step(0.001, sh));
    float ty = (p.y - wl0 - 0.048) / (top - wl0 - 0.048), hw = mix(0.018, 0.011, ty);
    col = mix(col, mix(vec3(0.07, 0.11, 0.11), vec3(0.015, 0.03, 0.035), sat((rx + hw) / hw)) * (0.75 + 0.25 * step(0.5, fract(ty * 3.0))), fill(abs(rx) - hw, px) * step(0.0, ty) * step(ty, 1.0));
    float roof = max(fill(abs(rx) - 0.02, px) * fill(abs(p.y - top - 0.003) - 0.003, px), fill(abs(rx) - 0.012 * sat((top + 0.04 - p.y) / 0.015), px) * step(top + 0.025, p.y) * step(p.y, top + 0.04));
    col = mix(mix(col, vec3(0.02, 0.035, 0.04), roof), vec3(1.0, 0.96, 0.82), fill(abs(rx) - 0.01, px) * fill(abs(p.y - top - 0.016) - 0.009, px));
    // A fog bank with a billowing, moonlit top, and a thinner layer at lamp height.
    float bankTop = wl0 + 0.05 + 0.035 * noise(vec2(p.x * 2.4 - t * 0.035, 4.0)) + 0.03 * (fogN - 0.5);
    float fog = sat(smoothstep(-0.02, 0.05, bankTop - p.y) * (0.2 + 0.8 * fogN) + exp(-pow((p.y - lamp.y) / 0.08, 2.0)) * smoothstep(0.35, 0.85, fogN) * 0.55);
    col = mix(col, vec3(0.16, 0.27, 0.27) + vec3(0.3, 0.36, 0.33) * exp(-dm * 2.2) + vec3(0.1, 0.14, 0.13) * smoothstep(0.03, 0.0, abs(bankTop - p.y)), fog * 0.6);
    // Two beams turning once in 32 s, bright in the fog; the glare swells slowly as one faces us.
    float a = mod(t, 32.0) * 0.19635;
    vec2 q = p - lamp;
    float dl = length(q * vec2(1.0, 1.6));
    col += vec3(0.85, 0.95, 0.88) * (beam(q, a) + beam(q, a + 3.1416)) * (0.35 + 1.3 * fog + 0.3 * fogN) + vec3(1.0, 0.95, 0.82) * (exp(-dl * 60.0) * 0.8 + exp(-dl * 14.0) * (0.12 + 0.35 * pow(abs(sin(a)), 6.0)));
  } else {
    // Under water: green-teal into black, the moon's window, slanting shafts.
    float dd = wl - p.y, sx = p.x - dd * 0.32;
    vec3 water = mix(vec3(0.05, 0.21, 0.2), vec3(0.002, 0.012, 0.015), sat(pow(dd / wl0, 0.6)));
    float rays = smoothstep(0.5, 0.85, noise(vec2(sx * 9.0, t * 0.12)) * 0.6 + noise(vec2(sx * 21.0, t * 0.2 + 4.0)) * 0.4) * exp(-dd * 3.5) * (0.35 + 0.65 * exp(-pow((sx - moon.x) / 0.55, 2.0)));
    col = water + vec3(0.14, 0.25, 0.22) * exp(-pow((sx - moon.x) / (0.14 + dd * 0.3), 2.0) - dd * 3.0) + vec3(0.16, 0.34, 0.3) * rays;
    // Far sea stacks in the gloom, marine snow.
    col = mix(col, vec3(0.01, 0.04, 0.045), fill(p.y - 0.16 - 0.09 * sat(sin(p.x * 3.1 + 0.6)) - 0.012 * sin(p.x * 17.0) + 0.12 * smoothstep(0.35, 0.6, p.x / ar), px) * 0.6);
    col += vec3(0.16, 0.23, 0.21) * motes(p * 42.0 + vec2(sin(t * 0.2) * 0.5, t * 0.12), 0.13, 0.15, 7.0) * exp(-dd * 1.5);
    // The leviathan behind the rock: ridged, rim-lit back, a slow wave running through its green lights.
    float bx = p.x / ar, dy = p.y - mix(0.36, 0.125, wide) - 0.045 * sin(bx * 5.0 + t * 0.12) - 0.02 * sin(bx * 11.0 - t * 0.09);
    float thick = 0.014 + 0.075 * smoothstep(0.0, 0.9, bx), ridge = 0.02 * pow(abs(sin(p.x * 24.0)), 5.0) * smoothstep(0.05, 0.3, bx);
    float body = fill(max(-dy - thick, dy - thick - ridge), px * 2.0);
    col = mix(col, mix(vec3(0.005, 0.018, 0.02) + vec3(0.1, 0.24, 0.22) * smoothstep(thick * 0.4, thick + ridge, dy) * (0.35 + rays * 1.5) * exp(-dd * 1.5), water, 0.4), body);
    vec2 lc = vec2(fract(p.x * 17.0) - 0.5, (dy + thick * 0.25) / (thick * 0.15 + 0.002));
    col += vec3(0.005, 0.03, 0.017) * exp(-abs(dy) / (thick * 2.5)) + vec3(0.32, 0.8, 0.5) * exp(-lc.x * lc.x * 40.0 - lc.y * lc.y) * body * (0.3 + 0.7 * pow(0.5 + 0.5 * sin(p.x * 5.0 - t * 0.7), 3.0));
    // The drowned one: head bowed, hair and coat drifting, arms afloat.
    float fs = mix(0.15, 0.155, wide);
    vec2 fq = (p - vec2(mix(0.3, 0.44, wide) * ar + 0.004 * sin(t * 0.4), wl0 - 0.03 - fs)) / fs;
    fq.x += (fq.y - 0.5) * 0.05 * sin(t * 0.33);
    if (abs(fq.x) < 0.4 && fq.y > -0.1 && fq.y < 1.12) {
      float l = 0.025 * sin(t * 0.5), cy = sat((0.62 - fq.y) / 0.34);
      float fd = min(length(fq - vec2(0.045, 0.85)) - 0.068, length((fq - vec2(0.02 + l * 0.5, 0.92)) / vec2(1.3, 0.8)) - 0.06);
      fd = min(fd, max(abs(fq.x - 0.03 * cy * sin(t * 0.4)) - mix(0.075, 0.15, cy), max(fq.y - 0.77, 0.28 + 0.025 * sin(fq.x * 40.0 + t * 0.8) - fq.y)));
      fd = min(fd, min(seg(fq, vec2(-0.07, 0.72), vec2(-0.2, 0.52 + l), 0.027), seg(fq, vec2(0.07, 0.72), vec2(0.19, 0.5 - l), 0.027)));
      fd = min(fd, min(seg(fq, vec2(-0.035, 0.32), vec2(-0.045, 0.02), 0.034), seg(fq, vec2(0.035, 0.32), vec2(0.07, 0.05 + l), 0.034)));
      col = mix(col, mix(vec3(0.008, 0.025, 0.03) + vec3(0.14, 0.3, 0.27) * smoothstep(0.55, 1.05, fq.y) * (0.5 + rays), water, 0.18), fill(fd, px / fs));
    }
    // The rock as a sea stack of ledges, moonlit on its left.
    float lv = p.y * 9.0 + 0.3, ls = lv + step(p.x, lx) * 0.5, cx = lx + 0.012 * sin(p.y * 7.0), strata = noise(vec2(p.x * 16.0, p.y * 42.0));
    float ex = abs(p.x - cx) - (0.085 + 0.05 * smoothstep(wl0, 0.0, p.y) + 0.028 * abs(fract(ls) - 0.5) * 2.0 + 0.012 * (h1(floor(ls)) - 0.5) + 0.006 * sin(p.y * 57.0)) * mix(0.72, 1.0, wide);
    float face = smoothstep(0.035, 0.0, -ex) * step(p.x, cx) * (0.6 + 0.6 * strata) + 0.5 * smoothstep(0.45, 0.6, fract(lv)) * strata;
    col = mix(col, mix(vec3(0.005, 0.016, 0.02) + vec3(0.1, 0.24, 0.21) * face * (0.5 + rays) * exp(-dd * 2.0), water, sat(dd * 0.9) * 0.55), fill(ex, px));
    col += vec3(0.16, 0.28, 0.26) * exp(-dd * 60.0) * smoothstep(0.0, px * 2.0, dd);
  }
  // The meniscus, brightest under the moon; vignette.
  col += vec3(0.6, 0.85, 0.8) * smoothstep(px * 3.0, 0.0, abs(p.y - wl)) * (0.3 + 0.5 * exp(-pow((p.x - moon.x) / 0.15, 2.0)));
  vec2 v = pixel / iResolution.xy - 0.5;
  col *= 1.0 - 0.45 * dot(v, v);
  color = vec4(col / (1.0 + col * 0.25), 1.0);
}
`;

/** Verdant: A colossal tree on its hill, the sun behind its crown pouring light over forests fading into golden haze. */
export const VERDANT_SHADER = `
float sat(float x) { return clamp(x, 0.0, 1.0); }
float fill(float d, float e) { return smoothstep(e, -e, d); }
float seg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * sat(dot(pa, ba) / dot(ba, ba))) - r;
}
float crest(float x) { return 0.12 + 0.03 * sin(x * 2.3 + 1.0) + 0.01 * sin(x * 7.0); }
// A row of tiered pines on ground at h. x: distance (about), y: side of the pine (-1 left, 1 right).
vec2 pines(vec2 p, float h, float s, float seed) {
  float r = h1(floor(p.x / s) + seed), ox = fract(p.x / s) - 0.5 + (r - 0.5) * 0.15;
  float th = s * (1.3 + 1.9 * r) * step(0.15, r), v = (p.y - h) / max(th, 0.0001), tier = fract(v * 3.5 + 0.3);
  float hw = s * 0.5 * (1.0 - v) * (0.74 + 0.26 * smoothstep(0.0, 0.25, tier) * (1.0 - tier));
  float pine = th > 0.0 ? max(abs(ox) * s - hw, max(-v, v - 1.0) * th) : 1.0;
  return vec2(min(p.y - h, pine), pine < p.y - h ? ox * s / max(hw, 0.0001) : 0.0);
}
// One leafy dome of the crown: keeps the nearest edge, blends in its normal (the highest dome weighs most).
void dome(vec2 q, vec2 c, float rad, float lift, inout float sd, inout vec3 nsum) {
  vec2 e = q - c;
  float z = rad * rad - dot(e, e), w = z / (rad * rad);
  sd = min(sd, -z / (2.0 * rad));
  if (z > 0.0) nsum += w * w * lift * vec3(e, sqrt(z)) / rad;
}
// One ridge (fi 0 far .. 3 near): two staggered pine rows on a rolling hill, faded into haze, mist at its foot.
vec3 ridge(vec3 col, vec2 p, float fi, float gy, float wide, float px, float mistN) {
  float depth = fi / 3.0, base = gy + 0.01 - fi * mix(0.095, 0.075, wide), s = (0.011 + fi * 0.012) * mix(0.75, 1.0, wide);
  float h = base + (0.02 + fi * 0.013) * (sin(p.x * 1.7 + fi * 7.3) * 0.6 + sin(p.x * 4.3 + fi * 14.6) * 0.4);
  vec2 ra = pines(p, h, s, fi * 7.3 + 1.0), rb = pines(p, h - s * 0.9, s * 0.83, fi * 7.3 + 4.2);
  if (rb.x < ra.x) ra = rb;
  vec3 haze = vec3(0.97, 0.93, 0.72), lc = mix(vec3(0.85, 0.89, 0.68), vec3(0.54, 0.73, 0.37), depth);
  lc = mix(lc, lc * vec3(0.82, 0.92, 0.95), smoothstep(0.2, -0.8, ra.y) * depth);   // far side in shade
  lc += vec3(1.0, 0.82, 0.4) * (smoothstep(0.3, 0.95, ra.y) * 0.25 * depth + smoothstep(0.003 + fi * 0.002, 0.0, -ra.x) * (0.06 + 0.1 * depth) * (0.4 + mistN));
  lc = mix(lc, haze, smoothstep(0.02, 0.14, -ra.x) * (0.35 + 0.3 * mistN) * (1.0 - depth * 0.7));
  col = mix(col, lc, fill(ra.x, px));
  return mix(col, haze, smoothstep(0.09, 0.0, abs(p.y - base + 0.04)) * smoothstep(0.3, 0.8, mistN) * 0.35 * (1.0 - depth * 0.6));
}
void mainImage(out vec4 color, in vec2 pixel) {
  float ar = iResolution.x / iResolution.y, wide = smoothstep(0.7, 1.5, ar), px = 1.5 / iResolution.y, t = iTime;
  vec2 p = pixel / iResolution.y;
  float S = min(0.7, ar * 1.15), tx = mix(0.5, 0.64, wide) * ar, gy = mix(0.5, 0.345, wide);   // tree size, place, ground
  vec2 q = (p - vec2(tx, gy)) / S, ds = p - vec2(tx + 0.05 * S, gy + 0.37 * S);
  float r = length(ds), tree = 0.0;
  // Sky: jade into gold, a bloom behind the crown, god rays sampled on the circle of directions (no seam).
  vec3 col = mix(vec3(1.0, 0.9, 0.62), vec3(0.64, 0.83, 0.7), smoothstep(gy - 0.1, 1.0, p.y)) + vec3(1.0, 0.82, 0.45) * exp(-r * 2.6) * 0.35 + vec3(1.0, 0.95, 0.8) * exp(-r * 8.0) * 0.35;
  vec2 dir = ds / (r + 0.0001);
  float rays = smoothstep(0.4, 0.85, noise(dir * 7.0 + t * 0.012) * (0.8 + 0.2 * sin(dir.x * 37.0 - dir.y * 23.0))) * exp(-r * 1.3);
  float mistN = noise(vec2(p.x * 3.0 - t * 0.03, p.y * 12.0 + sin(p.x * 2.0 + t * 0.05)));
  vec3 haze = vec3(0.97, 0.93, 0.72);
  // Ridges far to near; the tree stands between the second and third.
  if (p.y < gy + 0.12) for (int i = 0; i < 2; i++) col = ridge(col, p, float(i), gy, wide, px, mistN);
  if (abs(q.x) < 0.9 && q.y < 0.02) {
    // The tree's own hill.
    float hill = gy - 0.13 * S * (1.0 - exp(-q.x * q.x * 5.0)) + 0.004 * sin(q.x * 40.0) - p.y;
    col = mix(col, vec3(0.69, 0.81, 0.51) + vec3(1.0, 0.85, 0.45) * smoothstep(0.006, 0.0, hill) * 0.3, fill(-hill, px));
  }
  if (abs(q.x) < 0.45 && q.y > -0.03 && q.y < 0.57) {
    // Flared roots, a gnarled trunk and great limbs.
    float td = max(abs(q.x - 0.012 * sin(q.y * 14.0)) - 0.032 - 0.075 * exp(-q.y * 16.0) + 0.004 * sin(q.y * 70.0 + q.x * 30.0), q.y - 0.3);
    td = min(min(td, seg(q, vec2(0.0, 0.16), vec2(-0.16, 0.29), 0.02)), seg(q, vec2(0.005, 0.18), vec2(0.15, 0.3), 0.018));
    td = max(min(td, seg(vec2(abs(q.x), q.y), vec2(0.02, 0.02), vec2(0.145, -0.012), 0.012)), -q.y - 0.008);
    vec3 bark = mix(vec3(0.36, 0.4, 0.26), vec3(0.5, 0.52, 0.34), 0.5 + 0.5 * sin(q.x * 160.0 + q.y * 20.0)) + vec3(0.35, 0.28, 0.14) * smoothstep(0.02, 0.0, abs(td)) * step(0.0, q.x);
    col = mix(col, mix(bark, haze, 0.2), fill(td, px / S));
    // The crown, swaying: leafy domes (outer arc, middle row, heart), backlit, glowing at thin edges, sun breaking through.
    vec2 c = q + vec2(0.003 * sin(t * 0.6 + q.y * 4.0) * smoothstep(0.15, 0.4, q.y), 0.0), cs = vec2(1.0, 0.0);
    float leafN = noise(mat2(0.8, -0.6, 0.6, 0.8) * c * 30.0 + 5.0) * 0.6 + noise(mat2(0.6, 0.8, -0.8, 0.6) * c * 66.0) * 0.4, sd = 1.0;
    vec3 nsum = vec3(0.0, 0.0, 0.000001);
    for (int k = 0; k < 7; k++) { dome(c, vec2(cs.x * 0.29, 0.31 + cs.y * 0.12), 0.09 + 0.025 * fract(float(k) * 0.618 + 0.3), 1.0, sd, nsum); cs = mat2(0.866, 0.5, -0.5, 0.866) * cs; }
    cs = vec2(0.866, 0.5);
    for (int k = 0; k < 3; k++) { dome(c, vec2(cs.x * 0.19, 0.27 + cs.y * 0.08), 0.11 + 0.02 * float(k - 1) * float(k - 1), 3.0, sd, nsum); cs = mat2(0.5, 0.866, -0.866, 0.5) * cs; }
    dome(c, vec2(0.0, 0.28), 0.12, 9.0, sd, nsum);
    vec3 nrm = normalize(nsum);
    float rim = smoothstep(-0.035, 0.0, sd), toSun = sat(dot(normalize(nrm.xy + 0.0001), vec2(0.45, 0.9)));
    vec3 lv = mix(vec3(0.47, 0.64, 0.44), vec3(0.72, 0.84, 0.4), sat(0.4 + 0.6 * nrm.y) * smoothstep(0.15, 0.95, leafN)) * (0.8 + 0.2 * smoothstep(0.05, 0.6, nrm.z));
    lv += vec3(1.0, 0.85, 0.4) * (rim * rim * (0.32 + 0.48 * toSun) + toSun * toSun * (1.0 - nrm.z) * smoothstep(0.4, 0.7, leafN) * 0.5);
    lv += vec3(1.2, 1.08, 0.66) * smoothstep(0.66, 0.8, leafN) * exp(-length(c - vec2(0.05, 0.36)) * 5.0);
    tree = fill(sd + (leafN - 0.5) * 0.03, px / S);
    col = mix(col, mix(lv, haze, 0.1), tree);
  }
  if (p.y < gy + 0.02) for (int i = 2; i < 4; i++) col = ridge(col, p, float(i), gy, wide, px, mistN);
  // The near crest, and the wanderer on it, cloak stirring.
  float nd = p.y - crest(p.x) - 0.007 * (1.0 - abs(fract(p.x * 110.0) * 2.0 - 1.0)) * h1(floor(p.x * 110.0));
  col = mix(col, mix(vec3(0.6, 0.75, 0.4), vec3(0.55, 0.71, 0.37), smoothstep(0.1, 0.0, p.y)) + vec3(0.18, 0.16, 0.08) * smoothstep(0.01, 0.0, -nd), fill(nd, px));
  float wx = mix(0.3, 0.4, wide) * ar;
  vec2 w = (p - vec2(wx, crest(wx) - 0.004)) / 0.08;
  float fig = min(length(w - vec2(0.0, 0.86)) - 0.1, max(abs(w.x + 0.1 * (w.y - 0.8) + 0.04 * sin(t * 1.2 + w.y * 6.0) * (0.8 - w.y)) - 0.05 - 0.2 * (0.8 - w.y), max(w.y - 0.8, -w.y)));
  fig = min(fig, max(abs(w.x - 0.3 + w.y * 0.06) - 0.025, max(w.y - 1.1, -w.y)));
  col = mix(col, vec3(0.13, 0.2, 0.12) + vec3(0.24, 0.21, 0.1) * smoothstep(-0.05, 0.0, fig) * step(0.0, w.x), fill(fig, px / 0.08));
  // Tall grass framing the lower corners, swaying.
  float gx = p.x * 32.0, gc = floor(gx), hb = (0.04 + 0.08 * h1(gc)) * (smoothstep(0.3, 0.0, p.x / ar) + smoothstep(0.72, 1.0, p.x / ar)), yb = p.y / max(hb, 0.001);
  col = mix(col, vec3(0.47, 0.64, 0.32) + vec3(0.25, 0.21, 0.1) * smoothstep(0.6, 1.0, yb), fill((abs(fract(gx) - 0.5 - (0.25 + 0.12 * sin(t * 0.7 + gc * 0.9)) * yb * yb) - 0.32 * (1.0 - yb)) / 32.0, px) * step(yb, 1.0));
  // God rays (not over the crown), pollen, fireflies.
  col += vec3(1.0, 0.9, 0.6) * rays * (1.0 - tree) * 0.32;
  col += vec3(1.0, 0.93, 0.62) * motes(p * 18.0 + vec2(t * 0.05, -t * 0.1), 0.13, 0.12, 1.0) * (0.32 + 0.28 * exp(-r * 2.0));
  col += vec3(0.85, 1.0, 0.4) * motes(p * 26.0 + vec2(sin(t * 0.3) * 0.6, t * 0.04), 0.13, 0.12, 9.0) * (0.5 + 0.5 * sin(t * 1.3 + h2(floor(p * 26.0)) * 30.0)) * smoothstep(0.32, 0.08, p.y);
  vec2 v = pixel / iResolution.xy - 0.5;
  color = vec4(col * (1.0 - 0.3 * dot(v, v)), 1.0);
}
`;

/** Iron Vigil: A colossal walker stands guard against a hazy sun under a planet's ring, dust blowing over the dunes. */
export const IRON_VIGIL_SHADER = `
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
// A digitigrade leg from hip h to ankle a: thigh, knee plate, shin, foot.
float leg(vec2 q, vec2 h, vec2 a) {
  vec2 d = a - h, n = normalize(d); float L = min(length(d), 0.53);
  vec2 k = h + n * L * 0.5 + vec2(n.y, -n.x) * sqrt(0.0729 - L * L * 0.25);
  return min(min(seg(q, h, k, 0.066), seg(q, k, a, 0.045)), min(length(q - k) - 0.072, min(seg(q, a, a - vec2(0.06, 0.08), 0.03), box(q - a + vec2(0.035, 0.088), vec2(0.08, 0.016)) - 0.005)));
}
// The walker, 1 tall, feet at 0, facing left: wedge hull, shoulder plate, cannon arm, missile pod, stacks. walk = 0 stands still.
float mech(vec2 q, float ph, float walk) {
  vec2 h = vec2(0.04, 0.56 + walk * 0.012 * cos(ph * 2.0)), s = vec2(sin(ph), cos(ph)) * walk;
  float d = min(leg(q, h, vec2(-0.06 + 0.12 * s.x, 0.1 + 0.05 * max(s.y, 0.0))), leg(q, h + vec2(0.07, 0.01), vec2(0.13 - 0.12 * s.x, 0.1 + 0.05 * max(-s.y, 0.0))));
  q.y -= h.y - 0.56;
  float hull = max(box(q - vec2(-0.01, 0.715), vec2(0.285, 0.135)), max(max(dot(q - vec2(-0.13, 0.85), vec2(-0.55, 0.83)), dot(q - vec2(-0.31, 0.73), vec2(-0.82, -0.57))), dot(q - vec2(0.21, 0.58), vec2(0.86, -0.5))));
  vec2 sp = q - vec2(-0.03, 0.79), pp = q - vec2(0.13, 0.9);
  float top = min(box(vec2(sp.x * 0.98 + sp.y * 0.17, sp.y * 0.98 - sp.x * 0.17), vec2(0.1, 0.09)) - 0.03, box(vec2(pp.x * 0.99 - pp.y * 0.12, pp.y * 0.99 + pp.x * 0.12), vec2(0.12, 0.045)) - 0.02);
  float gun = min(box(q - vec2(-0.13, 0.6), vec2(0.13, 0.05)) - 0.008, min(seg(q, vec2(-0.24, 0.6), vec2(-0.52, 0.6), 0.018), seg(q, vec2(-0.1, 0.68), vec2(-0.44, 0.69), 0.013)));
  float rest = min(min(box(q - vec2(-0.5, 0.6), vec2(0.03, 0.03)), seg(q, vec2(-0.05, 0.9), vec2(-0.03, 1.04), 0.005)), min(seg(q, vec2(0.25, 0.8), vec2(0.26, 0.99), 0.012), seg(q, vec2(0.21, 0.82), vec2(0.215, 0.96), 0.01)));
  return min(min(d, hull), min(min(top, gun), rest));
}

void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y, t = iTime, px = 1.5 / iResolution.y;
  float wide = clamp((ar - 0.6) / 1.0, 0.0, 1.0), hz = mix(0.5, 0.36, wide), mx = ar * mix(0.58, 0.68, wide), ms = mix(0.4, 0.45, wide);
  // Heat shimmer bends the air low over the horizon
  vec2 q = vec2(uv.x * ar + sin(uv.y * 90.0 + t * 2.5) * 0.0012 * smoothstep(0.08, 0.0, abs(uv.y - hz - 0.02)), uv.y);
  float y = q.y - hz;
  vec2 sc = vec2(mx + 0.1 * ms, hz + 0.46 * ms); float sr = 0.4 * ms, sd = length(q - sc);
  // Dusk sky: violet-rose overhead, amber at the horizon, the sun's halo
  vec3 col = mix(mix(vec3(0.92, 0.52, 0.34), vec3(0.58, 0.25, 0.33), smoothstep(0.0, 0.3, y)), vec3(0.17, 0.08, 0.19), smoothstep(0.25, 0.8, y));
  col += vec3(1.0, 0.5, 0.28) * exp(-sd * 4.5) * 0.4 + vec3(1.0, 0.72, 0.45) * exp(-sd * 16.0) * 0.25;
  // The planet's ring: a lit band tilted across the sky, split by a gap
  vec2 rq = q - vec2(ar * 0.5, hz - 1.68); rq = vec2(rq.x * 0.97 - rq.y * 0.24, rq.x * 0.24 + rq.y * 0.97) / vec2(2.6, 2.1);
  float e = (length(rq) - 1.0) * 2.1;
  float rings = smoothstep(0.05, 0.038, abs(e)) * (0.7 + 0.3 * sin(e * 90.0)) * (0.8 - e * 4.0) * 0.8 * (1.0 - 0.75 * smoothstep(0.005, 0.0, abs(e - 0.012)));
  col += vec3(1.0, 0.8, 0.6) * rings * mix(0.7, 0.25, smoothstep(0.0, 1.0, abs(q.x - sc.x) / ar));
  // The huge soft sun and shafts of light fanning from it
  col = mix(col, mix(vec3(1.0, 0.56, 0.34), vec3(1.0, 0.8, 0.56), smoothstep(-0.4, 0.7, (q.y - sc.y) / sr)), smoothstep(sr + px * 2.0, sr - px * 2.0, sd) * 0.8);
  col += vec3(1.0, 0.62, 0.38) * smoothstep(0.35, 0.9, noise(vec2(atan(q.y - sc.y, q.x - sc.x) * 9.0, t * 0.04))) * exp(-sd * 2.2) * smoothstep(sr * 0.9, sr * 1.6, sd) * 0.32;
  // Long stratus clouds across sky and sun, lit from below
  float cl = noise(vec2(q.x * 1.2 + t * 0.01, y * 16.0)) * 0.6 + noise(vec2(q.x * 3.0 + t * 0.02, y * 34.0)) * 0.4;
  col = mix(col, mix(vec3(0.42, 0.18, 0.25), vec3(1.0, 0.66, 0.46), exp(-sd * 3.5)), smoothstep(0.52, 0.8, cl) * smoothstep(0.04, 0.12, y) * smoothstep(0.6, 0.25, y) * 0.6);
  // Far mesas, hazed into the sky
  float mesa = hz + 0.022 + 0.03 * smoothstep(0.35, 0.65, noise(vec2(q.x * 2.4, 3.0)));
  col = mix(col, mix(vec3(0.66, 0.34, 0.33), vec3(0.95, 0.58, 0.4), exp(-abs(q.x - sc.x) * 3.0) * 0.6), smoothstep(px, -px, q.y - mesa) * 0.85);
  // Walkers far off, marching left along the horizon
  float wx = q.x + t * 0.006, wid = floor(wx / 0.55);
  vec2 wq = vec2(wx - wid * 0.55 - 0.275, y - 0.005) / 0.065;
  if (abs(wq.x) < 0.6 && abs(wq.y - 0.5) < 0.56) col = mix(col, vec3(0.52, 0.26, 0.3), smoothstep(px, -px, mech(wq, t * 1.2 + wid * 2.0, 1.0) * 0.065) * 0.85);
  // The colossus, rim-lit against the sun and hazed at its feet; visor, warning lamp, searchlight, kicked-up dust
  vec2 base = vec2(mx, hz - 0.05), mq = (q - base) / ms;
  if (abs(mq.x + 0.1) < 0.48 && mq.y < 1.06 && mq.y > -0.02) {
    float md = mech(mq, 0.0, 0.0) * ms, rim = 0.0;
    if (md < px && md > -0.02) rim = smoothstep(-0.2, 1.0, mech(mq + normalize(sc - q) * 0.02, 0.0, 0.0) * ms / (px * 2.0)) * exp(-sd * 2.5);
    vec3 mc = mix(vec3(0.13, 0.065, 0.08), vec3(0.78, 0.45, 0.38), smoothstep(0.4, 0.0, mq.y) * 0.85) + vec3(0.12, 0.06, 0.1) * smoothstep(0.7, 0.95, mq.y);
    mc += vec3(1.0, 0.68, 0.42) * (rim * 1.4 + smoothstep(-0.008, 0.0, md) * 0.25) + vec3(1.0, 0.72, 0.35) * smoothstep(0.012, 0.0, seg(mq, vec2(-0.29, 0.73), vec2(-0.15, 0.82), 0.0)) * 0.9;
    col = mix(col, mc, smoothstep(px, -px, md));
  }
  vec2 lamp = base + vec2(-0.03, 1.045) * ms, eye = base + vec2(-0.3, 0.7) * ms;
  col += vec3(1.0, 0.15, 0.1) * (smoothstep(0.007, 0.0, length(q - lamp)) + exp(-length(q - lamp) * 60.0) * 0.4) * smoothstep(0.5, 0.0, abs(fract(t * 0.6) - 0.25));
  float ba = -2.45 + 0.2 * sin(t * 0.21), bl = dot(q - eye, vec2(cos(ba), sin(ba))), bx = abs(dot(q - eye, vec2(-sin(ba), cos(ba))));
  float beam = smoothstep(0.012 + bl * 0.14, 0.0, bx) * step(0.0, bl) * exp(-bl * 2.4);
  col += vec3(1.0, 0.92, 0.8) * smoothstep(0.012, 0.0, length(q - eye));
  col = mix(col, vec3(0.85, 0.52, 0.4), exp(-length((q - base - vec2(0.03, 0.03) * ms) * vec2(3.0, 9.0) / ms)) * 0.7);
  // Mid dunes, with a fallen walker half sunk, a leg raised, its gun snapped
  float mid = hz - 0.04 + 0.022 * sin(q.x * 2.6 + 0.4) + 0.012 * sin(q.x * 6.3);
  vec2 fw = (q - vec2(ar * mix(0.3, 0.45, wide), mid)) / mix(0.17, 0.22, wide);
  float wreck = min(box(vec2(fw.x * 0.96 + fw.y * 0.28, fw.y * 0.96 - fw.x * 0.28), vec2(0.28, 0.12)) - 0.02, min(seg(fw, vec2(0.1, 0.1), vec2(0.3, 0.32), 0.06), seg(fw, vec2(0.3, 0.32), vec2(0.38, 0.12), 0.045)));
  wreck = min(wreck, seg(fw, vec2(-0.2, 0.1), vec2(-0.36, 0.42), 0.02));
  col = mix(col, vec3(0.2, 0.1, 0.11), smoothstep(px, -px, wreck * mix(0.17, 0.22, wide)));
  col = mix(col, mix(vec3(0.33, 0.15, 0.16), vec3(0.78, 0.44, 0.33), exp(-max(mid - q.y, 0.0) * 32.0) * 0.8), smoothstep(px, -px, q.y - mid));
  // Near dunes with a sun-grazed crest and wind ripples; the figure on the ridge, coat blowing
  float nx = mx - mix(0.2, 0.36, wide);
  float near = hz - mix(0.11, 0.14, wide) + 0.035 * sin(q.x * 1.9 - 1.0) + 0.012 * sin(q.x * 5.1 + 2.0) + 0.015 * exp(-pow((q.x - nx) * 6.0, 2.0));
  vec2 fq = (q - vec2(nx, near - 0.004)) / 0.062;
  float fig = min(min(seg(fq, vec2(0.0), vec2(0.0, 0.62), 0.12), length(fq - vec2(0.0, 0.8)) - 0.11), max(seg(fq, vec2(0.02, 0.62), vec2(0.42 + 0.05 * sin(t * 1.7), 0.08), 0.1), -fq.y));
  fig = min(fig, seg(fq, vec2(-0.09, 0.5), vec2(-0.13, 1.18), 0.03)) * 0.062;
  float rip = smoothstep(0.55, 0.9, noise(vec2(q.x * 5.0, (near - q.y) * 60.0 + q.x * 8.0)));
  col = mix(col, mix(vec3(0.08, 0.035, 0.05), vec3(0.7, 0.38, 0.29), exp(-max(near - q.y, 0.0) * 70.0) * 0.8) + vec3(0.2, 0.09, 0.07) * rip * exp(-(near - q.y) * 6.0), smoothstep(px, -px, q.y - near));
  col = mix(col, vec3(0.06, 0.03, 0.04), smoothstep(px, -px, fig));
  // Dust: sunlit veils, the searchlight through them, grains blowing across
  float dust = noise(vec2(q.x * 2.5 - t * 0.12, y * 9.0)) * 0.6 + noise(vec2(q.x * 6.0 - t * 0.3, y * 20.0)) * 0.4;
  col = mix(col, mix(vec3(0.75, 0.42, 0.36), vec3(1.0, 0.7, 0.48), exp(-sd * 3.0)), smoothstep(0.2, 0.85, dust) * exp(-abs(y + 0.03) * 7.0) * 0.7);
  col += vec3(1.0, 0.86, 0.68) * beam * (0.18 + 0.5 * dust);
  for (int i = 0; i < 2; i++) {
    float fi = float(i), s = 22.0 - fi * 9.0;
    col += vec3(1.0, 0.8, 0.62) * motes(q * s * vec2(0.5, 1.0) + vec2(t * (0.8 + fi * 0.6), sin(q.x * 3.0 + t * 0.5 + fi) * 0.5), 0.1, 0.15, fi * 7.0) * (0.3 + fi * 0.1);
  }
  // Grade: soft shoulder, warm vignette
  col = col / (1.0 + col * 0.2);
  color = vec4(col * (1.0 - 0.35 * pow(length(uv - vec2(0.55, 0.5)) * 1.2, 2.0)), 1.0);
}
`;

/** Glasswing: A glass dragonfly the size of a mountain glides over a rose twilight lake, its wings bending the moon into prisms. */
export const GLASSWING_SHADER = `
float tri(float x) { return 1.0 - abs(2.0 * fract(x) - 1.0); }
// Frame-wide values, set once in mainImage.
float ar, wide, px, lake, tw; vec2 mc;
vec3 spectrum(float x) { return 0.5 + 0.5 * cos(6.283 * (x + vec3(0.0, 0.33, 0.67))); }
// Behind the glass: dusk sky and clouds, the moon, faceted peaks, the old tower, the wanderer.
vec3 world(vec2 p) {
  vec3 col = mix(vec3(0.84, 0.56, 0.6), vec3(0.66, 0.38, 0.58), smoothstep(0.28, 0.6, p.y));
  col = mix(col, vec3(0.24, 0.16, 0.4), smoothstep(0.58, 1.15, p.y));
  col += vec3(0.22, 0.12, 0.16) * smoothstep(0.45, 0.85, noise(vec2(p.x * 1.6 + sin(tw * 0.1) * 0.3, p.y * 13.0))) * smoothstep(0.48, 0.62, p.y) * smoothstep(1.0, 0.7, p.y);
  vec2 md = p - mc; float mr = length(md);
  col += vec3(1.0, 0.88, 0.94) * 0.09 / (1.0 + mr * 9.0);
  col = mix(col, vec3(1.0, 0.96, 0.92), smoothstep(0.06 + px, 0.06 - px, mr));
  for (int i = 0; i < 4; i++) {
    float fi = float(i), k = fi / 3.0, f = p.x * (1.0 + fi * 0.5) + fi * 3.7;
    float h = mix(0.47, 0.29, k) + (tri(f * 0.8) * 0.62 + tri(f * 1.9 + 0.3) * 0.26 + tri(f * 4.3 + 1.1) * 0.12) * mix(0.13, 0.1, k);
    // Facets lit toward the moon, a rim on the crest, mist at the foot.
    float face = smoothstep(5.0 * px, -5.0 * px, sin(6.283 * (f * 0.8 + (h - p.y) * 0.9)));
    vec3 lc = mix(vec3(0.8, 0.52, 0.66), vec3(0.27, 0.14, 0.3), pow(k, 0.8)) * mix(0.84, 1.1, face);
    lc += vec3(0.25, 0.16, 0.2) * exp(-max(h - p.y, 0.0) * 120.0) * face;
    lc = mix(lc, vec3(0.84, 0.56, 0.66), smoothstep(h - 0.03, h - 0.2, p.y) * mix(0.55, 0.28, k));
    col = mix(col, lc, smoothstep(h + px, h - px, p.y));
    if (i == 2) {
      float tx = mix(ar * 0.28, ar * 0.48, wide);
      float d = max(abs(p.x - tx) - mix(0.014, 0.009, clamp((p.y - 0.25) / 0.32, 0.0, 1.0)), p.y - 0.57);
      vec2 pq = p - vec2(tx + 0.026, 0.57);
      d = min(d, max(abs(length(pq) - 0.026) - 0.005, -min(pq.y, -pq.x)));
      col = mix(col, lc * 0.85, smoothstep(px, -px, d));
    }
  }
  vec2 w = (p - vec2(mix(ar * 0.62, ar * 0.58, wide), lake)) / 0.042;
  float d = min(max(abs(w.x + w.y * 0.22) - 0.26 * (1.0 - w.y * 0.5), max(w.y - 1.0, -w.y)), length(w - vec2(-0.07, 1.12)) - 0.16);
  return mix(col, vec3(0.15, 0.08, 0.17), smoothstep(px, -px, d * 0.042));
}
// A wing: edge distance, across-wing 0-1, span position, chord.
vec4 wing(vec2 q, float root, float sweep, float width) {
  float lead = root + 0.02 * q.x - sweep * q.x * q.x;
  float span = width * sqrt(max(0.0, 1.0 - q.x * q.x * q.x)) * smoothstep(0.0, 0.12, q.x) + 0.012, a = (lead - q.y) / span;
  return vec4(max(max(-a, a - 1.0) * span, q.x - 1.0), a, q.x, span);
}
vec3 scene(vec2 p) {
  vec3 col = world(p);
  // Early stars.
  vec2 sg = floor(p * 40.0), sf = fract(p * 40.0) - h22(sg) * 0.6 - 0.2;
  col += vec3(1.0, 0.92, 0.96) * step(0.93, h2(sg)) * smoothstep(0.75, 0.95, p.y) * exp(-dot(sf, sf) / (px * px * 1600.0));
  // The great dragonfly, right of centre, angled to the upper left.
  vec2 c = mix(vec2(ar * 0.5, 0.74), vec2(ar * 0.64, 0.7), wide) + vec2(sin(tw * 0.1), sin(tw * 0.2)) * vec2(0.03, 0.015);
  float s = mix(0.26, 0.5, wide), ang = 0.32 + 0.05 * sin(tw * 0.1), pu = px / s, flex = 0.015 * sin(tw * 0.5);
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (p - c) / s, aq = vec2(abs(q.x), q.y);
  if (aq.x > 1.05 || abs(q.y) > 1.0) return col;
  vec4 fw = wing(aq, 0.08, flex - 0.03, 0.13), hw = wing(aq, -0.04, flex + 0.14, 0.16), wg = fw.x < hw.x ? fw : hw;
  float m = smoothstep(pu, -pu, wg.x);
  if (m > 0.0) {
    // Cells between cross-veins; long veins converge at the tip.
    vec2 g = vec2(wg.z * 16.0, wg.y * 4.0), id = floor(g), fr = fract(g), cid = id;
    float f1 = 9.0, f2 = 9.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j)), pt = o + 0.2 + 0.6 * h22(id + o + sign(q.x) * 7.0) - fr; float dd = dot(pt, pt);
      if (dd < f1) { f2 = f1; f1 = dd; cid = id + o; } else if (dd < f2) f2 = dd;
    }
    float aa = pu * 16.0 / max(wg.w * 4.0, 0.3), edge = sqrt(f2) - sqrt(f1), hc = h2(cid + sign(q.x));
    float vein = max(smoothstep(0.06 + aa, 0.06 - aa, edge) * 0.35, smoothstep(0.012 + pu, -pu, wg.y * wg.w));
    vein = max(vein, smoothstep(0.004 + pu, 0.004 - pu, abs(fract(wg.y * 3.0 + 0.5) - 0.5) * wg.w / 3.0) * 0.8 * step(0.05, wg.y));
    // Each cell a faint lens: the world bends behind it, colours pulled apart.
    vec2 o = ((h22(cid * 1.3) - 0.5) * 0.03 + (fr - 0.5) * vec2(0.01, 0.02)) * s;
    vec3 ra = world(p + o), film = spectrum(hc * 0.3 + wg.z * 0.8 + wg.y * 0.3 + tw * 0.02);
    vec3 pane = vec3(ra.r, ra.g * 0.6 + col.g * 0.4, col.b) * (0.97 + 0.06 * hc) * mix(vec3(1.0), film, 0.1) + film * 0.03;
    pane += vec3(1.0, 0.95, 0.98) * exp(-pow((wg.z - 0.5 - 0.35 * sin(tw * 0.1)) * 4.0, 2.0)) * 0.12;
    pane = mix(pane, vec3(1.0, 0.92, 0.96), vein);
    pane = mix(pane, vec3(0.6, 0.22, 0.42), smoothstep(0.06, 0.03, length(vec2(wg.z - 0.84, wg.y * wg.w * 2.0))) * 0.85);
    pane += spectrum(wg.y * 2.0 + 0.3) * exp(-abs(wg.y - 1.0) * wg.w * 300.0) * 0.3;
    col = mix(col, pane, m);
  }
  // Body: segmented tail, thorax, eyes; plum turning iridescent teal on the moon side.
  float tail = max(abs(q.x) - 0.03 * (1.0 - smoothstep(-0.1, -0.72, q.y) * 0.45), max(-q.y - 0.72, q.y + 0.05));
  float bd = min(min(tail, (length(q / vec2(0.05, 0.1)) - 1.0) * 0.05), length(vec2(aq.x - 0.032, q.y - 0.12)) - 0.042);
  vec3 bc = mix(vec3(0.16, 0.08, 0.2), vec3(0.42, 0.62, 0.74), clamp(q.x * 18.0 + 0.35, 0.0, 1.0) * 0.75);
  bc *= 1.0 - 0.35 * smoothstep(0.35, 0.5, abs(fract(q.y * 11.0) - 0.5)) * step(q.y, -0.1);
  bc += vec3(1.0, 0.95, 1.0) * (smoothstep(-0.01, 0.0, bd) * 0.2 + smoothstep(0.014, 0.0, length(vec2(aq.x - 0.045, q.y - 0.137))) * 0.5);
  return mix(col, bc, smoothstep(pu, -pu, bd));
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; ar = iResolution.x / iResolution.y; px = 1.5 / iResolution.y;
  vec2 p = vec2(uv.x * ar, uv.y); wide = smoothstep(0.7, 1.4, ar); tw = mod(iTime, 62.8318);
  mc = mix(vec2(ar * 0.66, 0.86), vec2(ar * 0.83, 0.82), wide); lake = mix(0.3, 0.29, wide);
  float dz = lake - p.y;
  vec3 col;
  if (dz > 0.0) {
    // The lake mirrors the scene: ripples fading toward the shore, a glitter path under the moon.
    float rip = sin(3.0 / (dz + 0.02) + sin(p.x * 7.0) * 0.6 + tw * 0.5) * (0.003 + dz * 0.015) * smoothstep(0.0, 0.06, dz);
    col = scene(vec2(p.x + rip, lake + dz)) * vec3(0.88, 0.8, 0.94) * (0.82 + 0.18 * smoothstep(0.0, lake, p.y));
    col += vec3(0.14, 0.13, 0.13) * exp(-abs(p.x - mc.x + rip * 3.0) * 25.0) * (0.5 + 0.5 * sin(dz * 200.0 + tw * 2.0 + p.x * 40.0)) * smoothstep(0.0, 0.03, dz);
    col += vec3(0.18, 0.15, 0.17) * smoothstep(0.006, 0.0, dz);
  } else col = scene(p);
  // Falling motes, some prismatic.
  float fall = mod(iTime, 600.0);
  col += vec3(0.4, 0.38, 0.4) * motes(p * 9.0 + vec2(sin(p.y * 3.0 + tw * 0.1) * 0.6, fall * 0.18), 0.14, 0.12, 3.0);
  col += spectrum(p.x * 2.0 + p.y) * motes(p * 4.5 + vec2(0.0, fall * 0.12), 0.12, 0.06, 9.0) * 0.35;
  col *= 1.0 - 0.2 * pow(length(uv - 0.5) * 1.2, 2.5);
  color = vec4(col, 1.0);
}
`;

/** Frostline: A lone climber on a knife-edge ridge in a blizzard, ice peaks fading into whiteout under a pale sun. */
export const FROSTLINE_SHADER = `
// Peaks from the three nearest triangles. x: skyline, y: across the face of the nearest peak covering y, z: its depth,
// w: the skyline upwind (spindrift's source).
vec4 peaks(float x, float y, float seed, float lean) {
  float c = floor(x);
  vec3 r = vec3(h1(c - 1.0 + seed), h1(c + seed), h1(c + 1.0 + seed)), z = fract(r * 31.7);
  vec3 xi = c + vec3(-1.0, 0.0, 1.0) + 0.15 + 0.7 * r, hi = 0.45 + 0.55 * fract(r * 13.3 + 0.37);
  vec3 dx = x - xi, v = hi - abs(dx) * mix(1.7 - 0.6 * r, 1.1 + 0.7 * r, step(0.0, dx));
  float best = max(max(max(v.x, v.y), v.z), 0.0);
  vec3 key = z + step(v, vec3(y)) * 9.0, side = dx + (hi - y) * (0.4 * r - 0.12);
  float k = min(key.x, key.y), s = mix(mix(side.x, side.y, step(key.y, key.x)), side.z, step(key.z, k));
  vec3 du = dx + max(y - best, 0.0) * lean, vu = hi - abs(du) * mix(1.7 - 0.6 * r, 1.1 + 0.7 * r, step(0.0, du));
  float jag = abs(fract(x * 3.3) - 0.5) + abs(fract(x * 7.9 + 0.3) - 0.5) * 0.5;
  return vec4(best - jag * 0.1, s, min(min(k, key.z), 1.0), max(max(vu.x, vu.y), vu.z));
}
// Range fi (0 far .. 3 near): far ones lost in the white, near ones ice-blue.
vec3 range(vec3 col, vec2 p, float fi, float wide, float toward, float glow, vec3 haze, float veil, float px) {
  float sc = 1.7 + fi * 0.75, amp = 0.32 - fi * 0.045, base = mix(0.42, 0.36, wide) - fi * mix(0.075, 0.08, wide);
  vec4 pk = peaks(p.x * sc + fi * 7.3 + 2.0, (p.y - base) / amp, fi * 13.0 + 5.0, amp * 1.8 * sc);
  float depth = base + amp * pk.x - p.y, inside = max(depth, 0.0);
  float lit = mix(0.42, smoothstep(-0.025, 0.025, pk.y * toward + 0.01), exp(-inside / amp * 1.2));
  vec3 face = mix(mix(vec3(0.42, 0.53, 0.68), vec3(0.26, 0.37, 0.54), fi / 3.0), vec3(0.9, 0.94, 0.98) + vec3(0.08, 0.05, 0.0) * glow, lit);
  face = mix(face, vec3(0.62, 0.72, 0.84), smoothstep(0.0, 0.3, depth) * 0.35);
  if (fi > 2.5) { // gullies
    float g = p.x * sc * 9.0 + depth * 14.0 * sign(pk.y);
    face *= 1.0 - smoothstep(0.5, 0.95, sin(g) * sin(g * 0.37 + 1.3)) * 0.18 * smoothstep(0.0, 0.04, depth);
  }
  face += vec3(1.0, 0.97, 0.9) * exp(-inside * 160.0) * glow * 0.45;
  col = mix(col, mix(face, haze, clamp(mix(0.8, 0.1, fi / 3.0) * (0.85 + 0.3 * veil) + pk.z * 0.12, 0.0, 1.0)), smoothstep(px, -px, -depth));
  if (fi > 0.5 && fi < 2.5) { // spindrift
    float above = max(-depth, 0.0);
    float plume = smoothstep(0.45, 0.9, pk.w) * exp(-above * 16.0) * step(0.0, -depth);
    plume *= 0.25 + 0.75 * noise(vec2((p.x + iTime * 0.35) * 8.0, above * 26.0 - iTime * 0.6));
    col = mix(col, vec3(1.0, 0.99, 0.97), plume * (0.45 + fi * 0.15) * (0.6 + 0.4 * glow));
  }
  return col;
}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
// The climber, feet at the origin, one unit tall, with an ice axe.
float climber(vec2 c) {
  float d = seg(c, vec2(-0.12, -0.04), vec2(0.04, 0.44)) - 0.075;
  d = min(d, min(seg(c, vec2(0.26, 0.1), vec2(0.22, 0.28)), seg(c, vec2(0.22, 0.28), vec2(0.07, 0.44))) - 0.075);
  d = min(d, seg(c, vec2(0.06, 0.44), vec2(0.2, 0.78)) - 0.12);
  d = min(d, length(c - vec2(0.26, 0.9)) - 0.1);
  d = min(d, seg(c, vec2(-0.01, 0.56), vec2(0.07, 0.82)) - 0.13);
  d = min(d, seg(c, vec2(0.17, 0.72), vec2(0.42, 0.58)) - 0.045);
  return min(d, seg(c, vec2(0.44, 0.66), vec2(0.5, 0.1)) - 0.035);
}
// One depth of snow, stretched along the wind.
vec3 snow(vec3 col, vec2 p, float fj, float gust) {
  vec2 wd = vec2(-0.958, -0.287), q = vec2(dot(p, wd) * (0.32 - fj * 0.06), dot(p, vec2(-wd.y, wd.x))) * (46.0 - fj * 16.0);
  q += vec2(-gust * (1.0 + fj * 0.8), sin(q.x * 0.5 + iTime * 0.7 + fj) * 0.3);
  return mix(col, vec3(1.0), motes(q, 0.2 - fj * 0.02, 0.5 - fj * 0.1, fj * 7.0) * (0.7 + fj * 0.1));
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y);
  float px = 1.5 / iResolution.y, t = iTime, wide = clamp((ar - 0.6) / 0.9, 0.0, 1.0);
  vec2 sun = vec2(ar * mix(0.62, 0.7, wide), mix(0.8, 0.74, wide));
  float r = length(p - sun), glow = exp(-abs(p.x - sun.x) * 1.6);
  vec3 haze = mix(vec3(0.8, 0.86, 0.92), vec3(0.98, 0.95, 0.9), exp(-r * 1.8));
  float storm = noise(vec2(p.x * 0.7 + p.y * 0.5 + t * 0.32, t * 0.04)); // squalls
  // The arete, rising right; what it hides is skipped.
  float cx = ar * mix(0.6, 0.64, wide), cy = mix(0.42, 0.27, wide);
  float de = uv.y - cy - (p.x - cx) * 0.32 - 0.008 * sin(p.x * 23.0) * sin(p.x * 5.3 + 1.0);
  vec3 col = haze;
  if (de > -0.02) {
    // Sky: steel blue, a slate ceiling torn open around the sun.
    col = mix(vec3(0.84, 0.88, 0.92), vec3(0.46, 0.56, 0.68), smoothstep(0.3, 1.1, uv.y));
    float deck = noise(vec2(p.x * 1.3 + t * 0.06, p.y * 2.6));
    col = mix(col, vec3(0.46, 0.53, 0.63), smoothstep(0.35, 0.8, deck) * smoothstep(0.55, 1.0, uv.y) * smoothstep(0.12, 0.45, r) * 0.85);
    col += vec3(1.0, 0.95, 0.86) * (exp(-r * 1.6) * 0.18 + exp(-r * 6.0) * 0.32 + exp(-r * 22.0) * 0.4) * (0.75 + 0.25 * storm);
    col = mix(col, vec3(1.0, 0.99, 0.96), smoothstep(0.042 + px, 0.042 - px, r) * (0.8 - 0.4 * storm));
    float toward = clamp((sun.x - p.x) * 3.0, -1.0, 1.0);
    col = range(col, p, 0.0, wide, toward, glow, haze, storm, px);
    col = range(col, p, 1.0, wide, toward, glow, haze, storm, px);
    col = range(col, p, 2.0, wide, toward, glow, haze, storm, px);
    col = range(col, p, 3.0, wide, toward, glow, haze, storm, px);
  }
  if (de < 0.01) {
    // The arete's lit face over its shadow face.
    float fall = de + 0.1 + (p.x - cx) * 0.12 + 0.02 * sin(p.x * 5.0 + 2.0) * sin(p.x * 2.1);
    vec3 ice = mix(vec3(0.52, 0.62, 0.76), vec3(0.93, 0.96, 0.99), smoothstep(-0.006, 0.006, fall));
    ice -= 0.03 * (1.0 + sin(p.x * 9.0 + de * 40.0) * sin(p.x * 3.7 - de * 23.0));
    ice += vec3(1.0, 0.95, 0.85) * exp(min(de, 0.0) * 200.0) * 0.12;
    col = mix(col, ice, smoothstep(px, -px, de));
  }
  // The climber: red jacket, gold rim.
  float hc = mix(0.065, 0.07, wide); vec2 c = (p - vec2(cx, cy - 0.004)) / hc;
  if (abs(c.x - 0.2) < 0.8 && c.y > -0.3 && c.y < 1.2) {
    float d = climber(c), aa = px / hc;
    float rim = smoothstep(-0.07, -0.01, d) * smoothstep(0.3, 0.9, c.x * 1.2 + c.y * 0.6);
    vec3 suit = mix(vec3(0.08, 0.1, 0.14), vec3(0.7, 0.13, 0.08), smoothstep(0.4, 0.47, c.y) * step(c.y, 0.83));
    col = mix(col, suit + vec3(1.0, 0.88, 0.7) * rim * 0.55, smoothstep(aa, -aa, d));
  }
  // Ground blizzard over the crest, whiteout veils.
  if (de > -0.02 && de < 0.25) {
    float drift = noise(vec2((p.x + t * 0.9) * 5.0, de * 24.0)) * exp(-max(de, 0.0) * 16.0) * smoothstep(-0.015, 0.01, de);
    col = mix(col, vec3(0.98, 0.99, 1.0), drift * 0.6);
  }
  float sheet = noise(vec2(p.x * 1.8 + t * 0.6, p.y * 9.0 + 3.0)); sheet *= sheet;
  col = mix(col, haze, clamp(smoothstep(0.15, 0.6, sheet) * (0.5 - uv.y * 0.3) + smoothstep(0.45, 0.85, storm) * 0.35 * (1.0 - uv.y * 0.5), 0.0, 1.0));
  // Snow in three depths, gusting.
  float gust = t * 1.5 + 0.9 * sin(t * 0.45) + 0.5 * sin(t * 1.1);
  col = snow(snow(snow(col, p, 0.0, gust), p, 1.0, gust), p, 2.0, gust);
  color = vec4(col, 1.0);
}
`;

/** Kestrel: A fighter high over a sea of cloud, gold-rimmed against the sun's glare, peaks breaking through below. */
export const KESTREL_SHADER = `
// Distance to a convex quad (corners counter-clockwise).
float edge(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; return (e.y * (p.x - a.x) - e.x * (p.y - a.y)) / length(e); }
float quad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) { return max(max(edge(p, a, b), edge(p, b, c)), max(edge(p, c, d), edge(p, d, a))); }
// The fighter, nose right, one unit long.
float jet(vec2 q) {
  float h = clamp(q.x + 0.5, 0.0, 1.0);
  float body = length(q - vec2(h - 0.5, 0.0)) - 0.042 * (1.0 - smoothstep(0.55, 1.0, h) * 0.95) * (0.75 + 0.25 * smoothstep(0.0, 0.3, h));
  float canopy = length((q - vec2(0.2, 0.03)) * vec2(1.0, 2.8)) - 0.09;
  float wing = quad(q, vec2(0.14, -0.012), vec2(-0.26, -0.02), vec2(-0.36, -0.2), vec2(-0.27, -0.205));
  float farw = quad(q, vec2(0.06, 0.015), vec2(-0.2, 0.11), vec2(-0.27, 0.11), vec2(-0.2, 0.015));
  float fin = quad(q, vec2(-0.3, 0.02), vec2(-0.45, 0.02), vec2(-0.53, 0.16), vec2(-0.46, 0.165));
  float stab = quad(q, vec2(-0.36, -0.01), vec2(-0.5, -0.06), vec2(-0.56, -0.065), vec2(-0.52, -0.01));
  return min(min(min(body, canopy), min(wing, farw)), min(fin, stab));
}
// Cloud row fi (0 far .. 4 near): puffs lit as spheres with a silver rim, over a shadowed body; faster and bigger near.
vec3 cloudRow(vec3 col, vec2 w, float fi, float hz, float wide, vec2 toSun, float px, float glow) {
  float f = 26.0 / (1.0 + fi * 1.3), x = w.x * f + iTime * 0.026 * (1.0 + fi * 1.8) * f + fi * 17.0, c = floor(x), seed = fi * 5.3;
  float y = (w.y - hz + 0.015 + fi * mix(0.07, 0.06, wide) + fi * fi * 0.015) * f - 0.45 * sin(x * 0.29 + seed) - 0.3 * sin(x * 0.71 + seed * 1.7);
  vec3 r = vec3(h1(c - 1.0 + seed), h1(c + seed), h1(c + 1.0 + seed));
  vec3 dx = x - (c + vec3(-0.5, 0.5, 1.5) + 0.4 * (r - 0.5)), rad = 0.5 + 0.5 * fract(r * 13.7);
  vec3 yc = -rad * (0.2 + 0.4 * fract(r * 7.3)), top = yc + sqrt(max(rad * rad - dx * dx, 0.0));
  float b = step(top.x, top.y), z = step(max(top.x, top.y), top.z);
  float R = mix(mix(rad.x, rad.y, b), rad.z, z), under = max(max(max(top.x, top.y), top.z), 0.0) + 0.06 * abs(sin(x * 4.1 + seed)) - y;
  vec2 o = clamp(vec2(mix(mix(dx.x, dx.y, b), dx.z, z), y - mix(mix(yc.x, yc.y, b), yc.z, z)) / R, -1.0, 1.0);
  vec3 n = normalize(mix(vec3(o, sqrt(max(1.0 - dot(o, o), 0.0))), vec3(0.0, -0.3, 0.95), smoothstep(0.0, 0.28, under)));
  float e = 1.0 - n.z, rim = e * e * e * clamp(dot(n.xy, toSun) + 0.2, 0.0, 1.0);
  vec3 cc = mix(vec3(0.52, 0.62, 0.84), vec3(1.0, 0.97, 0.92), clamp(dot(n, normalize(vec3(toSun, 0.45))) * 0.75 + 0.35, 0.0, 1.0));
  cc = (cc + vec3(1.0, 0.86, 0.6) * rim * 0.7) * (1.0 + (mix(mix(r.x, r.y, b), r.z, z) - 0.5) * 0.14 * smoothstep(0.3, 0.0, under));
  cc = mix(cc, vec3(0.5, 0.6, 0.83), smoothstep(0.3, 1.8, under) * 0.75) + vec3(1.0, 0.82, 0.55) * glow * 0.1;
  cc = mix(cc, mix(vec3(0.82, 0.9, 0.98), vec3(1.0, 0.95, 0.86), glow * 0.5), mix(0.65, 0.0, fi / 4.0));
  float soft = px * f * 1.5 + 0.035;
  return mix(col, cc, smoothstep(-soft, soft, under));
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y);
  float px = 1.5 / iResolution.y, t = iTime, wide = clamp((ar - 0.6) / 0.9, 0.0, 1.0);
  // Bank: w is the rolled point.
  float bank = 0.07 + 0.05 * sin(t * 0.13);
  mat2 roll = mat2(cos(bank), -sin(bank), sin(bank), cos(bank));
  vec2 cen = vec2(ar * 0.5, 0.5), w = roll * (p - cen) + cen;
  vec2 sunP = vec2(ar * mix(0.66, 0.74, wide), mix(0.8, 0.76, wide)), sun = roll * (sunP - cen) + cen;
  float hz = mix(0.5, 0.42, wide), r = length(w - sun), glow = exp(-abs(w.x - sun.x) * 1.4), sy = w.y - hz;
  // Sky: pale horizon, cerulean, cobalt overhead.
  vec3 col = mix(mix(vec3(0.82, 0.9, 0.98), vec3(0.36, 0.6, 0.96), smoothstep(0.0, 0.22, sy)), vec3(0.1, 0.3, 0.78), smoothstep(0.25, 0.62, sy));
  // A far fighter's curling contrail.
  float behind = fract(t * 0.016) * (ar + 2.0) - 1.0 - w.x, cd = (w.y - 0.86 - 0.05 * sin(w.x * 3.0 + 1.0)) / (px * 0.8 + max(behind, 0.0) * 0.012);
  col = mix(col, vec3(0.96, 0.98, 1.0), exp(-cd * cd) * smoothstep(0.0, 0.02, behind) * smoothstep(1.2, 0.1, behind) * 0.8);
  // Peaks breaking through: rock, snow, a bright crest near the sun.
  float xs = w.x * 2.6 + t * 0.01 + 3.0, pc = floor(xs);
  vec3 pr = vec3(h1(pc - 1.0), h1(pc), h1(pc + 1.0)), pdx = xs - (pc + vec3(-0.5, 0.5, 1.5) + 0.5 * (pr - 0.5));
  vec3 ph = (0.35 + 0.65 * fract(pr * 9.1)) * step(0.25, pr) - abs(pdx) * mix(vec3(1.6), vec3(1.2), step(0.0, pdx));
  float pk = max(max(max(ph.x, ph.y), ph.z), 0.0) - (abs(fract(xs * 3.1) - 0.5) + abs(fract(xs * 6.7) - 0.5) * 0.5) * 0.08;
  float dp = hz - 0.04 + pk * 0.24 - w.y;
  float lit = smoothstep(-0.02, 0.02, mix(mix(pdx.x, pdx.y, step(ph.x, ph.y)), pdx.z, step(max(ph.x, ph.y), ph.z)) + dp * 3.0);
  vec3 rock = mix(mix(vec3(0.3, 0.37, 0.5), vec3(0.6, 0.6, 0.64), lit), mix(vec3(0.62, 0.71, 0.88), vec3(1.0, 0.96, 0.9), lit), smoothstep(0.045, 0.025, dp + 0.01 * sin(w.x * 60.0)));
  rock += vec3(1.0, 0.9, 0.75) * exp(-max(dp, 0.0) * 300.0) * glow * 0.6;
  col = mix(col, mix(rock, vec3(0.8, 0.87, 0.97), 0.15 + smoothstep(0.0, 0.1, dp) * 0.6), smoothstep(-px, px, dp));
  // Five cloud rows, far to near.
  vec2 toSun = normalize(sun - vec2(w.x, hz));
  col = cloudRow(col, w, 0.0, hz, wide, toSun, px, glow);
  col = cloudRow(col, w, 1.0, hz, wide, toSun, px, glow);
  col = cloudRow(col, w, 2.0, hz, wide, toSun, px, glow);
  col = cloudRow(col, w, 3.0, hz, wide, toSun, px, glow);
  col = cloudRow(col, w, 4.0, hz, wide, toSun, px, glow);
  // Sun: disc, glare, ice halo, streak.
  vec2 ds = w - sun; float rr = (r - 0.24) / 0.014;
  vec3 glare = vec3(1.0, 0.92, 0.74) * (exp(-r * 2.6) * 0.32 + exp(-r * 10.0) * 0.55 + exp(-r * 36.0) * 0.8);
  col += glare + mix(vec3(0.9, 0.55, 0.35), vec3(0.55, 0.75, 1.0), smoothstep(0.23, 0.255, r)) * exp(-rr * rr) * 0.12;
  col += vec3(1.0, 0.9, 0.75) * exp(-abs(ds.y) * 90.0) * exp(-abs(ds.x) * 1.8) * 0.28;
  col = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.028 + px, 0.028 - px, r));
  // The fighter: wingtip vapour, lit belly, gold rim, canopy glint.
  vec2 jc = vec2(ar * mix(0.5, 0.62, wide), mix(0.66, 0.6, wide) + 0.005 * sin(t * 0.9));
  float js = mix(ar * 0.58, 0.3, wide); vec2 q = (p - jc) / js;
  float va = (q.y + 0.2) / (0.006 + max(-q.x - 0.36, 0.0) * 0.025), vb = (q.y - 0.11) / (0.005 + max(-q.x - 0.27, 0.0) * 0.025);
  float vap = exp(-va * va) * smoothstep(-0.34, -0.38, q.x) + 0.6 * exp(-vb * vb) * smoothstep(-0.25, -0.29, q.x);
  col = mix(col, vec3(1.0), clamp(vap * (0.65 + 0.35 * noise(vec2(q.x * 7.0 + t * 3.0, 0.5))) * smoothstep(-2.4, -0.6, q.x), 0.0, 1.0) * 0.85);
  if (abs(q.x) < 0.62 && abs(q.y) < 0.26) {
    float d = jet(q), aa = px / js; vec2 ld = normalize(sunP - jc);
    vec3 hull = mix(vec3(0.24, 0.29, 0.38), vec3(0.1, 0.12, 0.17), smoothstep(-0.05, 0.03, q.y));
    hull += vec3(1.0, 0.82, 0.52) * smoothstep(-0.024, -0.004, d) * smoothstep(-0.03, 0.05, q.y * ld.y + q.x * ld.x * 0.3 + 0.02) * 1.2;
    hull += vec3(0.75, 0.88, 1.0) * smoothstep(0.015, 0.0, length((q - vec2(0.24, 0.045)) * vec2(1.0, 3.0)) - 0.025) * 0.7;
    col = mix(col, hull, smoothstep(aa, -aa, d));
  }
  color = vec4(col + glare * 0.22, 1.0);
}
`;

/** Starward: A ringed gas giant in crescent, its sun blazing past the edge, rays fanning over a vivid nebula. */
export const STARWARD_SHADER = `
float n3(vec2 p) { return (0.5 * noise(p) + 0.25 * noise(p * 2.03 + 1.7) + 0.125 * noise(p * 4.07 + 3.3)) / 0.875; }
// Stars: one per cell at most, soft, denser in the galaxy's band.
vec3 starLayer(vec2 p, float cell, float chance, float px, float seed, vec2 band) {
  vec2 g = p / cell, id = floor(g), r = h22(id + seed) - 0.5;
  float inBand = exp(-pow(dot((id + 0.5) * cell, band) - 1.0, 2.0) / 0.025);
  float on = step(1.0 - chance * (1.0 + 2.0 * inBand), h2(id + seed * 1.7)), b = h2(id + seed + 9.1);
  float d = length((fract(g) - 0.5 - r * 0.7) * cell), s = px * (0.85 + 1.3 * b * b);
  vec3 tint = mix(vec3(1.0, 0.8, 0.6), vec3(0.68, 0.85, 1.0), h2(id + seed + 3.7));
  return tint * on * (0.2 + 0.85 * b * b) * exp(-d * d / (s * s));
}
// Ring density by radius (planet radii): bands, a gap, soft edges; w is a pixel.
float ringDensity(float rr, float w) {
  float k = smoothstep(1.32 - w, 1.4 + w, rr) * smoothstep(2.45 + w, 2.32 - w, rr);
  float gap = 1.0 - 0.85 * smoothstep(0.04 + w, 0.015, abs(rr - 1.98));
  return k * gap * (0.55 + 0.28 * sin(rr * 29.0) + 0.17 * sin(rr * 67.0 + 2.0)) * mix(0.55, 1.0, smoothstep(1.4, 1.75, rr));
}
// A diffraction spike along a.y, a pixel wide at the core.
float spike(vec2 a, float px, float fall) { return exp(-abs(a.x) / (px + 0.012 * abs(a.y))) * exp(-abs(a.y) * fall); }
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y, px = 1.5 / iResolution.y, t = iTime * 0.02;
  vec2 p = vec2(uv.x * ar, uv.y); float wide = smoothstep(0.7, 1.4, ar);
  // The giant: right of centre when wide, high on a phone; its sun off the upper-left limb.
  vec2 pc = mix(vec2(ar * 0.62, 0.64), vec2(ar * 0.7, 0.4), wide); float R = mix(0.25, 0.38, wide);
  vec3 L = normalize(vec3(-0.6, 0.55, -0.28)), N = normalize(vec3(-0.2, 1.0, 0.24));
  vec2 sunDir = normalize(L.xy), sun = pc + sunDir * R * mix(1.2, 1.32, wide);
  vec2 sd = p - sun; float sr = length(sd), glow = 1.0 / (1.0 + sr * 3.5);
  // Nebula: teal, rose, gold toward the sun; filaments, dark dust, the galaxy's band.
  vec2 band = normalize(vec2(0.32, 1.0)); band /= dot(vec2(ar * 0.5, mix(0.88, 0.8, wide)), band);
  vec2 q = p * 1.25 + vec2(t, -0.3 * t);
  float w = n3(q * 1.6 + 5.0), neb = fbm(q + w * 1.5 - t * 0.3), hg = noise(q * 0.8 + 1.0) + 0.4 * glow;
  vec3 col = vec3(0.004, 0.012, 0.03) * (1.0 + 1.5 * uv.y);
  vec3 nc = mix(vec3(0.0, 0.42, 0.56), vec3(0.85, 0.16, 0.5), smoothstep(0.36, 0.5, hg));
  nc = mix(nc, vec3(1.0, 0.56, 0.16), smoothstep(0.58, 0.75, hg));
  col += nc * (pow(neb, 2.6) * (1.0 + 1.4 * glow) + pow(1.0 - abs(neb * 2.0 - 1.1), 8.0) * 0.5);
  float bandD = dot(p, band) - 1.0;
  col += vec3(0.5, 0.47, 0.46) * exp(-bandD * bandD / 0.01) * (0.25 + 0.75 * w) * (1.0 - 0.6 * exp(-pow(bandD / 0.025 + 2.0 * w - 1.0, 2.0)));
  col *= 1.0 - 0.7 * smoothstep(0.58, 0.72, w) * (1.0 - smoothstep(0.75, 0.9, neb));
  col += vec3(1.0, 0.75, 0.45) * pow(neb, 5.0) * smoothstep(0.55, 0.72, w) * 3.0 * glow;
  col += starLayer(p, 0.021, 0.2, px, 1.0, band) * 0.75 + starLayer(p, 0.07, 0.2, px * 1.3, 5.0, band);
  // Rays from the sun through the dust, slowly turning.
  float ang = atan(sd.y, sd.x), rays = noise(vec2(ang * 9.0 + t * 2.0, 0.0)) * noise(vec2(ang * 23.0 - t * 3.0, 3.0));
  col += vec3(1.0, 0.8, 0.55) * rays * (0.08 + 0.3 * neb) * exp(-sr * 2.6) * smoothstep(0.0, 0.1, sr);
  // Planet and ring plane in planet radii.
  vec2 d = (p - pc) / R; float r2 = dot(d, d), r = sqrt(r2), pxR = px / R;
  float zs = sqrt(max(0.0, 1.0 - r2)), zq = -(N.x * d.x + N.y * d.y) / N.z, rq = length(vec3(d, zq));
  float toward = max(dot(d / max(r, 0.001), sunDir), 0.0);
  float atm = exp(-max(r - 1.0, 3.0 - 3.0 * r) * R * mix(80.0, 35.0, toward)) * (0.1 + 1.4 * pow(toward, 6.0) + 0.4 * toward * toward);
  if (r < 1.0 + pxR) {
    vec3 P = vec3(d, zs), T = normalize(vec3(-N.y, N.x, 0.0));
    float lat = dot(P, N), lon = atan(dot(P, T), dot(P, cross(N, T))) + iTime * 0.006;
    // Bands warped by slow turbulence, calm at the poles.
    float tur = n3(vec2(lon * 3.0, lat * 14.0)), la = lat + 0.05 * (tur - 0.5) * smoothstep(0.97, 0.85, abs(lat));
    float bv = 0.5 + 0.3 * sin(la * 23.0) + 0.14 * sin(la * 57.0 + 1.3) + 0.08 * sin(la * 9.0 + 2.0);
    vec3 pcol = mix(vec3(0.33, 0.11, 0.05), vec3(0.98, 0.8, 0.55), clamp(bv, 0.0, 1.0));
    pcol = mix(pcol, vec3(0.78, 0.4, 0.18), smoothstep(0.62, 0.8, tur) * 0.6);
    pcol = mix(pcol, vec3(0.45, 0.58, 0.72), smoothstep(0.6, 0.92, abs(lat)) * 0.6);
    // Light: soft terminator with a red edge, the ring's shadow, a hot rim toward the sun.
    float dl = dot(P, L), lit = smoothstep(-0.12, 0.5, dl), s = -dot(P, N) / dot(L, N);
    float shade = 1.0 - 0.75 * step(0.0, s) * ringDensity(length(P + s * L), 0.02);
    vec3 pl = pcol * (lit * shade * 1.25 + 0.012) + vec3(0.13, 0.03, 0.01) * smoothstep(0.14, 0.0, abs(dl + 0.02));
    pl += vec3(0.6, 0.3, 0.15) * pow(1.0 - zs, 3.0) * pow(toward, 3.0);
    col = mix(col, pl, smoothstep(1.0 + pxR, 1.0 - pxR, r));
  }
  col += vec3(1.0, 0.72, 0.45) * atm + vec3(0.2, 0.33, 0.5) * atm * (1.0 - toward);
  // Rings in front of or beside the planet: glowing toward the sun, cut by its shadow.
  if (r > 1.0 - pxR || zq > zs) {
    vec3 Q = vec3(d, zq); float b = dot(Q, L), disc = b * b - dot(Q, Q) + 1.0;
    float shadow = 1.0 - 0.8 * smoothstep(-0.02, 0.06, disc) * step(b, 0.0);
    float fwd = 0.3 + 1.2 * pow(dot(normalize(Q.xy), sunDir) * 0.5 + 0.5, 3.0);
    vec3 rc = mix(vec3(0.95, 0.72, 0.5), vec3(1.0, 0.92, 0.8), 0.5 + 0.5 * sin(rq * 13.0));
    float front = (zq > zs) ? 1.0 : smoothstep(1.0 - pxR, 1.0 + pxR, r);
    col = mix(col, col * 0.35 + rc * fwd * shadow * 0.8, clamp(ringDensity(rq, pxR / N.z) * 0.85, 0.0, 1.0) * front);
  }
  // Two moons in crescent.
  for (int i = 0; i < 2; i++) {
    float fi = float(i), mr = R * mix(0.12, 0.05, fi);
    vec2 md = (p - pc - R * mix(vec2(-2.3, -0.75), vec2(1.15, 1.25), fi) * mix(vec2(0.42, 1.25), vec2(1.0), wide)) / mr;
    float m2 = dot(md, md);
    if (m2 < 1.5) {
      vec3 M = vec3(md, sqrt(max(0.0, 1.0 - m2)));
      vec3 mm = vec3(0.68, 0.58, 0.5) * (0.7 + 0.4 * noise(md * 3.0 + fi * 7.0));
      mm = mm * (smoothstep(-0.05, 0.45, dot(M, L)) * 1.2 + 0.015) + vec3(0.6, 0.42, 0.27) * pow(1.0 - M.z, 3.0) * max(dot(md, sunDir), 0.0);
      col = mix(col, mm, smoothstep(1.0 + px / mr, 1.0 - px / mr, sqrt(m2)));
    }
  }
  // The sun: a hot core, spikes, a blue lens streak, a warm bloom.
  vec2 sx = vec2(sd.x + sd.y, sd.y - sd.x) * 0.7071;
  float spikes = spike(sd, px, 7.0) + spike(sd.yx, px, 7.0) + 0.5 * (spike(sx, px, 12.0) + spike(sx.yx, px, 12.0));
  col += vec3(1.0, 0.95, 0.85) * (exp(-sr * sr / 0.00025) * 2.2 + spikes * 0.5) + vec3(0.035, 0.021, 0.01) / (sr * 6.0 + 0.2);
  col += vec3(0.33, 0.45, 0.6) * exp(-abs(sd.y) / (px * 1.2 + 0.0015)) * exp(-abs(sd.x) * 1.8);
  // Grade: soft shoulder, vignette, lift toward deep blue.
  col = col / (1.0 + col * 0.4);
  col *= 1.0 - 0.35 * pow(length(uv - vec2(0.55, 0.5)) * 1.1, 2.5);
  color = vec4(pow(col, vec3(0.9)) + vec3(0.004, 0.008, 0.016), 1.0);
}
`;

/** Emberfall: A field of black crust cracked over molten rock, a lava river running from an erupting volcano, sparks rising. */
export const EMBERFALL_SHADER = `
float hash2(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), e = vec2(1.0, 0.0); f *= f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + e), f.x), mix(hash2(i + e.yx), hash2(i + 1.0), f.x), f.y); }
float fb(vec2 p) { return vn(p) * 0.55 + vn(p * 2.1 + 3.0) * 0.3 + vn(p * 4.3 + 7.0) * 0.15; }
// Crust plates of uneven sizes (weighted cells): x = distance to the crack, y = the plate's value.
vec2 plates(vec2 g) {
  vec2 i = floor(g), f = fract(g); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)); float h = hash2(i + o);
    vec2 r = o + 0.5 + 0.8 * (vec2(h, fract(h * 13.7)) - 0.5) - f;
    float d = length(r) * (0.65 + 0.7 * fract(h * 31.3));
    if (d < d1) { d2 = d1; d1 = d; id = h; } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, id);
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y);
  float px = 1.5 / iResolution.y, t = iTime;
  // The volcano: right of centre on wide, high on portrait.
  float wide = smoothstep(0.8, 1.4, ar);
  float hor = mix(0.5, 0.4, wide), vx = ar * mix(0.56, 0.69, wide), top = hor + mix(0.22, 0.3, wide);
  vec3 col;
  if (uv.y > hor) {
    float y = uv.y - hor;
    p.x += sin(uv.y * 30.0 + t * 0.7) * 0.002 * exp(-y * 14.0); // heat haze, slow and soft
    vec2 q = vec2(p.x - vx, uv.y - top);
    // Sky: smoke banks, red where the fire lights them.
    float s = fb(vec2(p.x * 1.6 - t * 0.015, y * 3.5 / (y + 0.4) - t * 0.01));
    col = mix(vec3(0.6, 0.1, 0.02), vec3(0.03, 0.015, 0.014), smoothstep(0.0, 0.45, y));
    col *= 0.15 + 1.6 * smoothstep(0.25, 0.75, s);
    col += vec3(0.8, 0.14, 0.02) * exp(-length(q * vec2(0.9, 0.6)) * 3.0) * 0.45;
    // The ash cloud: dark billows rolling up, swelling and leaning downwind, lit from beneath.
    float up = max(q.y, 0.0), xx = q.x + up * up * 0.9 + up * 0.1, w = 0.05 + up * 0.7 + up * up * 0.5;
    vec2 aq = vec2(xx, q.y - t * 0.03) * 3.2 / (0.22 + up);
    aq.x += sin(aq.y * 0.9 + t * 0.15) * 0.35; // edges rolling over
    float b1 = fb(aq), b2 = fb(aq + vec2(0.1, -0.35));
    float cloud = smoothstep(0.0, 0.16, 1.0 - abs(xx) / w + (b1 - 0.5) * (0.5 + 1.8 * min(up, 0.35)) + 0.3 * smoothstep(0.2, 0.0, up)) * smoothstep(-0.01, 0.02, q.y);
    float lit = clamp((b1 - b2) * 3.0 + 0.45, 0.0, 1.0), fire = exp(-up * 4.5);
    vec3 ash = vec3(0.045, 0.028, 0.025) * (0.6 + 0.8 * b1); // dark body, deeper in the folds
    ash += vec3(0.55, 0.11, 0.025) * lit * lit * (0.25 + 0.75 * exp(-up * 1.6)); // undersides glowing red
    ash += vec3(1.0, 0.45, 0.1) * lit * fire; // and burning over the crater
    col = mix(col, ash, cloud * 0.97);
    col += vec3(1.0, 0.55, 0.15) * exp(-abs(q.x) * 28.0 / (1.0 + up * 6.0)) * smoothstep(0.1, 0.0, q.y) * exp(-max(-q.y, 0.0) * 60.0) * (0.75 + 0.25 * vn(vec2(q.x * 15.0, q.y * 8.0 - t * 1.2))); // fire fountain
    // The cone: massive, rugged, a shoulder, a broken crater rim; the far shore behind.
    float rough = vn(vec2(p.x * 6.0, 4.0)) * 0.5 + vn(vec2(p.x * 17.0, 5.0)) * 0.32 + vn(vec2(p.x * 45.0, 6.0)) * 0.18;
    float ax = min(abs(q.x), 0.62), coneH = top - ax * (q.x > 0.0 ? 1.15 : 0.95) + ax * ax * 0.8 - max(abs(q.x) - 0.62, 0.0);
    coneH = max(coneH, top - 0.14 - (q.x + 0.23) * (q.x + 0.23) * 3.5); // the shoulder
    coneH = min(coneH, top + 0.012 * (vn(vec2(p.x * 55.0, 2.0)) - 0.5) - 0.028 * smoothstep(0.04, 0.0, abs(q.x + 0.006)));
    coneH += (rough - 0.5) * 0.09 * smoothstep(0.0, 0.06, abs(q.x + 0.006)); // crags, sparing the crater
    float cone = max(coneH, hor + 0.02 + 0.03 * vn(vec2(p.x * 6.0, 9.0)) + 0.035 * smoothstep(0.5, 0.9, vn(vec2(p.x * 4.0, 6.0))) * (1.0 + vn(vec2(p.x * 16.0, 7.0))));
    float dh = cone - uv.y;
    if (dh > -px) {
      // Lava channels meandering down, splitting, pulsing slowly.
      float v = top - uv.y;
      float u = q.x / (v + 0.04) + 0.7 * (vn(vec2(v * 4.0, 1.3)) - 0.5) + 0.35 * (vn(vec2(v * 11.0, q.x * 5.0)) - 0.5);
      float ua = u * 3.2 + 0.3, ub = u * 3.2 + 0.8 + (vn(vec2(v * 6.0, floor(u * 3.2 + 0.8))) - 0.5) * 1.6 * smoothstep(0.05, 0.2, v);
      float wd = 0.9 - v * 0.3, aa = px * 9.0 / (v + 0.04) + 0.01;
      float sa = (1.0 - abs(fract(ua) - 0.5) * 2.0) * step(0.3, hash2(vec2(floor(ua), 3.0)));
      float sb = (1.0 - abs(fract(ub) - 0.5) * 2.0) * step(0.45, hash2(vec2(floor(ub), 5.0))) * smoothstep(0.06, 0.12, v);
      float sm = max(sa, sb), ca = smoothstep(wd - aa, wd + aa, sm), cb = smoothstep(wd + 0.04 - aa, wd + 0.06 + aa, sm);
      float pulse = (0.65 + 0.35 * sin(t * 0.5 + floor(ua) * 2.3)) * (0.7 + 0.5 * vn(vec2(u * 4.0, v * 9.0 - t * 0.35)));
      float on = smoothstep(0.0, 0.025, coneH - uv.y) * smoothstep(0.015, 0.05, v);
      vec3 flank = vec3(0.032, 0.019, 0.017) * (0.5 + 0.6 * rough + 0.6 * vn(vec2(u * 7.0, v * 4.0))); // gullies down the flanks
      flank += (vec3(0.9, 0.2, 0.02) * ca + vec3(0.5, 0.45, 0.2) * cb + vec3(0.6, 0.1, 0.01) * smoothstep(wd - 0.2, wd, sm) * 0.35) * pulse * on; // glow, core, halo
      flank += vec3(0.9, 0.25, 0.04) * exp(-(uv.y - hor) * 25.0) * 0.45; // the field's glow on the foot
      flank += vec3(1.0, 0.38, 0.07) * exp(-v * 7.0) * smoothstep(0.32, 0.0, abs(q.x)) * (0.3 + 0.4 * rough); // the crater lights the upper flanks
      flank += vec3(1.0, 0.5, 0.1) * exp(-dh * 70.0) * smoothstep(0.08, 0.0, abs(q.x)) * 0.9; // the crater lip
      flank += vec3(0.9, 0.25, 0.04) * exp(-dh * 90.0) * 0.3; // rim lit by the fire
      col = mix(col, flank, smoothstep(-px, px, dh));
    }
  } else {
    // The lava field in perspective.
    float z = 1.0 / (hor - uv.y + 0.025), far = smoothstep(4.0, 22.0, z), pz = px * z * z;
    vec2 g = vec2((p.x - vx) * z * 0.6, z * 1.1);
    // The river winds out of the volcano toward us.
    float heat = fb(g * 0.3 + vec2(t * 0.02, 0.0));
    float rc = sin(z * 0.3 + 0.8) * 1.6 + sin(z * 0.75) * 0.5, rw = 0.5 + 0.15 * heat;
    float rd = abs(g.x - rc) - rw;
    // Heat: by the river, under the volcano, in patches.
    float H = clamp(max(exp(-max(rd, 0.0) * 0.8), exp(-abs(p.x - vx) * 2.5 - (hor - uv.y) * 7.0)) * 0.85 + (heat - 0.5) * 0.7, 0.0, 1.0);
    float warp = vn(g * 0.6);
    vec2 gw = g + vec2(warp, vn(g * 0.6 + 5.0)) * 1.4 + vec2(vn(g * 2.7), vn(g * 2.7 + 9.0)) * 0.3; // crooked plate edges
    vec2 pl = plates(gw);
    // Cracks: hairline and deep red where cool, wide and white-hot where not.
    float cw = mix(0.004, 0.11, H * H) * (0.6 + 0.8 * vn(gw * 2.0));
    float seam = smoothstep(cw + pz, max(cw - pz, 0.0) * 0.5, pl.x) * min(1.0, cw / pz + 0.15);
    float sunk = smoothstep(0.85 - 0.45 * H, 0.88 - 0.45 * H, pl.y) * smoothstep(0.32, 0.12, pl.x) * (0.4 + 0.5 * H); // plates half-sunk in glow
    vec3 molten = mix(vec3(0.42, 0.035, 0.01), vec3(1.0, 0.42, 0.05), smoothstep(0.1, 0.7, H)) + vec3(0.6, 0.5, 0.3) * smoothstep(cw * 0.6, 0.0, pl.x) * H * H * H;
    // The crust: rough, a faint red sheen, glowing where thin by the cracks.
    float tex = vn(gw * 4.0 + pl.y * 20.0) * (1.0 - far);
    vec3 crust = vec3(0.03, 0.019, 0.017) * (0.55 + 0.6 * pl.y) * (0.65 + 0.7 * tex);
    crust += vec3(0.32, 0.05, 0.02) * (0.25 + 0.75 * smoothstep(0.4, 0.85, vn(g * 1.1 + 7.0))) * (0.12 + 0.2 * exp(-abs(p.x - vx) * 2.0)) * (1.0 - far) * (0.5 + 0.8 * tex); // red sheen
    crust += vec3(0.8, 0.12, 0.01) * smoothstep(0.25, 0.0, pl.x) * H * 0.3;
    vec3 ground = mix(crust, molten, mix(max(seam, sunk), 0.2 + 0.35 * H, far));
    // The river flowing: bright core, hot streaks, floes of crust drifting toward us.
    float river = smoothstep(pz + 0.02, -0.02, rd), sx = (g.x - rc) / rw, fl = g.y + t * 0.45;
    float core = clamp(1.0 - sx * sx, 0.0, 1.0);
    float streak = vn(vec2(sx * 2.5, fl * 0.7));
    vec3 flow = mix(vec3(0.8, 0.13, 0.02), vec3(1.0, 0.6, 0.14), core) + vec3(0.6, 0.5, 0.3) * smoothstep(0.45, 0.85, streak) * core;
    float fn = vn(vec2(g.x * 2.2, fl * 1.5) + 3.0);
    float floe = smoothstep(0.6, 0.68, fn) * (1.0 - far);
    flow = mix(flow + vec3(0.4, 0.15, 0.0) * smoothstep(0.5, 0.6, fn) * (1.0 - floe), vec3(0.06, 0.03, 0.025), floe * 0.9);
    ground = mix(ground, flow, river);
    ground += vec3(0.9, 0.2, 0.02) * exp(-max(rd, 0.0) * 2.0) * 0.2; // the river's glow on the crust
    col = mix(ground, vec3(0.6, 0.12, 0.02), far * 0.5);
  }
  // Sparks rising on the heat.
  for (int i = 0; i < 2; i++) {
    float fi = float(i), sc = 8.0 + fi * 7.0;
    vec2 a = vec2(p.x * sc + t * 0.15 + sin(p.y * 4.0 + t * 0.7 + fi) * 0.5, p.y * sc - t * (1.0 + fi * 0.5));
    col += vec3(1.0, 0.62, 0.22) * motes(a, 0.11 - fi * 0.03, 0.22, fi * 4.0) * (1.0 - fi * 0.3);
  }
  col = col / (1.0 + col * 0.3);
  vec2 vg = (uv - vec2(0.6, 0.45)) * vec2(0.9, 1.2);
  color = vec4(col * (1.0 - 0.5 * dot(vg, vg)), 1.0);
}
`;

/** A stand-in game's background, with what it shows. */
export interface StandInBackground {
  /** The stand-in game's slug in STAND_IN_GAMES, or the name of a world with no cover yet. */
  slug: string;
  title: string;
  /** The kind of game, in a word or two: "Dark fantasy". */
  genre: string;
  /** What it shows, in a sentence. */
  summary: string;
  shader: string;
}

/** Every stand-in background, for the gallery and for any page that needs a game's world before real games bring their own. */
export const STAND_IN_BACKGROUNDS: StandInBackground[] = [
  { slug: "ashen-crown", title: "Ashen Crown", genre: "Dark fantasy", summary: "A ruined citadel on a crag against a swollen dying sun, the dusk burning behind it, embers rising and ash falling.", shader: ASHEN_CROWN_SHADER },
  { slug: "neon-drift", title: "Neon Drift", genre: "Street racing", summary: "A rain-slick skyway over a black bay into a towering neon city, light trails streaming both ways.", shader: NEON_DRIFT_SHADER },
  { slug: "hollow-tide", title: "Hollow Tide", genre: "Horror", summary: "At the waterline: a lighthouse sweeps the sea fog under the moon, and below, the drowned drift past something vast.", shader: HOLLOW_TIDE_SHADER },
  { slug: "verdant", title: "Verdant", genre: "Exploration", summary: "A colossal tree on its hill, the sun behind its crown pouring light over forests fading into golden haze.", shader: VERDANT_SHADER },
  { slug: "iron-vigil", title: "Iron Vigil", genre: "Mech war", summary: "A colossal walker stands guard against a hazy sun under a planet's ring, dust blowing over the dunes.", shader: IRON_VIGIL_SHADER },
  { slug: "glasswing", title: "Glasswing", genre: "Dreamlike adventure", summary: "A glass dragonfly the size of a mountain glides over a rose twilight lake, its wings bending the moon into prisms.", shader: GLASSWING_SHADER },
  { slug: "frostline", title: "Frostline", genre: "Survival", summary: "A lone climber on a knife-edge ridge in a blizzard, ice peaks fading into whiteout under a pale sun.", shader: FROSTLINE_SHADER },
  { slug: "kestrel", title: "Kestrel", genre: "Flight", summary: "A fighter high over a sea of cloud, gold-rimmed against the sun's glare, peaks breaking through below.", shader: KESTREL_SHADER },
  { slug: "starward", title: "Starward", genre: "Space", summary: "A ringed gas giant in crescent, its sun blazing past the edge, rays fanning over a vivid nebula.", shader: STARWARD_SHADER },
  { slug: "emberfall", title: "Emberfall", genre: "Survival", summary: "A field of black crust cracked over molten rock, a lava river running from an erupting volcano, sparks rising.", shader: EMBERFALL_SHADER },
];

/** For this round only: candidates for Zaisma's own background, shown on the gallery with ?backdrop=<name> to choose between. */
export const ZAISMA_SHARDS_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; float t = iTime;
  vec2 P = vec2(uv.x * ar, uv.y); float px = 1.5 / iResolution.y;
  vec2 Ld = vec2(-0.6, 0.8);
  float gleam = exp(-pow(dot(P, vec2(0.6, 0.4)) - (fract(t * 0.02) * 3.4 - 1.0), 2.0) * 5.0);
  vec2 off = vec2(0.0); float body = 0.0, hi = 0.0, lo = 0.0, fres = 0.0, line = 0.0;
  for (int k = 0; k < 6; k++) {
    float fk = float(k); vec2 hk = fract(vec2(fk * 0.618 + 0.31, fk * 0.4142 + 0.77));
    float z = fract(fk * 0.63 + 0.25);                                  // depth: 0 far, 1 near
    vec2 u = normalize(vec2(0.47 + 0.24 * (hk.x - 0.5), 0.88)), v = vec2(-u.y, u.x);
    vec2 c = vec2(ar * fract(fk * 0.382 + 0.1) + (0.06 + 0.1 * z) * sin(t * (0.012 + 0.02 * z) + fk * 2.1), 0.5 + 0.5 * (hk.y - 0.5));
    float w = 0.05 + 0.1 * hk.x * (0.4 + 0.6 * z), len = 0.42 + 0.35 * hk.y, sk = 1.2 * (hk.y - 0.5);
    vec2 q = P - c; float a = dot(q, u), b = dot(q, v);
    float ea = (abs(a + b * sk) - len) * 0.8, eb = abs(b) - w, sd = max(ea, eb);
    float cov = smoothstep(px, -px, sd);
    vec2 nn = eb > ea ? v * sign(b) : u * sign(a + b * sk);
    float bev = cov * (1.0 - smoothstep(0.0, 0.016 + 0.006 * z, -sd));
    off += cov * v * 0.035 * (hk.x - 0.4) - nn * bev * 0.03;            // the face shifts what's behind; the rim bends it hard
    float side = dot(nn, Ld);
    hi += bev * max(side, 0.0);
    lo += bev * max(-side, 0.0);
    line += cov * (1.0 - smoothstep(0.0, px * 1.6, -sd)) * (0.35 + 0.65 * max(side, 0.0));   // the polished edge itself
    fres += cov * clamp(0.5 + b / w * 0.5, 0.0, 1.0);                    // each face brighter toward its lit side
    body += cov;
  }
  hi = min(hi, 1.0) * (0.65 + 0.7 * gleam); line = min(line, 1.0) * (0.6 + 0.6 * gleam);
  // The field behind, read where the shards bend the light to: three soft pools of the theme's hints under a light from the top left.
  vec2 Q = P + off;
  vec2 qa = Q - vec2(ar * 0.25 + 0.1 * sin(t * 0.03), 0.72), qb = Q - vec2(ar * 0.78, 0.3 + 0.1 * cos(t * 0.025)), qc = Q - vec2(ar * 0.55, 1.05);
  float wa = exp(-dot(qa, qa) * 3.0), wb = exp(-dot(qb, qb) * 3.0), wc = exp(-dot(qc, qc) * 4.0);
  float top = clamp(1.0 - 0.35 * length(P - vec2(0.0, 1.0)) / max(ar, 1.0), 0.0, 1.0);
  // Light theme: pearl, pale blue, teal and violet through clear glass; white lit rims, cool grey far ones.
  vec3 light = vec3(0.915, 0.934, 0.962) + top * 0.035;
  light = mix(light, vec3(0.8, 0.86, 0.95), wa * 0.55);
  light = mix(light, vec3(0.82, 0.92, 0.91), wb * 0.5);
  light = mix(light, vec3(0.87, 0.85, 0.96), wc * 0.5);
  light = mix(light, vec3(1.0), min(body, 2.0) * 0.07 + min(fres, 1.0) * 0.12);
  light = mix(light, vec3(1.0), min(hi, 1.0) * 0.9);
  light = mix(light, vec3(0.7, 0.75, 0.84), min(lo, 1.0) * 0.45);
  light = mix(light, vec3(1.0), line);
  // Dark theme: night blue, teal and violet through smoked glass; moonlit rims.
  vec3 dark = vec3(0.034, 0.043, 0.064) + top * vec3(0.012, 0.016, 0.024);
  dark = mix(dark, vec3(0.11, 0.17, 0.28), wa * 0.6);
  dark = mix(dark, vec3(0.055, 0.17, 0.19), wb * 0.55);
  dark = mix(dark, vec3(0.14, 0.12, 0.25), wc * 0.5);
  dark += vec3(0.022, 0.03, 0.048) * min(body, 2.0) + vec3(0.03, 0.04, 0.06) * min(fres, 1.0);
  dark = mix(dark, vec3(0.5, 0.58, 0.72), min(hi, 1.0) * 0.62);
  dark = mix(dark, vec3(0.01, 0.012, 0.02), min(lo, 1.0) * 0.6);
  dark = mix(dark, vec3(0.72, 0.8, 0.94), line * 0.75);
  o = vec4(mix(light, dark, iDark), 1.0);
}
`;

export const ZAISMA_METAL_SHADER = `
float cutLine(vec2 P, vec2 c, float an, inout float id, inout float best, inout vec2 bn, float bit) {
  vec2 n = vec2(-sin(an), cos(an)); float d = dot(P - c, n);
  id += step(0.0, d) * bit;
  if (abs(d) < best) { best = abs(d); bn = n * sign(d); }
  return d;
}
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; float t = iTime;
  vec2 P = vec2(uv.x * ar, uv.y); float px = 1.5 / iResolution.y;
  float id = 0.0, best = 9.0; vec2 bn = vec2(0.0, 1.0);
  cutLine(P, vec2(ar * 0.55, 0.5), 0.86, id, best, bn, 1.0);
  cutLine(P, vec2(ar * 0.3, 0.18), 0.38, id, best, bn, 2.0);
  cutLine(P, vec2(ar * 0.78, 0.8), 0.38, id, best, bn, 4.0);
  cutLine(P, vec2(ar * 0.12, 0.72), -0.52, id, best, bn, 8.0);
  cutLine(P, vec2(ar * 0.92, 0.3), 1.3, id, best, bn, 16.0);
  // The light: from the top left, swinging slowly; each plane leans its own way.
  float a = 2.3 + 0.45 * sin(t * 0.04);
  vec3 L = normalize(vec3(cos(a), sin(a), 1.3));
  vec2 hp = h22(vec2(id, id * 0.37 + 1.0)), tilt = (hp - 0.5) * 0.32;
  float face = dot(normalize(vec3(tilt, 1.0)), L);
  // The bevel: a band along the nearest cut leaning out 45 degrees; across the cut the neighbour leans back.
  float bw = 0.012, inB = 1.0 - smoothstep(bw - px, bw + px, best);
  float sb = dot(normalize(vec3(bn, 1.0)), L);
  float bevel = mix(dot(normalize(vec3(-bn, 1.0)), L) * 0.5 + sb * 0.5, sb, smoothstep(0.0, px, best));
  float edge = clamp((bevel - face) * 2.4, -1.0, 1.0) * inB;
  // Satin: brushed along the long cut, a soft sheen sliding along each plane at its own lean, a studio light from the top left.
  vec2 u = vec2(cos(0.86), sin(0.86)), w = vec2(u.y, -u.x);
  float sheen = exp(-pow(dot(P, w) * 0.9 + tilt.x * 1.6 - (fract(t * 0.014) * 3.2 - 1.6), 2.0) * 3.5);
  float grain = noise(vec2(dot(P, u) * iResolution.y * 0.01, dot(P, w) * iResolution.y * 0.22)) - 0.5;
  float studio = exp(-dot(P - vec2(-0.1, 1.15), P - vec2(-0.1, 1.15)) * 0.35);
  float lit = min(max(edge, 0.0) * (0.7 + 0.8 * sheen), 1.0), shadow = max(-edge, 0.0);
  // Each plane mirrors a hint: mostly pale blue (night blue on dark), sometimes teal or violet.
  float hue = h1(id * 1.37 + 0.2);
  vec3 hint = hue < 0.5 ? vec3(0.725, 0.796, 0.902) : (hue < 0.75 ? vec3(0.753, 0.863, 0.859) : vec3(0.824, 0.796, 0.918));
  vec3 hintD = hue < 0.5 ? vec3(0.11, 0.173, 0.286) : (hue < 0.75 ? vec3(0.055, 0.18, 0.204) : vec3(0.141, 0.118, 0.247));
  // Light theme: satin pearl planes, white lit bevels, cool grey turned-away ones.
  vec3 light = mix(vec3(0.86, 0.875, 0.905), vec3(0.975, 0.98, 0.99), studio);
  light = mix(light, hint, 0.12 + 0.1 * hp.y);
  light *= 1.0 + (face - 0.8) * 0.5 + grain * 0.012;
  light += vec3(1.0, 0.99, 0.97) * sheen * 0.06;
  light = mix(light, vec3(1.0), lit);
  light = mix(light, vec3(0.64, 0.68, 0.77), shadow * 0.55);
  // Dark theme: graphite planes under moonlight, silver-blue lit bevels, near-black turned-away ones.
  vec3 dark = mix(vec3(0.04, 0.045, 0.058), vec3(0.14, 0.155, 0.19), studio);
  dark = mix(dark, hintD, 0.14 + 0.12 * hp.y);
  dark *= 0.95 + (face - 0.8) * 2.0 + grain * 0.05;
  dark += vec3(0.5, 0.6, 0.85) * sheen * 0.06;
  dark = mix(dark, vec3(0.56, 0.62, 0.75), lit * 0.85);
  dark = mix(dark, vec3(0.008, 0.01, 0.014), shadow * 0.75);
  o = vec4(mix(light, dark, iDark), 1.0);
}
`;

export const ZAISMA_CANDIDATE_SHADERS: Record<string, string> = { shards: ZAISMA_SHARDS_SHADER, metal: ZAISMA_METAL_SHADER };

/** The glass pass runners wrap round every shader: kept in core, so the game domain's runner and the shader check compile the same thing. */
export { GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT } from "@zaisma/core";
