import {
  ALLOWED_CONTENT,
  purchaseLabelFor,
  purchaseSettingsOf,
  refundPolicyWords,
  type PurchaseLabel,
  canOpenLink,
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
  testerLinkOpened,
  testerLinkVersion,
  versionById,
  type ContentRule,
  type Game,
  type TesterLink,
} from "@zaisma/core";
import { authConfigured } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { cutButton, runButton, textLink } from "./components/actions.ts";
import { codeField } from "./components/inputs.ts";
import { cutField } from "./components/fields.ts";
import { glanceFacts } from "./components/data.ts";
import { glassPane, type IconName } from "./components/foundations.ts";
import { grid, row, stack, track, type LayoutItem } from "./components/layout.ts";
import { banner, dropdown, sheet } from "./components/panes.ts";
import { person } from "./components/people.ts";
import { gameCard, playingBar, playingCard, playingCheck, screenshot, screenshotLarge } from "./components/playing.ts";
import { facts, readingText } from "./components/reading.ts";
import { backgroundMarkup, backgroundOf } from "./backgrounds.ts";
import { glassMessage, html, layout, pageData, raw, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { showcase } from "./home.ts";
import { viewerOf } from "./viewer.ts";
import { SAVES_SCRIPT } from "./saves-client.ts";
import { reportSheet } from "./report.ts";
import { blockSheet } from "./blocks.ts";
import { playersSheet } from "./players-sheet.ts";
import { GAME_UPDATES_SCRIPT, connectionPlate, updateBarButtons } from "./game-updates.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, PLAY_COUNTER_SCRIPT, ageRefusal, playingNowCounts } from "./plays.ts";
import { profilePath } from "./profiles.ts";
import { MAXIMUM_REFRESHED_ROOM_COUNT, codeBox, pageRooms, readRoomPick, roomsOnPage, roomsPanel, tabCount } from "./rooms.ts";
import { checkPreviewLinkToken, readPreviewLinkToken } from "./preview-links.ts";
import { GAME_LINKS_SCRIPT, developerLinks, leavingCard } from "./game-links.ts";
import { BUY_SHEET_SCRIPT, buySheet, buySheetData, buySheetStripe } from "./buy-sheet.ts";
import { PASSKEY_SCRIPT } from "./passkeys.ts";
import { STILL_THERE_SCRIPT, stillThereCard } from "./still-there.ts";
import { gamePageHead, shareDialog } from "./share-cards.ts";
import { DISCLOSURE_WAIT_DAYS, FIX_WITHIN_DAYS, REPLY_WITHIN_DAYS, SECURITY_ADVISORY_URL, SECURITY_REPORT_EMAIL, SECURITY_TEXT_FILE_PATH } from "./security-policy.ts";

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

export async function gamePage(env: Env, slug: string, request: Request, tester?: TesterLink): Promise<Response> {
  const url = new URL(request.url);
  const game = await gameBySlug(env.DB, slug);
  if (!game || (!tester && (game.review_status === "pending" || game.visibility === "draft" || game.visibility === "private"))) return glassMessage(env, "Game not found", "Check the link and try again.", 404);
  if (game.review_status === "removed") return glassMessage(env, "This game was removed", "It broke Zaisma's content rules or was taken down on request.", 410);
  if (game.review_status === "held") return glassMessage(env, "This game is being reviewed", "Someone reported it and we're taking a look. Try again later.", 404);
  // Blocked in the player's country on a notice under its law, and only there (country-blocks.ts).
  const countryCode = requestCountryCode(request);
  if (isBlockedInCountry(game, countryCode)) return glassMessage(env, "This game isn't available in your country", `A legal notice under your country's law (${countryName(countryCode!)}) blocks it here. It's still available everywhere else.`, 451);
  const testerVersion = tester ? await testerLinkVersion(env.DB, game, tester) : null;
  if (tester && !testerVersion) return glassMessage(env, "Nothing to play yet", "The version this link opens isn't there yet: the developer hasn't published one, or it was deleted. Try the link again later.", 404);
  const here = tester ? `/t/${tester.token}` : `/g/${game.slug}`;
  const hidden = game.visibility === "draft" || game.visibility === "private";
  // A game for older players (docs/DECISIONS.md, "Games can keep out younger age bands"): a younger account
  // sees its details, closed, and nothing on the page says an age. The viewer's age also picks More games.
  const viewer = await viewerOf(request, env);
  const isClosed = Boolean(viewer.account && !isOldEnoughFor(viewer.account.age_band, game.minimum_player_age_years));

  const ownServerUrls = ownServerUrlsOf(game);
  // A room link (zaisma.com/g/<slug>?room=CODE) drops the player straight into that match.
  const code = url.searchParams.get("room")?.toUpperCase() ?? "";
  const inRoom = ROOM_CODE.test(code) && !isClosed;
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
  const isTestBuild = Boolean(testerVersion && testerVersion.id !== game.live_version_id);
  const multiplayer = (game.multiplayer_mode !== "none" || ownServerUrls.length > 0) && !isTestBuild;
  // Rooms on Zaisma have codes players can type into the bar to join (a room link does the same).
  const hasRoomCodes = game.multiplayer_mode !== "none" && !isTestBuild && !isClosed;
  const ownServers = ownServerUrls.map((server) => new URL(server).host);
  const autoplay = !isClosed && (inRoom || url.searchParams.has("play"));
  // A game that needs an account for the whole game or for multiplayer asks guests to sign in, and brings them back to the same match.
  const accountRequirement = authConfigured(env) ? game.account_requirement : "none";
  // An accounts-only game's public address opens only through the entry Play fetches (handlePlayEntry).
  const isAccountsOnly = accountRequirement === "whole_game" && !tester;
  const accountNext = encodeURIComponent(`${here}${inRoom ? roomQuery : "?play"}`);
  // A game can ask a guest to sign in while it runs (Zaisma.player.signIn).
  const canSignIn = authConfigured(env);
  const playedVersionId = testerVersion?.id ?? game.live_version_id;
  const [developer, pictures, updates, others, live, playingNow, playedVersion] = await Promise.all([
    game.owner_id
      ? env.DB.prepare("SELECT accounts.username AS name, (SELECT COUNT(*) FROM games WHERE owner_id = ? AND review_status = 'live' AND visibility = 'listed') AS game_count FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(game.owner_id, game.owner_id).first<{ name: string; game_count: number }>()
      : null,
    // The square cover is only for phones' game cards, not one of the game's pictures.
    env.DB.prepare("SELECT id, kind FROM game_images WHERE game_id = ? AND review_status = 'approved' AND kind IN ('cover', 'screenshot') ORDER BY kind = 'cover' DESC, created_at_ms").bind(game.id).all<{ id: string; kind: string }>(),
    env.DB.prepare("SELECT id, patch_notes, published_at_ms FROM versions WHERE game_id = ? AND published_at_ms IS NOT NULL AND patch_notes != '' ORDER BY published_at_ms DESC LIMIT 10").bind(game.id).all<{ id: string; patch_notes: string; published_at_ms: number }>(),
    showcase(env, viewer.ageFloorYears, 60, countryCode),
    // Games on Zaisma rooms: who's playing now, and the rooms to list if the developer shows them here.
    // Not on tester links: their rooms are reached by code and invite link.
    game.multiplayer_mode !== "none" && !tester && !isClosed ? pageRooms(env, game, request, readRoomPick(url.searchParams)) : null,
    playingNowCounts(env),
    // Whether the version this page plays needs threads (ScanReport.has_threads), without reading the whole report.
    playedVersionId ? env.DB.prepare("SELECT json_extract(scan_report, '$.has_threads') = 1 AS has_threads FROM versions WHERE id = ?").bind(playedVersionId).first<{ has_threads: number | null }>() : null,
  ]);
  const rooms = live && roomsOnPage(game) ? live : null;
  // Checked browsers with the game on screen, and everyone in its rooms (who may have come in another way): the larger.
  const playingNowPlayerCount = Math.max(playingNow.get(game.id) ?? 0, live ? live.playing.playerCount : 0);
  const shots = pictures.results.map((picture) => `/img/${picture.id}`);
  // The game's own cover, across the top of the buy sheet (items have no pictures of their own); null where the developer has none yet.
  const coverPicture = pictures.results.find((picture) => picture.kind === "cover");
  const coverUrl = coverPicture ? `/img/${coverPicture.id}` : null;
  const more = [...others.filter((otherGame) => otherGame.slug !== game.slug && otherGame.owner_id && otherGame.owner_id === game.owner_id), ...others.filter((otherGame) => otherGame.slug !== game.slug && (!otherGame.owner_id || otherGame.owner_id !== game.owner_id))].slice(0, 4);
  const purchaseLabel = await purchaseLabelFor(env.DB, game);
  const refundWords = refundPolicyWords(purchaseSettingsOf(game));
  const devices = game.devices ? game.devices.split(",") : [];
  const controls = game.controls ? game.controls.split(",") : [];
  const playModes = readPlayModes(game.play_modes);
  const describedModes = playModes ? describePlayModes(playModes) : game.multiplayer_mode !== "none" ? [{ mode: "online" as const, label: "Online multiplayer", playerCount: null }] : [];
  const gameFacts = [
    ...(describedModes.length ? [{ label: "Players", entries: describedModes.map((playMode) => ({ text: playMode.playerCount ? `${playMode.label}, ${playMode.playerCount}` : playMode.label, icon: MODE_ICON_NAMES[playMode.mode] })) }] : []),
    ...(devices.length ? [{ label: "Works on", entries: devices.map((device) => ({ text: DEVICE_LABELS[device] ?? device, icon: DEVICE_ICON_NAMES[device] ?? ("computer" as const) })) }] : []),
  ];
  // What the game sells, before anyone plays ("Every game that sells something states its refund policy"), under About.
  const purchaseFacts = [
    { label: "Purchases", text: purchaseWords(purchaseLabel) },
    ...(purchaseLabel.categories.length && refundWords ? [{ label: "Refunds", text: refundWords }] : []),
  ];
  const isSignedInAdult = viewer.account?.age_band === "18+";
  const pageLinks = linksOf(game).filter((link) => link.is_on_game_page && canOpenLink(link, isSignedInAdult));
  const background = await backgroundOf(env, game, isPhoneRequest(request) ? "phone" : "wide");
  const gameOrigin = new URL(frameUrl).origin;
  const testerWords = tester
    ? `You're testing this game with a link from its developer.${isTestBuild ? ` It opens a version players don't have yet${game.multiplayer_mode !== "none" || ownServers.length ? ", so online play is off: it works only on the version players have" : ""}.` : ""}${hidden ? " It isn't public yet: anyone with this link can play, so only share it with other testers." : ""} Your progress stays in this browser.${tester.ends_at_ms ? ` The link works until ${day(tester.ends_at_ms)}.` : ""}`
    : "";
  const reportHref = `/g/${game.slug}/report`;
  // The pane's actions: Play (the page's one orange), Details down to About, Share and Report.
  const paneActions = stack({
    items: [
      ...(isClosed ? [] : [{ kind: "control" as const, markup: runButton("Play", { id: "play", type: "button", isBig: true, isFullWidth: true, icon: "play" }) }]),
      {
        kind: "block",
        markup: row({
          widths: "lead-fills",
          label: "Details, Share and Report",
          items: [
            { kind: "control", markup: cutButton("Details", { href: "#about", isBig: true }) },
            { kind: "control", markup: cutButton("Share", { id: "share-page", type: "button", icon: "share", isLabelHidden: true, isBig: true, controls: "share-dialog" }) },
            { kind: "control", markup: cutButton("Report", { href: reportHref, icon: "flag", isLabelHidden: true, isBig: true, dataAttributes: { report: "" } }) },
          ],
        }),
      },
    ],
  });
  const accountNote = accountRequirement !== "none" && !isClosed
    ? html`<p id="account-note">${accountRequirement === "whole_game" ? "Needs a Zaisma account" : "Playing online needs a Zaisma account"}<span id="account-ask" hidden>. ${textLink("Make one free", `/join?next=${accountNext}`)} or ${textLink("sign in", `/signin?next=${accountNext}`)}${accountRequirement === "whole_game" ? " to play" : " to play with others"}</span>.</p>`
    : null;
  const gamePane = glassPane({
    paneWidth: "fit",
    isStartedLow: true,
    label: game.title,
    body: stack({
      items: [
        { kind: "words", markup: html`<h1 id="title">${game.title}</h1>` },
        ...(developer ? [{ kind: "words" as const, markup: html`<p>by ${textLink(developer.name, profilePath(developer.name), { isQuiet: true })}</p>` }] : []),
        { kind: "block", id: "playing-now", isHidden: playingNowPlayerCount < MINIMUM_PLAYING_NOW_PLAYER_COUNT, markup: glanceFacts({ playerCount: playingNowPlayerCount }) },
        ...(tester || !canSignIn || isClosed ? [] : [{ kind: "block" as const, id: "friends-here", isHidden: true, markup: html`` }]),
        ...(tester ? [{ kind: "block" as const, markup: banner({ text: testerWords, icon: "info", tone: "warning" }) }] : []),
        ...(isClosed ? [{ kind: "words" as const, id: "closed", markup: html`<p>This game isn't open to your account. ${textLink("Find other games", "/")}</p>` }] : []),
        { kind: "block", markup: paneActions },
        ...(accountNote ? [{ kind: "words" as const, markup: accountNote }] : []),
        { kind: "block", id: "device-note", isHidden: true, markup: banner({ text: "", icon: "warning" }) },
        ...(gameFacts.length ? [{ kind: "words" as const, markup: facts({ facts: gameFacts, arrangement: "across", label: "About playing it" }) }] : []),
      ],
    }),
  });
  const section = (id: string, title: string, items: LayoutItem[]): LayoutItem => ({
    kind: "block",
    id,
    markup: glassPane({ paneWidth: "full", label: title, body: stack({ items: [{ kind: "words", markup: html`<h2>${title}</h2>` }, ...items] }) }),
  });
  const description = game.description.trim();
  const developerGames = more.filter((otherGame) => otherGame.owner_id && otherGame.owner_id === game.owner_id);
  const sections: LayoutItem[] = [
    ...(rooms ? [section("rooms", "Rooms", [{ kind: "block", markup: codeBox(game.slug) }, { kind: "block", id: "rooms-list", markup: roomsPanel(game, rooms) }])] : []),
    ...(shots.length
      ? [section("screenshots", "Screenshots", [{ kind: "block", markup: track({ id: "screenshots-track", itemSize: "cover", label: "Screenshots", items: shots.map((shot, shotIndex) => ({ kind: "block" as const, markup: screenshot({ imageUrl: shot, label: `Screenshot ${shotIndex + 1} of ${shots.length}`, sheetId: `screenshot-${shotIndex + 1}` }) })) }) }])]
      : []),
    section("about", "About", [
      { kind: "block", markup: readingText({ markup: description ? paragraphs(description) : html`<p>The developer hasn't written about this game yet.</p>` }) },
      { kind: "words", markup: facts({ facts: purchaseFacts, arrangement: "down", label: "Purchases and refunds" }) },
      ...(developer ? [{ kind: "block" as const, markup: person({ username: developer.name, href: profilePath(developer.name), note: developer.game_count === 1 ? "1 game on Zaisma" : `${developer.game_count} games on Zaisma` }) }] : []),
      ...(pageLinks.length ? [{ kind: "block" as const, markup: html`${developerLinks(pageLinks)}` }] : []),
    ]),
    ...(updates.results.length
      ? [section("updates", "Updates", [{ kind: "block", markup: readingText({ markup: html`${updates.results.map((update) => html`<h3>${day(update.published_at_ms)}</h3>${paragraphs(update.patch_notes)}`)}` }) }])]
      : []),
    ...(developerGames.length && developer
      ? [section("more", `More from ${developer.name}`, [{ kind: "block", markup: grid({ itemSize: "cover", items: developerGames.map((otherGame) => ({ kind: "block" as const, markup: gameCard({ title: otherGame.title, imageUrl: otherGame.cover ?? null, href: `/g/${otherGame.slug}`, facts: { playerCount: otherGame.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? otherGame.playing_now_player_count : undefined } }) })) }) }])]
      : []),
  ];
  const screenshotSheets = shots.map((shot, shotIndex) => sheet({ id: `screenshot-${shotIndex + 1}`, title: `${game.title}, screenshot ${shotIndex + 1} of ${shots.length}`, body: screenshotLarge(shot, `${game.title}, screenshot ${shotIndex + 1}`), closeLabel: "Close" }));
  // Playing: the bar beside the game, and what it opens.
  const barControls = [
    ...(multiplayer ? [cutButton("Players", { id: "players-open", type: "button", icon: "people", isLabelHidden: true, isSmall: true, controls: "players", reactionCount: 0 })] : []),
    ...(saves ? [cutButton("Keep your progress", { id: "keep-bar", href: joinHere, icon: "save", isLabelHidden: true, isSmall: true, isHidden: true, dataAttributes: { keep: "/join" } })] : []),
    ...(hasRoomCodes ? [cutButton("Join", { id: "room-open", type: "button", icon: "hash", isSmall: true, controls: "room-dialog" })] : []),
    ...(isClosed ? [] : updateBarButtons()),
    cutButton("Share", { id: "share", type: "button", icon: "share", isLabelHidden: true, isSmall: true, controls: "share-dialog" }),
    cutButton("Full screen", { id: "full", type: "button", icon: "full-screen", isLabelHidden: true, isSmall: true }),
    cutButton("More", { id: "menu", type: "button", icon: "more", isLabelHidden: true, isSmall: true, controls: "menu-dialog", isExpanded: false }),
  ];
  const roomSheet = hasRoomCodes
    ? sheet({
        id: "room-dialog",
        title: "Room",
        placement: "foot",
        closeLabel: "Close",
        body: stack({
          items: [
            { kind: "block", id: "room-here", isHidden: true, markup: stack({ items: [
              { kind: "block", id: "room-code-shown", markup: codeField({ id: "room-code-text", label: "This room", code: "" }) },
              { kind: "control", markup: cutButton("Hide the room code", { id: "room-eye", type: "button", icon: "eye", isHidden: true }) },
              { kind: "words", id: "room-closed", isHidden: true, markup: html`<p>This room doesn't take new players.</p>` },
            ] }) },
            { kind: "control", markup: cutField({ id: "bar-join-code", name: "room", label: "Join a room by its code", type: "text", icon: "hash", placeholder: "ABC234", autocomplete: "off" }) },
            { kind: "words", id: "join-leaves", isHidden: true, markup: html`<p>It leaves the room you're in.</p>` },
          ],
        }),
        buttons: [cutButton("Join", { id: "room-join", type: "submit" })],
      })
    : "";
  const menu = dropdown({
    id: "menu-dialog",
    label: game.title,
    head: { title: game.title, note: ownServers.length ? ownServersLine(ownServers) : undefined },
    items: [
      // Guests only: a signed-in player's progress is on their account already.
      ...(saves && !viewer.account ? [{ id: "keep-link", isHidden: true, label: "Keep your progress", icon: "save" as const, href: joinHere, dataAttributes: { keep: "/join" } }] : []),
      { label: "Report this game", icon: "flag", href: reportHref, dataAttributes: { report: "" } },
      { kind: "rule" },
      { label: "Content rules", icon: "rules", href: "/legal/content-rules", isNewTab: true },
      { label: "All games", icon: "games", href: "/" },
    ],
  });
  const keepCard = saves
    ? playingCard({
        id: "keep",
        title: "Keep your progress",
        body: stack({ items: [
          { kind: "words", id: "save-status", isHidden: true, markup: html`<p role="status"></p>` },
          { kind: "words", markup: html`<p>Your ${game.title} progress is only saved in this browser. Make a free account to keep it safe and play on any device.</p>` },
          { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: runButton("Make an account", { href: joinHere, dataAttributes: { keep: "/join" } }) }, { kind: "control", markup: cutButton("Not now", { id: "keep-later", type: "button" }) }] }) },
          { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", signinHere, { dataAttributes: { keep: "/signin" } })}</p>` },
        ] }),
      })
    : "";
  const signInCard = canSignIn
    ? playingCard({
        id: "sign-in-ask",
        title: `${game.title} asks you to sign in`,
        body: stack({ items: [
          { kind: "words", markup: html`<p id="sign-in-text">Make a free Zaisma account or sign in. The game keeps running here while you do.</p>` },
          { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: runButton("Make an account", { href: joinHere, dataAttributes: { "sign-in": "/join" } }) }, { kind: "control", markup: cutButton("Not now", { id: "sign-in-later", type: "button" }) }] }) },
          { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", signinHere, { dataAttributes: { "sign-in": "/signin" } })}</p>` },
        ] }),
      })
    : "";
  const response = layout(env, {
    title: `${game.title} on Zaisma`,
    // What chat apps, social sites and search engines read; tester links are secret, so they get none.
    head: tester ? undefined : await gamePageHead(env, game, { roomCode: inRoom ? code : null, developerName: developer?.name ?? null }),
    checkedPage: tester ? "Tester link" : rooms ? "Game page" : "Game page, no rooms",
    // The game's own world behind the glass, the same the home shows while its cover is pointed at.
    stage: backgroundMarkup(background),
    // The home opens the game page in a frame to play in place; only such a request (a same-site frame) may do it, every other still refuses framing.
    isFramedBySelf: request.headers.get("sec-fetch-dest") === "iframe" && request.headers.get("sec-fetch-site") === "same-origin",
    viewer,
    // Cloudflare's invisible check from when the page opens, for play counts and multiplayer (tester links: only for multiplayer).
    hasTurnstileCheck: (!tester || multiplayer) && !isClosed && Boolean(env.TURNSTILE_SITE_KEY),
    // What a page for older players shows depends on who's looking, so no cache keeps it.
    isPrivate: game.minimum_player_age_years > 13,
    hasStripeFrame: !isClosed,
    body: html`${stack({ items: [{ kind: "block", markup: gamePane }, ...sections] })}
${screenshotSheets}
${playingBar({ title: game.title, controls: barControls })}
<template id="game-frame"><iframe class="game-frame" id="game"${tester || isAccountsOnly || isClosed ? "" : html` src="${frameUrl}"`} title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated" allowfullscreen referrerpolicy="no-referrer"></iframe></template>
${roomSheet}
${isClosed ? "" : connectionPlate()}
${menu}
${reportSheet(game, { isMultiplayer: multiplayer, gameOrigin })}
${multiplayer ? blockSheet({ gameOrigin }) : ""}
${multiplayer ? playersSheet({ gameOrigin, slug: game.slug, title: game.title, hasZaismaRooms: game.multiplayer_mode !== "none", canSignIn, signInPath: `/signin?next=${encodeURIComponent(`/g/${game.slug}`)}` }) : ""}
${keepCard}
${saves ? playingCard({ id: "save-toast", body: stack({ items: [{ kind: "words", markup: html`<p></p>` }] }) }) : ""}
${signInCard}
${multiplayer ? stillThereCard() : ""}
${leavingCard(game.title)}
${isClosed ? "" : buySheet({ joinHref: joinHere, signInHref: signinHere, coverUrl })}
${shareDialog(game.title, !tester)}
${tester && !multiplayer ? "" : playingCheck("play-check")}
${pageData("game-page-data", {
      slug: game.slug,
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
      has_threads: playedVersion?.has_threads === 1,
      // Streamer mode (an account setting) hides room codes until the player shows them.
      is_streamer_mode_on: Boolean(viewer.account?.is_streamer_mode_on),
      screen_orientation: game.screen_orientation || null,
      turnstile_site_key: env.TURNSTILE_SITE_KEY ?? "",
      account_requirement: accountRequirement,
      sign_in_url: `/signin?next=${accountNext}`,
      // The glass takes the game's tint, as on the home while its cover is pointed at.
      glass_tint_color: background.glassTintColor,
      // A room link is an invitation into a match already underway, and ?play comes from a Play button elsewhere: both skip the details.
      autoplay: autoplay ? (accountRequirement === "whole_game" || (accountRequirement === "multiplayer" && inRoom) ? "when_signed_in" : "always") : "never",
    })}
${isClosed ? "" : buySheetData({ slug: game.slug, tester_token: tester?.token ?? null, place: "game_page", ...buySheetStripe(env), asked: null, opener_origin: null })}
${saves && !isClosed ? pageData("saves-data", { api: `/api/saves/${game.slug}`, root: gameUrl(env, game.slug), query: roomQuery, frameOrigin: gameOrigin, slug: game.slug, offerAfter: (Number(env.KEEP_OFFER_SECONDS) || 300) * 1000, isAccountOfferEnabled: Boolean(game.account_offer_enabled) }) : ""}
${isClosed
      ? scriptTags(GAME_PAGE_SCRIPT, GAME_EMBEDDED_SCRIPT)
      : scriptTags(
          GAME_PAGE_SCRIPT,
          ...(tester && !multiplayer ? [] : [PLAY_COUNTER_SCRIPT]),
          ...(saves ? [SAVES_SCRIPT] : []),
          ...(accountRequirement !== "none" ? [ACCOUNT_GATE_SCRIPT] : []),
          ...(canSignIn ? [SIGN_IN_WHILE_PLAYING_SCRIPT] : []),
          ...(multiplayer ? [STILL_THERE_SCRIPT] : []),
          GAME_LINKS_SCRIPT,
          PASSKEY_SCRIPT,
          BUY_SHEET_SCRIPT,
          GAME_EMBEDDED_SCRIPT,
          GAME_UPDATES_SCRIPT,
          GAME_AUTOPLAY_SCRIPT,
        )}`,
  });
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  response.headers.append("Vary", "Sec-Fetch-Dest, Sec-Fetch-Site");
  // Unlisted games are for people with the link, never search engines; so are games the listing check keeps off lists ("No slop").
  const isShownInLists = game.visibility === "listed" && Boolean(await env.DB.prepare(`SELECT 1 AS shown FROM games WHERE id = ? AND ${SHOWN_IN_LISTS_SQL}`).bind(game.id).first());
  if (!isShownInLists || tester) response.headers.set("X-Robots-Tag", "noindex");
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
export async function previewPage(env: Env, token: string): Promise<Response> {
  const read = readPreviewLinkToken(token);
  const version = read ? await versionById(env.DB, read.versionId) : null;
  const expiresAtMs = version ? checkPreviewLinkToken(token, version) : null;
  const game = version && expiresAtMs ? await env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(version.game_id).first<Game>() : null;
  if (!version || !expiresAtMs || !game) return glassMessage(env, "This preview link doesn't work", "Preview links last a day, and the developer can turn them off. Get a fresh one from the dashboard or the API.", 404);
  if (!canOpen(game)) return glassMessage(env, game.review_status === "removed" ? "This game was removed" : "This game is being reviewed", "Its previews are closed too.", game.review_status === "removed" ? 410 : 404);
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
  const pages: Record<string, { title: string; body: string }> = {
    "content-rules": { title: "Content rules", body: CONTENT_RULES_PAGE },
    dmca: { title: "Copyright and DMCA notices", body: DMCA },
    defamation: { title: "Defamation notices", body: DEFAMATION },
    privacy: { title: "Privacy", body: PRIVACY },
    security: { title: "Security", body: SECURITY_PAGE },
  };
  const legalPage = pages[page];
  if (!legalPage) return null;
  return layout(env, { title: `${legalPage.title} · Zaisma`, body: html`<h1>${legalPage.title}</h1>${raw(legalPage.body)}` });
}

