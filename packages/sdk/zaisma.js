/*
 * The Zaisma SDK. On Zaisma, games include it with one tag:
 *   <script src="_zaisma/v1.js"></script>   (relative, from the game's top folder)
 * Plain JavaScript, no dependencies, MIT licensed. Every part is optional.
 *
 *   const room = await Zaisma.joinRoom();     // joins ?room=CODE if present, else makes a room
 *   room.me; room.players; room.code; room.inviteLink;
 *   room.on("message", (msg) => {});          // from the game server
 *   room.on("players", (list) => {});
 *   room.on("status", (s) => {});             // "connecting" | "open" | "reconnecting" | "away" | "closed"
 *   room.on("ended", (reason) => {});
 *   room.send({ move: "left" });
 *   room.leave();
 *   Zaisma.joinRoom({ server: "wss://my-server.example" });  // your own game server
 *   Zaisma.joinRoom({ data: { character: "knight" } });       // data for the game server's onJoin, up to 4 KB
 *
 * Players who walk away. The SDK pings the room every 25 seconds (a connection that stops answering
 * comes back by itself) and says goodbye as the page goes. After 10 minutes without input (the game
 * server's idleAfter) it asks "Still there?" for 30 seconds, then tells the room; in a real-time room,
 * the game hidden for 2 minutes counts too. The room then takes the player out of the match and holds
 * their seat for a few minutes, unless the game server decides (onAway). Any input brings them back.
 *   room.on("idle", (asking) => {});          // true: ask "Still there?" yourself (replaces Zaisma's small plate);
 *                                             // false: they answered, or time's up
 *   room.on("away", ({ why, seconds }) => {}); // out of the match ("idle" or "hidden"), seat held for seconds
 *   room.on("back", (back) => { back.rejoin(); });  // back after the seat ran out: listening turns off
 *                                             // rejoining by itself; rejoin() fails if the room is full or over
 *   Zaisma.joinRoom({ idle: 300 });           // seconds without input before "Still there?"; false: never ask
 *                                             // (the room's own check still applies, except with the relay)
 * When the game server sends the player to another room (room.reserve or room.moveTo), the room
 * follows by itself: same room object, new code, a "moved" event, then "players" with the new list.
 *   room.on("moved", (code) => {});
 *   room.on("move", (move) => { showLoading(); move.follow(); });  // step in: listening to "move" turns
 *                                             // off following by itself; move.follow() goes when you're ready
 *   room.on("kicked", ({ reason, keptOut }) => {});  // removed from the room by the game server or the host
 *   room.host;                                // the host's player ID, when the game server gives the host controls
 *   room.kick(playerId, { keepOut: true });   // the host removes a player (relay games; keepOut: for the rest of the match)
 *   await Zaisma.invite(room);                // share sheet on phones, copies the link elsewhere
 *
 * Room browsing. Listed rooms show on the game's Zaisma page and to the game itself:
 *   Zaisma.rooms.linked;                      // the room code the player's link points to, or null
 *   const { rooms, playing, regions } = await Zaisma.rooms.list();  // rooms: [{ code, players, max, open, location, near, link }]
 *                                             // location: { country: "DE", name: "Germany", continent: "EU" } or null
 *   Zaisma.rooms.list({ region: "EU", labels: { Mode: "Classic" } });  // one region, or rooms with these labels
 *   const room = await Zaisma.rooms.quickJoin();           // the linked room, else a busy one with space, else a new one
 *   Zaisma.rooms.quickJoin({ region: "EU", labels: { Mode: "Classic" } });  // a room like that with space, else a new one with those labels
 *   Zaisma.joinRoom({ listed: false });       // a new room that's never listed (a private match)
 *   Zaisma.joinRoom({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });  // name and label a new room
 *   room.listed; room.open; room.name; room.labels; room.on("room", ({ listed, open, name, labels }) => {});
 *   room.setListed(false); room.setOpen(false); room.setInfo({ name, labels });
 *                                             // with the relay, from the room's host (its first player);
 *                                             // otherwise the game server decides (room.setInfo)
 *   await Zaisma.filterText("what a player typed");  // { ok, reason, text }: Zaisma's text filter
 * Names and labels players type show on Zaisma's pages only if they pass the filter. Inside your game
 * they're yours to look after: filterText is there if you want it.
 * A closed room takes no new players; players who were in it can still come back.
 *
 * Player safety. Games where players interact must offer mute, block and report:
 *   Zaisma.openSafetyPanel(room);           // ready-made panel; call it from your menu
 *   room.isMuted(playerId);                 // true if muted or blocked: hide their emotes/phrases
 *   room.on("muted", (ids) => {});          // the muted list changed
 *   room.mute(id); room.unmute(id); room.block(id); room.report(id, reason)
 * On Zaisma, the panel's Report opens Zaisma's own report plate beside the game, and the
 * player is muted once the report is sent.
 *
 * On Zaisma, the games Worker defines __ZAISMA__ before this file with the rooms
 * address, the game and the site. Anywhere else, pass { server } yourself.
 *
 * Player passes (for rooms and your own servers) need the game played on its zaisma.com page, which
 * checks the browser on Play: joining fails with err.code "unchecked" when it couldn't, or when the
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

  function Emitter() {
    this._on = {};
  }
  Emitter.prototype.on = function (event, fn) {
    (this._on[event] = this._on[event] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function (event, fn) {
    this._on[event] = (this._on[event] || []).filter(function (f) { return f !== fn; });
    return this;
  };
  Emitter.prototype._emit = function (event, value) {
    (this._on[event] || []).slice().forEach(function (fn) {
      try { fn(value); } catch (err) { console.error(err); }
    });
  };

  function post(path, body) {
    // text/plain keeps this a simple request, so the browser needs no preflight.
    return fetch(config.rooms + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) { var err = new Error(data.error || "Zaisma request failed"); if (data.code) err.code = data.code; throw err; }
        return data;
      });
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
        function fail(message) { var err = new Error(message); err.code = "unchecked"; reject(err); }
        if (!config.site || window.parent === window) return fail("Online play works when the game is played on Zaisma.");
        // The check usually answers in a second or two, or asks the player to tap a box.
        var timer = setTimeout(function () { removeEventListener("message", onMessage); fail(UNCHECKED); }, 30000);
        function onMessage(e) {
          if (e.origin !== config.site || e.source !== window.parent || !e.data || e.data.type !== "zaisma:room-key") return;
          removeEventListener("message", onMessage);
          clearTimeout(timer);
          if (typeof e.data.key === "string") resolve(e.data.key);
          else fail(UNCHECKED);
        }
        addEventListener("message", onMessage);
        window.parent.postMessage({ type: "zaisma:room-key" }, config.site);
      });
    }
    return keyPromise;
  }

  /** This tab's guest player: { id, name, pass }. Kept only for the tab, like the guest it belongs to. */
  function player() {
    if (!config.rooms) return Promise.reject(new Error("Zaisma player passes only work on Zaisma"));
    try {
      var saved = JSON.parse(sessionStorage.getItem(passKey) || "null");
      if (saved && saved.expiresAt - Date.now() > 10 * 60 * 1000) return Promise.resolve(saved);
    } catch (e) { /* storage off: fetch a new pass */ }
    if (!passPromise) {
      passPromise = roomKey().then(function (key) {
        return post("/v1/pass", { game: config.game, key: key });
      }).then(function (data) {
        var p = { id: data.player.id, name: data.player.name, pass: data.pass, expiresAt: data.expiresAt };
        try { sessionStorage.setItem(passKey, JSON.stringify(p)); } catch (e) { /* fine */ }
        passPromise = null;
        return p;
      }, function (err) {
        passPromise = null;
        throw err;
      });
    }
    return passPromise;
  }

  function codeFromPage() {
    try {
      var code = new URLSearchParams(location.search).get("room");
      return code && CODE.test(code.toUpperCase()) ? code.toUpperCase() : null;
    } catch (e) {
      return null;
    }
  }

  function randomCode() {
    var alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(6)), function (b) { return alphabet[b & 31]; }).join("");
  }

  function Room(opts) {
    Emitter.call(this);
    this.code = opts.code;
    this.me = null;
    this.players = [];
    this.host = null;
    this.status = "connecting";
    this.inviteLink = config.site && config.game ? config.site + gamePage() + "?room=" + this.code : null;
    this.listed = opts.listed !== false;
    this.open = true;
    this.name = null;
    this.labels = {};
    this._url = opts.url;
    this._pass = opts.pass;
    this._made = { listed: opts.listed === false ? false : undefined, name: opts.name, labels: opts.labels };
    this._data = opts.data;
    this._server = opts.server;
    this._tries = 0;
    this._done = false;
    this._ready = null;
    // Walking away: the idle check the game asked for, when the room counts the player away (from welcome),
    // whether they're out of the match (and their connection gone too), and the last ping, pong and message.
    this._idle = opts.idle === false || typeof opts.idle === "number" ? opts.idle : undefined;
    this._checks = { idle: null, hidden: null };
    this._away = false;
    this._gone = false;
    this._idleSent = false;
    this._pingAt = 0;
    this._pongAt = 0;
    this._sentAt = 0;
  }
  Room.prototype = Object.create(Emitter.prototype);

  /** Send a message to the room if the connection is open. */
  Room.prototype._say = function (m) {
    if (!this._ws || this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify(m));
    this._sentAt = Date.now();
  };

  Room.prototype._connect = function () {
    var room = this;
    var ws = new WebSocket(this._url);
    this._ws = ws;
    watch();
    ws.onopen = function () {
      room._pingAt = room._pongAt = Date.now();
      room._say({ t: "hello", pass: room._pass, room: room._made, data: room._data, idle: room._idle });
    };
    ws.onmessage = function (ev) {
      if (ev.data === "pong") { room._pongAt = Date.now(); return; }
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "welcome") {
        var wasAway = room._away;
        room._tries = 0;
        room.me = m.me;
        room.players = m.players;
        room.host = m.host || null;
        room._checks = m.away || { idle: null, hidden: null };
        room._away = room._gone = room._idleSent = room._coming = room._offered = false;
        // From here on, the room's row counts this player (room lists leave them out once they've left).
        room._joinedAt = Date.now();
        if (m.room) room._settle(m.room);
        room._setStatus("open");
        if (room._moved || wasAway) { room._moved = false; room._emit("players", m.players); }
        if (room._ready) { room._ready.resolve(room); room._ready = null; }
        // In (again, after walking away or a move): the Zaisma page counts on knowing.
        if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: room.code, joined: true }, config.site);
        // Hidden already (a move, a reconnect): the room should know.
        if (document.hidden && room._checks.hidden) room._say({ t: "hidden" });
      } else if (m.t === "away") {
        room._away = true;
        room._idleSent = room._coming = false;
        room._setStatus("away");
        room._emit("away", { why: m.why, seconds: m.seconds });
        left(room);
      } else if (m.t === "players") {
        room.players = m.players;
        room.host = m.host || null;
        room._emit("players", m.players);
      } else if (m.t === "msg") {
        room._emit("message", m.d);
      } else if (m.t === "room") {
        room._settle(m.room);
        room._emit("room", m.room);
      } else if (m.t === "move") {
        if ((room._on.move || []).length) room._emit("move", room._move(m));
        else room._follow(m.code);
      } else if (m.t === "kicked") {
        room._done = true;
        room._emit("kicked", { reason: m.reason, keptOut: m.keptOut === true });
        left(room);
      } else if (m.t === "ended") {
        room._done = true;
        room._emit("ended", m.reason);
        left(room);
      } else if (m.t === "error") {
        room._emit("error", m);
        if (room._ready && (m.code === "full" || m.code === "closed" || m.code === "ended" || m.code === "bad-pass" || m.code === "too-big" || m.code === "game-unavailable" || m.code === "kept-out" || m.code === "refused" || m.code === "month-limit")) {
          room._done = true;
          var err = new Error(m.message);
          err.code = m.code;
          room._ready.reject(err);
          room._ready = null;
        }
      }
    };
    ws.onclose = function (ev) {
      // 4000: the match ended. 4001: refused or replaced by another tab. Neither comes back.
      if (room._done || ev.code === 4000 || ev.code === 4001) {
        room._done = true;
        room._setStatus("closed");
        if (room._ready) { room._ready.reject(new Error(ev.reason || "Couldn't join the room")); room._ready = null; }
        return;
      }
      // 4002: the room stopped holding the seat of a player who walked away. Either way, while they're
      // away, wait for them to come back before connecting again.
      if (ev.code === 4002 || room._away) {
        room._ws = null;
        room._away = room._gone = true;
        room._setStatus("away");
        return;
      }
      room._setStatus("reconnecting");
      var wait = Math.min(8000, 500 * Math.pow(2, room._tries++));
      setTimeout(function () { if (!room._done) room._connect(); }, wait);
    };
  };

  /** The connection stopped answering pings (lost signal, a laptop waking up): drop it and connect again. */
  Room.prototype._lost = function () {
    var ws = this._ws;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try { ws.close(); } catch (e) { /* fine */ }
    }
    this._ws = null;
    if (this._away) { this._gone = true; return; }
    this._setStatus("reconnecting");
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
      this._say({ t: "back" });
    }
    if (!this._away || this._coming) return;
    if (this._ws && this._ws.readyState === 1) {
      this._coming = true;
      this._say({ t: "back", data: this._data, idle: this._idle });
      return;
    }
    if (!this._gone || this._offered || this._paused) return;
    this._offered = true;
    var room = this;
    function rejoin() {
      if (room._done || room._ws) return;
      room._tries = 0;
      room._setStatus("connecting");
      room._connect();
    }
    if ((this._on.back || []).length) this._emit("back", { code: this.code, rejoin: rejoin });
    else rejoin();
  };

  /** Seconds without input before this room's player is asked "Still there?", or null: the game's choice, else the room's. */
  Room.prototype._idleAfter = function () {
    if (this._idle === false) return null;
    return typeof this._idle === "number" ? this._idle : this._checks.idle;
  };

  Room.prototype._setStatus = function (s) {
    if (this.status === s) return;
    this.status = s;
    this._emit("status", s);
  };

  /** Send a message to the game server. Plain JSON, up to 16 KB. Send input when it changes, not every frame. */
  Room.prototype.send = function (data) {
    if (!this._away) this._say({ t: "msg", d: data });
  };

  /**
   * Show or hide the room in room lists, and open or close it to new players. Works from the room's
   * host (its first player) when the game uses the relay; with a game server, the server decides.
   * The "room" event says when it changed.
   */
  Room.prototype.setListed = function (listed) {
    this._say({ t: "room", listed: Boolean(listed) });
  };
  Room.prototype.setOpen = function (open) {
    this._say({ t: "room", open: Boolean(open) });
  };
  /**
   * The host removes a player, when the game server gives the host controls (the relay does).
   * keepOut: true keeps them out for the rest of the match. They're told the host removed them.
   */
  Room.prototype.kick = function (playerId, opts) {
    this._say({ t: "kick", player: playerId, keepOut: Boolean(opts && opts.keepOut) });
  };
  /** Name and label the room: { name, labels }. Leave a field out to keep it; null clears it. */
  Room.prototype.setInfo = function (info) {
    info = info || {};
    this._say({ t: "room", name: info.name, labels: info.labels });
  };
  /**
   * The game server sent this player to another room: { code, follow(), join(opts) }. follow() moves
   * this room object there. join takes joinRoom's options and joins it as a new room object instead,
   * on the same server as this one (leave this one first).
   */
  Room.prototype._move = function (m) {
    var server = this._server;
    var room = this;
    return {
      code: m.code,
      follow: function () { room._follow(m.code); },
      join: function (opts) {
        return connect(m.code, Object.assign({}, opts || {}, { server: server }));
      },
    };
  };
  /** Move this room object to another room of the game: the old connection closes, the new one opens. */
  Room.prototype._follow = function (code) {
    if (this._done || !CODE.test(code) || code === this.code) return;
    var old = this._ws;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try { old.close(1000, "Moved"); } catch (e) { /* fine */ }
    }
    this._ws = null;
    left(this);
    this._gone = this._coming = false;
    this.code = code;
    this._url = this._url.replace(/[A-Z0-9]{6}$/, code);
    if (this.inviteLink) this.inviteLink = config.site + gamePage() + "?room=" + code;
    this._made = {};
    this._data = undefined;
    this._tries = 0;
    this._moved = true;
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: code }, config.site);
    this._setStatus("connecting");
    this._emit("moved", code);
    this._connect();
  };
  Room.prototype._settle = function (r) {
    this.listed = r.listed;
    this.open = r.open;
    this.name = r.name || null;
    this.labels = r.labels || {};
  };

  // Mute lasts for this room; block lasts for every room this tab joins.
  var blockKey = "zaisma:blocked:" + config.game;
  function blockedSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(blockKey) || "[]")); } catch (e) { return new Set(); }
  }
  Room.prototype._mutedChanged = function () {
    this._emit("muted", Array.from(this._muted || []).concat(Array.from(blockedSet())));
  };
  Room.prototype.isMuted = function (id) {
    return Boolean((this._muted && this._muted.has(id)) || blockedSet().has(id));
  };
  Room.prototype.mute = function (id) {
    (this._muted = this._muted || new Set()).add(id);
    this._mutedChanged();
  };
  Room.prototype.unmute = function (id) {
    if (this._muted) this._muted.delete(id);
    var b = blockedSet();
    b.delete(id);
    try { sessionStorage.setItem(blockKey, JSON.stringify(Array.from(b))); } catch (e) { /* fine */ }
    this._mutedChanged();
  };
  Room.prototype.block = function (id) {
    var b = blockedSet();
    b.add(id);
    try { sessionStorage.setItem(blockKey, JSON.stringify(Array.from(b))); } catch (e) { /* fine */ }
    this.mute(id);
  };
  /** Report a player to Zaisma. reason: harassment, hate, sexual, cheating or other. Nothing about you is sent. */
  Room.prototype.report = function (id, reason, details) {
    var p = this.players.filter(function (x) { return x.id === id; })[0];
    return post("/v1/report", { game: config.game, code: this.code, player: id, name: p ? p.name : "", reason: reason, details: details || "" });
  };

  Room.prototype.leave = function () {
    if (!this._done) left(this);
    this._done = true;
    if (this._ws) this._ws.close(1000, "Left");
  };

  /**
   * Join a room. Options:
   *   code   - a room code; defaults to ?room= in the page address, else a new room
   *   server - your own game server's address (wss://...) instead of Zaisma rooms
   *   listed - false: a new room that never shows in room lists, like a private match
   *   name, labels - a new room's name and labels, like "Ana's castle" and { Mode: "Classic" }
   *   data   - plain JSON for the game server's onJoin, like the character the player picked (up to 4 KB)
   *   idle   - seconds without input before the player is asked "Still there?" (30 to 86400), or false
   *            never to ask; by default, the game server's idleAfter (10 minutes)
   * If the room is full, closed or over, the player was kept out or turned away, or the game has used
   * this month's multiplayer time, it fails with an error whose code says which (full, closed, ended,
   * kept-out, refused, month-limit) and whose message says why.
   */
  function joinRoom(opts) {
    opts = opts || {};
    return connect(opts.code ? String(opts.code).toUpperCase() : codeFromPage(), opts);
  }

  function connect(code, opts, retried) {
    var server = opts.server ? String(opts.server).replace(/\/+$/, "") : null;
    if (!server && !config.rooms) return Promise.reject(new Error("Pass { server } to join a room outside Zaisma"));
    if (code && !CODE.test(code)) return Promise.reject(new Error("That room code isn't valid"));

    var codeReady = code ? Promise.resolve(code) : server ? Promise.resolve(randomCode()) : post("/v1/rooms", { game: config.game }).then(function (d) { return d.code; });
    return Promise.all([codeReady, player()]).then(function (got) {
      var base = (server || config.rooms).replace(/^http/, "ws");
      var room = new Room({ code: got[0], pass: got[1].pass, url: base + "/v1/rooms/" + config.game + "/" + got[0], listed: opts.listed, name: opts.name, labels: opts.labels, data: opts.data, idle: opts.idle, server: server });
      joined.push(room);
      // Tell the Zaisma page the room code, so its Invite button and address bar point here.
      if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: room.code }, config.site);
      return new Promise(function (resolve, reject) {
        room._ready = { resolve: resolve, reject: reject };
        room._connect();
      }).catch(function (err) {
        // A pass this tab kept from before Zaisma changed its keys: get a new one and try once more.
        if (err.code !== "bad-pass" || retried) throw err;
        try { sessionStorage.removeItem(passKey); } catch (e) { /* fine */ }
        return connect(room.code, opts, true);
      });
    });
  }

  /**
   * The game's listed rooms on Zaisma: { rooms: [{ code, players, max, open, location, near, link }],
   * playing: { players, rooms, closed }, joinable (rooms with space), open (rooms taking players, full ones too), regions: [{ code, name, rooms, players }], region,
   * more }. playing counts everyone in the game's rooms, hidden ones too. location is where the room runs: { country, name, continent }, like DE, Germany and EU.
   * Rooms with space come first (the player's country, then continent, then the busiest), up to 50;
   * more says how many open rooms are past those. Pass { region } (a continent code, like EU) for
   * one region. Never who's in them. For a game's own lobby or server browser.
   */
  function listRooms(opts) {
    if (!config.rooms) return Promise.reject(new Error("Room lists only cover Zaisma rooms"));
    opts = opts || {};
    var query = [];
    if (opts.region) query.push("region=" + encodeURIComponent(opts.region));
    if (opts.labels) query.push("labels=" + encodeURIComponent(JSON.stringify(opts.labels)));
    // The room this tab just left, so the player doesn't see themselves in it while lists catch up.
    var ago = recent ? Date.now() - recent.at : -1;
    var back = recent && joined.some(function (r) { return r.code === recent.code && !r._done && !r._away; });
    if (ago >= 0 && ago < 30000 && !back) query.push("left=" + recent.code + "." + ago + "." + (Date.now() - recent.joined));
    return fetch(config.rooms + "/v1/rooms/" + config.game + (query.length ? "?" + query.join("&") : "")).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Couldn't load the rooms");
        return data;
      });
    });
  }

  // A room that can't take this player, so another may: month-limit is an empty room that can't open again this month.
  var RETRY = { full: true, closed: true, ended: true, "month-limit": true };

  /**
   * Drop the player into a match: the room their link points to if it has space, otherwise a
   * listed room with space (nearby and busy first, in opts.region if given), otherwise a new room.
   * Takes joinRoom's options for the new room.
   */
  function quickJoin(opts) {
    opts = opts || {};
    var linked = codeFromPage();
    function fresh() { return connect(null, opts); }
    function busiest() {
      return listRooms({ region: opts.region, labels: opts.labels }).then(function (found) {
        var tries = found.rooms.filter(function (r) { return r.open && r.players + (r.held || 0) < r.max && r.code !== linked; }).slice(0, 3);
        function next() {
          var r = tries.shift();
          if (!r) return fresh();
          return connect(r.code, opts).catch(function (err) { if (RETRY[err.code]) return next(); throw err; });
        }
        return next();
      }, fresh);
    }
    if (!linked) return busiest();
    return connect(linked, opts).catch(function (err) { if (RETRY[err.code]) return busiest(); throw err; });
  }

  /**
   * Zaisma's text filter: whether what a player typed can be shown to other players, as on Zaisma's
   * own pages. Resolves to { ok, reason, text }: reason is "contact" (a link, handle, email, phone
   * number or contact app) or "words" (slurs or sexual words); text is tidied (hidden characters
   * and extra spaces gone).
   */
  function filterText(text) {
    return post("/v1/filter", { game: config.game, text: String(text == null ? "" : text) });
  }

  /**
   * Invite friends into a room: opens the share sheet where there is one, otherwise
   * copies the room link. Resolves to "shared", "copied", "cancelled" or "failed".
   * Call it from a button in your game, such as on a "waiting for players" screen.
   */
  function invite(room) {
    var link = room && room.inviteLink ? room.inviteLink : config.site && config.game ? config.site + gamePage() : location.href;
    function copy() {
      if (!navigator.clipboard) return Promise.resolve("failed");
      return navigator.clipboard.writeText(link).then(function () { return "copied"; }, function () { return "failed"; });
    }
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      return navigator.share({ title: document.title, url: link }).then(function () { return "shared"; }, function (err) {
        return err && err.name === "AbortError" ? "cancelled" : copy();
      });
    }
    return copy();
  }

  var joined = [];

  // The room this tab last left and when it joined it, for its own room lists, and for the Zaisma page's (zaisma:left).
  var recent = null;
  function left(room) {
    if (room._joinedAt) recent = { code: room.code, at: Date.now(), joined: room._joinedAt };
    room._joinedAt = 0;
    if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:left", code: room.code }, config.site);
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
      var seen = now.map(function (p) {
        return p.buttons.map(function (b) { return b.pressed ? 1 : 0; }).join("") + p.axes.map(function (a) { return Math.round(a * 4); }).join(",");
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
      var idle = room._idleAfter();
      if (idle !== null && now - lastInput >= idle * 1000) due.push(room);
      // The room's own check hears from players who give input but whose game sends nothing for a while.
      var roomIdle = room._checks.idle;
      if (roomIdle !== null && lastInput > room._sentAt && now - room._sentAt > Math.min(240000, roomIdle * 500)) room._say({ t: "here" });
    });
    if (asking && now >= asking.until) {
      var asked = asking.rooms;
      stopAsking();
      asked.forEach(function (room) {
        if (room._done || room._away || now - lastInput < ASK_MS) return;
        room._idleSent = true;
        room._say({ t: "idle" });
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
      if (!room._done && room._checks.hidden) room._say({ t: document.hidden ? "hidden" : "shown" });
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
      try { ws.close(1000, "Left"); } catch (e) { /* fine */ }
      room._ws = null;
      room._paused = true;
    });
  });
  // Back from the browser's back-forward cache: join again, or wait for the player if they'd walked away.
  addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    joined.forEach(function (room) {
      if (!room._paused || room._done) return;
      room._paused = false;
      if (room._away) { room._gone = true; return; }
      room._tries = 0;
      room._setStatus("reconnecting");
      room._connect();
    });
  });

  // The Zaisma page says when a player report was sent from its plate: mute them, as the panel's own form does.
  window.addEventListener("message", function (e) {
    if (!config.site || e.origin !== config.site || e.source !== window.parent || !e.data || e.data.type !== "zaisma:reported") return;
    var id = e.data.player;
    joined.forEach(function (room) {
      if (room.players.some(function (p) { return p.id === id; })) room.mute(id);
    });
  });

  /** Hand a player report to the Zaisma page. If no Zaisma page answers (the game runs somewhere else), use our own form. */
  function handOff(room, p, opened, fallback) {
    if (!config.site || window.parent === window) return fallback();
    var answered = false;
    function listen(e) {
      if (e.origin === config.site && e.source === window.parent && e.data && e.data.type === "zaisma:report-open") {
        answered = true;
        window.removeEventListener("message", listen);
        opened();
      }
    }
    window.addEventListener("message", listen);
    window.parent.postMessage({ type: "zaisma:report", code: room.code, player: { id: p.id, name: p.name } }, config.site);
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

  var rooms = { join: joinRoom, list: listRooms, quickJoin: quickJoin, linked: codeFromPage() };
  window.Zaisma = { version: 1, game: config.game || null, player: player, joinRoom: joinRoom, rooms: rooms, invite: invite, filterText: filterText, openSafetyPanel: openSafetyPanel };
})();
