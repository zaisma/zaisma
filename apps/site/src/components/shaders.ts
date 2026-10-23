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
 * Zaisma's own background: a sheet of cut crystal facets drifting slowly over a pearl field (graphite lit like moonlight on dark), with
 * bars of window light on the Z's diagonal sliding behind it and small orange nodes wandering, each facet refracting the light and the
 * nodes' glow its own way, a faint spectrum where the light breaks, and a soft studio light swinging across. iDark eases between the
 * two, so a change of theme fades.
 */
export const ZAISMA_SHADER = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; float t = iTime;
  vec2 P = vec2(uv.x * ar, uv.y); float px = 1.5 / iResolution.y;
  // Facets: nearest and second-nearest sites of a sheet drifting slowly; the crease is the line halfway between them.
  float sc = 1.55 * inversesqrt(min(ar, 1.0)); vec2 p = P * sc + vec2(0.012, 0.005) * t, g = floor(p), fr = fract(p);
  float d1 = 8.0, d2 = 8.0; vec2 r1 = vec2(0.0), r2 = vec2(1.0), c1 = vec2(0.0), c2 = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = vec2(float(i), float(j)), h = h22(g + c);
    vec2 r = c + 0.18 + 0.64 * h - fr; float d = dot(r, r);
    if (d < d1) { d2 = d1; r2 = r1; c2 = c1; d1 = d; r1 = r; c1 = g + c; } else if (d < d2) { d2 = d; r2 = r; c2 = g + c; }
  }
  vec2 n = normalize(r2 - r1); float edge = dot(0.5 * (r1 + r2), n) / sc;
  // Each facet leans; right at the crease the two leans meet over a couple of pixels.
  vec2 s1 = (h22(c1 * 1.7 + 3.1) - 0.5) * 0.9, s2 = (h22(c2 * 1.7 + 3.1) - 0.5) * 0.9;
  vec2 slope = mix(0.5 * (s1 + s2), s1, smoothstep(0.0, 1.5 * px, edge));
  vec3 N = normalize(vec3(-slope, 1.0));
  // Refraction: the field is seen shifted against the lean, blue a little further than red.
  vec2 off = -slope * 0.2;
  vec2 qR = P + off * 0.9, qG = P + off, qB = P + off * 1.12;
  // Bars of window light on the Z's diagonal, a wide one and a narrow one in each 0.9 of height, sliding slowly (each colour at its own shift).
  vec2 wd = vec2(0.66, -0.75);
  vec3 wx = fract((vec3(dot(qR, wd), dot(qG, wd), dot(qB, wd)) - t * 0.03) / 0.9) * 0.9;
  vec3 win = smoothstep(0.0, 0.02, wx) * smoothstep(0.24, 0.21, wx) + 0.6 * smoothstep(0.31, 0.325, wx) * smoothstep(0.39, 0.375, wx);
  // The nodes: small orange diamonds wandering, their glow read through the crystal.
  vec3 orange = vec3(0.969, 0.576, 0.102);
  vec3 glow = vec3(0.0); float core = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k); vec2 hk = fract(vec2(fk * 0.618 + 0.23, fk * 0.382 + 0.61)); float sp = 0.04 + 0.04 * hk.x;
    vec2 c = vec2(ar * (0.5 + 0.42 * sin(t * sp + 6.2831 * hk.y)), 0.5 + 0.38 * cos(t * sp * 0.83 + 6.2831 * hk.x));
    float dg = length(qG - c);
    glow += exp(-vec3(length(qR - c), dg, length(qB - c)) * 34.0) + 0.18 * exp(-dg * 9.0);
    vec2 q = qG - c; core = max(core, smoothstep(0.011 + px, 0.011 - px, abs(q.x) + abs(q.y)));
  }
  vec2 qa = qG - vec2(ar * 0.15, 0.9), qb = qG - vec2(ar * 0.9, 0.15);
  float wa = exp(-dot(qa, qa) * 2.0), wb = exp(-dot(qb, qb) * 2.0);
  // The studio light: a large soft box above the top left, swinging; facets leaning toward it mirror it, more at a slant (Fresnel).
  float a = 2.3 + 0.8 * sin(t * 0.12);
  vec3 Ls = normalize(vec3(cos(a) * 0.5, sin(a) * 0.5, 0.87));
  vec3 R = vec3(2.0 * N.z * N.xy, 2.0 * N.z * N.z - 1.0);
  float box = smoothstep(0.86, 0.995, dot(R, Ls));
  float fres = 0.05 + 0.7 * (1.0 - N.z);
  float sky = clamp(dot(N.xy, normalize(Ls.xy)) * 2.5, -1.0, 1.0);      // facets turned toward the light catch more of the room
  float crease = smoothstep(4.0 * px, 0.0, edge);                       // a soft shadowed line where two facets meet
  // ...and a glint gliding along the creases that face the light, a few pixels wide.
  float glint = exp(-edge / (2.5 * px)) * pow(abs(dot(n, normalize(Ls.xy))), 6.0) * exp(-pow(dot(P, vec2(0.8, 0.6)) - (fract(t * 0.05) * (ar + 2.3) - 0.9), 2.0) * 10.0);
  // Light theme: pearl field, the window light white, faintly cool crystal.
  vec3 lf = vec3(0.9, 0.915, 0.945);
  lf = mix(lf, vec3(0.82, 0.86, 0.94), wa * 0.5);
  lf = mix(lf, vec3(0.86, 0.84, 0.94), wb * 0.45);
  lf = mix(lf, vec3(1.0, 0.995, 0.985), min(win, vec3(1.0)) * 0.9);
  lf = mix(lf, orange, min(glow * 0.6, vec3(0.9)));
  lf = mix(lf, vec3(1.0, 0.76, 0.42), core);
  vec3 light = lf * (0.95 + 0.08 * sky) * mix(vec3(1.0), vec3(0.92, 0.95, 0.99), length(slope));
  light = mix(light, vec3(1.0), clamp(fres * box * 2.2 + glint * 0.8, 0.0, 0.85));
  // Dark theme: graphite and night-blue field, moonlit window bars, the nodes glowing through smoky crystal.
  vec3 df = vec3(0.03, 0.037, 0.054);
  df = mix(df, vec3(0.08, 0.12, 0.22), wa * 0.6);
  df = mix(df, vec3(0.11, 0.09, 0.2), wb * 0.55);
  df += vec3(0.1, 0.125, 0.175) * min(win, vec3(1.0));
  df += orange * glow;
  df = mix(df, vec3(1.0, 0.8, 0.5), core);
  vec3 dark = df * (0.92 + 0.12 * sky) * mix(vec3(1.0), vec3(0.8, 0.88, 1.0), length(slope));
  dark += vec3(0.34, 0.4, 0.54) * clamp(fres * box * 1.8, 0.0, 0.6);
  dark *= 1.0 - 0.12 * crease;
  dark += vec3(0.5, 0.58, 0.75) * glint * 0.6;
  vec3 col = mix(light, dark, iDark) + (h2(f) - 0.5) / 255.0;        // a still dither against banding
  o = vec4(col, 1.0);
}
`;

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

// Neon fog along the skyline: magenta and violet with pockets of cyan, drifting.
vec3 fogc(float x, float t) {
  float a = sin(x * 2.3 + 1.0 - t * 0.02);
  return mix(mix(vec3(1.0, 0.24, 0.6), vec3(0.6, 0.2, 1.0), 0.5 + 0.5 * sin(x * 5.0 + a * 2.0)), vec3(0.25, 0.8, 1.0), smoothstep(0.75, 1.0, a) * 0.5);
}

// The city at q, drawn front to back so hidden layers cost nothing; full = 0 for reflections.
vec3 city(vec2 q, float px, float t, float full) {
  vec3 glow = vec3(1.0, 0.26, 0.58), fog = fogc(q.x, t), acc = vec3(0.0), add = vec3(0.0);
  float T = 1.0, xs = abs(q.x), low = exp(-q.y * 9.0);
  for (int j = 0; j < 4; j++) {
    if (T < 0.003) break;
    if (j == 2) {
      // The arcology at the road's end: tiers, a needle, a holo ring, a beacon
      if (xs > 0.17 || q.y > 0.72) continue;
      float d = min(min(max(xs - 0.07, q.y - 0.17), max(xs - 0.048, q.y - 0.36)), min(max(xs - 0.03, q.y - 0.5), max(xs - 0.004, q.y - 0.6)));
      float m = smoothstep(px, -px, d), w = q.y < 0.17 ? 0.07 : (q.y < 0.36 ? 0.048 : 0.03), fade = smoothstep(0.17, 0.11, xs);
      vec3 tc = vec3(0.07, 0.02, 0.14) + vec3(0.25, 0.9, 1.0) * smoothstep(0.005, 0.0, abs(xs - w + 0.005)) * 0.9;
      tc += vec3(1.0, 0.3, 0.75) * smoothstep(0.55, 0.8, abs(fract(q.y * 24.0) - 0.5) * 2.0) * 0.25 * (1.0 - xs / w * 0.6);
      tc += vec3(1.0, 0.75, 0.95) * smoothstep(0.01, 0.0, min(min(abs(q.y - 0.166), abs(q.y - 0.356)), abs(q.y - 0.496))) * 0.7;
      add += T * vec3(0.9, 0.3, 0.8) * exp(-abs(d) / 0.03) * 0.15 * fade;
      if (full > 0.5 && abs(q.y - 0.41) < 0.08) {
        // The ring, only ever seen directly: bright arcs circling (sin 3x angle from the unit vector, no atan)
        vec2 e = vec2(q.x / 0.12, (q.y - 0.41) / 0.024), n = e / max(length(e), 0.001);
        float rd = abs(length(e) - 1.0) * 0.024, arc = 0.35 + 0.65 * smoothstep(0.3, 1.0, n.y * (3.0 - 4.0 * n.y * n.y) * cos(t * 0.9) - n.x * (4.0 * n.x * n.x - 3.0) * sin(t * 0.9));
        add += T * vec3(0.3, 1.0, 0.95) * (smoothstep(px * 2.0, 0.0, rd) * arc * (e.y < 0.0 ? 1.0 : 1.0 - m * 0.8) + exp(-rd / 0.012) * 0.12 * fade);
      }
      if (q.y > 0.58) add += T * vec3(1.0, 0.1, 0.2) * smoothstep(0.006, 0.0, length(q - vec2(0.0, 0.605))) * (0.6 + 0.4 * sin(t * 3.0));  // beacon
      acc += T * m * mix(tc, fog * 0.7, low * 0.6); T *= 1.0 - m;
      continue;
    }
    // Towers in three layers, near (fi = 3) to far (fi = 1): far ones melt into the fog, near ones are dark and crisp
    float fi = j < 2 ? 3.0 - float(j) : 1.0;
    float sc = 20.0 - fi * 4.7;
    if (q.y > 0.18 + fi * 0.047 + step(1.5, fi) * 0.075 + (xs + 0.5 / sc) * (0.05 + fi * 0.17) || (full < 0.5 && j == 3)) continue;
    float off = fi * 7.31, cx = q.x * sc + off, id = floor(cx), fx = fract(cx) - 0.5;
    float r = hs1(id + fi * 13.7), r2 = fract(r * 13.1 + 0.3), r3 = fract(r * 7.7 + 0.6), wid = 0.28 + 0.16 * r2;
    if (fi > 2.5 && r < 0.4 && xs < 0.75) continue;  // gaps in the nearest row open views deep into the city
    float top = 0.06 + fi * 0.012 + (0.07 + fi * 0.035) * r + abs(id + 0.5 - off) / sc * (0.05 + fi * 0.17);
    // Body, a setback crown on some, a mast on others
    float sb = (0.012 + 0.03 * r) * step(0.5, r2), mx = (r3 - 0.5) * wid * 0.8, mh = (sb + 0.03 + 0.04 * r) * step(0.45, r3) * step(1.5, fi) * full;
    float d = min(min(max((abs(fx) - wid) / sc, q.y - top), max((abs(fx) - wid * 0.6) / sc, q.y - top - sb)), max(abs(fx - mx) / sc - 0.0012, q.y - top - mh));
    if (d > 0.05) continue;  // open sky well clear of this tower and its glows
    float m = smoothstep(px, -px, d);
    vec3 bc = mix(fog * (0.5 + 0.35 * low), vec3(0.022, 0.008, 0.05), (0.18 + fi * 0.26) * (1.0 - low * (0.85 - fi * 0.2)));
    vec3 nc = mix(vec3(1.0, 0.2, 0.7), vec3(0.2, 0.95, 1.0), step(0.7, r));
    // Aircraft warning lamp on each mast, pulsing slowly
    float ld = length(vec2((fx - mx) / sc, q.y - top - mh));
    if (mh > 0.0 && ld < 0.03 && full > 0.5) add += T * vec3(1.0, 0.12, 0.15) * (smoothstep(0.0045, 0.0, ld) + exp(-ld * 160.0) * 0.3) * (0.3 + 0.7 * smoothstep(0.25, 0.0, abs(fract(t * 0.4 + r * 5.0) - 0.15)));
    // Neon signs: strips or bands, tubes brightest at the rim
    float band = step(0.8, r2), on = step(0.45, r) * step(1.5, fi) * (1.0 - step(0.72, r2) * step(2.5, fi));
    float sd = max((abs(fx - (r - 0.5) * wid * (1.0 - band)) - mix(0.05, 0.3, band)) / sc, abs(q.y - top * (0.35 + 0.3 * r2)) - top * mix(0.18, 0.05, band));
    // Holo panels: big blocks and bars of colour, cycling slowly, glowing into the haze
    float hp = step(0.72, r2) * step(2.5, fi), pw = wid * 0.85, pcy = top * (0.5 + 0.2 * r), phh = top * 0.13 + 0.015, pd = 1.0, blk = 0.0;
    vec2 pu = vec2(fx / pw, (q.y - pcy) / phh); vec3 pc = vec3(0.0);
    if (hp > 0.5) {
      pd = max((abs(fx) - pw) / sc, abs(q.y - pcy) - phh); blk = floor((pu.x + 1.0) * 1.5);
      pc = mix(mix(vec3(1.0, 0.15, 0.6), vec3(0.15, 0.9, 1.0), 0.5 + 0.5 * sin(t * 0.25 + blk * 2.1 + r * 6.0)), vec3(1.0, 0.6, 0.2), step(0.8, fract(blk * 0.37 + r * 3.0)));
      add += T * pc * exp(-max(pd, 0.0) * 50.0) * 0.28;
    }
    if (fi > 1.5 && m > 0.0) {
      bc += mix(glow, nc, 0.5) * smoothstep(px * 2.0, 0.0, (fx * sign(-q.x) + wid) / sc) * 0.12 * fi + nc * smoothstep(px, -px, sd) * (0.45 + 0.55 * smoothstep(-0.006, -0.001, sd)) * on;
      if (full > 0.5 && fi > 1.5) {
        // Windows: floors of varied height lit as bands, scattered or dark; warm and cool, a few flickering
        float fy = q.y * (55.0 + 55.0 * r2) * (1.0 + (3.0 - fi) * 0.3), fl = floor(fy), fh = hs1(fl + id * 7.7);
        float wx = (fx + 0.5) * (8.0 + floor(r * 5.0) * 2.0), wh = hs1(floor(wx) * 3.3 + fl * 1.7 + id * 5.1);
        float lit = fh > 0.8 ? 1.0 : (fh > 0.5 ? step(0.6, wh) : step(0.96, wh));
        if (lit > 0.0) {
          float shape = smoothstep(0.5, 0.3, abs(fract(fy) - 0.5)) * mix(smoothstep(0.5, 0.28, abs(fract(wx) - 0.5)), 1.0, step(0.8, fh) * step(0.45, r3));
          vec3 wc = mix(mix(vec3(1.0, 0.62, 0.38), vec3(0.45, 0.8, 1.0), step(0.5, fract(wh * 7.0 + r))), vec3(1.0, 0.4, 0.85), step(0.86, fract(wh * 13.0)));
          bc += wc * shape * step(abs(fx), wid - 0.03) * (fi - 0.6) * 0.06 * (1.0 - 0.7 * step(0.975, wh) * abs(fract(t * (0.1 + wh * 0.3) + wh * 7.0) * 2.0 - 1.0));
        }
      }
      float inP = smoothstep(px, -px, pd) * hp;
      if (inP > 0.0) bc = mix(bc, pc * (full > 0.5 ? (0.55 + 0.45 * step(0.35, fract(pu.y * 1.5 + blk * 0.43))) * smoothstep(1.0, 0.86, abs(fract((pu.x + 1.0) * 1.5) - 0.5) * 2.0) * (0.85 + 0.15 * sin(q.y * 900.0)) : 0.8), inP * 0.85);
    }
    if (on > 0.5) add += T * nc * exp(-max(sd, 0.0) * 160.0) * 0.25 * (1.0 - m * 0.5);
    acc += T * m * bc; T *= 1.0 - m;
  }
  if (T > 0.003) {
    // Sky: the fog's glow under violet night, smog lit from below
    vec3 col = mix(mix(fog, vec3(0.3, 0.06, 0.44), smoothstep(0.0, 0.28, q.y)), vec3(0.035, 0.012, 0.09), smoothstep(0.22, 0.85, q.y));
    col += vec3(1.0, 0.55, 0.8) * exp(-length(vec2(q.x * 0.5, q.y)) * 8.0) * 0.4;
    float c = 0.5;
    if (full > 0.5) c = noise(vec2(q.x * 2.0 + t * 0.012, q.y * 6.0)) * 0.8 + 0.1 * sin(q.x * 9.0 - q.y * 20.0 + t * 0.1);
    acc += T * (col + mix(vec3(0.85, 0.18, 0.6), vec3(0.35, 0.1, 0.55), smoothstep(0.0, 0.5, q.y)) * smoothstep(0.35, 0.85, c) * (smoothstep(1.1, 0.05, q.y) * 0.75 + 0.12));
  }
  // Street-level neon fog blooming along the foot of the city
  return acc + add + fog * exp(-q.y * 16.0) * 0.55;
}

// Street lamps along both barriers; reflections pass the mirrored point.
float lamps(vec2 q, float px) {
  if (abs(q.y - 0.463 * abs(q.x)) > 0.12) return 0.0;  // lamps sit on one line per side
  float dx = abs(q.x), zn = max(floor(0.36 / max(dx, 0.001) + 0.5), 1.0) * 3.0;
  float d = length(vec2(dx, q.y) - vec2(1.08, 1.05 - CAM) / zn), size = max(0.05 / zn, px);
  return (smoothstep(size, 0.0, d) + exp(-d / (size * 3.0)) * 0.35) * smoothstep(60.0, 20.0, zn);
}

void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y, t = iTime, wide = clamp((ar - 0.6) / 1.0, 0.0, 1.0);
  float hz = mix(0.5, 0.4, wide), s = mix(0.8, 1.0, wide), px = 1.5 / iResolution.y / s;
  vec2 q = (vec2(uv.x * ar, uv.y) - vec2(ar * mix(0.5, 0.6, wide), hz)) / s;  // scene units from the vanishing point
  // Below the horizon the deck (depth z, lateral X) and the bay mirror the city, stretched and rippled; one city per pixel
  float down = step(q.y, 0.0), z = CAM / max(-q.y, 0.0001), X = q.x * z, bay = step(1.08, abs(X));
  vec2 m = q;
  if (down > 0.5) {
    float rw = mix(X * 3.0, q.x * 40.0, bay);
    m = vec2(q.x + sin(rw * 2.1 + z * 1.3 - t * 0.6) * sin(rw * 1.3 - z * 2.2 + t * 0.45) * 0.5 * mix(0.012 / (1.0 + z * 0.1), 0.007, bay), -q.y * mix(0.4, 0.5, bay));
  }
  vec3 col = city(m, px * (1.0 + down), t, 1.0 - down) + vec3(0.85, 0.8, 1.0) * lamps(m, px * (1.0 + down * 2.0));
  if (down > 0.5) {
    vec3 refl = col, road = vec3(0.02, 0.01, 0.04) + refl * (0.3 + 0.45 * smoothstep(1.5, 12.0, z));
    if (bay < 0.5) {
      // Lane dashes, fading with distance
      road += vec3(0.6, 0.5, 0.7) * smoothstep(px + 0.01 / z, 0.01 / z - px, abs(fract(X * 2.0 + 0.5) - 0.5) / 2.0 / z) * step(0.55, fract(z * 0.35)) * step(abs(X), 0.75) * 0.3 * smoothstep(25.0, 4.0, z);
      // Light trails: headlights coming on the left, tail lights going on the right, a pair of lamps per car
      for (int k = 0; k < 4; k++) {
        float fk = float(k), xc = -0.75 + fk * 0.5, away = step(1.5, fk), w = 0.022 / z, wd = max(w, px * 0.5), dl = abs(abs(X - xc) - 0.07) / z;
        float u = z * 0.11 + (1.0 - 2.0 * away) * t * (0.3 + 0.06 * fk) + fk * 0.37, ph = mix(fract(u), 1.0 - fract(u), away);
        float comet = smoothstep(0.0, 0.025, ph) * max(1.0 - ph / (0.25 + 0.5 * hs1(floor(u) + fk * 7.0)), 0.0);
        comet *= sqrt(comet);
        vec3 tc = mix(vec3(0.7, 0.97, 1.0), vec3(1.0, 0.12, 0.42), away);
        road += tc * (0.1 + 2.4 * comet) * min(1.0, w / wd) * (smoothstep(wd + px, wd - px, dl) + exp(-dl / (wd * 4.0 + 0.003)) * 0.3);
        road += mix(tc, vec3(1.0), 0.4) * smoothstep(0.0, 0.05, ph) * exp(-ph * 10.0) * exp(-abs(X - xc) / z / (w * 8.0 + 0.008)) * 0.25;
      }
    } else {
      // Barriers with an LED strip, the drop to the bay beyond
      float zb = 1.08 / max(abs(q.x), 0.001);
      road = q.y > -CAM / zb && q.y < (0.14 - CAM) / zb ? vec3(0.06, 0.025, 0.1) + refl * 0.06 : vec3(0.008, 0.004, 0.025) + refl * (0.6 + 0.4 * noise(vec2(q.x * 60.0, q.y * 3.0)));
      road += vec3(0.3, 0.95, 1.0) * smoothstep(px * 1.5 + 0.008 / zb, 0.0, abs(q.y + (CAM - 0.14) / zb)) * 0.9;
    }
    col = mix(road, vec3(0.85, 0.25, 0.55), mix((1.0 - exp(-z * 0.035)) * 0.8, exp(q.y * 60.0) * 0.3, bay));
  }
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
float smin(float a, float b, float k) { float h = sat(0.5 + 0.5 * (b - a) / k); return mix(b, a, h) - k * h * (1.0 - h); }
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * sat(dot(pa, ba) / dot(ba, ba))) - r; }
// A limb: two capsules, a to b to c.
float limb(vec2 u, vec2 a, vec2 b, vec2 c, float r) { return min(seg(u, a, b, r), seg(u, b, c, r * 0.8)); }
// A lamp beam at angle a around the tower (0 = right, pi/2 = toward us).
float beam(vec2 q, float a) {
  float c = cos(a), u = q.x * sign(c), w = 0.005 + max(u, 0.0) * (0.48 - 0.4 * abs(c)), y = q.y + u * 0.035;
  return exp(-y * y / (w * w) - max(u, 0.0) / (0.06 + 1.4 * abs(c))) * smoothstep(-0.004, 0.012, u) * (0.5 + 0.4 * sin(a));
}
// Glitter on the far swells: rows of slow-twinkling dashes; rows under ~3 px melt into a soft line.
float dashes(vec2 p, float d, float t) {
  float v = sqrt(d + 0.004) * 60.0, row = floor(v), rc = (row + 0.5) / 60.0;
  float x = (p.x + h1(row) * 7.0 + t * 0.003) / (0.06 * rc + 0.003), hr = h2(vec2(floor(x), row)), len = 0.15 + 0.25 * hr;
  float dash = smoothstep(len, len - 0.12, abs(fract(x) - 0.5 - (hr - 0.5) * 0.4)) * smoothstep(0.5, 0.1, abs(fract(v) - 0.5)) * step(0.35, fract(hr * 13.7));
  return mix(0.35, dash * sat(sin(t * (0.5 + hr) + hr * 40.0) * 1.4 + 0.4), smoothstep(2.5, 5.0, rc / 30.0 * iResolution.y));
}
// The drowned body (feet 0, crown 1): limp, arms drifting up, torn shirt and hair streaming.
float body(vec2 u, float t) {
  float l = 0.03 * sin(t * 0.45), m = 0.03 * sin(t * 0.37 + 1.0), cy = sat((0.66 - u.y) / 0.3);
  float d = smin(length((u - vec2(0.075, 0.79)) / vec2(0.85, 1.1)) - 0.06, seg(u, vec2(0.03, 0.7), vec2(-0.02, 0.45), 0.072), 0.05);
  d = smin(d, limb(u, vec2(-0.05, 0.69), vec2(-0.14, 0.83 + l), vec2(-0.1 + l, 0.97 + l), 0.032), 0.04);
  d = smin(d, limb(u, vec2(0.09, 0.68), vec2(0.2, 0.76 - m), vec2(0.26 + m, 0.9), 0.032), 0.04);
  d = smin(d, limb(u, vec2(-0.03, 0.46), vec2(-0.08, 0.23), vec2(-0.05 + m, 0.03), 0.042), 0.04);
  d = smin(d, limb(u, vec2(0.04, 0.46), vec2(0.11, 0.26), vec2(0.17 + l, 0.11), 0.042), 0.04);
  float hem = 0.34 + 0.04 * sin(u.x * 30.0 - t * 1.1) + 0.025 * sin(u.x * 61.0 + t * 0.7);
  d = smin(d, max(abs(u.x - 0.02 - 0.07 * cy * cy - 0.02 * sin(t * 0.5)) - mix(0.075, 0.16, cy), max(u.y - 0.7, hem - u.y)), 0.02);
  vec2 dir = vec2(-0.682, 0.732), e = u - vec2(0.07, 0.82);
  for (int i = 0; i < 6; i++) {                                                       // hair: a fan of slow, wavering strands
    float fi = float(i), al = dot(e, dir), ac = dot(e, vec2(dir.y, -dir.x)) - 0.7 * al * al - 0.16 * al * sin(al * 15.0 - t * 0.9 + fi * 1.3);
    d = min(d, max(abs(ac) - mix(0.017, 0.006, sat(al / 0.3)), max(-al, al - 0.24 - 0.08 * fract(fi * 0.618))));
    dir = mat2(0.964, -0.267, 0.267, 0.964) * dir;
  }
  return d;
}
void mainImage(out vec4 color, in vec2 pixel) {
  float ar = iResolution.x / iResolution.y, wide = smoothstep(0.7, 1.5, ar), px = 1.5 / iResolution.y, t = iTime;
  vec2 p = pixel / iResolution.y;
  float wl0 = mix(0.6, 0.46, wide), hz = wl0 + 0.05, sc = mix(0.72, 1.0, wide);
  float wl = wl0 + 0.011 * sin(p.x * 5.0 - t * 0.9) + 0.005 * sin(p.x * 13.0 + t * 1.3) + 0.0025 * sin(p.x * 29.0 - t * 2.1);
  vec2 moon = vec2(mix(0.26, 0.42, wide) * ar, mix(0.91, 0.69, wide));
  float lx = mix(0.68, 0.7, wide) * ar, rx = p.x - lx, dm = length(p - moon), top = wl0 + mix(0.23, 0.24, wide), a = mod(t, 32.0) * 0.19635;
  vec2 lamp = vec2(lx, top + 0.016);
  // Where the two beams (one turn in 32 s) fall on the water.
  float onSea = 0.0;
  for (int b = 0; b < 2; b++) {
    float ab = a + float(b) * 3.1416, u = rx * sign(cos(ab));
    onSea += exp(-max(u, 0.0) / (0.05 + 1.2 * abs(cos(ab)))) * smoothstep(-0.02, 0.03, u) * (0.5 + 0.4 * sin(ab));
  }
  float fogN = noise(vec2(p.x * 2.2 - t * 0.045, p.y * 6.0 + sin(p.x * 1.3 + t * 0.03))) * 0.6 + noise(vec2(p.x * 5.0 - t * 0.085, p.y * 13.0)) * 0.4;
  vec3 col;
  if (p.y > wl) {
    if (p.y > hz) {
      // Sky: haze, halo, stars, cloud streaks, a far headland.
      float k = sat((p.y - hz) / (1.0 - hz)), hx = sat(1.0 - p.x / ar * 1.75);
      col = mix(vec3(0.08, 0.27, 0.27), vec3(0.008, 0.035, 0.045), pow(k, 0.6)) + vec3(0.1, 0.2, 0.19) * exp(-dm * 2.2) + vec3(0.2, 0.28, 0.26) * exp(-dm * 7.0) + vec3(0.4, 0.45, 0.42) * exp(-dm * 30.0);
      vec2 sg = p * 70.0;
      col += vec3(0.8, 0.95, 0.95) * motes(sg, 0.13, 0.08, 3.0) * (0.6 + 0.4 * sin(t * 1.1 + h2(floor(sg)) * 40.0)) * smoothstep(0.2, 0.5, k) * smoothstep(0.12, 0.3, dm);
      col = mix(col, vec3(0.08, 0.17, 0.18) + vec3(0.6, 0.72, 0.68) * exp(-dm * 4.0), smoothstep(0.5, 0.8, fogN) * smoothstep(1.0, 0.7, p.y) * smoothstep(hz + 0.08, hz + 0.18, p.y) * 0.6);
      col = mix(col, vec3(0.05, 0.18, 0.19), fill(p.y - hz - (0.028 * hx + 0.007 * sin(p.x * 11.0) + 0.004 * sin(p.x * 23.0 + 1.0)) * hx, px) * 0.8);
      // The moon, mottled, veiled by passing mist.
      vec2 mq = (p - moon) / 0.046;
      vec3 mc = vec3(0.95, 0.97, 0.9) - vec3(0.17, 0.15, 0.12) * smoothstep(0.42, 0.72, noise(mq * 1.7 + 3.0) * 0.65 + noise(mq * 4.3 + 9.0) * 0.35) - 0.1 * dot(mq, mq);
      col = mix(col, mix(mc, vec3(0.5, 0.62, 0.6), smoothstep(0.55, 0.85, fogN) * 0.35), fill(dm - 0.046, px));
    } else {
      // The far sea: swells, the moon's glitter path, beam light.
      float d = hz - p.y, gw = (p.x - moon.x) / (0.02 + d * 1.6), swl = 0.5 + 0.5 * sin(0.15 / (d + 0.004) + t * 0.6 + sin(p.x * 3.0) * 1.5);
      col = mix(vec3(0.08, 0.26, 0.26), vec3(0.015, 0.06, 0.07), sat(d * 25.0)) + vec3(0.03, 0.1, 0.1) * swl * smoothstep(0.004, 0.018, d);
      col += vec3(0.85, 0.96, 0.92) * (exp(-gw * gw) * dashes(p, d, t) * (0.6 + 0.6 * swl) + exp(-gw * gw * 0.15) * 0.08) + vec3(0.8, 0.92, 0.85) * onSea * (0.25 + 0.5 * swl) * smoothstep(0.0, 0.02, d);
    }
    // The crag; the banded tower, gallery, roof and lamp.
    float sh = sat(1.0 - pow(rx / (0.115 * mix(0.8, 1.0, wide)), 2.0)), rockTop = wl0 + sh * (0.062 + 0.022 * abs(sin(rx * 30.0 + 1.0)) + 0.006 * sin(rx * 97.0));
    col = mix(col, vec3(0.01, 0.022, 0.026) + vec3(0.12, 0.2, 0.19) * smoothstep(0.012, 0.0, rockTop - p.y) * sat(0.5 - rx * 8.0), fill(p.y - rockTop, px) * step(0.001, sh));
    float ty = (p.y - wl0 - 0.066) / (top - wl0 - 0.066), hw = mix(0.018, 0.011, ty);
    col = mix(col, mix(vec3(0.07, 0.11, 0.11), vec3(0.015, 0.03, 0.035), sat((rx + hw) / hw)) * (0.75 + 0.25 * step(0.5, fract(ty * 3.0))), fill(abs(rx) - hw, px) * step(0.0, ty) * step(ty, 1.0));
    float roof = max(fill(abs(rx) - 0.02, px) * fill(abs(p.y - top - 0.003) - 0.003, px), fill(abs(rx) - 0.012 * sat((top + 0.04 - p.y) / 0.015), px) * step(top + 0.025, p.y) * step(p.y, top + 0.04));
    col = mix(mix(col, vec3(0.02, 0.035, 0.04), roof), vec3(1.0, 0.96, 0.82), fill(abs(rx) - 0.01, px) * fill(abs(p.y - top - 0.016) - 0.009, px));
    // A fog bank on the horizon and a thin layer at lamp height; the beams and the glare.
    float bankTop = hz + 0.03 + 0.035 * noise(vec2(p.x * 2.4 - t * 0.035, 4.0)) + 0.03 * (fogN - 0.5);
    float fog = sat(smoothstep(-0.02, 0.05, bankTop - p.y) * (0.2 + 0.8 * fogN) * smoothstep(wl0 - 0.01, hz, p.y) + exp(-pow((p.y - lamp.y) / 0.08, 2.0)) * smoothstep(0.35, 0.85, fogN) * 0.55);
    col = mix(col, vec3(0.16, 0.27, 0.27) + vec3(0.3, 0.36, 0.33) * exp(-dm * 2.2) + vec3(0.1, 0.14, 0.13) * smoothstep(0.03, 0.0, abs(bankTop - p.y)), fog * 0.6);
    vec2 q = p - lamp;
    float dl = length(q * vec2(1.0, 1.6));
    col += vec3(0.85, 0.95, 0.88) * (beam(q, a) + beam(q, a + 3.1416)) * (0.35 + 1.3 * fog + 0.3 * fogN) + vec3(1.0, 0.95, 0.82) * (exp(-dl * 60.0) * 0.8 + exp(-dl * 14.0) * (0.12 + 0.35 * pow(abs(sin(a)), 6.0)));
  } else {
    // Under water: green-teal into black, moon shafts, far stacks, a glow in the deep, marine snow.
    float dd = wl - p.y, sx = p.x - dd * 0.32, bx = p.x / ar;
    vec3 water = mix(vec3(0.05, 0.21, 0.2), vec3(0.002, 0.012, 0.015), sat(pow(dd / wl0, 0.6)));
    float rays = smoothstep(0.5, 0.85, noise(vec2(sx * 9.0, t * 0.12)) * 0.6 + noise(vec2(sx * 21.0, t * 0.2 + 4.0)) * 0.4) * exp(-dd * 3.5) * (0.35 + 0.65 * exp(-pow((sx - moon.x) / 0.55, 2.0)));
    col = water + vec3(0.14, 0.25, 0.22) * exp(-pow((sx - moon.x) / (0.14 + dd * 0.3), 2.0) - dd * 3.0) + vec3(0.16, 0.34, 0.3) * rays;
    col = mix(col, vec3(0.01, 0.04, 0.045), fill(p.y - 0.16 - 0.09 * sat(sin(p.x * 3.1 + 0.6)) - 0.012 * sin(p.x * 17.0) + 0.12 * smoothstep(0.35, 0.6, bx), px) * 0.6);
    float dy = p.y - mix(0.34, 0.14, wide) - 0.045 * sin(bx * 5.0 + t * 0.12) - 0.02 * sin(bx * 11.0 - t * 0.09);
    col += vec3(0.03, 0.15, 0.1) * exp(-pow((dy - 0.06) / 0.2, 2.0)) * smoothstep(0.0, 0.5, bx) + vec3(0.16, 0.23, 0.21) * motes(p * 42.0 + vec2(sin(t * 0.2) * 0.5, t * 0.12), 0.13, 0.15, 7.0) * exp(-dd * 1.5);
    // The leviathan: a vast ridged back blotting out the glow, a slow wave through its lights.
    float thick = 0.015 + 0.12 * smoothstep(0.0, 1.0, bx), ridge = 0.022 * pow(abs(sin(p.x * 21.0)), 5.0) * smoothstep(0.05, 0.3, bx);
    float lev = fill(max(-dy - thick, dy - thick - ridge), px * 2.0 + 0.004 * smoothstep(0.0, -thick, dy));
    col = mix(col, mix(vec3(0.003, 0.012, 0.014) + vec3(0.1, 0.24, 0.22) * smoothstep(thick * 0.5, thick + ridge, dy) * (0.3 + rays * 1.5) * exp(-dd * 1.5), water * 0.5, 0.25), lev);
    vec2 lc = vec2(fract(p.x * 17.0) - 0.5, (dy + thick * 0.15) / (thick * 0.1 + 0.002));
    col += vec3(0.32, 0.8, 0.5) * exp(-lc.x * lc.x * 40.0 - lc.y * lc.y) * lev * (0.3 + 0.7 * pow(0.5 + 0.5 * sin(p.x * 5.0 - t * 0.7), 3.0));
    // The drowned one at a slant, lit only from above, its lower half lost in the murk.
    float fs = mix(0.16, 0.17, wide);
    vec2 fq = mat2(0.94, 0.34, -0.34, 0.94) * ((p - vec2(mix(0.3, 0.44, wide) * ar + 0.005 * sin(t * 0.3), wl0 - 0.04 - fs)) / fs - vec2(0.0, 0.5)) + vec2(0.0, 0.5);
    fq.x += 0.025 * sin(t * 0.33 + fq.y * 2.0);
    if (abs(fq.x - 0.05) < 0.45 && fq.y > -0.15 && fq.y < 1.25) {
      float fd = body(fq, t), murk = sat((0.55 - fq.y) * 1.6), lit = smoothstep(-0.015, 0.0, fd) * smoothstep(0.35, 0.95, fq.y) * 0.7;   // upper edges catch the light
      vec3 fc = vec3(0.006, 0.02, 0.024) + vec3(0.45, 0.7, 0.62) * lit * (0.4 + 1.5 * rays) * (1.0 - murk);
      col = mix(col, mix(fc, water, 0.1 + 0.5 * murk), fill(fd, px / fs * (1.0 + 7.0 * murk)));
    }
    // The sea stack: slanted strata, lit ledges, greener and darker with depth.
    float side = step(p.x, lx), sk = p.y * 9.0 + side * 0.45, L = floor(sk), f = fract(sk), hr = h1(L + side * 7.0);
    float strata = noise(vec2(p.x * 10.0, p.y * 46.0)), crack = noise(vec2(p.x * 34.0, p.y * 9.0));
    float ex = abs(p.x - lx - 0.01 * sin(p.y * 6.0)) - 0.008 * (crack - 0.5) - sc * (0.1 + 0.07 * smoothstep(wl0, 0.0, p.y) + 0.055 * (hr - 0.5)
             + 0.05 * (h1(L + 11.0 + side) - 0.5) * (f - 0.5) + 0.02 * smoothstep(0.12, 0.0, f) * (h1(L - 1.0 + side * 7.0) - hr));
    float shade = 0.4 + 0.8 * smoothstep(0.55, 0.8, strata) - 0.35 * smoothstep(0.35, 0.15, strata) + 0.4 * smoothstep(0.8, 1.0, f) - 0.3 * smoothstep(0.25, 0.1, crack) + 0.6 * smoothstep(0.035, 0.0, -ex) * side;
    col = mix(col, mix(mix(vec3(0.1, 0.22, 0.21), vec3(0.01, 0.05, 0.035), sat(dd * 2.2)) * shade * (0.55 + rays * 1.4), water, sat(dd * 0.9) * 0.5), fill(ex, px));
    // Kelp swaying.
    if (abs(rx) < 0.4 * sc && p.y < wl0 * 0.75) {
      for (int i = 0; i < 4; i++) {
        float fi = float(i), kt = wl0 * (0.5 + 0.08 * fi - 0.15 * step(1.5, fi)), s = sat(p.y / kt), lf = sin(p.y * 31.0 + fi * 2.0);
        float kd = abs(rx - (fi < 1.5 ? -0.15 - fi * 0.07 : 0.1 + fi * 0.045) * sc - 0.035 * sin(p.y * 7.0 - t * 0.5 + fi * 1.7) * s) - (0.004 + 0.009 * lf * lf) * (1.3 - s);
        col = mix(col, mix(vec3(0.03, 0.1, 0.06) + vec3(0.1, 0.24, 0.13) * (0.3 + rays * 2.0) * s, water, 0.2 + 0.4 * sat(0.6 - s)), fill(kd, px * 1.2) * step(p.y, kt));
      }
    }
    col += vec3(0.16, 0.28, 0.26) * (1.0 + 1.5 * onSea) * exp(-dd * 60.0) * smoothstep(0.0, px * 2.0, dd);
  }
  // The meniscus, brightest under the moon and the beams; vignette.
  col += vec3(0.6, 0.85, 0.8) * smoothstep(px * 3.0, 0.0, abs(p.y - wl)) * (0.3 + 0.5 * exp(-pow((p.x - moon.x) / 0.15, 2.0)) + 0.7 * onSea);
  vec2 v = pixel / iResolution.xy - 0.5;
  col *= 1.0 - 0.45 * dot(v, v);
  color = vec4(col / (1.0 + col * 0.25), 1.0);
}
`;

