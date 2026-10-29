import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { SAVE_COPY_REASONS } from "../../packages/core/src/saves.ts";
import { CORE_ROOMS, CORE_TYPES, declaredType, fieldsOf, GAME_SERVER, GAME_SERVER_REQUESTS, joinedRoom, loadSdk, me, membersOf, ON_ZAISMA, say, sdkTypeChecker, sdkTypeProgram, settings, type StandInSocket, TEXT_FILTER, TYPES, valuesOf } from "../sdk-stand-in.ts";

/**
 * packages/sdk/zaisma.d.ts is the SDK's reference, so it has to say exactly what zaisma.js does. The SDK
 * runs here in a stand-in browser: what it refuses lists what it takes, and what it hands out has its
 * fields, and both are compared with the types. The shapes rooms send are compared with the game
 * server's and the rooms Worker's own types.
 */

const ROOT = join(import.meta.dirname, "../..");
const SDK = readFileSync(join(ROOT, "packages/sdk/zaisma.js"), "utf8");
const ROOMS_WORKER = join(ROOT, "apps/rooms/src/index.ts");
const checker = sdkTypeChecker();

/** The values of a union of string literals a file declares but doesn't export, read from its source alone. */
function valuesInSource(file: string, name: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022);
  const alias = source.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  if (!alias || !ts.isUnionTypeNode(alias.type)) throw new Error(`${file} declares no union ${name}`);
  return alias.type.types.map((part) => ((part as ts.LiteralTypeNode).literal as ts.StringLiteral).text).sort();
}

/** The names a refusal lists after "It takes:" or "Rooms have:", sorted. */
function listed(error: unknown): string[] {
  const message = (error as Error).message;
  const list = message.match(/(?:It takes|Rooms have|Zaisma\.saves has|Zaisma\.items has): (.*)\.$/);
  if (!list) throw new Error(`Not a refusal that lists names: ${message}`);
  return list[1]!.split(", ").sort();
}

/** The code a call fails with. Its message is one sentence. */
async function failureCode(call: () => unknown): Promise<string> {
  try {
    await call();
  } catch (error) {
    expect((error as Error).message).toMatch(/^[^\n]+\.$/);
    return (error as { code: string }).code;
  }
  throw new Error("The SDK took it");
}

async function refusal(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    expect((error as { code: string }).code).toMatch(/^unknown_(option|event)$/);
    return error;
  }
  throw new Error("The SDK took it");
}

/** What a listener gets the next time the test makes the room send something. */
function heard(room: { on: (event: string, listener: (value: unknown) => void) => void }, event: string, send: () => void): Record<string, unknown> {
  let value: unknown;
  room.on(event, (given) => (value = given));
  send();
  if (value === undefined) throw new Error(`No "${event}" event`);
  return value as Record<string, unknown>;
}

