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
import { SOCIAL_MODE_LABELS } from "../../../apps/site/src/account.ts";
import type { IconName } from "../../../apps/site/src/components/foundations.ts";
import { icon } from "../../../apps/site/src/components/icons.ts";

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
  players: { playerId: string; name: string; isThisTab: boolean }[];
  /** The bench's address for a phone on the same Wi-Fi, null when it answers only on this computer. */
  networkUrl: string | null;
  /** What the bench said, newest last. */
  logLines: string[];
}

export type DevSheetName = "phone" | "log";

// The bench's own look, for its dev bar and its Players panel: flat, in deep violets none of Zaisma's pages use, so nothing of the bench reads
// as part of what a player sees. It's the bench's, not a page of zaisma.com's, so it has its own few styles here. The playing styles lay out
// the body as the game page's: the strip, then the stage below it (the panel, when it's open, beside the player's page).
const BENCH_STYLE = `html.is-playing body { flex-direction: column; }
.bench-bar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 30px; padding: 0 8px; padding-top: env(safe-area-inset-top, 0); background: #26215c; color: #cecbf6; font: 500 13px/1 Jost, system-ui, sans-serif; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
.bench-bar::-webkit-scrollbar { display: none; }
.bench-bar .bench-name { padding-right: 6px; color: #afa9ec; }
.bench-bar .bench-fill { flex: 1; }
.bench-bar .bench-tool { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
.bench-bar .bench-tool:hover, .bench-bar .bench-tool:focus-visible, .bench-bar .bench-tool[aria-pressed="true"] { background: #3c3489; color: #eeedfe; outline: none; }
.bench-bar .bench-tool.bench-player { background: #3c3489; color: #eeedfe; }
.bench-bar svg { width: 15px; height: 15px; flex: none; }
.bench-menu { position: fixed; z-index: 6; top: 32px; width: 270px; max-height: calc(100vh - 44px); overflow-y: auto; padding: 6px; border-radius: 8px; background: #26215c; color: #cecbf6; border: 1px solid #534ab7; box-shadow: 0 8px 24px rgb(0 0 0 / 40%); font: 400 13px/1.35 Jost, system-ui, sans-serif; }
.bench-menu[hidden] { display: none; }
.bench-menu svg { width: 15px; height: 15px; flex: none; vertical-align: -3px; }
.bm-head { margin: 4px 8px 6px; display: grid; gap: 2px; }
.bm-head b { font-weight: 500; color: #eeedfe; }
.bm-head span, .bm-note, .bm-url { font-size: 11px; color: #afa9ec; }
.bm-item { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 6px 8px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
.bm-item > span:first-of-type { flex: 1; }
.bm-item:hover, .bm-item:focus-visible { background: #3c3489; color: #eeedfe; outline: none; }
.bm-item.is-current { background: #3c3489; color: #eeedfe; }
.bm-tag { font-size: 10px; border-radius: 5px; padding: 1px 6px; background: #afa9ec; color: #26215c; }
.bm-rule { border: 0; border-top: 1px solid #3c3489; margin: 6px 4px; }
.bm-label { margin: 4px 8px; color: #eeedfe; }
.bm-note { margin: 4px 8px; }
.bm-qr { display: block; margin: 6px auto; background: #fff; padding: 6px; border-radius: 6px; }
.bm-url { margin: 0 8px 6px; text-align: center; word-break: break-all; }
.bm-warn { margin: 6px 8px; font-size: 11px; color: #fac775; }
.bm-log { margin: 0; padding: 0 8px 4px 24px; display: grid; gap: 4px; font-size: 12px; }
.bench-stage { flex: 1; display: flex; min-height: 0; position: relative; }
.bench-panel { flex: none; width: 290px; display: flex; flex-direction: column; overflow-y: auto; background: #1c1840; color: #cecbf6; border-right: 1px solid #3c3489; font: 400 13px/1.35 Jost, system-ui, sans-serif; }
.bench-panel[hidden] { display: none; }
.bench-panel.is-page { width: auto; max-width: 420px; margin: 0 auto; min-height: 100vh; border-left: 1px solid #3c3489; }
.bench-panel button, .bench-panel input, .bench-panel select { font: inherit; color: inherit; }
.bp-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #2f2a66; }
.bp-head b { flex: 1; font-weight: 500; color: #eeedfe; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-btn, .bp-ghost, .bp-link { border-radius: 6px; padding: 3px 8px; cursor: pointer; white-space: nowrap; font-size: 12px; }
.bp-btn { border: 0; background: #534ab7; color: #eeedfe; }
.bp-ghost { border: 1px solid #534ab7; background: none; }
.bp-link { border: 0; background: none; color: #afa9ec; }
.bp-btn:hover, .bp-ghost:hover, .bp-link:hover { background: #3c3489; color: #eeedfe; }
.bp-search, .bp-input, .bp-select { width: 100%; box-sizing: border-box; border: 0; border-radius: 6px; padding: 5px 8px; background: #26215c; color: #eeedfe; }
.bp-search { margin: 8px 10px; width: calc(100% - 20px); }
.bp-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid #26215c; }
.bp-row.is-current { background: #26215c; }
.bp-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; }
.bp-face { width: 22px; height: 22px; flex: none; border-radius: 50%; background: #534ab7; color: #eeedfe; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 500; }
.bp-who { min-width: 0; }
.bp-who b { display: block; font-weight: 500; color: #eeedfe; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-meta { font-size: 11px; color: #afa9ec; }
.bp-tag { font-size: 10px; border-radius: 5px; padding: 1px 6px; background: #afa9ec; color: #26215c; white-space: nowrap; }
.bp-tabs { display: flex; gap: 4px; padding: 6px 10px; border-bottom: 1px solid #2f2a66; }
.bp-tabs button { border: 0; background: none; border-radius: 6px; padding: 3px 9px; color: #afa9ec; cursor: pointer; }
.bp-tabs button[aria-current="page"] { background: #3c3489; color: #eeedfe; }
.bp-section { padding: 8px 10px; display: grid; gap: 6px; }
.bp-section h3 { margin: 4px 0 0; font-size: 11px; font-weight: 500; color: #7f77dd; }
.bp-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.bp-line { display: flex; align-items: center; gap: 6px; }
.bp-line > :first-child { flex: 1; min-width: 0; }
.bp-note { font-size: 11px; color: #afa9ec; }
.bp-error { font-size: 12px; color: #f5c4b3; }
.bp-item { padding: 6px 10px; border-top: 1px solid #26215c; display: grid; gap: 3px; }
.bp-purchase { padding-left: 10px; border-left: 2px solid #3c3489; }
.bp-foot { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-top: 1px solid #2f2a66; margin-top: auto; }
.bp-foot span { flex: 1; font-size: 11px; color: #afa9ec; }
.bp-empty { padding: 12px 10px; color: #afa9ec; }
@media (max-width: 600px) {
  .bench-bar .bench-name, .bench-bar .bench-tool:not(.bench-player) .bench-words { display: none; }
  .bench-stage > .bench-panel:not(.is-page) { position: absolute; inset: 0; width: auto; z-index: 3; }
}`;

