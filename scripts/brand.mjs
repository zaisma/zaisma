// Zaisma's own marks in glass (brand/README.md): the one generator for the glass mark and wordmark, the app icons, the favicon and the
// share cards, from Julius's drawing kept here as data. It writes the SVGs and brand/manifest.webmanifest, then renders the PNGs and favicon.ico through headless Chrome (scripts/chrome.mjs). Everything
// it writes is checked in, and test/node/brand-files.test.ts checks the text files are exactly what it makes, so nobody hand-edits one.
//
//   npm run brand                                   every file
//   node scripts/brand.mjs --svg-only [--out <folder>]
//       The text files only (the SVGs and the manifest), with no Chrome: into brand/, or into <folder>.
//
// Glass is drawn as flat-filled polygons, one per facet, never SVG lighting: crisp at every size and the same in every browser and email.
// Each shard (or letter) is a face, a bevel facet along every edge, walls along the edges that face the depth, a hairline edge, a white
// highlight on the edges facing up, and one soft shadow. A facet's shade comes from its edge's outward normal against the light.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "brand");
const GENERATED = join(ROOT, "apps/site/src/generated");

/* The drawing. */

// Julius's Z (brand/zaisma-mark-black.svg): three straight-edged shards, in the drawing's units, its foot at y 3778.62.
const Z_SHARDS = [
  [[1884.08, 3033.91], [4187.01, 3033.91], [4286.71, 3778.62], [0, 3778.62]],
  [[415.6, 3484.54], [2523.65, 1440.22], [3772.16, 945.05], [1949.08, 2877.19]],
  [[835.12, 1305.06], [899.94, 721.38], [4047.84, 721.38], [2575.7, 1305.06]],
];
// His small cut (brand/zaisma-mark-small-black.svg), thicker, for 32 px and under.
const Z_SMALL_SHARDS = [
  [[1887.28, 2962.39], [4086.07, 2962.39], [4286.72, 3778.62], [0, 3778.62]],
  [[471.95, 3302.71], [2449.22, 1427.02], [3492.34, 1012.36], [1950.97, 2719.65]],
  [[2486.31, 1242.1], [1001.78, 1242.1], [1092.39, 721.38], [3675.01, 721.38]],
];
// The letters "aisma" (brand/zaisma-wordmark-black.svg), each one or more rings of straight lines; a second ring is a hole (or the i's dot).
const LETTERS = [
  "M4957,1879 L5877,1879 L6132,3779 L5212,3779 L4837,3449 L4765,2909 L5051,2579 L5601,2579 L5557,2249 L4677,2249 Z M5140,2949 L5650,2949 L5712,3409 L5202,3409 Z",
  "M6077,1879 L6447,1879 L6702,3779 L6332,3779 Z",
  "M5991,1239 L6541,1239 L6412,1619 L6042,1619 Z",
  "M6647,1879 L7847,1879 L7667,2249 L7067,2249 L7120,2644 L7950,2644 L8102,3779 L6902,3779 L7082,3409 L7682,3409 L7629,3014 L6799,3014 Z",
  "M8091,2209 L8377,1879 L9997,1879 L10252,3779 L9882,3779 L9677,2249 L9257,2249 L9462,3779 L9092,3779 L8887,2249 L8467,2249 L8672,3779 L8302,3779 Z",
  "M10527,1879 L11447,1879 L11702,3779 L10782,3779 L10407,3449 L10335,2909 L10621,2579 L11171,2579 L11127,2249 L10247,2249 Z M10710,2949 L11220,2949 L11282,3409 L10772,3409 Z",
];
// The wordmark: the Z scaled about its foot, the letters moved left to meet it.
const WORDMARK_Z_SCALE = 0.62132, WORDMARK_FOOT_Y = 3779, LETTERS_SHIFT_X = -1953;
const Z_TOP_Y = 721.38;

/* The glass. */

// One light, from the top left; a facet facing it is lit, one facing away is shaded.
const LIGHT = [-0.55, -0.83];
// The two glasses: white for dark surfaces, black for light ones. Each has its face's two stops, its bevel's and walls' tones (lit, flat on,
// shaded), its hairline edge and its highlight.
const GLASSES = {
  white: { face: ["#FBFDFF", "#D9E2EE"], bevel: { lit: "#FFFFFF", middle: "#C6D0DE", dark: "#74839A" }, wall: { lit: "#A6B2C3", middle: "#727F93", dark: "#424D5D" }, edge: "rgba(30,45,75,.42)", highlight: "#FFFFFF" },
  black: { face: ["#3C414B", "#17191E"], bevel: { lit: "#A3AAB6", middle: "#2E3239", dark: "#0B0C0F" }, wall: { lit: "#4A4F58", middle: "#24272D", dark: "#0A0B0D" }, edge: "rgba(0,0,0,.6)", highlight: "rgba(255,255,255,.75)" },
};
// The mark, in the Z's units: Julius's 125-unit bevel, walls 71 across and 220 down, its shadow below them; hairlines as the sketch drew them.
const MARK_LOOK = { bevelUnits: 125, depth: [71, 220], strokes: { wall: 16.2, bevel: 13.5, edge: 24.3, highlight: 37.8 }, shadowBlurUnits: 162, shadowAlpha: { black: 0.3, white: 0.75 } };
// The wordmark, in its own units (the Z at 0.62132): the Z's bevel 73 and its walls 45 by 140; the letters shallower, so the Z leads.
const WORDMARK_LOOK = { bevelUnits: 73, depth: [45, 140], letterDepthShare: 0.55, letterBevelShare: 0.7, strokes: { wall: 13.6, bevel: 11.4, edge: 20.5, highlight: 31.8 }, shadowBlurUnits: 70, shadowAlpha: { black: 0.22, white: 0.65 } };
// What each file shows: centered on the glass and its walls, so a page's logo sits in the middle of its bar, with room for the shadow and
// the wordmark's i dot. apps/site/src/components/foundations.ts sizes the logo by these heights over the glass's (--logo-file-share).
const MARK_FILE_VIEW_BOX = "-350 300 5060 4120";
const WORDMARK_FILE_VIEW_BOX = "-120 1239 10080 3320";

