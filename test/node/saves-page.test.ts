import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pageScripts } from "../../apps/site/src/page-scripts.ts";
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

type Answer = { httpStatus?: number; body: unknown; headers?: Record<string, string> };
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
  const answer = (method: string, path: string, body: unknown, httpStatus = 200, headers: Record<string, string> = {}) => answers.unshift({ method, path, answer: { httpStatus, body, headers } });
  // Waits of 30 seconds or more (a failed save's retry) are held for the test to run; shorter ones run as usual.
  const retries: { run: () => void; delayMs: number }[] = [];
  const channels: { onmessage: null | ((event: { data: unknown }) => void) }[] = [];
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const documentListeners: Record<string, (() => void)[]> = {};
  // Its words go in its own <p> (querySelector("p")); the stand-in is its own <p>, so they land in its textContent.
  const element = () => {
    const stand = { hidden: true, textContent: "", classList: { toggle() {} }, querySelector: (): unknown => stand, focus() {}, onclick: null as null | (() => void) };
    return stand;
  };
  const elements: Record<string, ReturnType<typeof element> | { textContent: string }> = {
    "saves-data": { textContent: JSON.stringify({ api: API, root: `${FRAME_ORIGIN}/`, query: "", frameOrigin: FRAME_ORIGIN, slug: "owl-game", offerAfter: 300000, isAccountOfferEnabled }) },
    "save-status": element(),
    keep: element(),
    "keep-bar": element(),
    "keep-link": element(),
    "keep-later": element(),
    "save-line": element(),
    "signed-out": element(),
    "sign-in-ask": element(),
  };
  // The queue over the game (components/layers.ts), standing in: what was said, and cards shown and left.
  const said: Record<string, unknown>[] = [];
  const zaismaLayers = {
    // The same words while they're up are one notice, as the queue has it.
    say: (options: Record<string, unknown>) => {
      const known = said.find((each) => options.text !== undefined && each.text === options.text) ?? options;
      if (known === options) said.push(options);
      return { leave: () => void (said.includes(known) && said.splice(said.indexOf(known), 1)) };
    },
    show: (card: { hidden: boolean }) => void (card.hidden = false),
    leave: (card: { hidden: boolean }) => void (card.hidden = true),
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
      const headers = found.answer.headers ?? {};
      return { ok: (found.answer.httpStatus ?? 200) < 300, status: found.answer.httpStatus ?? 200, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, json: async () => found.answer.body };
    },
    addEventListener: (type: string, listener: (event?: unknown) => void) => void (listeners[type] ??= []).push(listener),
    BroadcastChannel: class {
      onmessage = null;
      constructor() {
        channels.push(this);
      }
    },
    setInterval: () => 0,
    setTimeout: (run: () => void, delayMs = 0) => (delayMs >= 30_000 ? `retry-${retries.push({ run, delayMs })}` : setTimeout(run, delayMs)),
  };
  // The game page's own script defines these for the saves script (pages.ts).
  Object.assign(window, { tellSignedIn: undefined, zaismaLayers });
  new Function(...Object.keys(browser), SAVES_SCRIPT.sourceText)(...Object.values(browser));
  const page = {
    elements: elements as Record<string, ReturnType<typeof element>>,
    said,
    window: window as { startSaves: (f: unknown) => void; savesRequest: (m: Message) => Promise<void>; offerAccount: () => void },
    answer,
    asked,
    toGame,
    opened,
    localStorage,
    retries,
    /** Another tab says the player signed in. */
    hearSignedIn() {
      channels.forEach((channel) => channel.onmessage?.({ data: "signed-in" }));
    },
    /** Which account the browser's cookie says is signed in: none, or one. */
    setSignedIn(isSignedIn: boolean) {
      browser.document.cookie = isSignedIn ? "zaisma_in=1" : "";
    },
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
    expect(page.asked.find((each) => each.method === "PUT")!.body).toEqual({ tag: "0123456789abcdef", keep: true, save_json: saveTextOf({ level: "3" }), version_id: "version_k2v9q4x7m1p3w8r5t6y0", played_at: null });
    page.fromGame({ step: "restored", ok: true });
    page.fromGame({ step: "hello", phase: "game" });
    await vi.waitFor(() => expect(page.asked.filter((each) => each.path === `${API}/copies`)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.events("conflict")).toEqual([]);
    // The game listens as it starts.
    await page.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["conflict"] });
    expect(page.events("conflict")).toEqual([{ winnerKind: "account", keptSaveCopy: { id: "save_copy_phone", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "device_lost", sizeBytes: 12, isCurrentSave: false, versionId: null } }]);
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
    expect(page.asked.filter((each) => each.method === "PUT")[1]!.body).toEqual({ tag: "0123456789abcdef", keep: true, save_json: saveTextOf({ level: "4" }), version_id: null, played_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) });
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
    expect(page.toGame.at(-1)).toEqual({ type: "zaisma:saves-answer", requestNumber: 1, answer: [{ id: "save_copy_old", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "hourly", sizeBytes: 12, isCurrentSave: false, versionId: null }] });
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
    expect(accountWins.asked.filter((each) => each.method === "PUT").map((each) => each.body)).toEqual([{ tag: "0123456789abcdef", keep: true, save_json: saveTextOf({ level: "4" }), version_id: null, played_at: new Date(older).toISOString() }]);
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
    expect(deviceWins.asked.filter((each) => each.method === "PUT").map((each) => each.body)).toEqual([{ tag: "0123456789abcdef", base_version_number: 2, save_json: saveTextOf({ level: "4" }), version_id: null, replace: true }]);
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

