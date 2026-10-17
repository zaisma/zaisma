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
 *  - the game's developer changed the account's save since this device last synced: the account's,
 *    with no question, keeping this device's progress as an earlier version
 *  - anything else (two different saves): the player chooses
 * While playing, every save names the version it started from; if another device saved
 * in between, saving pauses and the player chooses. Saving only starts once the game domain
 * says the account's save is in place, so a device that couldn't take it never sends its own.
 * Whichever progress the player didn't pick is kept as an earlier version (see /account/saves).
 * A developer's change (through the API, saves-api.ts) reaches an open game the same way, with no
 * question: when its next save finds the account moved on, or when the player comes back to the tab.
 *
 * Guests: the game opens directly and its progress stays in this browser; nothing is sent
 * anywhere. Once a guest has progress and has played a while, a card offers to keep it with
 * an account. Making one opens in a new tab, so the game keeps running; when this tab sees
 * the player signed in, the game's save goes to the new account without a reload.
 *
 * `SAVES` is set by the page: { api, root, query, frameOrigin, slug, offerAfter }.
 */
export const SAVES_CLIENT = `
(function () {
  const signedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  let guest = !signedIn();
  const status = document.getElementById("save-status");
  const history = document.getElementById("save-history");
  const offer = document.getElementById("keep");
  const offerBar = document.getElementById("keep-bar");
  const offerLink = document.getElementById("keep-link");
  const toast = document.getElementById("save-toast");
  if (history) history.hidden = guest;
  const choose = document.getElementById("save-choice");
  let cloud = null;       // the account's save as last seen: { tag, version_number, sha256, updated_at, changed_by_kind, save_data }
  let synced = null;      // the save text the game and the account both have
  let paused = true;
  let forceCloud = false;
  let saving = null;      // the request in flight
  let queued = null;      // the newest save waiting behind it
  let frame = null;
  let restoring = null;   // the account's save while the game domain puts it in place
  let replacing = false;  // the player picked this device's progress over the account's
  let welcome = false;    // a guest just signed in: say so when their progress first reaches the account

  const canonical = (data) => { const out = {}; Object.keys(data).sort().forEach((k) => (out[k] = data[k])); return JSON.stringify(out); };
  const sha = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
  const marker = (tag, value) => {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem("zaisma:save:" + tag) || "null");
      localStorage.setItem("zaisma:save:" + tag, JSON.stringify(value));
    } catch { return null; }
  };
  const ago = (updatedAt) => {
    const m = Math.round((Date.now() - Date.parse(updatedAt)) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  };
  // Green when progress is reaching the account, amber when it isn't.
  const say = (text) => { if (status) { status.textContent = text; status.hidden = false; status.classList.toggle("ok", text.startsWith("Progress saves to your account")); } };
  let toastTimer = null;
  const pop = (text) => {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 8000);
  };
  // The player picked the account's progress: keep this device's as an earlier version on the account.
  const keepDevice = (text) => {
    if (text && text !== "{}") fetch(SAVES.api, { method: "PUT", body: JSON.stringify({ keep: true, save_json: text }), credentials: "same-origin" }).catch(() => {});
  };
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
    queued = null; // From the game as it was; the reloaded game sends its own.
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
    if (!guest) openThroughRestore();
  };

  // --- Guests ---

  const OFFER_QUIET = 3 * 24 * 3600000;   // after "Not now", the card stays away this long
  const quietKey = "zaisma:keep:" + SAVES.slug;
  let guestText = null;
  let playedMs = 0;
  let offered = false;

  function guestSave(text) {
    guestText = text;
    maybeOffer();
  }
  setInterval(() => {
    if (!guest || !frame || document.visibilityState !== "visible") return;
    playedMs += 5000;
    maybeOffer();
  }, 5000);

  function maybeOffer() {
    if (!guest || !guestText || guestText === "{}") return;
    if (offerBar) offerBar.hidden = false;
    if (offerLink) offerLink.hidden = false;
    say("Your progress is only saved in this browser.");
    if (offered || playedMs < SAVES.offerAfter || !offer) return;
    offered = true;
    let quietSince = 0;
    try { quietSince = Number(localStorage.getItem(quietKey)) || 0; } catch {}
    if (Date.now() - quietSince >= OFFER_QUIET) offer.hidden = false;
  }

  // Make an account (or sign in) in a new tab, so the game keeps running here. If the browser
  // won't open one, the link itself goes there in this tab and comes back to the game.
  document.querySelectorAll("[data-keep]").forEach((a) => {
    a.addEventListener("click", (e) => {
      const next = "/account/kept?game=" + SAVES.slug;
      const opened = window.open(a.dataset.keep + "?next=" + encodeURIComponent(next), "_blank");
      if (opened) e.preventDefault();
      if (offer) offer.hidden = true;
      if (dialog && dialog.open) dialog.close();
    });
  });
  const later = document.getElementById("keep-later");
  if (later) later.onclick = () => {
    offer.hidden = true;
    try { localStorage.setItem(quietKey, String(Date.now())); } catch {}
  };

  // Signed in from another tab: the progress on this device goes to the account from now on.
  async function joined() {
    if (!guest || !signedIn()) return;
    guest = false;
    for (const el of [offer, offerBar, offerLink]) if (el) el.hidden = true;
    if (history) history.hidden = false;
    if (!frame) return; // Not playing yet: Play opens the game through the restore page as usual.
    const c = await load();
    if (!c) return say("Couldn't reach your saved progress, so this visit won't save to your account.");
    cloud = c;
    if (!c.version_number) {
      // A new account: whatever this device has becomes the account's save.
      paused = false;
      synced = null;
      welcome = true;
      tell({ step: "sync", text: null });
    } else if (guestText && (await sha(guestText)) === c.sha256) {
      // The account already has exactly this progress: carry on saving from it.
      marker(c.tag, { version_number: c.version_number, sha256: c.sha256 });
      paused = false;
      synced = guestText;
      tell({ step: "sync", text: guestText });
      say("Progress saves to your account.");
      pop("Your progress now saves to your account.");
    } else {
      const text = "You're signed in. Your account already has progress in this game, so you'll choose which to keep next time you open it.";
      say(text);
      pop(text);
    }
  }
  addEventListener("focus", joined);
  document.addEventListener("visibilitychange", joined);
  try { new BroadcastChannel("zaisma").onmessage = (e) => e.data === "signed-in" && joined(); } catch {}

  async function restore(text, broken) {
    clearTimeout(fallback);
    if (broken) {
      say("Couldn't read this game's saves on this device, so this visit won't save to your account.");
      return tell({ step: "restore", action: "keep" });
    }
    // The restore page waits for this page from here on; give up on the account after 10 seconds.
    tell({ step: "wait" });
    const c = (cloud = await Promise.race([cloud, new Promise((r) => setTimeout(() => r(null), 10000))]));
    if (!c) {
      say("Couldn't reach your saved progress, so this visit won't save to your account.");
      return tell({ step: "restore", action: "keep" });
    }
    const localHash = await sha(text);
    const empty = text === "{}";
    // A marker from before version_number and sha256 matches neither, so the player chooses once.
    const mark = marker(c.tag);
    let use;
    if (forceCloud && c.version_number) use = "cloud";
    else if (!c.version_number) use = "local";
    else if (empty || localHash === c.sha256) use = "cloud";
    else if (mark && mark.version_number === c.version_number) use = "local";
    else if (mark && c.changed_by_kind === "developer") {
      // The developer changed the save since this device synced: theirs wins, and this device's progress is kept.
      use = "cloud";
      keepDevice(text);
    }
    else if (mark && mark.sha256 === localHash) use = "cloud";
    else {
      use = await ask("Which progress do you want?", "This game has progress saved to your account and different progress on this device. The one you don't pick is kept on your account as an earlier version.", "Your account's (saved " + ago(c.updated_at) + ")", "This device's");
      if (use === "cloud") keepDevice(text);
      else replacing = true;
    }
    forceCloud = false;
    if (use === "cloud" && c.version_number) {
      restoring = c;
      tell({ step: "restore", action: "use-cloud", data: c.save_data });
    } else {
      paused = false;
      // Keep this device's save; the game sends it as soon as it starts.
      synced = empty && !c.version_number ? text : null;
      tell({ step: "restore", action: "keep" });
      say("Progress saves to your account.");
    }
  }

  // The game domain put the account's save in place (or couldn't). Only then does saving start.
  function restored(ok) {
    const c = restoring;
    restoring = null;
    if (!ok) {
      say("Couldn't put your account's progress on this device, so this visit won't save to your account.");
      return;
    }
    synced = canonical(c.save_data);
    marker(c.tag, { version_number: c.version_number, sha256: c.sha256 });
    paused = false;
    say("Progress saves to your account. Last saved " + ago(c.updated_at) + ".");
  }

  async function store(text) {
    if (paused) return;
    if (saving) { queued = text; return; }
    const body = JSON.stringify({ base_version_number: cloud.version_number, save_json: text, ...(replacing ? { replace: true } : {}) });
    saving = fetch(SAVES.api, { method: "PUT", body, credentials: "same-origin", keepalive: body.length < 60000 }).catch(() => null);
    const res = await saving;
    saving = null;
    const out = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      replacing = false;
      cloud.version_number = out.version_number;
      cloud.sha256 = out.sha256;
      synced = text;
      marker(cloud.tag, { version_number: out.version_number, sha256: out.sha256 });
      say("Progress saves to your account. Last saved just now.");
      if (welcome) pop("Your progress now saves to your account.");
      welcome = false;
    } else if (res && res.status === 409) {
      paused = true;
      tell({ step: "pause" });
      if (out.changed_by_kind === "developer") {
        // The developer changed the save: reload the game with it, no question, keeping this device's progress.
        keepDevice(text);
        openThroughRestore();
        return;
      }
      const use = await ask("You played this game on another device", "Its progress is newer than this device's. The one you don't pick is kept on your account as an earlier version.", "Load the newer progress", "Keep this device's");
      if (use === "cloud") {
        keepDevice(text);
        forceCloud = true;
        openThroughRestore();
      } else {
        cloud.version_number = out.version_number;
        replacing = true;
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

  // Back on the tab: if the developer changed the save meanwhile, reload the game with it now rather
  // than at its next save. Only the version is asked for, so this costs one small read.
  document.addEventListener("visibilitychange", async () => {
    if (guest || paused || saving || document.visibilityState !== "visible" || !cloud || cloud instanceof Promise) return;
    const res = await fetch(SAVES.api + "?version", { credentials: "same-origin" }).catch(() => null);
    const out = res && res.ok ? await res.json().catch(() => null) : null;
    if (!out || out.changed_by_kind !== "developer" || out.version_number === cloud.version_number || paused || saving) return;
    paused = true;
    tell({ step: "pause" });
    openThroughRestore();
  });

  addEventListener("message", (e) => {
    if (!frame || e.origin !== SAVES.frameOrigin || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.type !== "zaisma:saves" || typeof m.step !== "string") return;
    if (guest) {
      // Watch for progress only: the save stays in this browser.
      if (m.step === "hello" && m.phase === "game") tell({ step: "sync", text: null });
      else if (m.step === "save" && typeof m.text === "string") guestSave(m.text);
      return;
    }
    if (m.step === "hello" && m.phase === "restore" && typeof m.text === "string") restore(m.text, m.broken === true);
    else if (m.step === "blocked" && restoring) say("This game is open in another tab. Close it there to load your saved progress.");
    else if (m.step === "restored" && restoring) restored(m.ok === true);
    else if (m.step === "hello" && m.phase === "game") {
      // An older restore page doesn't say when it's done; the game starting means it is.
      if (restoring) restored(true);
      if (!paused && cloud && !(cloud instanceof Promise)) tell({ step: "sync", text: synced });
    }
    else if (m.step === "save" && typeof m.text === "string" && m.text !== synced && cloud && !(cloud instanceof Promise)) store(m.text);
  });
})();
`;
