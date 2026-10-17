/**
 * The Zaisma SDK, typed: this file is its reference. One script tag, from the game's top folder,
 * gives a browser game its players (Zaisma accounts and guests) and multiplayer rooms:
 *
 *   <script src="_zaisma/v1.js"></script>
 *
 * Plain JavaScript, no dependencies, MIT licensed, and every part is optional.
 *
 * For editor and compiler checks, save this file beside your game's folder, not in it, since uploads
 * take no .ts files. On Zaisma it's served beside the SDK as _zaisma/v1.d.ts; in Zaisma's repository
 * it's packages/sdk/zaisma.d.ts. Then put `/// <reference path="../zaisma.d.ts" />` (and in JavaScript,
 * `// @ts-check`) at the top of your script, or list it in jsconfig.json or tsconfig.json. The
 * global `Zaisma` is then typed, and its types are `Zaisma.Room`, `Zaisma.JoinOptions` and so on (in
 * JavaScript, give `let room = null` a JSDoc `@type {Zaisma.Room | null}`, as the example games do).
 *
 * Names follow Zaisma's naming guide: whole words, the unit in the name (`idleTimeoutSec`), and is, has
 * or can for yes or no. An option or event the SDK doesn't take is refused with the list of the ones it
 * does (`error.code` "unknown_option" or "unknown_event"), so a misspelled or old one never goes
 * quietly unused. Errors carry `error.code` ({@link Zaisma.ErrorCode}).
 *
 * Player passes, for rooms and your own servers, need the game played on its zaisma.com page, which
 * checks the browser on Play: joining fails with `error.code` "unchecked" when it couldn't, or when the
 * game was opened anywhere else, and "not_on_zaisma" when the game isn't hosted on Zaisma at all.
 *
 * @example
 * const room = await Zaisma.joinRoom();         // joins ?room=CODE if the link has one, else makes a room
 * room.me; room.players; room.roomCode; room.inviteUrl;
 * room.on("message", (message) => {});          // from the game server
 * room.on("players", (players) => {});
 * room.on("connectionStatus", (connectionStatus) => {});
 * room.on("ended", (message) => {});
 * room.send({ move: "left" });
 * room.leave();
 * await Zaisma.invite(room);                    // share sheet on phones, copies the link elsewhere
 */
declare namespace Zaisma {
  /** The SDK's version: 1 for _zaisma/v1.js. */
  const sdkVersionNumber: 1;

  /** The game's slug, as in zaisma.com/g/<slug>, or null outside Zaisma. */
  const gameSlug: string | null;

  /**
   * This tab's player, with their player pass: the signed-in Zaisma account, with the same player ID in
   * every game, or a guest. joinRoom gets one by itself; call this to let the player into a server of
   * your own. Kept for the tab, so a guest who reloads stays the same guest, and renewed when it has
   * under 10 minutes left or the player signed in or out. Fails with error.code "unchecked" when the
   * game isn't played on its zaisma.com page, "not_on_zaisma" when it isn't hosted on Zaisma, and
   * "account_needed" for a guest when the game needs an account for multiplayer or the whole game
   * (its account_requirement setting): ask them to sign in with {@link player.signIn}.
   */
  function player(): Promise<PlayerWithPass>;

  namespace player {
    /**
     * An account's public profile by player ID, what anyone sees of it, like a name for a leaderboard
     * row. Fails with error.code "no_player" for a guest's ID or a deleted account's, and
     * "bad_player_id" for anything that isn't a player ID.
     *
     * @example
     * const profile = await Zaisma.player.getProfile("player_8f3k2m"); // { id, name }
     */
    function getProfile(playerId: string): Promise<PlayerProfile>;

    /**
     * Ask a guest to sign in with their Zaisma account, without leaving the game. Zaisma's page shows a
     * small card beside the game ("Sign in" or make a free account, and "Not now"); signing in opens a
     * new tab, so the game keeps running. Resolves with the account once the player has signed in, and
     * at once when they already are. From then on {@link player} and joinRoom give the account's pass;
     * rooms the player is already in keep them as the guest they joined as, so join again to play as
     * the account. Call it when the player presses something that needs an account, like Play online
     * in a game whose multiplayer needs one (joinRoom failed with "account_needed"), or Save to
     * leaderboard. A second call while the card is up waits for the same answer. Fails with error.code
     * "sign_in_declined" when the player chose Not now, and "not_on_zaisma" when the game isn't played
     * on its zaisma.com page. There's no time limit: the player may take a few minutes.
     *
     * @example
     * try {
     *   room = await Zaisma.joinRoom();
     * } catch (error) {
     *   if (error.code !== "account_needed") throw error;
     *   await Zaisma.player.signIn(); // { id, name, kind: "account" }
     *   room = await Zaisma.joinRoom();
     * }
     */
    function signIn(): Promise<Player>;
  }

