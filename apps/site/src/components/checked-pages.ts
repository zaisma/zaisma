import { GALLERY_PLACES, galleryPagePath, type ComponentGroup, type GalleryPlace } from "./component.ts";

/*
 * The screens and pages the layout check measures (scripts/layout-check.mjs), which Screens (screens.ts) shows and offers. A module with
 * no imports but component.ts (whose own are only types), so the check reads it in Node as it is.
 */

/**
 * The screens every page is measured on, the ones players bring (docs/DESIGN.md, Screens): a small phone and a common one, a phone on its side,
 * an iPad, a Steam Deck, a laptop and a 1440p monitor. A phone is drawn at twice its pixels as a mobile browser; a touch screen is held to 44px
 * targets; the runner is held above the fold except on a phone on its side, which scrolls.
 */
export const SCREEN_SIZES = [
  { name: "Phone", widthPx: 320, heightPx: 667, isPhone: true, hasTouch: true, isRunnerChecked: true },
  { name: "Big phone", widthPx: 390, heightPx: 844, isPhone: true, hasTouch: true, isRunnerChecked: true },
  { name: "Landscape phone", widthPx: 844, heightPx: 390, isPhone: true, hasTouch: true, isRunnerChecked: false },
  { name: "Tablet", widthPx: 820, heightPx: 1180, isPhone: false, hasTouch: true, isRunnerChecked: true },
  { name: "Steam Deck", widthPx: 1280, heightPx: 800, isPhone: false, hasTouch: true, isRunnerChecked: true },
  { name: "Laptop", widthPx: 1440, heightPx: 900, isPhone: false, hasTouch: false, isRunnerChecked: true },
  { name: "Desktop", widthPx: 2560, heightPx: 1440, isPhone: false, hasTouch: false, isRunnerChecked: true },
] as const;
export type ScreenName = (typeof SCREEN_SIZES)[number]["name"];
/** What a run checks unless told otherwise (npm run layout:check -- --screens): Julius's phone and a laptop, so a build's runs stay quick. GitHub's check runs all seven. */
export const LOCAL_SCREEN_NAMES: readonly ScreenName[] = ["Phone", "Laptop"];
/** The screens a run at 200% text checks (--text 200): a laptop and an iPad. A phone at 320 is already checked to reflow. */
export const TEXT_SCREEN_NAMES: readonly ScreenName[] = ["Tablet", "Laptop"];
export const SCREEN_THEMES = ["light", "dark"] as const;

/**
 * A form the check fills in and sends before it measures, to reach a state only a form shows (a wrong password, a code that didn't work).
 * It's sent as a browser without the page's scripts would send it, so their own checks (a birthday's wheels) don't stop it, and its
 * answer loads whole instead of being swapped in place.
 */
export interface FormToSend {
  /** The form's action, as written in the page: the first form there with it. */
  formAction: string;
  /**
   * Each field's name and what's typed in it, added when the form has no such field (the bot check's token, which its script adds as
   * the form is sent). Required fields left out are sent empty. UNIQUE_WORD in a value is a new word each time it's sent, for a limit
   * kept on the value itself (3 codes an hour to one address).
   */
  fieldValues: Readonly<Record<string, string>>;
}

/** An address opened in the same browser, as a player following a link would (a way to sign in, which a form's answer can't redirect to). */
export interface PageToOpen {
  path: string;
}

/** A step toward a state only forms and links reach. */
export type StepToTake = FormToSend | PageToOpen;

/** Stands for a new word each time a form is sent (FormToSend.fieldValues). */
export const UNIQUE_WORD = "{unique}";
/** Cloudflare's test token, which the preview's bot check passes (scripts/preview/run.mjs, TURNSTILE_TOKEN). */
const BOT_CHECK_PASSED = { turnstile_token: "XXXX.DUMMY.TOKEN.XXXX" } as const;
/** An address no account has, new each time: it's sent a code the same as one that has, without reaching any limit. */
const NEW_EMAIL = { email: `checked-${UNIQUE_WORD}@example.test`, ...BOT_CHECK_PASSED } as const;

export interface CheckedPage {
  /** The state's name, which the page says it is (layout's checkedPage, html.ts): the check fails when the page says another. */
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
  /** With setUp: the state the page says it is at its address, before setUp opens what it hides. */
  stateBeforeSetUp?: string;
  /** The state the page says it is when that's another entry's: the same page seen as a stress account (STRESS_ACCOUNTS). */
  shownStateName?: string;
  /** The test account it's seen signed in as (scripts/preview/sign-ins.mjs). */
  account?: string;
  /** The gallery takes light or dark from its address. */
  isGallery?: boolean;
  /** Taken in order once the page has loaded, each answer's page taking the next: the state is the last one's answer. */
  stepsToTake?: readonly StepToTake[];
  /** Left off Screens' list, since showing it there leaves a mark on whoever looks (too young sets a cookie that keeps them from joining for a day). */
  isOffScreens?: boolean;
}

