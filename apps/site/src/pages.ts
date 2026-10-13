import { gameBySlug, readPlayers, testerLinkByToken, testerLinkOpened, type TesterLink } from "@zaisma/core";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, message, metalButton, playerModes, raw, siteFooter, siteHeader, type Raw } from "./html.ts";
import { showcase, tile } from "./home.ts";
import { SAVES_CLIENT } from "./saves-client.ts";
import { reportSheet } from "./report.ts";
import { playCounter } from "./plays.ts";
import { codeBox, pageRooms, roomsOnPage, roomsPanel, tabCount } from "./rooms.ts";

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/**
 * A game's page, or the same page opened through a tester link (zaisma.com/t/<token>), which plays
 * the live version whatever the game's visibility. Testers' progress stays in their browser.
 */
export async function gamePage(env: Env, slug: string, request: Request, tester?: TesterLink): Promise<Response> {
  const url = new URL(request.url);
  const game = await gameBySlug(env.DB, slug);
  if (!game || (!tester && (game.status === "pending" || game.visibility === "draft" || game.visibility === "private"))) return message(env, "Game not found", "Check the link and try again.", 404);
  if (game.status === "removed") return message(env, "This game was removed", "It broke Zaisma's content rules or was taken down on request.", 410);
  if (game.status === "held") return message(env, "This game is being reviewed", "Someone reported it and we're taking a look. Try again later.", 404);
  if (tester && (game.status === "pending" || !game.current_version_id)) return message(env, "Nothing to play yet", "The developer hasn't published a version of this game yet. Try the link again later.", 404);
  const here = tester ? `/t/${tester.token}` : `/g/${game.slug}`;
  const hidden = game.visibility === "draft" || game.visibility === "private";

  // A room link (zaisma.com/g/<slug>?room=CODE) drops the player straight into that match.
  const code = url.searchParams.get("room")?.toUpperCase() ?? "";
  const inRoom = ROOM_CODE.test(code);
  const src = gameUrl(env, tester ? `${game.slug}--${tester.token}` : game.slug) + (inRoom ? `?room=${code}` : "");
  const saves = Boolean(game.cloud_saves && env.SUPABASE_URL && !tester);
  // Without a new tab, making an account or signing in comes back to the game.
  const joinHere = `/join?next=${encodeURIComponent(`${here}?play`)}`;
  const signinHere = `/signin?next=${encodeURIComponent(`${here}?play`)}`;
  const multiplayer = Boolean(game.game_server || game.connect_hosts);
  const ownServers = game.connect_hosts.split("\n").filter(Boolean).map((o) => o.replace(/^[a-z]+:\/\//, ""));
  const autoplay = inRoom || url.searchParams.has("play");
  const [developer, pictures, updates, others, live] = await Promise.all([
    game.owner_id
      ? env.DB.prepare("SELECT accounts.name, (SELECT COUNT(*) FROM games WHERE owner_id = ? AND status = 'live' AND visibility = 'listed') AS games FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(game.owner_id, game.owner_id).first<{ name: string; games: number }>()
      : null,
    // The square cover is only for phones' game cards, not one of the game's pictures.
    env.DB.prepare("SELECT id, kind FROM game_images WHERE game_id = ? AND status = 'approved' AND kind != 'square' ORDER BY kind = 'cover' DESC, created_at").bind(game.id).all<{ id: string; kind: string }>(),
    env.DB.prepare("SELECT id, notes, published_at FROM versions WHERE game_id = ? AND published_at IS NOT NULL AND notes != '' ORDER BY published_at DESC LIMIT 10").bind(game.id).all<{ id: string; notes: string; published_at: number }>(),
    showcase(env, 60),
    // Games on Zaisma rooms: who's playing now, and the rooms to list if the developer shows them here.
    // Not on tester links: their rooms are reached by code and invite link.
    game.game_server && !tester ? pageRooms(env, game, request) : null,
  ]);
  const rooms = live && roomsOnPage(game) ? live : null;
  const playingNow = live ? live.playing.players : 0;
  const shots = pictures.results.map((p) => `/img/${p.id}`);
  const more = [...others.filter((g) => g.slug !== game.slug && g.owner_id && g.owner_id === game.owner_id), ...others.filter((g) => g.slug !== game.slug && (!g.owner_id || g.owner_id !== game.owner_id))].slice(0, 4);
  const devices = game.devices ? game.devices.split(",") : [];
  const controls = game.controls ? game.controls.split(",") : [];
  const modes = playerModes(readPlayers(game.players), Boolean(game.game_server));
  const specRows = [
    modes.html ? html`<div><dt>Players</dt><dd>${modes}</dd></div>` : "",
    devices.length ? html`<div><dt>Works on</dt><dd class="icons">${devices.map((d) => html`<span>${raw(DEVICE_ICONS[d] ?? "")}${DEVICE_LABELS[d] ?? d}</span>`)}</dd></div>` : "",
    controls.length ? html`<div><dt>Controls</dt><dd class="icons">${controls.map((c) => html`<span>${raw(CONTROL_ICONS[c] ?? "")}${CONTROL_LABELS[c] ?? c}</span>`)}</dd></div>` : "",
  ];
  const spec = specRows.some(Boolean) ? html`<dl class="spec">${specRows}</dl>` : "";
  const tabs = [{ id: "about", label: "About" }, ...(rooms ? [{ id: "rooms", label: "Rooms" }] : []), ...(updates.results.length ? [{ id: "updates", label: "Updates" }] : [])];
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const res = layout(env, {
    title: `${game.title} on Zaisma`,
    bare: true,
    // Cloudflare's invisible check on Play, for play counts (not on tester links, which aren't counted).
    check: !tester && Boolean(env.TURNSTILE_SITE_KEY),
    art: shots[0] ?? null,
    body: html`<style>
/* Two states on one page: details with a Play button, then the game filling the screen. */
/* Cloudflare's check on Play is invisible; if it ever needs a tap, it sits above the game. */
.play-check{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:50}
body.playing{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;background:#000}
body:not(.playing) #full{display:none}
body.playing>header.top,body.playing>main.gp,body.playing>footer,body.playing>.ambient{display:none}
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
/* Playing now: the live green square, linking to the rooms when they're listed here. */
.side .live-now{align-self:flex-start;margin:-6px 0 0;font-size:14px;text-decoration:none}
.side .live-now[hidden]{display:none}
a.live-now:hover{text-decoration:underline;text-underline-offset:3px}
.side .note{margin:0;font-size:14px;background:none;box-shadow:none;padding:0;color:var(--warn)}
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
.share-link[hidden]{display:none}
.share-link input{width:100%}
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
.dev-card{display:flex;align-items:center;gap:14px;padding:16px;text-decoration:none}
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
iframe{flex:1;border:0;width:100%;min-height:0;min-width:0;background:#000}
body:not(.playing) iframe{display:none}
/* Phones: icons only, big enough to tap. */
@media (max-width:640px){.ctl{width:40px;height:40px;padding:0;justify-content:center}.ctl .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}}
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
}
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
${siteHeader(env)}
<div class="bar">
  <a class="home" href="/" title="All games"><img src="/zaisma-mark-metal.svg" alt="Zaisma"></a>
  <h1>${game.title}</h1>
  <span class="spacer"></span>
  ${saves ? html`<a class="ctl" id="keep-bar" href="${joinHere}" data-keep="/join" title="Keep your progress" hidden>${raw(ICON_KEEP)}<span class="label">Keep progress</span></a>` : ""}
  <button class="ctl" id="share" type="button" title="Share">${raw(ICON_SHARE)}<span class="label">Share</span></button>
  <button class="ctl" id="full" type="button" title="Full screen">${raw(ICON_FULL)}<span class="label">Full screen</span></button>
  <button class="ctl" id="menu" type="button" title="More" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu-dialog">${raw(ICON_MORE)}<span class="label">More</span></button>
</div>
<main class="gp">
<section class="gp-top" aria-labelledby="title">
  <div class="viewer">
    <div class="frame"><div class="bezel bevel-l"><div class="shot">${shots[0] ? html`<img id="shot" src="${shots[0]}" alt="${game.title}">` : ""}</div></div></div>
    ${shots.length > 1 ? html`<div class="thumbs">${shots.map((src, i) => html`<button type="button" class="bevel-s" data-src="${src}" aria-label="Picture ${i + 1} of ${shots.length}" aria-pressed="${i === 0}"><img src="${src}" alt="" loading="lazy"></button>`)}</div>` : ""}
  </div>
  <div class="side plate bevel-l">
    <h1 id="title">${game.title}</h1>
    ${developer ? html`<p class="by">by ${developer.name}</p>` : ""}
    ${tester ? html`<p class="note tester">You're testing this game with a link from its developer.${hidden ? " It isn't public yet: anyone with this link can play, so only share it with other testers." : ""} Your progress stays in this browser.</p>` : ""}
    ${live ? playingLine(playingNow, Boolean(rooms)) : ""}
    ${metalButton("Play", { id: "play", big: true, block: true, play: true })}
    <p class="note" id="device-note" hidden></p>
    ${spec}
    <div class="row"><button class="btn ghost" id="share-page" type="button">${raw(ICON_SHARE)}<span class="label">Share</span></button><a class="btn ghost" href="/g/${game.slug}/report" data-report>Report</a></div>
    <label class="share-link" id="share-link" hidden>Copy this link<input readonly aria-label="Link to this game"></label>
  </div>
</section>
${tabs.length > 1
      ? html`<div class="tabs" role="tablist" aria-label="About this game">${tabs.map(
          (t, i) => html`<button type="button" role="tab" id="tab-${t.id}" aria-controls="${t.id}" aria-selected="${String(i === 0)}">${t.label}${t.id === "rooms" ? html`<span class="tab-count" id="rooms-count"${rooms?.joinable ? "" : raw(" hidden")}>${rooms ? tabCount(rooms) : "0"}</span>` : ""}</button>`,
        )}</div>`
      : html`<div class="tabs"></div>`}
<section class="about" id="about" role="tabpanel" aria-label="About">
  <div>
    ${game.description ? html`<p class="desc">${game.description}</p>` : html`<p class="desc muted">The developer hasn't written about this game yet.</p>`}
    ${ownServers.length ? html`<p class="note">This game also connects to its own servers: ${ownServers.join(", ")}.</p>` : ""}
  </div>
  ${developer ? html`<div class="dev-card bevel"><span class="av bevel-s" aria-hidden="true">${developer.name[0]!.toUpperCase()}</span><span><strong>${developer.name}</strong><small>${developer.games === 1 ? "1 game on Zaisma" : `${developer.games} games on Zaisma`}</small></span></div>` : ""}
</section>
${rooms ? html`<section id="rooms" role="tabpanel" aria-label="Rooms" hidden>${codeBox(game.slug)}<div id="rooms-list">${roomsPanel(game.slug, rooms)}</div></section>` : ""}
${updates.results.length
      ? html`<section id="updates" role="tabpanel" aria-label="Updates" hidden><ol class="updates">${updates.results.map(
          (u) => html`<li><h3>${day(u.published_at)}</h3><p>${u.notes}</p></li>`,
        )}</ol></section>`
      : ""}
${more.length ? html`<section class="more" aria-labelledby="more-title"><h2 class="rule-h" id="more-title">More games</h2><div class="grid">${more.map((g) => tile(g))}</div></section>` : ""}
</main>
${siteFooter()}
<template id="game-frame"><iframe id="game" src="${src}" title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay; web-share; clipboard-write" allowfullscreen referrerpolicy="no-referrer"></iframe></template>
<dialog id="menu-dialog" class="quick plate" aria-label="${game.title}">
  <div class="q-head">
    <strong>${game.title}</strong>
    ${game.description ? html`<p class="q-about">${game.description}</p>` : ""}
    ${ownServers.length ? html`<p class="q-about">Also connects to its own servers: ${ownServers.join(", ")}</p>` : ""}
    ${saves ? html`<p id="save-status" class="save-line" role="status" hidden></p>` : ""}
  </div>
  <nav>
    ${saves ? html`<a id="keep-link" href="${joinHere}" data-keep="/join" hidden>${raw(ICON_KEEP)}Keep your progress</a><a id="save-history" href="/account/saves/${game.slug}" hidden>${raw(ICON_HISTORY)}Earlier progress</a>` : ""}
    <a href="/g/${game.slug}/report" data-report>${raw(ICON_REPORT)}Report this game</a>
    <span class="sep" aria-hidden="true"></span>
    <a href="/legal/content-rules" target="_blank" rel="noopener">${raw(ICON_RULES)}Content rules${raw(ICON_OUT)}</a>
    <a href="/">${raw(ICON_GAMES)}All games</a>
  </nav>
</dialog>
${reportSheet(game, { multiplayer, gameOrigin: new URL(src).origin })}
${saves
      ? html`<aside class="keep plate bevel" id="keep" aria-labelledby="keep-title" hidden>
  <strong id="keep-title">Keep your progress</strong>
  <p>Your ${game.title} progress is only saved in this browser. Make a free account to keep it safe and play on any device.</p>
  <div class="row">${metalButton("Make an account", { href: joinHere, data: { keep: "/join" } })}<button class="btn ghost" type="button" id="keep-later">Not now</button></div>
  <p class="small">Have an account? <a href="${signinHere}" data-keep="/signin">Sign in</a></p>
</aside>
<p class="keep-toast plate" id="save-toast" role="status" hidden></p>
<dialog id="save-choice" aria-labelledby="save-choice-title"><form method="dialog">
  <div class="head"><strong id="save-choice-title"></strong></div>
  <div class="body"><p></p></div>
  <nav><button class="btn" value="cloud"></button><button class="btn ghost" value="local"></button></nav>
</form></dialog>`
      : ""}
${tester ? "" : html`<div id="play-check" class="play-check"></div>`}
<script>
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
  ${raw(tester ? "// A tester link's game stays off Continue playing and out of the play stats." : "remember();\n  countPlay();")}
  frame = document.getElementById("game-frame").content.firstElementChild.cloneNode(true);
  if (window.startSaves) startSaves(frame);
  document.body.appendChild(frame);
  document.body.classList.add("playing");
  scrollTo(0, 0);
  frame.focus();
}
document.getElementById("play").onclick = play;
document.getElementById("share-page").onclick = (e) => shareFrom(e.currentTarget);
${raw(tester ? "" : playCounter(game.slug, env.TURNSTILE_SITE_KEY))}
// Remember the game for Continue playing: on this device, and with the account when signed in.
function remember() {
  try {
    const list = JSON.parse(localStorage.getItem("zaisma:played") || "[]").filter((p) => p.slug !== ${raw(JSON.stringify(game.slug))});
    list.unshift({ slug: ${raw(JSON.stringify(game.slug))}, at: Date.now() });
    localStorage.setItem("zaisma:played", JSON.stringify(list.slice(0, 20)));
  } catch {}
  if (/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) fetch("/api/me/played/${raw(game.slug)}", { method: "POST", keepalive: true }).catch(() => {});
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
async function refreshRooms(force) {
  // The automatic refresh waits while nobody's looking; a pick the player just made always loads.
  if (!roomsPanel || roomsPanel.hidden || frame || (document.hidden && !force)) return;
  const list = document.getElementById("rooms-list");
  const shown = list.firstElementChild?.dataset.shown || "|[]";
  if (!force && shown === roomsKey() && Date.now() - roomsAt < 19000) return;
  roomsAt = Date.now();
  try {
    const query = new URLSearchParams();
    if (roomsRegion) query.set("region", roomsRegion);
    if (Object.keys(roomsLabels).length) query.set("labels", JSON.stringify(roomsLabels));
    const res = await fetch(location.pathname + "/rooms" + (query.size ? "?" + query : ""));
    if (!res.ok) return;
    list.innerHTML = await res.text();
    const n = list.firstElementChild?.dataset.joinable || "0";
    const playing = Number(list.firstElementChild?.dataset.playing || 0);
    const line = document.getElementById("playing-now");
    if (line) { line.hidden = playing < ${raw(String(PLAYING_NOW_MIN))}; line.textContent = playing + " playing now"; }
    const count = document.getElementById("rooms-count");
    count.textContent = n;
    count.hidden = n === "0";
  } catch {}
}
if (roomsPanel) {
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
const DEVICES = ${raw(JSON.stringify(devices))};
const coarse = matchMedia("(pointer: coarse)").matches;
const mine = coarse ? (Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet") : "computer";
if (DEVICES.length && !DEVICES.includes(mine)) {
  const note = document.getElementById("device-note");
  note.textContent = "Made for " + DEVICES.map((d) => d + "s").join(" and ") + ". It may not work well on this " + mine + ".";
  note.hidden = false;
  document.querySelector("#play span").textContent = "Play anyway";
}
// The menu drops from the ⋯ button (from the side strip on landscape phones) and closes when the
// player taps anywhere else, goes back to the game, or presses Escape.
const menuButton = document.getElementById("menu");
function placeMenu() {
  const b = menuButton.getBoundingClientRect();
  const strip = matchMedia("(orientation: landscape) and (max-height: 500px)").matches;
  Object.assign(dialog.style, strip
    ? { left: b.right + 8 + "px", right: "auto", top: "auto", bottom: Math.max(8, innerHeight - b.bottom) + "px" }
    : { left: "auto", right: Math.max(8, innerWidth - b.right) + "px", top: b.bottom + 8 + "px", bottom: "auto" });
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
// Shares the address bar, which includes the room code while the player is in a match.
// The system's share sheet where there is one; otherwise the link is copied and the button says so.
async function shareFrom(button) {
  const url = location.origin + location.pathname + location.search.replace(/[?&]play\b[^&]*/, "").replace(/^&/, "?");
  if (navigator.share) {
    try { await navigator.share({ title: document.title, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const label = button.querySelector(".label");
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch {
    // Some browsers block the clipboard; the older way often still works.
    const t = Object.assign(document.createElement("textarea"), { value: url });
    document.body.appendChild(t);
    t.select();
    try { copied = document.execCommand("copy"); } catch {}
    t.remove();
  }
  if (copied) {
    button.title = "Link copied";
    label.textContent = "Link copied";
    setTimeout(() => { button.title = "Share"; label.textContent = "Share"; }, 2000);
    return;
  }
  // Couldn't copy: show the link, selected, so the player can copy it themselves.
  const box = document.getElementById("share-link");
  if (frame || !box) return prompt("Copy this link", url);
  box.hidden = false;
  box.querySelector("input").value = url;
  box.querySelector("input").select();
}
share.onclick = () => shareFrom(share);
// The game says which room it's in, so the address bar (and so Share) points to that match.
const gameOrigin = new URL(${raw(JSON.stringify(src))}).origin;
addEventListener("message", (e) => {
  if (!frame || e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (d && d.type === "zaisma:room" && typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code)) {
    history.replaceState(null, "", location.pathname + "?room=" + d.code);
  }
});
${raw(saves ? `const SAVES = ${JSON.stringify({ api: `/api/saves/${game.slug}`, root: gameUrl(env, game.slug), query: inRoom ? `?room=${code}` : "", frameOrigin: new URL(src).origin, slug: game.slug, offerAfter: (Number(env.KEEP_OFFER_SECONDS) || 300) * 1000 }).replace(/</g, "\\u003c")};\n${SAVES_CLIENT}` : "")}
// A room link is an invitation into a match already underway, and ?play comes from a Play button elsewhere: both skip the details.
${raw(autoplay ? "play();" : "")}
</script>`,
  });
  // Unlisted games are for people with the link, never search engines.
  if (game.visibility === "unlisted" || tester) res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_SHARE = svg('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>');
const ICON_KEEP = svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>');
const ICON_FULL = svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>');
const DEVICE_ICONS: Record<string, string> = {
  phone: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6" y="2" width="8" height="16" rx="1.5"/><path d="M9 15h2"/></svg>',
  tablet: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="2" width="14" height="16" rx="1.5"/><path d="M9 15h2"/></svg>',
  computer: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="3" width="16" height="11" rx="1"/><path d="M7 17h6M10 14v3"/></svg>',
};
const DEVICE_LABELS: Record<string, string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };
const CONTROL_LABELS: Record<string, string> = { touch: "Touch", "keyboard-mouse": "Keyboard and mouse", gamepad: "Gamepad" };
const CONTROL_ICONS: Record<string, string> = {
  touch: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 11V4.2a1.5 1.5 0 0 1 3 0V9l3.4.7a2 2 0 0 1 1.6 2.2l-.5 3.6A2.6 2.6 0 0 1 12.9 18H10a2.6 2.6 0 0 1-2-1l-3.4-4.3a1.4 1.4 0 0 1 2.1-1.8z"/></svg>',
  "keyboard-mouse": '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="5" width="17" height="10" rx="1"/><path d="M4.5 8h.01M7.5 8h.01M10.5 8h.01M13.5 8h.01M15.5 8h.01M4.5 11h.01M15.5 11h.01M7.5 11.5h5"/></svg>',
  gamepad: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 5.5h7.2a4 4 0 0 1 3.9 3.3l.8 4.4a2 2 0 0 1-3.4 1.7L13 13H7l-1.9 1.9a2 2 0 0 1-3.4-1.7l.8-4.4a4 4 0 0 1 3.9-3.3z"/><path d="M6.2 8.3v3M4.7 9.8h3"/><path d="M13.6 9h.01M15.2 10.6h.01"/></svg>',
};
const ICON_HISTORY = svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6l-2.5 2.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>');
const ICON_REPORT = svg('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>');
const ICON_RULES = svg('<path d="M12 3l8 3v6c0 4.4-3.4 8.2-8 9-4.6-.8-8-4.6-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>');
const ICON_GAMES = svg('<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>');
const ICON_OUT = svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>').replace("<svg ", '<svg class="ext" ');
const ICON_MORE = svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>');

/** zaisma.com/t/<token>: a tester link that's on opens its game, noting when it was last used. */
export async function testerPage(env: Env, token: string, request: Request, ctx: ExecutionContext): Promise<Response> {
  const link = await testerLinkByToken(env.DB, token);
  if (!link) return message(env, "This link doesn't work", "The developer may have turned it off. Ask them for a fresh link.", 404);
  ctx.waitUntil(testerLinkOpened(env.DB, link.id));
  return gamePage(env, link.slug, request, link);
}

export function legal(env: Env, page: string): Response | null {
  const pages: Record<string, { title: string; body: string }> = {
    "content-rules": { title: "Content rules", body: CONTENT_RULES },
    dmca: { title: "Copyright and DMCA notices", body: DMCA },
    privacy: { title: "Privacy", body: PRIVACY },
  };
  const p = pages[page];
  if (!p) return null;
  return layout(env, { title: `${p.title} · Zaisma`, body: html`<h1>${p.title}</h1>${raw(p.body)}` });
}

// DRAFT: Julius approves this wording before it's deployed. The faked-plays rule was approved Oct 13, 2026.
const CONTENT_RULES = `
<p class="lead">Zaisma is for players 13 and up. Any kind of game is welcome, within these rules.</p>
<h2>Not allowed</h2>
<ul>
<li>Sexual content involving minors, in any form. We report it to the National Center for Missing &amp; Exploited Children.</li>
<li>Sexually explicit content.</li>
<li>Malware, crypto miners, phishing, scams or anything that tries to break out of the game.</li>
<li>Content that's illegal in the United States, including real-money gambling.</li>
<li>Hate, harassment or threats against real people or groups.</li>
<li>Other people's games, art, music or characters used without permission.</li>
<li>Collecting players' personal data.</li>
<li>Free-text chat between players. Preset phrases and emotes are fine.</li>
<li>Faking plays or players, with bots, scripts or click farms.</li>
</ul>
<p>Names players give to things in a game (sessions, worlds, maps) are allowed. The game is responsible for keeping them within these rules.</p>
<h2>How we check</h2>
<p>Every game is scanned before it's published: automatic malware checks, matching against known illegal images, and an AI review. Games that need a closer look wait for a person.</p>
<h2>Reports and takedowns</h2>
<p>Every game page has a Report button. We remove games that break these rules. Reports about child safety or illegal content go straight to a person. Until we've checked, a brand-new game is hidden and a recent update goes back to the version before it.</p>
<p>A game with faked plays is taken off Popular, Trending and New. Doing it again can get the game taken down.</p>
`;

const DMCA = `
<p class="lead">If a game on Zaisma uses your work without permission, send us a notice and we'll take it down.</p>
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
<h2>Counter-notices</h2>
<p>If your game was removed and you believe it was a mistake or you have permission, email the same address with a counter-notice. We'll forward it to the person who filed the claim.</p>
`;

// Approved by Julius on Oct 12, 2026; the play stats and play-check lines on Oct 13, 2026.
const PRIVACY = `
<p class="lead">Zaisma keeps as little about you as it can. Playing needs no account, and guests leave nothing behind.</p>
<h2>Playing as a guest</h2>
<p>Guests get a temporary ID and a made-up name like "Swift Fox 42", used only to run the game session. They're kept in your browser tab and forgotten when it closes. We don't keep a profile, and we don't know who you are.</p>
<p>Your browser also remembers which games you played recently, so the home page can show them first. That list stays on your device; we never see it.</p>
<p>When you press Play, we count it for the game's developer and for lists like Popular: that the game was played, how long it was on screen, and whether this browser played it before (and on which day it first did). To keep the counts honest, Cloudflare checks, invisibly, that a real browser pressed Play, and we count players by internet provider (like Comcast or Vodafone) to spot bot networks. A play's details are kept for a day at most; after that we keep only totals for each game and day, never anything that says who played.</p>
<h2>If you make an account</h2>
<ul>
<li><strong>Your email</strong>, only to sign you in. It's never shown to anyone, and we don't send marketing.</li>
<li><strong>Your name</strong>, the one you pick. Other players can see it.</li>
<li><strong>Your age group</strong>: 13 to 17, or 18 and over. We ask your birth date once to work it out and never keep it.</li>
<li><strong>Your game saves.</strong> If you're signed in, your game saves are stored with your account, so your progress follows you to any device.</li>
<li><strong>The games you played recently</strong> (the last 20), so Continue playing follows you to any device too.</li>
<li><strong>Your passkeys</strong>, if you add any: the public half of each key, the kind of device you added it on (like "iPhone") and when you last used it. The private half never leaves your device or password manager.</li>
<li><strong>If you sign in with Google or Discord</strong>, they give us your email, plus the name and profile picture on that account. We only use the email; Supabase, our sign-in provider, keeps the rest with your sign-in.</li>
</ul>
<p>Accounts are for people 13 and up. If you're younger, you can't make one, and we keep nothing you typed. If we find out we have an account for someone under 13, we delete it.</p>
<h2>Cookies</h2>
<p>We only use cookies to keep you signed in and to remember where you are while you make an account. No ads, no tracking, no analytics cookies.</p>
<h2>Reports</h2>
<p>When you report a game or a player, we keep what you wrote and nothing about you. Reports about a player include their temporary ID or name so we can act on it. If you include a picture of the game with your report, we keep it until the report is dealt with and delete it within 30 days.</p>
<h2>Games</h2>
<p>Games run on a separate domain and can't see your account, email or cookies. Our content rules don't allow games to collect players' personal data.</p>
<h2>Who helps us run Zaisma</h2>
<ul>
<li><strong>Cloudflare</strong> runs our servers, stores games and checks that a real browser pressed Play. It sees your connection address to deliver pages and stop abuse; we don't store it. The check on Play is Cloudflare Turnstile, covered by its <a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener">Turnstile Privacy Addendum</a>.</li>
<li><strong>Supabase</strong> handles sign-in and holds your email. Your browser never talks to it directly.</li>
<li><strong>Anthropic</strong> reviews uploaded games for safety. It sees game files, never players.</li>
</ul>
<p>We never sell your data, and there are no ads on Zaisma.</p>
<h2>Deleting your account</h2>
<p>Go to your account page and choose Delete account. Your email, name, game saves, recently played games and everything else on your account are deleted straight away.</p>
<h2>Questions</h2>
<p>Email <a href="mailto:privacy@zaisma.com">privacy@zaisma.com</a>.</p>
`;

/** Fewest players for "playing now" to show, so a new game never looks empty. */
const PLAYING_NOW_MIN = 3;

/** "151 playing now" under the title: everyone in the game's rooms, hidden ones too. */
function playingLine(players: number, roomsHere: boolean): Raw {
  const hidden = players < PLAYING_NOW_MIN ? raw(" hidden") : "";
  return roomsHere
    ? html`<a class="badge live-now" id="playing-now" href="#rooms"${hidden}>${players} playing now</a>`
    : html`<p class="badge live-now" id="playing-now"${hidden}>${players} playing now</p>`;
}
