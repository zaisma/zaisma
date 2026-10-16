import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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
const CORE_ROOMS = join(ROOT, "packages/core/src/rooms.ts");
const CORE_TYPES = join(ROOT, "packages/core/src/types.ts");
const TEXT_FILTER = join(ROOT, "packages/core/src/text-filter.ts");
const ROOMS_WORKER = join(ROOT, "apps/rooms/src/index.ts");

const program = ts.createProgram([TYPES, GAME_SERVER, CORE_ROOMS, CORE_TYPES, TEXT_FILTER], {
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
 * zaisma.js as on a game's page on Zaisma, in a stand-in browser: the tab already has a guest pass,
 * the test answers for the room's WebSocket and for fetch (no connection, unless it gives an answer),
 * and the page's event listeners are kept for the test to call. null for zaismaConfig: a game hosted
 * somewhere else, which has no __ZAISMA__.
 */
function loadSdk(zaismaConfig: typeof ON_ZAISMA | null = ON_ZAISMA, fetchAnswer: () => Promise<unknown> = () => Promise.reject(new TypeError("Failed to fetch"))) {
  const storage = new Map([["zaisma:pass:test-game", JSON.stringify({ id: "player_ana", name: "Ana", pass: "pass", expiresAt: "2099-01-01T00:00:00Z" })]]);
  const sockets: StandInSocket[] = [];
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const listen = (type: string, listener: (event?: unknown) => void) => void (listeners[type] ??= []).push(listener);
  const window: Record<string, unknown> = { parent: { postMessage() {} }, addEventListener: listen };
  const browser = {
    __ZAISMA__: zaismaConfig,
    fetch: fetchAnswer,
    window,
    document: { hidden: false, addEventListener: listen },
    location: { search: "", href: "https://test-game.games.zaisma.test/" },
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
    setInterval: () => 0,
    clearInterval() {},
    navigator: {},
  };
  new Function(...Object.keys(browser), SDK)(...Object.values(browser));
  return { Zaisma: window.Zaisma as any, sockets, listeners };
}

const me = { id: "player_ana", name: "Ana" };
const settings = { isListed: true, isOpen: true, name: null, labels: {} };

/** Join a room the test plays the server of. */
async function joinedRoom(sdk: ReturnType<typeof loadSdk>) {
  const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sdk.sockets.at(-1)!;
  socket.onopen!();
  say(socket, { type: "welcome", me, players: [me, { id: "player_bo", name: "Bo" }], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null } });
  return { room: await joining, socket };
}

function say(socket: StandInSocket, message: unknown) {
  socket.onmessage!({ data: JSON.stringify(message) });
}

/** The names a refusal lists after "It takes:" or "Rooms have:", sorted. */
function listed(error: unknown): string[] {
  const message = (error as Error).message;
  const list = message.match(/(?:It takes|Rooms have): (.*)\.$/);
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
  });

  it("the options each call takes", async () => {
    const sdk = loadSdk();
    const wrong = { notAnOption: true };
    expect(listed(await refusal(() => sdk.Zaisma.joinRoom(wrong)))).toEqual(fieldsOf("JoinOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.rooms.quickJoin(wrong)))).toEqual(fieldsOf("QuickJoinOptions"));
    expect(listed(await refusal(() => sdk.Zaisma.rooms.list(wrong)))).toEqual(fieldsOf("ListOptions"));
    const { room, socket } = await joinedRoom(sdk);
    expect(listed(await refusal(() => room.kick("player_bo", wrong)))).toEqual(fieldsOf("KickOptions"));
    expect(listed(await refusal(() => room.setInfo(wrong)))).toEqual(fieldsOf("RoomInfo"));
    const move = heard(room, "move", () => say(socket, { type: "move", roomCode: "M2X7Q3" }));
    expect(listed(await refusal(() => (move.join as (options: unknown) => Promise<unknown>)(wrong)))).toEqual(fieldsOf("MoveJoinOptions"));
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

    const sdk = loadSdk();
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ roomCode: "K7Q2MO" }))).toBe("bad_room_code");
    expect(await failureCode(() => sdk.Zaisma.joinRoom({ serverUrl: "play.example.com" }))).toBe("bad_server_url");
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

  it("what rooms send, as the game server and the rooms Worker declare it", () => {
    expect(fieldsOf("Player")).toEqual(fieldsOf("Player", GAME_SERVER));
    expect(fieldsOf("RoomSettings")).toEqual(fieldsOf("RoomSettings", GAME_SERVER));
    expect(valuesOf("RoomErrorCode")).toEqual(valuesOf("RoomErrorCode", GAME_SERVER));
    expect(valuesOf("ReportReason")).toEqual(valuesOf("PlayerReportReason", CORE_TYPES));
    expect(fieldsOf("ListedRoom")).toEqual([...fieldsOf("ListedRoom", CORE_ROOMS), "inviteUrl"].sort());
    // changedAtMs is the site's own; the rooms Worker leaves it out for games.
    expect(fieldsOf("RoomList")).toEqual(fieldsOf("RoomList", CORE_ROOMS).filter((name) => name !== "changedAtMs"));
  });
});
