import { CHECKED_PAGES, type CheckedPageName } from "../../../apps/site/src/components/checked-pages.ts";

/*
 * The Screens bench's places and their states: every state a page can show gets a button, both what arrives by itself and what a press
 * reaches. The layout check holds this to the pages (a sheet, menu or card on a page with no button fails it), and test/node/screens-bench.test.ts
 * holds its limits. A local tool: only the preview's entry loads this.
 */

export const MAXIMUM_BUTTONS_IN_A_PLACE = 50;
export const MAXIMUM_BUTTON_LABEL_LENGTH = 20;
/** Who can see a state or go to a place. */
export type Viewer = "guest" | "signed_in" | "both";
export type StateKind = "arrives" | "opened";

interface BenchStateBase {
  stateValue: string;
  label: string;
  stateKind: StateKind;
  seenBy: Viewer;
  /** Who it needs: pressing it switches to them. */
  profile?: string;
  /** Words a game would have filled in, by element id. */
  words?: Record<string, string>;
}
/** How a state comes in: an element shown by its id (idPattern, when each of a kind has its own id: the first one on the page); a real control pressed; or an entry on the checks' list, with its address, account, steps and setUp. */
export type BenchState = BenchStateBase & ({ opens: string; idPattern?: string; path?: string } | { presses: string } | { checkedPage: CheckedPageName } | { path: string });

export interface BenchPlace {
  placeValue: string;
  name: string;
  path: string;
  /** Pages it holds besides its own path: where the rail follows you to it. */
  pathPattern: string;
  seenBy: Viewer;
  /** Who it opens as when the bench's person can't see it. */
  profile?: string;
  states: BenchState[];
}

const hasMenu = (id: string) => `[aria-controls="${id}"]`;

const ACCOUNT_MENU: BenchState = { stateValue: "account-menu", label: "Account menu", stateKind: "opened", seenBy: "signed_in", presses: hasMenu("top-menu") };

