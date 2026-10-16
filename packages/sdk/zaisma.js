/*
 * The Zaisma SDK. Games include it with one tag, from the game's top folder:
 *   <script src="_zaisma/v1.js"></script>
 * Plain JavaScript, no dependencies, MIT licensed. Its reference is zaisma.d.ts beside this file (served
 * as _zaisma/v1.d.ts): every call, option, event and error code, explained once, there. Change the two
 * together; test/node/sdk-types.test.ts checks that they match.
 *
 * On Zaisma, the games Worker defines __ZAISMA__ before this file with the rooms address, the game and
 * the site. Anywhere else, games pass { serverUrl } themselves.
 */
(function () {
  "use strict";
  var config = typeof __ZAISMA__ === "object" && __ZAISMA__ ? __ZAISMA__ : {};
  var ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  var SERVER_URL = /^(wss?|https?):\/\/[^/]/;

  // What each call takes. Anything else is refused, so a misspelled or old option never goes quietly unused.
  var JOIN_OPTIONS = ["roomCode", "serverUrl", "isListed", "name", "labels", "joinData", "idleTimeoutSec", "idleCheckEnabled"];
  var QUICK_JOIN_OPTIONS = ["serverUrl", "isListed", "name", "labels", "joinData", "idleTimeoutSec", "idleCheckEnabled", "region"];
  var LIST_OPTIONS = ["region", "labels"];
  // move.join joins the room the move names, on this room's server.
  var MOVE_JOIN_OPTIONS = JOIN_OPTIONS.filter(function (name) { return name !== "roomCode" && name !== "serverUrl"; });
  var KICK_OPTIONS = ["keepOut"];
  var ROOM_INFO_FIELDS = ["name", "labels"];
  var ROOM_EVENTS = ["message", "players", "connectionStatus", "ended", "kicked", "room", "move", "moved", "idle", "away", "back", "muted", "error"];

  /** An Error with a code, as the SDK's errors all have. */
  function codedError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  /** The error for a call that needs Zaisma, in a game running somewhere else (no __ZAISMA__). */
  function notOnZaisma(message) {
    return codedError("not_on_zaisma", message);
  }

  /** The error for options a call doesn't take, naming the ones it does, or null when they're all fine. */
  function unknownOption(given, valid, call) {
    if (given === undefined || given === null) return null;
    if (typeof given !== "object") return codedError("unknown_option", call + " takes an object of options: " + valid.join(", ") + ".");
    var unknown = Object.keys(given).filter(function (name) { return valid.indexOf(name) === -1; });
    if (!unknown.length) return null;
    return codedError("unknown_option", call + " doesn't take " + unknown.join(", ") + ". It takes: " + valid.join(", ") + ".");
  }

  // The game's page on Zaisma, or the tester link it was opened from (a private game has no public page).
  function gamePage() {
    return config.page || "/g/" + config.game;
  }

  function Emitter(events) {
    this._on = {};
    this._events = events;
  }
  Emitter.prototype.on = function (event, listener) {
    if (this._events && this._events.indexOf(event) === -1) throw codedError("unknown_event", 'There\'s no "' + event + '" event. Rooms have: ' + this._events.join(", ") + ".");
    (this._on[event] = this._on[event] || []).push(listener);
    return this;
  };
  Emitter.prototype.off = function (event, listener) {
    this._on[event] = (this._on[event] || []).filter(function (each) { return each !== listener; });
    return this;
  };
  Emitter.prototype._emit = function (event, payload) {
    (this._on[event] || []).slice().forEach(function (listener) {
      try { listener(payload); } catch (error) { console.error(error); }
    });
  };

  /**
   * A call to Zaisma rooms. Errors answer { error: { code, message } }, which becomes an Error with that code;
   * no connection, or an answer that isn't one of Zaisma's, is request_failed.
   */
  function post(path, body) {
    // text/plain keeps this a simple request, so the browser needs no preflight.
    return fetch(config.rooms + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) }).then(answered, requestFailed);
  }
  function answered(response) {
    return response.json().then(function (answer) {
      if (response.ok) return answer;
      var error = answer && answer.error;
      if (error && error.code) throw codedError(error.code, error.message);
      requestFailed();
    }, requestFailed);
  }
  function requestFailed() {
    throw codedError("request_failed", "Zaisma didn't answer, so check the connection and try again.");
  }

  var passKey = "zaisma:pass:" + config.game;
  var passPromise = null;
  var keyPromise = null;
  var UNCHECKED = "Zaisma couldn't check this browser, so it can't play online. Reload the game to try again.";

  /**
   * The game page's key to player passes, as { key, playerKind }: whose passes it gives, the signed-in
   * account's or a guest's. zaisma.com gives one when Cloudflare's check on Play says a real browser
   * pressed it, so bots can't fill rooms; a game opened anywhere else gets none.
   */
  function roomKey() {
    if (!keyPromise) {
      keyPromise = new Promise(function (resolve, reject) {
        function fail(message) { reject(codedError("unchecked", message)); }
        if (!config.site || window.parent === window) return fail("Online play works when the game is played on Zaisma.");
        // The check usually answers in a second or two, or asks the player to tap a box.
        var timer = setTimeout(function () { removeEventListener("message", onMessage); fail(UNCHECKED); }, 30000);
        function onMessage(event) {
          if (event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:room-key") return;
          removeEventListener("message", onMessage);
          clearTimeout(timer);
          if (typeof event.data.key === "string") resolve({ key: event.data.key, playerKind: event.data.playerKind === "account" ? "account" : "guest" });
          else fail(UNCHECKED);
        }
        addEventListener("message", onMessage);
        window.parent.postMessage({ type: "zaisma:room-key" }, config.site);
      });
    }
    return keyPromise;
  }

  /** The pass this tab kept, while it has 10 minutes or more left, else null. */
  function keptPass() {
    try {
      var kept = JSON.parse(sessionStorage.getItem(passKey) || "null");
      return kept && Date.parse(kept.expiresAt) - Date.now() > 10 * 60 * 1000 ? kept : null;
    } catch (error) {
      return null; // storage off: fetch a new pass
    }
  }

  /**
   * This tab's player: { id, name, kind, pass, expiresAt }. The signed-in account, or a guest. Kept for
   * the tab, so a guest who reloads stays the same guest and gets their seat back.
   */
  function player() {
    if (!config.rooms) return Promise.reject(notOnZaisma("Player passes come from Zaisma, so they work only in games played on Zaisma."));
    if (!passPromise) {
      passPromise = roomKey().then(function (given) {
        // The kept pass, unless the player signed in or out since it was made.
        var kept = keptPass();
        if (kept && kept.kind === given.playerKind) return kept;
        return post("/v1/pass", { gameSlug: config.game, roomKey: given.key }).then(function (answer) {
          var mine = { id: answer.player.id, name: answer.player.name, kind: answer.player.kind, pass: answer.pass, expiresAt: answer.expiresAt };
          try { sessionStorage.setItem(passKey, JSON.stringify(mine)); } catch (error) { /* fine */ }
          return mine;
        });
      }, function (error) {
        // No key this time (the check couldn't answer): the pass this tab kept still works.
        var kept = keptPass();
        if (kept) return kept;
        throw error;
      }).then(function (mine) {
        passPromise = null;
        return mine;
      }, function (error) {
        passPromise = null;
        throw error;
      });
    }
    return passPromise;
  }

  /**
   * An account's public profile by player ID: { id, name }, what anyone sees of it. Guests have none
   * (error.code "no_player").
   */
  function getProfile(playerId) {
    if (!config.rooms) return Promise.reject(notOnZaisma("Profiles come from Zaisma, so they work only in games played on Zaisma."));
    if (typeof playerId !== "string" || !/^player_[a-z0-9]+$/.test(playerId)) return Promise.reject(codedError("bad_player_id", "playerId isn't a player ID like \"player_8f3k2m\": take it from room.players or Zaisma.player()."));
    return fetch(config.rooms + "/v1/players/" + playerId).then(answered, requestFailed).then(function (answer) {
      return answer.player;
    });
  }
  player.getProfile = getProfile;

  function roomCodeFromPage() {
    try {
      var code = new URLSearchParams(location.search).get("room");
      return code && ROOM_CODE.test(code.toUpperCase()) ? code.toUpperCase() : null;
    } catch (error) {
      return null;
    }
  }

  function randomRoomCode() {
    var alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(6)), function (byte) { return alphabet[byte & 31]; }).join("");
  }

  /** The idle check the game asked for in joinRoom's options: its timeout, or none at all. */
  function clientIdle(options) {
    var asked = {};
    if (typeof options.idleTimeoutSec === "number") asked.idleTimeoutSec = options.idleTimeoutSec;
    if (typeof options.idleCheckEnabled === "boolean") asked.idleCheckEnabled = options.idleCheckEnabled;
    return asked;
  }

  function Room(setup) {
    Emitter.call(this, ROOM_EVENTS);
    this.roomCode = setup.roomCode;
    this.me = null;
    this.players = [];
    this.hostPlayerId = null;
    this.connectionStatus = "connecting";
    this.inviteUrl = config.site && config.game ? config.site + gamePage() + "?room=" + this.roomCode : null;
    this.isListed = setup.isListed !== false;
    this.isOpen = true;
    this.name = null;
    this.labels = {};
    this._url = setup.url;
    this._pass = setup.pass;
    this._made = { isListed: setup.isListed === false ? false : undefined, name: setup.name, labels: setup.labels };
    this._joinData = setup.joinData === undefined ? null : setup.joinData;
    this._serverUrl = setup.serverUrl;
    this._tries = 0;
    this._done = false;
    this._ready = null;
    // Walking away: the idle check the game asked for, when the room counts the player away (from welcome),
    // whether they're out of the match (and their connection gone too), and the last ping, pong and message.
    this._clientIdle = setup.clientIdle;
    this._checks = { idleTimeoutSec: null, hiddenTimeoutSec: null };
    this._away = false;
    this._gone = false;
    this._idleSent = false;
    this._pingAtMs = 0;
    this._pongAtMs = 0;
    this._sentAtMs = 0;
  }
  Room.prototype = Object.create(Emitter.prototype);

  /** Send a message to the room if the connection is open. */
  Room.prototype._say = function (message) {
    if (!this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify(message));
    this._sentAtMs = Date.now();
  };

  // Codes that mean this room won't take the player, so joining fails instead of trying again.
  var REFUSED = ["full", "closed", "ended", "bad_pass", "too_big", "game_unavailable", "kept_out", "refused", "month_limit", "account_needed"];

  Room.prototype._connect = function () {
    var room = this;
    var ws = new WebSocket(this._url);
    this._ws = ws;
    watch();
    ws.onopen = function () {
      room._pingAtMs = room._pongAtMs = Date.now();
      room._say({ type: "hello", pass: room._pass, room: room._made, joinData: room._joinData, idleTimeoutSec: room._clientIdle.idleTimeoutSec, idleCheckEnabled: room._clientIdle.idleCheckEnabled });
    };
    ws.onmessage = function (event) {
      if (event.data === "pong") { room._pongAtMs = Date.now(); return; }
      var message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (message.type === "welcome") {
        var wasAway = room._away;
        room._tries = 0;
        room.me = message.me;
        room.players = message.players;
        room.hostPlayerId = message.hostPlayerId || null;
        room._checks = message.awayChecks || { idleTimeoutSec: null, hiddenTimeoutSec: null };
        room._away = room._gone = room._idleSent = room._coming = room._offered = false;
        // From here on, the room's row counts this player (room lists leave them out once they've left).
        room._joinedAtMs = Date.now();
        if (message.room) room._settle(message.room);
        room._setConnectionStatus("open");
        if (room._moved || wasAway) { room._moved = false; room._emit("players", message.players); }
        if (room._ready) { room._ready.resolve(room); room._ready = null; }
        // In (again, after walking away or a move): the Zaisma page counts on knowing.
        if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: room.roomCode, joined: true }, config.site);
        // Hidden already (a move, a reconnect): the room should know.
        if (document.hidden && room._checks.hiddenTimeoutSec) room._say({ type: "hidden" });
      } else if (message.type === "away") {
        room._away = true;
        room._idleSent = room._coming = false;
        room._setConnectionStatus("away");
        room._emit("away", { reason: message.reason, seatHoldDurationSec: message.seatHoldDurationSec });
        left(room);
      } else if (message.type === "players") {
        room.players = message.players;
        room.hostPlayerId = message.hostPlayerId || null;
        room._emit("players", message.players);
      } else if (message.type === "message") {
        room._emit("message", message.data);
      } else if (message.type === "room") {
        room._settle(message.room);
        room._emit("room", message.room);
      } else if (message.type === "move") {
        if ((room._on.move || []).length) room._emit("move", room._move(message));
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
        if (room._ready && REFUSED.indexOf(message.code) !== -1) {
          room._done = true;
          room._ready.reject(codedError(message.code, message.message));
          room._ready = null;
        }
      }
    };
    ws.onclose = function (event) {
      // 4000: the match ended. 4001: refused or replaced by another tab. Neither comes back.
      if (room._done || event.code === 4000 || event.code === 4001) {
        room._done = true;
        room._setConnectionStatus("closed");
        if (room._ready) {
          room._ready.reject(codedError("connection_closed", "The connection closed before the room let the player in" + (event.reason ? ": " + event.reason : "") + "."));
          room._ready = null;
        }
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
      this._say({ type: "back", joinData: this._joinData, idleTimeoutSec: this._clientIdle.idleTimeoutSec, idleCheckEnabled: this._clientIdle.idleCheckEnabled });
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
  Room.prototype._idleTimeoutSec = function () {
    if (this._clientIdle.idleCheckEnabled === false) return null;
    return typeof this._clientIdle.idleTimeoutSec === "number" ? this._clientIdle.idleTimeoutSec : this._checks.idleTimeoutSec;
  };

  Room.prototype._setConnectionStatus = function (connectionStatus) {
    if (this.connectionStatus === connectionStatus) return;
    this.connectionStatus = connectionStatus;
    this._emit("connectionStatus", connectionStatus);
  };

  /** Send a message to the game server. Plain JSON, up to 16 KB. Send input when it changes, not every frame. */
  Room.prototype.send = function (message) {
    if (!this._away) this._say({ type: "message", data: message });
  };

  /**
   * Show or hide the room in room lists, and open or close it to new players. Works from the room's
   * host (its first player) when the game uses the relay; with a game server, the server decides.
   * The "room" event says when it changed.
   */
  Room.prototype.setListed = function (isListed) {
    this._say({ type: "room", isListed: Boolean(isListed) });
  };
  Room.prototype.setOpen = function (isOpen) {
    this._say({ type: "room", isOpen: Boolean(isOpen) });
  };
  /**
   * The host removes a player, when the game server gives the host controls (the relay does).
   * keepOut: true keeps them out for the rest of the match. They're told the host removed them.
   */
  Room.prototype.kick = function (playerId, kickOptions) {
    var refused = unknownOption(kickOptions, KICK_OPTIONS, "room.kick");
    if (refused) throw refused;
    this._say({ type: "kick", playerId: playerId, keepOut: Boolean(kickOptions && kickOptions.keepOut) });
  };
  /** Name and label the room: { name, labels }. Leave a field out to keep it; null clears it. */
  Room.prototype.setInfo = function (nameAndLabels) {
    var refused = unknownOption(nameAndLabels, ROOM_INFO_FIELDS, "room.setInfo");
    if (refused) throw refused;
    nameAndLabels = nameAndLabels || {};
    this._say({ type: "room", name: nameAndLabels.name, labels: nameAndLabels.labels });
  };
  /**
   * The game server sent this player to another room: { roomCode, follow(), join(joinOptions) }.
   * follow() moves this room object there. join takes joinRoom's options and joins it as a new room
   * object instead, on the same server as this one (leave this one first).
   */
  Room.prototype._move = function (message) {
    var serverUrl = this._serverUrl;
    var room = this;
    return {
      roomCode: message.roomCode,
      follow: function () { room._follow(message.roomCode); },
      join: function (joinOptions) {
        var refused = unknownOption(joinOptions, MOVE_JOIN_OPTIONS, "move.join");
        if (refused) return Promise.reject(refused);
        return connect(message.roomCode, Object.assign({}, joinOptions || {}, { serverUrl: serverUrl }));
      },
    };
  };
  /** Move this room object to another room of the game: the old connection closes, the new one opens. */
  Room.prototype._follow = function (roomCode) {
    if (this._done || !ROOM_CODE.test(roomCode) || roomCode === this.roomCode) return;
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
    this._made = {};
    this._joinData = null;
    this._tries = 0;
    this._moved = true;
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: roomCode }, config.site);
    this._setConnectionStatus("connecting");
    this._emit("moved", roomCode);
    this._connect();
  };
  Room.prototype._settle = function (settings) {
    this.isListed = settings.isListed;
    this.isOpen = settings.isOpen;
    this.name = settings.name || null;
    this.labels = settings.labels || {};
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
    var reported = this.players.filter(function (each) { return each.id === playerId; })[0];
    return post("/v1/report", { gameSlug: config.game, roomCode: this.roomCode, playerId: playerId, playerName: reported ? reported.name : "", reason: reason, details: details || "" });
  };

  Room.prototype.leave = function () {
    if (!this._done) left(this);
    this._done = true;
    if (this._ws) this._ws.close(1000, "Left");
  };

  /** Join a room: the code in joinOptions, else the page's ?room=, else a new one (zaisma.d.ts: Zaisma.joinRoom). */
  function joinRoom(joinOptions) {
    var refused = unknownOption(joinOptions, JOIN_OPTIONS, "Zaisma.joinRoom");
    if (refused) return Promise.reject(refused);
    joinOptions = joinOptions || {};
    return connect(joinOptions.roomCode ? String(joinOptions.roomCode).toUpperCase() : roomCodeFromPage(), joinOptions);
  }

  function connect(roomCode, joinOptions, isRetry) {
    var serverUrl = joinOptions.serverUrl ? String(joinOptions.serverUrl).replace(/\/+$/, "") : null;
    if (!serverUrl && !config.rooms) return Promise.reject(notOnZaisma("Outside Zaisma, joinRoom needs your own game server's address, like { serverUrl: \"wss://play.example.com\" }."));
    if (serverUrl && !SERVER_URL.test(serverUrl)) return Promise.reject(codedError("bad_server_url", "serverUrl takes a full address starting with wss://, ws://, https:// or http://, like \"wss://play.example.com\"."));
    if (roomCode && !ROOM_CODE.test(roomCode)) return Promise.reject(codedError("bad_room_code", JSON.stringify(roomCode) + " isn't a room code: room codes are six characters like \"K7Q2MX\", from 2 to 9 and A to Z without I or O."));

    var roomCodeReady = roomCode
      ? Promise.resolve(roomCode)
      : serverUrl
        ? Promise.resolve(randomRoomCode())
        : post("/v1/rooms", { gameSlug: config.game }).then(function (answer) { return answer.roomCode; });
    return Promise.all([roomCodeReady, player()]).then(function (ready) {
      var base = (serverUrl || config.rooms).replace(/^http/, "ws");
      var room = new Room({
        roomCode: ready[0],
        pass: ready[1].pass,
        url: base + "/v1/rooms/" + config.game + "/" + ready[0],
        isListed: joinOptions.isListed,
        name: joinOptions.name,
        labels: joinOptions.labels,
        joinData: joinOptions.joinData,
        clientIdle: clientIdle(joinOptions),
        serverUrl: serverUrl,
      });
      joined.push(room);
      // Tell the Zaisma page the room code, so its Invite button and address bar point here.
      if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: room.roomCode }, config.site);
      return new Promise(function (resolve, reject) {
        room._ready = { resolve: resolve, reject: reject };
        room._connect();
      }).catch(function (error) {
        // A pass this tab kept from before Zaisma changed its keys: get a new one and try once more.
        if (error.code !== "bad_pass" || isRetry) throw error;
        try { sessionStorage.removeItem(passKey); } catch (storageError) { /* fine */ }
        return connect(room.roomCode, joinOptions, true);
      });
    });
  }

  /** The game's listed rooms on Zaisma, for a game's own lobby (zaisma.d.ts: RoomList). */
  function listRooms(listOptions) {
    var refused = unknownOption(listOptions, LIST_OPTIONS, "Zaisma.rooms.list");
    if (refused) return Promise.reject(refused);
    if (!config.rooms) return Promise.reject(notOnZaisma("Room lists show Zaisma rooms, so they work only in games played on Zaisma."));
    listOptions = listOptions || {};
    var query = [];
    if (listOptions.region) query.push("region=" + encodeURIComponent(listOptions.region));
    if (listOptions.labels) query.push("labels=" + encodeURIComponent(JSON.stringify(listOptions.labels)));
    // The room this tab just left, so the player doesn't see themselves in it while lists catch up.
    var leftAgoMs = recent ? Date.now() - recent.leftAtMs : -1;
    var isBack = recent && joined.some(function (room) { return room.roomCode === recent.roomCode && !room._done && !room._away; });
    if (leftAgoMs >= 0 && leftAgoMs < 30000 && !isBack) query.push("left=" + recent.roomCode + "." + leftAgoMs + "." + (Date.now() - recent.joinedAtMs));
    return fetch(config.rooms + "/v1/rooms/" + config.game + (query.length ? "?" + query.join("&") : "")).then(answered, requestFailed);
  }

  // A room that can't take this player, so another may: month_limit is an empty room that can't open again this month.
  var TRY_ANOTHER = ["full", "closed", "ended", "month_limit"];

  /** The linked room if it has space, else a listed room with space (nearby and busy first), else a new room. */
  function quickJoin(quickJoinOptions) {
    var refused = unknownOption(quickJoinOptions, QUICK_JOIN_OPTIONS, "Zaisma.rooms.quickJoin");
    if (refused) return Promise.reject(refused);
    quickJoinOptions = quickJoinOptions || {};
    var joinOptions = {};
    JOIN_OPTIONS.forEach(function (name) { if (quickJoinOptions[name] !== undefined) joinOptions[name] = quickJoinOptions[name]; });
    var linked = roomCodeFromPage();
    function fresh() { return connect(null, joinOptions); }
    function busiest() {
      return listRooms({ region: quickJoinOptions.region, labels: quickJoinOptions.labels }).then(function (found) {
        var tries = found.rooms.filter(function (room) { return room.isOpen && room.playerCount + room.heldSeatCount < room.maximumPlayerCount && room.roomCode !== linked; }).slice(0, 3);
        function next() {
          var room = tries.shift();
          if (!room) return fresh();
          return connect(room.roomCode, joinOptions).catch(function (error) { if (TRY_ANOTHER.indexOf(error.code) !== -1) return next(); throw error; });
        }
        return next();
      }, fresh);
    }
    if (!linked) return busiest();
    return connect(linked, joinOptions).catch(function (error) { if (TRY_ANOTHER.indexOf(error.code) !== -1) return busiest(); throw error; });
  }

  /** Zaisma's text filter: { isAllowed, reason, text } (zaisma.d.ts: Zaisma.filterText). */
  function filterText(text) {
    return post("/v1/filter", { gameSlug: config.game, text: String(text == null ? "" : text) });
  }

  /** The share sheet on phones, else copy the link: "shared", "copied", "cancelled" or "failed". */
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
    if (room._joinedAtMs) recent = { roomCode: room.roomCode, leftAtMs: Date.now(), joinedAtMs: room._joinedAtMs };
    room._joinedAtMs = 0;
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:left", code: room.roomCode }, config.site);
  }

  /*
   * Players who walk away. Honest clients do the fast part (docs/DECISIONS.md): ping so a dead connection
   * comes back by itself, say "Still there?" after a while without input and tell the room the answer,
   * say when the game is hidden, and say goodbye as the page goes. The room keeps its own slower checks.
   */
  var PING_MS = 25000;
  var PONG_MS = 15000;
  var ASK_MS = 30000;
  var lastInputAtMs = Date.now();
  var asking = null; // { untilMs, rooms } while "Still there?" is up
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
    lastInputAtMs = Date.now();
    if (asking) stopAsking();
    joined.forEach(function (room) { room._return(); });
  }

  // Gamepads don't send events for their buttons, so they're checked every second while one is connected.
  var pads = "";
  var padTimer = null;
  function pollPads() {
    if (padTimer || !navigator.getGamepads) return;
    padTimer = setInterval(function () {
      var connected = Array.prototype.filter.call(navigator.getGamepads() || [], Boolean);
      if (!connected.length) { clearInterval(padTimer); padTimer = null; return; }
      var seen = connected.map(function (pad) {
        return pad.buttons.map(function (button) { return button.pressed ? 1 : 0; }).join("") + pad.axes.map(function (axis) { return Math.round(axis * 4); }).join(",");
      }).join("|");
      if (pads && seen !== pads) input();
      pads = seen;
    }, 1000);
  }

  function check() {
    var nowMs = Date.now();
    var due = [];
    joined.forEach(function (room) {
      var ws = room._ws;
      if (room._done || !ws || ws.readyState !== 1) return;
      // A ping that went unanswered: the connection is gone, even if the browser hasn't noticed.
      if (room._pingAtMs > room._pongAtMs && nowMs - room._pingAtMs > PONG_MS) return room._lost();
      if (nowMs - room._pingAtMs >= PING_MS) {
        room._pingAtMs = nowMs;
        ws.send("ping");
      }
      if (room._away || room._idleSent) return;
      var idleTimeoutSec = room._idleTimeoutSec();
      if (idleTimeoutSec !== null && nowMs - lastInputAtMs >= idleTimeoutSec * 1000) due.push(room);
      // The room's own check hears from players who give input but whose game sends nothing for a while.
      var roomIdleTimeoutSec = room._checks.idleTimeoutSec;
      if (roomIdleTimeoutSec !== null && lastInputAtMs > room._sentAtMs && nowMs - room._sentAtMs > Math.min(240000, roomIdleTimeoutSec * 500)) room._say({ type: "here" });
    });
    if (asking && nowMs >= asking.untilMs) {
      var asked = asking.rooms;
      stopAsking();
      asked.forEach(function (room) {
        if (room._done || room._away || nowMs - lastInputAtMs < ASK_MS) return;
        room._idleSent = true;
        room._say({ type: "idle" });
      });
    } else if (!asking && due.length) startAsking(due);
  }

  function startAsking(rooms) {
    asking = { untilMs: Date.now() + ASK_MS, rooms: rooms };
    var isOwn = false;
    rooms.forEach(function (room) {
      if ((room._on.idle || []).length) isOwn = true;
      room._emit("idle", true);
    });
    if (!isOwn) showStillThere();
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
      if (!room._done && room._checks.hiddenTimeoutSec) room._say({ type: document.hidden ? "hidden" : "shown" });
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
    var playerId = event.data.player;
    joined.forEach(function (room) {
      if (room.players.some(function (each) { return each.id === playerId; })) room.mute(playerId);
    });
  });

  /** Hand a player report to the Zaisma page. If no Zaisma page answers (the game runs somewhere else), use our own form. */
  function handOff(room, reported, opened, fallback) {
    if (!config.site || window.parent === window) return fallback();
    var isAnswered = false;
    function listen(event) {
      if (event.origin === config.site && event.source === window.parent && event.data && event.data.type === "zaisma:report-open") {
        isAnswered = true;
        window.removeEventListener("message", listen);
        opened();
      }
    }
    window.addEventListener("message", listen);
    window.parent.postMessage({ type: "zaisma:report", code: room.roomCode, player: { id: reported.id, name: reported.name } }, config.site);
    setTimeout(function () {
      window.removeEventListener("message", listen);
      if (!isAnswered) fallback();
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
    var buttonStyle = "font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:0 12px;border:0;background:linear-gradient(180deg,#30353d,#22262c);box-shadow:inset 1px 1px 0 rgba(255,255,255,.13),inset -1px -1px 0 #000;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%);color:#eceef0;cursor:pointer";
    function close() { wrap.remove(); }
    wrap.addEventListener("click", function (event) { if (event.target === wrap) close(); });
    wrap.addEventListener("keydown", function (event) { if (event.key === "Escape") close(); });

    function render(note) {
      box.textContent = "";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px";
      var heading = document.createElement("strong");
      heading.textContent = "Players";
      var closeButton = document.createElement("button");
      closeButton.textContent = "Close";
      closeButton.style.cssText = buttonStyle;
      closeButton.onclick = close;
      head.append(heading, closeButton);
      box.appendChild(head);
      if (note) {
        var noteText = document.createElement("p");
        noteText.textContent = note;
        noteText.style.cssText = "margin:0 0 10px;color:#b9e7a6";
        box.appendChild(noteText);
      }
      var others = room.players.filter(function (each) { return !room.me || each.id !== room.me.id; });
      if (!others.length) {
        var none = document.createElement("p");
        none.textContent = "Nobody else is here.";
        none.style.color = "#969ba4";
        box.appendChild(none);
      }
      others.forEach(function (other) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;align-items:center;padding:10px 0;box-shadow:inset 0 1px 0 #000,inset 0 2px 0 rgba(255,255,255,.05)";
        var name = document.createElement("span");
        name.textContent = other.name + (room.isMuted(other.id) ? " (muted)" : "");
        name.style.flex = "1";
        var mute = document.createElement("button");
        mute.textContent = room.isMuted(other.id) ? "Unmute" : "Mute";
        mute.style.cssText = buttonStyle;
        mute.onclick = function () { room.isMuted(other.id) ? room.unmute(other.id) : room.mute(other.id); render(); };
        var block = document.createElement("button");
        block.textContent = "Block";
        block.style.cssText = buttonStyle;
        block.onclick = function () { room.block(other.id); render(other.name + " is blocked for this session."); };
        var report = document.createElement("button");
        report.textContent = "Report";
        report.style.cssText = buttonStyle;
        report.onclick = function () { handOff(room, other, close, function () { reportForm(other); }); };
        row.append(name, mute, block, report);
        box.appendChild(row);
      });
    }

    function reportForm(reported) {
      box.textContent = "";
      var heading = document.createElement("strong");
      heading.textContent = "Report " + reported.name;
      var select = document.createElement("select");
      select.style.cssText = "display:block;width:100%;margin:12px 0;min-height:40px;padding:0 10px;background:#0d0f12;color:#eceef0;border:1px solid #000;box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.06);font:inherit";
      REASONS.forEach(function (reason) { var option = document.createElement("option"); option.value = reason[0]; option.textContent = reason[1]; select.appendChild(option); });
      var note = document.createElement("p");
      note.textContent = "Zaisma reviews reports. Nothing about you is sent. They'll also be muted for you.";
      note.style.cssText = "margin:0 0 12px;color:#969ba4;font-size:13px";
      var send = document.createElement("button");
      send.textContent = "Send report";
      send.style.cssText = buttonStyle + ";background:linear-gradient(180deg,#eef0f2 0%,#b9bcc1 46%,#7d8086 100%);box-shadow:inset 1px 1px 0 #fff,inset -1px -1px 0 #000;color:#0b0b0c";
      var back = document.createElement("button");
      back.textContent = "Back";
      back.style.cssText = buttonStyle + ";margin-left:6px";
      back.onclick = function () { render(); };
      send.onclick = function () {
        send.disabled = true;
        room.mute(reported.id);
        room.report(reported.id, select.value).then(function () { render("Thanks. Your report was sent."); }, function (error) { render(error.message); });
      };
      box.append(heading, select, note, send, back);
    }

    render();
    document.body.appendChild(wrap);
    wrap.tabIndex = -1;
    wrap.focus();
  }

  var rooms = { list: listRooms, quickJoin: quickJoin, linkedRoomCode: roomCodeFromPage() };
  window.Zaisma = { sdkVersionNumber: 1, gameSlug: config.game || null, player: player, joinRoom: joinRoom, rooms: rooms, invite: invite, filterText: filterText, openSafetyPanel: openSafetyPanel };
})();
