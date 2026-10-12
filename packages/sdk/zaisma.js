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
 *   await Zaisma.invite(room);                // share sheet on phones, copies the link elsewhere
 *
 * Player safety. Games where players interact must offer mute, block and report:
 *   Zaisma.openSafetyPanel(room);           // ready-made panel; call it from your menu
 *   room.isMuted(playerId);                 // true if muted or blocked: hide their emotes/phrases
 *   room.on("muted", (ids) => {});          // the muted list changed
 *   room.mute(id); room.unmute(id); room.block(id); room.report(id, reason)
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
    this._url = opts.url;
    this._pass = opts.pass;
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
      ws.send(JSON.stringify({ t: "hello", pass: room._pass }));
    };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "welcome") {
        room._tries = 0;
        room.me = m.me;
        room.players = m.players;
        room._setStatus("open");
        if (room._ready) { room._ready.resolve(room); room._ready = null; }
      } else if (m.t === "players") {
        room.players = m.players;
        room._emit("players", m.players);
      } else if (m.t === "msg") {
        room._emit("message", m.d);
      } else if (m.t === "ended") {
        room._done = true;
        room._emit("ended", m.reason);
      } else if (m.t === "error") {
        room._emit("error", m);
        if (room._ready && (m.code === "full" || m.code === "ended" || m.code === "bad-pass" || m.code === "game-unavailable")) {
          room._done = true;
          room._ready.reject(new Error(m.message));
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
   */
  function joinRoom(opts) {
    opts = opts || {};
    var server = opts.server ? String(opts.server).replace(/\/+$/, "") : null;
    if (!server && !config.rooms) return Promise.reject(new Error("Pass { server } to join a room outside Zaisma"));
    var code = opts.code ? String(opts.code).toUpperCase() : codeFromPage();
    if (code && !CODE.test(code)) return Promise.reject(new Error("That room code isn't valid"));

    var codeReady = code ? Promise.resolve(code) : server ? Promise.resolve(randomCode()) : post("/v1/rooms", { game: config.game }).then(function (d) { return d.code; });
    return Promise.all([codeReady, player()]).then(function (got) {
      var base = (server || config.rooms).replace(/^http/, "ws");
      var room = new Room({ code: got[0], pass: got[1].pass, url: base + "/v1/rooms/" + config.game + "/" + got[0] });
      // Tell the Zaisma page the room code, so its Invite button and address bar point here.
      if (config.site && window.parent !== window) window.parent.postMessage({ type: "zaisma:room", code: room.code }, config.site);
      return new Promise(function (resolve, reject) {
        room._ready = { resolve: resolve, reject: reject };
        room._connect();
      });
    });
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

  var REASONS = [["harassment", "Harassing or bullying"], ["hate", "Hate or threats"], ["sexual", "Sexual behavior"], ["cheating", "Cheating"], ["other", "Something else"]];

  /** A ready-made mute, block and report panel. Games open it from their own menu. */
  function openSafetyPanel(room) {
    var old = document.getElementById("zaisma-safety");
    if (old) old.remove();
    var wrap = document.createElement("div");
    wrap.id = "zaisma-safety";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Players");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:grid;place-items:center;font:15px system-ui,sans-serif;color:#eee";
    var box = document.createElement("div");
    box.style.cssText = "background:#1b1c1f;border:1px solid #2c2e33;border-radius:12px;padding:16px;width:min(420px,92vw);max-height:80vh;overflow:auto";
    wrap.appendChild(box);
    var btn = "font:inherit;font-size:13px;padding:5px 10px;border-radius:7px;border:1px solid #444;background:#26282c;color:#eee;cursor:pointer";
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
        n.style.cssText = "margin:0 0 10px;color:#5fd38d";
        box.appendChild(n);
      }
      var others = room.players.filter(function (p) { return !room.me || p.id !== room.me.id; });
      if (!others.length) {
        var none = document.createElement("p");
        none.textContent = "Nobody else is here.";
        none.style.color = "#9b9da3";
        box.appendChild(none);
      }
      others.forEach(function (p) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;align-items:center;padding:8px 0;border-top:1px solid #2c2e33";
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
        report.onclick = function () { reportForm(p); };
        row.append(name, mute, block, report);
        box.appendChild(row);
      });
    }

    function reportForm(p) {
      box.textContent = "";
      var h = document.createElement("strong");
      h.textContent = "Report " + p.name;
      var sel = document.createElement("select");
      sel.style.cssText = "display:block;width:100%;margin:12px 0;padding:8px;background:#26282c;color:#eee;border:1px solid #444;border-radius:7px;font:inherit";
      REASONS.forEach(function (r) { var o = document.createElement("option"); o.value = r[0]; o.textContent = r[1]; sel.appendChild(o); });
      var note = document.createElement("p");
      note.textContent = "Zaisma reviews reports. Nothing about you is sent. They'll also be muted for you.";
      note.style.cssText = "margin:0 0 12px;color:#9b9da3;font-size:13px";
      var send = document.createElement("button");
      send.textContent = "Send report";
      send.style.cssText = btn + ";background:#ececec;color:#111;border-color:#ececec;font-weight:600";
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

  window.Zaisma = { version: 1, game: config.game || null, player: player, joinRoom: joinRoom, invite: invite, openSafetyPanel: openSafetyPanel };
})();
