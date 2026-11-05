import { NO_EMPTY_NOTE } from "./markup.ts";
import { AGE_BAND_FLOOR_YEARS, MAXIMUM_OTHER_PLAYER_COUNT, accountById, friendsInGameOf, friendsNowOf, friendsOf, gameBySlug, joinRefusalText } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { action, secondaryButton, primaryButton, textLink, toggleButton } from "./components/actions.ts";
import { cutField } from "./components/fields.ts";
import type { ControlMarkup } from "./components/control-markup.ts";
import { PAINT_PICTURE, listRows, pictureFrame, stateNote, type ListRow } from "./components/data.ts";
import { stack, type LayoutItem, type LayoutMarkup } from "./components/layout.ts";
import type { SheetStep } from "./components/panes.ts";
import { icon } from "./components/foundations.ts";
import type { FriendInGame } from "@zaisma/core";
import { joinPath } from "./friends-now.ts";
import { profilePath } from "./profiles.ts";
import { html, pageData, scriptTags, securityHeaders, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * The Zaisma overlay's Room and Friends (docs/DECISIONS.md, "Room in the Zaisma overlay"): who's in the room, one
 * line each, a player's Profile, Add friend, Mute, Block and Report one step in, and the player's friends playing
 * the game with Join, so every game Zaisma can see the room of has mute, block and report on zaisma.com.
 * The game's SDK says who's in the room (zaisma:players); names and Friend marks for accounts come from
 * Zaisma, never from the game, and Block and Report go through their own plates.
 *
 *   GET /friends/among?player_ids=a,b   which of these players are accounts, by the name Zaisma knows
 *                                       them by, and whether each is a friend of the signed-in player
 *   GET /g/:slug/players/friends?room=  all the player's friends, nearest first: in that room, in that game with Join (and Watch),
 *                                       in another game, online, offline
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
  const account = await accountById(env.DB, session.userId);
  if (!account) return done(new Response(null, { status: 404 }));
  const room = (new URL(request.url).searchParams.get("room") ?? "").toUpperCase();
  const [inGame, now, everyone] = await Promise.all([friendsInGameOf(env.DB, session.userId, game.id), friendsNowOf(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band]), friendsOf(env.DB, account.id)]);
  const isInThisRoom = (friend: FriendInGame) => ROOM_CODE.test(room) && friend.room_code === room;
  const placed = new Set<string>();
  const place = (listed: ListedFriend[], ids: string[]) => { ids.forEach((id) => placed.add(id)); return listed; };
  const here = inGame.filter(isInThisRoom), inThisGame = inGame.filter((friend) => !isInThisRoom(friend));
  const listed = [
    ...place(here.map((friend) => ({ username: friend.username, statusWords: "In your room" })), here.map((friend) => friend.player_id)),
    ...place(inThisGame.map((friend) => ({ username: friend.username, statusWords: friend.room_code ? "In another room" : "Playing this game", door: friend })), inThisGame.map((friend) => friend.player_id)),
  ];
  for (const playing of now.playing) {
    if (!playing.game || playing.game_id === game.id) continue;
    const title = playing.game.title, others = playing.friends.filter((friend) => !placed.has(friend.player_id));
    listed.push(...place(others.map((friend) => ({ username: friend.name, statusWords: `Playing ${title}` })), others.map((friend) => friend.player_id)));
  }
  const online = now.online.filter((friend) => !placed.has(friend.player_id));
  listed.push(...place(online.map((friend) => ({ username: friend.name, statusWords: "Online" })), online.map((friend) => friend.player_id)));
  listed.push(...everyone.filter((friend) => !placed.has(friend.player_id)).map((friend) => ({ username: friend.name, statusWords: "Offline", isAway: true })));
  return done(new Response(friendRows(game.slug, listed).html, { headers: securityHeaders(env) }));
}

