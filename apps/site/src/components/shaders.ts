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

/** Stand-in games' backgrounds, written as their studios might: the complex end of what a shader background can be. */
export const NEON_DRIFT_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y, t = iTime;
  vec3 glow = vec3(0.95, 0.2, 0.62);
  vec3 col = mix(glow * 0.9, vec3(0.04, 0.015, 0.11), smoothstep(0.22, 0.95, uv.y));
  col += vec3(0.15, 0.7, 0.9) * 0.18 * exp(-abs(uv.y - 0.33) * 9.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = uv.x * ar * (10.0 - fi * 2.0) + fi * 17.3;
    float id = floor(x);
    float hgt = (0.5 - fi * 0.09) + (0.26 - fi * 0.04) * h1(id + fi * 31.0) + 0.12 * step(0.9, h1(id * 3.7 + fi));
    if (uv.y < hgt) {
      vec3 b = mix(vec3(0.2, 0.06, 0.32), vec3(0.025, 0.01, 0.06), fi / 3.0);
      vec2 w = vec2(fract(x) * 7.0, uv.y * (70.0 - fi * 10.0));
      vec2 wid = floor(w) + vec2(id * 13.0, fi * 7.0);
      float lit = step(0.6, h2(wid)) * step(0.2, fract(w.x)) * step(fract(w.x), 0.72) * step(0.25, fract(w.y)) * step(fract(w.y), 0.78);
      float flick = 0.65 + 0.35 * sin(t * (1.5 + h2(wid) * 5.0) + h2(wid) * 40.0);
      vec3 wc = mix(vec3(1.0, 0.3, 0.75), vec3(0.25, 0.95, 1.0), step(0.55, h2(wid + 3.1)));
      b += wc * lit * flick * (0.3 + fi * 0.18);
      b = mix(b, glow * 0.5, (1.0 - fi / 3.0) * 0.18);
      col = b;
    }
  }
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    vec2 r = vec2(uv.x * ar * (70.0 + fk * 50.0) + uv.y * 10.0, uv.y * (1.2 + fk) + t * (2.2 + fk * 0.8));
    float rid = floor(r.x), rr = h1(rid + fk * 9.0);
    float drop = fract(r.y + rr * 7.0);
    float streak = smoothstep(0.0, 0.02, drop) * smoothstep(0.14, 0.02, drop) * step(0.5, rr);
    float lane = smoothstep(0.55, 1.0, 1.0 - abs(fract(r.x) - 0.5) * 2.0);
    col += vec3(0.55, 0.9, 1.0) * streak * lane * (0.22 + fk * 0.12);
  }
  o = vec4(col, 1.0);
}`;

export const FROSTLINE_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y); float t = iTime * 0.15;
  vec3 col = mix(vec3(0.07, 0.16, 0.28), vec3(0.01, 0.03, 0.09), smoothstep(0.2, 1.0, uv.y));
  float s = h2(floor(f / 2.5)); col += vec3(0.85) * step(0.996, s) * (0.5 + 0.5 * sin(iTime * 2.0 + s * 50.0)) * smoothstep(0.45, 0.8, uv.y);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float band = 0.6 + fi * 0.08 + 0.07 * sin(p.x * 1.2 + t * 2.0 + fi * 2.1) + 0.08 * fbm(vec2(p.x * 1.4 + t + fi * 4.0, t * 0.6));
    float d = uv.y - band;
    float curtain = exp(-max(d, 0.0) * (9.0 + fi * 3.0)) * smoothstep(-0.05, 0.0, d);
    float rays = 0.45 + 0.55 * fbm(vec2(p.x * 14.0 + fi * 3.0, t * 4.0));
    vec3 c = mix(vec3(0.15, 1.0, 0.6), vec3(0.45, 0.35, 1.0), clamp(fi * 0.45 + 0.25 * sin(p.x * 0.8 + t), 0.0, 1.0));
    col += c * curtain * rays * 0.5;
  }
  float r1 = 0.36 + 0.13 * fbm(vec2(p.x * 1.1, 2.0)) + 0.07 * abs(sin(p.x * 2.1 + 0.7));
  if (uv.y < r1) { float k = (r1 - uv.y) * 5.0; col = mix(vec3(0.72, 0.84, 0.95), vec3(0.16, 0.24, 0.36), clamp(k, 0.0, 1.0)) + vec3(0.05, 0.25, 0.15) * exp(-k * 2.0) * 0.4; }
  float r2 = 0.2 + 0.1 * fbm(vec2(p.x * 1.8, 7.0)) + 0.05 * abs(sin(p.x * 3.3));
  if (uv.y < r2) { float k = (r2 - uv.y) * 6.0; col = mix(vec3(0.85, 0.92, 1.0), vec3(0.1, 0.16, 0.25), clamp(k, 0.0, 1.0)); }
  for (int j = 0; j < 2; j++) {
    float fj = float(j), sc = 18.0 + fj * 14.0;
    vec2 q = p * sc + vec2(sin(iTime * 0.4 + fj) * 1.5, iTime * (1.6 + fj * 0.9));
    col += vec3(1.0) * motes(q, 0.09 - fj * 0.02, 0.35, fj * 11.0) * (0.55 + fj * 0.2);
  }
  o = vec4(col, 1.0);
}`;