export const BENCH_PLACES: BenchPlace[] = [
  { placeValue: "home", name: "Home", path: "/", pathPattern: "^/$", seenBy: "both", states: [ACCOUNT_MENU] },
  {
    placeValue: "games", name: "Games", path: "/games", pathPattern: "^/games", seenBy: "both",
    states: [
      { ...ACCOUNT_MENU, stateValue: "games-account-menu" },
      { stateValue: "filter", label: "Filter menu", stateKind: "opened", seenBy: "both", presses: hasMenu("browse-filter") },
      { stateValue: "one-genre", label: "One genre", stateKind: "opened", seenBy: "both", checkedPage: "Games, one genre" },
      { stateValue: "multiplayer", label: "Multiplayer", stateKind: "opened", seenBy: "both", checkedPage: "Games, multiplayer" },
      { stateValue: "a-search", label: "A search", stateKind: "opened", seenBy: "both", checkedPage: "Games, a search" },
      { stateValue: "nothing-found", label: "Nothing found", stateKind: "opened", seenBy: "both", checkedPage: "Games, nothing found" },
      { stateValue: "empty-genre", label: "An empty genre", stateKind: "opened", seenBy: "both", checkedPage: "Games, an empty genre" },
      { stateValue: "price-range", label: "A price range", stateKind: "opened", seenBy: "both", checkedPage: "Games, a price range" },
      { stateValue: "empty-price", label: "An empty price", stateKind: "opened", seenBy: "both", checkedPage: "Games, an empty price range" },
    ],
  },
  {
    placeValue: "game-page", name: "Game page", path: "/g/cave-crew", pathPattern: "^/(g/[^/?]+($|\\?(?!play))|t/)", seenBy: "both",
    states: [
      { stateValue: "no-rooms", label: "No rooms", stateKind: "opened", seenBy: "both", checkedPage: "Game page, no rooms" },
      { stateValue: "for-sale", label: "For sale", stateKind: "opened", seenBy: "both", checkedPage: "Game page, for sale" },
      { stateValue: "tester-link", label: "Tester link", stateKind: "opened", seenBy: "both", checkedPage: "Tester link" },
      { stateValue: "screenshots", label: "Screenshots", stateKind: "opened", seenBy: "both", opens: "screenshots-viewer" },
      { stateValue: "rooms-sort", label: "Sort rooms", stateKind: "opened", seenBy: "both", presses: "#rooms-order" },
      { stateValue: "make-a-room", label: "Make a room", stateKind: "opened", seenBy: "both", opens: "room-dialog" },
      { stateValue: "share", label: "Share", stateKind: "opened", seenBy: "both", opens: "share-dialog" },
      { stateValue: "share-qr", label: "Share, QR code", stateKind: "opened", seenBy: "both", opens: "share-qr-box" },
      { stateValue: "game-menu", label: "Game menu", stateKind: "opened", seenBy: "both", opens: "menu-dialog" },
      { stateValue: "report-sheet", label: "Report sheet", stateKind: "opened", seenBy: "both", opens: "report", path: "/g/shard-dodge" },
      { stateValue: "report-page", label: "Report a game", stateKind: "opened", seenBy: "both", checkedPage: "Report a game" },
    ],
  },
  {
    placeValue: "playing", name: "Playing", path: "/g/cave-crew?play", pathPattern: "^/g/(?!tiny-farm|seaside-stand)[^/?]+\\?play", seenBy: "both",
    states: [
      { stateValue: "keep-progress", label: "Keep your progress", stateKind: "arrives", seenBy: "guest", opens: "keep" },
      { stateValue: "asked-to-sign-in", label: "Asked to sign in", stateKind: "arrives", seenBy: "guest", opens: "sign-in-ask" },
      { stateValue: "signed-out", label: "Signed out", stateKind: "arrives", seenBy: "signed_in", opens: "signed-out" },
      { stateValue: "friend-request", label: "Friend request", stateKind: "arrives", seenBy: "signed_in", opens: "friend-request-card", words: { "friend-request-card-name": "Mia_Plays" } },
      { stateValue: "friend-accepted", label: "Friend accepted", stateKind: "arrives", seenBy: "signed_in", opens: "friend-accepted-card", words: { "friend-accepted-name": "Mia_Plays" } },
      { stateValue: "still-there", label: "Still there?", stateKind: "arrives", seenBy: "both", opens: "still-there" },
      { stateValue: "connection-lost", label: "Connection lost", stateKind: "arrives", seenBy: "both", opens: "conn-dialog" },
      { stateValue: "players", label: "Players", stateKind: "opened", seenBy: "both", checkedPage: "Playing a game, the players sheet" },
      { stateValue: "playing-share", label: "Invite", stateKind: "opened", seenBy: "both", opens: "share-dialog" },
      { stateValue: "playing-menu", label: "Game menu", stateKind: "opened", seenBy: "both", opens: "menu-dialog" },
      { stateValue: "block", label: "Confirm a block", stateKind: "opened", seenBy: "signed_in", opens: "block", words: { "block-told": "Leo_Marsh isn't told." } },
      { stateValue: "send-request", label: "Send a request", stateKind: "opened", seenBy: "signed_in", opens: "friend-request", words: { "friend-request-title": "Send Mia_Plays a friend request?", "friend-request-told": "Mia_Plays" } },
      { stateValue: "leaving-zaisma", label: "Leaving Zaisma", stateKind: "opened", seenBy: "both", opens: "link-ask", words: { "link-url": "https://example.test/store" } },
      { stateValue: "link-closed", label: "Link closed", stateKind: "opened", seenBy: "both", opens: "link-closed" },
    ],
  },
  {
    placeValue: "buying", name: "Buying", path: "/g/tiny-farm?play", pathPattern: "^/(g/(tiny-farm|seaside-stand)\\?play|buy/)", seenBy: "both",
    states: [
      { stateValue: "buy-guest", label: "As a guest", stateKind: "opened", seenBy: "guest", checkedPage: "Buying, as a guest" },
      { stateValue: "buy-one-press", label: "One press", stateKind: "opened", seenBy: "signed_in", profile: "Card_Keeper", checkedPage: "Buying, one press" },
      { stateValue: "buy-pin", label: "Confirm with a PIN", stateKind: "opened", seenBy: "signed_in", profile: "Pin_Keeper", checkedPage: "Buying, confirm with a PIN" },
      { stateValue: "buy-first-card", label: "A first card", stateKind: "opened", seenBy: "signed_in", profile: "Moss_Runner", checkedPage: "Buying, a first card" },
      { stateValue: "buy-owned", label: "Already owned", stateKind: "opened", seenBy: "signed_in", profile: "Card_Keeper", checkedPage: "Buying, already owned" },
      { stateValue: "buy-cant", label: "Can't be bought", stateKind: "opened", seenBy: "guest", checkedPage: "Buying, can't be bought" },
      { stateValue: "buy-declined", label: "Declined", stateKind: "arrives", seenBy: "signed_in", profile: "Card_Keeper", checkedPage: "Buying, declined" },
      { stateValue: "buy-signed-out", label: "Signed out", stateKind: "arrives", seenBy: "both", opens: "buy-signed-out" },
      { stateValue: "buy-unreachable", label: "Can't reach Stripe", stateKind: "arrives", seenBy: "both", opens: "buy-unreachable" },
      { stateValue: "buy-window", label: "Buy window", stateKind: "opened", seenBy: "both", checkedPage: "Buy window" },
    ],
  },
  {
    placeValue: "sign-in", name: "Sign in", path: "/signin", pathPattern: "^/signin", seenBy: "guest",
    states: [
      { stateValue: "wrong-password", label: "Wrong password", stateKind: "opened", seenBy: "guest", checkedPage: "Sign in, wrong password" },
      { stateValue: "forgot-password", label: "Forgot password", stateKind: "opened", seenBy: "guest", checkedPage: "Forgot your password" },
      { stateValue: "forgot-no-email", label: "Forgot, no email", stateKind: "opened", seenBy: "guest", checkedPage: "Forgot your password, no email" },
      { stateValue: "check-email", label: "Check your email", stateKind: "opened", seenBy: "guest", checkedPage: "Check your email" },
      { stateValue: "wrong-code", label: "Wrong code", stateKind: "opened", seenBy: "guest", checkedPage: "Check email, wrong code" },
      { stateValue: "account-closed", label: "Account closed", stateKind: "opened", seenBy: "guest", checkedPage: "Account closed" },
    ],
  },
  {
    placeValue: "make-an-account", name: "Make an account", path: "/join", pathPattern: "^/(join|account/kept)", seenBy: "both",
    states: [
      { stateValue: "no-birthday", label: "No birthday", stateKind: "opened", seenBy: "guest", checkedPage: "New account, no birthday" },
      { stateValue: "birthday-wheels", label: "Birthday wheels", stateKind: "opened", seenBy: "guest", opens: "join-birthday-pick" },
      { stateValue: "how-sign-in", label: "How you sign in", stateKind: "opened", seenBy: "guest", checkedPage: "How will you sign in" },
      { stateValue: "too-young", label: "Too young", stateKind: "opened", seenBy: "guest", checkedPage: "Make an account, too young" },
      { stateValue: "pick-username", label: "Pick a username", stateKind: "opened", seenBy: "guest", checkedPage: "Pick a username" },
      { stateValue: "how-you-play", label: "How do you play", stateKind: "opened", seenBy: "signed_in", profile: "Moss_Runner", checkedPage: "How do you play" },
      { stateValue: "youre-in", label: "You're in", stateKind: "opened", seenBy: "signed_in", profile: "Moss_Runner", checkedPage: "You're in" },
    ],
  },
  {
    placeValue: "dashboard", name: "Dashboard", path: "/dashboard", pathPattern: "^/dashboard(?!/settings)", seenBy: "signed_in", profile: "Preview_Studio",
    states: [
      { ...ACCOUNT_MENU, stateValue: "dashboard-account-menu" },
      { stateValue: "a-game", label: "A game", stateKind: "opened", seenBy: "signed_in", path: "/dashboard/tiny-farm" },
    ],
  },
  {
    placeValue: "settings", name: "Settings", path: "/dashboard/settings", pathPattern: "^/dashboard/settings", seenBy: "signed_in", profile: "Preview_Studio",
    states: [
      { ...ACCOUNT_MENU, stateValue: "settings-account-menu" },
      { stateValue: "spending-request", label: "Spending request", stateKind: "arrives", seenBy: "signed_in", profile: "Preview_Studio", checkedPage: "Developer settings, a spending request" },
      { stateValue: "settings-places", label: "Settings' places", stateKind: "opened", seenBy: "signed_in", opens: "settings-places-sheet" },
      { stateValue: "start-plan", label: "Start a plan", stateKind: "opened", seenBy: "signed_in", opens: "plan-start" },
      { stateValue: "storage-budget", label: "Storage budget", stateKind: "opened", seenBy: "signed_in", opens: "storage-budget" },
      { stateValue: "add-credit", label: "Add credit", stateKind: "opened", seenBy: "signed_in", opens: "add-credit" },
      { stateValue: "game-budget", label: "A game's budget", stateKind: "opened", seenBy: "signed_in", opens: "budget-arena", idPattern: "^budget-[a-z0-9-]+$" },
      { stateValue: "refund-top-up", label: "Refund a top-up", stateKind: "opened", seenBy: "signed_in", opens: "refund-top_up_preview00000000001", idPattern: "^refund-" },
      { stateValue: "cancel-pro", label: "Cancel Pro", stateKind: "opened", seenBy: "signed_in", opens: "pro-cancel" },
      { stateValue: "start-pro", label: "Start Pro", stateKind: "opened", seenBy: "signed_in", profile: "Empty_Handed", opens: "pro-start" },
      { stateValue: "connect-payments", label: "Connect payments", stateKind: "opened", seenBy: "signed_in", profile: "Empty_Handed", opens: "payments-connect" },
      { stateValue: "tax", label: "Tax", stateKind: "opened", seenBy: "signed_in", opens: "payments-tax" },
      { stateValue: "disconnect-payments", label: "Disconnect payments", stateKind: "opened", seenBy: "signed_in", opens: "payments-disconnect" },
      { stateValue: "add-webhook", label: "Add a webhook", stateKind: "opened", seenBy: "signed_in", opens: "webhook-add" },
      { stateValue: "add-server-webhook", label: "Add a server webhook", stateKind: "opened", seenBy: "signed_in", opens: "webhook-server-add" },
      { stateValue: "webhook-edit", label: "Edit a webhook", stateKind: "opened", seenBy: "signed_in", opens: "webhook-webhook_previewdiscord001-edit", idPattern: "^webhook-webhook_[a-z0-9]+-edit$" },
      { stateValue: "webhook-test", label: "Test a webhook", stateKind: "opened", seenBy: "signed_in", opens: "webhook-webhook_previewdiscord001-test", idPattern: "^webhook-webhook_[a-z0-9]+-test$" },
      { stateValue: "webhook-secret", label: "A webhook's secret", stateKind: "opened", seenBy: "signed_in", opens: "webhook-webhook_previewdiscord001-secret", idPattern: "^webhook-webhook_[a-z0-9]+-secret$" },
      { stateValue: "webhook-delete", label: "Delete a webhook", stateKind: "opened", seenBy: "signed_in", opens: "webhook-webhook_previewdiscord001-delete", idPattern: "^webhook-webhook_[a-z0-9]+-delete$" },
      { stateValue: "add-app", label: "Add a sign-in app", stateKind: "opened", seenBy: "signed_in", opens: "app-add" },
      { stateValue: "add-key", label: "Add an API key", stateKind: "opened", seenBy: "signed_in", opens: "key-add" },
      { stateValue: "settings-confirm", label: "Confirm it's you", stateKind: "opened", seenBy: "signed_in", opens: "settings-confirm" },
    ],
  },
];