/** A full room holds this many players (the game server's room limit), so the sheet never asks about more. */
const MAXIMUM_PLAYER_COUNT = MAXIMUM_OTHER_PLAYER_COUNT;
/** Past this many others in the room, the sheet's find field shows, so a long room is a name away. */
const FIND_SHOWN_AFTER_COUNT = 12;
const PLAYER_ID = /^player_[a-z0-9]{1,40}$/;
/** Only compared with friends' rooms, never shown, so any six letters or digits will do. */
const ROOM_CODE = /^[A-Z0-9]{6}$/;

/** One friend in the overlay's list: where they are in words, and in this game, what Join and Watch can do. */
export interface ListedFriend {
  username: string;
  statusWords: string;
  isAway?: boolean;
  door?: FriendInGame;
}

/**
 * All the player's friends, nearest first, a row each that opens their profile in a new tab, so the game keeps running here. A friend in this
 * game's rooms has Join, grayed with why under their name when it won't work, and Watch beside it when their room takes spectators, by the
 * same rules; none for a friend in no room Zaisma knows. Friends in another game only say which: joining them would leave this one.
 */
export function friendRows(slug: string, friends: ListedFriend[], requests: ListRow[] = []): Raw {
  if (!friends.length && !requests.length) return html`<p class="sheet-text">Friends you add show here.</p>`;
  return listRows({ whenEmpty: NO_EMPTY_NOTE,
    isCompact: true,
    label: "Your friends",
    id: "players-friends-rows",
    rows: [...requests, ...friends.map((friend) => {
      const door = friend.door;
      const join = !door || door.join_refusal === "friend_not_in_room" || (!door.room_code && !door.join_refusal) ? null : { room_code: door.room_code ?? "", server_url: door.server_url, refusal: door.join_refusal, refusing_friend_names: [friend.username] };
      const watch = door?.watch ? { room_code: door.watch.room_code ?? "", server_url: null, refusal: door.watch.refusal, refusing_friend_names: [friend.username] } : null;
      const reasons = [...new Set([join, watch].flatMap((each) => (each?.refusal ? [joinRefusalText(each)] : [])))];
      const doorButton = (name: "join" | "watch", each: NonNullable<typeof join>, path: string) => (each.refusal ? secondaryButton(action(name), { type: "button", isSmall: true, isDisabled: true }) : secondaryButton(action(name), { href: path, isSmall: true }));
      const actions = [join ? doorButton("join", join, joinPath(slug, join)) : null, watch ? doorButton("watch", watch, `${joinPath(slug, watch)}&watch=1`) : null].filter((each): each is ControlMarkup => each !== null);
      return { lead: pictureFrame(friend.username, "sm"), title: friend.username, detail: reasons.join(" · ") || friend.statusWords, href: profilePath(friend.username), isNewTab: true, isAway: friend.isAway, action: actions.length ? actions : undefined };
    })],
  });
}

/** A friend request, at the top of the same list: who's asking, their profile a press away, and Accept and Turn down on the row. Only the newest one's Accept is orange, so a few at once don't shout. */
export const friendRequestRow = (name: string, isNewest: boolean): ListRow => ({
  lead: pictureFrame(name, "sm"),
  title: name,
  detail: "Friend request",
  href: profilePath(name),
  isNewTab: true,
  action: [
    (isNewest ? primaryButton : secondaryButton)(action("addFriend", "Accept"), { type: "button", isSmall: true, isLabelHidden: true, dataAttributes: { "request-action": "accept" } }),
    secondaryButton(action("close", "Turn down"), { staysSecondaryBecause: "Turning a friend down is a real decision beside Accept, not a way out.", type: "button", isSmall: true, isLabelHidden: true, dataAttributes: { "request-action": "turn-down" } }),
  ],
});

/**
 * What the Zaisma overlay's Room and Friends hold, and a player's choices, its next step (then Report, reportStep, which brings its own script); Block
 * opens its confirm on top. The Z (playing.ts) opens the menu. A game played alone has no Room until the game says who's playing.
 */
