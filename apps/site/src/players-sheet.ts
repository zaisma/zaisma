import { MAXIMUM_OTHER_PLAYER_COUNT, friendsInGameOf, gameBySlug, joinRefusalText } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { cutButton, runButton, textLink } from "./components/actions.ts";
import { cutField } from "./components/fields.ts";
import type { ControlMarkup } from "./components/control-markup.ts";
import { listRows, pictureFrame, emptyState } from "./components/data.ts";
import { stack, type LayoutItem } from "./components/layout.ts";
import { menuChoices, sheet, type SheetStep } from "./components/panes.ts";
import { joinPath } from "./friends-now.ts";
import { profilePath } from "./profiles.ts";
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

/** A full room holds this many players (the game server's room limit), so the sheet never asks about more. */
const MAXIMUM_PLAYER_COUNT = MAXIMUM_OTHER_PLAYER_COUNT;
/** Past this many others in the room, the sheet's find field shows, so a long room is a name away. */
const FIND_SHOWN_AFTER_COUNT = 12;
const PLAYER_ID = /^player_[a-z0-9]{1,40}$/;
/** Only compared with friends' rooms, never shown, so any six letters or digits will do. */
const ROOM_CODE = /^[A-Z0-9]{6}$/;

/**
 * Friends playing the game, each with Join, grayed with why under their name when it won't work; none for a friend in no room Zaisma
 * knows. Watch beside it when their room takes spectators, by the same rules. The players sheet puts this in its friends part.
 */
export function friendRows(slug: string, friends: Awaited<ReturnType<typeof friendsInGameOf>>): Raw {
  if (!friends.length) return html`<p class="sheet-text">None of your friends are playing this right now.</p>`;
  return listRows({ whenEmpty: emptyState({ title: "No friends playing", text: "None of your friends are playing this right now." }),
    isCompact: true,
    label: "Friends playing",
    rows: friends.map((friend) => {
      const join = friend.join_refusal === "friend_not_in_room" || (!friend.room_code && !friend.join_refusal) ? null : { room_code: friend.room_code ?? "", server_url: friend.server_url, refusal: friend.join_refusal, refusing_friend_names: [friend.username] };
      const watch = friend.watch ? { room_code: friend.watch.room_code ?? "", server_url: null, refusal: friend.watch.refusal, refusing_friend_names: [friend.username] } : null;
      const reasons = [...new Set([join, watch].flatMap((door) => (door?.refusal ? [joinRefusalText(door)] : [])))];
      const doorButton = (label: string, door: NonNullable<typeof join>, path: string) => (door.refusal ? cutButton(label, { type: "button", isSmall: true, isDisabled: true }) : cutButton(label, { href: path, isSmall: true }));
      const actions = [join ? doorButton("Join", join, joinPath(slug, join)) : null, watch ? doorButton("Watch", watch, `${joinPath(slug, watch)}&watch=1`) : null].filter((action): action is ControlMarkup => action !== null);
      // The picture opens their profile in a new tab, so the game keeps running here.
      const lead = html`<a href="${profilePath(friend.username)}" target="_blank" rel="noopener" aria-label="${friend.username}'s profile">${pictureFrame(friend.username, "sm")}</a>`;
      return { lead, title: friend.username, detail: reasons.join(" · ") || undefined, action: actions.length ? actions : undefined };
    }),
  });
}

/**
 * The Players sheet, risen from the foot over the running game (which stays in view), for games that go online: who's in the room, each
 * with Mute and ⋯, and the friends playing the game. Its steps move forward inside it: Players, then a player (Profile, Block, Report),
 * then Report (reportStep, which brings its own script), each with Back; Block opens its confirm on top. The bar's button that opens it is
 * the game page's: id "players-open", aria-controls "players", with the room's player count in its cut-count (cutButton's reactionCount).
 */
