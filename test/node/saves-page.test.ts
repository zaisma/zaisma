import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SAVES_SCRIPT } from "../../apps/site/src/saves-client.ts";
import { canonicalSave, EMPTY_SAVE_TEXT, saveHash } from "../../packages/core/src/saves.ts";

/**
 * Cloud saves in the browser, in stand-in browsers: the game page's script (apps/site/src/saves-client.ts)
 * with the account's answers scripted, and the game domain's script (packages/sdk/saves.js) on a game page.
 * They cover what the game's own save screens rely on (Zaisma.saves and Zaisma.player.offerAccount):
 * a conflict that waits for the game to listen, a developer's change put in place under the running game
 * (or the reload when it can't be), and Zaisma's rule on how often the "Keep your progress" card shows.
 */

const SITE = "https://zaisma.test";
const FRAME_ORIGIN = "https://owl-game.games.zaisma.test";
const API = "/api/saves/owl-game";

type Answer = { httpStatus?: number; body: unknown };
type Message = Record<string, unknown>;

function storage(items: Record<string, string> = {}) {
  const map = new Map(Object.entries(items));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, text: string) => void map.set(key, String(text)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    map,
  };
}

/**
 * The game page with cloud saves on: its saves script, a game frame that records what it's told and
 * where it's opened, and the account's answers from `answers` (by method and path, the newest first).
 */
