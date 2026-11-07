import type { SteelPageName } from "./steel-pages.ts";
import { NO_EMPTY_NOTE } from "./markup.ts";
import { PICTURE_COLUMNS_SQL, shownPictureOf, type PictureRow } from "./placeholders.ts";
import { viewerDeviceKind } from "./device-kind.ts";
import { RENTED_SHARE_VPN_TEXT,
  readReviewReason,
  ALLOWED_CONTENT,
  CREDIT_LIMITS,
  PRO_PRICE_CENTS_PER_MONTH,
  PRO_REFUND_LIMITS,
  ALLOWED_CONTENT_TITLES,
  NOTICE_ONLY_CONTENT_RULES,
  fullGameOwner,
  itemsOf,
  ownedItemNames,
  priceFor,
  priceText,
  purchaseLabelFor,
  purchaseSettingsOf,
  refundPolicyWords,
  type PurchaseLabel,
  canOpenLink,
  standingOf,
  CONTENT_RULES,
  CONTENT_RULE_DETAILS,
  countryName,
  createAccessGrant,
  describePlayModes,
  gameAddress,
  gameBySlug,
  isBlockedInCountry,
  isOldEnoughFor,
  isOwnServerUrl,
  isTesterLinkOn,
  linksOf,
  ownServerUrlsOf,
  readPlayModes,
  requestCountryCode,
  ROOM_ORDERS,
  SHOWN_IN_LISTS_SQL,
  testerLinkByToken,
  PERFORMANCE_CHECK_LIMITS,
  testerLinkOpened,
  testerLinkVersion,
  testerLinkWaitingVersion,
  isAiReviewDone,
  versionById,
  type ContentRule,
  type DeviceKind,
  type Game,
  type GameItem,
  type RoomPage,
  type TesterLink,
  GENRE_LABELS,
  type Genre,
} from "@zaisma/core";
import { authConfigured } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { action, secondaryButton, primaryButton, tertiaryButton, textLink } from "./components/actions.ts";
import { copyField } from "./components/inputs.ts";
import { cutField } from "./components/fields.ts";
import { details, keyDetails, listRows, type ListRow, stateNote } from "./components/data.ts";
import { ago, glassPane, icon, tag, type IconName } from "./components/foundations.ts";
import { columns, grid, row, stack, track, type GridItem, type LayoutItem, stackOfOne } from "./components/layout.ts";
import { gameRow } from "./components/navigation.ts";
import { tabSwitch } from "./components/switch.ts";
import { banner, dropdown, gameCard, notice, sheet } from "./components/panes.ts";
import { person } from "./components/people.ts";
import { playingCheck, zaismaButton, zaismaOverlay } from "./components/playing.ts";
import { gameMedia } from "./components/game-media.ts";
import { readingText } from "./components/reading.ts";
import { backgroundMarkup, backgroundOf, type ShownBackground } from "./backgrounds.ts";
import { glassMessage, html, layout, pageData, raw, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { coverPriceText, paidGamesOwnedBy, shelfCounts, showcase, type ShowGame } from "./home.ts";
import { KEEP_PLAYED_COOKIE_SOURCE } from "./home-script.ts";
import { viewerOf, type Viewer } from "./viewer.ts";
import { SAVES_SCRIPT } from "./saves-client.ts";
import { reportScript, reportSheet, reportStep } from "./report.ts";
import { blockSheetParts } from "./blocks.ts";
import { playingPeople } from "./players-sheet.ts";
import { ZAISMA_OVERLAY_SCRIPT, gameOverlay, keepProgressCard, rentedShareCard, roomCodeItems, signInAskCard, signedOutCard } from "./zaisma-overlay.ts";
import { friendRequestParts } from "./friend-requests.ts";
import { GAME_UPDATES_SCRIPT, updateButton } from "./game-updates.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, PLAY_COUNTER_SCRIPT, ageRefusal, playingNowCounts } from "./plays.ts";
import { profilePath } from "./profiles.ts";
import { MAXIMUM_REFRESHED_ROOM_COUNT, ROOM_CODE_TYPING, codeBox, pageRooms, readRoomPick, roomsChoices, roomsOnPage, roomsPanel, tabCount } from "./rooms.ts";
import { checkPreviewLinkToken, readPreviewLinkToken } from "./preview-links.ts";
import { GAME_LINKS_SCRIPT, developerLinks, leavingCard } from "./game-links.ts";
import { BUY_SHEET_SCRIPT, buySheetParts, buySheetData, buySheetStripe } from "./buy-sheet.ts";
import { PASSKEY_SCRIPT } from "./passkeys.ts";
import { STILL_THERE_SCRIPT, stillThereCard } from "./still-there.ts";
import { gamePageHead, shareDialog } from "./share-cards.ts";
import { DISCLOSURE_WAIT_DAYS, FIX_WITHIN_DAYS, REPLY_WITHIN_DAYS, SECURITY_ADVISORY_URL, SECURITY_REPORT_EMAIL, SECURITY_TEXT_FILE_PATH, securityPromisesSection } from "./security-policy.ts";
import { PUBLISHED_PROMISES } from "./security-promises.ts";

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * A game's page, or the same page opened through a tester link (zaisma.com/t/<token>), which plays
 * the version the link opens whatever the game's visibility, at the game's fixed tester address.
 * Testers' progress stays in their browser.
 */
/** "&server=…" for a room link's server when it's one of the game's own servers (by host, wss:// or https://), else nothing. */
function ownServerParameter(given: string | null, ownServerUrls: string[]): string {
  if (!given || given.length > 200 || !isOwnServerUrl(given, ownServerUrls)) return "";
  return `&server=${encodeURIComponent(given.replace(/\/+$/, ""))}`;
}

/** How a game is played and where, as the facts' icons. */
/** A developer's text as written: a paragraph at each blank line, a line break at each single one. */
const paragraphs = (text: string): Raw =>
  html`${text.trim().split(/\n{2,}/).map((paragraph) => html`<p>${paragraph.split("\n").map((line, lineIndex) => html`${lineIndex ? raw("<br>") : ""}${line}`)}</p>`)}`;

const MODE_ICON_NAMES: Record<"single" | "local" | "online", IconName> = { single: "person", local: "people", online: "globe" };
const DEVICE_ICON_NAMES: Record<string, IconName> = { phone: "phone", tablet: "tablet", computer: "computer" };
const DEVICE_LABELS: Record<string, string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };
/** Phones get the background made for a phone's screen; the rest, the wide one. */
const isPhoneRequest = (request: Request) => /iPhone|iPod|Android.*Mobile|Mobi/.test(request.headers.get("user-agent") ?? "");

/** The game's own servers in the ⋯ menu, in neutral words: "Online play runs on the developer's own server: play.example.com". */
const ownServersLine = (hosts: string[]) => `Online play runs on the developer's own ${hosts.length === 1 ? "server" : "servers"}: ${hosts.join(", ")}`;

const PURCHASE_CATEGORY_WORDS: Record<PurchaseLabel["categories"][number], string> = { cosmetic: "cosmetic items", gameplay: "items that help you play", content: "more of the game", currency: "in-game currency" };

/** A game page's purchase label: what the game sells through Zaisma and its own payments, and that some goes past Zaisma. */
function purchaseWords(purchaseLabel: PurchaseLabel): string {
  if (!purchaseLabel.categories.length) return "No in-game purchases";
  const sold = purchaseLabel.categories.map((category) => PURCHASE_CATEGORY_WORDS[category]).join(", ");
  return `${sold.charAt(0).toUpperCase()}${sold.slice(1)}${purchaseLabel.has_own_payments ? "; some handled by the developer, not Zaisma" : ""}`;
}

/** What a game page shows: read from D1 by gamePage, or given by a stand-in for zaisma.com (the game server package's test bench). */
export interface GamePageView {
  game: Game;
  /** The page's address, for ?room=, ?server=, ?watch=1 and ?play. */
  pageUrl: URL;
  tester: TesterLink | null;
  /** The version a tester link opens, or null without one. */
  testerVersionId: string | null;
  viewer: Viewer;
  developer: { name: string; game_count: number } | null;
  pictures: (PictureRow & { kind: string })[];
  updates: { id: string; patch_notes: string; first_published_at_ms: number }[];
  /** The developer's other listed games, for More from <developer>: up to GAME_PAGE_ROW_GAME_COUNT. */
  developerGames: ShowGame[];
  /** Other developers' listed games of the same kind, most played this week first: More like this, up to GAME_PAGE_ROW_GAME_COUNT. */
  likeGames: ShowGame[];
  /** The game's live rooms on Zaisma, or null when it has none to count or list. */
  liveRooms: RoomPage | null;
  /** Checked browsers with the game on screen (playingNowCounts). */
  checkedPlayerCount: number;
  /** Whether the version this page plays needs threads (ScanReport.has_threads). */
  hasThreads: boolean;
  /** The viewer's kind of device as the server guesses it (device-kind.ts), and whether the browser's name says it's Chromium 137 or later
   * off an iPhone or iPad (a game with threads plays only there): the device note's first guess, which the page's script corrects. */
  deviceKind: DeviceKind;
  canIsolateFrame: boolean;
  purchaseLabel: PurchaseLabel;
  background: ShownBackground;
  /** What chat apps, social sites and search engines read; none for tester links, which are secret. */
  head: Raw | undefined;
  /** The request is a same-site frame of the page: the home playing a game in place. */
  isFramedBySelf: boolean;
  /** Listed, and kept on lists by the listing check, so search engines may index it. */
  isShownInLists: boolean;
  /** Whether the developer's standing opens search engines; a listed game stays out of them until it does (standing.ts). */
  searchEnginesEnabled: boolean;
  /** Whether the developer's standing opens its links to other sites for signed-in adults. */
  outsideLinksEnabled: boolean;
  /** The viewer plays it: it's free to play, or they own it (fullGameOwner), made it, or came by a tester link. */
  isFullGameOwner: boolean;
  /** The game's items, for a paid game's Buy and the page's Add-ons; [] for a page that sells nothing. */
  items: GameItem[];
  /** The permanent items the viewer owns in it. */
  ownedItemNames: string[];
  /** Where the viewer is (CF-IPCountry), for the prices they pay; null when unknown. */
  countryCode: string | null;
  /** A paid game's free demo, still there for players; null for none. */
  demoGameSlug: string | null;
  /** On a demo's page, the paid game that names it; null for none. */
  fullGameSlug: string | null;
  /** Of the other games on the page, the paid ones the viewer owns, so their covers carry no price. */
  ownedPaidGameIds: ReadonlySet<string>;
  /** When a signed-in viewer last played the game, or null; a guest's comes from this device's list, by the page's script. */
  lastPlayedAtMs: number | null;
}

// A game for older players (docs/DECISIONS.md, "Games can keep out younger age bands"): a younger account
// sees its details, closed, and nothing on the page says an age.
const isClosedTo = (viewer: Viewer, game: Game) => Boolean(viewer.account && !isOldEnoughFor(viewer.account.age_band, game.minimum_player_age_years));

/** A paid game the viewer doesn't own: Buy where Play is, and nothing plays. */
const isForSaleTo = (game: Game, isFullGameOwner: boolean, isClosed: boolean) => game.full_game_item_name !== null && !isFullGameOwner && !isClosed;

/** The room a room link (zaisma.com/g/<slug>?room=CODE) drops the player straight into, or "" for none. */
function roomCodeOf(url: URL, isClosed: boolean): string {
  const code = url.searchParams.get("room")?.toUpperCase() ?? "";
  return ROOM_CODE.test(code) && !isClosed ? code : "";
}