  /**
   * Join a room: the one joinOptions.roomCode names, else the one the page's link points to
   * (?room=CODE), else a new room. Resolves once the room has let the player in, so room.me and
   * room.players are set.
   *
   * Fails with an error whose code says why and whose message says it in words. The room won't take
   * the player: full, closed (to new players), ended, kept_out (removed for the rest of the match),
   * refused (the game server's canJoin said no; the message is its refusalMessage), month_limit (the
   * game has used this month's multiplayer time). No player pass: unchecked, or account_needed for a
   * guest when the game needs accounts (see {@link player}). The
   * call is set up wrong: unknown_option, bad_room_code, bad_server_url, not_on_zaisma (no serverUrl
   * outside Zaisma). Or connection_closed (the connection closed first, say the game left or the player
   * joined from another tab) and request_failed (Zaisma didn't answer). {@link ErrorCode} has them all.
   *
   * @example
   * const room = await Zaisma.joinRoom();
   * Zaisma.joinRoom({ joinData: { character: "knight" } });   // for the game server's canJoin and onJoin
   * Zaisma.joinRoom({ isListed: false });                       // a new room that's never listed: a private match
   * Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });
   * Zaisma.joinRoom({ idleTimeoutSec: 300 });                   // ask "Still there?" after 5 minutes without input
   * Zaisma.joinRoom({ serverUrl: "wss://play.example.com" });  // your own game server
   */
  function joinRoom(joinOptions?: JoinOptions): Promise<Room>;

  /** Room browsing: the game's listed rooms, which show on its Zaisma page and to the game itself. */
  const rooms: Rooms;

  /** The game's own game server outside any room: requests to its onRequest. */
  const server: Server;

  /**
   * Invite friends: opens the share sheet on phones, otherwise copies the room's invite link (the
   * game's page without a room). Call it from a button in your game, like on a "waiting for players" screen.
   *
   * @example
   * if ((await Zaisma.invite(room)) === "copied") inviteButton.textContent = "Link copied";
   */
  function invite(room?: Room | null): Promise<InviteStatus>;

  /**
   * Zaisma's text filter: whether what a player typed can be shown to other players, as on Zaisma's
   * own pages. Names and labels players type show on Zaisma's pages only if they pass it; inside your
   * game they're yours to look after, and this is there if you want it. Checks up to 500 characters.
   *
   * @example
   * const { isAllowed, text } = await Zaisma.filterText(typedName);
   */
  function filterText(text: string): Promise<FilteredText>;

  /**
   * Zaisma's ready-made Players panel, where a player can mute, block and report the others. Games
   * where players interact must offer mute, block and report: call this from your game's menu, or build
   * your own with room.mute, room.block and room.report. On Zaisma, Report opens Zaisma's own report
   * form beside the game, and the player is muted once the report is sent. Restyle it with CSS on
   * #zaisma-safety.
   */
  function openSafetyPanel(room: Room): void;

  /** What {@link joinRoom} takes. Every option is optional. */
  interface JoinOptions {
    /** A room's code: six characters, like "K7Q2MX". By default, the code in the page's link (?room=), else a new room. */
    roomCode?: string;
    /**
     * Your own game server's full address, like "wss://play.example.com" (wss://, ws://, https:// or
     * http://), instead of Zaisma rooms. Add it to the game's own servers on Zaisma first, so the game
     * is allowed to connect to it.
     */
    serverUrl?: string;
    /** false: a new room that never shows in room lists, like a private match. Counts only when this player makes the room. */
    isListed?: boolean;
    /** A new room's name, like "Ana's castle": up to 40 characters. Counts only when this player makes the room. */
    name?: string;
    /**
     * A new room's labels, which players can filter rooms by, like { Mode: "Classic", Map: "Docks" }: up
     * to 4, names up to 16 characters and values up to 24. Counts only when this player makes the room.
     */
    labels?: Record<string, string>;
    /**
     * What the player brings into the room, for the game server's canJoin and onJoin, like the character
     * they picked: plain JSON, up to 4 KB. It comes from the player's browser, so check it like any message.
     */
    joinData?: unknown;
    /**
     * Seconds without input before the player is asked "Still there?", from 30 to 86400. By default, the
     * game server's idleTimeoutSec (600, 10 minutes).
     */
    idleTimeoutSec?: number;
    /**
     * false: never ask "Still there?" in this game. The room's own check still applies, except where the
     * game server's idleCheck is "client", as with the relay.
     */
    idleCheckEnabled?: boolean;
  }

