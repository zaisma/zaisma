import { AUTO_HOLD_REASONS, PLAYER_REPORT_REASONS, REPORT_REASONS, audit, createReport, gameBySlug, reportLabel, reportPictureKey, setGameStatus, type Game, type PlayerReportReason, type ReportReason } from "@zaisma/core";
import type { Env } from "./env.ts";
import { sendAlert } from "./email.ts";
import { html, layout, metalButton, raw } from "./html.ts";

/**
 * Reporting a game or a player. On the game page it's a plate that slides in beside the game (up
 * from the bottom on phones), so the game keeps running and stays in view. Games hand a player
 * report over from the SDK's safety panel (a zaisma:report message), so every report looks the
 * same and carries the room and the player's temporary ID. Nothing about the person reporting is
 * kept. Without JavaScript, /g/<slug>/report is a plain form.
 */

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The reasons in the order players reach for them, each with a line saying what it covers. Copyright goes to the DMCA page. */
const GAME_WHYS: [ReportReason, string, string][] = [
  ["broken", "It's broken", "Won't load, crashes, or isn't really a game"],
  ["player", "A player", "Someone in a match is causing trouble"],
  ["sexual", "Sexual content", "Nudity or sexual material"],
  ["hate", "Hate or harassment", "Attacks or bullies people"],
  ["malware", "Scam or malware", "Asks for passwords or payment, or tries to install something"],
  ["child_safety", "Child safety", "Sexualizes children or puts a child in danger"],
  ["illegal", "Illegal content", "Something against the law"],
  ["other", "Something else", ""],
];
const PLAYER_WHYS: [PlayerReportReason, string, string][] = [
  ["harassment", PLAYER_REPORT_REASONS.harassment, "Picking on someone, following them or spamming"],
  ["hate", PLAYER_REPORT_REASONS.hate, "Attacks people for who they are, or threatens them"],
  ["sexual", PLAYER_REPORT_REASONS.sexual, "Sexual names, messages or actions"],
  ["cheating", PLAYER_REPORT_REASONS.cheating, "Hacks, exploits or unfair tricks"],
  ["other", PLAYER_REPORT_REASONS.other, ""],
];

const svg = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');
const ICON_NEXT = svg('<path d="M9 5l7 7-7 7"/>');
const ICON_SENT = svg('<path d="M4.5 12.5l5 5 10-11"/>');

const why = (reason: string, label: string, hint: string) =>
  html`<button type="button" class="why" data-reason="${reason}" data-label="${label}"><span><strong>${label}</strong>${hint ? html`<small>${hint}</small>` : ""}</span>${raw(ICON_NEXT)}</button>`;

