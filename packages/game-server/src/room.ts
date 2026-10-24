/**
 * The game server API and the room logic shared by Zaisma rooms (Durable Objects)
 * and the Node runner, so a game behaves the same in both places.
 *
 * Words: the *client* is the game in the player's browser. The *game server* is the
 * developer's code that holds the official game state. A *room* is one live match,
 * running one copy of the game server. Names follow docs/NAMING.md.
 */

import { DatabaseError, type GameDatabase } from "./database.ts";
import { isRoomCode, roomCode } from "./names.ts";
import type { PlayerKind } from "./pass.ts";
import type { Server } from "./requests.ts";
import { readSchedules, type Schedule, type ScheduledRun } from "./schedules.ts";
import { newStateTracker, type StateChange, type StateFrame, type StateTracker } from "./state-sync.ts";
import type { WebhookEvent } from "./webhooks.ts";

export interface Player {
  /** An account's player ID is the same in every game; a guest's lasts only for their pass. */
  id: string;
  /** The account's name, or a guest's generated one like "Swift Fox 42". */
  name: string;
  /** A signed-in Zaisma account, or a guest. */
  kind: PlayerKind;
  /**
   * The permanent items the account owns in this game, by item_name, from the pass it joined with (its
   * owned_item_names): check one with player.ownedItemNames?.includes("skin_red-dragon"). Absent for guests
   * and when the player owns nothing here. Only the game server sees it; other players' games never do.
   */
  ownedItemNames?: string[];
}

export interface Room {
  /**
   * This room's code, like K7Q2MX: the code players join it by. Use it to treat rooms differently, like
   * keeping only your one shared world (setKept in "WRLD22", canJoin refusing elsewhere). null only in a
   * room made before Zaisma rooms knew their codes.
   */
  readonly roomCode: string | null;
  /** Players in the room right now, in join order. */
  readonly players: readonly Player[];
  /**
   * Spectators watching the room (maximumSpectatorCount), in join order: they get what the room sends
   * everyone, send nothing and don't count as playing. Never in players.
   */
  readonly spectators: readonly Player[];
  /**
   * Send a message to every player and spectator (audience), or everyone but one (exceptPlayerId).
   * delivery "latest_only" lets a player whose connection is backed up skip it for a newer one (SendOptions).
   */
  broadcast(message: unknown, broadcastOptions?: BroadcastOptions): void;
  /** Send a message to one player or spectator. */
  send(playerId: string, message: unknown, sendOptions?: SendOptions): void;
  /**
   * Send bytes to every player, or everyone but one (exceptPlayerId), like a compact snapshot of the
   * world. fromPlayerId says whose they are when you pass one player's bytes on; each player's game gets
   * them as the "bytes" event, with that player's ID or null.
   */
  broadcastBytes(bytes: Uint8Array, broadcastOptions?: BytesBroadcastOptions): void;
  /** Send bytes to one player or spectator. */
  sendBytes(playerId: string, bytes: Uint8Array, sendOptions?: SendOptions): void;
  /** End the match: everyone is told why (message) and disconnected, and the room closes. */
  end(message?: string): void;
  /**
   * When Zaisma will end this match, an ISO time, or null. Set once the game's hosting on Zaisma rooms
   * pauses for the month (its free allowance, or its developer's budget or credit, is used), an hour after
   * the pause, so your game can save and tell its players (onEnding runs then); never set on your own server.
   */
  readonly endsAt: string | null;
  /** Shown in room lists (the game page and Zaisma.rooms.list). A hidden room still works by code and link. */
  readonly isListed: boolean;
  setListed(isListed: boolean): void;
  /** Taking new players. A closed room lets back only players who were already in it. */
  readonly isOpen: boolean;
  setOpen(isOpen: boolean): void;
  /**
   * Whether Zaisma's Join offers this room: a player's friends on zaisma.com, and Zaisma.friends. Off
   * shows their Join grayed as "Private room". It isn't a lock: a code or link still reaches the room,
   * so close it (setOpen) or answer false from canJoin to keep players out.
   */
  readonly friendJoinsEnabled: boolean;
  setFriendJoinsEnabled(isEnabled: boolean): void;
  /**
   * A kept room doesn't end when everyone leaves: it sleeps with its state saved and wakes when someone
   * joins, for worlds that last. Its saved state counts against the game's storage. room.end() ends it
   * for good. setKept(false) makes it an ordinary room again, whose state goes a day after it empties.
   */
  readonly isKept: boolean;
  setKept(isKept: boolean): void;
  /** The room's name, like "Ana's castle", or null. Up to 40 characters. */
  readonly name: string | null;
  /** Up to 4 labels players can filter by, like { Mode: "Classic", Map: "Docks" }. */
  readonly labels: Readonly<Record<string, string>>;
  /**
   * Name and label the room, from the game or from what a player typed. Names and labels a player
   * typed show on zaisma.com only if they pass Zaisma's text filter; your game is responsible for
   * them inside the game. Leave a field out to keep it; null clears it.
   */
  setInfo(nameAndLabels: RoomInfo): void;
  /**
   * Make a new room for some of this room's players, like a lobby starting a match, and move them
   * there. The new room runs this same game server: its setup(setupData) gets your setupData, only
   * the players named can join it (a closed room, until it opens), and it's hidden from room lists
   * unless you list it. Each player gets a "move" event in the game and joins when the game says so.
   * Returns the new room's code. setupData is plain JSON, up to 4 KB; players can read it but not change it.
   */
  reserve(reserveOptions: ReserveOptions): string;
  /**
   * Remove a player from the room, telling them why (message, up to 200 characters; your game's
   * words, so keep them within the content rules). keepOut keeps them out of this room for the rest
   * of the match, and out of any room it reserves after. onLeave runs once the current handler is done.
   */
  kick(playerId: string, kickOptions?: KickOptions): void;
  /**
   * Send some of this room's players to another room of this game that already exists, like back to
   * their party's match or into the next area of an open world. The other room's canJoin decides with
   * your joinData (plain JSON, up to 4 KB) and holds a seat for each player it takes for a minute,
   * even if it's closed to new players; its onJoin gets the same joinData. Each player taken gets a
   * "move" event in the game, which follows by default. onMoved then says who was taken and who was
   * turned away; they stay here.
   */
  moveTo(roomCode: string, moveOptions: MoveOptions): void;
  /**
   * The game's own SQLite database, shared by all its rooms and kept between matches: for what the
   * game server owns or must trust, like inventories, leaderboards and bans. Plain SQL, awaited in
   * any handler (which then runs as async). In Zaisma rooms it's part of the game's hosting; on your
   * own server the Node runner keeps it in a local file (--database), so the same code runs in both.
   */
  readonly database: GameDatabase;
  /**
   * The game's secrets, by name, like room.secrets.STRIPE_SECRET_KEY: set per game on Zaisma
   * (set_secret) and never shown again, or the environment variables on your own server. Calls to
   * other servers are plain fetch(); on Zaisma they reach the hosts the game lists in
   * game_server_allowed_hosts, and anything else throws an OutsideCallError.
   */
  readonly secrets: Readonly<Record<string, string>>;
  /**
   * Whether two players in the room have a block between them, either way (never which one made it):
   * from their Zaisma accounts, or a block a player just made in the game. A block is a wall both ways,
   * so don't deliver chat, voice or emotes from one to the other, and keep them apart in your own
   * matchmaking when you can, but never keep either one out: who plays is your call. Each player's game
   * hides the other's emotes and phrases by itself (room.isMuted).
   */
  hasBlockBetween(firstPlayerId: string, secondPlayerId: string): boolean;
  /**
   * Whether two players in the room are Zaisma friends: both accounts, as their friendship was when the
   * later of them joined. Use it for friends-only chat, teams or a "friend" mark; guests are never
   * anyone's friend. It never says who else a player's friends are.
   */
  areFriends(firstPlayerId: string, secondPlayerId: string): boolean;
  /**
   * A player's round trip to the room in milliseconds, smoothed, or null for a player who isn't in the
   * room or hasn't been measured yet (the room probes each player right after they join). The player's
   * game reads the same number as room.pingDurationMs. The room measures it itself, so a player can only
   * make theirs look worse by answering late, never better: cap any lag compensation that uses it.
   */
  pingDurationMs(playerId: string): number | null;
  /**
   * The room's clock now, in epoch milliseconds, like Date.now(). Players' games estimate the same
   * clock with room.serverTimeMs(), so a time the game server sends, like when a race starts, means
   * the same moment for everyone.
   */
  serverTimeMs(): number;
  /**
   * Why a player in the room isn't playing, or null while they play: "idle" or "hidden" (your onAway
   * kept them), or "lost" (their connection dropped and they have reconnectTimeoutSec to come back).
   * Every player's game sees the same in its player list (awayReason).
   */
  awayReason(playerId: string): AwayReason | null;
  /**
   * Switch to the new version now, with onVersionUpdate: at a good moment, like the end of a round. The
   * room saves, every player's game reconnects (reloading at the new version when its files changed) and
   * the new version's onRestored carries on from the state. Does nothing when no update is coming, and on
   * your own server.
   */
  applyVersionUpdate(): void;
}

/** Who a broadcast reaches: players and spectators (everyone), only the players, or only the spectators. */
export type Audience = "everyone" | "players" | "spectators";

/**
 * How a message goes: "reliable" (the default) reaches every player in order. "latest_only" may be
 * dropped: a player whose connection is backed up skips older ones and gets the newest once they catch
 * up, like positions sent every tick. In Zaisma rooms it rides the WebSocket today, and moves to real
 * datagrams the day Cloudflare carries them, with no change to your game.
 */
export type Delivery = "reliable" | "latest_only";

export interface SendOptions {
  delivery?: Delivery;
  /**
   * For "latest_only": which messages replace each other while a player is backed up, up to 40
   * characters, like "positions". Defaults to the message's type field when it's a string, else "".
   */
  latestKey?: string;
}

export interface BroadcastOptions extends SendOptions {
  /** A player who doesn't get it, like the one whose move this is. */
  exceptPlayerId?: string;
  /** Who gets it: "everyone" (the default: players and spectators), "players" or "spectators". */
  audience?: Audience;
}

export interface BytesBroadcastOptions extends BroadcastOptions {
  /** The player the bytes came from, when you pass one player's bytes on; left out, they're from the game server. */
  fromPlayerId?: string;
}

export interface MoveOptions {
  playerIds: string[];
  joinData?: unknown;
}

/** A player another room turned away (room.moveTo), with why: an error code and its message. */
export interface Refusal {
  player: Player;
  code: RoomErrorCode;
  message: string;
}

/** Who another room took (room.moveTo) and who it turned away. */
export interface MoveResult {
  roomCode: string;
  movedPlayers: Player[];
  refusals: Refusal[];
}

/**
 * How a player came in: fromRoomCode, the code of the room that sent them (room.moveTo), or null.
 * isReturning: they're coming back to the seat the room held for them, after walking away or losing their connection.
 * isSpectator: they come to watch (joinRoom({ isSpectator: true })), not to play.
 */
export interface JoinInfo {
  fromRoomCode: string | null;
  isReturning: boolean;
  isSpectator: boolean;
}

/**
 * Why a player isn't playing: no input (idle), the game hidden in a real-time room, or lost: their
 * connection dropped, and the room keeps them for reconnectTimeoutSec.
 */
export type AwayReason = "idle" | "hidden" | "lost";

/** A player as players' games see them: who they are, never what they own (that's the game server's, from the pass). */
export type ShownPlayer = Omit<Player, "ownedItemNames">;

function shownPlayer(player: Player): ShownPlayer {
  return { id: player.id, name: player.name, kind: player.kind };
}

/** A player as the room lists them to every player's game: awayReason says why they aren't playing, or null while they play. */
export interface ListedPlayer extends ShownPlayer {
  awayReason: AwayReason | null;
}

/**
 * Why a player left: left (closed the game or left the room), lost (their connection dropped and they
 * weren't back within reconnectTimeoutSec, and the room holds their seat), idle or hidden (they walked
 * away, and the room holds their seat), kicked.
 */
export type LeaveReason = "left" | AwayReason | "kicked";

export interface LeaveInfo {
  reason: LeaveReason;
}

/** What one room asks another when moving players there; fromRoomCode is the asking room's, added by the transport. */
export interface MoveAsk {
  fromRoomCode: string;
  players: Player[];
  joinData: unknown;
}

/** The other room's answer to a MoveAsk: who it took, and who it turned away and why. */
export interface MoveAnswer {
  movedPlayerIds: string[];
  refusals: { playerId: string; code: RoomErrorCode; message: string }[];
}

export interface KickOptions {
  message?: string;
  keepOut?: boolean;
}

/** A room made for some players: who, the data its game server starts with, and how it shows. */
export interface ReserveOptions extends RoomInfo {
  playerIds: string[];
  setupData?: unknown;
  isListed?: boolean;
  /** false: friends can't Join the new room from Zaisma ("Private room"). */
  friendJoinsEnabled?: boolean;
  /** true: the new room is kept (room.setKept). */
  isKept?: boolean;
}

/** How a reserved room starts, as the room that made it sends it on. */
export interface RoomStart extends Pick<RoomSettings, "isListed" | "name" | "labels">, Partial<Pick<RoomSettings, "friendJoinsEnabled">> {
  playerIds: string[];
  setupData: unknown;
  /** Players kept out of the room that made this one, and why: they stay out of this one too. */
  keptOut?: Record<string, string>;
  /** The code of the room that made this one, where awayMode "lobby" sends players. Added by the transport. */
  lobbyRoomCode?: string;
  /** Kept (room.setKept) from the start. */
  isKept?: boolean;
}

/** A room's name and labels, as a game sets them. */
export interface RoomInfo {
  name?: string | null;
  labels?: Record<string, string | number> | null;
}

/** Who checks for players who give no input: the room (server), each player's game (client), or nobody (off). */
export type IdleCheck = "server" | "client" | "off";

/** What happens to a player who walks away: their seat is held (hold), or they're sent to the room that made this one (lobby). */
export type AwayMode = "hold" | "lobby";

/** A handler answers the new state, or nothing to keep it; an async handler (one that awaits room.database) answers it later. */
type HandlerResult<S> = void | S | Promise<void | S>;

