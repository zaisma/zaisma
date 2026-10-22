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
  // A game's own server that friends can be sent to: secure addresses only.
  var OWN_SERVER_URL = /^(wss|https):\/\/[^/]/;

  // What each call takes. Anything else is refused, so a misspelled or old option never goes quietly unused.
  var JOIN_OPTIONS = ["roomCode", "serverUrl", "isListed", "friendJoinsEnabled", "name", "labels", "joinData", "idleTimeoutSec", "idleCheckEnabled", "isSpectator"];
  var QUICK_JOIN_OPTIONS = ["serverUrl", "isListed", "friendJoinsEnabled", "name", "labels", "joinData", "idleTimeoutSec", "idleCheckEnabled", "region"];
  var LIST_OPTIONS = ["region", "labels"];
  // move.join joins the room the move names, on this room's server, as a player: the game server moves only players.
  var MOVE_JOIN_OPTIONS = JOIN_OPTIONS.filter(function (name) { return name !== "roomCode" && name !== "serverUrl" && name !== "isSpectator"; });
  var KICK_OPTIONS = ["keepOut"];
  var SEND_OPTIONS = ["delivery", "latestKey"];
  var DELIVERIES = ["reliable", "latest_only"];
  var ROOM_INFO_FIELDS = ["name", "labels"];
  var ROOM_EVENTS = ["message", "bytes", "state", "players", "connectionStatus", "ended", "ending", "kicked", "room", "move", "moved", "idle", "away", "back", "muted", "error", "versionUpdate"];
  var SAVES_EVENTS = ["conflict", "developerChange"];
  var VERSIONS_EVENTS = ["update"];
  /** The room closes connections with this as its match switches to a version published "now". */
  var VERSION_UPDATE_CLOSE_CODE = 4004;
  /** A real-time room's ping from this on shows as a weak connection beside the game. */
  var WEAK_PING_MS = 150;
  /** A latest-only send waits while the socket holds this much not yet sent, checked every LATEST_CHECK_MS. */
  var BACKED_UP_SIZE_BYTES = 64 * 1024;
  var LATEST_CHECK_MS = 50;
  /** Latest-only sends waiting, one per latestKey (the room keeps the same many per player), and its latestKey's length. */
  var MAXIMUM_LATEST_ONLY_SLOT_COUNT = 64;
  var MAXIMUM_LATEST_KEY_CHARACTER_COUNT = 40;
  /** room.smoothedState() draws this far behind the room's clock unless the game says, and keeps a second of views to draw from. */
  var DEFAULT_SMOOTHING_DELAY_MS = 100;
  var KEPT_VIEWS_DURATION_MS = 1000;

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

  /** Events by name. eventsOwner names whose events they are in a wrong name's error ("Rooms have"). */
  function Emitter(events, eventsOwner) {
    this._on = {};
    this._events = events;
    this._eventsOwner = eventsOwner || "Rooms have";
  }
  Emitter.prototype.on = function (event, listener) {
    if (this._events && this._events.indexOf(event) === -1) throw codedError("unknown_event", 'There\'s no "' + event + '" event. ' + this._eventsOwner + ": " + this._events.join(", ") + ".");
    (this._on[event] = this._on[event] || []).push(listener);
    return this;
  };
  Emitter.prototype.off = function (event, listener) {
    this._on[event] = (this._on[event] || []).filter(function (each) { return each !== listener; });
    return this;
  };
  // Most events hand the game one thing; "bytes" hands two (the bytes, and whose they are).
  Emitter.prototype._emit = function (event, payload, secondPayload) {
    var given = arguments.length > 2 ? [payload, secondPayload] : [payload];
    (this._on[event] || []).slice().forEach(function (listener) {
      try { listener.apply(null, given); } catch (error) { console.error(error); }
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
   * An account's public profile by player ID: what anyone sees of it on zaisma.com/@username, in the SDK's
   * camelCase. Guests have none (error.code "no_player").
   */
  function getProfile(playerId) {
    if (!config.rooms) return Promise.reject(notOnZaisma("Profiles come from Zaisma, so they work only in games played on Zaisma."));
    if (typeof playerId !== "string" || !/^player_[a-z0-9]+$/.test(playerId)) return Promise.reject(codedError("bad_player_id", "playerId isn't a player ID like \"player_8f3k2m\": take it from room.players or Zaisma.player()."));
    return fetch(config.rooms + "/v1/players/" + playerId).then(answered, requestFailed).then(function (answer) {
      var profile = answer.player;
      var game = function (playedGame) {
        var shown = { slug: playedGame.slug, title: playedGame.title, pageUrl: playedGame.page_url };
        if (playedGame.played_period) shown.playedPeriod = playedGame.played_period;
        return shown;
      };
      return {
        id: profile.id,
        name: profile.name,
        username: profile.username,
        displayName: profile.display_name,
        bio: profile.bio,
        linkUrls: profile.link_urls,
        profileUrl: profile.profile_url,
        isProfilePrivate: profile.is_profile_private,
        publishedGames: profile.published_games.map(game),
        playedGames: profile.played_games.map(game),
        playingNow: profile.playing_now ? game(profile.playing_now) : null,
      };
    });
  }
  player.getProfile = getProfile;

  /*
   * Signing in while the game runs. The Zaisma page asks the player beside the game and signs them in in
   * a new tab, so the game keeps running. However the player signs in (here, or the page's "Keep your
   * progress"), the page says so (zaisma:signed-in): the room key was the guest's, so the next pass
   * comes from the account's key (and the guest's kept pass, of the wrong kind, isn't used).
   */
  var signInPromise = null;
  var signInWaiters = [];

  window.addEventListener("message", function (event) {
    if (!config.site || event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:signed-in") return;
    var given = event.data.player;
    if (!given || typeof given.id !== "string" || typeof given.name !== "string") return;
    keyPromise = null;
    friendsAsked = null;
    var signedIn = { id: given.id, name: given.name, kind: "account" };
    signInWaiters.splice(0).forEach(function (waiter) { waiter.resolve(signedIn); });
  });

  /*
   * Ask the page for something while the game runs and wait for its answer (signIn, offerAccount): one
   * promise at a time, resolved with the account once the player is signed in. The page answers at once
   * that it's asking; no answer in 3 seconds means no Zaisma page is around the game. statuses maps the
   * page's other answers to the error each one is.
   */
  function askPage(messageType, notOnZaismaMessage, statuses) {
    return new Promise(function (resolve, reject) {
      // Signed in (zaisma:signed-in, above): stop listening for the page's answers.
      var waiter = { resolve: function (signedIn) { settle(null); resolve(signedIn); } };
      signInWaiters.push(waiter);
      var isAsking = false;
      var timer = setTimeout(function () { if (!isAsking) settle(notOnZaisma(notOnZaismaMessage)); }, 3000);
      function settle(error) {
        removeEventListener("message", onMessage);
        clearTimeout(timer);
        signInWaiters = signInWaiters.filter(function (each) { return each !== waiter; });
        if (error) reject(error);
      }
      function onMessage(event) {
        if (event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== messageType) return;
        var status = event.data.status;
        if (status === "asking") isAsking = true;
        else if (Object.prototype.hasOwnProperty.call(statuses, status)) settle(codedError(statuses[status][0], statuses[status][1]));
      }
      addEventListener("message", onMessage);
      window.parent.postMessage({ type: messageType }, config.site);
    });
  }

  /** Ask a guest to sign in, without leaving the game: the account, once they have (zaisma.d.ts: Zaisma.player.signIn). */
  function signIn() {
    if (!config.site || window.parent === window) return Promise.reject(notOnZaisma("Signing in works when the game is played on its zaisma.com page."));
    if (signInPromise) return signInPromise;
    signInPromise = askPage("zaisma:sign-in", "No Zaisma page answered: signing in works when the game is played on its zaisma.com page.", {
      declined: ["sign_in_declined", "The player chose Not now. Ask again when they press something that needs an account, not on a timer."],
    }).then(function (signedIn) {
      signInPromise = null;
      return signedIn;
    }, function (error) {
      signInPromise = null;
      throw error;
    });
    return signInPromise;
  }
  player.signIn = signIn;

  /** Show Zaisma's "Keep your progress" card at the game's moment: the account, once the player has one (zaisma.d.ts: Zaisma.player.offerAccount). */
  var offerPromise = null;
  function offerAccount() {
    if (!config.site || window.parent === window) return Promise.reject(notOnZaisma("The \"Keep your progress\" card shows when the game is played on its zaisma.com page."));
    if (offerPromise) return offerPromise;
    offerPromise = askPage("zaisma:account-offer", "No Zaisma page answered: the \"Keep your progress\" card shows when the game is played on its zaisma.com page.", {
      declined: ["sign_in_declined", "The player chose Not now. Zaisma's card won't show again for 3 days; show your own message if you like."],
      too_soon: ["account_offer_too_soon", "Zaisma's card showed this visit or the player chose Not now in the last 3 days. Show your own message instead."],
      cloud_saves_off: ["cloud_saves_off", "This game has cloud saves off, so there's no progress for Zaisma's card to keep: ask with Zaisma.player.signIn() instead."],
    }).then(function (signedIn) {
      offerPromise = null;
      return signedIn;
    }, function (error) {
      offerPromise = null;
      throw error;
    });
    return offerPromise;
  }
  player.offerAccount = offerAccount;

  function roomCodeFromPage() {
    try {
      var code = new URLSearchParams(location.search).get("room");
      return code && ROOM_CODE.test(code.toUpperCase()) ? code.toUpperCase() : null;
    } catch (error) {
      return null;
    }
  }

  /** Whether the page's link is a Watch (?watch=1 beside ?room=): the player came to watch that room, not to play. */
  function watchFromPage() {
    try {
      return Boolean(roomCodeFromPage()) && new URLSearchParams(location.search).get("watch") === "1";
    } catch (error) {
      return false;
    }
  }

  /** The game's own server a friend's Join names beside the room (?server=), or null. */
  function serverUrlFromPage() {
    try {
      var given = new URLSearchParams(location.search).get("server");
      return given && OWN_SERVER_URL.test(given) ? given.replace(/\/+$/, "") : null;
    } catch (error) {
      return null;
    }
  }

  function hostOf(address) {
    try { return new URL(address).host; } catch (error) { return null; }
  }

  /**
   * The linked room, for a join on this server (serverUrl, or none for Zaisma rooms): a link that names
   * no server is for whichever the game uses, and one that names a server only for that one.
   */
  function linkedRoomFor(serverUrl) {
    var code = roomCodeFromPage();
    var linkedServerUrl = serverUrlFromPage();
    if (!code || !linkedServerUrl) return code;
    return serverUrl && hostOf(String(serverUrl)) === hostOf(linkedServerUrl) ? code : null;
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
    this.friendJoinsEnabled = setup.friendJoinsEnabled !== false;
    this.name = null;
    this.labels = {};
    this.endsAt = null;
    // Watching, not playing (joinRoom({ isSpectator: true })): sends nothing, and never counts as away.
    this.isSpectator = setup.isSpectator === true;
    this.spectatorCount = 0;
    this._url = setup.url;
    this._pass = setup.pass;
    this._made = { isListed: setup.isListed === false ? false : undefined, friendJoinsEnabled: setup.friendJoinsEnabled === false ? false : undefined, name: setup.name, labels: setup.labels };
    this._joinData = setup.joinData === undefined ? null : setup.joinData;
    this._serverUrl = setup.serverUrl;
    this._tries = 0;
    this._done = false;
    this._isReloadingForOtherVersion = false;
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
    // Ping and the room's clock (docs/DECISIONS.md, "Rooms under lag"): the room's probes carry this player's
    // ping and the room's time. The last 8 clock offsets are kept across reconnects, since the room's clock doesn't change.
    this.pingDurationMs = null;
    this._clockOffsetsMs = [];
    // How often a ticking room probes (from welcome), or null, and when this connection last heard from the room.
    this._probeIntervalSec = null;
    this._heardAtMs = 0;
    // State sync (the game server's stateSyncEnabled): this player's view of the state, null until the
    // first update, and the views of the last second with the room's time of each, for smoothedState().
    this.state = null;
    this._views = [];
    // Latest-only sends waiting for the socket to drain, by "<kind>:<latestKey>", least recently replaced first.
    this._slots = new Map();
    this._slotTimer = null;
  }
  Room.prototype = Object.create(Emitter.prototype);

  /** The room's clock now, in epoch milliseconds, estimated from its probes: Date.now() until the first one. */
  Room.prototype.serverTimeMs = function () {
    if (!this._clockOffsetsMs.length) return Date.now();
    // Queueing only delays a probe, which makes its sample smaller: the largest is the least delayed.
    return Math.round(performance.timeOrigin + performance.now() + Math.max.apply(null, this._clockOffsetsMs));
  };

  /** A probe from the room: answered at once, before anything else, and never a game message. */
  Room.prototype._probe = function (message) {
    // Straight onto the socket: an answer isn't something the game said, so it doesn't count for the "here" check.
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
    if (typeof message.pingDurationMs === "number") this.pingDurationMs = message.pingDurationMs;
    // The page beside the game shows a weak connection: told only when it starts or stops being weak.
    var isWeak = this._probeIntervalSec !== null && this.pingDurationMs !== null && this.pingDurationMs >= WEAK_PING_MS;
    if (isWeak !== this._isWeak) {
      this._isWeak = isWeak;
      this._tellConnection();
    }
    if (typeof message.serverTimeMs !== "number") return;
    this._clockOffsetsMs.push(message.serverTimeMs + (this.pingDurationMs || 0) / 2 - (performance.timeOrigin + performance.now()));
    if (this._clockOffsetsMs.length > 8) this._clockOffsetsMs.shift();
  };

  /** Send a message to the room if the connection is open. */
  Room.prototype._say = function (message) {
    if (!this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify(message));
    this._sentAtMs = Date.now();
  };

  // Codes that mean this room won't take the player, so joining fails instead of trying again.
  var REFUSED = ["full", "closed", "ended", "bad_pass", "too_big", "game_unavailable", "kept_out", "refused", "hosting_paused", "account_needed", "game_not_open_to_player", "blocked_player_here", "other_version", "watching_full", "no_room"];

  /**
   * Whether a Zaisma room on another version (other_version) has the page reload the game at it: on the
   * game's Zaisma page, except through a tester link (it plays only its own version) or in a tab that opened
   * into this very room, where the game domain already had its chance to serve the room's version.
   */
  Room.prototype._reloadsForOtherVersion = function () {
    return Boolean(config.site && window.parent !== window && !config.tester && roomCodeFromPage() !== this.roomCode);
  };

  Room.prototype._connect = function () {
    var room = this;
    // From a tester link, Zaisma rooms hear which one, so its players leave when it's turned off.
    var ws = new WebSocket(this._url + (config.tester && !this._serverUrl ? "?tester=" + config.tester : ""));
    ws.binaryType = "arraybuffer";
    this._ws = ws;
    watch();
    ws.onopen = function () {
      room._pingAtMs = room._pongAtMs = room._heardAtMs = Date.now();
      room._probeIntervalSec = null;
      var hello = { type: "hello", pass: room._pass, room: room._made, joinData: room._joinData, idleTimeoutSec: room._clientIdle.idleTimeoutSec, idleCheckEnabled: room._clientIdle.idleCheckEnabled };
      // quickJoin's first try at a room: rather another room than one with someone this player blocked.
      if (room._avoidsBlockedPlayers) hello.avoidBlockedPlayers = true;
      // Any quickJoin: Zaisma learns the game joins players by itself, for its Rooms tab.
      if (room._isQuickJoin) hello.isQuickJoin = true;
      // The version this tab runs, so a Zaisma room on another one has the game reload at it first.
      if (config.version && !room._serverUrl) hello.versionId = config.version;
      if (room.isSpectator) hello.isSpectator = true;
      room._say(hello);
    };
    ws.onmessage = function (event) {
      room._heardAtMs = Date.now();
      if (event.data === "pong") { room._pongAtMs = Date.now(); return; }
      if (typeof event.data !== "string") { room._bytes(event.data); return; }
      var message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (message.type === "probe") {
        room._probe(message);
      } else if (message.type === "welcome") {
        var wasAway = room._away;
        room._tries = 0;
        room.me = message.me;
        room.players = message.players;
        room.hostPlayerId = message.hostPlayerId || null;
        room._checks = message.awayChecks || { idleTimeoutSec: null, hiddenTimeoutSec: null };
        room._probeIntervalSec = typeof message.probeIntervalSec === "number" ? message.probeIntervalSec : null;
        room.spectatorCount = typeof message.spectatorCount === "number" ? message.spectatorCount : 0;
        room._away = room._gone = room._idleSent = room._coming = room._offered = room._isReloadingForVersion = false;
        // In: coming back after a lost connection never turns the player away for someone they blocked.
        room._avoidsBlockedPlayers = false;
        // A new connection: the room tells this one its blocks afresh, and hears this tab's.
        room._blocks = new Set();
        room._said = {};
        room._sayBlocks();
        // From here on, the room's row counts this player (room lists leave them out once they've left).
        room._joinedAtMs = Date.now();
        if (message.room) room._settle(message.room);
        room.endsAt = message.endsAt || null;
        room._setConnectionStatus("open");
        if (room._moved || wasAway) { room._moved = false; room._emit("players", message.players); }
        if (room._ready) { room._ready.resolve(room); room._ready = null; }
        // In (again, after walking away or a move): the Zaisma page counts on knowing.
        if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: room.roomCode, joined: true }, config.site);
        room._tellPage();
        // In a room on the game's own servers: Zaisma hears which, for friends' Join.
        room._sayOwnRoom();
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
        room._sayBlocks();
        room._emit("players", message.players);
        room._tellPage();
      } else if (message.type === "blocks") {
        room._blocks = new Set(Array.isArray(message.playerIds) ? message.playerIds : []);
        room._mutedChanged();
      } else if (message.type === "message") {
        room._emit("message", message.data);
      } else if (message.type === "state") {
        room._takeState(message);
      } else if (message.type === "room") {
        var wasTakingFriendJoins = room.friendJoinsEnabled;
        room._settle(message.room);
        if (typeof message.spectatorCount === "number") room.spectatorCount = message.spectatorCount;
        if (room.friendJoinsEnabled !== wasTakingFriendJoins) room._sayOwnRoom();
        room._emit("room", message.room);
        room._tellPage();
      } else if (message.type === "move") {
        if ((room._on.move || []).length) room._emit("move", room._move(message));
        else room._follow(message.roomCode);
      } else if (message.type === "kicked") {
        room._done = true;
        room._emit("kicked", { message: message.message, isKeptOut: message.isKeptOut === true });
        left(room);
      } else if (message.type === "ending") {
        room.endsAt = message.endsAt;
        room._emit("ending", message.endsAt);
      } else if (message.type === "versionUpdate") {
        var versionUpdate = { versionId: message.versionId, appliesAt: message.appliesAt, isReloading: message.isReloading === true };
        if (message.step === "now") room._isReloadingForVersion = versionUpdate.isReloading;
        else room._emit("versionUpdate", versionUpdate);
        if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:version-update", code: room.roomCode, step: message.step === "now" ? "now" : "coming", appliesAt: versionUpdate.appliesAt, isReloading: versionUpdate.isReloading }, config.site);
      } else if (message.type === "ended") {
        room._done = true;
        room._emit("ended", message.message);
        left(room);
      } else if (message.type === "error" && message.code === "other_version" && room._ready && room._reloadsForOtherVersion()) {
        // The room runs another version: the page reloads the game at it, into this room, and this join waits for that.
        room._isReloadingForOtherVersion = room._done = true;
        window.parent.postMessage(room._spectating({ type: "zaisma:reload", code: room.roomCode, versionId: message.versionId }), config.site);
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
      if (room._isReloadingForOtherVersion) return;
      // The match switched to a new version: its files changed, so the page reloads the game at it, back into this room.
      if (event.code === VERSION_UPDATE_CLOSE_CODE && room._isReloadingForVersion && config.site && window.parent !== window) {
        room._done = true;
        room._setConnectionStatus("reconnecting");
        window.parent.postMessage(room._spectating({ type: "zaisma:reload", code: room.roomCode }), config.site);
        return;
      }
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
    if (this.isSpectator || this._clientIdle.idleCheckEnabled === false) return null;
    return typeof this._clientIdle.idleTimeoutSec === "number" ? this._clientIdle.idleTimeoutSec : this._checks.idleTimeoutSec;
  };

  Room.prototype._setConnectionStatus = function (connectionStatus) {
    if (this.connectionStatus === connectionStatus) return;
    this.connectionStatus = connectionStatus;
    this._emit("connectionStatus", connectionStatus);
    this._tellConnection();
  };

  /** The Zaisma page shows the connection beside the game when it isn't fine: weak, reconnecting or lost. */
  Room.prototype._tellConnection = function () {
    if (!config.site || window.parent === window) return;
    window.parent.postMessage({ type: "zaisma:connection", code: this.roomCode, connectionStatus: this.connectionStatus, pingDurationMs: this.pingDurationMs, isWeak: this._isWeak === true }, config.site);
  };

  /** Spectators watch: what a spectator tries to send throws, and nothing goes. */
  function spectatorCannotSend() {
    return codedError("spectator_cannot_send", "Spectators watch; they can't send to the room. Join without isSpectator to play.");
  }

  /**
   * Send a message to the game server. Plain JSON, up to 16 KB. Send input when it changes, not every frame.
   * { delivery: "latest_only" } may drop it for a newer one with the same latestKey while the connection is backed up.
   */
  Room.prototype.send = function (message, sendOptions) {
    if (this.isSpectator) throw spectatorCannotSend();
    var latestKey = readDelivery(sendOptions, "room.send", message && typeof message === "object" && typeof message.type === "string" ? message.type : "");
    if (this._away) return;
    if (latestKey === null) this._say({ type: "message", data: message });
    else this._sendLatest("message:" + latestKey, JSON.stringify({ type: "message", data: message }));
  };

  /**
   * Send bytes to the game server (its onBytes), like a compact input: an ArrayBuffer or any typed array,
   * up to 16 KB, counted with messages (30 a second). Takes the same sendOptions as room.send.
   */
  Room.prototype.sendBytes = function (bytes, sendOptions) {
    if (this.isSpectator) throw spectatorCannotSend();
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw codedError("bad_bytes", "room.sendBytes takes bytes: a Uint8Array, another typed array or an ArrayBuffer. For JSON, use room.send.");
    var latestKey = readDelivery(sendOptions, "room.sendBytes", "");
    if (this._away || !this._ws || this._ws.readyState !== 1) return;
    if (latestKey !== null) {
      // A copy: the game may reuse its buffer while this one waits.
      this._sendLatest("bytes:" + latestKey, ArrayBuffer.isView(bytes) ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.slice(0));
      return;
    }
    this._ws.send(bytes);
    this._sentAtMs = Date.now();
  };

  /** A send's latestKey when its delivery is "latest_only", or null for a reliable one. Mistakes throw, naming what to give. */
  function readDelivery(sendOptions, call, defaultKey) {
    var refused = unknownOption(sendOptions, SEND_OPTIONS, call);
    if (refused) throw refused;
    var given = sendOptions || {};
    if (given.delivery !== undefined && DELIVERIES.indexOf(given.delivery) === -1) throw codedError("bad_send_option", call + "'s delivery is " + JSON.stringify(given.delivery) + '. Give "reliable" (the default) or "latest_only".');
    if (given.latestKey !== undefined && (typeof given.latestKey !== "string" || given.latestKey.length > MAXIMUM_LATEST_KEY_CHARACTER_COUNT)) throw codedError("bad_send_option", call + "'s latestKey must be text up to " + MAXIMUM_LATEST_KEY_CHARACTER_COUNT + ' characters, like "positions".');
    if (given.delivery !== "latest_only") return null;
    return given.latestKey !== undefined ? given.latestKey : defaultKey;
  }

  /** A latest-only send: now, after anything still waiting, or into its slot while the socket is backed up. */
  Room.prototype._sendLatest = function (slotKey, payload) {
    if (this._ws && this._ws.readyState === 1 && !(this._ws.bufferedAmount >= BACKED_UP_SIZE_BYTES)) {
      this._sendWaiting();
      this._ws.send(payload);
      this._sentAtMs = Date.now();
      return;
    }
    this._slots.delete(slotKey);
    this._slots.set(slotKey, payload);
    if (this._slots.size > MAXIMUM_LATEST_ONLY_SLOT_COUNT) this._slots.delete(this._slots.keys().next().value);
    if (this._slotTimer === null) {
      var room = this;
      this._slotTimer = setInterval(function () {
        if (room._done || room._away) room._slots.clear();
        else if (room._ws && room._ws.readyState === 1 && !(room._ws.bufferedAmount >= BACKED_UP_SIZE_BYTES)) room._sendWaiting();
        if (!room._slots.size) { clearInterval(room._slotTimer); room._slotTimer = null; }
      }, LATEST_CHECK_MS);
    }
  };
  /** Latest-only sends that waited, least recently replaced first. */
  Room.prototype._sendWaiting = function () {
    if (!this._slots.size) return;
    var ws = this._ws;
    this._slots.forEach(function (payload) { ws.send(payload); });
    this._slots.clear();
    this._sentAtMs = Date.now();
  };

  /** A state update from the game server (stateSyncEnabled): a full copy of this player's view, or what changed. */
  Room.prototype._takeState = function (message) {
    var changes = null;
    if (Object.prototype.hasOwnProperty.call(message, "full")) this.state = message.full;
    else if (Array.isArray(message.changes) && this._views.length) {
      try { this.state = applyStateChanges(this.state, message.changes); } catch (error) { return; }
      changes = message.changes;
    } else return;
    var serverTimeMs = typeof message.serverTimeMs === "number" ? message.serverTimeMs : this.serverTimeMs();
    this._views.push({ serverTimeMs: serverTimeMs, state: this.state });
    while (this._views.length > 2 && this._views[1].serverTimeMs <= serverTimeMs - KEPT_VIEWS_DURATION_MS) this._views.shift();
    this._emit("state", this.state, changes);
  };

  /**
   * The state as it was delayMs (100 unless given) behind the room's clock, between the two updates around
   * then: numbers in between, anything else as the older one had it, and what's in only one of them as it is.
   * A copy, so the game can keep it; null until the first update.
   */
  Room.prototype.smoothedState = function (delayMs) {
    if (delayMs === undefined) delayMs = DEFAULT_SMOOTHING_DELAY_MS;
    if (typeof delayMs !== "number" || !(delayMs >= 0 && delayMs <= KEPT_VIEWS_DURATION_MS)) throw codedError("bad_delay", "room.smoothedState takes a delay in milliseconds from 0 to " + KEPT_VIEWS_DURATION_MS + ", like 100.");
    var views = this._views;
    if (!views.length) return null;
    var atMs = this.serverTimeMs() - delayMs;
    // The first view newer than then: the one to blend toward.
    var newerIndex = 0;
    while (newerIndex < views.length && views[newerIndex].serverTimeMs <= atMs) newerIndex++;
    if (newerIndex === 0) return blendStates(views[0].state, views[0].state, 0);
    if (newerIndex === views.length) return blendStates(views[newerIndex - 1].state, views[newerIndex - 1].state, 0);
    var older = views[newerIndex - 1];
    var spanMs = views[newerIndex].serverTimeMs - older.serverTimeMs;
    return blendStates(older.state, views[newerIndex].state, spanMs > 0 ? (atMs - older.serverTimeMs) / spanMs : 1);
  };

  /** Two views blended: numbers fraction of the way from older to newer, anything else the older one's, and what's in only one as it is, copied. */
  function blendStates(older, newer, fraction) {
    if (typeof older === "number" && typeof newer === "number") return older + (newer - older) * fraction;
    var isList = Array.isArray(older);
    if (!older || typeof older !== "object" || !newer || typeof newer !== "object" || isList !== Array.isArray(newer)) {
      return older && typeof older === "object" ? blendStates(older, older, 0) : older;
    }
    var blended = isList ? [] : {};
    var keys = isList ? Array.from({ length: Math.max(older.length, newer.length) }, function (unused, i) { return i; }) : Object.keys(older).concat(Object.keys(newer).filter(function (key) { return !Object.prototype.hasOwnProperty.call(older, key); }));
    keys.forEach(function (key) {
      var isInOlder = Object.prototype.hasOwnProperty.call(older, key);
      var isInNewer = Object.prototype.hasOwnProperty.call(newer, key);
      var part = isInOlder && isInNewer ? blendStates(older[key], newer[key], fraction) : isInOlder ? blendStates(older[key], older[key], 0) : blendStates(newer[key], newer[key], 0);
      Object.defineProperty(blended, key, { value: part, writable: true, enumerable: true, configurable: true });
    });
    return blended;
  }

  /**
   * The state with a state update's changes applied, as a new state: what changed is copied along its path
   * and the rest shared, so earlier views stay as they were. The game server's applyStateChanges
   * (packages/game-server/src/state-sync.ts) does the same; test/node/state-sync.test.ts holds them equal.
   */
  function applyStateChanges(state, changes) {
    var copied = new Set();
    function copyOf(given) {
      if (copied.has(given)) return given;
      var copy = Array.isArray(given) ? given.slice() : {};
      if (!Array.isArray(given)) Object.keys(given).forEach(function (key) { Object.defineProperty(copy, key, { value: given[key], writable: true, enumerable: true, configurable: true }); });
      copied.add(copy);
      return copy;
    }
    var root = state;
    changes.forEach(function (change) {
      var path = change[0];
      if (!path.length) { root = change.length > 1 ? change[1] : null; return; }
      root = copyOf(root);
      var parent = root;
      for (var i = 0; i < path.length - 1; i++) {
        var child = copyOf(parent[path[i]]);
        parent[path[i]] = child;
        parent = child;
      }
      var key = path[path.length - 1];
      // A key named __proto__ is plain data, as JSON.parse makes it, never the object's prototype.
      if (change.length > 1) Object.defineProperty(parent, key, { value: change[1], writable: true, enumerable: true, configurable: true });
      else delete parent[key];
    });
    return root;
  }

  /** A binary frame from the room: one byte, the sender's player ID length, the ID (none for the game server), then the bytes. */
  Room.prototype._bytes = function (received) {
    var frame = new Uint8Array(received);
    if (!frame.length) return;
    var fromSizeBytes = frame[0];
    var fromPlayerId = fromSizeBytes ? new TextDecoder().decode(frame.subarray(1, 1 + fromSizeBytes)) : null;
    this._emit("bytes", frame.slice(1 + fromSizeBytes), fromPlayerId);
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
   * Turn Zaisma's Join on or off for this room ("Private room" when off). Works from the room's host
   * when the game uses the relay; with a game server, the server decides. Not a lock: codes and links still work.
   */
  Room.prototype.setFriendJoinsEnabled = function (isEnabled) {
    this._say({ type: "room", friendJoinsEnabled: Boolean(isEnabled) });
  };
  /** In a room on the game's own servers: Zaisma hears which, with its Join switch, for friends' Join. */
  Room.prototype._sayOwnRoom = function () {
    if (this.isSpectator || !this._serverUrl || !config.rooms || !OWN_SERVER_URL.test(this._serverUrl)) return;
    setOwnRoom({ serverUrl: this._serverUrl, roomCode: this.roomCode, friendJoinsEnabled: this.friendJoinsEnabled }).catch(function () { /* not one of the game's own servers, or a guest */ });
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
    // Another room's state comes with its first update.
    this.state = null;
    this._views = [];
    this._slots.clear();
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: roomCode }, config.site);
    this._setConnectionStatus("connecting");
    this._emit("moved", roomCode);
    this._connect();
  };
  Room.prototype._settle = function (settings) {
    this.isListed = settings.isListed;
    this.isOpen = settings.isOpen;
    this.friendJoinsEnabled = settings.friendJoinsEnabled !== false;
    this.name = settings.name || null;
    this.labels = settings.labels || {};
  };

  /*
   * Mute lasts for this room. A block is a wall both ways (zaisma.d.ts: room.block): between two
   * accounts it lasts until it's undone on zaisma.com/friends, and rooms find it themselves as players
   * join; any other block (a guest's, or of a guest) lasts for the session, in every game played in this
   * tab on Zaisma. Either way the room hears of it at once, and tells both players' games ("blocks"),
   * so each hides the other's emotes and phrases. Games never get anyone's list of blocks.
   */
  var blockKey = "zaisma:blocked:" + config.game;
  /** Session blocks this tab made in this game. */
  function blockedSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(blockKey) || "[]")); } catch (error) { return new Set(); }
  }
  function rememberBlock(playerId, isBlocked) {
    var blocked = blockedSet();
    if (isBlocked) blocked.add(playerId);
    else blocked.delete(playerId);
    try { sessionStorage.setItem(blockKey, JSON.stringify(Array.from(blocked))); } catch (error) { /* fine */ }
  }
  /** Blocks between accounts this tab made, which last: the room hears of them until its next pass and join find them. */
  var lastingBlocked = new Set();
  function hasBlocked(playerId) {
    return lastingBlocked.has(playerId) || blockedSet().has(playerId);
  }
  Room.prototype._mutedChanged = function () {
    var room = this;
    var hidden = new Set(Array.from(this._muted || []).concat(Array.from(blockedSet()), Array.from(lastingBlocked), Array.from(this._blocks || [])));
    this._emit("muted", Array.from(hidden).filter(function (playerId) { return !room.me || playerId !== room.me.id; }));
    this._tellPage();
  };
  /**
   * Tell the Zaisma page who's in the room, for the Players plate in its bar: the players, and which of
   * them this player muted or blocked. Blocks someone else made of them never leave the SDK.
   */
  Room.prototype._tellPage = function () {
    if (!onZaismaPage() || this._done || !this.roomCode) return;
    var ids = this.players.map(function (each) { return each.id; });
    var muted = this._muted || new Set();
    var session = blockedSet();
    window.parent.postMessage(this._spectating({
      type: "zaisma:players",
      code: this.roomCode,
      // Whether the room takes new players by its code, so the page shows the code or says it's closed.
      isOpen: this.isOpen !== false,
      myPlayerId: this.me ? this.me.id : null,
      players: this.players.map(function (each) { return { id: each.id, name: each.name, kind: each.kind }; }),
      mutedPlayerIds: ids.filter(function (playerId) { return muted.has(playerId); }),
      blockedPlayerIds: ids.filter(function (playerId) { return session.has(playerId); }),
      lastingBlockedPlayerIds: ids.filter(function (playerId) { return lastingBlocked.has(playerId); }),
    }), config.site);
  };
  /**
   * A message to the Zaisma page with how many watch, and whether this player is one of them, when anyone
   * is: the Players plate says so under the players, and a reload brings a spectator back to watching.
   */
  Room.prototype._spectating = function (message) {
    if (this.spectatorCount > 0) message.spectatorCount = this.spectatorCount;
    if (this.isSpectator) message.isSpectator = true;
    return message;
  };
  Room.prototype.isMuted = function (playerId) {
    return Boolean((this._muted && this._muted.has(playerId)) || hasBlocked(playerId) || (this._blocks && this._blocks.has(playerId)));
  };
  Room.prototype.mute = function (playerId) {
    (this._muted = this._muted || new Set()).add(playerId);
    this._mutedChanged();
  };
  Room.prototype.unmute = function (playerId) {
    if (this._muted) this._muted.delete(playerId);
    // A session block goes too. A block between accounts is undone on zaisma.com/friends, never from a game.
    if (blockedSet().has(playerId)) {
      rememberBlock(playerId, false);
      if (onZaismaPage()) window.parent.postMessage({ type: "zaisma:unblock", playerId: playerId }, config.site);
      joined.forEach(function (room) {
        if (room._said) delete room._said[playerId];
        if (room.players.some(function (each) { return each.id === playerId; })) room._say({ type: "unblock", playerId: playerId });
        room._mutedChanged();
      });
    }
    this._mutedChanged();
  };
  /** Block a player: true once they're blocked, false if the player changed their mind (zaisma.d.ts: room.block). */
  Room.prototype.block = function (playerId) {
    var room = this;
    var other = this.players.filter(function (each) { return each.id === playerId; })[0];
    if (!other || (this.me && playerId === this.me.id)) return Promise.reject(codedError("bad_player_id", "room.block takes the ID of another player in this room, from room.players."));
    return askToBlock(this, other).then(function (answer) {
      if (!answer) return false;
      if (answer.isLasting) {
        lastingBlocked.add(playerId);
        // The next pass carries the block, for the game's own servers.
        try { sessionStorage.removeItem(passKey); } catch (error) { /* fine */ }
      } else rememberBlock(playerId, true);
      joined.forEach(function (each) { each._sayBlocks(); each._mutedChanged(); });
      return true;
    });
  };
  /** Tell the room of this tab's blocks of players in it, each once a connection; on Zaisma, ask the page which others this session blocked. */
  Room.prototype._sayBlocks = function () {
    var room = this;
    var me = this.me ? this.me.id : null;
    room._said = room._said || {};
    room._asked = room._asked || {};
    var unasked = [];
    this.players.forEach(function (each) {
      if (each.id === me) return;
      // Spectators send nothing, blocks included: nothing of theirs reaches a player.
      if (hasBlocked(each.id) && !room._said[each.id] && !room.isSpectator) {
        room._said[each.id] = true;
        room._say({ type: "block", playerId: each.id });
      }
      if (!room._asked[each.id]) {
        room._asked[each.id] = true;
        unasked.push(each.id);
      }
    });
    if (unasked.length && onZaismaPage()) window.parent.postMessage({ type: "zaisma:blocks-among", playerIds: unasked }, config.site);
  };

  function onZaismaPage() {
    return Boolean(config.site && window.parent !== window);
  }

  // The Zaisma page answers which of the players asked about this tab blocked earlier in the session, in other games too.
  window.addEventListener("message", function (event) {
    if (!config.site || event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:blocks-among" || !Array.isArray(event.data.playerIds)) return;
    event.data.playerIds.forEach(function (playerId) { if (typeof playerId === "string") rememberBlock(playerId, true); });
    joined.forEach(function (room) { room._sayBlocks(); room._mutedChanged(); });
  });

  // The Players plate in the Zaisma page's bar mutes, unmutes and blocks through the game's own rooms.
  window.addEventListener("message", function (event) {
    var asked = event.data;
    if (!config.site || event.origin !== config.site || event.source !== window.parent || !asked || asked.type !== "zaisma:player-action" || typeof asked.playerId !== "string") return;
    var roomsWithPlayer = joined.filter(function (room) { return !room._done && room.players.some(function (each) { return each.id === asked.playerId; }); });
    if (asked.action === "mute") roomsWithPlayer.forEach(function (room) { room.mute(asked.playerId); });
    else if (asked.action === "unmute") roomsWithPlayer.forEach(function (room) { room.unmute(asked.playerId); });
    else if (asked.action === "block" && roomsWithPlayer.length) roomsWithPlayer[0].block(asked.playerId).catch(function () { /* fine */ });
  });

  var blockAsk = null;
  /**
   * Ask the Zaisma page to block a player: between two accounts it confirms with the player first and
   * keeps the block with the account ({ isLasting: true }); otherwise it keeps it for the session. The
   * answer is null when the player changed their mind. Outside Zaisma, the block lasts for this tab.
   */
  function askToBlock(room, other) {
    if (!onZaismaPage()) return Promise.resolve({ isLasting: false });
    // One question at a time: another block while the page is asking is a no.
    if (blockAsk) return Promise.resolve(null);
    blockAsk = new Promise(function (resolve) {
      var isAsking = false;
      var timer = setTimeout(function () { if (!isAsking) settle({ isLasting: false }); }, 1500);
      function settle(answer) {
        removeEventListener("message", onMessage);
        clearTimeout(timer);
        blockAsk = null;
        resolve(answer);
      }
      function onMessage(event) {
        if (event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:block" || event.data.playerId !== other.id) return;
        if (event.data.status === "asking") isAsking = true;
        else if (event.data.status === "blocked") settle({ isLasting: event.data.isLasting === true });
        else if (event.data.status === "cancelled") settle(null);
      }
      addEventListener("message", onMessage);
      window.parent.postMessage({ type: "zaisma:block", code: room.roomCode, playerKind: room.me ? room.me.kind : "guest", player: { id: other.id, name: other.name, kind: other.kind } }, config.site);
    });
    return blockAsk;
  }
  /** Report a player to Zaisma. reason: real_life_threat, personal_details, following_after_block or sexual (Zaisma looks), or harassment, cheating or other (passed to the game's developer). Nothing about you is sent. */
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
    return connect(joinOptions.roomCode ? String(joinOptions.roomCode).toUpperCase() : linkedRoomFor(joinOptions.serverUrl), joinOptions);
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
        friendJoinsEnabled: joinOptions.friendJoinsEnabled,
        name: joinOptions.name,
        labels: joinOptions.labels,
        joinData: joinOptions.joinData,
        clientIdle: clientIdle(joinOptions),
        serverUrl: serverUrl,
        isSpectator: joinOptions.isSpectator === true,
      });
      room._avoidsBlockedPlayers = joinOptions.avoidBlockedPlayers === true;
      room._isQuickJoin = joinOptions.isQuickJoin === true;
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
    if (config.tester) query.push("tester=" + config.tester);
    return fetch(config.rooms + "/v1/rooms/" + config.game + (query.length ? "?" + query.join("&") : "")).then(answered, requestFailed);
  }

  // A room that can't take this player, so another may: hosting_paused is an empty room that can't open again while its game's hosting is paused.
  var TRY_ANOTHER = ["full", "closed", "ended", "hosting_paused"];

  /** The linked room if it has space, else a listed room with space (nearby and busy first), else a new room. */
  function quickJoin(quickJoinOptions) {
    var refused = unknownOption(quickJoinOptions, QUICK_JOIN_OPTIONS, "Zaisma.rooms.quickJoin");
    if (refused) return Promise.reject(refused);
    quickJoinOptions = quickJoinOptions || {};
    var joinOptions = {};
    JOIN_OPTIONS.forEach(function (name) { if (quickJoinOptions[name] !== undefined) joinOptions[name] = quickJoinOptions[name]; });
    joinOptions.isQuickJoin = true;
    var linked = linkedRoomFor(quickJoinOptions.serverUrl);
    function fresh() { return connect(null, joinOptions); }
    function busiest() {
      return listRooms({ region: quickJoinOptions.region, labels: quickJoinOptions.labels }).then(function (found) {
        var tries = found.rooms.filter(function (room) { return room.isOpen && room.playerCount + room.heldSeatCount < room.maximumPlayerCount && room.roomCode !== linked; }).slice(0, 3);
        // Rooms with someone this player blocked come after the others, and before a new room.
        var later = [];
        function next() {
          var room = tries.shift();
          if (room) {
            return connect(room.roomCode, Object.assign({}, joinOptions, { avoidBlockedPlayers: true })).catch(function (error) {
              if (error.code === "blocked_player_here") later.push(room);
              else if (TRY_ANOTHER.indexOf(error.code) === -1) throw error;
              return next();
            });
          }
          room = later.shift();
          if (!room) return fresh();
          return connect(room.roomCode, joinOptions).catch(function (error) { if (TRY_ANOTHER.indexOf(error.code) !== -1) return next(); throw error; });
        }
        return next();
      }, fresh);
    }
    if (!linked) return busiest();
    return connect(linked, joinOptions).catch(function (error) { if (TRY_ANOTHER.indexOf(error.code) !== -1) return busiest(); throw error; });
  }

  /*
   * Friends in games (zaisma.d.ts: Zaisma.friends): the player's friends playing this game, and the
   * room on the game's own servers the player is in, so friends' Join works there too. The player's
   * pass says who's asking; games never see friends who aren't playing them.
   */
  var FRIENDS_KEPT_MS = 10000;
  var OWN_ROOM_CHECK_IN_MS = 2 * 60 * 1000;
  var OWN_ROOM_OPTIONS = ["serverUrl", "roomCode", "friendJoinsEnabled"];
  // The last answer and when it was asked, for 10 seconds.
  var friendsAsked = null;
  // The room on the game's own servers the player is in ({ serverUrl, roomCode }), said again every 2 minutes.
  var ownRoom = null;
  var ownRoomTimer = null;

  /** A call about friends with the player's pass, with a new pass once if Zaisma's keys changed; guests have no friends. */
  function friendsCall(path, body, isRetry) {
    return player().then(function (mine) {
      if (mine.kind !== "account") throw codedError("account_needed", "Friends are for players signed in to Zaisma: ask the player to sign in first (Zaisma.player.signIn).");
      return post(path, Object.assign({ gameSlug: config.game, pass: mine.pass }, body));
    }).catch(function (error) {
      if (error.code !== "bad_pass" || isRetry) throw error;
      try { sessionStorage.removeItem(passKey); } catch (storageError) { /* fine */ }
      return friendsCall(path, body, true);
    });
  }

  /** The player's friends playing this game, kept for 10 seconds (zaisma.d.ts: Friends.list). */
  function listFriends() {
    if (!config.rooms) return Promise.reject(notOnZaisma("Friends come from Zaisma, so they work only in games played on Zaisma."));
    if (friendsAsked && Date.now() - friendsAsked.atMs < FRIENDS_KEPT_MS) return friendsAsked.answer;
    var asked = {
      atMs: Date.now(),
      answer: friendsCall("/v1/friends", {}, false).then(function (found) {
        return {
          friends: found.friends.map(function (friend) {
            return { id: friend.player_id, name: friend.username, username: friend.username, roomCode: friend.room_code, serverUrl: friend.server_url, joinRefusal: friend.join_refusal };
          }),
        };
      }),
    };
    friendsAsked = asked;
    asked.answer.catch(function () { if (friendsAsked === asked) friendsAsked = null; });
    return asked.answer;
  }

  /** Which room on the game's own servers the player is in, or null (zaisma.d.ts: Friends.setRoom). */
  function setOwnRoom(room) {
    if (!config.rooms) return Promise.reject(notOnZaisma("Friends' Join comes from Zaisma, so it works only in games played on Zaisma."));
    if (room !== null) {
      if (!room || typeof room !== "object") return Promise.reject(codedError("unknown_option", "Zaisma.friends.setRoom takes { serverUrl, roomCode, friendJoinsEnabled? }, or null once the player left the room."));
      var refused = unknownOption(room, OWN_ROOM_OPTIONS, "Zaisma.friends.setRoom");
      if (refused) return Promise.reject(refused);
      var serverUrl = String(room.serverUrl || "").replace(/\/+$/, "");
      if (!OWN_SERVER_URL.test(serverUrl)) return Promise.reject(codedError("bad_server_url", "serverUrl takes your own server's address starting with wss:// or https://, like \"wss://play.example.com\"."));
      var roomCode = String(room.roomCode || "").toUpperCase();
      if (!ROOM_CODE.test(roomCode)) return Promise.reject(codedError("bad_room_code", JSON.stringify(room.roomCode) + " isn't a room code: room codes are six characters like \"K7Q2MX\", from 2 to 9 and A to Z without I or O."));
      room = { serverUrl: serverUrl, roomCode: roomCode, friendJoinsEnabled: room.friendJoinsEnabled !== false };
    }
    ownRoom = room;
    clearInterval(ownRoomTimer);
    ownRoomTimer = room ? setInterval(function () { sayOwnRoom().catch(function () { /* said again next time */ }); }, OWN_ROOM_CHECK_IN_MS) : null;
    return sayOwnRoom();
  }

  function sayOwnRoom() {
    var said = ownRoom ? { serverUrl: ownRoom.serverUrl, roomCode: ownRoom.roomCode, friendJoinsEnabled: ownRoom.friendJoinsEnabled } : { serverUrl: null, roomCode: null };
    return friendsCall("/v1/friends/room", said, false).then(function () { /* said */ }, function (error) {
      // A guest has no friends to tell.
      if (error.code !== "account_needed") throw error;
    });
  }

  // Closing the page leaves the room for friends at once; one that comes back from the back button says it again.
  addEventListener("pagehide", function () {
    var kept = ownRoom && config.rooms ? keptPass() : null;
    if (!kept || kept.kind !== "account") return;
    try {
      fetch(config.rooms + "/v1/friends/room", { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ gameSlug: config.game, pass: kept.pass, serverUrl: null, roomCode: null }) }).catch(function () { /* drops off by itself */ });
    } catch (error) {
      /* drops off by itself */
    }
  });
  addEventListener("pageshow", function (event) {
    if (event.persisted && ownRoom) sayOwnRoom().catch(function () { /* said again next time */ });
  });

  var REQUEST_OPTIONS = ["serverUrl"];
  var MAXIMUM_REQUEST_SIZE_BYTES = 16 * 1024;

  /**
   * A request to the game's own game server, its onRequest, outside any room: what it answered
   * (zaisma.d.ts: Zaisma.server.request). The player's pass goes with it, so the server knows who's asking.
   */
  function serverRequest(request, requestOptions, isRetry) {
    var refused = unknownOption(requestOptions, REQUEST_OPTIONS, "Zaisma.server.request");
    if (refused) return Promise.reject(refused);
    var serverUrl = requestOptions && requestOptions.serverUrl ? String(requestOptions.serverUrl).replace(/\/+$/, "") : null;
    if (!serverUrl && !config.rooms) return Promise.reject(notOnZaisma("Outside Zaisma, Zaisma.server.request needs your own game server's address, like { serverUrl: \"https://play.example.com\" }."));
    if (serverUrl && !SERVER_URL.test(serverUrl)) return Promise.reject(codedError("bad_server_url", "serverUrl takes a full address starting with https://, http://, wss:// or ws://, like \"https://play.example.com\"."));
    var requestText;
    try {
      requestText = JSON.stringify(request === undefined ? null : request);
    } catch (error) {
      requestText = undefined;
    }
    if (requestText === undefined) return Promise.reject(codedError("bad_request", "A request is plain JSON: numbers, text, true or false, null, lists and plain objects, like { type: \"buy\", itemId: \"sword\" }."));
    if (new TextEncoder().encode(requestText).length > MAXIMUM_REQUEST_SIZE_BYTES) return Promise.reject(codedError("too_big", "Requests are up to 16 KB as JSON."));
    var base = (serverUrl || config.rooms).replace(/^ws/, "http");
    return player().then(function (mine) {
      return fetch(base + "/v1/requests/" + config.game, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ pass: mine.pass, request: JSON.parse(requestText) }) }).then(answered, requestFailed);
    }).then(function (answer) {
      return answer.answer;
    }, function (error) {
      // A pass this tab kept from before Zaisma changed its keys: get a new one and try once more.
      if (error.code !== "bad_pass" || isRetry) throw error;
      try { sessionStorage.removeItem(passKey); } catch (storageError) { /* fine */ }
      return serverRequest(request, requestOptions, true);
    });
  }

  var server = {
    request: function (request, requestOptions) { return serverRequest(request, requestOptions, false); },
  };

  /** Zaisma's chat filter: { isAllowed, reason, message, hasSwearing, text } (zaisma.d.ts: Zaisma.filterText). */
  function filterText(text) {
    return post("/v1/filter", { gameSlug: config.game, text: String(text == null ? "" : text) });
  }

  /**
   * On Zaisma, the page's Share (its QR code, the link and the room's code): "opened". Elsewhere the
   * share sheet on phones, else copy the link: "shared", "copied", "cancelled" or "failed".
   */
  function invite(room) {
    if (onZaismaPage()) {
      window.parent.postMessage({ type: "zaisma:share" }, config.site);
      return Promise.resolve("opened");
    }
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

  /*
   * Registered links (zaisma.d.ts: Zaisma.links.open). On Zaisma, the page around the game looks the
   * link up, shows its "You're leaving Zaisma" card and opens it; on the developer's own site there's no
   * Zaisma page, so the SDK opens ownSiteUrl itself. Either way only right after the player's tap.
   */
  var LINK_OPTIONS = ["path", "queryParameters", "ownSiteUrl"];
  var LINK_NAME = /^[a-z][a-z0-9_]{0,31}$/;
  var LINK_PATH = /^(\/[^/?#\\]+)+\/?$/;
  // What the page answers when a link can't be looked up; anything else is request_failed.
  var LINK_ERROR_CODES = ["needs_player_tap", "unknown_link", "bad_link_path", "bad_link_query", "slow_down", "request_failed"];
  var linkRequestCount = 0;
  var linkWaiters = {};

  window.addEventListener("message", function (event) {
    if (!config.site || event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:link") return;
    var waiter = linkWaiters[event.data.requestNumber];
    if (!waiter) return;
    if (event.data.status === "asking") { waiter.isAsked = true; return; }
    delete linkWaiters[event.data.requestNumber];
    clearTimeout(waiter.timer);
    if (event.data.status === "opened" || event.data.status === "stayed") return waiter.resolve(event.data.status);
    var code = LINK_ERROR_CODES.indexOf(event.data.code) === -1 ? "request_failed" : event.data.code;
    waiter.reject(codedError(code, typeof event.data.message === "string" ? event.data.message : "Zaisma didn't answer, so check the connection and try again."));
  });

  /** What's wrong with the path and query a game adds under a link's address, or null. */
  function linkPartsProblem(linkOptions) {
    var path = linkOptions.path;
    var query = linkOptions.queryParameters;
    var isBadPath = path !== undefined && path !== null && (typeof path !== "string" || path.length > 500 || !LINK_PATH.test(path) || path.split("/").some(function (segment) {
      var dots = segment.replace(/%2e/gi, ".");
      return dots === "." || dots === "..";
    }));
    if (isBadPath) return codedError("bad_link_path", "path " + JSON.stringify(path) + " isn't a path to add under the link's address: it starts with /, like \"/buy\", with no ?, #, . or .. parts. Give query parameters as queryParameters.");
    if (query === undefined || query === null) return null;
    var names = typeof query === "object" && !Array.isArray(query) ? Object.keys(query) : null;
    var isBadQuery = !names || names.length > 20 || names.some(function (name) { return !name || name.length > 100 || typeof query[name] !== "string" || query[name].length > 500; });
    return isBadQuery ? codedError("bad_link_query", "queryParameters takes up to 20 names, each with text of up to 500 characters, like { item: \"sword\", count: String(3) }.") : null;
  }

  /** Open one of the game's registered links: "opened" or "stayed" (zaisma.d.ts: Zaisma.links.open). */
  function openLink(linkName, linkOptions) {
    var refused = unknownOption(linkOptions, LINK_OPTIONS, "Zaisma.links.open");
    if (refused) return Promise.reject(refused);
    linkOptions = linkOptions || {};
    if (typeof linkName !== "string" || !LINK_NAME.test(linkName)) return Promise.reject(codedError("unknown_link", JSON.stringify(linkName) + " isn't a link name: open a link by the link_name registered on the game, like \"store\"."));
    var problem = linkPartsProblem(linkOptions);
    if (problem) return Promise.reject(problem);
    var ownSiteUrl = linkOptions.ownSiteUrl;
    if (ownSiteUrl !== undefined && ownSiteUrl !== null && (typeof ownSiteUrl !== "string" || !/^https:\/\/[^/]/.test(ownSiteUrl))) return Promise.reject(codedError("bad_own_site_url", "ownSiteUrl takes the link's whole address on your own site, starting with https://, like \"https://kit.itch.io/sky-hopper\"."));
    // Only right after the player tapped or pressed a key in the game, so nothing ever opens by itself.
    if (navigator.userActivation && !navigator.userActivation.isActive) return Promise.reject(codedError("needs_player_tap", "Links open only right after the player taps or presses a key in the game: call Zaisma.links.open from that tap's handler."));
    if (!config.site || window.parent === window) return openOnOwnSite(linkOptions);
    return new Promise(function (resolve, reject) {
      var requestNumber = ++linkRequestCount;
      var waiter = { resolve: resolve, reject: reject, isAsked: false };
      // The page answers at once that it's asking; no answer means no Zaisma page is around the game.
      waiter.timer = setTimeout(function () {
        if (waiter.isAsked) return;
        delete linkWaiters[requestNumber];
        reject(notOnZaisma("No Zaisma page answered: links open when the game is played on its zaisma.com page, or give ownSiteUrl for your own site."));
      }, 3000);
      linkWaiters[requestNumber] = waiter;
      window.parent.postMessage({ type: "zaisma:link", requestNumber: requestNumber, linkName: linkName, path: linkOptions.path === undefined ? null : linkOptions.path, queryParameters: linkOptions.queryParameters === undefined ? null : linkOptions.queryParameters }, config.site);
    });
  }

  /** On the developer's own site: the address the game gave, with the path and query added under it. */
  function openOnOwnSite(linkOptions) {
    if (!linkOptions.ownSiteUrl) return Promise.reject(notOnZaisma("Outside Zaisma there's no page to look the link up, so give its address too, like Zaisma.links.open(\"store\", { ownSiteUrl: \"https://kit.itch.io/sky-hopper\" })."));
    var url = new URL(linkOptions.ownSiteUrl);
    var basePath = url.pathname.replace(/\/+$/, "");
    if (linkOptions.path) url.pathname = basePath + linkOptions.path;
    var query = linkOptions.queryParameters || {};
    Object.keys(query).forEach(function (name) { url.searchParams.append(name, query[name]); });
    var opened = window.open(url.href, "_blank");
    if (opened) opened.opener = null;
    return Promise.resolve(opened ? "opened" : "stayed");
  }

  var links = { open: openLink };

  /*
   * A version the developer published "now", for a game that isn't in a match (single-player, or a menu):
   * the page beside it notices, and a game listening switches when it says (update.apply()); otherwise the
   * page offers Update beside the game. Never forced. Matches hear it from their room ("versionUpdate").
   */
  var versionsEvents = new Emitter(VERSIONS_EVENTS, "Zaisma.versions has");
  var versions = {
    on: function (event, listener) {
      versionsEvents.on(event, listener);
      return versions;
    },
    off: function (event, listener) {
      versionsEvents.off(event, listener);
      return versions;
    },
  };
  if (config.site && window.parent !== window) {
    // Which version this tab runs, so the page knows when a newer one is out.
    if (config.version) window.parent.postMessage({ type: "zaisma:version", versionId: config.version }, config.site);
    window.addEventListener("message", function (event) {
      if (event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:version-ready") return;
      var isHandled = (versionsEvents._on.update || []).length > 0;
      if (isHandled) {
        versionsEvents._emit("update", {
          versionId: event.data.versionId,
          apply: function () { window.parent.postMessage({ type: "zaisma:reload", code: null }, config.site); },
        });
      }
      window.parent.postMessage({ type: "zaisma:version-ready", versionId: event.data.versionId, isHandled: isHandled }, config.site);
    });
  }

  /*
   * The player's cloud saves, for games that draw their own save screens. The game page on Zaisma holds
   * the player's session and answers (apps/site/src/saves-client.ts); the game never talks to a server.
   */
  var SAVE_COPY_ID = /^save_copy_[a-z0-9-]{1,40}$/;
  var SAVES_ERROR_CODES = ["account_needed", "bad_save_copy_id", "no_save_copy", "cloud_saves_off", "slow_down", "request_failed"];
  var savesRequestCount = 0;
  var savesWaiters = {};
  var savesEvents = new Emitter(SAVES_EVENTS, "Zaisma.saves has");

  /** An earlier version as the game gets it (SaveCopy). */
  function saveCopyOf(given) {
    return { id: given.id, savedAt: given.savedAt, copyReason: given.copyReason, sizeBytes: given.sizeBytes, isCurrentSave: given.isCurrentSave };
  }

  window.addEventListener("message", function (event) {
    if (!config.site || event.origin !== config.site || event.source !== window.parent || !event.data) return;
    var message = event.data;
    if (message.type === "zaisma:saves-event") {
      var given = message.event || {};
      if (message.eventName === "conflict" && given.keptSaveCopy) savesEvents._emit("conflict", { winningProgress: given.winningProgress, keptSaveCopy: saveCopyOf(given.keptSaveCopy) });
      if (message.eventName === "developerChange") savesEvents._emit("developerChange", { changedAt: given.changedAt, keptSaveCopy: given.keptSaveCopy ? saveCopyOf(given.keptSaveCopy) : null });
      return;
    }
    if (message.type !== "zaisma:saves-answer") return;
    var waiter = savesWaiters[message.requestNumber];
    if (!waiter) return;
    if (message.status === "asking") { waiter.isAsked = true; return; }
    delete savesWaiters[message.requestNumber];
    clearTimeout(waiter.timer);
    if (!message.error) return waiter.resolve(message.answer);
    var code = SAVES_ERROR_CODES.indexOf(message.error.code) === -1 ? "request_failed" : message.error.code;
    waiter.reject(codedError(code, typeof message.error.message === "string" ? message.error.message : "Zaisma didn't answer, so check the connection and try again."));
  });

  /** Ask the game page about the player's saves: its answer, or an error with a code. */
  function askSaves(request, saveCopyId) {
    if (!config.site || window.parent === window) return Promise.reject(notOnZaisma("Cloud saves work when the game is played on its zaisma.com page."));
    return new Promise(function (resolve, reject) {
      var requestNumber = ++savesRequestCount;
      var waiter = { resolve: resolve, reject: reject, isAsked: false };
      // The page answers at once that it's asking; no answer means no Zaisma page is around the game.
      waiter.timer = setTimeout(function () {
        if (waiter.isAsked) return;
        delete savesWaiters[requestNumber];
        reject(notOnZaisma("No Zaisma page answered: cloud saves work when the game is played on its zaisma.com page."));
      }, 3000);
      savesWaiters[requestNumber] = waiter;
      window.parent.postMessage({ type: "zaisma:saves-request", requestNumber: requestNumber, request: request, saveCopyId: saveCopyId }, config.site);
    });
  }
  function checkedSaveCopyId(saveCopyId) {
    return typeof saveCopyId === "string" && SAVE_COPY_ID.test(saveCopyId) ? null : codedError("bad_save_copy_id", JSON.stringify(saveCopyId) + " isn't a save copy ID: give an id from Zaisma.saves.listCopies(), like \"save_copy_k2v9q4x7m1p3w8r5t6y0\".");
  }

  var savesListened = {};
  var saves = {
    // Listening for an event tells the page, the first time for each, so it sends that event.
    on: function (event, listener) {
      savesEvents.on(event, listener);
      if (!savesListened[event] && config.site && window.parent !== window) {
        savesListened[event] = true;
        window.parent.postMessage({ type: "zaisma:saves-request", requestNumber: ++savesRequestCount, request: "listen", eventNames: [event] }, config.site);
      }
      return saves;
    },
    off: function (event, listener) {
      savesEvents.off(event, listener);
      return saves;
    },
  };
  saves.listCopies = function () {
    return askSaves("list_copies").then(function (copies) { return copies.map(saveCopyOf); });
  };
  saves.getCopy = function (saveCopyId) {
    var problem = checkedSaveCopyId(saveCopyId);
    if (problem) return Promise.reject(problem);
    return askSaves("get_copy", saveCopyId).then(function (copy) {
      var contents = saveCopyOf(copy);
      contents.localStorageItems = copy.localStorageItems;
      contents.indexeddbDatabases = copy.indexeddbDatabases;
      return contents;
    });
  };
  saves.restoreCopy = function (saveCopyId) {
    var problem = checkedSaveCopyId(saveCopyId);
    if (problem) return Promise.reject(problem);
    return askSaves("restore_copy", saveCopyId).then(function () { return undefined; });
  };

  var joined = [];

  // The room this tab last left and when it joined it, for its own room lists, and for the Zaisma page's (zaisma:left).
  var recent = null;
  function left(room) {
    if (ownRoom && room._serverUrl === ownRoom.serverUrl && room.roomCode === ownRoom.roomCode) setOwnRoom(null).catch(function () { /* fine: it drops off by itself */ });
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
  // A ticking room probes every probeIntervalSec, so this long without a word from it means the connection is gone.
  var SILENCE_MS = 8000;
  var ASK_MS = 30000;
  var lastInputAtMs = Date.now();
  var asking = null; // { untilMs, rooms } while "Still there?" is up
  var watching = null;

  function watch() {
    if (watching) return;
    watching = setInterval(check, 1000);
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
      // In a ticking room, silence. Not while the player is away or the game is hidden: the room stops probing players who walked away.
      if (room._probeIntervalSec && !room._away && !room._idleSent && !document.hidden && nowMs - room._heardAtMs > SILENCE_MS) return room._lost();
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

  // The first four go to Zaisma; the rest to the game's developer.
  var REASONS = [["real_life_threat", "Threatening them in real life"], ["personal_details", "Sharing someone's personal details"], ["following_after_block", "Following me after I blocked them"], ["sexual", "Sexual behavior"], ["harassment", "Harassing or bullying"], ["cheating", "Cheating"], ["other", "Something else"]];

  /** A ready-made mute, block and report panel. Games open it from their own menu. */
  function openSafetyPanel(room) {
    // On Zaisma, the page's own Players (the bar's), so a game's Players button opens the same one.
    if (onZaismaPage()) {
      window.parent.postMessage({ type: "zaisma:players-open" }, config.site);
      return;
    }
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
        // Only what this player did themselves shows: a block someone made of them never does.
        var isBlocked = hasBlocked(other.id);
        var isMuted = Boolean(room._muted && room._muted.has(other.id));
        var name = document.createElement("span");
        name.textContent = other.name + (isBlocked ? " (blocked)" : isMuted ? " (muted)" : "");
        name.style.flex = "1";
        row.appendChild(name);
        function button(text, onclick) {
          var each = document.createElement("button");
          each.textContent = text;
          each.style.cssText = buttonStyle;
          each.onclick = onclick;
          row.appendChild(each);
        }
        // A lasting block is undone on zaisma.com/friends; a session one here.
        if (!lastingBlocked.has(other.id)) button(isBlocked ? "Unblock" : isMuted ? "Unmute" : "Mute", function () { isBlocked || isMuted ? room.unmute(other.id) : room.mute(other.id); render(); });
        if (!isBlocked) {
          button("Block", function () {
            room.block(other.id).then(function (isDone) {
              render(!isDone ? undefined : lastingBlocked.has(other.id) ? other.name + " is blocked. Unblock them on your Zaisma friends page." : other.name + " is blocked for this session.");
            }, function () { render(); });
          });
        }
        button("Report", function () { handOff(room, other, close, function () { reportForm(other); }); });
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

  var rooms = { list: listRooms, quickJoin: quickJoin, linkedRoomCode: roomCodeFromPage(), linkedServerUrl: roomCodeFromPage() ? serverUrlFromPage() : null, isLinkedAsSpectator: watchFromPage() };
  var friends = { list: listFriends, setRoom: setOwnRoom };
  window.Zaisma = { sdkVersionNumber: 1, gameSlug: config.game || null, player: player, joinRoom: joinRoom, rooms: rooms, server: server, invite: invite, filterText: filterText, openSafetyPanel: openSafetyPanel, links: links, friends: friends, saves: saves, versions: versions };
})();