/** Verdant: A colossal tree on its hill, the sun behind its crown pouring light over forests fading into golden haze. */
export const VERDANT_SHADER = `
float sat(float x) { return clamp(x, 0.0, 1.0); }
float fill(float d, float e) { return smoothstep(e, -e, d); }
float smin(float a, float b, float k) { float h = sat(0.5 + 0.5 * (b - a) / k); return mix(b, a, h) - k * h * (1.0 - h); }
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * sat(dot(pa, ba) / dot(ba, ba))) - r; }
// A limb or root bending once: a to b to c, tapering.
float limb(vec2 q, vec2 a, vec2 b, vec2 c, float r) { return min(seg(q, a, b, r), seg(q, b, c, r * 0.6)); }
float crest(float x) { return 0.11 + 0.03 * sin(x * 2.3 + 1.0) + 0.01 * sin(x * 7.0); }
// A forested ridge (fi 0 far .. 3 near): a rolling hill under an irregular canopy line of rounded crowns with a spire here
// and there; clumps dappled in sun and cool shade, gold along the tops, sinking into valley mist and, far off, into haze.
vec3 forest(vec3 col, vec2 p, float fi, float gy, float wide, float px, float mistN) {
  float depth = fi / 3.0, w = (0.006 + 0.007 * fi) * mix(0.75, 1.0, wide), x = p.x / w;
  float top = gy + 0.02 - fi * mix(0.085, 0.07, wide) + (0.015 + 0.012 * fi) * (sin(p.x * 1.6 + fi * 2.0) * 0.6 + sin(p.x * 3.7 + fi * 5.0) * 0.4);
  top += w * (0.5 * abs(sin(x * 1.3 + fi)) + 0.3 * abs(sin(x * 0.81 + 2.0 * fi)) + 0.2 * abs(sin(x * 2.1)));
  float r = h1(floor(x * 0.4) + fi * 13.0);
  top += step(0.7, r) * max(0.0, 1.0 - abs(fract(x * 0.4) - 0.5) * (2.6 + r)) * w * (1.8 + 1.5 * r);
  float d = p.y - top, dapple = noise(mat2(0.8, -0.6, 0.6, 0.8) * vec2(p.x, p.y * 1.4) / (w * 2.2) + fi * 7.0);
  vec3 moss = mix(vec3(0.77, 0.85, 0.65), vec3(0.5, 0.69, 0.4), depth), haze = vec3(0.96, 0.91, 0.7);
  vec3 c = mix(moss * mix(vec3(0.9, 0.96, 0.99), vec3(0.74, 0.88, 0.97), depth), moss, smoothstep(0.3, 0.72, dapple));   // cool shade, sunlit clumps
  c += vec3(0.95, 0.8, 0.42) * smoothstep(w * 0.9, 0.0, -d) * (0.18 + 0.12 * depth) * (0.6 + 0.6 * mistN);   // gold on the tops
  c = mix(c, haze, smoothstep(0.0, 0.07 + 0.04 * fi, -d) * (0.35 + 0.35 * mistN) * (1.0 - 0.4 * depth));  // valley mist
  return mix(col, mix(c, haze, (1.0 - depth) * 0.4), fill(d, px));
}
void mainImage(out vec4 color, in vec2 pixel) {
  float ar = iResolution.x / iResolution.y, wide = smoothstep(0.7, 1.5, ar), px = 1.5 / iResolution.y, t = iTime;
  vec2 p = pixel / iResolution.y;
  float S = min(0.77, ar * 1.3), tx = mix(0.5, 0.65, wide) * ar, gy = mix(0.48, 0.28, wide);   // the tree's size, place, ground
  vec2 q = (p - vec2(tx, gy)) / S, ds = p - vec2(tx + 0.07 * S, gy + 0.42 * S);
  float r = length(ds), tree = 0.0;
  // Sky: cool jade overhead into warm gold at the haze line, a great bloom behind the crown.
  vec3 col = mix(vec3(1.0, 0.86, 0.56), vec3(0.83, 0.88, 0.66), smoothstep(gy - 0.05, gy + 0.3, p.y));
  col = mix(col, vec3(0.52, 0.75, 0.72), smoothstep(gy + 0.25, 1.1, p.y)) + vec3(1.0, 0.82, 0.5) * exp(-r * 2.4) * 0.35 + vec3(1.0, 0.96, 0.82) * exp(-r * 7.0) * 0.4;
  // God rays fanning from the sun, sampled on the circle of directions so they have no seam.
  vec2 dir = ds / (r + 0.0001);
  float rays = smoothstep(0.42, 0.85, noise(dir * 7.0 + t * 0.012) * (0.8 + 0.2 * sin(dir.x * 37.0 - dir.y * 23.0))) * exp(-r * 1.2);
  float mistN = noise(vec2(p.x * 3.0 - t * 0.03, p.y * 12.0 + sin(p.x * 2.0 + t * 0.05)));
  // A far blue-green range lost in the haze, then the far forests.
  col = mix(col, vec3(0.78, 0.86, 0.72), fill(p.y - gy - 0.035 - 0.025 * sin(p.x * 2.1 + 0.5) - 0.012 * sin(p.x * 5.3), px) * 0.6);
  if (p.y < gy + 0.08) for (int i = 0; i < 2; i++) col = forest(col, p, float(i), gy, wide, px, mistN);
  // The tree's hill, a broad meadow mound in warm light.
  float hill = gy - 0.24 * S * (1.0 - exp(-q.x * q.x * 2.2)) + 0.003 * sin(q.x * 50.0) - p.y;
  if (hill > -0.02) col = mix(col, mix(vec3(0.66, 0.78, 0.47), vec3(0.82, 0.84, 0.55), smoothstep(-0.12, 0.0, -hill)) * (0.94 + 0.1 * mistN) + vec3(0.3, 0.25, 0.12) * smoothstep(0.008, 0.0, hill), fill(-hill, px));
  if (abs(q.x) < 0.44 && q.y > -0.08 && q.y < 0.66) {
    // Roots gripping the hill, a massive gnarled trunk, great limbs splaying into the crown.
    float yy = max(q.y, 0.0);
    float td = abs(q.x - 0.015 * sin(q.y * 9.0) + 0.02 * q.y) - (0.038 + 0.055 * exp(-yy * 14.0) + 0.006 * sin(q.y * 40.0 + 1.0) + 0.004 * sin(q.y * 97.0));
    td = max(td, q.y - 0.22);
    td = smin(td, limb(q, vec2(-0.03, 0.02), vec2(-0.1, -0.01), vec2(-0.2, -0.05), 0.022), 0.02);
    td = smin(td, limb(q, vec2(0.03, 0.02), vec2(0.11, -0.005), vec2(0.21, -0.048), 0.022), 0.02);
    td = smin(td, limb(q, vec2(-0.01, 0.01), vec2(-0.05, -0.03), vec2(-0.09, -0.07), 0.016), 0.02);
    td = smin(td, limb(q, vec2(0.0, 0.18), vec2(-0.12, 0.26), vec2(-0.24, 0.31), 0.028), 0.03);
    td = smin(td, limb(q, vec2(0.0, 0.19), vec2(-0.04, 0.3), vec2(-0.09, 0.42), 0.02), 0.03);
    td = smin(td, limb(q, vec2(0.01, 0.19), vec2(0.08, 0.3), vec2(0.07, 0.43), 0.02), 0.03);
    td = smin(td, limb(q, vec2(0.01, 0.18), vec2(0.14, 0.24), vec2(0.27, 0.29), 0.028), 0.03);
    td = max(td, -0.24 * (1.0 - exp(-q.x * q.x * 2.2)) - 0.012 - q.y);                              // roots sink into the hill
    float side = smoothstep(-0.04, 0.04, q.x - 0.015 * sin(q.y * 9.0) + 0.02 * q.y);
    vec3 bark = mix(vec3(0.36, 0.41, 0.39), vec3(0.56, 0.52, 0.38), side) * (0.6 + 0.55 * smoothstep(0.25, 0.65, noise(vec2(q.x * 80.0, q.y * 8.0 + q.x * 25.0))));   // furrowed bark
    bark += vec3(0.5, 0.38, 0.18) * smoothstep(0.012, 0.0, abs(td)) * side;                                // warm rim on the sun side
    col = mix(col, mix(bark, vec3(0.96, 0.91, 0.7), 0.15 + 0.1 * (1.0 - wide)), fill(td, px / S));
    // The crown: layered leaf clumps from back to front, edges torn by leaf noise; hazier at the back, mossy in front,
    // cool in shade, glowing gold where the low sun shines through the thin edges.
    vec2 c = q + vec2(0.004 * sin(t * 0.5 + q.y * 5.0) * smoothstep(0.2, 0.45, q.y), 0.0);
    float leaf = noise(c * 30.0) * 0.45 + noise(mat2(0.8, -0.6, 0.6, 0.8) * c * 90.0) * 0.55;
    for (int row = 0; row < 4; row++) {
      float fr = float(row), n = 7.0 + 2.0 * step(0.5, fr) * step(fr, 2.5);
      float spread = fr < 0.5 ? 0.17 : (fr < 1.5 ? 0.26 : (fr < 2.5 ? 0.3 : 0.25));
      vec3 tone = mix(vec3(0.55, 0.7, 0.56), vec3(0.5, 0.68, 0.37), fr / 3.0);
      for (int k = 0; k < 10; k++) {
        float fk = float(k), u = fk / (n - 1.0) * 2.0 - 1.0, hk = fract(fk * 0.618 + fr * 0.37);
        if (fk < n) {
          vec2 cc = vec2(u * spread + (hk - 0.5) * 0.03, 0.51 - fr * 0.06 + (0.045 - fr * 0.018) * (1.0 - u * u) + (hk - 0.5) * 0.04);   // rows arch into a dome
          float rad = 0.058 + 0.026 * hk + 0.006 * fr;
          vec2 e = (c - cc) / vec2(1.25, 1.0);
          float d = length(e) / rad - 1.0 + (leaf - 0.5) * 0.7;
          vec2 nrm = e / rad;
          float facing = sat(0.35 + dot(nrm, vec2(0.5, 0.85)));
          vec3 lc = mix(tone * vec3(0.76, 0.9, 0.99), tone, sat(0.55 + 0.6 * nrm.y + 0.4 * (leaf - 0.5)));
          lc += vec3(1.0, 0.86, 0.45) * smoothstep(-0.4, 0.0, d) * facing * facing * (0.5 + 0.15 * fr);
          lc = mix(lc, vec3(0.96, 0.91, 0.7), 0.28 - fr * 0.09 + 0.1 * (1.0 - wide));
          float cov = fill(d, px / S / rad * 1.5);
          col = mix(col, lc, cov);
          tree = max(tree, cov);
        }
      }
    }
    // Sun breaking through gaps near the heart of the crown.
    col += vec3(1.0, 0.9, 0.55) * smoothstep(0.78, 0.9, leaf) * tree * exp(-length(c - vec2(0.07, 0.42)) * 6.0) * 1.2;
  }
  // Nearer forests, in front of the hill's foot.
  if (p.y < gy - 0.02) for (int i = 2; i < 4; i++) col = forest(col, p, float(i), gy, wide, px, mistN);
  // The near meadow with grass tips, and the wanderer on it, cloak stirring.
  float nd = p.y - crest(p.x) - 0.007 * (1.0 - abs(fract(p.x * 110.0) * 2.0 - 1.0)) * h1(floor(p.x * 110.0));
  col = mix(col, mix(vec3(0.66, 0.8, 0.46), vec3(0.6, 0.75, 0.44), smoothstep(0.1, 0.0, p.y)) * (0.93 + 0.12 * mistN) + vec3(0.25, 0.2, 0.08) * smoothstep(0.012, 0.0, -nd), fill(nd, px));
  float wx = mix(0.3, 0.4, wide) * ar;
  vec2 w = (p - vec2(wx, crest(wx) - 0.004)) / 0.08;
  float fig = min(length(w - vec2(0.0, 0.86)) - 0.1, max(abs(w.x + 0.1 * (w.y - 0.8) + 0.04 * sin(t * 1.2 + w.y * 6.0) * (0.8 - w.y)) - 0.05 - 0.2 * (0.8 - w.y), max(w.y - 0.8, -w.y)));
  fig = min(fig, max(abs(w.x - 0.3 + w.y * 0.06) - 0.025, max(w.y - 1.1, -w.y)));
  col = mix(col, vec3(0.16, 0.22, 0.17) + vec3(0.32, 0.26, 0.12) * smoothstep(-0.06, 0.0, fig) * step(0.0, w.x), fill(fig, px / 0.08));
  // Tall grass framing the lower corners, swaying, its tips in the light.
  float gx = p.x * 32.0, gc = floor(gx), hb = (0.04 + 0.08 * h1(gc)) * mix(0.55, 1.0, wide) * (smoothstep(0.3, 0.0, p.x / ar) + smoothstep(0.72, 1.0, p.x / ar)), yb = p.y / max(hb, 0.001);
  col = mix(col, vec3(0.47, 0.65, 0.39) + vec3(0.4, 0.32, 0.12) * smoothstep(0.6, 1.0, yb), fill((abs(fract(gx) - 0.5 - (0.25 + 0.12 * sin(t * 0.7 + gc * 0.9)) * yb * yb) - 0.32 * (1.0 - yb)) / 32.0, px) * step(yb, 1.0));
  // Birds wheeling slowly around the crown, tiny against it.
  if (abs(q.x) < 0.46 && q.y > 0.42 && q.y < 0.72) for (int i = 0; i < 5; i++) {
    float fi = float(i), an = t * 0.07 + fi * 1.26;
    vec2 b = (p - vec2(tx + cos(an) * 0.4 * S, gy + (0.5 + 0.06 * sin(an * 2.0 + fi)) * S + 0.03 * fi * S)) / (0.006 + 0.002 * sin(an));
    float flap = 0.35 * sin(t * 5.0 + fi * 2.0);
    col = mix(col, vec3(0.34, 0.4, 0.33), fill(abs(b.y - abs(b.x) * (0.5 + flap)) - 0.22 + abs(b.x) * 0.12, 0.25) * step(abs(b.x), 1.0) * mix(1.0 - tree, 1.0, step(0.0, sin(an))));   // behind the crown when passing round it
  }
  // God rays (not over the crown), sparse pollen, fireflies over the meadow.
  col += vec3(1.0, 0.9, 0.6) * rays * (1.0 - tree) * 0.3;
  col += vec3(1.0, 0.93, 0.62) * motes(p * 18.0 + vec2(t * 0.05, -t * 0.1), 0.12, 0.08, 1.0) * (0.3 + 0.3 * exp(-r * 2.0));
  col += vec3(0.85, 1.0, 0.4) * motes(p * 26.0 + vec2(sin(t * 0.3) * 0.6, t * 0.04), 0.13, 0.08, 9.0) * (0.5 + 0.5 * sin(t * 1.3 + h2(floor(p * 26.0)) * 30.0)) * smoothstep(0.3, 0.06, p.y);
  vec2 v = pixel / iResolution.xy - 0.5;
  color = vec4(col * (1.0 - 0.28 * dot(v, v)), 1.0);
}
`;