const CITY = { mainActionShows: "desktop" } as const;

/**
 * The stress accounts (scripts/preview/sign-ins.mjs), and the words each adds to a page's name: every name at its field's longest, nothing at
 * all, and a great many things. A page that lists what depends on who's looking is listed as each of them too (the layout check fails one that isn't).
 */
export const STRESS_ACCOUNTS = [
  { account: "Longest_Names_Here", nameEnding: "long names" },
  { account: "Empty_Handed", nameEnding: "empty" },
  { account: "Many_Things", nameEnding: "full" },
] as const;
/** The page's name its stress entries start with: a signed-in state's without its ", signed in". */
export const stressBaseName = (name: string): string => name.replace(/, signed in$/, "");

/** The Players sheet, opened from the playing bar's Players button. */
const OPEN_PLAYERS_SHEET = `(async () => { document.querySelector('[aria-controls="players"]').click(); await new Promise((done) => setTimeout(done, 600)); return true; })()`;
/** The cards over a running game that start hidden (the game asking to sign in, signed out), shown one under another. */
const SHOW_PLAYING_CARDS = `(async () => {
  let top = 70;
  for (const id of ["sign-in-ask", "signed-out"]) {
    const card = document.getElementById(id);
    if (!card) continue;
    if (card.popover && card.showPopover) card.showPopover();
    card.hidden = false;
    card.style.top = top + "px";
    // One that wouldn't fit under the one before (a phone on its side) stays hidden: over a game they come one at a time.
    if (top + card.getBoundingClientRect().height > innerHeight - 8 && top > 70) { card.hidden = true; continue; }
    top += 20 + card.getBoundingClientRect().height;
  }
  await new Promise((done) => setTimeout(done, 600));
  return true;
})()`;
/**
 * The buy sheet over the game, opened for one item as a tap in the game would (buy-sheet.ts, preview only), and settled; then the moments
 * it can't reach on its own (a decline), or the presses of a player who gets to the Confirm it's you dialog, each given a moment to settle.
 */
const openBuySheet = (itemName: string, ...moments: string[]) => `(async () => {
  window.showBuyMoment("open", ${JSON.stringify(itemName)});
  for (let tryIndex = 0; tryIndex < 50 && !document.getElementById("buy-loading").hidden; tryIndex += 1) await new Promise((done) => setTimeout(done, 100));
  ${moments.map((moment) => `window.showBuyMoment(${JSON.stringify(moment)}); await new Promise((done) => setTimeout(done, 1500));`).join("\n  ")}
  await new Promise((done) => setTimeout(done, 600));
  return true;
})()`;
const GALLERY = { area: "Gallery", mainActionShows: "nowhere", isGallery: true } as const;
/** A gallery page's state: "Gallery: inputs fields", or "Gallery: layout" for a group that's one page. */
export const galleryPageName = (place: GalleryPlace): `Gallery: ${ComponentGroup}` | `Gallery: ${ComponentGroup} ${string}` => (place.subgroup ? `Gallery: ${place.group} ${place.subgroup}` : `Gallery: ${place.group}`);
/** A grown-up's birthday for the join steps, and one too young for an account. */
const ADULT_BIRTHDAY = { birthday: "1990-04-12" } as const;
const TOO_YOUNG_BIRTHDAY = { birthday: "2020-04-12" } as const;
/** No account has this username, so its password is always wrong and nothing gets locked out. */
const WRONG_SIGN_IN = { username: "Nobody_Here", password: "not the password", ...BOT_CHECK_PASSED } as const;

/**
 * Every page and state the layout check opens (scripts/layout-check.mjs), and the Screens page offers. A page built in Zaisma's look
 * names the state it renders from this list (layout's checkedPage), so typecheck fails for a rebuilt state that isn't here, and the layout
 * check fails when an entry's address shows another.
 */
