// The test bench's pages in Glass (bin/local-play.js serves them), taken from apps/site's source when the package is built (scripts/bench.mjs
// bundles this file) and when the repository runs the bench, so nothing here is a copy of Zaisma that can go stale. Two layers:
//   - the dev page: the bench's own bar (add a player, friends, a phone, the log) above one frame;
//   - the player page in that frame: zaisma.com's game page, drawn by the site's own gamePageResponse from the bench's stand-ins, with
//     its bar, sheets, cards and page scripts, framing the game. The bench answers its calls; nothing here runs on Zaisma's servers.
import { AGE_BANDS, SOCIAL_MODES, chatBandGroup, defaultSocialMode, socialModeSettings, socialModesFor, type Account, type AgeBand, type FriendInGame, type FriendsInGame, type Game, type ItemCategory, type SocialMode } from "@zaisma/core";
import { html, layout, raw, type Raw } from "../../../apps/site/src/html.ts";
import type { Env } from "../../../apps/site/src/env.ts";
import { gamePageResponse } from "../../../apps/site/src/pages.ts";
import { friendRows } from "../../../apps/site/src/players-sheet.ts";
import { friendsHere } from "../../../apps/site/src/friends-now.ts";
import { pageScriptResponse } from "../../../apps/site/src/page-scripts.ts";
import { pageStyleResponse } from "../../../apps/site/src/page-styles.ts";
import { cutButton, runButton } from "../../../apps/site/src/components/actions.ts";
import { cutField, searchField } from "../../../apps/site/src/components/fields.ts";
import { sectionTabs } from "../../../apps/site/src/components/navigation.ts";
import { SOCIAL_MODE_LABELS } from "../../../apps/site/src/account.ts";
import { glassPane, type IconName } from "../../../apps/site/src/components/foundations.ts";
import { icon } from "../../../apps/site/src/components/icons.ts";
import { banner, confirmSheet, dropdown, sheet } from "../../../apps/site/src/components/panes.ts";
import { selectField } from "../../../apps/site/src/components/choices.ts";
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
  /** The bench's players, for the player menu: the most recent first. */
  players: { id: string; username: string; isThisTab: boolean }[];
  /** The bench's address for a phone on the same Wi-Fi, null when it answers only on this computer. */
  networkUrl: string | null;
  /** What the bench said, newest last. */
  logLines: string[];
}

export type DevSheetName = "phone" | "log";

// The dev bar's own look: a slim flat strip in a color none of Zaisma's pages use, with words for its buttons, so it never reads as part of
// what a player sees. It's the bench's, not a page of zaisma.com's, so it has its own few styles here. The playing styles lay out the body
// as the game page's: this strip, then the frame below it, in a column on every screen.
const DEV_BAR_STYLE = `html.is-playing body { flex-direction: column; }
.bench-bar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 0 8px; padding-top: env(safe-area-inset-top, 0); background: #26215c; color: #cecbf6; font: 500 13px/1 Jost, system-ui, sans-serif; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
.bench-bar::-webkit-scrollbar { display: none; }
.bench-bar .bench-name { padding-right: 6px; color: #afa9ec; }
.bench-bar .bench-fill { flex: 1; }
.bench-bar .bench-tool { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
.bench-bar .bench-tool:hover, .bench-bar .bench-tool:focus-visible { background: #3c3489; color: #eeedfe; outline: none; }
.bench-bar .bench-tool.bench-player { background: #3c3489; color: #eeedfe; }
.bench-bar svg { width: 15px; height: 15px; flex: none; }
main > .dropdown { z-index: 5; }
@media (max-width: 600px) { .bench-bar .bench-name, .bench-bar .bench-tool:not(.bench-player) .bench-words { display: none; } }`;

