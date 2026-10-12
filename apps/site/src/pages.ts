import { AUTO_HOLD_REASONS, REPORT_REASONS, audit, createReport, gameBySlug, setGameStatus, type ReportReason } from "@zaisma/core";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, message, metalButton, raw, siteFooter, siteHeader } from "./html.ts";
import { showcase, tile } from "./home.ts";
import { SAVES_CLIENT } from "./saves-client.ts";
import { sendAlert } from "./email.ts";

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export async function gamePage(env: Env, slug: string, url: URL): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status === "pending" || game.visibility === "draft" || game.visibility === "private") return message(env, "Game not found", "Check the link and try again.", 404);
  if (game.status === "removed") return message(env, "This game was removed", "It broke Zaisma's content rules or was taken down on request.", 410);
  if (game.status === "held") return message(env, "This game is being reviewed", "Someone reported it and we're taking a look. Try again later.", 404);

  // A room link (zaisma.com/g/<slug>?room=CODE) drops the player straight into that match.
  const code = url.searchParams.get("room")?.toUpperCase() ?? "";
  const inRoom = ROOM_CODE.test(code);
  const src = gameUrl(env, game.slug) + (inRoom ? `?room=${code}` : "");
  const saves = Boolean(game.cloud_saves && env.SUPABASE_URL);
  const multiplayer = Boolean(game.game_server || game.connect_hosts);
  const ownServers = game.connect_hosts.split("\n").filter(Boolean).map((o) => o.replace(/^[a-z]+:\/\//, ""));
  const autoplay = inRoom || url.searchParams.has("play");
  const [developer, pictures, updates, others] = await Promise.all([
    game.owner_id
      ? env.DB.prepare("SELECT accounts.name, (SELECT COUNT(*) FROM games WHERE owner_id = ? AND status = 'live' AND visibility = 'listed') AS games FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(game.owner_id, game.owner_id).first<{ name: string; games: number }>()
      : null,
    env.DB.prepare("SELECT id, kind FROM game_images WHERE game_id = ? AND status = 'approved' ORDER BY kind = 'cover' DESC, created_at").bind(game.id).all<{ id: string; kind: string }>(),
    env.DB.prepare("SELECT id, notes, published_at FROM versions WHERE game_id = ? AND published_at IS NOT NULL AND notes != '' ORDER BY published_at DESC LIMIT 10").bind(game.id).all<{ id: string; notes: string; published_at: number }>(),
    showcase(env, 60),
  ]);
  const shots = pictures.results.map((p) => `/img/${p.id}`);
  const more = [...others.filter((g) => g.slug !== game.slug && g.owner_id && g.owner_id === game.owner_id), ...others.filter((g) => g.slug !== game.slug && (!g.owner_id || g.owner_id !== game.owner_id))].slice(0, 4);
  const devices = game.devices ? game.devices.split(",") : [];
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const res = layout(env, {
    title: `${game.title} on Zaisma`,
    bare: true,
    body: html`<style>
/* Two states on one page: details with a Play button, then the game filling the screen. */
body.playing{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}
body:not(.playing) #full{display:none}
body.playing>header.top,body.playing>main.gp,body.playing>footer{display:none}
body:not(.playing) .bar{display:none}
.bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);flex:none}
main.gp{max-width:1240px;margin:0 auto;padding:28px 24px 64px}
.gp-top{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:32px;align-items:start}
.viewer .shot{aspect-ratio:16/9;background:var(--pic);overflow:hidden}
.viewer .shot img{width:100%;height:100%;object-fit:cover;display:block}
.viewer .thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;margin-top:10px}
.viewer .thumbs button{padding:0;border:0;background:var(--pic);aspect-ratio:16/9;cursor:pointer;overflow:hidden;opacity:.6}
.viewer .thumbs button[aria-pressed=true]{opacity:1;box-shadow:0 0 0 2px #000,-2px -2px 0 2px #fff}
.viewer .thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.side{display:flex;flex-direction:column;gap:16px}
.side h1{margin:0}
.side .by{margin:-8px 0 0;color:var(--muted);font-size:15px}
.side .by a{color:var(--text-2)}
.devices{display:flex;align-items:center;gap:14px;color:var(--muted);font-size:14px}
.devices svg{width:20px;height:20px;color:var(--text)}
.devices span{display:inline-flex;gap:6px;align-items:center}
.side .row .btn{flex:1}
.side .note{margin:0;font-size:14px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:40px 0 24px}
.tabs button{min-height:48px;padding:0 18px;border:0;background:none;color:var(--muted);font:inherit;font-weight:600;font-size:15px;cursor:pointer;box-shadow:inset 0 -2px 0 transparent}
.tabs button[aria-selected=true]{color:var(--text);box-shadow:inset 0 -2px 0 var(--text)}
.about{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px;align-items:start}
.about .desc{font-size:17px;color:var(--text-2);white-space:pre-line;margin:0 0 16px}
.dev-card{display:flex;align-items:center;gap:12px;background:var(--panel);padding:14px;text-decoration:none}
.dev-card .av{flex:none;width:44px;height:44px;background:var(--raised);display:grid;place-items:center;font-weight:700;font-family:var(--display);font-size:20px}
.dev-card small{display:block;color:var(--muted);font-size:13px}
.updates{list-style:none;padding:0;margin:0;display:grid;gap:14px;max-width:760px}
.updates li{background:var(--panel-2);padding:16px 18px}
.updates h3{margin:0 0 6px;font-size:17px}
.updates p{margin:0;color:var(--text-2);white-space:pre-line}
.more h2{margin-top:48px}
@media (max-width:900px){.gp-top,.about{grid-template-columns:1fr}main.gp{padding:16px 16px 48px}}
.bar .home img{height:22px;display:block}
.bar h1{font-size:15px;margin:0 0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.ctl{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--text);font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.ctl:hover{border-color:#55585f}
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
  .bar{flex-direction:column;border-bottom:0;border-right:1px solid var(--line);padding:8px 5px;gap:10px}
  .bar h1{display:none}
  .bar .spacer{flex:1}
  .ctl{width:40px;height:40px;padding:0;justify-content:center}
  .ctl .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
}
/* The menu only appears when the player opens it, so it may cover the game. */
dialog{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;padding:0;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px)}
dialog::backdrop{background:rgba(0,0,0,.55)}
dialog .head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)}
dialog .head strong{font-size:16px}
dialog .body{padding:14px 16px;display:grid;gap:12px;font-size:14px}
dialog .body p{margin:0;color:var(--muted)}
dialog nav{display:grid;gap:6px;padding:0 16px 16px}
dialog nav a{display:block;padding:10px 12px;border:1px solid var(--line);border-radius:8px;text-decoration:none}
dialog nav a:hover{border-color:#55585f}
</style>
${siteHeader(env)}
<div class="bar">
  <a class="home" href="/" title="All games"><img src="/zaisma-mark-metal.svg" alt="Zaisma"></a>
  <h1>${game.title}</h1>
  <span class="spacer"></span>
  <button class="ctl" id="share" type="button" title="Share">${raw(ICON_SHARE)}<span class="label">Share</span></button>
  <button class="ctl" id="full" type="button" title="Full screen">${raw(ICON_FULL)}<span class="label">Full screen</span></button>
  <button class="ctl" id="menu" type="button" title="More" aria-haspopup="dialog">${raw(ICON_MORE)}<span class="label">More</span></button>
</div>
<main class="gp">
<section class="gp-top" aria-labelledby="title">
  <div class="viewer">
    <div class="shot bevel-l">${shots[0] ? html`<img id="shot" src="${shots[0]}" alt="${game.title}">` : ""}</div>
    ${shots.length > 1 ? html`<div class="thumbs">${shots.map((src, i) => html`<button type="button" data-src="${src}" aria-label="Picture ${i + 1} of ${shots.length}" aria-pressed="${i === 0}"><img src="${src}" alt="" loading="lazy"></button>`)}</div>` : ""}
  </div>
  <div class="side">
    <h1 id="title">${game.title}</h1>
    <p class="by">${developer ? html`by ${developer.name} · ` : ""}${multiplayer ? "Multiplayer" : "Single-player"}</p>
    ${metalButton("Play", { id: "play", big: true, block: true, play: true })}
    <p class="note" id="device-note" hidden></p>
    ${devices.length ? html`<div class="devices">${devices.map((d) => html`<span title="Plays on ${d}s">${raw(DEVICE_ICONS[d] ?? "")}${d[0]!.toUpperCase() + d.slice(1)}</span>`)}</div>` : ""}
    <div class="row"><button class="btn ghost" id="share-page" type="button">${raw(ICON_SHARE)}<span class="label">Share</span></button><a class="btn ghost" href="/g/${game.slug}/report">Report</a></div>
  </div>
</section>
${updates.results.length
      ? html`<div class="tabs" role="tablist" aria-label="About this game"><button type="button" role="tab" id="tab-about" aria-controls="about" aria-selected="true">About</button><button type="button" role="tab" id="tab-updates" aria-controls="updates" aria-selected="false">Updates</button></div>`
      : html`<div class="tabs"></div>`}
<section class="about" id="about" role="tabpanel" aria-label="About">
  <div>
    ${game.description ? html`<p class="desc">${game.description}</p>` : html`<p class="desc muted">The developer hasn't written about this game yet.</p>`}
    ${ownServers.length ? html`<p class="note">This game also connects to its own servers: ${ownServers.join(", ")}.</p>` : ""}
  </div>
  ${developer ? html`<div class="dev-card"><span class="av bevel-s" aria-hidden="true">${developer.name[0]!.toUpperCase()}</span><span><strong>${developer.name}</strong><small>${developer.games === 1 ? "1 game on Zaisma" : `${developer.games} games on Zaisma`}</small></span></div>` : ""}
</section>
${updates.results.length
      ? html`<section id="updates" role="tabpanel" aria-label="Updates" hidden><ol class="updates">${updates.results.map(
          (u) => html`<li><h3>${day(u.published_at)}</h3><p>${u.notes}</p></li>`,
        )}</ol></section>`
      : ""}
${more.length ? html`<section class="more" aria-labelledby="more-title"><h2 id="more-title">More games</h2><div class="grid">${more.map((g) => tile(g))}</div></section>` : ""}
</main>
${siteFooter()}
<template id="game-frame"><iframe id="game" src="${src}" title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay; web-share; clipboard-write" allowfullscreen referrerpolicy="no-referrer"></iframe></template>
<dialog id="menu-dialog" aria-label="${game.title}">
  <div class="head"><strong>${game.title}</strong><button class="ctl" type="button" id="menu-close">Close</button></div>
  <div class="body">
    ${game.description ? html`<p>${game.description}</p>` : ""}
    ${multiplayer ? html`<p>Multiplayer. Share the link while you're in a match to bring friends into it.</p>` : ""}
    ${ownServers.length ? html`<p>This game also connects to its own servers: ${ownServers.join(", ")}.</p>` : ""}
  </div>
  ${saves ? html`<p id="save-status" class="muted" hidden></p>` : ""}
  <nav>
    <a href="/g/${game.slug}/report">Report this game</a>
    <a href="/legal/content-rules">Content rules</a>
    <a href="/">All games</a>
  </nav>
</dialog>
${saves
      ? html`<dialog id="save-choice" aria-labelledby="save-choice-title"><form method="dialog">
  <div class="head"><strong id="save-choice-title"></strong></div>
  <div class="body"><p></p></div>
  <nav><button class="btn" value="cloud"></button><button class="btn ghost" value="local"></button></nav>
</form></dialog>`
      : ""}
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
  remember();
  frame = document.getElementById("game-frame").content.firstElementChild.cloneNode(true);
  if (window.startSaves) startSaves(frame);
  document.body.appendChild(frame);
  document.body.classList.add("playing");
  scrollTo(0, 0);
  frame.focus();
}
document.getElementById("play").onclick = play;
document.getElementById("share-page").onclick = () => share.click();
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
// About and Updates.
const tabs = [...document.querySelectorAll(".tabs [role=tab]")];
const showTab = (id) => tabs.forEach((t) => { const on = t.getAttribute("aria-controls") === id; t.setAttribute("aria-selected", String(on)); document.getElementById(t.getAttribute("aria-controls")).hidden = !on; });
tabs.forEach((t) => t.onclick = () => showTab(t.getAttribute("aria-controls")));
if (location.hash === "#updates" && tabs.length) showTab("updates");
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
document.getElementById("menu").onclick = () => dialog.showModal();
document.getElementById("menu-close").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => frame && frame.focus());
// Shares the address bar, which includes the room code while the player is in a match.
share.onclick = async () => {
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: document.title, url: location.href }); } catch {}
    return;
  }
  try {
    await navigator.clipboard.writeText(location.href);
    share.title = "Link copied";
    share.querySelector(".label").textContent = "Copied";
    setTimeout(() => { share.title = "Share"; share.querySelector(".label").textContent = "Share"; }, 1500);
  } catch { prompt("Copy this link", location.href); }
};
// The game says which room it's in, so the address bar (and so Share) points to that match.
const gameOrigin = new URL(${raw(JSON.stringify(src))}).origin;
addEventListener("message", (e) => {
  if (!frame || e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (d && d.type === "zaisma:room" && typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code)) {
    history.replaceState(null, "", location.pathname + "?room=" + d.code);
  }
});
${raw(saves ? `const SAVES = ${JSON.stringify({ api: `/api/saves/${game.slug}`, root: gameUrl(env, game.slug), query: inRoom ? `?room=${code}` : "", frameOrigin: new URL(src).origin }).replace(/</g, "\\u003c")};\n${SAVES_CLIENT}` : "")}
// A room link is an invitation into a match already underway, and ?play comes from a Play button elsewhere: both skip the details.
${raw(autoplay ? "play();" : "")}
</script>`,
  });
  // Unlisted games are for people with the link, never search engines.
  if (game.visibility === "unlisted") res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_SHARE = svg('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>');
const ICON_FULL = svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>');
const DEVICE_ICONS: Record<string, string> = {
  phone: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6" y="2" width="8" height="16" rx="1.5"/><path d="M9 15h2"/></svg>',
  tablet: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="2" width="14" height="16" rx="1.5"/><path d="M9 15h2"/></svg>',
  computer: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="3" width="16" height="11" rx="1"/><path d="M7 17h6M10 14v3"/></svg>',
};
const ICON_MORE = svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>');

export async function reportForm(env: Env, slug: string, error = ""): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status === "pending" || game.visibility === "draft" || game.visibility === "private") return message(env, "Game not found", "Check the link and try again.", 404);
  return layout(env, {
    title: `Report ${game.title}`,
    body: html`<h1>Report “${game.title}”</h1>