const devTool = (label: string, iconName: IconName | null, target: { id: string; menu?: string; isToggle?: boolean; className?: string }): Raw =>
  html`<button class="bench-tool${target.className ? ` ${target.className}` : ""}" id="${target.id}" type="button"${target.menu ? html` data-bench-menu="${target.menu}" aria-haspopup="true" aria-expanded="false"` : ""}${target.isToggle ? raw(' aria-pressed="false"') : ""} aria-label="${label}">${iconName ? icon(iconName) : ""}<span class="bench-words">${label}</span>${target.menu && !iconName ? icon("chevron-down") : ""}</button>`;

/** How many of the bench's players the player menu lists; the rest are in the Players panel. */
const PLAYER_MENU_COUNT = 8;

/** One of the dev bar's menus, in the bench's look: hidden until its button opens it, under that button. */
const benchMenu = (id: string, label: string, body: Raw) => html`<div class="bench-menu" id="${id}" role="menu" aria-label="${label}" hidden>${body}</div>`;

/** The dev page: the bench's bar above the stage, which holds the Players panel (when it's open) and the player's page, which frames the game. */
export async function devPage(places: BenchPlaces, view: DevView, frame: { path: string; allow: string }): Promise<BenchPage> {
  const who = `Player ${view.playerNumber}${view.accountName ? `, ${view.accountName}` : ", a guest"}`;
  const bar = html`<div class="bench-bar" role="toolbar" aria-label="Test bench">
<span class="bench-name">Test bench</span>
${devTool(who, null, { id: "bench-who", menu: "bench-who-menu", className: "bench-player" })}
<span class="bench-fill"></span>
${devTool("Players", "people", { id: "bench-players-open", isToggle: true })}
${devTool("Add a player", "plus", { id: "bench-add", menu: "bench-add-menu" })}
${devTool(view.logLines.length ? `Log ${view.logLines.length}` : "Log", "info", { id: "bench-log-open", menu: "bench-log-menu" })}
</div>`;
  // Who this tab plays as: another of the bench's players, all of them in the Players panel, or a new guest. The game starts again.
  const whoMenu = benchMenu("bench-who-menu", who, html`<p class="bm-head"><b>Player ${String(view.playerNumber)}</b><span>Who this tab plays as. The game starts again as them.</span></p>
${view.players.slice(0, PLAYER_MENU_COUNT).map((player) => html`<button class="bm-item${player.isThisTab ? " is-current" : ""}" type="button" role="menuitem" data-bench-play-as="${player.playerId}">${icon("person")}<span>${player.name}</span>${player.isThisTab ? html`<span class="bm-tag">this tab</span>` : ""}</button>`)}
${view.players.length ? html`<hr class="bm-rule">` : ""}
<button class="bm-item" type="button" role="menuitem" data-bench-panel="open">${icon("people")}<span>${view.players.length ? "All players" : "Make a player"}</span></button>
${view.accountName ? html`<button class="bm-item" type="button" role="menuitem" data-bench-play-as="guest">${icon("sign-out")}<span>Sign out, as a new guest</span></button>` : ""}`);
  // A new player, into the room this player is in: in a tab of this browser, or on a phone from the QR code drawn as the menu opens.
  const addMenu = benchMenu("bench-add-menu", "Add a player", html`<p class="bm-head"><b>Add a player</b><span>A new guest, in the room you're in.</span></p>
<a class="bm-item" id="bench-add-tab" role="menuitem" href="${view.roomCode ? `/?room=${view.roomCode}` : "/"}" target="_blank" rel="noopener">${icon("plus")}<span>In a new tab</span>${icon("out-of-page")}</a>
<hr class="bm-rule">
<div id="bench-phone-body">${raw(devSheetBody("phone", view))}</div>`);
  const logMenu = benchMenu("bench-log-menu", "Log", html`<p class="bm-head"><b>Log</b><span>What the bench and your game server said, newest last.</span></p><div id="bench-log-body">${raw(devSheetBody("log", view))}</div>`);
  // The strip and its menus first, then the stage: the playing styles show those alone.
  const body = html`<style>${raw(BENCH_STYLE)}</style>
${bar}
${whoMenu}
${addMenu}
${logMenu}
<div class="bench-stage"><aside class="bench-panel" id="bench-panel" aria-label="Players" hidden></aside>
<iframe class="game-frame" id="bench-player" src="${frame.path}" title="${who}: the game page on Zaisma" allow="${frame.allow}" allowfullscreen></iframe></div>
<script src="/bench/dev.js?player=${String(view.playerNumber)}" defer></script>`;
  const page = await pageOf(layout(benchEnv(places), { title: `${who}: test bench for ${view.gameSlug}`, checkedPage: "Game page", isBare: true, frames: ["'self'"], body }));
  return { ...page, body: page.body.replace('<html lang="en"', '<html lang="en" class="is-playing"') };
}