  /** What {@link Rooms.quickJoin} takes: joinRoom's options but roomCode, and region. */
  interface QuickJoinOptions extends Omit<JoinOptions, "roomCode"> {
    /** Look for a room in this region only: a continent code, like "EU", as in {@link RoomList.regions}. */
    region?: string;
    /** Look for a room with these labels, like { Mode: "Classic" }; a new room gets them. */
    labels?: Record<string, string>;
  }

  /** What {@link Rooms.list} takes. */
  interface ListOptions {
    /** Rooms in this region only: a continent code, like "EU", as in {@link RoomList.regions}. */
    region?: string;
    /** Rooms with these labels only, like { Mode: "Classic" }. */
    labels?: Record<string, string>;
  }

  /** What {@link Move.join} takes: joinRoom's options but roomCode and serverUrl, which are the move's own. */
  interface MoveJoinOptions extends Omit<JoinOptions, "roomCode" | "serverUrl"> {}

  /** What {@link Room.kick} takes. */
  interface KickOptions {
    /** Keep them out for the rest of the match. */
    keepOut?: boolean;
  }

  /** What {@link Room.setInfo} takes. Leave a field out to keep it; null clears it. */
  interface RoomInfo {
    /** The room's name, like "Ana's castle": up to 40 characters. */
    name?: string | null;
    /** The room's labels, like { Mode: "Classic", Map: "Docks" }: up to 4, names up to 16 characters and values up to 24. */
    labels?: Record<string, string> | null;
  }

  /** Room browsing: the game's listed rooms, which show on its Zaisma page and to the game itself. */
  interface Rooms {
    /**
     * The room code the player's link points to (?room=CODE), or null. Check it to show a menu or a
     * character picker first, then join with what the player picked: joinRoom and quickJoin both follow the link.
     */
    readonly linkedRoomCode: string | null;
    /**
     * The game's listed rooms on Zaisma, for a game's own lobby or server browser: rooms with space
     * first (the player's country, then region, then the busiest), up to 50. Never who's in them.
     * Fails with error.code "not_on_zaisma" in a game that isn't hosted on Zaisma.
     *
     * @example
     * const { rooms, playing, regions } = await Zaisma.rooms.list();
     * Zaisma.rooms.list({ region: "EU", labels: { Mode: "Classic" } });   // one region, or rooms with these labels
     */
    list(listOptions?: ListOptions): Promise<RoomList>;
    /**
     * Drop the player into a match: the room their link points to if it has space, otherwise a listed
     * room with space (nearby and busy first), otherwise a new room.
     *
     * @example
     * const room = await Zaisma.rooms.quickJoin();
     * Zaisma.rooms.quickJoin({ region: "EU", labels: { Mode: "Classic" } });   // a room like that with space, else a new one with those labels
     */
    quickJoin(quickJoinOptions?: QuickJoinOptions): Promise<Room>;
  }

  /** The game's own game server outside any room ({@link server}). */
  interface Server {
    /**
     * Send a request to the game's own game server, its onRequest(player, request, server), outside
     * any room, and get back what it answers: for a leaderboard, a shop or a daily reward, in
     * single-player games too. The player's pass goes with it, so the server knows who's asking and
     * the player can't pretend to be someone else. The request is plain JSON, up to 16 KB; say what
     * it's for in its type, like a room message. On Zaisma, the game server is the one in your
     * upload's zaisma-server/ folder (or zaisma-server.js); give serverUrl for your own.
     *
     * Fails with error.code: no_request_handler (the game server has no onRequest), game_server_error
     * (onRequest threw, answered something that isn't plain JSON or over 1 MB, or took over 10
     * seconds; you see why with the game server's errors), request_limit (the game has used this
     * month's free requests, 1 million on Zaisma), too_big, bad_request (not plain JSON), slow_down
     * (over about 120 a minute from one address), bad_pass, account_needed, unchecked,
     * game_unavailable, bad_origin, busy, bad_server_url, not_on_zaisma (no serverUrl outside
     * Zaisma), unknown_option and request_failed.
     *
     * @example
     * const top = await Zaisma.server.request({ type: "leaderboard" });
     * const { coinCount } = await Zaisma.server.request({ type: "claimDailyReward" });
     * Zaisma.server.request({ type: "buy", itemId: "sword" }, { serverUrl: "https://play.example.com" }); // your own server
     */
    request(request: unknown, requestOptions?: RequestOptions): Promise<unknown>;
  }

