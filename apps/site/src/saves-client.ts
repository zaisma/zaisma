/**
 * Cloud saves, game page side: runs on zaisma.com/g/<game> for signed-in players.
 * It fetches the account's save, decides with the game domain script (packages/sdk/saves.js)
 * which save the game starts with, and stores the game's save as it changes.
 *
 * Which save wins when the game opens:
 *  - nothing on the account: keep this device's (and store it, if there is one)
 *  - nothing on this device, or both the same: the account's
 *  - this device last synced the account's current save and has played on since: this device's
 *  - this device hasn't changed since it last synced, but the account has: the account's
 *  - anything else (two different saves): the player chooses
 * While playing, every save names the version it started from; if another device saved
 * in between, saving pauses and the player chooses.
 *
 * `SAVES` is set by the page: { api, root, query, frameOrigin }.
 */
export const SAVES_CLIENT = `
(function () {
  if (!/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) return;
  const status = document.getElementById("save-status");
  const choose = document.getElementById("save-choice");
  let cloud = null;       // the account's save as last seen: { tag, version, hash, at, data }
  let synced = null;      // the save text the game and the account both have
  let paused = true;
  let forceCloud = false;
  let saving = null;      // the request in flight
  let queued = null;      // the newest save waiting behind it
  let frame = null;

  const canonical = (data) => { const out = {}; Object.keys(data).sort().forEach((k) => (out[k] = data[k])); return JSON.stringify(out); };
  const sha = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
  const marker = (tag, value) => {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem("zaisma:save:" + tag) || "null");
      localStorage.setItem("zaisma:save:" + tag, JSON.stringify(value));
    } catch { return null; }
  };
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  };
  const say = (text) => { if (status) { status.textContent = text; status.hidden = false; } };
  const tell = (msg) => frame && frame.contentWindow && frame.contentWindow.postMessage({ type: "zaisma:saves", ...msg }, SAVES.frameOrigin);

  // One retry for a passing hiccup; a signed-out player or a game without saves just plays.
  async function load(retry = true) {
    try {
      const res = await fetch(SAVES.api, { credentials: "same-origin" });
      if (res.ok) return await res.json();
      if (res.status === 401 || res.status === 404 || !retry) return null;
    } catch { if (!retry) return null; }
    await new Promise((r) => setTimeout(r, 800));
    return load(false);
  }

  function ask(title, text, cloudLabel, localLabel) {
    choose.querySelector("strong").textContent = title;
    choose.querySelector("p").textContent = text;
    choose.querySelector("[value=cloud]").textContent = cloudLabel;
    choose.querySelector("[value=local]").textContent = localLabel;
    choose.showModal();
    // Answer on the click itself; Escape counts as the account's save, the safe default.
    return new Promise((resolve) => {
      const done = (value) => (e) => {
        if (e) e.preventDefault();
        choose.querySelector("[value=cloud]").onclick = choose.querySelector("[value=local]").onclick = choose.oncancel = null;
        choose.close();
        resolve(value);
      };
      choose.querySelector("[value=cloud]").onclick = done("cloud");
      choose.querySelector("[value=local]").onclick = done("local");
      choose.oncancel = done("cloud");
    });
  }

  // Open the game through the restore page. If that page doesn't answer, open the game
  // directly so the player is never stuck, and leave saving off for this visit.
  let fallback = null;
  function openThroughRestore() {
    paused = true;
    cloud = load();
    frame.src = SAVES.root + "_zaisma/restore#" + encodeURIComponent(SAVES.query);
    clearTimeout(fallback);
    fallback = setTimeout(() => {
      cloud = null;
      frame.src = SAVES.root + SAVES.query;
      say("Couldn't reach your saved progress, so this visit won't save to your account.");
    }, 6000);
  }

  // Called by play(): start the game through the restore page instead of directly.
  window.startSaves = function (f) {
    frame = f;
    openThroughRestore();
  };

  async function restore(text) {
    clearTimeout(fallback);
    // The restore page waits for this page from here on; give up on the account after 10 seconds.
    tell({ step: "wait" });
    const c = (cloud = await Promise.race([cloud, new Promise((r) => setTimeout(() => r(null), 10000))]));
    if (!c) {
      say("Couldn't reach your saved progress, so this visit won't save to your account.");
      return tell({ step: "restore", action: "keep" });
    }
    const localHash = await sha(text);
    const empty = text === "{}";
    const mark = marker(c.tag);
    let use;
    if (forceCloud && c.version) use = "cloud";
    else if (!c.version) use = "local";
    else if (empty || localHash === c.hash) use = "cloud";
    else if (mark && mark.version === c.version) use = "local";
    else if (mark && mark.hash === localHash) use = "cloud";
    else {
      use = await ask("Which progress do you want?", "This game has progress saved to your account and different progress on this device. The one you don't pick is replaced.", "Your account's (saved " + ago(c.at) + ")", "This device's");
    }
    forceCloud = false;
    paused = false;
    if (use === "cloud" && c.version) {
      synced = canonical(c.data);
      marker(c.tag, { version: c.version, hash: c.hash });
      tell({ step: "restore", action: "use-cloud", data: c.data });
      say("Progress saves to your account. Last saved " + ago(c.at) + ".");
    } else {
      // Keep this device's save; the game sends it as soon as it starts.
      synced = empty && !c.version ? text : null;
      tell({ step: "restore", action: "keep" });
      say("Progress saves to your account.");
    }
  }

  async function store(text) {
    if (paused) return;
    if (saving) { queued = text; return; }
    const body = JSON.stringify({ base: cloud.version, data: text });
    saving = fetch(SAVES.api, { method: "PUT", body, credentials: "same-origin", keepalive: body.length < 60000 }).catch(() => null);
    const res = await saving;
    saving = null;
    const out = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      cloud.version = out.version;
      cloud.hash = out.hash;
      synced = text;
      marker(cloud.tag, { version: out.version, hash: out.hash });
      say("Progress saves to your account. Last saved just now.");
    } else if (res && res.status === 409) {
      paused = true;
      tell({ step: "pause" });
      const use = await ask("You played this game on another device", "Its progress is newer than this device's. The one you don't pick is replaced.", "Load the newer progress", "Keep this device's");
      if (use === "cloud") {
        forceCloud = true;
        openThroughRestore();
      } else {
        cloud.version = out.version;
        paused = false;
        tell({ step: "sync", text: null });
      }
      return;
    } else if (res && res.status === 413) {
      paused = true;
      tell({ step: "pause" });
      say("This game's save is over 5 MB, so it stays on this device.");
      return;
    } else if (res && res.status === 401) {
      paused = true;
      tell({ step: "pause" });
      say("Sign in again to keep saving to your account.");
      return;
    } else {
      // Let the game send this save again on its next check.
      say("Couldn't save to your account. Trying again soon.");
      tell({ step: "sync", text: synced });
    }
    if (queued !== null) { const next = queued; queued = null; store(next); }
  }

  addEventListener("message", (e) => {
    if (!frame || e.origin !== SAVES.frameOrigin || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.type !== "zaisma:saves" || typeof m.step !== "string") return;
    if (m.step === "hello" && m.phase === "restore" && typeof m.text === "string") restore(m.text);
    else if (m.step === "hello" && m.phase === "game" && !paused && cloud && !(cloud instanceof Promise)) tell({ step: "sync", text: synced });
    else if (m.step === "save" && typeof m.text === "string" && m.text !== synced && cloud && !(cloud instanceof Promise)) store(m.text);
  });
})();
`;