export async function gamePage(env: Env, slug: string, request: Request, tester?: TesterLink): Promise<Response> {
  const url = new URL(request.url);
  const game = await gameBySlug(env.DB, slug);
  if (!game || (!tester && game.review_status === "pending")) return glassMessage(env, "Game not found", "Check the link and try again.", 404);
  const viewer = await viewerOf(request, env);
  // A paid game (docs/DECISIONS.md, "How paid games work") plays for whoever owns it, its developer and tester links; bought means
  // kept, so its page still opens for an owner after the developer hides it.
  const isFullGameOwner = tester ? true : await fullGameOwner(env.DB, game, viewer.account);
  const isHidden = game.visibility === "draft" || game.visibility === "private";
  if (!tester && isHidden && !(game.full_game_item_name !== null && isFullGameOwner && game.live_version_id)) return glassMessage(env, "Game not found", "Check the link and try again.", 404);
  if (game.review_status === "removed") return readReviewReason(game.review_reason)?.code === "developer_deleted_game" ? glassMessage(env, "This game was deleted", "Its developer deleted it.", 410) : glassMessage(env, "This game was removed", "It broke Zaisma's content rules or was taken down on request.", 410);
  if (game.review_status === "held") return glassMessage(env, "This game is being reviewed", "Someone reported it and we're taking a look. Try again later.", 404);
  // Blocked in the player's country on a notice under its law, and only there (country-blocks.ts).
  const countryCode = requestCountryCode(request);
  if (isBlockedInCountry(game, countryCode)) return glassMessage(env, "This game isn't available in your country", `A legal notice under your country's law (${countryName(countryCode!)}) blocks it here. It's still available everywhere else.`, 451);
  const testerVersion = tester ? await testerLinkVersion(env.DB, game, tester) : null;
  if (tester && !testerVersion && (await testerLinkWaitingVersion(env.DB, game, tester))) return glassMessage(env, "This game is being reviewed", "This link opens once its AI review passes. Try it again later.", 404);
  if (tester && !testerVersion) return glassMessage(env, "Nothing to play yet", "The version this link opens isn't there yet: the developer hasn't published one, or it was deleted. Try the link again later.", 404);
  const isClosed = isClosedTo(viewer, game);
  const isForSale = isForSaleTo(game, isFullGameOwner, isClosed);
  const code = roomCodeOf(url, isClosed || isForSale);
  const playedVersionId = testerVersion?.id ?? game.live_version_id;
  const [developer, pictures, updates, otherGames, liveRooms, playingNow, playedVersion, purchaseLabel, background, shownInLists, items, ownedNames, demo, fullGame, standing, lastPlayed] = await Promise.all([
    game.owner_id
      ? env.DB.prepare("SELECT accounts.username AS name, (SELECT COUNT(*) FROM games WHERE owner_id = ? AND review_status = 'live' AND visibility = 'listed') AS game_count FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(game.owner_id, game.owner_id).first<{ name: string; game_count: number }>()
      : null,
    // The square cover is only for phones' game cards, not one of the game's pictures.
    env.DB.prepare(`SELECT ${PICTURE_COLUMNS_SQL}, kind FROM game_images WHERE game_id = ? AND review_status = 'approved' AND kind IN ('cover', 'screenshot') ORDER BY kind = 'cover' DESC, created_at_ms`).bind(game.id).all<PictureRow & { kind: string }>(),
    // Quiet patches and big updates alike, each under the day it first went live: a rollback moves neither.
    env.DB.prepare("SELECT id, patch_notes, first_published_at_ms FROM versions WHERE game_id = ? AND first_published_at_ms IS NOT NULL AND patch_notes != '' ORDER BY first_published_at_ms DESC LIMIT 10").bind(game.id).all<{ id: string; patch_notes: string; first_published_at_ms: number }>(),
    // The viewer's age picks More from the developer and More like this.
    showcase(env, viewer.ageFloorYears, 200, countryCode),
    // Games on Zaisma rooms: who's playing now, and the rooms to list if the developer shows them here.
    // Not on tester links: their rooms are reached by code and invite link.
    game.multiplayer_mode !== "none" && !tester && !isClosed ? pageRooms(env, game, request, readRoomPick(url.searchParams)) : null,
    playingNowCounts(env),
    // Whether the version this page plays needs threads (ScanReport.has_threads), without reading the whole report.
    playedVersionId ? env.DB.prepare("SELECT json_extract(scan_report, '$.has_threads') = 1 AS has_threads FROM versions WHERE id = ?").bind(playedVersionId).first<{ has_threads: number | null }>() : null,
    purchaseLabelFor(env.DB, game),
    backgroundOf(env, game, isPhoneRequest(request) ? "phone" : "wide"),
    // Unlisted games are for people with the link, never search engines; so are games the listing check keeps off lists ("No slop").
    game.visibility === "listed" && !tester ? env.DB.prepare(`SELECT 1 AS shown FROM games WHERE id = ? AND ${SHOWN_IN_LISTS_SQL}`).bind(game.id).first() : null,
    // What the page sells: the full game, and the add-ons the developer picked (is_on_game_page), with what the viewer owns of them.
    isClosed ? ([] as GameItem[]) : itemsOf(env.DB, game.id),
    viewer.account && !isClosed ? ownedItemNames(env.DB, game.id, viewer.account.player_id) : ([] as string[]),
    // A paid game's free demo, still there for players; and, on a demo's own page, the paid game that names it.
    isForSale && game.demo_game_id
      ? env.DB.prepare("SELECT slug FROM games WHERE id = ? AND owner_id IS ? AND full_game_item_name IS NULL AND review_status = 'live' AND live_version_id IS NOT NULL AND visibility IN ('listed', 'unlisted')").bind(game.demo_game_id, game.owner_id).first<{ slug: string }>()
      : null,
    game.full_game_item_name === null && game.owner_id
      ? env.DB.prepare("SELECT slug FROM games WHERE demo_game_id = ? AND owner_id = ? AND full_game_item_name IS NOT NULL AND review_status = 'live' AND live_version_id IS NOT NULL AND visibility IN ('listed', 'unlisted') ORDER BY slug LIMIT 1").bind(game.id, game.owner_id).first<{ slug: string }>()
      : null,
    // What the developer's standing opens: links to other sites, and search engines (standing.ts).
    standingOf(env.DB, game.owner_id, Date.now()),
    // A returning player's own first: when they last played it.
    viewer.account && !tester ? env.DB.prepare("SELECT played_at_ms FROM played WHERE account_id = ? AND game_id = ?").bind(viewer.account.id, game.id).first<{ played_at_ms: number }>() : null,
  ]);
  const { developerGames, likeGames } = gamePageRows(game, otherGames, await shelfCounts(env, viewer.ageFloorYears));
  const ownedPaidGameIds = await paidGamesOwnedBy(env, viewer.account, [...developerGames, ...likeGames]);
  const response = gamePageResponse(env, {
    game,
    pageUrl: url,
    tester: tester ?? null,
    testerVersionId: testerVersion?.id ?? null,
    viewer,
    developer,
    pictures: pictures.results,
    updates: updates.results,
    developerGames,
    likeGames,
    liveRooms,
    checkedPlayerCount: playingNow.get(game.id) ?? 0,
    hasThreads: playedVersion?.has_threads === 1,
    deviceKind: viewerDeviceKind(request),
    canIsolateFrame: Number(/Chrome\/(\d+)/.exec(request.headers.get("user-agent") ?? "")?.[1] ?? 0) >= 137 && !/iPhone|iPad/.test(request.headers.get("user-agent") ?? ""),
    purchaseLabel,
    background,
    head: tester ? undefined : await gamePageHead(env, game, { roomCode: code || null, developerName: developer?.name ?? null }),
    // The home opens the game page in a frame to play in place; only such a request (a same-site frame) may do it, every other still refuses framing.
    isFramedBySelf: request.headers.get("sec-fetch-dest") === "iframe" && request.headers.get("sec-fetch-site") === "same-origin",
    isShownInLists: Boolean(shownInLists),
    searchEnginesEnabled: standing.searchEnginesEnabled,
    outsideLinksEnabled: standing.outsideLinksEnabled,
    isFullGameOwner,
    items,
    ownedItemNames: ownedNames,
    countryCode,
    demoGameSlug: demo?.slug ?? null,
    fullGameSlug: fullGame?.slug ?? null,
    ownedPaidGameIds,
    lastPlayedAtMs: lastPlayed?.played_at_ms ?? null,
  });
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/**
 * The Rooms tab: the order and the game's options beside the region and the room code (on an upright phone, the code first), then the
 * list, which the page's script refreshes on its own.
 */
function roomsTabItems(slug: string, rooms: RoomPage): LayoutItem[] {
  const { choices, finding } = roomsChoices(rooms);
  const findingItems: LayoutItem[] = [...finding, { kind: "block", markup: codeBox(slug) }];
  return [
    { kind: "block", markup: choices.length ? columns({ split: "wide-first", isSideBySideWhenShort: true, isSecondFirstWhenStacked: true, columns: [stack({ items: choices }), stack({ items: findingItems })] }) : stack({ items: findingItems }) },
    { kind: "block", id: "rooms-list", markup: roomsPanel({ slug }, rooms) },
  ];
}

/** How many covers each of a game page's Game rows holds, More from <developer> and More like this. */
export const GAME_PAGE_ROW_GAME_COUNT = 4;
/** On a phone, where two covers show at once and the third peeks: the first paint stays under its size with the folds' styles. */
export const PHONE_ROW_GAME_COUNT = 3;

/**
 * A game page's two Game rows from the showcase: the developer's other games, newest first, and More like this: other developers' games
 * sharing one of its genres, most players this week first (Popular's count), then the newest. Earned, never sold, and none that the
 * shelves leave out (offShelfSlugs).
 */
export function gamePageRows(game: Pick<Game, "slug" | "owner_id" | "genres">, showcaseGames: ShowGame[], shelfCount: { counts: Map<string, { weekPlayerCount: number }>; offShelfSlugs: Set<string> }): { developerGames: ShowGame[]; likeGames: ShowGame[] } {
  const others = showcaseGames.filter((otherGame) => otherGame.slug !== game.slug);
  const isTheDevelopers = (otherGame: ShowGame) => Boolean(game.owner_id && otherGame.owner_id === game.owner_id);
  const genres = new Set(game.genres ? game.genres.split(",") : []);
  const weekPlayerCount = (otherGame: ShowGame) => shelfCount.counts.get(otherGame.slug)?.weekPlayerCount ?? 0;
  const likeGames = others
    .filter((otherGame) => !isTheDevelopers(otherGame) && !shelfCount.offShelfSlugs.has(otherGame.slug) && otherGame.genres.some((genre) => genres.has(genre)))
    .sort((first, second) => weekPlayerCount(second) - weekPlayerCount(first) || (second.first_published_at_ms ?? 0) - (first.first_published_at_ms ?? 0));
  const developerGames = others.filter((otherGame) => isTheDevelopers(otherGame) && !shelfCount.offShelfSlugs.has(otherGame.slug));
  return { developerGames: developerGames.slice(0, GAME_PAGE_ROW_GAME_COUNT), likeGames: likeGames.slice(0, GAME_PAGE_ROW_GAME_COUNT) };
}

/** A description's first sentence, for the line under a game's name: up to GAME_LINE_MAXIMUM_LETTER_COUNT letters, cut at a word. */
export const GAME_LINE_MAXIMUM_LETTER_COUNT = 120;
export function firstSentence(description: string): string {
  const firstParagraph = description.trim().split(/\n/)[0]?.trim() ?? "";
  const sentence = /^.+?[.!?](?=\s|$)/.exec(firstParagraph)?.[0] ?? firstParagraph;
  if (sentence.length <= GAME_LINE_MAXIMUM_LETTER_COUNT) return sentence;
  const cut = sentence.slice(0, GAME_LINE_MAXIMUM_LETTER_COUNT);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;:\s]+$/, "")}…`;
}

/**
 * A game page drawn from what it shows (GamePageView), with no reads of its own: zaisma.com draws it from D1, and the
 * game server package's test bench from its own stand-ins, so the bench's player page is Zaisma's own.
 */
export function gamePageResponse(env: Env, view: GamePageView): Response {
  const { game, tester, viewer } = view;
  const url = view.pageUrl;
  const here = tester ? `/t/${tester.token}` : `/g/${game.slug}`;
  const hidden = game.visibility === "draft" || game.visibility === "private";
  const isClosed = isClosedTo(viewer, game);
  const isForSale = isForSaleTo(game, view.isFullGameOwner, isClosed);
  const ownServerUrls = ownServerUrlsOf(game);
  // A paid game's room link, for someone who doesn't own it, opens the details with Buy instead.
  const code = roomCodeOf(url, isClosed || isForSale);
  const inRoom = code !== "";
  // A friend's Join into a room on the game's own servers names the server too (?server=), passed on only when it's one of them.
  // Watch beside Join says watch=1, which the game reads as Zaisma.rooms.isLinkedAsSpectator.
  const roomQuery = inRoom ? `?room=${code}${ownServerParameter(url.searchParams.get("server"), ownServerUrls)}${url.searchParams.get("watch") === "1" ? "&watch=1" : ""}` : "";
  // A tester link's game opens at the game's fixed tester address, through a grant the Play button fetches (testerEnter).
  const frameUrl = tester ? gameUrl(env, gameAddress(game.slug, "tester")) : gameUrl(env, game.slug) + roomQuery;
  const saves = Boolean(game.cloud_saves_enabled && env.SUPABASE_URL && !tester);
  // Without a new tab, making an account or signing in comes back to the game.
  const joinHere = `/join?next=${encodeURIComponent(`${here}?play`)}`;
  const signinHere = `/signin?next=${encodeURIComponent(`${here}?play`)}`;
  // A tester link on a build players don't have yet plays alone: online play would reach the live
  // version's rooms, game server and data, so it waits until test builds get their own.
  const isTestBuild = Boolean(view.testerVersionId && view.testerVersionId !== game.live_version_id);
  const multiplayer = (game.multiplayer_mode !== "none" || ownServerUrls.length > 0) && !isTestBuild;
  // Rooms on Zaisma have codes players can type into the bar to join (a room link does the same).
  const hasRoomCodes = game.multiplayer_mode !== "none" && !isTestBuild && !isClosed;
  const ownServers = ownServerUrls.map((server) => new URL(server).host);
  const autoplay = !isClosed && !isForSale && (inRoom || url.searchParams.has("play"));
  // A game that needs an account for the whole game or for multiplayer asks guests to sign in, and brings them back to the same match.
  const accountRequirement = authConfigured(env) ? game.account_requirement : "none";
  // An accounts-only game's public address opens only through the entry Play fetches (handlePlayEntry).
  const isAccountsOnly = accountRequirement === "whole_game" && !tester;
  const accountNext = encodeURIComponent(`${here}${inRoom ? roomQuery : "?play"}`);
  // A game can ask a guest to sign in while it runs (Zaisma.player.signIn).
  const canSignIn = authConfigured(env);
  const live = view.liveRooms;
  const rooms = live && roomsOnPage(game) ? live : null;
  // Checked browsers with the game on screen, and everyone in its rooms (who may have come in another way): the larger.
  const playingNowPlayerCount = Math.max(view.checkedPlayerCount, live ? live.playing.playerCount : 0);
  const shots = view.pictures.map((picture) => shownPictureOf(picture));
  // The game's own cover, across the top of the buy sheet (items have no pictures of their own); null where the developer has none yet.
  const coverPicture = view.pictures.find((picture) => picture.kind === "cover");
  const cover = coverPicture ? shownPictureOf(coverPicture) : null;
  const { developer, purchaseLabel, background } = view;
  const refundWords = refundPolicyWords(purchaseSettingsOf(game));
  const devices = game.devices ? game.devices.split(",") : [];
  const controls = game.controls ? game.controls.split(",") : [];
  const deviceNote = deviceNoteFor({ deviceKind: view.deviceKind, canIsolateFrame: view.canIsolateFrame, hasThreads: view.hasThreads, devices, controls, screenOrientation: game.screen_orientation || null });
  const playModes = readPlayModes(game.play_modes);
  const describedModes = playModes ? describePlayModes(playModes) : game.multiplayer_mode !== "none" ? [{ mode: "online" as const, label: "Online multiplayer", playerCount: null }] : [];
  const gameFacts = [
    ...(describedModes.length ? [{ label: "Players", entries: describedModes.map((playMode) => ({ text: playMode.playerCount ? `${playMode.label}, ${playMode.playerCount}` : playMode.label, icon: MODE_ICON_NAMES[playMode.mode] })) }] : []),
    ...(devices.length ? [{ label: "Works on", entries: devices.map((device) => ({ text: DEVICE_LABELS[device] ?? device, icon: DEVICE_ICON_NAMES[device] ?? ("computer" as const) })) }] : []),
    // Only a marked big update: a quiet patch, a rollback or a title change never says so.
    ...(game.big_update_at_ms ? [{ label: "Updated", text: day(game.big_update_at_ms) }] : []),
  ];
  // What the game sells, before anyone plays ("Every game that sells something states its refund policy"), under About.
  const purchaseFacts = [
    { label: "Purchases", text: purchaseWords(purchaseLabel) },
    ...(purchaseLabel.categories.length && refundWords ? [{ label: "Refunds", text: refundWords }] : []),
  ];
  const isSignedInAdult = viewer.account?.age_band === "18+";
  const pageLinks = linksOf(game).filter((link) => link.is_on_game_page && canOpenLink(link, isSignedInAdult, view.outsideLinksEnabled));
  const gameOrigin = new URL(frameUrl).origin;
  // The tester note: one short line, only what changes how they test.
  const testerWords = tester
    ? `Testing${[
        isTestBuild ? (game.multiplayer_mode !== "none" || ownServers.length ? "a new build, offline only" : "a new build") : "",
        hidden ? "anyone with this link can play" : "",
        tester.ends_at_ms ? `until ${day(tester.ends_at_ms)}` : "",
      ].filter(Boolean).map((part, partIndex) => (partIndex ? ` · ${part}` : `: ${part}`)).join("")}. Progress stays in this browser.`
    : "";
  const reportHref = `/g/${game.slug}/report`;
  const fullGameItem = view.items.find((gameItem) => gameItem.item_name === game.full_game_item_name) ?? null;
  const fullGamePrice = fullGameItem ? priceFor(fullGameItem, view.countryCode) : null;
  // Add-ons: the items the developer sells on the page too, priced or owned, but the full game, which is Buy.
  const isOwned = (gameItem: GameItem) => gameItem.item_kind === "permanent" && view.ownedItemNames.includes(gameItem.item_name);
  const addOns = view.items.filter((gameItem) => gameItem.is_on_game_page && gameItem.item_name !== game.full_game_item_name && (gameItem.price_minor_units !== null || isOwned(gameItem)));
  // The pane's actions: Play (the page's one orange), or Buy for a paid game the viewer doesn't own; Details down to About, a paid
  // game's demo or a demo's full game, Share and Report.
  // A guest is asked to sign in from the first paint, never by a script after it: the note says how, and where the game (or the room a link
  // opens) needs an account, Play says so (ACCOUNT_GATE_SCRIPT only sends the press to sign in).
  const asksGuestToSignIn = !view.viewer.account && accountRequirement !== "none" && !isForSale;
  const mainAction = isClosed
    ? []
    : !isForSale
      ? [{ kind: "control" as const, markup: primaryButton(action("play"), { id: "play", type: "button", isBig: true }) }]
      : fullGamePrice
        ? [{ kind: "control" as const, markup: primaryButton(action("buy"), { id: "buy-game", type: "button", isBig: true, trailingText: priceText(fullGamePrice.currencyCode, fullGamePrice.priceMinorUnits), dataAttributes: { "buy-item": game.full_game_item_name! } }) }]
        : [{ kind: "control" as const, markup: primaryButton("Not on sale right now", { id: "buy-game", type: "button", isBig: true, isDisabled: true }) }];
  const demoSlug = isForSale ? view.demoGameSlug : null;
  const otherGameLink = demoSlug ? secondaryButton("Try the demo", { href: `/g/${demoSlug}?play`, isBig: true, isFullWidth: true }) : view.fullGameSlug ? secondaryButton("Full game", { href: `/g/${view.fullGameSlug}?buy`, isBig: true, isFullWidth: true }) : null;
  // Under Play: a paid game's demo or a demo's full game, then Share and Report, small. The page itself is the game's details.
  const smallActions = [
    { kind: "control" as const, markup: secondaryButton(action("share"), { id: "share-page", type: "button", isLabelHidden: true, isBig: true, controls: "share-dialog" }) },
    { kind: "control" as const, markup: secondaryButton(action("report"), { href: reportHref, isLabelHidden: true, isBig: true, dataAttributes: { report: "" } }) },
  ];
  // Share and Report are one cell, so a line too narrow for the row puts them together under what leads it.
  const shareAndReport: LayoutItem = { kind: "block", markup: row({ widths: "fit", alignment: "end", label: "Share and Report", items: smallActions }) };
  // Play (or Buy) fills the row, Share and Report small at its end; a paid game's demo or a demo's full game goes under it.
  const paneActions = stack({
    items: [
      // Play and Share and Report share one line on every screen. With a paid game's demo (or a demo's full game) under it, Share and Report
      // go beside that instead, so Buy, with its price, has its line.
      {
        kind: "block",
        markup: !mainAction.length
          ? row({ widths: "fit", alignment: "end", label: "Share and Report", items: smallActions })
          : otherGameLink
            ? stack({ items: [...mainAction, { kind: "block", markup: row({ widths: "lead-fills", label: `${demoSlug ? "Try the demo" : "Full game"}, Share and Report`, items: [{ kind: "control", markup: otherGameLink }, shareAndReport] }) }] })
            // Where Buy and its price can't share the line (the narrowest phone), Buy takes it alone and the pair goes under it.
            : row({ widths: "lead-fills", label: "Play, Share and Report", items: [...mainAction, shareAndReport] }),
      },
    ],
  });
  // A paid game's Buy says what's needed, and the buy sheet makes the account.
  const accountNote = accountRequirement !== "none" && !isClosed && game.full_game_item_name === null
    ? html`<p id="account-note">${accountRequirement === "whole_game" ? "Needs a Zaisma account" : "Playing online needs a Zaisma account"}<span id="account-ask"${asksGuestToSignIn ? "" : raw(" hidden")}>. ${textLink("Make one free", `/join?next=${accountNext}`)} or ${textLink("sign in", `/signin?next=${accountNext}`)}${accountRequirement === "whole_game" ? " to play" : " to play with others"}</span>.</p>`
    : null;
  const genreNames = (game.genres ? game.genres.split(",") : []).filter((genre): genre is Genre => genre in GENRE_LABELS).map((genre) => GENRE_LABELS[genre]);
  const description = game.description.trim();
  const gameLine = firstSentence(description);
  // How it's played, where, and what it sells, in one line under Play: the rest is in Details.
  const factsLine = [
    ...describedModes.map((playMode) => (playMode.playerCount ? `${playMode.label}, ${playMode.playerCount}` : playMode.label)),
    ...(devices.length ? [devices.map((device) => DEVICE_LABELS[device] ?? device).join(", ")] : []),
    purchaseWords(purchaseLabel),
  ].join(" · ").replace(/-/g, "\u2011");
  // A returning player's own first (on a guest's device, the page's script fills it): when they last played, and what's new since.
  const lastPlayedAtMs = tester ? null : view.lastPlayedAtMs;
  const latestUpdateAtMs = view.updates[0]?.first_published_at_ms ?? null;
  const newSinceLink = textLink("What's new", "#updates");
  const titleBlock = stack({
    items: [
      { kind: "words", markup: html`<h1 id="title">${game.title}</h1>` },
      ...(developer || genreNames.length
        ? [{ kind: "words" as const, markup: html`<p>${developer ? html`by ${textLink(developer.name, profilePath(developer.name), { isQuiet: true })}` : ""}${developer && genreNames.length ? " · " : ""}${genreNames.slice(0, 2).join(", ")}</p>` }]
        : []),
      ...(gameLine ? [{ kind: "words" as const, markup: html`<p>${gameLine}</p>` }] : []),
      // The live line: hidden until it says something (people playing, or friends the page's script finds).
      { kind: "block", id: "live-line", isHidden: playingNowPlayerCount < MINIMUM_PLAYING_NOW_PLAYER_COUNT && lastPlayedAtMs === null, markup: keyDetails({ details: [
        ...(tester ? [] : [{ id: "last-played", isHidden: lastPlayedAtMs === null, label: "Last played", detailValue: lastPlayedAtMs === null ? "" : ago(Date.now() - lastPlayedAtMs), under: html`<span id="new-since"${lastPlayedAtMs !== null && latestUpdateAtMs !== null && latestUpdateAtMs > lastPlayedAtMs ? "" : raw(" hidden")}>${newSinceLink}</span>` }]),
        { id: "playing-now", isHidden: playingNowPlayerCount < MINIMUM_PLAYING_NOW_PLAYER_COUNT, label: "Playing now", detailValue: playingNowPlayerCount.toLocaleString("en-US") },
        ...(tester || !canSignIn || isClosed ? [] : [{ id: "friends-here", isHidden: true, label: "Friends playing", detailValue: "" }]),
      ] }) },
      ...(tester ? [{ kind: "block" as const, markup: banner({ text: testerWords, icon: "info", tone: "warning" }) }] : []),
      ...(isClosed ? [{ kind: "words" as const, id: "closed", markup: html`<p>This game isn't open to your account. ${textLink("Find other games", "/")}</p>` }] : []),
      { kind: "block", markup: paneActions },
      ...(accountNote ? [{ kind: "words" as const, markup: accountNote }] : []),
    ],
  });
  // Across the whole pane under the pictures and Play, so neither column grows long beside the other: this device's note, and the facts.
  const paneFoot: LayoutItem[] = [
    { kind: "block", id: "device-note", isHidden: !deviceNote.notes.length, markup: banner({ text: deviceNote.notes.join(" "), icon: "warning", ...(deviceNote.isOtherBrowserNeeded ? { tone: "warning" as const } : {}) }) },
    ...(factsLine ? [{ kind: "words" as const, markup: html`<p>${factsLine}</p>` }] : []),
  ];
  // The top of the page: its screenshots, the first large, beside its name and Play; one over the other on an upright phone.
  const media = shots.length
    ? gameMedia({ id: "screenshots", gameTitle: game.title, arrangement: "featured", whenEmpty: NO_EMPTY_NOTE, items: shots.map((shot) => ({ mediaKind: "picture" as const, picture: shot })) })
    : null;
  const gamePane = glassPane({
    paneWidth: "full",
    label: game.title,
    body: stack({ items: [{ kind: "block", markup: media ? columns({ split: "wide-first", isSideBySideWhenShort: true, columns: [media, titleBlock] }) : titleBlock }, ...paneFoot] }),
  });
  const pane = (title: string, items: LayoutItem[], isTitleShown = true): Raw =>
    glassPane({ paneWidth: "full", label: title, body: stack({ items: [...(isTitleShown ? [{ kind: "words" as const, markup: html`<h2>${title}</h2>` }] : []), ...items] }) });
  const coverCard = (otherGame: ShowGame): GridItem => ({
    kind: "block",
    markup: gameCard({ title: otherGame.title, picture: otherGame.cover_picture, href: `/g/${otherGame.slug}`, tintColor: otherGame.glass_tint_color, facts: { playerCount: otherGame.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? otherGame.playing_now_player_count : undefined, priceText: coverPriceText(otherGame, view.ownedPaidGameIds) } }),
  });
  const gameDetails = [
    ...gameFacts,
    ...(game.first_published_at_ms ? [{ label: "Released", text: day(game.first_published_at_ms) }] : []),
    ...purchaseFacts,
  ];
  const aboutItems: LayoutItem[] = [
    { kind: "block", markup: readingText({ markup: description ? paragraphs(description) : html`<p>The developer hasn't written about this game yet.</p>` }) },
    ...(genreNames.length ? [{ kind: "words" as const, markup: html`<p>${genreNames.map((genreName) => tag(genreName, "plain"))}</p>` }] : []),
  ];
  const detailsItems: LayoutItem[] = [
    { kind: "words", markup: details({ details: gameDetails, arrangement: "down", label: "Details" }) },
    ...(developer ? [{ kind: "block" as const, markup: person({ username: developer.name, href: profilePath(developer.name), note: developer.game_count === 1 ? "1 game on Zaisma" : `${developer.game_count} games on Zaisma` }) }] : []),
    ...(pageLinks.length ? [{ kind: "block" as const, markup: html`${developerLinks(pageLinks)}` }] : []),
  ];
  const addOnRows: ListRow[] = addOns.map((gameItem) => {
    const price = priceFor(gameItem, view.countryCode);
    const detail = gameItem.description.split("\n")[0]?.trim() || undefined;
    return isOwned(gameItem) || !price
      ? { title: gameItem.title, detail, end: tag("Owned", "plain") }
      : { title: gameItem.title, detail, action: secondaryButton(priceText(price.currencyCode, price.priceMinorUnits), { type: "button", isSmall: true, dataAttributes: { "buy-item": gameItem.item_name } }) };
  });
  // On a phone, Roblox-simple: the art, the name and Play up top, then About, Details and Add-ons folded shut, each a row that opens. On
  // a computer, Steam-rich: About beside Details, then Add-ons, all open.
  const learnItems: LayoutItem[] = view.deviceKind === "phone"
    ? [{ kind: "block", markup: pane("About this game", [{ kind: "block", markup: listRows({
        whenEmpty: NO_EMPTY_NOTE,
        label: "About, details and add-ons",
        rows: [
          { title: "About", fold: { body: stack({ items: aboutItems }) } },
          { title: "Details", fold: { body: stack({ items: detailsItems }) } },
          ...(addOnRows.length ? [{ title: "Add-ons", fold: { id: "add-ons", rows: addOnRows } }] : []),
        ],
      }) }], false) }]
    : [
        { kind: "block", markup: columns({ split: "wide-first", columns: [pane("About", aboutItems), pane("Details", detailsItems)] }) },
        // The part shows only with an add-on in it.
        ...(addOnRows.length ? [{ kind: "block" as const, id: "add-ons", markup: pane("Add-ons", [{ kind: "block" as const, markup: listRows({ label: "Add-ons", whenEmpty: NO_EMPTY_NOTE, rows: addOnRows }) }]) }] : []),
      ];
  const rowGameCount = view.deviceKind === "phone" ? PHONE_ROW_GAME_COUNT : GAME_PAGE_ROW_GAME_COUNT;
  const overviewItems: LayoutItem[] = [
    ...learnItems,
    ...(view.developerGames.length && developer
      ? [{ kind: "block" as const, markup: gameRow({ id: "more", trackId: "more-track", title: `More from ${developer.name}`, items: view.developerGames.slice(0, rowGameCount).map(coverCard) }) }]
      : []),
    ...(view.likeGames.length
      ? [{ kind: "block" as const, markup: gameRow({ id: "like-this", trackId: "like-this-track", title: "More like this", items: view.likeGames.slice(0, rowGameCount).map(coverCard) }) }]
      : []),
  ];
  // Overview, then Rooms (picking a room first is rare: Roblox keeps its servers a tab away) and Updates, each a tab showing its part alone.
  const parts = [
    { id: "overview", label: "Overview", items: overviewItems },
    ...(rooms ? [{ id: "rooms", label: "Rooms", items: [{ kind: "block" as const, markup: pane("Rooms", roomsTabItems(game.slug, rooms), false) }] }] : []),
    ...(view.updates.length
      ? [{ id: "updates", label: "Updates", items: [{ kind: "block" as const, markup: pane("Updates", [{ kind: "block", markup: readingText({ markup: html`${view.updates.map((update) => html`<h3>${day(update.first_published_at_ms)}</h3>${paragraphs(update.patch_notes)}`)}` }) }], false) }] }]
      : []),
  ];
  const sections: LayoutItem[] = [
    ...(parts.length > 1
      // The tabs sit on a pane of their own, as everything on the page does.
      ? [{ kind: "block" as const, markup: glassPane({ paneWidth: "full", label: `${game.title}: its parts`, body: stackOfOne(tabSwitch({ label: `${game.title}: its parts`, switchSize: "small", isFull: true, isShowingOnePanel: true, tabs: parts.map((part, partIndex) => ({ label: part.label, href: `#${part.id}`, isCurrent: partIndex === 0 })) })) }) }]
      : []),
    ...parts.map((part, partIndex): LayoutItem => ({ kind: "block", id: part.id, isHidden: partIndex > 0, markup: stack({ items: part.items }) })),
  ];
  // Playing: the Z over the game, and the menu it opens.
  const roomItems: LayoutItem[] = hasRoomCodes ? roomCodeItems() : [];
  const people = playingPeople({ gameOrigin, slug: game.slug, title: game.title, hasZaismaRooms: game.multiplayer_mode !== "none", isPlayedAlone: !multiplayer, canSignIn, signInPath: `/signin?next=${encodeURIComponent(`/g/${game.slug}`)}`, roomItems });
  const gameRows: ListRow[] = [
    // Guests only: a signed-in player's progress is on their account already.
    ...(saves && !viewer.account ? [{ id: "keep-link", isHidden: true, title: "Keep your progress", lead: icon("save"), href: joinHere }] : []),
    { title: "Report this game", lead: icon("flag"), href: reportHref },
    { title: "Content rules", lead: icon("rules"), href: "/legal/content-rules", isNewTab: true },
  ];
  const gameBody = stack({ items: [
    // When the account last saved ("Saved 2 min ago"), written by the saves script: saving that works says nothing over the game.
    ...(saves ? [{ kind: "words" as const, markup: html`<p id="save-line" hidden></p>` }] : []),
    ...(ownServers.length ? [{ kind: "words" as const, markup: html`<p>${ownServersLine(ownServers)}</p>` }] : []),
    ...(isClosed ? [] : [{ kind: "control" as const, markup: updateButton() }]),
    ...(pageLinks.length ? [{ kind: "block" as const, markup: html`${developerLinks(pageLinks)}` }] : []),
    { kind: "block", markup: listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, label: game.title, rows: gameRows }) },
  ] });
  const overlay = gameOverlay({ title: game.title, people, gameBody, reportStep: reportStep(game, { isMultiplayer: multiplayer }), isPlayedAlone: !multiplayer });
  const response = layout(env, {
    title: `${game.title} on Zaisma`,
    head: view.head,
    checkedPage: tester ? "Tester link" : isForSale ? "Game page, for sale" : rooms ? "Game page" : "Game page, no rooms",
    pageShape: "full",
    // Where the game plays: it gets the whole screen, past a phone's notch.
    isFillingScreen: true,
    // The game's own world behind the glass, the same the home shows while its cover is pointed at.
    stage: backgroundMarkup(background),
    stageColor: background.source === "zaisma" ? null : background.tone?.averageColor,
    // The glass takes the game's tint.
    glassHue: background.glassTintColor,
    isFramedBySelf: view.isFramedBySelf,
    viewer,
    // Cloudflare's invisible check from when the page opens, for play counts and multiplayer (tester links: only for multiplayer).
    hasTurnstileCheck: (!tester || multiplayer) && !isClosed && Boolean(env.TURNSTILE_SITE_KEY),
    // What a page for older players shows depends on who's looking, so no cache keeps it.
    isPrivate: game.minimum_player_age_years > 13 || game.full_game_item_name !== null || addOns.length > 0,
    hasStripeFrame: !isClosed,
    hasBackButton: true,
    body: html`${stack({ items: [{ kind: "block", markup: gamePane }, ...sections] })}
${zaismaButton()}
<template id="game-frame"><iframe class="game-frame" id="game"${tester || isAccountsOnly || isClosed ? "" : html` src="${frameUrl}"`} title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated" allowfullscreen referrerpolicy="no-referrer"></iframe></template>
${overlay}
${people.parts}
${multiplayer ? html`${reportScript(game, { gameOrigin })}${blockSheetParts({ gameOrigin })}` : reportScript(game, { gameOrigin })}
${saves ? keepProgressCard({ title: game.title, joinHref: joinHere, signInHref: signinHere }) : ""}
${saves ? signedOutCard(signinHere) : ""}
${canSignIn ? signInAskCard({ title: game.title, joinHref: joinHere, signInHref: signinHere }) : ""}
${canSignIn ? rentedShareCard(signinHere) : ""}
${isClosed || !authConfigured(env) ? "" : friendRequestParts({ gameOrigin, slug: game.slug })}
${multiplayer ? stillThereCard() : ""}
${leavingCard(game.title)}
${isClosed ? "" : buySheetParts({ joinHref: joinHere, signInHref: signinHere, cover })}
${shareDialog({ gameTitle: game.title, hasQrCode: !tester })}
${tester && !multiplayer ? "" : playingCheck("play-check")}
${pageData("game-page-data", {
      rented_share_text: RENTED_SHARE_VPN_TEXT,
      slug: game.slug,
      latest_update_at_ms: tester ? null : latestUpdateAtMs,
      tester_token: tester?.token ?? null,
      room_code: inRoom ? code : "",
      is_multiplayer: multiplayer,
      frame_url: frameUrl,
      // Game files start before Play, on the game's own address: never for tester links or accounts-only games, which need a cookie first.
      warm_url: tester || isAccountsOnly || isClosed ? null : `${gameUrl(env, game.slug)}_zaisma/warm`,
      is_accounts_only: isAccountsOnly,
      // Whether the game has cloud saves on, so a page without them here (a tester link, no accounts) says which it is.
      cloud_saves_enabled: Boolean(game.cloud_saves_enabled),
      frame_query: roomQuery,
      devices,
      controls,
      // A build that needs threads runs only where the game's frame can be isolated (Chrome and Edge): other browsers get a note.
      has_threads: view.hasThreads,
      // Streamer mode (an account setting) hides room codes until the player shows them.
      is_streamer_mode_on: Boolean(viewer.account?.is_streamer_mode_on),
      screen_orientation: game.screen_orientation || null,
      turnstile_site_key: env.TURNSTILE_SITE_KEY ?? "",
      account_requirement: accountRequirement,
      sign_in_url: `/signin?next=${accountNext}`,
      // A room link is an invitation into a match already underway, and ?play comes from a Play button elsewhere: both skip the details.
      autoplay: autoplay ? (accountRequirement === "whole_game" || (accountRequirement === "multiplayer" && inRoom) ? "when_signed_in" : "always") : "never",
    })}
${isClosed ? "" : buySheetData({ slug: game.slug, tester_token: tester?.token ?? null, place: "game_page", ...buySheetStripe(env), asked: null, opener_origin: null, opened_item_name: isForSale && fullGamePrice && url.searchParams.has("buy") ? game.full_game_item_name : null })}
${saves && !isClosed ? pageData("saves-data", { api: `/api/saves/${game.slug}`, root: gameUrl(env, game.slug), query: roomQuery, frameOrigin: gameOrigin, slug: game.slug, offerAfter: (Number(env.KEEP_OFFER_SECONDS) || 300) * 1000, isAccountOfferEnabled: Boolean(game.account_offer_enabled) }) : ""}
${isClosed
      ? scriptTags(GAME_PAGE_SCRIPT, GAME_EMBEDDED_SCRIPT)
      : scriptTags(
          GAME_PAGE_SCRIPT,
          ...(tester && !multiplayer ? [] : [PLAY_COUNTER_SCRIPT]),
          ...(saves ? [SAVES_SCRIPT] : []),
          ...(accountRequirement !== "none" && !isForSale ? [ACCOUNT_GATE_SCRIPT] : []),
          ...(canSignIn ? [SIGN_IN_WHILE_PLAYING_SCRIPT] : []),
          ...(multiplayer ? [STILL_THERE_SCRIPT] : []),
          GAME_LINKS_SCRIPT,
          PASSKEY_SCRIPT,
          BUY_SHEET_SCRIPT,
          GAME_EMBEDDED_SCRIPT,
          GAME_UPDATES_SCRIPT,
          ZAISMA_OVERLAY_SCRIPT,
          GAME_AUTOPLAY_SCRIPT,
        )}`,
  });
  response.headers.append("Vary", "Sec-Fetch-Dest, Sec-Fetch-Site");
  if (!view.isShownInLists || !view.searchEnginesEnabled || tester) response.headers.set("X-Robots-Tag", "noindex");
  return response;
}