export function playingPeople(options: { gameOrigin: string; slug: string; title: string; hasZaismaRooms: boolean; isPlayedAlone: boolean; canSignIn: boolean; signInPath: string; roomItems: LayoutItem[]; shownPlayers?: ListRow[]; shownFriends?: Raw }): { roomBody: LayoutMarkup; friendsBody: LayoutMarkup; playerStep: SheetStep; templates: Raw; parts: Raw } {
  const words = (markup: Raw): LayoutItem => ({ kind: "words", markup });
  const roomBody = stack({
    items: [
      // A long room's find field: it narrows the list to the names that hold what's typed.
      { kind: "control", id: "players-find", isHidden: true, markup: cutField({ id: "players-find-field", name: "player_name", label: "Find a player", type: "search", icon: "search", placeholder: "Find a player", autocomplete: "off" }) },
      // While nobody's listed, the note says why (the page's script writes it): the list's empty state.
      { kind: "block", markup: listRows({ whenEmpty: stateNote({ stateKind: "empty", text: "", textId: "players-note" }), isCompact: true, rows: options.shownPlayers ?? [], id: "players-list", label: "In this room" }) },
      words(html`<p id="players-watching" hidden></p>`),
      ...options.roomItems,
    ],
  });
  const friendsBody = stack({
    items: [
      // Friend requests waiting for the player, with Accept and Turn down (friend-requests.ts brings them).
      {
        kind: "block",
        id: "players-requests",
        isHidden: true,
        markup: listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, rows: [], id: "players-requests-list", label: "Friend requests" }),
      },
      {
        kind: "block",
        id: "players-friends",
        isHidden: true,
        markup: stack({ items: [
          { kind: "control", id: "players-friends-find", isHidden: true, markup: cutField({ id: "players-friends-find-field", name: "friend_name", label: "Find a friend", type: "search", icon: "search", placeholder: "Find a friend", autocomplete: "off" }) },
          { kind: "block", markup: html`<div id="players-friends-list">${options.shownFriends ?? ""}</div>` },
          words(html`<p id="players-friends-none" hidden>No friend goes by that name.</p>`),
        ] }),
      },
      words(html`<p id="players-friends-all" hidden>${textLink("Manage friends", "/friends", { isNewTab: true })}</p>`),
    ],
  });
  // One player's choices: a press further than their row, so a misclick does nothing.
  const playerBody = stack({
    items: [
      {
        kind: "block",
        markup: listRows({
          whenEmpty: NO_EMPTY_NOTE,
          isCompact: true,
          label: "Their choices",
          rows: [
            { title: "Profile", href: "/", id: "players-player-profile", lead: icon("person"), isHidden: true },
            // Only when they take friend requests from this player (friend-requests.ts asks), with no hint why otherwise.
            { title: action("addFriend").label, press: {}, id: "players-player-friend", lead: icon(action("addFriend").icon), isHidden: true },
            // Add friend, once it's sent: the row keeps its place, with nothing to press.
            { title: "Friend request sent", id: "players-player-sent", lead: icon(action("addFriend").icon), isAway: true, isHidden: true },
            { title: "Mute", press: {}, id: "players-player-mute", lead: icon("speaker") },
            { title: "Unblock", press: {}, id: "players-player-unblock", lead: icon("ban"), isHidden: true },
            { title: "Block", press: {}, id: "players-player-block", lead: icon("ban") },
            { title: "Report", press: {}, id: "players-player-report", lead: icon("flag") },
          ],
        }),
      },
      words(html`<p id="players-player-sign-in" hidden>${textLink("Sign in", options.signInPath)} to add friends.</p>`),
    ],
  });
  const rowButton = { type: "button", isSmall: true } as const;
  // One line for a player: a friend's mark after their name, muted or blocked in its quiet words, Mute at its end and the rest of their choices a press in.
  const rowTemplate = listRows({
    whenEmpty: stateNote({ stateKind: "empty", title: "Nobody here yet", text: "Players show here as they join your room." }),
    isCompact: true,
    rows: [{
      lead: pictureFrame("?", "sm"),
      title: "?",
      titleIcon: { icon: "friends", label: "Friend", isHidden: true },
      detail: "?",
      press: {},
      action: toggleButton(action("mute"), { type: "button", isSmall: true, isLabelHidden: true, isPressed: false, isQuietWhenOff: true, dataAttributes: { "player-mute": "" } }),
    }],
  });
  const templates = html`<template id="players-row">${rowTemplate}</template>
<template id="players-self-row">${listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, rows: [{ lead: pictureFrame("?", "sm"), title: "?", detail: "You" }] })}</template>
<template id="players-request-row">${listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, rows: [friendRequestRow("?", false)] })}</template>
<template id="players-newest-request-row">${listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, rows: [friendRequestRow("?", true)] })}</template>`;
  const parts = html`${templates}
${pageData("players-data", { gameOrigin: options.gameOrigin, slug: options.slug, hasZaismaRooms: options.hasZaismaRooms, isPlayedAlone: options.isPlayedAlone, canSignIn: options.canSignIn, maximumPlayerCount: MAXIMUM_PLAYER_COUNT, findShownAfterCount: FIND_SHOWN_AFTER_COUNT })}
${scriptTags(PLAYERS_SHEET_SCRIPT)}`;
  return { roomBody, friendsBody, playerStep: { stepName: "player", title: "Player", body: playerBody, isCompact: true }, templates, parts };
}

