import { CHECKED_PAGES } from "../../../apps/site/src/components/checked-pages.ts";
import { STEEL_PAGES, type PageName } from "../../../apps/site/src/steel-pages.ts";

/*
 * The Screens bench's places and their states: every screen is one press away, or says why not. Every page names its screen (layout's
 * checkedPage, html.ts), test/node/screens-bench.test.ts fails a name with no button of its own and no reason, the layout check fails a sheet,
 * menu or card on a page with no button, and each night scripts/bench-press-check.mjs presses every button and sees it arrive. None of them
 * catch a screen that only the data makes (an alert only some games have) or a branch inside one page that names one screen (a form's error).
 * A local tool: only the preview's entry loads this.
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
  /** Who it needs, a test account or "guest". Pressing it switches to them; with none, a state seenBy one kind of person switches only someone of the other kind (readyStates). */
  profile?: string;
  /** Words a game would have filled in, by element id. */
  words?: Record<string, string>;
}
/** How a state comes in: an element shown by its id (idPattern, when each of a kind has its own id: the first one on the page); a real control pressed; or a named screen, with its address, account, steps and setUp. */
export type BenchState = BenchStateBase & ({ opens: string; idPattern?: string; path?: string } | { presses: string } | { checkedPage: PageName } | { path: string });

export interface BenchPlace {
  placeValue: string;
  name: string;
  path: string;
  /** Pages it holds besides its own path: where the rail follows you to it. */
  pathPattern: string;
  seenBy: Viewer;
  /** Who it opens as when the bench's person can't see it. Its states stay with whoever you switched to, unless one needs someone. */
  profile?: string;
  states: BenchState[];
}

const hasMenu = (id: string) => `[aria-controls="${id}"]`;

const ACCOUNT_MENU: BenchState = { stateValue: "account-menu", label: "Account menu", stateKind: "opened", seenBy: "signed_in", presses: hasMenu("top-menu") };