// Approved by Julius on Oct 16, 2026 (#191); the faked-plays rule on Oct 13, 2026.
// The rules themselves are CONTENT_RULES (@zaisma/core), each anchored by the name holds and takedowns give it.
const ruleItem = (rule: ContentRule, words: string) => {
  const details = CONTENT_RULE_DETAILS[rule];
  return html`<li id="${rule}"><strong>${words}</strong>${details.explanation ? html` ${details.explanation}` : ""}<br><strong>Fine:</strong> ${details.fine}<br><strong>Not fine:</strong> ${details.notFine}</li>`;
};
const CONTENT_RULES_PAGE = `
<p class="lead">Zaisma is for players 13 and up. Any kind of game is welcome, within these rules.</p>
<h2>Not allowed</h2>
${html`<ul>${Object.entries(CONTENT_RULES).map(([rule, words]) => ruleItem(rule as ContentRule, words))}</ul>`}
<p>Names players give to things in a game (sessions, worlds, maps) are allowed. The game is responsible for keeping them within these rules.</p>
<h2>Allowed, even where other platforms ban it</h2>
${html`<ul>${ALLOWED_CONTENT.map((words) => html`<li>${words}</li>`)}</ul>`}
<h2>How we check</h2>
<p>Every game is scanned before it's published: automatic malware checks, matching against known illegal images, and an AI review. Games that need a closer look wait for a person.</p>
<h2>If a game breaks a rule</h2>
<p>That version is held, or the live game is hidden, and you're told which rule, what we found and how to fix it. Nothing is deleted. Publish a fixed version and it's back.</p>
<p>Copyright and defamation are different: we don't judge them ourselves. When the owner of a work, or a private person a game falsely accuses of a crime, sends a notice, the game is hidden until you publish a version without what the notice names. If the notice is wrong, you can send a counter-notice. See <a href="/legal/dmca">Copyright and DMCA notices</a> and <a href="/legal/defamation">Defamation notices</a>.</p>
<p>These rules follow US law. When a country's own law forbids a game that's fine here (the UK's hatred offences, say), a notice from a court, regulator or police there blocks it for players in that country only, and everyone else still plays it. Publish a version without what the notice names and we lift the block. Authorities can send notices to <a href="mailto:safety@zaisma.com">safety@zaisma.com</a>.</p>
<p>Accounts are closed only for sexual content involving minors, malware, or putting back something we already took down.</p>
<h2>Reports and takedowns</h2>
<p>Every game page has a Report button. We remove games that break these rules. Reports about child safety or illegal content go straight to a person. Until we've checked a report, a brand-new game is hidden and a recent update goes back to the version before it.</p>
<p>How players talk to each other is up to each game and its moderators, and mute and block are always there. Zaisma steps in for threats that reach into real life, sharing someone's personal details, following someone after they've blocked them, and anything sexual toward a teen. Trash talk, however rough, is the game's call: reports about bullying, cheating and other behavior go to the game's developer.</p>
<p>A game with faked plays is taken off Popular, Trending and New. Doing it again can get the game taken down.</p>
<p>Zaisma's lists show games whose covers and titles keep a few clear lines: no text but the title, nothing laid over the picture, no fake rewards, no famous characters you don't own, and built around something from the game. A game that breaks one still plays by its link until it's fixed; a fake reward holds it. See <a href="/developers/covers">Covers that show your game</a>.</p>
`;

