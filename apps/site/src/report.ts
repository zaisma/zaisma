import { AUTO_HOLD_REASONS, PLAYER_REPORT_REASONS, REPORT_REASONS, ZAISMA_PLAYER_REPORT_REASONS, audit, hasBlockBetweenAccounts, createReport, gameBySlug, reportLabel, reportPictureKey, reviewReason, setReviewStatus, versionById, type Game, type PlayerReportReason, type ReportReason, type Version } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { sendAlert } from "./email.ts";
import { tellWebhooks, type WaitUntil } from "./webhooks.ts";
import { html, layout, pageData, scriptTags, type Raw } from "./html.ts";
import { secondaryButton, primaryButton, textLink } from "./components/actions.ts";
import { checkField, choiceCards, longField, type ChoiceCard } from "./components/choices.ts";
import { doneState } from "./components/data.ts";
import { row, stack } from "./components/layout.ts";
import { glassPane } from "./components/foundations.ts";
import { banner, sheet, type SheetStep } from "./components/panes.ts";
import { readingText } from "./components/reading.ts";
import { pageScript } from "./page-scripts.ts";
import type { Viewer } from "./viewer.ts";
import { recordRestoreEvent } from "./restore-events.ts";

/**
 * Reporting a game or a player. On the game page it's a sheet over the game, which keeps running. Games hand a player
 * report over from the SDK's safety panel (a zaisma:report message), so every report looks the
 * same and carries the room and the player's temporary ID. Nothing about the person reporting is
 * kept. Without JavaScript, /g/<slug>/report is a plain form.
 */

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The reasons in the order players reach for them, each with a line saying what it covers. Copyright and defamation go to their notice pages. */
const GAME_WHYS: [ReportReason, string, string][] = [
  ["broken", "It's broken", "Won't load, crashes, or isn't really a game"],
  ["player", "A player", "Someone in a match is causing trouble"],
  ["sexual", "Sexual content", "Nudity or sexual material"],
  ["real_people", "Private details or threats", "Shows where a real person lives or goes to school, or threatens them"],
  ["malware", "Scam or malware", "Asks for passwords or payment, or tries to install something"],
  ["child_safety", "Child safety", "Sexualizes children or puts a child in danger"],
  ["illegal", "Illegal content", "Something against the law"],
  ["other", "Something else", ""],
];
/** The first four go to Zaisma; the rest to the game's developer (ZAISMA_PLAYER_REPORT_REASONS). */
const PLAYER_WHYS: [PlayerReportReason, string, string][] = [
  ["real_life_threat", PLAYER_REPORT_REASONS.real_life_threat, "Says they'll find or hurt someone outside the game"],
  ["personal_details", PLAYER_REPORT_REASONS.personal_details, "Where someone lives or goes to school, their real name, phone or photos"],
  ["following_after_block", PLAYER_REPORT_REASONS.following_after_block, "Keeps turning up after I blocked them"],
  ["sexual", PLAYER_REPORT_REASONS.sexual, "Sexual names, messages or actions"],
  ["harassment", PLAYER_REPORT_REASONS.harassment, "Picking on someone or spamming"],
  ["cheating", PLAYER_REPORT_REASONS.cheating, "Hacks, exploits or unfair tricks"],
  ["other", PLAYER_REPORT_REASONS.other, ""],
];

const reasonChoices = (whys: [string, string, string][]): ChoiceCard[] => whys.map(([reason, label, hint]) => ({ choiceValue: reason, label, ...(hint ? { text: hint } : {}) }));

/**
 * Report, as the last step of the game page's Players sheet in a game that goes online (Players, then a player, then Report: one sheet),
 * or a sheet of its own in one that doesn't (reportSheet). One form: what's wrong (the game's reasons, or a player's when a game hands
 * one over), anything else to say, the picture of the game, then a done state in its place once it's sent. Report links
 * (a[data-report]) and a room's report button (data-report-room) open it at this step, with no Back; a player's ⋯ moves to it.
 * Its script comes with it once (reportScript).
 */
