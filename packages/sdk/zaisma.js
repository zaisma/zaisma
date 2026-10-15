/*
 * The Zaisma SDK. On Zaisma, games include it with one tag:
 *   <script src="_zaisma/v1.js"></script>   (relative, from the game's top folder)
 * Plain JavaScript, no dependencies, MIT licensed. Every part is optional. Names follow docs/NAMING.md:
 * they say what they hold, and an option or event the SDK doesn't know is refused, never ignored.
 *
 *   const room = await Zaisma.joinRoom();     // joins ?room=CODE if present, else makes a room
 *   room.me; room.players; room.roomCode; room.inviteUrl;
 *   room.on("message", (messageData) => {});  // from the game server
 *   room.on("players", (players) => {});
 *   room.on("connection_status", (connectionStatus) => {});  // "connecting" | "open" | "reconnecting" | "away" | "closed"
 *   room.on("ended", (message) => {});
 *   room.send({ move: "left" });
 *   room.leave();
 *   Zaisma.joinRoom({ serverUrl: "wss://my-server.example" });  // your own game server
 *   Zaisma.joinRoom({ joinData: { character: "knight" } });    // for the game server's canJoin and onJoin, up to 4 KB
 *
 * Players who walk away. The SDK pings the room every 25 seconds (a connection that stops answering
 * comes back by itself) and says goodbye as the page goes. After 10 minutes without input (the game
 * server's idleTimeoutSec) it asks "Still there?" for 30 seconds, then tells the room; in a real-time
 * room, the game hidden for 2 minutes counts too. The room then takes the player out of the match and
 * holds their seat for a few minutes, unless the game server decides (onAway). Any input brings them back.
 *   room.on("idle", (isAsking) => {});        // true: ask "Still there?" yourself (replaces Zaisma's small plate);
 *                                             // false: they answered, or time's up
 *   room.on("away", ({ awayReason, seatHoldDurationSec }) => {});  // out of the match ("idle" or "hidden")
 *   room.on("back", (back) => { back.rejoin(); });  // back after the seat ran out: listening turns off
 *                                             // rejoining by itself; rejoin() fails if the room is full or over
 *   Zaisma.joinRoom({ idleTimeoutSec: 300 }); // seconds without input before "Still there?" (30 to 86400)
 *   Zaisma.joinRoom({ idleCheck: "off" });    // never ask (the room's own check still applies, except with the relay)
 * When the game server sends the player to another room (room.reserve or room.moveTo), the room
 * follows by itself: same room object, new roomCode, a "moved" event, then "players" with the new list.
 *   room.on("moved", (roomCode) => {});
 *   room.on("move", (move) => { showLoading(); move.follow(); });  // step in: listening to "move" turns
 *                                             // off following by itself; move.follow() goes when you're ready
 *   room.on("kicked", ({ message, isKeptOut }) => {});  // removed from the room by the game server or the host
 *   room.hostPlayerId;                        // the host's player ID when the game server gives the host controls, else null
 *   room.kick(playerId, { keepOut: true });   // the host removes a player (relay games; keepOut: for the rest of the match)
 *   await Zaisma.invite(room);                // share sheet on phones, copies the link elsewhere
 *
 * Room browsing. Listed rooms show on the game's Zaisma page and to the game itself:
 *   Zaisma.rooms.linkedRoomCode;              // the room code the player's link points to, or null
 *   const { rooms, playingNow, regions } = await Zaisma.rooms.list();
 *     // rooms: [{ roomCode, playerCount, heldSeatCount, maximumPlayerCount, isOpen, name, labels, location, isNearby, inviteUrl }]
 *     // location: { countryCode: "DE", countryName: "Germany", continentCode: "EU" } or null
 *   Zaisma.rooms.list({ regionCode: "EU", labels: { Mode: "Classic" } });  // one region, or rooms with these labels
 *   const room = await Zaisma.rooms.quickJoin();           // the linked room, else a busy one with space, else a new one
 *   Zaisma.rooms.quickJoin({ regionCode: "EU", labels: { Mode: "Classic" } });  // a room like that with space, else a new one with those labels
 *   Zaisma.joinRoom({ isListed: false });     // a new room that's never listed (a private match)
 *   Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });  // name and label a new room
 *   room.isListed; room.isOpen; room.name; room.labels; room.on("room_settings", ({ isListed, isOpen, name, labels }) => {});
 *   room.setListed(false); room.setOpen(false); room.setName("Ana's castle"); room.setLabels({ Mode: "Classic" });
 *                                             // with the relay, from the room's host (its first player);
 *                                             // otherwise the game server decides (room.setName)
 *   await Zaisma.filterText("what a player typed");  // { isAllowed, reason, text }: Zaisma's text filter
 * Names and labels players type show on Zaisma's pages only if they pass the filter. Inside your game
 * they're yours to look after: filterText is there if you want it.
 * A closed room takes no new players; players who were in it can still come back.
 *
 * Player safety. Games where players interact must offer mute, block and report:
 *   Zaisma.openSafetyPanel(room);           // ready-made panel; call it from your menu
 *   room.isMuted(playerId);                 // true if muted or blocked: hide their emotes/phrases
 *   room.on("muted", (mutedPlayerIds) => {});  // the muted list changed
 *   room.mute(playerId); room.unmute(playerId); room.block(playerId); room.report(playerId, reason)
 * On Zaisma, the panel's Report opens Zaisma's own report plate beside the game, and the
 * player is muted once the report is sent.
 *
 * Every error the SDK gives has a code (error.code), lowercase snake_case: the room's (full, closed,
 * ended, kept_out, refused, month_limit, bad_pass, too_big, game_unavailable, ...) and the SDK's own
 * (unchecked, not_on_zaisma, bad_room_code, unknown_option, bad_option, unknown_event,
 * connection_failed, slow_down, no_rooms).
 *
 * On Zaisma, the games Worker defines __ZAISMA__ before this file with the rooms
 * address, the game and the site. Anywhere else, pass { serverUrl } yourself.
 *
 * Player passes (for rooms and your own servers) need the game played on its zaisma.com page, which
 * checks the browser on Play: joining fails with error.code "unchecked" when it couldn't, or when the
 * game was opened anywhere else.
 */