describe("the SDK's types say what the SDK does", () => {
  it("compile on their own", () => {
    const program = sdkTypeProgram();
    const source = program.getSourceFile(TYPES)!;
    const problems = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(problems).toEqual([]);
  });

  it("every call and field on Zaisma and Zaisma.rooms", () => {
    const { Zaisma } = loadSdk();
    const values = membersOf(TYPES)
      .filter((member) => member.flags & ts.SymbolFlags.Value)
      .map((member) => member.name)
      .sort();
    expect(Object.keys(Zaisma).sort()).toEqual(values);
    expect(Object.keys(Zaisma.rooms).sort()).toEqual(fieldsOf("Rooms"));
    expect(Object.keys(Zaisma.server).sort()).toEqual(fieldsOf("Server"));
    expect(Object.keys(Zaisma.links).sort()).toEqual(fieldsOf("Links"));
    expect(Object.keys(Zaisma.items).sort()).toEqual(fieldsOf("Items"));
    expect(Object.keys(Zaisma.friends).sort()).toEqual(fieldsOf("Friends"));
    expect(Object.keys(Zaisma.saves).sort()).toEqual(fieldsOf("Saves"));
    // Zaisma.player is a plain object of calls, not a call itself.
    const player = membersOf(TYPES).find((member) => member.name === "player")!;
    expect(typeof Zaisma.player).toBe("object");
    expect(Object.keys(Zaisma.player).sort()).toEqual(checker.getPropertiesOfType(checker.getTypeOfSymbol(player)).map((property) => property.name).sort());
    expect(Zaisma.filterText).toBeUndefined();
    expect(Zaisma.openSafetyPanel).toBeUndefined();
  });

  it("the options each call takes", async () => {
    const sdk = loadSdk();
    const wrong = { notAnOption: true };
    expect(listed(await refusal(() => sdk.Zaisma.joinRoom(wrong)))).toEqual(fieldsOf("JoinOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.rooms.quickJoin(wrong)))).toEqual(fieldsOf("QuickJoinOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.rooms.list(wrong)))).toEqual(fieldsOf("ListOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.server.request({ type: "leaderboard" }, wrong)))).toEqual(fieldsOf("RequestOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.links.open("store", wrong)))).toEqual(fieldsOf("LinkOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.items.buy("revive", wrong)))).toEqual(fieldsOf("BuyOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.items.on("notAnEvent", () => {})))).toEqual(fieldsOf("ItemsEvents"));
    expect(listed(await refusal(() => sdk.Zaisma.friends.setRoom(wrong)))).toEqual(fieldsOf("OwnServerRoom"));
    const { room, socket } = await joinedRoom(sdk);
    expect(listed(await refusal(() => room.kick("player_bo", wrong)))).toEqual(fieldsOf("KickOptions"));
    expect(listed(await refusal(() => room.setInfo(wrong)))).toEqual(fieldsOf("RoomInfo"));
    expect(listed(await refusal(() => room.send({}, wrong)))).toEqual(fieldsOf("SendOptions"));
    expect(listed(await refusal(() => room.sendBytes(new Uint8Array([1]), wrong)))).toEqual(fieldsOf("SendOptions"));
    const move = heard(room, "move", () => say(socket, { type: "move", roomCode: "M2X7Q3" }));
    expect(listed(await refusal(() => (move.join as (options: unknown) => Promise<unknown>)(wrong)))).toEqual(fieldsOf("MoveJoinOptions"));
  });

  it("hears when Zaisma will end a match past the month's free tier", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    expect(room.endsAt).toBeNull();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(heard(room, "ending", () => say(socket, { type: "ending", endsAt }))).toEqual({ endsAt });
    expect(room.endsAt).toBe(endsAt);
  });

  it("a room's events, fields and calls", async () => {
    const sdk = loadSdk();
    const { room } = await joinedRoom(sdk);
    expect(listed(await refusal(() => room.on("notAnEvent", () => {})))).toEqual(fieldsOf("RoomEvents"));
    const shown: string[] = [];
    for (const name in room) if (!name.startsWith("_")) shown.push(name);
    expect(shown.sort()).toEqual(fieldsOf("Room"));
    expect(Object.keys(room.me).sort()).toEqual(fieldsOf("Player"));
  });

  it("what each event hands the game", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const fields = (value: Record<string, unknown>) => Object.keys(value).sort();
    expect(fields(heard(room, "move", () => say(socket, { type: "move", roomCode: "M2X7Q3" })))).toEqual(fieldsOf("Move"));
    expect(fields(heard(room, "settings", () => say(socket, { type: "room", room: settings })))).toEqual(fieldsOf("RoomSettingsChange"));
    expect(fields(heard(room, "error", () => say(socket, { type: "error", code: "too_fast", message: "Slow down." })))).toEqual(fieldsOf("RoomError"));
    expect(fields(heard(room, "away", () => say(socket, { type: "away", awayReason: "idle", seatHoldDurationSec: 300 })))).toEqual(fieldsOf("Away"));
    // The player list, as rooms send it: each player with why they aren't playing, the same in room.players.
    const listedPlayers = [{ ...me, awayReason: null }, { id: "player_bo", name: "Bo", kind: "account", awayReason: "lost" }];
    const players = heard(room, "players", () => say(socket, { type: "players", players: listedPlayers, hostPlayerId: null })) as unknown as Record<string, unknown>[];
    expect(players.map(fields)).toEqual([fieldsOf("ListedPlayer"), fieldsOf("ListedPlayer")]);
    expect(room.players).toEqual(listedPlayers);
    // The held seat runs out, then the player presses a key.
    const back = heard(room, "back", () => {
      socket.onclose!({ code: 4002, reason: "" });
      sdk.listeners.keydown![0]!();
    });
    expect(fields(back)).toEqual(fieldsOf("Back"));
    const { room: other, socket: otherSocket } = await joinedRoom(sdk);
    expect(fields(heard(other, "kicked", () => say(otherSocket, { type: "kicked", message: "Removed by the host.", isKeptOut: true })))).toEqual(fieldsOf("Kicked"));
  });

  it("every error the SDK throws has a code from ErrorCode", async () => {
    const codes = valuesOf("ErrorCode");
    // Errors come from codedError alone, with the SDK's own codes and the ones rooms answer with.
    expect(SDK.match(/new Error\(/g)).toHaveLength(1);
    const given = [...SDK.matchAll(/codedError\("([a-z_]+)"/g)].map((match) => match[1]!);
    expect(given.filter((code) => !codes.includes(code))).toEqual([]);
    expect(valuesInSource(ROOMS_WORKER, "CallErrorCode").filter((code) => !codes.includes(code))).toEqual([]);

    // A game hosted somewhere else.
    const elsewhere = loadSdk(null);
    expect(await failureCode(() => elsewhere.Zaisma.player.getPass())).toBe("not_on_zaisma");
    expect(await failureCode(() => elsewhere.Zaisma.joinRoom())).toBe("not_on_zaisma");
    expect(await failureCode(() => elsewhere.Zaisma.rooms.list())).toBe("not_on_zaisma");
    expect(await failureCode(() => elsewhere.Zaisma.server.request({ type: "leaderboard" }))).toBe("not_on_zaisma");

    const sdk = loadSdk();
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ roomCode: "K7Q2MO" }))).toBe("bad_room_code");
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ serverUrl: "play.example.com" }))).toBe("bad_server_url");
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ serverUrl: "wss://play.example.com", transport: "udp" }))).toBe("bad_transport");
    expect(await failureCode(() => sdk.Zaisma.server.request({ type: "leaderboard" }, { serverUrl: "play.example.com" }))).toBe("bad_server_url");
    expect(await failureCode(() => sdk.Zaisma.server.request({ type: "buy", coinCount: BigInt(10) }))).toBe("bad_request");
    expect(await failureCode(() => sdk.Zaisma.server.request({ type: "save", text: "x".repeat(17 * 1024) }))).toBe("too_big");
    // The match ends before the room lets the player in.
    const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    sdk.sockets.at(-1)!.onclose!({ code: 4000, reason: "Match ended" });
    expect(await failureCode(() => joining)).toBe("connection_closed");
    // No connection, then answers that aren't Zaisma's, then one that is.
    expect(await failureCode(() => sdk.Zaisma.rooms.list())).toBe("request_failed");
    const answering = (answer: () => Promise<unknown>) => loadSdk(ON_ZAISMA, () => Promise.resolve({ ok: false, json: answer })).Zaisma;
    expect(await failureCode(() => answering(() => Promise.reject(new SyntaxError("Unexpected token '<'"))).rooms.list())).toBe("request_failed");
    expect(await failureCode(() => answering(() => Promise.resolve({})).rooms.list())).toBe("request_failed");
    expect(await failureCode(() => answering(() => Promise.resolve({ error: { code: "slow_down", message: "Too many calls. Try again in a minute." } })).rooms.list())).toBe("slow_down");
    // Profiles: only player IDs are looked up, and a guest's has none.
    expect(await failureCode(() => sdk.Zaisma.player.getProfile("Ana"))).toBe("bad_player_id");
    expect(await failureCode(() => answering(() => Promise.resolve({ error: { code: "no_player", message: "No account has that player ID." } })).player.getProfile("player_gone"))).toBe("no_player");
    expect(await failureCode(() => elsewhere.Zaisma.player.getProfile("player_ana"))).toBe("not_on_zaisma");
    // Sending and smoothing take only what they say.
    const { room } = await joinedRoom(sdk);
    expect(await failureCode(() => room.send({}, { delivery: "lossy" }))).toBe("bad_send_option");
    expect(await failureCode(() => room.sendBytes(new Uint8Array([1]), { latestKey: "x".repeat(41) }))).toBe("bad_send_option");
    expect(await failureCode(() => room.smoothedState({ delayMs: -5 }))).toBe("bad_delay");
    expect(await failureCode(() => room.smoothedState({ delayMs: "100" }))).toBe("bad_delay");
    expect(await failureCode(() => room.smoothedState(100))).toBe("unknown_option");
  });

  it("keeps a guest's pass for the tab, and gives an account a new one with each page's key", async () => {
    const asked: { url: string; body: string }[] = [];
    const passAnswer = { pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" };
    const fetchAnswer = ((url: string, init: { body: string }) => {
      asked.push({ url, body: init.body });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(passAnswer) });
    }) as () => Promise<unknown>;
    // Still a guest: the kept guest pass, with no call.
    expect(await loadSdk(ON_ZAISMA, fetchAnswer).Zaisma.player.getPass()).toEqual({ ...me, pass: "pass", expiresAt: "2099-01-01T00:00:00Z" });
    expect(asked).toEqual([]);
    // Signed in since: a new pass, for the account, with the page's key.
    const signedIn = await loadSdk(ON_ZAISMA, fetchAnswer, "account").Zaisma.player.getPass();
    expect(signedIn).toEqual({ ...passAnswer.player, pass: "account-pass", expiresAt: passAnswer.expiresAt });
    expect(Object.keys(signedIn).sort()).toEqual(fieldsOf("PlayerWithPass"));
    expect(asked).toEqual([{ url: "https://rooms.zaisma.test/v1/pass", body: JSON.stringify({ gameSlug: "test-game", roomKey: "room_key_test" }) }]);
    // A tab that kept another account's pass (the player signed in as someone else in another window): the page's key is for
    // whoever is signed in now, so the game plays as them, never as the account the tab had before.
    const switched = await loadSdk(ON_ZAISMA, fetchAnswer, "account", "", { id: "player_owl", name: "Chat_Owl", kind: "account" }).Zaisma.player.getPass();
    expect(switched.id).toBe("player_cy");
    expect(asked).toHaveLength(2);
  });

  it("asks the page to sign a guest in, then gives the account's pass", async () => {
    const passAnswer = { pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" };
    const sdk = loadSdk(ON_ZAISMA, () => Promise.resolve({ ok: true, json: () => Promise.resolve(passAnswer) }));
    expect((await sdk.Zaisma.player.getPass()).kind).toBe("guest");
    const asking = sdk.Zaisma.player.signIn();
    // A second call while the page is asking waits for the same answer.
    expect(sdk.Zaisma.player.signIn()).toBe(asking);
    expect(sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:sign-in")).toEqual([{ type: "zaisma:sign-in" }]);
    sdk.page.say({ type: "zaisma:sign-in", status: "asking" });
    // Signed in: the page's key is the account's from now on.
    sdk.page.playerKind = "account";
    sdk.page.say({ type: "zaisma:signed-in", player: passAnswer.player });
    const signedIn = await asking;
    expect(signedIn).toEqual(passAnswer.player);
    expect(Object.keys(signedIn).sort()).toEqual(fieldsOf("Player"));
    expect(await sdk.Zaisma.player.getPass()).toEqual({ ...passAnswer.player, pass: "account-pass", expiresAt: passAnswer.expiresAt });

    // Not now.
    const declined = sdk.Zaisma.player.signIn();
    sdk.page.say({ type: "zaisma:sign-in", status: "asking" });
    sdk.page.say({ type: "zaisma:sign-in", status: "declined" });
    expect(await failureCode(() => declined)).toBe("sign_in_declined");
    // A game opened anywhere but its Zaisma page.
    expect(await failureCode(() => loadSdk(null).Zaisma.player.signIn())).toBe("not_on_zaisma");
  });

  it("asks the page for the player's earlier versions, and hands them out as SaveCopy says", async () => {
    const sdk = loadSdk();
    const savesMessages = () => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:saves-request");
    const pageCopy = { id: "save_copy_k2v9q4x7m1p3w8r5t6y0", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "account_lost", sizeBytes: 120, isCurrentSave: false, versionId: "version_k2v9q4x7m1p3w8r5t6y0" };
    const gameCopy = pageCopy;
    const listing = sdk.Zaisma.saves.listCopies();
    expect(savesMessages()).toEqual([{ type: "zaisma:saves-request", requestNumber: 1, request: "list_copies", saveCopyId: undefined }]);
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 1, status: "asking" });
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 1, answer: [{ ...pageCopy, extra: "not handed out" }] });
    const copies = await listing;
    expect(copies).toEqual({ saveCopies: [gameCopy] });
    expect(Object.keys(copies).sort()).toEqual(fieldsOf("SaveCopyList"));
    expect(Object.keys(copies.saveCopies[0]).sort()).toEqual(fieldsOf("SaveCopy"));
    expect(valuesOf("SaveCopyReason")).toEqual([...SAVE_COPY_REASONS].sort());

    const reading = sdk.Zaisma.saves.getCopy(pageCopy.id);
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 2, answer: { ...pageCopy, localStorageItems: { level: "7" }, indexeddbDatabases: [] } });
    const contents = await reading;
    expect(contents.localStorageItems).toEqual({ level: "7" });
    expect(contents.versionId).toBe(pageCopy.versionId);
    expect(Object.keys(contents).sort()).toEqual(fieldsOf("SaveCopyContents"));

    const restoring = sdk.Zaisma.saves.restoreCopy(pageCopy.id);
    expect(savesMessages().at(-1)).toEqual({ type: "zaisma:saves-request", requestNumber: 3, request: "restore_copy", saveCopyId: pageCopy.id });
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 3, answer: null });
    expect(await restoring).toBeUndefined();

    // What the page refuses comes back with its code; a code that isn't one of its own is request_failed.
    for (const code of ["account_needed", "no_save_copy", "cloud_saves_off", "cloud_saves_not_here", "slow_down", "bad_save_copy_id"]) {
      const asking = sdk.Zaisma.saves.listCopies();
      sdk.page.say({ type: "zaisma:saves-answer", requestNumber: (savesMessages().at(-1) as { requestNumber: number }).requestNumber, error: { code, message: "The page says no." } });
      expect(await failureCode(() => asking)).toBe(code);
      expect(valuesOf("ErrorCode")).toContain(code);
    }
    const odd = sdk.Zaisma.saves.listCopies();
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: (savesMessages().at(-1) as { requestNumber: number }).requestNumber, error: { code: "not_a_code", message: "Something." } });
    expect(await failureCode(() => odd)).toBe("request_failed");

    // A copy ID that isn't one never reaches the page.
    const before = savesMessages().length;
    expect(await failureCode(() => sdk.Zaisma.saves.getCopy("nope"))).toBe("bad_save_copy_id");
    expect(await failureCode(() => sdk.Zaisma.saves.restoreCopy(42))).toBe("bad_save_copy_id");
    expect(savesMessages()).toHaveLength(before);
    // Not on Zaisma, and no page answering.
    expect(await failureCode(() => loadSdk(null).Zaisma.saves.listCopies())).toBe("not_on_zaisma");
    vi.useFakeTimers();
    try {
      const unanswered = sdk.Zaisma.saves.listCopies();
      vi.advanceTimersByTime(3000);
      expect(await failureCode(() => unanswered)).toBe("not_on_zaisma");
      // A page that said it's asking can take longer than that.
      const slow = sdk.Zaisma.saves.listCopies();
      const slowNumber = (savesMessages().at(-1) as { requestNumber: number }).requestNumber;
      sdk.page.say({ type: "zaisma:saves-answer", requestNumber: slowNumber, status: "asking" });
      vi.advanceTimersByTime(10000);
      sdk.page.say({ type: "zaisma:saves-answer", requestNumber: slowNumber, answer: [] });
      expect(await slow).toEqual({ saveCopies: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("listens for the saves events through the page, and hands them out as the types say", async () => {
    const sdk = loadSdk();
    expect(listed(await refusal(() => sdk.Zaisma.saves.on("notAnEvent", () => {})))).toEqual(fieldsOf("SavesEvents"));
    const listens = () => sdk.page.posted.filter((message) => (message as { request?: string }).request === "listen");
    const pageCopy = { id: "save_copy_k2v9q4x7m1p3w8r5t6y0", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "device_lost", sizeBytes: 80, isCurrentSave: false, versionId: null };
    const gameCopy = { ...pageCopy };
    const conflicts: Record<string, unknown>[] = [];
    const listener = (conflict: Record<string, unknown>) => conflicts.push(conflict);
    expect(sdk.Zaisma.saves.on("conflict", listener)).toBe(sdk.Zaisma.saves);
    sdk.Zaisma.saves.on("conflict", () => {});
    // The page hears once per event.
    expect(listens()).toEqual([{ type: "zaisma:saves-request", requestNumber: 1, request: "listen", eventNames: ["conflict"] }]);
    sdk.page.say({ type: "zaisma:saves-event", eventName: "conflict", event: { winnerKind: "account", keptSaveCopy: pageCopy } });
    expect(conflicts).toEqual([{ winnerKind: "account", keptSaveCopy: gameCopy }]);
    expect(Object.keys(conflicts[0]!).sort()).toEqual(fieldsOf("SaveConflict"));
    sdk.Zaisma.saves.off("conflict", listener);
    sdk.page.say({ type: "zaisma:saves-event", eventName: "conflict", event: { winnerKind: "this_device", keptSaveCopy: pageCopy } });
    expect(conflicts).toHaveLength(1);

    const changes: Record<string, unknown>[] = [];
    sdk.Zaisma.saves.on("developerChange", (change: Record<string, unknown>) => changes.push(change));
    expect(listens().at(-1)).toMatchObject({ request: "listen", eventNames: ["developerChange"] });
    sdk.page.say({ type: "zaisma:saves-event", eventName: "developerChange", event: { savedAt: "2026-10-18T09:05:00.000Z", keptSaveCopy: null } });
    sdk.page.say({ type: "zaisma:saves-event", eventName: "developerChange", event: { savedAt: "2026-10-18T09:06:00.000Z", keptSaveCopy: pageCopy } });
    expect(changes).toEqual([{ savedAt: "2026-10-18T09:05:00.000Z", keptSaveCopy: null }, { savedAt: "2026-10-18T09:06:00.000Z", keptSaveCopy: gameCopy }]);
    expect(Object.keys(changes[0]!).sort()).toEqual(fieldsOf("DeveloperChange"));
    // Off Zaisma there's no page to tell.
    const elsewhere = loadSdk(null);
    elsewhere.Zaisma.saves.on("conflict", () => {});
    expect(elsewhere.page.posted).toEqual([]);
  });

  it("asks the page for the \"Keep your progress\" card, and hears the account, Not now or too soon", async () => {
    const sdk = loadSdk();
    const offering = sdk.Zaisma.player.offerAccount();
    expect(sdk.Zaisma.player.offerAccount()).toBe(offering);
    expect(sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:account-offer")).toEqual([{ type: "zaisma:account-offer" }]);
    sdk.page.say({ type: "zaisma:account-offer", status: "asking" });
    sdk.page.say({ type: "zaisma:signed-in", player: { id: "player_cy", name: "Cy", kind: "account" } });
    const account = await offering;
    expect(account).toEqual({ id: "player_cy", name: "Cy", kind: "account" });
    expect(Object.keys(account).sort()).toEqual(fieldsOf("Player"));
    for (const [status, code] of [["declined", "sign_in_declined"], ["too_soon", "account_offer_too_soon"], ["cloud_saves_off", "cloud_saves_off"], ["cloud_saves_not_here", "cloud_saves_not_here"]]) {
      const asking = sdk.Zaisma.player.offerAccount();
      sdk.page.say({ type: "zaisma:account-offer", status });
      expect(await failureCode(() => asking)).toBe(code);
      expect(valuesOf("ErrorCode")).toContain(code);
    }
    // A sign-in card's answer isn't the account card's.
    const waiting = sdk.Zaisma.player.offerAccount();
    sdk.page.say({ type: "zaisma:sign-in", status: "declined" });
    sdk.page.say({ type: "zaisma:account-offer", status: "too_soon" });
    expect(await failureCode(() => waiting)).toBe("account_offer_too_soon");
    expect(await failureCode(() => loadSdk(null).Zaisma.player.offerAccount())).toBe("not_on_zaisma");
  });

  it("asks the page to open a registered link, and hears opened or stayed", async () => {
    const sdk = loadSdk();
    const linkMessages = () => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:link") as { requestNumber: number }[];
    const opening = sdk.Zaisma.links.open("store", { path: "/buy", queryParameters: { item: "sword" } });
    expect(linkMessages()).toEqual([{ type: "zaisma:link", requestNumber: 1, linkName: "store", path: "/buy", queryParameters: { item: "sword" } }]);
    sdk.page.say({ type: "zaisma:link", requestNumber: 1, status: "asking" });
    // An answer for another request isn't this one's.
    sdk.page.say({ type: "zaisma:link", requestNumber: 7, status: "stayed" });
    sdk.page.say({ type: "zaisma:link", requestNumber: 1, status: "opened" });
    const linkStatus = await opening;
    expect(linkStatus).toBe("opened");
    expect(valuesOf("LinkStatus")).toEqual(["opened", "stayed"]);
    const staying = sdk.Zaisma.links.open("discord");
    sdk.page.say({ type: "zaisma:link", requestNumber: 2, status: "asking" });
    sdk.page.say({ type: "zaisma:link", requestNumber: 2, status: "stayed" });
    expect(await staying).toBe("stayed");
    // What the page says the game got wrong comes back with its code; anything else is request_failed.
    const unknown = sdk.Zaisma.links.open("patreon");
    sdk.page.say({ type: "zaisma:link", requestNumber: 3, status: "error", code: "unknown_link", message: "Sky Hopper has no link named patreon." });
    expect(await failureCode(() => unknown)).toBe("unknown_link");
    const odd = sdk.Zaisma.links.open("store");
    sdk.page.say({ type: "zaisma:link", requestNumber: 4, status: "error", code: "not_a_code", message: "Something." });
    expect(await failureCode(() => odd)).toBe("request_failed");
  });

  it("opens a link only right after the player's tap, and checks what the game adds", async () => {
    const sdk = loadSdk();
    expect(await failureCode(() => sdk.Zaisma.links.open("Store Page"))).toBe("unknown_link");
    expect(await failureCode(() => sdk.Zaisma.links.open("store", { path: "buy" }))).toBe("bad_link_path");
    expect(await failureCode(() => sdk.Zaisma.links.open("store", { path: "/../other" }))).toBe("bad_link_path");
    expect(await failureCode(() => sdk.Zaisma.links.open("store", { path: "/buy?item=sword" }))).toBe("bad_link_path");
    expect(await failureCode(() => sdk.Zaisma.links.open("store", { queryParameters: { count: 3 } }))).toBe("bad_link_query");
    expect(await failureCode(() => sdk.Zaisma.links.open("store", { ownSiteUrl: "kit.itch.io" }))).toBe("bad_own_site_url");
    sdk.navigator.userActivation = { isActive: false };
    expect(await failureCode(() => sdk.Zaisma.links.open("store"))).toBe("needs_player_tap");
    expect(sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:link")).toEqual([]);
  });

  it("asks the page for the buy sheet, hears it open and close, and gets a fresh pass after a buy", async () => {
    const sdk = loadSdk();
    const buyMessages = () => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:buy");
    const sheets: string[] = [];
    sdk.Zaisma.items.on("sheetOpen", (sheet: { itemName: string }) => sheets.push(`open ${sheet.itemName}`));
    sdk.Zaisma.items.on("sheetClose", (sheet: { itemName: string }) => sheets.push(`close ${sheet.itemName}`));
    const buying = sdk.Zaisma.items.buy("revive", { itemCount: 3, gameAccountId: "farmer-42" });
    expect(buyMessages()).toEqual([{ type: "zaisma:buy", requestNumber: 1, itemName: "revive", itemCount: 3, gameAccountId: "farmer-42" }]);
    sdk.page.say({ type: "zaisma:buy", requestNumber: 1, status: "open" });
    // An answer for another request isn't this one's.
    sdk.page.say({ type: "zaisma:buy", requestNumber: 9, status: "cancelled" });
    // The sheet sends the API's snake_case purchase; the game gets the camelCase Purchase the purchase event has.
    const purchase = { id: "purchase_k2m9x4w7q1z8c3v5b6n0", item_name: "revive", item_kind: "consumable", item_count: 3, purchase_source: "sale", purchase_status: "completed", game_account_id: "farmer-42", paid_minor_units: 297, currency_code: "eur", purchased_at: "2026-10-24T12:00:00.000Z", refunded_at: null, receipt: "receipt.signed" };
    sdk.page.say({ type: "zaisma:buy", requestNumber: 1, status: "bought", purchase });
    const bought = await buying;
    expect(bought).toEqual({
      status: "bought",
      purchase: { id: purchase.id, itemName: "revive", itemKind: "consumable", itemCount: 3, purchaseSource: "sale", purchaseStatus: "completed", gameAccountId: "farmer-42", paidMinorUnits: 297, currencyCode: "eur", purchasedAt: "2026-10-24T12:00:00.000Z", refundedAt: null, receipt: "receipt.signed" },
    });
    expect(Object.keys(bought).sort()).toEqual(fieldsOf("BuyResult"));
    expect(sheets).toEqual(["open revive", "close revive"]);
    const cancelling = sdk.Zaisma.items.buy("skin_red-dragon");
    sdk.page.say({ type: "zaisma:buy", requestNumber: 2, status: "open" });
    sdk.page.say({ type: "zaisma:buy", requestNumber: 2, status: "cancelled" });
    expect(await cancelling).toEqual({ status: "cancelled", purchase: null });
    // A payment still settling when the sheet closed is failed, with the purchase that has no receipt yet.
    const settling = sdk.Zaisma.items.buy("revive");
    sdk.page.say({ type: "zaisma:buy", requestNumber: 3, status: "open" });
    sdk.page.say({ type: "zaisma:buy", requestNumber: 3, status: "failed", purchase: { id: purchase.id, item_name: "revive", item_kind: "consumable", item_count: 1, purchase_source: "sale", purchase_status: "pending", game_account_id: null, paid_minor_units: null, currency_code: "eur", purchased_at: null, refunded_at: null, receipt: null } });
    expect(await settling).toMatchObject({ status: "failed", purchase: { id: purchase.id, itemName: "revive", purchaseStatus: "pending", receipt: "" } });
    // A developer's mistake rejects with its code; anything else the page says is request_failed.
    const unsold = sdk.Zaisma.items.buy("free_hat");
    sdk.page.say({ type: "zaisma:buy", requestNumber: 4, status: "error", code: "not_for_sale", message: "Free Hat can't be bought: it has no price." });
    expect(await failureCode(() => unsold)).toBe("not_for_sale");
    // The server's fix rides in the message, as the SDK's errors all say what to fix.
    const unpaid = sdk.Zaisma.items.buy("revive");
    sdk.page.say({ type: "zaisma:buy", requestNumber: 5, status: "error", code: "stripe_cannot_take_payments", message: "Stripe hasn't turned on payments yet.", fix: "Finish setting up on Stripe's dashboard." });
    await expect(unpaid).rejects.toMatchObject({ code: "stripe_cannot_take_payments", message: "Stripe hasn't turned on payments yet. Finish setting up on Stripe's dashboard." });
    expect(valuesOf("ErrorCode")).toEqual(expect.arrayContaining(["not_for_sale", "no_game", "bad_item_name"]));
    const odd = sdk.Zaisma.items.buy("revive");
    sdk.page.say({ type: "zaisma:buy", requestNumber: 6, status: "error", code: "not_a_code", message: "Something." });
    expect(await failureCode(() => odd)).toBe("request_failed");
  });

  it("opens the buy sheet only right after the player's tap, and checks what the game sends", async () => {
    const sdk = loadSdk();
    expect(await failureCode(() => sdk.Zaisma.items.buy(""))).toBe("bad_item_name");
    expect(await failureCode(() => sdk.Zaisma.items.buy("revive", { itemCount: 1.5 }))).toBe("bad_item_count");
    expect(await failureCode(() => sdk.Zaisma.items.buy("revive", { gameAccountId: 42 as unknown as string }))).toBe("bad_game_account_id");
    sdk.navigator.userActivation = { isActive: false };
    expect(await failureCode(() => sdk.Zaisma.items.buy("revive"))).toBe("needs_player_tap");
    expect(sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:buy")).toEqual([]);
  });

  it("on the developer's own site, opens ownSiteUrl straight away", async () => {
    const elsewhere = loadSdk(null);
    expect(await failureCode(() => elsewhere.Zaisma.links.open("store"))).toBe("not_on_zaisma");
    const opened: string[] = [];
    elsewhere.window.open = (url: string) => (opened.push(url), {});
    expect(await elsewhere.Zaisma.links.open("store", { ownSiteUrl: "https://kit.itch.io/sky-hopper/", path: "/buy", queryParameters: { item: "sword" } })).toBe("opened");
    expect(opened).toEqual(["https://kit.itch.io/sky-hopper/buy?item=sword"]);
    // The browser held the tab back: the player stayed.
    elsewhere.window.open = () => null;
    expect(await elsewhere.Zaisma.links.open("store", { ownSiteUrl: "https://kit.itch.io/sky-hopper" })).toBe("stayed");
  });

  it("blocks through the Zaisma page, tells the room, and hides emotes both ways without saying who blocked whom", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const sent = () => socket.sent.map((text) => JSON.parse(text));
    // As it joins, the game asks the page which players here this session blocked in other games.
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:blocks-among", playerIds: ["player_bo"] });
    // A block between them that this player didn't make: the room says so, and only isMuted shows it.
    say(socket, { type: "blocks", playerIds: ["player_bo"] });
    expect(room.isMuted("player_bo")).toBe(true);
    say(socket, { type: "blocks", playerIds: [] });
    expect(room.isMuted("player_bo")).toBe(false);

    // A guest's block lasts for the session: the page keeps it, the room hears at once.
    const blocking = room.block("player_bo");
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:block", code: "K7Q2MX", playerKind: "guest", player: { id: "player_bo", name: "Bo", kind: "account" } });
    sdk.page.say({ type: "zaisma:block", status: "asking", playerId: "player_bo" });
    sdk.page.say({ type: "zaisma:block", status: "blocked", playerId: "player_bo", isLasting: false });
    expect(await blocking).toBe(true);
    expect(sent().at(-1)).toEqual({ type: "block", playerId: "player_bo" });
    expect(room.isMuted("player_bo")).toBe(true);
    // Unblock lifts a session block, telling the room and the page.
    room.unblock("player_bo");
    expect(sent().at(-1)).toEqual({ type: "unblock", playerId: "player_bo" });
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:unblock", playerId: "player_bo" });
    expect(room.isMuted("player_bo")).toBe(false);

    // The player changed their mind on Zaisma's plate.
    const cancelled = room.block("player_bo");
    sdk.page.say({ type: "zaisma:block", status: "asking", playerId: "player_bo" });
    sdk.page.say({ type: "zaisma:block", status: "cancelled", playerId: "player_bo" });
    expect(await cancelled).toBe(false);
    // A block between accounts lasts, and is undone only on zaisma.com/friends.
    const lasting = room.block("player_bo");
    sdk.page.say({ type: "zaisma:block", status: "asking", playerId: "player_bo" });
    sdk.page.say({ type: "zaisma:block", status: "blocked", playerId: "player_bo", isLasting: true });
    expect(await lasting).toBe(true);
    room.unmute("player_bo");
    expect(room.isMuted("player_bo")).toBe(true);
    expect(await failureCode(() => room.block("player_nobody"))).toBe("bad_player_id");

    // The page says this session blocked a player in another game: the room hears as soon as they're here.
    const fresh = loadSdk();
    const { room: elsewhere, socket: elsewhereSocket } = await joinedRoom(fresh);
    fresh.page.say({ type: "zaisma:blocks-among", playerIds: ["player_bo"] });
    expect(JSON.parse(elsewhereSocket.sent.at(-1)!)).toEqual({ type: "block", playerId: "player_bo" });
    expect(elsewhere.isMuted("player_bo")).toBe(true);
  });

  it("opens the page's own Share and Players from a game's Invite and Players buttons on Zaisma", async () => {
    const sdk = loadSdk();
    const { room } = await joinedRoom(sdk);
    const shares = () => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:share");
    // The page answers whether its Share opened.
    const inviting = sdk.Zaisma.invite(room);
    expect(shares()).toEqual([{ type: "zaisma:share", requestNumber: 1 }]);
    // An answer for another request isn't this one's.
    sdk.page.say({ type: "zaisma:share-answer", requestNumber: 7, isOpened: false });
    sdk.page.say({ type: "zaisma:share-answer", requestNumber: 1, isOpened: true });
    expect(await inviting).toBe("opened");
    const refused = sdk.Zaisma.invite(room);
    sdk.page.say({ type: "zaisma:share-answer", requestNumber: 2, isOpened: false });
    expect(await refused).toBe("failed");
    expect(valuesOf("InviteStatus")).toEqual(expect.arrayContaining(["opened", "failed"]));
    sdk.Zaisma.openPlayersPanel(room);
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:players-open" });
    // No page answering: like links, not on Zaisma.
    vi.useFakeTimers();
    try {
      const unanswered = sdk.Zaisma.invite(room);
      vi.advanceTimersByTime(3000);
      expect(await failureCode(() => unanswered)).toBe("not_on_zaisma");
    } finally {
      vi.useRealTimers();
    }
    // Only right after the player's tap, on Zaisma or off it, and then the page hears nothing.
    sdk.navigator.userActivation = { isActive: false };
    const before = shares().length;
    expect(await failureCode(() => sdk.Zaisma.invite(room))).toBe("needs_player_tap");
    expect(shares()).toHaveLength(before);
    const elsewhere = loadSdk(null);
    elsewhere.navigator.userActivation = { isActive: false };
    expect(await failureCode(() => elsewhere.Zaisma.invite(null))).toBe("needs_player_tap");
    // A game on its own site has no Zaisma page: it tells none.
    elsewhere.navigator.userActivation = { isActive: true };
    const elsewhereBefore = elsewhere.page.posted.length;
    await elsewhere.Zaisma.invite(null).catch(() => "failed");
    expect(elsewhere.page.posted.slice(elsewhereBefore).filter((message) => ["zaisma:share", "zaisma:players-open"].includes((message as { type: string }).type))).toEqual([]);
  });

  it("checks chat through Zaisma, and calls Zaisma only from a game on Zaisma", async () => {
    const asked: string[] = [];
    const tooLong = { isAllowed: false, reason: "too_long", message: "That message is too long to send.", hasSwearing: false, hasSlur: false, text: "" };
    const fetchAnswer = ((url: string) => {
      asked.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(tooLong) });
    }) as () => Promise<unknown>;
    const check = await loadSdk(ON_ZAISMA, fetchAnswer).Zaisma.checkChat("x".repeat(2001));
    expect(check).toEqual(tooLong);
    expect(Object.keys(check).sort()).toEqual(fieldsOf("ChatCheck"));
    expect(asked).toEqual(["https://rooms.zaisma.test/v1/filter"]);
    // The SDK's reasons are the ones /v1/filter gives: the game server's, but for the two only a room gives.
    const gameServerReasons = valuesInSource(join(ROOT, "packages/game-server/src/chat.ts"), "ChatCheckReason");
    expect(valuesOf("ChatCheckReason")).toEqual(gameServerReasons.filter((reason) => reason !== "chat_paused" && reason !== "not_allowed_to_chat"));
    // Off Zaisma there's nowhere to ask: refused before any fetch.
    expect(await failureCode(() => loadSdk(null, fetchAnswer).Zaisma.checkChat("hello"))).toBe("not_on_zaisma");
    expect(asked).toHaveLength(1);
  });

  it("tells the Zaisma page who's in the room for its Players plate, and mutes and blocks when the plate asks", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const told = () => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:players").at(-1);
    const bo = { id: "player_bo", name: "Bo", kind: "account" };
    expect(told()).toEqual({ type: "zaisma:players", code: "K7Q2MX", isOpen: true, myPlayerId: "player_ana", players: [me, bo], mutedPlayerIds: [], blockedPlayerIds: [], lastingBlockedPlayerIds: [] });
    // Someone joins: the page hears the new list.
    const cy = { id: "player_cy", name: "Cy", kind: "guest" };
    say(socket, { type: "players", players: [me, bo, cy], hostPlayerId: null });
    expect((told() as { players: unknown[] }).players).toEqual([me, bo, cy]);
    // The room stops taking new players: the page hears, so its bar says the room is closed instead of its code.
    say(socket, { type: "room", room: { isListed: false, isOpen: false, name: null, labels: {} } });
    expect((told() as { isOpen: boolean }).isOpen).toBe(false);
    say(socket, { type: "room", room: { isListed: false, isOpen: true, name: null, labels: {} } });
    expect((told() as { isOpen: boolean }).isOpen).toBe(true);
    // A mute in the game shows on the plate.
    room.mute("player_cy");
    expect((told() as { mutedPlayerIds: string[] }).mutedPlayerIds).toEqual(["player_cy"]);
    // The plate mutes and unmutes through the game's room.
    sdk.page.say({ type: "zaisma:player-action", action: "mute", playerId: "player_bo" });
    expect(room.isMuted("player_bo")).toBe(true);
    sdk.page.say({ type: "zaisma:player-action", action: "unmute", playerId: "player_bo" });
    expect(room.isMuted("player_bo")).toBe(false);
    // Only Zaisma's page can ask.
    (sdk.listeners.message ?? []).forEach((listener) => listener({ origin: "https://evil.test", source: sdk.page, data: { type: "zaisma:player-action", action: "mute", playerId: "player_bo" } }));
    expect(room.isMuted("player_bo")).toBe(false);
    // Block from the plate asks through the same plate a game's room.block uses.
    sdk.page.say({ type: "zaisma:player-action", action: "block", playerId: "player_bo" });
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:block", code: "K7Q2MX", playerKind: "guest", player: bo });
    sdk.page.say({ type: "zaisma:block", status: "asking", playerId: "player_bo" });
    sdk.page.say({ type: "zaisma:block", status: "blocked", playerId: "player_bo", isLasting: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(room.isMuted("player_bo")).toBe(true);
    expect((told() as { blockedPlayerIds: string[] }).blockedPlayerIds).toEqual(["player_bo"]);
    // A block someone else made of this player never reaches the page.
    say(socket, { type: "blocks", playerIds: ["player_cy"] });
    expect((told() as { blockedPlayerIds: string[] }).blockedPlayerIds).toEqual(["player_bo"]);

    // A game hosted somewhere else tells no page.
    const elsewhere = loadSdk(null);
    expect(elsewhere.page.posted.filter((message) => (message as { type: string }).type === "zaisma:players")).toEqual([]);
  });

  it("quickJoin tries rooms with someone the player blocked after the others, and before a new room", async () => {
    const listed = ["AAAAAA", "BBBBBB"].map((roomCode) => ({ roomCode, isOpen: true, playerCount: 1, heldSeatCount: 0, maximumPlayerCount: 4 }));
    const sdk = loadSdk(ON_ZAISMA, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ rooms: listed }) }));
    const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
    const joining = sdk.Zaisma.rooms.quickJoin();
    const tryRoom = async () => {
      await wait();
      const socket = sdk.sockets.at(-1)!;
      socket.onopen!();
      return { socket, roomCode: socket.url.slice(-6), hello: JSON.parse(socket.sent[0]!) };
    };
    // Someone the player blocked is in the busiest room: quickJoin moves on.
    const first = await tryRoom();
    // Every hello from quickJoin says so, so Zaisma knows the game joins players by itself.
    expect(first).toMatchObject({ roomCode: "AAAAAA", hello: { avoidBlockedPlayers: true, isQuickJoin: true } });
    say(first.socket, { type: "error", code: "blocked_player_here", message: "Someone you blocked is in this room." });
    const second = await tryRoom();
    expect(second).toMatchObject({ roomCode: "BBBBBB", hello: { avoidBlockedPlayers: true } });
    say(second.socket, { type: "error", code: "room_full", message: "This room is full." });
    // Nothing else fits: back to the first room, with the wall still up.
    const last = await tryRoom();
    expect(last.roomCode).toBe("AAAAAA");
    expect(last.hello).not.toHaveProperty("avoidBlockedPlayers");
    expect(last.hello.isQuickJoin).toBe(true);
    say(last.socket, { type: "welcome", me, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null } });
    expect((await joining).roomCode).toBe("AAAAAA");
  });

  it("a profile has the fields PlayerProfile says", async () => {
    const asked: string[] = [];
    const sdk = loadSdk(ON_ZAISMA, ((url: string) => {
      asked.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ player: { id: "player_bo", name: "Bo_Peep", username: "Bo_Peep", display_name: "Bo", bio: null, link_urls: [], profile_url: "https://zaisma.test/@Bo_Peep", is_profile_private: false, published_games: [{ slug: "sheep-run", title: "Sheep Run", page_url: "https://zaisma.test/g/sheep-run" }], played_games: [{ slug: "arena", title: "Arena", page_url: "https://zaisma.test/g/arena", played_period: "this_week" }], playing_now: { slug: "arena", title: "Arena", page_url: "https://zaisma.test/g/arena" } } }) });
    }) as () => Promise<unknown>);
    const profile = await sdk.Zaisma.player.getProfile("player_bo");
    expect(Object.keys(profile).sort()).toEqual(fieldsOf("PlayerProfile"));
    // In the SDK's camelCase, like everything else in games.
    expect(profile.displayName).toBe("Bo");
    expect(profile.publishedGames).toEqual([{ slug: "sheep-run", title: "Sheep Run", pageUrl: "https://zaisma.test/g/sheep-run" }]);
    expect(profile.playedGames).toEqual([{ slug: "arena", title: "Arena", pageUrl: "https://zaisma.test/g/arena", playedPeriod: "this_week" }]);
    expect(profile.playingNow).toEqual({ slug: "arena", title: "Arena", pageUrl: "https://zaisma.test/g/arena" });
    expect(asked).toEqual(["https://rooms.zaisma.test/v1/players/player_bo"]);
  });

  it("hands purchases to a game whose purchases come to it once it listens, once each, and marks them handled", async () => {
    const asked: { url: string; body: Record<string, unknown> }[] = [];
    const bought = { id: "purchase_k2v9q4", itemName: "revive", itemKind: "consumable", itemCount: 3, purchaseSource: "sale", purchaseStatus: "completed", gameAccountId: null, paidMinorUnits: 199, currencyCode: "EUR", purchasedAt: "2026-10-24T09:00:00.000Z", refundedAt: null, receipt: "receipt" };
    const takenBack = { ...bought, id: "purchase_m7x1p3", purchaseStatus: "refunded", refundedAt: "2026-10-24T10:00:00.000Z" };
    const answers: Record<string, unknown> = {
      "/v1/pass": { pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" },
      "/v1/items/unhandled": { purchases: [bought, takenBack] },
      "/v1/items/handled": { isHandled: true },
    };
    const fetchAnswer = ((url: string, init: { body: string }) => {
      const path = url.replace(ON_ZAISMA.rooms, "");
      asked.push({ url: path, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(answers[path]) });
    }) as () => Promise<unknown>;
    const sdk = loadSdk({ ...ON_ZAISMA, purchaseDelivery: "game" } as typeof ON_ZAISMA, fetchAnswer, "account");
    expect(listed(await refusal(() => sdk.Zaisma.items.on("notAnEvent", () => {})))).toEqual(fieldsOf("ItemsEvents"));
    const heard: [string, Record<string, unknown>][] = [];
    expect(sdk.Zaisma.items.on("purchase", (purchase: Record<string, unknown>) => heard.push(["purchase", purchase]))).toBe(sdk.Zaisma.items);
    sdk.Zaisma.items.on("refund", (purchase: Record<string, unknown>) => heard.push(["refund", purchase]));
    await vi.waitFor(() => expect(heard).toHaveLength(2));
    expect(heard).toEqual([["purchase", bought], ["refund", takenBack]]);
    expect(Object.keys(bought).sort()).toEqual(fieldsOf("Purchase"));
    expect(asked.filter((call) => call.url === "/v1/items/unhandled")).toEqual([{ url: "/v1/items/unhandled", body: { gameSlug: "test-game", pass: "account-pass" } }]);

    // Listening again looks again, but a purchase already handed over in this page doesn't come twice.
    sdk.Zaisma.items.on("purchase", () => {});
    await vi.waitFor(() => expect(asked.filter((call) => call.url === "/v1/items/unhandled")).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heard).toHaveLength(2);

    expect(await sdk.Zaisma.items.unhandled()).toEqual([bought, takenBack]);
    expect(await sdk.Zaisma.items.markHandled("purchase_k2v9q4")).toBeUndefined();
    expect(asked.at(-1)).toEqual({ url: "/v1/items/handled", body: { gameSlug: "test-game", pass: "account-pass", purchaseId: "purchase_k2v9q4" } });
    expect(await failureCode(() => sdk.Zaisma.items.markHandled("revive"))).toBe("bad_purchase_id");
  });

  it("leaves purchases to the game server when they're delivered there, and passes on a refusal to mark one", async () => {
    const asked: string[] = [];
    const fetchAnswer = ((url: string) => {
      const path = url.replace(ON_ZAISMA.rooms, "");
      asked.push(path);
      if (path === "/v1/pass") return Promise.resolve({ ok: true, json: () => Promise.resolve({ pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: { code: "handled_by_server", message: "The game server marks it." } }) });
    }) as () => Promise<unknown>;
    const sdk = loadSdk({ ...ON_ZAISMA, purchaseDelivery: "game_server" } as typeof ON_ZAISMA, fetchAnswer, "account");
    sdk.Zaisma.items.on("purchase", () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual([]);
    expect(await failureCode(() => sdk.Zaisma.items.markHandled("purchase_k2v9q4"))).toBe("handled_by_server");
  });

  it("offers a friend request through the Zaisma page, which asks first, and has the room nudge the other player's game", async () => {
    const accountPass = { pass: "account-pass", player: { id: "player_ana", name: "Ana", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" };
    const fetchAnswer = ((url: string) => (url.endsWith("/v1/pass") ? Promise.resolve({ ok: true, json: () => Promise.resolve(accountPass) }) : Promise.reject(new TypeError("Failed to fetch")))) as () => Promise<unknown>;
    const sdk = loadSdk(ON_ZAISMA, fetchAnswer, "account");
    const { socket } = await joinedRoom(sdk);
    const sent = () => socket.sent.map((text) => JSON.parse(text));
    const askedOf = async () => {
      await vi.waitFor(() => expect((sdk.page.posted.at(-1) as { type?: string })?.type).toBe("zaisma:friend-request"));
      return sdk.page.posted.at(-1);
    };
    const asking = sdk.Zaisma.friends.sendRequest("player_bo");
    expect(await askedOf()).toEqual({ type: "zaisma:friend-request", playerId: "player_bo" });
    sdk.page.say({ type: "zaisma:friend-request", playerId: "player_bo", status: "asking" });
    sdk.page.say({ type: "zaisma:friend-request", playerId: "player_bo", status: "sent" });
    const answer = await asking;
    expect(answer).toEqual({ status: "sent" });
    expect(Object.keys(answer).sort()).toEqual(fieldsOf("FriendRequestAnswer"));
    // The room Bo is in tells Bo's game to have their page look.
    expect(sent().at(-1)).toEqual({ type: "friend_request", playerId: "player_bo" });
    // The player said no on Zaisma's sheet.
    const cancelled = sdk.Zaisma.friends.sendRequest("player_bo");
    await askedOf();
    sdk.page.say({ type: "zaisma:friend-request", playerId: "player_bo", status: "cancelled" });
    expect(await cancelled).toEqual({ status: "cancelled" });
    const before = socket.sent.length;
    // One sent from the page's own Players reaches the room too.
    sdk.page.say({ type: "zaisma:friend-request", playerId: "player_bo", status: "sent" });
    expect(socket.sent.length).toBe(before + 1);
    // An accept on the page reaches the room the same way, so the sender hears of it.
    sdk.page.say({ type: "zaisma:friend-request", playerId: "player_bo", status: "accepted" });
    expect(sent().at(-1)).toEqual({ type: "friend_request", playerId: "player_bo" });
    // A request waiting for this player: the room says only "look", and the page is told.
    say(socket, { type: "friend_request" });
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:friend-requests" });
    expect(await failureCode(() => sdk.Zaisma.friends.sendRequest("Bo"))).toBe("bad_player_id");
    expect(await failureCode(() => loadSdk().Zaisma.friends.sendRequest("player_bo"))).toBe("account_needed");
    expect(await failureCode(() => loadSdk(null).Zaisma.friends.sendRequest("player_bo"))).toBe("not_on_zaisma");
  });

  it("lists a signed-in player's friends playing the game, as FriendInGame says, and keeps the answer 10 seconds", async () => {
    const asked: { url: string; body: Record<string, unknown> }[] = [];
    const answers: Record<string, unknown> = {
      "/v1/pass": { pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" },
      "/v1/friends": {
        friends: [
          { player_id: "player_bo", username: "Bo_Peep", room_code: "K7Q2MX", server_url: null, join_refusal: null },
          { player_id: "player_di", username: "Di", room_code: null, server_url: null, join_refusal: "room_full" },
        ],
      },
      "/v1/friends/room": { isSet: true },
    };
    const fetchAnswer = ((url: string, init: { body: string }) => {
      const path = url.replace(ON_ZAISMA.rooms, "");
      asked.push({ url: path, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(answers[path]) });
    }) as () => Promise<unknown>;
    const sdk = loadSdk(ON_ZAISMA, fetchAnswer, "account");
    const { friends } = await sdk.Zaisma.friends.list();
    expect(Object.keys(friends[0]).sort()).toEqual(fieldsOf("FriendInGame"));
    expect(friends).toEqual([
      { id: "player_bo", name: "Bo_Peep", username: "Bo_Peep", roomCode: "K7Q2MX", serverUrl: null, joinRefusal: null },
      { id: "player_di", name: "Di", username: "Di", roomCode: null, serverUrl: null, joinRefusal: "room_full" },
    ]);
    expect(asked.at(-1)).toEqual({ url: "/v1/friends", body: { gameSlug: "test-game", pass: "account-pass" } });
    await sdk.Zaisma.friends.list();
    expect(asked.filter((call) => call.url === "/v1/friends")).toHaveLength(1);

    // Which room on the game's own servers, and that the player left it.
    await sdk.Zaisma.friends.setRoom({ serverUrl: "wss://play.example.com/", roomCode: "k7q2mx" });
    expect(asked.at(-1)).toEqual({ url: "/v1/friends/room", body: { gameSlug: "test-game", pass: "account-pass", serverUrl: "wss://play.example.com", roomCode: "K7Q2MX", friendJoinsEnabled: true } });
    // A private room: friends' Join grays it.
    await sdk.Zaisma.friends.setRoom({ serverUrl: "wss://play.example.com", roomCode: "K7Q2MX", friendJoinsEnabled: false });
    expect(asked.at(-1)!.body).toMatchObject({ roomCode: "K7Q2MX", friendJoinsEnabled: false });
    await sdk.Zaisma.friends.setRoom(null);
    expect(asked.at(-1)).toEqual({ url: "/v1/friends/room", body: { gameSlug: "test-game", pass: "account-pass", serverUrl: null, roomCode: null } });
    expect(await failureCode(() => sdk.Zaisma.friends.setRoom({ serverUrl: "ws://play.example.com", roomCode: "K7Q2MX" }))).toBe("bad_server_url");
    expect(await failureCode(() => sdk.Zaisma.friends.setRoom({ serverUrl: "wss://play.example.com", roomCode: "K7Q2MO" }))).toBe("bad_room_code");
    expect(await failureCode(() => sdk.Zaisma.friends.setRoom(undefined))).toBe("unknown_option");

    // joinRoom on the game's own server says the room by itself once in, and that the player left as they go.
    const joining = sdk.Zaisma.joinRoom({ serverUrl: "wss://play.example.com", roomCode: "M2X7Q3" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sdk.sockets.at(-1)!;
    socket.onopen!();
    say(socket, { type: "welcome", me: { id: "player_cy", name: "Cy", kind: "account" }, players: [], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: null, hiddenTimeoutSec: null } });
    const room = await joining;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked.at(-1)).toEqual({ url: "/v1/friends/room", body: { gameSlug: "test-game", pass: "account-pass", serverUrl: "wss://play.example.com", roomCode: "M2X7Q3", friendJoinsEnabled: true } });
    // The game server turns friends' Join off for the room: Zaisma hears it at once.
    say(socket, { type: "room", room: { ...settings, friendJoinsEnabled: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(room.friendJoinsEnabled).toBe(false);
    expect(asked.at(-1)!.body).toMatchObject({ roomCode: "M2X7Q3", friendJoinsEnabled: false });
    room.leave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked.at(-1)!.body).toMatchObject({ serverUrl: null, roomCode: null });

    // A guest has no friends: list says so, and setRoom has nobody to tell.
    const guest = loadSdk(ON_ZAISMA, fetchAnswer);
    const callCount = asked.length;
    expect(await failureCode(() => guest.Zaisma.friends.list())).toBe("account_needed");
    await guest.Zaisma.friends.setRoom({ serverUrl: "wss://play.example.com", roomCode: "K7Q2MX" });
    expect(asked).toHaveLength(callCount);
    expect(await failureCode(() => loadSdk(null).Zaisma.friends.list())).toBe("not_on_zaisma");
  });

  it("follows a friend's Join to the game's own server only when joining that server", async () => {
    const linked = "?room=K7Q2MX&server=" + encodeURIComponent("wss://play.example.com");
    const ownServer = loadSdk(ON_ZAISMA, undefined, "guest", linked);
    expect(ownServer.Zaisma.rooms.linkedRoomCode).toBe("K7Q2MX");
    expect(ownServer.Zaisma.rooms.linkedServerUrl).toBe("wss://play.example.com");
    ownServer.Zaisma.joinRoom({ serverUrl: "wss://play.example.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ownServer.sockets.at(-1)!.url).toBe("wss://play.example.com/v1/rooms/test-game/K7Q2MX");
    // Another server makes its own room; Zaisma rooms don't take an own server's code.
    const elsewhere = loadSdk(ON_ZAISMA, undefined, "guest", linked);
    elsewhere.Zaisma.joinRoom({ serverUrl: "wss://other.example.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(elsewhere.sockets.at(-1)!.url).not.toContain("K7Q2MX");
    // A link without a server is for whichever the game uses, as before.
    const plain = loadSdk(ON_ZAISMA, undefined, "guest", "?room=K7Q2MX");
    expect(plain.Zaisma.rooms.linkedServerUrl).toBeNull();
    plain.Zaisma.joinRoom({ serverUrl: "wss://play.example.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(plain.sockets.at(-1)!.url).toBe("wss://play.example.com/v1/rooms/test-game/K7Q2MX");
  });

  it("watches a room as a spectator: says so in the hello, sends nothing, and follows a Watch link", async () => {
    const sdk = loadSdk(ON_ZAISMA, undefined, "guest", "?room=K7Q2MX&watch=1");
    expect(sdk.Zaisma.rooms.isLinkedAsSpectator).toBe(true);
    expect(loadSdk(ON_ZAISMA, undefined, "guest", "?room=K7Q2MX").Zaisma.rooms.isLinkedAsSpectator).toBe(false);
    expect(loadSdk(ON_ZAISMA, undefined, "guest", "?watch=1").Zaisma.rooms.isLinkedAsSpectator).toBe(false);
    const joining = sdk.Zaisma.joinRoom({ isSpectator: sdk.Zaisma.rooms.isLinkedAsSpectator });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sdk.sockets.at(-1)!;
    expect(socket.url).toContain("/K7Q2MX");
    socket.onopen!();
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "hello", isSpectator: true });
    say(socket, { type: "welcome", me, isSpectator: true, players: [{ id: "player_bo", name: "Bo", kind: "account", awayReason: null }], room: settings, spectatorCount: 3, hostPlayerId: null, awayChecks: { idleTimeoutSec: null, hiddenTimeoutSec: null } });
    const room = await joining;
    expect(room.isSpectator).toBe(true);
    expect(room.spectatorCount).toBe(3);
    const sentCount = socket.sent.length;
    expect(await failureCode(() => room.send({ type: "move" }))).toBe("spectator_cannot_send");
    expect(await failureCode(() => room.sendBytes(new Uint8Array([1])))).toBe("spectator_cannot_send");
    expect(socket.sent.length).toBe(sentCount);
    // The count follows the room; the Players plate hears it, and that this player watches.
    expect(heard(room, "settings", () => say(socket, { type: "room", room: settings, spectatorCount: 4 }))).toEqual({ ...settings, spectatorCount: 4 });
    expect(room.spectatorCount).toBe(4);
    expect(sdk.page.posted.filter((message: any) => message?.type === "zaisma:players").at(-1)).toMatchObject({ isSpectator: true, spectatorCount: 4 });
    // A player joins to play, and quickJoin and move.join take no isSpectator.
    expect((await joinedRoom(loadSdk())).room.isSpectator).toBe(false);
    expect(listed(await refusal(() => sdk.Zaisma.rooms.quickJoin({ isSpectator: true })))).not.toContain("isSpectator");
  });

  it("the example games that use the SDK type-check against them", () => {
    const problems: string[] = [];
    let checkedCount = 0;
    for (const example of readdirSync(join(ROOT, "examples"))) {
      const folder = join(ROOT, "examples", example, "game");
      let names: string[];
      try {
        names = readdirSync(folder);
      } catch {
        continue;
      }
      if (!readFileSync(join(folder, "index.html"), "utf8").includes("_zaisma/v1.js")) continue;
      // Each game on its own, as in the browser: its scripts share one page, not the other games'.
      const scripts = names.filter((name) => name.endsWith(".js")).map((name) => join(folder, name));
      const game = ts.createProgram([TYPES, ...scripts], { target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [], allowJs: true, checkJs: true, noEmit: true });
      for (const diagnostic of ts.getPreEmitDiagnostics(game)) {
        const at = diagnostic.file && diagnostic.start !== undefined ? `${diagnostic.file.fileName.slice(ROOT.length + 1)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1} ` : "";
        problems.push(at + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      }
      checkedCount++;
    }
    expect(problems).toEqual([]);
    expect(checkedCount).toBeGreaterThanOrEqual(2);
  });

  it("answers the room's probes at once, without a message event, and takes its ping and clock from them", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    expect(room.pingDurationMs).toBeNull();
    expect(Math.abs(room.serverTimeMs() - Date.now())).toBeLessThan(50);
    const messages: unknown[] = [];
    room.on("message", (message: unknown) => messages.push(message));
    socket.sent.length = 0;
    say(socket, { type: "probe", probeNumber: 1, serverTimeMs: Date.now() + 5000, pingDurationMs: null });
    expect(socket.sent.map((text) => JSON.parse(text))).toEqual([{ type: "probe_answer", probeNumber: 1 }]);
    expect(room.pingDurationMs).toBeNull();
    say(socket, { type: "probe", probeNumber: 2, serverTimeMs: Date.now() + 5000, pingDurationMs: 60 });
    expect(room.pingDurationMs).toBe(60);
    expect(messages).toEqual([]);
    // The room's clock runs 5 seconds ahead of this device's.
    expect(Math.abs(room.serverTimeMs() - (Date.now() + 5000))).toBeLessThan(100);
    // A late probe (queued behind other messages) doesn't pull the clock back.
    say(socket, { type: "probe", probeNumber: 3, serverTimeMs: Date.now() + 4000, pingDurationMs: 60 });
    expect(Math.abs(room.serverTimeMs() - (Date.now() + 5000))).toBeLessThan(100);
  });

  it("chats through the room: room.chat answers when it went, the chat event brings others' lines, and reports carry them", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    // A guest's welcome: no chat.
    expect(room.canChat).toBe(false);
    expect(await failureCode(() => room.chat("hi"))).toBe("chat_not_allowed");
    say(socket, { type: "welcome", me, players: [me, { id: "player_bo", name: "Bo", kind: "account" }], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null }, canChat: true });
    expect(room.canChat).toBe(true);
    socket.sent.length = 0;
    const got: unknown[] = [];
    room.on("chat", (chat: unknown) => got.push(chat));
    const sending = room.chat("good game");
    const sent = JSON.parse(socket.sent.at(-1) as string);
    expect(sent).toEqual({ type: "chat", chatNumber: sent.chatNumber, text: "good game" });
    say(socket, { type: "chat_sent", chatNumber: sent.chatNumber, sentAt: "2026-10-26T10:00:00.000Z" });
    expect(await sending).toEqual({ sentAt: "2026-10-26T10:00:00.000Z" });
    say(socket, { type: "chat", fromPlayerId: "player_bo", text: "gg too", hasSwearing: false, hasSlur: false, sentAt: "2026-10-26T10:00:01.000Z" });
    expect(got).toEqual([{ fromPlayerId: "player_bo", text: "gg too", hasSwearing: false, hasSlur: false, sentAt: "2026-10-26T10:00:01.000Z" }]);
    const stopping = room.chat("add me on snap");
    say(socket, { type: "chat_stopped", chatNumber: JSON.parse(socket.sent.at(-1) as string).chatNumber, reason: "contact_details", message: "Contact details can't be sent here." });
    expect(await stopping.catch((error: { code: string; reason: string }) => [error.code, error.reason])).toEqual(["chat_stopped", "contact_details"]);
    // Muted players' lines never reach the game.
    room.mute("player_bo");
    say(socket, { type: "chat", fromPlayerId: "player_bo", text: "hello?", hasSwearing: false, hasSlur: false, sentAt: "2026-10-26T10:00:02.000Z" });
    expect(got).toHaveLength(1);
  });

  it("sends bytes as a binary frame, and hands the game bytes with whose they are", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    socket.sent.length = 0;
    room.sendBytes(new Uint8Array([1, 2, 3]));
    room.sendBytes(new Float32Array([1]).buffer);
    expect((socket.sent as unknown[]).map((sent) => [...new Uint8Array(ArrayBuffer.isView(sent) ? sent.buffer : (sent as ArrayBuffer))])).toEqual([[1, 2, 3], [0, 0, 128, 63]]);
    expect(await failureCode(() => room.sendBytes("text"))).toBe("bad_bytes");
    const got: [number[], string | null][] = [];
    room.on("bytes", (bytes: Uint8Array, fromPlayerId: string | null) => got.push([[...bytes], fromPlayerId]));
    const from = new TextEncoder().encode("player_bo");
    socket.onmessage!({ data: new Uint8Array([from.length, ...from, 7, 8]).buffer as never });
    socket.onmessage!({ data: new Uint8Array([0, 9]).buffer as never });
    expect(got).toEqual([[[7, 8], "player_bo"], [[9], null]]);
  });

  it("reconnects after 8 seconds without a word from a ticking room", async () => {
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sdk.sockets.at(-1)!;
    socket.onopen!();
    say(socket, { type: "welcome", me, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: 120 }, probeIntervalSec: 2 });
    const room = await joining;
    const check = () => sdk.intervals.forEach((work) => work());
    const startMs = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(startMs + 7_000);
      check();
      expect(room.connectionStatus).toBe("open");
      say(socket, { type: "probe", probeNumber: 1, serverTimeMs: startMs + 7_000, pingDurationMs: 40 });
      clock.mockReturnValue(startMs + 15_001);
      check();
      expect(room.connectionStatus).toBe("reconnecting");
    } finally {
      clock.mockRestore();
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sdk.sockets.length).toBe(2);
  });

  it("asks the Zaisma page to show \"Still there?\", hears I'm here as input, and tells the page when it's over", async () => {
    const sdk = loadSdk();
    const { socket } = await joinedRoom(sdk);
    // The room answers every ping, so the connection stays open however long the clock jumps.
    const check = () => {
      sdk.intervals.forEach((work) => work());
      socket.onmessage!({ data: "pong" });
    };
    const stillThere = () => sdk.page.posted.filter((message) => (message as { type?: string })?.type === "zaisma:still-there");
    const startMs = Date.now();
    vi.useFakeTimers({ now: startMs });
    try {
      vi.setSystemTime(startMs + 600_000);
      check();
      expect(stillThere()).toEqual([{ type: "zaisma:still-there", untilMs: startMs + 630_000 }]);
      sdk.page.say({ type: "zaisma:still-there", status: "showing" });
      // Past the second the page has to answer: it did, so the game draws nothing (this stand-in browser has no document to draw in).
      vi.advanceTimersByTime(1500);
      // Only the page around the game answers for the player.
      (sdk.listeners.message ?? []).slice().forEach((listener) => listener({ origin: ON_ZAISMA.site, source: {}, data: { type: "zaisma:still-there", status: "here" } }));
      expect(stillThere()).toHaveLength(1);
      sdk.page.say({ type: "zaisma:still-there", status: "here" });
      expect(stillThere()).toEqual([{ type: "zaisma:still-there", untilMs: startMs + 630_000 }, { type: "zaisma:still-there", untilMs: null }]);
      // Asked again later, and nobody answers: the 30 seconds run out, the room hears they walked away, and the page hides its card.
      vi.setSystemTime(startMs + 1_300_000);
      check();
      sdk.page.say({ type: "zaisma:still-there", status: "showing" });
      vi.setSystemTime(startMs + 1_331_000);
      check();
      expect(stillThere().slice(2)).toEqual([{ type: "zaisma:still-there", untilMs: startMs + 1_330_000 }, { type: "zaisma:still-there", untilMs: null }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("what rooms send, as the game server and the rooms Worker declare it", () => {
    // What a player owns is the game server's alone, from their pass: rooms never send it to players' games.
    expect(fieldsOf("Player")).toEqual(fieldsOf("Player", GAME_SERVER).filter((name) => name !== "ownedItemNames"));
    expect(fieldsOf("ListedPlayer")).toEqual(fieldsOf("ListedPlayer", GAME_SERVER));
    const awayReasons = (file: string) => {
      const type = checker.getTypeOfSymbol(declaredType(file, "ListedPlayer").getProperty("awayReason")!);
      return (type.isUnion() ? type.types : [type]).map((part) => (part.isStringLiteral() ? part.value : checker.typeToString(part))).sort();
    };
    expect(awayReasons(TYPES)).toEqual(["hidden", "idle", "lost", "null"]);
    expect(awayReasons(TYPES)).toEqual(awayReasons(GAME_SERVER));
    expect(fieldsOf("RoomSettings")).toEqual(fieldsOf("RoomSettings", GAME_SERVER));
    expect(valuesOf("RoomErrorCode")).toEqual(valuesOf("RoomErrorCode", GAME_SERVER));
    expect(valuesOf("RequestErrorCode")).toEqual(valuesOf("RequestErrorCode", GAME_SERVER_REQUESTS));
    expect(valuesOf("ReportReason")).toEqual(valuesOf("PlayerReportReason", CORE_TYPES));
    expect(fieldsOf("ListedRoom")).toEqual([...fieldsOf("ListedRoom", CORE_ROOMS), "inviteUrl"].sort());
    // changedAtMs is the site's own; the rooms Worker leaves it out for games.
    // The SDK reads the rooms Worker's list into the game's own names (readRoomList in zaisma.js).
    expect(fieldsOf("RoomList")).toEqual(["filters", "listedClosedRoomCount", "listedJoinableRoomCount", "matchingOpenRoomCount", "moreOpenRoomCount", "playingPlayerCount", "playingRoomCount", "region", "regions", "rooms"]);
    expect(fieldsOf("RoomList", CORE_ROOMS)).toEqual(expect.arrayContaining(["filters", "joinableRoomCount", "moreOpenRoomCount", "openRoomCount", "playing", "region", "regions", "rooms"]));
  });
});

describe("versions published now, and the connection beside the game", () => {
  it("hears a match's version update, and asks the page to reload the game when its files changed", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const heard: unknown[] = [];
    room.on("versionUpdate", (versionUpdate: unknown) => heard.push(versionUpdate));
    say(socket, { type: "version_update", step: "coming", versionId: "version_two", appliesAt: "2026-10-21T12:00:10.000Z", isReloading: true });
    expect(heard).toEqual([{ versionId: "version_two", appliesAt: "2026-10-21T12:00:10.000Z", isReloading: true }]);
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:version-update", code: "K7Q2MX", step: "coming", appliesAt: "2026-10-21T12:00:10.000Z", isReloading: true });
    say(socket, { type: "version_update", step: "now", versionId: "version_two", appliesAt: "2026-10-21T12:00:10.000Z", isReloading: true });
    const socketCount = sdk.sockets.length;
    socket.onclose!({ code: 4004, reason: "Updating" });
    // The page reloads the game into this room; this tab doesn't reconnect by itself.
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:reload", code: "K7Q2MX" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sdk.sockets.length).toBe(socketCount);
    expect(room.connectionStatus).toBe("reconnecting");
  });

  it("reconnects by itself when only the game server changed", async () => {
    const sdk = loadSdk();
    const { socket } = await joinedRoom(sdk);
    say(socket, { type: "version_update", step: "now", versionId: "version_two", appliesAt: "2026-10-21T12:00:10.000Z", isReloading: false });
    const socketCount = sdk.sockets.length;
    socket.onclose!({ code: 4004, reason: "Updating" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sdk.sockets.length).toBe(socketCount + 1);
    expect(sdk.page.posted.some((message) => (message as { type: string }).type === "zaisma:reload")).toBe(false);
  });

  it("tells the page its connection: weak in a real-time room from a 150 ms ping, and reconnecting", async () => {
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sdk.sockets.at(-1)!;
    socket.onopen!();
    say(socket, { type: "welcome", me, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: 120 }, probeIntervalSec: 2 });
    await joining;
    const connection = () => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:connection");
    expect(connection().at(-1)).toEqual({ type: "zaisma:connection", code: "K7Q2MX", connectionStatus: "open", pingDurationMs: null, isWeak: false });
    say(socket, { type: "probe", probeNumber: 1, pingDurationMs: 90 });
    const toldCount = connection().length;
    say(socket, { type: "probe", probeNumber: 2, pingDurationMs: 180 });
    expect(connection().length).toBe(toldCount + 1);
    expect(connection().at(-1)).toMatchObject({ isWeak: true, pingDurationMs: 180 });
    // Still weak: not told again.
    say(socket, { type: "probe", probeNumber: 3, pingDurationMs: 190 });
    expect(connection().length).toBe(toldCount + 1);
    socket.onclose!({ code: 1006, reason: "" });
    expect(connection().at(-1)).toMatchObject({ connectionStatus: "reconnecting" });
  });

  it("joins a room on another version through the page, which reloads the game at it, never twice", async () => {
    const wait = (durationMs = 0) => new Promise((resolve) => setTimeout(resolve, durationMs));
    const knock = async (sdk: ReturnType<typeof loadSdk>, joinOptions: Record<string, unknown> = { roomCode: "K7Q2MX" }) => {
      const outcome: { code?: string; isSettled: boolean } = { isSettled: false };
      sdk.Zaisma.joinRoom(joinOptions).then(
        () => (outcome.isSettled = true),
        (error: { code: string }) => Object.assign(outcome, { isSettled: true, code: error.code }),
      );
      await wait();
      const socket = sdk.sockets.at(-1)!;
      socket.onopen!();
      const hello = JSON.parse(socket.sent[0]!);
      say(socket, { type: "error", code: "other_version", message: "This room runs another version of the game, so the game reloads at it first.", versionId: "version_one" });
      socket.onclose!({ code: 4001, reason: "other_version" });
      await wait();
      return { hello, outcome, socketCount: sdk.sockets.length };
    };
    const reloads = (sdk: ReturnType<typeof loadSdk>) => sdk.page.posted.filter((message) => (message as { type: string }).type === "zaisma:reload");
    const onVersionTwo = { ...ON_ZAISMA, version: "version_two" } as typeof ON_ZAISMA;

    // The hello says the tab's version; the page reloads the game at the room's, and the join waits for it.
    const sdk = loadSdk(onVersionTwo);
    const first = await knock(sdk);
    expect(first.hello).toMatchObject({ type: "hello", versionId: "version_two" });
    expect(reloads(sdk)).toEqual([{ type: "zaisma:reload", code: "K7Q2MX", versionId: "version_one" }]);
    await wait(600);
    expect(sdk.sockets.length).toBe(first.socketCount);
    expect(first.outcome.isSettled).toBe(false);

    // Opened into that very room already, or through a tester link: the join fails, so the game never reloads round and round.
    for (const again of [loadSdk(onVersionTwo, undefined, "guest", "?room=K7Q2MX"), loadSdk({ ...onVersionTwo, tester: "tester_1" } as typeof ON_ZAISMA)]) {
      expect((await knock(again)).outcome).toEqual({ isSettled: true, code: "other_version" });
      expect(reloads(again)).toEqual([]);
    }
    // The game's own servers have no versions of Zaisma's: their hello says none.
    expect((await knock(loadSdk(onVersionTwo), { roomCode: "K7Q2MX", serverUrl: "wss://play.example.com" })).hello).not.toHaveProperty("versionId");
  });

  it("offers a game not in a match the version the page found, and says whether the game took it", () => {
    const sdk = loadSdk({ ...ON_ZAISMA, version: "version_one" } as typeof ON_ZAISMA);
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:version", versionId: "version_one" });
    sdk.page.say({ type: "zaisma:version-ready", versionId: "version_two" });
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:version-ready", versionId: "version_two", isHandled: false });
    const offered: { versionId: string; apply(): void }[] = [];
    sdk.Zaisma.versions.on("update", (update: { versionId: string; apply(): void }) => offered.push(update));
    sdk.page.say({ type: "zaisma:version-ready", versionId: "version_three" });
    expect(offered.map((update) => update.versionId)).toEqual(["version_three"]);
    expect(sdk.page.posted).toContainEqual({ type: "zaisma:version-ready", versionId: "version_three", isHandled: true });
    offered[0]!.apply();
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:reload", code: null });
    expect(() => sdk.Zaisma.versions.on("updated", () => {})).toThrow('There\'s no "updated" event. Zaisma.versions has: update.');
  });

  it("says when Zaisma's page covers the game, only on a change and only from the page, read-only", () => {
    const sdk = loadSdk();
    expect(sdk.Zaisma.page.coveredBy).toBeNull();
    const heard: unknown[] = [];
    sdk.Zaisma.page.on("coveredBy", (coveredBy: unknown) => heard.push(coveredBy));
    sdk.page.say({ type: "zaisma:covered", coveredBy: "sheet" });
    sdk.page.say({ type: "zaisma:covered", coveredBy: "sheet" });
    expect(sdk.Zaisma.page.coveredBy).toBe("sheet");
    sdk.page.say({ type: "zaisma:covered", coveredBy: "card" });
    sdk.page.say({ type: "zaisma:covered", coveredBy: "something else" });
    expect(heard).toEqual(["sheet", "card", null]);
    // It's the page's to say, not the game's.
    expect(() => {
      "use strict";
      (sdk.Zaisma.page as { coveredBy: unknown }).coveredBy = "sheet";
    }).toThrow();
    expect(sdk.Zaisma.page.coveredBy).toBeNull();
    expect(() => sdk.Zaisma.page.on("covered", () => {})).toThrow('There\'s no "covered" event. Zaisma.page has: coveredBy.');
  });
});

describe("state sync and latest-only sends in the SDK", () => {
  it("keeps room.state from full copies and changes, and hands the \"state\" event both", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    expect(room.state).toBeNull();
    expect(room.smoothedState()).toBeNull();
    const heard: [unknown, unknown][] = [];
    room.on("state", (state: unknown, changes: unknown) => heard.push([state, changes]));
    say(socket, { type: "state", serverTimeMs: Date.now(), full: { round: 1, bodies: { ana: { x: 0 } } } });
    const first = room.state;
    say(socket, { type: "state", serverTimeMs: Date.now(), changes: [[["bodies", "ana", "x"], 5], [["bodies", "bo"], { x: 9 }], [["round"]]] });
    expect(room.state).toEqual({ bodies: { ana: { x: 5 }, bo: { x: 9 } } });
    // The earlier view stays as it was.
    expect(first).toEqual({ round: 1, bodies: { ana: { x: 0 } } });
    expect(heard).toEqual([
      [{ round: 1, bodies: { ana: { x: 0 } } }, null],
      [{ bodies: { ana: { x: 5 }, bo: { x: 9 } } }, [[["bodies", "ana", "x"], 5], [["bodies", "bo"], { x: 9 }], [["round"]]]],
    ]);
    // A full copy replaces it.
    say(socket, { type: "state", serverTimeMs: Date.now(), full: { round: 2 } });
    expect(room.state).toEqual({ round: 2 });
  });

  it("smooths between the two updates around delayMs behind the room's clock: numbers in between, the rest the older one's", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const nowMs = Date.now();
    say(socket, { type: "state", serverTimeMs: nowMs - 300, full: { bodies: { ana: { x: 0, y: 10, name: "Ana", isOut: false } }, list: [0, 0] } });
    say(socket, { type: "state", serverTimeMs: nowMs - 200, changes: [[["bodies", "ana", "x"], 100], [["bodies", "ana", "name"], "Ana L"], [["bodies", "bo"], { x: 50 }], [["list"], [10, 10, 10]]] });
    say(socket, { type: "state", serverTimeMs: nowMs - 100, changes: [[["bodies", "ana", "x"], 300]] });
    const clock = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      // 250 ms behind: halfway between the first two updates.
      const smoothed = room.smoothedState({ delayMs: 250 });
      expect(smoothed.bodies.ana.x).toBeCloseTo(50, 0);
      expect(smoothed.bodies.ana).toMatchObject({ y: 10, name: "Ana", isOut: false });
      // Bo is only in the newer one: as he is there.
      expect(smoothed.bodies.bo).toEqual({ x: 50 });
      expect(smoothed.list).toEqual([5, 5, 10]);
      // A copy, the game's to keep.
      smoothed.bodies.ana.x = -1;
      expect(room.smoothedState({ delayMs: 250 }).bodies.ana.x).toBeCloseTo(50, 0);
      // 150 ms behind by default 100: between the last two.
      expect(room.smoothedState({ delayMs: 150 }).bodies.ana.x).toBeCloseTo(200, 0);
      // Past the newest, the newest; before the oldest, the oldest.
      expect(room.smoothedState({ delayMs: 0 }).bodies.ana.x).toBe(300);
      expect(room.smoothedState({ delayMs: 1000 }).bodies.ana.x).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("holds latest-only sends while the socket is backed up, sending only the newest of each latestKey once it drains", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const buffered = socket as unknown as { bufferedAmount: number };
    socket.sent.length = 0;
    room.send({ type: "aim", angle: 1 }, { delivery: "latest_only", latestKey: "aim" });
    expect(socket.sent.map((text) => JSON.parse(text))).toEqual([{ type: "message", data: { type: "aim", angle: 1 } }]);
    buffered.bufferedAmount = 100 * 1024;
    room.send({ type: "aim", angle: 2 }, { delivery: "latest_only", latestKey: "aim" });
    room.send({ type: "aim", angle: 3 }, { delivery: "latest_only", latestKey: "aim" });
    room.send({ type: "fire" });
    room.sendBytes(new Uint8Array([1]), { delivery: "latest_only", latestKey: "pose" });
    room.sendBytes(new Uint8Array([2]), { delivery: "latest_only", latestKey: "pose" });
    // Reliable ones go at once, whatever the buffer holds.
    expect(socket.sent.slice(1).map((text) => JSON.parse(text))).toEqual([{ type: "message", data: { type: "fire" } }]);
    const check = () => sdk.intervals.forEach((work) => work());
    check();
    expect(socket.sent).toHaveLength(2);
    buffered.bufferedAmount = 0;
    check();
    expect(socket.sent.slice(2).map((sent) => (typeof sent === "string" ? JSON.parse(sent) : [...new Uint8Array(sent as unknown as ArrayBuffer)]))).toEqual([{ type: "message", data: { type: "aim", angle: 3 } }, [2]]);
  });
});

describe("the scripts the games server serves, in a page of their own", () => {
  /** A script as the games Worker serves it (withSetup in apps/games/src/index.ts): its setup handed in as a parameter. */
  const served = (parameterName: string, setup: unknown, script: string) => `(function (${parameterName}) {\n${script}\n})(${JSON.stringify(setup)});\n`;
  const listen = () => {};
  /** A fresh page with nothing on it but what a browser has, where the game sits in a Zaisma page. */
  function freshPage() {
    const zaismaPage = { postMessage() {} };
    const element = (): Record<string, unknown> => ({ style: {}, appendChild() {}, remove() {}, addEventListener: listen, setAttribute() {} });
    const storage = new Map<string, string>();
    const page = createContext({
      parent: zaismaPage,
      document: { hidden: false, visibilityState: "visible", currentScript: null, addEventListener: listen, getElementById: () => null, createElement: element, body: element() },
      location: { pathname: "/index.html", search: "", hash: "", href: "https://test-game.games.zaisma.test/index.html" },
      sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      localStorage: { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
      navigator: {},
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
      WebSocket: class {},
      addEventListener: listen,
      removeEventListener: listen,
      setInterval: () => 0,
      clearInterval() {},
      setTimeout: () => 0,
      clearTimeout() {},
      URL,
    });
    runInContext("var window = this;", page);
    const before = new Set(Object.getOwnPropertyNames(page));
    return { page, added: () => Object.getOwnPropertyNames(page).filter((name) => !before.has(name)) };
  }
  const zaismaGlobals = (names: string[]) => names.filter((name) => name.startsWith("__ZAISMA"));

  it("v1.js sets up window.Zaisma and leaves no __ZAISMA global", () => {
    const { page, added } = freshPage();
    runInContext(served("__ZAISMA__", ON_ZAISMA, SDK), page);
    expect(typeof (page as { Zaisma?: unknown }).Zaisma).toBe("object");
    expect(added()).toContain("Zaisma");
    expect(zaismaGlobals(Object.getOwnPropertyNames(page))).toEqual([]);
  });

  it("saves.js leaves no __ZAISMA global", () => {
    const { page } = freshPage();
    runInContext(served("__ZAISMA_SAVES__", { site: ON_ZAISMA.site, saveLimitBytes: 5 * 1024 * 1024, versionId: null }, readFileSync(join(ROOT, "packages/sdk/saves.js"), "utf8")), page);
    expect(zaismaGlobals(Object.getOwnPropertyNames(page))).toEqual([]);
  });
});

describe("v1 room messages in the SDK", () => {
  /** The socket drops the way a browser's does: closed first, then its close event. */
  function drop(socket: StandInSocket, code = 1006) {
    socket.readyState = 3;
    socket.onclose!({ code, reason: "" });
  }
  /** The room's side lets the player back in on a new socket. */
  function welcome(socket: StandInSocket, extra: Record<string, unknown> = {}) {
    socket.onopen!();
    say(socket, { type: "welcome", me, isSpectator: false, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null }, protocolVersionNumber: 1, ...extra });
  }
  const messagesOn = (socket: StandInSocket) => socket.sent.map((text) => JSON.parse(text)).filter((message) => message.type === "message");

  it("says its protocol and always a boolean isListed, and reads the welcome field by field", async () => {
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sdk.sockets.at(-1)!;
    socket.onopen!();
    const hello = JSON.parse(socket.sent[0]!);
    expect(hello.protocolVersionNumber).toBe(1);
    expect(hello.room.isListed).toBe(false);
    say(socket, { type: "welcome", me: { ...me, secret: 1 }, isSpectator: true, players: [{ ...me, awayReason: null, extra: true }], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: null, hiddenTimeoutSec: null }, protocolVersionNumber: 1 });
    const room = await joining;
    expect(room.me).toEqual(me);
    expect(room.players).toEqual([{ ...me, awayReason: null }]);
    expect(room.isSpectator).toBe(true);
    expect(room._protocolVersionNumber).toBe(1);
  });

  it("keeps reliable sends while reconnecting and sends them in order after the welcome", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    drop(socket);
    expect(room.connectionStatus).toBe("reconnecting");
    expect(room.send({ type: "one" })).toBe(true);
    room.send({ type: "aim", angle: 1 }, { delivery: "latest_only", latestKey: "aim" });
    expect(room.send({ type: "two" })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const next = sdk.sockets.at(-1)!;
    expect(next).not.toBe(socket);
    welcome(next);
    expect(messagesOn(next).map((message) => message.data.type)).toEqual(["one", "two", "aim"]);
  });

  it("keeps up to 60, drops the oldest past that and says send_queue_full once an outage", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    drop(socket);
    const errors: unknown[] = [];
    room.on("error", (error: unknown) => errors.push(error));
    for (let i = 0; i < 62; i++) room.send({ type: "move", i });
    room.send({ type: "aim" }, { delivery: "latest_only", latestKey: "aim" });
    const full = { code: "send_queue_full", message: "Up to 60 sends wait while reconnecting; older ones were dropped." };
    expect(errors).toEqual([full]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const next = sdk.sockets.at(-1)!;
    welcome(next);
    // 50 at once, within the room's burst, then 3 every 100 ms; the latest-only one after them all.
    expect(messagesOn(next)).toHaveLength(50);
    const flush = sdk.intervals.at(-1)!;
    for (let tick = 0; tick < 4; tick++) flush();
    const sent = messagesOn(next).map((message) => message.data);
    expect(sent.map((data) => data.i ?? data.type)).toEqual([...Array.from({ length: 60 }, (_, i) => i + 2), "aim"]);
    // Another outage, another overflow: said again.
    drop(next);
    for (let i = 0; i < 61; i++) room.send({ type: "move", i });
    expect(errors).toEqual([full, full]);
  });

  it("queues sends between the socket opening and the welcome, so none is taken for the hello", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    drop(socket);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const next = sdk.sockets.at(-1)!;
    next.onopen!();
    room.send({ type: "early" });
    expect(next.sent.map((text) => JSON.parse(text).type)).toEqual(["hello"]);
    say(next, { type: "welcome", me, isSpectator: false, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null }, protocolVersionNumber: 1 });
    expect(messagesOn(next).map((message) => message.data.type)).toEqual(["early"]);
  });

  it("queues sends while the player is away, and sends them once they're back", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    socket.sent.length = 0;
    say(socket, { type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
    expect(room.send({ type: "while_away" })).toBe(true);
    expect(messagesOn(socket)).toEqual([]);
    sdk.listeners.keydown![0]!();
    say(socket, { type: "welcome", me, isSpectator: false, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null }, protocolVersionNumber: 1 });
    expect(messagesOn(socket).map((message) => message.data.type)).toEqual(["while_away"]);
  });

  it("an idle player moved to the lobby isn't away there, and hears no back", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const backs: unknown[] = [];
    room.on("back", (back: unknown) => backs.push(back));
    say(socket, { type: "away", awayReason: "idle", seatHoldDurationSec: 0 });
    say(socket, { type: "move", roomCode: "M2X7Q3" });
    expect(room.awayReason).toBeNull();
    const lobby = sdk.sockets.at(-1)!;
    welcome(lobby);
    expect(backs).toEqual([]);
    expect(JSON.parse(lobby.sent[0]!).room).toEqual({ isListed: false });
  });

  it("quickJoin lists the rooms it makes unless told not to", async () => {
    const hellos: Record<string, any>[] = [];
    for (const quickJoinOptions of [undefined, { isListed: false }]) {
      const sdk = loadSdk(ON_ZAISMA, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ rooms: [] }) }));
      void sdk.Zaisma.rooms.quickJoin(quickJoinOptions);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const socket = sdk.sockets.at(-1)!;
      socket.onopen!();
      hellos.push(JSON.parse(socket.sent[0]!));
    }
    expect(hellos.map((hello) => hello.room.isListed)).toEqual([true, false]);
  });

  it("answers false only once the room is gone, and a move clears what waited", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    drop(socket);
    room.send({ type: "stale" });
    say(socket, { type: "move", roomCode: "M2X7Q3" });
    const moved = sdk.sockets.at(-1)!;
    welcome(moved);
    expect(messagesOn(moved)).toEqual([]);
    say(moved, { type: "ended", message: "Good game.", endReason: "game" });
    expect(room.send({ type: "late" })).toBe(false);
    expect(room.sendBytes(new Uint8Array([1]))).toBe(false);
  });

  it("connects once when a move comes while it waits to reconnect", async () => {
    const sdk = loadSdk();
    const { socket } = await joinedRoom(sdk);
    drop(socket);
    say(socket, { type: "move", roomCode: "M2X7Q3" });
    const socketCount = sdk.sockets.length;
    // The reconnect it was waiting for (500 ms) finds the moved socket and stays away.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sdk.sockets.length).toBe(socketCount);
    expect(sdk.sockets.at(-1)!.url).toContain("M2X7Q3");
  });

  it("throws too_big before sending over 16 KB, and latest_only needs a latestKey", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const before = socket.sent.length;
    expect(await failureCode(() => room.send({ text: "é".repeat(9000) }))).toBe("too_big");
    expect(await failureCode(() => room.sendBytes(new Uint8Array(16 * 1024 + 1)))).toBe("too_big");
    expect(await failureCode(() => room.send({ type: "aim" }, { delivery: "latest_only" }))).toBe("bad_send_option");
    expect(socket.sent.length).toBe(before);
    // Just under, in characters that take three bytes each, still goes.
    expect(room.send("x".repeat(16 * 1024 - 40))).toBe(true);
  });

  it("away keeps the socket open, the seat running out closes it, and back says which", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    const away = heard(room, "away", () => say(socket, { type: "away", awayReason: "hidden", seatHoldDurationSec: 300 }));
    expect(away).toEqual({ awayReason: "hidden", seatHoldDurationSec: 300 });
    expect(room.connectionStatus).toBe("open");
    expect(room.awayReason).toBe("hidden");
    // The page still hears "away".
    expect(sdk.page.posted.filter((message: any) => message.type === "zaisma:connection").at(-1)).toMatchObject({ connectionStatus: "away" });
    // Back to the held seat: the room's new welcome, then back with isSeatHeld.
    const held = heard(room, "back", () => {
      sdk.listeners.keydown![0]!();
      say(socket, { type: "welcome", me, isSpectator: false, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null }, protocolVersionNumber: 1 });
    });
    expect(held.isSeatHeld).toBe(true);
    expect(room.awayReason).toBeNull();
    // Away again, and the seat runs out: closed until the player is back, then back with the seat gone.
    say(socket, { type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
    socket.onclose!({ code: 4002, reason: "" });
    expect(room.connectionStatus).toBe("closed");
    const gone = heard(room, "back", () => sdk.listeners.keydown![0]!());
    expect(gone.isSeatHeld).toBe(false);
    expect(sdk.sockets.at(-1)).toBe(socket);
    (gone.rejoin as () => void)();
    expect(room.connectionStatus).toBe("connecting");
    expect(sdk.sockets.at(-1)).not.toBe(socket);
  });

  it("idle hands asking, then answered or timed_out", async () => {
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX", idleTimeoutSec: 30 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const socket = sdk.sockets.at(-1)!;
    welcome(socket);
    const room = await joining;
    const statuses: unknown[] = [];
    room.on("idle", (idle: unknown) => statuses.push(idle));
    // The room answers each ping, so only the idle check is at work.
    const check = () => {
      sdk.intervals.forEach((work) => work());
      socket.onmessage!({ data: "pong" });
    };
    const startMs = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(startMs + 31_000);
      check();
      sdk.listeners.keydown![0]!();
      clock.mockReturnValue(startMs + 62_000);
      check();
      clock.mockReturnValue(startMs + 93_000);
      check();
    } finally {
      clock.mockRestore();
    }
    expect(statuses).toEqual([
      { idleStatus: "asking", answerTimeoutSec: 30 },
      { idleStatus: "answered", answerTimeoutSec: 30 },
      { idleStatus: "asking", answerTimeoutSec: 30 },
      { idleStatus: "timed_out", answerTimeoutSec: 30 },
    ]);
  });

  it("unmute lifts a mute and unblock a session block, and the page's Unmute does both", async () => {
    const sdk = loadSdk();
    const { room } = await joinedRoom(sdk);
    room.mute("player_bo");
    await room.block("player_bo");
    room.unmute("player_bo");
    expect(room.isMuted("player_bo")).toBe(true);
    room.unblock("player_bo");
    expect(room.isMuted("player_bo")).toBe(false);
    room.mute("player_bo");
    await room.block("player_bo");
    sdk.page.say({ type: "zaisma:player-action", action: "unmute", playerId: "player_bo" });
    expect(room.isMuted("player_bo")).toBe(false);
  });

  it("message, settings, ended and moved hand what the d.ts says", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    let from: unknown;
    room.on("message", (message: unknown, fromPlayerId: unknown) => (from = [message, fromPlayerId]));
    say(socket, { type: "message", data: { type: "hi" }, fromPlayerId: "player_bo" });
    expect(from).toEqual([{ type: "hi" }, "player_bo"]);
    say(socket, { type: "message", data: { type: "tick" }, fromPlayerId: null });
    expect(from).toEqual([{ type: "tick" }, null]);
    expect(heard(room, "settings", () => say(socket, { type: "room", room: { ...settings, name: "Docks" }, spectatorCount: 2 }))).toEqual({ ...settings, name: "Docks", spectatorCount: 2 });
    expect(heard(room, "moved", () => say(socket, { type: "move", roomCode: "M2X7Q3" }))).toEqual({ roomCode: "M2X7Q3", fromRoomCode: "K7Q2MX" });
    const moved = sdk.sockets.at(-1)!;
    welcome(moved);
    expect(heard(room, "ended", () => say(moved, { type: "ended", message: "", endReason: "no_players" }))).toEqual({ message: "", endReason: "no_players" });
  });

  it("maps room lists into the SDK's names and refuses a region that isn't a continent", async () => {
    const answer = {
      rooms: [{ roomCode: "K7Q2MX", playerCount: 2, heldSeatCount: 0, maximumPlayerCount: 8, spectatorCount: 0, maximumSpectatorCount: 0, isOpen: true, location: { countryCode: "DE", countryName: "Germany", region: "EU" }, isNear: true, name: null, labels: {}, isKept: false, inviteUrl: "https://zaisma.test/g/test-game?room=K7Q2MX", changedAtMs: 1 }],
      playing: { playerCount: 9, roomCount: 3, closedRoomCount: 1 },
      joinableRoomCount: 2,
      openRoomCount: 2,
      regions: [{ region: "EU", name: "Europe", roomCount: 2, playerCount: 7 }],
      region: null,
      moreOpenRoomCount: 0,
      filters: [],
    };
    const sdk = loadSdk(ON_ZAISMA, () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer) }));
    const list = await sdk.Zaisma.rooms.list();
    expect(Object.keys(list).sort()).toEqual(fieldsOf("RoomList"));
    expect(list).toMatchObject({ playingPlayerCount: 9, playingRoomCount: 3, listedClosedRoomCount: 1, listedJoinableRoomCount: 2, matchingOpenRoomCount: 2, moreOpenRoomCount: 0, region: null });
    expect(list.regions).toEqual([{ region: "EU", regionName: "Europe", roomCount: 2, playerCount: 7 }]);
    expect(Object.keys(list.rooms[0]).sort()).toEqual(fieldsOf("ListedRoom"));
    expect(valuesOf("Region")).toEqual(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);
    expect(await failureCode(() => sdk.Zaisma.rooms.list({ region: "Europe" }))).toBe("bad_region");
    expect(await failureCode(() => sdk.Zaisma.rooms.quickJoin({ region: "eu" }))).toBe("bad_region");
  });

  it("refuses an idleTimeoutSec out of range, and quickJoin's serverUrl", async () => {
    const sdk = loadSdk();
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX", idleTimeoutSec: 10 }))).toBe("bad_idle_timeout");
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX", idleTimeoutSec: "600" }))).toBe("bad_idle_timeout");
    expect(await failureCode(() => sdk.Zaisma.rooms.quickJoin({ idleTimeoutSec: 90000 }))).toBe("bad_idle_timeout");
    expect(await failureCode(() => sdk.Zaisma.rooms.quickJoin({ serverUrl: "wss://play.example.com" }))).toBe("unknown_option");
    expect(await failureCode(() => loadSdk(null).Zaisma.joinRoom())).toBe("not_on_zaisma");
  });

  it("links a room on the game's own server with &server=, and tells the page its server", async () => {
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX", serverUrl: "wss://play.example.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    welcome(sdk.sockets.at(-1)!);
    const room = await joining;
    expect(room.inviteUrl).toBe("https://zaisma.test/g/test-game?room=K7Q2MX&server=" + encodeURIComponent("wss://play.example.com"));
    expect(sdk.page.posted.filter((message: any) => message.type === "zaisma:room").at(-1)).toMatchObject({ code: "K7Q2MX", serverUrl: "wss://play.example.com" });
  });
});