describe("the game page's saves script, keeping every promise", () => {
  const puts = (page: ReturnType<typeof loadGamePage>) => page.asked.filter((each) => each.method === "PUT").map((each) => each.body as Record<string, unknown>);
  const savedAnswer = (versionNumber: number) => ({ version_number: versionNumber, sha256: "x", saved_at: new Date().toISOString(), kept_save_copy_id: null });
  // What the queue was last told over the game, and the ⋯ menu's quiet line.
  const toast = (page: ReturnType<typeof loadGamePage>) => page.said.at(-1)?.text;
  const savedLine = (page: ReturnType<typeof loadGamePage>) => page.elements["save-line"]!.textContent;

  it("waits before sending a failed save again, longer each time and as long as Retry-After says, never in a loop", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" });
    const syncCount = page.told("sync").length;
    // Offline: the save fails, and the game isn't told to send it again at once.
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(page.retries).toHaveLength(1));
    expect(page.retries[0]!.delayMs).toBe(30_000);
    expect(page.told("sync")).toHaveLength(syncCount);
    expect(toast(page)).toBe("Couldn't save to your account. Trying again soon.");
    // A newer save meanwhile waits for the retry, which sends the newest.
    page.fromGame({ step: "save", text: saveTextOf({ level: "5" }) });
    expect(puts(page)).toHaveLength(1);
    page.answer("PUT", API, { error: "Zaisma had a problem." }, 503);
    page.retries[0]!.run();
    await vi.waitFor(() => expect(page.retries).toHaveLength(2));
    expect(puts(page).at(-1)!.save_json).toBe(saveTextOf({ level: "5" }));
    expect(page.retries[1]!.delayMs).toBe(60_000);
    page.answer("PUT", API, { error: "Saving too often." }, 429, { "retry-after": "300" });
    page.retries[1]!.run();
    await vi.waitFor(() => expect(page.retries).toHaveLength(3));
    expect(page.retries[2]!.delayMs).toBe(300_000);
    page.answer("PUT", API, savedAnswer(3));
    page.retries[2]!.run();
    await vi.waitFor(() => expect(savedLine(page)).toBe("Saved just now"));
    // Saving works again: the problem card is gone, and nothing else is said.
    expect(page.said).toEqual([]);
    expect(puts(page)).toHaveLength(4);
    expect(page.told("sync")).toHaveLength(syncCount);

    // A game that stopped saving to accounts: saving stops for the visit.
    const stopped = loadGamePage();
    await playing(stopped, { level: "3" });
    stopped.answer("PUT", API, { error: "This game doesn't save to accounts." }, 404);
    stopped.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(stopped.told("pause")).toHaveLength(1));
    expect(stopped.retries).toEqual([]);
    stopped.fromGame({ step: "save", text: saveTextOf({ level: "5" }) });
    expect(puts(stopped)).toHaveLength(1);
  });

  it("carries on when a save whose answer was lost is refused as already stored: no reload, no copy, no conflict", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" });
    await page.window.savesRequest({ requestNumber: 1, request: "listen", eventNames: ["conflict"] });
    const text = saveTextOf({ level: "4" });
    page.answer("PUT", API, { error: "Played on another device.", version_number: 3, sha256: await saveHash(text), saved_at: new Date().toISOString(), changed_by_kind: "player" }, 409);
    page.fromGame({ step: "save", text });
    await vi.waitFor(() => expect(savedLine(page)).toBe("Saved just now"));
    expect(page.told("pause")).toEqual([]);
    expect(page.opened).toHaveLength(1);
    expect(page.events("conflict")).toEqual([]);
    page.answer("PUT", API, savedAnswer(4));
    page.fromGame({ step: "save", text: saveTextOf({ level: "5" }) });
    await vi.waitFor(() => expect(puts(page)).toHaveLength(2));
    // No keep: the next save goes on from the version it adopted.
    expect(puts(page)[1]).toMatchObject({ base_version_number: 3, save_json: saveTextOf({ level: "5" }) });
  });

  it("says nothing over the game when Play opens a working account save: the ⋯ menu says when it last saved", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" });
    expect(page.said).toEqual([]);
    expect(savedLine(page)).toMatch(/^Saved /);
    page.answer("PUT", API, savedAnswer(3));
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(savedLine(page)).toBe("Saved just now"));
    expect(page.said).toEqual([]);
  });

  it("drops a save waiting behind one the account refused, keeping the newest progress instead", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" });
    page.answer("PUT", API, { error: "Played on another device.", version_number: 3, sha256: "developer", saved_at: new Date().toISOString(), changed_by_kind: "developer" }, 409);
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    page.fromGame({ step: "save", text: saveTextOf({ level: "5" }) });
    await vi.waitFor(() => expect(page.opened).toHaveLength(2));
    // The save sent, then the newest progress kept as an earlier version: the waiting save is never sent over the developer's change.
    expect(puts(page).map((body) => [body.keep === true, body.save_json])).toEqual([
      [false, saveTextOf({ level: "4" })],
      [true, saveTextOf({ level: "5" })],
    ]);
  });

  it("pauses after a refused session, and saves again once the player is signed in, reopening as whoever that is", async () => {
    const page = loadGamePage();
    await playing(page, { level: "3" });
    page.answer("PUT", API, { error: "Sign in to save to your account." }, 401);
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(page.told("pause")).toHaveLength(1));
    // Signed out is urgent: the page's own card, with Sign in, over anything.
    expect(page.said).toEqual([{ cardId: "signed-out", noticeUrgency: "urgent" }]);
    // Not signed in yet: nothing is asked.
    page.setSignedIn(false);
    page.hearSignedIn();
    expect(page.asked.filter((each) => each.path === `${API}?version`)).toEqual([]);
    page.setSignedIn(true);
    page.answer("GET", `${API}?version`, { version_number: 2, saved_at: new Date().toISOString(), changed_by_kind: "player" });
    page.answer("GET", API, await cloudSave({ level: "3" }, 2));
    page.hearSignedIn();
    await vi.waitFor(() => expect(page.opened).toHaveLength(2));
    expect(page.opened[1]).toContain("_zaisma/restore");

    // Another account signed in on this browser: the page asks at once, and reopens as that account.
    const switched = loadGamePage();
    await playing(switched, { level: "3" });
    switched.answer("PUT", API, { error: "account_changed", message: "Another account is signed in now." }, 409);
    switched.answer("GET", `${API}?version`, { version_number: 0, saved_at: null, changed_by_kind: null });
    switched.answer("GET", API, { tag: "fedcba9876543210", version_number: 0 });
    switched.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(switched.opened).toHaveLength(2));
    expect(puts(switched)).toHaveLength(1);
  });

  it("decides which progress was played most recently on Zaisma's clock, whatever the device's says", async () => {
    // This phone's clock is 10 minutes slow. The laptop saved 5 minutes ago; the phone is playing right now.
    const skewMs = 10 * 60_000;
    const zaismaClock = () => ({ date: new Date(Date.now() + skewMs).toUTCString() });
    const page = loadGamePage();
    page.answer("GET", API, await cloudSave({ level: "3" }, 2, "player", new Date(Date.now() + skewMs - 3600_000).toISOString()), 200, zaismaClock());
    page.play();
    page.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "3" }) });
    await vi.waitFor(() => expect(page.told("restore")).toHaveLength(1));
    page.fromGame({ step: "restored", ok: true });
    page.fromGame({ step: "hello", phase: "game" });
    await vi.waitFor(() => expect(page.told("sync")).toHaveLength(1));
    page.answer("PUT", API, { error: "Played on another device.", version_number: 3, sha256: "laptop", saved_at: new Date(Date.now() + skewMs - 5 * 60_000).toISOString(), changed_by_kind: "player" }, 409, zaismaClock());
    page.fromGame({ step: "save", text: saveTextOf({ level: "4" }) });
    await vi.waitFor(() => expect(page.told("sync")).toHaveLength(2));
    // The phone's progress wins: it replaces the laptop's, and the game isn't reloaded with the older progress.
    expect(page.told("sync").at(-1)).toEqual({ type: "zaisma:saves", step: "sync", text: null });
    expect(page.opened).toHaveLength(1);
  });

  it("on a shared computer, gives each account its own progress, moving another's unsynced progress aside until it's back", async () => {
    const ANNA = "aaaaaaaaaaaaaaaa";
    const BEN = "bbbbbbbbbbbbbbbb";
    const annaSynced = saveTextOf({ level: "7" });
    const benSave = { ...(await cloudSave({ level: "2" }, 9, "player", new Date(Date.now() - 3600_000).toISOString())), tag: BEN };
    const annaMarker = JSON.stringify({ version_number: 4, sha256: await saveHash(annaSynced), slug: "owl-game", marked_at_ms: Date.now() - 120_000 });
    const playedNow = JSON.stringify({ sha256: "anna-progress", played_at_ms: Date.now() - 60_000 });
    /** Ben opens the game where Anna played, the game's storage holding `text`. */
    async function benOpens(text: string, localItems: Record<string, string>) {
      const page = loadGamePage({ localItems });
      page.answer("GET", API, benSave);
      page.answer("PUT", API, { is_kept: true, save_copy_id: "save_copy_x" });
      page.play();
      page.fromGame({ step: "hello", phase: "restore", text });
      await vi.waitFor(() => expect(page.told("restore")).toHaveLength(1));
      return page;
    }

    // The game's storage is exactly Anna's synced save: Ben gets his own, and nothing of Anna's is kept on his account.
    const synced = await benOpens(annaSynced, { [`zaisma:save:${ANNA}`]: annaMarker, "zaisma:played:owl-game": playedNow });
    expect(synced.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "2" }) }]);
    expect(puts(synced)).toEqual([]);

    // Anna played on after her last sync: her progress is moved aside for her, and Ben gets his own.
    const annaUnsynced = saveTextOf({ level: "8" });
    const ben = await benOpens(annaUnsynced, { [`zaisma:save:${ANNA}`]: annaMarker, "zaisma:played:owl-game": playedNow });
    expect(ben.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "2" }) }]);
    expect(puts(ben)).toEqual([]);
    expect(JSON.parse(ben.localStorage.getItem(`zaisma:unsynced:${ANNA}`)!)).toMatchObject({ text: annaUnsynced });
    ben.fromGame({ step: "restored", ok: true });
    await vi.waitFor(() => expect(ben.localStorage.getItem(`zaisma:save:${BEN}`)).not.toBeNull());

    // Anna signs in here again: her moved-aside progress is this device's progress, and goes on from her version.
    const anna = loadGamePage({ localItems: Object.fromEntries(ben.localStorage.map) });
    anna.answer("GET", API, { ...(await cloudSave({ level: "7" }, 4, "player", new Date(Date.now() - 2 * 3600_000).toISOString())), tag: ANNA });
    anna.play();
    anna.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "2" }) });
    await vi.waitFor(() => expect(anna.told("restore")).toHaveLength(1));
    expect(anna.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "8" }) }]);
    expect(anna.localStorage.getItem(`zaisma:unsynced:${ANNA}`)).toBeNull();
    anna.fromGame({ step: "restored", ok: true });
    anna.fromGame({ step: "hello", phase: "game" });
    await vi.waitFor(() => expect(anna.told("sync")).toEqual([{ type: "zaisma:saves", step: "sync", text: null }]));
    anna.answer("PUT", API, savedAnswer(5));
    anna.fromGame({ step: "save", text: annaUnsynced });
    await vi.waitFor(() => expect(puts(anna)).toHaveLength(1));
    expect(puts(anna)[0]).toMatchObject({ tag: ANNA, base_version_number: 4, save_json: annaUnsynced });
  });

  it("opens with the account's progress when a guest with nothing in the game's storage signs in", async () => {
    const page = loadGamePage({ isSignedIn: false });
    page.play();
    page.fromGame({ step: "hello", phase: "game" });
    // The guest played, then the game's storage was emptied: that change counts as playing just now.
    const played = () => JSON.parse(page.localStorage.getItem("zaisma:played:owl-game") ?? "null");
    page.fromGame({ step: "save", text: saveTextOf({ level: "1" }) });
    await vi.waitFor(() => expect(played()).not.toBeNull());
    page.fromGame({ step: "save", text: EMPTY_SAVE_TEXT });
    await vi.waitFor(() => expect(played()).toMatchObject({ played_at_ms: expect.any(Number) }));
    page.setSignedIn(true);
    page.answer("GET", API, await cloudSave({ level: "9" }, 2));
    page.hearSignedIn();
    await vi.waitFor(() => expect(page.opened).toHaveLength(1));
    expect(page.opened[0]).toContain("_zaisma/restore");
    page.fromGame({ step: "hello", phase: "restore", text: EMPTY_SAVE_TEXT });
    await vi.waitFor(() => expect(page.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "use-cloud", data: envelope({ level: "9" }) }]));
    expect(puts(page)).toEqual([]);
  });

  it("starts saving when the account answers a version without its data", async () => {
    const page = loadGamePage();
    page.answer("GET", API, { tag: "0123456789abcdef", version_number: 3 });
    page.play();
    page.fromGame({ step: "hello", phase: "restore", text: saveTextOf({ level: "3" }) });
    await vi.waitFor(() => expect(page.told("restore")).toEqual([{ type: "zaisma:saves", step: "restore", action: "keep" }]));
    page.fromGame({ step: "hello", phase: "game" });
    await vi.waitFor(() => expect(page.told("sync")).toHaveLength(1));
    page.answer("PUT", API, savedAnswer(4));
    page.fromGame({ step: "save", text: saveTextOf({ level: "3" }) });
    await vi.waitFor(() => expect(puts(page)).toEqual([expect.objectContaining({ base_version_number: 3 })]));
  });
});