/** What's on a page and has no button, each with why: a list a field opens, a menu that's part of another. */
export const NOT_A_STATE: readonly { idPattern: string; reason: string }[] = [
  { idPattern: "-list$", reason: "a field's own list: it opens as you type or press that field, and the same press happens on every screen" },
  { idPattern: "^top-menu$", reason: "the account menu's popover: its button presses it open" },
  { idPattern: "^browse-filter$", reason: "the Filter menu's popover: its button presses it open" },
  { idPattern: "-more$", reason: "a row's More menu: the row's own button presses it open, and each of its choices has a button" },
  { idPattern: "^(app|key)-", reason: "a sheet per app or API key, the same sheets as Add a sign-in app and Add an API key" },
  { idPattern: "^(buy-sheet|buy-confirm-you)$", reason: "Buying's buttons open it, each with what's in it" },
  { idPattern: "^players$", reason: "Playing's Players button opens it, with its list filled" },
  { idPattern: "^spending-request$", reason: "Spending request's button opens it from its address" },
  { idPattern: "^budget-[a-z0-9-]+-off$", reason: "a game's budget turned off, a step of A game's budget" },
];

/** Checked states with no button, each with why. */
export const CHECKED_PAGES_NOT_ON_THE_BENCH: readonly { name: CheckedPageName; reason: string }[] = [
  ...(["Background guide", "Content rules", "Terms of service", "Privacy policy", "Example page", "A message"] as const).map((name) => ({ name, reason: "a page of its own with no states: the find box's address reaches it" })),
];