export function playersSheet(options: { gameOrigin: string; slug: string; title: string; hasZaismaRooms: boolean; canSignIn: boolean; signInPath: string; reportStep: SheetStep }): Raw {
  const words = (markup: Raw): LayoutItem => ({ kind: "words", markup });
  const body = stack({
    items: [
      // Friend requests waiting for the player, with Accept and Turn down (friend-requests.ts brings them).
      {
        kind: "block",
        id: "players-requests",
        isHidden: true,
        markup: stack({ items: [words(html`<h3>Friend requests</h3>`), { kind: "block", markup: listRows({ whenEmpty: html`<p hidden></p>`, rows: [], id: "players-requests-list", label: "Friend requests" }) }] }),
      },
      // The room's own heading shows only under friend requests, to part the two lists.
      words(html`<h3 id="players-room-title" hidden>In this room</h3>`),
      // A long room's find field: it narrows the list to the names that hold what's typed.
      { kind: "control", id: "players-find", isHidden: true, markup: cutField({ id: "players-find-field", name: "player_name", label: "Find a player", type: "search", icon: "search", placeholder: "Find a player", autocomplete: "off" }) },
      // While nobody's listed, the note says why (the page's script writes it): the list's empty state.
      { kind: "block", markup: listRows({ whenEmpty: html`<p id="players-note" hidden></p>`, isCompact: true, rows: [], id: "players-list", label: "In this room" }) },
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
      {
        kind: "block",
        markup: menuChoices({
          label: "Their choices",
          choices: [
            { label: "Profile", href: "/", id: "players-player-profile", icon: "person", isHidden: true },
            // Only when they take friend requests from this player (friend-requests.ts asks), with no hint why otherwise.
            { label: "Add friend", isButton: true, id: "players-player-friend", icon: "friends", isHidden: true },
            { label: "Block", isButton: true, id: "players-player-block", icon: "ban" },
            { label: "Report", isButton: true, id: "players-player-report", icon: "flag" },
          ],
        }),
      },
      words(html`<p id="players-player-sent" hidden>Friend request sent.</p>`),
      words(html`<p id="players-player-sign-in" hidden>${textLink("Sign in", options.signInPath)} to add friends.</p>`),
    ],
  });
  const rowButton = { type: "button", isSmall: true } as const;
  // A row's toggle, the script showing one: Mute (a speaker), pressed once muted (the speaker crossed out), or pressed with the block mark for a block made here (Unblock).
  const rowTemplate = listRows({
    whenEmpty: emptyState({ title: "Nobody here yet", text: "Players show here as they join your room." }),
    isCompact: true,
    rows: [{
      lead: pictureFrame("?", "sm"),
      title: "?",
      titleIcon: { icon: "friends", label: "Friend", isHidden: true },
      action: [
        cutButton("Mute", { ...rowButton, icon: "speaker", isLabelHidden: true, isPressed: false, dataAttributes: { "player-action": "mute" } }),
        cutButton("Mute", { ...rowButton, icon: "speaker-off", isLabelHidden: true, isPressed: true, isHidden: true, dataAttributes: { "player-action": "unmute" } }),
        cutButton("Unblock", { ...rowButton, icon: "ban", isLabelHidden: true, isPressed: true, isHidden: true, dataAttributes: { "player-action": "unblock" } }),
        cutButton("More", { ...rowButton, icon: "more", isLabelHidden: true, dataAttributes: { "player-action": "more" } }),
      ],
    }],
  });
  return html`${sheet({
    id: "players",
    closeLabel: "Close",
    placement: "foot",
    // Menu-sized on a wide screen, its words a size smaller, so a long room reads as a list.
    isCompact: true,
    steps: [{ stepName: "players", title: "Players", body }, { stepName: "player", title: "Player", body: playerBody }, options.reportStep],
  })}
<template id="players-row">${rowTemplate}</template>
<template id="players-request-row">${listRows({ whenEmpty: html`<p hidden></p>`, rows: [{ lead: pictureFrame("?", "md"), title: "?", action: [runButton("Accept", { ...rowButton, dataAttributes: { "request-action": "accept" } }), cutButton("Turn down", { ...rowButton, dataAttributes: { "request-action": "turn-down" } })] }] })}</template>
${pageData("players-data", { gameOrigin: options.gameOrigin, slug: options.slug, hasZaismaRooms: options.hasZaismaRooms, canSignIn: options.canSignIn, maximumPlayerCount: MAXIMUM_PLAYER_COUNT, findShownAfterCount: FIND_SHOWN_AFTER_COUNT })}
${scriptTags(PLAYERS_SHEET_SCRIPT)}`;
}

