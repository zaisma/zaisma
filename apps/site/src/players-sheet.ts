import { friendsInGameOf, gameBySlug } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { joinButton } from "./friends-now.ts";
import { accountPicture, html, raw, scriptTags, securityHeaders, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { profilePath } from "./profiles.ts";

/**
 * The Players plate in the game page's bar (docs/DECISIONS.md, "Players in the game bar"): who's in the
 * room, with Mute on each row and Profile, Block and Report behind ⋯, and the player's friends playing
 * the game with Join, so every game Zaisma can see the room of has mute, block and report on zaisma.com.
 * The game's SDK says who's in the room (zaisma:players); names and Friend marks for accounts come from
 * Zaisma, never from the game, and Block and Report go through their own plates.
 *
 *   GET /friends/among?player_ids=a,b   which of these players are accounts, by the name Zaisma knows
 *                                       them by, and whether each is a friend of the signed-in player
 *   GET /g/:slug/players/friends?room=  the friends playing that game, outside that room, with Join
 */
export async function handlePlayersSheet(request: Request, env: Env, path: string): Promise<Response | null> {
  const friendsMatch = path.match(/^\/g\/([a-z0-9-]+)\/players\/friends$/);
  if (path !== "/friends/among" && !friendsMatch) return null;
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const session = await currentSession(request, env);
  const done = (response: Response) => {
    for (const cookie of session?.cookies ?? []) response.headers.append("Set-Cookie", cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  if (path === "/friends/among") {
    const given = (new URL(request.url).searchParams.get("player_ids") ?? "").split(",").filter(Boolean);
    if (given.length > MAXIMUM_PLAYER_COUNT || given.some((playerId) => !PLAYER_ID.test(playerId))) {
      return done(Response.json({ error: { code: "bad_player_ids", message: `player_ids takes up to ${MAXIMUM_PLAYER_COUNT} player IDs, separated by commas.` } }, { status: 400 }));
    }
    if (!given.length) return done(Response.json({ players: [] }));
    const marks = "?, ".repeat(given.length).slice(0, -2);
    const { results } = await env.DB.prepare(
      `SELECT accounts.player_id, accounts.username, friendships.account_id IS NOT NULL AS is_friend FROM accounts
       LEFT JOIN friendships ON friendships.friend_account_id = accounts.id AND friendships.account_id = ?
       WHERE accounts.player_id IN (${marks}) AND accounts.id != ?`,
    )
      .bind(session?.userId ?? "", ...given, session?.userId ?? "")
      .all<{ player_id: string; username: string; is_friend: number }>();
    return done(Response.json({ players: results.map((row) => ({ player_id: row.player_id, name: row.username, is_friend: row.is_friend === 1 })) }));
  }

  if (!session) return done(Response.json({ error: { code: "not_signed_in", message: "Sign in to see your friends." } }, { status: 401 }));
  const game = await gameBySlug(env.DB, friendsMatch![1]!);
  if (!game) return done(new Response(null, { status: 404 }));
  const room = (new URL(request.url).searchParams.get("room") ?? "").toUpperCase();
  const friends = (await friendsInGameOf(env.DB, session.userId, game.id)).filter((friend) => !ROOM_CODE.test(room) || friend.room_code !== room);
  return done(new Response(friendRows(game.slug, friends).html, { headers: securityHeaders(env) }));
}

/** A room holds at most 50 players, so the plate never asks about more. */
const MAXIMUM_PLAYER_COUNT = 50;
const PLAYER_ID = /^player_[a-z0-9]{1,40}$/;
/** Only compared with friends' rooms, never shown, so any six letters or digits will do. */
const ROOM_CODE = /^[A-Z0-9]{6}$/;

/** Friends playing the game, each with Join, grayed with why when it won't work; none for a friend in no room Zaisma knows. */
function friendRows(slug: string, friends: Awaited<ReturnType<typeof friendsInGameOf>>): Raw {
  if (!friends.length) return html`<p class="pl-note">None of your friends are playing this right now.</p>`;
  return html`<ul class="pl-list">${friends.map(
    (friend) => html`<li class="pl-row"><a class="face" href="${profilePath(friend.username)}" target="_blank" rel="noopener" aria-label="${friend.username}">${accountPicture(friend.username, "sm")}</a><a class="pl-name" href="${profilePath(friend.username)}" target="_blank" rel="noopener">${friend.username}</a>${
      friend.join_refusal === "no_room" || (!friend.room_code && !friend.join_refusal)
        ? ""
        : joinButton(slug, { room_code: friend.room_code ?? "", server_url: friend.server_url, refusal: friend.join_refusal, refusing_friend_names: [friend.username] })
    }</li>`,
  )}</ul>`;
}

/** The plate itself, beside the game like Report's (and using its styles), for games that go online. */
export function playersSheet(options: { gameOrigin: string; slug: string; title: string; hasZaismaRooms: boolean; canSignIn: boolean; signInPath: string }): Raw {
  return html`<dialog id="players" class="sheet" aria-labelledby="players-title" data-game-origin="${options.gameOrigin}" data-slug="${options.slug}" data-has-zaisma-rooms="${String(options.hasZaismaRooms)}" data-can-sign-in="${String(options.canSignIn)}">
  <div class="sheet-head">
    <div><h2 id="players-title">Players</h2></div>
    <button class="ctl x" type="button" data-close title="Close" aria-label="Close">${raw(ICON_CLOSE)}</button>
  </div>
  <div class="sheet-body">
    <section class="pl-part" aria-labelledby="players-room-title">
      <h3 class="pl-h" id="players-room-title">In this room<span id="players-count"></span></h3>
      <ul class="pl-list" id="players-list"></ul>
      <p class="pl-note" id="players-note" hidden></p>
    </section>
    <section class="pl-part" id="players-friends" aria-labelledby="players-friends-title" hidden>
      <h3 class="pl-h" id="players-friends-title">Friends playing ${options.title}</h3>
      <div id="players-friends-list"></div>
    </section>
    <p class="pl-note" id="players-sign-in" hidden><a href="${options.signInPath}">Sign in</a> to see your friends here.</p>
  </div>
</dialog>
<style>
.pl-part+.pl-part{margin-top:22px}
.pl-h{margin:0 0 8px;font-size:15px;font-weight:600;color:var(--text-2)}
#players-count{color:var(--muted);font-weight:500}
.pl-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.pl-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-height:52px;padding:8px 10px 8px 12px;
  background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.1),inset -1px -1px 0 #000;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)}
.pl-name{flex:1;min-width:0;font-family:var(--display);font-size:15px;font-weight:600;color:var(--text);text-decoration:none;overflow-wrap:anywhere}
a.pl-name:hover{text-decoration:underline}
.pl-friend{margin-left:8px;font-family:var(--body,inherit);font-size:12px;font-weight:500;color:var(--ok)}
.pl-state{margin-left:6px;font-weight:500;font-size:13px;color:var(--muted)}
.pl-row .btn{min-height:34px;padding:0 12px;font-size:13px}
.pl-more{width:34px;height:34px;padding:0;justify-content:center}
.pl-actions{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 2px 36px}
.pl-actions .btn{min-height:32px}
.pl-note{margin:4px 2px 0;color:var(--muted);font-size:14px}
.pl-note a{color:var(--text)}
</style>
${scriptTags(PLAYERS_SHEET_SCRIPT)}`;
}

const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

// The plate's script: the game's SDK says who's in the room, and Mute, Block and Report go back through the game and Zaisma's plates.
const PLAYERS_SHEET_SCRIPT = pageScript("players-sheet", String.raw`(() => {
  const sheet = document.getElementById("players");
  const opener = document.getElementById("players-open");
  if (!sheet || !opener) return;
  const GAME_ORIGIN = sheet.dataset.gameOrigin;
  const SLUG = sheet.dataset.slug;
  const HAS_ZAISMA_ROOMS = sheet.dataset.hasZaismaRooms === "true";
  const CAN_SIGN_IN = sheet.dataset.canSignIn === "true";
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const $ = (id) => document.getElementById(id);
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  const count = opener.querySelector(".count");
  // The room the game is in, as its SDK says: { code, myPlayerId, players, muted, blocked, lasting }.
  let room = null, hasSeenRoom = false, openPlayerId = null;
  // Accounts by player ID, by the name Zaisma knows them by: { name, isFriend }.
  const accounts = new Map();
  const asked = new Set();

  const text = (value, most) => (typeof value === "string" ? value.trim().slice(0, most) : "");
  const ids = (list) => new Set(Array.isArray(list) ? list.filter((each) => typeof each === "string") : []);
  function hue(name) { let h = 7; for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
  function initials(name) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? [Array.from(words[0])[0], Array.from(words[1])[0]] : Array.from(words[0] || "?").slice(0, 2);
    return letters.join("").toUpperCase();
  }
  function element(tag, className, content) {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (content !== undefined) made.textContent = content;
    return made;
  }

  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== GAME_ORIGIN || !d) return;
    if (d.type === "zaisma:players" && typeof d.code === "string" && CODE.test(d.code) && Array.isArray(d.players)) {
      const players = d.players.slice(0, 50).filter((each) => each && typeof each.id === "string" && each.id.length <= 60).map((each) => ({ id: each.id, name: text(each.name, 40) || "A player", kind: each.kind === "account" ? "account" : "guest" }));
      room = { code: d.code, myPlayerId: typeof d.myPlayerId === "string" ? d.myPlayerId : null, players, muted: ids(d.mutedPlayerIds), blocked: ids(d.blockedPlayerIds), lasting: ids(d.lastingBlockedPlayerIds) };
      hasSeenRoom = true;
      lookUp();
      update();
    } else if (d.type === "zaisma:left" && room && d.code === room.code) {
      room = null;
      update();
    }
  });

  // Names and Friend marks for accounts come from Zaisma, never from the game.
  function lookUp() {
    const unasked = room.players.filter((each) => each.kind === "account" && each.id !== room.myPlayerId && !asked.has(each.id) && /^player_[a-z0-9]{1,40}$/.test(each.id)).map((each) => each.id);
    if (!unasked.length) return;
    unasked.forEach((playerId) => asked.add(playerId));
    fetch("/friends/among?player_ids=" + unasked.join(","))
      .then((res) => (res.ok ? res.json() : { players: [] }))
      .then((answer) => {
        (answer.players || []).forEach((each) => accounts.set(each.player_id, { name: each.name, isFriend: each.is_friend === true }));
        if (sheet.open) render();
      })
      .catch(() => {});
  }

  function update() {
    count.hidden = !room;
    count.textContent = room ? String(room.players.length) : "";
    if (sheet.open) render();
  }

  function render() {
    $("players-count").textContent = room ? " · " + room.players.length : "";
    const list = $("players-list");
    list.textContent = "";
    const others = room ? room.players.filter((each) => each.id !== room.myPlayerId) : [];
    const note = $("players-note");
    note.textContent = !room
      ? HAS_ZAISMA_ROOMS || hasSeenRoom ? "Players show here once you're in a room." : "This game keeps its own player list. Mute, block and report are in its menu."
      : others.length ? "" : "Nobody else is here yet.";
    note.hidden = !note.textContent;
    others.forEach((other) => list.appendChild(row(other)));
  }

  function row(other) {
    const known = other.kind === "account" ? accounts.get(other.id) : null;
    const name = known ? known.name : other.name;
    const isBlocked = room.blocked.has(other.id) || room.lasting.has(other.id);
    const isMuted = room.muted.has(other.id);
    const item = element("li", "pl-row");
    const face = element("span", "av sm", initials(name));
    face.style.setProperty("--h", String(hue(name)));
    face.setAttribute("aria-hidden", "true");
    const label = element("span", "pl-name", name);
    if (known && known.isFriend) label.appendChild(element("span", "pl-friend", "Friend"));
    if (isBlocked || isMuted) label.appendChild(element("span", "pl-state", isBlocked ? "(blocked)" : "(muted)"));
    item.append(face, label);
    // A lasting block is undone on zaisma.com/friends; a session one, or a mute, here.
    if (!room.lasting.has(other.id)) {
      const mute = element("button", "btn ghost", isBlocked ? "Unblock" : isMuted ? "Unmute" : "Mute");
      mute.type = "button";
      mute.addEventListener("click", () => tell({ type: "zaisma:player-action", action: isBlocked || isMuted ? "unmute" : "mute", playerId: other.id }));
      item.appendChild(mute);
    }
    const more = element("button", "ctl pl-more", "⋯");
    more.type = "button";
    more.setAttribute("aria-label", "More for " + name);
    more.setAttribute("aria-expanded", String(openPlayerId === other.id));
    more.addEventListener("click", () => { openPlayerId = openPlayerId === other.id ? null : other.id; render(); });
    item.appendChild(more);
    if (openPlayerId === other.id) {
      const actions = element("div", "pl-actions");
      if (known) {
        const profile = element("a", "btn ghost", "Profile");
        profile.href = "/@" + encodeURIComponent(known.name);
        profile.target = "_blank";
        profile.rel = "noopener";
        actions.appendChild(profile);
      }
      if (!isBlocked) actions.appendChild(action("Block", () => { sheet.close(); tell({ type: "zaisma:player-action", action: "block", playerId: other.id }); }));
      actions.appendChild(action("Report", () => { sheet.close(); dispatchEvent(new CustomEvent("zaisma:open-report", { detail: { id: other.id, name, code: room ? room.code : "" } })); }));
      item.appendChild(actions);
    }
    return item;
  }

  function action(label, onClick) {
    const button = element("button", "btn ghost", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  // Friends playing this game, outside this room, with Join: fresh each time the plate opens.
  function loadFriends() {
    const signedIn = isSignedIn();
    $("players-friends").hidden = !signedIn;
    $("players-sign-in").hidden = signedIn || !CAN_SIGN_IN;
    if (!signedIn) return;
    fetch("/g/" + SLUG + "/players/friends" + (room ? "?room=" + room.code : ""))
      .then((res) => (res.ok ? res.text() : ""))
      .then((fragment) => { $("players-friends-list").innerHTML = fragment; })
      .catch(() => {});
  }

  opener.addEventListener("click", () => {
    ["menu-dialog", "report", "block"].forEach((id) => { const other = $(id); if (other && other.open) other.close(); });
    openPlayerId = null;
    render();
    loadFriends();
    if (!sheet.open) sheet.showModal();
  });
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet || (e.target.closest && e.target.closest("[data-close]"))) sheet.close();
  });
  sheet.addEventListener("close", () => { const f = frame(); if (f) f.focus(); });
})();`);
