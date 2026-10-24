import { gameBySlug } from "@zaisma/core";
import { pageScript } from "./page-scripts.ts";
import type { Env } from "./env.ts";
import type { Raw } from "./html.ts";
import { cutButton } from "./components/actions.ts";
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
 *  - the connection, only when it isn't fine: weak (a real-time room's ping), reconnecting, or lost (10
 *    seconds without getting back, or the browser offline); a tap shows the ping.
 * Nothing sits over the game, and the bar is hidden in full screen.
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

/**
 * The bar's buttons, between Players and Share: the connection (one button for each way it can be wrong: weak, reconnecting, lost; the
 * script shows the one that's true, and only that one opens the connection's dropdown), then Update. All start hidden.
 */
export function updateBarButtons(): ControlMarkup[] {
  const connection = (state: "weak" | "retrying" | "lost", label: string, iconName: IconName) =>
    cutButton(label, { id: `conn-${state}`, type: "button", icon: iconName, isLabelHidden: true, isSmall: true, controls: "conn-dialog", isHidden: true });
  return [
    connection("weak", "Weak connection", "signal-weak"),
    connection("retrying", "Reconnecting", "reconnecting"),
    connection("lost", "Connection lost", "signal-lost"),
    cutButton("Update", { id: "update", type: "button", icon: "download", isSmall: true, isHidden: true }),
  ];
}

/** What the connection button opens, hanging from it like the ⋯ menu: how the connection is, and the ping. */
export function connectionPlate(): Raw {
  return dropdown({ id: "conn-dialog", label: "Connection", head: { title: "Connection", note: "Checking the connection." }, items: [] });
}