describe("the game domain's saves script, at the save limit and putting saves in place", () => {
  it("counts the limit in UTF-8 bytes, as the server does", async () => {
    // 72 characters, 132 bytes.
    const frame = loadGameFrame({ localItems: { world: "é".repeat(60) }, saveLimitBytes: 100 });
    frame.fromPage({ step: "sync", text: null });
    await vi.waitFor(() => expect(frame.steps("over_limit")).toHaveLength(1));
    expect(frame.steps("save")).toEqual([]);
  });

  it("takes a developer's change in place without reading the databases again on the game's thread", async () => {
    let listCount = 0;
    const indexedDB = { databases: async () => (listCount++, []) };
    const frame = loadGameFrame({ localItems: { level: "3" }, indexedDB });
    frame.fromPage({ step: "apply", data: envelope({ level: "10" }) });
    await vi.waitFor(() => expect(frame.steps("applied")).toEqual([{ type: "zaisma:saves", step: "applied", ok: true }]));
    // Once, to put the save in place; never again to read it back.
    expect(listCount).toBe(1);
  });
});

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
    // The Keep card isn't showing, so the word comes as a problem card over the game, which stays until it's closed.
    expect(page.said).toEqual([{ text: "This game's save is over 5 MB, so it stays on this device.", noticeUrgency: "information", tone: "problem" }]);
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

