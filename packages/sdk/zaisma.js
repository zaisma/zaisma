/*
 * The Zaisma SDK. On Zaisma, games include it with one tag:
 *   <script src="/_zaisma/v1.js"></script>
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

  window.Zaisma = { version: 1, game: config.game || null, player: player, joinRoom: joinRoom };
})();