export const GAME_UPDATES_SCRIPT = pageScript(
  "game-updates",
  String.raw`(() => {
  const gamePage = JSON.parse(document.getElementById("game-page-data").textContent);
  const conns = { weak: document.getElementById("conn-weak"), retrying: document.getElementById("conn-retrying"), lost: document.getElementById("conn-lost") };
  const update = document.getElementById("update");
  if (!conns.weak || !update) return;
  const updateLabel = update.querySelector(".face > span:not([class])");
  const plate = document.getElementById("conn-dialog");
  const plateTitle = plate.querySelector(".dropdown-head strong");
  const plateLine = plate.querySelector(".dropdown-head span");
  const isPlateOpen = () => !plate.classList.contains("shut");
  // The dropdown hangs from the button that names it with aria-expanded: only the one shown has it.
  const closePlate = () => { plate.classList.add("shut"); plate.setAttribute("aria-hidden", "true"); Object.values(conns).forEach((b) => b.hasAttribute("aria-expanded") && b.setAttribute("aria-expanded", "false")); };
  const gameOrigin = new URL(gamePage.frame_url).origin;
  const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const LOST_AFTER_MS = 10000;
  const frame = () => document.getElementById("game");
  const tell = (message) => { const f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage(message, gameOrigin); };
  // The local preview shows each state by its link (?play&preview_bar=weak), since a room on this computer
  // is never slow or gone; the game's own messages then don't change it. Never on zaisma.com (a .ts.net name is the preview on a phone).
  const previewBar = /^(localhost|127\.0\.0\.1|.+\.ts\.net)$/.test(location.hostname) ? new URLSearchParams(location.search).get("preview_bar") : null;

  // The game's room, as its SDK says, and its connection: { code, connectionStatus, pingDurationMs, isWeak }.
  let connection = null;
  let reconnectingSinceMs = null;
  let lostTimer = null;
  // The version the game runs, and a newer one it was offered; whether a match update is coming or under way.
  let frameVersionId = null;
  let offeredVersionId = null;
  let matchUpdate = null;

  function connectionState() {
    if (!navigator.onLine && frame()) return "lost";
    if (!connection) return null;
    if (connection.connectionStatus === "reconnecting" || connection.connectionStatus === "connecting" && reconnectingSinceMs !== null) {
      return reconnectingSinceMs !== null && Date.now() - reconnectingSinceMs >= LOST_AFTER_MS ? "lost" : "retrying";
    }
    if (connection.connectionStatus === "open" && connection.isWeak) return "weak";
    return null;
  }
  function showConnection() {
    // While the game reloads for an update, the bar says Updating, not that the connection dropped.
    const state = matchUpdate && matchUpdate.step === "now" ? null : connectionState();
    const wasOpen = isPlateOpen();
    if (wasOpen && !state) closePlate();
    for (const [each, button] of Object.entries(conns)) {
      button.hidden = each !== state;
      if (each === state) { if (!button.hasAttribute("aria-expanded")) button.setAttribute("aria-expanded", "false"); }
      else button.removeAttribute("aria-expanded");
    }
    if (wasOpen && state) { const shown = conns[state]; shown.setAttribute("aria-expanded", "true"); fillPlate(state); }
  }
  function fillPlate(state) {
    const ping = connection && typeof connection.pingDurationMs === "number" ? Math.round(connection.pingDurationMs) + " ms ping" : "";
    plateTitle.textContent = { weak: "Weak connection", retrying: "Reconnecting…", lost: "Connection lost" }[state] || "Connection";
    plateLine.textContent =
      state === "weak" ? ping + ". The game may lag." :
      state === "retrying" ? "The game is getting back into the match." :
      !navigator.onLine ? "This device is offline. The game reconnects when it's back." :
      "Still trying to reach the game's room.";
  }
  // The dropdown opens and closes itself (DROPDOWN_SCRIPT); its words are filled as it opens.
  Object.values(conns).forEach((button) => button.addEventListener("click", () => fillPlate(connectionState()), true));
  addEventListener("online", showConnection);
  addEventListener("offline", showConnection);

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
      const wasReconnecting = connection && connection.connectionStatus === "reconnecting";
      connection = { code: d.code, connectionStatus: String(d.connectionStatus), pingDurationMs: typeof d.pingDurationMs === "number" ? d.pingDurationMs : null, isWeak: d.isWeak === true };
      if (connection.connectionStatus === "reconnecting" && !wasReconnecting) {
        reconnectingSinceMs = Date.now();
        clearTimeout(lostTimer);
        lostTimer = setTimeout(showConnection, LOST_AFTER_MS);
      }
      if (connection.connectionStatus === "open" || connection.connectionStatus === "closed" || connection.connectionStatus === "away") {
        reconnectingSinceMs = null;
        clearTimeout(lostTimer);
        if (connection.connectionStatus !== "open") connection = null;
      }
      // Back in after an update: the reload is done.
      if (matchUpdate && matchUpdate.step === "now" && d.connectionStatus === "open") { matchUpdate = null; showUpdate(); }
      showConnection();
    } else if (d.type === "zaisma:left") {
      connection = null;
      reconnectingSinceMs = null;
      showConnection();
    } else if (d.type === "zaisma:version-update" && typeof d.code === "string" && CODE.test(d.code) && typeof d.appliesAt === "string") {
      matchUpdate = { code: d.code, step: d.step === "now" ? "now" : "coming", appliesAt: d.appliesAt, isReloading: d.isReloading === true };
      offeredVersionId = null;
      showUpdate();
      showConnection();
    } else if (d.type === "zaisma:reload") {
      // The match switched and the game's files changed: back into the same room, at the new version.
      if (matchUpdate) matchUpdate.step = "now";
      else matchUpdate = { code: null, step: "now", appliesAt: new Date().toISOString(), isReloading: true };
      showUpdate();
      reloadGame(typeof d.code === "string" && CODE.test(d.code) ? d.code : null, d.isSpectator === true);
    } else if (d.type === "zaisma:version" && typeof d.versionId === "string") {
      frameVersionId = d.versionId;
      // The reloaded game is up: the update is done, and the connection shows from here (it rejoins its room, or its menu shows).
      if (matchUpdate && matchUpdate.step === "now") { matchUpdate = null; showUpdate(); showConnection(); }
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
    if (previewBar === "weak") connection = { code: "PREVUE", connectionStatus: "open", pingDurationMs: 182, isWeak: true };
    if (previewBar === "retrying" || previewBar === "lost") {
      connection = { code: "PREVUE", connectionStatus: "reconnecting", pingDurationMs: 64, isWeak: false };
      reconnectingSinceMs = previewBar === "lost" ? nowMs - LOST_AFTER_MS : nowMs;
      lostTimer = setTimeout(showConnection, LOST_AFTER_MS);
    }
    if (previewBar === "coming") matchUpdate = { code: "PREVUE", step: "coming", appliesAt: new Date(nowMs + 4 * 60_000).toISOString(), isReloading: true };
    if (previewBar === "updating") matchUpdate = { code: "PREVUE", step: "now", appliesAt: new Date(nowMs).toISOString(), isReloading: true };
    if (previewBar === "update") offeredVersionId = "version_preview";
    frameVersionId = "version_preview";
    showConnection();
    showUpdate();
  }
})();`,
);
