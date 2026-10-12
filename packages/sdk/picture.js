/*
 * Report pictures. Zaisma adds this to every game page. When a player opens Report on the Zaisma
 * game page, the page asks for one picture of the game as it is right now: the game's biggest
 * canvas, copied straight after the game draws a frame (so WebGL games work too), shrunk and
 * handed back. Nothing is taken unless the Zaisma page asks, and nothing leaves the player's
 * browser unless they send the report with the picture. Games that don't draw on a canvas give
 * no picture. Plain JavaScript, no dependencies, MIT licensed.
 */
(function () {
  "use strict";
  var site = typeof __ZAISMA_PICTURE__ === "object" && __ZAISMA_PICTURE__ ? __ZAISMA_PICTURE__.site : "";
  if (!site || window.parent === window) return;
  var MAX_SIDE = 1280;
  var waiting = [];

  function biggestCanvas() {
    var best = null;
    var area = 0;
    var all = document.getElementsByTagName("canvas");
    for (var i = 0; i < all.length; i++) {
      var size = all[i].width * all[i].height;
      if (size > area && all[i].getClientRects().length) {
        best = all[i];
        area = size;
      }
    }
    return best;
  }

  function picture() {
    try {
      var from = biggestCanvas();
      if (!from) return null;
      var scale = Math.min(1, MAX_SIDE / Math.max(from.width, from.height));
      var to = document.createElement("canvas");
      to.width = Math.max(1, Math.round(from.width * scale));
      to.height = Math.max(1, Math.round(from.height * scale));
      var ctx = to.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, to.width, to.height);
      ctx.drawImage(from, 0, 0, to.width, to.height);
      return to.toDataURL("image/jpeg", 0.8);
    } catch (e) {
      return null; // A canvas showing pictures from another site can't be copied.
    }
  }

  function answer() {
    if (!waiting.length) return;
    var pic = picture();
    waiting.splice(0).forEach(function (id) {
      window.parent.postMessage({ type: "zaisma:picture", id: id, picture: pic }, site);
    });
  }

  // Copy inside the game's own frame callback: after it has drawn, before the browser clears a WebGL canvas.
  var nativeFrame = window.requestAnimationFrame;
  if (nativeFrame) {
    window.requestAnimationFrame = function (callback) {
      return nativeFrame.call(window, function (time) {
        try {
          callback(time);
        } finally {
          answer();
        }
      });
    };
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== site || e.source !== window.parent || !e.data || e.data.type !== "zaisma:picture-request") return;
    var id = String(e.data.id);
    waiting.push(id);
    // A game that isn't drawing right now (paused, between turns) is copied straight away.
    setTimeout(function () {
      if (waiting.indexOf(id) !== -1) answer();
    }, 200);
  });
})();