export interface GameServer<S = any> {
  /** Up to 100. Defaults to 8. */
  maximumPlayerCount?: number;
  /**
   * Spectators a room takes, up to 100: they watch a match without playing (joinRoom({ isSpectator: true })),
   * get what the room sends everyone, send nothing, don't count as playing or toward maximumPlayerCount,
   * and are free (off the player-hour meter). Leave it out, or 0, and nobody can watch.
   */
  maximumSpectatorCount?: number;
  /** Ticks a second, up to 60. Leave out for turn-based games so the room can sleep between moves. */
  ticksPerSec?: number;
  /**
   * The room's first player is its host: they may hide, show, open, close and name the room, and
   * kick players, from the game. When the host leaves, the next player takes over. The relay has this on.
   */
  hostControlsEnabled?: boolean;
  /**
   * Who checks for players who give no input. "server" (the default): after idleTimeoutSec, the
   * player's game asks "Still there?", and 30 seconds later they walk away. "client": each player's
   * game decides (joinRoom({ idleTimeoutSec, idleCheckEnabled })), as the relay does. "off": nobody.
   */
  idleCheck?: IdleCheck;
  /** Seconds without input before "Still there?", 30 to 86400. Defaults to 600 (10 minutes). */
  idleTimeoutSec?: number;
  /**
   * What happens when a player walks away (idle, or the game hidden for 2 minutes in a real-time
   * room). "hold" (the default) takes them out of the match (onLeave) and holds their seat for
   * seatHoldDurationSec, so they come straight back to it. "lobby" sends them to the room that made
   * this one (room.reserve), holding their seat if there isn't one or it won't take them. Give onAway
   * to handle it yourself instead.
   */
  awayMode?: AwayMode;
  /**
   * How long the room holds a seat for a player who walked away or lost their connection, in
   * seconds: up to 1800, 0 for none. Defaults to 300. Held seats count toward maximumPlayerCount.
   */
  seatHoldDurationSec?: number;
  /**
   * How long a player whose connection dropped stays in the match as away (reason "lost") before they
   * leave it, in seconds: 0 to 300, 0 to take them out at once. Defaults to 30. Your onAway and onBack
   * run, so you can freeze their character; held seats come after (seatHoldDurationSec).
   */
  reconnectTimeoutSec?: number;
  /**
   * Send each player the state, then only what changes: a full copy when they join (and after their
   * connection was backed up), then the changes after each tick, or after each handler in a turn-based
   * game. Their game reads it as room.state, or room.smoothedState() to move evenly between updates.
   * Off by default. The state goes as JSON, so keep it plain; cut what each player sees with stateView.
   */
  stateSyncEnabled?: boolean;
  /**
   * How often a real-time room saves its state, in seconds: 1 to 60, default 5. A restarted room comes
   * back with the last saved state (onRestored). Turn-based rooms save after every change and ignore it.
   */
  stateSaveIntervalSec?: number;
  /**
   * The starting state. It must be plain JSON so a sleeping room can be saved and woken. setupData
   * is what room.reserve() passed when another room made this one, and null otherwise. Rooms need it;
   * a game server that only answers requests (onRequest) or runs on schedules can leave it out.
   */
  setup?(setupData: unknown): S;
  /**
   * A request from the player's game outside any room (Zaisma.server.request(request)), like a
   * leaderboard, a shop or a daily reward in a single-player game. Answer what the game gets back:
   * plain JSON, up to 1 MB, within 10 seconds. request is plain JSON from the player's browser, up
   * to 16 KB, so check it like any message; player is who sent it, from their player pass. There's no
   * room and no state: keep what lasts in server.database; server.secrets has the game's secrets. If it throws, the game gets
   * error.code "game_server_error" and you see the error with the game server's others.
   */
  onRequest?(player: Player, request: unknown, server: Server): unknown;
  /**
   * When the game server runs by itself, outside rooms and requests: daily resets, a weekly
   * leaderboard, a persistent world's turns. Up to 10, each a name and a cron in UTC (minute hour
   * day-of-month month day-of-week), so at most once a minute: [{ name: "daily-reset", cron: "0 0 * * *" }].
   */
  schedules?: Schedule[];
  /**
   * A schedule is due: run.name says which, run.scheduledAt the minute it was due (an ISO time, UTC).
   * There's no room, no player and no state: keep what lasts in server.database; server.secrets has the game's secrets. It has 30 seconds.
   * A run can rarely come twice or a little late (after a restart), so make it safe to repeat, like
   * a reset that checks run.scheduledAt against the last one it did. If it throws, you see the
   * error with the game server's others.
   */
  onSchedule?(run: ScheduledRun, server: Server): unknown;
  /**
   * An event from one of the developer's webhooks: a webhook whose destination is this game's game
   * server (create_webhook with destination_kind "game_server"), or, on your own server, one whose
   * endpoint_url is this server's /v1/webhooks. event is what any webhook is sent: event.kind, and
   * event.game, event.version and event.bug_report as the developer API answers them
   * (event.account_deletion for account_deleted: Zaisma erases the player's rows itself unless the game
   * turned that off). Turn it into a
   * Discord post or a GitHub issue with fetch() and the tokens in server.secrets. There's no room, no
   * player and no state. Finishing without an error counts as delivered; throwing (or taking over 10
   * seconds) tries it again later, up to 6 times, so make it safe to repeat: event.id is the same on
   * every try. Each event counts as one of the game's requests.
   */
  onWebhook?(event: WebhookEvent, server: Server): unknown;
  /**
   * joinData is what the player's game passed to joinRoom({ joinData }), like the character they
   * picked, or null. It comes from the player's browser, so check it like any message. For a player
   * another room sent (room.moveTo), joinData is what that room's game server passed, and
   * joinInfo.fromRoomCode is its code.
   */
  onJoin?(state: S, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo): HandlerResult<S>;
  /**
   * Say who may come in, before they join: answer true (or nothing) to let them in, false to turn them
   * away, or { refusalMessage } to turn them away with a message they see (up to 200 characters), like
   * a wrong room password in joinData or a full team. Anything else is a mistake and turns them away
   * too, logged as a game server error. Players coming back after a dropped connection don't ask
   * again. Only decide here; change the state in onJoin. If it throws, the player is turned away.
   * Players another room sends are asked when it sends them, with its joinData and
   * joinInfo.fromRoomCode, and not again when they arrive.
   */
  canJoin?(state: S, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo): JoinAnswer | Promise<JoinAnswer>;
  /** After room.moveTo: who the other room took, and who it turned away and why. */
  onMoved?(state: S, moveResult: MoveResult, room: Room): HandlerResult<S>;
  /**
   * leaveInfo.reason says why they left; a player who lost their connection or walked away gets their
   * seat held. A dropped connection ("lost") first comes to onAway, and only here if they aren't back
   * within reconnectTimeoutSec.
   */
  onLeave?(state: S, player: Player, room: Room, leaveInfo: LeaveInfo): HandlerResult<S>;
  /** A spectator came to watch: send them what they need to follow the match, like the whole state once. */
  onSpectatorJoin?(state: S, spectator: Player, room: Room): HandlerResult<S>;
  /** A spectator stopped watching (left, lost their connection or was kicked). No seat is held. */
  onSpectatorLeave?(state: S, spectator: Player, room: Room): HandlerResult<S>;
  /**
   * A player walked away (idle, hidden) or their connection dropped (lost). For idle and hidden, with
   * onAway they stay in the room and your game decides what happens: kick them, move them
   * (room.moveTo) or keep them. For lost, every game hears it, and the room decides when time's up:
   * they stay for reconnectTimeoutSec, then leave (onLeave, reason "lost"); freeze their character
   * meanwhile. They don't count as playing while away, and a room where everyone is away stops
   * ticking. onBack runs when they return: send them what they missed.
   */
  onAway?(state: S, player: Player, room: Room, reason: AwayReason): HandlerResult<S>;
  onBack?(state: S, player: Player, room: Room): HandlerResult<S>;
  onMessage?(state: S, player: Player, message: unknown, room: Room): HandlerResult<S>;
  /**
   * Bytes a player's game sent (room.sendBytes), like a compact input, under the same limits as
   * messages: up to 16 KB each, 30 a second. Read them with a DataView; they're a copy, yours to keep.
   */
  onBytes?(state: S, player: Player, bytes: Uint8Array, room: Room): HandlerResult<S>;
  /** tickDurationSec: seconds since the last tick, about 1 / ticksPerSec (more when a tick was skipped). */
  onTick?(state: S, tickDurationSec: number, room: Room): HandlerResult<S>;
  /**
   * Zaisma will end this match at room.endsAt, because the game's hosting paused for the month: save
   * what should outlive it and tell your players. Runs once; each player's game also gets
   * the "ending" event. Never runs on your own server.
   */
  onEnding?(state: S, room: Room): HandlerResult<S>;
  /**
   * The room restarted (Zaisma restarts its rooms on every update, and your own server may restart) and
   * came back with the state it last saved: restoreInfo.savedAt says when, and restoreInfo.lostDurationSec
   * how many seconds of play since then are lost, so you can resync clocks or tell your players. Runs
   * once, instead of setup. The players who were in the match come back as away (reason "lost"): onAway
   * runs for each after this, and onBack as each reconnects, or onLeave if they aren't back within
   * reconnectTimeoutSec.
   */
  onRestored?(state: S, restoreInfo: RestoreInfo, room: Room): HandlerResult<S>;
  /**
   * With stateSyncEnabled: what this player sees of the state, like only what's near them in a big
   * world, or without the other team's hidden cards. Leave it out and everyone sees all of it. Answer
   * plain JSON, a new object or parts of the state; don't change the state here. Keep it cheap: it runs
   * for every player on every tick. viewer is the player it's for.
   */
  stateView?(state: S, viewer: Player, room: Room): unknown;
  /**
   * The developer published a version with match_update_mode "now", and this match moves to it. With
   * this handler the room waits for you: call room.applyVersionUpdate() at a good moment, like the end of
   * a round, or it switches at versionUpdate.forcedAt, 5 minutes on. Without it, it switches 10 seconds
   * after the notice. Each player's game hears it too (the room's "versionUpdate" event), to show a
   * countdown or save. Never runs on your own server.
   */
  onVersionUpdate?(state: S, versionUpdate: VersionUpdate, room: Room): HandlerResult<S>;
}

/** What onVersionUpdate hears: the version the match moves to, and when it switches at the latest (an ISO time). */
export interface VersionUpdate {
  versionId: string;
  forcedAt: string;
}

/**
 * What onRestored hears: when the state it came back with was saved (an ISO time), how many seconds of
 * play since then are lost, and the version of the game that saved it (null on your own server), which
 * differs from the one running after an update, so the game can bring an older state up to date.
 */
export interface RestoreInfo {
  savedAt: string;
  lostDurationSec: number;
  savedVersionId: string | null;
}

/**
 * A restored room's restoreInfo, from when its state was saved and the version that saved it. A state
 * saved as the room emptied (isSavedEmpty) lost nothing, however long ago: a kept world waking after a week
 * reads savedAt for the time that passed.
 */
export function restoreInfoOf(savedAtMs: number, nowMs = Date.now(), savedVersionId: string | null = null, isSavedEmpty = false): RestoreInfo {
  return { savedAt: new Date(savedAtMs).toISOString(), lostDurationSec: isSavedEmpty ? 0 : Math.max(0, Math.round((nowMs - savedAtMs) / 1000)), savedVersionId };
}

/**
 * What canJoin answers: true, or nothing (undefined or null), lets the player in; false turns them
 * away; { refusalMessage } turns them away with that message.
 */
export type JoinAnswer = boolean | { refusalMessage: string } | null | void;

function describeObject(given: object): string {
  try {
    return (JSON.stringify(given) ?? "an object").slice(0, 80);
  } catch {
    return "an object";
  }
}

/**
 * canJoin's answer as the room acts on it: let in, or turn away with a refusalMessage (null for the
 * usual one). Any other answer, like a string, is a mistake, described for the game server's errors.
 */
export function readJoinAnswer(answer: unknown): { isAllowed: true } | { isAllowed: false; refusalMessage: string | null } | { mistake: string } {
  if (answer === true || answer === undefined || answer === null) return { isAllowed: true };
  if (answer === false) return { isAllowed: false, refusalMessage: null };
  const refusalMessage = typeof answer === "object" && !Array.isArray(answer) ? (answer as { refusalMessage?: unknown }).refusalMessage : undefined;
  if (typeof refusalMessage === "string" && Object.keys(answer as object).length === 1) return { isAllowed: false, refusalMessage };
  const given = typeof answer === "string" ? `the text ${JSON.stringify(answer.slice(0, 60))}` : typeof answer === "object" ? describeObject(answer) : String(answer);
  return { mistake: `canJoin answered ${given}, so the player was turned away. Answer true (or nothing) to let them in, false to turn them away, or { refusalMessage: "Wrong room password." } to turn them away with a message.` };
}

/** Everything a game server object may have, in the order the docs give them. Anything else is refused. */
export const GAME_SERVER_OPTIONS = [
  "maximumPlayerCount",
  "maximumSpectatorCount",
  "ticksPerSec",
  "hostControlsEnabled",
  "idleCheck",
  "idleTimeoutSec",
  "awayMode",
  "seatHoldDurationSec",
  "stateSyncEnabled",
  "reconnectTimeoutSec",
  "stateSaveIntervalSec",
  "setup",
  "onJoin",
  "canJoin",
  "onMoved",
  "onLeave",
  "onSpectatorJoin",
  "onSpectatorLeave",
  "onAway",
  "onBack",
  "onMessage",
  "onBytes",
  "onTick",
  "onEnding",
  "onRestored",
  "stateView",
  "onVersionUpdate",
  "onRequest",
  "schedules",
  "onSchedule",
  "onWebhook",
] as const satisfies readonly (keyof GameServer)[];

export const ROOM_LIMITS = {
  /** Players in one room: what one room carries at 60 ticks a second (test/load/room-load.test.ts). */
  maximumPlayerCount: 100,
  defaultMaximumPlayerCount: 8,
  /** Spectators in one room: each send costs the room time, so its audience is bounded like its players. Bigger audiences are a stream. */
  maximumSpectatorCount: 100,
  maximumTicksPerSec: 60,
  /** A room's name, its labels, and each label's name and value. */
  maximumNameCharacterCount: 40,
  maximumLabelCount: 4,
  maximumLabelNameCharacterCount: 16,
  maximumLabelValueCharacterCount: 24,
  /** Join data a player brings to a room, and setup data a reserved room starts with, as JSON. */
  maximumRoomDataSizeBytes: 4 * 1024,
  /** Rooms one room may reserve or move players to a minute: enough for a full lobby, not for a bug that does it every tick. */
  maximumReservesPerMin: 20,
  /** A kick's or a refusal's message. */
  maximumMessageCharacterCount: 200,
  /** Largest game message (or bytes) a client may send. */
  maximumGameMessageSizeBytes: 16 * 1024,
  /**
   * Sustained game messages (and bytes) per second per player, with a short burst allowance. A game at
   * 60 ticks sends two inputs in one message: incoming messages are what a room is billed for.
   */
  gameMessagesPerSec: 30,
  gameMessageBurstCount: 60,
  /** The idle check's default and range (idleTimeoutSec, joinRoom({ idleTimeoutSec })). */
  defaultIdleTimeoutSec: 600,
  minimumIdleTimeoutSec: 30,
  maximumIdleTimeoutSec: 24 * 3600,
  /** How long a game hidden in a real-time room counts before its player is away. */
  hiddenTimeoutSec: 120,
  /** How long a seat is held by default, and at most (seatHoldDurationSec). */
  defaultSeatHoldDurationSec: 300,
  maximumSeatHoldDurationSec: 1800,
  /** How long a player whose connection dropped stays in the match by default, and at most (reconnectTimeoutSec). */
  defaultReconnectTimeoutSec: 30,
  maximumReconnectTimeoutSec: 300,
  /** How often a real-time room saves its state by default, and the range (stateSaveIntervalSec). */
  defaultStateSaveIntervalSec: 5,
  minimumStateSaveIntervalSec: 1,
  maximumStateSaveIntervalSec: 60,
  /** A match moving to a version published "now": its notice without onVersionUpdate, and the longest onVersionUpdate can hold it. */
  versionUpdateNoticeSec: 10,
  maximumVersionUpdateHoldSec: 300,
  /** A real-time room's state bigger than this as JSON isn't saved, and a restart starts it fresh. */
  maximumSavedStateSizeBytes: 32 * 1024 * 1024,
  /** How often a ticking room probes each player, for their ping and the room's clock. */
  probeIntervalSec: 2,
  /** A probe left unanswered this long drops the player: their connection stopped or fell too far behind. */
  probeAnswerTimeoutSec: 8,
  /** A player is also probed each time this much has gone out to them since their last probe. */
  sentBytesPerProbe: 256 * 1024,
  /** Bytes sent to a player since the last probe they answered; past it, they're dropped. */
  maximumUnansweredSentBytes: 2 * 1024 * 1024,
  /** Unanswered probes the room remembers per player; the oldest is forgotten past it. */
  maximumUnansweredProbeCount: 16,
  /** A player's view of the state as JSON (stateSyncEnabled): bigger views aren't sent, and the game's errors say so once. */
  maximumStateViewSizeBytes: 1024 * 1024,
  /**
   * A player is backed up with this much sent and not yet through: on your own server, the socket's
   * bufferedAmount; in Zaisma rooms, sent since the last probe they answered, while a probe of theirs is
   * backedUpDelayMs later than their ping. State sync skips them, and latest-only messages wait for them in slots.
   */
  backedUpSizeBytes: 64 * 1024,
  backedUpDelayMs: 250,
  /** A latest-only message's latestKey. */
  maximumLatestKeyCharacterCount: 40,
  /** Latest-only messages waiting for a backed-up player, one per latestKey; past it, the oldest is dropped. */
  maximumLatestOnlySlotCount: 64,
} as const;

/** "Still there?" waits this long for an answer, and the room this much more before it decides for itself. */
const IDLE_ASK_MS = 30_000;
const IDLE_GRACE_MS = 60_000;

/**
 * A game server object that breaks the rules, with a code, the option at fault and what to do
 * (like the developer API's errors, docs/NAMING.md).
 */
export class GameServerError extends Error {
  readonly code: "unknown_option" | "bad_option";
  readonly field: string;
  readonly fix: string;
  constructor(code: "unknown_option" | "bad_option", field: string, message: string, fix: string) {
    super(`${message} ${fix} (${code})`);
    this.code = code;
    this.field = field;
    this.fix = fix;
  }
}

/** The error for an option a game server doesn't take, naming the ones it does. */
export function unknownOptionError(field: string): GameServerError {
  return new GameServerError("unknown_option", field, `${field} isn't a game server option.`, `A game server takes: ${GAME_SERVER_OPTIONS.join(", ")}.`);
}

/** The error for a room whose game server has no setup(): it only answers requests, runs on schedules or takes webhooks. */
export function noSetupError(): GameServerError {
  return new GameServerError("bad_option", "setup", "This game server has no setup(), so it can't run rooms; it only answers requests, runs on schedules or takes webhooks.", "Add setup: (setupData) => ({ ...your starting state }) to run rooms too.");
}

/** A game server's schedules, checked (readSchedules), or GameServerError for the field schedules. */
export function checkSchedules(schedules: unknown, hasOnSchedule: boolean): Schedule[] {
  const read = readSchedules(schedules, hasOnSchedule);
  if ("message" in read) throw new GameServerError("bad_option", "schedules", read.message, read.fix);
  return read.schedules;
}