const DMCA = `
<p class="lead">If a game on Zaisma uses your work without permission, send us a notice and players won't be able to open it until it's fixed.</p>
<h2>What to include</h2>
<ol>
<li>Your name, address, phone number and email.</li>
<li>The work you own, and the Zaisma link where it's being used.</li>
<li>A statement that you believe in good faith the use isn't authorized by you, your agent or the law.</li>
<li>A statement, under penalty of perjury, that your notice is accurate and that you're the owner or authorized to act for the owner.</li>
<li>Your physical or electronic signature.</li>
</ol>
<h2>Where to send it</h2>
<p>Email <a href="mailto:dmca@zaisma.com">dmca@zaisma.com</a>.</p>
<p class="note">Designated agent details will be listed here once Zaisma's DMCA agent registration is complete.</p>
<h2>What happens next</h2>
<p>We hide the game from players and tell its developer what your notice names. We pass your notice on to them, with your name and email. Once they publish a version without your work, we check it and show the game again. Nothing is deleted.</p>
<h2>Counter-notices</h2>
<p>If your game was hidden by mistake, or you may use the work, email the same address with a counter-notice:</p>
<ol>
<li>Your name, address, phone number and email.</li>
<li>The game's Zaisma link and what the notice named.</li>
<li>A statement, under penalty of perjury, that you believe in good faith it was hidden by mistake or because the work was misidentified.</li>
<li>Your consent to the jurisdiction of the federal court for your address (or, outside the US, any court where Zaisma may be found), and that you'll accept service from the person who sent the notice.</li>
<li>Your physical or electronic signature.</li>
</ol>
<p>We pass it on to the person who sent the notice, with your name and address. After 10 working days the game is back, unless they tell us they've gone to court.</p>
`;

