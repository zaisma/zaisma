/*
 * The glass pass every shader background runs inside (apps/site/src/components/foundations.ts, BACKDROP_SCRIPT, and the game
 * domain's background runner): a shader is one mainImage function, and this is the main round it. Kept in core so Zaisma's
 * own pages, the game domain and the shader check all compile the same thing (wrapShader in developers.ts).
 */

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