/** Who a button or a choice is for: short, since the menus hold them on one line. Each of the preview's test accounts has one. */
export const PROFILE_WORDS: Record<string, string> = {
  Preview_Studio: "a developer with games", Moss_Runner: "an everyday player", Quiet_Comet: "14, private to friends", Bright_Reed: "16, open and social", Chat_Owl: "an adult who chats",
  Tall_Pine: "custom social settings", Kit_Spark: "in a full room", Key_Maker: "no passkey yet", Waiting_Key: "a passkey waiting", New_Passkey: "its only passkey waits", Guessed_At: "locked out",
  Saved_Farmer: "no passkey or email", Quiet_Builder: "no email, has a key", Gone_Dev: "owns two games", Loud_Lynx: "reported in Arena", Stopped_Fox: "social side off", Card_Keeper: "has a saved card",
  Pin_Keeper: "buys with a PIN", Banned_Dev: "developer side banned", Closed_Player: "a closed account", New_Studio: "3 days old", New_Teen: "16, an hour old", Mia_Plays: "has a row in a game",
  Longest_Names_Here: "the longest names", Empty_Handed: "nothing yet", Many_Things: "a great many things",
};

const entryOf = (name: CheckedPageName) => CHECKED_PAGES.find((page) => page.name === name)!;

