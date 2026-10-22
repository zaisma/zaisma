import { raw, type Raw } from "../markup.ts";
import { LINK_BRAND_ICON_PATHS } from "../link-icons.ts";

/** A site's own mark (Simple Icons, link-icons.ts), filled in the words' color: on a developer's link to that site. */
const siteMark = (site: keyof typeof LINK_BRAND_ICON_PATHS) => `<svg class="ico solid" viewBox="0 0 24 24" aria-hidden="true"><path d="${LINK_BRAND_ICON_PATHS[site]}"/></svg>`;
const stroke = (viewBox: string, paths: string, extra = "") => `<svg class="ico" viewBox="${viewBox}" aria-hidden="true"${extra}>${paths}</svg>`;

/** Every line icon the drafts use. Each is drawn in the words' color (.ico). */
export const ICONS = {
  person: stroke("0 0 20 20", '<circle cx="10" cy="6.8" r="3.2"/><path d="M3.8 17.2c0-3.4 2.8-5.9 6.2-5.9s6.2 2.5 6.2 5.9"/>'),
  people: stroke("0 0 16 16", '<circle cx="6" cy="5.2" r="2.4"/><path d="M1.8 13.2c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2"/><circle cx="11.6" cy="5.8" r="1.9"/><path d="M10.9 9c2 .2 3.4 1.9 3.4 4"/>', ' stroke-width="1.5"'),
  friends: stroke("0 0 20 20", '<circle cx="6.5" cy="7" r="2.5"/><circle cx="13.5" cy="7" r="2.5"/><path d="M2 16.5c0-2.5 2-4.5 4.5-4.5 1.3 0 2.5.5 3.3 1.4M18 16.5c0-2.5-2-4.5-4.5-4.5-1.3 0-2.5.5-3.3 1.4"/>'),
  // Playing on your own, in your own world.
  headphones: stroke("0 0 20 20", '<path d="M3.6 12.6V10a6.4 6.4 0 0 1 12.8 0v2.6"/><rect x="2.6" y="11.4" width="3.6" height="5.6" rx="1.5"/><rect x="13.8" y="11.4" width="3.6" height="5.6" rx="1.5"/>'),
  // Everyone, everywhere: meeting new players.
  // A globe turned to a continent, marking a region (a game's rooms by where they run).
  "globe-africa": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M7.4 6.6l3.8-.2 1.9 1.7-.4 2.1-1.5 2.2-.8 2.5-1.3-.4-.6-2.4-1.5-1.9.4-2z"/>'),
  "globe-antarctica": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M5.2 14.4l2.7-.9h4.2l2.7.9-1.7 1.6H6.9z"/>'),
  "globe-asia": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M5.6 6l4.2-1.6 4.4 1 1.7 2.5-1.3 1.7-2.5.4-1 1.9-1.9-.6-1.3-1.7-1.9-.8z"/>'),
  "globe-europe": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M6.8 5.6l2.3-1 2.8.5 1.5 1.7-.6 1.9-2.1.5-1.5 1.5-1.9-.4-.6-1.7.8-1.2z"/>'),
  "globe-north-america": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M4.4 6.6l2.7-2.1 3.4.2 1 1.9-1.7 1.7-.6 2.3-1.7 1.3-1.3-1.5-1.7-.6z"/>'),
  "globe-oceania": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M9.6 11.4l3.1-.6 1.9 1.3.2 1.9-1.7 1.3-2.1-.2-1.5-1.3z"/>'),
  "globe-south-america": stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M8.8 10.2l2.5.4 1.5 1.9-.8 2.5-1.7 2.1-.8-2.3-.8-2.3z"/>'),
  globe: stroke("0 0 20 20", '<circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c1.9 2 2.9 4.4 2.9 7.2s-1 5.2-2.9 7.2c-1.9-2-2.9-4.4-2.9-7.2s1-5.2 2.9-7.2z"/>'),
  clock: stroke("0 0 16 16", '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.5"/>', ' stroke-width="1.5"'),
  calendar: stroke("0 0 20 20", '<path d="M3.5 5h13v11.5h-13z"/><path d="M3.5 8.6h13M7 3.2v3.4M13 3.2v3.4"/>'),
  lock: stroke("0 0 20 20", '<path d="M4.5 9h11v8.5h-11z"/><path d="M7 9V6.6a3 3 0 0 1 6 0V9"/><path d="M10 12.4v2"/>'),
  mail: stroke("0 0 20 20", '<path d="M3 5h14v10.5H3z"/><path d="M3.4 5.6 10 11l6.6-5.4"/>'),
  gear: stroke(
    "0 0 20 20",
    '<polygon points="15.99,8.40 18.59,8.64 18.59,11.36 15.99,11.60 15.37,13.10 17.04,15.11 15.11,17.04 13.10,15.37 11.60,15.99 11.36,18.59 8.64,18.59 8.40,15.99 6.90,15.37 4.89,17.04 2.96,15.11 4.63,13.10 4.01,11.60 1.41,11.36 1.41,8.64 4.01,8.40 4.63,6.90 2.96,4.89 4.89,2.96 6.90,4.63 8.40,4.01 8.64,1.41 11.36,1.41 11.60,4.01 13.10,4.63 15.11,2.96 17.04,4.89 15.37,6.90"/><polygon points="12.68,11.11 11.11,12.68 8.89,12.68 7.32,11.11 7.32,8.89 8.89,7.32 11.11,7.32 12.68,8.89"/>',
    ' stroke-width="1.4"',
  ),
  code: stroke("0 0 20 20", '<path d="M7 5.5L2.5 10 7 14.5M13 5.5l4.5 4.5-4.5 4.5"/>'),
  "sign-out": stroke("0 0 20 20", '<path d="M12 4H5v12h7M9 10h8M14 7l3 3-3 3"/>'),
  search: stroke("0 0 20 20", '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/>', ' stroke-width="1.8"'),
  eye: stroke("0 0 20 20", '<path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/>'),
  "chevron-down": stroke("0 0 20 12", '<path d="M2 2l8 8 8-8"/>', ' stroke-width="2.2"'),
  "chevron-right": stroke("0 0 12 20", '<path d="M2 2l8 8-8 8"/>', ' stroke-width="2.4"'),
  // The sun on light glass, the moon on smoked (--on-light and --on-smoked): the theme a page is in.
  "light-dark": stroke(
    "0 0 20 20",
    '<g class="on-light"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></g><g class="on-smoked"><path d="M15.5 12.6A6.6 6.6 0 0 1 7.4 4.5a6.6 6.6 0 1 0 8.1 8.1z"/></g>',
    ' stroke-width="1.8"',
  ),
  trash: stroke("0 0 20 20", '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.2 5.5l.8 11h8l.8-11"/><path d="M8.5 8.6v5M11.5 8.6v5"/>'),
  close: stroke("0 0 20 20", '<path d="M5 5l10 10M15 5 5 15"/>', ' stroke-width="1.8"'),
  check: stroke("0 0 20 20", '<path d="M4.2 10.4l3.9 3.9 7.7-8.6"/>', ' stroke-width="2.2"'),
  copy: stroke("0 0 20 20", '<path d="M7 7h9.5v9.5H7z"/><path d="M13 7V3.5H3.5V13H7"/>'),
  upload: stroke("0 0 20 20", '<path d="M10 13.2V3.6M6.2 7.2 10 3.4l3.8 3.8"/><path d="M3.5 12.4v4.1h13v-4.1"/>'),
  warning: stroke("0 0 20 20", '<path d="M10 2.8 18.2 17H1.8z"/><path d="M10 8v4.2M10 14.6v.1"/>'),
  share: stroke("0 0 20 20", '<path d="M10 2.8v10M6.4 6.2 10 2.6l3.6 3.6"/><path d="M4.5 10v6.5h11V10"/>'),
  flag: stroke("0 0 20 20", '<path d="M4.5 17.5V3"/><path d="M4.5 3.5h10.5l-2.2 3.8 2.2 3.8H4.5"/>'),
  hash: stroke("0 0 20 20", '<path d="M4 7.5h13M3 12.5h13M8.5 3 7 17M13.5 3 12 17"/>'),
  "full-screen": stroke("0 0 20 20", '<path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4"/>'),
  more: stroke("0 0 20 20", '<circle cx="4.5" cy="10" r="1.1"/><circle cx="10" cy="10" r="1.1"/><circle cx="15.5" cy="10" r="1.1"/>', ' stroke-width="1.8"'),
  save: stroke("0 0 20 20", '<path d="M4 3h9.5L16 5.5V17H4z"/><path d="M7 3v4.5h6V3M7 17v-5.5h6V17"/>'),
  rules: stroke("0 0 20 20", '<path d="M10 2.8l6.5 2.4v4.6c0 3.6-2.8 6.6-6.5 7.4-3.7-.8-6.5-3.8-6.5-7.4V5.2z"/><path d="M7.2 10l2 2 3.8-4.2"/>'),
  games: stroke("0 0 20 20", '<path d="M3.5 3.5h5.5V9H3.5zM11 3.5h5.5V9H11zM3.5 11H9v5.5H3.5zM11 11h5.5v5.5H11z"/>'),
  "signal-weak": stroke("0 0 20 20", '<path d="M4.5 16.5v-3"/><path d="M10 16.5v-7" opacity="0.35"/><path d="M15.5 16.5v-11" opacity="0.35"/>', ' stroke-width="2.4"'),
  "signal-lost": stroke("0 0 20 20", '<path d="M4.5 16.5v-3M10 16.5v-7M15.5 16.5v-11" opacity="0.35"/><path d="M3 3l14 14"/>', ' stroke-width="2.2"'),
  reconnecting: stroke("0 0 20 20", '<path d="M16.5 10a6.5 6.5 0 0 1-11.4 4.3M3.5 10a6.5 6.5 0 0 1 11.4-4.3"/><path d="M15 2.8v3.4h-3.4M5 17.2v-3.4h3.4"/>'),
  // Playing together at one screen.
  gamepad: stroke("0 0 20 20", '<path d="M6.2 6h7.6a3.6 3.6 0 0 1 3.5 2.8l.8 3.8a2 2 0 0 1-3.5 1.6L13 12.5H7l-1.6 1.7a2 2 0 0 1-3.5-1.6l.8-3.8A3.6 3.6 0 0 1 6.2 6z"/><path d="M6.4 8.4v2.4M5.2 9.6h2.4M13.4 9h.1M15 10.6h.1"/>'),
  // Devices a game works on.
  phone: stroke("0 0 20 20", '<path d="M6.5 2.5h7v15h-7z"/><path d="M9.2 15h1.6"/>'),
  tablet: stroke("0 0 20 20", '<path d="M3.5 3.5h13v13h-13z"/><path d="M9.2 14.2h1.6"/>'),
  computer: stroke("0 0 20 20", '<path d="M2.8 4h14.4v9.5H2.8z"/><path d="M7 17h6M10 13.5V17"/>'),
  refresh: stroke("0 0 20 20", '<path d="M16.3 10a6.3 6.3 0 1 1-1.9-4.5"/><path d="M15.4 2.6v3.6h-3.6"/>'),
  download: stroke("0 0 20 20", '<path d="M10 3.5v9M6.2 8.8 10 12.6l3.8-3.8"/><path d="M4 16.5h12"/>'),
  "out-of-page": stroke("0 0 20 20", '<path d="M11.5 3.5h5v5M16.5 3.5 9.5 10.5"/><path d="M14.5 12v4.5h-11v-11H8"/>'),
  passkey: stroke("0 0 24 24", '<circle cx="8" cy="9" r="4"/><path d="M2 20c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.5"/><circle cx="17.5" cy="13.5" r="2.5"/><path d="M17.5 16v5M17.5 19h2"/>', ' stroke-width="1.7"'),
  // Filled arrows, for scrolling a row back and on.
  "arrow-back": '<svg class="ico solid" viewBox="0 0 12 16" aria-hidden="true"><path d="M12 0H7L0 8l7 8h5L5 8z"/></svg>',
  "arrow-on": '<svg class="ico solid" viewBox="0 0 12 16" aria-hidden="true"><path d="M0 0h5l7 8-7 8H0l7-8z"/></svg>',
  // Sites a developer links to from their game's page, each in its own mark.
  ...(Object.fromEntries(Object.keys(LINK_BRAND_ICON_PATHS).map((site) => [`site-${site}`, siteMark(site as keyof typeof LINK_BRAND_ICON_PATHS)])) as Record<`site-${keyof typeof LINK_BRAND_ICON_PATHS}`, string>),
  play: '<svg class="play" viewBox="0 0 16 18" width="14" height="16" aria-hidden="true"><path d="M2 1.5l12 7.5-12 7.5z" fill="currentColor"/></svg>',
} as const;
export type IconName = keyof typeof ICONS;
export const icon = (name: IconName): Raw => raw(ICONS[name]);