  /** Options for {@link Server.request}. */
  interface RequestOptions {
    /** Your own game server's address, like "https://play.example.com", instead of Zaisma's. The Node runner answers requests on the same port as its rooms. */
    serverUrl?: string;
  }

  /** A room the player is in: one live match, running one copy of the game server. */
  interface Room {
    /** The room's code, six characters like "K7Q2MX". It changes when the game server moves the player (the "moved" event). */
    readonly roomCode: string;
    /** This player. */
    readonly me: Player;
    /** Players in the room right now, in join order, this player included. */
    readonly players: readonly Player[];
    /** The host's player ID, when the game server gives the host controls (the relay does), else null. */
    readonly hostPlayerId: string | null;
    /** Where the connection stands; the "connectionStatus" event says when it changes. */
    readonly connectionStatus: ConnectionStatus;
    /** The room's link on Zaisma, like "https://zaisma.com/g/sky-hopper?room=K7Q2MX", or null outside Zaisma. */
    readonly inviteUrl: string | null;
    /** Shown in room lists. A room that isn't still works by code and link. */
    readonly isListed: boolean;
    /** Taking new players. A closed room lets back only players who were in it. */
    readonly isOpen: boolean;
    /** The room's name, like "Ana's castle", or null. */
    readonly name: string | null;
    /** The room's labels, like { Mode: "Classic", Map: "Docks" }. */
    readonly labels: Readonly<Record<string, string>>;

    /**
     * Send a message to the game server: plain JSON, up to 16 KB, about 30 a second at most. Send input
     * when it changes, not every frame. Nothing is sent while the player is away.
     */
    send(message: unknown): void;
    /** Leave the room for good. */
    leave(): void;
    /**
     * Show or hide the room in room lists. From the room's host when the game uses the relay; with a
     * game server of your own, the server decides (its room.setListed). The "room" event says when it changed.
     */
    setListed(isListed: boolean): void;
    /**
     * Open or close the room to new players; players who were in it can still come back. From the
     * room's host when the game uses the relay; with a game server of your own, the server decides (its
     * room.setOpen). The "room" event says when it changed.
     */
    setOpen(isOpen: boolean): void;
    /**
     * Name and label the room. From the room's host when the game uses the relay; with a game server of
     * your own, the server decides (its room.setInfo). Names and labels players type show on Zaisma's
     * pages only if they pass Zaisma's text filter ({@link filterText}).
     */
    setInfo(nameAndLabels: RoomInfo): void;
    /**
     * The host removes a player, when the game server gives the host controls (the relay does). They're
     * told the host removed them; keepOut keeps them out for the rest of the match.
     */
    kick(playerId: string, kickOptions?: KickOptions): void;
    /** Whether a player is muted or blocked: hide their emotes and phrases. */
    isMuted(playerId: string): boolean;
    /** Mute a player for this room. The "muted" event says the list changed. */
    mute(playerId: string): void;
    /** Unmute a player, and unblock them. */
    unmute(playerId: string): void;
    /** Block a player: muted in every room this tab joins. */
    block(playerId: string): void;
    /** Report a player to Zaisma, with what happened in the player's own words if they gave any (details). Nothing about the reporting player is sent. */
    report(playerId: string, reason: ReportReason, details?: string): Promise<ReportAnswer>;

    /**
     * Listen for an event. Listening is optional: without "move" and "back" listeners, the SDK follows
     * a move and rejoins by itself; with one, your game decides when.
     *
     * @example
     * room.on("message", (message) => {});
     * room.on("players", (players) => {});
     * room.on("move", (move) => { showLoading(); move.follow(); });
     */
    on<EventName extends keyof RoomEvents>(event: EventName, listener: RoomEvents[EventName]): this;
    /** Stop listening. */
    off<EventName extends keyof RoomEvents>(event: EventName, listener: RoomEvents[EventName]): this;
  }

