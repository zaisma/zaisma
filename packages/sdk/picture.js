/*
 * Report pictures. Zaisma adds this to every game page. When a player opens Report on the Zaisma
 * game page, the page asks for one picture of the game as it is right now: the game's biggest
 * canvas, copied straight after the game draws a frame (so WebGL games work too), shrunk and
 * handed back (unless it's all one color). Nothing is taken unless the Zaisma page asks, and nothing leaves the player's
 * browser unless they send the report with the picture. Games that don't draw on a canvas give
 * no picture. Plain JavaScript, no dependencies, MIT licensed.
 */
(function () {
  "use strict";
  var site = typeof __ZAISMA_PICTURE__ === "object" && __ZAISMA_PICTURE__ ? __ZAISMA_PICTURE__.site : "";
  if (!site || window.parent === window) return;
  var MAXIMUM_SIDE_PIXEL_COUNT = 1280;
  var waiting = [];

  function biggestCanvas() {
    var best = null;
    var bestPixelCount = 0;
    var all = document.getElementsByTagName("canvas");
    for (var i = 0; i < all.length; i++) {
      var pixelCount = all[i].width * all[i].height;
      if (pixelCount > bestPixelCount && all[i].getClientRects().length) {
        best = all[i];
        bestPixelCount = pixelCount;
      }
    }
    return best;
  }

  // A canvas that's all one color (a title screen drawn in HTML over it, a game still loading) shows nothing worth sending.
  function blank(canvas) {
    var small = document.createElement("canvas");
    small.width = 32;
    small.height = 18;
    var canvasContext = small.getContext("2d");
    canvasContext.drawImage(canvas, 0, 0, 32, 18);
    var pixelBytes = canvasContext.getImageData(0, 0, 32, 18).data;
    var darkestByte = 255, lightestByte = 0;
    for (var i = 0; i < pixelBytes.length; i += 4) {
      var lightnessByte = (pixelBytes[i] * 3 + pixelBytes[i + 1] * 6 + pixelBytes[i + 2]) / 10;
      if (lightnessByte < darkestByte) darkestByte = lightnessByte;
      if (lightnessByte > lightestByte) lightestByte = lightnessByte;
    }
    return lightestByte - darkestByte < 10;
  }

  function picture() {
    try {
      var from = biggestCanvas();
      if (!from) return null;
      var longestSidePixelCount = Math.max(from.width, from.height);
      var shrunkSidePixelCount = Math.min(longestSidePixelCount, MAXIMUM_SIDE_PIXEL_COUNT);
      var to = document.createElement("canvas");
      to.width = Math.max(1, Math.round((from.width * shrunkSidePixelCount) / longestSidePixelCount));
      to.height = Math.max(1, Math.round((from.height * shrunkSidePixelCount) / longestSidePixelCount));
      var canvasContext = to.getContext("2d");
      canvasContext.fillStyle = "#000";
      canvasContext.fillRect(0, 0, to.width, to.height);
      canvasContext.drawImage(from, 0, 0, to.width, to.height);
      return blank(to) ? null : to.toDataURL("image/jpeg", 0.8);
    } catch (error) {
      return null; // A canvas showing pictures from another site can't be copied.
    }
  }

  function answer() {
    if (!waiting.length) return;
    var pictureUrl = picture();
    waiting.splice(0).forEach(function (id) {
      window.parent.postMessage({ type: "zaisma:picture", id: id, picture: pictureUrl }, site);
    });
  }

  // Copy inside the game's own frame callback: after it has drawn, before the browser clears a WebGL canvas.
  var nativeFrame = window.requestAnimationFrame;
  if (nativeFrame) {
    window.requestAnimationFrame = function (callback) {
      return nativeFrame.call(window, function (frameTimeMs) {
        try {
          callback(frameTimeMs);
        } finally {
          answer();
        }
      });
    };
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:picture-request") return;
    var id = String(event.data.id);
    waiting.push(id);
    // A game that isn't drawing right now (paused, between turns) is copied straight away.
    setTimeout(function () {
      if (waiting.indexOf(id) !== -1) answer();
    }, 200);
  });
})();