// The flow Julius settled on Oct 19, 2026: the game is hidden on a notice, without Zaisma judging it, until a fixed version or a counter-notice.
const DEFAMATION = `
<p class="lead">If a game on Zaisma falsely says you, a private person, committed a crime, send us a notice and players won't be able to open it until it's fixed. We don't judge whether it's true: the developer can answer with a counter-notice.</p>
<p>Satire, jokes and stories about politicians, celebrities and other public figures are allowed, and so are crimes someone was publicly charged with or convicted of. If a game shows where you live, your phone number or where you go to school, or threatens you, use the Report button on its page instead: that breaks the <a href="/legal/content-rules#real_people">content rules</a> whatever it says.</p>
<h2>What to include</h2>
<ol>
<li>Your name and email.</li>
<li>The game's Zaisma link, and the exact words or scene: where it is in the game, and what it says.</li>
<li>That it's about you, that you're a private person and not a public figure, and that it says you committed a crime you didn't commit.</li>
<li>Your consent for us to pass your notice on to the game's developer, with your name.</li>
<li>A statement that you believe in good faith your notice is accurate.</li>
<li>Your physical or electronic signature.</li>
</ol>
<h2>Where to send it</h2>
<p>Email <a href="mailto:safety@zaisma.com">safety@zaisma.com</a>, with "Defamation notice" in the subject.</p>
<h2>What happens next</h2>
<p>We hide the game from players and tell its developer what your notice names. Once they publish a version without it, we check it and show the game again. Nothing is deleted.</p>
<h2>Counter-notices</h2>
<p>If your game was hidden and what it says is true, or isn't about a private person, email the same address with a counter-notice:</p>
<ol>
<li>Your name, a contact address and your email.</li>
<li>The game's Zaisma link and what the notice named.</li>
<li>Why the notice is wrong: what it says is true, or it isn't about the person who sent it, or that person is a public figure.</li>
<li>Your consent for us to pass your counter-notice on to the person who sent the notice, with your name and address, so they can take it to court.</li>
<li>A statement that you believe in good faith your counter-notice is accurate.</li>
<li>Your physical or electronic signature.</li>
</ol>
<p>We pass it on to the person who sent the notice. After 10 working days the game is back, unless they tell us they've gone to court.</p>
`;