export function reportStep(game: Game, options: { isMultiplayer: boolean }): SheetStep {
  const gameWhys = GAME_WHYS.filter(([reason]) => reason !== "player" || options.isMultiplayer);
  const tell = stack({
    items: [
      { kind: "words", markup: html`<p id="report-sub">We don't record who you are.</p>` },
      { kind: "block", id: "report-reasons-game", markup: choiceCards({ id: "report-reason-game", name: "reason", label: "What's wrong", choices: reasonChoices(gameWhys), isCompact: true }) },
      { kind: "block", id: "report-reasons-player", isHidden: true, markup: choiceCards({ id: "report-reason-player", name: "reason", label: "What did they do?", choices: reasonChoices(PLAYER_WHYS), isCompact: true }) },
      { kind: "block", markup: longField({ id: "report-details", name: "details", label: "Anything else we should know? (optional)", rowCount: 3, maximumCharacterCount: 2000, placeholder: "What did you see, and where in the game?" }) },
      {
        kind: "block",
        id: "report-pic",
        isHidden: true,
        markup: stack({
          items: [
            { kind: "block", markup: readingText({ markup: html`<p><img id="report-pic-img" alt="The game when you opened Report"></p>` }) },
            { kind: "block", markup: checkField({ id: "report-picture", name: "picture", label: "Include this picture of the game", isChecked: true }) },
          ],
        }),
      },
      { kind: "block", id: "report-hold", isHidden: true, markup: banner({ text: "These go straight to a person.", icon: "person" }) },
      { kind: "words", markup: html`<p id="report-context"></p>` },
      { kind: "block", markup: html`<p class="field-error" id="report-error" role="alert" hidden></p>` },
      {
        kind: "words",
        id: "report-notices",
        markup: html`<p>Someone copied your work? ${textLink("Send a copyright notice", "/legal/dmca", { isNewTab: true })}<br>A game falsely says you committed a crime? ${textLink("Send a defamation notice", "/legal/defamation", { isNewTab: true })}</p>`,
      },
    ],
  });
  const body = stack({
    items: [
      { kind: "block", id: "report-tell", markup: tell },
      { kind: "block", id: "report-sent", isHidden: true, markup: html`<div role="status">${doneState({ title: "Thanks for the report", text: "We'll look at it soon." })}</div>` },
    ],
  });
  return {
    stepName: "report",
    title: `Report ${game.title}`,
    body,
    buttons: [secondaryButton("Back to the game", { id: "report-done", type: "submit", formMethod: "dialog", isHidden: true }), primaryButton("Send report", { id: "report-send", type: "submit" })],
  };
}

/** The report sheet of its own, for a game that doesn't go online, with its script. */
export function reportSheet(game: Game, options: { isMultiplayer: boolean; gameOrigin: string }): Raw {
  const step = reportStep(game, options);
  return html`${sheet({ id: "report", title: step.title, body: step.body, closeLabel: "Close", buttons: step.buttons })}
${reportScript(game, options)}`;
}

/** What the report's script needs from the page (the game's slug, title and origin, and which reasons go straight to a person), and the script. */
export function reportScript(game: Game, options: { gameOrigin: string }): Raw {
  const config = { slug: game.slug, title: game.title, gameOrigin: options.gameOrigin, hold: AUTO_HOLD_REASONS, zaisma: ZAISMA_PLAYER_REPORT_REASONS };
  return html`${pageData("report-data", config)}
${scriptTags(REPORT_SHEET_SCRIPT)}`;
}

