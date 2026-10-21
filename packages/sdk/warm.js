/*
 * Game files start before Play. Zaisma's game page opens this, hidden, on the game's own address while a
 * player reads it (on computers, and on Android phones on Wi-Fi, never with Data Saver), so the files the game
 * needed before its first frame are in the browser's cache for this game when the player taps Play. The
 * browser keeps each site's cache apart, which is why it runs here and not on zaisma.com. One file at a time,
 * at low priority, up to 100 MB, and nothing is kept but the cache. Plain JavaScript, no dependencies, MIT licensed.
 */
(function () {
  "use strict";
  fetch("warm.json", { credentials: "same-origin" })
    .then(function (response) {
      return response.ok ? response.json() : [];
    })
    .then(function (paths) {
      return paths.reduce(function (previous, path) {
        return previous.then(function () {
          return fetch(path, { credentials: "same-origin", priority: "low" })
            .then(function (response) {
              return response.body ? response.body.pipeTo(new WritableStream()) : undefined;
            })
            .catch(function () {});
        });
      }, Promise.resolve());
    })
    .catch(function () {});
})();