/**
 * A stand-in for the browser's WebTransport, for the fast lane to a game's own server: the test plays the
 * server, opening the session (or not), reading what the SDK wrote to its stream and its datagrams, and
 * saying frames on the stream as [4-byte length][kind][payload].
 */
class StandInWebTransport {
  static made: StandInWebTransport[] = [];
  readonly url: string;
  readonly ready: Promise<void>;
  readonly closed: Promise<{ closeCode: number; reason: string }>;
  open!: () => void;
  refuse!: (error: Error) => void;
  closeFromServer!: (info: { closeCode: number; reason: string }) => void;
  streamWritten: Uint8Array[] = [];
  datagramsWritten: Uint8Array[] = [];
  private toClient!: ReadableStreamDefaultController<Uint8Array>;
  datagrams = {
    maxDatagramSize: 1200,
    readable: new ReadableStream<Uint8Array>(),
    createWritable: () => new WritableStream<Uint8Array>({ write: (datagram) => void this.datagramsWritten.push(datagram) }),
  };
  constructor(url: string) {
    this.url = url;
    this.ready = new Promise((resolve, reject) => ((this.open = resolve), (this.refuse = reject)));
    this.ready.catch(() => {});
    this.closed = new Promise((resolve) => (this.closeFromServer = resolve));
    StandInWebTransport.made.push(this);
  }
  async createBidirectionalStream() {
    return {
      readable: new ReadableStream<Uint8Array>({ start: (controller) => void (this.toClient = controller) }),
      writable: new WritableStream<Uint8Array>({ write: (frame) => void this.streamWritten.push(frame) }),
    };
  }
  close() {}
  /** A text frame from the server, on the stream. */
  say(message: unknown) {
    const payload = new TextEncoder().encode(JSON.stringify(message));
    const frame = new Uint8Array(5 + payload.length);
    new DataView(frame.buffer).setUint32(0, payload.length);
    frame[4] = 0;
    frame.set(payload, 5);
    this.toClient.enqueue(frame);
  }
  /** What the SDK wrote, as { kind, text }: the stream's frames, or the datagrams. */
  static read(written: Uint8Array[], isDatagram: boolean) {
    return written.map((bytes) => {
      const start = isDatagram ? 1 : 5;
      if (!isDatagram) expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)).toBe(bytes.length - 5);
      return { kind: bytes[start - 1], text: new TextDecoder().decode(bytes.subarray(start)) };
    });
  }
}

