import { gameBySlug } from "@zaisma/core";
import { pageScript } from "./page-scripts.ts";
import type { Env } from "./env.ts";
import type { Raw } from "./html.ts";
import { action, secondaryButton } from "./components/actions.ts";
import type { ControlMarkup } from "./components/control-markup.ts";
import type { IconName } from "./components/icons.ts";
import { dropdown } from "./components/panes.ts";

/*
 * Updates and the connection, beside the game in the game page's bar (docs/DECISIONS.md, "A version reaches
 * live matches at the next match, or now" and "Nothing of ours constantly on top of the game"):
 *  - a match moving to a version published "now": Updating while it's coming and while the game reloads
 *    back into its room (the room tells the game's SDK, which tells this page);
 *  - a game that isn't in a match after a "now" publish: the page notices within 2 minutes, a game that
 *    listens (Zaisma.versions) switches when it says, and otherwise Update here reloads it with its save;
 * A game reads its own connection (room.connectionStatus, room.pingDurationMs); Zaisma shows none.
 */

/** How often a game page that isn't in a match asks whether a newer version is out, and how long the answer is cached. */
const LIVE_VERSION_CHECK_MS = 2 * 60_000;
const LIVE_VERSION_CACHE_SEC = 30;

/** GET /g/<slug>/live-version: which version players get, and whether it came "now", for the page's check. */
export async function liveVersionAnswer(env: Env, slug: string): Promise<Response> {
  const game = await gameBySlug(env.DB, slug);
  const isPlayable = game && game.review_status === "live" && game.live_version_id && (game.visibility === "listed" || game.visibility === "unlisted");
  if (!game || !isPlayable) return Response.json({ error: { code: "no_game", message: "No game here." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    { live_version_id: game.live_version_id, live_version_match_update_mode: game.live_version_match_update_mode },
    { headers: { "Cache-Control": `public, max-age=${LIVE_VERSION_CACHE_SEC}` } },
  );
}

/** Update, in the Zaisma overlay's This game: it starts hidden, and shows while a new version is ready. */
export function updateButton(): ControlMarkup {
  return secondaryButton(action("update"), { id: "update", type: "button", isSmall: true, isHidden: true });
}

export const GAME_UPDATES_SCRIPT = pageScript(
  "game-updates",
  String.raw`(() => {
  const gamePage = JSON.parse(document.getElementById("game-page-data").textContent);
  const update = document.getElementById("update");
  if (!update) return;
  const updateLabel = update.querySelector(".face > span:not([class])");
  const gameOrigin = new URL(gamePage.frame_url).origin;
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, gameOrigin); };
  // The local preview shows each state of Update by its link (?play&preview_bar=update); the game's own messages then don't change it. Never on zaisma.com (a .ts.net name is the preview on a phone).
  const previewBar = /^(localhost|127\.0\.0\.1|.+\.ts\.net)$/.test(location.hostname) ? new URLSearchParams(location.search).get("preview_bar") : null;

  // The game's room, as its SDK says, and its connection: { code, connectionStatus, pingDurationMs, isWeak }.
  let connection = null;
  // The version the game runs, and a newer one it was offered; whether a match update is coming or under way.
  let frameVersionId = null;
  let offeredVersionId = null;
  let matchUpdate = null;

  function showUpdate() {
    if (matchUpdate) {
      update.hidden = false;
      update.disabled = true;
      updateLabel.textContent = matchUpdate.step === "now" ? "Updating…" : "Update coming";
      update.title = matchUpdate.step === "now" ? "The game is updating" : "This match moves to a new version by " + new Date(matchUpdate.appliesAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return;
    }
    update.disabled = false;
    updateLabel.textContent = "Update";
    update.title = "Update the game to its new version";
    update.hidden = !offeredVersionId;
  }

  // Reload the game in place, at the version players get now, into a room (code) or not: through the saves
  // script when it runs (so progress carries over), else straight at the game's address. A spectator goes back to watching.
  function reloadGame(code, isSpectator) {
    const query = code ? "?room=" + code + (isSpectator ? "&watch=1" : "") : "";
    if (gamePage.tester_token) return location.assign("/t/" + gamePage.tester_token + query);
    offeredVersionId = null;
    frameVersionId = null;
    if (window.reloadGameThroughSaves && reloadGameThroughSaves(query)) return;
    const f = frame();
    if (!f) return;
    if (gamePage.is_accounts_only && window.openGameAt) return openGameAt(f, query);
    const url = new URL(gamePage.frame_url);
    url.search = query;
    f.src = url.toString();
  }
  update.onclick = () => { if (!matchUpdate && offeredVersionId) reloadGame(null); };

  addEventListener("message", (e) => {
    const f = frame();
    const d = e.data;
    if (!f || e.source !== f.contentWindow || e.origin !== gameOrigin || !d || previewBar) return;
    if (d.type === "zaisma:connection" && typeof d.code === "string" && CODE.test(d.code)) {
      connection = { code: d.code, connectionStatus: String(d.connectionStatus), pingDurationMs: typeof d.pingDurationMs === "number" ? d.pingDurationMs : null, isWeak: d.isWeak === true };
      if (connection.connectionStatus === "closed" || connection.connectionStatus === "away") connection = null;
      // Back in after an update: the reload is done.
      if (matchUpdate && matchUpdate.step === "now" && d.connectionStatus === "open") { matchUpdate = null; showUpdate(); }
    } else if (d.type === "zaisma:left") {
      connection = null;
    } else if (d.type === "zaisma:version-update" && typeof d.code === "string" && CODE.test(d.code) && typeof d.appliesAt === "string") {
      matchUpdate = { code: d.code, step: d.step === "now" ? "now" : "coming", appliesAt: d.appliesAt, isReloading: d.isReloading === true };
      offeredVersionId = null;
      showUpdate();
    } else if (d.type === "zaisma:reload") {
      // The match switched and the game's files changed: back into the same room, at the new version.
      if (matchUpdate) matchUpdate.step = "now";
      else matchUpdate = { code: null, step: "now", appliesAt: new Date().toISOString(), isReloading: true };
      showUpdate();
      reloadGame(typeof d.code === "string" && CODE.test(d.code) ? d.code : null, d.isSpectator === true);
    } else if (d.type === "zaisma:version" && typeof d.versionId === "string") {
      frameVersionId = d.versionId;
      // The reloaded game is up: the update is done, and the connection shows from here (it rejoins its room, or its menu shows).
      if (matchUpdate && matchUpdate.step === "now") { matchUpdate = null; showUpdate(); }
    } else if (d.type === "zaisma:version-ready" && d.versionId === offeredVersionId) {
      // The game takes it itself (Zaisma.versions), or the player does, with Update.
      if (d.isHandled === true) offeredVersionId = null;
      showUpdate();
    }
  });

  // A game that isn't in a match hears of a version published "now" (a match hears it from its room).
  async function checkVersion() {
    if (document.hidden || !frame() || !frameVersionId || connection || matchUpdate || gamePage.tester_token) return;
    try {
      const response = await fetch("/g/" + gamePage.slug + "/live-version");
      if (!response.ok) return;
      const live = await response.json();
      if (live.live_version_match_update_mode !== "now" || !live.live_version_id || live.live_version_id === frameVersionId || live.live_version_id === offeredVersionId) return;
      offeredVersionId = live.live_version_id;
      tell({ type: "zaisma:version-ready", versionId: offeredVersionId });
    } catch {
      // Offline: the next check tries again.
    }
  }
  setInterval(checkVersion, ${LIVE_VERSION_CHECK_MS});
  document.addEventListener("visibilitychange", checkVersion);

  if (previewBar) {
    const nowMs = Date.now();
    if (previewBar === "coming") matchUpdate = { code: "PREVUE", step: "coming", appliesAt: new Date(nowMs + 4 * 60_000).toISOString(), isReloading: true };
    if (previewBar === "updating") matchUpdate = { code: "PREVUE", step: "now", appliesAt: new Date(nowMs).toISOString(), isReloading: true };
    if (previewBar === "update") offeredVersionId = "version_preview";
    frameVersionId = "version_preview";
    showUpdate();
  }
})();`,
);
