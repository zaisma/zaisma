// The test bench's pages in Glass (bin/local-play.js serves them), taken from apps/site's source when the package is built (scripts/bench.mjs
// bundles this file) and when the repository runs the bench, so nothing here is a copy of Zaisma that can go stale. Two layers:
//   - the dev page: the bench's own bar (add a player, friends, a phone, the log) above one frame;
//   - the player page in that frame: zaisma.com's game page, drawn by the site's own gamePageResponse from the bench's stand-ins, with
//     its bar, sheets, cards and page scripts, framing the game. The bench answers its calls; nothing here runs on Zaisma's servers.
import type { Account, FriendInGame, FriendsInGame, Game, ItemCategory } from "@zaisma/core";
import { html, layout, type Raw } from "../../../apps/site/src/html.ts";
import type { Env } from "../../../apps/site/src/env.ts";
import { gamePageResponse } from "../../../apps/site/src/pages.ts";
import { friendRows } from "../../../apps/site/src/players-sheet.ts";
import { friendsHere } from "../../../apps/site/src/friends-now.ts";
import { pageScriptResponse } from "../../../apps/site/src/page-scripts.ts";
import { pageStyleResponse } from "../../../apps/site/src/page-styles.ts";
import { playingBar } from "../../../apps/site/src/components/playing.ts";
import { cutButton, runButton } from "../../../apps/site/src/components/actions.ts";
import { cutField } from "../../../apps/site/src/components/fields.ts";
import { glassPane } from "../../../apps/site/src/components/foundations.ts";
import { banner, sheet } from "../../../apps/site/src/components/panes.ts";
import { checkField } from "../../../apps/site/src/components/choices.ts";
import { qrCode } from "../../../apps/site/src/components/inputs.ts";
import { emptyState, listRows } from "../../../apps/site/src/components/data.ts";
import { row, stack, type LayoutItem } from "../../../apps/site/src/components/layout.ts";

/** Where the bench is, as the browser reached it: the site's settings the pages read, for the bench's origins. */
export interface BenchPlaces {
  /** The bench's own address on this computer (http://localhost:4800): it says to the site's code that this is a local preview. */
  localSiteOrigin: string;
  /** The game's site as this browser reaches it (http://localhost:4801, or the computer's address from a phone). */
  gameOrigin: string;
  roomsOrigin: string;
}

// The site Worker's settings the pages read. The bench stands in for sign-in, payments and saves itself, so those read as set; Turnstile,
// which checks a real browser for Zaisma, has no site key, so a play goes ahead without it.
const benchEnv = (places: BenchPlaces) =>
  ({
    SITE_ORIGIN: places.localSiteOrigin,
    GAME_ORIGIN: places.gameOrigin,
    ROOMS_ORIGIN: places.roomsOrigin,
    GAME_HOST_MODE: "path",
    GAME_DOMAIN: "",
    SUPABASE_URL: `${places.localSiteOrigin}/stand-in`,
    SUPABASE_SECRET_KEY: "stand-in",
    STRIPE_API_ORIGIN: `${places.localSiteOrigin}/stand-in`,
    KEEP_OFFER_SECONDS: "300",
  }) as unknown as Env;

/** A page as the bench sends it. */
export interface BenchPage {
  httpStatus: number;
  headers: [string, string][];
  body: string;
}

const pageOf = async (response: Response): Promise<BenchPage> => ({ httpStatus: response.status, headers: [...response.headers.entries()], body: await response.text() });

/** What a player's page shows. */
export interface PlayerPageInput {
  places: BenchPlaces;
  gameSlug: string;
  gameTitle: string;
  /** The page's address, /p/<player number>/g/<slug> with its query. */
  pageUrl: string;
  /** The account the player signed in to, or null for a guest. */
  account: { id: string; username: string } | null;
  purchaseDelivery: Game["purchase_delivery"];
  /** The categories of the items the game sells, for the purchase label. */
  soldCategories: ItemCategory[];
}