function loadGamePage({ isSignedIn = true, isAccountOfferEnabled = true, localItems = {} as Record<string, string> } = {}) {
  const answers: { method: string; path: string; answer: Answer }[] = [];
  const asked: { method: string; path: string; body: unknown }[] = [];
  const answer = (method: string, path: string, body: unknown, httpStatus = 200) => answers.unshift({ method, path, answer: { httpStatus, body } });
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const documentListeners: Record<string, (() => void)[]> = {};
  const element = () => ({ hidden: true, textContent: "", classList: { toggle() {} }, querySelector: () => ({ focus() {} }), focus() {}, onclick: null as null | (() => void) });
  const elements: Record<string, ReturnType<typeof element> | { textContent: string }> = {
    "saves-data": { textContent: JSON.stringify({ api: API, root: `${FRAME_ORIGIN}/`, query: "", frameOrigin: FRAME_ORIGIN, slug: "owl-game", offerAfter: 300000, isAccountOfferEnabled }) },
    "save-status": element(),
    keep: element(),
    "keep-bar": element(),
    "keep-link": element(),
    "keep-later": element(),
    "save-toast": element(),
    "sign-in-ask": element(),
  };
  const toGame: Message[] = [];
  const opened: string[] = [];
  const contentWindow = { postMessage: (message: Message, origin: string) => origin === FRAME_ORIGIN && toGame.push(message) };
  const frame = {
    contentWindow,
    set src(address: string) {
      opened.push(address);
    },
  };
  const localStorage = storage(localItems);
  const window: Record<string, unknown> = {};
  const browser = {
    window,
    document: {
      cookie: isSignedIn ? "zaisma_in=1" : "",
      visibilityState: "visible",
      getElementById: (id: string) => elements[id] ?? null,
      querySelectorAll: () => [],
      addEventListener: (type: string, listener: () => void) => void (documentListeners[type] ??= []).push(listener),
    },
    localStorage,
    fetch: async (path: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? "GET";
      asked.push({ method, path, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const found = answers.find((each) => each.method === method && each.path === path);
      if (!found) throw new TypeError("Failed to fetch");
      return { ok: (found.answer.httpStatus ?? 200) < 300, status: found.answer.httpStatus ?? 200, json: async () => found.answer.body };
    },
    addEventListener: (type: string, listener: (event?: unknown) => void) => void (listeners[type] ??= []).push(listener),
    BroadcastChannel: class {
      onmessage = null;
    },
    setInterval: () => 0,
  };
  // The game page's own script defines these for the saves script (pages.ts).
  Object.assign(window, { tellSignedIn: undefined });
  new Function(...Object.keys(browser), SAVES_SCRIPT.sourceText)(...Object.values(browser));
  const page = {
    elements: elements as Record<string, ReturnType<typeof element>>,
    window: window as { startSaves: (f: unknown) => void; savesRequest: (m: Message) => Promise<void>; offerAccount: () => void },
    answer,
    asked,
    toGame,
    opened,
    localStorage,
    /** The game domain's saves script says something. */
    fromGame(data: Message) {
      (listeners.message ?? []).forEach((listener) => listener({ origin: FRAME_ORIGIN, source: contentWindow, data: { type: "zaisma:saves", ...data } }));
    },
    /** The player comes back to the tab. */
    showTab() {
      (documentListeners.visibilitychange ?? []).forEach((listener) => listener());
    },
    play() {
      page.window.startSaves(frame);
    },
    told: (step: string) => toGame.filter((message) => message.type === "zaisma:saves" && message.step === step),
    events: (eventName: string) => toGame.filter((message) => message.type === "zaisma:saves-event" && message.eventName === eventName).map((message) => message.event),
  };
  return page;
}

/** A v1 save of localStorage items alone, as the account answers it. */
const envelope = (localStorageItems: Record<string, string>, indexeddbDatabases: unknown[] = []) => ({ save_format_version_number: 1 as const, local_storage_items: localStorageItems, indexeddb_databases: indexeddbDatabases });
/** That save's text, as the game domain's script sends it. */
const saveTextOf = (localStorageItems: Record<string, string>) => canonicalSave(envelope(localStorageItems));

async function cloudSave(saveData: Record<string, string>, versionNumber: number, changedByKind = "player", savedAt = new Date(Date.now() - 60_000).toISOString()) {
  return { tag: "0123456789abcdef", version_number: versionNumber, sha256: await saveHash(saveTextOf(saveData)), saved_at: savedAt, changed_by_kind: changedByKind, save_data: envelope(saveData) };
}

const copy = (id: string, copyReason: string) => ({ id, saved_at: "2026-10-18T09:00:00.000Z", copy_reason: copyReason, size_bytes: 12, is_current_save: false, version_id: null });

/** The game opens through the restore page with the account's save, and starts saving. */
async function playing(page: ReturnType<typeof loadGamePage>, saveData: Record<string, string>, versionId: string | null = null) {
  page.answer("GET", API, await cloudSave(saveData, 2));
  page.play();
  page.fromGame({ step: "hello", phase: "restore", text: saveTextOf(saveData), versionId });
  await vi.waitFor(() => expect(page.told("restore")).toHaveLength(1));
  page.fromGame({ step: "restored", ok: true });
  page.fromGame({ step: "hello", phase: "game", versionId });
  await vi.waitFor(() => expect(page.told("sync")).toHaveLength(1));
}

describe("the game page's saves script, for the game's own save screens", () => {
  it("holds a conflict until the game listens, then hands it over with the kept copy", async () => {
    const page = loadGamePage();
    page.answer("GET", API, await cloudSave({ level: "9" }, 2));
    page.answer("PUT", API, { is_kept: true, save_copy_id: "save_copy_phone" });
    page.answer("GET", `${API}/copies`, { save_copies: [copy("save_copy_phone", "device_lost"), copy("save_copy_old", "hourly")] });
    page.play();
    // This device played on too, but the account's progress was played more recently: it wins, this device's is kept.
    page.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "3" }), versionId: "version_k2v9q4x7m1p3w8r5t6y0" });
    await vi.waitFor(() => expect(page.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "9" }) }]));
    // Kept with the version the game was served from; this device never played while this page watched, so no time.
    expect(page.asked.find((each) => each.method === "PUT")!.body).toEqual({ keep: true, save_json: saveTextOf({ level: "3" }), version_id: "version_k2v9q4x7m1p3w8r5t6y0", played_at: null });
    page.fromGame({ step: "restored", ok: true });
    page.fromGame({ step: "hello", phase: "game" });
    await vi.waitFor(() => expect(page.asked.filter((each) => each.path === `${API}/copies`)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.events("conflict")).toEqual([]);
    // The game listens as it starts.
    await page.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["conflict"] });
    expect(page.events("conflict")).toEqual([{ winnerKind: "account", keptSaveCopy: { id: "save_copy_phone", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "device_lost", sizeBytes: 12, isCurrentSave: false, version_id: null } }]);
    // Once only.
    await page.window.savesRequest({ requestNumber: 2, request: "listen", eventNames: ["conflict"] });
    expect(page.events("conflict")).toHaveLength(1);
  });

  it("tells a listening game when its own progress replaced the account's", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" }, "version_k2v9q4x7m1p3w8r5t6y0");
    await page.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["conflict"] });
    // Another device saved meanwhile, but this device's progress was played just now: it replaces the account's.
    page.answer("PUT", API, { error: "Played on another device.", version_number: 3, saved_at: new Date(Date.now() - 3600_000).toISOString(), changed_by_kind: "player" }, 409);
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(page.told("sync")).toHaveLength(2));
    page.answer("PUT", API, { version_number: 4, sha256: "x", saved_at: new Date().toISOString(), kept_save_copy_id: "save_copy_laptop" });
    page.answer("GET", `${API}/copies`, { save_copies: [copy("save_copy_laptop", "account_lost")] });
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }), versionId: "version_k2v9q4x7m1p3w8r5t6y0" });
    await vi.waitFor(() => expect(page.events("conflict")).toEqual([{ winnerKind: "this_device", keptSaveCopy: expect.objectContaining({ id: "save_copy_laptop", copyReason: "account_lost" }) }]));
    // Every save names the version the game was served from.
    expect(page.asked.filter((each) => each.method === "PUT").map((each) => (each.body as { version_id: unknown }).version_id)).toEqual(["version_k2v9q4x7m1p3w8r5t6y0", "version_k2v9q4x7m1p3w8r5t6y0"]);
    expect(page.asked.filter((each) => each.method === "PUT").at(-1)!.body).toMatchObject({ base_version_number: 3, replace: true });
    expect(page.opened).toHaveLength(1);
  });

  it("puts a developer's change in place under a game that listens, and reloads one that doesn't or can't take it", async () => {
    const developerSave = await cloudSave({ level: "10" }, 3, "developer", new Date().toISOString());
    const changedByDeveloper = { error: "Played on another device.", version_number: 3, saved_at: developerSave.saved_at, changed_by_kind: "developer" };

    // Listening: no reload. The device's progress since its last save is kept, and the game hears the change.
    const page = loadGamePage();
    await playing(page, { level: "3" });
    await page.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["developerChange"] });
    page.answer("PUT", API, changedByDeveloper, 409);
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(page.asked.filter((each) => each.method === "PUT")).toHaveLength(1));
    page.answer("PUT", API, { is_kept: true, save_copy_id: "save_copy_since" });
    page.answer("GET", API, developerSave);
    page.answer("GET", `${API}/copies`, { save_copies: [copy("save_copy_since", "device_lost")] });
    await vi.waitFor(() => expect(page.told("apply")).toEqual([{ type: "zaisma:saves", step: "apply", data: envelope({ level: "10" }) }]));
    expect(page.told("pause")).toHaveLength(1);
    page.fromGame({ step: "applied", ok: true });
    await vi.waitFor(() => expect(page.events("developerChange")).toEqual([{ savedAt: developerSave.saved_at, keptSaveCopy: expect.objectContaining({ id: "save_copy_since", copyReason: "device_lost" }) }]));
    // Kept dated when this device last played it, from its played record.
    expect(page.asked.filter((each) => each.method === "PUT")[1]!.body).toEqual({ keep: true, save_json: saveTextOf({ level: "4" }), version_id: null, played_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) });
    // Saving goes on from the developer's version, and the game was never reloaded.
    expect(page.told("sync").at(-1)).toEqual({ type: "zaisma:saves", step: "sync", text: saveTextOf({ level: "10" }) });
    expect(page.opened).toHaveLength(1);
    page.answer("PUT", API, { version_number: 4, sha256: "x", saved_at: new Date().toISOString(), kept_save_copy_id: null });
    page.fromGame({ step: "save", text: saveTextOf({ level: "11" }) });
    await vi.waitFor(() => expect(page.asked.filter((each) => each.method === "PUT").at(-1)!.body).toMatchObject({ base_version_number: 3 }));

    // Not listening: today's reload, through the restore page with the account's save.
    const notListening = loadGamePage();
    await playing(notListening, { level: "3" });
    notListening.answer("PUT", API, changedByDeveloper, 409);
    notListening.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(notListening.opened).toHaveLength(2));
    expect(notListening.told("apply")).toEqual([]);
    expect(notListening.opened[1]).toContain("_zaisma/restore");

    // Listening, but the game domain couldn't put it in place (a database the game holds open): the reload.
    const cantTake = loadGamePage();
    await playing(cantTake, { level: "3" });
    await cantTake.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["developerChange"] });
    cantTake.answer("PUT", API, changedByDeveloper, 409);
    cantTake.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(cantTake.asked.filter((each) => each.method === "PUT")).toHaveLength(1));
    cantTake.answer("GET", API, developerSave);
    await vi.waitFor(() => expect(cantTake.told("apply")).toHaveLength(1));
    cantTake.fromGame({ step: "applied", ok: false });
    await vi.waitFor(() => expect(cantTake.opened).toHaveLength(2));
    expect(cantTake.events("developerChange")).toEqual([]);
  });

  it("takes a developer's change in place when the player comes back to the tab, keeping nothing", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" });
    await page.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["developerChange"] });
    const developerSave = await cloudSave({ level: "10" }, 3, "developer", new Date().toISOString());
    page.answer("GET", `${API}?version`, { version_number: 3, saved_at: developerSave.saved_at, changed_by_kind: "developer" });
    page.answer("GET", API, developerSave);
    page.showTab();
    await vi.waitFor(() => expect(page.told("apply")).toHaveLength(1));
    page.fromGame({ step: "applied", ok: true });
    await vi.waitFor(() => expect(page.events("developerChange")).toEqual([{ savedAt: developerSave.saved_at, keptSaveCopy: null }]));
    expect(page.asked.filter((each) => each.method === "PUT")).toEqual([]);
    expect(page.opened).toHaveLength(1);
  });

  it("answers the game's requests for earlier versions, and goes back to one by reloading", async () => {
    const guest = loadGamePage({ isSignedIn: false });
    guest.play();
    await guest.window.savesRequest({ requestNumber: 1, request: "list_copies" });
    expect(guest.toGame).toEqual([
      { type: "zaisma:saves-answer", requestNumber: 1, status: "asking" },
      { type: "zaisma:saves-answer", requestNumber: 1, error: { code: "account_needed", message: expect.stringMatching(/\.$/) } },
    ]);

    const page = loadGamePage();
    await playing(page, { level: "3" });
    page.answer("GET", `${API}/copies`, { save_copies: [copy("save_copy_old", "hourly")] });
    await page.window.savesRequest({ requestNumber: 1, request: "list_copies" });
    expect(page.toGame.at(-1)).toEqual({ type: "zaisma:saves-answer", requestNumber: 1, answer: [{ id: "save_copy_old", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "hourly", sizeBytes: 12, isCurrentSave: false, version_id: null }] });
    page.answer("GET", `${API}/copies/save_copy_old`, { save_copy: { ...copy("save_copy_old", "hourly"), local_storage_items: { level: "1" }, missing_keys: [], indexeddb_databases: [] } });
    await page.window.savesRequest({ requestNumber: 2, request: "get_copy", saveCopyId: "save_copy_old" });
    expect(page.toGame.at(-1)).toMatchObject({ requestNumber: 2, answer: { id: "save_copy_old", localStorageItems: { level: "1" }, indexeddbDatabases: [] } });
    await page.window.savesRequest({ requestNumber: 3, request: "get_copy", saveCopyId: "../save" });
    expect(page.toGame.at(-1)).toMatchObject({ requestNumber: 3, error: { code: "bad_save_copy_id" } });
    page.answer("GET", `${API}/copies/save_copy_gone`, { error: "no_save_copy" }, 404);
    await page.window.savesRequest({ requestNumber: 4, request: "get_copy", saveCopyId: "save_copy_gone" });
    expect(page.toGame.at(-1)).toMatchObject({ requestNumber: 4, error: { code: "no_save_copy" } });

    // Refused: saving goes on as before.
    page.answer("POST", `${API}/copies/save_copy_old/restore`, { error: "Saving too often." }, 429);
    await page.window.savesRequest({ requestNumber: 5, request: "restore_copy", saveCopyId: "save_copy_old" });
    expect(page.toGame.at(-1)).toMatchObject({ requestNumber: 5, error: { code: "slow_down" } });
    expect(page.told("sync").at(-1)).toEqual({ type: "zaisma:saves", step: "sync", text: saveTextOf({ level: "3" }) });
    expect(page.opened).toHaveLength(1);
    // Restored: the game hears so, then reloads with the account's save, which is the copy now.
    page.answer("POST", `${API}/copies/save_copy_old/restore`, { version_number: 3, sha256: "x", saved_at: new Date().toISOString(), kept_save_copy_id: "save_copy_before" });
    page.answer("GET", API, await cloudSave({ level: "1" }, 3));
    await page.window.savesRequest({ requestNumber: 6, request: "restore_copy", saveCopyId: "save_copy_old" });
    expect(page.toGame.at(-1)).toEqual({ type: "zaisma:saves-answer", requestNumber: 6, answer: null });
    expect(page.opened).toHaveLength(2);
    expect(page.opened[1]).toContain("_zaisma/restore");
    // This device's progress was the save the restore replaced: nothing more is kept.
    page.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "3" }) });
    await vi.waitFor(() => expect(page.told("restore").at(-1)).toEqual({ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "1" }) }));
    expect(page.asked.filter((each) => each.method === "PUT")).toEqual([]);
  });

  it("writes the account's save as the same v1 text as the server, and treats the empty save as nothing to keep", async () => {
    expect(SAVES_SCRIPT.sourceText).toContain(`const EMPTY_SAVE_TEXT = ${JSON.stringify(EMPTY_SAVE_TEXT)};`);
    // Keys out of order and a database: the page's text is canonicalSave's, byte for byte.
    const databases = [{ name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { $z: ["bytes", "Bw=="] }]] }] }];
    const save = envelope({ zebra: "1", apple: "2" }, databases);
    const page = loadGamePage();
    page.answer("GET", API, { ...(await cloudSave({}, 2)), sha256: await saveHash(canonicalSave(save)), save_data: save });
    page.play();
    // Nothing on this device: the account's, and nothing is kept.
    page.fromGame({ step: "hello", phase: "restore", text: EMPTY_SAVE_TEXT });
    await vi.waitFor(() => expect(page.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: save }]));
    page.fromGame({ step: "restored", ok: true });
    page.fromGame({ step: "hello", phase: "game" });
    await vi.waitFor(() => expect(page.told("sync")).toEqual([{ type: "zaisma:saves", step: "sync", text: canonicalSave(save) }]));
    expect(canonicalSave(save).startsWith('{"save_format_version_number":1,"local_storage_items":{"apple":"2","zebra":"1"},"indexeddb_databases":[')).toBe(true);
    expect(page.asked.filter((each) => each.method === "PUT")).toEqual([]);
    // A guest whose save is empty has no progress to offer to keep.
    const guest = loadGamePage({ isSignedIn: false });
    guest.play();
    guest.fromGame({ step: "save", text: EMPTY_SAVE_TEXT });
    expect(guest.elements["keep-bar"]!.hidden).toBe(true);
    guest.fromGame({ step: "save", text: saveTextOf({ level: "2" }) });
    expect(guest.elements["keep-bar"]!.hidden).toBe(false);
  });

  it("loses nothing when this device remembers a save from before v1: whichever progress wins, the other is kept", async () => {
    // Saved before v1: the played record and the marker hold the hash of the older text, which no v1 text matches.
    const legacyHash = await saveHash(JSON.stringify({ level: "3" }));
    const remembered = (playedAtMs: number) => ({
      "zaisma:played:owl-game": JSON.stringify({ sha256: legacyHash, played_at_ms: playedAtMs }),
      "zaisma:save:0123456789abcdef": JSON.stringify({ version_number: 1, sha256: legacyHash }),
    });
    const accountSavedAt = new Date(Date.now() - 3600_000).toISOString();

    // The account's progress was played more recently: it wins, and this device's is kept, dated when it was played.
    const older = Date.now() - 2 * 3600_000;
    const accountWins = loadGamePage({ localItems: remembered(older) });
    accountWins.answer("GET", API, await cloudSave({ level: "9" }, 2, "player", accountSavedAt));
    accountWins.answer("PUT", API, { is_kept: true, save_copy_id: "save_copy_phone" });
    accountWins.answer("GET", `${API}/copies`, { save_copies: [copy("save_copy_phone", "device_lost")] });
    accountWins.play();
    accountWins.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(accountWins.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "9" }) }]));
    expect(accountWins.asked.filter((each) => each.method === "PUT").map((each) => each.body)).toEqual([{ keep: true, save_json: saveTextOf({ level: "4" }), version_id: null, played_at: new Date(older).toISOString() }]);
    await accountWins.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["conflict"] });
    await vi.waitFor(() => expect(accountWins.events("conflict")).toEqual([{ winnerKind: "account", keptSaveCopy: expect.objectContaining({ id: "save_copy_phone" }) }]));

    // This device's progress was played more recently: it replaces the account's, which the account keeps.
    const deviceWins = loadGamePage({ localItems: remembered(Date.now() - 60_000) });
    deviceWins.answer("GET", API, await cloudSave({ level: "9" }, 2, "player", accountSavedAt));
    deviceWins.play();
    deviceWins.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(deviceWins.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "keep" }]));
    deviceWins.answer("PUT", API, { version_number: 3, sha256: "x", saved_at: new Date().toISOString(), kept_save_copy_id: "save_copy_account" });
    deviceWins.answer("GET", `${API}/copies`, { save_copies: [copy("save_copy_account", "account_lost")] });
    deviceWins.fromGame({ step: "hello", phase: "game" });
    await deviceWins.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["conflict"] });
    deviceWins.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(deviceWins.events("conflict")).toEqual([{ winnerKind: "this_device", keptSaveCopy: expect.objectContaining({ id: "save_copy_account" }) }]));
    expect(deviceWins.asked.filter((each) => each.method === "PUT").map((each) => each.body)).toEqual([{ base_version_number: 2, save_json: saveTextOf({ level: "4" }), version_id: null, replace: true }]);
  });

  it("shows the \"Keep your progress\" card when the game asks, at most once a visit and not for 3 days after Not now", () => {
    const offers = (page: ReturnType<typeof loadGamePage>) => page.toGame.filter((message) => message.type === "zaisma:account-offer").map((message) => message.status);
    // The automatic card is off, and the game still picks its moment.
    const page = loadGamePage({ isSignedIn: false, isAccountOfferEnabled: false });
    page.play();
    page.elements["sign-in-ask"]!.hidden = false;
    page.window.offerAccount();
    expect(offers(page)).toEqual(["asking"]);
    expect(page.elements.keep!.hidden).toBe(false);
    expect(page.elements["sign-in-ask"]!.hidden).toBe(true);
    page.window.offerAccount();
    expect(offers(page)).toEqual(["asking", "too_soon"]);
    // Not now: the game hears it, and the card stays away for 3 days, in later visits too.
    page.elements["keep-later"]!.onclick!();
    expect(offers(page)).toEqual(["asking", "too_soon", "declined"]);
    expect(page.elements.keep!.hidden).toBe(true);
    const nextVisit = loadGamePage({ isSignedIn: false, localItems: Object.fromEntries(page.localStorage.map) });
    nextVisit.play();
    nextVisit.window.offerAccount();
    expect(offers(nextVisit)).toEqual(["too_soon"]);
    expect(nextVisit.elements.keep!.hidden).toBe(true);
    const daysLater = loadGamePage({ isSignedIn: false, localItems: { "zaisma:keep:owl-game": String(Date.now() - 3 * 24 * 3600_000 - 1000) } });
    daysLater.play();
    daysLater.window.offerAccount();
    expect(offers(daysLater)).toEqual(["asking"]);
  });
});