/** Iron Vigil: A colossal walker stands guard against a hazy sun under a planet's ring, dust blowing over the dunes. */
export const IRON_VIGIL_SHADER = `
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
// Outward distance from the edge a to b of a counter-clockwise polygon.
float edge(vec2 p, vec2 a, vec2 b) { vec2 e = normalize(b - a); return dot(p - a, vec2(e.y, -e.x)); }
// A small human in a long coat, 1 tall, feet at 0: head, collar, a coat flaring and blowing right, legs below, a rifle on the back.
float person(vec2 p, float t) {
  float hem = 0.22 + 0.04 * sin(t * 1.6);
  float coat = max(max(edge(p, vec2(-0.1, 0.8), vec2(-0.15, 0.2)), edge(p, vec2(-0.15, 0.2), vec2(hem, 0.17))), max(edge(p, vec2(hem, 0.17), vec2(0.11, 0.8)), p.y - 0.8));
  float d = min(coat - 0.02, length(p - vec2(0.0, 0.9)) - 0.075);
  d = min(d, min(seg(p, vec2(-0.04, 0.2), vec2(-0.05, 0.0), 0.035), seg(p, vec2(0.05, 0.2), vec2(0.07, 0.0), 0.035)));
  return min(min(d, seg(p, vec2(-0.13, 1.02), vec2(0.07, 0.45), 0.018)), box(p - vec2(0.0, 0.79), vec2(0.13, 0.04)) - 0.02);
}
// The fallen walker, in its own units: an armoured torso on its side with its pod, a leg jutting up, a snapped gun.
float wreck(vec2 p) {
  vec2 r = vec2(p.x * 0.9 - p.y * 0.44, p.x * 0.44 + p.y * 0.9);
  float d = min(box(r, vec2(0.36, 0.15)) - 0.04, box(r - vec2(-0.1, 0.21), vec2(0.17, 0.07)) - 0.03);
  d = min(d, min(seg(p, vec2(0.15, 0.22), vec2(0.22, 0.52), 0.065), length(p - vec2(0.22, 0.52)) - 0.078));
  d = min(d, min(seg(p, vec2(0.22, 0.52), vec2(0.43, 0.68), 0.045), seg(p, vec2(0.43, 0.68), vec2(0.5, 0.6), 0.03)));
  d = min(d, seg(p, vec2(0.45, 0.52), vec2(0.58, 0.68), 0.022));
  return min(d, min(seg(p, vec2(-0.3, 0.04), vec2(-0.72, 0.2), 0.022), box(p - vec2(-0.74, 0.21), vec2(0.045, 0.032))));
}
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
  float wx = q.x + t * 0.006, wid = floor(wx / 0.45), wh = h1(wid + 3.0), ws = 0.042 + 0.032 * wh;
  vec2 wq = vec2(wx - wid * 0.45 - 0.225 - (fract(wh * 7.0) - 0.5) * 0.18, y - 0.003 - (1.0 - wh) * 0.012) / ws;
  if (wh > 0.2 && abs(wq.x) < 0.6 && abs(wq.y - 0.5) < 0.56) col = mix(col, mix(vec3(0.62, 0.34, 0.34), vec3(0.42, 0.2, 0.25), wh), smoothstep(px, -px, mech(wq, t * 1.2 + wid * 2.0, 1.0) * ws) * (0.5 + 0.35 * wh));
  // The colossus, rim-lit against the sun and hazed at its feet; visor, warning lamp, searchlight, kicked-up dust
  vec2 base = vec2(mx, hz - 0.05), mq = (q - base) / ms;
  if (abs(mq.x + 0.1) < 0.48 && mq.y < 1.06 && mq.y > -0.02) {
    float md = mech(mq, 0.0, 0.0) * ms, rim = 0.0;
    if (md < px && md > -0.02) rim = smoothstep(-0.2, 1.0, mech(mq + normalize(sc - q) * 0.025, 0.0, 0.0) * ms / (px * 2.0)) * (0.35 + exp(-sd * 2.5));
    vec3 mc = mix(vec3(0.13, 0.065, 0.08), vec3(0.78, 0.45, 0.38), smoothstep(0.4, 0.0, mq.y) * 0.85) + vec3(0.12, 0.06, 0.1) * smoothstep(0.7, 0.95, mq.y);
    float seam = min(abs(mq.y - 0.7) + step(0.22, abs(mq.x + 0.03)), min(abs(mq.y - 0.635) + step(0.16, abs(mq.x - 0.03)), abs(mq.y - 0.86) + step(0.07, abs(mq.x - 0.12))));
    mc += vec3(0.2, 0.1, 0.08) * smoothstep(0.005, 0.0015, seam);
    mc += vec3(1.0, 0.68, 0.42) * (rim * 1.6 + smoothstep(-0.008, 0.0, md) * 0.25) + vec3(1.0, 0.72, 0.35) * smoothstep(0.012, 0.0, seg(mq, vec2(-0.29, 0.73), vec2(-0.15, 0.82), 0.0)) * 0.9;
    col = mix(col, mc, smoothstep(px, -px, md));
  }
  vec2 lamp = base + vec2(-0.03, 1.045) * ms, eye = base + vec2(-0.3, 0.7) * ms;
  col += vec3(1.0, 0.15, 0.1) * (smoothstep(0.007, 0.0, length(q - lamp)) + exp(-length(q - lamp) * 60.0) * 0.4) * smoothstep(0.5, 0.0, abs(fract(t * 0.6) - 0.25));
  float ba = -2.45 + 0.2 * sin(t * 0.21), bl = dot(q - eye, vec2(cos(ba), sin(ba))), bx = abs(dot(q - eye, vec2(-sin(ba), cos(ba))));
  float beam = smoothstep(0.012 + bl * 0.14, 0.0, bx) * step(0.0, bl) * exp(-bl * 2.4);
  col += vec3(1.0, 0.92, 0.8) * smoothstep(0.012, 0.0, length(q - eye));
  vec2 kq = (q - base - vec2(0.03, 0.03) * ms) / ms;
  col = mix(col, vec3(0.85, 0.52, 0.4), exp(-length(kq * vec2(2.6, 8.0))) * (0.45 + 0.4 * noise(kq * vec2(6.0, 14.0) - vec2(t * 0.25, 0.0))));
  // Mid dunes
  float mid = hz - 0.04 + 0.022 * sin(q.x * 2.6 + 0.4) + 0.012 * sin(q.x * 6.3);
  col = mix(col, mix(vec3(0.33, 0.15, 0.16), vec3(0.78, 0.44, 0.33), exp(-max(mid - q.y, 0.0) * 32.0) * 0.8), smoothstep(px, -px, q.y - mid));
  // Near dunes: a fallen walker half sunk in sand drifted over it, one leg jutting up, its gun snapped; the figure on the crest
  float wcx = ar * mix(0.2, 0.37, wide), nx = ar * mix(0.64, 0.52, wide), sz = mix(0.22, 0.3, wide);
  float near = hz - mix(0.11, 0.14, wide) + 0.035 * sin(q.x * 1.9 - 1.0) + 0.012 * sin(q.x * 5.1 + 2.0) + 0.012 * exp(-pow((q.x - nx) * 6.0, 2.0)) + 0.03 * exp(-pow((q.x - wcx) / sz * 2.2, 2.0));
  vec2 fw = (q - vec2(wcx, near - 0.035)) / sz, L = normalize(sc - q);
  float wd = wreck(fw) * sz;
  if (wd < 0.01) {
    float wr = smoothstep(-0.2, 1.0, wreck(fw + L * 0.03) * sz / (px * 2.0));
    col = mix(col, vec3(0.07, 0.035, 0.04) + vec3(1.0, 0.62, 0.4) * wr * 0.5, smoothstep(px, -px, wd));
  }
  float rip = smoothstep(0.55, 0.9, noise(vec2(q.x * 5.0, (near - q.y) * 60.0 + q.x * 8.0)));
  col = mix(col, mix(vec3(0.08, 0.035, 0.05), vec3(0.7, 0.38, 0.29), exp(-max(near - q.y, 0.0) * 70.0) * 0.8) + vec3(0.2, 0.09, 0.07) * rip * exp(-(near - q.y) * 6.0), smoothstep(px, -px, q.y - near));
  vec2 fq = (q - vec2(nx, near - 0.003)) / 0.085;
  float fig = person(fq, t) * 0.085;
  if (fig < 0.01) {
    float frim = smoothstep(-0.2, 1.0, person(fq + L * 0.06, t) * 0.085 / (px * 1.5));
    col = mix(col, vec3(0.05, 0.025, 0.03) + vec3(1.0, 0.66, 0.42) * frim * 0.9, smoothstep(px, -px, fig));
  }
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
// A cheap hash without sine, for the wing cells and stars.
vec2 cell(vec2 p) { vec3 q = fract(p.xyx * vec3(0.1031, 0.103, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
vec3 spectrum(float x) { return 0.5 + 0.5 * cos(6.283 * (x + vec3(0.0, 0.33, 0.67))); }
// Behind the glass: dusk sky, clouds, moon, faceted peaks, the old tower, the wanderer.
vec3 world(vec2 p, bool clouds) {
  vec3 col = mix(vec3(0.76, 0.49, 0.56), vec3(0.6, 0.34, 0.54), smoothstep(0.28, 0.6, p.y));
  col = mix(col, vec3(0.24, 0.16, 0.4), smoothstep(0.58, 1.15, p.y));
  if (clouds) col += vec3(0.22, 0.12, 0.16) * smoothstep(0.45, 0.85, noise(vec2(p.x * 1.6 + sin(tw * 0.1) * 0.3, p.y * 13.0))) * smoothstep(0.48, 0.62, p.y) * smoothstep(1.0, 0.7, p.y);
  vec2 md = p - mc; float mr = length(md);
  col += vec3(1.0, 0.88, 0.94) * 0.09 / (1.0 + mr * 9.0);
  col = mix(col, vec3(1.0, 0.96, 0.92), smoothstep(0.06 + px, 0.06 - px, mr));
  for (int i = 0; i < 4; i++) {
    float fi = float(i), k = fi / 3.0, f = p.x * (1.0 + fi * 0.5) + fi * 3.7;
    float h = mix(0.47, 0.29, k) + (tri(f * 0.8) * 0.62 + tri(f * 1.9 + 0.3) * 0.26 + tri(f * 4.3 + 1.1) * 0.12) * mix(0.13, 0.1, k);
    // Facets lit toward the moon, a rim on the crest, mist at the foot.
    float face = smoothstep(3.2 * px, -3.2 * px, 1.0 - 4.0 * abs(fract(f * 0.8 + (h - p.y) * 0.9 + 0.25) - 0.5));
    vec3 lc = mix(vec3(0.72, 0.46, 0.61), vec3(0.27, 0.14, 0.3), pow(k, 0.8)) * mix(0.84, 1.1, face);
    lc += vec3(0.25, 0.16, 0.2) * exp(-max(h - p.y, 0.0) * 120.0) * face;
    lc = mix(lc, vec3(0.76, 0.49, 0.6), smoothstep(h - 0.03, h - 0.2, p.y) * mix(0.55, 0.28, k));
    col = mix(col, lc, smoothstep(h + px, h - px, p.y));
    if (i == 2) {
      float tx = mix(ar * 0.28, ar * 0.48, wide);
      float d = max(abs(p.x - tx) - (0.017 - 0.014 * p.y), p.y - 0.57);
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
// Distance to a segment; a unit dome's normal.
float segment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
vec3 dome(vec2 e) { return vec3(e, sqrt(max(0.0, 1.0 - dot(e, e)))); }
// Metallic thin film: violet at grazing angles to teal facing us, a glint, a pearl rim.
vec3 metal(vec3 n, float film, float glint) {
  vec3 L = normalize(vec3(0.55, 0.35, 0.75)), c = spectrum(film);
  float spec = pow(max(2.0 * n.z * dot(n, L) - L.z, 0.0), glint);
  return c * (0.08 + 0.36 * max(dot(n, L), 0.0)) + mix(c, vec3(1.0), 0.55) * spec + vec3(0.8, 0.75, 0.9) * pow(1.0 - n.z, 3.0) * 0.45;
}
// The body (y toward the head): tucked legs, segmented abdomen, thorax, glossy eyes.
vec4 body(vec2 q, float pu) {
  vec2 aq = vec2(abs(q.x), q.y), k1 = vec2(0.068, 0.1), k2 = vec2(0.085, 0.0);
  float lg = min(min(segment(aq, vec2(0.02, 0.07), k1), segment(aq, k1, vec2(0.04, 0.16))), min(segment(aq, vec2(0.025, 0.0), k2), segment(aq, k2, vec2(0.06, 0.1)))) - max(0.0045, pu * 0.6);
  // Abdomen: ten segments pinched at the joints, a narrow waist, a tapered tip.
  float t = (-q.y - 0.06) / 0.7, sg = fract(t * 10.0);
  float w = 0.03 * (1.0 - 0.42 * smoothstep(0.0, 0.2, t)) * (0.88 + 0.12 * sin(sg * 3.1416)) * sqrt(clamp((1.0 - t) * 14.0, 0.0, 1.0));
  float ab = max(aq.x - w, max(-t, t - 1.0) * 0.7);
  // Thorax and compound eyes, blended into one normal, film and gloss.
  vec2 tc = (q - vec2(0.0, 0.025)) / vec2(0.062, 0.1), ec = (aq - vec2(0.034, 0.142)) / 0.046;
  float wt = smoothstep(pu, -pu, (length(tc) - 1.0) * 0.062), we = smoothstep(pu, -pu, (length(ec) - 1.0) * 0.046);
  vec3 n = dome(mix(mix(vec2(clamp(q.x / max(w, 0.001), -1.0, 1.0), 0.0), tc, wt), ec * sign(vec2(q.x, 1.0)), we));
  float film = mix(mix(0.22 + 0.1 * t + 0.06 * sin(tw * 0.2 + t * 6.0), 0.3, wt), 0.36, we) + mix(0.2, 0.1, we) * n.z;
  vec3 c = metal(n, film, mix(mix(14.0, 10.0, wt), 40.0, we)) * mix(1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.07 + pu * 9.0, min(sg, 1.0 - sg))), mix(1.0, 0.8, we), max(wt, we));
  c += vec3(0.4, 0.5, 0.45) * smoothstep(0.012 + pu, 0.004, abs(aq.x * 0.9 + (q.y - 0.02) * 0.45 - 0.038)) * n.z * wt * (1.0 - we);
  c += vec3(0.7) * smoothstep(0.22, 0.08, length(n.xy - vec2(0.35, 0.35))) * we;
  float a = mix(mix(0.72 + 0.25 * n.z, 0.95, wt), 1.0, we) * max(smoothstep(pu, -pu, ab), max(wt, we));
  return mix(vec4(0.2, 0.1, 0.24, smoothstep(pu, -pu, lg) * 0.85), vec4(c, 1.0), a);
}
vec3 scene(vec2 p) {
  vec3 col = world(p, true);
  // Early stars.
  vec2 sg = floor(p * 40.0), sh = cell(sg + 50.0), sf = fract(p * 40.0) - fract(sh * 7.0) * 0.6 - 0.2;
  col += vec3(1.0, 0.92, 0.96) * step(0.93, sh.x) * smoothstep(0.75, 0.95, p.y) * exp(-dot(sf, sf) / (px * px * 1600.0));
  // The great dragonfly, right of centre, angled to the upper left.
  vec2 c = mix(vec2(ar * 0.5, 0.74), vec2(ar * 0.64, 0.7), wide) + vec2(sin(tw * 0.1), sin(tw * 0.2)) * vec2(0.03, 0.015);
  float s = mix(0.26, 0.5, wide), ang = 0.32 + 0.05 * sin(tw * 0.1), pu = px / s, flex = 0.025 * sin(tw * 0.5);
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (p - c) / s, aq = vec2(abs(q.x), q.y);
  if (aq.x > 1.05 || abs(q.y) > 1.0) return col;
  vec4 fw = wing(aq, 0.08, flex - 0.03, 0.13), hw = wing(aq, -0.04, flex + 0.14, 0.16), wg = fw.x < hw.x ? fw : hw;
  float m = smoothstep(pu, -pu, wg.x);
  if (m > 0.0) {
    // Cells between cross-veins; long veins converge at the tip.
    vec2 g = vec2(wg.z * 16.0, wg.y * 4.0), id = floor(g), fr = fract(g), cid = id;
    float f1 = 9.0, f2 = 9.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j)), pt = o + 0.2 + 0.6 * cell(id + o + sign(q.x) * 7.0) - fr; float dd = dot(pt, pt);
      if (dd < f1) { f2 = f1; f1 = dd; cid = id + o; } else if (dd < f2) f2 = dd;
    }
    float aa = pu * 16.0 / max(wg.w * 4.0, 0.3), edge = sqrt(f2) - sqrt(f1);
    vec2 hh = cell(cid * 1.3 + sign(q.x) * 3.0); float hc = hh.x;
    float vein = max(smoothstep(0.06 + aa, 0.06 - aa, edge) * 0.35, smoothstep(0.012 + pu, -pu, wg.y * wg.w));
    vein = max(vein, smoothstep(0.004 + pu, 0.004 - pu, abs(fract(wg.y * 3.0 + 0.5) - 0.5) * wg.w / 3.0) * 0.8 * step(0.05, wg.y));
    // Each cell a faint lens: the world bends behind it, colours apart.
    vec2 o = ((fract(hh * 5.0) - 0.5) * 0.03 + (fr - 0.5) * vec2(0.01, 0.02)) * s;
    vec3 ra = world(p + o, false), film = spectrum(hc * 0.3 + wg.z * 0.8 + wg.y * 0.3 + 0.08 * sin(wg.z * 5.0 - tw * 0.5));
    vec3 pane = vec3(ra.r, ra.g * 0.6 + col.g * 0.4, col.b) * (0.92 + 0.14 * hc) * mix(vec3(1.0), film, 0.12) + film * 0.03;
    // Cells catch the moon unevenly, each in its own slow turn.
    pane += mix(film, vec3(1.0), 0.6) * pow(max(sin(hc * 40.0 + tw * 0.3 + wg.z * 4.0), 0.0), 8.0) * 0.16;
    pane = mix(pane, vec3(1.0, 0.92, 0.96), vein);
    pane += spectrum(wg.y * 2.0 + 0.3) * exp(-abs(wg.y - 1.0) * wg.w * 300.0) * 0.3;
    col = mix(col, pane, m);
  }
  if (aq.x > 0.12) return col;
  vec4 b = body(q, pu);
  return mix(col, b.rgb + col * 0.2, b.a);
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; ar = iResolution.x / iResolution.y; px = 1.5 / iResolution.y;
  vec2 p = vec2(uv.x * ar, uv.y); wide = smoothstep(0.7, 1.4, ar); tw = mod(iTime, 62.8318);
  mc = mix(vec2(ar * 0.66, 0.86), vec2(ar * 0.83, 0.82), wide); lake = mix(0.3, 0.29, wide);
  float dz = lake - p.y;
  vec3 col;
  if (dz > 0.0) {
    // The lake: the scene mirrored a little lower, broken by ripples, glitter under the moon.
    float fade = smoothstep(0.0, 0.05, dz), n = noise(vec2(p.x * 2.5, 2.5 / (dz + 0.08) + tw * 0.5));
    float rip = (n - 0.5) * (0.014 + dz * 0.08) * fade;
    vec3 refl = scene(vec2(p.x + rip, lake + dz * 1.1 + 0.012 + rip * 1.6)) * vec3(0.9, 0.82, 0.96);
    col = mix(vec3(0.15, 0.08, 0.19), refl, mix(0.68, 0.32, smoothstep(0.0, lake, dz)));
    col += vec3(0.12, 0.08, 0.12) * smoothstep(0.6, 0.9, n) * fade;
    col += vec3(0.3, 0.27, 0.3) * exp(-abs(p.x - mc.x + rip * 3.0) * 22.0) * smoothstep(0.55, 0.8, n) * fade;
  } else col = scene(p);
  // A soft mist band along the shore.
  col += vec3(0.16, 0.1, 0.15) * exp(-abs(dz + 0.004) * 45.0);
  // Falling motes, some prismatic.
  float fall = mod(iTime, 600.0);
  vec2 mp = p * 7.0 + vec2(sin(p.y * 3.0 + tw * 0.1) * 0.6, fall * 0.15);
  col += mix(vec3(0.42), spectrum(p.x * 2.0 + p.y) * 0.45, step(0.65, fract(dot(floor(mp), vec2(0.37, 0.71))))) * motes(mp, 0.14, 0.12, 3.0);
  col *= 1.0 - 0.2 * pow(length(uv - 0.5) * 1.2, 2.5);
  color = vec4(col, 1.0);
}
`;