/** zaisma.com/t/<token>: a tester link that's on opens its game, noting when it was last used. */
export async function testerPage(env: Env, token: string, request: Request, ctx: ExecutionContext): Promise<Response> {
  const link = await testerLinkByToken(env.DB, token);
  if (!link) return glassMessage(env, "This link doesn't work", "The developer may have turned it off. Ask them for a fresh link.", 404);
  if (!isTesterLinkOn(link)) return glassMessage(env, "This link ended", `It worked until ${day(link.ends_at_ms!)}. Ask the developer for a fresh link.`, 404);
  ctx.waitUntil(testerLinkOpened(env.DB, link.id));
  return gamePage(env, link.slug, request, link);
}

/**
 * POST zaisma.com/t/<token>/enter, from the Play button: a one-use grant for this browser to open the
 * game's tester address, which the games server swaps for its access cookie. { room_code } drops the
 * player into that match.
 */
export async function testerEnter(env: Env, token: string, request: Request): Promise<Response> {
  const link = await testerLinkByToken(env.DB, token);
  const game = link && isTesterLinkOn(link) ? await gameBySlug(env.DB, link.slug) : null;
  if (!link || !game || !canOpen(game) || !(await testerLinkVersion(env.DB, game, link))) return Response.json({ error: { code: "no_tester_link" } }, { status: 404 });
  // Tester links reach other people, so they follow the game's minimum age; only previews, the developer's own, don't.
  const turnedAway = game.minimum_player_age_years > 13 ? ageRefusal(game, (await viewerOf(request, env)).account) : null;
  if (turnedAway) return turnedAway;
  const body = (await request.json().catch(() => ({}))) as { room_code?: unknown };
  const roomCode = typeof body.room_code === "string" && ROOM_CODE.test(body.room_code) ? body.room_code : "";
  const grantKey = await createAccessGrant(env.DB, { gameId: game.id, addressKind: "tester", testerId: link.id, expiresAtMs: link.ends_at_ms ?? Number.MAX_SAFE_INTEGER });
  return Response.json({ frame_url: enterUrl(env, game.slug, "tester", grantKey, roomCode ? `?room=${roomCode}` : "") }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * zaisma.com/p/<token>: a version's preview link, for the developer and their AI. It opens the version
 * full page at the game's fixed preview address, through a one-use grant, so the game domain's
 * address never holds the link's key.
 */
export async function previewPage(request: Request, env: Env, token: string): Promise<Response> {
  const read = readPreviewLinkToken(token);
  const version = read ? await versionById(env.DB, read.versionId) : null;
  const expiresAtMs = version ? checkPreviewLinkToken(env, token, version) : null;
  const game = version && expiresAtMs ? await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(version.game_id).first<Game>() : null;
  if (!version || !expiresAtMs || !game) return glassMessage(env, "This preview link doesn't work", "Preview links last a day, and the developer can turn them off. Get a fresh one from the dashboard or the API.", 404);
  if (!canOpen(game)) return glassMessage(env, game.review_status === "removed" ? "This game was removed" : "This game is being reviewed", "Its previews are closed too.", game.review_status === "removed" ? 410 : 404);
  // Until its AI review lets it through, only its developer reaches it: no link makes it a page for anyone else (Julius, Nov 2, 2026).
  if (!isAiReviewDone(version) && game.owner_id) {
    const { account } = await viewerOf(request, env);
    if (!account) return new Response(null, { status: 302, headers: { Location: `/signin?next=${encodeURIComponent(`/p/${token}`)}`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    const isDeveloper = await env.DB.prepare("SELECT 1 FROM owners WHERE id = ? AND account_id = ?").bind(game.owner_id, account.id).first();
    if (!isDeveloper) return glassMessage(env, "This game is being reviewed", "Its preview opens for its developer until the AI review passes.", 404);
  }
  const grantKey = await createAccessGrant(env.DB, { gameId: game.id, addressKind: "preview", versionId: version.id, expiresAtMs });
  return new Response(null, { status: 302, headers: { Location: enterUrl(env, game.slug, "preview", grantKey, ""), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}

/** Removed and held games open through no link. */
function canOpen(game: Game): boolean {
  return game.review_status !== "removed" && game.review_status !== "held";
}

function enterUrl(env: Env, slug: string, addressKind: "tester" | "preview", grantKey: string, then: string): string {
  return `${gameUrl(env, gameAddress(slug, addressKind))}_zaisma/enter?grant=${grantKey}${then ? `&then=${encodeURIComponent(then)}` : ""}`;
}

export function legal(env: Env, page: string): Response | null {
  if (page === "content-rules") return layout(env, { title: "Content rules · Zaisma", body: contentRulesBody(), pageShape: "reading", checkedPage: "Content rules" });
  if (page === "terms") return layout(env, { title: "Terms of service · Zaisma", body: termsBody(), pageShape: "reading", checkedPage: "Terms of service" });
  if (page === "privacy") return layout(env, { title: "Privacy policy · Zaisma", body: privacyBody(), pageShape: "reading", checkedPage: "Privacy policy" });
  if (page === "security") return layout(env, { title: "Security · Zaisma", body: securityBody(), pageShape: "reading", checkedPage: "Security" });
  const pages: Record<string, { title: string; body: string; checkedPage: SteelPageName }> = {
    dmca: { title: "Copyright and DMCA notices", body: DMCA, checkedPage: "DMCA notices" },
    defamation: { title: "Defamation notices", body: DEFAMATION, checkedPage: "Defamation notices" },
    trademark: { title: "Trademark notices", body: TRADEMARK, checkedPage: "Trademark notices" },
  };
  const legalPage = pages[page];
  if (!legalPage) return null;
  return layout(env, { title: `${legalPage.title} · Zaisma`, checkedPage: legalPage.checkedPage, body: html`<h1>${legalPage.title}</h1>${raw(legalPage.body)}` });
}

// Settled by Julius on Oct 28, 2026 (docs/DECISIONS.md, "Terms of service"): the promises are the decisions' own, in plain words, with no lawyer review.
const TERMS_CHANGED_ON = "October 29, 2026";

/** The terms of service, zaisma.com/legal/terms: concise and formal, in panes like the content rules. */
function termsBody(): Raw {
  const creditDays = CREDIT_LIMITS.refundableDurationDays;
  const proDays = PRO_REFUND_LIMITS.refundableDurationDays;
  const dollarsText = (cents: number) => `$${cents / 100}`;
  const pane = (label: string, markup: Raw): LayoutItem => ({ kind: "block", markup: glassPane({ paneWidth: "full", label, body: stackOfOne(readingText({ markup }), "words") }) });
  return stack({
    items: [
      pane(
        "Terms of service",
        html`<h1>Terms of service</h1>
<p>These terms are the agreement between you and Zaisma LLC, a Wyoming company, which operates Zaisma. The ${textLink("content rules", "/legal/content-rules")} and the ${textLink("privacy policy", "/legal/privacy")} form part of these terms.</p>
<p>Last changed ${TERMS_CHANGED_ON}.</p>`,
      ),
      pane(
        "You and Zaisma",
        html`<h2>Who this is between</h2>
<p>You must be 13 or older to use Zaisma. By playing a game, as a guest or with an account, you accept these terms. Creating an account also constitutes acceptance.</p>
<h2>Your account</h2>
<p>You are responsible for your password and passkeys and for all activity on your account. Usernames must comply with the content rules. You may ${textLink("download your data", "/account#your-data")} or ${textLink("delete your account", "/account#delete-account")} at any time.</p>
<h2>Privacy</h2>
<p>The ${textLink("privacy policy", "/legal/privacy")} describes what Zaisma keeps about you, why, and for how long.</p>
<h2>Closing accounts</h2>
<p>You may delete your account at any time. Zaisma may close an account that breaks these terms, the content rules or the law. In either case, hosting credit from the last ${creditDays} days is refunded to the card it was paid with, and older credit is not refunded. Hosting already paid for is not reversed.</p>`,
      ),
      pane(
        "Games and developers",
        html`<h2>Your games are yours</h2>
<p>You own your games and their contents, and you must hold the rights to everything in them. By publishing a game on Zaisma, you permit Zaisma to store it, serve it to players, review it against the content rules and list it for as long as it remains on Zaisma.</p>
<p>Zaisma may show and promote public games anywhere, always as games on Zaisma credited to their developers, and never as Zaisma's own. Private, unlisted and draft games are never shown or promoted.</p>
<p>When you sell a game or items in it, you are the seller. The sale is between you and the player, through your own Stripe account, and refunds are your responsibility. You are responsible for your games and for how they handle players' data.</p>
<h2>Commitments to developers</h2>
<ul>
<li>Zaisma does not take a share of your sales.</li>
<li>Zaisma gives 30 days' notice before removing a feature developers rely on, and 90 days' notice for the API and the SDK.</li>
<li>You may export all data about your games at any time.</li>
<li>If Zaisma stops hosting games, it will give 90 days' notice and refund all unspent hosting credit.</li>
</ul>
<h2>Content rules and takedowns</h2>
<p>Games, names and posts must comply with the ${textLink("content rules", "/legal/content-rules")}. A game that breaks them or the law may be held, meaning it is hidden from players until a corrected version is published, or removed. Every hold or removal states the rule concerned, what was found and how to fix it.</p>
<p>Copyright notices follow the ${textLink("copyright policy", "/legal/dmca")}. An account is closed after 3 copyright notices that stand within 12 months. Notices that a game falsely accuses a person of a crime follow the ${textLink("defamation policy", "/legal/defamation")}. Notices about a trademark follow the ${textLink("trademark policy", "/legal/trademark")}.</p>`,
      ),
      pane(
        "Payments",
        html`<h2>Hosting credit</h2>
<p>Hosting credit pays for what your games use on Zaisma's servers beyond their free allowance. It is prepaid, with a minimum top-up of ${dollarsText(CREDIT_LIMITS.minimumTopUpCents)}, sold through Link by Stripe, and may be used only for Zaisma's services.</p>
<p>Credit does not expire. The unspent part of a top-up is refundable to its card on request for ${creditDays} days after the top-up. After that, it remains available to spend but is not refundable. Spent credit is not refundable. Deleting your account refunds only credit within its ${creditDays} days. Credit is never paid out.</p>
<h2>Zaisma Pro</h2>
<p>Zaisma Pro costs ${dollarsText(PRO_PRICE_CENTS_PER_MONTH)} a month, charged to your card. You may cancel at any time and keep Pro until the end of the paid month. Partial months are not refunded. The first payment is refundable on request within ${proDays} days of it, and Pro ends when it is refunded. Refunds are requested in ${textLink("Developer settings", "/dashboard/settings#pro")} or through the API.</p>
<h2>Purchases and age</h2>
<p>Buying hosting credit or Zaisma Pro requires you to be 18 or older, or to have a parent's or guardian's permission. Selling requires you to be 18 or older, as Stripe requires.</p>`,
      ),
      pane(
        "Liability and disputes",
        html`<h2>Disclaimer and limitation of liability</h2>
<p>Zaisma is provided as is, without warranties beyond those stated in these terms. Games are made by their developers, not by Zaisma, and each developer is responsible for their own games. To the extent permitted by law, Zaisma's total liability to you is limited to the greater of the amount you paid Zaisma in the preceding 12 months and $50.</p>
<h2>Disputes</h2>
<p>Before bringing a claim, email ${textLink("support@zaisma.com", "mailto:support@zaisma.com")} and allow Zaisma 60 days to resolve it. Unresolved disputes are decided by the courts of Wyoming, including small claims courts, under Wyoming law. There is no arbitration.</p>
<h2>Changes</h2>
<p>Changes to these terms are announced on this page and by email to every account with an email address, 30 days before they take effect.</p>
<h2>Contact</h2>
<p>Questions about these terms may be sent to ${textLink("support@zaisma.com", "mailto:support@zaisma.com")}.</p>`,
      ),
    ],
  });
}

// Approved by Julius on Oct 16, 2026 (#191); the faked-plays rule on Oct 13, 2026.
// The rules themselves are CONTENT_RULES (@zaisma/core), each anchored by the name holds and takedowns give it.

/** One rule as a row that opens: its short title (the anchor a hold's rule links to) and its test, opening to what it is, Fine and Not fine. */
const ruleRow = (rule: ContentRule): ListRow => {
  const ruleDetails = CONTENT_RULE_DETAILS[rule];
  const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  return {
    title: ruleDetails.title,
    detail: ruleDetails.test,
    fold: { id: rule, body: stack({
      items: [
        { kind: "words", markup: html`<p>${CONTENT_RULES[rule]}${NOTICE_ONLY_CONTENT_RULES.includes(rule) && ruleDetails.explanation ? ` ${ruleDetails.explanation}` : ""}</p>` },
        { kind: "words", markup: details({ arrangement: "across", details: [{ label: "Fine", text: sentence(ruleDetails.fine) }, { label: "Not fine", text: sentence(ruleDetails.notFine) }] }) },
      ],
    }) },
  };
};

/** zaisma.com/legal/content-rules: what's welcome, then each rule with its test, the ones acted on only on a notice, and what happens. */
function contentRulesBody(): Raw {
  const pane = (label: string, items: LayoutItem[]): LayoutItem => ({ kind: "block", markup: glassPane({ paneWidth: "full", label, body: stack({ items }) }) });
  return stack({
    items: [
      pane("Content rules", [
        { kind: "words", markup: html`<h1>Content rules</h1>` },
        { kind: "words", markup: html`<p>Zaisma is for players 13 and up. Games may contain anything these rules do not prohibit, including:</p>` },
        { kind: "words", markup: html`<p>${ALLOWED_CONTENT_TITLES.map((title, index) => html`<span title="${ALLOWED_CONTENT[index]}">${tag(title, "plain")}</span> `)}</p>` },
      ]),
      pane("The lines", [
        { kind: "words", markup: html`<h2>The lines</h2>` },
        { kind: "words", markup: html`<p>A game that breaks one of these is rejected or taken down, with the rule, what was found and how to fix it. Anyone can report a game.</p>` },
        { kind: "block", markup: listRows({ label: "The lines", whenEmpty: NO_EMPTY_NOTE, rows: (Object.keys(CONTENT_RULES) as ContentRule[]).filter((rule) => !NOTICE_ONLY_CONTENT_RULES.includes(rule)).map(ruleRow) }) },
      ]),
      pane("Only on a notice", [
        { kind: "words", markup: html`<h2>Only on a notice</h2>` },
        { kind: "words", markup: html`<p>Zaisma does not judge these itself. When the owner of a work or a trademark, or a private person a game falsely accuses of a crime, sends a notice, the game is hidden until you publish a version without what it names. If the notice is wrong, you can send a counter-notice: see ${textLink("Copyright and DMCA notices", "/legal/dmca")}, ${textLink("Defamation notices", "/legal/defamation")} and ${textLink("Trademark notices", "/legal/trademark")}.</p>` },
        { kind: "block", markup: listRows({ label: "Only on a notice", whenEmpty: NO_EMPTY_NOTE, rows: NOTICE_ONLY_CONTENT_RULES.map(ruleRow) }) },
      ]),
      pane("What happens", [
        { kind: "words", markup: html`<h2>What happens</h2>` },
        {
          kind: "words",
          markup: details({
            arrangement: "across",
            details: [
              { label: "Review", text: "Each version is checked for malware, matched against known illegal images and reviewed against each rule's test, usually within minutes." },
              { label: "Rejection", text: "A version that breaks a rule is rejected with the rule, the finding and the fix. Nothing is deleted; a corrected version can be published." },
              { label: "Appeal", text: "To contest a decision, message Zaisma about the version. A person replies, usually within a day." },
            ],
          }),
        },
      ]),
      pane("Reports and enforcement", [
        { kind: "words", markup: html`<h2>Reports and enforcement</h2>` },
        {
          kind: "block",
          markup: listRows({
            label: "Reports and enforcement",
            whenEmpty: NO_EMPTY_NOTE,
            rows: [
              {
                title: "Reports",
                detail: "Every game page has a Report button; child safety and illegal content go straight to a person.",
                fold: { id: "reports", body: readingText({ markup: html`<p>Zaisma removes games that break these rules. Until a report is checked, a brand-new game is hidden and a recent update goes back to the version before it. A person looks only at what the review cannot settle, and at anything about child safety.</p>` }) },
              },
              {
                title: "Player conduct",
                detail: "How players treat each other is the game's call, with a few exceptions.",
                fold: { id: "player-conduct", body: readingText({ markup: html`<p>Each game and its moderators decide how players talk to each other, and mute and block are always there. Zaisma steps in for threats that reach into real life, sharing someone's personal details, following someone after they have blocked them, and anything sexual toward a teen. Reports about bullying, cheating and other behavior go to the game's developer.</p>` }) },
              },
              {
                title: "Account closure",
                detail: "Only for sexual content involving minors, malware, or restoring content that was taken down.",
                fold: { id: "account-closure", body: readingText({ markup: html`<p>Breaking any other rule costs a version, never the account: the version is rejected or the game hidden, and a corrected version brings it back.</p>` }) },
              },
              {
                title: "Other countries",
                detail: "A notice from a court, regulator or police blocks a game in that country only.",
                fold: { id: "other-countries", body: readingText({ markup: html`<p>These rules follow US law. When a country's own law forbids a game that is allowed here (the UK's hatred offences, for example), the game is blocked for players in that country, and everyone else can still play it. Publishing a version without what the notice names lifts the block. Authorities can send notices to ${textLink("safety@zaisma.com", "mailto:safety@zaisma.com")}.</p>` }) },
              },
              {
                title: "Faked plays",
                detail: "A game with faked plays is removed from Popular, Trending and New; doing it again can get it taken down.",
                fold: { id: "faked-plays-in-lists", body: readingText({ markup: html`<p>Plays and players are counted only when they are people (see the faked plays rule above).</p>` }) },
              },
              {
                title: "Covers and titles",
                detail: "Zaisma's lists show games whose covers and titles keep the listing lines.",
                fold: { id: "covers-and-titles", body: readingText({ markup: html`<p>No text but the title, nothing laid over the picture, no fake rewards, and built around something from the game. A game that breaks one still plays by its link until it is fixed; a fake reward holds it. See ${textLink("Covers that show your game", "/developers/covers")}.</p>` }) },
              },
              {
                title: "Names players give",
                detail: "Names players give to sessions, levels and maps are allowed; the game keeps them within these rules.",
                fold: { id: "names-players-give", body: readingText({ markup: html`<p>The game is responsible for what its players name things, as for anything else it shows.</p>` }) },
              },
            ],
          }),
        },
      ]),
    ],
  });
}

const DMCA = `
<p class="lead">If a game on Zaisma uses your work without permission, send Zaisma a notice, and players cannot open the game until it is fixed.</p>
<h2>What to include</h2>
<ol>
<li>Your name, address, phone number and email.</li>
<li>The work you own, and the Zaisma link where it is used.</li>
<li>A statement that you believe in good faith the use is not authorized by you, your agent or the law.</li>
<li>A statement, under penalty of perjury, that your notice is accurate and that you are the owner or authorized to act for the owner.</li>
<li>Your physical or electronic signature.</li>
</ol>
<h2>Where to send it</h2>
<p>Email <a href="mailto:dmca@zaisma.com">dmca@zaisma.com</a>.</p>
<p class="note">Designated agent details will be listed here once Zaisma's DMCA agent registration is complete.</p>
<h2>What happens next</h2>
<p>Zaisma hides the game from players and tells its developer what your notice names, passing the notice on with your name and email. Once the developer publishes a version without your work, Zaisma checks it and shows the game again. Nothing is deleted.</p>
<h2>Repeat infringers</h2>
<p>An account is closed after 3 copyright notices that stand within 12 months: notices with no counter-notice, or whose counter-notice failed. The <a href="/legal/terms">terms of service</a> say what happens to its credit.</p>
<h2>Counter-notices</h2>
<p>If your game was hidden by mistake, or you may use the work, email the same address with a counter-notice:</p>
<ol>
<li>Your name, address, phone number and email.</li>
<li>The game's Zaisma link and what the notice named.</li>
<li>A statement, under penalty of perjury, that you believe in good faith it was hidden by mistake or because the work was misidentified.</li>
<li>Your consent to the jurisdiction of the federal court for your address (or, outside the US, any court where Zaisma may be found), and that you will accept service from the person who sent the notice.</li>
<li>Your physical or electronic signature.</li>
</ol>
<p>Zaisma passes it on to the person who sent the notice, with your name and address. After 10 working days the game is back, unless that person tells Zaisma they have gone to court.</p>
`;

// The flow Julius settled on Oct 19, 2026: the game is hidden on a notice, without Zaisma judging it, until a fixed version or a counter-notice.
const DEFAMATION = `
<p class="lead">If a game on Zaisma falsely says you, a private person, committed a crime, send Zaisma a notice, and players cannot open the game until it is fixed. Zaisma does not judge whether it is true: the developer can answer with a counter-notice.</p>
<p>Satire, jokes and stories about politicians, celebrities and other public figures are allowed, and so are crimes someone was publicly charged with or convicted of. If a game shows where you live, your phone number or where you go to school, or threatens you, use the Report button on its page instead: that breaks the <a href="/legal/content-rules#real_people">content rules</a> whatever it says.</p>
<h2>What to include</h2>
<ol>
<li>Your name and email.</li>
<li>The game's Zaisma link, and the exact words or scene: where it is in the game, and what it says.</li>
<li>That it is about you, that you are a private person and not a public figure, and that it says you committed a crime you did not commit.</li>
<li>Your consent for Zaisma to pass your notice on to the game's developer, with your name.</li>
<li>A statement that you believe in good faith your notice is accurate.</li>
<li>Your physical or electronic signature.</li>
</ol>
<h2>Where to send it</h2>
<p>Email <a href="mailto:safety@zaisma.com">safety@zaisma.com</a>, with "Defamation notice" in the subject.</p>
<h2>What happens next</h2>
<p>Zaisma hides the game from players and tells its developer what your notice names. Once the developer publishes a version without it, Zaisma checks it and shows the game again. Nothing is deleted.</p>
<h2>Counter-notices</h2>
<p>If your game was hidden and what it says is true, or is not about a private person, email the same address with a counter-notice:</p>
<ol>
<li>Your name, a contact address and your email.</li>
<li>The game's Zaisma link and what the notice named.</li>
<li>Why the notice is wrong: what it says is true, or it is not about the person who sent it, or that person is a public figure.</li>
<li>Your consent for Zaisma to pass your counter-notice on to the person who sent the notice, with your name and address, so they can take it to court.</li>
<li>A statement that you believe in good faith your counter-notice is accurate.</li>
<li>Your physical or electronic signature.</li>
</ol>
<p>Zaisma passes it on to the person who sent the notice. After 10 working days the game is back, unless that person tells Zaisma they have gone to court.</p>
`;

// The flow Julius picked on Nov 5, 2026, when Zaisma stopped checking for famous names: as with defamation, hidden on a notice without Zaisma judging it.
const TRADEMARK = `
<p class="lead">If a game on Zaisma uses your registered trademark so that players would think you made or back it, send Zaisma a notice, and players cannot open the game until it is fixed. Zaisma does not judge whether the trademark is infringed: the developer can answer with a counter-notice.</p>
<p>A notice covers a game's name, its pictures and anything in the game. A brand mentioned in a game's story or description, parody, and a common word that happens to be a trademark are allowed.</p>
<h2>What to include</h2>
<ol>
<li>Your name, address and email.</li>
<li>The trademark, where it is registered and its registration number.</li>
<li>The game's Zaisma link, and where the trademark is used: the title, a picture, or where in the game.</li>
<li>Your consent for Zaisma to pass your notice on to the game's developer, with your name and email.</li>
<li>A statement that you believe in good faith the use is not authorized by you, your agent or the law.</li>
<li>A statement that your notice is accurate and that you are the owner or authorized to act for the owner.</li>
<li>Your physical or electronic signature.</li>
</ol>
<h2>Where to send it</h2>
<p>Email <a href="mailto:dmca@zaisma.com">dmca@zaisma.com</a>, with "Trademark notice" in the subject.</p>
<h2>What happens next</h2>
<p>Zaisma hides the game from players and tells its developer what your notice names. Once the developer changes it, Zaisma checks the game and shows it again. Nothing is deleted.</p>
<h2>Counter-notices</h2>
<p>If your game was hidden by mistake, or you may use the trademark, email the same address with a counter-notice:</p>
<ol>
<li>Your name, a contact address and your email.</li>
<li>The game's Zaisma link and what the notice named.</li>
<li>Why the notice is wrong: you own the trademark or have permission, the trademark is not registered, or players would not think its owner made or backs the game.</li>
<li>Your consent for Zaisma to pass your counter-notice on to the person who sent the notice, with your name and address, so they can take it to court.</li>
<li>A statement that you believe in good faith your counter-notice is accurate.</li>
<li>Your physical or electronic signature.</li>
</ol>
<p>Zaisma passes it on to the person who sent the notice. After 10 working days the game is back, unless that person tells Zaisma they have gone to court.</p>
`;

// Approved by Julius on Oct 12, 2026; the play stats and play-check lines on Oct 13, 2026; the lead, the player ID line and the line about games' content rules on Oct 16, 2026; sites you sign in to with Zaisma in the player ID line by merging Sign in with Zaisma; the devices, wrong passwords, cookies, Cloudflare and Supabase lines (Accounts open only through Zaisma) in its preview on Oct 17, 2026.
// Rewritten in a formal register and moved into Glass panes with the terms of service, Oct 29, 2026: the same facts and promises.
/** The privacy policy, zaisma.com/legal/privacy: concise and formal, in panes like the terms of service. */
function privacyBody(): Raw {
  const pane = (label: string, markup: Raw): LayoutItem => ({ kind: "block", markup: glassPane({ paneWidth: "full", label, body: stackOfOne(readingText({ markup }), "words") }) });
  return stack({
    items: [
      pane(
        "Privacy policy",
        html`<h1>Privacy policy</h1>
<p>Zaisma keeps as little personal data as possible. Most games require no account, and guests leave no data behind.</p>
<p>Zaisma does not sell personal data, and there is no advertising on Zaisma.</p>
<p>Each page reports how fast it showed: which page, how long it took, whether it was opened or reached from another page on Zaisma, and the type of device and connection. The report carries nothing that identifies you or your device, and it is kept for 3 months.</p>`,
      ),
      pane(
        "Guests",
        html`<h2>Playing as a guest</h2>
<p>Guests receive a temporary ID and a generated name, used only to run the game session and discarded when the browser tab closes. Zaisma keeps no profile of guests.</p>
<p>The browser stores the games played recently. This list stays on the device and is never sent to Zaisma.</p>
<p>Each play is counted for the game's developer and for lists such as Popular: that the game was played, how long it was on screen, and whether the browser played it before and on which day it first did. Plays are counted by internet provider, never by person. The details of a play are kept for at most one day; after that, only totals for each game and day are kept, never anything that identifies who played.</p>
<p>Zaisma measures how games perform by browser and device type, as totals only.</p>`,
      ),
      pane(
        "Accounts",
        html`<h2>If you create an account</h2>
<p>If you create an account, Zaisma keeps the following:</p>
<ul>
<li><strong>Your username</strong>, which you choose. It is public.</li>
<li><strong>Your password.</strong> Only Supabase, Zaisma's sign-in provider, keeps it, as a hash.</li>
<li><strong>Your email</strong>, only if you add one, used only to recover your account and to send codes you request. It is never shown to anyone and is never used for marketing.</li>
<li><strong>Your player ID.</strong> When you are signed in, the games you play and the sites you sign in to with Zaisma receive your player ID and can look up your username with it. They never receive your email, your age or anything from other games. Your account page lists those sites, and you may remove any of them.</li>
<li><strong>Your age group</strong>: 13 to 15, 16 or 17, or 18 and over. If you are under 18, your birth date is also kept to update your age group, and it is deleted when you turn 18. If you are 18 or over when you create an account, your birth date is never kept. Your age group is never shown to anyone.</li>
<li><strong>Your game saves</strong>, stored with your account.</li>
<li><strong>The games you played</strong>: the last 20, and every game you have played, so its developer can be notified if you delete your account.</li>
<li><strong>Your passkeys</strong>, if you add any: the public half of each key, the type of device it was added on and when it was last used. The private half never leaves your device or password manager.</li>
<li><strong>The devices you sign in on.</strong> Each browser you sign in on keeps a random ID in a cookie, and Zaisma records that your account signed in with it, to protect your account from password guessing. The record is deleted one year after your last sign-in on that device.</li>
<li><strong>Your account's activity</strong>, for 90 days: sign-ins on a new device and changes to how you sign in or to your API keys, each with the device, the network and the approximate location it came from, derived from your connection address without keeping the address. Only you can see it, on your account page. If you turn off ${textLink("Keep where my account is used from", "/account#activity")}, only the event and its time are kept.</li>
<li><strong>Wrong passwords entered for your account</strong>: when, and whether on a device you had signed in on, never what was entered. Kept for one day.</li>
<li><strong>Google or Discord sign-in.</strong> If you sign in with Google or Discord, they provide your email and the name and profile picture on that account. Zaisma uses only the email; Supabase keeps the rest with your sign-in.</li>
</ul>
<p>Accounts are for people 13 and older. Anyone younger cannot create one, and nothing they entered is kept. If Zaisma learns that an account belongs to someone under 13, the account is deleted.</p>
<h2>Cookies</h2>
<p>Zaisma uses cookies only to keep you signed in, to complete account creation, and to recognize a device you have signed in on before. Zaisma uses no advertising, tracking or analytics cookies.</p>
<p>Your browser keeps the date it first played each game, signed by Zaisma, so a browser that has played before keeps playing when a network looks like a server. It stays in your browser: Zaisma keeps no copy, and it says nothing about you or your device. Clearing your browser's storage removes it.</p>`,
      ),
      pane(
        "Games and payments",
        html`<h2>Reports</h2>
<p>When you report a game or a player, Zaisma keeps what you wrote and nothing about you. A report about a player includes their temporary ID or name. A picture attached to a report is deleted within 30 days.</p>
<h2>Games</h2>
<p>Games cannot access your account, email or cookies. The content rules do not allow games to ask for your personal details.</p>
<p>Some games run online play on their developer's own servers, named in the game's menu. Those servers see your connection address, as any website you visit does, and what the game sends them. They never receive your email or your age.</p>
<h2>Purchases in games</h2>
<p>Payments for purchases in games are processed by Stripe. When you save a card, Stripe keeps it, and Zaisma keeps its brand, its last four digits and the email for receipts. The developer you buy from receives the payment, never your card details. Zaisma keeps what you bought and when.</p>
<h2>Reports of child sexual abuse</h2>
<p>When image matching finds known child sexual abuse material in anything uploaded to Zaisma, or a person at Zaisma confirms a child-safety case, US law requires a report to the National Center for Missing &amp; Exploited Children (NCMEC). The report carries the account's username, its email if it has one, the connection address and time of the upload, and the material itself. Zaisma keeps what it reported for a year after the report, as the law requires, even if the account or the game is deleted.</p>
<h2>If you make games</h2>
<p>Changes you and your API keys make to your games are recorded in each game's history for as long as the game exists, with who made each change and from where. Each change also keeps its connection address for 90 days, visible only to you, so that a report of illegal material can be traced. Turning off ${textLink("Keep where my account is used from", "/account#activity")} stops this, except for uploads of versions and images, which keep their address for 90 days in either case. To alert you when a key is used from a new location, Zaisma keeps a fingerprint of each network and country it is used from until it has gone unused for 90 days.</p>`,
      ),
      pane(
        "Storage and service providers",
        html`<h2>Backups</h2>
<p>Each night, Zaisma copies its data to a backup at Backblaze, in the United States. For up to 30 days after something is deleted, a copy of it may remain in the backup; after that, it is gone. The backup is used only to restore Zaisma after a failure, and a restore never brings back deleted data.</p>
<h2>Service providers</h2>
<ul>
<li><strong>Cloudflare</strong> runs Zaisma's servers, stores games, sends the email codes you request, and checks for automated traffic. It sees your connection address to deliver pages and prevent abuse; Zaisma keeps that address only where this policy says. The verification is Cloudflare Turnstile, covered by its ${textLink("Turnstile Privacy Addendum", "https://www.cloudflare.com/turnstile-privacy-policy/")}.</li>
<li><strong>Supabase</strong> handles sign-in: it checks your password, keeping only a hash, and holds your email if you added one. It receives your connection address when you sign in and keeps it with each sign-in.</li>
<li><strong>Stripe</strong> processes payments for purchases in games and keeps the cards you save. The developer you buy from receives the payment through their own Stripe account, with the email for receipts.</li>
<li><strong>Anthropic</strong> reviews uploaded games for safety. It sees game files, never players.</li>
<li><strong>Backblaze</strong> keeps Zaisma's nightly backup, in the United States. It only stores the copies, encrypted.</li>
</ul>`,
      ),
      pane(
        "Your data",
        html`<h2>Downloading your data</h2>
<p>On your account page, choose ${textLink("Download your data", "/account#your-data")} to receive a copy of everything Zaisma keeps about your account, including your game saves.</p>
<h2>Deleting your account</h2>
<p>On your account page, choose ${textLink("Delete account", "/account#delete-account")}. Your username, password, any email, game saves, recently played games and all other account data are deleted immediately. Their copies in the backup are gone within 30 days. Games you made are deleted as well, with their files, database and players' saves. A game its developer deletes on its own stays off for a week, so they can bring it back, then it is erased the same way, and its copies in the backup are gone within 30 days of that. The games you played and the sites you signed in to with Zaisma are notified, so their developers can erase what they kept about you.</p>
<h2>Questions</h2>
<p>Questions about this policy may be sent to ${textLink("privacy@zaisma.com", "mailto:privacy@zaisma.com")}.</p>`,
      ),
    ],
  });
}

// Julius settled it on Oct 19, 2026: safe harbor with scope and rules, no cash reward in the beta, reply in 5 days, fix serious holes in 30, 90 days before publishing.
function securityBody(): Raw {
  const pane = (label: string, markup: Raw): LayoutItem => ({ kind: "block", markup: glassPane({ paneWidth: "full", label, body: stackOfOne(readingText({ markup }), "words") }) });
  const hasPromises = PUBLISHED_PROMISES.length > 0;
  return stack({
    items: [
      pane(
        "Security",
        html`<h1>Security</h1>
<p>Anyone who finds a security hole in Zaisma can report it privately, and will not get in trouble for looking.</p>
<h2>How to report</h2>
<p>Email ${textLink(SECURITY_REPORT_EMAIL, `mailto:${SECURITY_REPORT_EMAIL}`)}, or ${textLink("report it privately on GitHub", SECURITY_ADVISORY_URL, { isNewTab: true })}. A report says where the hole is, how to make it happen, and what it lets someone do. Zaisma's machine-readable contact is ${textLink("security.txt", SECURITY_TEXT_FILE_PATH)}.</p>`,
      ),
      pane(
        "What is covered and the rules",
        html`<h2>What is covered</h2>
<ul>
<li>zaisma.com, its API and its MCP.</li>
<li>Your own Zaisma account and your own games.</li>
<li>The game server, the SDK and the upload command in the ${textLink("open source repo", "https://github.com/zaisma/zaisma")}.</li>
</ul>
<h2>Zaisma's promise: safe harbor</h2>
<p>If you look for holes in good faith and stay inside the rules below, Zaisma will not take legal action against you and will not close your account.</p>
<h2>The rules</h2>
<ul>
<li>Test only on your own account and your own games. If you reach another player's account or data, stop at the smallest proof, do not keep it, and tell Zaisma.</li>
<li>No denial of service, and nothing that slows Zaisma for other players.</li>
<li>No spam, phishing or tricking other players, on Zaisma or anywhere else.</li>
<li>Never upload illegal content, even to prove a point. Child sexual abuse material has no safe harbor: it is reported and passed to the police.</li>
<li>Give Zaisma ${DISCLOSURE_WAIT_DAYS} days to fix a hole before you publish it. Past that, Zaisma cannot promise to stay quiet.</li>
</ul>`,
      ),
      pane(
        "What to expect",
        html`<h2>What to expect</h2>
<p>Zaisma replies within ${REPLY_WITHIN_DAYS} days, and aims to fix serious holes within ${FIX_WITHIN_DAYS}. Zaisma tells you when a hole is fixed.</p>
<h2>Rewards</h2>
<p>There is no cash reward yet. Zaisma is small, and would rather say so than promise what it cannot pay.</p>
<h2>Something else</h2>
<p>A game that breaks the rules, or anything about children's safety, goes to ${textLink("safety@zaisma.com", "mailto:safety@zaisma.com")}, not here. Copyright is on the ${textLink("DMCA page", "/legal/dmca")}.</p>`,
      ),
      ...(hasPromises ? [pane("What Zaisma promises", securityPromisesSection(PUBLISHED_PROMISES))] : []),
    ],
  });
}

/**
 * The game page's script: Play, the pictures, tabs and rooms, the menu, Share, and what the game says
 * through the frame. Its values come in the page's game-page-data block, as gamePage; the page's other
 * scripts come after it and use gamePage, frame and gameOrigin.
 */
const GAME_PAGE_SCRIPT = pageScript("game-page", String.raw`const gamePage = JSON.parse(document.getElementById("game-page-data").textContent);
let frame = null;
const share = document.getElementById("share");
// The game only loads when the player taps Play. That tap also lets the game play sound straight away.
function play() {
  if (frame) return;
  // A tester link's game stays off Continue playing and out of the play stats; its play is checked only for multiplayer.
  if (!gamePage.tester_token) remember();
  if (!gamePage.tester_token || gamePage.is_multiplayer) countPlay();
  frame = document.getElementById("game-frame").content.firstElementChild.cloneNode(true);
  if (gamePage.tester_token) {
    // The game's tester address opens only with a one-use grant, fetched now so it's fresh.
    const opening = frame;
    fetch("/t/" + gamePage.tester_token + "/enter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room_code: gamePage.room_code }) })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((entered) => { opening.src = entered.frame_url; })
      .catch(() => { location.reload(); });
  } else if (gamePage.is_accounts_only && !window.startSaves) openGameAt(frame, gamePage.frame_query);
  if (window.startSaves) startSaves(frame);
  document.body.appendChild(frame);
  // The panes and the background fade, then the page turns into the game: the bar beside it, everything else aside, and the
  // background stops drawing. The glass goes back to the theme's own: the game, whatever its colors, is behind it now.
  document.documentElement.classList.add("is-leaving");
  const isStill = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    document.documentElement.classList.replace("is-leaving", "is-playing");
    document.querySelectorAll(".backdrop").forEach((backdrop) => { if (window.zaismaBackdrop) zaismaBackdrop.remove(backdrop); backdrop.remove(); });
    if (window.zaismaBackdrop) zaismaBackdrop.forgetGlass();
  }, isStill ? 0 : 250);
  // The warm-up's downloads are the game's by now: the game's own requests share what's still coming.
  if (warming) setTimeout(() => { warming.remove(); warming = null; }, 30000);
  // Friends see what the player is playing (friends-now.ts), but not a tester link's game.
  if (!gamePage.tester_token) document.body.dataset.presenceGame = gamePage.slug;
  scrollTo(0, 0);
  frame.focus();
}
// An accounts-only game's address opens only through an entry, fetched now so it's fresh, which the
// games server swaps for its cookie before opening pathInGame. The saves script opens the game through here too.
if (gamePage.is_accounts_only) {
  window.openGameAt = (opening, pathInGame) => {
    fetch("/api/plays/" + gamePage.slug + "/entry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ then: pathInGame }) })
      .then((response) => response.json().then((answer) => (response.ok ? answer : Promise.reject(answer))))
      .then((entered) => { opening.src = entered.entry_url; })
      .catch((answer) => {
        const errorCode = answer && answer.error && answer.error.code;
        if (errorCode === "account_needed") location.href = gamePage.sign_in_url;
        else if (errorCode === "game_not_open_to_player") location.reload();
      });
  };
}
const playStart = document.getElementById("play");
if (playStart) playStart.onclick = play;
// Game files start before Play: while the player reads the page, the files the game needs first download, up to
// 100 MB, in a hidden frame on the game's own address (the browser keeps each site's cache apart). On computers, and
// on Android phones and tablets that say they're on Wi-Fi; on iPhones, which never say, only a game whose start files
// come to ${PERFORMANCE_CHECK_LIMITS.maximumPhoneWarmUpSizeBytes / 1000 ** 2} MB or less, all or none; never on other phones and tablets, or with Data Saver.
// On a page prepared ahead, this script waits until the page is opened (prepared-pages.ts), so nothing warms for a page never opened.
let warming = null;
function warmUp() {
  const connection = navigator.connection;
  const isComputer = !matchMedia("(pointer: coarse)").matches;
  const isAndroidOnWifi = /Android/.test(navigator.userAgent) && connection && (connection.type === "wifi" || connection.type === "ethernet");
  const isIPhone = /iPhone/.test(navigator.userAgent);
  // An iPad downloads nothing ahead of time: its warm-up only keeps redirects (warm.js), so an update there downloads only what changed.
  const isIPad = !isComputer && (/iPad/.test(navigator.userAgent) || navigator.platform === "MacIntel");
  if (frame || !gamePage.warm_url || (connection && connection.saveData === true) || !(isComputer || isAndroidOnWifi || isIPhone || isIPad)) return;
  warming = document.createElement("iframe");
  warming.src = gamePage.warm_url + (isComputer || isAndroidOnWifi ? "" : "?maximum_start_size_bytes=" + (isIPad ? 0 : ${PERFORMANCE_CHECK_LIMITS.maximumPhoneWarmUpSizeBytes}));
  warming.setAttribute("sandbox", "allow-scripts allow-same-origin");
  warming.hidden = true;
  warming.setAttribute("aria-hidden", "true");
  warming.tabIndex = -1;
  warming.title = "";
  document.body.appendChild(warming);
}
if (document.readyState === "complete") setTimeout(warmUp, 1000);
else addEventListener("load", () => setTimeout(warmUp, 1000));
document.getElementById("share-page").onclick = (e) => shareFrom(e.currentTarget);
// Remember the game for Continue playing: on this device (and in PLAYED_COOKIE, so the home shows it from its first paint), and with the account when signed in.
${KEEP_PLAYED_COOKIE_SOURCE}
function remember() {
  try {
    const list = JSON.parse(localStorage.getItem("zaisma:played") || "[]").filter((p) => p.slug !== gamePage.slug);
    list.unshift({ slug: gamePage.slug, played_at_ms: Date.now() });
    localStorage.setItem("zaisma:played", JSON.stringify(list.slice(0, 20)));
    keepPlayedCookie(list);
  } catch {}
  if (/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) fetch("/api/me/played/" + gamePage.slug, { method: "POST", keepalive: true }).catch(() => {});
}
// A guest's last time here, from this device's list (an account's comes with the page, and a device's list may be someone else's), and
// the updates since: ago() in foundations.ts.
(() => {
  const lastPlayed = document.getElementById("last-played");
  if (!lastPlayed || !lastPlayed.hidden || /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) return;
  let playedAtMs = 0;
  try { playedAtMs = Number((JSON.parse(localStorage.getItem("zaisma:played") || "[]").find((entry) => entry.slug === gamePage.slug) || {}).played_at_ms) || 0; } catch {}
  if (!playedAtMs) return;
  const minuteCount = Math.max(1, Math.round((Date.now() - playedAtMs) / 60000)), dayCount = Math.round(minuteCount / 1440);
  lastPlayed.querySelector(".key-detail-value").textContent = minuteCount < 60 ? minuteCount + " min ago" : minuteCount < 1440 ? Math.round(minuteCount / 60) + " h ago" : dayCount === 1 ? "yesterday" : dayCount + " days ago";
  document.getElementById("new-since").hidden = !(gamePage.latest_update_at_ms > playedAtMs);
  lastPlayed.hidden = false;
  document.getElementById("live-line")?.removeAttribute("hidden");
})();
// Friends playing this game, under the title, with Join (friends-now.ts).
const friendsHere = document.getElementById("friends-here");
if (friendsHere && /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) {
  fetch("/g/" + gamePage.slug + "/friends").then((r) => (r.ok ? r.text() : "")).then((fragment) => {
    const arrived = document.createElement("template");
    arrived.innerHTML = fragment;
    const detail = arrived.content.querySelector(".key-detail");
    if (!detail) return;
    friendsHere.replaceChildren(...detail.childNodes);
    friendsHere.hidden = false;
    document.getElementById("live-line")?.removeAttribute("hidden");
  }).catch(() => {});
}
// Rooms come and go: while the list is on screen, it's brought up to date every 20 seconds. The
// rooms already loaded stay open across updates.
const roomsPanel = document.getElementById("rooms");
let isRoomsSeen = false;
if (roomsPanel) new IntersectionObserver((entries) => { isRoomsSeen = entries.some((entry) => entry.isIntersecting); if (isRoomsSeen) refreshRooms(); }).observe(roomsPanel);
let roomsAt = Date.now();
let roomsRegion = "";
let roomsLabels = {};
// The order is in the address (room_order), so a refresh or a shared link keeps it.
const roomOrders = ${JSON.stringify(ROOM_ORDERS)};
const askedFor = new URLSearchParams(location.search);
let roomsOrder = roomOrders.includes(askedFor.get("room_order")) ? askedFor.get("room_order") : roomOrders[0];
// Full rooms always show, last in every order: nothing on the page hides them any more, so an old link's setting is let go.
// The region a device kept before the region menu stopped being remembered.
try { localStorage.removeItem("zaisma:rooms-region"); } catch {}
const roomsKey = () => roomsRegion + "|" + JSON.stringify(Object.entries(roomsLabels).sort()) + "|" + roomsOrder;
// The room this tab just left, so the list doesn't show the player in it while room lists catch up (about 15 seconds).
const leftKey = "zaisma:left:" + gamePage.slug;
function justLeft() {
  try {
    const left = JSON.parse(sessionStorage.getItem(leftKey) || "null");
    const ago = left ? Date.now() - left.at : -1;
    return ago >= 0 && ago < 30000 && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(left.code) ? left.code + "." + ago + "." + (Date.now() - left.joined) : null;
  } catch { return null; }
}
// The room the game is in now and since when, as it says (zaisma:room, zaisma:left).
let inRoom = null;
// The game left the room it was in: lists leave the player out of it while they catch up.
function leftRoom() {
  if (!inRoom) return;
  try { sessionStorage.setItem(leftKey, JSON.stringify({ code: inRoom.code, at: Date.now(), joined: inRoom.at })); } catch {}
  inRoom = null;
}
async function refreshRooms(force) {
  // The automatic refresh waits while nobody's looking; a pick the player just made always loads.
  if (!roomsPanel || (!isRoomsSeen && !force) || frame || (document.hidden && !force)) return;
  const list = document.getElementById("rooms-list");
  const shown = list.firstElementChild?.dataset.shown || "|[]|" + roomOrders[0] + "|false";
  if (!force && shown === roomsKey() && Date.now() - roomsAt < 19000) return;
  // A refresh keeps the rooms the player loaded (Load more); past ${MAXIMUM_REFRESHED_ROOM_COUNT} rows the list is left as it is, and another region or label starts over at the first page.
  const isSamePick = shown === roomsKey();
  const loadedRows = isSamePick ? list.querySelectorAll("#rooms-rows > li").length : 0;
  if (!force && loadedRows > ${MAXIMUM_REFRESHED_ROOM_COUNT}) return;
  roomsAt = Date.now();
  try {
    const query = new URLSearchParams();
    if (roomsRegion) query.set("region", roomsRegion);
    if (Object.keys(roomsLabels).length) query.set("labels", JSON.stringify(roomsLabels));
    if (roomsOrder !== roomOrders[0]) query.set("room_order", roomsOrder);
    if (loadedRows > 0) query.set("shown_row_count", String(Math.min(loadedRows, ${MAXIMUM_REFRESHED_ROOM_COUNT})));
    const left = justLeft();
    if (left) query.set("left", left);
    const res = await fetch(location.pathname + "/rooms" + (query.size ? "?" + query : ""));
    if (!res.ok) return;
    const scrolledTo = isSamePick ? document.getElementById("rooms-rows")?.scrollTop || 0 : 0;
    list.innerHTML = await res.text();
    const fresh = document.getElementById("rooms-rows");
    if (fresh && scrolledTo) fresh.scrollTop = scrolledTo;
    const playing = Number(list.firstElementChild?.dataset.playing || 0);
    const line = document.getElementById("playing-now");
    if (line) {
      line.hidden = playing < ${MINIMUM_PLAYING_NOW_PLAYER_COUNT};
      line.querySelector(".key-detail-value").textContent = playing.toLocaleString("en-US");
      // The live line holding it shows once it has something to say: people playing, or friends.
      const liveLine = document.getElementById("live-line");
      if (liveLine && !line.hidden) liveLine.hidden = false;
    }
  } catch {} finally {
    hideStale(false);
  }
}
// Just back from a match, the list and the count still have this player in them: they're hidden until the fresh copy lands.
function hideStale(isHidden) {
  for (const id of ["rooms-list", "playing-now"]) { const el = document.getElementById(id); if (el) el.style.visibility = isHidden ? "hidden" : ""; }
}
if (roomsPanel) {
  // Back on the page just after leaving a match: show the list without this player in it, straight away.
  const comeBack = () => {
    if (!justLeft()) return;
    hideStale(true);
    setTimeout(() => hideStale(false), 2000);
    refreshRooms("left");
  };
  comeBack();
  // Back to this page from the browser's back-forward cache, which keeps the list as it was: bring it up to date.
  addEventListener("pageshow", (e) => { if (e.persisted) justLeft() ? comeBack() : refreshRooms(true); });
  setInterval(refreshRooms, 5000);
  document.addEventListener("visibilitychange", () => refreshRooms());
  roomsPanel.addEventListener("click", (e) => {
    // The order's switch: the address keeps it without adding a step to Back.
    const orderPick = e.target.closest("button[data-room-order]");
    if (orderPick) {
      roomsOrder = roomOrders.includes(orderPick.dataset.roomOrder) ? orderPick.dataset.roomOrder : roomOrders[0];
      const address = new URL(location.href);
      roomsOrder === roomOrders[0] ? address.searchParams.delete("room_order") : address.searchParams.set("room_order", roomsOrder);
      history.replaceState(history.state, "", address);
      refreshRooms(true);
      return;
    }
    // One of the game's options (a mode, a map): Any takes it off.
    const labelPick = e.target.closest("button[data-label-name]");
    if (labelPick) {
      if (labelPick.dataset.labelValue) roomsLabels[labelPick.dataset.labelName] = labelPick.dataset.labelValue;
      else delete roomsLabels[labelPick.dataset.labelName];
      refreshRooms(true);
    }
  });
  roomsPanel.addEventListener("change", (e) => {
    // On a phone the order and the game's options are menus: the same picks as their switches.
    const orderMenu = e.target.closest('input[name="room_order"]');
    if (orderMenu) {
      roomsOrder = roomOrders.includes(orderMenu.value) ? orderMenu.value : roomOrders[0];
      const address = new URL(location.href);
      roomsOrder === roomOrders[0] ? address.searchParams.delete("room_order") : address.searchParams.set("room_order", roomsOrder);
      history.replaceState(history.state, "", address);
      refreshRooms(true);
      return;
    }
    const labelMenu = e.target.closest("input[data-label]");
    if (labelMenu) {
      if (labelMenu.value) roomsLabels[labelMenu.dataset.label] = labelMenu.value;
      else delete roomsLabels[labelMenu.dataset.label];
      refreshRooms(true);
      return;
    }
    // The region's menu.
    const regionPick = e.target.closest('input[name="room_region"]');
    if (!regionPick) return;
    roomsRegion = regionPick.value;
    refreshRooms(true);
  });
}
const codeInput = document.getElementById("room-code");
if (codeInput) {
  codeInput.addEventListener("input", () => codeInput.setCustomValidity(""));
  codeInput.addEventListener("invalid", () => codeInput.setCustomValidity("Room codes are 6 letters and numbers, like ABC234."));
}
// Games for other devices still open, with a word of warning.
const DEVICES = gamePage.devices;
const coarse = matchMedia("(pointer: coarse)").matches;
const mine = coarse ? (Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet") : "computer";
const deviceNotes = [];
// Threads need the game's frame isolated (Document-Isolation-Policy): Chromium 137+, never on iPhone or iPad, whose Chrome is WebKit.
// userAgentData is only in Chromium browsers, so Firefox and Safari get the note with no list to keep.
const chromium = navigator.userAgentData?.brands?.find((b) => b.brand === "Chromium");
const canIsolateFrame = Boolean(chromium && Number(chromium.version) >= 137 && !/iPhone|iPad/.test(navigator.userAgent));
const needsOtherBrowser = gamePage.has_threads && !canIsolateFrame;
if (needsOtherBrowser) deviceNotes.push("This game needs Chrome or Edge on a computer or Android.");
if (DEVICES.length && !DEVICES.includes(mine)) deviceNotes.push("Made for " + DEVICES.map((d) => d + "s").join(" and ") + ". It may not work well on this " + mine + ".");
// Controls and screen only come up when they don't fit this device.
const CONTROLS = gamePage.controls;
if (CONTROLS.length) {
  if (coarse && !CONTROLS.includes("touch")) deviceNotes.push(CONTROLS.includes("keyboard_mouse") ? "Needs a keyboard." : "Needs a gamepad.");
  else if (!coarse && !CONTROLS.includes("keyboard_mouse") && !CONTROLS.includes("touch")) deviceNotes.push("Needs a gamepad.");
}
const SCREEN = gamePage.screen_orientation;
if (coarse && (SCREEN === "landscape" || SCREEN === "portrait")) deviceNotes.push(SCREEN === "landscape" ? "Best in landscape." : "Best in portrait.");
// The page says it from the first paint for the device the server guessed (deviceNoteFor); measured here, it changes only where the guess
// was wrong (a tablet whose browser calls itself a computer's).
{
  const note = document.getElementById("device-note"), words = deviceNotes.join(" ");
  if (note.querySelector(".banner-text").textContent !== words) note.querySelector(".banner-text").textContent = words;
  // Amber only when this browser can't start the game at all.
  note.querySelector(".banner-in").classList.toggle("tone-warning", needsOtherBrowser);
  note.hidden = !deviceNotes.length;
}
// A tap into the game never reaches this page: the page losing focus closes an open menu instead.
window.addEventListener("blur", () => document.querySelectorAll('.dropdown[role="menu"]:popover-open').forEach((menu) => { const opener = document.querySelector('[aria-controls="' + menu.id + '"][aria-expanded="true"]'); if (opener) opener.click(); }));
// The room in the menu's Room: the room's code while the game is in a room (zaisma:room, then zaisma:players says
// whether it takes others), with Copy, and Join by code. In streamer mode (an account setting) the code starts
// hidden: the eye shows it on this page, and Share blurs it under Show.
const roomDialog = document.getElementById("players");
const isStreamerModeOn = gamePage.is_streamer_mode_on === true;
let isRoomCodeHidden = isStreamerModeOn;
let shownRoom = null;
function showRoomCode(room) {
  shownRoom = room;
  if (!document.getElementById("room-here")) return;
  document.getElementById("room-here").hidden = !room;
  document.getElementById("room-closed").hidden = !room || room.isOpen;
  const codeText = document.getElementById("room-code-text");
  codeText.textContent = room ? (isRoomCodeHidden ? "••••••" : room.code) : "";
  codeText.setAttribute("data-copy", room ? room.code : "");
  codeText.closest(".copy-field").classList.toggle("is-masked", isRoomCodeHidden);
  document.getElementById("room-code-shown").hidden = !room || !room.isOpen;
  const roomEye = document.getElementById("room-eye");
  roomEye.hidden = !isStreamerModeOn || !room || !room.isOpen;
  roomEye.setAttribute("aria-pressed", String(isRoomCodeHidden));
  roomEye.querySelector(".face > span:not([class])").textContent = isRoomCodeHidden ? "Show the room code" : "Hide the room code";
}
if (document.getElementById("bar-join-code")) {
  const joinInput = document.getElementById("bar-join-code");
  // Enter joins: the sheet's first submit button is its Close, which the browser would press.
  joinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinInput.form.requestSubmit(document.getElementById("room-join")); } });
  joinInput.addEventListener("input", () => joinInput.setCustomValidity(""));
  // Join goes to the room's link; the room the player is in already has nothing to leave.
  roomDialog.querySelector("form").addEventListener("submit", (e) => {
    if (!e.submitter || e.submitter.id !== "room-join") return;
    e.preventDefault();
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(joinInput.value)) {
      joinInput.setCustomValidity("Room codes are 6 letters and numbers, like ABC234.");
      joinInput.reportValidity();
      return;
    }
    if (shownRoom && joinInput.value === shownRoom.code) return roomDialog.close();
    location.href = location.pathname + "?room=" + joinInput.value;
  });
  document.getElementById("room-eye").onclick = () => {
    isRoomCodeHidden = !isRoomCodeHidden;
    showRoomCode(shownRoom);
  };
  showRoomCode(null);
}
// Share opens the share sheet: the address bar's link (with the room code while the player is in a match), its QR code for someone
// in the same room, the room code, Copy (the code fields' own, COPY_SCRIPT), and the system's share sheet where there is one.
const shareBox = document.getElementById("share-dialog");
const shareLink = document.getElementById("share-link");
// What streamer mode masks: the QR code, the room code and the link (Copy still copies them).
const shareSecrets = () => document.querySelectorAll("#share-dialog .copy-field, #share-qr-box .qr-code");
function shareFrom(button) {
  const url = location.origin + location.pathname + location.search.replace(/[?&]play\b[^&]*/, "").replace(/^&/, "?");
  const room = new URLSearchParams(location.search).get("room");
  shareLink.dataset.copy = url;
  shareLink.textContent = url.replace(/^https?:\/\//, "");
  document.getElementById("share-room").hidden = !room;
  document.getElementById("share-room-code").textContent = room || "";
  const isMasked = isRoomCodeHidden && Boolean(room);
  for (const secret of shareSecrets()) secret.classList.toggle("is-masked", isMasked);
  document.getElementById("share-reveal").hidden = !isMasked;
  const qr = document.getElementById("share-qr");
  if (qr) {
    qr.src = "/g/" + gamePage.slug + "/qr-code.svg" + (room ? "?room=" + encodeURIComponent(room) : "");
    document.getElementById("share-qr-caption").textContent = room ? "Scan with a phone's camera to join this match" : "Scan with a phone's camera to play";
  }
  if (!shareBox.open) shareBox.showModal();
  shareBox.returnFocus = button;
}
const shareMore = document.getElementById("share-more");
if (navigator.share) {
  shareMore.closest("li").hidden = false;
  shareMore.onclick = async () => {
    try { await navigator.share({ title: document.title, url: shareLink.dataset.copy }); shareBox.close(); } catch {}
  };
}
// Show, or a tap on the blurred link or room code, reveals them for this time.
const revealShare = () => { for (const secret of shareSecrets()) secret.classList.remove("is-masked"); document.getElementById("share-reveal").hidden = true; };
document.getElementById("share-reveal").onclick = revealShare;
shareBox.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".copy-field.is-masked .copy-field-text")) revealShare(); });
shareBox.addEventListener("close", () => { if (frame) frame.focus(); else if (shareBox.returnFocus) shareBox.returnFocus.focus(); });
share.onclick = () => shareFrom(share);
// The game says which room it's in, so the address bar (and so Share) points to that match.
const gameOrigin = new URL(gamePage.frame_url).origin;
// Whenever a sheet or card of Zaisma's covers the game, or stops, the game hears it (Zaisma.page.coveredBy), so it can pause.
addEventListener("zaisma:covered", (e) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: "zaisma:covered", coveredBy: e.detail.coveredBy }, gameOrigin); });
let isRentedShareTold = false;
const rentedShareLater = document.getElementById("rented-share-later");
if (rentedShareLater) rentedShareLater.onclick = () => zaismaLayers.leave(document.getElementById("rented-share"));
function tellRentedShareUsed() {
  if (isRentedShareTold) return;
  isRentedShareTold = true;
  const card = document.getElementById("rented-share");
  if (card && !/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) zaismaLayers.show(card);
  else zaismaLayers.say({ text: gamePage.rented_share_text, noticeUrgency: "ask" });
}
// The local preview shows the words by a link (?play&preview_bar=rented_share). Never on zaisma.com.
if (/^(localhost|127\.0\.0\.1|.+\.ts\.net)$/.test(location.hostname) && new URLSearchParams(location.search).get("preview_bar") === "rented_share") setTimeout(tellRentedShareUsed, 1000);
addEventListener("message", (e) => {
  if (!frame || e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (d && d.type === "zaisma:room" && typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code)) {
    // A room on the game's own server keeps its server in the link, so Share brings friends to it.
    const server = typeof d.serverUrl === "string" && /^(wss|https):\/\/[^/]/.test(d.serverUrl) ? "&server=" + encodeURIComponent(d.serverUrl) : "";
    history.replaceState(null, "", location.pathname + "?room=" + d.code + server);
    // The code comes first, for Share; joined once the room let the player in.
    if (d.joined === true) {
      inRoom = { code: d.code, at: Date.now() };
      if (!shownRoom || shownRoom.code !== d.code) showRoomCode({ code: d.code, isOpen: true });
    }
  }
  // The game's own Invite button (Zaisma.invite): Zaisma's invite sheet, only right after the player's tap. Invite hears whether it opened.
  // No game can open the menu: only the player's own press does (docs/principles/whose-game-is-it.md).
  if (d && d.type === "zaisma:share") {
    const answerShare = (isOpened) => typeof d.requestNumber === "number" && frame.contentWindow.postMessage({ type: "zaisma:share-answer", requestNumber: d.requestNumber, isOpened }, gameOrigin);
    if (navigator.userActivation && !navigator.userActivation.isActive) answerShare(false);
    else {
      try {
        shareFrom(share);
        answerShare(true);
      } catch {
        answerShare(false);
      }
    }
  }
  // Who's in the room, and whether it takes others by its code.
  if (d && d.type === "zaisma:players" && inRoom && d.code === inRoom.code && typeof d.isOpen === "boolean") showRoomCode({ code: d.code, isOpen: d.isOpen });
  // The game left a room (the player left, walked away, was moved or the match ended).
  if (d && d.type === "zaisma:left" && inRoom && d.code === inRoom.code) {
    leftRoom();
    showRoomCode(null);
  }
  // The game asks for its key to player passes: given once the check on Play has answered, only to this game,
  // with whose passes it gives (account or guest), so the game doesn't keep a pass from before the player signed in or out.
  if (d && d.type === "zaisma:room-key") {
    const reply = (given) => frame.contentWindow.postMessage({ type: "zaisma:room-key", key: given ? given.key : null, playerKind: given ? given.playerKind : null }, gameOrigin);
    typeof roomKey === "undefined" ? reply(null) : roomKey.then(reply);
  }
  // The game asks a guest to sign in (Zaisma.player.signIn).
  if (d && d.type === "zaisma:sign-in" && window.askSignIn) askSignIn();
  // This network's share of the game is used: only Zaisma can say why and offer signing in.
  if (d && d.type === "zaisma:rented-share-used") tellRentedShareUsed();
  // The game asks to open one of its registered links (Zaisma.links.open).
  if (d && d.type === "zaisma:link" && typeof d.requestNumber === "number" && typeof d.linkName === "string") askLink(d);
  // The game asks to buy one of its items (Zaisma.items.buy): the buy sheet rises over it.
  if (d && d.type === "zaisma:buy" && typeof d.requestNumber === "number" && typeof d.itemName === "string" && window.askBuy) askBuy(d);
  // The game's own save screens (Zaisma.saves) and its moment for "Keep your progress" (Zaisma.player.offerAccount),
  // answered by the saves script; a game without cloud saves here has none: cloud_saves_not_here when the game has
  // them on but this page can't (a tester link, or no accounts), cloud_saves_off when the game has them off.
  if (d && d.type === "zaisma:saves-request" && typeof d.requestNumber === "number" && typeof d.request === "string") {
    if (window.savesRequest) savesRequest(d);
    else if (d.request !== "listen") {
      const error = gamePage.cloud_saves_enabled
        ? { code: "cloud_saves_not_here", message: "Cloud saves don't work here: this is a tester link, or this Zaisma has no accounts. Save in the browser as usual; cloud saves work on the game's own page on Zaisma." }
        : { code: "cloud_saves_off", message: "This game has cloud saves off, so it has no saves on players' accounts." };
      frame.contentWindow.postMessage({ type: "zaisma:saves-answer", requestNumber: d.requestNumber, error }, gameOrigin);
    }
  }
  if (d && d.type === "zaisma:account-offer") {
    if (window.offerAccount) offerAccount();
    else frame.contentWindow.postMessage({ type: "zaisma:account-offer", status: gamePage.cloud_saves_enabled ? "cloud_saves_not_here" : "cloud_saves_off" }, gameOrigin);
  }
});
// Leaving the page while in a match leaves the room too (the game says goodbye as it goes). Only
// while the game is in one: a room the player already left has counted them out, and doing it again would count them twice.
addEventListener("pagehide", () => {
  if (frame) leftRoom();
});`);

/**
 * What the game page says about this device under Play, from the first paint: the same notes its script works out in the browser (the
 * game page's script, deviceNotes), here from the server's guess at the device (device-kind.ts) and the browser's name. isPlayedAnyway: a
 * game made for other devices or one this browser can't start; Play still says only Play, beside Share and Report, and the note says why.
 */
export function deviceNoteFor(options: { deviceKind: DeviceKind; canIsolateFrame: boolean; hasThreads: boolean; devices: string[]; controls: string[]; screenOrientation: string | null }): { notes: string[]; isOtherBrowserNeeded: boolean; isPlayedAnyway: boolean } {
  const isCoarse = options.deviceKind !== "computer";
  const isOtherBrowserNeeded = options.hasThreads && !options.canIsolateFrame;
  const isOtherDevice = options.devices.length > 0 && !options.devices.includes(options.deviceKind);
  const notes = [
    ...(isOtherBrowserNeeded ? ["This game needs Chrome or Edge on a computer or Android."] : []),
    ...(isOtherDevice ? [`Made for ${options.devices.map((device) => `${device}s`).join(" and ")}. It may not work well on this ${options.deviceKind}.`] : []),
    ...(options.controls.length && isCoarse && !options.controls.includes("touch") ? [options.controls.includes("keyboard_mouse") ? "Needs a keyboard." : "Needs a gamepad."] : []),
    ...(options.controls.length && !isCoarse && !options.controls.includes("keyboard_mouse") && !options.controls.includes("touch") ? ["Needs a gamepad."] : []),
    ...(isCoarse && (options.screenOrientation === "landscape" || options.screenOrientation === "portrait") ? [options.screenOrientation === "landscape" ? "Best in landscape." : "Best in portrait."] : []),
  ];
  return { notes, isOtherBrowserNeeded, isPlayedAnyway: isOtherBrowserNeeded || isOtherDevice };
}

/**
 * The game page's script for a game that needs an account: a guest (no zaisma_in cookie) sees how to
 * sign in (the page says so from its first paint), and for a whole game, or a room link, Play goes to sign in. Sets needsSignIn for
 * autoplay. Rooms refuse guests' passes either way; this is only so honest players never start a game
 * that turns them away.
 */
const ACCOUNT_GATE_SCRIPT = pageScript("account-gate", `// Guests are asked to sign in first, and come back to the same page or match.
const needsSignIn = !/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
// The page already says so (gamePage in pages.ts): Play says only Play and the note says how. A press goes to sign in.
if (needsSignIn && (gamePage.account_requirement === "whole_game" || gamePage.room_code)) {
  const playButton = document.getElementById("play");
  if (playButton) playButton.onclick = () => { location.href = gamePage.sign_in_url; };
}`);

/**
 * The game page in a frame of the home (the home plays a game in place by opening this page, so the two start a game the same way and can't
 * drift): the bar's Zaisma button and any link to the home say so to the home, which takes the frame away; a link to another page
 * opens as the whole window, never inside the frame; and the address a game moves to (a room's code) is told to the home, which shows it.
 */
const GAME_EMBEDDED_SCRIPT = pageScript("game-embedded", `if (window.top !== window) {
  const tell = (message) => window.parent.postMessage(message, location.origin);
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
    const target = new URL(link.href, location.href);
    if (target.origin !== location.origin || (target.pathname === location.pathname && target.search === location.search)) return;
    event.preventDefault();
    if (target.pathname === "/") tell({ type: "zaisma:home-back" });
    else window.top.location.href = target.href;
  });
  const replaceState = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => {
    replaceState(state, title, url);
    tell({ type: "zaisma:home-address", path: location.pathname + location.search });
  };
}`);

/** Last on the game page, once its other scripts are in: a room link or ?play starts the game straight away. */
const GAME_AUTOPLAY_SCRIPT = pageScript("game-autoplay", `if (gamePage.autoplay === "always" || (gamePage.autoplay === "when_signed_in" && !needsSignIn)) play();`);

/**
 * The game page's script for signing in while the game runs. The game asks (Zaisma.player.signIn) and
 * a card beside it offers an account; making one or signing in opens a new tab, so the game keeps
 * running. However the player signs in (here, "Keep your progress", or another tab), the game hears who
 * they are now (zaisma:signed-in), and in a multiplayer game the guest's room key is traded for one to
 * the account's passes. Not now tells the game the player declined.
 */
const SIGN_IN_WHILE_PLAYING_SCRIPT = pageScript("sign-in-while-playing", `const signInAsk = document.getElementById("sign-in-ask");
const signInText = document.getElementById("sign-in-text");
const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
let wasGuest = !isSignedIn();
let telling = null;
// Who the player is now, told to the game: the account, with the guest's room key traded for the account's.
function tellSignedIn() {
  if (!frame) return Promise.resolve(false);
  if (telling) return telling;
  telling = (async () => {
    const given = typeof roomKey === "undefined" ? null : await roomKey;
    const body = given && given.playerKind === "guest" ? { roomKey: given.key } : {};
    const answer = await fetch("/api/plays/" + gamePage.slug + "/account", { method: "POST", body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    telling = null;
    if (!answer) return false;
    if (answer.key) roomKey = Promise.resolve({ key: answer.key, playerKind: answer.playerKind });
    zaismaLayers.leave(signInAsk);
    frame.contentWindow.postMessage({ type: "zaisma:signed-in", player: answer.player }, gameOrigin);
    return true;
  })();
  return telling;
}
window.askSignIn = async () => {
  frame.contentWindow.postMessage({ type: "zaisma:sign-in", status: "asking" }, gameOrigin);
  // Signed in already: the game hears who they are at once. A sign-in that has run out asks again.
  if (!wasGuest && (await tellSignedIn())) return;
  wasGuest = true;
  signInText.textContent = "Make a free Zaisma account or sign in. The game keeps running here while you do.";
  const keep = document.getElementById("keep");
  if (keep) zaismaLayers.leave(keep);
  zaismaLayers.show(signInAsk);
  if (!signInAsk.hidden) signInAsk.querySelector("[data-sign-in]").focus();
};
document.getElementById("sign-in-later").onclick = () => {
  zaismaLayers.leave(signInAsk);
  if (!frame) return;
  frame.contentWindow.postMessage({ type: "zaisma:sign-in", status: "declined" }, gameOrigin);
  frame.focus();
};
// In a new tab, so the game keeps running. If the browser won't open one, the link goes there in this tab and comes back to the game.
signInAsk.querySelectorAll("[data-sign-in]").forEach((a) => a.addEventListener("click", (e) => {
  if (!window.open(a.dataset.signIn + "?next=" + encodeURIComponent("/account/kept?game=" + gamePage.slug), "_blank")) return;
  e.preventDefault();
  signInText.textContent = "Finish in the new tab, then come back here.";
}));
// Signed in from another tab: tell the game once it's running.
function checkSignedIn() {
  if (!wasGuest || !isSignedIn()) return;
  if (!frame) { wasGuest = false; return; }
  tellSignedIn().then((isTold) => { if (isTold) wasGuest = false; });
}
addEventListener("focus", checkSignedIn);
document.addEventListener("visibilitychange", checkSignedIn);
try { new BroadcastChannel("zaisma").addEventListener("message", (e) => e.data === "signed-in" && checkSignedIn()); } catch {}`);