/** Check a game server's options once, when it's defined: unknown options and values out of range throw. */
export function defineGameServer<S>(server: GameServer<S>): GameServer<S> {
  for (const field of Object.keys(server ?? {})) if (!(GAME_SERVER_OPTIONS as readonly string[]).includes(field)) throw unknownOptionError(field);
  const bad = (field: string, message: string, fix: string) => new GameServerError("bad_option", field, message, fix);
  if (typeof server?.setup !== "function" && typeof server?.onRequest !== "function" && typeof server?.onSchedule !== "function" && typeof server?.onWebhook !== "function") {
    throw bad(
      "setup",
      "A game server needs setup() to run rooms, onRequest() to answer requests, onSchedule() to run on schedules or onWebhook() to take webhooks, or more than one.",
      "Add setup: (setupData) => ({ ...your starting state }) for rooms, onRequest(player, request, server) for requests, schedules with onSchedule(run, server), or onWebhook(event, server) for webhooks.",
    );
  }
  for (const field of GAME_SERVER_OPTIONS) {
    if (field.startsWith("on") || field === "canJoin" || field === "setup" || field === "stateView") {
      if (server[field] !== undefined && typeof server[field] !== "function") throw bad(field, `${field} isn't a function.`, `Give ${field} as a function, or leave it out.`);
    }
  }
  checkSchedules(server.schedules, typeof server.onSchedule === "function");
  const { maximumPlayerCount, maximumSpectatorCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, reconnectTimeoutSec, stateSaveIntervalSec } = server;
  if (maximumPlayerCount !== undefined && !(Number.isInteger(maximumPlayerCount) && maximumPlayerCount >= 1 && maximumPlayerCount <= ROOM_LIMITS.maximumPlayerCount)) {
    throw bad("maximumPlayerCount", `maximumPlayerCount is ${JSON.stringify(maximumPlayerCount)}.`, `Give a whole number from 1 to ${ROOM_LIMITS.maximumPlayerCount}, like 8.`);
  }
  if (maximumSpectatorCount !== undefined && !(Number.isInteger(maximumSpectatorCount) && maximumSpectatorCount >= 0 && maximumSpectatorCount <= ROOM_LIMITS.maximumSpectatorCount)) {
    throw bad("maximumSpectatorCount", `maximumSpectatorCount is ${JSON.stringify(maximumSpectatorCount)}.`, `Give a whole number from 0 to ${ROOM_LIMITS.maximumSpectatorCount}, like 20, or leave it out so nobody watches.`);
  }
  if (ticksPerSec !== undefined && !(typeof ticksPerSec === "number" && ticksPerSec > 0 && ticksPerSec <= ROOM_LIMITS.maximumTicksPerSec)) {
    throw bad("ticksPerSec", `ticksPerSec is ${JSON.stringify(ticksPerSec)}.`, `Give a number above 0 and up to ${ROOM_LIMITS.maximumTicksPerSec}, like 30, or leave it out for a turn-based game.`);
  }
  if (hostControlsEnabled !== undefined && typeof hostControlsEnabled !== "boolean") throw bad("hostControlsEnabled", "hostControlsEnabled isn't true or false.", "Give true or false.");
  if (server.stateSyncEnabled !== undefined && typeof server.stateSyncEnabled !== "boolean") throw bad("stateSyncEnabled", "stateSyncEnabled isn't true or false.", "Give true to send each player the state and then only what changes, or leave it out.");
  if (server.stateView !== undefined && !server.stateSyncEnabled) throw bad("stateView", "stateView only works with stateSyncEnabled.", "Add stateSyncEnabled: true, or leave stateView out.");
  if (idleCheck !== undefined && idleCheck !== "server" && idleCheck !== "client" && idleCheck !== "off") {
    throw bad("idleCheck", `idleCheck is ${JSON.stringify(idleCheck)}.`, 'Give "server" (the room checks, after idleTimeoutSec), "client" (each player\'s game decides) or "off".');
  }
  if (idleTimeoutSec !== undefined && !(typeof idleTimeoutSec === "number" && idleTimeoutSec >= ROOM_LIMITS.minimumIdleTimeoutSec && idleTimeoutSec <= ROOM_LIMITS.maximumIdleTimeoutSec)) {
    throw bad("idleTimeoutSec", `idleTimeoutSec is ${JSON.stringify(idleTimeoutSec)}.`, `Give seconds from ${ROOM_LIMITS.minimumIdleTimeoutSec} to ${ROOM_LIMITS.maximumIdleTimeoutSec}, like 600; to turn the idle check off, give idleCheck: "off".`);
  }
  if (awayMode !== undefined && awayMode !== "hold" && awayMode !== "lobby") throw bad("awayMode", `awayMode is ${JSON.stringify(awayMode)}.`, 'Give "hold" (hold their seat) or "lobby" (send them to the room that made this one).');
  if (seatHoldDurationSec !== undefined && !(typeof seatHoldDurationSec === "number" && seatHoldDurationSec >= 0 && seatHoldDurationSec <= ROOM_LIMITS.maximumSeatHoldDurationSec)) {
    throw bad("seatHoldDurationSec", `seatHoldDurationSec is ${JSON.stringify(seatHoldDurationSec)}.`, `Give seconds from 0 (no held seats) to ${ROOM_LIMITS.maximumSeatHoldDurationSec}, like 300.`);
  }
  if (reconnectTimeoutSec !== undefined && !(typeof reconnectTimeoutSec === "number" && reconnectTimeoutSec >= 0 && reconnectTimeoutSec <= ROOM_LIMITS.maximumReconnectTimeoutSec)) {
    throw bad("reconnectTimeoutSec", `reconnectTimeoutSec is ${JSON.stringify(reconnectTimeoutSec)}.`, `Give seconds from 0 (leave at once) to ${ROOM_LIMITS.maximumReconnectTimeoutSec}, like 30.`);
  }
  if (stateSaveIntervalSec !== undefined && !(typeof stateSaveIntervalSec === "number" && stateSaveIntervalSec >= ROOM_LIMITS.minimumStateSaveIntervalSec && stateSaveIntervalSec <= ROOM_LIMITS.maximumStateSaveIntervalSec)) {
    throw bad("stateSaveIntervalSec", `stateSaveIntervalSec is ${JSON.stringify(stateSaveIntervalSec)}.`, `Give a number of seconds from ${ROOM_LIMITS.minimumStateSaveIntervalSec} to ${ROOM_LIMITS.maximumStateSaveIntervalSec}, like ${ROOM_LIMITS.defaultStateSaveIntervalSec}, or leave it out for ${ROOM_LIMITS.defaultStateSaveIntervalSec}.`);
  }
  return server;
}

/** Whether a room shows in room lists, takes new players and is offered by Zaisma's Join, and its name and labels. */
export interface RoomSettings {
  isListed: boolean;
  isOpen: boolean;
  friendJoinsEnabled: boolean;
  name: string | null;
  labels: Record<string, string>;
}

/**
 * Messages from the room to a client. Every message says its type; a game's own messages carry
 * theirs in data (docs/NAMING.md).
 *
 * Clients send {type: "hello", pass, joinData?, room?: {isListed?, friendJoinsEnabled?, name?, labels?}, idleTimeoutSec?,
 * idleCheckEnabled?} first (joinData is for canJoin and onJoin; the room's settings only count from
 * the player who makes it; the idle fields only where the game server's idleCheck is "client"), then
 * {type: "message", data}. With hostControlsEnabled, the host may also send {type: "room", isListed?,
 * isOpen?, friendJoinsEnabled?, name?, labels?} and {type: "kick", playerId, keepOut?}. hostPlayerId is null without host controls.
 *
 * Blocks (docs/DECISIONS.md, "How blocks work"): a player's game sends {type: "block", playerId} for a
 * player in the room it blocked (a guest's, or one just made) and {type: "unblock", playerId} when it
 * takes one back; blocks between accounts the room finds itself. Each player gets {type: "blocks",
 * playerIds}, the players in the room they have a block with, either way, whenever that changes. A
 * hello from Zaisma.rooms.quickJoin may say avoidBlockedPlayers: true, and a Zaisma room then turns the
 * player away with blocked_player_here when someone they blocked is in it, so quickJoin tries another.
 * Every hello from quickJoin says isQuickJoin: true, so Zaisma knows the game joins players by itself.
 *
 * Players who walk away (docs/DECISIONS.md): clients send the text "ping" every 30 seconds or so (the
 * room answers "pong"; a connection with no ping or message for about a minute is dropped), and
 * {type: "here"} now and then while the player gives input but the game sends nothing. They send
 * {type: "idle"} when the player didn't answer "Still there?", {type: "hidden"} and {type: "shown"} as
 * the game is hidden and shown (where welcome's awayChecks.hiddenTimeoutSec says it counts), and
 * {type: "back", joinData?, idleTimeoutSec?, idleCheckEnabled?} when the player returns. A player out
 * of the match with their seat held gets {type: "away"}, and once the seat is no longer held, their
 * connection closes with SEAT_GONE_CLOSE_CODE.
 *
 * Ping and the room's clock (docs/DECISIONS.md, "Rooms under lag"): the room sends {type: "probe",
 * probeNumber, serverTimeMs, pingDurationMs} right after welcome and again once it's answered (so the
 * client hears its first ping), every welcome.probeIntervalSec while
 * the room ticks (null when it doesn't), and each time ROOM_LIMITS.sentBytesPerProbe has gone out to
 * the player. The client answers at once with {type: "probe_answer", probeNumber}. Answers aren't game
 * messages: they don't count toward the 30 a second or the idle check. A probe left unanswered for
 * ROOM_LIMITS.probeAnswerTimeoutSec, or ROOM_LIMITS.maximumUnansweredSentBytes sent since the last
 * answered one, closes the connection with NO_ANSWER_CLOSE_CODE.
 *
 * Bytes: after hello, a client may also send binary frames (room.sendBytes), each up to
 * ROOM_LIMITS.maximumGameMessageSizeBytes and counted with its messages, for the game server's onBytes.
 * Every binary frame the room sends starts with one byte, the length in UTF-8 bytes of the player ID
 * they came from (0 for the game server), then that ID, then the bytes (bytesFrame).
 *
 * State sync (stateSyncEnabled): {type: "state", serverTimeMs, full} with the player's whole view, the
 * first time and after their connection was backed up, then {type: "state", serverTimeMs, changes} with
 * what changed since (StateChange, state-sync.ts). serverTimeMs is the room's clock as it was sent.
 *
 * Spectators (maximumSpectatorCount): a hello with isSpectator: true watches. A spectator's welcome says
 * isSpectator: true, and they get the players, the state and every message sent to everyone, but they send
 * nothing: only probe answers, and anything else gets spectator_cannot_send. welcome and every "room"
 * message carry spectatorCount, and a "room" message goes out whenever it changes.
 */
export type ServerMessage =
  | {
      type: "welcome";
      me: ShownPlayer;
      isSpectator: boolean;
      players: ListedPlayer[];
      room: RoomSettings;
      spectatorCount: number;
      hostPlayerId: string | null;
      awayChecks: AwayChecks;
      endsAt: string | null;
      probeIntervalSec: number | null;
    }
  | { type: "probe"; probeNumber: number; serverTimeMs: number; pingDurationMs: number | null }
  | { type: "ending"; endsAt: string }
  // A version published "now": coming at appliesAt (an ISO time), then now, just before the room closes its connections (VERSION_UPDATE_CLOSE_CODE). isReloading: the game's files changed, so it reloads.
  | { type: "versionUpdate"; step: "coming" | "now"; versionId: string; appliesAt: string; isReloading: boolean }
  | { type: "players"; players: ListedPlayer[]; hostPlayerId: string | null }
  | { type: "away"; reason: Exclude<AwayReason, "lost">; seatHoldDurationSec: number }
  | { type: "kicked"; message: string; isKeptOut: boolean }
  | { type: "room"; room: RoomSettings; spectatorCount: number }
  | { type: "move"; roomCode: string }
  | { type: "message"; data: unknown }
  | { type: "state"; serverTimeMs: number; full: unknown }
  | { type: "state"; serverTimeMs: number; changes: StateChange[] }
  | { type: "blocks"; playerIds: string[] }
  // versionId: with other_version, the version the room runs, which the game reloads at.
  | { type: "error"; code: RoomErrorCode; message: string; versionId?: string }
  | { type: "ended"; message: string };

export type RoomErrorCode =
  | "full"
  | "closed"
  | "ended"
  | "too_big"
  | "too_fast"
  | "bad_message"
  | "bad_pass"
  | "no_hello"
  | "not_allowed"
  | "game_unavailable"
  | "busy"
  | "kept_out"
  | "refused"
  | "no_room"
  | "hosting_paused"
  | "account_needed"
  | "game_not_open_to_player"
  | "blocked_player_here"
  | "other_version"
  | "watching_full"
  | "spectator_cannot_send";

export const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: "This room is full.",
  closed: "This room isn't taking new players.",
  ended: "This match has ended.",
  too_big: "Message too big.",
  too_fast: "Too many messages. Slow down.",
  bad_message: "Messages must be JSON with a type the room takes.",
  bad_pass: "Your player pass isn't valid for this game.",
  no_hello: "Send your player pass first.",
  not_allowed: "Only the game server or the room's host can do that.",
  game_unavailable: "This game isn't available right now.",
  busy: "Rooms are busy. Try again soon.",
  kept_out: "You were removed from this room.",
  refused: "The game didn't let you into this room.",
  no_room: "That room isn't running.",
  hosting_paused: "This game's hosting is paused. It starts again when the month resets or its developer adds credit.",
  account_needed: "Playing online needs a Zaisma account. Sign in on the game's page to play.",
  game_not_open_to_player: "This game isn't open to this account.",
  blocked_player_here: "Someone you blocked is in this room.",
  other_version: "This room runs another version of the game, so the game reloads at it first.",
  watching_full: "Nobody else can watch this room right now.",
  spectator_cannot_send: "Spectators watch; they can't send to the room.",
};

/** What players are told when Zaisma ends a match at room.endsAt. */
export const HOSTING_PAUSED_END_MESSAGE = "This game's hosting is paused, so this match has ended. New rooms open again when the month resets or its developer adds credit.";

/**
 * isListed, isOpen, the players who have been in the room, the players kept out of it and a reserved
 * room's setup data, saved with a sleeping room's state.
 */
export interface SavedRoom extends RoomSettings {
  knownPlayerIds: string[];
  setupData?: unknown;
  keptOut?: Record<string, string>;
  expected?: Record<string, Expected>;
  held?: Record<string, Held>;
  kept?: Record<string, AwayReason>;
  /** Players whose connection dropped, with when their time to come back runs out (reconnectTimeoutSec). */
  reconnecting?: Record<string, Reconnecting>;
  lobbyRoomCode?: string;
  /** Blocks between the room's players from their accounts, as pairs of player IDs. */
  accountBlocks?: [string, string][];
  /** Blocks players' games said they made, each the blocker's player ID and then the blocked one's. */
  sessionBlocks?: [string, string][];
  /** Friendships between the room's players, as pairs of player IDs. */
  friendships?: [string, string][];
  /** When Zaisma will end the match (room.endsAt), once it's set. */
  endsAt?: string;
  /** Kept (room.setKept): it sleeps with its state when everyone leaves, instead of going a day later. */
  isKept?: boolean;
}

/** A seat held for a player out of the match: who, why they're out, and until when. */
export interface Held {
  player: Player;
  reason: AwayReason;
  untilMs: number;
}

/**
 * A player whose connection dropped, still in the match: who, and when their time to come back runs out.
 * Saved with the room, so a room that sleeps and wakes, which finds its players by their connections, keeps them.
 */
export interface Reconnecting {
  player: Player;
  untilMs: number;
}

/** When a room counts its players as away, or null when it doesn't: no input (idle), and the game hidden. */
export interface AwayChecks {
  idleTimeoutSec: number | null;
  hiddenTimeoutSec: number | null;
}

/** A player another room is sending here: the join data it sent, where from, and until when their seat is held. */
export interface Expected {
  joinData: unknown;
  fromRoomCode: string;
  untilMs: number;
}

/** The idle check a player's game asked for, for idleCheck "client": its timeout, or none at all. */
export interface ClientIdle {
  idleTimeoutSec?: number;
  idleCheckEnabled?: boolean;
}

/** How long a room holds a seat for a player another room is sending. */
const SEAT_MS = 60_000;

/** How the room reaches players: a Durable Object's sockets, or a Node server's. */
export interface Transport {
  send(playerId: string, text: string): void;
  /** A binary frame (bytesFrame). Without it, rooms can't send bytes. */
  sendBytes?(playerId: string, frame: Uint8Array): void;
  close(playerId: string, closeCode: number, reason: string): void;
  /** Set up a reserved room, then send each of its players a "move" message. Without it, rooms can't reserve. */
  reserve?(roomCode: string, start: RoomStart): void;
  /**
   * Ask another room of the game to take some players (its expect()), send each player it takes a
   * "move" message, then hand the answer to this room's moved(). Without it, rooms can't move players.
   */
  moveTo?(roomCode: string, ask: Omit<MoveAsk, "fromRoomCode">): void;
  /** This room's code, as room.roomCode. Without it, null. */
  roomCode?: string;
  /** The game's database, as room.database. Without it, its calls fail with database_unavailable. */
  database?: GameDatabase;
  /** The game's secrets, as room.secrets. Without them, there are none. */
  secrets?: Readonly<Record<string, string>>;
  /** room.applyVersionUpdate(): switch to the version coming now. Without it (your own server), it does nothing. */
  applyVersionUpdate?(): void;
  /** Whether a player's connection holds ROOM_LIMITS.backedUpSizeBytes or more not yet sent. Without it, the room judges by its probes. */
  isBackedUp?(playerId: string): boolean;
}

/** room.secrets and server.secrets where a game has none. */
export const NO_SECRETS: Readonly<Record<string, string>> = Object.freeze({});

/** room.database where the room has no database: every call fails, saying so. */
const NO_DATABASE: GameDatabase = {
  query: () => Promise.reject(new DatabaseError("database_unavailable", "This room has no game database.", "On your own server, start the Node runner with --database <file>, or pass database to startServer.")),
  batch: () => Promise.reject(new DatabaseError("database_unavailable", "This room has no game database.", "On your own server, start the Node runner with --database <file>, or pass database to startServer.")),
  erasePlayer: () => Promise.reject(new DatabaseError("database_unavailable", "This room has no game database.", "On your own server, start the Node runner with --database <file>, or pass database to startServer.")),
};

/**
 * Plain JSON within ROOM_LIMITS.maximumRoomDataSizeBytes, copied, or isValid false if it isn't.
 * Nothing (undefined or null) is null. Players' data that fails this is refused.
 */
export function checkRoomData(given: unknown): { isValid: true; checkedData: unknown } | { isValid: false } {
  if (given === undefined || given === null) return { isValid: true, checkedData: null };
  let text: string | undefined;
  try {
    text = JSON.stringify(given);
  } catch {
    return { isValid: false };
  }
  if (text === undefined || new TextEncoder().encode(text).length > ROOM_LIMITS.maximumRoomDataSizeBytes) return { isValid: false };
  return { isValid: true, checkedData: JSON.parse(text) };
}

/**
 * An error for a client. message replaces the usual text, like the game's reason for turning a player away;
 * details add what the code needs, like the room's versionId with other_version.
 */
export function errorMessage(code: RoomErrorCode, message?: string, details?: { versionId: string }): string {
  return JSON.stringify({ type: "error", code, message: message || ERROR_TEXT[code], ...details } satisfies ServerMessage);
}

/** Whether a player may come in, and if not, why. */
export type Admission = { isAllowed: true } | { isAllowed: false; code: RoomErrorCode; message?: string };

/** WebSocket close code for a match that ended normally. */
export const ENDED_CLOSE_CODE = 4000;
/** Close code for a player refused or removed by the room. */
export const REFUSED_CLOSE_CODE = 4001;
/** Close code for a player who walked away, once the room stops holding their seat. They may try to come back. */
export const SEAT_GONE_CLOSE_CODE = 4002;
/** Close code for a connection that stopped answering or fell too far behind; the SDK reconnects. */
export const NO_ANSWER_CLOSE_CODE = 4003;
/** Close code for a match switching to a version published "now"; the SDK reconnects, or the page reloads the game first. */
export const VERSION_UPDATE_CLOSE_CODE = 4004;

/**
 * A binary frame as the room sends it: one byte, the length of fromPlayerId in UTF-8 bytes (0 for the
 * game server), then fromPlayerId, then the bytes.
 */
export function bytesFrame(bytes: Uint8Array, fromPlayerId: string | null): Uint8Array {
  const from = new TextEncoder().encode(fromPlayerId ?? "");
  if (from.length > 255) throw new Error("A player ID is too long to send bytes from");
  const frame = new Uint8Array(1 + from.length + bytes.length);
  frame[0] = from.length;
  frame.set(from, 1);
  frame.set(bytes, 1 + from.length);
  return frame;
}

/**
 * Marks a game server whose onMessage and onBytes only queue the input for its next call, like Zaisma's
 * sandboxed real-time ones: the room hands each input over as it comes, outside the handlers waiting
 * their turn, so ticks never wait behind input.
 */
export const QUEUES_INPUT = Symbol("queuesInput");

/**
 * On a room's API object, for Zaisma's sandbox: a count that goes up each time a block or friendship
 * between the room's players may have changed, so the sandbox is sent the pairs again only then.
 */
export const PAIR_CHANGE_COUNT = Symbol("pairChangeCount");

/**
 * Marks a game server that runs state sync itself, like Zaisma's sandboxed ones, whose state lives in the
 * sandbox: its calls send their frames through the room's STATE_SYNC, and the room calls this, with the
 * state and its API, when a round is due outside them (a player reconnecting, or catching up, in a turn-based room).
 */
