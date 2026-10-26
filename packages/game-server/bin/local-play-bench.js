// The dev page's own scripts (local-play.js serves them as /bench/dev.js and /bench/kept.js). The dev page is the bench's: its bar
// (bench/glass.ts) and one frame, the player's page, which is zaisma.com's game page with its own scripts. These never reach into it.

/** What the dev page's frame lets the player's page pass on to the game: the game page's own list (apps/site/src/pages.ts; test/node/local-play-parity.test.ts holds the two together). */
export const FRAME_ALLOW = "fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated";

/** The dev page's script: it keeps the player's place, reloads the game when a file changes, and draws the bar's sheets afresh. */
export const devScriptSource = () => `(${devScript.toString()})();\n`;

/**
 * The end of a sign-in on the bench (/account/kept): it tells the open game pages, as zaisma.com's own page does. Opened as a tab of its own,
 * it closes; reached in the player's own tab (a blocked pop-up sends the sign-in there), it goes back to the player's dev page and game.
 */
export const KEPT_SCRIPT_SOURCE = `try { new BroadcastChannel("zaisma").postMessage("signed-in"); } catch {}
var keptPlayerNumber = Number(new URL(document.currentScript.src).searchParams.get("player")) || 0;
setTimeout(function () {
  if (window.opener) window.close();
  else location.replace(keptPlayerNumber ? "/?player=" + keptPlayerNumber : "/");
}, 800);
`;

/** Where a tab arrives (/ with no player): the tab's own player number again, or a new player's, then the dev page. */
export const ARRIVE_SCRIPT_SOURCE = `(function () {
  var kept = null;
  try { kept = Number(sessionStorage.getItem("zaisma-bench:player")) || null; } catch (error) {}
  var room = /^[A-Z0-9]{6}$/.test(new URLSearchParams(location.search).get("room") || "") ? new URLSearchParams(location.search).get("room") : null;
  fetch("/bench/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keptPlayerNumber: kept }) })
    .then(function (response) { return response.json(); })
    .then(function (answer) { location.replace("/?player=" + answer.playerNumber + (room ? "&room=" + room : "")); });
})();
`;

/**
 * The bench's sign-in page: whose sign-in it is, when its address didn't say. It opens in the player's tab or in a tab the game page opened,
 * and both hold the player's number the dev page keeps in sessionStorage (a tab opened by a page starts with a copy of the page's).
 */
export const SIGN_IN_SCRIPT_SOURCE = `(function () {
  var field = document.getElementById("bench-sign-in-player");
  if (!field || field.value !== "0") return;
  try { field.value = sessionStorage.getItem("zaisma-bench:player") || "0"; } catch (error) {}
})();
`;

/** Run in the browser. Written as a function so it stays real code; the bench serves its text. */
function devScript() {
  const playerNumber = Number(new URL(document.currentScript.src).searchParams.get("player")) || 0;
  try {
    sessionStorage.setItem("zaisma-bench:player", String(playerNumber));
  } catch {
    // Storage off: the tab is a new player each time it comes to /.
  }
  const frame = document.getElementById("bench-player");
  const add = document.getElementById("bench-add");
  let reloadNumber = null;
  let roomCode = null;

  // Each new player is a new tab: the bench claims it a number as it opens.
  add.addEventListener("click", (event) => {
    event.preventDefault();
    // A tab of its own, with nothing of this one's: a new player.
    window.open(add.href, "_blank", "noopener");
  });

  const refresh = (name) =>
    fetch(`/bench/sheet/${name}?player=${playerNumber}`)
      .then((response) => response.text())
      .then((text) => {
        const body = document.getElementById(`bench-${name}-body`);
        if (body) body.innerHTML = text;
      })
      .catch(() => {});
  for (const name of ["friends", "phone", "log"]) document.getElementById(`bench-${name}-open`)?.addEventListener("click", () => refresh(name));

  document.addEventListener("change", (event) => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.name !== "bench-friend") return;
    fetch("/bench/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "set-friend", playerNumber, friendAccountId: box.value, isFriend: box.checked }) })
      .then(() => refresh("friends"))
      .catch(() => {});
  });

  // About once a second: the player is still here, a game file changed (reload the game), and the room they're in (Add a player joins it).
  const check = () =>
    fetch(`/bench/state?player=${playerNumber}`)
      .then((response) => response.json())
      .then((answer) => {
        if (reloadNumber !== null && answer.reloadNumber !== reloadNumber) frame.contentWindow?.location.reload();
        reloadNumber = answer.reloadNumber;
        if (answer.roomCode !== roomCode) {
          roomCode = answer.roomCode;
          add.href = roomCode ? `/?room=${roomCode}` : "/";
        }
      })
      .catch(() => {});
  check();
  setInterval(check, 1000);
  addEventListener("pagehide", () => navigator.sendBeacon(`/bench/leave?player=${playerNumber}`));
}