// Approved by Julius on Oct 12, 2026; the play stats and play-check lines on Oct 13, 2026; the lead, the player ID line and the line about games' content rules on Oct 16, 2026; sites you sign in to with Zaisma in the player ID line by merging Sign in with Zaisma; the devices, wrong passwords, cookies, Cloudflare and Supabase lines (Accounts open only through Zaisma) in its preview on Oct 17, 2026.
const PRIVACY = `
<p class="lead">Zaisma keeps as little about you as it can. Most games need no account, and guests leave nothing behind.</p>
<h2>Playing as a guest</h2>
<p>Guests get a temporary ID and a made-up name like "Swift Fox 42", used only to run the game session. They're kept in your browser tab and forgotten when it closes. We don't keep a profile, and we don't know who you are.</p>
<p>Your browser also remembers which games you played recently, so the home page can show them first. That list stays on your device; we never see it.</p>
<p>When you press Play, we count it for the game's developer and for lists like Popular: that the game was played, how long it was on screen, and whether this browser played it before (and on which day it first did). To keep the counts honest, Cloudflare checks, invisibly, when you open a game's page that it's a real browser, and we count players by internet provider (like Comcast or Vodafone) to spot bot networks. The same check lets you play online in multiplayer games, so bots can't fill their rooms. A play's details are kept for a day at most; after that we keep only totals for each game and day, never anything that says who played.</p>
<p>Zaisma measures how games run (load time, frame rate, crashes) by browser and device type, only as totals.</p>
<h2>If you make an account</h2>
<ul>
<li><strong>Your username</strong>, the one you pick. Everyone can see it.</li>
<li><strong>Your password.</strong> Only Supabase, our sign-in provider, keeps it, as a scrambled hash nobody can read back. When you pick one, we check it isn't known from a data breach without sending it anywhere.</li>
<li><strong>Your email</strong>, only if you add one, as a way back in if you forget your password. We email it a code only when you ask for one. It's never shown to anyone, and we don't send marketing.</li>
<li><strong>Your player ID.</strong> When you're signed in, the games you play, and the sites you choose to sign in to with Zaisma, know you by a player ID, the same everywhere, and can look up your username with it. They never get your email, your age or anything from other games. Your account page lists the sites, and you can remove any of them.</li>
<li><strong>Your age group</strong>: 13 to 15, 16 or 17, or 18 and over. If you're under 18 we also keep your birth date, so your account moves to the next group on your birthday by itself, and we delete it when you turn 18. If you're 18 or over when you make an account, we never keep it. It's never shown to anyone.</li>
<li><strong>Your game saves.</strong> If you're signed in, your game saves are stored with your account, so your progress follows you to any device.</li>
<li><strong>The games you played.</strong> The last 20, so Continue playing follows you to any device too, and which games you've ever played, so their developers can be told if you delete your account.</li>
<li><strong>Your passkeys</strong>, if you add any: the public half of each key, the kind of device you added it on (like "iPhone") and when you last used it. The private half never leaves your device or password manager.</li>
<li><strong>The devices you sign in on.</strong> Each browser you sign in on keeps a random ID in a cookie, and we note that your account signed in with it, so your password always opens your account there, even while someone elsewhere is guessing it. The note goes a year after your last sign-in on that device.</li>
<li><strong>Your account's activity.</strong> For 90 days, sign-ins on a new device and changes to how you sign in or to your API keys, each with the device (like "Chrome on a Windows PC"), the network (like Vodafone) and the rough place (like near Manchester, UK) it came from, which we work out from your connection address without keeping it. Only you see it, on your account page. Turn off Keep where my account is used from there and we keep only what happened and when.</li>
<li><strong>Wrong passwords typed for your account</strong>: when, and whether it was on a device you'd signed in on. Never what was typed. Kept for a day.</li>
<li><strong>If you sign in with Google or Discord</strong>, they give us your email, plus the name and profile picture on that account. We only use the email, to sign you in; Supabase keeps the rest with your sign-in.</li>
</ul>
<p>Accounts are for people 13 and up. If you're younger, you can't make one, and we keep nothing you typed. If we find out we have an account for someone under 13, we delete it.</p>
<h2>Cookies</h2>
<p>We only use cookies to keep you signed in, to remember where you are while you make an account, and to know a device you've signed in on before. No ads, no tracking, no analytics cookies.</p>
<h2>Reports</h2>
<p>When you report a game or a player, we keep what you wrote and nothing about you. Reports about a player include their temporary ID or name so we can act on it. If you include a picture of the game with your report, we keep it until the report is dealt with and delete it within 30 days.</p>
<h2>Games</h2>
<p>Games run on a separate domain and can't see your account, email or cookies. Our content rules don't allow games to ask for your personal details.</p>
<p>Some games run online play on their developer's own servers, named in the game's menu. Those servers see your connection address, as any website you visit does, and what the game sends them. They never get your email or your age.</p>
<h2>Buying in games</h2>
<p>When you buy something in a game, payment goes through Stripe. When you save a card, Stripe keeps it and Zaisma keeps its brand, its last four digits and the email for receipts; the developer you buy from gets the payment, never a card they can charge again. We keep what you bought and when, so it stays yours on any device.</p>
<h2>If you make games</h2>
<p>What you and your API keys do to your games (uploads, publishes, database and save changes, secrets and the rest) is kept in each game's history for as long as the game, with who did it and from where, so you can see it. Each change also keeps its connection address for 90 days, shown only to you, so a report of illegal material can be traced to whoever uploaded it. Keep where my account is used from turns that off, except for uploads: a version's or an image's upload keeps its address for 90 days either way. To tell you when a key is used from somewhere new, we keep a fingerprint of each network and country it's used from, never shown, until it's gone unused for 90 days.</p>
<h2>Backups</h2>
<p>Every night Zaisma copies what it keeps to a backup at Backblaze, in the United States, so a disaster at our servers loses nothing. Nobody can change or delete a copy for 28 days, not even us, so for up to 30 days after something is deleted here, a copy of it can still be in the backup; then it's gone. We only read the backup to bring Zaisma back after a disaster, and a restore never brings back what was deleted.</p>
<h2>Who helps us run Zaisma</h2>
<ul>
<li><strong>Cloudflare</strong> runs our servers, stores games, sends the email codes you ask for, and checks that a real browser opened a game's page, made an account, typed a password on a new device or asked for an email code. It sees your connection address to deliver pages and stop abuse; we keep it only where this page says. The check is Cloudflare Turnstile, covered by its <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Turnstile Privacy Addendum</a>.</li>
<li><strong>Supabase</strong> handles sign-in: it checks your password, keeping only a hash, and holds your email if you added one. When you sign in, we pass it your connection address, so its limits on tries count you and not everyone at once, and it keeps that address with each sign-in. Your browser never talks to it directly.</li>
<li><strong>Stripe</strong> takes payments when you buy something in a game, and keeps the cards you save. The developer you buy from gets the payment through their own Stripe account, with the email for receipts.</li>
<li><strong>Anthropic</strong> reviews uploaded games for safety. It sees game files, never players.</li>
<li><strong>Backblaze</strong> keeps Zaisma's nightly backup, in the United States. It only stores the copies, encrypted.</li>
</ul>
<p>We never sell your data, and there are no ads on Zaisma.</p>
<h2>Downloading your data</h2>
<p>Go to your account page and choose Download your data. You get one .zip with everything we keep about your account, your game saves as files, and a note saying what each file holds.</p>
<h2>Deleting your account</h2>
<p>Go to your account page and choose Delete account. Your username, password, any email, game saves, recently played games and everything else on your account are deleted straight away. Their copies in our backup are gone within 30 days. If you made games, they're deleted too, with their files, database and players' saves. Games you played and sites you signed in to with Zaisma are told, so their developers can erase what they kept about you.</p>
<h2>Questions</h2>
<p>Email <a href="mailto:privacy@zaisma.com">privacy@zaisma.com</a>.</p>
`;