export const SYNCS_STATE = Symbol("syncsState");

/**
 * On a room's API object, for a game server that runs state sync itself (SYNCS_STATE): viewers() says
 * which players are backed up and which need a full copy (taken: each is said once), and send() sends a
 * frame to some of them.
 */
export const STATE_SYNC = Symbol("stateSync");

/** What STATE_SYNC hands a game server that runs state sync itself. */
export interface StateSyncHooks {
  viewers(): { backedUpPlayerIds: string[]; fullCopyPlayerIds: string[] };
  send(playerIds: unknown, frame: unknown): void;
}

/** Messages a room's traffic counts by type: their data.type, like "move", or one of these. */
export const NO_MESSAGE_TYPE = "(none)";
export const BYTES_MESSAGE_TYPE = "(bytes)";
export const ZAISMA_MESSAGE_TYPE = "(zaisma)";
export const OTHER_MESSAGE_TYPE = "(other)";
/** State sync's updates (stateSyncEnabled). */
export const STATE_MESSAGE_TYPE = "(state)";
/** Message types a room counts apart in each direction; any more count as OTHER_MESSAGE_TYPE. */
const MAXIMUM_MESSAGE_TYPE_COUNT = 20;
/** A game's message type: up to 40 letters, digits and _ - . : */
const MESSAGE_TYPE_PATTERN = /^[A-Za-z0-9_\-.:]{1,40}$/;

export type TrafficDirection = "inbound" | "outbound";

/**
 * One message type's traffic in one direction: how many, their bytes and the largest, and how many of
 * those sent reliably went to a player whose connection was backed up (for the latest_only hint).
 */
export interface MessageTypeTraffic {
  messageType: string;
  direction: TrafficDirection;
  messageCount: number;
  sizeBytes: number;
  largestSizeBytes: number;
  backedUpMessageCount: number;
}

/**
 * A room's traffic since it was last taken (takeTraffic): bytes in, messages and bytes out (each
 * frame once per player it went to), and per message type. Messages in are RoomCore.messageCount.
 */
export interface RoomTraffic {
  inboundSizeBytes: number;
  outboundMessageCount: number;
  outboundSizeBytes: number;
  messageTypes: MessageTypeTraffic[];
}

/** No traffic yet. */
export function noTraffic(): RoomTraffic {
  return { inboundSizeBytes: 0, outboundMessageCount: 0, outboundSizeBytes: 0, messageTypes: [] };
}

/** Two rooms' (or two hours') traffic added up, message types matched by type and direction. */
export function addTraffic(first: RoomTraffic, second: RoomTraffic): RoomTraffic {
  const types = new Map(first.messageTypes.map((type) => [`${type.direction} ${type.messageType}`, { ...type }]));
  for (const type of second.messageTypes) {
    const key = `${type.direction} ${type.messageType}`;
    const kept = types.get(key);
    if (!kept) types.set(key, { ...type, backedUpMessageCount: type.backedUpMessageCount ?? 0 });
    else {
      kept.messageCount += type.messageCount;
      kept.sizeBytes += type.sizeBytes;
      kept.largestSizeBytes = Math.max(kept.largestSizeBytes, type.largestSizeBytes);
      // Traffic a room kept from before backed-up sends were counted has none.
      kept.backedUpMessageCount = (kept.backedUpMessageCount ?? 0) + (type.backedUpMessageCount ?? 0);
    }
  }
  return {
    inboundSizeBytes: first.inboundSizeBytes + second.inboundSizeBytes,
    outboundMessageCount: first.outboundMessageCount + second.outboundMessageCount,
    outboundSizeBytes: first.outboundSizeBytes + second.outboundSizeBytes,
    messageTypes: [...types.values()],
  };
}

/** A game message's type for the traffic counts: its data.type when that's a short name, else NO_MESSAGE_TYPE. */
function messageTypeOf(messageData: unknown): string {
  const type = messageData && typeof messageData === "object" ? (messageData as { type?: unknown }).type : undefined;
  return typeof type === "string" && MESSAGE_TYPE_PATTERN.test(type) ? type : NO_MESSAGE_TYPE;
}

/** How many past players a room remembers, so they can come back to a closed room, and how many it keeps out: at least everyone a full room can hold, so blocks and friends are found among all of them. */
const REMEMBERED_PLAYER_COUNT = ROOM_LIMITS.maximumPlayerCount;

const NOBODY_JOINED: JoinInfo = { fromRoomCode: null, isReturning: false, isSpectator: false };
const WATCHING: JoinInfo = { fromRoomCode: null, isReturning: false, isSpectator: true };

/** Two players with a block between them, in either order (player IDs have no spaces). */
const pairKey = (firstPlayerId: string, secondPlayerId: string) => (firstPlayerId < secondPlayerId ? `${firstPlayerId} ${secondPlayerId}` : `${secondPlayerId} ${firstPlayerId}`);
/** One player's block of another: the blocker first. */
const blockKey = (blockerPlayerId: string, blockedPlayerId: string) => `${blockerPlayerId} ${blockedPlayerId}`;

export class RoomCore<S = any> {
  state: S;
  readonly players = new Map<string, Player>();
  /** Spectators watching (maximumSpectatorCount): never in players, never counted as playing. */
  readonly spectators = new Map<string, Player>();
  ended = false;
  /** When Zaisma will end this match (room.endsAt), or null. */
  endsAt: string | null = null;
  /** Messages received from clients, for usage counts. */
  messageCount = 0;
  /** The rest of the room's traffic since takeTraffic, by "<direction> <type>". */
  private traffic = { inboundSizeBytes: 0, outboundMessageCount: 0, outboundSizeBytes: 0, messageTypes: new Map<string, MessageTypeTraffic>(), inboundTypeCount: 0, outboundTypeCount: 0 };
  /** Goes up whenever a block or friendship between players may have changed (PAIR_CHANGE_COUNT). */
  private pairChangeCount = 0;
  /** Set when the state changed and a sleeping room should save it. */
  dirty = false;
  /** A version published "now" this match is moving to, once the transport started it (startVersionUpdate). */
  versionUpdate: { versionId: string; appliesAt: string; isReloading: boolean } | null = null;
  /** When a real-time room's state was last saved, set by the transport after each save; null until it has been. */
  savedAtMs: number | null = null;
  isListed = true;
  isOpen = true;
  friendJoinsEnabled = true;
  name: string | null = null;
  labels: Record<string, string> = {};
  /** Kept (room.setKept): the transport keeps its state when it empties. */
  isKept = false;
  /**
   * Set when the player count, isListed, isOpen or isKept changed, so the room list can be brought up to date,
   * and when the room's blocks changed, since a sleeping room's saved room is written with its listing.
   */
  listingChanged = false;
  /** Players who have been in this room, newest last: they may come back after it closes. */
  readonly known = new Set<string>();
  /** Players kicked and kept out for the rest of the match, with the message they were given. */
  readonly keptOut = new Map<string, string>();
  /** Players other rooms are sending here (room.moveTo), with a seat each until they arrive. */
  readonly expected = new Map<string, Expected>();
  /** Seats held for players out of the match (walked away, or lost their connection) until they come back or it runs out. */
  readonly held = new Map<string, Held>();
  /** Players who walked away that onAway kept in the room, and players whose connection dropped (lost), and why. */
  readonly kept = new Map<string, AwayReason>();
  /** Players whose connection dropped (kept as "lost"): when their time to reconnect runs out. */
  readonly reconnectUntilMs = new Map<string, number>();
  /** The room that made this one, where awayMode "lobby" sends players who walk away. */
  lobbyRoomCode: string | null = null;
  /** Blocks between players from their accounts (Zaisma's own record, or passes on your own server), either way: pairKey(first, second). */
  private readonly accountBlocks = new Set<string>();
  /** Blocks players' games said they made, a guest's or one just made: blockKey(blocker, blocked). */
  private readonly sessionBlocks = new Set<string>();
  /** Friendships between players from their accounts (Zaisma's own record, or passes on your own server): pairKey(first, second). */
  private readonly friendships = new Set<string>();
  /** The blocks each player was last told of, so they're told again only when theirs change. */
  private readonly toldBlocks = new Map<string, string>();
  /** When each player in the match was last heard from, when their game was hidden, and the idle check their game asked for. */
  private presence = new Map<string, Presence>();
  /** Players this room is sending to its lobby for walking away, so onMoved doesn't hear of it. */
  private sentAway = new Set<string>();
  /** What a reserved room started with, kept so a room that starts over starts the same way. */
  private setupData: unknown = null;
  /** When this room last reserved rooms, for the limit. */
  private reservedAtMs: number[] = [];
  private buckets = new Map<string, { tokenCount: number; filledAtMs: number }>();
  /** Probes this room has sent, to every player: each probe's number. */
  private probeCount = 0;
  /** What each player was last sent of the state (stateSyncEnabled), unless the game server runs state sync itself (SYNCS_STATE). */
  private readonly stateTracker: StateTracker | null;
  /** For a game server that runs state sync itself: players with a new connection, who need a full copy. */
  private readonly fullCopyPlayerIds = new Set<string>();
  /** A turn-based room's players state sync skipped as backed up, who get a full copy once they catch up. */
  private readonly stateSkippedPlayerIds = new Set<string>();
  /** Latest-only messages waiting for each backed-up player, by "<kind>:<latestKey>", least recently replaced first. */
  private readonly latestSlots = new Map<string, Map<string, Outgoing>>();
  private readonly now: () => number;
  readonly maximumPlayerCount: number;
  readonly maximumSpectatorCount: number;
  private readonly api: Room;
  readonly server: GameServer<S>;
  private readonly transport: Transport;
  /**
   * Set once a handler returns a promise (a game server in a sandbox): from then on handlers run
   * one after another, each with the state the last one left.
   */
  private queue: Promise<void> | null = null;
  /** Handlers waiting in the queue, so ticks don't pile up behind a slow game server. */
  private waitingCount = 0;
  /** Handlers running right now, and what waits for them to finish (a kicked player's onLeave). */
  private depth = 0;
  private afterHandler: (() => void)[] = [];

  /**
   * startOptions.start makes a reserved room: closed, open only to the players it was made for, and
   * set up with its setup data. A saved room (startOptions.room) wakes as it was, with
   * startOptions.presence saying when each of its players was last heard from and the idle check
   * their game asked for. A restarted real-time room (startOptions.restoreInfo, with its saved state)
   * skips setup: startOptions.lostPlayers, the players in its match at the save who aren't connected,
   * come back as away (reason "lost"), and onRestored runs once. startOptions.spectators are spectators
   * still connected to a room waking from sleep.
   */
  constructor(
    server: GameServer<S>,
    transport: Transport,
    startOptions: {
      state?: S;
      players?: Player[];
      spectators?: Player[];
      room?: SavedRoom;
      start?: RoomStart;
      presence?: Record<string, { seenAtMs?: number; clientIdle?: ClientIdle }>;
      restoreInfo?: RestoreInfo;
      lostPlayers?: Player[];
      now?: () => number;
    } = {},
  ) {
    this.server = server;
    this.transport = transport;
    this.now = startOptions.now ?? Date.now;
    this.maximumPlayerCount = server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount;
    this.maximumSpectatorCount = server.maximumSpectatorCount ?? 0;
    this.stateTracker = server.stateSyncEnabled && !(server as { [SYNCS_STATE]?: unknown })[SYNCS_STATE] ? newStateTracker(ROOM_LIMITS.maximumStateViewSizeBytes) : null;
    for (const spectator of startOptions.spectators ?? []) {
      this.spectators.set(spectator.id, spectator);
      this.presence.set(spectator.id, newPresence(this.now(), {}));
    }
    for (const player of startOptions.players ?? []) {
      this.players.set(player.id, player);
      const was = startOptions.presence?.[player.id];
      this.presence.set(player.id, newPresence(was?.seenAtMs ?? this.now(), clientIdle(was?.clientIdle)));
    }
    const saved = startOptions.room;
    if (saved) {
      this.isListed = saved.isListed !== false;
      this.isOpen = saved.isOpen !== false;
      this.friendJoinsEnabled = saved.friendJoinsEnabled !== false;
      this.name = saved.name ?? null;
      this.labels = saved.labels ?? {};
      for (const id of saved.knownPlayerIds ?? []) this.known.add(id);
      this.setupData = saved.setupData ?? null;
      this.keepOut(saved.keptOut);
      for (const [id, expected] of Object.entries(saved.expected ?? {})) this.expected.set(id, expected);
      for (const [id, held] of Object.entries(saved.held ?? {})) if (!this.players.has(id)) this.held.set(id, held);
      // A room waking with its state keeps players whose connection dropped: they have no connection to be found by.
      if (startOptions.state !== undefined) {
        for (const [id, reconnecting] of Object.entries(saved.reconnecting ?? {})) {
          if (this.players.has(id)) continue;
          this.players.set(id, reconnecting.player);
          this.presence.set(id, newPresence(this.now(), {}));
          this.kept.set(id, "lost");
          this.reconnectUntilMs.set(id, reconnecting.untilMs);
        }
      }
      for (const [id, reason] of Object.entries(saved.kept ?? {})) if (this.players.has(id) && !this.kept.has(id) && reason !== "lost") this.kept.set(id, reason);
      this.lobbyRoomCode = saved.lobbyRoomCode ?? null;
      this.endsAt = saved.endsAt ?? null;
      this.isKept = saved.isKept === true;
      for (const [first, second] of saved.accountBlocks ?? []) this.accountBlocks.add(pairKey(first, second));
      for (const [blocker, blocked] of saved.sessionBlocks ?? []) this.sessionBlocks.add(blockKey(blocker, blocked));
      for (const [first, second] of saved.friendships ?? []) this.friendships.add(pairKey(first, second));
    } else if (startOptions.start) {
      const start = startOptions.start;
      this.isOpen = false;
      this.isListed = start.isListed;
      this.friendJoinsEnabled = start.friendJoinsEnabled !== false;
      this.name = start.name;
      this.labels = start.labels;
      for (const id of start.playerIds) this.known.add(id);
      this.setupData = start.setupData ?? null;
      this.keepOut(start.keptOut);
      this.lobbyRoomCode = start.lobbyRoomCode ?? null;
      this.isKept = start.isKept === true;
    }
    // A restarted room's players who aren't connected: in the match until leave() below makes them away, as a dropped connection does.
    const restoreInfo = startOptions.state !== undefined ? startOptions.restoreInfo : undefined;
    const lostPlayers = restoreInfo ? (startOptions.lostPlayers ?? []).filter((player) => !startOptions.players?.some((connected) => connected.id === player.id) && !this.held.has(player.id)) : [];
    for (const player of lostPlayers) {
      this.players.set(player.id, player);
      this.presence.set(player.id, newPresence(this.now(), {}));
      this.kept.delete(player.id);
      this.reconnectUntilMs.delete(player.id);
    }
    for (const player of this.players.values()) this.remember(player.id);
    // A room waking up: its players were told their blocks before it slept.
    for (const id of this.players.keys()) this.toldBlocks.set(id, JSON.stringify(this.blockedWith(id)));
    if (startOptions.state !== undefined) this.state = startOptions.state;
    else {
      if (typeof server.setup !== "function") throw noSetupError();
      const first = server.setup(this.setupData) as S | Promise<S>;
      if (isPromise(first)) {
        this.state = undefined as S;
        this.run(() => first);
      } else this.state = first;
    }
    const core = this;
    this.api = {
      roomCode: transport.roomCode ?? null,
      get players() {
        return [...core.players.values()];
      },
      get spectators() {
        return [...core.spectators.values()];
      },
      broadcast: (message, broadcastOptions) => {
        const given = closed(broadcastOptions ?? {}, ["exceptPlayerId", "audience", "delivery", "latestKey"], "room.broadcast");
        const delivery = readDelivery(given, "room.broadcast", defaultLatestKey(message));
        this.deliver(
          this.audienceOf(given.audience, "room.broadcast").filter((id) => id !== given.exceptPlayerId),
          { text: JSON.stringify({ type: "message", data: message } satisfies ServerMessage), messageType: messageTypeOf(message) },
          delivery,
        );
      },
      send: (playerId, message, sendOptions) => {
        const delivery = readDelivery(closed(sendOptions ?? {}, ["delivery", "latestKey"], "room.send"), "room.send", defaultLatestKey(message));
        if (this.isViewer(playerId)) this.deliver([playerId], { text: JSON.stringify({ type: "message", data: message } satisfies ServerMessage), messageType: messageTypeOf(message) }, delivery);
      },
      broadcastBytes: (bytes, broadcastOptions) => this.broadcastBytes(bytes, broadcastOptions),
      sendBytes: (playerId, bytes, sendOptions) => {
        const delivery = readDelivery(closed(sendOptions ?? {}, ["delivery", "latestKey"], "room.sendBytes"), "room.sendBytes", "");
        const frame = bytesFrame(readBytes(bytes, "room.sendBytes"), null);
        if (this.isViewer(playerId)) this.deliver([playerId], { frame, messageType: BYTES_MESSAGE_TYPE }, delivery);
      },
      end: (message) => this.end(message ?? "The match is over."),
      get endsAt() {
        return core.endsAt;
      },
      get isListed() {
        return core.isListed;
      },
      setListed: (isListed) => this.settle({ isListed: Boolean(isListed) }),
      get isOpen() {
        return core.isOpen;
      },
      setOpen: (isOpen) => this.settle({ isOpen: Boolean(isOpen) }),
      get friendJoinsEnabled() {
        return core.friendJoinsEnabled;
      },
      setFriendJoinsEnabled: (isEnabled) => this.settle({ friendJoinsEnabled: Boolean(isEnabled) }),
      get isKept() {
        return core.isKept;
      },
      setKept: (isKept) => this.setKept(Boolean(isKept)),
      get name() {
        return core.name;
      },
      get labels() {
        return { ...core.labels };
      },
      setInfo: (nameAndLabels) => this.settle(tidyRoomInfo(closed(nameAndLabels, ["name", "labels"], "room.setInfo"))),
      reserve: (reserveOptions) => this.reserve(reserveOptions),
      kick: (playerId, kickOptions) => this.kick(playerId, kickOptions),
      moveTo: (toRoomCode, moveOptions) => this.moveTo(toRoomCode, moveOptions),
      database: transport.database ?? NO_DATABASE,
      secrets: transport.secrets ?? NO_SECRETS,
      hasBlockBetween: (firstPlayerId, secondPlayerId) => this.hasBlockBetween(firstPlayerId, secondPlayerId),
      areFriends: (firstPlayerId, secondPlayerId) => this.areFriends(firstPlayerId, secondPlayerId),
      pingDurationMs: (playerId) => this.presence.get(playerId)?.pingDurationMs ?? null,
      serverTimeMs: () => this.now(),
      awayReason: (playerId) => (this.players.has(playerId) ? (this.kept.get(playerId) ?? null) : null),
      applyVersionUpdate: () => {
        if (this.versionUpdate) this.soon(() => this.transport.applyVersionUpdate?.());
      },
    };
    Object.defineProperty(this.api, PAIR_CHANGE_COUNT, { get: () => this.pairChangeCount });
    Object.defineProperty(this.api, STATE_SYNC, { value: { viewers: () => this.stateViewers(), send: (playerIds, frame) => this.sendStateFrom(playerIds, frame) } satisfies StateSyncHooks });
    if (restoreInfo) this.restored(restoreInfo, lostPlayers);
  }