export const STARWARD_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y); float t = iTime * 0.03;
  float n = fbm(p * 1.6 + fbm(p * 2.4 + t) * 1.4 - t);
  vec3 col = mix(vec3(0.01, 0.015, 0.05), vec3(0.08, 0.12, 0.38), n);
  col += vec3(0.55, 0.15, 0.6) * pow(fbm(p * 2.2 - t * 1.3 + 4.0), 3.0) * 1.4;
  col += vec3(0.1, 0.6, 0.8) * pow(n, 4.0) * 0.8;
  vec2 g = floor(f / 3.0); float s = h2(g);
  col += vec3(0.9, 0.95, 1.0) * step(0.993, s) * (0.4 + 0.6 * sin(iTime * (1.0 + s * 3.0) + s * 80.0));
  vec2 bc = floor(p * 6.0); vec2 bl = fract(p * 6.0) - 0.5 - (h22(bc) - 0.5) * 0.6;
  float big = step(0.93, h2(bc + 2.0)) * (0.5 + 0.5 * sin(iTime * 0.8 + h2(bc) * 9.0));
  col += vec3(0.85, 0.9, 1.0) * big * (smoothstep(0.03, 0.0, length(bl)) + 0.25 * smoothstep(0.004, 0.0, abs(bl.x) * abs(bl.y) * 6.0) * smoothstep(0.35, 0.0, length(bl)));
  vec2 pc = vec2(ar * 0.74, 0.34); float pr = 0.17; vec2 d = p - pc; float r = length(d);
  if (r < pr) {
    vec3 n3 = vec3(d / pr, sqrt(max(0.0, 1.0 - dot(d, d) / (pr * pr))));
    float light = clamp(dot(n3, normalize(vec3(-0.7, 0.5, 0.5))), 0.0, 1.0);
    float bands = fbm(vec2(n3.y * 6.0, n3.x / (n3.z + 0.3) + iTime * 0.05));
    col = mix(vec3(0.15, 0.3, 0.55), vec3(0.6, 0.85, 0.95), bands) * (0.08 + light);
  }
  col += vec3(0.3, 0.6, 1.0) * smoothstep(pr + 0.03, pr, r) * smoothstep(pr - 0.01, pr + 0.01, r) * 0.6;
  vec2 rd = d * mat2(0.94, 0.34, -0.34, 0.94); rd.y *= 4.0; float rr = length(rd);
  float ring = smoothstep(0.012, 0.0, abs(rr - pr * 1.55)) * (rd.y < 0.0 || r > pr ? 1.0 : 0.0);
  col += vec3(0.7, 0.85, 1.0) * ring * 0.45;
  o = vec4(col, 1.0);
}`;

export const EMBERFALL_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y); float t = iTime;
  vec3 col = mix(vec3(0.75, 0.16, 0.03), vec3(0.06, 0.0, 0.01), smoothstep(0.0, 0.85, uv.y));
  col *= 0.75 + 0.35 * fbm(p * 2.5 + vec2(t * 0.05, -t * 0.12));
  float ridge = 0.3 + 0.16 * abs(fract(p.x * 0.9 + 0.3) * 2.0 - 1.0) + 0.08 * fbm(vec2(p.x * 3.0, 1.0));
  if (uv.y < ridge) {
    col = vec3(0.05, 0.012, 0.01) + vec3(1.0, 0.32, 0.05) * exp(-(ridge - uv.y) * 35.0) * 0.55;
    float lava = smoothstep(0.1, 0.0, uv.y) * (0.6 + 0.4 * fbm(vec2(p.x * 6.0 + t * 0.3, t * 0.4)));
    col += vec3(1.0, 0.4, 0.06) * lava;
  }
  for (int i = 0; i < 3; i++) {
    float fi = float(i), sc = 9.0 + fi * 8.0;
    vec2 q = vec2(p.x * sc + sin(uv.y * 6.0 + t * 0.8 + fi) * 0.6, p.y * sc - t * (1.4 + fi * 0.7));
    float m = motes(q, 0.12 - fi * 0.025, 0.42, fi * 5.0);
    float flick = 0.6 + 0.4 * sin(t * 6.0 + h2(floor(q)) * 30.0);
    col += vec3(1.0, 0.55, 0.15) * m * flick * (1.2 - fi * 0.25);
  }
  o = vec4(col, 1.0);
}`;