const hexToRgb = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
const mix = (from, to, share) => {
  const a = hexToRgb(from), b = hexToRgb(to), clamped = Math.max(0, Math.min(1, share));
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * clamped).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};
const shadeFor = (tones, normal) => {
  const facing = normal[0] * LIGHT[0] + normal[1] * LIGHT[1];
  return facing >= 0 ? mix(tones.middle, tones.lit, facing) : mix(tones.middle, tones.dark, -facing);
};
const round = (value, digits) => {
  // Only a fraction's trailing zeros go: a whole number keeps its own (4000, not 4).
  const fixed = value.toFixed(digits), text = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return text === "-0" ? "0" : text;
};
const pointsOf = (points, digits = 1) => points.map(([x, y]) => `${round(x, digits)},${round(y, digits)}`).join(" ");
const pathOf = (rings, digits = 1) => rings.map((ring) => `M${ring.map(([x, y]) => `${round(x, digits)},${round(y, digits)}`).join("L")}Z`).join("");
const parseRings = (path) => path.split("M").filter((part) => part.trim()).map((part) => part.replace(/Z/g, "").split("L").map((point) => point.trim().split(",").map(Number)));

function isInside(point, rings) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Each edge's unit normal, pointing out of the glass (into a hole for a hole's edges). */
function outwardNormals(rings) {
  return rings.map((ring) => ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length];
    const length = Math.hypot(b[1] - a[1], b[0] - a[0]);
    const normal = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
    const probe = [(a[0] + b[0]) / 2 + normal[0] * 4, (a[1] + b[1]) / 2 + normal[1] * 4];
    return isInside(probe, rings) ? [-normal[0], -normal[1]] : normal;
  }));
}
/** A ring moved in by distance along every edge: the face inside its bevel. */
function insetRing(ring, normals, distance) {
  const lines = ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length];
    return [[a[0] - normals[index][0] * distance, a[1] - normals[index][1] * distance], [b[0] - a[0], b[1] - a[1]]];
  });
  return ring.map((_, index) => {
    const [p1, d1] = lines[(index - 1 + ring.length) % ring.length], [p2, d2] = lines[index];
    const crossing = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(crossing) < 1e-9) return p2;
    const along = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / crossing;
    return [p1[0] + d1[0] * along, p1[1] + d1[1] * along];
  });
}

/**
 * Glass pieces drawn in one glass: { definitions, shapes } for one <svg>, every id starting with idPrefix. Each piece is
 * { rings, depthShare, bevelUnits }: its depth and bevel scale with depthShare, so the letters sit shallower than the Z.
 */
function glassDrawing(pieces, { glassName, look, idPrefix }) {
  const glass = GLASSES[glassName], strokes = look.strokes;
  let wallCount = 0, definitions = "", walls = "", fronts = "";
  definitions += `<linearGradient id="${idPrefix}-face" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${glass.face[0]}"/><stop offset="1" stop-color="${glass.face[1]}"/></linearGradient>`;
  definitions += `<filter id="${idPrefix}-shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="${look.shadowBlurUnits}"/></filter>`;
  // The shadow falls below the walls, a little right: under the light from the top left.
  const shadows = pieces.map((piece) => {
    const drop = look.depth[1] * piece.depthShare;
    return `<path d="${pathOf(piece.rings.map((ring) => ring.map(([x, y]) => [x + 0.44 * drop, y + 1.44 * drop])))}"/>`;
  }).join("");
  for (const piece of pieces) {
    const normals = outwardNormals(piece.rings), depth = [look.depth[0] * piece.depthShare, look.depth[1] * piece.depthShare];
    piece.rings.forEach((ring, ringIndex) => ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length], normal = normals[ringIndex][index];
      if (normal[0] * depth[0] + normal[1] * depth[1] <= 0) return;
      const tone = shadeFor(glass.wall, normal), id = `${idPrefix}-wall-${wallCount++}`;
      definitions += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(a[0], 1)}" y1="${round(a[1], 1)}" x2="${round(a[0] + depth[0], 1)}" y2="${round(a[1] + depth[1], 1)}"><stop offset="0" stop-color="${mix(tone, "#FFFFFF", 0.15)}"/><stop offset="1" stop-color="${mix(tone, "#000000", 0.45)}"/></linearGradient>`;
      walls += `<polygon points="${pointsOf([a, b, [b[0] + depth[0], b[1] + depth[1]], [a[0] + depth[0], a[1] + depth[1]]])}" fill="url(#${id})" stroke="${tone}" stroke-width="${strokes.wall}"/>`;
    }));
    const insets = piece.rings.map((ring, ringIndex) => insetRing(ring, normals[ringIndex], piece.bevelUnits));
    piece.rings.forEach((ring, ringIndex) => ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length], tone = shadeFor(glass.bevel, normals[ringIndex][index]), inset = insets[ringIndex];
      fronts += `<polygon points="${pointsOf([a, b, inset[(index + 1) % ring.length], inset[index]])}" fill="${tone}" stroke="${tone}" stroke-width="${strokes.bevel}"/>`;
    }));
    fronts += `<path d="${pathOf(insets)}" fill-rule="evenodd" fill="url(#${idPrefix}-face)"/><path d="${pathOf(piece.rings)}" fill="none" stroke="${glass.edge}" stroke-width="${strokes.edge}"/>`;
    piece.rings.forEach((ring, ringIndex) => ring.forEach((a, index) => {
      if (normals[ringIndex][index][1] >= -0.9) return;
      const b = ring[(index + 1) % ring.length];
      fronts += `<path d="M${round(a[0], 1)},${round(a[1], 1)}L${round(b[0], 1)},${round(b[1], 1)}" stroke="${glass.highlight}" stroke-width="${strokes.highlight}" stroke-linecap="round"/>`;
    }));
  }
  const shapes = `<g filter="url(#${idPrefix}-shadow)" fill-rule="evenodd" opacity="${look.shadowAlpha[glassName]}">${shadows}</g>${walls}${fronts}`;
  return { definitions, shapes };
}