// Julius settled it on Oct 19, 2026: safe harbor with scope and rules, no cash reward in the beta, reply in 5 days, fix serious holes in 30, 90 days before publishing.
const SECURITY_PAGE = `
<p class="lead">Found a security hole in Zaisma? Tell us privately, and you won't get in trouble for looking.</p>
<h2>How to report</h2>
<p>Email <a href="mailto:${SECURITY_REPORT_EMAIL}">${SECURITY_REPORT_EMAIL}</a>, or <a href="${SECURITY_ADVISORY_URL}" rel="noopener">report it privately on GitHub</a>. Say where it is, how to make it happen, and what it lets someone do. Our machine-readable contact is <a href="${SECURITY_TEXT_FILE_PATH}">security.txt</a>.</p>
<h2>What's covered</h2>
<ul>
<li>zaisma.com, its API and its MCP.</li>
<li>Your own Zaisma account and your own games.</li>
<li>The game server, the SDK and the upload command in the <a href="https://github.com/zaisma/zaisma" rel="noopener">open source repo</a>.</li>
</ul>
<h2>Our promise: safe harbor</h2>
<p>If you look for holes in good faith and stay inside the rules below, we won't take legal action against you and we won't close your account.</p>
<h2>The rules</h2>
<ul>
<li>Test only on your own account and your own games. If you reach another player's account or data, stop at the smallest proof, don't keep it, and tell us.</li>
<li>No denial of service, and nothing that slows Zaisma for other players.</li>
<li>No spam, phishing or tricking other players, ours or anyone else's.</li>
<li>Never upload illegal content, even to prove a point. Child sexual abuse material has no safe harbor: it's reported and passed to the police.</li>
<li>Give us ${DISCLOSURE_WAIT_DAYS} days to fix a hole before you publish it. Past that we can't promise to stay quiet.</li>
</ul>
<h2>What to expect</h2>
<p>We reply within ${REPLY_WITHIN_DAYS} days, and aim to fix serious holes within ${FIX_WITHIN_DAYS}. We tell you when it's fixed.</p>
<h2>Rewards</h2>
<p>There's no cash reward yet. Zaisma is small, and we'd rather say so than promise what we can't pay.</p>
<h2>Something else</h2>
<p>A game that breaks the rules, or anything about children's safety, goes to <a href="mailto:safety@zaisma.com">safety@zaisma.com</a>, not here. Copyright is on the <a href="/legal/dmca">DMCA page</a>.</p>
`;