/** Frostline: Polar dusk over jagged peaks, the last light burning pink on the summits, spindrift streaming off the crests and snow gusting in. */
export const FROSTLINE_SHADER = `
// 1D value noise, and a ridged octave of it (sharp crests).
float vn(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float rdg(float x) { return 1.0 - abs(vn(x) * 2.0 - 1.0); }
// Lopsided summits (the three nearest, plus a spire), crests broken by ridged noise. x: skyline, y: across the ridge of the
// nearest summit covering y (positive on its sunward face), z: that face's steepness, w: the skyline upwind (spindrift).
vec4 peaks(float x, float y, float seed, float spireX, float tall, float lean) {
  float c = floor(x);
  vec3 r = vec3(h1(c - 1.0 + seed), h1(c + seed), h1(c + 1.0 + seed)), r2 = fract(r * 13.3 + 0.37);
  vec3 xi = c + vec3(-1.0, 0.0, 1.0) + 0.15 + 0.7 * r, hi = 0.35 + 0.65 * r2;
  vec3 dx = x - xi, sl = mix(1.9 - 0.9 * r2, 1.0 + 0.9 * r, step(0.0, dx)), v = hi - abs(dx) * sl;
  float ds = x - spireX, vs = tall - abs(ds) * (ds < 0.0 ? 1.0 : 1.7);
  float jag = rdg(x * 3.1 + seed) * 0.14 + rdg(x * 7.3 + seed) * 0.06;
  float best = max(max(max(v.x, v.y), max(v.z, vs)), 0.0);
  vec3 key = fract(r * 31.7) + step(v, vec3(y)) * 9.0, side = dx + (hi - y) * (0.55 * r - 0.2);
  float k = min(key.x, key.y), pick = step(key.y, key.x), pz = step(key.z, k);
  float sd = mix(mix(side.x, side.y, pick), side.z, pz), st = mix(mix(sl.x, sl.y, pick), sl.z, pz);
  float onSpire = step(y, vs);
  sd = mix(sd, ds + (tall - y) * 0.18, onSpire); st = mix(st, 1.4, onSpire);
  float upwind = max(y - best + jag, 0.0) * lean;
  vec3 du = dx + upwind; vec3 vu = hi - abs(du) * mix(1.9 - 0.9 * r2, 1.0 + 0.9 * r, step(0.0, du));
  float dsu = ds + upwind;
  return vec4(best - jag, sd, st, max(max(max(vu.x, vu.y), vu.z), tall - abs(dsu) * (dsu < 0.0 ? 1.0 : 1.7)));
}
// One range over col. glow: dusk light it catches, fog: how far it ghosts into the sky.
vec3 range(vec3 col, vec2 p, float fi, float sc, float amp, float base, float fog, float tall, float glow, float fx, float sunX, vec3 sky, float px) {
  float y = (p.y - base) / amp;
  vec4 pk = peaks(p.x * sc + fi * 7.3, y, fi * 13.0 + 5.0, fx * sc + fi * 7.3, tall, amp * 1.3 * sc);
  float d = (pk.x - y) * amp, below = max(d, 0.0);
  float near = exp(-abs(p.x - sunX) * 0.7), alpen = smoothstep(base - 0.05, base + amp * 0.9, p.y) * near * glow;
  float lit = smoothstep(-0.02, 0.02, pk.y + (vn(y * 9.0 + fi * 5.0) - 0.5) * 0.07);  // jagged ridge line
  vec3 shade = mix(vec3(0.09, 0.13, 0.27), vec3(0.2, 0.26, 0.46), smoothstep(0.25, 0.0, below));
  vec3 sunlit = mix(vec3(0.38, 0.44, 0.64), vec3(1.0, 0.66, 0.52), alpen);
  vec3 face = mix(shade, sunlit, lit);
  // Bare rock streaks down the faces where snow can't hold.
  if (fi > 0.5) {
    float streak = noise(vec2(pk.y * 9.0 * sc, p.y * sc * 3.0 + fi * 3.0)) * (0.6 + 0.5 * vn(p.y * sc * 1.5 + pk.y * 3.0 * sc));
    float rock = smoothstep(0.62 - pk.z * 0.08, 0.76 - pk.z * 0.08, streak) * smoothstep(0.0, 0.02, below);
    face *= 0.92 + 0.16 * streak;
    face = mix(face, mix(vec3(0.04, 0.05, 0.09), vec3(0.3, 0.2, 0.21), lit * (0.3 + alpen)), rock * 0.9);
  }
  face += vec3(1.0, 0.76, 0.62) * exp(-below * 260.0) * (0.1 + lit * alpen * 0.7);
  // Mist pools low; far ranges ghost into the sky.
  face = mix(face, mix(sky, vec3(0.3, 0.32, 0.5), 0.3), clamp(fog + smoothstep(0.04, 0.3, d) * (0.4 - fog * 0.2 - step(2.5, fi) * 0.15), 0.0, 1.0));
  col = mix(col, face, smoothstep(-px, px, d));
  if (fi > 0.5 && fi < 2.5) { // spindrift off the crests
    float above = max(-d, 0.0);
    float plume = smoothstep(0.5, 0.95, pk.w) * exp(-above * 12.0) * step(0.0, -d);
    plume *= smoothstep(0.2, 0.8, noise(vec2((p.x + iTime * 0.5) * 4.0 + above * 6.0, above * 30.0 - iTime * 0.7)));
    col = mix(col, mix(vec3(0.6, 0.66, 0.86), vec3(1.0, 0.78, 0.65), near), plume * 0.75);
  }
  return col;
}
// Flakes of varied size and brightness, one per cell at most; q is stretched along the wind.
float flakes(vec2 q, float chance, float smin, float smax, float seed) {
  vec2 id = floor(q), r = h22(id + seed); float k = h2(id + seed + 7.3), s = mix(smin, smax, fract(k * 7.7));
  return step(1.0 - chance, k) * smoothstep(s, s * 0.25, length(fract(q) - 0.5 - (r - 0.5) * 0.4)) * (0.5 + 0.5 * fract(k * 13.1));
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y);
  float px = 1.5 / iResolution.y, t = iTime, wide = clamp((ar - 0.6) / 0.9, 0.0, 1.0), lift = (1.0 - wide) * 0.12;
  // Sky: indigo, mauve, the afterglow low on the right.
  vec2 sun = vec2(ar * mix(0.8, 0.84, wide), 0.3 + lift);
  float g = length((p - sun) * vec2(0.45, 1.5));
  vec3 sky = mix(vec3(0.36, 0.32, 0.5), vec3(0.04, 0.06, 0.17), smoothstep(0.3 + lift, 1.0, uv.y));
  sky += vec3(1.0, 0.45, 0.25) * exp(-g * 2.4) * 0.8 + vec3(1.0, 0.78, 0.5) * exp(-g * 7.0) * 0.7;
  vec3 col = sky;
  // Four ranges; the second carries the summit, right of centre.
  float fx = ar * mix(0.6, 0.66, wide);
  col = range(col, p, 0.0, 3.2, 0.2, 0.4 + lift, 0.7, 0.0, 1.0, fx, sun.x, sky, px);
  col = range(col, p, 1.0, 2.0, 0.26, 0.27 + lift, 0.34, 1.45, 1.0, fx, sun.x, sky, px);
  col = range(col, p, 2.0, 2.6, 0.22, 0.17 + lift * 0.7, 0.14, 0.0, 0.6, fx, sun.x, sky, px);
  col = range(col, p, 3.0, 3.4, 0.16, 0.04 + lift * 0.5, 0.0, 0.0, 0.35, fx, sun.x, sky, px);
  // Gust fronts sweep through, then ease.
  float front = smoothstep(0.35, 0.8, noise(vec2(p.x * 0.6 + p.y * 0.3 + t * 0.45, t * 0.07)));
  float stream = noise(vec2((p.x + t * 0.9) * 3.0, p.y * 18.0)); stream *= stream;
  col = mix(col, vec3(0.34, 0.38, 0.56), smoothstep(0.12, 0.5, stream) * (0.15 + 0.5 * front) * (1.0 - uv.y * 0.7));
  // Snow: many small far flakes, gust streaks, big near ones, a few soft out-of-focus ones.
  vec2 wd = vec2(-0.96, -0.28), wn = vec2(0.28, -0.96);
  float gust = t * 1.3 + 0.8 * sin(t * 0.37) + 0.4 * sin(t * 0.9 + 1.0);
  vec3 sc = mix(vec3(0.62, 0.68, 0.88), vec3(1.0, 0.8, 0.68), exp(-g * 1.5));
  vec2 q = vec2(dot(p, wd) * 0.45, dot(p, wn)) * 70.0 + vec2(-gust, 0.0);
  col = mix(col, sc, flakes(q, 0.3, 0.14, 0.2, 1.0) * (0.15 + 0.35 * front));
  q = vec2(dot(p, wd) * 0.32, dot(p, wn)) * 36.0 + vec2(-gust * 1.6, sin(t * 0.7) * 0.3);
  col = mix(col, sc, flakes(q, 0.3, 0.09, 0.24, 2.0) * (0.2 + 0.6 * front));
  q = vec2(dot(p, wd) * 0.12, dot(p, wn)) * 30.0 + vec2(-gust * 1.2, 0.0);
  col = mix(col, sc, flakes(q, 0.3, 0.07, 0.12, 5.0) * front * 0.6);
  q = vec2(dot(p, wd) * 0.3, dot(p, wn)) * 14.0 + vec2(-gust * 2.3, sin(t * 0.5 + 1.0) * 0.4);
  col = mix(col, sc, flakes(q, 0.2, 0.08, 0.22, 3.0) * (0.55 + 0.45 * front));
  q = vec2(dot(p, wd) * 0.45, dot(p, wn)) * 5.0 + vec2(-gust * 3.2, 0.0);
  col = mix(col, sc * 1.05, smoothstep(0.0, 0.6, flakes(q, 0.14, 0.08, 0.18, 4.0)) * 0.28);
  color = vec4(col, 1.0);
}
`;