const markPieces = (shards = Z_SHARDS) => shards.map((ring) => ({ rings: [ring], depthShare: 1, bevelUnits: MARK_LOOK.bevelUnits }));
const wordmarkPieces = () => [
  ...Z_SHARDS.map((ring) => ({ rings: [ring.map(([x, y]) => [x * WORDMARK_Z_SCALE, WORDMARK_FOOT_Y - (WORDMARK_FOOT_Y - y) * WORDMARK_Z_SCALE])], depthShare: 1, bevelUnits: WORDMARK_LOOK.bevelUnits })),
  ...LETTERS.map((path) => ({ rings: parseRings(path).map((ring) => ring.map(([x, y]) => [x + LETTERS_SHIFT_X, y])), depthShare: WORDMARK_LOOK.letterDepthShare, bevelUnits: WORDMARK_LOOK.bevelUnits * Math.max(WORDMARK_LOOK.letterBevelShare, WORDMARK_LOOK.letterDepthShare) })),
];
const markDrawing = (glassName) => glassDrawing(markPieces(), { glassName, look: MARK_LOOK, idPrefix: `logo-mark-${glassName}` });
const wordmarkDrawing = (glassName) => glassDrawing(wordmarkPieces(), { glassName, look: WORDMARK_LOOK, idPrefix: `logo-wordmark-${glassName}` });