describe("the game page's answer to a game without cloud saves here", async () => {
  await import("../../apps/site/src/index.ts");
  const gameScript = pageScripts().find((script) => script.name === "game-page")!.sourceText;

  /** A stand-in for any page element or browser object the script touches but this test doesn't look at. */
  const anything = (): any =>
    new Proxy(function () {}, {
      get: (_, key) => (key === Symbol.iterator ? function* () {} : key === Symbol.toPrimitive ? () => "" : typeof key === "symbol" || key === "then" ? undefined : anything()),
      set: () => true,
      apply: () => anything(),
    });

  /** The game page's own script on a page whose game has cloud saves on or off, with Play pressed and the game's frame open. */
  function loadGameScript({ isCloudSavesEnabled, hasSavesScript }: { isCloudSavesEnabled: boolean; hasSavesScript: boolean }) {
    const told: { message: Message; origin: string }[] = [];
    const frame = { contentWindow: { postMessage: (message: Message, origin: string) => told.push({ message, origin }) }, focus() {}, set src(_address: string) {} };
    const listeners: Record<string, ((event: unknown) => void)[]> = {};
    const handedToSavesScript: Message[] = [];
    let play: (() => void) | null = null;
    const elements: Record<string, unknown> = {
      "game-page-data": { textContent: JSON.stringify({ slug: "owl-game", frame_url: `${FRAME_ORIGIN}/`, cloud_saves_enabled: isCloudSavesEnabled, devices: [], controls: [] }) },
      "game-frame": { content: { firstElementChild: { cloneNode: () => frame } } },
      play: {
        set onclick(handler: () => void) {
          play = handler;
        },
      },
    };
    const window: Record<string, unknown> = hasSavesScript
      ? { savesRequest: (request: Message) => handedToSavesScript.push(request), offerAccount: () => handedToSavesScript.push({ type: "offerAccount" }) }
      : {};
    const addEventListener = (type: string, listener: (event: unknown) => void) => void (listeners[type] ??= []).push(listener);
    // The page script reaches the window's listeners both bare and as window.addEventListener.
    window.addEventListener = addEventListener;
    const globals: Record<string, unknown> = {
      window,
      document: new Proxy({ getElementById: (id: string) => elements[id] ?? anything(), cookie: "" } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : anything()) }),
      addEventListener,
    };
    for (const name of ["location", "history", "navigator", "localStorage", "sessionStorage", "matchMedia", "scrollTo", "BroadcastChannel", "requestAnimationFrame", "IntersectionObserver", "screen", "countPlay"]) globals[name] = anything();
    // The saves script's functions are page globals, so the page script calls them by name.
    Object.assign(globals, window);
    globals.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    new Function(...Object.keys(globals), gameScript)(...Object.values(globals));
    play!();
    return {
      told,
      handedToSavesScript,
      /** The game says something to the page. */
      fromGame: (data: Message) => (listeners.message ?? []).forEach((listener) => listener({ origin: FRAME_ORIGIN, source: frame.contentWindow, data })),
    };
  }

  it("says cloud_saves_not_here when the game has cloud saves on and this page can't, and cloud_saves_off when it has them off", () => {
    for (const [isCloudSavesEnabled, code] of [[true, "cloud_saves_not_here"], [false, "cloud_saves_off"]] as const) {
      const page = loadGameScript({ isCloudSavesEnabled, hasSavesScript: false });
      page.fromGame({ type: "zaisma:saves-request", requestNumber: 4, request: "list_copies" });
      page.fromGame({ type: "zaisma:account-offer" });
      // The "listen" request gets no answer, and neither does a game that isn't asking.
      page.fromGame({ type: "zaisma:saves-request", requestNumber: 5, request: "listen", eventNames: ["conflict"] });
      expect(page.told.map((each) => each.origin)).toEqual([FRAME_ORIGIN, FRAME_ORIGIN]);
      expect(page.told[0]!.message).toMatchObject({ type: "zaisma:saves-answer", requestNumber: 4, error: { code } });
      expect(page.told[1]!.message).toEqual({ type: "zaisma:account-offer", status: code });
    }
  });

  it("leaves both to the saves script when the page has one", () => {
    const page = loadGameScript({ isCloudSavesEnabled: true, hasSavesScript: true });
    page.fromGame({ type: "zaisma:saves-request", requestNumber: 4, request: "list_copies" });
    page.fromGame({ type: "zaisma:account-offer" });
    expect(page.told).toEqual([]);
    expect(page.handedToSavesScript).toEqual([{ type: "zaisma:saves-request", requestNumber: 4, request: "list_copies" }, { type: "offerAccount" }]);
  });
});