/** A state as the screens take it: where it is, who sees it, and what's done there. */
export interface ReadyState {
  placeValue: string;
  stateValue: string;
  label: string;
  stateKind: StateKind;
  seenBy: Viewer;
  profile?: string;
  path: string;
  words?: Record<string, string>;
  opens?: string;
  presses?: string;
  setUpName?: string;
  stepsToTake?: unknown;
  /** It takes a page of its own, so leaving it is going back. */
  isOwnPage: boolean;
}

export function readyStates(): ReadyState[] {
  return BENCH_PLACES.flatMap((place) => place.states.map((state) => {
    const shared = { placeValue: place.placeValue, stateValue: state.stateValue, label: state.label, stateKind: state.stateKind, seenBy: state.seenBy, profile: state.profile ?? place.profile, words: state.words };
    if ("checkedPage" in state) {
      const entry = entryOf(state.checkedPage) as (typeof CHECKED_PAGES)[number] & { setUp?: string; stepsToTake?: unknown };
      return { ...shared, profile: state.profile ?? entry.account ?? place.profile, path: entry.path, stepsToTake: entry.stepsToTake, setUpName: entry.setUp ? entry.name : undefined, isOwnPage: !entry.setUp };
    }
    if ("opens" in state) return { ...shared, path: state.path ?? place.path, opens: state.opens, isOwnPage: false };
    if ("path" in state) return { ...shared, path: state.path, isOwnPage: true };
    return { ...shared, path: place.path, presses: state.presses, isOwnPage: false };
  }));
}

/** The checks' setUp scripts as functions in a file of their own, so the site's script policy needn't allow eval. */
export const setUpsScript = (): string =>
  `window.zaismaBenchSetUps = {\n${CHECKED_PAGES.flatMap((page) => ("setUp" in page && page.setUp ? [`${JSON.stringify(page.name)}: () => ${page.setUp},`] : [])).join("\n")}\n};`;

/** Every id a button opens, and the patterns of those with an id each, for the layout check. */
export const coveredIdPatterns = (): RegExp[] => [
  ...BENCH_PLACES.flatMap((place) => place.states.flatMap((state) => ("opens" in state ? [new RegExp(state.idPattern ?? `^${state.opens}$`)] : []))),
  ...NOT_A_STATE.map(({ idPattern }) => new RegExp(idPattern)),
];

/** What the layout check reads on a page, in the page: every layer's id, those in its templates too. */
export const STATE_IDS_ON_THE_PAGE = `(() => {
  const SELECTOR = "dialog[id], [popover][id], .notice[id], .playing-card[id]";
  const found = [...document.querySelectorAll(SELECTOR)];
  for (const template of document.querySelectorAll("template")) found.push(...template.content.querySelectorAll(SELECTOR));
  return found.map((element) => element.id);
})()`;
/** The ids among these with no button on the bench and no reason for it. */
export const statesWithNoButton = (ids: string[]): string[] => { const patterns = coveredIdPatterns(); return [...new Set(ids)].filter((id) => !patterns.some((pattern) => pattern.test(id))); };