const svgFile = (viewBox, body, label = "Zaisma") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${body}</svg>\n`;
const drawingFile = (viewBox, drawing) => svgFile(viewBox, `<defs>${drawing.definitions}</defs>${drawing.shapes}`);

/* The orange grid: a plane leaning back 40°, rolled 35° along the Z's diagonal, strong near the viewer and gone by two-thirds up. */

const GRID_LEAN_RAD = (40 * Math.PI) / 180, GRID_ROLL_RAD = (35 * Math.PI) / 180, GRID_FOCAL = 60, GRID_NEAR = 1.2;
const GRID_ORANGE = { light: "#F7931A", dark: "#A85A06" };
const gridFade = (distance) => Math.max(0, Math.min(1, Math.pow(Math.max(0, 1 - (distance - 0.75) / 3.2), 2) * 1.15));

/** The grid in a box width wide and 100 tall, centered at centerX: line paths grouped by strength and width, so the file stays small. */
function gridLines(theme, { width, centerX, horizonY, uLimit, step = 0.3, vStart, rowStart, rowChunk, isRowFadedAtNearEnd }) {
  const project = (u, v) => {
    const height = v * Math.cos(GRID_LEAN_RAD), distance = GRID_NEAR + v * Math.sin(GRID_LEAN_RAD);
    const dx = GRID_FOCAL * u / distance, dy = horizonY - (GRID_FOCAL * height) / distance - 62;
    return [centerX + dx * Math.cos(GRID_ROLL_RAD) - dy * Math.sin(GRID_ROLL_RAD), 62 + dx * Math.sin(GRID_ROLL_RAD) + dy * Math.cos(GRID_ROLL_RAD), distance];
  };
  const strengthOf = (distance) => gridFade(distance) * (theme === "light" ? 1 : 0.85);
  const widthOf = (distance) => Math.max(0.12, Math.min(1.1, 1.15 / distance));
  const groups = new Map();
  const add = (a, b, distance) => {
    const strength = strengthOf(distance);
    if (strength <= 0.01) return;
    if (Math.max(a[0], b[0]) < -5 || Math.min(a[0], b[0]) > width + 5 || Math.max(a[1], b[1]) < -5 || Math.min(a[1], b[1]) > 105) return;
    const key = `${strength.toFixed(2)} ${widthOf(distance).toFixed(2)}`;
    const group = groups.get(key) ?? { d: "", end: "" };
    const start = `${round(a[0], 2)},${round(a[1], 2)}`, end = `${round(b[0], 2)},${round(b[1], 2)}`;
    group.d += group.end === start ? `L${end}` : `M${start}L${end}`;
    group.end = end;
    groups.set(key, group);
  };
  const depths = [];
  for (let v = vStart; v < 26; v += 0.12 * (1 + Math.max(0, v) * 0.5)) depths.push(v);
  for (let u = -uLimit; u <= uLimit + 0.001; u += step) for (let i = 0; i < depths.length - 1; i++) {
    const a = project(u, depths[i]), b = project(u, depths[i + 1]);
    add(a, b, isRowFadedAtNearEnd ? Math.min(a[2], b[2]) : a[2]);
  }
  for (let v = rowStart; v < 26; v += step) {
    if (!rowChunk) add(project(-uLimit, v), project(uLimit, v), project(-uLimit, v)[2]);
    else for (let u = -uLimit; u < uLimit; u += rowChunk) {
      const a = project(u, v), b = project(u + rowChunk, v);
      add(a, b, Math.min(a[2], b[2]));
    }
  }
  return [...groups].map(([key, group]) => {
    const [strength, lineWidth] = key.split(" ");
    return `<path d="${group.d}" stroke-opacity="${round(Number(strength), 2)}" stroke-width="${round(Number(lineWidth), 2)}"/>`;
  }).join("");
}

/* The app icon: the mark in front of the grid. */

const ICON_BACKGROUNDS = { light: ["#FFFFFF", "#FFF7EE"], dark: ["#050505", "#120B03"] };
const ICON_CORNER = 22.5;
// The glass Z's box in its own units (the walls included) and where its middle sits on the icon: the sketch's place and size.
const Z_GLASS_BOX = { left: 0, top: Z_TOP_Y, right: 4286.71 + MARK_LOOK.depth[0], bottom: 3778.62 + MARK_LOOK.depth[1] };
const ICON_Z_SCALE = 0.0185, ICON_Z_MIDDLE = [50, 50.3];
// On a maskable icon the whole Z stays inside the circle a home screen may cut it to (the middle 80%).
const MASKABLE_Z_SHARE = 80 / Math.hypot((Z_GLASS_BOX.right - Z_GLASS_BOX.left) * ICON_Z_SCALE, (Z_GLASS_BOX.bottom - Z_GLASS_BOX.top) * ICON_Z_SCALE);

const zPlacement = (scale) => {
  const x = ICON_Z_MIDDLE[0] - ((Z_GLASS_BOX.left + Z_GLASS_BOX.right) / 2) * scale;
  const y = ICON_Z_MIDDLE[1] - ((Z_GLASS_BOX.top + Z_GLASS_BOX.bottom) / 2) * scale;
  return `translate(${round(x, 3)} ${round(y, 3)}) scale(${round(scale, 6)})`;
};

/** The icon, 100 units square: rounded (the tile) or square (for a home screen or Stripe that rounds it), the Z at a share of its size. */
function iconSvg(theme, { isRounded = true, zShare = 1 } = {}) {
  const drawing = markDrawing(theme === "light" ? "black" : "white");
  const [top, bottom] = ICON_BACKGROUNDS[theme];
  const grid = gridLines(theme, { width: 100, centerX: 50, horizonY: 64, uLimit: 24, vStart: -0.9, rowStart: -0.8, rowChunk: 0, isRowFadedAtNearEnd: false });
  const corner = isRounded ? ` rx="${ICON_CORNER}"` : "";
  const body = `<defs><linearGradient id="icon-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><clipPath id="icon-tile"><rect width="100" height="100"${corner}/></clipPath>${drawing.definitions}</defs>`
    + `<g clip-path="url(#icon-tile)"><rect width="100" height="100" fill="url(#icon-back)"/><g fill="none" stroke="${GRID_ORANGE[theme]}">${grid}</g>`
    + `<g transform="${zPlacement(ICON_Z_SCALE * zShare)}">${drawing.shapes}</g></g>`;
  return svgFile("0 0 100 100", body);
}

/* The favicon: the icon with the small cut in three flat tones per shard (face, lit and shaded), light or dark with the browser. */

function faviconSvg() {
  const tones = {
    black: { face: mix(GLASSES.black.face[0], GLASSES.black.face[1], 0.5), lit: GLASSES.black.bevel.lit, shade: GLASSES.black.bevel.dark },
    white: { face: mix(GLASSES.white.face[0], GLASSES.white.face[1], 0.5), lit: GLASSES.white.bevel.lit, shade: GLASSES.white.bevel.dark },
  };
  // At 16 to 32 px a bevel needs to be wider than a pixel to show.
  const bevelUnits = 250, depth = MARK_LOOK.depth;
  let shapes = "";
  for (const ring of Z_SMALL_SHARDS) {
    const [normals] = outwardNormals([ring]);
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length], normal = normals[index];
      if (normal[0] * depth[0] + normal[1] * depth[1] > 0) shapes += `<polygon class="shade" points="${pointsOf([a, b, [b[0] + depth[0], b[1] + depth[1]], [a[0] + depth[0], a[1] + depth[1]]], 0)}"/>`;
    });
  }
  for (const ring of Z_SMALL_SHARDS) {
    const [normals] = outwardNormals([ring]), inset = insetRing(ring, normals, bevelUnits);
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length], facing = normals[index][0] * LIGHT[0] + normals[index][1] * LIGHT[1];
      shapes += `<polygon class="${facing >= 0 ? "lit" : "shade"}" points="${pointsOf([a, b, inset[(index + 1) % ring.length], inset[index]], 0)}"/>`;
    });
    shapes += `<polygon class="face" points="${pointsOf(inset, 0)}"/>`;
  }
  const grid = gridLines("light", { width: 100, centerX: 50, horizonY: 64, uLimit: 24, step: 0.6, vStart: -0.9, rowStart: -0.8, rowChunk: 0, isRowFadedAtNearEnd: false });
  const style = `.light-back{fill:url(#favicon-light)}.grid{stroke:${GRID_ORANGE.light}}.face{fill:${tones.black.face}}.lit{fill:${tones.black.lit}}.shade{fill:${tones.black.shade}}`
    + `@media (prefers-color-scheme:dark){.light-back{fill:url(#favicon-dark)}.grid{stroke:${GRID_ORANGE.dark};opacity:.85}.face{fill:${tones.white.face}}.lit{fill:${tones.white.lit}}.shade{fill:${tones.white.shade}}}`;
  const body = `<style>${style}</style><defs><linearGradient id="favicon-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ICON_BACKGROUNDS.light[0]}"/><stop offset="1" stop-color="${ICON_BACKGROUNDS.light[1]}"/></linearGradient>`
    + `<linearGradient id="favicon-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ICON_BACKGROUNDS.dark[0]}"/><stop offset="1" stop-color="${ICON_BACKGROUNDS.dark[1]}"/></linearGradient><clipPath id="favicon-tile"><rect width="100" height="100" rx="${ICON_CORNER}"/></clipPath></defs>`
    + `<g clip-path="url(#favicon-tile)"><rect class="light-back" width="100" height="100"/><g class="grid" fill="none">${grid}</g><g transform="${zPlacement(ICON_Z_SCALE)}">${shapes}</g></g>`;
  return svgFile("0 0 100 100", body);
}

