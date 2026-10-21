import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { SAVE_COPY_REASONS } from "../../packages/core/src/saves.ts";

/**
 * packages/sdk/zaisma.d.ts is the SDK's reference, so it has to say exactly what zaisma.js does. The SDK
 * runs here in a stand-in browser: what it refuses lists what it takes, and what it hands out has its
 * fields, and both are compared with the types. The shapes rooms send are compared with the game
 * server's and the rooms Worker's own types.
 */

const ROOT = join(import.meta.dirname, "../..");
const TYPES = join(ROOT, "packages/sdk/zaisma.d.ts");
const SDK = readFileSync(join(ROOT, "packages/sdk/zaisma.js"), "utf8");
const GAME_SERVER = join(ROOT, "packages/game-server/src/room.ts");
const GAME_SERVER_REQUESTS = join(ROOT, "packages/game-server/src/requests.ts");
const CORE_ROOMS = join(ROOT, "packages/core/src/rooms.ts");
const CORE_TYPES = join(ROOT, "packages/core/src/types.ts");
const TEXT_FILTER = join(ROOT, "packages/core/src/text-filter.ts");
const ROOMS_WORKER = join(ROOT, "apps/rooms/src/index.ts");

const program = ts.createProgram([TYPES, GAME_SERVER, GAME_SERVER_REQUESTS, CORE_ROOMS, CORE_TYPES, TEXT_FILTER], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  strict: true,
  types: [],
});
const checker = program.getTypeChecker();

/** A declaration's members: the Zaisma namespace's in zaisma.d.ts, or a module's exports. */
function membersOf(file: string): ts.Symbol[] {
  const source = program.getSourceFile(file)!;
  if (file !== TYPES) return checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
  const namespace = source.statements.find((statement): statement is ts.ModuleDeclaration => ts.isModuleDeclaration(statement) && statement.name.text === "Zaisma")!;
  return checker.getExportsOfModule(checker.getSymbolAtLocation(namespace.name)!);
}