/** How many pieces of glass the runner tells a shader about: the largest ones in view. */
export const MOST_GLASS_PANE_COUNT = 16;

/**
 * The runner's pass round any shader's mainImage (BACKDROP_SCRIPT): glass that bends the backdrop's light. Under each piece of glass
 * it draws what's behind a little magnified and bent inward along the cut edge, as through thick glass; fainter under smoked glass.
 * The light the glass gathers along its edge is the pane's own rim (GLASS_SCRIPT's caustics), so it moves with the pane as the page
 * scrolls; the backdrop sits still under the page and could only follow a frame late. Everything is in the canvas's own pixels, from
 * its bottom left.
 */
export const GLASS_LIGHT_PASS = `
uniform vec4 zaismaPanes[${MOST_GLASS_PANE_COUNT}];     // each pane: left, bottom, right, top
uniform vec4 zaismaPaneCuts[${MOST_GLASS_PANE_COUNT}];  // its cut corners: top left, top right, bottom right, bottom left; 4096 added to the last on smoked glass
uniform float zaismaPaneCount;
uniform float zaismaPixel;      // canvas pixels per CSS pixel
uniform vec2 zaismaViewOffset;  // where the canvas sits in the scene it shows a part of (the gallery's framed examples), in its pixels
// Signed distance to a pane's cut shape (negative inside), and the outward normal of its nearest side.
float zaismaPaneShape(vec2 f, vec4 r, vec4 c, out vec2 n) {
  vec2 h = (r.zw - r.xy) * 0.5, q = f - (r.xy + r.zw) * 0.5, a = abs(q) - h;
  float d = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0), k = 0.70710678, e;
  n = a.x > a.y ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y));
  if (c.x > 0.0) { e = (dot(q, vec2(-1.0, 1.0)) - (h.x + h.y - c.x)) * k; if (e > d) { d = e; n = vec2(-k, k); } }
  if (c.y > 0.0) { e = (dot(q, vec2(1.0, 1.0)) - (h.x + h.y - c.y)) * k; if (e > d) { d = e; n = vec2(k, k); } }
  if (c.z > 0.0) { e = (dot(q, vec2(1.0, -1.0)) - (h.x + h.y - c.z)) * k; if (e > d) { d = e; n = vec2(k, -k); } }
  if (c.w > 0.0) { e = (dot(q, vec2(-1.0, -1.0)) - (h.x + h.y - c.w)) * k; if (e > d) { d = e; n = vec2(-k, -k); } }
  return d;
}
void main() {
  vec2 f = gl_FragCoord.xy, at = f;
  // The panes come smallest first, so a pane on a tray bends the light under it, not the tray.
  for (int i = 0; i < ${MOST_GLASS_PANE_COUNT}; i++) {
    if (float(i) >= zaismaPaneCount) break;
    vec4 cuts = zaismaPaneCuts[i]; float smoke = step(4096.0, cuts.w); cuts.w = mod(cuts.w, 4096.0);
    vec2 n; float d = zaismaPaneShape(f, zaismaPanes[i], cuts, n);
    float strength = mix(1.0, 0.5, smoke), rim = 18.0 * zaismaPixel;
    if (d < 0.0) {
      float depth = -d, edge = 1.0 - smoothstep(0.0, rim, depth);
      vec2 center = (zaismaPanes[i].xy + zaismaPanes[i].zw) * 0.5;
      // Thick glass: what's behind is magnified a little and bent inward along the rim, most at the very edge.
      at = center + (f - center) * (1.0 - 0.018 * strength) - n * rim * 0.45 * strength * edge * edge;
      break;
    }
  }
  vec4 color; mainImage(color, at + zaismaViewOffset);
  vec3 col = color.rgb;
  gl_FragColor = vec4(col, 1.0);
}`;