// The sheet's script: the game's SDK says who's in the room, and Mute, Block and Report go back through the game and Zaisma's sheets.
const PLAYERS_SHEET_SCRIPT = pageScript("players-sheet", String.raw`(() => {
  const sheet = document.getElementById("players");
  const opener = document.getElementById("players-open");
  const data = document.getElementById("players-data");
  if (!sheet || !opener || !data) return;
  const { gameOrigin: GAME_ORIGIN, slug: SLUG, hasZaismaRooms: HAS_ZAISMA_ROOMS, canSignIn: CAN_SIGN_IN, maximumPlayerCount: MAXIMUM_PLAYER_COUNT, findShownAfterCount: FIND_SHOWN_AFTER_COUNT } = JSON.parse(data.textContent);
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const $ = (id) => document.getElementById(id);
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  // The bar button's count: its cut-count (cutButton's reactionCount).
  const count = opener.querySelector(".cut-count");
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
  // Friend requests waiting for this player, and the ones they sent from here this session.
  let requests = [];
  const sentTo = new Set();
  addEventListener("zaisma:friend-requests-waiting", (e) => { requests = e.detail && Array.isArray(e.detail.requests) ? e.detail.requests : []; if (sheet.open) render(); });
  addEventListener("zaisma:friend-request-sent", (e) => { if (e.detail) sentTo.add(e.detail.id); });
  // Friends now (an accept either way): the row says Friend, and the menu has nothing to add.
  addEventListener("zaisma:friend-added", (e) => {
    if (!e.detail) return;
    sentTo.delete(e.detail.id);
    const known = accounts.get(e.detail.id);
    if (known && !known.isFriend) { known.isFriend = true; if (sheet.open) render(); }
  });
  function renderRequests() {
    const list = $("players-requests-list");
    list.textContent = "";
    $("players-requests").hidden = !requests.length;
    $("players-room-title").hidden = !requests.length;
    list.hidden = !requests.length;
    requests.slice(0, 20).forEach((waiting) => {
      const item = $("players-request-row").content.querySelector("li").cloneNode(true);
      paint(item.querySelector(".av"), waiting.name);
      item.querySelector(".list-row-title").textContent = waiting.name;
      item.querySelectorAll("[data-request-action]").forEach((button) => button.addEventListener("click", () => {
        dispatchEvent(new CustomEvent("zaisma:answer-friend-request", { detail: { id: waiting.player_id, verb: button.dataset.requestAction } }));
      }));
      list.appendChild(item);
    });
  }

  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== GAME_ORIGIN || !d) return;
    if (d.type === "zaisma:players" && typeof d.code === "string" && CODE.test(d.code) && Array.isArray(d.players)) {
      const players = d.players.slice(0, MAXIMUM_PLAYER_COUNT).filter((each) => each && typeof each.id === "string" && each.id.length <= 60).map((each) => ({ id: each.id, name: text(each.name, 40) || "A player", kind: each.kind === "account" ? "account" : "guest" }));
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

  // The name a player goes by here: Zaisma's for an account, the game's otherwise.
  const nameOf = (other) => { const known = other.kind === "account" ? accounts.get(other.id) : null; return known ? known.name : other.name; };
  const isFriend = (other) => { const known = other.kind === "account" ? accounts.get(other.id) : null; return Boolean(known && known.isFriend); };
  const find = $("players-find-field");
  find.addEventListener("input", () => render());
  // Enter in it finds, and never sends the sheet's form (its Report step's).
  find.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); } });
  function render() {
    renderRequests();
    $("players-players-title").textContent = room ? "Players · " + room.players.length : "Players";
    const list = $("players-list");
    list.textContent = "";
    // Friends first, then everyone else in the order they joined.
    const everyone = room ? room.players.filter((each) => each.id !== room.myPlayerId) : [];
    const ordered = everyone.filter(isFriend).concat(everyone.filter((each) => !isFriend(each)));
    $("players-find").hidden = everyone.length <= FIND_SHOWN_AFTER_COUNT;
    if ($("players-find").hidden) find.value = "";
    const wanted = find.value.trim().toLowerCase();
    const others = wanted ? ordered.filter((each) => nameOf(each).toLowerCase().includes(wanted)) : ordered;
    list.hidden = !others.length;
    const note = $("players-note");
    note.textContent = !room
      ? HAS_ZAISMA_ROOMS || hasSeenRoom ? "Players show here once you're in a room." : "Players show here once the game says who's playing with you. Until then, mute, block and report are in its own menu."
      : others.length ? "" : wanted ? "Nobody here goes by that name." : "Nobody else is here yet.";
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
    // A friend is marked by the friends icon after their name; muted and blocked show on the row's toggle, never as words beside the name.
    item.querySelector(".list-row-title-icon").hidden = !(known && known.isFriend);
    const button = (action) => item.querySelector('[data-player-action="' + action + '"]');
    const more = button("more");
    // One of Mute, Unmute and Unblock shows; a lasting block is undone on zaisma.com/friends, so none does then.
    const shown = room.lasting.has(other.id) ? null : isBlocked ? "unblock" : isMuted ? "unmute" : "mute";
    ["mute", "unmute", "unblock"].forEach((action) => {
      const each = button(action);
      if (action !== shown) return each.closest(".row-cell").remove();
      each.hidden = false;
      each.setAttribute("aria-label", (action === "unblock" ? "Unblock " : "Mute ") + name);
      each.addEventListener("click", () => tell({ type: "zaisma:player-action", action: action === "mute" ? "mute" : "unmute", playerId: other.id }));
    });
    more.setAttribute("aria-label", "More for " + name);
    // ⋯ moves the sheet to the player's step, filled in here first.
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
      showFriendChoice(other, known, isBlocked);
      zaismaLayers.step(sheet, "player");
    });
    return item;
  }

  // Add friend, Friend request sent, or Sign in to add friends: asked of Zaisma as the player's sheet opens.
  function showFriendChoice(other, known, isBlocked) {
    const add = $("players-player-friend"), sent = $("players-player-sent"), signIn = $("players-player-sign-in");
    add.hidden = true;
    sent.hidden = true;
    signIn.hidden = !(other.kind === "account" && !isSignedIn() && CAN_SIGN_IN);
    if (!known || known.isFriend || isBlocked || !isSignedIn()) return;
    // Sent from here: say so at once, then ask Zaisma, which knows when it was accepted since.
    sent.hidden = !sentTo.has(other.id);
    const asking = other.id;
    fetch("/friends/requests/about/" + other.id)
      .then((res) => (res.ok ? res.json() : null))
      .then((about) => {
        if (!about || !chosen || chosen.id !== asking) return;
        if (about.is_friend) {
          sentTo.delete(asking);
          known.isFriend = true;
          render();
        }
        add.hidden = !about.can_send;
        sent.hidden = !about.has_sent;
      })
      .catch(() => {});
  }
  $("players-player-friend").addEventListener("click", () => {
    if (!chosen) return;
    const playerId = chosen.id;
    sheet.close();
    dispatchEvent(new CustomEvent("zaisma:ask-friend-request", { detail: { id: playerId } }));
  });

  // Block goes back to the room's list, and the game asks: between two accounts, its confirm opens on top of this sheet.
  $("players-player-block").addEventListener("click", () => {
    if (!chosen) return;
    const playerId = chosen.id;
    zaismaLayers.step(sheet, "players");
    tell({ type: "zaisma:player-action", action: "block", playerId });
  });
  // Report is this sheet's next step (report.ts fills it in and moves to it).
  $("players-player-report").addEventListener("click", () => {
    if (!chosen) return;
    dispatchEvent(new CustomEvent("zaisma:open-report", { detail: { id: chosen.id, name: chosen.name, code: room ? room.code : "" } }));
  });

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

  // The bar's button opens it at the room's list (zaismaLayers does too, by its aria-controls; this runs first and fills it in).
  opener.addEventListener("click", () => {
    ["report", "block", "friend-request"].forEach((id) => { const other = $(id); if (other && other.open) other.close(); });
    render();
    loadFriends();
    zaismaLayers.step(sheet, "players", { isBackShown: false });
    if (!sheet.open) sheet.showModal();
  });
  sheet.addEventListener("close", () => { chosen = null; const f = frame(); if (f) f.focus(); });
  // No count on the bar's button until the game is in a room.
  update();
})();`);