/** Zaisma's wordmark and mark, drawn in the words' color (brand/zaisma-wordmark-black.svg, brand/zaisma-mark-black.svg). */
const MARK_PATHS = '<path d="M1884.08,3033.91c767.645,0 1535.29,0 2302.930,0c33.233,248.238 66.466,496.475 99.699,744.712l-4286.71,-0c627.367,-243.599 1255.990,-491.890 1884.080,-744.712Z"/><path d="M415.598,3484.54c777.297,-719.363 1475.76,-1400.24 2108.05,-2044.32c404.715,-158.588 821.55,-323.759 1248.51,-495.17c-547.607,610.584 -1151.51,1254.04 -1823.08,1932.14c-520.17,209.105 -1032.22,411.7 -1533.48,607.345Z"/><path d="M2575.7,1305.06l-1740.58,0c21.608,-194.559 43.215,-389.119 64.823,-583.678l3147.9,0c-485.752,195.366 -976.426,389.899 -1472.14,583.678Z"/>';
export const WORDMARK = raw(
  `<svg viewBox="-120 1080 9988 2820" role="img" aria-label="Zaisma"><g fill="currentColor"><g transform="translate(0 3779) scale(0.62132) translate(0 -3779)">${MARK_PATHS}</g><g transform="translate(-1953 0)"><path d="M4957,1879 L5877,1879 L6132,3779 L5212,3779 L4837,3449 L4765,2909 L5051,2579 L5601,2579 L5557,2249 L4677,2249 Z M5140,2949 L5650,2949 L5712,3409 L5202,3409 Z" fill-rule="evenodd"/><path d="M6077,1879 L6447,1879 L6702,3779 L6332,3779 Z M5991,1239 L6541,1239 L6412,1619 L6042,1619 Z" fill-rule="evenodd"/><path d="M6647,1879 L7847,1879 L7667,2249 L7067,2249 L7120,2644 L7950,2644 L8102,3779 L6902,3779 L7082,3409 L7682,3409 L7629,3014 L6799,3014 Z" fill-rule="evenodd"/><path d="M8091,2209 L8377,1879 L9997,1879 L10252,3779 L9882,3779 L9677,2249 L9257,2249 L9462,3779 L9092,3779 L8887,2249 L8467,2249 L8672,3779 L8302,3779 Z" fill-rule="evenodd"/><path d="M10527,1879 L11447,1879 L11702,3779 L10782,3779 L10407,3449 L10335,2909 L10621,2579 L11171,2579 L11127,2249 L10247,2249 Z M10710,2949 L11220,2949 L11282,3409 L10772,3409 Z" fill-rule="evenodd"/></g></g></svg>`,
);
export const MARK = raw(`<svg viewBox="-120 600 4527 3300" aria-hidden="true"><g fill="currentColor">${MARK_PATHS}</g></svg>`);