  /**
   * A restarted room's players who aren't connected are away as lost, with the whole reconnectTimeoutSec
   * from now, whatever they had before the restart; then onRestored runs, and onAway for each.
   */
  private restored(restoreInfo: RestoreInfo, lostPlayers: Player[]): void {
    const reconnectTimeoutSec = this.server.reconnectTimeoutSec ?? ROOM_LIMITS.defaultReconnectTimeoutSec;
    if (reconnectTimeoutSec > 0) {
      for (const player of lostPlayers) {
        this.kept.set(player.id, "lost");
        this.reconnectUntilMs.set(player.id, this.now() + reconnectTimeoutSec * 1000);
      }
    }
    this.run(() => this.server.onRestored?.(this.state, restoreInfo, this.api));
    for (const player of lostPlayers) {
      // With reconnectTimeoutSec 0, they leave at once, as a dropped connection does.
      if (reconnectTimeoutSec === 0) this.leave(player.id, "lost");
      else if (this.server.onAway) this.run(() => this.server.onAway!(this.state, player, this.api, "lost"));
    }
    this.listingChanged = true;
    this.dirty = true;
    this.broadcastPlayers();
  }

  /** What a sleeping room saves besides the game's state. */
  get saved(): SavedRoom {
    this.countHeldSeats();
    return {
      ...this.settings(),
      knownPlayerIds: [...this.known],
      ...(this.setupData !== null ? { setupData: this.setupData } : {}),
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
      ...(this.expected.size ? { expected: Object.fromEntries(this.expected) } : {}),
      ...(this.held.size ? { held: Object.fromEntries(this.held) } : {}),
      ...(this.kept.size ? { kept: Object.fromEntries(this.kept) } : {}),
      ...(this.reconnectUntilMs.size ? { reconnecting: Object.fromEntries([...this.reconnectUntilMs].map(([id, untilMs]) => [id, { player: this.players.get(id)!, untilMs }])) } : {}),
      ...(this.lobbyRoomCode ? { lobbyRoomCode: this.lobbyRoomCode } : {}),
      ...(this.endsAt ? { endsAt: this.endsAt } : {}),
      ...(this.isKept ? { isKept: true } : {}),
      ...this.savedBlocks(),
    };
  }

  /** The blocks worth keeping while the room sleeps: those between players it still remembers. */
  private savedBlocks(): Pick<SavedRoom, "accountBlocks" | "sessionBlocks" | "friendships"> {
    const remembered = (key: string) => key.split(" ").every((id) => this.known.has(id));
    const accountBlocks = [...this.accountBlocks].filter(remembered).map((key) => key.split(" ") as [string, string]);
    const sessionBlocks = [...this.sessionBlocks].filter(remembered).map((key) => key.split(" ") as [string, string]);
    const friendships = [...this.friendships].filter(remembered).map((key) => key.split(" ") as [string, string]);
    return { ...(accountBlocks.length ? { accountBlocks } : {}), ...(sessionBlocks.length ? { sessionBlocks } : {}), ...(friendships.length ? { friendships } : {}) };
  }

  /** Whether two players are friends, from their accounts as the later of them joined. */
  areFriends(firstPlayerId: string, secondPlayerId: string): boolean {
    return firstPlayerId !== secondPlayerId && this.friendships.has(pairKey(firstPlayerId, secondPlayerId));
  }

  /**
   * A player's friends among the others this room remembers, from their accounts, as the room found them
   * as the player joined (Zaisma's own record, or the passes on your own server): they replace what the
   * room knew of that player's, so a friend removed since is gone. Call before join.
   */
  setFriends(playerId: string, friendPlayerIds: readonly string[]): void {
    let isChanged = false;
    for (const key of [...this.friendships]) {
      if (!key.split(" ").includes(playerId)) continue;
      this.friendships.delete(key);
      isChanged = true;
    }
    for (const otherPlayerId of friendPlayerIds) {
      if (otherPlayerId === playerId) continue;
      this.friendships.add(pairKey(playerId, otherPlayerId));
      isChanged = true;
    }
    if (!isChanged) return;
    this.dirty = true;
    this.pairChangeCount++;
  }

  /** Whether two players have a block between them, either way: from their accounts, or one a player's game said it made. */
  hasBlockBetween(firstPlayerId: string, secondPlayerId: string): boolean {
    if (firstPlayerId === secondPlayerId) return false;
    return this.accountBlocks.has(pairKey(firstPlayerId, secondPlayerId)) || this.sessionBlocks.has(blockKey(firstPlayerId, secondPlayerId)) || this.sessionBlocks.has(blockKey(secondPlayerId, firstPlayerId));
  }

  /**
   * The blocks between a player and the others this room remembers, from their accounts, as the room
   * found them as the player joined (Zaisma's own record, or the passes on your own server): they replace
   * what the room knew of that player's, so a block taken back since is gone. Call before join.
   */
  setAccountBlocks(playerId: string, blockPlayerIds: readonly string[]): void {
    let isChanged = false;
    for (const key of [...this.accountBlocks]) {
      if (!key.split(" ").includes(playerId)) continue;
      this.accountBlocks.delete(key);
      isChanged = true;
    }
    for (const otherPlayerId of blockPlayerIds) {
      if (otherPlayerId === playerId) continue;
      this.accountBlocks.add(pairKey(playerId, otherPlayerId));
      isChanged = true;
    }
    if (!isChanged) return;
    this.dirty = true;
    this.listingChanged = true;
    this.pairChangeCount++;
  }

  /** The players in the room this one has a block with, either way. */
  private blockedWith(playerId: string): string[] {
    return [...this.players.keys()].filter((otherPlayerId) => this.hasBlockBetween(playerId, otherPlayerId));
  }

  /** Tell each player the players in the room they have a block with, when that changed. */
  private tellBlocks(): void {
    for (const id of this.players.keys()) {
      const playerIds = this.blockedWith(id);
      const told = JSON.stringify(playerIds);
      if ((this.toldBlocks.get(id) ?? "[]") === told) continue;
      this.toldBlocks.set(id, told);
      this.sendText(id, JSON.stringify({ type: "blocks", playerIds } satisfies ServerMessage));
    }
  }

  /** A player's game blocked a player in the room (a guest's block, or one just made), or took one back. */
  private sessionBlock(playerId: string, message: Record<string, unknown>, isBlocking: boolean): RoomErrorCode | null {
    const otherPlayerId = message.playerId;
    if (typeof otherPlayerId !== "string" || otherPlayerId === playerId || !this.known.has(otherPlayerId)) return "bad_message";
    const key = blockKey(playerId, otherPlayerId);
    if (isBlocking === this.sessionBlocks.has(key)) return null;
    if (isBlocking) this.sessionBlocks.add(key);
    else this.sessionBlocks.delete(key);
    this.pairChangeCount++;
    this.dirty = true;
    this.listingChanged = true;
    this.tellBlocks();
    return null;
  }

  /** Players in the match who haven't walked away: what room lists and "playing now" count. */
  get playingCount(): number {
    return this.players.size - this.kept.size;
  }

  /** Seats the room holds for players on their way (room.moveTo) or out of the match for now. */
  get heldSeatCount(): number {
    return this.countHeldSeats();
  }

  /** Resolves once every handler started so far has finished (at once for game servers that answer at once). */
  async settled(): Promise<void> {
    while (this.queue) {
      const queued = this.queue;
      await queued;
      if (this.queue === queued) return;
    }
  }

  get ticking(): boolean {
    return this.server.ticksPerSec !== undefined;
  }

  /** How many are watching. */
  get spectatorCount(): number {
    return this.spectators.size;
  }

  /**
   * Whether a player may come in: the room's own rules (over, kept out, closed, full), then the game
   * server's canJoin with the join data the player brought. Call before join; join checks the room's rules again.
   * admitOptions.isSpectator: they come to watch, which a closed or full room still takes (spectatorDoor).
   */
  async admit(player: Player, joinData: unknown = null, admitOptions: { isSpectator?: boolean } = {}): Promise<Admission> {
    if (admitOptions.isSpectator) {
      const spectatorDoor = this.spectatorDoor(player.id);
      if (spectatorDoor) return spectatorDoor;
      // A spectator reconnecting doesn't ask again.
      return this.spectators.has(player.id) ? { isAllowed: true } : this.ask(player, joinData, WATCHING);
    }
    const door = this.door(player.id);
    if (door) return door;
    // Players already in, players another room sent (asked when it sent them) and players coming back to a held seat don't ask again.
    if (this.players.has(player.id) || this.seat(player.id) || this.holding(player.id)) return { isAllowed: true };
    return this.ask(player, joinData, NOBODY_JOINED);
  }

  /** The game server's canJoin, then the room's rules again, since things may change while it decides. */
  private async ask(player: Player, joinData: unknown, joinInfo: JoinInfo): Promise<Admission> {
    const isMoving = joinInfo.fromRoomCode !== null;
    const door = () => (joinInfo.isSpectator ? this.spectatorDoor(player.id) : this.door(player.id, isMoving));
    if (!this.server.canJoin) return door() ?? { isAllowed: true };
    await this.settled();
    let answer: unknown;
    try {
      answer = await this.server.canJoin(this.state, player, this.api, joinData, joinInfo);
    } catch (error) {
      console.error("Game server error:", error);
      return { isAllowed: false, code: "refused" };
    }
    const read = readJoinAnswer(answer);
    if ("mistake" in read) {
      console.error(`Game server error: ${read.mistake}`);
      return { isAllowed: false, code: "refused" };
    }
    if (!read.isAllowed) {
      const message = tidy(read.refusalMessage, ROOM_LIMITS.maximumMessageCharacterCount);
      return { isAllowed: false, code: "refused", ...(message ? { message } : {}) };
    }
    return door() ?? { isAllowed: true };
  }

  /**
   * The room's own rules for a player coming in, or null if they may. A player already in may always
   * come back, and a player another room sent, or whose seat is held, has a seat. isMoving: the game is
   * sending this player from another room, which a closed room still takes (closed keeps out
   * strangers, not the game).
   */
  private door(id: string, isMoving = false): Admission | null {
    if (this.ended) return { isAllowed: false, code: "ended" };
    const keptOutMessage = this.keptOut.get(id);
    if (keptOutMessage !== undefined) return { isAllowed: false, code: "kept_out", message: keptOutMessage };
    if (this.players.has(id) || this.seat(id) || this.holding(id)) return null;
    if (!isMoving && !this.isOpen && !this.known.has(id)) return { isAllowed: false, code: "closed" };
    if (this.players.size + this.countHeldSeats() >= this.maximumPlayerCount) return { isAllowed: false, code: "full" };
    return null;
  }

  /**
   * The room's own rules for a spectator coming in, or null if they may: a match that's over, and a player
   * kept out, keep them out, and so does a full audience; a closed or full room doesn't, since watching a
   * match under way is the point. A player in the match can't watch it too.
   */
  private spectatorDoor(id: string): Admission | null {
    if (this.ended) return { isAllowed: false, code: "ended" };
    const keptOutMessage = this.keptOut.get(id);
    if (keptOutMessage !== undefined) return { isAllowed: false, code: "kept_out", message: keptOutMessage };
    if (this.players.has(id)) return { isAllowed: false, code: "bad_message", message: "You're playing in this room, so you can't watch it too." };
    if (this.spectators.has(id)) return null;
    if (this.spectators.size >= this.maximumSpectatorCount) return { isAllowed: false, code: "watching_full" };
    return null;
  }

  /** Whether this room is holding a place for a player: they've been in it, another room is sending them, or their seat is held. */
  expects(id: string): boolean {
    return this.known.has(id) || this.seat(id) !== null || this.holding(id) !== null;
  }

  /** The seat held for a player out of the match, if it hasn't run out. */
  private holding(id: string): Held | null {
    const held = this.held.get(id);
    if (held && held.untilMs > this.now()) return held;
    if (held) {
      this.held.delete(id);
      this.listingChanged = true;
      this.dirty = true;
    }
    return null;
  }

  /** The seat held for a player another room is sending, if it hasn't run out. */
  private seat(id: string): Expected | null {
    const expected = this.expected.get(id);
    if (expected && expected.untilMs > this.now()) return expected;
    if (expected) this.expected.delete(id);
    return null;
  }

  /** Seats held for players other rooms are sending and players out of the match, dropping those that ran out. */
  private countHeldSeats(): number {
    let heldSeatCount = 0;
    for (const id of [...this.expected.keys()]) if (!this.players.has(id) && this.seat(id)) heldSeatCount++;
    for (const id of [...this.held.keys()]) if (this.holding(id)) heldSeatCount++;
    return heldSeatCount;
  }

  /**
   * Another room of the game wants to send players here (its room.moveTo). Each is checked like a
   * newcomer, with the room's rules and canJoin given the sending room's join data; those taken get a
   * seat for a minute. Says who was taken and who wasn't, and why.
   */
  async expect(ask: MoveAsk): Promise<MoveAnswer> {
    const answer: MoveAnswer = { movedPlayerIds: [], refusals: [] };
    const checked = checkRoomData(ask.joinData);
    const joinData = checked.isValid ? checked.checkedData : null;
    for (const player of ask.players) {
      const verdict: Admission = this.players.has(player.id)
        ? { isAllowed: false, code: "bad_message", message: "Already in that room." }
        : await this.ask(player, joinData, { fromRoomCode: ask.fromRoomCode, isReturning: false, isSpectator: false });
      if (verdict.isAllowed) {
        this.expected.set(player.id, { joinData, fromRoomCode: ask.fromRoomCode, untilMs: this.now() + SEAT_MS });
        answer.movedPlayerIds.push(player.id);
      } else answer.refusals.push({ playerId: player.id, code: verdict.code, message: verdict.message || ERROR_TEXT[verdict.code] });
    }
    if (answer.movedPlayerIds.length) this.dirty = true;
    return answer;
  }

  /**
   * A player arrives. Joining again with the same ID (a reconnect) keeps their place. The player who
   * makes the room can hide it from the start (a private match), turn friends' Join off, and name and label it. joinData is
   * what the player's game sent along, for onJoin; clientIdle is the idle check it asked for (idleCheck "client").
   * isSpectator: they come to watch (watch).
   */
  join(
    player: Player,
    joinOptions: { isListed?: boolean; friendJoinsEnabled?: boolean; joinData?: unknown; clientIdle?: ClientIdle; isSpectator?: boolean } & RoomInfo = {},
  ): { isAllowed: true; isRejoin: boolean } | { isAllowed: false; code: RoomErrorCode; message?: string } {
    if (joinOptions.isSpectator) return this.watch(player);
    // A player whose time to reconnect ran out while the room slept comes back to their held seat instead.
    this.expireReconnects();
    const isRejoin = this.players.has(player.id);
    const door = this.door(player.id);
    if (door && !door.isAllowed) return door;
    // A spectator who joins the match stops watching first.
    this.stopWatching(player.id);
    // A player another room sent brings what that room's game server passed, not what their browser sent.
    const seat = isRejoin ? null : this.seat(player.id);
    const back = isRejoin || seat ? null : this.holding(player.id);
    this.expected.delete(player.id);
    if (back) this.held.delete(player.id);
    const joinData = seat ? seat.joinData : (joinOptions.joinData ?? null);
    const joinInfo: JoinInfo = seat ? { fromRoomCode: seat.fromRoomCode, isReturning: false, isSpectator: false } : back ? { fromRoomCode: null, isReturning: true, isSpectator: false } : NOBODY_JOINED;
    if (this.known.size === 0) {
      if (joinOptions.isListed === false) this.isListed = false;
      if (joinOptions.friendJoinsEnabled === false) this.friendJoinsEnabled = false;
      Object.assign(this, tidyRoomInfo({ name: joinOptions.name, labels: joinOptions.labels }));
    }
    // Back from a dropped connection: in the match again before the welcome, so it reaches them and lists them as playing.
    const isReconnect = isRejoin && this.kept.get(player.id) === "lost";
    if (isReconnect) {
      this.kept.delete(player.id);
      this.reconnectUntilMs.delete(player.id);
    }
    this.players.set(player.id, player);
    this.remember(player.id);
    this.presence.set(player.id, newPresence(this.now(), joinOptions.clientIdle === undefined ? (this.presence.get(player.id)?.clientIdle ?? {}) : clientIdle(joinOptions.clientIdle)));
    const probeIntervalSec = this.ticking ? ROOM_LIMITS.probeIntervalSec : null;
    this.sendText(
      player.id,
      JSON.stringify({ type: "welcome", me: shownPlayer(player), isSpectator: false, players: this.list(), room: this.settings(), spectatorCount: this.spectators.size, hostPlayerId: this.hostPlayerId, awayChecks: this.checks(player.id), endsAt: this.endsAt, probeIntervalSec } satisfies ServerMessage),
    );
    // Every room gets a first ping and clock sample right away, ticking or not.
    this.probe(player.id);
    // A new connection starts with nothing of the state: a full copy comes with the next round.
    if (this.server.stateSyncEnabled) {
      this.stateTracker?.forget(player.id);
      this.fullCopyPlayerIds.add(player.id);
    }
    // A new connection hears its blocks afresh, and everyone else before the game or the player list says they're here.
    this.toldBlocks.delete(player.id);
    this.tellBlocks();
    if (!isRejoin) {
      this.listingChanged = true;
      this.run(() => this.server.onJoin?.(this.state, player, this.api, joinData, joinInfo));
      this.broadcastPlayers();
    } else if (isReconnect) this.cameBack(player);
    else if (this.kept.has(player.id)) this.back(player.id);
    // A turn-based room has no tick to bring a returning connection its copy of the state.
    if (isRejoin && !this.ticking) this.syncSoon();
    return { isAllowed: true, isRejoin };
  }