/** The game domain's saves script on a game page, in a stand-in browser that answers for the Zaisma page. */
function loadGameFrame({ localItems = {} as Record<string, string>, indexedDB = undefined as unknown, saveLimitBytes = 5 * 1024 * 1024, versionId = null as string | null } = {}) {
  const source = readFileSync(join(import.meta.dirname, "../../packages/sdk/saves.js"), "utf8");
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const documentListeners: Record<string, (() => void)[]> = {};
  const toPage: Message[] = [];
  const parent = { postMessage: (message: Message, origin: string) => origin === SITE && toPage.push(message) };
  const localStorage = storage(localItems);
  const window = { parent, indexedDB };
  const browser = {
    __ZAISMA_SAVES__: { site: SITE, saveLimitBytes, versionId },
    window,
    parent,
    indexedDB,
    localStorage,
    location: { pathname: "/owl-game/" },
    document: { visibilityState: "visible", addEventListener: (type: string, listener: () => void) => void (documentListeners[type] ??= []).push(listener) },
    addEventListener: (type: string, listener: (event?: unknown) => void) => void (listeners[type] ??= []).push(listener),
    setInterval: () => 0,
    clearInterval() {},
  };
  new Function(...Object.keys(browser), source)(...Object.values(browser));
  return {
    localStorage,
    toPage,
    fromPage(data: Message) {
      (listeners.message ?? []).forEach((listener) => listener({ origin: SITE, source: parent, data: { type: "zaisma:saves", ...data } }));
    },
    /** The player leaves the tab: the script checks the save. */
    hide() {
      browser.document.visibilityState = "hidden";
      (documentListeners.visibilitychange ?? []).forEach((listener) => listener());
    },
    steps: (step: string) => toPage.filter((message) => message.step === step),
  };
}