  /** A room's events, each with what its listener gets. */
  interface RoomEvents {
    /** A message from the game server: the game's own, as it sent it. With the relay, { fromPlayerId, data }. */
    message: (message: any) => void;
    /** Players joined, left, walked away or came back; the same list as room.players. */
    players: (players: readonly Player[]) => void;
    /** Where the connection stands, as room.connectionStatus. "away" while the player is out of the match. */
    connectionStatus: (connectionStatus: ConnectionStatus) => void;
    /** The match ended (the game server's room.end), with its message. The connection closes. */
    ended: (message: string) => void;
    /** The game server or the host removed the player from the room. The connection closes. */
    kicked: (kicked: Kicked) => void;
    /** The room's listing, name or labels changed: room.isListed, room.isOpen, room.name and room.labels have the new ones. */
    room: (settings: RoomSettings) => void;
    /**
     * The game server is sending the player to another room (its room.reserve or room.moveTo). Without
     * a listener the room follows by itself; with one, call move.follow() when your game is ready, or
     * leave and move.join() it as a new room object.
     */
    move: (move: Move) => void;
    /** This room object moved to another room: same object, new code. A "players" event with the new list follows. */
    moved: (roomCode: string) => void;
    /**
     * "Still there?": true when it's time to ask, after idleTimeoutSec without input. Listening replaces
     * Zaisma's small "Still there?" plate (restyle the plate with CSS on #zaisma-still-there instead, if you
     * like). false: they answered, or the 30 seconds are up and the room is told they walked away.
     */
    idle: (isAsking: boolean) => void;
    /**
     * The player walked away: out of the match, with their seat held for seatHoldDurationSec, unless the
     * game server decides (its onAway). Any input brings them back.
     */
    away: (away: Away) => void;
    /**
     * The player came back after their held seat ran out. Listening turns off rejoining by itself:
     * call back.rejoin() to rejoin their old room (it fails if the room is full or over).
     */
    back: (back: Back) => void;
    /** Who's muted or blocked changed: every muted and blocked player's ID. */
    muted: (playerIds: string[]) => void;
    /** The room sent an error, like too_fast. Joining fails with the same code when the room won't take the player. */
    error: (error: RoomError) => void;
  }

  /** A player, as the room shows them to everyone. */
  interface Player {
    /** Their player ID, like "player_8f3k2m". An account's is the same in every game; a guest's is temporary. */
    id: string;
    /** The name shown for them: the account's name, or a guest's like "Swift Otter 42". */
    name: string;
    /** A signed-in Zaisma account, or a guest. */
    kind: PlayerKind;
  }

  /** A signed-in Zaisma account, or a guest. */
  type PlayerKind = "guest" | "account";

  /** What anyone sees of an account ({@link player.getProfile}). */
  interface PlayerProfile {
    /** The account's player ID, the same in every game. */
    id: string;
    name: string;
  }

  /** This tab's player and their player pass ({@link player}). */
  interface PlayerWithPass extends Player {
    /**
     * The player pass: a standard EdDSA JWT any server can check against the keys at
     * https://rooms.zaisma.com/.well-known/jwks.json. It proves only who the player is: its sub is the
     * player's ID, kind says guest or account, aud is the game. A guest's pass also carries their name;
     * an account's name comes from its profile (https://rooms.zaisma.com/v1/players/<id>). An account's
     * pass says who it can chat with, never its age: who_can_chat (nobody, friends or anyone, the
     * player's own setting), when anyone an opaque chat_group (chat_group_…) that differs in every
     * game, and friend_player_ids, its friends' player IDs (up to 200). Your own server checks two
     * players with canChat(first, second) from @zaisma/game-server before passing chat between them;
     * guests never chat.
     */
    pass: string;
    /** When the pass runs out, as an ISO time in UTC. */
    expiresAt: string;
  }

  /** Where a room's connection stands. "away": the player walked away and is out of the match until they're back. */
  type ConnectionStatus = "connecting" | "open" | "reconnecting" | "away" | "closed";

  /** Whether a room shows in room lists and takes new players, and its name and labels. */
  interface RoomSettings {
    isListed: boolean;
    isOpen: boolean;
    name: string | null;
    labels: Record<string, string>;
  }

  /** Why the player was removed from the room, and whether they're kept out for the rest of the match. */
  interface Kicked {
    /** Why, in words to show the player. */
    message: string;
    isKeptOut: boolean;
  }

