import { AUTO_HOLD_REASONS, REPORT_REASONS, audit, createReport, gameBySlug, liveGames, setGameStatus, type ReportReason } from "@zaisma/core";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, message, raw } from "./html.ts";
import { sendAlert } from "./email.ts";

export async function home(env: Env): Promise<Response> {
  const games = await liveGames(env.DB);
  return layout(env, {
    title: "Zaisma: every kind of game, one link away",
    body: html`<h1>Every kind of game. One link away.</h1>
<p class="lead">Tap a game and you're playing. No account, no download.</p>
${games.length === 0
      ? html`<p class="empty">The first games are on their way.</p>`
      : html`<div class="grid">${games.map(
          (g) => html`<a class="card" href="/g/${g.slug}"><h3>${g.title}</h3><p>${g.description}</p>${g.game_server || g.connect_hosts ? html`<span class="pill">Multiplayer</span>` : ""}</a>`,
        )}</div>`}`,
  });
}

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export async function gamePage(env: Env, slug: string, url: URL): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status === "pending") return message(env, "Game not found", "Check the link and try again.", 404);
  if (game.status === "removed") return message(env, "This game was removed", "It broke Zaisma's content rules or was taken down on request.", 410);
  if (game.status === "held") return message(env, "This game is being reviewed", "Someone reported it and we're taking a look. Try again later.", 404);

  // A room link (zaisma.com/g/<slug>?room=CODE) drops the player straight into that match.
  const code = url.searchParams.get("room")?.toUpperCase() ?? "";
  const src = gameUrl(env, game.slug) + (ROOM_CODE.test(code) ? `?room=${code}` : "");
  const multiplayer = Boolean(game.game_server || game.connect_hosts);
  const ownServers = game.connect_hosts.split("\n").filter(Boolean).map((o) => o.replace(/^[a-z]+:\/\//, ""));
  return layout(env, {
    title: `${game.title} on Zaisma`,
    bare: true,
    body: html`<style>
body{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}
.bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);flex:none}
.bar .home img{height:22px;display:block}
.bar h1{font-size:15px;margin:0 0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.ctl{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--text);font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.ctl:hover{border-color:#55585f}
.ctl svg{width:18px;height:18px;flex:none}
.ctl[hidden]{display:none}
iframe{flex:1;border:0;width:100%;min-height:0;min-width:0;background:#000}
/* Phones: icons only, big enough to tap. */
@media (max-width:640px){.ctl{width:40px;height:40px;padding:0;justify-content:center}.ctl .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}}
/* Landscape phones: the bar becomes a slim strip down the left edge, so the game keeps its full height. */
@media (orientation:landscape) and (max-height:500px){
  body{flex-direction:row}
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
<div class="bar">
  <a class="home" href="/" title="All games"><img src="/zaisma-mark-metal.svg" alt="Zaisma"></a>
  <h1>${game.title}</h1>
  <span class="spacer"></span>
  <button class="ctl" id="share" type="button" title="Share">${raw(ICON_SHARE)}<span class="label">Share</span></button>
  <button class="ctl" id="full" type="button" title="Full screen">${raw(ICON_FULL)}<span class="label">Full screen</span></button>
  <button class="ctl" id="menu" type="button" title="More" aria-haspopup="dialog">${raw(ICON_MORE)}<span class="label">More</span></button>
</div>
<iframe id="game" src="${src}" title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay; web-share; clipboard-write" allowfullscreen referrerpolicy="no-referrer"></iframe>
<dialog id="menu-dialog" aria-label="${game.title}">
  <div class="head"><strong>${game.title}</strong><button class="ctl" type="button" id="menu-close">Close</button></div>
  <div class="body">
    ${game.description ? html`<p>${game.description}</p>` : ""}
    ${multiplayer ? html`<p>Multiplayer. Share the link while you're in a match to bring friends into it.</p>` : ""}
    ${ownServers.length ? html`<p>This game also connects to its own servers: ${ownServers.join(", ")}.</p>` : ""}
  </div>
  <nav>
    <a href="/g/${game.slug}/report">Report this game</a>
    <a href="/legal/content-rules">Content rules</a>
    <a href="/">All games</a>
  </nav>
</dialog>
<script>
const frame = document.getElementById("game");
const share = document.getElementById("share");
const full = document.getElementById("full");
const dialog = document.getElementById("menu-dialog");
// iPhones can't put a frame in full screen, so don't offer it there.
if (!document.fullscreenEnabled || !frame.requestFullscreen) full.hidden = true;
full.onclick = () => frame.requestFullscreen();
document.getElementById("menu").onclick = () => dialog.showModal();
document.getElementById("menu-close").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => frame.focus());
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
const gameOrigin = new URL(frame.src).origin;
addEventListener("message", (e) => {
  if (e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (d && d.type === "zaisma:room" && typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code)) {
    history.replaceState(null, "", location.pathname + "?room=" + d.code);
  }
});
frame.focus();
</script>`,
  });
}

const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_SHARE = svg('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>');
const ICON_FULL = svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>');
const ICON_MORE = svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>');

export async function reportForm(env: Env, slug: string, error = ""): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status === "pending") return message(env, "Game not found", "Check the link and try again.", 404);
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
  if (!game || game.status === "pending") return message(env, "Game not found", "Check the link and try again.", 404);

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