/** What a dev bar menu shows that changes while the bench runs: the phone's QR code for the room, or the log. Drawn afresh as it opens. */
export function devSheetBody(name: DevSheetName, view: DevView): string {
  if (name === "phone") {
    if (!view.networkUrl) return String(html`<p class="bm-note">${icon("phone")} On a phone: start the bench again with --on-network, and the QR code for a phone on the same Wi-Fi shows here.</p>`);
    const target = view.roomCode ? `${view.networkUrl}/?room=${view.roomCode}` : `${view.networkUrl}/`;
    return String(html`<p class="bm-label">${icon("phone")} On a phone, on the same Wi-Fi</p>
<img class="bm-qr" src="/bench/qr.svg?text=${encodeURIComponent(target)}" alt="A QR code for ${target}" width="150" height="150">
<p class="bm-url">${target}</p>
<p class="bm-warn">${icon("warning")} Your phone will say the connection isn't private, because the bench signs its own certificate. Continue to the site.</p>`);
  }
  if (!view.logLines.length) return String(html`<p class="bm-note">Nothing yet.</p>`);
  return String(html`<ol class="bm-log">${view.logLines.map((line) => html`<li>${line}</li>`)}</ol>`);
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

/** One of the bench's players, as the Players panel shows them. */
export interface PanelPlayer {
  playerId: string;
  name: string;
  ageBand: AgeBand;
  socialMode: SocialMode;
  /** The players (tab numbers) open as them now. */
  openPlayerNumbers: number[];
}

/** Whose panel it is: the player (tab) it plays for, and whether it's a page of its own (a sign-in the game page opened). */
export interface PanelPlace {
  playerNumber: number;
  isPage: boolean;
}

const face = (name: string) => html`<span class="bp-face" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>`;
const describe = (player: PanelPlayer) => `${AGE_BAND_WORDS[player.ageBand]} · ${SOCIAL_MODE_LABELS[player.socialMode]}`;
const call = (method: string, path: string, body: Record<string, unknown> = {}) => html` data-bench-call="${method} ${path}" data-bench-body="${JSON.stringify(body)}"`;
const playerPath = (playerId: string) => `/bench/api/players/${encodeURIComponent(playerId)}`;
const ageSelect = (ageBand: AgeBand, attributes: Raw | "" = "") =>
  html`<select class="bp-select" name="age_band" aria-label="Age"${attributes}>${AGE_BANDS.map((each) => html`<option value="${each}"${each === ageBand ? raw(" selected") : ""}>${AGE_BAND_WORDS[each]}</option>`)}</select>`;
const socialSelect = (socialMode: SocialMode, attributes: Raw | "" = "") =>
  html`<select class="bp-select" name="social_mode" aria-label="How they play"${attributes}>${SOCIAL_MODES.map((each) => html`<option value="${each}"${each === socialMode ? raw(" selected") : ""}>${SOCIAL_MODE_LABELS[each]}</option>`)}</select>`;

/** The Players panel's list: every player made on this computer, to play as, open, or make; and playing as a guest. */
export function playersPanelHtml(place: PanelPlace, input: { players: PanelPlayer[]; currentPlayerId: string | null; searchText: string; totalCount: number }): string {
  const rows = input.players.map((player) => {
    const isCurrent = player.playerId === input.currentPlayerId;
    const elsewhere = player.openPlayerNumbers.filter((openNumber) => openNumber !== place.playerNumber);
    return html`<div class="bp-row${isCurrent ? " is-current" : ""}"><button class="bp-open" type="button" data-bench-view="player" data-player-id="${player.playerId}">${face(player.name)}<span class="bp-who"><b>${player.name}</b><span class="bp-meta">${describe(player)}</span></span></button>${
      isCurrent ? html`<span class="bp-tag">this tab</span>` : html`${elsewhere.length ? html`<span class="bp-tag">player ${elsewhere[0]}</span>` : ""}<button class="bp-ghost" type="button" data-bench-play-as="${player.playerId}">Play as</button>`
    }</div>`;
  });
  return String(html`<div class="bp-head"><b>Players</b><button class="bp-btn" type="button"${call("POST", "/bench/api/players")}>+ Quick</button><button class="bp-ghost" type="button" data-bench-view="new">New</button>${place.isPage ? "" : html`<button class="bp-link" type="button" data-bench-panel="close" aria-label="Close the panel">✕</button>`}</div>
<input class="bp-search" type="search" placeholder="Find a player" aria-label="Find a player" value="${input.searchText}" data-bench-search>
${rows.length ? rows : html`<p class="bp-empty">${input.searchText ? "No one by that name." : "No players yet. + Quick makes one with the next name and the defaults."}</p>`}
<div class="bp-foot"><span>${input.totalCount === 1 ? "1 player" : `${input.totalCount} players`} on this computer</span><button class="bp-ghost" type="button" data-bench-play-as="guest">Play as a guest</button></div>`);
}

/** The Players panel's New player: a name, an age band and a social mode. */
export function newPlayerPanelHtml(input: { suggestedName: string }): string {
  return String(html`<div class="bp-head"><button class="bp-link" type="button" data-bench-view="list" aria-label="Back to players">‹</button><b>New player</b></div>
<div class="bp-section" data-bench-form><input class="bp-input" name="name" value="${input.suggestedName}" maxlength="20" aria-label="Name">
<div class="bp-pair">${ageSelect("18+")}${socialSelect(startingSocialMode("18+"))}</div>
<p class="bp-note">Zaisma's own age and social rules: 13–15 is never open and social.</p>
<p class="bp-error" data-bench-error hidden></p>
<button class="bp-btn" type="button" data-bench-make>Make player</button></div>`);
}

export type PanelTab = "profile" | "items";

/** One of a player's purchases of an item, newest first. */
export interface PanelPurchase {
  purchaseId: string;
  /** "Test card × 3", "Granted"; the date and whether the game has handled it. */
  detail: string;
  isRefunded: boolean;
}

/** One of the game's items, as a player's Items tab lists it: whether they own it, and their purchases of it. */
export interface PanelItem {
  itemName: string;
  title: string;
  itemKind: string;
  priceText: string;
  isOwned: boolean;
  purchases: PanelPurchase[];
}

/** One player in the Players panel: their profile, friends and blocks; the game's items, with their purchases of each. Every change saves at once. */
export function playerPanelHtml(
  place: PanelPlace,
  input: {
    player: PanelPlayer;
    isCurrent: boolean;
    tab: PanelTab;
    friends: { playerId: string; name: string }[];
    blocked: { playerId: string; name: string }[];
    blockedBy: string[];
    others: { playerId: string; name: string }[];
    items: PanelItem[];
    searchText: string;
  },
): string {
  const { player } = input;
  const here = playerPath(player.playerId);
  const tabButton = (tab: PanelTab, label: string) => html`<button type="button" data-bench-tab="${tab}"${tab === input.tab ? raw(' aria-current="page"') : ""}>${label}</button>`;
  const pick = (list: { playerId: string; name: string }[], label: string, kind: "friends" | "blocks") => {
    const choices = input.others.filter((other) => !list.some((each) => each.playerId === other.playerId));
    return choices.length
      ? html`<select class="bp-select" aria-label="${label}" data-bench-add="${here}/${kind}/"><option value="">${label}</option>${choices.map((other) => html`<option value="${other.playerId}">${other.name}</option>`)}</select>`
      : "";
  };
  let section: Raw;
  if (input.tab === "profile") {
    section = html`<div class="bp-section"><input class="bp-input" name="name" value="${player.name}" maxlength="20" aria-label="Name" data-bench-field="${here}">
<div class="bp-pair">${ageSelect(player.ageBand, html` data-bench-field="${here}"`)}${socialSelect(player.socialMode, html` data-bench-field="${here}"`)}</div>
<p class="bp-error" data-bench-error hidden></p>
<h3>Friends</h3>
${input.friends.length ? input.friends.map((friend) => html`<div class="bp-line"><span>${friend.name}</span><button class="bp-link" type="button"${call("DELETE", `${here}/friends/${friend.playerId}`)}>Remove</button></div>`) : html`<p class="bp-note">No friends yet.</p>`}
${pick(input.friends, "+ Add a friend", "friends")}
<h3>Blocks</h3>
${input.blocked.length ? input.blocked.map((other) => html`<div class="bp-line"><span>${other.name}</span><button class="bp-link" type="button"${call("DELETE", `${here}/blocks/${other.playerId}`)}>Unblock</button></div>`) : html`<p class="bp-note">${player.name} hasn't blocked anyone.</p>`}
${input.blockedBy.length ? html`<p class="bp-note">Blocked by ${input.blockedBy.join(", ")}. A block holds both ways in the game's passes.</p>` : ""}
${pick(input.blocked, "+ Block a player", "blocks")}
<p class="bp-note">A change reaches the game with ${player.name}'s next pass: the next time they join a room.</p>
<div class="bp-line"><span></span><button class="bp-link" type="button" data-bench-delete="${here}" data-player-name="${player.name}">Delete ${player.name}</button></div></div>`;
  } else {
    // Each of the game's items: whether they own it, Grant or Take away, and under it their purchases of it, each with Refund.
    const purchaseLine = (purchase: PanelPurchase) =>
      html`<div class="bp-line bp-purchase"><span class="bp-meta">${purchase.detail}</span>${purchase.isRefunded ? "" : html`<button class="bp-link" type="button"${call("POST", `${here}/purchases/${purchase.purchaseId}/refund`)}>Refund</button>`}</div>`;
    section = html`<input class="bp-search" type="search" placeholder="Find an item" aria-label="Find an item" value="${input.searchText}" data-bench-search>
${input.items.length
      ? input.items.map((gameItem) => html`<div class="bp-item"><div class="bp-line"><span class="bp-who"><b>${gameItem.title}</b><span class="bp-meta">${[gameItem.itemKind, gameItem.priceText, ...(gameItem.isOwned ? ["owned"] : [])].join(" · ")}</span></span>${
          gameItem.isOwned && gameItem.itemKind === "permanent"
            ? html`<button class="bp-ghost" type="button"${call("DELETE", `${here}/items/${gameItem.itemName}`)}>Take away</button>`
            : html`<button class="bp-ghost" type="button"${call("POST", `${here}/items`, { item_name: gameItem.itemName })}>${gameItem.itemKind === "consumable" ? "Grant 1" : "Grant"}</button>`
        }</div>${gameItem.purchases.map(purchaseLine)}</div>`)
      : html`<p class="bp-empty">${input.searchText ? "No item by that name." : "No items: they're set on Zaisma, and the bench brings them in with --game and ZAISMA_KEY."}</p>`}
<p class="bp-note" style="padding:8px 10px">A grant is a purchase the game gets as Zaisma would send it, and a refund reaches it as Zaisma's would. "Waiting for the game" is one it hasn't handled yet.</p>`;
  }
  return String(html`<div class="bp-head"><button class="bp-link" type="button" data-bench-view="list" aria-label="Back to players">‹</button>${face(player.name)}<b>${player.name}</b>${input.isCurrent ? html`<span class="bp-tag">this tab</span>` : html`<button class="bp-btn" type="button" data-bench-play-as="${player.playerId}">Play as ${player.name}</button>`}</div>
<p class="bp-note" style="padding:6px 10px 0">${describe(player)}${player.openPlayerNumbers.length ? ` · open as player ${player.openPlayerNumbers.join(", ")}` : ""}</p>
<div class="bp-tabs" role="tablist">${tabButton("profile", "Profile")}${tabButton("items", "Items")}</div>
${section}`);
}

/** The Players panel as a page of its own: where the game page's sign-in and Make an account go, in a tab it opened or its own. */
export async function panelPage(places: BenchPlaces, place: PanelPlace, panelHtml: string): Promise<BenchPage> {
  const body = html`<style>${raw(BENCH_STYLE)}body { background: #120f2e; }</style>
<aside class="bench-panel is-page" id="bench-panel" aria-label="Players" data-bench-page>${raw(panelHtml)}</aside>
<script src="/bench/dev.js?player=${String(place.playerNumber)}&page=players" defer></script>`;
  return pageOf(layout(benchEnv(places), { title: "Players: test bench", checkedPage: "A message", isBare: true, body }));
}

/** Where a sign-in ends (/account/kept): it tells the game page it's signed in, then closes or goes back to the player's game. */
export async function keptPage(places: BenchPlaces, username: string | null, playerNumber: number): Promise<BenchPage> {
  const text = username ? `You're signed in as ${username}. The game picks it up where you left it.` : "Sign in from a player's game page.";
  const body = html`<style>${raw(BENCH_STYLE)}body { background: #120f2e; }</style>
<aside class="bench-panel is-page" aria-label="Signed in"><div class="bp-head"><b>You're in</b></div><p class="bp-empty">${text}</p></aside>
<script src="/bench/kept.js?player=${String(playerNumber)}" defer></script>`;
  return pageOf(layout(benchEnv(places), { title: "Signed in: test bench", checkedPage: "A message", isBare: true, body }));
}

/** The site's stylesheet, scripts and font by the paths the page names, or null for a path that isn't one of them. */
export async function siteAsset(path: string): Promise<{ httpStatus: number; headers: Record<string, string>; body: Uint8Array } | null> {
  for (const answer of [pageScriptResponse(path), pageStyleResponse(path)]) {
    if (answer.status === 404) continue;
    return { httpStatus: answer.status, headers: Object.fromEntries(answer.headers.entries()), body: new Uint8Array(await answer.arrayBuffer()) };
  }
  return null;
}