// The report sheet's script. What it needs from the page (the game's slug, title and origin, and which reasons go straight to a
// person) comes in the report-data block.
const REPORT_SHEET_SCRIPT = pageScript("report-sheet", `(() => {
  // The Players sheet's report step, or the report sheet of its own.
  const step = document.querySelector('[data-sheet-step="report"]');
  const sheet = step ? step.closest("dialog") : document.getElementById("report");
  const title = (step || sheet).querySelector(".sheet-title");
  const C = JSON.parse(document.getElementById("report-data").textContent);
  const form = sheet.querySelector("form");
  const $ = (id) => document.getElementById(id);
  const send = $("report-send"), done = $("report-done");
  const ROOM_REASONS = ["child_safety", "sexual", "real_people", "illegal", "other"];
  // about: a player a game handed over; aboutRoom: a room from the Rooms list ({ code, name }).
  let about = null, aboutRoom = null, reason = "";
  // A picture of the game, taken when the player opens the menu or Report; sent only if they keep it ticked.
  let picture = null, asked = 0;
  const frame = () => document.getElementById("game");
  const reasons = () => $(about ? "report-reasons-player" : "report-reasons-game");
  function takePicture() {
    const f = frame();
    picture = null;
    if (!f || !f.contentWindow) return;
    asked = Date.now();
    f.contentWindow.postMessage({ type: "zaisma:picture-request", id: String(asked) }, C.gameOrigin);
  }
  function showPicture() {
    const pic = $("report-pic");
    // Never with child safety, illegal content or a sexual report about a player: we don't want to receive images like that.
    pic.hidden = !picture || (about ? reason === "sexual" : C.hold.includes(reason));
    if (!pic.hidden) $("report-pic-img").src = picture;
  }
  const menuButton = document.getElementById("menu");
  if (menuButton) menuButton.addEventListener("click", takePicture);
  const roomCode = () => { const c = (new URLSearchParams(location.search).get("room") || "").toUpperCase(); return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(c) ? c : ""; };
  function firstReason() { return reasons().querySelector(".choice-card:not([hidden]) input"); }
  // The form, or the done state in its place once it's sent.
  function showSent(isSent) {
    $("report-tell").hidden = isSent;
    $("report-sent").hidden = !isSent;
    send.hidden = isSent;
    done.hidden = !isSent;
  }
  // Open for the game, for a player a game handed over ({ id, name, code }), or for a room's name. From a player's ⋯ in the Players
  // sheet it's that sheet's next step, with Back; from anywhere else it opens at it.
  function open(player, room, isFromPlayers) {
    about = player || null;
    aboutRoom = room || null;
    reason = "";
    // From the menu, keep the picture taken when it opened; otherwise take one now. A room's name needs none.
    if (aboutRoom) picture = null;
    else if (about || Date.now() - asked > 30000) takePicture();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    title.textContent = aboutRoom ? "Report this room" : "Report " + (about ? about.name : C.title);
    $("report-sub").textContent = (aboutRoom ? "“" + aboutRoom.name + "”. " : about && about.code ? "In room " + about.code + ". " : "") + "We don't record who you are.";
    $("report-reasons-game").hidden = Boolean(about);
    $("report-reasons-player").hidden = !about;
    // A room's name is words: only the reasons words can break, and no copyright note.
    $("report-reasons-game").querySelectorAll(".choice-card").forEach((card) => (card.hidden = Boolean(aboutRoom) && !ROOM_REASONS.includes(card.querySelector("input").value)));
    $("report-notices").hidden = Boolean(about) || Boolean(aboutRoom);
    form.reset();
    form.details.placeholder = about ? "What did they do?" : "What did you see, and where in the game?";
    $("report-hold").hidden = true;
    const code = about ? about.code : roomCode();
    $("report-context").textContent = aboutRoom ? "We'll include the room's name and code." : about ? "We'll include their temporary player ID and the room code." : "We'll include the version you're playing" + (code ? " and the room code." : ".");
    $("report-error").hidden = true;
    showPicture();
    showSent(false);
    if (step) zaismaLayers.step(sheet, "report", { isBackShown: Boolean(isFromPlayers) && sheet.open });
    if (!sheet.open) sheet.showModal();
    const first = firstReason();
    if (first) first.focus();
  }
  if (!step) sheet.addEventListener("close", () => { const f = frame(); if (f) f.focus(); });
  form.addEventListener("change", (e) => {
    if (e.target.name !== "reason") return;
    reason = e.target.value;
    $("report-error").hidden = true;
    form.details.placeholder = about ? "What did they do?" : reason === "player" ? "Who was it, and what did they do?" : reason === "broken" ? "What happened, and where in the game?" : "What did you see, and where in the game?";
    $("report-hold").hidden = Boolean(about) || Boolean(aboutRoom) || !C.hold.includes(reason);
    showPicture();
  });
  // Enter in a field sends the report: the sheet's first submit button is its Close, which the browser would press.
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement) || send.hidden || (step && !step.contains(e.target))) return;
    e.preventDefault();
    form.requestSubmit(send);
  });
  form.addEventListener("submit", async (e) => {
    // Close and Back to the game close the sheet (formmethod="dialog").
    if (e.submitter && e.submitter.getAttribute("formmethod") === "dialog") return;
    e.preventDefault();
    if (send.getAttribute("aria-busy") === "true") return;
    $("report-error").hidden = true;
    if (!reason) {
      $("report-error").textContent = "Choose what the problem is.";
      $("report-error").hidden = false;
      const first = firstReason();
      if (first) first.focus();
      return;
    }
    send.setAttribute("aria-busy", "true");
    const body = { reason, details: form.details.value, room: aboutRoom ? aboutRoom.code : about ? about.code : roomCode() };
    if (aboutRoom) body.about = "room";
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
    // A player report Zaisma looks at itself, or one passed to the game's developer.
    const passed = about && !C.zaisma.includes(reason);
    showSent(true);
    $("report-sent").querySelector(".state-text").textContent = data.is_game_hidden ? "The game is hidden while we check it." : data.is_update_paused ? "The latest update is paused while we check it." : about ? (about.fromGame ? about.name + " is muted for you. " : "") + (passed ? "Block them to keep them away in every game. We've passed this to the game's developer." : "A person at Zaisma will look at it soon.") : "We'll look at it soon.";
    done.focus();
    // The game mutes a player once they're reported.
    const f = frame();
    if (about && f && f.contentWindow) f.contentWindow.postMessage({ type: "zaisma:reported", player: about.id }, C.gameOrigin);
  });
  // Report links open the sheet: any marked data-report, and any to this game's report page (the menu's Report choice); without
  // JavaScript they lead to the form page. A room in the Rooms list is reported for its name or labels. Both listen on the page,
  // since the menu and the list can change.
  const reportLinks = 'a[data-report], a[href="/g/' + C.slug + '/report"]';
  document.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest(reportLinks);
    if (link) { e.preventDefault(); return open(null); }
    const b = e.target.closest && e.target.closest("[data-report-room]");
    if (!b || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(b.dataset.reportRoom)) return;
    open(null, { code: b.dataset.reportRoom, name: (b.dataset.roomName || "").slice(0, 80) });
  });
  // A game's safety panel hands a player over.
  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== C.gameOrigin || !d) return;
    if (d.type === "zaisma:picture") {
      if (d.id === String(asked) && typeof d.picture === "string" && d.picture.startsWith("data:image/jpeg;base64,") && d.picture.length < 2000000) {
        picture = d.picture;
        if (sheet.open && !$("report-tell").hidden) showPicture();
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
  // The Players sheet hands a player over the same way, from Zaisma's own page.
  window.addEventListener("zaisma:open-report", (e) => {
    const p = e.detail || {};
    if (typeof p.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id)) return;
    const code = typeof p.code === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(p.code) ? p.code : roomCode();
    open({ id: p.id, name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : "a player", code, fromGame: true }, null, true);
  });
})();`);