describe("the fast lane to your own server", () => {
  const OWN = { roomCode: "K7Q2MX", serverUrl: "wss://play.example.com", transport: "webtransport" };
  const welcome = { type: "welcome", me, players: [me], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null } };
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  function standIn() {
    StandInWebTransport.made = [];
    vi.stubGlobal("WebTransport", StandInWebTransport);
    onTestFinished(() => void vi.unstubAllGlobals());
  }

  it("joins over WebTransport, sends latest-only messages that fit as datagrams, and everything else on the stream", async () => {
    standIn();
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom(OWN);
    await vi.waitFor(() => expect(StandInWebTransport.made).toHaveLength(1));
    const lane = StandInWebTransport.made[0]!;
    expect(lane.url).toBe("https://play.example.com/v1/rooms/test-game/K7Q2MX");
    lane.open();
    await vi.waitFor(() => expect(lane.streamWritten).toHaveLength(1));
    expect(JSON.parse(StandInWebTransport.read(lane.streamWritten, false)[0]!.text)).toMatchObject({ type: "hello", pass: "pass" });
    lane.say(welcome);
    const room = await joining;
    expect(room.transport).toBe("webtransport");
    expect(sdk.sockets).toHaveLength(0);
    lane.streamWritten = [];

    room.send({ type: "aim", angle: 1 }, { delivery: "latest_only", latestKey: "aim" });
    room.sendBytes(new Uint8Array([7, 8]), { delivery: "latest_only", latestKey: "pose" });
    room.send({ type: "aim", wide: "x".repeat(2000) }, { delivery: "latest_only", latestKey: "aim" });
    room.send({ type: "jump" });
    await settle();
    expect(StandInWebTransport.read(lane.datagramsWritten, true)).toEqual([
      { kind: 0, text: JSON.stringify({ type: "message", data: { type: "aim", angle: 1 } }) },
      { kind: 1, text: "\u0007\b" },
    ]);
    // Too big for a datagram, then a reliable one: on the stream, in order.
    expect(StandInWebTransport.read(lane.streamWritten, false).map((frame) => JSON.parse(frame.text).data.type)).toEqual(["aim", "jump"]);
    // What the room says on the stream reaches the game as over a WebSocket.
    let heard: unknown;
    room.on("message", (message: unknown) => (heard = message));
    lane.say({ type: "message", data: { type: "score", value: 3 }, fromPlayerId: null });
    await vi.waitFor(() => expect(heard).toEqual({ type: "score", value: 3 }));
  });

  it("uses the WebSocket where there's no WebTransport, or no serverUrl", async () => {
    const sdk = loadSdk();
    sdk.Zaisma.joinRoom(OWN);
    await vi.waitFor(() => expect(sdk.sockets).toHaveLength(1));
    expect(sdk.sockets[0]!.url).toBe("wss://play.example.com/v1/rooms/test-game/K7Q2MX");

    standIn();
    const onZaisma = loadSdk();
    onZaisma.Zaisma.joinRoom({ roomCode: "K7Q2MX", transport: "webtransport" });
    await vi.waitFor(() => expect(onZaisma.sockets).toHaveLength(1));
    expect(onZaisma.sockets[0]!.url).toBe("wss://rooms.zaisma.test/v1/rooms/test-game/K7Q2MX");
    expect(StandInWebTransport.made).toHaveLength(0);
  });

  it("falls back to the WebSocket when the session is refused, saying why once", async () => {
    standIn();
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warned.mockRestore());
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom(OWN);
    await vi.waitFor(() => expect(StandInWebTransport.made).toHaveLength(1));
    StandInWebTransport.made[0]!.refuse(new Error("Opening handshake failed."));
    await vi.waitFor(() => expect(sdk.sockets).toHaveLength(1));
    sdk.sockets[0]!.onopen!();
    say(sdk.sockets[0]!, welcome);
    const room = await joining;
    expect(room.transport).toBe("websocket");
    expect(warned).toHaveBeenCalledTimes(1);
    expect(String(warned.mock.calls[0]![0])).toContain("Opening handshake failed.");
  });

  it("falls back to the WebSocket when the session isn't up in 3 seconds", async () => {
    standIn();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => void vi.useRealTimers());
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warned.mockRestore());
    const sdk = loadSdk();
    const joining = sdk.Zaisma.joinRoom(OWN);
    // Real turns of the event loop (the clock is fake): the pass, then the session.
    for (let turn = 0; turn < 50 && !StandInWebTransport.made.length; turn++) await settle();
    expect(StandInWebTransport.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(sdk.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sdk.sockets).toHaveLength(1);
    sdk.sockets[0]!.onopen!();
    say(sdk.sockets[0]!, welcome);
    expect((await joining).transport).toBe("websocket");
  });
});