describe("the game domain's saves script, past the save limit", () => {
  it("says the save is over the limit instead of sending it, and the game page keeps it on the device", async () => {
    const frame = loadGameFrame({ localItems: { world: "x".repeat(200) }, saveLimitBytes: 100 });
    frame.fromPage({ step: "sync", text: null });
    await vi.waitFor(() => expect(frame.steps("over_limit")).toHaveLength(1));
    expect(frame.steps("save")).toEqual([]);

    const page = loadGamePage();
    await playing(page, { level: "3" });
    page.fromGame({ step: "over_limit" });
    expect(page.told("pause")).toHaveLength(1);
    expect(page.elements["save-status"]!.textContent).toBe("This game's save is over 5 MB, so it stays on this device.");
    // Paused: a later save isn't sent to the account.
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.asked.filter((each) => each.method !== "GET")).toEqual([]);
  });
});

describe("the game domain's saves script, putting a save in place while the game runs", () => {
  it("writes the save and says so, and the next check has nothing to send", async () => {
    const frame = loadGameFrame({ localItems: { level: "3", coins: "10" }, versionId: "version_k2v9q4x7m1p3w8r5t6y0" });
    expect(frame.steps("hello")).toEqual([{ type: "zaisma:saves", step: "hello", phase: "game", versionId: "version_k2v9q4x7m1p3w8r5t6y0" }]);
    frame.fromPage({ step: "sync", text: saveTextOf({ level: "3", coins: "10" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frame.steps("save")).toEqual([]);
    frame.fromPage({ step: "apply", data: envelope({ level: "10" }) });
    await vi.waitFor(() => expect(frame.steps("applied")).toEqual([{ type: "zaisma:saves", step: "applied", ok: true }]));
    expect(Object.fromEntries(frame.localStorage.map)).toEqual({ level: "10" });
    frame.hide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frame.steps("save")).toEqual([]);
  });

  it("fails at once when the game holds a database open that would have to be set up again", async () => {
    // The game's database is at version 1; the save's is version 2, so it would be deleted and made again.
    const request = () => ({ onsuccess: null as null | (() => void), onerror: null, onblocked: null as null | (() => void), onupgradeneeded: null, result: null as unknown });
    const indexedDB = {
      databases: async () => [{ name: "game" }],
      open() {
        const opening = request();
        opening.result = { version: 1, objectStoreNames: [], close() {} };
        queueMicrotask(() => opening.onsuccess!());
        return opening;
      },
      deleteDatabase() {
        const deleting = request();
        queueMicrotask(() => deleting.onblocked!());
        return deleting;
      },
    };
    const frame = loadGameFrame({ localItems: { level: "3" }, indexedDB });
    frame.fromPage({ step: "apply", data: envelope({ level: "10" }, [{ name: "game", version: 2, stores: [] }]) });
    await vi.waitFor(() => expect(frame.steps("applied")).toEqual([{ type: "zaisma:saves", step: "applied", ok: false }]));
    // localStorage is left as it was.
    expect(Object.fromEntries(frame.localStorage.map)).toEqual({ level: "3" });
  });
});