  /** The game server is sending the player to another room ({@link RoomEvents.move}). */
  interface Move {
    /** The room they're being sent to. */
    roomCode: string;
    /** Move this room object there: the old connection closes and the new one opens. */
    follow(): void;
    /** Join it as a new room object instead, on the same server as this one: leave this one first. */
    join(moveJoinOptions?: MoveJoinOptions): Promise<Room>;
  }

  /** The player walked away ({@link RoomEvents.away}). */
  interface Away {
    /** "idle": no input and no answer to "Still there?". "hidden": the game was hidden for 2 minutes in a real-time room. */
    reason: "idle" | "hidden";
    /** How long the room holds their seat, in seconds. */
    seatHoldDurationSec: number;
  }

  /** The player is back after their held seat ran out ({@link RoomEvents.back}). */
  interface Back {
    /** Their old room. */
    roomCode: string;
    /** Rejoin it. Fails if it's full or over. */
    rejoin(): void;
  }

  /** An error the room sent. */
  interface RoomError {
    code: RoomErrorCode;
    /** What happened, in words. */
    message: string;
  }

  /**
   * The codes a room's errors have, in its "error" event and when joining fails:
   * - full: the room has no space.
   * - closed: the room is closed to new players.
   * - ended: the match is over.
   * - kept_out: the player was removed for the rest of the match.
   * - refused: the game server's canJoin turned them away.
   * - month_limit: the game has used this month's multiplayer time; new rooms open again next month (UTC).
   * - account_needed: the player is a guest, and the game needs a Zaisma account for multiplayer or the whole game.
   * - game_unavailable: the game can't be played right now.
   * - bad_pass: the player pass wasn't accepted (the SDK gets a new one and tries once more).
   * - too_big: a message over 16 KB, or joinData over 4 KB.
   * - too_fast: more messages than the room takes (about 30 a second).
   * - bad_message, no_hello, not_allowed: a message the room couldn't read, didn't expect, or doesn't allow from this player.
   * - busy, no_room: the room couldn't take the player right now, or doesn't exist.
   */
  type RoomErrorCode =
    | "full"
    | "closed"
    | "ended"
    | "kept_out"
    | "refused"
    | "month_limit"
    | "account_needed"
    | "game_unavailable"
    | "bad_pass"
    | "too_big"
    | "too_fast"
    | "bad_message"
    | "no_hello"
    | "not_allowed"
    | "busy"
    | "no_room";

  /**
   * The codes a request's errors have ({@link Server.request}), from Zaisma or the Node runner alike:
   * - bad_request: not plain JSON with the player's pass.
   * - too_big: a request over 16 KB.
   * - bad_pass: the player pass wasn't accepted (the SDK gets a new one and tries once more).
   * - account_needed: the player is a guest, and the game needs a Zaisma account for multiplayer or the whole game.
   * - game_unavailable: the game can't be played right now.
   * - no_request_handler: the game's server has no onRequest.
   * - game_server_error: onRequest threw, answered something that isn't plain JSON or over 1 MB, or took over 10 seconds.
   * - request_limit: the game has used this month's free requests; they work again next month (UTC).
   * - slow_down: too many requests from this address; try again in a minute.
   * - bad_origin: the request didn't come from the game's own page.
   * - busy: Zaisma couldn't answer right now; try again soon.
   */
  type RequestErrorCode =
    | "bad_request"
    | "too_big"
    | "bad_pass"
    | "account_needed"
    | "game_unavailable"
    | "no_request_handler"
    | "game_server_error"
    | "request_limit"
    | "slow_down"
    | "bad_origin"
    | "busy";