export const BENCH_PLACES: BenchPlace[] = [
  {
    placeValue: "home", name: "Home", path: "/", pathPattern: "^/$", seenBy: "both",
    states: [
      ACCOUNT_MENU,
      { stateValue: "home-guest", label: "As a guest", stateKind: "opened", seenBy: "guest", checkedPage: "Home" },
      { stateValue: "home-signed-in", label: "Signed in", stateKind: "opened", seenBy: "signed_in", checkedPage: "Home, signed in" },
      { stateValue: "home-long-names", label: "Long names", stateKind: "opened", seenBy: "signed_in", checkedPage: "Home, long names" },
      { stateValue: "home-empty", label: "Empty", stateKind: "opened", seenBy: "signed_in", checkedPage: "Home, empty" },
      { stateValue: "home-full", label: "Full", stateKind: "opened", seenBy: "signed_in", checkedPage: "Home, full" },
    ],
  },
  {
    placeValue: "games", name: "Games", path: "/games", pathPattern: "^/games", seenBy: "both",
    states: [
      { ...ACCOUNT_MENU, stateValue: "games-account-menu" },
      { stateValue: "games-guest", label: "As a guest", stateKind: "opened", seenBy: "guest", checkedPage: "Games" },
      { stateValue: "games-signed-in", label: "Signed in", stateKind: "opened", seenBy: "signed_in", checkedPage: "Games, signed in" },
      { stateValue: "games-long-names", label: "Long names", stateKind: "opened", seenBy: "signed_in", checkedPage: "Games, long names" },
      { stateValue: "games-empty", label: "Empty", stateKind: "opened", seenBy: "signed_in", checkedPage: "Games, empty" },
      { stateValue: "games-full", label: "Full", stateKind: "opened", seenBy: "signed_in", checkedPage: "Games, full" },
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
    placeValue: "game-page", name: "Game page", path: "/g/cave-crew", pathPattern: "^/(g/[^/?]+(/report)?($|\\?(?!play))|t/)", seenBy: "both",
    states: [
      { stateValue: "rooms", label: "Rooms", stateKind: "opened", seenBy: "both", checkedPage: "Game page" },
      { stateValue: "game-long-names", label: "Long names", stateKind: "opened", seenBy: "signed_in", checkedPage: "Game page, long names" },
      { stateValue: "no-rooms", label: "No rooms", stateKind: "opened", seenBy: "both", checkedPage: "Game page, no rooms" },
      { stateValue: "for-sale", label: "For sale", stateKind: "opened", seenBy: "both", checkedPage: "Game page, for sale" },
      { stateValue: "tester-link", label: "Tester link", stateKind: "opened", seenBy: "both", checkedPage: "Tester link" },
      { stateValue: "screenshots", label: "Screenshots", stateKind: "opened", seenBy: "both", opens: "screenshots-viewer" },
      { stateValue: "rooms-sort", label: "Sort rooms", stateKind: "opened", seenBy: "both", presses: "#rooms-order" },
      { stateValue: "share", label: "Share", stateKind: "opened", seenBy: "both", opens: "share-dialog" },
      { stateValue: "share-qr", label: "Share, QR code", stateKind: "opened", seenBy: "both", opens: "share-qr-box" },
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
      { stateValue: "weak-connection", label: "Weak connection", stateKind: "arrives", seenBy: "both", path: "/g/cave-crew?play&preview_bar=weak" },
      { stateValue: "reconnecting", label: "Reconnecting", stateKind: "arrives", seenBy: "both", path: "/g/cave-crew?play&preview_bar=retrying" },
      { stateValue: "connection-lost", label: "Connection lost", stateKind: "arrives", seenBy: "both", path: "/g/cave-crew?play&preview_bar=lost" },
      { stateValue: "rented-share-used", label: "Rented share used", stateKind: "arrives", seenBy: "both", opens: "rented-share" },
      { stateValue: "update-ready", label: "Update ready", stateKind: "arrives", seenBy: "both", path: "/g/cave-crew?play&preview_bar=update" },
      { stateValue: "update-coming", label: "Update coming", stateKind: "arrives", seenBy: "both", path: "/g/cave-crew?play&preview_bar=coming" },
      { stateValue: "updating", label: "Updating", stateKind: "arrives", seenBy: "both", path: "/g/cave-crew?play&preview_bar=updating" },
      { stateValue: "players", label: "Players", stateKind: "opened", seenBy: "both", checkedPage: "Playing a game, the players sheet" },
      { stateValue: "playing-share", label: "Invite", stateKind: "opened", seenBy: "both", opens: "share-dialog" },
      { stateValue: "zaisma-overlay", label: "Zaisma overlay", stateKind: "opened", seenBy: "both", presses: "#zaisma-open" },
      { stateValue: "leaving-game", label: "Leave the game", stateKind: "opened", seenBy: "both", opens: "leave-sheet" },
      { stateValue: "full-screen", label: "Full screen", stateKind: "opened", seenBy: "both", opens: "full-screen-sheet" },
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
      { stateValue: "both-sign-in-cards", label: "Both sign-in cards", stateKind: "arrives", seenBy: "both", checkedPage: "Playing a game, asked to sign in" },
    ],
  },
  {
    placeValue: "sign-in", name: "Sign in", path: "/signin", pathPattern: "^/signin", seenBy: "guest",
    states: [
      { stateValue: "sign-in-page", label: "Sign in", stateKind: "opened", seenBy: "guest", checkedPage: "Sign in" },
      { stateValue: "wrong-password", label: "Wrong password", stateKind: "opened", seenBy: "guest", checkedPage: "Sign in, wrong password" },
      { stateValue: "forgot-password", label: "Forgot password", stateKind: "opened", seenBy: "guest", checkedPage: "Forgot your password" },
      { stateValue: "forgot-no-email", label: "Forgot, no email", stateKind: "opened", seenBy: "guest", checkedPage: "Forgot your password, no email" },
      { stateValue: "check-email", label: "Check your email", stateKind: "opened", seenBy: "guest", checkedPage: "Check your email" },
      { stateValue: "wrong-code", label: "Wrong code", stateKind: "opened", seenBy: "guest", checkedPage: "Check email, wrong code" },
      { stateValue: "account-closed", label: "Account closed", stateKind: "opened", seenBy: "guest", checkedPage: "Account closed" },
    ],
  },
  {
    placeValue: "make-an-account", name: "Make an account", path: "/join", pathPattern: "^/(join|account/kept)", seenBy: "guest",
    states: [
      { stateValue: "birthday", label: "Your birthday", stateKind: "opened", seenBy: "guest", profile: "guest", checkedPage: "Make an account" },
      { stateValue: "no-birthday", label: "No birthday", stateKind: "opened", seenBy: "guest", profile: "guest", checkedPage: "New account, no birthday" },
      { stateValue: "birthday-wheels", label: "Birthday wheels", stateKind: "opened", seenBy: "guest", profile: "guest", presses: "#join-birthday .wheel-button" },
      { stateValue: "how-sign-in", label: "How you sign in", stateKind: "opened", seenBy: "guest", profile: "guest", checkedPage: "How will you sign in" },
      { stateValue: "pick-username", label: "Pick a username", stateKind: "opened", seenBy: "guest", profile: "guest", checkedPage: "Pick a username" },
      { stateValue: "too-young", label: "Too young", stateKind: "opened", seenBy: "guest", profile: "guest", checkedPage: "Make an account, too young" },
      { stateValue: "how-you-play", label: "How do you play", stateKind: "opened", seenBy: "signed_in", profile: "Moss_Runner", checkedPage: "How do you play" },
      { stateValue: "youre-in", label: "You're in", stateKind: "opened", seenBy: "signed_in", profile: "Moss_Runner", checkedPage: "You're in" },
    ],
  },
  {
    placeValue: "dashboard", name: "Dashboard", path: "/dashboard", pathPattern: "^/dashboard(?!/settings)", seenBy: "signed_in", profile: "Preview_Studio",
    states: [
      { ...ACCOUNT_MENU, stateValue: "dashboard-account-menu" },
      { stateValue: "your-games", label: "Your games", stateKind: "opened", seenBy: "signed_in", checkedPage: "Your games" },
      { stateValue: "your-games-banned", label: "Banned", stateKind: "opened", seenBy: "signed_in", checkedPage: "Your games, banned" },
      { stateValue: "game-not-found", label: "No such game", stateKind: "opened", seenBy: "signed_in", checkedPage: "A game not found" },
      { stateValue: "a-game", label: "Overview", stateKind: "opened", seenBy: "signed_in", checkedPage: "A game's overview" },
      { stateValue: "game-versions", label: "Versions", stateKind: "opened", seenBy: "signed_in", checkedPage: "A game's versions" },
      { stateValue: "game-details", label: "Details", stateKind: "opened", seenBy: "signed_in", checkedPage: "A game's details" },
      { stateValue: "game-players", label: "Players", stateKind: "opened", seenBy: "signed_in", checkedPage: "A game's players" },
      { stateValue: "game-database", label: "Database", stateKind: "opened", seenBy: "signed_in", checkedPage: "A game's database" },
    ],
  },
  {
    placeValue: "settings", name: "Settings", path: "/dashboard/settings", pathPattern: "^/dashboard/settings", seenBy: "signed_in", profile: "Preview_Studio",
    states: [
      { ...ACCOUNT_MENU, stateValue: "settings-account-menu" },
      { stateValue: "settings-page", label: "With games", stateKind: "opened", seenBy: "signed_in", checkedPage: "Developer settings" },
      { stateValue: "settings-long-names", label: "Long names", stateKind: "opened", seenBy: "signed_in", checkedPage: "Developer settings, long names" },
      { stateValue: "settings-empty", label: "Empty", stateKind: "opened", seenBy: "signed_in", checkedPage: "Developer settings, empty" },
      { stateValue: "settings-full", label: "Full", stateKind: "opened", seenBy: "signed_in", checkedPage: "Developer settings, full" },
      { stateValue: "spending-request", label: "Spending request", stateKind: "arrives", seenBy: "signed_in", profile: "Preview_Studio", checkedPage: "Developer settings, a spending request" },
      { stateValue: "game-deletion-request", label: "Deletion request", stateKind: "arrives", seenBy: "signed_in", profile: "Preview_Studio", checkedPage: "Developer settings, a game deletion request" },
      { stateValue: "kept-world-erase-request", label: "Erase a world", stateKind: "arrives", seenBy: "signed_in", profile: "Preview_Studio", checkedPage: "Developer settings, a request to erase a kept world" },
      { stateValue: "settings-places", label: "Settings' places", stateKind: "opened", seenBy: "signed_in", opens: "settings-places-sheet" },
      { stateValue: "start-plan", label: "Start a plan", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "plan-start" },
      { stateValue: "storage-budget", label: "Storage budget", stateKind: "opened", seenBy: "signed_in", opens: "storage-budget" },
      { stateValue: "add-credit", label: "Add credit", stateKind: "opened", seenBy: "signed_in", opens: "add-credit" },
      { stateValue: "game-budget", label: "A game's budget", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "budget-arena", idPattern: "^budget-[a-z0-9-]+$" },
      { stateValue: "refund-top-up", label: "Refund a top-up", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "refund-top_up_preview00000000001", idPattern: "^refund-" },
      { stateValue: "cancel-pro", label: "Cancel Pro", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "pro-cancel" },
      { stateValue: "start-pro", label: "Start Pro", stateKind: "opened", seenBy: "signed_in", profile: "Empty_Handed", opens: "pro-start" },
      { stateValue: "connect-payments", label: "Connect payments", stateKind: "opened", seenBy: "signed_in", profile: "Empty_Handed", opens: "payments-connect" },
      { stateValue: "tax", label: "Tax", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "payments-tax" },
      { stateValue: "disconnect-payments", label: "Disconnect payments", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "payments-disconnect" },
      { stateValue: "add-webhook", label: "Add a webhook", stateKind: "opened", seenBy: "signed_in", opens: "webhook-add" },
      { stateValue: "add-server-webhook", label: "Add a server webhook", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "webhook-server-add" },
      { stateValue: "webhook-edit", label: "Edit a webhook", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "webhook-webhook_previewdiscord001-edit", idPattern: "^webhook-webhook_[a-z0-9]+-edit$" },
      { stateValue: "webhook-test", label: "Test a webhook", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "webhook-webhook_previewdiscord001-test", idPattern: "^webhook-webhook_[a-z0-9]+-test$" },
      { stateValue: "webhook-secret", label: "A webhook's secret", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "webhook-webhook_previewdiscord001-secret", idPattern: "^webhook-webhook_[a-z0-9]+-secret$" },
      { stateValue: "webhook-delete", label: "Delete a webhook", stateKind: "opened", seenBy: "signed_in", profile: "Preview_Studio", opens: "webhook-webhook_previewdiscord001-delete", idPattern: "^webhook-webhook_[a-z0-9]+-delete$" },
      { stateValue: "add-app", label: "Add a sign-in app", stateKind: "opened", seenBy: "signed_in", opens: "app-add" },
      { stateValue: "add-key", label: "Add an API key", stateKind: "opened", seenBy: "signed_in", opens: "key-add" },
      { stateValue: "settings-confirm", label: "Confirm it's you", stateKind: "opened", seenBy: "signed_in", opens: "settings-confirm" },
    ],
  },
  {
    placeValue: "account", name: "Account", path: "/account", pathPattern: "^/(account|friends|@)", seenBy: "signed_in", profile: "Moss_Runner",
    states: [
      { stateValue: "your-account", label: "Your account", stateKind: "opened", seenBy: "signed_in", checkedPage: "Your account" },
      { stateValue: "friends", label: "Friends", stateKind: "opened", seenBy: "signed_in", checkedPage: "Friends" },
      { stateValue: "friend-invite", label: "A friend invite", stateKind: "opened", seenBy: "both", checkedPage: "A friend invite" },
      { stateValue: "profile", label: "A player's profile", stateKind: "opened", seenBy: "both", checkedPage: "A player's profile" },
      { stateValue: "report-player", label: "Report a player", stateKind: "opened", seenBy: "signed_in", checkedPage: "Report a player" },
    ],
  },
  {
    placeValue: "forum", name: "Forum", path: "/forum", pathPattern: "^/forum", seenBy: "both",
    states: [
      { stateValue: "forum-list", label: "Topics", stateKind: "opened", seenBy: "both", checkedPage: "Forum" },
      { stateValue: "forum-new-topic", label: "New topic", stateKind: "opened", seenBy: "signed_in", checkedPage: "Forum, new topic" },
      { stateValue: "forum-message", label: "Message Zaisma", stateKind: "opened", seenBy: "signed_in", checkedPage: "Forum, message Zaisma" },
      { stateValue: "forum-leaving", label: "Leaving Zaisma", stateKind: "opened", seenBy: "both", checkedPage: "Forum, leaving Zaisma" },
      { stateValue: "forum-not-a-link", label: "Not a link", stateKind: "opened", seenBy: "both", checkedPage: "Forum, not a link" },
      { stateValue: "forum-not-found", label: "No such topic", stateKind: "opened", seenBy: "both", checkedPage: "Forum, not found" },
    ],
  },
  {
    placeValue: "reading", name: "Reading pages", path: "/legal/terms", pathPattern: "^/(legal|developers/|design/example|oauth/authorize|no-such-page)", seenBy: "both",
    states: [
      { stateValue: "terms-of-service", label: "Terms of service", stateKind: "opened", seenBy: "both", checkedPage: "Terms of service" },
      { stateValue: "privacy-policy", label: "Privacy policy", stateKind: "opened", seenBy: "both", checkedPage: "Privacy policy" },
      { stateValue: "content-rules", label: "Content rules", stateKind: "opened", seenBy: "both", checkedPage: "Content rules" },
      { stateValue: "security", label: "Security", stateKind: "opened", seenBy: "both", checkedPage: "Security" },
      { stateValue: "dmca-notices", label: "DMCA notices", stateKind: "opened", seenBy: "both", checkedPage: "DMCA notices" },
      { stateValue: "defamation-notices", label: "Defamation notices", stateKind: "opened", seenBy: "both", checkedPage: "Defamation notices" },
      { stateValue: "trademark-notices", label: "Trademark notices", stateKind: "opened", seenBy: "both", checkedPage: "Trademark notices" },
      { stateValue: "background-guide", label: "Background guide", stateKind: "opened", seenBy: "both", checkedPage: "Background guide" },
      { stateValue: "cover-guide", label: "Cover guide", stateKind: "opened", seenBy: "both", checkedPage: "Cover guide" },
      { stateValue: "example-page", label: "Example page", stateKind: "opened", seenBy: "both", checkedPage: "Example page" },
      { stateValue: "a-message", label: "A message", stateKind: "opened", seenBy: "both", checkedPage: "A message" },
      { stateValue: "a-message-in-the-old-look", label: "Old-look message", stateKind: "opened", seenBy: "both", checkedPage: "A message, in the old look" },
    ],
  },
  {
    placeValue: "admin", name: "Admin", path: "/admin", pathPattern: "^/admin", seenBy: "both",
    states: [
      { stateValue: "admin-home", label: "Admin home", stateKind: "opened", seenBy: "both", checkedPage: "Admin" },
      { stateValue: "admin-game", label: "A game", stateKind: "opened", seenBy: "both", checkedPage: "Admin, a game" },
      { stateValue: "admin-audit", label: "Audit log", stateKind: "opened", seenBy: "both", checkedPage: "Admin, audit log" },
      { stateValue: "admin-profiles", label: "Profiles", stateKind: "opened", seenBy: "both", checkedPage: "Admin, profiles" },
      { stateValue: "admin-chat", label: "Chat reviews", stateKind: "opened", seenBy: "both", checkedPage: "Admin, chat reviews" },
      { stateValue: "admin-ncmec", label: "NCMEC reports", stateKind: "opened", seenBy: "both", checkedPage: "Admin, NCMEC reports" },
      { stateValue: "admin-publishing", label: "Publishing", stateKind: "opened", seenBy: "both", checkedPage: "Admin, publishing" },
      { stateValue: "admin-reports", label: "Reports", stateKind: "opened", seenBy: "both", checkedPage: "Admin, reports" },
      { stateValue: "admin-precedents", label: "Precedents", stateKind: "opened", seenBy: "both", checkedPage: "Admin, precedents" },
      { stateValue: "admin-review-precedents", label: "Review precedents", stateKind: "opened", seenBy: "both", checkedPage: "Admin, review precedents" },
      { stateValue: "admin-feedback", label: "Feedback", stateKind: "opened", seenBy: "both", checkedPage: "Admin, feedback" },
    ],
  },
];

/** What's on a page and has no button, each with why: a list a field opens, a menu that's part of another. */
export const NOT_A_STATE: readonly { idPattern: string; reason: string }[] = [
  { idPattern: "^join-birthday-pick$", reason: "the Birthday wheels button opens it by pressing its field, so it's placed as a player sees it" },
  { idPattern: "-list$", reason: "a field's own list: it opens as you type or press that field, and the same press happens on every screen" },
  { idPattern: "^zaisma-button$", reason: "the Zaisma button: always over a running game" },
  { idPattern: "^top-menu$", reason: "the account menu's popover: its button presses it open" },
  { idPattern: "^browse-filter$", reason: "the Filter menu's popover: its button presses it open" },
  { idPattern: "-more$", reason: "a row's More menu: the row's own button presses it open, and each of its choices has a button" },
  { idPattern: "^(app|key)-", reason: "a sheet per app or API key, the same sheets as Add a sign-in app and Add an API key" },
  { idPattern: "^(buy-sheet|buy-confirm-you)$", reason: "Buying's buttons open it, each with what's in it" },
  { idPattern: "^conn-dialog$", reason: "the connection's dropdown: Weak connection, Reconnecting and Connection lost each show the bar's button that opens it" },
    { idPattern: "^players$", reason: "Playing's Players button opens it, with its list filled" },
  { idPattern: "^spending-request$", reason: "Spending request's button opens it from its address" },
  { idPattern: "^game-deletion-request$", reason: "Deletion request's button opens it from its address" },
  { idPattern: "^budget-[a-z0-9-]+-off$", reason: "a game's budget turned off, a step of A game's budget" },
];

/** Named screens with no button, each with why. */
export const PAGES_NOT_ON_THE_BENCH: readonly { name: PageName; reason: string }[] = [
  { name: "Connect an app", reason: "only a developer's stand-in site sends a player there, and a screen's frame stays on Zaisma's own address: open the preview's sign-in site" },
  { name: "Sign in with Zaisma", reason: "only a developer's stand-in site sends a player there, and a screen's frame stays on Zaisma's own address: open the preview's sign-in site" },
  { name: "Check your email, in the old look", reason: "only a form on Your account reaches it, after a passkey or a code: Your account's button is one press from it" },
  { name: "A forum topic", reason: "its address holds an id the preview makes new on each start: press a topic in Topics" },
  { name: "Forum, report a post", reason: "its address holds an id the preview makes new on each start: press Report on a post in a topic" },
  { name: "Admin, a feedback note", reason: "its address holds an id made as feedback is sent: press a note in Feedback" },
];

/** Who a button or a choice is for: short, since the menus hold them on one line. Each of the preview's test accounts has one. */
export const PROFILE_WORDS: Record<string, string> = {
  Preview_Studio: "a developer with games", Moss_Runner: "an everyday player", Quiet_Comet: "14, private to friends", Bright_Reed: "16, open and social", Chat_Owl: "an adult who chats",
  Tall_Pine: "custom social settings", Kit_Spark: "in a full room", Key_Maker: "no passkey yet", Waiting_Key: "a passkey waiting", New_Passkey: "its only passkey waits", Guessed_At: "locked out",
  Saved_Farmer: "no passkey or email", Quiet_Builder: "no email, has a key", Gone_Dev: "owns two games", Loud_Lynx: "reported in Arena", Paused_Maker: "paused by a known-image match", Stopped_Fox: "social side off", Card_Keeper: "has a saved card",
  Pin_Keeper: "buys with a PIN", Banned_Dev: "developer side banned", Closed_Player: "a closed account", New_Studio: "3 days old", New_Teen: "16, an hour old", Mia_Plays: "has a row in a game",
  Longest_Names_Here: "the longest names", Empty_Handed: "nothing yet", Many_Things: "a great many things",
};

const entryOf = (name: PageName): (typeof CHECKED_PAGES)[number] => [...CHECKED_PAGES, ...STEEL_PAGES].find((page) => page.name === name) as (typeof CHECKED_PAGES)[number];
/** Who a place or state seen only signed in opens as, when no one's named and the bench's person is a guest. */
const SIGNED_IN_BY_DEFAULT = "Moss_Runner";

/** A state as the screens take it: where it is, who it needs, and what's done there. It's listed for everyone: there's no saying who can't see it, only who a press switches to. */
export interface ReadyState {
  placeValue: string;
  stateValue: string;
  label: string;
  stateKind: StateKind;
  /** Who a press always switches to, a test account or "guest". */
  profile?: string;
  /** Who a press switches a guest to, when any signed-in person will do. */
  signedInProfile?: string;
  /** The screen the page says it is once it's there (layout's checkedPage), for the press check. */
  shownPageName?: string;
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
    const entry = "checkedPage" in state ? entryOf(state.checkedPage) : null;
    const profile = state.profile ?? entry?.account ?? (state.seenBy === "guest" ? "guest" : undefined);
    const shared = { placeValue: place.placeValue, stateValue: state.stateValue, label: state.label, stateKind: state.stateKind, profile, signedInProfile: !profile && state.seenBy === "signed_in" ? place.profile ?? SIGNED_IN_BY_DEFAULT : undefined, words: state.words };
    if ("checkedPage" in state) return { ...shared, path: entry!.path, shownPageName: entry!.stateBeforeSetUp ?? entry!.shownStateName ?? entry!.name, stepsToTake: entry!.stepsToTake, setUpName: entry!.setUp ? entry!.name : undefined, isOwnPage: !entry!.setUp };
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