/** Private, draft and not-yet-published games can be reported too, but the form never shows their name. */
const isPublic = (game: Game) => game.review_status !== "pending" && game.visibility !== "draft" && game.visibility !== "private";

/**
 * The form without JavaScript: the sheet's reasons and field on a pane of their own, sent as a plain form post. Every game reason is
 * offered, since a private game's form mustn't say whether it has players to report.
 * viewer: who is looking, for the header only (the report never records who sent it).
 */
export async function reportForm(env: Env, slug: string, error = "", httpStatus = 200, viewer?: Viewer): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const named = game && isPublic(game);
  const fields = stack({
    items: [
      ...(error ? [{ kind: "words" as const, markup: html`<p class="field-error" role="alert">${error}</p>` }] : []),
      { kind: "block", markup: choiceCards({ id: "report-reason", name: "reason", label: "What's the problem?", choices: reasonChoices(GAME_WHYS), isCompact: true }) },
      { kind: "block", markup: longField({ id: "report-details", name: "details", label: "Details (optional)", rowCount: 3, maximumCharacterCount: 2000, placeholder: "What did you see, and where in the game?" }) },
      {
        kind: "words",
        markup: html`<p>Copyright claims need a formal notice: see the ${textLink("DMCA page", "/legal/dmca")}. So does a game that falsely says you committed a crime: see ${textLink("Defamation notices", "/legal/defamation")}.</p>`,
      },
      { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Send report", { type: "submit" }) }, { kind: "control", markup: secondaryButton("Cancel", { href: `/g/${slug}` }) }] }) },
    ],
  });
  const response = layout(env, {
    viewer,
    checkedPage: "Report a game",
    pageShape: "reading",
    title: named ? `Report ${game.title}` : "Report a game",
    body: glassPane({
      paneWidth: "fit",
      label: named ? `Report ${game.title}` : "Report a game",
      body: stack({
        items: [
          { kind: "words", markup: html`<h1>${named ? html`Report “${game.title}”` : "Report a game"}</h1>` },
          { kind: "words", markup: html`<p>Tell us what's wrong. We don't record who you are.</p>` },
          { kind: "block", markup: html`<form method="post">${fields}</form>` },
        ],
      }),
    }),
  });
  const page = new Response(response.body, { status: httpStatus, headers: response.headers });
  for (const cookie of viewer?.cookies ?? []) page.headers.append("Set-Cookie", cookie);
  return page;
}

