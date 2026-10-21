import {
  ALLOWED_CONTENT,
  canOpenLink,
  CONTENT_RULES,
  CONTENT_RULE_DETAILS,
  createAccessGrant,
  gameAddress,
  gameBySlug,
  isOldEnoughFor,
  isOwnServerUrl,
  isTesterLinkOn,
  linksOf,
  ownServerUrlsOf,
  readPlayModes,
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
import { html, layout, message, metalButton, pageData, playerModes, raw, scriptTags, siteFooter, siteHeader, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { showcase, tile } from "./home.ts";
import { viewerOf } from "./viewer.ts";
import { SAVES_SCRIPT } from "./saves-client.ts";
import { reportSheet } from "./report.ts";
import { blockSheet } from "./blocks.ts";
import { playersSheet } from "./players-sheet.ts";
import { GAME_UPDATES_SCRIPT, UPDATE_BAR_STYLE, connectionPlate, updateBarButtons } from "./game-updates.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, PLAY_COUNTER_SCRIPT, ageRefusal, playingNowCounts } from "./plays.ts";
import { JOIN_OFF_STYLES } from "./friends-now.ts";
import { profilePath } from "./profiles.ts";
import { codeBox, pageRooms, roomsOnPage, roomsPanel, tabCount } from "./rooms.ts";
import { checkPreviewLinkToken, readPreviewLinkToken } from "./preview-links.ts";
import { DEVELOPER_LINK_STYLES, GAME_LINKS_SCRIPT, developerLinks, leavingCard } from "./game-links.ts";
import { gamePageHead, SHARE_DIALOG_STYLES, shareDialog } from "./share-cards.ts";
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

/** The game's own servers in the ⋯ menu, in neutral words: "Online play runs on the developer's own server: play.example.com". */
const ownServersLine = (hosts: string[]) => `Online play runs on the developer's own ${hosts.length === 1 ? "server" : "servers"}: ${hosts.join(", ")}`;

export async function gamePage(env: Env, slug: string, request: Request, tester?: TesterLink): Promise<Response> {
  const url = new URL(request.url);
  const game = await gameBySlug(env.DB, slug);
  if (!game || (!tester && (game.review_status === "pending" || game.visibility === "draft" || game.visibility === "private"))) return message(env, "Game not found", "Check the link and try again.", 404);
  if (game.review_status === "removed") return message(env, "This game was removed", "It broke Zaisma's content rules or was taken down on request.", 410);
  if (game.review_status === "held") return message(env, "This game is being reviewed", "Someone reported it and we're taking a look. Try again later.", 404);
  const testerVersion = tester ? await testerLinkVersion(env.DB, game, tester) : null;
  if (tester && !testerVersion) return message(env, "Nothing to play yet", "The version this link opens isn't there yet: the developer hasn't published one, or it was deleted. Try the link again later.", 404);
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
  const roomQuery = inRoom ? `?room=${code}${ownServerParameter(url.searchParams.get("server"), ownServerUrls)}` : "";
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
    showcase(env, viewer.ageFloorYears, 60),
    // Games on Zaisma rooms: who's playing now, and the rooms to list if the developer shows them here.
    // Not on tester links: their rooms are reached by code and invite link.
    game.multiplayer_mode !== "none" && !tester && !isClosed ? pageRooms(env, game, request) : null,
    playingNowCounts(env),
    // Whether the version this page plays needs threads (ScanReport.has_threads), without reading the whole report.
    playedVersionId ? env.DB.prepare("SELECT json_extract(scan_report, '$.has_threads') = 1 AS has_threads FROM versions WHERE id = ?").bind(playedVersionId).first<{ has_threads: number | null }>() : null,
  ]);
  const rooms = live && roomsOnPage(game) ? live : null;
  // Checked browsers with the game on screen, and everyone in its rooms (who may have come in another way): the larger.
  const playingNowPlayerCount = Math.max(playingNow.get(game.id) ?? 0, live ? live.playing.playerCount : 0);
  const shots = pictures.results.map((picture) => `/img/${picture.id}`);
  const more = [...others.filter((otherGame) => otherGame.slug !== game.slug && otherGame.owner_id && otherGame.owner_id === game.owner_id), ...others.filter((otherGame) => otherGame.slug !== game.slug && (!otherGame.owner_id || otherGame.owner_id !== game.owner_id))].slice(0, 4);
  const devices = game.devices ? game.devices.split(",") : [];
  const controls = game.controls ? game.controls.split(",") : [];
  const modes = playerModes(readPlayModes(game.play_modes), game.multiplayer_mode !== "none");
  const specRows = [
    modes.html ? html`<div><dt>Players</dt><dd>${modes}</dd></div>` : "",
    devices.length ? html`<div><dt>Works on</dt><dd class="icons">${devices.map((device) => html`<span>${raw(DEVICE_ICONS[device] ?? "")}${DEVICE_LABELS[device] ?? device}</span>`)}</dd></div>` : "",
  ];
  const spec = specRows.some(Boolean) ? html`<dl class="spec">${specRows}</dl>` : "";
  const tabs = [{ id: "about", label: "About" }, ...(rooms ? [{ id: "rooms", label: "Rooms" }] : []), ...(updates.results.length ? [{ id: "updates", label: "Updates" }] : [])];
  const isSignedInAdult = viewer.account?.age_band === "18+";
  const pageLinks = linksOf(game).filter((link) => link.is_on_game_page && canOpenLink(link, isSignedInAdult));
  const response = layout(env, {
    title: `${game.title} on Zaisma`,
    // What chat apps, social sites and search engines read; tester links are secret, so they get none.
    head: tester ? undefined : await gamePageHead(env, game, { roomCode: inRoom ? code : null, developerName: developer?.name ?? null }),
    isBare: true,
    // The home opens the game page in a frame to play in place; only such a request (a same-site frame) may do it, every other still refuses framing.
    isFramedBySelf: request.headers.get("sec-fetch-dest") === "iframe" && request.headers.get("sec-fetch-site") === "same-origin",
    viewer,
    // Cloudflare's invisible check from when the page opens, for play counts and multiplayer (tester links: only for multiplayer).
    hasTurnstileCheck: (!tester || multiplayer) && !isClosed && Boolean(env.TURNSTILE_SITE_KEY),
    // What a page for older players shows depends on who's looking, so no cache keeps it.
    isPrivate: game.minimum_player_age_years > 13,
    body: html`<style>
/* Two states on one page: details with a Play button, then the game filling the screen. */
/* Cloudflare's check is invisible; if it ever needs a tap, it sits at the bottom, above the game. */
.play-check{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:50}
/* Just back from a match: the room list waits a moment for a copy without the player in it. */
.just-left #rooms-list,.just-left #playing-now{visibility:hidden}
body.playing{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;padding:0;background:#000}
body:not(.playing) #full{display:none}
/* Playing, the game is the whole screen: Zaisma's header, backdrop, footer and the page's details step aside, and the bar sits beside the game. */
body.playing>header.top,body.playing>.dropdown,body.playing>.backdrop,body.playing>.foot,body.playing>.rail,body.playing main.gp{display:none}
body.playing>.game-steel{display:contents}
body:not(.playing) .bar{display:none}
main.gp{max-width:1240px;margin:0 auto;padding:30px 24px 72px}
.gp-top{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:28px;align-items:start}
/* The picture sits in a machined bezel. */
.viewer .frame{filter:drop-shadow(0 26px 50px rgba(0,0,0,.6))}
.viewer .bezel{padding:3px;background:linear-gradient(135deg,#60656f 0%,#1c1e22 36%,#121417 70%,#40444c 100%)}
.viewer .shot{position:relative;aspect-ratio:16/9;background:var(--grain) 0 0/200px 200px,linear-gradient(135deg,#23272e,#14161a);overflow:hidden;clip-path:polygon(0 0,calc(100% - 34px) 0,100% 34px,100% 100%,0 100%)}
.viewer .shot img{width:100%;height:100%;object-fit:cover;display:block}
.viewer .shot:empty::after{content:"";position:absolute;inset:0;background:url(/zaisma-mark-metal.svg) center/22% no-repeat;opacity:.2}
.viewer .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px;margin-top:14px}
.viewer .thumbs button{position:relative;padding:0;border:0;background:#101215;aspect-ratio:16/9;cursor:pointer;opacity:.55;transition:opacity 140ms;box-shadow:0 0 0 1px #000}
.viewer .thumbs button:hover{opacity:.9}
.viewer .thumbs button[aria-pressed=true]{opacity:1;box-shadow:0 0 0 2px #e9ebee,0 0 0 4px #000,0 0 18px rgba(215,224,238,.25)}
.viewer .thumbs img{width:100%;height:100%;object-fit:cover;display:block}
/* The side plate: title, Play, and an engraved spec plate. */
.side{padding:28px 26px 24px;display:flex;flex-direction:column;gap:16px}
.side h1{margin:0;font-size:clamp(32px,3.4vw,46px)}
.side .by{margin:-8px 0 0;color:var(--muted);font-size:15px}
.side .by a{color:var(--text-2);text-underline-offset:3px}
/* Playing now: the live green square, linking to the rooms when they're listed here. */
.side .live-now{align-self:flex-start;margin:-6px 0 0;font-size:14px;text-decoration:none}
.side .live-now[hidden]{display:none}
a.live-now:hover{text-decoration:underline;text-underline-offset:3px}
.side .note{margin:0;font-size:14px;background:none;box-shadow:none;padding:0;color:var(--warn)}
.side .account-note{margin:-4px 0 0;font-size:14px;color:var(--text-2)}
/* A game for older players, opened by a younger account: a closed card in place of Play. */
.side .closed{display:grid;gap:14px;padding:18px}
.side .closed p{margin:0;font-size:15px;color:var(--text)}
/* Friends playing this game: their faces, who they are, and Join. */
.friends-here{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:-4px 0 0;font-size:14px;color:var(--text-2)}
.friends-here[hidden]{display:none}
.friends-here .faces{display:flex;gap:4px}
.friends-here .face{display:inline-flex;text-decoration:none}
.friends-here .said{flex:1;min-width:0}
.friends-here .btn{min-height:36px;padding:0 16px}
${raw(JOIN_OFF_STYLES)}
.side .account-note a{color:var(--text);text-underline-offset:3px}
.spec{margin:4px 0 0;display:grid}
.spec>div{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;align-items:start;padding:12px 0;
  background:linear-gradient(#000,#000) top/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) 0 1px/100% 1px no-repeat}
.spec dt{font-family:var(--display);font-size:13px;font-weight:500;color:var(--muted);padding-top:2px}
.spec dd{margin:0}
.icons{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:14px;color:var(--text)}
.icons span{display:inline-flex;align-items:center;gap:7px}
.icons svg,.spec .modes svg{width:20px;height:20px;flex:none;color:var(--text-2)}
.spec .modes li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:1px 10px;font-size:14px}
/* The player count goes under its way to play, so narrow plates never break "Online versus" apart. */
.spec .modes small{grid-column:2;font-size:13px}
.spec .modes small::before{content:none}
.side .row{margin-top:4px}
.side .row .btn{flex:1}
${raw(DEVELOPER_LINK_STYLES)}
${raw(SHARE_DIALOG_STYLES)}
/* Tabs ride on an engraved line; the open one gets the chrome rail, like the header. */
.tabs{display:flex;gap:30px;margin:52px 0 26px;background:linear-gradient(#000,#000) bottom 1px left/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) bottom/100% 1px no-repeat}
.tabs:empty{margin:40px 0 24px}
.tabs button{position:relative;min-height:50px;padding:0 2px;border:0;background:none;color:var(--muted);font:inherit;font-family:var(--display);font-weight:500;font-size:18px;cursor:pointer}
.tabs button:hover{color:var(--text)}
.tabs button[aria-selected=true]{color:var(--text)}
.tabs button[aria-selected=true]::after{content:"";position:absolute;left:-4px;right:-4px;bottom:0;height:3px;background:var(--chrome);box-shadow:0 0 14px rgba(225,230,240,.35)}
.about{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:36px;align-items:start}
[role=tabpanel][hidden]{display:none}
/* A link to a tab (#rooms, #updates) lands with the tabs in view, below the header. */
[role=tabpanel]{scroll-margin-top:150px}
.about .desc{font-size:18px;line-height:1.6;color:var(--text-2);white-space:pre-line;margin:0 0 16px;max-width:68ch}
.dev-card{display:flex;align-items:center;gap:14px;padding:16px;text-decoration:none;color:var(--text)}
a.dev-card:hover strong{text-decoration:underline;text-underline-offset:3px}
.dev-card .av{flex:none;width:48px;height:48px;display:grid;place-items:center;font-weight:700;font-family:var(--display);font-size:22px;color:#0b0b0c;background:var(--chrome);box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #000}
.dev-card strong{font-family:var(--display);font-weight:600;font-size:17px}
.dev-card small{display:block;color:var(--muted);font-size:13px}
.tab-count{display:inline-block;margin-left:9px;padding:1px 7px;vertical-align:2px;font-size:13px;font-weight:600;color:var(--text);background:rgba(0,0,0,.4);box-shadow:inset 0 1px 2px rgba(0,0,0,.7),0 1px 0 rgba(255,255,255,.06)}
.tab-count[hidden]{display:none}
/* Rooms: a machined slot per room, with a seat for each place in it (up to 16), lit for each player. */
.rooms-head{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:0 0 16px}
.rooms-head .badge{font-size:14px}
.rooms{list-style:none;padding:0;margin:0;display:grid;gap:10px;max-width:900px}
.room{--cut:12px;display:grid;grid-template-columns:minmax(0,1fr) 250px auto 104px 36px;align-items:center;gap:8px 20px;padding:10px 6px 10px 20px;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
.room .main{min-width:0}
/* A named room leads with its name and labels; they're words players may have typed, shown only past the filter. */
.room .title{display:flex;flex-direction:column;gap:2px;min-width:0}
.room .name{font-family:var(--display);font-size:17px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.room .labels{font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.room .small-count{font-size:13px;color:var(--text-2);white-space:nowrap}
.room .act{display:flex;justify-content:center}
.report-room{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;background:none;color:var(--muted);cursor:pointer}
.report-room:hover,.report-room:focus-visible{color:var(--text)}
.report-room svg{width:16px;height:16px}
.room.later{display:none}
#rooms.all .room.later{display:grid}
.room .fill{display:flex;align-items:center;gap:6px 12px;min-width:0}
.room .count{font-family:var(--display);font-size:17px;font-weight:600;color:var(--text);white-space:nowrap}
.room .where{display:flex;align-items:center;gap:8px;min-width:52px}
/* Where the room runs: the country's flag, set into the metal, and its two-letter code. */
.room .flag{width:20px;height:15px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.85),0 1px 0 1px rgba(255,255,255,.07)}
.room .where abbr{text-decoration:none;font-family:var(--display);font-size:14px;font-weight:500;letter-spacing:.06em;color:var(--text-2)}
.seats{display:flex;gap:3px;min-width:0}
.seats i{flex:0 1 7px;min-width:3px;height:18px;background:rgba(0,0,0,.5);box-shadow:inset 0 1px 2px rgba(0,0,0,.85),0 1px 0 rgba(255,255,255,.06)}
.seats i.on{background:linear-gradient(180deg,#f2f4f6,#aeb2b8 55%,#71757c);box-shadow:inset 0 1px 0 #fff,0 0 7px rgba(225,230,240,.28)}
/* A code from a friend: typed into the metal, joined in one press. */
.code-join{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 22px;max-width:900px}
.code-join label{font-family:var(--display);font-size:15px;font-weight:500;color:var(--text-2)}
.code-join input{width:8.5em;min-height:44px;padding:0 12px;font-family:var(--display);font-size:18px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
.code-join input::placeholder{color:#5d626b;letter-spacing:.16em}
.room .btn{min-height:44px}
.room .full{display:grid;place-items:center;min-height:44px;color:var(--muted);font-family:var(--display);font-size:15px;font-weight:500}
.rooms-pick{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;margin:0 0 14px;max-width:900px}
.regions{display:flex;width:fit-content;max-width:100%;overflow-x:auto;scrollbar-width:none}
/* Labels worth filtering by, each a small dropdown cut into the metal. */
.filters{display:flex;flex-wrap:wrap;gap:8px 16px}
.filter{display:flex;align-items:center;gap:8px;font-family:var(--display);font-size:14px;font-weight:500;color:var(--text-2)}
.filter select{width:auto;min-height:40px;max-width:180px}
.regions button{min-height:38px;padding:0 13px;gap:7px}
.regions small{font-size:12px;font-weight:500;color:var(--muted)}
.rooms-empty{max-width:900px;margin:0}
.rooms-all{margin:12px 0 0}
#rooms.all .rooms-all{display:none}
.rooms-more{margin:14px 0 0}
/* Phones: how full the room is on the left, its flag and Join on the right. */
@media (max-width:640px){
  .room{grid-template-columns:minmax(0,1fr) auto auto;gap:8px 12px;padding:12px 10px 12px 16px}
  .room .main{grid-column:1;grid-row:1}
  .room .where{grid-column:2;grid-row:1}
  .room .btn,.room .full{grid-column:3;grid-row:1;min-width:76px}
  .room .fill{grid-column:1/3;grid-row:2}
  .room .act{grid-column:3;grid-row:2;justify-content:flex-end}
  .room .count,.room .name{font-size:16px}
  .code-join label{flex-basis:100%}
}
/* The narrowest phones keep just the flag; the country is in the Join button's label. */
@media (max-width:370px){.room .where{min-width:0}.room .where abbr{display:none}}
.updates{list-style:none;padding:0;margin:0;display:grid;gap:16px;max-width:780px}
.updates li{padding:18px 20px}
.updates h3{margin:0 0 6px;font-size:18px}
.updates p{margin:0;color:var(--text-2);white-space:pre-line}
/* minmax(0,…) so the strip of thumbnails scrolls instead of pushing the page past the screen. */
@media (max-width:960px){.gp-top,.about{grid-template-columns:minmax(0,1fr)}main.gp{padding:16px 16px 56px}.side{padding:22px 20px}}
/* Stacked (phones and tablets): the picture, a slim strip of the other pictures and the details plate
   make one machined piece, so Play sits near the top. The picture takes the cut corner, lit like a plate's. */
@media (max-width:960px){
  .gp-top{gap:0}
  .viewer .bezel{--cut:28px;clip-path:polygon(0 0,calc(100% - 28px) 0,100% 28px,100% 100%,0 100%);
    background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(255,255,255,.34) calc(50% - 1.5px),rgba(255,255,255,.34) 50%,transparent 50%) top right/28px 28px no-repeat,linear-gradient(135deg,#60656f 0%,#1c1e22 36%,#121417 70%,#40444c 100%)}
  .viewer .shot{clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,0 100%)}
  .viewer .thumbs{display:flex;gap:6px;margin:0;padding:6px;overflow-x:auto;scrollbar-width:none;background:#0a0b0d;box-shadow:inset 0 2px 5px rgba(0,0,0,.8),inset 0 -1px 0 rgba(255,255,255,.05)}
  .viewer .thumbs::-webkit-scrollbar{display:none}
  .viewer .thumbs button{flex:0 0 76px;clip-path:none}
  .side{--cut:0px;clip-path:none;padding:16px 18px 20px;gap:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),var(--rim),var(--drop)}
  .side h1{font-size:clamp(28px,8vw,40px)}
  .side .by{margin-top:-6px;font-size:14px}
}
/* Playing: a slim brushed bar above the game. */
.bar{display:flex;align-items:center;gap:8px;padding:6px 10px;flex:none;background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,#24282e,#16181c);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 0 #000}
.bar .home img{height:22px;display:block}
.bar h1{font-size:15px;margin:0 0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;text-shadow:none}
.ctl{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 11px;border:0;color:var(--text);font:inherit;font-family:var(--display);font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;
  background:var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.12),inset -1px -1px 0 #000;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%)}
.ctl:hover{background:linear-gradient(180deg,#3a3f48,#2a2e35)}
.ctl svg{width:18px;height:18px;flex:none}
.ctl[hidden]{display:none}
/* The room control, in games on Zaisma rooms: the room's code while the player is in one (dots when the
   eye hid it, for streamers; Closed when it takes nobody), Join otherwise. It opens one plate with the
   code, Copy and the eye, and a box to join another room by its code. */
.room-open b{font-family:var(--display);font-weight:600;font-size:14px;letter-spacing:.12em;font-variant-numeric:tabular-nums}
.room-open.closed b{letter-spacing:0;font-weight:500;font-size:13px;color:var(--muted)}
.room-dialog .room-here{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:14px 16px 12px;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
.room-dialog .room-here[hidden]{display:none}
.room-dialog .room-title,.room-dialog label{margin:0;font-family:var(--display);font-size:15px;font-weight:500;color:var(--text)}
.room-line{display:flex;align-items:center;gap:8px}
.room-line b{flex:1;min-width:0;overflow:hidden;font-family:var(--display);font-size:24px;font-weight:600;letter-spacing:.16em;color:var(--text)}
.room-line .btn{min-height:38px}
.room-line .icon{width:38px;padding:0;justify-content:center}
.room-line .icon svg{width:18px;height:18px}
.room-line [hidden],.room-dialog p[hidden]{display:none}
.room-dialog .eye-off{display:none}
.room-dialog.masked .eye-off{display:inline}
.room-dialog p{margin:0;font-size:13px;color:var(--muted)}
.room-dialog form{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:14px 16px 16px}
.join-row{display:flex;gap:8px}
.join-row input{flex:1;width:0;min-width:0;min-height:44px;font-family:var(--display);font-size:18px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
.join-row input::placeholder{color:#5d626b}
/* Players: how many are in the room, beside the label; a corner badge on the icon where labels hide. */
.ctl .count{min-width:20px;height:18px;padding:0 6px;display:inline-grid;place-items:center;font-size:12px;font-weight:600;background:#0c0e11;box-shadow:inset 0 1px 2px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.06);border-radius:9px}
.ctl .count[hidden]{display:none}
${raw(UPDATE_BAR_STYLE)}
iframe{flex:1;border:0;width:100%;min-height:0;min-width:0;background:#000}
/* The game takes the keys while it's played: no focus ring around it. */
iframe:focus-visible{outline:none}
body:not(.playing) iframe{display:none}
/* Phones: icons only, big enough to tap. */
@media (max-width:640px){.ctl{width:40px;height:40px;padding:0;justify-content:center}.ctl .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}#players-open{position:relative}#players-open .count{position:absolute;bottom:2px;right:2px;min-width:16px;height:16px;padding:0 4px;font-size:10px}}
/* Landscape phones: the bar becomes a slim strip down the left edge, so the game keeps its full height. */
@media (orientation:landscape) and (max-height:500px){
  body.playing{flex-direction:row}
  body:not(.playing) .bar{flex-direction:row}
  body:not(.playing) .bar h1{display:block}
  body:not(.playing) .bar .ctl{width:40px}
  .bar{flex-direction:column;padding:8px 5px;gap:10px;box-shadow:inset -1px 0 0 rgba(255,255,255,.06),1px 0 0 #000}
  .bar h1{display:none}
  .bar .spacer{flex:1}
  .ctl{width:40px;height:40px;padding:0;justify-content:center}
  .ctl .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  #players-open{position:relative}
  #players-open .count{position:absolute;bottom:2px;right:2px;min-width:16px;height:16px;padding:0 4px;font-size:10px}
  /* The strip has no room for a code across it: the room control is its icon, and its plate has the code. */
  .room-open b{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
}
/* Narrow phones: the bar scrolls sideways under a Z that stays put; the room control keeps its code. */
@media (max-width:640px) and (orientation:portrait),(max-width:640px) and (min-height:501px){
  .bar{overflow-x:auto;scrollbar-width:none;gap:6px;padding-left:0}
  .bar::-webkit-scrollbar{display:none}
  .bar .home{position:sticky;left:0;z-index:2;flex:none;align-self:stretch;display:flex;align-items:center;padding:0 8px 0 10px;background:linear-gradient(180deg,#24282e,#16181c);box-shadow:6px 0 8px -4px rgba(0,0,0,.8)}
  /* Each button holds its own hidden label, so none sticks out past the bar and widens the page. */
  .bar .ctl{flex:none;position:relative}
  /* The title has no room here; the ⋯ menu names the game. */
  .bar h1{display:none}
  .bar .spacer{flex:1}
  .bar .room-open{width:auto;padding:0 10px;gap:5px}
  .room-open svg{width:16px;height:16px}
  .room-open b{font-size:13px;letter-spacing:.06em}
}
@media (max-width:360px){.bar .room-open svg{display:none}.bar .room-open{padding:0 8px}}
/* The menu: a small plate that drops from the ⋯ button, so the game stays in view and nothing dims it.
   One row per thing to do, each with an icon; the save line says at a glance whether progress is safe. */
dialog.quick{position:fixed;z-index:40;inset:auto;margin:0;width:min(320px,calc(100vw - 16px));max-height:calc(100dvh - 70px);overflow:auto;padding:0;
  --cut:14px;clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%);filter:drop-shadow(0 18px 36px rgba(0,0,0,.65));animation:quick-in 140ms cubic-bezier(.2,.8,.2,1)}
.quick .q-head{padding:14px 16px 12px;display:grid;gap:4px;background:linear-gradient(#000,#000) bottom left/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) bottom 1px left/100% 1px no-repeat}
.quick .q-head strong{font-family:var(--display);font-size:18px;font-weight:600;padding-right:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.quick .q-about{margin:0;color:var(--muted);font-size:13px;line-height:1.4;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.save-line{display:flex;gap:8px;margin:6px 0 0;font-size:13px;line-height:1.4;color:var(--text-2)}
.save-line[hidden]{display:none}
.save-line::before{content:"";flex:none;width:7px;height:7px;margin-top:6px;background:var(--warn)}
.save-line.ok::before{background:var(--ok);box-shadow:0 0 8px rgba(95,211,141,.6)}
.quick nav{display:grid;gap:2px;padding:6px}
.quick nav a{position:relative;display:flex;background:none;box-shadow:none;align-items:center;gap:12px;min-height:46px;padding:0 12px;text-decoration:none;font-family:var(--display);font-size:16px;font-weight:500;color:var(--text)}
.quick nav a[hidden]{display:none}
.quick nav a>svg{width:20px;height:20px;flex:none;color:var(--muted)}
.quick nav a .ext{width:14px;height:14px;margin-left:auto}
.quick nav a:hover,.quick nav a:focus-visible{outline:none;background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.1),inset -1px -1px 0 #000}
.quick nav a:hover>svg,.quick nav a:focus-visible>svg{color:var(--text)}
.quick nav a:focus-visible::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;background:var(--chrome)}
.quick .sep{height:2px;margin:6px 8px;background:linear-gradient(#000,#000) top/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) bottom/100% 1px no-repeat}
@media (orientation:landscape) and (max-height:500px){dialog.quick{max-height:calc(100dvh - 16px)}.quick .q-about{-webkit-line-clamp:2}.quick nav a{min-height:42px}}
@keyframes quick-in{from{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){dialog.quick{animation:none}}
/* The saves choice still takes the middle of the screen: the player has to answer it. */
dialog{width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px)}
dialog .head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
dialog .head strong{font-family:var(--display);font-size:17px}
dialog .body{padding:14px 16px;display:grid;gap:12px;font-size:14px}
dialog .body p{margin:0;color:var(--muted)}
dialog nav{display:grid;gap:8px;padding:0 16px 16px}
/* Keep your progress: a card over the game's top corner for guests, and a note once it's saved. */
.keep,.keep-toast{position:fixed;z-index:20;top:58px;right:14px;width:min(360px,calc(100vw - 28px));margin:0;filter:drop-shadow(0 18px 36px rgba(0,0,0,.6));animation:keep-in 260ms cubic-bezier(.2,.8,.2,1)}
.keep{display:grid;gap:10px;padding:18px 18px 16px}
.keep[hidden],.keep-toast[hidden]{display:none}
.keep strong{font-family:var(--display);font-size:18px}
.keep p{margin:0;font-size:14px;color:var(--text-2)}
.keep .row{margin-top:4px}
.keep .small{color:var(--muted)}
.keep-toast{padding:12px 16px;font-size:14px}
@keyframes keep-in{from{opacity:0;transform:translateY(-8px)}}
@media (prefers-reduced-motion:reduce){.keep,.keep-toast{animation:none}}
@media (orientation:landscape) and (max-height:500px){.keep,.keep-toast{top:10px}}
</style>
${siteHeader(env, { viewer })}
<div class="steel game-steel">
<div class="bar">
  <a class="home" href="/" title="All games"><img src="/zaisma-mark-metal.svg" alt="Zaisma"></a>
  <h1>${game.title}</h1>
  <span class="spacer"></span>
  ${multiplayer ? html`<button class="ctl" id="players-open" type="button" title="Players" aria-haspopup="dialog" aria-controls="players">${raw(ICON_PLAYERS)}<span class="label">Players</span><span class="count" hidden></span></button>` : ""}
  ${saves ? html`<a class="ctl" id="keep-bar" href="${joinHere}" data-keep="/join" title="Keep your progress" hidden>${raw(ICON_KEEP)}<span class="label">Keep progress</span></a>` : ""}
  ${hasRoomCodes ? html`<button class="ctl room-open" id="room-open" type="button" title="Room code, or join a room" aria-haspopup="dialog" aria-expanded="false" aria-controls="room-dialog">${raw(ICON_HASH)}<b id="room-open-text">Join</b></button>` : ""}
  ${isClosed ? "" : raw(updateBarButtons())}
  <button class="ctl" id="share" type="button" title="Share" aria-haspopup="dialog" aria-controls="share-dialog">${raw(ICON_SHARE)}<span class="label">Share</span></button>
  <button class="ctl" id="full" type="button" title="Full screen">${raw(ICON_FULL)}<span class="label">Full screen</span></button>
  <button class="ctl" id="menu" type="button" title="More" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-dialog">${raw(ICON_MORE)}<span class="label">More</span></button>
</div>
<main class="gp">
<section class="gp-top" aria-labelledby="title">
  <div class="viewer">
    <div class="frame"><div class="bezel bevel-l"><div class="shot">${shots[0] ? html`<img id="shot" src="${shots[0]}" alt="${game.title}">` : ""}</div></div></div>
    ${shots.length > 1 ? html`<div class="thumbs">${shots.map((shot, i) => html`<button type="button" class="bevel-s" data-src="${shot}" aria-label="Picture ${i + 1} of ${shots.length}" aria-pressed="${i === 0}"><img src="${shot}" alt="" loading="lazy"></button>`)}</div>` : ""}
  </div>
  <div class="side plate bevel-l">
    <h1 id="title">${game.title}</h1>
    ${developer ? html`<p class="by">by <a href="${profilePath(developer.name)}">${developer.name}</a></p>` : ""}
    ${tester || !canSignIn || isClosed ? "" : html`<div class="friends-here" id="friends-here" hidden></div>`}
    ${tester ? html`<p class="note tester">You're testing this game with a link from its developer.${isTestBuild ? ` It opens a version players don't have yet${game.multiplayer_mode !== "none" || ownServers.length ? ", so online play is off: it works only on the version players have" : ""}.` : ""}${hidden ? " It isn't public yet: anyone with this link can play, so only share it with other testers." : ""} Your progress stays in this browser.${tester.ends_at_ms ? ` The link works until ${day(tester.ends_at_ms)}.` : ""}</p>` : ""}
    ${playingLine(playingNowPlayerCount, Boolean(rooms))}
    ${isClosed
      ? html`<div class="closed plate bevel" id="closed"><p>This game isn't open to your account.</p>${metalButton("Find other games", { href: "/", isFullWidth: true })}</div>`
      : metalButton("Play", { id: "play", isBig: true, isFullWidth: true, hasPlayIcon: true })}
    ${accountRequirement !== "none" && !isClosed
      ? html`<p class="account-note" id="account-note">${accountRequirement === "whole_game" ? "Needs a Zaisma account" : "Playing online needs a Zaisma account"}<span id="account-ask" hidden>. <a href="/join?next=${accountNext}">Make one free</a> or <a href="/signin?next=${accountNext}">sign in</a>${accountRequirement === "whole_game" ? " to play" : " to play with others"}</span>.</p>`
      : ""}
    <p class="note" id="device-note" hidden></p>
    ${spec}
    ${developerLinks(pageLinks)}
    <div class="row"><button class="btn ghost" id="share-page" type="button" aria-haspopup="dialog" aria-controls="share-dialog">${raw(ICON_SHARE)}<span class="label">Share</span></button><a class="btn ghost" href="/g/${game.slug}/report" data-report>Report</a></div>
  </div>
</section>
${tabs.length > 1
      ? html`<div class="tabs" role="tablist" aria-label="About this game">${tabs.map(
          (tab, i) => html`<button type="button" role="tab" id="tab-${tab.id}" aria-controls="${tab.id}" aria-selected="${String(i === 0)}">${tab.label}${tab.id === "rooms" ? html`<span class="tab-count" id="rooms-count"${rooms?.joinableRoomCount ? "" : raw(" hidden")}>${rooms ? tabCount(rooms) : "0"}</span>` : ""}</button>`,
        )}</div>`
      : html`<div class="tabs"></div>`}
<section class="about" id="about" role="tabpanel" aria-label="About">
  <div>
    ${game.description ? html`<p class="desc">${game.description}</p>` : html`<p class="desc muted">The developer hasn't written about this game yet.</p>`}
  </div>
  ${developer ? html`<a class="dev-card bevel" href="${profilePath(developer.name)}"><span class="av bevel-s" aria-hidden="true">${developer.name[0]!.toUpperCase()}</span><span><strong>${developer.name}</strong><small>${developer.game_count === 1 ? "1 game on Zaisma" : `${developer.game_count} games on Zaisma`}</small></span></a>` : ""}
</section>
${rooms ? html`<section id="rooms" role="tabpanel" aria-label="Rooms" hidden>${codeBox(game.slug)}<div id="rooms-list">${roomsPanel(game, rooms)}</div></section>` : ""}
${updates.results.length
      ? html`<section id="updates" role="tabpanel" aria-label="Updates" hidden><ol class="updates">${updates.results.map(
          (update) => html`<li><h3>${day(update.published_at_ms)}</h3><p>${update.patch_notes}</p></li>`,
        )}</ol></section>`
      : ""}
${more.length ? html`<section class="more" aria-labelledby="more-title"><h2 class="rule-h" id="more-title">More games</h2><div class="grid">${more.map((otherGame) => tile(otherGame))}</div></section>` : ""}
</main>
<template id="game-frame"><iframe id="game"${tester || isAccountsOnly || isClosed ? "" : html` src="${frameUrl}"`} title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated" allowfullscreen referrerpolicy="no-referrer"></iframe></template>
${hasRoomCodes
      ? html`<dialog id="room-dialog" class="quick plate room-dialog" aria-label="Room">
  <section class="room-here" id="room-here" hidden>
    <p class="room-title">This room</p>
    <div class="room-line"><b id="room-code-text"></b><button class="btn ghost" type="button" id="room-copy">Copy</button><button class="btn ghost icon" type="button" id="room-eye" aria-pressed="false" title="Hide the room code" aria-label="Hide the room code">${raw(ICON_EYE)}</button></div>
    <p id="room-closed" hidden>This room doesn't take new players.</p>
  </section>
  <form method="get" action="${here}"><label for="bar-join-code">Join a room by its code</label>
  <div class="join-row"><input id="bar-join-code" name="room" required maxlength="8" minlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" pattern="[2-9A-HJ-NP-Za-hj-np-z]{6}" placeholder="ABC234" title="6 letters and numbers, like ABC234"><button class="btn" type="submit">Join</button></div>
  <p id="join-leaves" hidden>It leaves the room you're in.</p></form>
</dialog>`
      : ""}
${isClosed ? "" : raw(connectionPlate())}
<dialog id="menu-dialog" class="quick plate" aria-label="${game.title}">
  <div class="q-head">
    <strong>${game.title}</strong>
    ${ownServers.length ? html`<p class="q-about">${ownServersLine(ownServers)}</p>` : ""}
    ${saves ? html`<p id="save-status" class="save-line" role="status" hidden></p>` : ""}
  </div>
  <nav>
    ${saves ? html`<a id="keep-link" href="${joinHere}" data-keep="/join" hidden>${raw(ICON_KEEP)}Keep your progress</a>` : ""}
    <a href="/g/${game.slug}/report" data-report>${raw(ICON_REPORT)}Report this game</a>
    <span class="sep" aria-hidden="true"></span>
    <a href="/legal/content-rules" target="_blank" rel="noopener">${raw(ICON_RULES)}Content rules${raw(ICON_OUT)}</a>
    <a href="/">${raw(ICON_GAMES)}All games</a>
  </nav>
</dialog>
${reportSheet(game, { isMultiplayer: multiplayer, gameOrigin: new URL(frameUrl).origin })}
${multiplayer ? blockSheet({ gameOrigin: new URL(frameUrl).origin }) : ""}
${multiplayer ? playersSheet({ gameOrigin: new URL(frameUrl).origin, slug: game.slug, title: game.title, hasZaismaRooms: game.multiplayer_mode !== "none", canSignIn, signInPath: `/signin?next=${encodeURIComponent(`/g/${game.slug}`)}` }) : ""}
${saves
      ? html`<aside class="keep plate bevel" id="keep" aria-labelledby="keep-title" hidden>
  <strong id="keep-title">Keep your progress</strong>
  <p>Your ${game.title} progress is only saved in this browser. Make a free account to keep it safe and play on any device.</p>
  <div class="row">${metalButton("Make an account", { href: joinHere, dataAttributes: { keep: "/join" } })}<button class="btn ghost" type="button" id="keep-later">Not now</button></div>
  <p class="small">Have an account? <a href="${signinHere}" data-keep="/signin">Sign in</a></p>
</aside>`
      : ""}
${saves ? html`<p class="keep-toast plate" id="save-toast" role="status" hidden></p>` : ""}
${canSignIn
      ? html`<aside class="keep plate bevel" id="sign-in-ask" aria-labelledby="sign-in-title" hidden>
  <strong id="sign-in-title">${game.title} asks you to sign in</strong>
  <p id="sign-in-text">Make a free Zaisma account or sign in. The game keeps running here while you do.</p>
  <div class="row">${metalButton("Make an account", { href: joinHere, dataAttributes: { "sign-in": "/join" } })}<button class="btn ghost" type="button" id="sign-in-later">Not now</button></div>
  <p class="small">Have an account? <a href="${signinHere}" data-sign-in="/signin">Sign in</a></p>
</aside>`
      : ""}
${leavingCard(game.title)}
${shareDialog(game.title, !tester)}
${tester && !multiplayer ? "" : html`<div id="play-check" class="play-check"></div>`}
</div>
${siteFooter()}
${pageData("game-page-data", {
      slug: game.slug,
      tester_token: tester?.token ?? null,
      room_code: inRoom ? code : "",
      is_multiplayer: multiplayer,
      frame_url: frameUrl,
      // Game files start before Play, on the game's own address: never for tester links or accounts-only games, which need a cookie first.
      warm_url: tester || isAccountsOnly || isClosed ? null : `${gameUrl(env, game.slug)}_zaisma/warm`,
      is_accounts_only: isAccountsOnly,
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
      // A room link is an invitation into a match already underway, and ?play comes from a Play button elsewhere: both skip the details.
      autoplay: autoplay ? (accountRequirement === "whole_game" || (accountRequirement === "multiplayer" && inRoom) ? "when_signed_in" : "always") : "never",
    })}
${saves && !isClosed ? pageData("saves-data", { api: `/api/saves/${game.slug}`, root: gameUrl(env, game.slug), query: roomQuery, frameOrigin: new URL(frameUrl).origin, slug: game.slug, offerAfter: (Number(env.KEEP_OFFER_SECONDS) || 300) * 1000, isAccountOfferEnabled: Boolean(game.account_offer_enabled) }) : ""}
${isClosed
      ? scriptTags(GAME_PAGE_SCRIPT, GAME_EMBEDDED_SCRIPT)
      : scriptTags(
          GAME_PAGE_SCRIPT,
          ...(tester && !multiplayer ? [] : [PLAY_COUNTER_SCRIPT]),
          ...(saves ? [SAVES_SCRIPT] : []),
          ...(accountRequirement !== "none" ? [ACCOUNT_GATE_SCRIPT] : []),
          ...(canSignIn ? [SIGN_IN_WHILE_PLAYING_SCRIPT] : []),
          GAME_LINKS_SCRIPT,
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

const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_PLAYERS = svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.4 14.4c2.6-.3 4.6 1.4 5.1 4.6"/>');
const ICON_SHARE = svg('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>');
const ICON_KEEP = svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>');
const ICON_HASH = svg('<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18"/>');
const ICON_EYE = svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="eye-off" d="M4 4l16 16"/>');
const ICON_FULL = svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>');
const DEVICE_ICONS: Record<string, string> = {
  phone: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6" y="2" width="8" height="16" rx="1.5"/><path d="M9 15h2"/></svg>',
  tablet: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="2" width="14" height="16" rx="1.5"/><path d="M9 15h2"/></svg>',
  computer: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="3" width="16" height="11" rx="1"/><path d="M7 17h6M10 14v3"/></svg>',
};
const DEVICE_LABELS: Record<string, string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };
const ICON_REPORT = svg('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>');
const ICON_RULES = svg('<path d="M12 3l8 3v6c0 4.4-3.4 8.2-8 9-4.6-.8-8-4.6-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>');
const ICON_GAMES = svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>');
const ICON_OUT = svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>').replace("<svg ", '<svg class="ext" ');
const ICON_MORE = svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>');

/** zaisma.com/t/<token>: a tester link that's on opens its game, noting when it was last used. */
export async function testerPage(env: Env, token: string, request: Request, ctx: ExecutionContext): Promise<Response> {
  const link = await testerLinkByToken(env.DB, token);
  if (!link) return message(env, "This link doesn't work", "The developer may have turned it off. Ask them for a fresh link.", 404);
  if (!isTesterLinkOn(link)) return message(env, "This link ended", `It worked until ${day(link.ends_at_ms!)}. Ask the developer for a fresh link.`, 404);
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
  if (!version || !expiresAtMs || !game) return message(env, "This preview link doesn't work", "Preview links last a day, and the developer can turn them off. Get a fresh one from the dashboard or the API.", 404);
  if (!canOpen(game)) return message(env, game.review_status === "removed" ? "This game was removed" : "This game is being reviewed", "Its previews are closed too.", game.review_status === "removed" ? 410 : 404);
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
<h2>If you make games</h2>
<p>What you and your API keys do to your games (uploads, publishes, database and save changes, secrets and the rest) is kept in each game's history for as long as the game, with who did it and from where, so you can see it. Each change also keeps its connection address for 90 days, shown only to you, so a report of illegal material can be traced to whoever uploaded it. Keep where my account is used from turns that off, except for uploads: a version's or an image's upload keeps its address for 90 days either way. To tell you when a key is used from somewhere new, we keep a fingerprint of each network and country it's used from, never shown, until it's gone unused for 90 days.</p>
<h2>Who helps us run Zaisma</h2>
<ul>
<li><strong>Cloudflare</strong> runs our servers, stores games, sends the email codes you ask for, and checks that a real browser opened a game's page, made an account, typed a password on a new device or asked for an email code. It sees your connection address to deliver pages and stop abuse; we keep it only where this page says. The check is Cloudflare Turnstile, covered by its <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Turnstile Privacy Addendum</a>.</li>
<li><strong>Supabase</strong> handles sign-in: it checks your password, keeping only a hash, and holds your email if you added one. When you sign in, we pass it your connection address, so its limits on tries count you and not everyone at once, and it keeps that address with each sign-in. Your browser never talks to it directly.</li>
<li><strong>Anthropic</strong> reviews uploaded games for safety. It sees game files, never players.</li>
</ul>
<p>We never sell your data, and there are no ads on Zaisma.</p>
<h2>Downloading your data</h2>
<p>Go to your account page and choose Download your data. You get one .zip with everything we keep about your account, your game saves as files, and a note saying what each file holds.</p>
<h2>Deleting your account</h2>
<p>Go to your account page and choose Delete account. Your username, password, any email, game saves, recently played games and everything else on your account are deleted straight away. If you made games, they're deleted too, with their files, database and players' saves. Games you played and sites you signed in to with Zaisma are told, so their developers can erase what they kept about you.</p>
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
  document.body.classList.add("playing");
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
// Pictures: the big one shows whichever thumbnail was picked.
document.querySelectorAll(".thumbs button").forEach((b) => b.onclick = () => {
  document.getElementById("shot").src = b.dataset.src;
  document.querySelectorAll(".thumbs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
});
// About, Rooms and Updates.
const tabs = [...document.querySelectorAll(".tabs [role=tab]")];
const showTab = (id) => { tabs.forEach((t) => { const on = t.getAttribute("aria-controls") === id; t.setAttribute("aria-selected", String(on)); document.getElementById(t.getAttribute("aria-controls")).hidden = !on; }); refreshRooms(); };
tabs.forEach((t) => t.onclick = () => showTab(t.getAttribute("aria-controls")));
// Rooms come and go: while the list is on screen, it's brought up to date every 20 seconds. The
// region the player picked is remembered on this device, and "Show more" stays open across updates.
const roomsPanel = document.getElementById("rooms");
let roomsAt = Date.now();
let roomsRegion = "";
let roomsLabels = {};
const roomsKey = () => roomsRegion + "|" + JSON.stringify(Object.entries(roomsLabels).sort());
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
  if (!roomsPanel || (roomsPanel.hidden && force !== "left") || frame || (document.hidden && !force)) return;
  const list = document.getElementById("rooms-list");
  const shown = list.firstElementChild?.dataset.shown || "|[]";
  if (!force && shown === roomsKey() && Date.now() - roomsAt < 19000) return;
  roomsAt = Date.now();
  try {
    const query = new URLSearchParams();
    if (roomsRegion) query.set("region", roomsRegion);
    if (Object.keys(roomsLabels).length) query.set("labels", JSON.stringify(roomsLabels));
    const left = justLeft();
    if (left) query.set("left", left);
    const res = await fetch(location.pathname + "/rooms" + (query.size ? "?" + query : ""));
    if (!res.ok) return;
    list.innerHTML = await res.text();
    const n = list.firstElementChild?.dataset.count || "0";
    const playing = Number(list.firstElementChild?.dataset.playing || 0);
    const line = document.getElementById("playing-now");
    if (line) { line.hidden = playing < ${MINIMUM_PLAYING_NOW_PLAYER_COUNT}; line.textContent = playing + " playing now"; }
    const count = document.getElementById("rooms-count");
    count.textContent = n;
    count.hidden = n === "0";
  } catch {} finally {
    document.documentElement.classList.remove("just-left");
  }
}
if (roomsPanel) {
  // Back on the page just after leaving a match: show the list without this player in it, straight away.
  const comeBack = () => {
    if (!justLeft()) return;
    document.documentElement.classList.add("just-left");
    setTimeout(() => document.documentElement.classList.remove("just-left"), 2000);
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
      roomsPanel.classList.remove("all");
      refreshRooms(true);
    } else if (e.target.closest(".rooms-all")) {
      roomsPanel.classList.add("all");
    }
  });
  roomsPanel.addEventListener("change", (e) => {
    const pick = e.target.closest("select[data-label]");
    if (!pick) return;
    if (pick.value) roomsLabels[pick.dataset.label] = pick.value;
    else delete roomsLabels[pick.dataset.label];
    roomsPanel.classList.remove("all");
    refreshRooms(true);
  });
}
const codeInput = document.getElementById("room-code");
if (codeInput) {
  codeInput.addEventListener("input", () => { codeInput.value = codeInput.value.toUpperCase().replace(/\s/g, ""); codeInput.setCustomValidity(""); });
  codeInput.addEventListener("invalid", () => codeInput.setCustomValidity("Room codes are 6 letters and numbers, like ABC234."));
}
// A link to a tab (like "playing now" to #rooms) opens it, then scrolls to it once it can be seen.
addEventListener("hashchange", () => {
  const t = tabs.find((t) => "#" + t.getAttribute("aria-controls") === location.hash);
  if (!t) return;
  showTab(t.getAttribute("aria-controls"));
  document.getElementById(t.getAttribute("aria-controls")).scrollIntoView({ block: "start" });
});
const linkedTab = tabs.find((t) => "#" + t.getAttribute("aria-controls") === location.hash);
if (linkedTab) showTab(linkedTab.getAttribute("aria-controls"));
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
// The note names the browser that can't, so players know why it's there. Every browser on iPhone is Safari inside.
const browserName = /iPhone/.test(navigator.userAgent) ? "on iPhone" : /iPad/.test(navigator.userAgent) ? "on iPad" : /Firefox\//.test(navigator.userAgent) ? "in Firefox" : !chromium && /Safari\//.test(navigator.userAgent) ? "in Safari" : "in this browser";
if (needsOtherBrowser) deviceNotes.push("This game doesn't work " + browserName + ". Play it in Chrome or Edge on a computer or Android.");
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
  note.textContent = deviceNotes.join(" ");
  note.hidden = false;
  if (needsOtherBrowser || (DEVICES.length && !DEVICES.includes(mine))) document.querySelector("#play span").textContent = "Play anyway";
}
// The menu drops from the ⋯ button (from the side strip on landscape phones) and closes when the
// player taps anywhere else, goes back to the game, or presses Escape.
const menuButton = document.getElementById("menu");
function placeMenu(box = dialog, button = menuButton) {
  const b = button.getBoundingClientRect();
  // Under its button, kept inside the screen: on phones a button near the left would push it off the edge.
  const boxWidth = Math.min(box.offsetWidth || 320, innerWidth - 16);
  const right = Math.max(8, Math.min(innerWidth - b.right, innerWidth - boxWidth - 8));
  const strip = matchMedia("(orientation: landscape) and (max-height: 500px)").matches;
  Object.assign(box.style, strip
    ? { left: b.right + 8 + "px", right: "auto", top: "auto", bottom: Math.max(8, innerHeight - b.bottom) + "px" }
    : { left: "auto", right: right + "px", top: b.bottom + 8 + "px", bottom: "auto" });
}
menuButton.onclick = () => {
  if (dialog.open) return dialog.close();
  placeMenu();
  dialog.show();
  menuButton.setAttribute("aria-expanded", "true");
  const first = dialog.querySelector("nav a:not([hidden])");
  if (first) first.focus({ focusVisible: false });
};
dialog.addEventListener("close", () => { menuButton.setAttribute("aria-expanded", "false"); if (frame && !document.getElementById("report").open) frame.focus(); });
addEventListener("pointerdown", (e) => { if (dialog.open && !dialog.contains(e.target) && !menuButton.contains(e.target)) dialog.close(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && dialog.open) dialog.close(); });
addEventListener("blur", () => { if (dialog.open) dialog.close(); });
addEventListener("resize", () => dialog.open && placeMenu());
// The room control: the room's code while the game is in a room (zaisma:room, then zaisma:players says
// whether it takes others), Join otherwise; its plate has Copy and Join by code. In streamer mode (an
// account setting) the code starts hidden: the eye shows it on this page, and Share blurs it under Show.
const roomOpen = document.getElementById("room-open");
const roomDialog = document.getElementById("room-dialog");
const isStreamerModeOn = gamePage.is_streamer_mode_on === true;
let isRoomCodeHidden = isStreamerModeOn;
let shownRoom = null;
function showRoomCode(room) {
  shownRoom = room;
  if (!roomOpen) return;
  const shownCode = !room ? "Join" : !room.isOpen ? "Closed" : isRoomCodeHidden ? "••••••" : room.code;
  document.getElementById("room-open-text").textContent = shownCode;
  roomOpen.classList.toggle("closed", Boolean(room && !room.isOpen));
  roomOpen.title = !room ? "Join a room by its code" : !room.isOpen ? "This room doesn't take new players" : "The room's code";
  roomDialog.classList.toggle("masked", isRoomCodeHidden);
  document.getElementById("room-here").hidden = !room;
  document.getElementById("join-leaves").hidden = !room;
  document.getElementById("room-closed").hidden = !room || room.isOpen;
  document.getElementById("room-code-text").textContent = room ? (isRoomCodeHidden ? "••••••" : room.code) : "";
  document.getElementById("room-copy").hidden = !room || !room.isOpen;
  const roomEye = document.getElementById("room-eye");
  roomEye.hidden = !isStreamerModeOn || !room || !room.isOpen;
  roomEye.setAttribute("aria-pressed", String(isRoomCodeHidden));
  roomEye.title = isRoomCodeHidden ? "Show the room code" : "Hide the room code";
  roomEye.setAttribute("aria-label", roomEye.title);
}
if (roomOpen && roomDialog) {
  const joinInput = document.getElementById("bar-join-code");
  roomOpen.onclick = () => {
    if (roomDialog.open) return roomDialog.close();
    placeMenu(roomDialog, roomOpen);
    roomDialog.show();
    roomOpen.setAttribute("aria-expanded", "true");
    if (!shownRoom) joinInput.focus();
  };
  roomDialog.addEventListener("close", () => { roomOpen.setAttribute("aria-expanded", "false"); if (frame) frame.focus(); });
  addEventListener("pointerdown", (e) => { if (roomDialog.open && !roomDialog.contains(e.target) && !roomOpen.contains(e.target)) roomDialog.close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && roomDialog.open) roomDialog.close(); });
  // A tap on the game goes to its frame, not this page: the page losing focus closes the plate, as for the ⋯ menu.
  addEventListener("blur", () => { if (roomDialog.open) roomDialog.close(); });
  addEventListener("resize", () => roomDialog.open && placeMenu(roomDialog, roomOpen));
  joinInput.addEventListener("input", () => { joinInput.value = joinInput.value.toUpperCase().replace(/[^0-9A-Z]/g, ""); joinInput.setCustomValidity(""); });
  joinInput.addEventListener("invalid", () => joinInput.setCustomValidity("Room codes are 6 letters and numbers, like ABC234."));
  // The room the player is in already: nothing to leave.
  roomDialog.querySelector("form").addEventListener("submit", (e) => { if (shownRoom && joinInput.value === shownRoom.code) { e.preventDefault(); roomDialog.close(); } });
  document.getElementById("room-eye").onclick = () => {
    isRoomCodeHidden = !isRoomCodeHidden;
    showRoomCode(shownRoom);
  };
  const roomCopy = document.getElementById("room-copy");
  roomCopy.onclick = async () => {
    if (!shownRoom) return;
    try { await navigator.clipboard.writeText(shownRoom.code); roomCopy.textContent = "Copied"; } catch { roomCopy.textContent = "Can't copy"; }
    setTimeout(() => (roomCopy.textContent = "Copy"), 1500);
  };
  showRoomCode(null);
}
// Share opens the share dialog: the address bar's link (with the room code while the player is in a
// match), its QR code for someone in the same room, Copy, and the system's share sheet where there is one.
const shareBox = document.getElementById("share-dialog");
const shareInput = shareBox.querySelector("input");
const shareCopy = document.getElementById("share-copy");
function shareFrom(button) {
  const url = location.origin + location.pathname + location.search.replace(/[?&]play\b[^&]*/, "").replace(/^&/, "?");
  const room = new URLSearchParams(location.search).get("room");
  shareInput.value = url;
  shareCopy.textContent = "Copy";
  const roomLine = document.getElementById("share-room");
  roomLine.hidden = !room;
  roomLine.querySelector("b").textContent = room || "";
  shareBox.classList.toggle("masked", isRoomCodeHidden && Boolean(room));
  document.getElementById("share-reveal").hidden = !shareBox.classList.contains("masked");
  const qr = document.getElementById("share-qr");
  if (qr) {
    qr.src = "/g/" + gamePage.slug + "/qr-code.svg" + (room ? "?room=" + encodeURIComponent(room) : "");
    document.getElementById("share-scan").textContent = room ? "Scan to join this match" : "Scan to play";
  }
  shareBox.showModal();
  shareBox.returnFocus = button;
}
shareCopy.onclick = async () => {
  let copied = false;
  try { await navigator.clipboard.writeText(shareInput.value); copied = true; } catch {
    shareInput.select();
    try { copied = document.execCommand("copy"); } catch {}
  }
  shareCopy.textContent = copied ? "Copied" : "Select and copy";
  if (!copied) shareInput.select();
};
const shareMore = document.getElementById("share-more");
if (navigator.share) {
  shareMore.hidden = false;
  shareMore.onclick = async () => {
    try { await navigator.share({ title: document.title, url: shareInput.value }); shareBox.close(); } catch {}
  };
}
shareInput.onfocus = () => shareInput.select();
// Show on the blur, or a tap on the blurred link, reveals them for this time.
const revealShare = () => { shareBox.classList.remove("masked"); document.getElementById("share-reveal").hidden = true; };
document.getElementById("share-reveal").onclick = revealShare;
shareInput.addEventListener("click", () => { if (shareBox.classList.contains("masked")) revealShare(); });
document.getElementById("share-close").onclick = () => shareBox.close();
shareBox.addEventListener("click", (e) => { if (e.target === shareBox) shareBox.close(); });
shareBox.addEventListener("close", () => { if (frame) frame.focus(); else if (shareBox.returnFocus) shareBox.returnFocus.focus(); });
share.onclick = () => shareFrom(share);
// The game says which room it's in, so the address bar (and so Share) points to that match.
const gameOrigin = new URL(gamePage.frame_url).origin;
addEventListener("message", (e) => {
  if (!frame || e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (d && d.type === "zaisma:room" && typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code)) {
    history.replaceState(null, "", location.pathname + "?room=" + d.code);
    // The code comes first, for Share; joined once the room let the player in.
    if (d.joined === true) {
      inRoom = { code: d.code, at: Date.now() };
      if (!shownRoom || shownRoom.code !== d.code) showRoomCode({ code: d.code, isOpen: true });
    }
  }
  // The game's own Invite or Players button (Zaisma.invite, Zaisma.openSafetyPanel): the same Share and
  // Players as the bar's, only right after the player's tap. Full screen holds only the game, so it ends first.
  if (d && (d.type === "zaisma:share" || d.type === "zaisma:players-open") && (!navigator.userActivation || navigator.userActivation.isActive)) {
    const playersOpen = document.getElementById("players-open");
    const open = () => (d.type === "zaisma:share" ? shareFrom(share) : playersOpen && playersOpen.click());
    if (document.fullscreenElement) document.exitFullscreen().then(open, open);
    else open();
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
  // The game's own save screens (Zaisma.saves) and its moment for "Keep your progress" (Zaisma.player.offerAccount),
  // answered by the saves script; a game without cloud saves here (off, or a tester link) has none.
  if (d && d.type === "zaisma:saves-request" && typeof d.requestNumber === "number" && typeof d.request === "string") {
    if (window.savesRequest) savesRequest(d);
    else if (d.request !== "listen") frame.contentWindow.postMessage({ type: "zaisma:saves-answer", requestNumber: d.requestNumber, error: { code: "cloud_saves_off", message: "This game has cloud saves off, so it has no saves on players' accounts." } }, gameOrigin);
  }
  if (d && d.type === "zaisma:account-offer") {
    if (window.offerAccount) offerAccount();
    else frame.contentWindow.postMessage({ type: "zaisma:account-offer", status: "cloud_saves_off" }, gameOrigin);
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
    playButton.querySelector("span").textContent = "Sign in to play";
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

/** "151 playing now" under the title: the larger of everyone in the game's rooms (hidden ones too) and the browsers playing it. */
function playingLine(playerCount: number, roomsHere: boolean): Raw {
  const hidden = playerCount < MINIMUM_PLAYING_NOW_PLAYER_COUNT ? raw(" hidden") : "";
  return roomsHere
    ? html`<a class="badge live-now" id="playing-now" href="#rooms"${hidden}>${playerCount} playing now</a>`
    : html`<p class="badge live-now" id="playing-now"${hidden}>${playerCount} playing now</p>`;
}
