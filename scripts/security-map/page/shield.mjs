import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SECTOR_IDS } from "../schema.mjs";

/**
 * The page's art, as one hidden SVG of symbols, drawn once and used everywhere: the shield in its four
 * states, plain, with the Z for Zaisma and with an emblem for each sector, and the harm and lock pictures. Only a whole
 * shield shines; a breaking one deepens from pale red to full red, the same scale as harm and locks. An emblem is drawn into the shield under its cracks and
 * inside its clips, so it breaks with it. Harm and locks take currentColor, so the page's tokens color them in
 * both themes.
 */

/** A shield's drawing runs off its shape's box to leave room for shards and torn halves. */
const SHIELD_DRAWING_BOX = "-14 -8 128 126";
/** What holds a shield. A used symbol lands at 0 0 and fills this box, so it starts at 0 0 too: a box starting anywhere else pushes the shield off center and cuts its far edges. */
export const SHIELD_VIEW_BOX = "0 0 128 126";

const OUTLINE = "M50 6 L88 20 V52 C88 78 68 94 50 102 C32 94 12 78 12 52 V20 Z";
const FACE = "M50 13 L81 24.5 V52 C81 73.5 65 87.5 50 94.5 C35 87.5 19 73.5 19 52 V24.5 Z";
const FACE_SHADED_SIDE = "M50 13 L81 24.5 V52 C81 73.5 65 87.5 50 94.5 Z";
const LIT_EDGE = "M50 8.2 L14.2 21.4 V52 C14.2 58 15.4 63.6 17.4 68.6";
const CHIP_EDGE = "58,-6 62,18 76,26 72,40 114,46";
const TEAR_EDGE = "52,-6 44,22 56,40 42,60 54,80 46,112";

/** Every break is the same black: a crack, a chip's edge and a tear. */
const BREAK_COLOR = "#0D0D0F";

const COLORS_BY_STATE = {
  whole: { rim: ["#E4F0FC", "#6FAEEE", "#1B5A9E"], face: ["#62AEF8", "#1C5EAE"], edge: "#0C3E73", shade: 0.16, lit: 0.75, markOpacity: 0.95, mark: "#FFFFFF" },
  cracked: { rim: ["#EAC9C9", "#CF8F8F", "#9A5555"], face: ["#D49A9A", "#A86666"], edge: "#6E3A3A", shade: 0.1, lit: 0.3, markOpacity: 0.85, mark: "#FFFFFF" },
  chipped: { rim: ["#EDBBBB", "#D86F6F", "#A23F3F"], face: ["#DE7C7C", "#AE4A4A"], edge: "#6E2A2A", shade: 0.08, lit: 0.2, markOpacity: 0.65, mark: "#000000" },
  torn: { rim: ["#F2AAAA", "#E04545", "#A81F1F"], face: ["#E04545", "#A81F1F"], edge: "#6B1212", shade: 0.06, lit: 0.1, markOpacity: 0.6, mark: "#000000" },
};

const gradientOf = (gradientId, colors) => `<linearGradient id="${gradientId}" x1="0.15" y1="0" x2="0.75" y2="1">${colors.map((color, index) => `<stop offset="${index / (colors.length - 1)}" stop-color="${color}"/>`).join("")}</linearGradient>`;

function plateOf(state) {
  const { edge, shade, lit } = COLORS_BY_STATE[state];
  return `<use href="#shield-outline" fill="url(#rim-${state})" stroke="${edge}" stroke-width="1.5"/><use href="#shield-face" fill="url(#face-${state})"/><path d="${FACE_SHADED_SIDE}" fill="#000" opacity="${shade}"/><path d="${LIT_EDGE}" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="${lit}"/>`;
}