  /**
   * A spectator comes to watch: welcomed with the players and the room, probed for their ping and the
   * room's clock like a player, and the game hears it (onSpectatorJoin). Nothing they do counts as playing.
   */
  private watch(spectator: Player): { isAllowed: true; isRejoin: boolean } | { isAllowed: false; code: RoomErrorCode; message?: string } {
    const door = this.spectatorDoor(spectator.id);
    if (door && !door.isAllowed) return door;
    const isRejoin = this.spectators.has(spectator.id);
    this.spectators.set(spectator.id, spectator);
    this.presence.set(spectator.id, newPresence(this.now(), {}));
    const probeIntervalSec = this.ticking ? ROOM_LIMITS.probeIntervalSec : null;
    this.sendText(
      spectator.id,
      JSON.stringify({ type: "welcome", me: shownPlayer(spectator), isSpectator: true, players: this.list(), room: this.settings(), spectatorCount: this.spectators.size, hostPlayerId: this.hostPlayerId, awayChecks: { idleTimeoutSec: null, hiddenTimeoutSec: null }, endsAt: this.endsAt, probeIntervalSec } satisfies ServerMessage),
    );
    this.probe(spectator.id);
    // A new connection starts with nothing of the state: a full copy comes with the next round.
    if (this.server.stateSyncEnabled) {
      this.stateTracker?.forget(spectator.id);
      this.fullCopyPlayerIds.add(spectator.id);
    }
    if (!isRejoin) {
      this.listingChanged = true;
      this.run(() => this.server.onSpectatorJoin?.(this.state, spectator, this.api));
      this.tellRoom();
    }
    // A turn-based room has no tick to bring them their copy of the state, nor a handler that did.
    if (!this.ticking && (isRejoin || !this.server.onSpectatorJoin)) this.syncSoon();
    return { isAllowed: true, isRejoin };
  }

  /** A spectator stops watching: gone at once, and the game hears it (onSpectatorLeave) once the handler running now is done. */
  private stopWatching(spectatorId: string): void {
    const spectator = this.spectators.get(spectatorId);
    if (!spectator) return;
    this.spectators.delete(spectatorId);
    this.presence.delete(spectatorId);
    this.buckets.delete(spectatorId);
    this.latestSlots.delete(spectatorId);
    this.stateSkippedPlayerIds.delete(spectatorId);
    this.fullCopyPlayerIds.delete(spectatorId);
    this.listingChanged = true;
    this.soon(() => {
      if (this.ended) return;
      this.run(() => this.server.onSpectatorLeave?.(this.state, spectator, this.api));
      this.tellRoom();
    });
  }