const CHECKED_PAGE_LIST = [
  { name: "Home", area: "Playing", path: "/", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Home, signed in", area: "Playing", path: "/", account: "Moss_Runner", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Home, long names", area: "Playing", path: "/", account: "Longest_Names_Here", shownStateName: "Home, signed in", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Home, empty", area: "Playing", path: "/", account: "Empty_Handed", shownStateName: "Home, signed in", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Home, full", area: "Playing", path: "/", account: "Many_Things", shownStateName: "Home, signed in", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Game page", area: "Playing", path: "/g/cave-crew", mainActionShows: "everywhere" },
  { name: "Game page, no rooms", area: "Playing", path: "/g/shard-dodge", mainActionShows: "everywhere" },
  { name: "Game page, for sale", area: "Playing", path: "/g/ashfall", mainActionShows: "everywhere" },
  // The longest title and description a game can have, and every name on its page at its longest.
  { name: "Game page, long names", area: "Playing", path: "/g/wandering-lighthouse-keeper", account: "Longest_Names_Here", shownStateName: "Game page, no rooms", mainActionShows: "everywhere" },
  { name: "Tester link", area: "Playing", path: "/t/7e57ed00dcafe0a1b2c3", mainActionShows: "everywhere" },
  { name: "Playing a game, the players sheet", area: "Playing", path: "/g/cave-crew?play", mainActionShows: "nowhere", setUp: OPEN_PLAYERS_SHEET, stateBeforeSetUp: "Game page" },
  { name: "Playing a game, asked to sign in", area: "Playing", path: "/g/tiny-farm?play", mainActionShows: "nowhere", setUp: SHOW_PLAYING_CARDS, stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buying, one press", area: "Playing", path: "/g/tiny-farm?play", account: "Card_Keeper", mainActionShows: "nowhere", setUp: openBuySheet("revive"), stateBeforeSetUp: "Game page, no rooms" },
  // Pin_Keeper has a purchase PIN: Buy is pressed once, which opens the Confirm it's you dialog over the panel, asking for the PIN (the stand-in's test card is saved first where it has none).
  { name: "Buying, confirm with a PIN", area: "Playing", path: "/g/tiny-farm?play", account: "Pin_Keeper", mainActionShows: "nowhere", setUp: openBuySheet("revive", "press_buy"), stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buying, a first card", area: "Playing", path: "/g/tiny-farm?play", account: "Moss_Runner", mainActionShows: "nowhere", setUp: openBuySheet("spring_valley"), stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buying, already owned", area: "Playing", path: "/g/tiny-farm?play", account: "Card_Keeper", mainActionShows: "nowhere", setUp: openBuySheet("straw_hat"), stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buying, can't be bought", area: "Playing", path: "/g/seaside-stand?play", mainActionShows: "nowhere", setUp: openBuySheet("extra_lemons"), stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buying, as a guest", area: "Playing", path: "/g/tiny-farm?play", mainActionShows: "nowhere", setUp: openBuySheet("revive"), stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buying, declined", area: "Playing", path: "/g/tiny-farm?play", account: "Card_Keeper", mainActionShows: "nowhere", setUp: openBuySheet("revive", "declined"), stateBeforeSetUp: "Game page, no rooms" },
  { name: "Buy window", area: "Playing", path: "/buy/tiny-farm/revive", mainActionShows: "nowhere" },
  { name: "Games", area: "Playing", path: "/games", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, signed in", area: "Playing", path: "/games", account: "Moss_Runner", mainActionShows: "nowhere", isCoverAboveFold: true },
  ...STRESS_ACCOUNTS.map(({ account, nameEnding }) => ({ name: `Games, ${nameEnding}` as const, area: "Playing" as const, path: "/games", account, shownStateName: "Games, signed in", mainActionShows: "nowhere" as const, isCoverAboveFold: true })),
  { name: "Games, one genre", area: "Playing", path: "/games?genre=strategy", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, multiplayer", area: "Playing", path: "/games?players=multiplayer", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, a search", area: "Playing", path: "/games?search_text=farm", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, nothing found", area: "Playing", path: "/games?search_text=no%20game%20is%20called%20this", mainActionShows: "nowhere" },
  { name: "Games, an empty genre", area: "Playing", path: "/games?genre=visual_novel", mainActionShows: "nowhere" },
  { name: "Games, a price range", area: "Playing", path: "/games?price=free", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, an empty price range", area: "Playing", path: "/games?price=30_and_up", mainActionShows: "nowhere" },
  { name: "Report a game", area: "Playing", path: "/g/cave-crew/report", mainActionShows: "nowhere" },
  { name: "A message", area: "Playing", path: "/oauth/authorize?client_id=nope", mainActionShows: "everywhere" },
  { name: "Sign in", area: "Signing in", path: "/signin", ...CITY },
  { name: "Sign in, wrong password", area: "Signing in", path: "/signin", ...CITY, stepsToTake: [{ formAction: "/signin", fieldValues: WRONG_SIGN_IN }] },
  { name: "Forgot your password", area: "Signing in", path: "/signin/email", ...CITY },
  { name: "Forgot your password, no email", area: "Signing in", path: "/signin/email", ...CITY, stepsToTake: [{ formAction: "/signin/email", fieldValues: { email: "", ...BOT_CHECK_PASSED } }] },
  { name: "Check your email", area: "Signing in", path: "/signin/email", ...CITY, stepsToTake: [{ formAction: "/signin/email", fieldValues: NEW_EMAIL }] },
  {
    name: "Check email, wrong code",
    area: "Signing in",
    path: "/signin/email",
    ...CITY,
    stepsToTake: [{ formAction: "/signin/email", fieldValues: NEW_EMAIL }, { formAction: "/signin/code", fieldValues: { code: "000000" } }],
  },
  { name: "Make an account", area: "Signing in", path: "/join", ...CITY },
  { name: "New account, no birthday", area: "Signing in", path: "/join", ...CITY, stepsToTake: [{ formAction: "/join/age", fieldValues: { birthday: "" } }] },
  { name: "How will you sign in", area: "Signing in", path: "/join", ...CITY, stepsToTake: [{ formAction: "/join/age", fieldValues: ADULT_BIRTHDAY }] },
  { name: "Make an account, too young", area: "Signing in", path: "/join", ...CITY, stepsToTake: [{ formAction: "/join/age", fieldValues: TOO_YOUNG_BIRTHDAY }], isOffScreens: true },
  // A new player back from Google with no account yet (the preview's stand-in sign-in answers for it), after the age step.
  { name: "Pick a username", area: "Signing in", path: "/join", ...CITY, stepsToTake: [{ formAction: "/join/age", fieldValues: ADULT_BIRTHDAY }, { path: "/signin/with/google" }] },
  { name: "How do you play", area: "Signing in", path: "/join/play", account: "Moss_Runner", ...CITY },
  { name: "You're in", area: "Signing in", path: "/account/kept", account: "Moss_Runner", ...CITY },
  { name: "Developer settings", area: "Developers", path: "/dashboard/settings", account: "Preview_Studio", mainActionShows: "nowhere" },
  ...STRESS_ACCOUNTS.map(({ account, nameEnding }) => ({ name: `Developer settings, ${nameEnding}` as const, area: "Developers" as const, path: "/dashboard/settings", account, shownStateName: "Developer settings", mainActionShows: "nowhere" as const })),
  { name: "Developer settings, a spending request", area: "Developers", path: "/dashboard/settings?spending_request=spending_request_preview0waiting", account: "Preview_Studio", mainActionShows: "nowhere", stateBeforeSetUp: "Developer settings", setUp: `(async () => { await new Promise((done) => setTimeout(done, 600)); return Boolean(document.getElementById("spending-request")?.open); })()` },
  { name: "Background guide", area: "Developers", path: "/developers/backgrounds", mainActionShows: "nowhere" },
  { name: "Content rules", area: "Developers", path: "/legal/content-rules", mainActionShows: "nowhere" },
  { name: "Example page", area: "Gallery", path: "/design/example", mainActionShows: "everywhere" },
  { name: "Connect an app", area: "Signing in", path: "/mcp-start", isOnSignInSite: true, account: "Preview_Studio", mainActionShows: "everywhere" },
  { name: "Sign in with Zaisma", area: "Signing in", path: "/start", isOnSignInSite: true, account: "Moss_Runner", mainActionShows: "everywhere" },
  ...GALLERY_PLACES().map((place) => ({ name: galleryPageName(place), path: galleryPagePath(place.group, place.subgroup), ...GALLERY })),
  { name: "Gallery: the sidebar over the page", path: "/design/inputs/fields", ...GALLERY, stateBeforeSetUp: "Gallery: inputs fields", setUp: `(async () => { const sheet = document.getElementById("gallery-places-sheet"); sheet.showModal(); await new Promise((done) => setTimeout(done, 400)); return sheet.open; })()` },
  { name: "Screens", path: "/design/screens?page=%2Fdesign%2Fexample", ...GALLERY },
] as const satisfies readonly CheckedPage[];
export const CHECKED_PAGES: readonly CheckedPage[] = CHECKED_PAGE_LIST;

/** A state's name on the list: what a page built in Zaisma's look says it renders (layout's checkedPage). */
export type CheckedPageName = (typeof CHECKED_PAGE_LIST)[number]["name"];