function declaredType(file: string, name: string): ts.Type {
  const symbol = membersOf(file).find((member) => member.name === name && member.flags & ts.SymbolFlags.Type);
  if (!symbol) throw new Error(`${file} declares no type ${name}`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

/** The field names of a shape, sorted. */
function fieldsOf(name: string, file = TYPES): string[] {
  return checker
    .getPropertiesOfType(declaredType(file, name))
    .map((property) => property.name)
    .sort();
}

/** The values of a union of string literals, sorted. */
function valuesOf(name: string, file = TYPES): string[] {
  const type = declaredType(file, name);
  return (type.isUnion() ? type.types : [type]).map((part) => String((part as ts.StringLiteralType).value)).sort();
}

/** The values of a union of string literals a file declares but doesn't export, read from its source alone. */
function valuesInSource(file: string, name: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022);
  const alias = source.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  if (!alias || !ts.isUnionTypeNode(alias.type)) throw new Error(`${file} declares no union ${name}`);
  return alias.type.types.map((part) => ((part as ts.LiteralTypeNode).literal as ts.StringLiteral).text).sort();
}

interface StandInSocket {
  url: string;
  sent: string[];
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

const ON_ZAISMA = { rooms: "https://rooms.zaisma.test", game: "test-game", site: "https://zaisma.test" };

/**
 * zaisma.js as on a game's page on Zaisma, in a stand-in browser: the tab already has a guest pass and
 * the page hands over a guest's room key, the test answers for the room's WebSocket and for fetch (no
 * connection, unless it gives an answer), and the page's event listeners are kept for the test to
 * call. null for zaismaConfig: a game hosted somewhere else, which has no __ZAISMA__.
 */
function loadSdk(zaismaConfig: typeof ON_ZAISMA | null = ON_ZAISMA, fetchAnswer: () => Promise<unknown> = () => Promise.reject(new TypeError("Failed to fetch")), playerKind = "guest", search = "") {
  const storage = new Map([["zaisma:pass:test-game", JSON.stringify({ ...me, pass: "pass", expiresAt: "2099-01-01T00:00:00Z" })]]);
  const sockets: StandInSocket[] = [];
  // What the SDK runs on a timer (its checks every second), for the test to run when it likes.
  const intervals: (() => void)[] = [];
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const listen = (type: string, listener: (event?: unknown) => void) => void (listeners[type] ??= []).push(listener);
  // The Zaisma page around the game: it hands over its room key, whose kind changes when the player signs in.
  const page = {
    playerKind,
    posted: [] as unknown[],
    postMessage(message: { type?: string }) {
      page.posted.push(message);
      const answer = { origin: ON_ZAISMA.site, source: page, data: { type: "zaisma:room-key", key: "room_key_test", playerKind: page.playerKind } };
      if (message?.type === "zaisma:room-key") queueMicrotask(() => (listeners.message ?? []).slice().forEach((listener) => listener(answer)));
    },
    /** A message from the page to the game. */
    say(data: unknown) {
      (listeners.message ?? []).slice().forEach((listener) => listener({ origin: ON_ZAISMA.site, source: page, data }));
    },
  };
  const window: Record<string, unknown> = { parent: page, addEventListener: listen };
  const browser = {
    __ZAISMA__: zaismaConfig,
    fetch: fetchAnswer,
    window,
    document: { hidden: false, addEventListener: listen },
    location: { search, href: `https://test-game.games.zaisma.test/${search}` },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    WebSocket: class {
      sent: string[] = [];
      readyState = 1;
      onopen = null;
      onmessage = null;
      onclose = null;
      constructor(public url: string) {
        sockets.push(this);
      }
      send(text: string) {
        this.sent.push(text);
      }
      close() {}
    },
    addEventListener: listen,
    removeEventListener() {},
    setInterval: (work: () => void) => (intervals.push(work), 0),
    clearInterval() {},
    navigator: {},
  };
  new Function(...Object.keys(browser), SDK)(...Object.values(browser));
  return { Zaisma: window.Zaisma as any, sockets, intervals, listeners, page, window, navigator: browser.navigator as Record<string, unknown> };
}

const me = { id: "player_ana", name: "Ana", kind: "guest" };
const settings = { isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {} };

/** Join a room the test plays the server of. */
async function joinedRoom(sdk: ReturnType<typeof loadSdk>) {
  const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sdk.sockets.at(-1)!;
  socket.onopen!();
  say(socket, { type: "welcome", me, players: [me, { id: "player_bo", name: "Bo", kind: "account" }], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null } });
  return { room: await joining, socket };
}

function say(socket: StandInSocket, message: unknown) {
  socket.onmessage!({ data: JSON.stringify(message) });
}

/** The names a refusal lists after "It takes:" or "Rooms have:", sorted. */
function listed(error: unknown): string[] {
  const message = (error as Error).message;
  const list = message.match(/(?:It takes|Rooms have|Zaisma\.saves has): (.*)\.$/);
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
    expect(Object.keys(Zaisma.friends).sort()).toEqual(fieldsOf("Friends"));
    expect(Object.keys(Zaisma.saves).sort()).toEqual(fieldsOf("Saves"));
    const player = membersOf(TYPES).find((member) => member.name === "player")!;
    expect(Object.keys(Zaisma.player).sort()).toEqual([...player.exports!.keys()].map(String).sort());
  });

  it("the options each call takes", async () => {
    const sdk = loadSdk();
    const wrong = { notAnOption: true };
    expect(listed(await refusal(() => sdk.Zaisma.joinRoom(wrong)))).toEqual(fieldsOf("JoinOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.rooms.quickJoin(wrong)))).toEqual(fieldsOf("QuickJoinOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.rooms.list(wrong)))).toEqual(fieldsOf("ListOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.server.request({ type: "leaderboard" }, wrong)))).toEqual(fieldsOf("RequestOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.links.open("store", wrong)))).toEqual(fieldsOf("LinkOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.friends.setRoom(wrong)))).toEqual(fieldsOf("OwnServerRoom"));
    const { room, socket } = await joinedRoom(sdk);
    expect(listed(await refusal(() => room.kick("player_bo", wrong)))).toEqual(fieldsOf("KickOptions"));
    expect(listed(await refusal(() => room.setInfo(wrong)))).toEqual(fieldsOf("RoomInfo"));
    const move = heard(room, "move", () => say(socket, { type: "move", roomCode: "M2X7Q3" }));
    expect(listed(await refusal(() => (move.join as (options: unknown) => Promise<unknown>)(wrong)))).toEqual(fieldsOf("MoveJoinOptions"));
  });

  it("hears when Zaisma will end a match past the month's free tier", async () => {
    const sdk = loadSdk();
    const { room, socket } = await joinedRoom(sdk);
    expect(room.endsAt).toBeNull();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(heard(room, "ending", () => say(socket, { type: "ending", endsAt }))).toBe(endsAt);
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
    expect(fields(heard(room, "room", () => say(socket, { type: "room", room: settings })))).toEqual(fieldsOf("RoomSettings"));
    expect(fields(heard(room, "error", () => say(socket, { type: "error", code: "too_fast", message: "Slow down." })))).toEqual(fieldsOf("RoomError"));
    expect(fields(heard(room, "away", () => say(socket, { type: "away", reason: "idle", seatHoldDurationSec: 300 })))).toEqual(fieldsOf("Away"));
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
    expect(await failureCode(() => elsewhere.Zaisma.player())).toBe("not_on_zaisma");
    expect(await failureCode(() => elsewhere.Zaisma.joinRoom())).toBe("not_on_zaisma");
    expect(await failureCode(() => elsewhere.Zaisma.rooms.list())).toBe("not_on_zaisma");
    expect(await failureCode(() => elsewhere.Zaisma.server.request({ type: "leaderboard" }))).toBe("not_on_zaisma");

    const sdk = loadSdk();
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ roomCode: "K7Q2MO" }))).toBe("bad_room_code");
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ serverUrl: "play.example.com" }))).toBe("bad_server_url");
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
  });

  it("keeps a pass for the tab until the player signs in or out", async () => {
    const asked: { url: string; body: string }[] = [];
    const passAnswer = { pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" };
    const fetchAnswer = ((url: string, init: { body: string }) => {
      asked.push({ url, body: init.body });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(passAnswer) });
    }) as () => Promise<unknown>;
    // Still a guest: the kept guest pass, with no call.
    expect(await loadSdk(ON_ZAISMA, fetchAnswer).Zaisma.player()).toEqual({ ...me, pass: "pass", expiresAt: "2099-01-01T00:00:00Z" });
    expect(asked).toEqual([]);
    // Signed in since: a new pass, for the account, with the page's key.
    const signedIn = await loadSdk(ON_ZAISMA, fetchAnswer, "account").Zaisma.player();
    expect(signedIn).toEqual({ ...passAnswer.player, pass: "account-pass", expiresAt: passAnswer.expiresAt });
    expect(Object.keys(signedIn).sort()).toEqual(fieldsOf("PlayerWithPass"));
    expect(asked).toEqual([{ url: "https://rooms.zaisma.test/v1/pass", body: JSON.stringify({ gameSlug: "test-game", roomKey: "room_key_test" }) }]);
  });

  it("asks the page to sign a guest in, then gives the account's pass", async () => {
    const passAnswer = { pass: "account-pass", player: { id: "player_cy", name: "Cy", kind: "account" }, expiresAt: "2099-01-01T00:00:00Z" };
    const sdk = loadSdk(ON_ZAISMA, () => Promise.resolve({ ok: true, json: () => Promise.resolve(passAnswer) }));
    expect((await sdk.Zaisma.player()).kind).toBe("guest");
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
    expect(await sdk.Zaisma.player()).toEqual({ ...passAnswer.player, pass: "account-pass", expiresAt: passAnswer.expiresAt });

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
    const pageCopy = { id: "save_copy_k2v9q4x7m1p3w8r5t6y0", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "replaced", sizeBytes: 120, isCurrentSave: false };
    const listing = sdk.Zaisma.saves.listCopies();
    expect(savesMessages()).toEqual([{ type: "zaisma:saves-request", requestNumber: 1, request: "list_copies", saveCopyId: undefined }]);
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 1, status: "asking" });
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 1, answer: [{ ...pageCopy, extra: "not handed out" }] });
    const copies = await listing;
    expect(copies).toEqual([pageCopy]);
    expect(Object.keys(copies[0]).sort()).toEqual(fieldsOf("SaveCopy"));
    expect(valuesOf("SaveCopyReason")).toEqual([...SAVE_COPY_REASONS].sort());

    const reading = sdk.Zaisma.saves.getCopy(pageCopy.id);
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 2, answer: { ...pageCopy, localStorageItems: { level: "7" }, indexeddbDatabases: [] } });
    const contents = await reading;
    expect(contents.localStorageItems).toEqual({ level: "7" });
    expect(Object.keys(contents).sort()).toEqual(fieldsOf("SaveCopyContents"));

    const restoring = sdk.Zaisma.saves.restoreCopy(pageCopy.id);
    expect(savesMessages().at(-1)).toEqual({ type: "zaisma:saves-request", requestNumber: 3, request: "restore_copy", saveCopyId: pageCopy.id });
    sdk.page.say({ type: "zaisma:saves-answer", requestNumber: 3, answer: null });
    expect(await restoring).toBeUndefined();

    // What the page refuses comes back with its code; a code that isn't one of its own is request_failed.
    for (const code of ["account_needed", "no_save_copy", "cloud_saves_off", "slow_down", "bad_save_copy_id"]) {
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
      expect(await slow).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("listens for the saves events through the page, and hands them out as the types say", async () => {
    const sdk = loadSdk();
    expect(listed(await refusal(() => sdk.Zaisma.saves.on("notAnEvent", () => {})))).toEqual(fieldsOf("SavesEvents"));
    const listens = () => sdk.page.posted.filter((message) => (message as { request?: string }).request === "listen");
    const pageCopy = { id: "save_copy_k2v9q4x7m1p3w8r5t6y0", savedAt: "2026-10-18T09:00:00.000Z", copyReason: "device", sizeBytes: 80, isCurrentSave: false };
    const conflicts: Record<string, unknown>[] = [];
    const listener = (conflict: Record<string, unknown>) => conflicts.push(conflict);
    expect(sdk.Zaisma.saves.on("conflict", listener)).toBe(sdk.Zaisma.saves);
    sdk.Zaisma.saves.on("conflict", () => {});
    // The page hears once per event.
    expect(listens()).toEqual([{ type: "zaisma:saves-request", requestNumber: 1, request: "listen", eventNames: ["conflict"] }]);
    sdk.page.say({ type: "zaisma:saves-event", eventName: "conflict", event: { winningProgress: "other_device", keptSaveCopy: pageCopy } });
    expect(conflicts).toEqual([{ winningProgress: "other_device", keptSaveCopy: pageCopy }]);
    expect(Object.keys(conflicts[0]!).sort()).toEqual(fieldsOf("SaveConflict"));
    sdk.Zaisma.saves.off("conflict", listener);
    sdk.page.say({ type: "zaisma:saves-event", eventName: "conflict", event: { winningProgress: "this_device", keptSaveCopy: pageCopy } });
    expect(conflicts).toHaveLength(1);

    const changes: Record<string, unknown>[] = [];
    sdk.Zaisma.saves.on("developerChange", (change: Record<string, unknown>) => changes.push(change));
    expect(listens().at(-1)).toMatchObject({ request: "listen", eventNames: ["developerChange"] });
    sdk.page.say({ type: "zaisma:saves-event", eventName: "developerChange", event: { changedAt: "2026-10-18T09:05:00.000Z", keptSaveCopy: null } });
    sdk.page.say({ type: "zaisma:saves-event", eventName: "developerChange", event: { changedAt: "2026-10-18T09:06:00.000Z", keptSaveCopy: pageCopy } });
    expect(changes).toEqual([{ changedAt: "2026-10-18T09:05:00.000Z", keptSaveCopy: null }, { changedAt: "2026-10-18T09:06:00.000Z", keptSaveCopy: pageCopy }]);
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
    for (const [status, code] of [["declined", "sign_in_declined"], ["too_soon", "account_offer_too_soon"], ["cloud_saves_off", "cloud_saves_off"]]) {
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
    // Unmute lifts a session block, telling the room and the page.
    room.unmute("player_bo");
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
    expect(await sdk.Zaisma.invite(room)).toBe("opened");
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:share" });
    sdk.Zaisma.openSafetyPanel(room);
    expect(sdk.page.posted.at(-1)).toEqual({ type: "zaisma:players-open" });
    // A game on its own site has no Zaisma page: it tells none.
    const elsewhere = loadSdk(null);
    const before = elsewhere.page.posted.length;
    await elsewhere.Zaisma.invite(null).catch(() => "failed");
    expect(elsewhere.page.posted.slice(before).filter((message) => ["zaisma:share", "zaisma:players-open"].includes((message as { type: string }).type))).toEqual([]);
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
    say(second.socket, { type: "error", code: "full", message: "This room is full." });
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
    // A private room: friends' Join greys it.
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

  it("what rooms send, as the game server and the rooms Worker declare it", () => {
    expect(fieldsOf("Player")).toEqual(fieldsOf("Player", GAME_SERVER));
    expect(fieldsOf("RoomSettings")).toEqual(fieldsOf("RoomSettings", GAME_SERVER));
    expect(valuesOf("RoomErrorCode")).toEqual(valuesOf("RoomErrorCode", GAME_SERVER));
    expect(valuesOf("RequestErrorCode")).toEqual(valuesOf("RequestErrorCode", GAME_SERVER_REQUESTS));
    expect(valuesOf("ReportReason")).toEqual(valuesOf("PlayerReportReason", CORE_TYPES));
    expect(fieldsOf("ListedRoom")).toEqual([...fieldsOf("ListedRoom", CORE_ROOMS), "inviteUrl"].sort());
    // changedAtMs is the site's own; the rooms Worker leaves it out for games.
    expect(fieldsOf("RoomList")).toEqual(fieldsOf("RoomList", CORE_ROOMS).filter((name) => name !== "changedAtMs"));
  });
});