  /**
   * A player's connection closed: they left (closed the game, or followed a move), or it was lost. A
   * lost player stays in the match as away for reconnectTimeoutSec (onAway, reason "lost"), then
   * leaves it with their seat held for a while, so they can still come straight back. A spectator just goes.
   */
  leave(playerId: string, reason: "left" | "lost" = "left"): void {
    if (this.spectators.has(playerId)) return this.stopWatching(playerId);
    if (this.held.has(playerId)) {
      // A player out of the match went for good: their seat is free. A lost connection keeps it held.
      if (reason === "left") {
        this.held.delete(playerId);
        this.listingChanged = true;
        this.dirty = true;
      }
      return;
    }
    const player = this.players.get(playerId);
    if (!player) return;
    const reconnectTimeoutSec = this.server.reconnectTimeoutSec ?? ROOM_LIMITS.defaultReconnectTimeoutSec;
    if (reason === "lost" && !this.ended && reconnectTimeoutSec > 0) {
      // A second close, or the runtime's close after the room already dropped them, changes nothing.
      if (this.kept.get(playerId) === "lost") return;
      this.kept.set(playerId, "lost");
      this.reconnectUntilMs.set(playerId, this.now() + reconnectTimeoutSec * 1000);
      this.presence.get(playerId)?.unansweredProbes.clear();
      this.listingChanged = true;
      this.dirty = true;
      if (this.server.onAway) this.run(() => this.server.onAway!(this.state, player, this.api, "lost"));
      this.broadcastPlayers();
      return;
    }
    this.out(playerId);
    if (this.ended) return;
    if (reason === "lost") this.hold(player, "lost");
    this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason }));
    this.broadcastPlayers();
  }

  /** Take a player out of the match, forgetting what the room knew about them while they were in. */
  private out(playerId: string): void {
    this.players.delete(playerId);
    this.latestSlots.delete(playerId);
    this.stateSkippedPlayerIds.delete(playerId);
    this.fullCopyPlayerIds.delete(playerId);
    this.kept.delete(playerId);
    this.reconnectUntilMs.delete(playerId);
    this.presence.delete(playerId);
    this.buckets.delete(playerId);
    this.listingChanged = true;
    this.dirty = true;
  }

  /** Hold a seat for a player out of the match, for the game's seatHoldDurationSec. */
  private hold(player: Player, reason: Held["reason"]): number {
    const seatHoldDurationSec = this.server.seatHoldDurationSec ?? ROOM_LIMITS.defaultSeatHoldDurationSec;
    if (seatHoldDurationSec > 0) this.held.set(player.id, { player, reason, untilMs: this.now() + seatHoldDurationSec * 1000 });
    this.listingChanged = true;
    this.dirty = true;
    return seatHoldDurationSec;
  }

  /** When this room counts a player as away (welcome's awayChecks), by the game's settings and what their game asked for. */
  private checks(playerId: string): AwayChecks {
    return { idleTimeoutSec: this.idleTimeoutSecFor(playerId), hiddenTimeoutSec: this.ticking ? ROOM_LIMITS.hiddenTimeoutSec : null };
  }

  /** Seconds without input before a player counts as idle, or null if nobody checks for them. */
  private idleTimeoutSecFor(playerId: string): number | null {
    const idleCheck = this.server.idleCheck ?? "server";
    const serverTimeoutSec = this.server.idleTimeoutSec ?? ROOM_LIMITS.defaultIdleTimeoutSec;
    if (idleCheck === "off") return null;
    if (idleCheck === "server") return serverTimeoutSec;
    const asked = this.presence.get(playerId)?.clientIdle ?? {};
    if (asked.idleCheckEnabled === false) return null;
    return asked.idleTimeoutSec ?? serverTimeoutSec;
  }

  /**
   * A player walked away: idle (they didn't answer "Still there?", or the room heard nothing for
   * longer), or their game hidden too long in a real-time room. The game's onAway decides; otherwise
   * they leave the match with their seat held, and with awayMode "lobby" are sent to the lobby.
   */
  private walkAway(playerId: string, reason: Exclude<AwayReason, "lost">): void {
    const player = this.players.get(playerId);
    if (!player || this.ended || this.kept.has(playerId)) return;
    if (this.server.onAway) {
      const presence = this.presence.get(playerId);
      if (presence) presence.hiddenAtMs = undefined;
      this.kept.set(playerId, reason);
      this.listingChanged = true;
      this.dirty = true;
      this.run(() => this.server.onAway!(this.state, player, this.api, reason));
      return;
    }
    this.out(playerId);
    const seatHoldDurationSec = this.hold(player, reason);
    this.sendText(playerId, JSON.stringify({ type: "away", reason, seatHoldDurationSec } satisfies ServerMessage));
    this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason }));
    this.broadcastPlayers();
    if (this.server.awayMode === "lobby" && this.lobbyRoomCode && this.transport.moveTo) {
      this.sentAway.add(playerId);
      this.transport.moveTo(this.lobbyRoomCode, { players: [player], joinData: null });
    } else if (!seatHoldDurationSec) this.transport.close(playerId, SEAT_GONE_CLOSE_CODE, "Seat no longer held");
  }

  /** A player who walked away is back: kept in the room by onAway, or coming back to their held seat. */
  private back(playerId: string, joinData?: unknown, asked?: ClientIdle): RoomErrorCode | null {
    const player = this.players.get(playerId);
    if (player) {
      if (!this.kept.delete(playerId)) return null;
      this.reconnectUntilMs.delete(playerId);
      this.cameBack(player);
      return null;
    }
    const held = this.holding(playerId);
    if (!held) return null;
    const checked = checkRoomData(joinData);
    const joined = this.join(held.player, { joinData: checked.isValid ? checked.checkedData : null, clientIdle: asked });
    return joined.isAllowed ? null : joined.code;
  }

  /** A player kept away is playing again: the game hears it (onBack), and every player's list shows them playing. */
  private cameBack(player: Player): void {
    this.listingChanged = true;
    this.dirty = true;
    this.run(() => this.server.onBack?.(this.state, player, this.api));
    this.broadcastPlayers();
  }

  /** Players whose time to reconnect ran out leave the match, with their seat held (onLeave, reason "lost"). */
  private expireReconnects(): void {
    if (this.ended) return;
    const nowMs = this.now();
    for (const [id, untilMs] of [...this.reconnectUntilMs]) {
      if (untilMs > nowMs) continue;
      const player = this.players.get(id);
      this.reconnectUntilMs.delete(id);
      if (!player) continue;
      this.out(id);
      this.hold(player, "lost");
      this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason: "lost" }));
      this.broadcastPlayers();
    }
  }

  /** When the first player whose connection dropped runs out of time to reconnect, or null if nobody is reconnecting. */
  nextReconnectDeadlineMs(): number | null {
    let deadlineMs: number | null = null;
    for (const untilMs of this.reconnectUntilMs.values()) if (deadlineMs === null || untilMs < deadlineMs) deadlineMs = untilMs;
    return deadlineMs;
  }

  /** Whether a player is in the match without a connection: dropped, and still within reconnectTimeoutSec. */
  private isLost(playerId: string): boolean {
    return this.kept.get(playerId) === "lost";
  }

  /**
   * Check on the room's players, every half a minute or so: players the room hasn't heard from in
   * longer than the idle check allows (a game that doesn't ask "Still there?"), and players whose
   * game has been hidden too long in a real-time room, walk away; held seats that ran out are freed,
   * and those players' connections close.
   */
  sweep(): void {
    if (this.ended) return;
    this.expireReconnects();
    const nowMs = this.now();
    for (const [id, presence] of [...this.presence]) {
      // Spectators give no input, so they're never idle or away; a dead connection still drops them.
      if (this.kept.has(id) || this.spectators.has(id)) continue;
      const idleTimeoutSec = this.idleTimeoutSecFor(id);
      if (idleTimeoutSec !== null && nowMs - presence.seenAtMs >= idleTimeoutSec * 1000 + IDLE_ASK_MS + IDLE_GRACE_MS) this.walkAway(id, "idle");
      else if (this.ticking && presence.hiddenAtMs !== undefined && nowMs - presence.hiddenAtMs >= ROOM_LIMITS.hiddenTimeoutSec * 1000) this.walkAway(id, "hidden");
    }
    // Rooms that don't tick check their probes here.
    for (const id of [...this.presence.keys()]) this.checkAnswers(id);
    for (const [id, held] of [...this.held]) {
      if (held.untilMs > nowMs) continue;
      this.held.delete(id);
      this.listingChanged = true;
      this.dirty = true;
      this.transport.close(id, SEAT_GONE_CLOSE_CODE, "Seat no longer held");
    }
  }

  /** A raw text message from a client. Returns an error code if it was refused. */
  receive(playerId: string, text: string): RoomErrorCode | null {
    if (this.spectators.has(playerId)) return this.receiveFromSpectator(playerId, text);
    const player = this.players.get(playerId);
    const isHeld = !player && this.held.has(playerId);
    if ((!player && !isHeld) || this.ended) return "ended";
    const sizeBytes = text.length > ROOM_LIMITS.maximumGameMessageSizeBytes ? text.length : utf8ByteCount(text);
    const isTooBig = sizeBytes > ROOM_LIMITS.maximumGameMessageSizeBytes;
    let parsed: unknown;
    let isParsed = false;
    if (!isTooBig) {
      try {
        parsed = JSON.parse(text);
        isParsed = true;
      } catch {
        // Refused below, once it's counted.
      }
    }
    const message = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    // A probe answer is automatic, not the player's input: it isn't counted, takes no token and doesn't count as seen.
    if (message.type === "probe_answer" && this.answer(playerId, message.probeNumber)) return null;
    this.messageCount++;
    this.countTraffic("inbound", message.type === "message" ? messageTypeOf(message.data) : typeof message.type === "string" ? ZAISMA_MESSAGE_TYPE : NO_MESSAGE_TYPE, 1, sizeBytes);
    if (isTooBig) return "too_big";
    if (!this.take(playerId)) return "too_fast";
    if (!isParsed) return "bad_message";
    // Out of the match with their seat held, a player can only come back; anything else waits.
    if (isHeld) return message.type === "back" ? this.back(playerId, message.joinData, message as ClientIdle) : null;
    const presence = this.presence.get(playerId);
    if (presence) presence.seenAtMs = this.now();
    switch (message.type) {
      case "room":
        return this.hostChange(playerId, message);
      case "kick":
        return this.hostKick(playerId, message);
      case "here":
        return null;
      case "probe_answer":
        // It answers no probe: counted and limited like any message, so answers can't dodge the limit.
        return null;
      case "idle":
        this.walkAway(playerId, "idle");
        return null;
      case "hidden":
        if (presence && this.ticking) presence.hiddenAtMs ??= this.now();
        return null;
      case "shown":
        if (presence) presence.hiddenAtMs = undefined;
        return this.kept.get(playerId) === "hidden" ? this.back(playerId) : null;
      case "back":
        return this.back(playerId);
      case "message":
        this.input(() => this.server.onMessage?.(this.state, player!, message.data, this.api));
        return null;
      case "block":
        return this.sessionBlock(playerId, message, true);
      case "unblock":
        return this.sessionBlock(playerId, message, false);
      default:
        return "bad_message";
    }
  }

  /** Bytes from a client (a binary frame). Returns an error code if they were refused. */
  receiveBytes(playerId: string, bytes: Uint8Array): RoomErrorCode | null {
    // Spectators send nothing; limited like anyone's messages, so refusing them costs little.
    if (this.spectators.has(playerId)) return this.ended ? "ended" : this.take(playerId) ? "spectator_cannot_send" : "too_fast";
    const player = this.players.get(playerId);
    const isHeld = !player && this.held.has(playerId);
    if ((!player && !isHeld) || this.ended) return "ended";
    this.messageCount++;
    this.countTraffic("inbound", BYTES_MESSAGE_TYPE, 1, bytes.length);
    if (bytes.length > ROOM_LIMITS.maximumGameMessageSizeBytes) return "too_big";
    if (!this.take(playerId)) return "too_fast";
    // Out of the match with their seat held, a player's bytes wait like their messages.
    if (isHeld) return null;
    if (!this.server.onBytes) return "bad_message";
    const presence = this.presence.get(playerId);
    if (presence) presence.seenAtMs = this.now();
    this.input(() => this.server.onBytes!(this.state, player!, bytes, this.api));
    return null;
  }

  /**
   * A spectator's text: answers to the room's probes, and nothing else (spectator_cannot_send). Kept out of
   * the room's message count and traffic, so watching stays off the meter, and limited like anyone's messages.
   */
  private receiveFromSpectator(spectatorId: string, text: string): RoomErrorCode | null {
    if (this.ended) return "ended";
    if (text.length <= ROOM_LIMITS.maximumGameMessageSizeBytes) {
      try {
        const message = JSON.parse(text) as { type?: unknown; probeNumber?: unknown } | null;
        if (message?.type === "probe_answer" && this.answer(spectatorId, message.probeNumber)) return null;
      } catch {
        // Refused below.
      }
    }
    return this.take(spectatorId) ? "spectator_cannot_send" : "too_fast";
  }

  /**
   * A player's message or bytes for the game server: through the queue of handlers, or at once for a
   * game server that only queues them for its next call (QUEUES_INPUT).
   */
  private input(handler: () => HandlerResult<S>): void {
    if (!(this.server as { [QUEUES_INPUT]?: boolean })[QUEUES_INPUT]) return this.run(handler);
    try {
      handler();
    } catch (error) {
      console.error("Game server error:", error);
    }
  }

  /** Count messages in or out for the room's traffic: how many, their bytes and the largest of them, and how many went to a backed-up player. */
  private countTraffic(direction: TrafficDirection, messageType: string, messageCount: number, sizeBytes: number, backedUpMessageCount = 0): void {
    if (messageCount === 0) return;
    const traffic = this.traffic;
    if (direction === "inbound") traffic.inboundSizeBytes += sizeBytes;
    else {
      traffic.outboundMessageCount += messageCount;
      traffic.outboundSizeBytes += sizeBytes * messageCount;
    }
    let kept = traffic.messageTypes.get(`${direction} ${messageType}`);
    if (!kept) {
      const typeCountKey = direction === "inbound" ? "inboundTypeCount" : "outboundTypeCount";
      if (traffic[typeCountKey] >= MAXIMUM_MESSAGE_TYPE_COUNT && messageType !== OTHER_MESSAGE_TYPE) return this.countTraffic(direction, OTHER_MESSAGE_TYPE, messageCount, sizeBytes, backedUpMessageCount);
      if (messageType !== OTHER_MESSAGE_TYPE) traffic[typeCountKey]++;
      kept = { messageType, direction, messageCount: 0, sizeBytes: 0, largestSizeBytes: 0, backedUpMessageCount: 0 };
      traffic.messageTypes.set(`${direction} ${messageType}`, kept);
    }
    kept.messageCount += messageCount;
    kept.sizeBytes += sizeBytes * messageCount;
    kept.largestSizeBytes = Math.max(kept.largestSizeBytes, sizeBytes);
    kept.backedUpMessageCount += backedUpMessageCount;
  }

  /** The room's traffic since the last time it was taken, and start counting afresh. */
  takeTraffic(): RoomTraffic {
    const traffic = this.traffic;
    this.traffic = { inboundSizeBytes: 0, outboundMessageCount: 0, outboundSizeBytes: 0, messageTypes: new Map(), inboundTypeCount: 0, outboundTypeCount: 0 };
    return { inboundSizeBytes: traffic.inboundSizeBytes, outboundMessageCount: traffic.outboundMessageCount, outboundSizeBytes: traffic.outboundSizeBytes, messageTypes: [...traffic.messageTypes.values()] };
  }

  /**
   * The host: the room's first player, when the game server has host controls on. A host whose
   * connection dropped hands over to the next player meanwhile, so host controls never wait on them.
   */
  get hostPlayerId(): string | null {
    if (!this.server.hostControlsEnabled) return null;
    for (const id of this.players.keys()) if (!this.isLost(id)) return id;
    return null;
  }

  /**
   * The host kicks a player, when the game server allows it. Players can't type the message (no free
   * text between strangers), so the kicked player is told the host removed them.
   */
  private hostKick(playerId: string, message: Record<string, unknown>): RoomErrorCode | null {
    if (this.hostPlayerId !== playerId) return "not_allowed";
    const kickedId = message.playerId;
    if (typeof kickedId !== "string" || kickedId === playerId || !this.players.has(kickedId)) return "bad_message";
    this.kick(kickedId, { message: "The host removed you from this room.", keepOut: message.keepOut === true });
    return null;
  }

  /** The host hides, shows, opens, closes, turns friends' Join on or off, names or labels the room, when the game server allows it. */
  private hostChange(playerId: string, message: Record<string, unknown>): RoomErrorCode | null {
    if (this.hostPlayerId !== playerId) return "not_allowed";
    const change: Partial<RoomSettings> = tidyRoomInfo(message as RoomInfo);
    if (typeof message.isListed === "boolean") change.isListed = message.isListed;
    if (typeof message.isOpen === "boolean") change.isOpen = message.isOpen;
    if (typeof message.friendJoinsEnabled === "boolean") change.friendJoinsEnabled = message.friendJoinsEnabled;
    this.settle(change);
    this.dirty = true;
    return null;
  }

  private settings(): RoomSettings {
    return { isListed: this.isListed, isOpen: this.isOpen, friendJoinsEnabled: this.friendJoinsEnabled, name: this.name, labels: { ...this.labels } };
  }

  /** Change isListed, isOpen, friendJoinsEnabled, the name or labels, and tell everyone in the room. */
  private settle(change: Partial<RoomSettings>): void {
    const next = { ...this.settings(), ...change };
    if (JSON.stringify(next) === JSON.stringify(this.settings())) return;
    this.isListed = next.isListed;
    this.isOpen = next.isOpen;
    this.friendJoinsEnabled = next.friendJoinsEnabled;
    this.name = next.name;
    this.labels = next.labels;
    this.listingChanged = true;
    this.tellRoom();
  }

  /** Tell every player and spectator the room's settings and how many are watching. */
  private tellRoom(): void {
    this.sendEach(this.everyone(), JSON.stringify({ type: "room", room: this.settings(), spectatorCount: this.spectators.size } satisfies ServerMessage));
  }

  /** The players and the spectators: everyone the room tells what happens in it. */
  private everyone(): string[] {
    return [...this.players.keys(), ...this.spectators.keys()];
  }

  /** Whether the room sends to this player: they're in the match, or watching. */
  private isViewer(playerId: string): boolean {
    return this.players.has(playerId) || this.spectators.has(playerId);
  }

  /** Who a broadcast reaches (BroadcastOptions.audience). Anything else is a mistake in the game's call. */
  private audienceOf(audience: unknown, call: string): string[] {
    if (audience === undefined || audience === "everyone") return this.everyone();
    if (audience === "players") return [...this.players.keys()];
    if (audience === "spectators") return [...this.spectators.keys()];
    throw new Error(`${call}'s audience is ${typeof audience === "string" ? JSON.stringify(audience.slice(0, 40)) : typeof audience}. Give "everyone", "players" or "spectators", or leave it out for everyone.`);
  }

  /**
   * Keep the room, or stop keeping it (room.setKept). The transport may turn a keep back (a game past its
   * free storage), so it hears through listingChanged; players are told nothing.
   */
  setKept(isKept: boolean): void {
    if (this.isKept === isKept || this.ended) return;
    this.isKept = isKept;
    this.listingChanged = true;
    this.dirty = true;
  }

  /** A room made for some of this room's players (room.reserve). Mistakes in the game's call throw. */
  private reserve(reserveOptions: ReserveOptions & { roomCode?: unknown }): string {
    if (!this.transport.reserve) throw new Error("Reserved rooms aren't available here");
    if (this.ended) throw new Error("This room has ended");
    // A game server in a sandbox picks the code itself (roomCode), since it tells the game at once.
    const given = closed(reserveOptions, ["playerIds", "setupData", "isListed", "friendJoinsEnabled", "isKept", "name", "labels", "roomCode"], "room.reserve");
    const playerIds = [...new Set(Array.isArray(given.playerIds) ? given.playerIds : [])].filter((id) => this.players.has(id));
    if (!playerIds.length) throw new Error("room.reserve needs playerIds of players who are in this room");
    const checked = checkRoomData(given.setupData);
    if (!checked.isValid) throw new Error(`room.reserve's setupData must be plain JSON up to ${ROOM_LIMITS.maximumRoomDataSizeBytes / 1024} KB`);
    this.limit();
    const nameAndLabels = tidyRoomInfo({ name: given.name ?? null, labels: given.labels ?? {} });
    const newRoomCode = typeof given.roomCode === "string" && isRoomCode(given.roomCode) ? given.roomCode : roomCode();
    this.transport.reserve(newRoomCode, {
      playerIds,
      setupData: checked.checkedData,
      isListed: given.isListed === true,
      ...(given.friendJoinsEnabled === false ? { friendJoinsEnabled: false } : {}),
      ...(given.isKept === true ? { isKept: true } : {}),
      name: nameAndLabels.name ?? null,
      labels: nameAndLabels.labels ?? {},
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
    });
    return newRoomCode;
  }

  /** Send players to another room of the game (room.moveTo). Mistakes in the game's call throw. */
  private moveTo(toRoomCode: string, moveOptions: MoveOptions): void {
    if (!this.transport.moveTo) throw new Error("Moving players isn't available here");
    if (this.ended) throw new Error("This room has ended");
    if (typeof toRoomCode !== "string" || !isRoomCode(toRoomCode)) throw new Error("room.moveTo needs a room code");
    const given = closed(moveOptions, ["playerIds", "joinData"], "room.moveTo");
    const players = [...new Set(Array.isArray(given.playerIds) ? given.playerIds : [])].map((id) => this.players.get(id)).filter((player): player is Player => Boolean(player));
    if (!players.length) throw new Error("room.moveTo needs playerIds of players who are in this room");
    const checked = checkRoomData(given.joinData);
    if (!checked.isValid) throw new Error(`room.moveTo's joinData must be plain JSON up to ${ROOM_LIMITS.maximumRoomDataSizeBytes / 1024} KB`);
    this.limit();
    this.transport.moveTo(toRoomCode, { players, joinData: checked.checkedData });
  }

  /**
   * The other room's answer to room.moveTo, for onMoved. Players it took who already left, or who
   * aren't here, are left out.
   */
  moved(toRoomCode: string, answer: MoveAnswer, sent: Player[]): void {
    // The room sending a player who walked away to its lobby: if the lobby turned them away, their seat
    // here stays held, and with no seat held (seatHoldDurationSec: 0) there's nothing to stay connected for.
    if (sent.length === 1 && this.sentAway.delete(sent[0]!.id)) {
      const id = sent[0]!.id;
      if (!answer.movedPlayerIds.includes(id) && !this.players.has(id) && !this.holding(id)) this.transport.close(id, SEAT_GONE_CLOSE_CODE, "Seat no longer held");
      return;
    }
    if (this.ended || !this.server.onMoved) return;
    const who = new Map(sent.map((player) => [player.id, player]));
    const moveResult: MoveResult = {
      roomCode: toRoomCode,
      movedPlayers: answer.movedPlayerIds.map((id) => who.get(id)).filter((player): player is Player => Boolean(player)),
      refusals: answer.refusals.filter((refusal) => who.has(refusal.playerId)).map((refusal) => ({ player: who.get(refusal.playerId)!, code: refusal.code, message: refusal.message })),
    };
    this.run(() => this.server.onMoved!(this.state, moveResult, this.api));
  }

  /** Reserving rooms and moving players share one limit a minute. */
  private limit(): void {
    const nowMs = this.now();
    this.reservedAtMs = this.reservedAtMs.filter((reservedAtMs) => nowMs - reservedAtMs < 60_000);
    if (this.reservedAtMs.length >= ROOM_LIMITS.maximumReservesPerMin) throw new Error(`A room can reserve rooms or move players up to ${ROOM_LIMITS.maximumReservesPerMin} times a minute`);
    this.reservedAtMs.push(nowMs);
  }

  /** Remove a player (room.kick). Their onLeave runs once the handler that kicked them is done. */
  kick(playerId: string, kickOptions?: KickOptions): void {
    const given = closed(kickOptions ?? {}, ["message", "keepOut"], "room.kick");
    const player = this.players.get(playerId);
    const held = this.held.get(playerId);
    const isSpectator = this.spectators.has(playerId);
    if ((!player && !held && !isSpectator) || this.ended) return;
    const message = tidy(given.message, ROOM_LIMITS.maximumMessageCharacterCount) || ERROR_TEXT.kept_out;
    const isKeptOut = given.keepOut === true;
    if (isSpectator) {
      if (isKeptOut) this.keepOut({ [playerId]: message });
      this.sendText(playerId, JSON.stringify({ type: "kicked", message, isKeptOut } satisfies ServerMessage));
      this.transport.close(playerId, REFUSED_CLOSE_CODE, "Removed from the room");
      this.stopWatching(playerId);
      return;
    }
    this.known.delete(playerId);
    if (isKeptOut) this.keepOut({ [playerId]: message });
    // A player whose connection dropped has none to tell or close.
    if (!this.isLost(playerId)) {
      this.sendText(playerId, JSON.stringify({ type: "kicked", message, isKeptOut } satisfies ServerMessage));
      this.transport.close(playerId, REFUSED_CLOSE_CODE, "Removed from the room");
    }
    this.held.delete(playerId);
    this.out(playerId);
    // A player out of the match with their seat held already left it: there's no onLeave to run.
    if (!player) return;
    this.soon(() => {
      if (this.ended) return;
      this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason: "kicked" }));
      this.broadcastPlayers();
    });
  }

  /** Keep players out, newest last, up to as many as the room remembers. */
  private keepOut(players: Record<string, string> | undefined): void {
    for (const [id, message] of Object.entries(players ?? {})) {
      if (typeof message !== "string") continue;
      this.keptOut.delete(id);
      this.keptOut.set(id, message.slice(0, ROOM_LIMITS.maximumMessageCharacterCount));
      if (this.keptOut.size > REMEMBERED_PLAYER_COUNT) this.keptOut.delete(this.keptOut.keys().next().value!);
    }
  }

  /** Run now, or once the handler running now is done, so a handler never runs inside another. */
  private soon(work: () => void): void {
    if (this.depth) this.afterHandler.push(work);
    else work();
  }

  private flush(): void {
    while (!this.depth && this.afterHandler.length) this.afterHandler.shift()!();
  }

  private remember(id: string): void {
    this.known.delete(id);
    this.known.add(id);
    // Forget the oldest who isn't here or holding a seat, so no player in the match drops out of what the room knows of them.
    if (this.known.size > REMEMBERED_PLAYER_COUNT) {
      for (const oldest of this.known) {
        if (oldest === id || this.players.has(oldest) || this.holding(oldest) !== null) continue;
        this.known.delete(oldest);
        break;
      }
    }
  }

  tick(tickDurationSec: number): void {
    if (this.ended) return;
    this.expireReconnects();
    this.probeDue();
    this.catchUp();
    // A room where everyone walked away stops running until someone's back.
    if (this.playingCount === 0) return;
    // State sync's round comes after onTick; without one, every tick.
    if (!this.server.onTick) return this.syncState();
    // A game server that hasn't caught up skips this tick; tickDurationSec carries the time over to the next one.
    if (this.waitingCount > 1) return;
    this.run(() => this.server.onTick!(this.state, tickDurationSec, this.api), true);
  }

  /**
   * Players who caught up: their latest-only messages go now, and in a turn-based room, players state sync
   * skipped get a full copy. Ticking rooms check each tick and at each probe answer; your own server's
   * runner also every 50 ms while isCatchingUp.
   */
  catchUp(): void {
    if (this.ended) return;
    for (const id of [...this.latestSlots.keys()]) {
      if (!this.isViewer(id) || this.isLost(id)) this.latestSlots.delete(id);
      else if (!this.isBackedUp(id)) this.sendLatest(id);
    }
    let hasCaughtUp = false;
    for (const id of [...this.stateSkippedPlayerIds]) {
      if (this.isViewer(id) && !this.isLost(id) && this.isBackedUp(id)) continue;
      this.stateSkippedPlayerIds.delete(id);
      hasCaughtUp ||= this.isViewer(id);
    }
    if (hasCaughtUp) this.syncSoon();
  }

  /** Whether anything waits for a player to catch up: latest-only messages, or a turn-based room's state. */
  get isCatchingUp(): boolean {
    return this.latestSlots.size > 0 || this.stateSkippedPlayerIds.size > 0;
  }

  /**
   * Whether a player's connection is backed up: the transport says (the socket's bufferedAmount on your
   * own server), or, in Zaisma rooms, a probe of theirs is ROOM_LIMITS.backedUpDelayMs later than their
   * ping with ROOM_LIMITS.backedUpSizeBytes or more sent since the last probe they answered.
   */
  isBackedUp(playerId: string): boolean {
    if (!this.isViewer(playerId) || this.isLost(playerId)) return false;
    if (this.transport.isBackedUp) return this.transport.isBackedUp(playerId);
    const presence = this.presence.get(playerId);
    const oldest = presence?.unansweredProbes.values().next().value;
    if (!presence || !oldest) return false;
    return this.now() - oldest.sentAtMs > (presence.pingDurationMs ?? 0) + ROOM_LIMITS.backedUpDelayMs && presence.sentByteCount - presence.answeredSentByteCount >= ROOM_LIMITS.backedUpSizeBytes;
  }

  /** The players who see the state: everyone in the match with a connection, and the spectators. */
  private stateViewerIds(): string[] {
    return this.everyone().filter((id) => !this.isLost(id));
  }

  /** Which viewers are backed up this round; a turn-based room remembers them, to send a full copy once they catch up. */
  private backedUpViewers(viewerIds: string[]): Set<string> {
    const backedUpPlayerIds = new Set(viewerIds.filter((id) => this.isBackedUp(id)));
    if (!this.ticking) for (const id of backedUpPlayerIds) this.stateSkippedPlayerIds.add(id);
    return backedUpPlayerIds;
  }

  /** A round of state sync (stateSyncEnabled): each player's view, in full or what changed since their last. */
  private syncState(): void {
    const tracker = this.stateTracker;
    if (!tracker || this.ended) return;
    const viewerIds = this.stateViewerIds();
    const stateView = this.server.stateView;
    const state = this.state;
    const round = tracker.round(state, viewerIds, stateView ? (viewerId) => stateView(state, (this.players.get(viewerId) ?? this.spectators.get(viewerId))!, this.api) : null, this.backedUpViewers(viewerIds));
    for (const problem of round.problems) console.error(`Game server error: ${problem}`);
    for (const { playerIds, frame } of round.frames) this.sendState(playerIds, frame);
  }

  /** A round of state sync once the handler running now is done, for a room with no handler about to run. */
  private syncSoon(): void {
    if (!this.server.stateSyncEnabled || this.ended) return;
    const syncs = (this.server as { [SYNCS_STATE]?: (state: S, room: Room) => HandlerResult<S> })[SYNCS_STATE];
    if (syncs) return this.run(() => syncs(this.state, this.api));
    if (this.queue) this.queue = this.queue.then(() => this.syncState());
    else this.soon(() => this.syncState());
  }

  /** For a game server that runs state sync itself: who's backed up this round, and who needs a full copy (said once). */
  private stateViewers(): { backedUpPlayerIds: string[]; fullCopyPlayerIds: string[] } {
    const fullCopyPlayerIds = [...this.fullCopyPlayerIds].filter((id) => this.isViewer(id));
    this.fullCopyPlayerIds.clear();
    return { backedUpPlayerIds: [...this.backedUpViewers(this.stateViewerIds())], fullCopyPlayerIds };
  }

  /** A frame from a game server that runs state sync itself, checked like anything a game hands the room. */
  private sendStateFrom(playerIds: unknown, frame: unknown): void {
    if (!Array.isArray(playerIds) || !frame || typeof frame !== "object") return;
    const keys = Object.keys(frame);
    if (keys.length !== 1 || (keys[0] !== "full" && !(keys[0] === "changes" && Array.isArray((frame as { changes?: unknown }).changes)))) return;
    this.sendState(
      playerIds.filter((id): id is string => typeof id === "string" && this.isViewer(id)),
      frame as StateFrame,
    );
  }

  /** Send a state frame to players in the match, with the room's clock, counted as state sync's traffic. */
  private sendState(playerIds: string[], frame: StateFrame): void {
    if (!playerIds.length) return;
    this.sendEach(playerIds, JSON.stringify({ type: "state", serverTimeMs: this.now(), ...frame } as ServerMessage), STATE_MESSAGE_TYPE);
  }

  /**
   * A game's message or bytes for some players. Reliable ones go to all of them, counting those that went to
   * a backed-up player; latest-only ones wait in a slot for each backed-up player, replacing an older one there.
   */
  private deliver(playerIds: string[], outgoing: Outgoing, delivery: ReadDelivery): void {
    const ids = playerIds.filter((id) => !this.isLost(id));
    if (!delivery.isLatestOnly) return this.sendOut(ids, outgoing, ids.filter((id) => this.isBackedUp(id)).length);
    const ready: string[] = [];
    for (const id of ids) {
      if (!this.isBackedUp(id)) {
        // Anything still waiting for them goes first, so the newest arrives last.
        if (this.latestSlots.has(id)) this.sendLatest(id);
        ready.push(id);
        continue;
      }
      let slots = this.latestSlots.get(id);
      if (!slots) this.latestSlots.set(id, (slots = new Map()));
      const slotKey = `${"frame" in outgoing ? "bytes" : "message"}:${delivery.latestKey}`;
      slots.delete(slotKey);
      slots.set(slotKey, outgoing);
      if (slots.size > ROOM_LIMITS.maximumLatestOnlySlotCount) slots.delete(slots.keys().next().value!);
    }
    this.sendOut(ready, outgoing, 0);
  }

  /** A player's waiting latest-only messages, least recently replaced first. */
  private sendLatest(playerId: string): void {
    const slots = this.latestSlots.get(playerId);
    this.latestSlots.delete(playerId);
    for (const outgoing of slots?.values() ?? []) this.sendOut([playerId], outgoing, 0);
  }

  private sendOut(playerIds: string[], outgoing: Outgoing, backedUpMessageCount: number): void {
    if ("frame" in outgoing) this.sendFrame(playerIds, outgoing.frame, backedUpMessageCount);
    else this.sendEach(playerIds, outgoing.text, outgoing.messageType, backedUpMessageCount);
  }

  /**
   * The match moves to a version published "now": every player hears it's coming at appliesAt, and when
   * isHeld (a game server with onVersionUpdate) the game server hears it too and may switch sooner.
   */
  startVersionUpdate(versionUpdate: { versionId: string; appliesAt: string; isReloading: boolean }, isHeld: boolean): void {
    if (this.ended || this.versionUpdate?.versionId === versionUpdate.versionId) return;
    this.versionUpdate = versionUpdate;
    this.sendEach(this.everyone(), JSON.stringify({ type: "versionUpdate", step: "coming", ...versionUpdate } satisfies ServerMessage));
    if (isHeld && this.server.onVersionUpdate) this.run(() => this.server.onVersionUpdate!(this.state, { versionId: versionUpdate.versionId, forcedAt: versionUpdate.appliesAt }, this.api));
  }

  /** The switch is happening: every player hears it just before the room closes their connections. */
  tellVersionUpdateNow(): void {
    if (!this.versionUpdate) return;
    this.sendEach(this.everyone(), JSON.stringify({ type: "versionUpdate", step: "now", ...this.versionUpdate } satisfies ServerMessage));
  }

  /**
   * Zaisma will end this match at endsAt (an ISO time): every player hears it and onEnding runs, once.
   * Only Zaisma rooms call it, when the game's hosting pauses.
   */
  startEnding(endsAt: string): void {
    if (this.ended || this.endsAt !== null) return;
    this.endsAt = endsAt;
    this.dirty = true;
    this.sendEach(this.everyone(), JSON.stringify({ type: "ending", endsAt } satisfies ServerMessage));
    if (this.server.onEnding) this.run(() => this.server.onEnding!(this.state, this.api));
  }

  end(message: string): void {
    if (this.ended) return;
    this.ended = true;
    this.listingChanged = true;
    const text = JSON.stringify({ type: "ended", message } satisfies ServerMessage);
    for (const id of [...this.players.keys(), ...this.held.keys(), ...this.spectators.keys()]) {
      if (this.isLost(id)) continue;
      this.sendText(id, text);
      this.transport.close(id, ENDED_CLOSE_CODE, "Match ended");
    }
    this.players.clear();
    this.spectators.clear();
    this.held.clear();
    this.kept.clear();
    this.reconnectUntilMs.clear();
    this.presence.clear();
    this.latestSlots.clear();
    this.stateSkippedPlayerIds.clear();
  }

  /** The players as every player's game lists them, with why each isn't playing. */
  private list(): ListedPlayer[] {
    return [...this.players.values()].map((player) => ({ ...shownPlayer(player), awayReason: this.kept.get(player.id) ?? null }));
  }

  /** room.broadcastBytes: one frame, built once, to the audience (everyone, by default) but exceptPlayerId. */
  private broadcastBytes(bytes: Uint8Array, broadcastOptions?: BytesBroadcastOptions): void {
    const given = closed(broadcastOptions ?? {}, ["exceptPlayerId", "fromPlayerId", "audience", "delivery", "latestKey"], "room.broadcastBytes");
    const delivery = readDelivery(given, "room.broadcastBytes", "");
    const fromPlayerId = typeof given.fromPlayerId === "string" ? given.fromPlayerId : null;
    const frame = bytesFrame(readBytes(bytes, "room.broadcastBytes"), fromPlayerId);
    this.deliver(this.audienceOf(given.audience, "room.broadcastBytes").filter((id) => id !== given.exceptPlayerId), { frame, messageType: BYTES_MESSAGE_TYPE }, delivery);
  }

  /** Send a binary frame to some players, counting it like text: toward each one's backlog, and the room's traffic. */
  private sendFrame(given: string[], frame: Uint8Array, backedUpMessageCount = 0): void {
    if (!this.transport.sendBytes) throw new Error("Sending bytes isn't available here");
    const playerIds = given.filter((id) => !this.isLost(id));
    this.countTraffic("outbound", BYTES_MESSAGE_TYPE, playerIds.length, frame.length, backedUpMessageCount);
    this.depth++;
    try {
      for (const id of playerIds) {
        this.transport.sendBytes(id, frame);
        this.sent(id, frame.length);
      }
    } finally {
      this.depth--;
      this.flush();
    }
  }

  private broadcastPlayers(): void {
    this.sendEach(this.everyone(), JSON.stringify({ type: "players", players: this.list(), hostPlayerId: this.hostPlayerId } satisfies ServerMessage));
  }

  /**
   * Send one text to several players, counting its bytes once. A player it drops for falling behind
   * leaves once everyone has it, so nobody hears of the leave before the rest of this text.
   */
  private sendEach(playerIds: Iterable<string>, text: string, messageType = ZAISMA_MESSAGE_TYPE, backedUpMessageCount = 0): void {
    const byteCount = utf8ByteCount(text);
    const ids = [...playerIds].filter((id) => !this.isLost(id));
    this.countTraffic("outbound", messageType, ids.length, byteCount, backedUpMessageCount);
    this.depth++;
    try {
      for (const id of ids) this.sendText(id, text, byteCount, null);
    } finally {
      this.depth--;
      this.flush();
    }
  }

  /**
   * Send a player a text, counting the bytes that went out to them: past
   * ROOM_LIMITS.maximumUnansweredSentBytes since the last probe they answered, they're dropped;
   * every ROOM_LIMITS.sentBytesPerProbe, they're probed, so a backed-up connection shows as a late answer.
   * A player whose connection dropped gets nothing: nothing is sent, counted or probed until they're back.
   */
  private sendText(playerId: string, text: string, byteCount = utf8ByteCount(text), messageType: string | null = ZAISMA_MESSAGE_TYPE): void {
    if (this.isLost(playerId)) return;
    this.transport.send(playerId, text);
    // sendEach counts its text once for everyone (messageType null).
    if (messageType !== null) this.countTraffic("outbound", messageType, 1, byteCount);
    this.sent(playerId, byteCount);
  }

  /** Bytes that went out to a player, for the probes and the backlog. */
  private sent(playerId: string, byteCount: number): void {
    const presence = this.presence.get(playerId);
    if (!presence) return;
    presence.sentByteCount += byteCount;
    if (presence.sentByteCount - presence.answeredSentByteCount > ROOM_LIMITS.maximumUnansweredSentBytes) this.dropBehind(playerId);
    else if (presence.sentByteCount - presence.lastProbeSentByteCount >= ROOM_LIMITS.sentBytesPerProbe) this.probe(playerId);
  }

  /** Probe a player for their ping and a clock sample. Probes aren't counted as bytes sent, so a probe never sets off another. */
  private probe(playerId: string): void {
    const presence = this.presence.get(playerId);
    if (!presence) return;
    const probeNumber = ++this.probeCount;
    const nowMs = this.now();
    presence.unansweredProbes.set(probeNumber, { sentAtMs: nowMs, sentByteCount: presence.sentByteCount });
    if (presence.unansweredProbes.size > ROOM_LIMITS.maximumUnansweredProbeCount) presence.unansweredProbes.delete(presence.unansweredProbes.keys().next().value!);
    presence.lastProbeAtMs = nowMs;
    presence.lastProbeSentByteCount = presence.sentByteCount;
    const text = JSON.stringify({ type: "probe", probeNumber, serverTimeMs: nowMs, pingDurationMs: presence.pingDurationMs } satisfies ServerMessage);
    this.transport.send(playerId, text);
    this.countTraffic("outbound", ZAISMA_MESSAGE_TYPE, 1, text.length);
  }

  /** A ticking room probes each player in the match, and each spectator, every ROOM_LIMITS.probeIntervalSec, and drops those who stopped answering. */
  private probeDue(): void {
    const nowMs = this.now();
    for (const id of this.everyone()) {
      const presence = this.presence.get(id);
      if (presence && !this.kept.has(id) && nowMs - presence.lastProbeAtMs >= ROOM_LIMITS.probeIntervalSec * 1000) this.probe(id);
    }
    for (const id of [...this.presence.keys()]) this.checkAnswers(id);
  }

  /** A player whose oldest unanswered probe is ROOM_LIMITS.probeAnswerTimeoutSec old is dropped. */
  private checkAnswers(playerId: string): void {
    if (this.isLost(playerId)) return;
    const oldest = this.presence.get(playerId)?.unansweredProbes.values().next().value;
    if (oldest && this.now() - oldest.sentAtMs >= ROOM_LIMITS.probeAnswerTimeoutSec * 1000) this.dropBehind(playerId);
  }

  /** A probe answer: the player's ping moves a quarter of the way to this sample. False if it answers no probe of theirs. */
  private answer(playerId: string, probeNumber: unknown): boolean {
    const presence = this.presence.get(playerId);
    const probe = typeof probeNumber === "number" ? presence?.unansweredProbes.get(probeNumber) : undefined;
    if (!presence || !probe) return false;
    const sampleMs = this.now() - probe.sentAtMs;
    const previousMs = presence.pingDurationMs;
    presence.pingDurationMs = Math.round(previousMs === null ? sampleMs : previousMs * 0.75 + sampleMs * 0.25);
    presence.answeredSentByteCount = probe.sentByteCount;
    for (const number of [...presence.unansweredProbes.keys()]) if (number <= (probeNumber as number)) presence.unansweredProbes.delete(number);
    // The first measurement: probe again at once, so the player's game hears its ping too, even in a room that doesn't tick.
    if (previousMs === null) this.probe(playerId);
    // An answer is when a backed-up connection shows it caught up.
    this.soon(() => this.catchUp());
    return true;
  }

  /**
   * A player whose connection can't keep up: closed at once, so the room holds no growing backlog for
   * them, and out of the match like any lost connection, once the handler running now is done. Their
   * game reconnects by itself. The runtime's close event comes later and finds them gone.
   */
  private dropBehind(playerId: string): void {
    if (!this.presence.delete(playerId)) return;
    this.transport.close(playerId, NO_ANSWER_CLOSE_CODE, "Connection too far behind");
    this.soon(() => this.leave(playerId, "lost"));
  }

  /** Token bucket per player: a short burst is fine, a flood is dropped. */
  private take(playerId: string): boolean {
    const nowMs = this.now();
    const bucket = this.buckets.get(playerId) ?? { tokenCount: ROOM_LIMITS.gameMessageBurstCount, filledAtMs: nowMs };
    bucket.tokenCount = Math.min(ROOM_LIMITS.gameMessageBurstCount, bucket.tokenCount + ((nowMs - bucket.filledAtMs) / 1000) * ROOM_LIMITS.gameMessagesPerSec);
    bucket.filledAtMs = nowMs;
    this.buckets.set(playerId, bucket);
    if (bucket.tokenCount < 1) return false;
    bucket.tokenCount -= 1;
    return true;
  }

  /**
   * Run a game server handler. A crash in game code is logged and never takes the room down. State sync's
   * round follows a turn-based room's handlers and a real-time room's tick (isTick).
   */
  private run(handler: () => HandlerResult<S> | Promise<HandlerResult<S>>, isTick = false): void {
    const isSyncing = this.stateTracker !== null && (isTick || !this.ticking);
    if (!this.queue) {
      let next: HandlerResult<S> | Promise<HandlerResult<S>>;
      this.depth++;
      try {
        next = handler();
      } catch (error) {
        console.error("Game server error:", error);
        this.depth--;
        this.flush();
        return;
      }
      this.depth--;
      if (!isPromise(next)) {
        if (next !== undefined) this.state = next as S;
        this.dirty = true;
        if (isSyncing) this.syncState();
        this.flush();
        return;
      }
      this.queue = Promise.resolve();
      const started = next;
      handler = () => started;
    }
    this.waitingCount++;
    this.queue = this.queue.then(async () => {
      this.depth++;
      try {
        const next = await handler();
        if (next !== undefined) this.state = next as S;
        this.dirty = true;
        if (isSyncing) this.syncState();
      } catch (error) {
        console.error("Game server error:", error);
      } finally {
        this.waitingCount--;
        this.depth--;
        this.flush();
      }
    });
  }
}