/** The report plate for the game page, with its styles and script. */
export function reportSheet(game: Game, opts: { multiplayer: boolean; gameOrigin: string }): ReturnType<typeof html> {
  const config = { slug: game.slug, title: game.title, gameOrigin: opts.gameOrigin, hold: AUTO_HOLD_REASONS };
  return html`<style>
/* Report: a plate that slides in beside the game. The game keeps running and stays in view, and the
   shade only deepens toward the plate. */
dialog.sheet{position:fixed;inset:12px 12px 12px auto;margin:0;width:min(400px,calc(100vw - 24px));height:auto;max-width:none;max-height:none;flex-direction:column;overflow:hidden;
  --cut:36px;clip-path:polygon(0 0,calc(100% - 36px) 0,100% 36px,100% 100%,0 100%);animation:sheet-in 220ms cubic-bezier(.2,.8,.2,1)}
dialog.sheet[open]{display:flex}
dialog.sheet::backdrop{background:linear-gradient(90deg,rgba(4,5,7,0) 35%,rgba(4,5,7,.6));-webkit-backdrop-filter:none;backdrop-filter:none}
.sheet [hidden]{display:none!important}
.sheet-head{display:flex;align-items:flex-start;gap:12px;padding:22px 22px 16px;
  background:linear-gradient(#000,#000) bottom left/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) bottom 1px left/100% 1px no-repeat}
.sheet-head>div{flex:1;min-width:0}
.sheet-head h2{margin:0;font-size:24px;line-height:1.15;overflow-wrap:anywhere}
.sheet-sub{margin:6px 0 0;color:var(--muted);font-size:14px}
.sheet-head .x{flex:none;width:40px;height:40px;margin-right:24px;padding:0;justify-content:center}
.sheet-body{flex:1;min-height:0;overflow:auto;padding:16px 16px 20px}
.whys{display:grid;gap:8px}
/* Each reason is a plate you press; the chevron says it leads on. */
.why,.picked{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:58px;padding:10px 14px 10px 16px;border:0;text-align:left;color:var(--text);font:inherit;cursor:pointer;
  background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.1),inset -1px -1px 0 #000;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)}
.why span,.picked span{flex:1;min-width:0;display:grid;gap:2px}
.why strong,.picked strong{font-family:var(--display);font-size:16px;font-weight:600}
.why small{color:var(--muted);font-size:13px;line-height:1.35}
.why svg{width:16px;height:16px;flex:none;color:var(--muted)}
.why:hover,.picked:hover{background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,#3a3f48,#2a2e35)}
.why:hover svg{color:var(--text)}
.why:focus-visible,.picked:focus-visible{outline:none;box-shadow:inset 0 0 0 2px #e9ebee}
/* The chosen reason rides on a chrome rail, like the open tab. */
.picked{padding-left:20px}
.picked::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--chrome);box-shadow:0 0 12px rgba(225,230,240,.35)}
.picked .change{flex:none;font-family:var(--display);font-size:13px;font-weight:500;color:var(--muted)}
.picked:hover .change{color:var(--text)}
.sheet form{display:grid;gap:14px}
.sheet textarea{width:100%;min-height:120px;resize:vertical}
/* The picture of the game sits in a machined bezel, like the game page's; unticked, it greys out. */
.report-pic{margin:0;display:grid;gap:10px}
.report-pic .frame{display:block;padding:3px;background:linear-gradient(135deg,#60656f 0%,#1c1e22 36%,#121417 70%,#40444c 100%);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)}
.report-pic img{display:block;width:100%;max-height:190px;object-fit:contain;background:#000;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%);transition:opacity 140ms,filter 140ms}
.report-pic.off img{opacity:.3;filter:grayscale(1)}
.sheet .tick{display:flex;align-items:center;gap:10px;color:var(--text-2);font-size:14px;cursor:pointer}
.sheet .tick input{width:18px;height:18px;min-height:0;margin:0;padding:0;accent-color:#d7dbe0}
.sheet .note{margin:0;font-size:14px;color:var(--warn)}
.sheet-fine{margin:0;color:var(--muted);font-size:13px}
.sheet .error{margin:0}
.sheet-foot{margin:16px 2px 0;color:var(--muted);font-size:13px}
.sent{display:grid;gap:10px;justify-items:start;padding-top:6px}
.sent .mark{display:grid;place-items:center;width:52px;height:52px;color:var(--ok);background:var(--brush) 0 0/320px 320px,var(--face-hi);
  box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000,0 0 22px rgba(95,211,141,.16)}
.sent .mark svg{width:26px;height:26px}
.sent h3{margin:6px 0 0;font-size:22px}
.sent p{margin:0 0 8px;color:var(--text-2)}
@keyframes sheet-in{from{opacity:0;transform:translateX(28px)}}
@keyframes sheet-up{from{opacity:.4;transform:translateY(48px)}}
/* Phones: the same plate comes up from the bottom. */
@media (max-width:640px){
  dialog.sheet{inset:auto 0 0 0;width:100%;max-height:88dvh;animation-name:sheet-up}
  dialog.sheet::backdrop{background:linear-gradient(180deg,rgba(4,5,7,0) 25%,rgba(4,5,7,.65))}
  .sheet-head{padding:18px 18px 14px}
  .sheet-body{padding:14px 12px 20px}
}
/* Landscape phones keep the game's full height: the plate stays at the side. */
@media (orientation:landscape) and (max-height:500px){
  dialog.sheet{inset:8px 8px 8px auto;width:min(380px,62vw);max-height:none;animation-name:sheet-in}
  .sheet-head{padding:14px 18px 12px}
}
@media (prefers-reduced-motion:reduce){dialog.sheet{animation:none}}
</style>
<dialog id="report" class="sheet" aria-labelledby="report-title">
  <div class="sheet-head">
    <div><h2 id="report-title">Report ${game.title}</h2><p class="sheet-sub" id="report-sub">We don't record who you are.</p></div>
    <button class="ctl x" type="button" data-close title="Close" aria-label="Close">${raw(ICON_CLOSE)}</button>
  </div>
  <div class="sheet-body">
    <section data-step="why" aria-label="What's wrong">
      <div class="whys" data-for="game">${GAME_WHYS.filter(([r]) => r !== "player" || opts.multiplayer).map(([r, label, hint]) => why(r, label, hint))}</div>
      <div class="whys" data-for="player" hidden>${PLAYER_WHYS.map(([r, label, hint]) => why(r, label, hint))}</div>
      <p class="sheet-foot" data-for="game">Someone copied your work? <a href="/legal/dmca" target="_blank" rel="noopener">Send a copyright notice</a></p>
    </section>
    <form data-step="tell" hidden>
      <button type="button" class="picked" data-back><span><strong id="report-picked"></strong></span><span class="change">Change</span></button>
      <label>Anything else we should know? (optional)<textarea name="details" maxlength="2000" rows="4"></textarea></label>
      <figure class="report-pic" id="report-pic" hidden>
        <span class="frame"><img id="report-pic-img" alt="The game when you opened Report"></span>
        <label class="tick"><input type="checkbox" name="picture" checked>Include this picture of the game</label>
      </figure>
      <p class="note plate" id="report-hold" hidden>We hide the game straight away while we check.</p>
      <p class="sheet-fine" id="report-context"></p>
      <p class="error" id="report-error" role="alert" hidden></p>
      <div class="row">${metalButton("Send report", { id: "report-send", type: "submit" })}<button class="btn ghost" type="button" data-back>Back</button></div>
    </form>
    <section class="sent" data-step="sent" aria-live="polite" hidden>
      <span class="mark bevel-s">${raw(ICON_SENT)}</span>
      <h3>Thanks for the report</h3>
      <p id="report-sent-text"></p>
      <button class="btn" type="button" data-close>Back to the game</button>
    </section>
  </div>
</dialog>
<script>
(() => {
  const C = ${raw(JSON.stringify(config).replace(/</g, "\\u003c"))};
  const sheet = document.getElementById("report");
  const form = sheet.querySelector("form");
  const send = document.getElementById("report-send");
  const $ = (id) => document.getElementById(id);
  let about = null, reason = "", label = "";
  // A picture of the game, taken when the player opens the menu or Report; sent only if they keep it ticked.
  let picture = null, asked = 0;
  function takePicture() {
    const f = frame();
    picture = null;
    if (!f || !f.contentWindow) return;
    asked = Date.now();
    f.contentWindow.postMessage({ type: "zaisma:picture-request", id: String(asked) }, C.gameOrigin);
  }
  function showPicture() {
    const fig = $("report-pic");
    fig.hidden = !picture || (!about && C.hold.includes(reason));
    if (!fig.hidden) $("report-pic-img").src = picture;
    fig.classList.toggle("off", !form.picture.checked);
  }
  form.picture.addEventListener("change", showPicture);
  const menuButton = document.getElementById("menu");
  if (menuButton) menuButton.addEventListener("click", takePicture);
  const roomCode = () => { const c = (new URLSearchParams(location.search).get("room") || "").toUpperCase(); return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(c) ? c : ""; };
  const frame = () => document.getElementById("game");
  function step(name) {
    sheet.querySelectorAll("[data-step]").forEach((el) => (el.hidden = el.dataset.step !== name));
    const first = name === "why" ? sheet.querySelector("[data-step=why] .whys:not([hidden]) .why") : name === "tell" ? form.details : sheet.querySelector("[data-step=sent] .btn");
    if (first) first.focus();
  }
  // Open for the game, or for a player a game handed over: { id, name, code }.
  function open(player) {
    about = player || null;
    // From the menu, keep the picture taken when it opened; otherwise take one now.
    if (about || Date.now() - asked > 30000) takePicture();
    const menu = document.getElementById("menu-dialog");
    if (menu && menu.open) menu.close();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $("report-title").textContent = "Report " + (about ? about.name : C.title);
    $("report-sub").textContent = (about && about.code ? "In room " + about.code + ". " : "") + "We don't record who you are.";
    sheet.querySelectorAll("[data-for]").forEach((el) => (el.hidden = (el.dataset.for === "player") !== Boolean(about)));
    form.reset();
    $("report-error").hidden = true;
    if (!sheet.open) sheet.showModal();
    step("why");
  }
  function close() { if (sheet.open) sheet.close(); }
  sheet.addEventListener("close", () => { const f = frame(); if (f) f.focus(); });
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) return close();
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-close")) return close();
    if (b.hasAttribute("data-back")) return step("why");
    if (b.dataset.reason) {
      reason = b.dataset.reason;
      label = b.dataset.label;
      $("report-picked").textContent = label;
      form.details.placeholder = about ? "What did they do?" : reason === "player" ? "Who was it, and what did they do?" : reason === "broken" ? "What happened, and where in the game?" : "What did you see, and where in the game?";
      $("report-hold").hidden = Boolean(about) || !C.hold.includes(reason);
      const code = about ? about.code : roomCode();
      $("report-context").textContent = about ? "We'll include their temporary player ID and the room code." : "We'll include the version you're playing" + (code ? " and the room code." : ".");
      showPicture();
      step("tell");
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (send.getAttribute("aria-busy") === "true") return;
    send.setAttribute("aria-busy", "true");
    $("report-error").hidden = true;
    const body = { reason, details: form.details.value, room: about ? about.code : roomCode() };
    if (about) body.player = { id: about.id, name: about.name };
    if (picture && form.picture.checked && !$("report-pic").hidden) body.picture = picture;
    let res = null, data = {};
    try {
      res = await fetch("/g/" + C.slug + "/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      data = await res.json();
    } catch {}
    send.removeAttribute("aria-busy");
    if (!res || !res.ok) {
      $("report-error").textContent = data.error || "Couldn't send that. Check your connection and try again.";
      $("report-error").hidden = false;
      return;
    }
    $("report-sent-text").textContent = data.hidden ? "The game is hidden while we check it." : about && about.fromGame ? about.name + " is muted for you. We'll look at it soon." : "We'll look at it soon.";
    // The game mutes a player once they're reported.
    const f = frame();
    if (about && f && f.contentWindow) f.contentWindow.postMessage({ type: "zaisma:reported", player: about.id }, C.gameOrigin);
    step("sent");
  });
  // Report links open the plate; without JavaScript they lead to the form page.
  document.querySelectorAll("a[data-report]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); open(null); }));
  // A game's safety panel hands a player over.
  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== C.gameOrigin || !d) return;
    if (d.type === "zaisma:picture") {
      if (d.id === String(asked) && typeof d.picture === "string" && d.picture.startsWith("data:image/jpeg;base64,") && d.picture.length < 2000000) {
        picture = d.picture;
        if (sheet.open && !form.hidden) showPicture();
      }
      return;
    }
    if (d.type !== "zaisma:report") return;
    const p = d.player || {};
    if (typeof p.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id)) return;
    const code = typeof d.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(d.code) ? d.code : roomCode();
    open({ id: p.id, name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : "a player", code, fromGame: true });
    e.source.postMessage({ type: "zaisma:report-open" }, C.gameOrigin);
  });
})();
</script>`;
}