// The sheet's script: the game's SDK says who's in the room, and Mute, Block and Report go back through the game and Zaisma's sheets.
const PLAYERS_SHEET_SCRIPT = pageScript("players-sheet", String.raw`(() => {
  const sheet = document.getElementById("players");
  const opener = document.getElementById("zaisma-open");
  const data = document.getElementById("players-data");
  if (!sheet || !opener || !data) return;
  const { gameOrigin: GAME_ORIGIN, slug: SLUG, hasZaismaRooms: HAS_ZAISMA_ROOMS, isPlayedAlone: IS_PLAYED_ALONE, canSignIn: CAN_SIGN_IN, maximumPlayerCount: MAXIMUM_PLAYER_COUNT, findShownAfterCount: FIND_SHOWN_AFTER_COUNT } = JSON.parse(data.textContent);
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const $ = (id) => document.getElementById(id);
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, GAME_ORIGIN); };
  const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
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
  ${PAINT_PICTURE}
  // A button's words: the last span in its face (secondaryButton).
  const wordsOf = (button) => button.querySelector(".face > span:last-child");
  // Friend requests waiting for this player, and the ones they sent from here this session.
  let requests = [];
  const sentTo = new Set();
  addEventListener("zaisma:friend-requests-waiting", (e) => { requests = e.detail && Array.isArray(e.detail.requests) ? e.detail.requests : []; if (sheet.open) render(); });
  addEventListener("zaisma:friend-request-sent", (e) => {
    if (!e.detail) return;
    sentTo.add(e.detail.id);
    if (chosen && chosen.id === e.detail.id) { $("players-player-friend").closest("li").hidden = true; $("players-player-sent").closest("li").hidden = false; }
  });
  // Friends now (an accept either way): the row says Friend, and the menu has nothing to add.
  addEventListener("zaisma:friend-added", (e) => {
    if (!e.detail) return;
    sentTo.delete(e.detail.id);
    const known = accounts.get(e.detail.id);
    if (known && !known.isFriend) { known.isFriend = true; if (sheet.open) render(); }
    if (sheet.open) loadFriends();
  });
  function renderRequests() {
    // At the top of the friends list; with no friends yet, in a list of their own.
    const friends = $("players-friends-list");
    friends.querySelectorAll("[data-friend-request]").forEach((item) => item.remove());
    const friendsRows = friends.querySelector("ul");
    const own = $("players-requests-list");
    own.textContent = "";
    $("players-requests").hidden = !requests.length || Boolean(friendsRows);
    own.hidden = !requests.length || Boolean(friendsRows);
    const list = friendsRows || own, firstFriend = list.firstElementChild;
    [...requests].sort((one, other) => other.created_at_ms - one.created_at_ms).slice(0, 20).forEach((waiting, index) => {
      const item = $(index ? "players-request-row" : "players-newest-request-row").content.querySelector("li").cloneNode(true);
      paint(item.querySelector(".av"), waiting.name);
      item.querySelector(".list-row-title").textContent = waiting.name;
      item.querySelector("a.list-row").href = "/@" + encodeURIComponent(waiting.name);
      item.setAttribute("data-friend-request", "");
      item.querySelectorAll("[data-request-action]").forEach((button) => button.addEventListener("click", () => {
        dispatchEvent(new CustomEvent("zaisma:answer-friend-request", { detail: { id: waiting.player_id, verb: button.dataset.requestAction } }));
      }));
      list.insertBefore(item, firstFriend);
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
      // A game marked as played alone that says who's playing has a room after all, so mute, block and report are there for its players.
      const roomTab = sheet.querySelector('[data-sheet-tab-to="room"]');
      if (roomTab.hidden) {
        roomTab.hidden = false;
        const opening = sheet.querySelector("[data-sheet-tab-opening]");
        if (opening) opening.removeAttribute("data-sheet-tab-opening");
        roomTab.setAttribute("data-sheet-tab-opening", "");
        const tabs = roomTab.closest(".tab-switch"), current = tabs.querySelector('[aria-pressed="true"]');
        if (current && tabs.pickTab) tabs.pickTab(current);
      }
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
    const list = $("players-list");
    // Friends first, then everyone else in the order they joined.
    const everyone = room ? room.players.filter((each) => each.id !== room.myPlayerId) : [];
    const ordered = everyone.filter(isFriend).concat(everyone.filter((each) => !isFriend(each)));
    $("players-find").hidden = everyone.length <= FIND_SHOWN_AFTER_COUNT;
    if ($("players-find").hidden) find.value = "";
    const wanted = find.value.trim().toLowerCase();
    const others = wanted ? ordered.filter((each) => nameOf(each).toLowerCase().includes(wanted)) : ordered;
    // You're in the count, so you're in the list too, first, with nothing to press: never while finding someone, or while only watching.
    const me = room && !room.isSpectator && !wanted ? room.players.find((each) => each.id === room.myPlayerId) : null;
    list.hidden = !others.length && !me;
    const note = $("players-note");
    note.textContent = !room
      ? HAS_ZAISMA_ROOMS || hasSeenRoom ? "Players show here once you're in a room." : "Players show here once the game says who's playing with you. Until then, mute, block and report are in its own menu."
      : others.length ? "" : wanted ? "Nobody here goes by that name." : "Nobody else is here yet.";
    note.hidden = !note.textContent;
    const watching = $("players-watching");
    watching.textContent = room && room.spectatorCount ? (room.isSpectator ? "You're watching" + (room.spectatorCount > 1 ? ", with " + (room.spectatorCount - 1) + " more" : "") : room.spectatorCount + " watching") : room && room.isSpectator ? "You're watching" : "";
    watching.hidden = !watching.textContent;
    // Each player keeps their row while they're in the room, filled in again here, and a row moves only when its place changes: so a Mute
    // pressed a moment ago rises on to its end when the game says it's done, and isn't drawn again from the start.
    const rows = (me ? [selfRow(me)] : []).concat(others.map(row));
    rows.forEach((item, index) => { if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null); });
    while (list.children.length > rows.length) list.lastElementChild.remove();
    const inRoom = new Set(room ? room.players.map((each) => each.id) : []);
    rowsById.forEach((item, id) => { if (!inRoom.has(id)) rowsById.delete(id); });
  }

  // Your own row (template#players-self-row): your picture and the name the game knows you by, marked You.
  let selfItem = null;
  function selfRow(me) {
    selfItem = selfItem || $("players-self-row").content.querySelector("li").cloneNode(true);
    paint(selfItem.querySelector(".av"), me.name);
    selfItem.querySelector(".list-row-title").textContent = me.name;
    return selfItem;
  }

  // A player's row, from the page's own (template#players-row): their picture and name, Friend, muted or blocked under it. Pressing it opens their
  // choices. Made once per player and filled in again on every change.
  const rowsById = new Map();
  const isMutedNow = (id) => Boolean(room) && room.muted.has(id);
  const isBlockedNow = (id) => Boolean(room) && (room.blocked.has(id) || room.lasting.has(id));
  function showChoices() {
    if (!chosen) return;
    const blocked = isBlockedNow(chosen.id);
    const mute = $("players-player-mute");
    mute.closest("li").hidden = blocked;
    mute.querySelector(".list-row-title").textContent = isMutedNow(chosen.id) ? "Unmute" : "Mute";
    // A lasting block is undone on zaisma.com/friends, so Unblock doesn't show then.
    $("players-player-unblock").closest("li").hidden = !blocked || room.lasting.has(chosen.id);
    $("players-player-block").closest("li").hidden = blocked;
  }
  function row(other) {
    let item = rowsById.get(other.id);
    if (!item) {
      item = $("players-row").content.querySelector("li").cloneNode(true);
      rowsById.set(other.id, item);
      item.querySelector("[data-player-mute]").addEventListener("click", () => flipMute(other.id));
      // It moves the sheet to the player's step, filled in here first.
      item.querySelector("button").addEventListener("click", () => {
        const known = other.kind === "account" ? accounts.get(other.id) : null;
        const name = known ? known.name : other.name;
        chosen = { id: other.id, name };
        $("players-player-title").textContent = name;
        const profile = $("players-player-profile");
        // Each choice is a List row: its whole row shows or hides, hairline and all.
        profile.closest("li").hidden = !known;
        if (known) {
          profile.href = "/@" + encodeURIComponent(known.name);
          profile.target = "_blank";
          profile.rel = "noopener";
        }
        showChoices();
        showFriendChoice(other, known, isBlockedNow(other.id));
        zaismaLayers.step(sheet, "player");
      });
    }
    const known = other.kind === "account" ? accounts.get(other.id) : null;
    const name = known ? known.name : other.name;
    paint(item.querySelector(".av"), name);
    item.querySelector(".list-row-title").textContent = name;
    item.querySelector(".list-row-title-icon").hidden = !(known && known.isFriend);
    item.dataset.playerName = name;
    showMute(item, other.id);
    return item;
  }
  // What a row says of its player's mute: its words, and its button, on or off, gone once they're blocked.
  function showMute(item, id) {
    const isMuted = isMutedNow(id), isBlocked = isBlockedNow(id);
    const detail = item.querySelector(".list-row-detail");
    detail.textContent = isBlocked ? "Blocked" : isMuted ? "Muted" : "";
    detail.hidden = !detail.textContent;
    const button = item.querySelector("[data-player-mute]");
    button.closest(".list-row-side").hidden = isBlocked;
    button.setAttribute("aria-pressed", isMuted ? "true" : "false");
    button.setAttribute("aria-label", (isMuted ? "Unmute " : "Mute ") + item.dataset.playerName);
  }
  function flipMute(id) {
    if (!room) return;
    const isMuting = !room.muted.has(id);
    if (isMuting) room.muted.add(id); else room.muted.delete(id);
    const item = rowsById.get(id);
    if (item) showMute(item, id);
    showChoices();
    tell({ type: "zaisma:player-action", action: isMuting ? "mute" : "unmute", playerId: id });
  }
  // Mute turns on or off at once, as it's pressed, then the game does it.
  $("players-player-mute").addEventListener("click", () => {
    if (chosen) flipMute(chosen.id);
  });
  $("players-player-unblock").addEventListener("click", () => {
    if (chosen) tell({ type: "zaisma:player-action", action: "unmute", playerId: chosen.id });
    zaismaLayers.step(sheet, "players");
  });

  // Add friend, Friend request sent, or Sign in to add friends: asked of Zaisma as the player's sheet opens.
  function showFriendChoice(other, known, isBlocked) {
    const add = $("players-player-friend"), sent = $("players-player-sent"), signIn = $("players-player-sign-in");
    add.closest("li").hidden = true;
    sent.closest("li").hidden = true;
    signIn.hidden = !(other.kind === "account" && !isSignedIn() && CAN_SIGN_IN);
    if (!known || known.isFriend || isBlocked || !isSignedIn()) return;
    // Sent from here: say so at once, then ask Zaisma, which knows when it was accepted since.
    sent.closest("li").hidden = !sentTo.has(other.id);
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
        add.closest("li").hidden = !about.can_send;
        sent.closest("li").hidden = !about.has_sent;
      })
      .catch(() => {});
  }
  $("players-player-friend").addEventListener("click", () => {
    if (!chosen) return;
    // Its confirm opens on top, so closing it comes back to this player's choices.
    dispatchEvent(new CustomEvent("zaisma:ask-friend-request", { detail: { id: chosen.id } }));
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

  // Past the same count as a room's list, Find a friend shows, and narrows the list to the names that hold what's typed.
  const friendsFind = $("players-friends-find-field");
  function findFriend() {
    const rows = [...$("players-friends-list").querySelectorAll("li")];
    $("players-friends-find").hidden = rows.length <= FIND_SHOWN_AFTER_COUNT;
    if ($("players-friends-find").hidden) friendsFind.value = "";
    const wanted = friendsFind.value.trim().toLowerCase();
    rows.forEach((item) => { item.hidden = Boolean(wanted) && !item.querySelector(".list-row-title").textContent.toLowerCase().includes(wanted); });
    $("players-friends-none").hidden = !wanted || rows.some((item) => !item.hidden);
  }
  friendsFind.addEventListener("input", findFriend);
  // All your friends, nearest first: fresh each time the sheet opens.
  function loadFriends() {
    const signedIn = isSignedIn();
    // A guest has no friends to list, so no Friends tab: an account's only.
    const friendsTab = sheet.querySelector('[data-sheet-tab-to="friends"]');
    if (friendsTab.hidden === signedIn) {
      friendsTab.hidden = !signedIn;
      const tabs = friendsTab.closest(".tab-switch"), current = tabs.querySelector('[aria-pressed="true"]');
      if (current && tabs.pickTab) tabs.pickTab(current);
    }
    $("players-friends").hidden = !signedIn;
    $("players-friends-all").hidden = !signedIn;
    if (!signedIn) return;
    fetch("/g/" + SLUG + "/players/friends" + (room ? "?room=" + room.code : ""))
      .then((res) => (res.ok ? res.text() : ""))
      .then((fragment) => { $("players-friends-list").innerHTML = fragment; renderRequests(); findFriend(); })
      .catch(() => {});
  }

  // The Z opens it at its first place (zaismaLayers does too, by its aria-controls; this runs first and fills it in).
  opener.addEventListener("click", () => {
    ["report", "block", "friend-request"].forEach((id) => { const other = $(id); if (other && other.open) other.close(); });
    render();
    loadFriends();
    zaismaLayers.step(sheet, "players", { isBackShown: false });
    if (!sheet.open) sheet.showModal();
  });
  sheet.addEventListener("close", () => { chosen = null; const f = frame(); if (f) f.focus(); });
})();`);