/** One of the dev bar's buttons: it opens its sheet, or its menu (a dropdown, which says whether it's open). */
const devTool = (label: string, iconName: IconName | null, target: { id: string; controls: string; isMenu?: boolean; className?: string }): Raw =>
  html`<button class="bench-tool${target.className ? ` ${target.className}` : ""}" id="${target.id}" type="button" aria-controls="${target.controls}"${target.isMenu ? raw(' aria-expanded="false"') : ""} aria-label="${label}">${iconName ? icon(iconName) : ""}<span class="bench-words">${label}</span>${target.isMenu && !iconName ? icon("chevron-down") : ""}</button>`;

/** How many of the bench's players the player menu lists; the rest are in Manage players. */
const PLAYER_MENU_COUNT = 8;

/** The dev page: the bench's bar above the player's page, which frames the game. */
export async function devPage(places: BenchPlaces, view: DevView, frame: { path: string; allow: string }): Promise<BenchPage> {
  const who = `Player ${view.playerNumber}${view.accountName ? `, ${view.accountName}` : ", a guest"}`;
  const bar = html`<div class="bench-bar" role="toolbar" aria-label="Test bench">
<span class="bench-name">Test bench</span>
${devTool(who, null, { id: "bench-who", controls: "bench-who-menu", isMenu: true, className: "bench-player" })}
<span class="bench-fill"></span>
${devTool("Add a player", "plus", { id: "bench-add", controls: "bench-add-menu", isMenu: true })}
${devTool(view.logLines.length ? `Log ${view.logLines.length}` : "Log", "info", { id: "bench-log-open", controls: "bench-log" })}
</div>`;
  // Who this tab plays as: switch to another of the bench's players, manage them all, or sign out to a new guest. The game starts again.
  const back = encodeURIComponent(`/?player=${view.playerNumber}`);
  const whoMenu = dropdown({
    id: "bench-who-menu",
    label: who,
    head: { title: `Player ${view.playerNumber}`, note: "Who this tab plays as. The game starts again as them." },
    items: [
      ...view.players.slice(0, PLAYER_MENU_COUNT).map((player) => ({ label: player.username, icon: "person" as const, isCurrent: player.isThisTab, action: `/bench/sign-in?player=${view.playerNumber}&account=${encodeURIComponent(player.id)}&next=${back}` })),
      ...(view.players.length ? [{ kind: "rule" as const }] : []),
      { label: view.players.length ? "Manage players" : "Make a player", icon: "people", href: `/bench/players?player=${view.playerNumber}` },
      ...(view.accountName ? [{ label: "Sign out, as a new guest", icon: "sign-out" as const, action: `/bench/sign-out?player=${view.playerNumber}` }] : []),
    ],
  });
  // A new player comes in a tab of this browser, or on a phone; either way into the room this player is in.
  const addMenu = dropdown({
    id: "bench-add-menu",
    label: "Add a player",
    head: { title: "Add a player", note: "A new guest, in the room you're in." },
    items: [
      { id: "bench-add-tab", label: "In a new tab", icon: "plus", href: view.roomCode ? `/?room=${view.roomCode}` : "/", isNewTab: true },
      { label: "On a phone", icon: "phone", confirmSheetId: "bench-phone" },
    ],
  });
  const devSheet = (name: DevSheetName, title: string) => sheet({ id: `bench-${name}`, title, closeLabel: "Close", placement: "foot", isCompact: true, body: html`<div id="bench-${name}-body">${devSheetMarkup(name, view)}</div>` });
  // The strip first, then <main> with the menus and sheets, then the player's page in the frame: the playing styles show those alone.
  const body = html`<style>${raw(DEV_BAR_STYLE)}</style>
${bar}
<main>${whoMenu}
${addMenu}
${devSheet("phone", "Add a player on a phone")}
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

// --- The bench's players: made on this computer, with Zaisma's own age bands and social modes ---

const AGE_BAND_WORDS: Record<AgeBand, string> = { "13-15": "13–15", "16-17": "16–17", "18+": "18+" };

/** Whether a social mode is one an age band can choose on Zaisma (13–15 never open and social). */
export const isSocialModeAllowed = (ageBand: AgeBand, socialMode: SocialMode): boolean => socialModesFor(ageBand).includes(socialMode);

/** Where a new player starts on Zaisma: 13–15 with no chat, everyone else with friends only. */
export const startingSocialMode = (ageBand: AgeBand): SocialMode => defaultSocialMode(ageBand);

/**
 * Who a player chats with, by Zaisma's own rules for their age and social mode: their chat setting, and the band group strangers who chat
 * with anyone share (16–17 or 18+), or null. A pass carries the setting and an opaque chat group made from the group, never the age.
 */
export function chatOf(ageBand: AgeBand, socialMode: SocialMode): { whoCanChat: string; bandGroup: string | null } {
  const whoCanChat = socialModeSettings(socialMode, ageBand).who_can_chat;
  return { whoCanChat, bandGroup: chatBandGroup({ who_can_chat: whoCanChat, age_band: ageBand }) };
}

/** One of the bench's players, as its pages show them. */
export interface BenchPlayer {
  id: string;
  username: string;
  ageBand: AgeBand;
  socialMode: SocialMode;
  /** The players (tab numbers) open as them now. */
  openPlayerNumbers: number[];
}

/** Where a players page was opened from: the player (tab) it's for, and where to go once someone's picked (the game page's next). */
export interface PlayersPlace {
  playerNumber: number;
  nextPath: string;
}

const keep = (place: PlayersPlace, extra: Record<string, string> = {}) => ({ player: String(place.playerNumber), ...(place.nextPath ? { next: place.nextPath } : {}), ...extra });
const query = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const hiddenFields = (fields: Record<string, string>) => html`${Object.entries(fields).map(([name, fieldText]) => html`<input type="hidden" name="${name}" value="${fieldText}">`)}`;
const describe = (player: BenchPlayer) => [AGE_BAND_WORDS[player.ageBand], SOCIAL_MODE_LABELS[player.socialMode], ...player.openPlayerNumbers.map((playerNumber) => `open as player ${playerNumber}`)].join(" · ");
const benchPane = (places: BenchPlaces, title: string, body: Raw) =>
  pageOf(layout(benchEnv(places), { title: `${title}: test bench`, checkedPage: "A message", body: html`${glassPane({ paneWidth: "fit", label: title, body })}<script src="/bench/sign-in.js" defer></script>` }));

/** Who's playing: every player made on this computer, a row each, to sign in as; a new one; or staying a guest. Where Zaisma's sign-in and Make an account go. */
export async function playersPage(places: BenchPlaces, place: PlayersPlace, input: { players: BenchPlayer[]; searchText: string; shownCount: number; totalCount: number }): Promise<BenchPage> {
  const shown = input.players.slice(0, input.shownCount);
  const rows = shown.map((player) => ({
    title: player.username,
    detail: describe(player),
    action: [
      cutButton("Sign in", { type: "submit", name: "account", buttonValue: player.id, isSmall: true }),
      cutButton(`${player.username}'s details`, { href: `/bench/players/${encodeURIComponent(player.id)}?${query(keep(place))}`, icon: "chevron-right", isLabelHidden: true, isSmall: true }),
    ],
  }));
  const list: LayoutItem = rows.length
    ? { kind: "block", markup: listRows({ label: "Players", rows }) }
    : { kind: "block", markup: emptyState({ title: input.searchText ? "No one by that name" : "No players yet", text: input.searchText ? "Clear the search, or make them." : "Make one, or press Quick player for one with the next name and the defaults." }) };
  // The search is a form of its own; every row's Sign in and Quick player are one form that signs this tab in.
  const picking = html`<form method="post" action="/bench/sign-in">${hiddenFields(keep(place))}${stack({ items: [
    { kind: "block", markup: row({ widths: "fit", items: [{ kind: "control", markup: cutButton("Quick player", { type: "submit", name: "quick", buttonValue: "yes", icon: "plus", isSmall: true }) }] }) },
    list,
    ...(input.players.length > shown.length ? [{ kind: "control" as const, markup: cutButton("Show more", { href: `/bench/players?${query(keep(place, { search: input.searchText, shown: String(input.shownCount + 20) }))}` }) }] : []),
  ] })}</form>`;
  const items: LayoutItem[] = [
    { kind: "words", markup: html`<h1>Who's playing?</h1><p>The players made on this computer. Sign in as one, or make a new one: the bench keeps them, with their saves, items, friends and blocks.</p>` },
    {
      kind: "block",
      markup: row({
        widths: "lead-fills",
        label: "Find or make a player",
        items: [
          { kind: "control", markup: searchField({ action: "/bench/players", name: "search", searchText: input.searchText, placeholder: "Find a player", label: "Find a player", keep: keep(place) }) },
          { kind: "control", markup: cutButton("New player", { href: `/bench/players/new?${query(keep(place))}`, isSmall: true }) },
        ],
      }),
    },
    { kind: "block", markup: picking },
    { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "words", markup: html`<p>${input.totalCount === 1 ? "1 player" : `${input.totalCount} players`} on this computer</p>` }, { kind: "control", markup: cutButton("Stay a guest", { href: place.playerNumber ? `/?player=${place.playerNumber}` : "/", isSmall: true }) }] }) },
  ];
  return benchPane(places, "Who's playing", stack({ items }));
}

