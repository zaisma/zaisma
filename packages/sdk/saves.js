/*
 * Zaisma cloud saves, game side. The games server adds this to every page of a game
 * that has cloud saves on; games don't include it themselves.
 *
 * It only ever talks to the Zaisma game page around it (zaisma.com), never to a server,
 * and does nothing unless that page asks it to. The game page holds the player's
 * session and does the saving; this script only reads and writes the game's own
 * localStorage, the same storage the game already uses.
 *
 * Two places it runs:
 *  - <game>/_zaisma/restore: before the game opens, it shows the game page what's saved
 *    on this device and puts the account's save in place if the page says so.
 *  - every game page: while the page says to sync, it sends the save over whenever it
 *    changes (checked every 30 seconds) and when the player leaves.
 */
(function () {
  "use strict";
  var site = __ZAISMA_SAVES__.site;
  if (window.parent === window) return;

  function snapshot() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    return data;
  }
  // Keys sorted, so the same save is always the same text (matches canonicalSave on the server).
  function canonical(data) {
    var out = {};
    Object.keys(data)
      .sort()
      .forEach(function (k) {
        out[k] = data[k];
      });
    return JSON.stringify(out);
  }
  function post(msg) {
    msg.type = "zaisma:saves";
    parent.postMessage(msg, site);
  }
  function listen(fn) {
    addEventListener("message", function (e) {
      if (e.origin !== site || e.source !== parent || !e.data || e.data.type !== "zaisma:saves") return;
      fn(e.data);
    });
  }

  if (/\/_zaisma\/restore$/.test(location.pathname)) {
    // The game starts at its root, with the query the game page passed (like ?room=ABC234).
    var query = decodeURIComponent(location.hash.slice(1));
    var target = new URL("../" + (/^\?[\w=&%-]*$/.test(query) ? query : ""), location.href).href;
    var go = function () {
      location.replace(target);
    };
    // If the game page never answers, play anyway.
    var timer = setTimeout(go, 8000);
    var text;
    try {
      text = canonical(snapshot());
    } catch (err) {
      go();
      return;
    }
    listen(function (m) {
      // The player is choosing between two saves: wait for them.
      if (m.step === "wait") clearTimeout(timer);
      if (m.step !== "restore") return;
      clearTimeout(timer);
      if (m.action === "use-cloud" && m.data && typeof m.data === "object") {
        try {
          localStorage.clear();
          Object.keys(m.data).forEach(function (k) {
            localStorage.setItem(k, String(m.data[k]));
          });
        } catch (err) {}
      }
      go();
    });
    post({ step: "hello", phase: "restore", text: text });
    return;
  }

  var syncing = false;
  var last = null;
  var timer = null;
  function check() {
    if (!syncing) return;
    var text;
    try {
      text = canonical(snapshot());
    } catch (err) {
      return;
    }
    if (text === last) return;
    last = text;
    post({ step: "save", text: text });
  }
  listen(function (m) {
    if (m.step === "sync") {
      syncing = true;
      last = typeof m.text === "string" ? m.text : null;
      clearInterval(timer);
      timer = setInterval(check, 30000);
      check();
    } else if (m.step === "pause") {
      syncing = false;
      clearInterval(timer);
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") check();
  });
  addEventListener("pagehide", check);
  post({ step: "hello", phase: "game" });
})();
