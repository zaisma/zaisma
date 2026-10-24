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
const GALLERY = { area: "Gallery", mainActionShows: "nowhere", isGallery: true } as const;
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
  { name: "Games", area: "Playing", path: "/games", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, signed in", area: "Playing", path: "/games", account: "Moss_Runner", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, one genre", area: "Playing", path: "/games?filter=strategy", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, multiplayer", area: "Playing", path: "/games?filter=multiplayer", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, a search", area: "Playing", path: "/games?search_text=farm", mainActionShows: "nowhere", isCoverAboveFold: true },
  { name: "Games, nothing found", area: "Playing", path: "/games?search_text=no%20game%20is%20called%20this", mainActionShows: "nowhere" },
  { name: "Games, an empty genre", area: "Playing", path: "/games?filter=visual_novel", mainActionShows: "nowhere" },
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
  { name: "Background guide", area: "Developers", path: "/developers/backgrounds", mainActionShows: "nowhere" },
  { name: "Example page", area: "Gallery", path: "/design/example", mainActionShows: "everywhere" },
  { name: "Connect an app", area: "Signing in", path: "/mcp-start", isOnSignInSite: true, account: "Preview_Studio", mainActionShows: "everywhere" },
  { name: "Sign in with Zaisma", area: "Signing in", path: "/start", isOnSignInSite: true, account: "Moss_Runner", mainActionShows: "everywhere" },
  { name: "Gallery: foundations", path: "/design", ...GALLERY },
  { name: "Gallery: layout", path: "/design/layout", ...GALLERY },
  { name: "Gallery: actions", path: "/design/actions", ...GALLERY },
  { name: "Gallery: inputs", path: "/design/inputs", ...GALLERY },
  { name: "Gallery: navigation", path: "/design/navigation", ...GALLERY },
  { name: "Gallery: panes", path: "/design/panes", ...GALLERY },
  { name: "Gallery: data", path: "/design/data", ...GALLERY },
  { name: "Screens", path: "/design/screens?page=%2Fdesign%2Fexample", ...GALLERY },
] as const satisfies readonly CheckedPage[];
export const CHECKED_PAGES: readonly CheckedPage[] = CHECKED_PAGE_LIST;

/** A state's name on the list: what a page built in Zaisma's look says it renders (layout's checkedPage). */
export type CheckedPageName = (typeof CHECKED_PAGE_LIST)[number]["name"];