function isPromise<T>(given: unknown): given is Promise<T> {
  return typeof (given as { then?: unknown } | null)?.then === "function";
}

/** What the room knows about a player in the match, for the away checks. */
interface Presence {
  /** When the room last heard from them (any message but a ping or a probe answer). */
  seenAtMs: number;
  /** Since when their game has been hidden, as their game said. */
  hiddenAtMs?: number;
  /** The idle check their game asked for, for idleCheck "client". */
  clientIdle: ClientIdle;
  /** UTF-8 bytes the room has sent them since they joined, probes aside. */
  sentByteCount: number;
  /** What sentByteCount was when the last probe they answered went out. */
  answeredSentByteCount: number;
  /** What sentByteCount was when their last probe went out. */
  lastProbeSentByteCount: number;
  lastProbeAtMs: number;
  /** Probes they haven't answered yet, by probe number, oldest first. */
  unansweredProbes: Map<number, { sentAtMs: number; sentByteCount: number }>;
  /** Their smoothed round trip in milliseconds (room.pingDurationMs), or null until they answer a probe. */
  pingDurationMs: number | null;
}

/** A player's presence as they come in: nothing sent and nothing measured yet. A room waking from sleep starts its probes afresh. */
function newPresence(seenAtMs: number, clientIdle: ClientIdle): Presence {
  return { seenAtMs, clientIdle, sentByteCount: 0, answeredSentByteCount: 0, lastProbeSentByteCount: 0, lastProbeAtMs: 0, unansweredProbes: new Map(), pingDurationMs: null };
}

/** A game's message or bytes on their way out: the text or binary frame, and its type for the traffic counts. */
type Outgoing = { text: string; messageType: string } | { frame: Uint8Array; messageType: string };

/** A send's delivery as the room acts on it: latest-only, with its latestKey, or reliable. */
type ReadDelivery = { isLatestOnly: false } | { isLatestOnly: true; latestKey: string };

/** A latest-only message's latestKey when the game gives none: its type field when that's text, else "". */
function defaultLatestKey(message: unknown): string {
  const type = message && typeof message === "object" ? (message as { type?: unknown }).type : undefined;
  return typeof type === "string" ? type : "";
}

/** A send's delivery and latestKey, checked: mistakes throw, naming what to give. defaultKey is the latestKey when it gives none. */
function readDelivery(given: SendOptions, call: string, defaultKey: string): ReadDelivery {
  const { delivery, latestKey } = given;
  if (delivery !== undefined && delivery !== "reliable" && delivery !== "latest_only") throw new Error(`${call}'s delivery is ${JSON.stringify(delivery)}. Give "reliable" (the default) or "latest_only".`);
  if (latestKey !== undefined && (typeof latestKey !== "string" || latestKey.length > ROOM_LIMITS.maximumLatestKeyCharacterCount)) {
    throw new Error(`${call}'s latestKey must be text up to ${ROOM_LIMITS.maximumLatestKeyCharacterCount} characters, like "positions".`);
  }
  if (delivery !== "latest_only") return { isLatestOnly: false };
  return { isLatestOnly: true, latestKey: latestKey ?? defaultKey };
}

/** Bytes a game handed the room, as a Uint8Array: anything else is a mistake in the game's call. */
function readBytes(given: unknown, call: string): Uint8Array {
  if (given instanceof Uint8Array) return given;
  if (given instanceof ArrayBuffer) return new Uint8Array(given);
  if (ArrayBuffer.isView(given)) return new Uint8Array(given.buffer, given.byteOffset, given.byteLength);
  throw new Error(`${call} takes bytes: a Uint8Array, another typed array or an ArrayBuffer.`);
}

/** How many bytes a text takes on the wire. */
function utf8ByteCount(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The idle check a player's game asked for, from its hello or back message: a timeout within the limits, and whether to check at all. */
export function clientIdle(given: unknown): ClientIdle {
  const asked = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const out: ClientIdle = {};
  if (typeof asked.idleTimeoutSec === "number" && Number.isFinite(asked.idleTimeoutSec)) {
    out.idleTimeoutSec = Math.min(ROOM_LIMITS.maximumIdleTimeoutSec, Math.max(ROOM_LIMITS.minimumIdleTimeoutSec, Math.round(asked.idleTimeoutSec)));
  }
  if (typeof asked.idleCheckEnabled === "boolean") out.idleCheckEnabled = asked.idleCheckEnabled;
  return out;
}

/** A game's call options with only the fields it takes: anything else throws, naming the ones it does. */
function closed<T extends object>(given: T, fields: readonly string[], call: string): Partial<T> {
  if (given === null || typeof given !== "object") return {};
  for (const field of Object.keys(given)) {
    if (!fields.includes(field)) throw new Error(`${call} doesn't take ${field}. It takes: ${fields.filter((name) => name !== "roomCode").join(", ")}.`);
  }
  return given;
}

// Characters that hide text or flip its direction.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const tidy = (given: unknown, maximumCharacterCount: number) =>
  String(given ?? "")
    .normalize("NFKC")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumCharacterCount)
    .trim();

/** A name and labels within the limits, with hidden characters dropped. Fields left out stay out. */
export function tidyRoomInfo(nameAndLabels: RoomInfo): Partial<Pick<RoomSettings, "name" | "labels">> {
  const out: Partial<Pick<RoomSettings, "name" | "labels">> = {};
  if (nameAndLabels.name !== undefined) out.name = nameAndLabels.name === null ? null : tidy(nameAndLabels.name, ROOM_LIMITS.maximumNameCharacterCount) || null;
  if (nameAndLabels.labels !== undefined) {
    const labels: Record<string, string> = {};
    if (nameAndLabels.labels && typeof nameAndLabels.labels === "object") {
      for (const [labelName, labelValue] of Object.entries(nameAndLabels.labels)) {
        const key = tidy(labelName, ROOM_LIMITS.maximumLabelNameCharacterCount);
        const shown = typeof labelValue === "string" || typeof labelValue === "number" ? tidy(labelValue, ROOM_LIMITS.maximumLabelValueCharacterCount) : "";
        if (key && shown && Object.keys(labels).length < ROOM_LIMITS.maximumLabelCount) labels[key] = shown;
      }
    }
    out.labels = labels;
  }
  return out;
}