(function () {
  "use strict";
  var config = typeof __ZAISMA__ === "object" && __ZAISMA__ ? __ZAISMA__ : {};
  var CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

  // The game's page on Zaisma, or the tester link it was opened from (a private game has no public page).
  function gamePage() {
    return config.page || "/g/" + config.game;
  }

  /** An error with a stable code (error.code), like every error the SDK gives. */
  function sdkError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  /** Refuses option names a call doesn't take, saying which it does: unknown_option, never quietly ignored. */
  function closed(options, allowed, what) {
    if (options === undefined || options === null) return null;
    if (typeof options !== "object" || Array.isArray(options)) return sdkError("bad_option", what + " takes an object with " + allowed.join(", ") + ".");
    var unknown = Object.keys(options).filter(function (name) { return allowed.indexOf(name) === -1; });
    return unknown.length ? sdkError("unknown_option", what + " doesn't take " + unknown.join(", ") + ". It takes " + allowed.join(", ") + ".") : null;
  }

  function Emitter() {
    this._on = {};
  }
  Emitter.prototype.on = function (event, listener) {
    (this._on[event] = this._on[event] || []).push(listener);
    return this;
  };
  Emitter.prototype.off = function (event, listener) {
    this._on[event] = (this._on[event] || []).filter(function (other) { return other !== listener; });
    return this;
  };
  Emitter.prototype._emit = function (event, value) {
    (this._on[event] || []).slice().forEach(function (listener) {
      try { listener(value); } catch (error) { console.error(error); }
    });
  };

  /** A call to Zaisma rooms. Refusals answer { error: { code, message } }, thrown as an error with that code. */
  function post(path, body) {
    // text/plain keeps this a simple request, so the browser needs no preflight.
    return fetch(config.rooms + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) }).then(answered);
  }

  function answered(response) {
    return response.json().then(function (answer) {
      if (!response.ok) {
        var error = answer && answer.error && typeof answer.error === "object" ? answer.error : {};
        throw sdkError(error.code || "request_failed", error.message || "Zaisma request failed");
      }
      return answer;
    }, function () {
      throw sdkError("request_failed", "Zaisma request failed");
    });
  }

  var passKey = "zaisma:pass:" + config.game;
  var passPromise = null;
  var keyPromise = null;
  var UNCHECKED = "Zaisma couldn't check this browser, so it can't play online. Reload the game to try again.";

  /**
   * The game page's key to player passes. zaisma.com gives one when Cloudflare's check on Play says
   * a real browser pressed it, so bots can't fill rooms; a game opened anywhere else gets none.
   */
  function roomKey() {
    if (!keyPromise) {
      keyPromise = new Promise(function (resolve, reject) {
        function fail(message) { reject(sdkError("unchecked", message)); }
        if (!config.site || window.parent === window) return fail("Online play works when the game is played on Zaisma.");
        // The check usually answers in a second or two, or asks the player to tap a box.
        var timer = setTimeout(function () { removeEventListener("message", onMessage); fail(UNCHECKED); }, 30000);
        function onMessage(event) {
          if (event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:room-key") return;
          removeEventListener("message", onMessage);
          clearTimeout(timer);
          if (typeof event.data.roomKey === "string") resolve(event.data.roomKey);
          else fail(UNCHECKED);
        }
        addEventListener("message", onMessage);
        window.parent.postMessage({ type: "zaisma:room-key" }, config.site);
      });
    }
    return keyPromise;
  }

  /** This tab's guest player: { id, name, pass, passExpiresAt }. Kept only for the tab, like the guest it belongs to. */
  function player() {
    if (!config.rooms) return Promise.reject(sdkError("not_on_zaisma", "Zaisma player passes only work on Zaisma"));
    try {
      var saved = JSON.parse(sessionStorage.getItem(passKey) || "null");
      if (saved && Date.parse(saved.passExpiresAt) - Date.now() > 10 * 60 * 1000) return Promise.resolve(saved);
    } catch (error) { /* storage off: fetch a new pass */ }
    if (!passPromise) {
      passPromise = roomKey().then(function (key) {
        return post("/v1/pass", { gameSlug: config.game, roomKey: key });
      }).then(function (answer) {
        var guest = { id: answer.player.id, name: answer.player.name, pass: answer.pass, passExpiresAt: answer.passExpiresAt };
        try { sessionStorage.setItem(passKey, JSON.stringify(guest)); } catch (error) { /* fine */ }
        passPromise = null;
        return guest;
      }, function (error) {
        passPromise = null;
        throw error;
      });
    }
    return passPromise;
  }

  function linkedRoomCode() {
    try {
      var code = new URLSearchParams(location.search).get("room");
      return code && CODE.test(code.toUpperCase()) ? code.toUpperCase() : null;
    } catch (error) {
      return null;
    }
  }

  function randomCode() {
    var alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(6)), function (byte) { return alphabet[byte & 31]; }).join("");
  }

  var ROOM_EVENTS = ["message", "players", "connection_status", "room_settings", "ended", "kicked", "error", "idle", "away", "back", "move", "moved", "muted"];

  function Room(options) {
    Emitter.call(this);
    this.roomCode = options.roomCode;
    this.me = null;
    this.players = [];
    this.hostPlayerId = null;
    this.connectionStatus = "connecting";
    this.inviteUrl = config.site && config.game ? config.site + gamePage() + "?room=" + this.roomCode : null;
    this.isListed = options.isListed !== false;
    this.isOpen = true;
    this.name = null;
    this.labels = {};
    this._url = options.url;
    this._pass = options.pass;
    this._newRoom = { isListed: options.isListed === false ? false : undefined, name: options.name, labels: options.labels };
    this._joinData = options.joinData;
    this._serverUrl = options.serverUrl;
    this._tries = 0;
    this._done = false;
    this._ready = null;
    // Walking away: the idle check the game asked for, when the room counts the player away (from welcome),
    // whether they're out of the match (and their connection gone too), and the last ping, pong and message.
    this._idleCheck = options.idleCheck;
    this._idleTimeoutSec = options.idleTimeoutSec;
    this._awayChecks = { idleTimeoutSec: null, hiddenTimeoutSec: null };
    this._away = false;
    this._gone = false;
    this._idleSent = false;
    this._pingAt = 0;
    this._pongAt = 0;
    this._sentAt = 0;
  }
  Room.prototype = Object.create(Emitter.prototype);

  /** Listen for one of the room's events; an event the SDK doesn't have throws (unknown_event), saying which it has. */
  Room.prototype.on = function (event, listener) {
    if (ROOM_EVENTS.indexOf(event) === -1) throw sdkError("unknown_event", 'room.on doesn\'t know "' + event + '". It takes ' + ROOM_EVENTS.join(", ") + ".");
    return Emitter.prototype.on.call(this, event, listener);
  };

  /** Send a message to the room if the connection is open. */
  Room.prototype._say = function (message) {
    if (!this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify(message));
    this._sentAt = Date.now();
  };

  // Errors that end a join for good: another try at the same room would get the same answer.
  var FINAL = { full: true, closed: true, ended: true, bad_pass: true, too_big: true, game_unavailable: true, kept_out: true, refused: true, month_limit: true };

  Room.prototype._connect = function () {
    var room = this;
    var ws = new WebSocket(this._url);
    this._ws = ws;
    watch();
    ws.onopen = function () {
      room._pingAt = room._pongAt = Date.now();
      room._say({ type: "hello", pass: room._pass, newRoom: room._newRoom, joinData: room._joinData, idleCheck: room._idleCheck, idleTimeoutSec: room._idleTimeoutSec });
    };
    ws.onmessage = function (event) {
      if (event.data === "pong") { room._pongAt = Date.now(); return; }
      var message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (message.type === "welcome") {
        var wasAway = room._away;
        room._tries = 0;
        room.me = message.me;
        room.players = message.players;
        room.hostPlayerId = message.hostPlayerId || null;
        room._awayChecks = message.awayChecks || { idleTimeoutSec: null, hiddenTimeoutSec: null };
        room._away = room._gone = room._idleSent = room._coming = room._offered = false;
        // From here on, the room's row counts this player (room lists leave them out once they've left).
        room._joinedAt = Date.now();
        if (message.roomSettings) room._settle(message.roomSettings);
        room._setConnectionStatus("open");
        if (room._moved || wasAway) { room._moved = false; room._emit("players", message.players); }
        if (room._ready) { room._ready.resolve(room); room._ready = null; }
        // In (again, after walking away or a move): the Zaisma page counts on knowing.
        if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", roomCode: room.roomCode, isJoined: true }, config.site);
        // Hidden already (a move, a reconnect): the room should know.
        if (document.hidden && room._awayChecks.hiddenTimeoutSec) room._say({ type: "hidden" });
      } else if (message.type === "away") {
        room._away = true;
        room._idleSent = room._coming = false;
        room._setConnectionStatus("away");
        room._emit("away", { awayReason: message.awayReason, seatHoldDurationSec: message.seatHoldDurationSec });
        left(room);
      } else if (message.type === "players") {
        room.players = message.players;
        room.hostPlayerId = message.hostPlayerId || null;
        room._emit("players", message.players);
      } else if (message.type === "message") {
        room._emit("message", message.data);
      } else if (message.type === "room_settings") {
        room._settle(message.roomSettings);
        room._emit("room_settings", message.roomSettings);
      } else if (message.type === "move") {
        if ((room._on.move || []).length) room._emit("move", room._move(message.roomCode));
        else room._follow(message.roomCode);
      } else if (message.type === "kicked") {
        room._done = true;
        room._emit("kicked", { message: message.message, isKeptOut: message.isKeptOut === true });
        left(room);
      } else if (message.type === "ended") {
        room._done = true;
        room._emit("ended", message.message);
        left(room);
      } else if (message.type === "error") {
        room._emit("error", { code: message.code, message: message.message });
        if (room._ready && FINAL[message.code]) {
          room._done = true;
          room._ready.reject(sdkError(message.code, message.message));
          room._ready = null;
        }
      }
    };
    ws.onclose = function (event) {
      // 4000: the match ended. 4001: refused or replaced by another tab. Neither comes back.
      if (room._done || event.code === 4000 || event.code === 4001) {
        room._done = true;
        room._setConnectionStatus("closed");
        if (room._ready) { room._ready.reject(sdkError("connection_failed", event.reason || "Couldn't join the room")); room._ready = null; }
        return;
      }
      // 4002: the room stopped holding the seat of a player who walked away. Either way, while they're
      // away, wait for them to come back before connecting again.
      if (event.code === 4002 || room._away) {
        room._ws = null;
        room._away = room._gone = true;
        room._setConnectionStatus("away");
        return;
      }
      room._setConnectionStatus("reconnecting");
      var waitMs = Math.min(8000, 500 * Math.pow(2, room._tries++));
      setTimeout(function () { if (!room._done) room._connect(); }, waitMs);
    };
  };

  /** The connection stopped answering pings (lost signal, a laptop waking up): drop it and connect again. */
  Room.prototype._lost = function () {
    var ws = this._ws;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try { ws.close(); } catch (error) { /* fine */ }
    }
    this._ws = null;
    if (this._away) { this._gone = true; return; }
    this._setConnectionStatus("reconnecting");
    var room = this;
    setTimeout(function () { if (!room._done && !room._ws) room._connect(); }, 500);
  };

  /**
   * The player is here (input, or the game shown again). Back from walking away: to their held seat,
   * or once it ran out, their old room if it has space (offered to the game first, when it listens for "back").
   */
  Room.prototype._return = function () {
    if (this._done) return;
    if (this._idleSent && !this._away) {
      this._idleSent = false;
      this._say({ type: "back" });
    }
    if (!this._away || this._coming) return;
    if (this._ws && this._ws.readyState === 1) {
      this._coming = true;
      this._say({ type: "back", joinData: this._joinData, idleCheck: this._idleCheck, idleTimeoutSec: this._idleTimeoutSec });
      return;
    }
    if (!this._gone || this._offered || this._paused) return;
    this._offered = true;
    var room = this;
    function rejoin() {
      if (room._done || room._ws) return;
      room._tries = 0;
      room._setConnectionStatus("connecting");
      room._connect();
    }
    if ((this._on.back || []).length) this._emit("back", { roomCode: this.roomCode, rejoin: rejoin });
    else rejoin();
  };

  /** Seconds without input before this room's player is asked "Still there?", or null: the game's choice, else the room's. */
  Room.prototype._idleTimeoutSecNow = function () {
    if (this._idleCheck === "off") return null;
    return typeof this._idleTimeoutSec === "number" ? this._idleTimeoutSec : this._awayChecks.idleTimeoutSec;
  };

  Room.prototype._setConnectionStatus = function (connectionStatus) {
    if (this.connectionStatus === connectionStatus) return;
    this.connectionStatus = connectionStatus;
    this._emit("connection_status", connectionStatus);
  };

  /** Send messageData to the game server. Plain JSON, up to 16 KB. Send input when it changes, not every frame. */
  Room.prototype.send = function (messageData) {
    if (!this._away) this._say({ type: "message", data: messageData });
  };

  /**
   * Show or hide the room in room lists, open or close it to new players, and name and label it.
   * Works from the room's host (its first player) when the game uses the relay; with a game server,
   * the server decides. The "room_settings" event says when it changed.
   */
  Room.prototype.setListed = function (isListed) {
    this._say({ type: "update_room", isListed: Boolean(isListed) });
  };
  Room.prototype.setOpen = function (isOpen) {
    this._say({ type: "update_room", isOpen: Boolean(isOpen) });
  };
  /** The room's name, like "Ana's castle"; null clears it. */
  Room.prototype.setName = function (name) {
    this._say({ type: "update_room", name: name === null ? null : String(name) });
  };
  /** Up to 4 labels, like { Mode: "Classic", Map: "Docks" }; null clears them. */
  Room.prototype.setLabels = function (labels) {
    this._say({ type: "update_room", labels: labels === null ? null : labels });
  };
  /**
   * The host removes a player, when the game server gives the host controls (the relay does).
   * keepOut: true keeps them out for the rest of the match. They're told the host removed them.
   */
  Room.prototype.kick = function (playerId, options) {
    var refused = closed(options, ["keepOut"], "room.kick");
    if (refused) throw refused;
    this._say({ type: "kick", playerId: playerId, keepOut: Boolean(options && options.keepOut) });
  };
  /**
   * The game server sent this player to another room: { roomCode, follow(), join(options) }. follow()
   * moves this room object there. join takes joinRoom's options and joins it as a new room object
   * instead, on the same server as this one (leave this one first).
   */
  Room.prototype._move = function (roomCode) {
    var serverUrl = this._serverUrl;
    var room = this;
    return {
      roomCode: roomCode,
      follow: function () { room._follow(roomCode); },
      join: function (options) {
        var refused = closed(options, JOIN_OPTIONS.filter(function (name) { return name !== "roomCode" && name !== "serverUrl"; }), "move.join");
        if (refused) return Promise.reject(refused);
        return connect(roomCode, Object.assign({}, options || {}, { serverUrl: serverUrl }));
      },
    };
  };
  /** Move this room object to another room of the game: the old connection closes, the new one opens. */
  Room.prototype._follow = function (roomCode) {
    if (this._done || !CODE.test(roomCode) || roomCode === this.roomCode) return;
    var old = this._ws;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try { old.close(1000, "Moved"); } catch (error) { /* fine */ }
    }
    this._ws = null;
    left(this);
    this._gone = this._coming = false;
    this.roomCode = roomCode;
    this._url = this._url.replace(/[A-Z0-9]{6}$/, roomCode);
    if (this.inviteUrl) this.inviteUrl = config.site + gamePage() + "?room=" + roomCode;
    this._newRoom = {};
    this._joinData = undefined;
    this._tries = 0;
    this._moved = true;
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", roomCode: roomCode }, config.site);
    this._setConnectionStatus("connecting");
    this._emit("moved", roomCode);
    this._connect();
  };
  Room.prototype._settle = function (roomSettings) {
    this.isListed = roomSettings.isListed;
    this.isOpen = roomSettings.isOpen;
    this.name = roomSettings.name || null;
    this.labels = roomSettings.labels || {};
  };

  // Mute lasts for this room; block lasts for every room this tab joins.
  var blockKey = "zaisma:blocked:" + config.game;
  function blockedSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(blockKey) || "[]")); } catch (error) { return new Set(); }
  }
  Room.prototype._mutedChanged = function () {
    this._emit("muted", Array.from(this._muted || []).concat(Array.from(blockedSet())));
  };
  Room.prototype.isMuted = function (playerId) {
    return Boolean((this._muted && this._muted.has(playerId)) || blockedSet().has(playerId));
  };
  Room.prototype.mute = function (playerId) {
    (this._muted = this._muted || new Set()).add(playerId);
    this._mutedChanged();
  };
  Room.prototype.unmute = function (playerId) {
    if (this._muted) this._muted.delete(playerId);
    var blocked = blockedSet();
    blocked.delete(playerId);
    try { sessionStorage.setItem(blockKey, JSON.stringify(Array.from(blocked))); } catch (error) { /* fine */ }
    this._mutedChanged();
  };
  Room.prototype.block = function (playerId) {
    var blocked = blockedSet();
    blocked.add(playerId);
    try { sessionStorage.setItem(blockKey, JSON.stringify(Array.from(blocked))); } catch (error) { /* fine */ }
    this.mute(playerId);
  };
  /** Report a player to Zaisma. reason: harassment, hate, sexual, cheating or other. Nothing about you is sent. */
  Room.prototype.report = function (playerId, reason, details) {
    var reported = this.players.filter(function (other) { return other.id === playerId; })[0];
    return post("/v1/report", { gameSlug: config.game, roomCode: this.roomCode, playerId: playerId, playerName: reported ? reported.name : "", reason: reason, details: details || "" });
  };

  Room.prototype.leave = function () {
    if (!this._done) left(this);
    this._done = true;
    if (this._ws) this._ws.close(1000, "Left");
  };

  var JOIN_OPTIONS = ["roomCode", "serverUrl", "isListed", "name", "labels", "joinData", "idleCheck", "idleTimeoutSec"];

  /** joinRoom's options, checked: names it doesn't take and values out of range are refused, saying what's allowed. */
  function joinOptionsProblem(options, allowed, what) {
    var refused = closed(options, allowed, what);
    if (refused) return refused;
    if (options.idleCheck !== undefined && options.idleCheck !== "on" && options.idleCheck !== "off") return sdkError("bad_option", 'idleCheck is "on" or "off".');
    if (options.idleTimeoutSec !== undefined && !(typeof options.idleTimeoutSec === "number" && options.idleTimeoutSec >= 30 && options.idleTimeoutSec <= 86400)) return sdkError("bad_option", "idleTimeoutSec is a number of seconds from 30 to 86400.");
    if (options.isListed !== undefined && typeof options.isListed !== "boolean") return sdkError("bad_option", "isListed is true or false.");
    return null;
  }

  /**
   * Join a room. Options:
   *   roomCode  - a room code; defaults to ?room= in the page address, else a new room
   *   serverUrl - your own game server's address (wss://...) instead of Zaisma rooms
   *   isListed  - false: a new room that never shows in room lists, like a private match
   *   name, labels - a new room's name and labels, like "Ana's castle" and { Mode: "Classic" }
   *   joinData  - plain JSON for the game server's canJoin and onJoin, like the character the player picked (up to 4 KB)
   *   idleCheck - "off": never ask "Still there?"; "on" (the default) asks after idleTimeoutSec
   *   idleTimeoutSec - seconds without input before the player is asked "Still there?" (30 to 86400);
   *               by default, the game server's idleTimeoutSec (10 minutes)
   * If the room is full, closed or over, the player was kept out or turned away, or the game has used
   * this month's multiplayer time, it fails with an error whose code says which (full, closed, ended,
   * kept_out, refused, month_limit) and whose message says why.
   */
  function joinRoom(options) {
    options = options || {};
    var refused = joinOptionsProblem(options, JOIN_OPTIONS, "joinRoom");
    if (refused) return Promise.reject(refused);
    return connect(options.roomCode ? String(options.roomCode).toUpperCase() : linkedRoomCode(), options);
  }

  function connect(roomCode, options, retried) {
    var serverUrl = options.serverUrl ? String(options.serverUrl).replace(/\/+$/, "") : null;
    if (!serverUrl && !config.rooms) return Promise.reject(sdkError("not_on_zaisma", "Pass { serverUrl } to join a room outside Zaisma"));
    if (roomCode && !CODE.test(roomCode)) return Promise.reject(sdkError("bad_room_code", "That room code isn't valid: 6 letters and numbers, like ABC234."));

    var codeReady = roomCode ? Promise.resolve(roomCode) : serverUrl ? Promise.resolve(randomCode()) : post("/v1/rooms", { gameSlug: config.game }).then(function (answer) { return answer.roomCode; });
    return Promise.all([codeReady, player()]).then(function (got) {
      var base = (serverUrl || config.rooms).replace(/^http/, "ws");
      var room = new Room({
        roomCode: got[0],
        pass: got[1].pass,
        url: base + "/v1/rooms/" + config.game + "/" + got[0],
        isListed: options.isListed,
        name: options.name,
        labels: options.labels,
        joinData: options.joinData,
        idleCheck: options.idleCheck,
        idleTimeoutSec: options.idleTimeoutSec,
        serverUrl: serverUrl,
      });
      joined.push(room);
      // Tell the Zaisma page the room code, so its Invite button and address bar point here.
      if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", roomCode: room.roomCode }, config.site);
      return new Promise(function (resolve, reject) {
        room._ready = { resolve: resolve, reject: reject };
        room._connect();
      }).catch(function (error) {
        // A pass this tab kept from before Zaisma changed its keys: get a new one and try once more.
        if (error.code !== "bad_pass" || retried) throw error;
        try { sessionStorage.removeItem(passKey); } catch (storageError) { /* fine */ }
        return connect(room.roomCode, options, true);
      });
    });
  }

  /**
   * The game's listed rooms on Zaisma:
   *   { rooms: [{ roomCode, playerCount, heldSeatCount, maximumPlayerCount, isOpen, name, labels, location, isNearby, inviteUrl }],
   *     playingNow: { playerCount, roomCount, closedRoomCount }, joinableRoomCount, openRoomCount,
   *     regions: [{ regionCode, name, roomCount, playerCount }], regionCode, moreRoomCount, labelFilters: [{ label, values }] }
   * playingNow counts everyone in the game's rooms, hidden ones too. joinableRoomCount: rooms with space;
   * openRoomCount: rooms taking players, full ones too. location is where the room runs:
   * { countryCode, countryName, continentCode }, like DE, Germany and EU. Rooms with space come first
   * (the player's country, then continent, then the busiest), up to 50; moreRoomCount says how many open
   * rooms are past those. Pass { regionCode } (a continent code, like EU) for one region, and { labels }
   * for rooms with those labels. Never who's in them. For a game's own lobby or server browser.
   */
  function listRooms(options) {
    if (!config.rooms) return Promise.reject(sdkError("not_on_zaisma", "Room lists only cover Zaisma rooms"));
    options = options || {};
    var refused = closed(options, ["regionCode", "labels"], "rooms.list");
    if (refused) return Promise.reject(refused);
    var query = [];
    if (options.regionCode) query.push("regionCode=" + encodeURIComponent(options.regionCode));
    if (options.labels) query.push("labels=" + encodeURIComponent(JSON.stringify(options.labels)));
    // The room this tab just left, so the player doesn't see themselves in it while lists catch up.
    var agoMs = recent ? Date.now() - recent.at : -1;
    var back = recent && joined.some(function (room) { return room.roomCode === recent.code && !room._done && !room._away; });
    if (agoMs >= 0 && agoMs < 30000 && !back) query.push("left=" + recent.code + "." + agoMs + "." + (Date.now() - recent.joined));
    return fetch(config.rooms + "/v1/rooms/" + config.game + (query.length ? "?" + query.join("&") : "")).then(answered);
  }

  // A room that can't take this player, so another may: month_limit is an empty room that can't open again this month.
  var RETRY = { full: true, closed: true, ended: true, month_limit: true };

  /**
   * Drop the player into a match: the room their link points to if it has space, otherwise a
   * listed room with space (nearby and busy first, in options.regionCode if given, with options.labels
   * if given), otherwise a new room. Takes joinRoom's options for the new room.
   */
  function quickJoin(options) {
    options = options || {};
    var refused = joinOptionsProblem(options, ["regionCode", "isListed", "name", "labels", "joinData", "idleCheck", "idleTimeoutSec"], "rooms.quickJoin");
    if (refused) return Promise.reject(refused);
    var joinOptions = Object.assign({}, options);
    delete joinOptions.regionCode;
    var linked = linkedRoomCode();
    function fresh() { return connect(null, joinOptions); }
    function busiest() {
      return listRooms({ regionCode: options.regionCode, labels: options.labels }).then(function (found) {
        var tries = found.rooms.filter(function (room) { return room.isOpen && room.playerCount + (room.heldSeatCount || 0) < room.maximumPlayerCount && room.roomCode !== linked; }).slice(0, 3);
        function next() {
          var room = tries.shift();
          if (!room) return fresh();
          return connect(room.roomCode, joinOptions).catch(function (error) { if (RETRY[error.code]) return next(); throw error; });
        }
        return next();
      }, fresh);
    }
    if (!linked) return busiest();
    return connect(linked, joinOptions).catch(function (error) { if (RETRY[error.code]) return busiest(); throw error; });
  }

  /**
   * Zaisma's text filter: whether what a player typed can be shown to other players, as on Zaisma's
   * own pages. Resolves to { isAllowed, reason, text }: reason is "contact" (a link, handle, email,
   * phone number or contact app), "words" (slurs or sexual words) or null; text is tidied (hidden
   * characters and extra spaces gone).
   */
  function filterText(text) {
    return post("/v1/filter", { gameSlug: config.game, text: String(text == null ? "" : text) });
  }

  /**
   * Invite friends into a room: opens the share sheet where there is one, otherwise
   * copies the room link. Resolves to "shared", "copied", "cancelled" or "failed".
   * Call it from a button in your game, such as on a "waiting for players" screen.
   */
  function invite(room) {
    var link = room && room.inviteUrl ? room.inviteUrl : config.site && config.game ? config.site + gamePage() : location.href;
    function copy() {
      if (!navigator.clipboard) return Promise.resolve("failed");
      return navigator.clipboard.writeText(link).then(function () { return "copied"; }, function () { return "failed"; });
    }
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      return navigator.share({ title: document.title, url: link }).then(function () { return "shared"; }, function (error) {
        return error && error.name === "AbortError" ? "cancelled" : copy();
      });
    }
    return copy();
  }

  var joined = [];

  // The room this tab last left and when it joined it, for its own room lists, and for the Zaisma page's (zaisma:left).
  var recent = null;
  function left(room) {
    if (room._joinedAt) recent = { code: room.roomCode, at: Date.now(), joined: room._joinedAt };
    room._joinedAt = 0;
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:left", roomCode: room.roomCode }, config.site);
  }

  /*
   * Players who walk away. Honest clients do the fast part (docs/DECISIONS.md): ping so a dead connection
   * comes back by itself, say "Still there?" after a while without input and tell the room the answer,
   * say when the game is hidden, and say goodbye as the page goes. The room keeps its own slower checks.
   */
  var PING_MS = 25000;
  var PONG_MS = 15000;
  var ASK_MS = 30000;
  var lastInput = Date.now();
  var asking = null; // { until, rooms } while "Still there?" is up
  var watching = null;

  function watch() {
    if (watching) return;
    watching = setInterval(check, 5000);
    ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"].forEach(function (type) {
      addEventListener(type, input, { capture: true, passive: true });
    });
    addEventListener("gamepadconnected", pollPads);
    pollPads();
  }

  function input() {
    lastInput = Date.now();
    if (asking) stopAsking();
    joined.forEach(function (room) { room._return(); });
  }

  // Gamepads don't send events for their buttons, so they're checked every second while one is connected.
  var pads = "";
  var padTimer = null;
  function pollPads() {
    if (padTimer || !navigator.getGamepads) return;
    padTimer = setInterval(function () {
      var now = Array.prototype.filter.call(navigator.getGamepads() || [], Boolean);
      if (!now.length) { clearInterval(padTimer); padTimer = null; return; }
      var seen = now.map(function (pad) {
        return pad.buttons.map(function (button) { return button.pressed ? 1 : 0; }).join("") + pad.axes.map(function (axis) { return Math.round(axis * 4); }).join(",");
      }).join("|");
      if (pads && seen !== pads) input();
      pads = seen;
    }, 1000);
  }

  function check() {
    var now = Date.now();
    var due = [];
    joined.forEach(function (room) {
      var ws = room._ws;
      if (room._done || !ws || ws.readyState !== 1) return;
      // A ping that went unanswered: the connection is gone, even if the browser hasn't noticed.
      if (room._pingAt > room._pongAt && now - room._pingAt > PONG_MS) return room._lost();
      if (now - room._pingAt >= PING_MS) {
        room._pingAt = now;
        ws.send("ping");
      }
      if (room._away || room._idleSent) return;
      var idleTimeoutSec = room._idleTimeoutSecNow();
      if (idleTimeoutSec !== null && now - lastInput >= idleTimeoutSec * 1000) due.push(room);
      // The room's own check hears from players who give input but whose game sends nothing for a while.
      var roomIdleTimeoutSec = room._awayChecks.idleTimeoutSec;
      if (roomIdleTimeoutSec !== null && lastInput > room._sentAt && now - room._sentAt > Math.min(240000, roomIdleTimeoutSec * 500)) room._say({ type: "here" });
    });
    if (asking && now >= asking.until) {
      var asked = asking.rooms;
      stopAsking();
      asked.forEach(function (room) {
        if (room._done || room._away || now - lastInput < ASK_MS) return;
        room._idleSent = true;
        room._say({ type: "idle" });
      });
    } else if (!asking && due.length) startAsking(due);
  }

  function startAsking(rooms) {
    asking = { until: Date.now() + ASK_MS, rooms: rooms };
    var own = false;
    rooms.forEach(function (room) {
      if ((room._on.idle || []).length) own = true;
      room._emit("idle", true);
    });
    if (!own) showStillThere();
  }

  function stopAsking() {
    var rooms = asking ? asking.rooms : [];
    asking = null;
    hideStillThere();
    rooms.forEach(function (room) { room._emit("idle", false); });
  }

  /** Zaisma's small "Still there?" plate, in the Steel look. It never covers the game; games can restyle #zaisma-still-there. */
  function showStillThere() {
    hideStillThere();
    var plate = document.createElement("div");
    plate.id = "zaisma-still-there";
    plate.setAttribute("role", "status");
    plate.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:14px;align-items:center;max-width:calc(100vw - 32px);box-sizing:border-box;padding:12px 14px 14px;font:15px/1.4 system-ui,-apple-system,sans-serif;color:#eceef0;background:linear-gradient(180deg,#262a31,#1b1e23);box-shadow:inset 1px 1px 0 rgba(255,255,255,.09),inset -1px -1px 0 rgba(0,0,0,.7),0 14px 32px rgba(0,0,0,.42);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)";
    var text = document.createElement("div");
    var title = document.createElement("strong");
    title.textContent = "Still there?";
    var note = document.createElement("div");
    note.textContent = "Tap or press any key to keep playing.";
    note.style.cssText = "color:#969ba4;font-size:13px";
    text.append(title, note);
    var here = document.createElement("button");
    here.type = "button";
    here.textContent = "I'm here";
    here.style.cssText = "font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:0 14px;border:0;background:linear-gradient(180deg,#eef0f2 0%,#b9bcc1 46%,#7d8086 100%);box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #000;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%);color:#0b0b0c;cursor:pointer;flex:none";
    here.onclick = input;
    // How long is left, as a bar that runs down along the bottom.
    var bar = document.createElement("i");
    bar.style.cssText = "position:absolute;left:0;bottom:0;height:3px;width:100%;background:#b9bcc1;transform-origin:left;transition:transform " + ASK_MS + "ms linear";
    plate.append(text, here, bar);
    document.body.appendChild(plate);
    requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.transform = "scaleX(0)"; }); });
  }

  function hideStillThere() {
    var old = document.getElementById("zaisma-still-there");
    if (old) old.remove();
  }

  // Hidden and shown again: the room counts a real-time game hidden for 2 minutes as away; coming back counts as input.
  document.addEventListener("visibilitychange", function () {
    joined.forEach(function (room) {
      if (!room._done && room._awayChecks.hiddenTimeoutSec) room._say({ type: document.hidden ? "hidden" : "shown" });
    });
    if (!document.hidden) input();
  });

  // Goodbye as the page goes, so the room lets the player go at once instead of waiting for pings to stop.
  addEventListener("pagehide", function () {
    joined.forEach(function (room) {
      var ws = room._ws;
      if (room._done || !ws) return;
      ws.onclose = null;
      ws.onmessage = null;
      try { ws.close(1000, "Left"); } catch (error) { /* fine */ }
      room._ws = null;
      room._paused = true;
    });
  });
  // Back from the browser's back-forward cache: join again, or wait for the player if they'd walked away.
  addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    joined.forEach(function (room) {
      if (!room._paused || room._done) return;
      room._paused = false;
      if (room._away) { room._gone = true; return; }
      room._tries = 0;
      room._setConnectionStatus("reconnecting");
      room._connect();
    });
  });

  // The Zaisma page says when a player report was sent from its plate: mute them, as the panel's own form does.
  window.addEventListener("message", function (event) {
    if (!config.site || event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:reported") return;
    var playerId = event.data.playerId;
    joined.forEach(function (room) {
      if (room.players.some(function (other) { return other.id === playerId; })) room.mute(playerId);
    });
  });

  /** Hand a player report to the Zaisma page. If no Zaisma page answers (the game runs somewhere else), use our own form. */
  function handOff(room, p, opened, fallback) {
    if (!config.site || window.parent === window) return fallback();
    var answered = false;
    function listen(event) {
      if (event.origin === config.site && event.source === window.parent && event.data && event.data.type === "zaisma:report-open") {
        answered = true;
        window.removeEventListener("message", listen);
        opened();
      }
    }
    window.addEventListener("message", listen);
    window.parent.postMessage({ type: "zaisma:report", roomCode: room.roomCode, player: { id: p.id, name: p.name } }, config.site);
    setTimeout(function () {
      window.removeEventListener("message", listen);
      if (!answered) fallback();
    }, 800);
  }

  var REASONS = [["harassment", "Harassing or bullying"], ["hate", "Hate or threats"], ["sexual", "Sexual behavior"], ["cheating", "Cheating"], ["other", "Something else"]];

  /** A ready-made mute, block and report panel. Games open it from their own menu. */
  function openSafetyPanel(room) {
    var old = document.getElementById("zaisma-safety");
    if (old) old.remove();
    var wrap = document.createElement("div");
    wrap.id = "zaisma-safety";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Players");
    // Zaisma's Steel look: gunmetal plates with the cut corner. Games can restyle #zaisma-safety.
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(4,5,7,.6);display:grid;place-items:center;font:15px/1.4 system-ui,-apple-system,sans-serif;color:#eceef0";
    var box = document.createElement("div");
    box.style.cssText = "background:linear-gradient(180deg,#262a31,#1b1e23);box-shadow:inset 1px 1px 0 rgba(255,255,255,.09),inset -1px -1px 0 rgba(0,0,0,.7),0 14px 32px rgba(0,0,0,.42);clip-path:polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,0 100%);padding:18px;width:min(420px,92vw);max-height:80vh;overflow:auto";
    wrap.appendChild(box);
    var btn = "font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:0 12px;border:0;background:linear-gradient(180deg,#30353d,#22262c);box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%);color:#eceef0;cursor:pointer";
    function close() { wrap.remove(); }
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    function render(note) {
      box.textContent = "";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
      var h = document.createElement("strong");
      h.textContent = "Players";
      var x = document.createElement("button");
      x.textContent = "Close";
      x.style.cssText = btn;
      x.onclick = close;
      head.append(h, x);
      box.appendChild(head);
      if (note) {
        var n = document.createElement("p");
        n.textContent = note;
        n.style.cssText = "margin:0 0 10px;color:#b9e7a6";
        box.appendChild(n);
      }
      var others = room.players.filter(function (p) { return !room.me || p.id !== room.me.id; });
      if (!others.length) {
        var none = document.createElement("p");
        none.textContent = "Nobody else is here.";
        none.style.color = "#969ba4";
        box.appendChild(none);
      }
      others.forEach(function (p) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;align-items:center;padding:10px 0;box-shadow:inset 0 1px 0 #000,inset 0 2px 0 rgba(255,255,255,.05)";
        var name = document.createElement("span");
        name.textContent = p.name + (room.isMuted(p.id) ? " (muted)" : "");
        name.style.flex = "1";
        var mute = document.createElement("button");
        mute.textContent = room.isMuted(p.id) ? "Unmute" : "Mute";
        mute.style.cssText = btn;
        mute.onclick = function () { room.isMuted(p.id) ? room.unmute(p.id) : room.mute(p.id); render(); };
        var block = document.createElement("button");
        block.textContent = "Block";
        block.style.cssText = btn;
        block.onclick = function () { room.block(p.id); render(p.name + " is blocked for this session."); };
        var report = document.createElement("button");
        report.textContent = "Report";
        report.style.cssText = btn;
        report.onclick = function () { handOff(room, p, close, function () { reportForm(p); }); };
        row.append(name, mute, block, report);
        box.appendChild(row);
      });
    }

    function reportForm(p) {
      box.textContent = "";
      var h = document.createElement("strong");
      h.textContent = "Report " + p.name;
      var sel = document.createElement("select");
      sel.style.cssText = "display:block;width:100%;margin:12px 0;min-height:40px;padding:0 10px;background:#0d0f12;color:#eceef0;border:1px solid #000;box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.06);font:inherit";
      REASONS.forEach(function (r) { var o = document.createElement("option"); o.value = r[0]; o.textContent = r[1]; sel.appendChild(o); });
      var note = document.createElement("p");
      note.textContent = "Zaisma reviews reports. Nothing about you is sent. They'll also be muted for you.";
      note.style.cssText = "margin:0 0 12px;color:#969ba4;font-size:13px";
      var send = document.createElement("button");
      send.textContent = "Send report";
      send.style.cssText = btn + ";background:linear-gradient(180deg,#eef0f2 0%,#b9bcc1 46%,#7d8086 100%);box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #000;color:#0b0b0c";
      var back = document.createElement("button");
      back.textContent = "Back";
      back.style.cssText = btn + ";margin-left:6px";
      back.onclick = function () { render(); };
      send.onclick = function () {
        send.disabled = true;
        room.mute(p.id);
        room.report(p.id, sel.value).then(function () { render("Thanks. Your report was sent."); }, function (err) { render(err.message); });
      };
      box.append(h, sel, note, send, back);
    }

    render();
    document.body.appendChild(wrap);
    wrap.tabIndex = -1;
    wrap.focus();
  }

  var rooms = { join: joinRoom, list: listRooms, quickJoin: quickJoin, linkedRoomCode: linkedRoomCode() };
  window.Zaisma = { version: 1, gameSlug: config.game || null, player: player, joinRoom: joinRoom, rooms: rooms, invite: invite, filterText: filterText, openSafetyPanel: openSafetyPanel };
})();
