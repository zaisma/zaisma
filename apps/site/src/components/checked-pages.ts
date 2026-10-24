/*
 * The screens and pages the layout check measures (scripts/layout-check.mjs), which Screens (screens.ts) shows and offers. A module with
 * no imports, so the check reads it in Node as it is.
 */

/** The screens every page is shown and measured on: Julius's phone, and a desktop. scripts/layout-check.mjs measures at the same. */
export const SCREEN_SIZES = [
  { name: "Phone", widthPx: 320, heightPx: 667, isPhone: true },
  { name: "Desktop", widthPx: 1440, heightPx: 900, isPhone: false },
] as const;
export const SCREEN_THEMES = ["light", "dark"] as const;

export interface CheckedPage {
  name: string;
  /** Which branch of Zaisma it's in, as Screens groups its links. */
  area: "Playing" | "Signing in" | "Developers" | "Gallery";
  /** On this site, or on the stand-in site of a developer using Sign in with Zaisma (isOnSignInSite), which sends the player on to Zaisma's own page. */
  path: string;
  /**
   * Where the page's runner (its one main action) must show without scrolling: at every size, only on a desktop (the city's pane starts
   * low on a phone, showing down to its heading, so the city has the screen: docs/DECISIONS.md, "Signing in happens in the city"), or
   * nowhere (the page has none, or many, like the gallery).
   */
  mainActionShows: "everywhere" | "desktop" | "nowhere";
  /** The page is for finding a game (the home): its first cover shows whole without scrolling, on every screen. */
  isCoverAboveFold?: boolean;
  isOnSignInSite?: boolean;
  /**
   * What the page starts hidden (a sheet, a card over the game) is opened before it's measured: a script in the page, run once it has settled
   * (an expression the check waits for). Screens shows the page as it opens, without this.
   */
  setUp?: string;
  /** The test account it's seen signed in as (scripts/preview/sign-ins.mjs). */
  account?: string;
  /** The gallery takes light or dark from its address. */
  isGallery?: boolean;
}

const CITY = { mainActionShows: "desktop" } as const;

/** The Players sheet, opened from the playing bar's Players button. */
const OPEN_PLAYERS_SHEET = `(async () => { document.querySelector('[aria-controls="players"]').click(); await new Promise((done) => setTimeout(done, 600)); return true; })()`;
/** The cards over a running game that start hidden (the game asking to sign in, the save toast), shown one under another. */
const SHOW_PLAYING_CARDS = `(async () => {
  let top = 70;
  for (const id of ["sign-in-ask", "save-toast"]) {
    const card = document.getElementById(id);
    if (!card) continue;
    if (id === "save-toast") card.querySelector("p").textContent = "Progress saves to your account.";
    card.hidden = false;
    card.style.top = top + "px";
    top += 20 + card.getBoundingClientRect().height;
  }
  await new Promise((done) => setTimeout(done, 600));
  return true;
})()`;
const GALLERY_GROUPS = ["", "/layout", "/actions", "/inputs", "/navigation", "/panes", "/data"];

/** Every page and state the layout check opens (scripts/layout-check.mjs), and the Screens page offers. */
export const CHECKED_PAGES: CheckedPage[] = [
  { name: "Home", area: "Playing", path: "/", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Home, signed in", area: "Playing", path: "/", account: "Moss_Runner", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Game page", area: "Playing", path: "/g/cave-crew", mainActionShows: "everywhere" },
  { name: "Game page, no rooms", area: "Playing", path: "/g/shard-dodge", mainActionShows: "everywhere" },
  { name: "Tester link", area: "Playing", path: "/t/7e57ed00dcafe0a1b2c3", mainActionShows: "everywhere" },
  { name: "Playing a game, the players sheet", area: "Playing", path: "/g/cave-crew?play", mainActionShows: "nowhere", setUp: OPEN_PLAYERS_SHEET },
  { name: "Playing a game, asked to sign in", area: "Playing", path: "/g/tiny-farm?play", mainActionShows: "nowhere", setUp: SHOW_PLAYING_CARDS },
  { name: "Games", area: "Playing", path: "/games", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, one genre", area: "Playing", path: "/games?filter=strategy", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Sign in", area: "Signing in", path: "/signin", ...CITY },
  { name: "Make an account", area: "Signing in", path: "/join", ...CITY },
  { name: "Forgot your password", area: "Signing in", path: "/signin/email", ...CITY },
  { name: "Background guide", area: "Developers", path: "/developers/backgrounds", mainActionShows: "nowhere" },
  { name: "Example page", area: "Gallery", path: "/design/example", mainActionShows: "everywhere" },
  { name: "Connect an app", area: "Signing in", path: "/mcp-start", isOnSignInSite: true, account: "Preview_Studio", mainActionShows: "everywhere" },
  { name: "Sign in with Zaisma", area: "Signing in", path: "/start", isOnSignInSite: true, account: "Moss_Runner", mainActionShows: "everywhere" },
  ...GALLERY_GROUPS.map((group): CheckedPage => ({ name: `Gallery${group ? `: ${group.slice(1)}` : ": foundations"}`, area: "Gallery", path: `/design${group}`, mainActionShows: "nowhere", isGallery: true })),
  { name: "Screens", area: "Gallery", path: "/design/screens?page=%2Fdesign%2Fexample", mainActionShows: "nowhere", isGallery: true },
];

