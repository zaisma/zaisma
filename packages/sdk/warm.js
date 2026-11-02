/*
 * Game files start before Play. Zaisma's game page opens this, hidden, on the game's own address while a
 * player reads it (on computers, Android phones on Wi-Fi and iPhones, never with Data Saver), so the files the game
 * needed before its first frame are in the browser's cache for this game when the player taps Play. The
 * browser keeps each site's cache apart, which is why it runs here and not on zaisma.com. One file at a time,
 * at low priority, up to 100 MB, and nothing is kept but the cache. The page's query goes on to warm.json: an iPhone's asks for
 * a small game's files only (maximum_start_size_bytes), all of them or none. Plain JavaScript, no dependencies, MIT licensed.
 *
 * A file an update didn't change redirects to an address the browser already has. Safari reads its cache for a
 * redirect it kept, never for where a fresh one leads, so outside Chromium this first keeps the redirects, which
 * are small and hold no file: then the game's own requests find what's there.
 */
(function () {
  "use strict";
  function keepRedirects(urls) {
    var nextIndex = 0;
    function keepNext() {
      if (nextIndex >= urls.length) return Promise.resolve();
      return fetch(urls[nextIndex++], { credentials: "same-origin", redirect: "manual", priority: "low" })
        .catch(function () {})
        .then(keepNext);
    }
    return Promise.all([keepNext(), keepNext(), keepNext(), keepNext(), keepNext(), keepNext()]);
  }
  var readList = function (response) {
    return response.ok ? response.json() : null;
  };
  var redirectsRead = navigator.userAgentData ? Promise.resolve(null) : fetch("warm-redirects.json", { credentials: "same-origin" }).then(readList).catch(function () {});
  Promise.all([fetch("warm.json" + location.search, { credentials: "same-origin" }).then(readList), redirectsRead])
    .then(function (lists) {
      var paths = lists[0] || [];
      var redirects = lists[1] || { start_file_urls: [], other_file_urls: [] };
      return keepRedirects(redirects.start_file_urls).then(function () {
        keepRedirects(redirects.other_file_urls);
        return paths.reduce(function (previous, path) {
          return previous.then(function () {
            return fetch(path, { credentials: "same-origin", priority: "low" })
              .then(function (response) {
                return response.body ? response.body.pipeTo(new WritableStream()) : undefined;
              })
              .catch(function () {});
          });
        }, Promise.resolve());
      });
    })
    .catch(function () {});
})();