/* The share card: the full wordmark over the grid, the Relay far off to the right with its beam and flare, players streaking toward it. */

// The card is 190 by 99.75 units, drawn at 1200 by 630.
const CARD_WIDTH = 190, CARD_HEIGHT = 99.75;
// The Relay's heights in the city (apps/site/src/components/city.ts), drawn RELAY_DRAWN_HEIGHT units tall from its feet to its tips.
const RELAY_FOOT_Y = 9.25, RELAY_TIP_Y = 168, CAPSTONE_BOTTOM_Y = 180, CAPSTONE_TOP_Y = 193;
const RELAY_DRAWN_HEIGHT = 10, RELAY_SCALE = RELAY_DRAWN_HEIGHT / (RELAY_TIP_Y - RELAY_FOOT_Y);
const RELAY_FOOT = [131, 33], RELAY_AXIS = [Math.sin(GRID_ROLL_RAD), -Math.cos(GRID_ROLL_RAD)];
const BEAM_START = [RELAY_FOOT[0] + RELAY_AXIS[0] * (RELAY_DRAWN_HEIGHT + 2), RELAY_FOOT[1] + RELAY_AXIS[1] * (RELAY_DRAWN_HEIGHT + 2)];

const CARD_DEFINITIONS = {
  light: `<linearGradient id="card-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFF7EE"/></linearGradient>`
    + `<radialGradient id="card-core"><stop offset="0" stop-color="#FFF6EA"/><stop offset=".12" stop-color="#FFB04A"/><stop offset=".35" stop-color="#E9820A" stop-opacity=".75"/><stop offset=".7" stop-color="#F7931A" stop-opacity=".25"/><stop offset="1" stop-color="#F7931A" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="card-halo"><stop offset=".55" stop-color="#E9820A" stop-opacity="0"/><stop offset=".82" stop-color="#E9820A" stop-opacity=".28"/><stop offset="1" stop-color="#F7931A" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="card-dawn"><stop offset="0" stop-color="#FFCF94" stop-opacity=".75"/><stop offset=".55" stop-color="#FFE6C6" stop-opacity=".35"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="card-streak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C46A08" stop-opacity="0"/><stop offset=".4" stop-color="#E9820A" stop-opacity=".55"/><stop offset=".5" stop-color="#F7931A"/><stop offset=".6" stop-color="#E9820A" stop-opacity=".55"/><stop offset="1" stop-color="#C46A08" stop-opacity="0"/></linearGradient>`,
  dark: `<linearGradient id="card-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050505"/><stop offset="1" stop-color="#120B03"/></linearGradient>`
    + `<radialGradient id="card-core"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".18" stop-color="#FFF1D6"/><stop offset=".45" stop-color="#FFB04A" stop-opacity=".55"/><stop offset="1" stop-color="#F7931A" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="card-halo"><stop offset=".55" stop-color="#F7931A" stop-opacity="0"/><stop offset=".8" stop-color="#FFB04A" stop-opacity=".2"/><stop offset="1" stop-color="#F7931A" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="card-dawn"><stop offset="0" stop-color="#6A3504" stop-opacity=".85"/><stop offset=".55" stop-color="#2E1602" stop-opacity=".45"/><stop offset="1" stop-color="#050505" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="card-streak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F7931A" stop-opacity="0"/><stop offset=".42" stop-color="#FFC27A" stop-opacity=".6"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset=".58" stop-color="#FFC27A" stop-opacity=".6"/><stop offset="1" stop-color="#F7931A" stop-opacity="0"/></linearGradient>`,
};