/** Kestrel: Chasing a fighter high over a sea of cloud rushing in from a curved horizon, thunderheads towering in the sun's glare. */
export const KESTREL_SHADER = `
float edge(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; return (e.y * (p.x - a.x) - e.x * (p.y - a.y)) / length(e); }
float quad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) { return max(max(edge(p, a, b), edge(p, b, c)), max(edge(p, c, d), edge(p, d, a))); }
// The fighter from behind and above. x: distance, y: 1 on the tails.
vec2 jet(vec2 q) {
  vec2 m = vec2(abs(q.x), q.y);
  float body = length(vec2(q.x, q.y - clamp(q.y, -0.45, 0.5))) - 0.05 * (1.0 - smoothstep(0.03, 0.5, q.y) * 0.92);
  float wing = quad(m, vec2(0.05, 0.14), vec2(0.05, -0.2), vec2(0.46, -0.22), vec2(0.46, -0.16));
  float tail = quad(m, vec2(0.04, -0.36), vec2(0.04, -0.48), vec2(0.2, -0.5), vec2(0.2, -0.45));
  float fin = quad(m, vec2(0.06, -0.3), vec2(0.07, -0.47), vec2(0.105, -0.44), vec2(0.14, -0.3));
  return vec2(min(min(body, wing), min(tail, fin)), step(fin, min(body, min(wing, tail)) + 0.004));
}
// One cloud dome from cell g + o, soft-blended into acc.
void dome(vec2 g, vec2 f, vec2 o, inout vec4 acc) {
  vec2 r = h22(g + o), c = f - o - 0.2 - 0.6 * r;
  float R = 0.6 + 0.4 * fract(r.x * 7.3 + r.y), up = sqrt(max(R * R - dot(c, c), 0.0)), k = up * up * up * (1.0 + 2.0 * fract(r.y * 5.1));
  acc += vec4(k * c * (0.6 + up), k * (up + 0.1), k * up);
}
// Value noise with its gradient.
vec3 noised(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = h2(i), b = h2(i + vec2(1.0, 0.0)), c = h2(i + vec2(0.0, 1.0)), d = h2(i + 1.0), k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}
// Thunderhead density at q (> 0 inside): an outline with a crown and turret, cauliflower bulges of many sizes (fine: the
// small ones too), the foot thinning to wisps.
vec3 towerA, towerB; float horizon;
float cloud(vec2 q, float fine) {
  vec2 ya = (q.y - horizon) / vec2(towerA.z, towerB.z);
  vec2 xa = (q.x - vec2(towerA.x, towerB.x)) / (vec2(towerA.y, towerB.y) * (1.0 - 0.15 * clamp(ya, 0.0, 1.0)));
  vec2 top = max(ya - 0.62, 0.0) / 0.38, e = 1.0 - xa * xa - top * top - smoothstep(0.12, -0.04, ya) * 0.9 - step(ya, vec2(-0.04)) * 9.0;
  vec2 tu = (q - vec2(towerA.x + towerA.y * 0.7, horizon + towerA.z * 0.62)) / (towerA.y * vec2(0.6, 1.05));
  float env = max(max(e.x, e.y), 1.0 - dot(tu, tu));
  vec2 b = q * 13.0 + vec2(0.0, -iTime * 0.015);
  float n = abs(noise(b) * 2.0 - 1.0) * 0.45 + abs(noise(b * 2.3 + 3.1) * 2.0 - 1.0) * 0.28
          + (abs(noise(b * 5.1 + 1.7) * 2.0 - 1.0) * 0.15 + abs(noise(b * 10.7 + 5.3) * 2.0 - 1.0) * 0.06) * fine;
  return env + (n - 0.32 - 0.1 * (1.0 - fine)) * 1.5 - smoothstep(0.1, -0.4, env);
}
void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = pixel / iResolution.xy; float ar = iResolution.x / iResolution.y; vec2 p = vec2(uv.x * ar, uv.y);
  float px = 1.5 / iResolution.y, t = iTime, wide = clamp((ar - 0.6) / 0.9, 0.0, 1.0);
  // Bank: w is the rolled point.
  float bank = 0.06 + 0.05 * sin(t * 0.13);
  mat2 roll = mat2(cos(bank), -sin(bank), sin(bank), cos(bank));
  vec2 cen = vec2(ar * 0.5, 0.5), w = roll * (p - cen) + cen;
  vec2 sunP = vec2(ar * mix(0.6, 0.64, wide), mix(0.84, 0.8, wide)), sun = roll * (sunP - cen) + cen;
  float xn = (w.x - cen.x) / max(ar, 1.0), hz = mix(0.54, 0.46, wide) - 0.06 * xn * xn;
  float r = length(w - sun), glow = exp(-abs(w.x - sun.x) * 1.3), sy = w.y - hz;
  // Sky: pale horizon, cerulean, cobalt.
  vec3 col = mix(mix(vec3(0.84, 0.91, 0.98), vec3(0.36, 0.6, 0.96), smoothstep(0.0, 0.2, sy)), vec3(0.1, 0.3, 0.78), smoothstep(0.24, 0.6, sy));
  vec3 haze = mix(vec3(0.84, 0.9, 0.98), vec3(1.0, 0.95, 0.86), glow * 0.7);
  // The deck: a plane below rushing toward us.
  if (sy < 0.0) {
    float v = -sy, z = 0.1 / (v + 0.004), fp = 0.8 / ((v + 0.004) * (v + 0.004)) * px;
    vec2 wp = vec2((w.x - cen.x) * z, z) * 8.0 + vec2(0.0, t * 1.8);
    vec3 m1 = noised(wp * 0.1 + 3.0), m2 = noised(wp * 0.26 + 7.0);  // big masses
    float mass = m1.x * 0.65 + m2.x * 0.35;
    vec2 mg = (m1.yz * 0.065 + m2.yz * 0.091) * 7.0;
    wp += vec2(noise(wp * 0.3), noise(wp * 0.3 + 5.2)) * 1.4;  // warp
    vec2 g = floor(wp), f = fract(wp); vec4 a = vec4(0.0);
    dome(g, f, vec2(-1.0), a); dome(g, f, vec2(0.0, -1.0), a); dome(g, f, vec2(1.0, -1.0), a);
    dome(g, f, vec2(-1.0, 0.0), a); dome(g, f, vec2(0.0), a); dome(g, f, vec2(1.0, 0.0), a);
    dome(g, f, vec2(-1.0, 1.0), a); dome(g, f, vec2(0.0, 1.0), a); dome(g, f, vec2(1.0), a);
    vec4 dm = vec4(a.w / (a.z + 0.001) * 1.6, normalize(a.xyz + vec3(0.0, 0.0, 0.001)));
    vec3 n = normalize(vec3(-mg * 1.3, 1.0) + (dm.yzw - vec3(0.0, 0.0, 1.0)) * 0.95);
    float diff = dot(n, vec3(0.3, 0.81, 0.51)) * 0.5 + 0.5, e = 1.0 - n.z, rim = e * e * max(dot(n.xy, vec2(0.35, 0.94)), 0.0);
    vec3 cc = vec3(0.52, 0.62, 0.84) * (0.7 + 0.3 * n.z) + vec3(1.0, 0.95, 0.86) * diff * diff * 0.45 + vec3(1.0, 0.86, 0.62) * rim * (0.3 + 0.4 * glow);
    cc *= (0.78 + 0.22 * smoothstep(0.2, 1.1, dm.x)) * (1.0 + (noise(wp * 3.1) - 0.5) * 0.14 * smoothstep(0.3, 0.05, fp));
    cc = mix(cc, vec3(0.3, 0.42, 0.64), smoothstep(0.35, 0.05, dm.x) * 0.5);
    cc *= 0.84 + 0.26 * smoothstep(0.3, 0.75, mass);
    // Gaps onto a hazier layer below where the masses thin.
    vec3 low = mix(vec3(0.3, 0.4, 0.6), haze, 0.3) * (0.92 + 0.16 * noise(wp * 0.7));
    cc = mix(low, cc, smoothstep(0.41, 0.5, mass + (dm.x - 0.5) * 0.15));
    cc = mix(cc, vec3(0.84, 0.89, 0.97), smoothstep(0.12, 0.45, fp));
    col = mix(cc, haze, 1.0 - exp(-z * 0.2));
    col = mix(col, haze, smoothstep(0.015, 0.0, v));
  }
  // Thunderheads, lit by how little cloud lies toward the sun; feet in haze.
  towerA = vec3(cen.x + 0.36 * ar, mix(0.11, 0.12, wide), 0.35); towerB = vec3(cen.x - 0.24 * ar, 0.06, 0.18); horizon = hz;
  if (sy > -0.05 && ((abs(w.x - towerA.x) < 0.3 && sy < 0.5) || (abs(w.x - towerB.x) < 0.14 && sy < 0.26))) {
    float D = cloud(w, 1.0), yy = sy / 0.4;
    vec2 L = normalize(sun - w);
    float D1 = cloud(w + L * 0.015, 0.0), T = exp(-max(D1, 0.0) * 1.3 - max(cloud(w + L * 0.06, 0.0), 0.0) * 0.9);
    float lobe = clamp((cloud(w, 0.0) - D1) * 3.0 + 0.4, 0.0, 1.0);
    vec3 tc = mix(mix(vec3(0.42, 0.49, 0.68), vec3(0.6, 0.66, 0.84), smoothstep(0.0, 0.7, yy)), vec3(1.0, 0.97, 0.92), max(T, lobe * 0.5));
    tc += vec3(1.0, 0.95, 0.85) * smoothstep(0.6, 1.0, yy) * T * 0.15;
    tc += vec3(1.0, 0.88, 0.66) * T * smoothstep(0.25, 0.0, D) * 0.35;
    tc = mix(tc, haze, smoothstep(0.3, 0.0, yy) * 0.75 + 0.1 + 0.3 * step(w.x, cen.x));
    col = mix(col, tc, smoothstep(0.0, mix(0.45, 0.07, smoothstep(0.0, 0.35, yy)), D));
  }
  // Sun: disc, glare, ice halo, streak.
  vec2 ds = w - sun; float rr = (r - 0.24) / 0.014;
  vec3 glare = vec3(1.0, 0.92, 0.74) * (exp(-r * 2.6) * 0.32 + exp(-r * 10.0) * 0.55 + exp(-r * 36.0) * 0.8);
  col += glare + mix(vec3(0.9, 0.55, 0.35), vec3(0.55, 0.75, 1.0), smoothstep(0.23, 0.255, r)) * exp(-rr * rr) * 0.12;
  col += vec3(1.0, 0.9, 0.75) * exp(-abs(ds.y) * 90.0) * exp(-abs(ds.x) * 1.8) * 0.28;
  col = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.028 + px, 0.028 - px, r));
  // The fighter and its contrails.
  vec2 jc = vec2(ar * mix(0.5, 0.61, wide), mix(0.66, 0.62, wide) + 0.004 * sin(t * 0.8));
  float js = mix(0.13, 0.15, wide);
  vec2 q = (p - jc) / js; q.y /= 0.55;
  float back = max(-q.y - 0.47, 0.0), trail = abs(abs(q.x) - 0.035 - back * 0.11) / (px / js + back * 0.012);
  float lane = step(0.0, -q.y - 0.47) * exp(-back * 0.3);
  col = mix(col * (1.0 - 0.12 * exp(-trail * trail * 0.25) * lane), vec3(1.0), exp(-trail * trail) * lane * 0.95);
  if (abs(q.x) < 0.6 && abs(q.y) < 0.6) {
    vec2 jd = jet(q); float d = jd.x, aa = px / js * 1.4;
    vec3 hull = mix(vec3(0.2, 0.23, 0.28), vec3(0.4, 0.44, 0.5), smoothstep(-0.3, 0.4, q.x + q.y * 0.3));
    hull = mix(hull, mix(vec3(0.14, 0.16, 0.2), vec3(0.62, 0.64, 0.66), step(0.0, q.x)), jd.y);
    hull += vec3(1.0, 0.9, 0.7) * smoothstep(-0.02, 0.0, d) * 0.45 * step(0.0, q.y + 0.1);
    float can = length((q - vec2(0.0, 0.2)) * vec2(1.9, 0.75)) - 0.06;
    hull = mix(hull, vec3(0.08, 0.1, 0.16), smoothstep(0.01, -0.01, can));
    hull += vec3(1.0, 0.95, 0.85) * smoothstep(0.035, 0.0, length(q - vec2(0.015, 0.23))) * 0.9;
    col = mix(col, hull, smoothstep(aa, -aa, d));
  }
  color = vec4(col + glare * 0.2, 1.0);
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
  { slug: "frostline", title: "Frostline", genre: "Survival", summary: "Polar dusk over jagged peaks, the last light burning pink on the summits, spindrift streaming off the crests and snow gusting in.", shader: FROSTLINE_SHADER },
  { slug: "kestrel", title: "Kestrel", genre: "Flight", summary: "Chasing a fighter high over a sea of cloud rushing in from a curved horizon, thunderheads towering in the sun's glare.", shader: KESTREL_SHADER },
  { slug: "starward", title: "Starward", genre: "Space", summary: "A ringed gas giant in crescent, its sun blazing past the edge, rays fanning over a vivid nebula.", shader: STARWARD_SHADER },
  { slug: "emberfall", title: "Emberfall", genre: "Survival", summary: "A field of black crust cracked over molten rock, a lava river running from an erupting volcano, sparks rising.", shader: EMBERFALL_SHADER },
];

/** The glass pass runners wrap round every shader: kept in core, so the game domain's runner and the shader check compile the same thing. */
export { GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT } from "@zaisma/core";