/** The game as zaisma.com would hold it: an unlisted live game on Zaisma's rooms, with cloud saves, that anyone can play. */
function benchGame(input: PlayerPageInput): Game {
  return {
    id: "game_local", slug: input.gameSlug, title: input.gameTitle, description: "", review_status: "live", review_reason: null, live_version_id: "version_local",
    multiplayer_mode: "relay", built_in_server: null, own_server_urls: "[]", owner_id: null, cloud_saves_enabled: 1, account_offer_enabled: 1,
    deleted_account_erase_enabled: 0, friend_joins_enabled: 1, performance_measuring_enabled: 0, monthly_budget_cents: null, quick_joined_at_ms: null,
    game_server_allowed_hosts: "[]", links: "[]", links_checked_at_ms: null, secrets_changed_at_ms: null, visibility: "unlisted", devices: "", genres: "",
    controls: "", screen_orientation: "", play_modes: "", room_browsing: "off", account_requirement: "none", minimum_player_age_years: 13, entry_signing_key: "",
    is_off_shelves: 0, details_waiting_for_review: null, title_listing_reason: null, country_blocks: "[]", cleared_title: null, listing_check_requested_at_ms: null,
    listing_checked_at_ms: null, glass_tint_color: null, refund_policy: null, refund_policy_text: null, own_payment_categories: "[]",
    purchase_delivery: input.purchaseDelivery, live_version_match_update_mode: "next_match", live_version_published_at_ms: null,
    has_live_version_game_file_changes: 0, created_at_ms: 0, updated_at_ms: 0,
  };
}

/** A player's page: zaisma.com's game page for the game, drawn by the site's own code, as this player sees it. */
export async function playerPage(input: PlayerPageInput): Promise<BenchPage> {
  // Only what the game page reads of an account: who they are, a grown-up's band, their own light or dark left to the system.
  const account = input.account ? ({ id: input.account.id, username: input.account.username, age_band: "18+", is_streamer_mode_on: 0, color_theme: "system" } as unknown as Account) : null;
  return pageOf(gamePageResponse(benchEnv(input.places), {
    game: benchGame(input),
    pageUrl: new URL(input.pageUrl, input.places.localSiteOrigin),
    tester: null,
    testerVersionId: null,
    viewer: { ageFloorYears: 18, account, email: null, cookies: [] },
    developer: null,
    pictures: [],
    updates: [],
    otherGames: [],
    liveRooms: null,
    checkedPlayerCount: 0,
    hasThreads: false,
    purchaseLabel: { categories: input.soldCategories, has_own_payments: false },
    background: { source: "zaisma", glassTintColor: null },
    head: undefined,
    isFramedBySelf: true,
    isShownInLists: false,
  }));
}

/** A friend playing the game now, as the bench knows them. */
export interface FriendPlaying {
  playerId: string;
  username: string;
  /** Their room, for Join; null when they're in none. */
  roomCode: string | null;
}

/** Under the game's title (#friends-here): the friends playing it, with Join. Empty with none. */
export function friendsHereHtml(gameSlug: string, friends: FriendPlaying[]): string {
  if (!friends.length) return "";
  const room = friends.find((friend) => friend.roomCode)?.roomCode ?? null;
  const here = {
    friends: friends.map((friend) => ({ player_id: friend.playerId, name: friend.username })),
    join: room ? { room_code: room, server_url: null, refusal: null, refusing_friend_names: [] } : null,
    watch: null,
  } as unknown as FriendsInGame;
  return String(friendsHere(gameSlug, here));
}

/** The players sheet's friends part: the friends playing the game outside this room, with Join. */
export function friendRowsHtml(gameSlug: string, friends: FriendPlaying[]): string {
  const rows: FriendInGame[] = friends.map((friend) => ({ player_id: friend.playerId, username: friend.username, room_code: friend.roomCode, server_url: null, join_refusal: friend.roomCode ? null : "friend_not_in_room", watch: null }));
  return String(friendRows(gameSlug, rows));
}