/** A card's drawing: its shapes, and the gradients they need added to definitions (ids card-0, card-1, ...). */
function cardSvg(theme) {
  const isLight = theme === "light";
  let gradientCount = 0, definitions = CARD_DEFINITIONS[theme];
  const gradient = (from, to, start, end, fromAlpha = 1, toAlpha = 1) => {
    const id = `card-${gradientCount++}`;
    definitions += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(start[0], 2)}" y1="${round(start[1], 2)}" x2="${round(end[0], 2)}" y2="${round(end[1], 2)}"><stop offset="0" stop-color="${from}" stop-opacity="${fromAlpha}"/><stop offset="1" stop-color="${to}" stop-opacity="${toAlpha}"/></linearGradient>`;
    return `url(#${id})`;
  };
  definitions += `<filter id="card-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation=".9"/></filter><filter id="card-beam-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.5"/></filter>`;
  const points = (list) => pointsOf(list, 2);
  const across = [-RELAY_AXIS[1], RELAY_AXIS[0]];

  // The dawn round the Relay's foot, and its beam rising out of the card.
  let relay = "";
  const glowMiddle = [RELAY_FOOT[0] + RELAY_AXIS[0] * 5, RELAY_FOOT[1] + RELAY_AXIS[1] * 5];
  relay += `<ellipse cx="${round(glowMiddle[0], 2)}" cy="${round(glowMiddle[1], 2)}" rx="40" ry="24" fill="url(#card-dawn)"/>`;
  const far = [BEAM_START[0] + RELAY_AXIS[0] * 200, BEAM_START[1] + RELAY_AXIS[1] * 200];
  const beam = (width, farWidth) => [[BEAM_START[0] - across[0] * width, BEAM_START[1] - across[1] * width], [BEAM_START[0] + across[0] * width, BEAM_START[1] + across[1] * width], [far[0] + across[0] * farWidth, far[1] + across[1] * farWidth], [far[0] - across[0] * farWidth, far[1] - across[1] * farWidth]];
  const along = (length) => [BEAM_START[0] + RELAY_AXIS[0] * length, BEAM_START[1] + RELAY_AXIS[1] * length];
  relay += `<polygon points="${points(beam(1, 12))}" fill="${gradient(isLight ? "#E9820A" : "#FFB04A", "#F7931A", BEAM_START, along(75), isLight ? 0.6 : 0.55, 0)}" filter="url(#card-beam-glow)"/>`;
  relay += `<polygon points="${points(beam(0.45, 1.6))}" fill="${gradient(isLight ? "#D4700A" : "#FFFFFF", isLight ? "#F7931A" : "#FFE2B0", BEAM_START, along(85), 1, 0)}"/>`;

  // The Relay: two blades over a slit that narrows from 28 at the feet to 10 at the flat tips, the capstone's two halves floating over
  // them, rungs across the blades every 12 units, and the core's door glowing at the foot of the slit. City units, y up, then scaled.
  const at = (x, y) => [x * RELAY_SCALE, -(y - RELAY_FOOT_Y) * RELAY_SCALE];
  const fills = isLight ? ["#E3E6EA", "#EEF0F3"] : ["#0A0B0E", "#111318"], seam = isLight ? "#A85A06" : "#FFB020";
  const rim = isLight ? ` stroke="#C9CED5" stroke-width=".12"` : "";
  let tower = "";
  for (const side of [-1, 1]) {
    const blade = [at(side * 29.5, RELAY_FOOT_Y), at(side * 14, RELAY_FOOT_Y), at(side * 5, RELAY_TIP_Y), at(side * 8, RELAY_TIP_Y)];
    tower += `<polygon points="${points(blade)}" fill="${fills[side < 0 ? 0 : 1]}"${rim}/>`;
    const capstone = [at(side * 2.5, CAPSTONE_BOTTOM_Y), at(side * 7, CAPSTONE_BOTTOM_Y), at(side * 5.2, CAPSTONE_TOP_Y), at(side * 2.5, CAPSTONE_TOP_Y)];
    tower += `<polygon points="${points(capstone)}" fill="${fills[side < 0 ? 0 : 1]}"${rim}/>`;
    if (isLight) {
      const [footInner, tipInner] = [at(side * 14, RELAY_FOOT_Y), at(side * 5, RELAY_TIP_Y)];
      tower += `<path d="M${points([footInner])}L${points([tipInner])}" stroke="${seam}" stroke-width=".18"/>`;
      for (let height = RELAY_FOOT_Y + 12; height < RELAY_TIP_Y; height += 12) {
        const share = (height - RELAY_FOOT_Y) / (RELAY_TIP_Y - RELAY_FOOT_Y);
        tower += `<path d="M${points([at(side * (29.5 + (8 - 29.5) * share), height)])}L${points([at(side * (14 + (5 - 14) * share), height)])}" stroke="${seam}" stroke-width=".06" opacity=".6"/>`;
      }
    }
  }
  if (!isLight) tower += `<path d="M0,0L0,${round(-RELAY_DRAWN_HEIGHT, 2)}" stroke="#FFE7A8" stroke-width=".22"/>`;
  tower += `<rect x="-0.4" y="-1.1" width=".8" height="1.1" fill="${seam}"/>`;
  relay += `<g transform="translate(${RELAY_FOOT[0]} ${RELAY_FOOT[1]}) rotate(35)">${tower}</g>`;

  // Players: orange streaks heading for the Relay, big and long near the camera, small and faint near it. [x, y, how far off].
  let players = "";
  const target = [RELAY_FOOT[0] + RELAY_AXIS[0] * 4, RELAY_FOOT[1] + RELAY_AXIS[1] * 4];
  for (const [x, y, farShare] of [[16, 88, 0.05], [176, 90, 0.12], [8, 34, 0.3], [58, 18, 0.55], [180, 52, 0.5], [104, 20, 0.85], [160, 30, 0.88], [118, 40, 0.95]]) {
    const distance = Math.hypot(target[0] - x, target[1] - y), heading = [(target[0] - x) / distance, (target[1] - y) / distance], side = [-heading[1], heading[0]];
    const near = 1 - farShare, width = 0.25 + near * 1.1, alpha = 0.6 + near * 0.4, length = Math.min(distance * 0.85, 8 + near * 50);
    const tail = [x - heading[0] * length, y - heading[1] * length], tones = isLight ? ["#F7931A", "#C46A08"] : ["#F7931A", "#FFA024"];
    if (!isLight) players += `<polygon points="${points([[x + side[0] * width * 1.6, y + side[1] * width * 1.6], tail, [x - side[0] * width * 1.6, y - side[1] * width * 1.6]])}" fill="${gradient("#F7931A", "#F7931A", tail, [x, y], 0, 0.3 * alpha)}" filter="url(#card-glow)"/>`;
    players += `<polygon points="${points([[x + side[0] * width, y + side[1] * width], tail, [x - side[0] * width, y - side[1] * width]])}" fill="${gradient(tones[0], tones[1], tail, [x, y], 0, alpha)}"/><circle cx="${x}" cy="${y}" r="${round(width, 3)}" fill="${tones[1]}" opacity="${round(alpha, 3)}"/>`;
  }

  // The lens flare at the capstone: a halo, a long thin streak, a star, the core, and ghosts down toward the card's middle.
  const [flareX, flareY] = BEAM_START.map((value) => Number(round(value, 2)));
  let flare = `<circle cx="${flareX}" cy="${flareY}" r="19" fill="url(#card-halo)" opacity="${isLight ? 0.9 : 0.85}"/>`;
  flare += `<ellipse cx="${flareX}" cy="${flareY}" rx="80" ry="${isLight ? 0.6 : 0.5}" fill="url(#card-streak)" opacity="${isLight ? 0.75 : 0.8}"/>`;
  const rayTones = isLight ? ["#E9820A", "#F7931A"] : ["#FFFFFF", "#FFC27A"];
  for (const [angleDeg, length] of [[0, 12], [60, 7], [120, 7], [180, 12], [240, 7], [300, 7], [90, 9], [270, 9], [30, 4], [150, 4], [210, 4], [330, 4]]) {
    const angle = (angleDeg * Math.PI) / 180, end = [flareX + Math.cos(angle) * length, flareY + Math.sin(angle) * length];
    flare += `<path d="M${flareX},${flareY}L${points([end])}" stroke="${gradient(rayTones[0], rayTones[1], [flareX, flareY], end, 0.9, 0)}" stroke-width="${isLight ? 0.35 : 0.3}"/>`;
  }
  flare += `<circle cx="${flareX}" cy="${flareY}" r="8" fill="url(#card-core)"/><circle cx="${flareX}" cy="${flareY}" r="${isLight ? 0.7 : 1}" fill="${isLight ? "#FFF6EA" : "#FFFFFF"}"/>`;
  const ghosts = isLight
    ? [[0.6, 1.3, "#E9820A", 0.4, false], [1.1, 3.6, "#F7931A", 0.12, true], [1.55, 1.8, "#C46A08", 0.22, false], [2, 5, "#F7931A", 0.08, true]]
    : [[0.6, 1.3, "#FFC27A", 0.3, false], [1.1, 3.6, "#F7931A", 0.08, true], [1.55, 1.8, "#7FD6E8", 0.13, false], [2, 5, "#F7931A", 0.05, true]];
  for (const [share, radius, color, alpha, hasRing] of ghosts) {
    const x = round(flareX + (95 - flareX) * share, 2), y = round(flareY + (50 - flareY) * share, 2);
    flare += `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity="${alpha}"/>`;
    if (hasRing) flare += `<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="${color}" stroke-width=".25" opacity="${round(alpha * 2.2, 3)}"/>`;
  }

  const wordmark = wordmarkDrawing(isLight ? "black" : "white");
  const grid = gridLines(theme, { width: CARD_WIDTH, centerX: 95, horizonY: 64, uLimit: 40, vStart: -0.95, rowStart: -0.9, rowChunk: 1.5, isRowFadedAtNearEnd: true });
  const body = `<defs>${definitions}${wordmark.definitions}</defs><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#card-back)"/><g fill="none" stroke="${GRID_ORANGE[theme]}">${grid}</g>`
    + `${relay}${players}${flare}<svg x="34" y="37" width="122" height="35" viewBox="-60 1150 10000 2900">${wordmark.shapes}</svg>`;
  return svgFile(`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`, body);
}

