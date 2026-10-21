import { friendsInGameOf, gameBySlug, joinRefusalText } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { cutButton, textLink } from "./components/actions.ts";
import { pictureFrame } from "./components/data.ts";
import { tag } from "./components/foundations.ts";
import { sheet } from "./components/panes.ts";
import { friendJoinButton } from "./friends-now.ts";
import { html, scriptTags, securityHeaders, type Raw } from "./html.ts";
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
  if (!friends.length) return html`<p class="players-note">None of your friends are playing this right now.</p>`;
  return html`<ul class="list-rows">${friends.map((friend) => {
    const join = friend.join_refusal === "no_room" || (!friend.room_code && !friend.join_refusal) ? null : { room_code: friend.room_code ?? "", server_url: friend.server_url, refusal: friend.join_refusal, refusing_friend_names: [friend.username] };
    // When Join won't work, why is said under the name, in words.
    return html`<li><div class="list-row players-row"><a class="players-face" href="${profilePath(friend.username)}" target="_blank" rel="noopener" aria-label="${friend.username}">${pictureFrame(friend.username, "sm")}</a><span class="list-row-words"><a class="list-row-title players-name" href="${profilePath(friend.username)}" target="_blank" rel="noopener">${friend.username}</a>${join?.refusal ? html`<span class="list-row-detail">${joinRefusalText(join)}</span>` : ""}</span>${join ? html`<span class="list-row-end">${friendJoinButton(slug, join)}</span>` : ""}</div></li>`;
  })}</ul>`;
}

/**
 * The Players sheet itself, for games that go online. The rows its script builds use the buttons in its templates, so they're the
 * components' own; its look is the game page's (game-page-style.ts).
 */
export function playersSheet(options: { gameOrigin: string; slug: string; title: string; hasZaismaRooms: boolean; canSignIn: boolean; signInPath: string }): Raw {
  return html`${sheet({
    id: "players",
    title: "Players",
    closeLabel: "Close",
    body: html`<section class="players-part" aria-labelledby="players-room-title">
<h3 class="players-heading" id="players-room-title">In this room<span id="players-count"></span></h3>
<ul class="list-rows" id="players-list"></ul>
<p class="players-note" id="players-note" hidden></p>
</section>
<section class="players-part" id="players-friends" aria-labelledby="players-friends-title" hidden>
<h3 class="players-heading" id="players-friends-title">Friends playing ${options.title}</h3>
<div id="players-friends-list"></div>
</section>
<p class="players-note" id="players-sign-in" hidden>${textLink("Sign in", options.signInPath)} to see your friends here.</p>`,
  })}<span hidden id="players-config" data-game-origin="${options.gameOrigin}" data-slug="${options.slug}" data-has-zaisma-rooms="${String(options.hasZaismaRooms)}" data-can-sign-in="${String(options.canSignIn)}"></span>
<template id="players-button">${cutButton("Mute", { type: "button", isSmall: true })}</template>
<template id="players-more">${cutButton("More", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, isExpanded: false })}</template>
<template id="players-link">${cutButton("Profile", { href: "/", isSmall: true })}</template>
<template id="players-friend">${tag("Friend", "new")}</template>
${scriptTags(PLAYERS_SHEET_SCRIPT)}`;
}

// The plate's script: the game's SDK says who's in the room, and Mute, Block and Report go back through the game and Zaisma's plates.
const PLAYERS_SHEET_SCRIPT = pageScript("players-sheet", String.raw`(() => {
  const sheet = document.getElementById("players");
  const opener = document.getElementById("players-open");
  if (!sheet || !opener) return;
  const config = document.getElementById("players-config").dataset;
  const GAME_ORIGIN = config.gameOrigin;
  const SLUG = config.slug;
  const HAS_ZAISMA_ROOMS = config.hasZaismaRooms === "true";
  const CAN_SIGN_IN = config.canSignIn === "true";
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const $ = (id) => document.getElementById(id);
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  const count = document.getElementById("players-count-badge");
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
  // A component from the sheet's templates: a cut button with its label, or the Friend tag.
  function fromTemplate(id, label) {
    const made = $(id).content.firstElementChild.cloneNode(true);
    const words = made.querySelector(".face > span:not([class])");
    if (words && label !== undefined) words.textContent = label;
    return made;
  }
  // An account's picture as the page draws them (data.ts, pictureFrame): initials in their own color, in a frame of glass.
  function picture(name) {
    const frame = element("span", "frame sm glass");
    frame.setAttribute("data-glass", "");
    frame.setAttribute("data-glass-corners", "0 0 0 0");
    frame.setAttribute("data-glass-band", "2");
    frame.setAttribute("aria-hidden", "true");
    const inside = element("span", "frame-picture");
    const face = element("span", "av sm", initials(name));
    face.style.setProperty("--h", String(hue(name)));
    inside.append(face);
    frame.append(inside);
    return frame;
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
    count.querySelector(".tag").textContent = room ? String(room.players.length) : "";
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
    const item = element("li");
    const line = element("div", "list-row players-row");
    const words = element("span", "list-row-words");
    const title = element("span", "list-row-title", name);
    if (known && known.isFriend) title.append(" ", fromTemplate("players-friend"));
    words.appendChild(title);
    if (isBlocked || isMuted) words.appendChild(element("span", "list-row-detail", isBlocked ? "Blocked" : "Muted"));
    const end = element("span", "list-row-end");
    line.append(picture(name), words, end);
    item.appendChild(line);
    // A lasting block is undone on zaisma.com/friends; a session one, or a mute, here.
    if (!room.lasting.has(other.id)) {
      const mute = fromTemplate("players-button", isBlocked ? "Unblock" : isMuted ? "Unmute" : "Mute");
      mute.addEventListener("click", () => tell({ type: "zaisma:player-action", action: isBlocked || isMuted ? "unmute" : "mute", playerId: other.id }));
      end.appendChild(mute);
    }
    const more = fromTemplate("players-more");
    more.setAttribute("aria-label", "More for " + name);
    more.setAttribute("aria-expanded", String(openPlayerId === other.id));
    more.addEventListener("click", () => { openPlayerId = openPlayerId === other.id ? null : other.id; render(); });
    end.appendChild(more);
    if (openPlayerId === other.id) {
      const actions = element("div", "control-row players-actions");
      if (known) {
        const profile = fromTemplate("players-link", "Profile");
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
    const button = fromTemplate("players-button", label);
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
    ["report", "block", "share-dialog"].forEach((id) => { const other = $(id); if (other && other.open) other.close(); });
    openPlayerId = null;
    render();
    loadFriends();
    if (!sheet.open) sheet.showModal();
  });
  sheet.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("[data-close]")) sheet.close();
  });
  sheet.addEventListener("close", () => { const f = frame(); if (f) f.focus(); });
})();`);