const ageChoices = AGE_BANDS.map((ageBand) => ({ label: AGE_BAND_WORDS[ageBand], choiceValue: ageBand }));
const socialChoices = SOCIAL_MODES.map((socialMode) => ({ label: SOCIAL_MODE_LABELS[socialMode], choiceValue: socialMode }));
/** Age and how they play, side by side. */
const profileChoices = (ageBand: AgeBand, socialMode: SocialMode) =>
  row({ widths: "equal", items: [{ kind: "control", markup: selectField({ name: "age_band", label: "Age", choices: ageChoices, pickedValue: ageBand }) }, { kind: "control", markup: selectField({ name: "social_mode", label: "How they play", choices: socialChoices, pickedValue: socialMode }) }] });

/** A new player: a name, an age band and a social mode, with Zaisma's limits (13–15 is never open and social). */
export async function newPlayerPage(places: BenchPlaces, place: PlayersPlace, input: { name: string; ageBand: AgeBand; socialMode: SocialMode; error: string | null }): Promise<BenchPage> {
  const items: LayoutItem[] = [
    { kind: "words", markup: html`<h1>New player</h1><p>Made on this computer, with the same age and social rules as a Zaisma account, so the game's passes carry what a real account's would.</p>` },
    { kind: "control", markup: cutField({ name: "name", label: "Name", type: "text", icon: "person", text: input.name, autocomplete: "off", error: input.error ?? undefined }) },
    { kind: "block", markup: profileChoices(input.ageBand, input.socialMode) },
    { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: cutButton("Back", { href: `/bench/players?${query(keep(place))}` }) }, { kind: "control", markup: runButton(place.nextPath ? "Make and sign in" : "Make player", { type: "submit" }) }] }) },
  ];
  return benchPane(places, "New player", html`<form method="post" action="/bench/players/new">${hiddenFields(keep(place))}${stack({ items })}</form>`);
}