/* The files. */

const MANIFEST = `${JSON.stringify({
  name: "Zaisma", short_name: "Zaisma", start_url: "/", display: "browser", background_color: "#FFFFFF", theme_color: "#E7E4DF",
  icons: [
    { src: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2)}\n`;

/**
 * The glass logo's SVGs as a module the site puts in its pages (components/icons.ts), so the first paint shows the logo without waiting
 * on a file: the same text as the brand files.
 */
const logoModule = (svgs) =>
  `// Made by scripts/brand.mjs with the glass logo's brand files: never edit it by hand.\nexport const GLASS_LOGO_SVGS = ${JSON.stringify(svgs, null, 2)} as const;\n`;

/** Every text file: its name, the folder it goes in, and its text. */
function textFiles() {
  const logo = { wordmark: { black: drawingFile(WORDMARK_FILE_VIEW_BOX, wordmarkDrawing("black")), white: drawingFile(WORDMARK_FILE_VIEW_BOX, wordmarkDrawing("white")) }, mark: { black: drawingFile(MARK_FILE_VIEW_BOX, markDrawing("black")), white: drawingFile(MARK_FILE_VIEW_BOX, markDrawing("white")) } };
  return [
    ["logo-svgs.generated.ts", GENERATED, logoModule(logo)],
    ["zaisma-mark-glass-black.svg", BRAND, drawingFile(MARK_FILE_VIEW_BOX, markDrawing("black"))],
    ["zaisma-mark-glass-white.svg", BRAND, drawingFile(MARK_FILE_VIEW_BOX, markDrawing("white"))],
    ["zaisma-wordmark-glass-black.svg", BRAND, drawingFile(WORDMARK_FILE_VIEW_BOX, wordmarkDrawing("black"))],
    ["zaisma-wordmark-glass-white.svg", BRAND, drawingFile(WORDMARK_FILE_VIEW_BOX, wordmarkDrawing("white"))],
    ["zaisma-icon-light.svg", BRAND, iconSvg("light")],
    ["zaisma-icon-dark.svg", BRAND, iconSvg("dark")],
    ["favicon.svg", BRAND, faviconSvg()],
    ["share-card-light.svg", BRAND, cardSvg("light")],
    ["share-card-dark.svg", BRAND, cardSvg("dark")],
    ["manifest.webmanifest", BRAND, MANIFEST],
  ];
}