/** What the dev page and its sheets show. */
export interface DevView {
  gameSlug: string;
  playerNumber: number;
  /** The account the player signed in to, or null for a guest. */
  accountName: string | null;
  /** The room the player is in, or null. */
  roomCode: string | null;
  /** The other accounts, and whether each is this player's friend; empty for a guest. */
  friendChoices: { accountId: string; username: string; isFriend: boolean }[];
  /** The bench's address for a phone on the same Wi-Fi, null when it answers only on this computer. */
  networkUrl: string | null;
  /** What the bench said, newest last. */
  logLines: string[];
}

export type DevSheetName = "friends" | "phone" | "log";

/** The dev page: the bench's bar above the player's page, which frames the game. */
export async function devPage(places: BenchPlaces, view: DevView, frame: { path: string; allow: string }): Promise<BenchPage> {
  const addHref = view.roomCode ? `/?room=${view.roomCode}` : "/";
  const controls = [
    cutButton("Add a player", { id: "bench-add", href: addHref, icon: "plus", isSmall: true }),
    cutButton("Friends", { id: "bench-friends-open", type: "button", icon: "friends", isLabelHidden: true, isSmall: true, controls: "bench-friends" }),
    cutButton("Phone", { id: "bench-phone-open", type: "button", icon: "phone", isLabelHidden: true, isSmall: true, controls: "bench-phone" }),
    cutButton("Log", { id: "bench-log-open", type: "button", icon: "info", isLabelHidden: true, isSmall: true, controls: "bench-log" }),
  ];
  const devSheet = (name: DevSheetName, title: string) => sheet({ id: `bench-${name}`, title, closeLabel: "Close", placement: "foot", isCompact: true, body: html`<div id="bench-${name}-body">${devSheetMarkup(name, view)}</div>` });
  const who = `Player ${view.playerNumber}${view.accountName ? `, ${view.accountName}` : ", a guest"}`;
  // The bar and its sheets in <main>, the player's page in the frame beside it in the body: the playing styles lay out those alone.
  const body = html`<main>${playingBar({ title: who, controls })}
${devSheet("friends", "Friends")}
${devSheet("phone", "Open it on a phone")}
${devSheet("log", "Log")}</main>
<iframe class="game-frame" id="bench-player" src="${frame.path}" title="${who}: the game page on Zaisma" allow="${frame.allow}" allowfullscreen></iframe>
<script src="/bench/dev.js?player=${String(view.playerNumber)}" defer></script>`;
  const page = await pageOf(layout(benchEnv(places), { title: `${who}: test bench for ${view.gameSlug}`, checkedPage: "Game page", isBare: true, frames: ["'self'"], body }));
  return { ...page, body: page.body.replace('<html lang="en"', '<html lang="en" class="is-playing"') };
}

/** One of the dev page's sheets, drawn afresh each time it opens or changes. */
export function devSheetBody(name: DevSheetName, view: DevView): string {
  return String(devSheetMarkup(name, view));
}

function devSheetMarkup(name: DevSheetName, view: DevView): Raw {
  const words = (text: string): LayoutItem => ({ kind: "words", markup: html`<p>${text}</p>` });
  if (name === "friends") {
    if (!view.accountName) return stack({ items: [words("Friends are between accounts. Sign in from the game, and the players who have signed in on the bench show here.")] });
    if (!view.friendChoices.length) return stack({ items: [words(`No one else has signed in on the bench yet. Add a player, sign them in, and they show here as ${view.accountName}'s friends to pick.`)] });
    return stack({
      items: [
        words(`Who ${view.accountName} is friends with. A game learns only which of its own players are friends, through their passes.`),
        ...view.friendChoices.map((choice): LayoutItem => ({ kind: "block", markup: checkField({ name: "bench-friend", id: `bench-friend-${choice.accountId}`, checkValue: choice.accountId, label: choice.username, isChecked: choice.isFriend }) })),
        words("A pass is made as a player joins a room: join again to bring a change into the game."),
      ],
    });
  }
  if (name === "phone") {
    if (!view.networkUrl) return stack({ items: [words("The bench answers only on this computer. To play on a phone on the same Wi-Fi, stop it and start it again with --on-network.")] });
    const target = view.roomCode ? `${view.networkUrl}/?room=${view.roomCode}` : `${view.networkUrl}/`;
    return stack({
      items: [
        { kind: "block", markup: qrCode({ id: "bench-phone-qr", label: view.roomCode ? "A new player, into this room" : "A new player", caption: target, imageUrl: `/bench/qr.svg?text=${encodeURIComponent(target)}` }) },
        { kind: "block", markup: banner({ text: "Your phone will say the connection isn't private, because the bench signs its own certificate. Continue to the site.", icon: "warning", tone: "warning" }) },
      ],
    });
  }
  if (!view.logLines.length) return stack({ items: [{ kind: "block", markup: emptyState({ title: "Nothing yet", text: "What the bench and your game server say shows up here." }) }] });
  return listRows({ label: "Log", rows: view.logLines.map((line) => ({ title: line })) });
}