/**
 * The game page's script: Play, the pictures, tabs and rooms, the menu, Share, and what the game says
 * through the frame. Its values come in the page's game-page-data block, as gamePage; the page's other
 * scripts come after it and use gamePage, frame and gameOrigin.
 */
const GAME_PAGE_SCRIPT = pageScript("game-page", String.raw`const gamePage = JSON.parse(document.getElementById("game-page-data").textContent);
let frame = null;
const share = document.getElementById("share");
const full = document.getElementById("full");
const dialog = document.getElementById("menu-dialog");
// The glass takes the game's tint, as on the home while its cover is pointed at.
if (/^#[0-9a-fA-F]{6}$/.test(gamePage.glass_tint_color || "")) document.documentElement.style.setProperty("--glass-hue", gamePage.glass_tint_color);
// iPhones can't put a frame in full screen, so don't offer it there.
if (!document.fullscreenEnabled) full.hidden = true;
full.onclick = () => frame && frame.requestFullscreen();
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
// on Android phones and tablets that say they're on Wi-Fi; never on other phones and tablets, or with Data Saver.
let warming = null;
function warmUp() {
  const connection = navigator.connection;
  const isComputer = !matchMedia("(pointer: coarse)").matches;
  const isAndroidOnWifi = /Android/.test(navigator.userAgent) && connection && (connection.type === "wifi" || connection.type === "ethernet");
  if (frame || !gamePage.warm_url || (connection && connection.saveData === true) || !(isComputer || isAndroidOnWifi)) return;
  warming = document.createElement("iframe");
  warming.src = gamePage.warm_url;
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
// Remember the game for Continue playing: on this device, and with the account when signed in.
function remember() {
  try {
    const list = JSON.parse(localStorage.getItem("zaisma:played") || "[]").filter((p) => p.slug !== gamePage.slug);
    list.unshift({ slug: gamePage.slug, played_at_ms: Date.now() });
    localStorage.setItem("zaisma:played", JSON.stringify(list.slice(0, 20)));
  } catch {}
  if (/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) fetch("/api/me/played/" + gamePage.slug, { method: "POST", keepalive: true }).catch(() => {});
}
// Friends playing this game, under the title, with Join (friends-now.ts).
const friendsHere = document.getElementById("friends-here");
if (friendsHere && /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) {
  fetch("/g/" + gamePage.slug + "/friends").then((r) => (r.ok ? r.text() : "")).then((fragment) => {
    friendsHere.innerHTML = fragment;
    friendsHere.hidden = !fragment;
  }).catch(() => {});
}
// Rooms come and go: while the list is on screen, it's brought up to date every 20 seconds. The
// region the player picked is remembered on this device, and "Show more" stays open across updates.
const roomsPanel = document.getElementById("rooms");
let isRoomsSeen = false;
if (roomsPanel) new IntersectionObserver((entries) => { isRoomsSeen = entries.some((entry) => entry.isIntersecting); if (isRoomsSeen) refreshRooms(); }).observe(roomsPanel);
let roomsAt = Date.now();
let roomsRegion = "";
let roomsLabels = {};
// The order and the full-rooms box are in the address (room_order, is_hiding_full_rooms), so a refresh or a shared link keeps them.
const roomOrders = ${JSON.stringify(ROOM_ORDERS)};
const askedFor = new URLSearchParams(location.search);
let roomsOrder = roomOrders.includes(askedFor.get("room_order")) ? askedFor.get("room_order") : roomOrders[0];
let isHidingFullRooms = askedFor.get("is_hiding_full_rooms") === "true";
const roomsKey = () => roomsRegion + "|" + JSON.stringify(Object.entries(roomsLabels).sort()) + "|" + roomsOrder + "|" + isHidingFullRooms;
try { roomsRegion = localStorage.getItem("zaisma:rooms-region") || ""; } catch {}
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
    if (isHidingFullRooms) query.set("is_hiding_full_rooms", "true");
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
    if (line) { line.hidden = playing < ${MINIMUM_PLAYING_NOW_PLAYER_COUNT}; line.querySelector("b").textContent = playing.toLocaleString("en-US"); }
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
    const pick = e.target.closest("button[data-region]");
    if (pick) {
      roomsRegion = pick.dataset.region;
      try { roomsRegion ? localStorage.setItem("zaisma:rooms-region", roomsRegion) : localStorage.removeItem("zaisma:rooms-region"); } catch {}
      refreshRooms(true);
    }
  });
  roomsPanel.addEventListener("change", (e) => {
    const orderPick = e.target.closest('input[name="room_order"]');
    const fullPick = e.target.closest('input[name="is_hiding_full_rooms"]');
    if (orderPick || fullPick) {
      if (orderPick) roomsOrder = roomOrders.includes(orderPick.value) ? orderPick.value : roomOrders[0];
      else isHidingFullRooms = fullPick.checked;
      // The address keeps the pick without adding a step to Back.
      const address = new URL(location.href);
      roomsOrder === roomOrders[0] ? address.searchParams.delete("room_order") : address.searchParams.set("room_order", roomsOrder);
      isHidingFullRooms ? address.searchParams.set("is_hiding_full_rooms", "true") : address.searchParams.delete("is_hiding_full_rooms");
      history.replaceState(history.state, "", address);
      refreshRooms(true);
      return;
    }
    const pick = e.target.closest("input[data-label]");
    if (!pick) return;
    if (pick.value) roomsLabels[pick.dataset.label] = pick.value;
    else delete roomsLabels[pick.dataset.label];
    refreshRooms(true);
  });
}
const codeInput = document.getElementById("room-code");
if (codeInput) {
  codeInput.addEventListener("input", () => { codeInput.value = codeInput.value.toUpperCase().replace(/\s/g, ""); codeInput.setCustomValidity(""); });
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
if (deviceNotes.length) {
  const note = document.getElementById("device-note");
  note.querySelector(".banner-text").textContent = deviceNotes.join(" ");
  // Amber only when this browser can't start the game at all.
  note.querySelector(".banner-in").classList.toggle("tone-warning", needsOtherBrowser);
  note.hidden = false;
  const playLabel = document.querySelector("#play .face > span:not([class])");
  if (playLabel && (needsOtherBrowser || (DEVICES.length && !DEVICES.includes(mine)))) playLabel.textContent = "Play anyway";
}
// The ⋯ menu is a dropdown, which opens and closes itself; closed, the game gets the keys back.
const menuButton = document.getElementById("menu");
// A tap into the game never reaches this page: the page losing focus closes an open menu instead.
window.addEventListener("blur", () => document.querySelectorAll('.dropdown[role="menu"]:not(.shut)').forEach((menu) => { const opener = document.querySelector('[aria-controls="' + menu.id + '"][aria-expanded="true"]'); if (opener) opener.click(); }));
menuButton.addEventListener("click", () => setTimeout(() => { if (frame && menuButton.getAttribute("aria-expanded") === "false" && !document.getElementById("report").open) frame.focus(); }));
// The room control: the room's code while the game is in a room (zaisma:room, then zaisma:players says
// whether it takes others), Join otherwise; its sheet has the code with Copy, and Join by code. In streamer mode (an
// account setting) the code starts hidden: the eye shows it on this page, and Share blurs it under Show.
const roomOpen = document.getElementById("room-open");
const roomDialog = document.getElementById("room-dialog");
const isStreamerModeOn = gamePage.is_streamer_mode_on === true;
let isRoomCodeHidden = isStreamerModeOn;
let shownRoom = null;
function showRoomCode(room) {
  shownRoom = room;
  if (!roomOpen) return;
  roomOpen.querySelector(".face > span:not([class])").textContent = !room ? "Join" : !room.isOpen ? "Closed" : isRoomCodeHidden ? "••••••" : room.code;
  roomOpen.title = !room ? "Join a room by its code" : !room.isOpen ? "This room doesn't take new players" : "The room's code";
  document.getElementById("room-here").hidden = !room;
  document.getElementById("join-leaves").hidden = !room;
  document.getElementById("room-closed").hidden = !room || room.isOpen;
  const codeText = document.getElementById("room-code-text");
  codeText.textContent = room ? (isRoomCodeHidden ? "••••••" : room.code) : "";
  codeText.setAttribute("data-code", room ? room.code : "");
  codeText.closest(".code-field").classList.toggle("is-masked", isRoomCodeHidden);
  document.getElementById("room-code-shown").hidden = !room || !room.isOpen;
  const roomEye = document.getElementById("room-eye");
  roomEye.hidden = !isStreamerModeOn || !room || !room.isOpen;
  roomEye.querySelector(".face > span:not([class])").textContent = isRoomCodeHidden ? "Show the room code" : "Hide the room code";
}
if (roomOpen && roomDialog) {
  const joinInput = document.getElementById("bar-join-code");
  roomOpen.addEventListener("click", () => { if (!shownRoom) setTimeout(() => joinInput.focus()); });
  roomDialog.addEventListener("close", () => { if (frame) frame.focus(); });
  // Enter joins: the sheet's first submit button is its Close, which the browser would press.
  joinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinInput.form.requestSubmit(document.getElementById("room-join")); } });
  joinInput.addEventListener("input", () => { joinInput.value = joinInput.value.toUpperCase().replace(/[^0-9A-Z]/g, ""); joinInput.setCustomValidity(""); });
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
const shareSecrets = () => shareBox.querySelectorAll(".qr-code, .code-field");
function shareFrom(button) {
  const url = location.origin + location.pathname + location.search.replace(/[?&]play\b[^&]*/, "").replace(/^&/, "?");
  const room = new URLSearchParams(location.search).get("room");
  shareLink.textContent = url;
  document.getElementById("share-room").hidden = !room;
  document.getElementById("share-room-code").textContent = room || "";
  const isMasked = isRoomCodeHidden && Boolean(room);
  for (const secret of shareSecrets()) secret.classList.toggle("is-masked", isMasked);
  document.getElementById("share-reveal").hidden = !isMasked;
  const qr = document.getElementById("share-qr");
  if (qr) {
    qr.src = "/g/" + gamePage.slug + "/qr-code.svg" + (room ? "?room=" + encodeURIComponent(room) : "");
    document.getElementById("share-qr-caption").textContent = room ? "Scan to join this match" : "Scan to play";
  }
  if (!shareBox.open) shareBox.showModal();
  shareBox.returnFocus = button;
}
const shareMore = document.getElementById("share-more");
if (navigator.share) {
  shareMore.hidden = false;
  shareMore.onclick = async () => {
    try { await navigator.share({ title: document.title, url: shareLink.textContent }); shareBox.close(); } catch {}
  };
}
// Show, or a tap on the blurred link or room code, reveals them for this time.
const revealShare = () => { for (const secret of shareSecrets()) secret.classList.remove("is-masked"); document.getElementById("share-reveal").hidden = true; };
document.getElementById("share-reveal").onclick = revealShare;
shareBox.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".code-field.is-masked .code-text")) revealShare(); });
shareBox.addEventListener("close", () => { if (frame) frame.focus(); else if (shareBox.returnFocus) shareBox.returnFocus.focus(); });
share.onclick = () => shareFrom(share);
// The game says which room it's in, so the address bar (and so Share) points to that match.
const gameOrigin = new URL(gamePage.frame_url).origin;
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
  // The game's own Invite or Players button (Zaisma.invite, Zaisma.openPlayersPanel): the same Share and
  // Players as the bar's, only right after the player's tap. Full screen holds only the game, so it ends first.
  // Invite hears whether Share opened.
  if (d && (d.type === "zaisma:share" || d.type === "zaisma:players-open")) {
    const isShare = d.type === "zaisma:share";
    const answerShare = (isOpened) => isShare && typeof d.requestNumber === "number" && frame.contentWindow.postMessage({ type: "zaisma:share-answer", requestNumber: d.requestNumber, isOpened }, gameOrigin);
    if (navigator.userActivation && !navigator.userActivation.isActive) answerShare(false);
    else {
      const playersOpen = document.getElementById("players-open");
      const open = () => {
        if (!isShare) return playersOpen && playersOpen.click();
        try {
          shareFrom(share);
          answerShare(true);
        } catch {
          answerShare(false);
        }
      };
      if (document.fullscreenElement) document.exitFullscreen().then(open, open);
      else open();
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
 * The game page's script for a game that needs an account: a guest (no zaisma_in cookie) sees how to
 * sign in, and for a whole game, or a room link, Play becomes "Sign in to play". Sets needsSignIn for
 * autoplay. Rooms refuse guests' passes either way; this is only so honest players never start a game
 * that turns them away.
 */
const ACCOUNT_GATE_SCRIPT = pageScript("account-gate", `// Guests are asked to sign in first, and come back to the same page or match.
const needsSignIn = !/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
if (needsSignIn) {
  document.getElementById("account-ask").hidden = false;
  if (gamePage.account_requirement === "whole_game" || gamePage.room_code) {
    const playButton = document.getElementById("play");
    playButton.querySelector(".face > span:not([class])").textContent = "Sign in to play";
    playButton.onclick = () => { location.href = gamePage.sign_in_url; };
  }
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
    signInAsk.hidden = true;
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
  if (keep) keep.hidden = true;
  signInAsk.hidden = false;
  signInAsk.querySelector("[data-sign-in]").focus();
};
document.getElementById("sign-in-later").onclick = () => {
  signInAsk.hidden = true;
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