  /**
   * The codes the SDK's errors have: a room's ({@link RoomErrorCode}), and:
   * - unchecked: no player pass, because the game isn't played on its zaisma.com page or Zaisma couldn't check the browser.
   * - unknown_option, unknown_event: a call the SDK doesn't take; the message lists what it does.
   * - slow_down: too many calls; try again in a minute.
   * - no_rooms: the game doesn't use Zaisma rooms.
   * - bad_report: a report whose reason isn't a {@link ReportReason}, or whose player ID isn't one.
   * - bad_origin: the call didn't come from the game's own page.
   * - not_on_zaisma: the game isn't hosted on Zaisma, so it has no player passes, sign-in or room lists, and joinRoom needs a serverUrl.
   * - sign_in_declined: the player chose Not now when the game asked them to sign in ({@link player.signIn}).
   * - bad_room_code: not a room code, which is six characters like "K7Q2MX", from 2 to 9 and A to Z without I or O.
   * - bad_server_url: a serverUrl that isn't a full wss://, ws://, https:// or http:// address.
   * - connection_closed: the connection to the room closed before it let the player in; the message says why.
   * - request_failed: Zaisma didn't answer (no connection, or a problem on Zaisma's side); try again.
   * - And a request's ({@link RequestErrorCode}).
   */
  type ErrorCode =
    | RoomErrorCode
    | RequestErrorCode
    | "unchecked"
    | "unknown_option"
    | "unknown_event"
    | "slow_down"
    | "no_rooms"
    | "bad_report"
    | "bad_origin"
    | "not_on_zaisma"
    | "sign_in_declined"
    | "no_player"
    | "bad_player_id"
    | "bad_room_code"
    | "bad_server_url"
    | "connection_closed"
    | "request_failed";

  /**
   * An error from the SDK: its code says what went wrong, for the game to branch on, and its message
   * says it in one sentence, with what to fix.
   *
   * @example
   * try { room = await Zaisma.joinRoom(); }
   * catch (error) { if (error.code === "full") showRoomFull(); else showError(error.message); }
   */
  interface SdkError extends Error {
    code: ErrorCode;
  }

  /** What {@link invite} did: "shared" from the share sheet, "copied" the link, "cancelled" the share sheet, or "failed" to do either. */
  type InviteStatus = "shared" | "copied" | "cancelled" | "failed";

  /** What {@link filterText} found. */
  interface FilteredText {
    /** Whether it can be shown to other players. */
    isAllowed: boolean;
    /**
     * Why not: "contact" (a link, a handle, an email, a phone number or a contact app) or "words" (slurs
     * or sexual words); null when it's allowed.
     */
    reason: "contact" | "words" | null;
    /** The text tidied up: hidden characters and extra spaces gone. */
    text: string;
  }

  /** What happened, in a player report: harassment, hate (or threats), sexual (behavior), cheating or other. */
  type ReportReason = "harassment" | "hate" | "sexual" | "cheating" | "other";

  /** Zaisma's answer to a report. */
  interface ReportAnswer {
    isReported: true;
  }

  /** The game's listed rooms ({@link Rooms.list}). */
  interface RoomList {
    /** Rooms with space first (the player's country, then region, then the busiest), then full and closed ones. Up to 50, in the region asked for. */
    rooms: ListedRoom[];
    /** Everyone playing in the game's rooms everywhere, hidden rooms too (for "playing now"), and how many listed rooms are closed. */
    playing: { playerCount: number; roomCount: number; closedRoomCount: number };
    /** Rooms a player could join right now, everywhere. */
    joinableRoomCount: number;
    /** Listed rooms taking players, full ones too, in the region and with the labels asked for: the ones listed plus the ones past them (moreOpenRoomCount). */
    openRoomCount: number;
    /** The regions with listed rooms, busiest first, for a region filter. */
    regions: { region: string; name: string; roomCount: number; playerCount: number }[];
    /** The region the rooms are filtered to, or null for everywhere. */
    region: string | null;
    /** Open rooms in that region past the ones listed. */
    moreOpenRoomCount: number;
    /** Labels worth filtering by: ones several rooms have, with a handful of values. */
    filters: { label: string; values: string[] }[];
  }

  /** A room in a room list. Never who's in it. */
  interface ListedRoom {
    roomCode: string;
    /** Players in the match, not counting players who walked away. */
    playerCount: number;
    /** Seats held for players coming back or on their way: a room has space while playerCount + heldSeatCount < maximumPlayerCount. */
    heldSeatCount: number;
    maximumPlayerCount: number;
    /** false: closed, so only players who were in it can come back. */
    isOpen: boolean;
    /**
     * Where the room runs: the country its first player connected from, and its region (a continent),
     * like { countryCode: "DE", countryName: "Germany", region: "EU" }; null when unknown.
     */
    location: { countryCode: string; countryName: string; region: string | null } | null;
    /** In the same region as the player asking. */
    isNear: boolean;
    /** The room's name, or null. */
    name: string | null;
    /** The room's labels. */
    labels: Record<string, string>;
    /** The room's link on Zaisma, to join it or pass it on. */
    inviteUrl: string;
  }
}

interface Window {
  /** The Zaisma SDK: see the Zaisma namespace. */
  Zaisma: typeof Zaisma;
}