/**
 * A report, from the sheet (JSON) or the plain form. Every game can be reported, whatever its
 * visibility; an address that isn't a game gets the same thanks, so this can't be used to find
 * private games. Reports about child safety or illegal content hide a live game straight away.
 */
export async function submitReport(env: Env, request: Request, slug: string, ctx: ExecutionContext): Promise<Response> {
  const fromSheet = (request.headers.get("content-type") ?? "").startsWith("application/json");
  // A fresh session cookie, when looking up the reporter's blocks refreshed it.
  let cookies: string[] = [];
  const reply = (httpStatus: number, body: { has_reported?: true; is_game_hidden?: boolean; is_update_paused?: boolean; error?: string }) => {
    if (fromSheet) {
      const headers = new Headers({ "Cache-Control": "no-store" });
      for (const cookie of cookies) headers.append("Set-Cookie", cookie);
      return Response.json(body, { status: httpStatus, headers });
    }
    if (body.error) return reportForm(env, slug, body.error, httpStatus);
    const response = layout(env, {
      title: "Thanks for the report",
      checkedPage: "A message",
      pageShape: "reading",
      body: glassPane({
        paneWidth: "fit",
        body: stack({
          items: [
            { kind: "words", markup: html`<h1>Thanks for the report</h1>` },
            { kind: "words", markup: html`<p>${body.is_game_hidden ? "The game is hidden while we check it." : body.is_update_paused ? "The latest update is paused while we check it." : "We'll look at it soon."}</p>` },
            { kind: "control", markup: secondaryButton("Back to games", { href: "/", isFullWidth: true }) },
          ],
        }),
      }),
    });
    return new Response(response.body, { status: httpStatus, headers: response.headers });
  };
  // Only our own pages send the sheet's reports.
  if (fromSheet && request.headers.get("origin") !== new URL(request.url).origin) return reply(403, { error: "Not allowed from here." });

  // Rate limit by connection address. It's checked by Cloudflare and never stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.REPORT_LIMIT && !(await env.REPORT_LIMIT.limit({ key: ip })).success) return reply(429, { error: "Too many reports. Wait a minute and try again." });

  const input = fromSheet ? await readJson(request) : Object.fromEntries((await request.formData()).entries());
  const text = (given: unknown, maximumCharacterCount: number) => (typeof given === "string" ? given.slice(0, maximumCharacterCount).replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim() : "");
  const playerText = text(input.details, 2000);
  const room = text(input.room, 6).toUpperCase();
  const playerInput = input.player && typeof input.player === "object" ? (input.player as Record<string, unknown>) : null;
  const player = playerInput && typeof playerInput.id === "string" && PLAYER_ID.test(playerInput.id) ? { id: playerInput.id, name: text(playerInput.name, 40), reason: text(input.reason, 40) } : null;
  // A report about a player says what they did; one about the game says what's wrong with it.
  const reason = (player ? "player" : text(input.reason, 40)) as ReportReason;
  if (player ? !(player.reason in PLAYER_REPORT_REASONS) : !(reason in REPORT_REASONS)) return reply(400, { error: "Choose what the problem is." });

  const game = await gameBySlug(env.DB, slug);
  if (!game) return reply(200, { has_reported: true, is_game_hidden: false, is_update_paused: false });

  const roomCode = ROOM_CODE.test(room) ? room : "";
  // The room's name and labels as they are now, from the room itself: a room can rename itself later.
  const named = roomCode ? await env.DB.prepare("SELECT name, labels FROM live_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, roomCode).first<{ name: string | null; labels: string }>() : null;
  const roomName = named ? describeRoom(named.name, named.labels) : null;
  // The one thing kept about the reporter, as a yes or no: whether they and the reported account have a block
  // between them, which is what a report about following after a block turns on. Never who they are.
  let hasBlockBetween = false;
  if (player && fromSheet) {
    const session = await currentSession(request, env);
    cookies = session?.cookies ?? [];
    const reported = session ? await env.DB.prepare("SELECT id FROM accounts WHERE player_id = ?").bind(player.id).first<{ id: string }>() : null;
    hasBlockBetween = Boolean(session && reported && reported.id !== session.userId && (await hasBlockBetweenAccounts(env.DB, session.userId, reported.id)));
  }
  const report = { gameId: game.id, reason, playerText, versionId: game.live_version_id, roomCode, roomName, hasBlockBetween, ...(player ? { player } : {}) };
  // A report about what a room is called is about players' words, not the game: it never pauses the game.
  const aboutRoom = input.about === "room" && Boolean(roomCode);
  const id = await createReport(env.DB, report);
  // Never a picture with a child-safety or illegal-content report, or a sexual one about a player (it may be
  // about a teen): we don't want to receive or pass on images like that.
  const picture = AUTO_HOLD_REASONS.includes(reason) || player?.reason === "sexual" ? null : pictureBytes(input.picture);
  if (picture) {
    await env.GAMES.put(reportPictureKey(id), picture, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare("UPDATE reports SET has_picture = 1 WHERE id = ?").bind(id).run();
  }
  const paused = !player && !aboutRoom && AUTO_HOLD_REASONS.includes(reason) ? await pauseForReport(env, game, REPORT_REASONS[reason], (promise) => ctx.waitUntil(promise)) : null;
  const hidden = paused === "game";
  // Child-safety and illegal-content reports go to a person straight away. Report triage (triage.ts)
  // sorts the rest within minutes and alerts the serious ones.
  if (!player && AUTO_HOLD_REASONS.includes(reason)) {
    const what = reportLabel({ reason, room_code: report.roomCode, room_name: roomName, player_name: "", player_reason: "" });
    ctx.waitUntil(
      sendAlert(
        env,
        `${reason === "child_safety" ? "URGENT child-safety report" : "URGENT report"} on ${game.slug}: ${what}${hidden ? " (game hidden)" : paused ? " (update paused)" : ""}`,
        `${what}\n\n${playerText || "(no details)"}\n\n${reason === "child_safety" ? "Don't delete anything; review it and report to NCMEC if confirmed.\n\n" : ""}${hidden ? "The game is hidden until you review it.\n\n" : paused ? "Players are back on the version before the latest update until you review it.\n\n" : ""}Review: ${env.SITE_ORIGIN}/admin/reports`,
      ),
    );
  }
  return reply(200, { has_reported: true, is_game_hidden: hidden, is_update_paused: paused === "update" });
}

/** A picture of the game from the sheet: a JPEG data URL, at most 1.5 MB. Anything else is dropped. */
function pictureBytes(dataUrl: unknown): Uint8Array | null {
  const prefix = "data:image/jpeg;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix) || dataUrl.length > 2_100_000) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  return bytes.length <= 1_500_000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

const RECENT_MS = 7 * 86400_000;

/**
 * A child-safety or illegal-content report, before a person has looked (docs/DECISIONS.md). No single
 * report can take an established game offline, and a griefer gets at most one pause per version:
 * - a version a person already cleared, or one a report already went back to: nothing automatic;
 * - an update that went live in the last 7 days: players go back to the version before it, which is
 *   then never undone again automatically, and the update is held for a person;
 * - a brand-new game (its only version went live in the last 7 days): hidden until a person looks;
 * - anything else stays up. The alert goes out either way, marked URGENT.
 */
export async function pauseForReport(env: Env, game: Game, label: string, waitUntil?: WaitUntil): Promise<"game" | "update" | null> {
  if (game.review_status !== "live" || !game.live_version_id) return null;
  const live = await versionById(env.DB, game.live_version_id);
  const nowMs = Date.now();
  if (!live || live.cleared_at_ms || !live.published_at_ms || live.published_at_ms < nowMs - RECENT_MS) return null;
  const before = await env.DB
    .prepare("SELECT * FROM versions WHERE game_id = ? AND id != ? AND scan_status = 'approved' AND published_at_ms IS NOT NULL AND published_at_ms < ? ORDER BY published_at_ms DESC LIMIT 1")
    .bind(game.id, live.id, live.published_at_ms)
    .first<Version>();
  if (before) {
    // Approving the held update (in admin) puts it straight back.
    await env.DB.batch([
      env.DB.prepare("UPDATE games SET live_version_id = ?, updated_at_ms = ? WHERE id = ?").bind(before.id, nowMs, game.id),
      env.DB.prepare("UPDATE versions SET scan_status = 'held', publish_when_approved_enabled = 1, report_held_at_ms = ? WHERE id = ?").bind(nowMs, live.id),
      env.DB.prepare("UPDATE versions SET cleared_at_ms = ? WHERE id = ?").bind(nowMs, before.id),
    ]);
    await audit(env.DB, game.id, "report-paused-update", `Report: ${label}. ${live.id} held; players are back on ${before.id}`, "system", reviewReason("report_paused_update"));
    await tellWebhooks(env, "scan_status_changed", game.id, { versionId: live.id }, waitUntil);
    await tellWebhooks(env, "live_version_changed", game.id, { versionId: before.id }, waitUntil);
    return "update";
  }
  await setReviewStatus(env.DB, game.id, "held", reviewReason("report_paused_game"));
  await recordRestoreEvent(env, { event_kind: "game_held", at_ms: nowMs, game_id: game.id, review_reason: reviewReason("report_paused_game") });
  await env.DB.prepare("UPDATE versions SET report_held_at_ms = ? WHERE id = ?").bind(nowMs, live.id).run();
  await audit(env.DB, game.id, "auto-hold", `Report: ${label}`, "system", reviewReason("report_paused_game"));
  await tellWebhooks(env, "review_status_changed", game.id, {}, waitUntil);
  return "game";
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A room's name and labels in a line, like "Ana's castle (Mode: Classic, Map: Docks)". */
export function describeRoom(name: string | null, labelsJson: string): string | null {
  let labels: [string, unknown][] = [];
  try {
    labels = Object.entries(JSON.parse(labelsJson) as Record<string, unknown>);
  } catch {}
  const tags = labels.map(([labelName, labelValue]) => `${labelName}: ${String(labelValue)}`).join(", ");
  return [name, tags && `(${tags})`].filter(Boolean).join(" ") || null;
}