/** Private, draft and not-yet-published games can be reported too, but the form never shows their name. */
const isPublic = (game: Game) => game.status !== "pending" && game.visibility !== "draft" && game.visibility !== "private";

/** The form without JavaScript. */
export async function reportForm(env: Env, slug: string, error = "", status = 200): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const named = game && isPublic(game);
  const res = layout(env, {
    title: named ? `Report ${game.title}` : "Report a game",
    body: html`<h1>${named ? html`Report “${game.title}”` : "Report a game"}</h1>
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
  <div class="row"><button class="btn" type="submit">Send report</button><a class="btn ghost" href="/g/${slug}">Cancel</a></div>
</form>`,
  });
  return new Response(res.body, { status, headers: res.headers });
}

/**
 * A report, from the plate (JSON) or the plain form. Every game can be reported, whatever its
 * visibility; an address that isn't a game gets the same thanks, so this can't be used to find
 * private games. Reports about child safety or illegal content hide a live game straight away.
 */
export async function submitReport(env: Env, request: Request, slug: string, ctx: ExecutionContext): Promise<Response> {
  const fromSheet = (request.headers.get("content-type") ?? "").startsWith("application/json");
  const reply = (status: number, body: { ok?: true; hidden?: boolean; error?: string }) => {
    if (fromSheet) return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (body.error) return reportForm(env, slug, body.error, status);
    const res = layout(env, {
      title: "Thanks for the report",
      body: html`<h1>Thanks for the report</h1><p class="lead">${body.hidden ? "The game is hidden while we check it." : "We'll look at it soon."}</p><a class="btn ghost" href="/">Back to games</a>`,
    });
    return new Response(res.body, { status, headers: res.headers });
  };
  // Only our own pages send the plate's reports.
  if (fromSheet && request.headers.get("origin") !== new URL(request.url).origin) return reply(403, { error: "Not allowed from here." });

  // Rate limit by connection address. It's checked by Cloudflare and never stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.REPORT_LIMIT && !(await env.REPORT_LIMIT.limit({ key: ip })).success) return reply(429, { error: "Too many reports. Wait a minute and try again." });

  const input = fromSheet ? await readJson(request) : Object.fromEntries((await request.formData()).entries());
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max).replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim() : "");
  const details = text(input.details, 2000);
  const room = text(input.room, 6).toUpperCase();
  const p = input.player && typeof input.player === "object" ? (input.player as Record<string, unknown>) : null;
  const player = p && typeof p.id === "string" && PLAYER_ID.test(p.id) ? { id: p.id, name: text(p.name, 40), reason: text(input.reason, 20) } : null;
  // A report about a player says what they did; one about the game says what's wrong with it.
  const reason = (player ? "player" : text(input.reason, 20)) as ReportReason;
  if (player ? !(player.reason in PLAYER_REPORT_REASONS) : !(reason in REPORT_REASONS)) return reply(400, { error: "Choose what the problem is." });

  const game = await gameBySlug(env.DB, slug);
  if (!game) return reply(200, { ok: true, hidden: false });

  const report = { gameId: game.id, reason, details, versionId: game.current_version_id, roomCode: ROOM_CODE.test(room) ? room : "", ...(player ? { player } : {}) };
  const id = await createReport(env.DB, report);
  // Never a picture with a child-safety or illegal-content report: we don't want to receive or pass on images like that.
  const picture = AUTO_HOLD_REASONS.includes(reason) ? null : pictureBytes(input.picture);
  if (picture) {
    await env.GAMES.put(reportPictureKey(id), picture, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare("UPDATE reports SET picture = 1 WHERE id = ?").bind(id).run();
  }
  const hidden = !player && AUTO_HOLD_REASONS.includes(reason) && game.status === "live";
  if (hidden) {
    await setGameStatus(env.DB, game.id, "held");
    await audit(env.DB, game.id, "auto-hold", `Report: ${REPORT_REASONS[reason]}`);
  }
  const what = reportLabel({ reason, room_code: report.roomCode, player_name: player?.name ?? "", player_reason: player?.reason ?? "" });
  ctx.waitUntil(
    sendAlert(
      env,
      `${reason === "child_safety" ? "URGENT child-safety report" : "Report"} on ${game.slug}: ${what}${hidden ? " (game hidden)" : ""}`,
      `${what}\n\n${details || "(no details)"}\n\n${picture ? "With a picture of the game.\n\n" : ""}${reason === "child_safety" ? "Don't delete anything; review it and report to NCMEC if confirmed.\n\n" : ""}${hidden ? "The game is hidden until you review it.\n\n" : ""}Review: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
    ),
  );
  return reply(200, { ok: true, hidden });
}

/** A picture of the game from the plate: a JPEG data URL, at most 1.5 MB. Anything else is dropped. */
function pictureBytes(value: unknown): Uint8Array | null {
  const prefix = "data:image/jpeg;base64,";
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 2_100_000) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value.slice(prefix.length)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  return bytes.length <= 1_500_000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
