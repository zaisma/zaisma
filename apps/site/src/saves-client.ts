import { pageScript } from "./page-scripts.ts";

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
 *  - anything else (both played on): the progress played most recently
 * Zaisma never asks the player which progress to keep: what progress means is the game's, so a game
 * that wants a choice builds it with the SDK. When this device's progress loses, it's kept on the account
 * as an earlier version; when it wins, the account's is (the developer can restore either).
 * While playing, every save names the version it started from. If another device saved in between,
 * the progress played most recently wins: usually this device's, which is being played right now.
 * Back on the tab, if the account moved on while it was hidden and was played after this device,
 * the game reloads with the account's progress. Saving only starts once the game domain says the
 * account's save is in place, so a device that couldn't take it never sends its own.
 * When this device last played is remembered per game as { sha256, played_at_ms }: the time its save
 * last changed, as far as this page saw (null when it never saw a change; the account's progress wins then).
 * A developer's change (through the API, saves-api.ts) always wins: when the game's next save finds the
 * account moved on, or when the player comes back to the tab, the game reloads with it, and this device's
 * progress since its last save is kept as an earlier version. A game opening later takes it like any newer save.
 *
 * The game's own save screens (Zaisma.saves in packages/sdk/zaisma.js) ask this page, which answers for
 * them: its earlier versions, one of them, and going back to one (which reloads the game). A game that
 * listens hears two events. conflict: two progresses differed and one was set aside, kept as an earlier
 * version (held until the game listens, newest first, across the reload that put the winner in place).
 * developerChange: the developer changed the save, and instead of the reload it's put in place under the
 * running game, which rereads its storage (the reload stays the fallback when it can't be).
 * The game can also ask for the "Keep your progress" card (Zaisma.player.offerAccount): it shows at most
 * once a visit however it's asked, and not for 3 days after Not now.
 *
 * Guests: the game opens directly and its progress stays in this browser; nothing is sent
 * anywhere. Once a guest has progress and has played a while, a card offers to keep it with
 * an account. Making one opens in a new tab, so the game keeps running; when this tab sees
 * the player signed in, the game's save goes to the new account without a reload.
 *
 * The page sets `SAVES` in its saves-data block: { api, root, query, frameOrigin, slug, offerAfter, isAccountOfferEnabled }.
 * The game page's script (pages.ts) comes first: this uses its frame, and hands it the game's
 * zaisma:saves-request and zaisma:account-offer messages (savesRequest and offerAccount below).
 */
export const SAVES_SCRIPT = pageScript("saves", `
(function () {
  const SAVES = JSON.parse(document.getElementById("saves-data").textContent);
  const signedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
  let guest = !signedIn();
  const status = document.getElementById("save-status");
  const offer = document.getElementById("keep");
  const offerBar = document.getElementById("keep-bar");
  const offerLink = document.getElementById("keep-link");
  const toast = document.getElementById("save-toast");
  let cloud = null;       // the account's save as last seen: { tag, version_number, sha256, updated_at, changed_by_kind, save_data }
  let synced = null;      // the save text the game and the account both have
  let paused = true;
  let forceCloud = false;
  let saving = null;      // the request in flight
  let queued = null;      // the newest save waiting behind it
  let frame = null;
  let restoring = null;   // the account's save while the game domain puts it in place
  let replacing = false;  // this device's progress was played more recently than the account's, and replaces it
  let welcome = false;    // a guest just signed in: say so when their progress first reaches the account
  let keptBeforeReload = null; // this device's progress, kept already before the reload with the account's
  let openCount = 0;      // how many times the game was opened through the restore page: what happened before belongs to an earlier game
  const SAVES_EVENTS = ["conflict", "developerChange"];
  const listening = new Set(); // the events the game listens for (Zaisma.saves.on); a game that reloads says again
  let pendingConflict = null;  // a conflict the game hasn't listened for yet
  let applying = null;    // a developer's change while the game domain puts it in place under the running game
  let isRestoringCopy = false; // the game is going back to an earlier version (Zaisma.saves.restoreCopy)

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
  // The account's progress wins: keep this device's as an earlier version on the account. Answers the copy's ID, or null.
  const keepDevice = (text) =>
    text && text !== "{}"
      ? fetch(SAVES.api, { method: "PUT", body: JSON.stringify({ keep: true, save_json: text }), credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          .then((out) => (out && out.save_copy_id) || null)
          .catch(() => null)
      : Promise.resolve(null);
  const playedKey = "zaisma:played:" + SAVES.slug;
  const played = (value) => {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(playedKey) || "null");
      localStorage.setItem(playedKey, JSON.stringify(value));
    } catch { return null; }
  };
  // The game sent its save: if it changed, this device played just now.
  async function notePlayed(text) {
    const hash = await sha(text);
    const was = played();
    if (!was) played({ sha256: hash, played_at_ms: null });
    else if (was.sha256 !== hash) played({ sha256: hash, played_at_ms: Date.now() });
  }
  // Whether this device's progress was played after the account's was saved. Not known: the account's wins.
  const deviceIsNewer = (updatedAt) => {
    const p = played();
    return Boolean(p && p.played_at_ms && updatedAt && p.played_at_ms > Date.parse(updatedAt));
  };
  const tell = (msg) => frame && frame.contentWindow && frame.contentWindow.postMessage({ type: "zaisma:saves", ...msg }, SAVES.frameOrigin);
  // To the game itself (the SDK), not the game domain's saves script.
  const toGame = (msg) => frame && frame.contentWindow && frame.contentWindow.postMessage(msg, SAVES.frameOrigin);
  const copyFields = (copy) => ({ id: copy.id, savedAt: copy.saved_at, copyReason: copy.copy_reason, sizeBytes: copy.size_bytes, isCurrentSave: copy.is_current_save });
  async function copyById(saveCopyId) {
    if (!saveCopyId) return null;
    const res = await fetch(SAVES.api + "/copies", { credentials: "same-origin" }).catch(() => null);
    const out = res && res.ok ? await res.json().catch(() => null) : null;
    const copy = out && Array.isArray(out.save_copies) ? out.save_copies.find((each) => each.id === saveCopyId) : null;
    return copy ? copyFields(copy) : null;
  }
  const sendEvent = (eventName, event) => toGame({ type: "zaisma:saves-event", eventName, event });

  // Two progresses differed and one was set aside: the game hears which won and where the other is kept,
  // now if it listens, or once it does. keeping answers the kept copy's ID; no copy, no conflict.
  async function conflicted(winningProgress, keeping) {
    const opened = openCount;
    const keptSaveCopy = await copyById(await keeping);
    if (!keptSaveCopy || opened !== openCount) return;
    const event = { winningProgress, keptSaveCopy };
    if (listening.has("conflict")) sendEvent("conflict", event);
    else pendingConflict = event;
  }

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

  // Open the game through the restore page. If that page doesn't answer, open the game
  // directly so the player is never stuck, and leave saving off for this visit.
  let fallback = null;
  // An accounts-only game opens through its entry (the game page's openGameAt); any other straight away.
  const openAt = (pathInGame) => (window.openGameAt ? openGameAt(frame, pathInGame) : (frame.src = SAVES.root + pathInGame));
  function openThroughRestore() {
    paused = true;
    openCount++;
    listening.clear();
    pendingConflict = null; // A conflict from this reload comes after it (conflicted).
    if (applying) { clearTimeout(applying.timer); applying = null; }
    queued = null; // From the game as it was; the reloaded game sends its own.
    cloud = load();
    openAt("_zaisma/restore#" + encodeURIComponent(SAVES.query));
    clearTimeout(fallback);
    fallback = setTimeout(() => {
      cloud = null;
      openAt(SAVES.query);
      say("Couldn't reach your saved progress, so this visit won't save to your account.");
    }, 6000);
  }

  // The game page reloads the game in place (a version published "now"), at query: through the restore
  // page, so its progress carries over. A guest's game has nothing to restore, so the page opens it itself.
  window.reloadGameThroughSaves = function (query) {
    if (guest || !frame) return false;
    SAVES.query = query;
    openThroughRestore();
    return true;
  };

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

  let isGameAsking = false; // the card is up because the game asked (Zaisma.player.offerAccount)
  const isQuiet = () => {
    let quietSince = 0;
    try { quietSince = Number(localStorage.getItem(quietKey)) || 0; } catch {}
    return Date.now() - quietSince < OFFER_QUIET;
  };

  function maybeOffer() {
    if (!guest || !guestText || guestText === "{}") return;
    if (offerBar) offerBar.hidden = false;
    if (offerLink) offerLink.hidden = false;
    say("Your progress is only saved in this browser.");
    // The card by itself, after a while, unless the game picks the moment instead. Either way it shows once a visit.
    if (offered || !SAVES.isAccountOfferEnabled || playedMs < SAVES.offerAfter || !offer) return;
    offered = true;
    if (!isQuiet()) offer.hidden = false;
  }

  // The game asks for the card (Zaisma.player.offerAccount): signing in reaches it as zaisma:signed-in.
  window.offerAccount = function () {
    const answer = (status) => toGame({ type: "zaisma:account-offer", status });
    if (!guest || signedIn()) {
      // Signed in already: the game hears who they are at once (the sign-in script's tellSignedIn).
      answer("asking");
      if (typeof tellSignedIn === "function") tellSignedIn();
      return;
    }
    if (offered || isQuiet() || !offer) return answer("too_soon");
    offered = true;
    isGameAsking = true;
    answer("asking");
    const signInAsk = document.getElementById("sign-in-ask");
    if (signInAsk) signInAsk.hidden = true;
    offer.hidden = false;
  };

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
    if (isGameAsking) toGame({ type: "zaisma:account-offer", status: "declined" });
    isGameAsking = false;
  };

  // Signed in from another tab: the progress on this device goes to the account from now on.
  async function joined() {
    if (!guest || !signedIn()) return;
    guest = false;
    for (const el of [offer, offerBar, offerLink]) if (el) el.hidden = true;
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
    } else if (deviceIsNewer(c.updated_at)) {
      // Both have progress, and this device's was played more recently: it replaces the account's, which is kept
      // as an earlier version (the game hears the conflict once that save is stored).
      paused = false;
      synced = null;
      replacing = true;
      welcome = true;
      tell({ step: "sync", text: null });
    } else {
      // The account's progress was played more recently: the game reloads with it, keeping this device's as an earlier version.
      const keeping = keepDevice(guestText);
      keptBeforeReload = guestText;
      forceCloud = true;
      openThroughRestore();
      conflicted("other_device", keeping);
      pop("You're signed in. Your account's progress in this game is newer, so the game reloaded with it.");
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
    // The first time this page sees this device's save: from now on a change to it counts as playing.
    if (!played()) played({ sha256: localHash, played_at_ms: null });
    // A marker from before version_number and sha256 matches neither, so the most recently played wins.
    const mark = marker(c.tag);
    let use;
    if (forceCloud && c.version_number) {
      use = "cloud";
      // This device's progress since its last save (the account keeps one copy of each progress).
      // Unchanged since it last synced, it was the account's own save, so there's nothing to keep; nor when it was kept before the reload.
      if (!empty && localHash !== c.sha256 && !(mark && mark.sha256 === localHash) && text !== keptBeforeReload) keepDevice(text);
    }
    else if (!c.version_number) use = "local";
    else if (empty || localHash === c.sha256) use = "cloud";
    else if (mark && mark.version_number === c.version_number) use = "local";
    else if (mark && mark.sha256 === localHash) use = "cloud";
    else {
      // Both played on since they last matched: the progress played most recently wins, the other is kept.
      use = deviceIsNewer(c.updated_at) ? "local" : "cloud";
      if (use === "cloud") conflicted("other_device", keepDevice(text));
      else replacing = true; // The game hears the conflict once its save replaced the account's (store).
    }
    forceCloud = false;
    keptBeforeReload = null;
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
    played({ sha256: c.sha256, played_at_ms: Date.parse(c.updated_at) || null });
    paused = false;
    say("Progress saves to your account. Last saved " + ago(c.updated_at) + ".");
  }

  async function store(text) {
    if (paused) return;
    if (saving) { queued = text; return; }
    const body = JSON.stringify({ base_version_number: cloud.version_number, save_json: text, ...(replacing ? { replace: true } : {}) });
    saving = fetch(SAVES.api, { method: "PUT", body, credentials: "same-origin", keepalive: body.length < 60000 }).catch(() => null);
    const opened = openCount;
    const res = await saving;
    saving = null;
    // The game reloaded meanwhile: that save is from the game as it was.
    if (opened !== openCount) return;
    // Going back to an earlier version: a save that went through still moved the account on; anything else waits for that.
    if (isRestoringCopy && !(res && res.ok)) return;
    const out = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      if (replacing) conflicted("this_device", Promise.resolve(out.kept_save_copy_id));
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
      // The developer's change always wins, and so does another device's progress played after this device's:
      // reload the game with it, keeping this device's progress. Otherwise this device's, played just now, replaces it.
      // A developer's change is never a conflict, and a game that listens for it takes it in place.
      if (out.changed_by_kind === "developer" && listening.has("developerChange")) {
        takeDeveloperChange(text);
      } else if (out.changed_by_kind === "developer" || !deviceIsNewer(out.updated_at)) {
        const keeping = keepDevice(text);
        keptBeforeReload = text;
        forceCloud = true;
        openThroughRestore();
        if (out.changed_by_kind !== "developer") conflicted("other_device", keeping);
      } else {
        cloud.version_number = out.version_number;
        replacing = true;
        paused = false;
        tell({ step: "sync", text: null });
      }
      return;
    } else if (res && res.status === 413) {
      overLimit();
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

  // Back on the tab: if the developer changed the save meanwhile, or another device saved progress played
  // after this device's, reload the game with it now rather than at its next save. Only the version is
  // asked for, so this costs one small read.
  document.addEventListener("visibilitychange", async () => {
    if (guest || paused || saving || document.visibilityState !== "visible" || !cloud || cloud instanceof Promise) return;
    const res = await fetch(SAVES.api + "?version", { credentials: "same-origin" }).catch(() => null);
    const out = res && res.ok ? await res.json().catch(() => null) : null;
    if (!out || out.version_number === cloud.version_number || paused || saving) return;
    if (out.changed_by_kind !== "developer" && deviceIsNewer(out.updated_at)) return;
    paused = true;
    tell({ step: "pause" });
    // This device's progress was saved when the tab was hidden, so there's nothing of it to keep here.
    if (out.changed_by_kind === "developer" && listening.has("developerChange")) return takeDeveloperChange(null);
    forceCloud = true;
    openThroughRestore();
  });

  // The developer changed the save and the game listens for it: put it in place under the running game
  // (saving is paused), then tell the game, which rereads its storage. Anything in the way: today's reload.
  // text is this device's progress since its last save, kept as an earlier version (null: nothing to keep).
  async function takeDeveloperChange(text) {
    const opened = openCount;
    const keeping = keepDevice(text);
    const reload = () => {
      keptBeforeReload = text;
      forceCloud = true;
      openThroughRestore();
    };
    const c = await load();
    if (opened !== openCount) return;
    if (!c || !c.version_number || !c.save_data) return reload();
    applying = { c, keeping, reload, timer: setTimeout(() => applied(false), 3000) };
    tell({ step: "apply", data: c.save_data });
  }
  async function applied(ok) {
    const taking = applying;
    if (!taking) return;
    applying = null;
    clearTimeout(taking.timer);
    if (!ok) return taking.reload();
    const c = taking.c;
    const opened = openCount;
    cloud = c;
    synced = canonical(c.save_data);
    marker(c.tag, { version_number: c.version_number, sha256: c.sha256 });
    played({ sha256: c.sha256, played_at_ms: Date.parse(c.updated_at) || null });
    paused = false;
    tell({ step: "sync", text: synced });
    say("Progress saves to your account. Last saved " + ago(c.updated_at) + ".");
    const keptSaveCopyId = await taking.keeping;
    const keptSaveCopy = keptSaveCopyId ? await copyById(keptSaveCopyId) : null;
    if (opened === openCount && listening.has("developerChange")) sendEvent("developerChange", { changedAt: c.updated_at, keptSaveCopy });
  }

  // --- The game's own save screens (Zaisma.saves), handed over by the game page's script ---

  const SAVE_COPY_ID = /^save_copy_[a-z0-9-]{1,40}$/;
  window.savesRequest = async function (m) {
    const reply = (body) => toGame({ type: "zaisma:saves-answer", requestNumber: m.requestNumber, ...body });
    const fail = (code, message) => reply({ error: { code, message } });
    const failed = () => fail("request_failed", "Zaisma didn't answer, so check the connection and try again.");
    if (m.request === "listen") {
      const eventNames = Array.isArray(m.eventNames) ? m.eventNames.filter((eventName) => SAVES_EVENTS.includes(eventName)) : [];
      eventNames.forEach((eventName) => listening.add(eventName));
      if (listening.has("conflict") && pendingConflict) {
        sendEvent("conflict", pendingConflict);
        pendingConflict = null;
      }
      return;
    }
    if (!["list_copies", "get_copy", "restore_copy"].includes(m.request)) return;
    // The answer can take a moment: say at once that this page is here.
    reply({ status: "asking" });
    if (guest || !signedIn()) return fail("account_needed", "Earlier versions are kept for players signed in to Zaisma: a guest's progress stays in this browser. Ask the player to sign in first (Zaisma.player.signIn).");
    if (m.request === "list_copies") {
      const res = await fetch(SAVES.api + "/copies", { credentials: "same-origin" }).catch(() => null);
      const out = res && res.ok ? await res.json().catch(() => null) : null;
      if (!out || !Array.isArray(out.save_copies)) return failed();
      return reply({ answer: out.save_copies.map(copyFields) });
    }
    if (typeof m.saveCopyId !== "string" || !SAVE_COPY_ID.test(m.saveCopyId)) return fail("bad_save_copy_id", "Give a save copy ID from Zaisma.saves.listCopies(), like save_copy_k2v9q4x7m1p3w8r5t6y0.");
    const copyPath = SAVES.api + "/copies/" + m.saveCopyId;
    const noCopy = () => fail("no_save_copy", "The player has no earlier version " + m.saveCopyId + " in this game: Zaisma.saves.listCopies() lists the ones kept.");
    if (m.request === "get_copy") {
      const res = await fetch(copyPath, { credentials: "same-origin" }).catch(() => null);
      if (res && res.status === 404) return noCopy();
      const out = res && res.ok ? await res.json().catch(() => null) : null;
      if (!out || !out.save_copy) return failed();
      return reply({ answer: { ...copyFields(out.save_copy), localStorageItems: out.save_copy.local_storage_items, indexeddbDatabases: out.save_copy.indexeddb_databases } });
    }
    // restore_copy: pause saving, make the copy the save, and reload the game with it.
    const wasPaused = paused;
    paused = true;
    isRestoringCopy = true;
    queued = null;
    tell({ step: "pause" });
    const res = await fetch(copyPath + "/restore", { method: "POST", credentials: "same-origin" }).catch(() => null);
    isRestoringCopy = false;
    if (res && res.ok) {
      reply({ answer: null });
      // This device's progress, if it was the save the restore replaced, is that save's "restore" copy: nothing more to keep.
      forceCloud = true;
      openThroughRestore();
      return;
    }
    paused = wasPaused;
    if (!wasPaused) tell({ step: "sync", text: synced });
    if (res && res.status === 404) return noCopy();
    if (res && res.status === 429) return fail("slow_down", "The game went back to earlier versions too often. Wait a minute and try again.");
    failed();
  };

  // The save is past the limit (the server said so, or the game's script stopped reading at it).
  function overLimit() {
    paused = true;
    tell({ step: "pause" });
    say("This game's save is over 5 MB, so it stays on this device.");
  }

  addEventListener("message", (e) => {
    if (!frame || e.origin !== SAVES.frameOrigin || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.type !== "zaisma:saves" || typeof m.step !== "string") return;
    if (m.step === "save" && typeof m.text === "string") notePlayed(m.text);
    // A game page starting: its game listens again if it wants the events.
    if (m.step === "hello" && m.phase === "game") listening.clear();
    if (guest) {
      // Watch for progress only: the save stays in this browser.
      if (m.step === "hello" && m.phase === "game") tell({ step: "sync", text: null });
      else if (m.step === "save" && typeof m.text === "string") guestSave(m.text);
      return;
    }
    if (m.step === "hello" && m.phase === "restore" && typeof m.text === "string") restore(m.text, m.broken === true);
    else if (m.step === "blocked" && restoring) say("This game is open in another tab. Close it there to load your saved progress.");
    else if (m.step === "restored" && restoring) restored(m.ok === true);
    else if (m.step === "applied" && applying) applied(m.ok === true);
    else if (m.step === "hello" && m.phase === "game") {
      // An older restore page doesn't say when it's done; the game starting means it is.
      if (restoring) restored(true);
      if (!paused && cloud && !(cloud instanceof Promise)) tell({ step: "sync", text: synced });
    }
    else if (m.step === "save" && typeof m.text === "string" && m.text !== synced && cloud && !(cloud instanceof Promise)) store(m.text);
    else if (m.step === "over_limit" && !paused && cloud && !(cloud instanceof Promise)) overLimit();
  });
})();
`);