<p class="lead">Tell us what's wrong. We don't record who you are.</p>
${error ? html`<p class="note">${error}</p>` : ""}
<form class="stack" method="post">
  <label>What's the problem?
    <select name="reason" required>
      <option value="">Choose one</option>
      ${Object.entries(REPORT_REASONS).map(([value, label]) => html`<option value="${value}">${label}</option>`)}
    </select>
  </label>
  <label>Details (optional)
    <textarea name="details" maxlength="2000" placeholder="What did you see, and where in the game?"></textarea>
  </label>
  <p class="note">Copyright claims need a formal notice: see the <a href="/legal/dmca">DMCA page</a>.</p>
  <div class="row"><button class="btn" type="submit">Send report</button><a class="btn ghost" href="/g/${game.slug}">Cancel</a></div>
</form>`,
  });
}

export async function submitReport(env: Env, request: Request, slug: string, ctx: ExecutionContext): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status === "pending" || game.visibility === "draft" || game.visibility === "private") return message(env, "Game not found", "Check the link and try again.", 404);

  // Rate limit by connection address. It's checked by Cloudflare and never stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.REPORT_LIMIT && !(await env.REPORT_LIMIT.limit({ key: ip })).success) {
    return message(env, "Too many reports", "Please wait a minute and try again.", 429);
  }

  const form = await request.formData();
  const reason = String(form.get("reason") ?? "") as ReportReason;
  const details = String(form.get("details") ?? "").slice(0, 2000).trim();
  if (!(reason in REPORT_REASONS)) return reportForm(env, slug, "Choose what the problem is.");

  await createReport(env.DB, { gameId: game.id, reason, details });
  const autoHold = AUTO_HOLD_REASONS.includes(reason) && game.status === "live";
  if (autoHold) {
    await setGameStatus(env.DB, game.id, "held");
    await audit(env.DB, game.id, "auto-hold", `Report: ${REPORT_REASONS[reason]}`);
  }
  ctx.waitUntil(
    sendAlert(
      env,
      `Report on ${game.slug}: ${REPORT_REASONS[reason]}${autoHold ? " (game hidden)" : ""}`,
      `${REPORT_REASONS[reason]}\n\n${details || "(no details)"}\n\n${autoHold ? "The game is hidden until you review it.\n\n" : ""}Review: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
    ),
  );
  return message(env, "Thanks for the report", "We'll look at it soon.");
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

