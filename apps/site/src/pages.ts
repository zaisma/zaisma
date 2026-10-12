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
.bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);flex:none}
.bar img{height:22px;display:block}
.bar h1{font-size:15px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.bar .btn{padding:6px 10px;font-size:13px}
.bar .servers{font-size:12px;color:var(--muted);white-space:nowrap}
@media (max-width:600px){.bar .servers{display:none}}
iframe{flex:1;border:0;width:100%;background:#000}
</style>
<div class="bar">
  <a href="/"><img src="/zaisma-mark-metal.svg" alt="Zaisma"></a>
  <h1>${game.title}</h1>
  ${ownServers.length ? html`<span class="servers" title="This game also connects to its own servers">Connects to ${ownServers.join(", ")}</span>` : ""}
  <button class="btn ghost" id="share" type="button">${multiplayer ? "Invite" : "Copy link"}</button>
  <button class="btn ghost" id="full" type="button">Full screen</button>
  <a class="btn ghost" href="/g/${game.slug}/report">Report</a>
</div>
<iframe id="game" src="${src}" title="${game.title}"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  allow="fullscreen; gamepad; autoplay" allowfullscreen referrerpolicy="no-referrer"></iframe>
<script>
const frame = document.getElementById("game");
const share = document.getElementById("share");
document.getElementById("full").onclick = () => frame.requestFullscreen?.();
share.onclick = async () => {
  const label = share.textContent;
  // Phones get the share sheet; computers copy the link.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: document.title, url: location.href }); } catch {}
    return;
  }
  try { await navigator.clipboard.writeText(location.href); share.textContent = "Copied"; setTimeout(() => (share.textContent = label), 1500); }
  catch { prompt("Copy this link", location.href); }
};
// The game says which room it's in, so the address bar and Invite point to that match.
const gameOrigin = new URL(frame.src).origin;
addEventListener("message", (e) => {
  if (e.origin !== gameOrigin || e.source !== frame.contentWindow) return;
  const d = e.data;
  if (d && d.type === "zaisma:room" && typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code)) {
    history.replaceState(null, "", location.pathname + "?room=" + d.code);
  }
});
</script>`,
  });
}

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
