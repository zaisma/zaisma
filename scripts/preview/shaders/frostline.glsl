// Frostline: snowfall over a ridge at dusk, the looks drafts' stand-in game background, with the helpers it calls.
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
}