/** A line cut into the glass: its dark groove, and the light catching its far side. */
function crackOf(points, grooveWidth) {
  return `<polyline points="${points}" fill="none" stroke="#fff" stroke-width="${grooveWidth * 0.5}" stroke-linejoin="round" opacity="0.35" transform="translate(1.1 0.7)"/><polyline points="${points}" fill="none" stroke="${BREAK_COLOR}" stroke-width="${grooveWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

const sparkleOf = (x, y, size) => `<path d="M${x} ${y - size} L${x + size * 0.24} ${y - size * 0.24} L${x + size} ${y} L${x + size * 0.24} ${y + size * 0.24} L${x} ${y + size} L${x - size * 0.24} ${y + size * 0.24} L${x - size} ${y} L${x - size * 0.24} ${y - size * 0.24} Z" fill="#fff"/>`;

const WHOLE_SHEEN = `<g clip-path="url(#clip-face)"><polygon points="24,8 44,2 18,80 7,64" fill="#fff" opacity="0.42"/><polygon points="49,2 55,3 28,88 22,82" fill="#fff" opacity="0.24"/><ellipse cx="50" cy="104" rx="34" ry="16" fill="#9CD0FF" opacity="0.28"/></g>`;
const WHOLE_SPARKLES = `${sparkleOf(76, 22, 8)}${sparkleOf(87, 38, 3.2)}`;

/** Each sector's emblem, in line, centered on the shield's face. */
const EMBLEM_DRAWINGS = {
  "player-data": `<path d="M36 34 H58 L66 42 V66 H36 Z M42 34 V43 H56 V34 M42 66 V53 H60 V66"/>`,
  accounts: `<rect x="31" y="37" width="38" height="27" rx="3"/><circle cx="42" cy="47" r="3.6"/><path d="M36 58 C37.5 53.5 46.5 53.5 48 58 M54 45 H64 M54 52 H64"/>`,
  money: `<circle cx="50" cy="50" r="17"/><path d="M56.5 44 C54 40.5 44 40.5 44 46 C44 52 56.5 48 56.5 54.5 C56.5 59.5 46 59.5 43.5 56 M50 37.5 V62.5"/>`,
  "api-keys": `<circle cx="41" cy="42" r="8.5"/><path d="M47 48 L66 67 M59 60 L64.5 54.5 M64 65 L69 60"/>`,
  "games-and-files": `<path d="M38 39 H62 C69 39 73 52 73 60 C73 66 66 67 62 62 L58 57 H42 L38 62 C34 67 27 66 27 60 C27 52 31 39 38 39 Z M39 45 V52 M35.5 48.5 H42.5"/><circle cx="58" cy="45.5" r="1.2"/><circle cx="62.5" cy="50.5" r="1.2"/>`,
  rooms: `<path d="M38 68 V36 C38 34 39 33 41 33 H59 C61 33 62 34 62 36 V68 M31 68 H69"/><circle cx="56" cy="51" r="1.4"/>`,
  "zaisma-keys-and-admin": `<path d="M32 60 L29 39 L41 49 L50 33 L59 49 L71 39 L68 60 Z M32 67 H68"/>`,
  "staying-up": `<path d="M28 58 L38 48 L47 54 L60 38 L72 44 M60 38 V50 M72 44 H60 M30 68 H70"/>`,
};

/** Zaisma's shield carries the logo's own Z, read from its one-color file so it's never redrawn. */
const ZAISMA_EMBLEM = "zaisma";
const MARK_FILE_PATH = join(import.meta.dirname, "../../../brand/zaisma-mark-white.svg");
const markDrawing = () => `<g id="emblem-${ZAISMA_EMBLEM}" transform="translate(50 50) scale(0.0103) translate(-2143 -2250)">${readFileSync(MARK_FILE_PATH, "utf8").match(/<path [^>]*\/>/g).join("")}</g>`;

/** An emblem is white with a dark outline in every state, so it reads on the sheen and on the fade alike. */
const emblemLineOf = (sectorId, color, lineWidth, opacity) => `<g fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"><use href="#emblem-${sectorId}" transform="translate(50 51) scale(1.25) translate(-50 -50)"/></g>`;

function emblemOf(state, sectorId) {
  if (!sectorId) return "";
  const { markOpacity, mark } = COLORS_BY_STATE[state];
  if (sectorId === ZAISMA_EMBLEM) return `<g fill="${mark}" opacity="${markOpacity}"><use href="#emblem-${ZAISMA_EMBLEM}"/></g>`;
  return `${emblemLineOf(sectorId, "#0A2340", 9, 0.85)}${emblemLineOf(sectorId, "#fff", 4.6, 1)}`;
}

const SHIELD_DRAWINGS = {
  whole: (sectorId) => `${plateOf("whole")}${WHOLE_SHEEN}${emblemOf("whole", sectorId)}${WHOLE_SPARKLES}`,
  cracked: (sectorId) => `${plateOf("cracked")}${emblemOf("cracked", sectorId)}${crackOf("56,8 48,26 58,38 46,54 54,68", 2.2)}${crackOf("48,26 36,32", 1.6)}${crackOf("58,38 66,44", 1.3)}`,
  chipped: (sectorId) => `<g clip-path="url(#clip-chip)">${plateOf("chipped")}${emblemOf("chipped", sectorId)}${crackOf("62,18 50,36 56,50 44,72", 2.2)}${crackOf("50,36 38,40", 1.5)}${crackOf("56,50 66,58", 1.3)}</g><polyline points="${CHIP_EDGE}" fill="none" stroke="${BREAK_COLOR}" stroke-width="1.8" stroke-linejoin="round" clip-path="url(#clip-outline)"/><polygon points="88,10 99,4 97,20 90,18" fill="url(#rim-chipped)" stroke="${COLORS_BY_STATE.chipped.edge}" stroke-width="1.2"/><polygon points="102,26 107,24 106,31" fill="${COLORS_BY_STATE.chipped.rim[1]}" stroke="${COLORS_BY_STATE.chipped.edge}" stroke-width="0.8"/>`,
  torn: (sectorId) => `<g transform="translate(-7 4) rotate(-8 50 54)"><g clip-path="url(#clip-tear-left)">${plateOf("torn")}${emblemOf("torn", sectorId)}</g><polyline points="${TEAR_EDGE}" fill="none" stroke="${BREAK_COLOR}" stroke-width="1.8" stroke-linejoin="round" clip-path="url(#clip-outline)"/></g><g transform="translate(9 6) rotate(9 50 54)"><g clip-path="url(#clip-tear-right)">${plateOf("torn")}${emblemOf("torn", sectorId)}</g><polyline points="${TEAR_EDGE}" fill="none" stroke="${BREAK_COLOR}" stroke-width="1.8" stroke-linejoin="round" clip-path="url(#clip-outline)"/></g>`,
};

const PERSON = (x, y, scale) => `<g transform="translate(${x} ${y}) scale(${scale})" fill="currentColor"><circle cx="0" cy="-5.2" r="3.4"/><path d="M-5.8 6 C-5.8 0.6 -3.2 -1 0 -1 C3.2 -1 5.8 0.6 5.8 6 Z"/></g>`;

const HARM_DRAWINGS = {
  one_player: { viewBox: "0 0 24 24", drawing: PERSON(12, 13, 1) },
  a_few: { viewBox: "0 0 24 24", drawing: `${PERSON(7.5, 13, 0.85)}${PERSON(16.5, 13, 0.85)}` },
  one_game: { viewBox: "0 0 24 24", drawing: `${PERSON(5, 15, 0.7)}${PERSON(19, 15, 0.7)}${PERSON(12, 11, 0.9)}` },
  many_games: { viewBox: "0 0 24 24", drawing: `${PERSON(4, 18, 0.5)}${PERSON(12, 18, 0.5)}${PERSON(20, 18, 0.5)}${PERSON(8, 8.5, 0.5)}${PERSON(16, 8.5, 0.5)}` },
  everyone: { viewBox: "0 0 24 24", drawing: `<g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><ellipse cx="12" cy="12" rx="4.2" ry="9.5"/><path d="M3 9 H21 M3 15 H21"/></g>` },
};

const LOCK_BODY = (x, width) => `<rect x="${x}" y="11" width="${width}" height="10" rx="2"/>`;

const LOCK_DRAWINGS = {
  open: { viewBox: "0 0 24 24", drawing: `<g fill="none" stroke="currentColor" stroke-width="2">${LOCK_BODY(3, 13)}<path d="M12 11 V6.5 a4 4 0 0 1 8 0 V8.5"/></g>` },
  key_in_it: { viewBox: "0 0 24 24", drawing: `<g fill="none" stroke="currentColor" stroke-width="2">${LOCK_BODY(3, 14)}<path d="M6 11 V7 a4 4 0 0 1 8 0 V11"/></g><circle cx="10" cy="16" r="1.7" fill="currentColor"/><path d="M10 16 H23 M20 16 V19.5" fill="none" stroke="currentColor" stroke-width="1.7"/>` },
  locked: { viewBox: "0 0 24 24", drawing: `<g fill="none" stroke="currentColor" stroke-width="2">${LOCK_BODY(5, 14)}<path d="M8 11 V7 a4 4 0 0 1 8 0 V11"/></g><circle cx="12" cy="16" r="1.6" fill="currentColor"/>` },
  two_locks: { viewBox: "0 0 30 24", drawing: `<g fill="none" stroke="currentColor" stroke-width="2">${LOCK_BODY(2, 12)}<path d="M4.5 11 V7 a3.5 3.5 0 0 1 7 0 V11"/>${LOCK_BODY(16, 12)}<path d="M18.5 11 V7 a3.5 3.5 0 0 1 7 0 V11"/></g><circle cx="8" cy="16" r="1.4" fill="currentColor"/><circle cx="22" cy="16" r="1.4" fill="currentColor"/>` },
  vault: { viewBox: "0 0 24 24", drawing: `<rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor"/><g fill="none" stroke="var(--bg)" stroke-width="1.8"><circle cx="12" cy="12" r="6"/><path d="M12 6 V18 M6 12 H18"/></g>` },
};

/** The one hidden SVG. It's sized to nothing rather than display: none, which would stop its gradients from painting. */
export function artSprite() {
  const defs = [
    ...Object.entries(COLORS_BY_STATE).flatMap(([state, { rim, face }]) => [gradientOf(`rim-${state}`, rim), gradientOf(`face-${state}`, face)]),
    `<path id="shield-outline" d="${OUTLINE}"/><path id="shield-face" d="${FACE}"/>`,
    ...Object.entries(EMBLEM_DRAWINGS).map(([sectorId, drawing]) => `<g id="emblem-${sectorId}">${drawing}</g>`),
    markDrawing(),
    `<clipPath id="clip-outline"><use href="#shield-outline"/></clipPath><clipPath id="clip-face"><use href="#shield-face"/></clipPath>`,
    `<clipPath id="clip-chip"><polygon points="-14,-6 ${CHIP_EDGE} 114,112 -14,112"/></clipPath>`,
    `<clipPath id="clip-tear-left"><polygon points="-14,-6 ${TEAR_EDGE} -14,112"/></clipPath><clipPath id="clip-tear-right"><polygon points="114,-6 114,112 ${TEAR_EDGE.split(" ").reverse().join(" ")}"/></clipPath>`,
  ].join("");
  const symbols = [
    ...Object.entries(SHIELD_DRAWINGS).flatMap(([state, drawingOf]) => [null, ZAISMA_EMBLEM, ...SECTOR_IDS].map((sectorId) => `<symbol id="shield-${state}${sectorId ? `-${sectorId}` : ""}" viewBox="${SHIELD_DRAWING_BOX}">${drawingOf(sectorId)}</symbol>`)),
    ...Object.entries(HARM_DRAWINGS).map(([level, { viewBox, drawing }]) => `<symbol id="harm-${level}" viewBox="${viewBox}">${drawing}</symbol>`),
    ...Object.entries(LOCK_DRAWINGS).map(([level, { viewBox, drawing }]) => `<symbol id="lock-${level}" viewBox="${viewBox}">${drawing}</symbol>`),
  ].join("");
  return `<svg class="art-sprite" width="0" height="0" aria-hidden="true"><defs>${defs}</defs>${symbols}</svg>`;
}
