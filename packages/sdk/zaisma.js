/*
 * The Zaisma SDK. On Zaisma, games include it with one tag:
 *   <script src="_zaisma/v1.js"></script>   (relative, from the game's top folder)
 * Plain JavaScript, no dependencies, MIT licensed. Every part is optional.
 *
 *   const room = await Zaisma.joinRoom();     // joins ?room=CODE if present, else makes a room
 *   room.me; room.players; room.code; room.inviteLink;
 *   room.on("message", (msg) => {});          // from the game server
 *   room.on("players", (list) => {});
 *   room.on("status", (s) => {});             // "connecting" | "open" | "reconnecting" | "closed"
 *   room.on("ended", (reason) => {});
 *   room.send({ move: "left" });
 *   room.leave();
 *   Zaisma.joinRoom({ server: "wss://my-server.example" });  // your own game server
 *   Zaisma.joinRoom({ data: { character: "knight" } });       // data for the game server's onJoin, up to 4 KB
 *   room.on("move", (move) => { room.leave(); move.join(); }); // the game server reserved a room for this player
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
 *                                             // with the relay, from the room's first player;
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
 */
(function () {
  "use strict";
  var config = typeof __ZAISMA__ === "object" && __ZAISMA__ ? __ZAISMA__ : {};
  var CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

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
        if (!res.ok) throw new Error(data.error || "Zaisma request failed");
        return data;
      });
    });
  }

  var passKey = "zaisma:pass:" + config.game;
  var passPromise = null;

  /** This tab's guest player: { id, name, pass }. Kept only for the tab, like the guest it belongs to. */
  function player() {
    if (!config.rooms) return Promise.reject(new Error("Zaisma player passes only work on Zaisma"));
    try {
      var saved = JSON.parse(sessionStorage.getItem(passKey) || "null");
      if (saved && saved.expiresAt - Date.now() > 10 * 60 * 1000) return Promise.resolve(saved);
    } catch (e) { /* storage off: fetch a new pass */ }
    if (!passPromise) {
      passPromise = post("/v1/pass", { game: config.game }).then(function (data) {
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
    this.status = "connecting";
    this.inviteLink = config.site && config.game ? config.site + "/g/" + config.game + "?room=" + this.code : null;
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
  }
  Room.prototype = Object.create(Emitter.prototype);

  Room.prototype._connect = function () {
    var room = this;
    var ws = new WebSocket(this._url);
    this._ws = ws;
    ws.onopen = function () {
      ws.send(JSON.stringify({ t: "hello", pass: room._pass, room: room._made, data: room._data }));
    };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "welcome") {
        room._tries = 0;
        room.me = m.me;
        room.players = m.players;
        if (m.room) room._settle(m.room);
        room._setStatus("open");
        if (room._ready) { room._ready.resolve(room); room._ready = null; }
      } else if (m.t === "players") {
        room.players = m.players;
        room._emit("players", m.players);
      } else if (m.t === "msg") {
        room._emit("message", m.d);
      } else if (m.t === "room") {
        room._settle(m.room);
        room._emit("room", m.room);
      } else if (m.t === "move") {
        room._emit("move", room._move(m));
      } else if (m.t === "ended") {
        room._done = true;
        room._emit("ended", m.reason);
      } else if (m.t === "error") {
        room._emit("error", m);
        if (room._ready && (m.code === "full" || m.code === "closed" || m.code === "ended" || m.code === "bad-pass" || m.code === "too-big" || m.code === "game-unavailable")) {
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
      room._setStatus("reconnecting");
      var wait = Math.min(8000, 500 * Math.pow(2, room._tries++));
      setTimeout(function () { if (!room._done) room._connect(); }, wait);
    };
  };

  Room.prototype._setStatus = function (s) {
    if (this.status === s) return;
    this.status = s;
    this._emit("status", s);
  };

  /** Send a message to the game server. Plain JSON, up to 16 KB. Send input when it changes, not every frame. */
  Room.prototype.send = function (data) {
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ t: "msg", d: data }));
  };

  /**
   * Show or hide the room in room lists, and open or close it to new players. Works from the room's
   * first player when the game uses the relay; with a game server, the server decides. The "room"
   * event says when it changed.
   */
  Room.prototype.setListed = function (listed) {
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ t: "room", listed: Boolean(listed) }));
  };
  Room.prototype.setOpen = function (open) {
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ t: "room", open: Boolean(open) }));
  };
  /** Name and label the room: { name, labels }. Leave a field out to keep it; null clears it. */
  Room.prototype.setInfo = function (info) {
    info = info || {};
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify({ t: "room", name: info.name, labels: info.labels }));
  };
  /**
   * The game server reserved a room for this player: { code, join(opts) }. join takes joinRoom's
   * options (like data) and joins that room, on the same server as this one.
   */
  Room.prototype._move = function (m) {
    var server = this._server;
    return {
      code: m.code,
      join: function (opts) {
        return connect(m.code, Object.assign({}, opts || {}, { server: server }));
      },
    };
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
   * If the room is full, closed or over, it fails with an error whose code says which.
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
      var room = new Room({ code: got[0], pass: got[1].pass, url: base + "/v1/rooms/" + config.game + "/" + got[0], listed: opts.listed, name: opts.name, labels: opts.labels, data: opts.data, server: server });
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
   * playing: { players, rooms, closed }, joinable, regions: [{ code, name, rooms, players }], region,
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
    return fetch(config.rooms + "/v1/rooms/" + config.game + (query.length ? "?" + query.join("&") : "")).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Couldn't load the rooms");
        return data;
      });
    });
  }

  var RETRY = { full: true, closed: true, ended: true };

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
        var tries = found.rooms.filter(function (r) { return r.open && r.players < r.max && r.code !== linked; }).slice(0, 3);
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
    var link = room && room.inviteLink ? room.inviteLink : config.site && config.game ? config.site + "/g/" + config.game : location.href;
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