// DRAFT: Julius approves this wording before it's deployed.
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
</ul>
<h2>How we check</h2>
<p>Every game is scanned before it's published: automatic malware checks, matching against known illegal images, and an AI review. Games that need a closer look wait for a person.</p>
<h2>Reports and takedowns</h2>
<p>Every game page has a Report button. We remove games that break these rules. Reports about child safety or illegal content hide the game straight away until we've reviewed it.</p>
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

// Approved by Julius on Oct 12, 2026.
const PRIVACY = `
<p class="lead">Zaisma keeps as little about you as it can. Playing needs no account, and guests leave nothing behind.</p>
<h2>Playing as a guest</h2>
<p>Guests get a temporary ID and a made-up name like "Swift Fox 42", used only to run the game session. They're kept in your browser tab and forgotten when it closes. We don't keep a profile, and we don't know who you are.</p>
<p>Your browser also remembers which games you played recently, so the home page can show them first. That list stays on your device; we never see it.</p>
<h2>If you make an account</h2>
<ul>
<li><strong>Your email</strong>, only to sign you in. It's never shown to anyone, and we don't send marketing.</li>
<li><strong>Your name</strong>, the one you pick. Other players can see it.</li>
<li><strong>Your age group</strong>: 13 to 17, or 18 and over. We ask your birth date once to work it out and never keep it.</li>
<li><strong>Your game saves.</strong> If you're signed in, your game saves are stored with your account, so your progress follows you to any device.</li>
<li><strong>The games you played recently</strong> (the last 20), so Continue playing follows you to any device too.</li>
</ul>
<p>Accounts are for people 13 and up. If you're younger, you can't make one, and we keep nothing you typed. If we find out we have an account for someone under 13, we delete it.</p>
<h2>Cookies</h2>
<p>We only use cookies to keep you signed in and to remember where you are while you make an account. No ads, no tracking, no analytics cookies.</p>
<h2>Reports</h2>
<p>When you report a game or a player, we keep what you wrote and nothing about you. Reports about a player include their temporary ID or name so we can act on it.</p>
<h2>Games</h2>
<p>Games run on a separate domain and can't see your account, email or cookies. Our content rules don't allow games to collect players' personal data.</p>
<h2>Who helps us run Zaisma</h2>
<ul>
<li><strong>Cloudflare</strong> runs our servers and stores games. It sees your connection address to deliver pages and stop abuse; we don't store it.</li>
<li><strong>Supabase</strong> handles sign-in and holds your email. Your browser never talks to it directly.</li>
<li><strong>Anthropic</strong> reviews uploaded games for safety. It sees game files, never players.</li>
</ul>
<p>We never sell your data, and there are no ads on Zaisma.</p>
<h2>Deleting your account</h2>
<p>Go to your account page and choose Delete account. Your email, name, game saves, recently played games and everything else on your account are deleted straight away.</p>
<h2>Questions</h2>
<p>Email <a href="mailto:privacy@zaisma.com">privacy@zaisma.com</a>.</p>
`;
