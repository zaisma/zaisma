// Neon Drift: a city at night under rain, the looks drafts' stand-in game background, with the helpers it calls.
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
}
