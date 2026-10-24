import { accountById, areFriends, blockPlayer, hasBlocked, unblockPlayer, type BlockedPlayer } from "@zaisma/core";
import { authConfigured, currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { cutButton, runButton, textLink } from "./components/actions.ts";
import { listRows, pictureFrame } from "./components/data.ts";
import { stack } from "./components/layout.ts";
import { banner, sheet } from "./components/panes.ts";
import { accountPicture, html, pageData, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * Blocks on zaisma.com (docs/DECISIONS.md, "How blocks work"): the plate beside the game that asks
 * before a block between two accounts, the calls behind it, and the Blocked list on the friends page,
 * each with Unblock. A block is only ever made by the player themselves on a Zaisma page: a game asks
 * (room.block), and Zaisma shows the account's real name before anything happens, so a game can't block
 * or unfriend anyone on a player's behalf. Blocks that don't involve two accounts (a guest's, or of a
 * guest) never reach the server: the game page keeps them for the tab's session, across games.
 */
export async function handleBlocks(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/friends\/blocks\/(player_[a-z0-9]{1,40})(\/remove)?$/);
  if (!match) return null;
  const [, playerId, remove] = match as unknown as [string, string, string | undefined];
  if (!authConfigured(env)) return answer({ error: { code: "accounts_off", message: "Accounts aren't on yet." } }, 404);
  const post = request.method === "POST";
  // Changes only come from our own pages.
  if (post && request.headers.get("origin") !== new URL(request.url).origin) return answer({ error: { code: "bad_origin", message: "Not allowed from here." } }, 403);
  const isForm = (request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);

  if (remove) {
    if (!post) return redirect("/friends#blocked");
    if (!account) return done(redirect(`/signin?next=${encodeURIComponent("/friends")}`));
    await unblockPlayer(env.DB, account.id, playerId);
    return done(redirect("/friends?unblocked#blocked"));
  }
  if (!account) return done(isForm ? redirect(`/signin?next=${encodeURIComponent("/friends")}`) : answer({ error: { code: "not_signed_in", message: "Sign in to block players." } }, 401));

  if (post) {
    const outcome = await blockPlayer(env.DB, account.id, playerId);
    if ("error" in outcome) {
      const message = outcome.error === "own_player" ? "That's you." : "No account has that player ID.";
      return done(isForm ? redirect("/friends#blocked") : answer({ error: { code: outcome.error, message } }, outcome.error === "own_player" ? 400 : 404));
    }
    return done(isForm ? redirect("/friends?blocked#blocked") : answer({ player: { player_id: outcome.blocked.player_id, name: outcome.blocked.name }, is_blocked: true }));
  }

  // Who the plate asks about: the account's real name, whatever the game called them, and whether they're friends.
  const other = await env.DB.prepare("SELECT id, player_id, username FROM accounts WHERE player_id = ?").bind(playerId).first<{ id: string; player_id: string; username: string }>();
  if (!other || other.id === account.id) return done(answer({ error: { code: "player_not_found", message: "No other account has that player ID." } }, 404));
  return done(answer({ player: { player_id: other.player_id, name: other.username }, is_friend: await areFriends(env.DB, account.id, other.id), is_blocked: await hasBlocked(env.DB, account.id, other.id) }));
}

/** The friends page's Blocked list, newest first, each with Unblock. Nothing when there are none. */
export function blockedSection(blocks: BlockedPlayer[], query: URLSearchParams): Raw {
  const status = query.has("unblocked") ? "Unblocked. You're not friends again unless one of you sends an invite." : query.has("blocked") ? "Blocked." : "";
  if (!blocks.length) return status ? html`<p class="note" role="status" id="blocked">${status}</p>` : html``;
  return html`<h2 class="rule-h" id="blocked">Blocked (${blocks.length})</h2>
${status ? html`<p class="note" role="status">${status}</p>` : ""}
<p class="hint">Nothing either of you sends in a game reaches the other, and neither of you shows up in the other's friends. They aren't told.</p>
<ul class="keys friends">${blocks.map(
    (blocked) => html`<li><span class="friend">${accountPicture(blocked.name, "sm")}<span>${blocked.name} <span class="why muted small">blocked ${day(blocked.created_at_ms)}</span></span></span>
<form method="post" action="/friends/blocks/${blocked.player_id}/remove" data-confirm="Unblock ${blocked.name}? You can see each other in games again. They aren't told."><button class="btn ghost" type="submit">Unblock</button></form></li>`,
  )}</ul>`;
}

const day = (atMs: number) => new Date(atMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The game page's side of room.block: a sheet over the game that asks before a block between two accounts, with the name Zaisma knows
 * them by. Session blocks (zaisma:block for a guest, or by one) are kept in this tab without asking, and the game can ask which players in
 * its room this session blocked (zaisma:blocks-among), never for the whole list.
 */
export function blockSheet(options: { gameOrigin: string }): Raw {
  const body = stack({
    items: [
      // Who's blocked: the picture and name the script fills in, as the page draws an account's.
      { kind: "block", markup: listRows({ rows: [{ lead: pictureFrame("?", "md"), title: "?" }], id: "block-who" }) },
      { kind: "words", markup: html`<p>Nothing either of you sends in a game reaches the other: messages, emotes or voice. Neither of you shows up in the other's friends or profile.</p>` },
      { kind: "words", markup: html`<p id="block-friend" hidden>You're friends, so this ends that too.</p>` },
      { kind: "words", markup: html`<p><span id="block-told"></span> Unblock any time on your ${textLink("friends page", "/friends#blocked", { isNewTab: true })}.</p>` },
      { kind: "block", markup: html`<div id="block-error" role="alert" hidden>${banner({ text: "Couldn't block them. Check your connection and try again.", icon: "warning", tone: "warning" })}</div>` },
    ],
  });
  return html`${sheet({
    id: "block",
    title: "Block this player?",
    body,
    closeLabel: "Close",
    placement: "foot",
    buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog" }), runButton("Block", { type: "button", id: "block-yes" })],
  })}
${pageData("block-data", { gameOrigin: options.gameOrigin })}
${scriptTags(BLOCK_SHEET_SCRIPT)}`;
}

// The block sheet's script: a game asks (Zaisma.players.block) and the sheet asks the player, or blocks for this session. Cancel, Esc
// and a press beside the sheet close it (SHEET_SCRIPT), which is a no.
const BLOCK_SHEET_SCRIPT = pageScript("block-sheet", `(() => {
  const sheet = document.getElementById("block");
  const GAME_ORIGIN = JSON.parse(document.getElementById("block-data").textContent).gameOrigin;
  const PLAYER_ID = /^player_[a-z0-9]{1,40}$/;
  const yes = document.getElementById("block-yes");
  const $ = (id) => document.getElementById(id);
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  // Session blocks: kept for this tab, in every game it plays, and gone when it closes.
  const KEY = "zaisma:blocked";
  const sessionBlocks = () => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || "[]")); } catch { return new Set(); } };
  const keep = (blocked) => { try { sessionStorage.setItem(KEY, JSON.stringify([...blocked].slice(-500))); } catch {} };
  // The block the plate is asking about: { id }.
  let asking = null;
  function finish(status) {
    if (!asking) return;
    tell({ type: "zaisma:block", status, playerId: asking.id, isLasting: status === "blocked" });
    asking = null;
    if (sheet.open) sheet.close();
  }
  function open(about) {
    asking = { id: about.player.player_id };
    const name = about.player.name;
    $("block-title").textContent = "Block " + name + "?";
    showWho(name);
    $("block-friend").hidden = !about.is_friend;
    $("block-told").textContent = name + " isn't told.";
    $("block-error").hidden = true;
    yes.removeAttribute("aria-busy");
    yes.disabled = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    sheet.showModal();
    yes.focus();
  }
  // Who's blocked, as the page draws an account (accountPicture): initials in its own color, from the name.
  function showWho(name) {
    const who = $("block-who");
    let hue = 7;
    for (const character of name) hue = (hue * 31 + character.codePointAt(0)) % 360;
    const words = name.trim().split(/\\s+/).filter(Boolean);
    const letters = words.length > 1 ? [Array.from(words[0])[0], Array.from(words[1])[0]] : Array.from(words[0] || "?").slice(0, 2);
    const picture = who.querySelector(".av");
    picture.style.setProperty("--h", String(hue));
    picture.textContent = letters.join("").toUpperCase();
    who.querySelector(".list-row-title").textContent = name;
  }
  yes.addEventListener("click", async () => {
    if (!asking || yes.getAttribute("aria-busy") === "true") return;
    yes.setAttribute("aria-busy", "true");
    $("block-error").hidden = true;
    const res = await fetch("/friends/blocks/" + asking.id, { method: "POST" }).catch(() => null);
    yes.removeAttribute("aria-busy");
    if (!res || !res.ok) {
      $("block-error").hidden = false;
      return;
    }
    finish("blocked");
  });
  sheet.addEventListener("close", () => { finish("cancelled"); const f = frame(); if (f) f.focus(); });
  addEventListener("message", async (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== GAME_ORIGIN || !d) return;
    // Which of these players this session blocked: only ever the ones the game names, never the list.
    if (d.type === "zaisma:blocks-among" && Array.isArray(d.playerIds)) {
      const blocked = sessionBlocks();
      const playerIds = d.playerIds.slice(0, 64).filter((playerId) => typeof playerId === "string" && blocked.has(playerId));
      if (playerIds.length) tell({ type: "zaisma:blocks-among", playerIds });
      return;
    }
    if (d.type === "zaisma:unblock" && typeof d.playerId === "string") {
      const blocked = sessionBlocks();
      blocked.delete(d.playerId);
      keep(blocked);
      return;
    }
    if (d.type !== "zaisma:block" || !d.player || typeof d.player.id !== "string" || !PLAYER_ID.test(d.player.id)) return;
    const playerId = d.player.id;
    // One question at a time: another block while the sheet is up is a no.
    if (asking) return tell({ type: "zaisma:block", status: "cancelled", playerId });
    tell({ type: "zaisma:block", status: "asking", playerId });
    // Between two accounts the block lasts, so Zaisma asks first, with the name it knows them by.
    if (isSignedIn() && d.playerKind === "account" && d.player.kind === "account") {
      asking = { id: playerId };
      const about = await fetch("/friends/blocks/" + playerId).then((res) => (res.ok ? res.json() : null)).catch(() => null);
      asking = null;
      if (about && about.is_blocked) return tell({ type: "zaisma:block", status: "blocked", playerId, isLasting: true });
      if (about && about.player) return open(about);
    }
    // Anyone else: blocked for this session, at once.
    const blocked = sessionBlocks();
    blocked.add(playerId);
    keep(blocked);
    tell({ type: "zaisma:block", status: "blocked", playerId, isLasting: false });
  });
})();`);


function answer(body: unknown, httpStatus = 200): Response {
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