/** The bench's sign-in, where /signin and /join go: a name alone makes an account on this computer. */
export async function signInPage(places: BenchPlaces, input: { playerNumber: number; nextPath: string; suggestedName: string; freeAccounts: { id: string; username: string }[]; error: string | null }): Promise<BenchPage> {
  const items: LayoutItem[] = [
    { kind: "words", markup: html`<h1>Sign in</h1><p>On the test bench a name is enough: the bench makes the account on this computer, with no password.</p>` },
    ...(input.freeAccounts.length
      ? [{ kind: "block" as const, markup: row({ widths: "fit", label: "Accounts on the bench", items: input.freeAccounts.map((account) => ({ kind: "control" as const, markup: cutButton(`Sign in as ${account.username}`, { type: "submit", name: "account", buttonValue: account.id }) })) }) }]
      : []),
    { kind: "control", markup: cutField({ name: "name", label: input.freeAccounts.length ? "Or a new player" : "Your name", type: "text", icon: "person", text: input.suggestedName, autocomplete: "off", error: input.error ?? undefined }) },
    { kind: "control", markup: runButton("Sign in", { type: "submit", isFullWidth: true }) },
  ];
  // Laid out as the site lays out a message: a pane of glass on the page, under the site's header.
  const body = glassPane({ paneWidth: "fit", label: "Sign in", body: html`<form method="post" action="/bench/sign-in"><input type="hidden" name="player" id="bench-sign-in-player" value="${String(input.playerNumber)}"><input type="hidden" name="next" value="${input.nextPath}">${stack({ items })}</form>` });
  return pageOf(layout(benchEnv(places), { title: "Sign in: test bench", checkedPage: "A message", body: html`${body}<script src="/bench/sign-in.js" defer></script>` }));
}

/** Where a sign-in ends (/account/kept): it tells the game page it's signed in, then closes or goes back to the player's game. */
export async function keptPage(places: BenchPlaces, username: string | null, playerNumber: number): Promise<BenchPage> {
  const text = username ? `You're signed in as ${username}. The game picks it up where you left it.` : "Sign in from a player's game page.";
  const body = html`${glassPane({ paneWidth: "fit", label: "Signed in", body: stack({ items: [{ kind: "words", markup: html`<h1>You're in</h1><p>${text}</p>` }] }) })}<script src="/bench/kept.js?player=${String(playerNumber)}" defer></script>`;
  return pageOf(layout(benchEnv(places), { title: "Signed in: test bench", checkedPage: "A message", body }));
}

/** The site's stylesheet, scripts and font by the paths the page names, or null for a path that isn't one of them. */
export async function siteAsset(path: string): Promise<{ httpStatus: number; headers: Record<string, string>; body: Uint8Array } | null> {
  for (const answer of [pageScriptResponse(path), pageStyleResponse(path)]) {
    if (answer.status === 404) continue;
    return { httpStatus: answer.status, headers: Object.fromEntries(answer.headers.entries()), body: new Uint8Array(await answer.arrayBuffer()) };
  }
  return null;
}