const viewBoxSize = (viewBox) => viewBox.split(" ").slice(2).map(Number);

/** Every picture: its file name, the SVG it's drawn from, its size in pixels, and the color scheme it's drawn in. */
function pictures() {
  const [markWidth, markHeight] = viewBoxSize(MARK_FILE_VIEW_BOX), [wordmarkWidth, wordmarkHeight] = viewBoxSize(WORDMARK_FILE_VIEW_BOX);
  const markFile = (glassName) => drawingFile(MARK_FILE_VIEW_BOX, markDrawing(glassName));
  const wordmarkFile = (glassName) => drawingFile(WORDMARK_FILE_VIEW_BOX, wordmarkDrawing(glassName));
  const light = iconSvg("light"), square = iconSvg("light", { isRounded: false }), circle = iconSvg("light", { isRounded: false, zShare: MASKABLE_Z_SHARE });
  return [
    ["zaisma-mark-glass-black-2048.png", markFile("black"), 2048, Math.round((2048 * markHeight) / markWidth)],
    ["zaisma-mark-glass-white-2048.png", markFile("white"), 2048, Math.round((2048 * markHeight) / markWidth)],
    ["zaisma-wordmark-glass-black-2400.png", wordmarkFile("black"), 2400, Math.round((2400 * wordmarkHeight) / wordmarkWidth)],
    ["zaisma-wordmark-glass-white-2400.png", wordmarkFile("white"), 2400, Math.round((2400 * wordmarkHeight) / wordmarkWidth)],
    ["app-icon-1024.png", light, 1024, 1024],
    ["app-icon-512.png", light, 512, 512],
    ["app-icon-192.png", light, 192, 192],
    ["app-icon-dark-512.png", iconSvg("dark"), 512, 512],
    // A home screen rounds the corners itself; Stripe and a maskable icon may cut it to a circle.
    ["apple-touch-icon.png", square, 180, 180],
    ["stripe-icon.png", circle, 512, 512],
    ["app-icon-maskable-512.png", circle, 512, 512],
    ["favicon-32.png", faviconSvg(), 32, 32],
    ["share-card-light.png", cardSvg("light"), 1200, 630],
    ["share-card-dark.png", cardSvg("dark"), 1200, 630],
  ];
}

/** An ICO holding PNGs (every browser since 2007 reads them): its header, one entry per size, then the pictures. */
function icoOf(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ sizePx, data }, index) => {
    const at = 6 + 16 * index;
    header.writeUInt8(sizePx % 256, at);
    header.writeUInt8(sizePx % 256, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(({ data }) => data)]);
}

async function renderPictures() {
  const { openChrome } = await import("./chrome.mjs");
  const { chromeToRun } = await import("./layout-check.mjs");
  const chrome = await openChrome(await chromeToRun(), "zaisma-brand-");
  try {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, parameters = {}) => chrome.send(method, parameters, sessionId);
    await send("Page.enable");
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    const { frameTree } = await send("Page.getFrameTree");
    const render = async (svg, widthPx, heightPx) => {
      await send("Emulation.setDeviceMetricsOverride", { width: widthPx, height: heightPx, deviceScaleFactor: 1, mobile: false });
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${widthPx}px;height:${heightPx}px}</style>${svg}` });
      await send("Runtime.evaluate", { expression: "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))", awaitPromise: true });
      const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: widthPx, height: heightPx, scale: 1 } });
      return Buffer.from(data, "base64");
    };
    for (const [name, svg, widthPx, heightPx] of pictures()) {
      const data = await render(svg, widthPx, heightPx);
      writeFileSync(join(BRAND, name), data);
      console.log(`brand/${name} (${widthPx} × ${heightPx}, ${Math.round(data.length / 1024)} KB)`);
    }
    const favicon = faviconSvg(), sizes = [16, 32, 48];
    const pngs = [];
    for (const sizePx of sizes) pngs.push({ sizePx, data: await render(favicon, sizePx, sizePx) });
    writeFileSync(join(BRAND, "favicon.ico"), icoOf(pngs));
    console.log(`brand/favicon.ico (${sizes.join(", ")} px)`);
  } finally {
    await chrome.close();
  }
}

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
for (const [name, folder, text] of textFiles()) {
  const target = out ?? folder;
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, name), text);
  if (!out) console.log(`${folder === BRAND ? "brand" : "apps/site/src/generated"}/${name} (${Math.round(text.length / 1024)} KB)`);
}
if (!args.includes("--svg-only")) await renderPictures();