export type PlayerTab = "profile" | "items" | "purchases";

/** One of the game's items, as a player's Items tab lists it. */
export interface PlayerItem {
  itemName: string;
  title: string;
  itemKind: string;
  priceText: string;
  isOwned: boolean;
}

/** One of a player's purchases, newest first. */
export interface PlayerPurchase {
  id: string;
  title: string;
  /** "Bought for $1.99", "Granted"; the date and whether the game has handled it. */
  detail: string;
  isRefunded: boolean;
}

/** One player's details: their profile, friends and blocks; their items; their purchases. Every change posts and comes back here. */
export async function playerDetailsPage(
  places: BenchPlaces,
  place: PlayersPlace,
  input: {
    player: BenchPlayer;
    tab: PlayerTab;
    friends: { id: string; username: string }[];
    blocked: { id: string; username: string }[];
    blockedBy: string[];
    others: { id: string; username: string }[];
    items: PlayerItem[];
    purchases: PlayerPurchase[];
    searchText: string;
    shownCount: number;
    error: string | null;
  },
): Promise<BenchPage> {
  const { player } = input;
  const here = `/bench/players/${encodeURIComponent(player.id)}`;
  const tabHref = (tab: PlayerTab) => `${here}?${query(keep(place, { tab }))}`;
  const changeForm = (body: Raw) => html`<form method="post" action="${here}">${hiddenFields(keep(place, { tab: input.tab }))}${body}</form>`;
  const change = (label: string, changeText: string, isQuiet = true) => cutButton(label, { type: "submit", name: "change", buttonValue: changeText, isSmall: isQuiet });
  const words = (text: string): LayoutItem => ({ kind: "words", markup: html`<p>${text}</p>` });
  const head: LayoutItem[] = [
    { kind: "block", markup: row({ widths: "fit", items: [{ kind: "control", markup: cutButton("Players", { href: `/bench/players?${query(keep(place))}`, icon: "arrow-back", isSmall: true }) }] }) },
    { kind: "words", markup: html`<h1>${player.username}</h1><p>${describe(player)}</p><p>A change here reaches the game with ${player.username}'s next pass: the next time they join a room, or as the game asks for one.</p>` },
    ...(input.error ? [{ kind: "block" as const, markup: banner({ text: input.error, icon: "warning", tone: "warning" }) }] : []),
    { kind: "block", markup: html`<form method="post" action="/bench/sign-in">${hiddenFields(keep(place))}${row({ widths: "fit", items: [{ kind: "control", markup: runButton(`Sign in as ${player.username}`, { type: "submit", name: "account", buttonValue: player.id }) }, { kind: "control", markup: cutButton("Delete", { type: "button", icon: "trash", controls: "bench-delete", isSmall: true }) }] })}</form>` },
    { kind: "block", markup: sectionTabs({ label: `${player.username}'s details`, tabs: [{ label: "Profile", href: tabHref("profile"), isCurrent: input.tab === "profile" }, { label: "Items", href: tabHref("items"), isCurrent: input.tab === "items" }, { label: "Purchases", href: tabHref("purchases"), isCurrent: input.tab === "purchases" }] }) },
  ];
  const others = (except: { id: string }[]) => input.others.filter((other) => !except.some((each) => each.id === other.id)).map((other) => ({ label: other.username, choiceValue: other.id }));
  let tabItems: LayoutItem[];
  if (input.tab === "profile") {
    const friendChoices = others(input.friends);
    const blockChoices = others(input.blocked);
    tabItems = [
      { kind: "block", markup: changeForm(stack({ items: [
        { kind: "words", markup: html`<h2>Profile</h2>` },
        { kind: "control", markup: cutField({ name: "name", label: "Name", type: "text", icon: "person", text: player.username, autocomplete: "off" }) },
        { kind: "block", markup: profileChoices(player.ageBand, player.socialMode) },
        { kind: "block", markup: row({ widths: "fit", items: [{ kind: "control", markup: change("Save", "profile") }] }) },
      ] })) },
      { kind: "block", markup: changeForm(stack({ items: [
        { kind: "words", markup: html`<h2>Friends</h2>` },
        input.friends.length ? { kind: "block", markup: listRows({ label: "Friends", rows: input.friends.map((friend) => ({ title: friend.username, action: change("Remove", `unfriend:${friend.id}`) })) }) } : words("No friends yet."),
        ...(friendChoices.length ? [{ kind: "block" as const, markup: row({ widths: "lead-fills", items: [{ kind: "control", markup: selectField({ name: "friend", label: "Add a friend", choices: friendChoices, placeholder: "Pick a player" }) }, { kind: "control", markup: change("Add", "friend", false) }] }) }] : []),
      ] })) },
      { kind: "block", markup: changeForm(stack({ items: [
        { kind: "words", markup: html`<h2>Blocks</h2>` },
        input.blocked.length ? { kind: "block", markup: listRows({ label: `Blocked by ${player.username}`, rows: input.blocked.map((other) => ({ title: other.username, action: change("Unblock", `unblock:${other.id}`) })) }) } : words(`${player.username} hasn't blocked anyone.`),
        ...(input.blockedBy.length ? [words(`Blocked by: ${input.blockedBy.join(", ")}. A block holds both ways in the game's passes.`)] : []),
        ...(blockChoices.length ? [{ kind: "block" as const, markup: row({ widths: "lead-fills", items: [{ kind: "control", markup: selectField({ name: "block", label: "Block a player", choices: blockChoices, placeholder: "Pick a player" }) }, { kind: "control", markup: change("Block", "block", false) }] }) }] : []),
      ] })) },
    ];
  } else {
    const isItems = input.tab === "items";
    const search: LayoutItem = { kind: "control", markup: searchField({ action: here, name: "search", searchText: input.searchText, placeholder: isItems ? "Find an item" : "Find a purchase", label: isItems ? "Find an item" : "Find a purchase", keep: keep(place, { tab: input.tab }) }) };
    const list: LayoutItem = isItems
      ? input.items.length
        ? { kind: "block", markup: listRows({ label: "Items", rows: input.items.slice(0, input.shownCount).map((gameItem) => ({ title: gameItem.title, detail: [gameItem.itemName, gameItem.itemKind, gameItem.priceText, ...(gameItem.isOwned ? ["owned"] : [])].join(" · "), action: gameItem.isOwned && gameItem.itemKind === "permanent" ? change("Take away", `take:${gameItem.itemName}`) : change(gameItem.itemKind === "consumable" ? "Grant 1" : "Grant", `grant:${gameItem.itemName}`) })) }) }
        : { kind: "block", markup: emptyState({ title: input.searchText ? "No item by that name" : "No items", text: "A game's items are set on Zaisma; start the bench with --game and ZAISMA_KEY to bring them in." }) }
      : input.purchases.length
        ? { kind: "block", markup: listRows({ label: "Purchases", rows: input.purchases.slice(0, input.shownCount).map((purchase) => ({ title: purchase.title, detail: purchase.detail, action: purchase.isRefunded ? undefined : change("Refund", `refund:${purchase.id}`) })) }) }
        : { kind: "block", markup: emptyState({ title: input.searchText ? "No purchase of that" : "No purchases yet", text: "Buying in the game, or granting an item here, adds one." }) };
    const listedCount = isItems ? input.items.length : input.purchases.length;
    tabItems = [
      { kind: "words", markup: isItems ? html`<p>Granting one is a purchase the game gets as Zaisma would send it: at once while it runs, or as unhandled the next time.</p>` : html`<p>Newest first. A refund reaches the game as Zaisma's would.</p>` },
      search,
      { kind: "block", markup: changeForm(stack({ items: [list] })) },
      ...(listedCount > input.shownCount ? [{ kind: "control" as const, markup: cutButton("Show more", { href: `${here}?${query(keep(place, { tab: input.tab, search: input.searchText, shown: String(input.shownCount + 20) }))}` }) }] : []),
    ];
  }
  const deleteSheet = confirmSheet({ id: "bench-delete", title: `Delete ${player.username}?`, text: "Their saves, items, purchases, friends and blocks on the bench go too.", action: `${here}?${query(keep(place, { change: "delete" }))}`, confirmLabel: "Delete" });
  return benchPane(places, player.username, html`${stack({ items: [...head, ...tabItems] })}${deleteSheet}`);
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
