import { friendsInGameOf, gameBySlug, joinRefusalText } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { cutButton, textLink } from "./components/actions.ts";
import type { ControlMarkup } from "./components/control-markup.ts";
import { listRows, pictureFrame } from "./components/data.ts";
import { stack, type LayoutItem } from "./components/layout.ts";
import { sheet } from "./components/panes.ts";
import { joinPath } from "./friends-now.ts";
import { html, pageData, scriptTags, securityHeaders, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * The Players plate in the game page's bar (docs/DECISIONS.md, "Players in the game bar"): who's in the
 * room, with Mute on each row and Profile, Block and Report behind ⋯, and the player's friends playing
 * the game with Join, so every game Zaisma can see the room of has mute, block and report on zaisma.com.
 * The game's SDK says who's in the room (zaisma:players); names and Friend marks for accounts come from
 * Zaisma, never from the game, and Block and Report go through their own plates.
 *
 *   GET /friends/among?player_ids=a,b   which of these players are accounts, by the name Zaisma knows
 *                                       them by, and whether each is a friend of the signed-in player
 *   GET /g/:slug/players/friends?room=  the friends playing that game, outside that room, with Join (and Watch)
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

/**
 * Friends playing the game, each with Join, grayed with why under their name when it won't work; none for a friend in no room Zaisma
 * knows. Watch beside it when their room takes spectators, by the same rules. The players sheet puts this in its friends part.
 */
function friendRows(slug: string, friends: Awaited<ReturnType<typeof friendsInGameOf>>): Raw {
  if (!friends.length) return html`<p class="sheet-text">None of your friends are playing this right now.</p>`;
  return listRows({
    label: "Friends playing",
    rows: friends.map((friend) => {
      const join = friend.join_refusal === "no_room" || (!friend.room_code && !friend.join_refusal) ? null : { room_code: friend.room_code ?? "", server_url: friend.server_url, refusal: friend.join_refusal, refusing_friend_names: [friend.username] };
      const watch = friend.watch ? { room_code: friend.watch.room_code ?? "", server_url: null, refusal: friend.watch.refusal, refusing_friend_names: [friend.username] } : null;
      const reasons = [...new Set([join, watch].flatMap((door) => (door?.refusal ? [joinRefusalText(door)] : [])))];
      const doorButton = (label: string, door: NonNullable<typeof join>, path: string) => (door.refusal ? cutButton(label, { type: "button", isSmall: true, isDisabled: true }) : cutButton(label, { href: path, isSmall: true }));
      const actions = [join ? doorButton("Join", join, joinPath(slug, join)) : null, watch ? doorButton("Watch", watch, `${joinPath(slug, watch)}&watch=1`) : null].filter((action): action is ControlMarkup => action !== null);
      return { lead: pictureFrame(friend.username, "md"), title: friend.username, detail: reasons.join(" · ") || undefined, action: actions.length ? actions : undefined };
    }),
  });
}

/**
 * The Players sheet, risen from the foot over the running game (which stays in view), for games that go online: who's in the room, each
 * with Mute and ⋯ (Profile, Block, Report in a sheet of their own), and the friends playing the game. The bar's button that opens it is
 * the game page's: id "players-open", aria-controls "players", with the room's player count in its cut-count (cutButton's reactionCount).
 */
export function playersSheet(options: { gameOrigin: string; slug: string; title: string; hasZaismaRooms: boolean; canSignIn: boolean; signInPath: string }): Raw {
  const words = (markup: Raw): LayoutItem => ({ kind: "words", markup });
  const body = stack({
    items: [
      words(html`<h3 id="players-room-title">In this room<span id="players-count"></span></h3>`),
      { kind: "block", markup: listRows({ rows: [], id: "players-list", label: "In this room" }) },
      words(html`<p id="players-note" hidden></p>`),
      words(html`<p id="players-watching" hidden></p>`),
      {
        kind: "block",
        id: "players-friends",
        isHidden: true,
        markup: stack({ items: [words(html`<h3 id="players-friends-title">Friends playing ${options.title}</h3>`), { kind: "block", markup: html`<div id="players-friends-list"></div>` }] }),
      },
      words(html`<p id="players-sign-in" hidden>${textLink("Sign in", options.signInPath)} to see your friends here.</p>`),
    ],
  });
  // One player's other choices: Profile (accounts only), Block and Report, a press further than Mute, so a misclick only mutes.
  const playerBody = stack({
    items: [
      { kind: "control", markup: cutButton("Profile", { href: "/", id: "players-player-profile", isFullWidth: true, isHidden: true }) },
      { kind: "control", markup: cutButton("Block", { type: "button", id: "players-player-block", isFullWidth: true }) },
      { kind: "control", markup: cutButton("Report", { type: "button", id: "players-player-report", isFullWidth: true }) },
    ],
  });
  const rowButton = { type: "button", isSmall: true } as const;
  const rowTemplate = listRows({ rows: [{ lead: pictureFrame("?", "md"), title: "?", detail: "?", action: [cutButton("Mute", { ...rowButton, dataAttributes: { "player-action": "mute" } }), cutButton("More", { ...rowButton, icon: "more", isLabelHidden: true, controls: "players-player", dataAttributes: { "player-action": "more" } })] }] });
  return html`${sheet({ id: "players", title: "Players", body, closeLabel: "Close", placement: "foot" })}
${sheet({ id: "players-player", title: "Player", body: playerBody, closeLabel: "Close", placement: "foot" })}
<template id="players-row">${rowTemplate}</template>
${pageData("players-data", { gameOrigin: options.gameOrigin, slug: options.slug, hasZaismaRooms: options.hasZaismaRooms, canSignIn: options.canSignIn })}
${scriptTags(PLAYERS_SHEET_SCRIPT)}`;
}

// The sheet's script: the game's SDK says who's in the room, and Mute, Block and Report go back through the game and Zaisma's sheets.
const PLAYERS_SHEET_SCRIPT = pageScript("players-sheet", String.raw`(() => {
  const sheet = document.getElementById("players");
  const opener = document.getElementById("players-open");
  const data = document.getElementById("players-data");
  if (!sheet || !opener || !data) return;
  const { gameOrigin: GAME_ORIGIN, slug: SLUG, hasZaismaRooms: HAS_ZAISMA_ROOMS, canSignIn: CAN_SIGN_IN } = JSON.parse(data.textContent);
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const $ = (id) => document.getElementById(id);
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  // The bar button's count: its cut-count (cutButton's reactionCount).
  const count = opener.querySelector(".cut-count");
  const playerSheet = $("players-player");
  // The room the game is in, as its SDK says: { code, myPlayerId, players, muted, blocked, lasting }.
  let room = null, hasSeenRoom = false;
  // The player whose other choices are open: { id, name }.
  let chosen = null;
  // Accounts by player ID, by the name Zaisma knows them by: { name, isFriend }.
  const accounts = new Map();
  const asked = new Set();

  const text = (value, most) => (typeof value === "string" ? value.trim().slice(0, most) : "");
  const ids = (list) => new Set(Array.isArray(list) ? list.filter((each) => typeof each === "string") : []);
  // An account's picture as the page draws it (accountPicture): initials in its own color, from the name.
  function paint(picture, name) {
    let hue = 7;
    for (const c of name) hue = (hue * 31 + c.codePointAt(0)) % 360;
    const words = name.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? [Array.from(words[0])[0], Array.from(words[1])[0]] : Array.from(words[0] || "?").slice(0, 2);
    picture.style.setProperty("--h", String(hue));
    picture.textContent = letters.join("").toUpperCase();
  }
  // A button's words: the last span in its face (cutButton).
  const wordsOf = (button) => button.querySelector(".face > span:last-child");

  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== GAME_ORIGIN || !d) return;
    if (d.type === "zaisma:players" && typeof d.code === "string" && CODE.test(d.code) && Array.isArray(d.players)) {
      const players = d.players.slice(0, 50).filter((each) => each && typeof each.id === "string" && each.id.length <= 60).map((each) => ({ id: each.id, name: text(each.name, 40) || "A player", kind: each.kind === "account" ? "account" : "guest" }));
      // How many watch: a count, never who (spectators can't reach the players, so their names would only expose them).
      const spectatorCount = typeof d.spectatorCount === "number" && d.spectatorCount > 0 ? Math.min(Math.floor(d.spectatorCount), 999) : 0;
      room = { code: d.code, myPlayerId: typeof d.myPlayerId === "string" ? d.myPlayerId : null, isSpectator: d.isSpectator === true, spectatorCount, players, muted: ids(d.mutedPlayerIds), blocked: ids(d.blockedPlayerIds), lasting: ids(d.lastingBlockedPlayerIds) };
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
    if (count) {
      count.hidden = !room;
      count.textContent = room ? String(room.players.length) : "";
    }
    if (sheet.open) render();
  }

  function render() {
    $("players-count").textContent = room ? " · " + room.players.length : "";
    const list = $("players-list");
    list.textContent = "";
    const others = room ? room.players.filter((each) => each.id !== room.myPlayerId) : [];
    list.hidden = !others.length;
    const note = $("players-note");
    note.textContent = !room
      ? HAS_ZAISMA_ROOMS || hasSeenRoom ? "Players show here once you're in a room." : "Players show here once the game says who's playing with you. Until then, mute, block and report are in its own menu."
      : others.length ? "" : "Nobody else is here yet.";
    note.hidden = !note.textContent;
    const watching = $("players-watching");
    watching.textContent = room && room.spectatorCount ? (room.isSpectator ? "You're watching" + (room.spectatorCount > 1 ? ", with " + (room.spectatorCount - 1) + " more" : "") : room.spectatorCount + " watching") : room && room.isSpectator ? "You're watching" : "";
    watching.hidden = !watching.textContent;
    others.forEach((other) => list.appendChild(row(other)));
  }

  // A player's row, from the page's own (template#players-row): their picture and name, Friend, muted or blocked under it, Mute and ⋯.
  function row(other) {
    const known = other.kind === "account" ? accounts.get(other.id) : null;
    const name = known ? known.name : other.name;
    const isBlocked = room.blocked.has(other.id) || room.lasting.has(other.id);
    const isMuted = room.muted.has(other.id);
    const item = $("players-row").content.querySelector("li").cloneNode(true);
    paint(item.querySelector(".av"), name);
    item.querySelector(".list-row-title").textContent = name;
    const detail = item.querySelector(".list-row-detail");
    detail.textContent = [known && known.isFriend ? "Friend" : "", isBlocked ? "Blocked" : isMuted ? "Muted" : ""].filter(Boolean).join(" · ");
    detail.hidden = !detail.textContent;
    const mute = item.querySelector('[data-player-action="mute"]'), more = item.querySelector('[data-player-action="more"]');
    // A lasting block is undone on zaisma.com/friends; a session one, or a mute, here.
    if (room.lasting.has(other.id)) mute.closest(".row-cell").remove();
    else {
      wordsOf(mute).textContent = isBlocked ? "Unblock" : isMuted ? "Unmute" : "Mute";
      mute.addEventListener("click", () => tell({ type: "zaisma:player-action", action: isBlocked || isMuted ? "unmute" : "mute", playerId: other.id }));
    }
    more.setAttribute("aria-label", "More for " + name);
    // ⋯ opens the player's own sheet (SHEET_SCRIPT, by its aria-controls), filled in here first.
    more.addEventListener("click", () => {
      chosen = { id: other.id, name };
      $("players-player-title").textContent = name;
      const profile = $("players-player-profile");
      profile.hidden = !known;
      if (known) {
        profile.href = "/@" + encodeURIComponent(known.name);
        profile.target = "_blank";
        profile.rel = "noopener";
      }
      $("players-player-block").hidden = isBlocked;
      if (!playerSheet.open) playerSheet.showModal();
    });
    return item;
  }

  function closeBoth() {
    if (playerSheet.open) playerSheet.close();
    if (sheet.open) sheet.close();
  }
  $("players-player-block").addEventListener("click", () => {
    if (!chosen) return;
    const playerId = chosen.id;
    closeBoth();
    tell({ type: "zaisma:player-action", action: "block", playerId });
  });
  $("players-player-report").addEventListener("click", () => {
    if (!chosen) return;
    const detail = { id: chosen.id, name: chosen.name, code: room ? room.code : "" };
    closeBoth();
    dispatchEvent(new CustomEvent("zaisma:open-report", { detail }));
  });
  playerSheet.addEventListener("close", () => { chosen = null; });

  // Friends playing this game, outside this room, with Join: fresh each time the sheet opens.
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

  // The bar's button opens it (SHEET_SCRIPT does too, by its aria-controls; this runs first and fills it in).
  opener.addEventListener("click", () => {
    ["report", "block"].forEach((id) => { const other = $(id); if (other && other.open) other.close(); });
    render();
    loadFriends();
    if (!sheet.open) sheet.showModal();
  });
  sheet.addEventListener("close", () => { if (playerSheet.open) playerSheet.close(); const f = frame(); if (f) f.focus(); });
  // No count on the bar's button until the game is in a room.
  update();
})();`);
