/**
 * zaisma.js in a stand-in browser, for tests that play the room's side of its WebSocket and the Zaisma
 * page around the game: test/node/sdk-types.test.ts and the v1 lock (test/contracts/rooms-v1.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const SDK = readFileSync(join(ROOT, "packages/sdk/zaisma.js"), "utf8");

// The SDK's types, read by the compiler: what the stand-in's answers are checked against.
export const TYPES = join(ROOT, "packages/sdk/zaisma.d.ts");
export const GAME_SERVER = join(ROOT, "packages/game-server/src/room.ts");
export const GAME_SERVER_REQUESTS = join(ROOT, "packages/game-server/src/requests.ts");
export const CORE_ROOMS = join(ROOT, "packages/core/src/rooms.ts");
export const CORE_TYPES = join(ROOT, "packages/core/src/types.ts");
export const TEXT_FILTER = join(ROOT, "packages/core/src/text-filter.ts");

let program: ts.Program | null = null;
/** One compiler over the SDK's types and the shapes rooms send, made the first time a test asks. */
export function sdkTypeProgram(): ts.Program {
  program ??= ts.createProgram([TYPES, GAME_SERVER, GAME_SERVER_REQUESTS, CORE_ROOMS, CORE_TYPES, TEXT_FILTER], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    types: [],
  });
  return program;
}
export function sdkTypeChecker(): ts.TypeChecker {
  return sdkTypeProgram().getTypeChecker();
}

/** A declaration's members: the Zaisma namespace's in zaisma.d.ts, or a module's exports. */
export function membersOf(file: string): ts.Symbol[] {
  const checker = sdkTypeChecker();
  const source = sdkTypeProgram().getSourceFile(file)!;
  if (file !== TYPES) return checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
  const namespace = source.statements.find((statement): statement is ts.ModuleDeclaration => ts.isModuleDeclaration(statement) && statement.name.text === "Zaisma")!;
  return checker.getExportsOfModule(checker.getSymbolAtLocation(namespace.name)!);
}

export function declaredType(file: string, name: string): ts.Type {
  const symbol = membersOf(file).find((member) => member.name === name && member.flags & ts.SymbolFlags.Type);
  if (!symbol) throw new Error(`${file} declares no type ${name}`);
  return sdkTypeChecker().getDeclaredTypeOfSymbol(symbol);
}

/** The field names of a shape, sorted. */
export function fieldsOf(name: string, file = TYPES): string[] {
  return sdkTypeChecker()
    .getPropertiesOfType(declaredType(file, name))
    .map((property) => property.name)
    .sort();
}

/** The values of a union of string literals, sorted. */
export function valuesOf(name: string, file = TYPES): string[] {
  const type = declaredType(file, name);
  return (type.isUnion() ? type.types : [type]).map((part) => String((part as ts.StringLiteralType).value)).sort();
}


export interface StandInSocket {
  url: string;
  sent: string[];
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export const ON_ZAISMA = { rooms: "https://rooms.zaisma.test", game: "test-game", site: "https://zaisma.test" };

/**
 * zaisma.js as on a game's page on Zaisma, in a stand-in browser: the tab already has a guest pass and
 * the page hands over a guest's room key, the test answers for the room's WebSocket and for fetch (no
 * connection, unless it gives an answer), and the page's event listeners are kept for the test to
 * call. null for zaismaConfig: a game hosted somewhere else, which has no __ZAISMA__.
 */
/** A page element that takes what the SDK's plates do to one. */
function element(): Record<string, unknown> {
  return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, querySelector: () => null };
}

export function loadSdk(zaismaConfig: typeof ON_ZAISMA | null = ON_ZAISMA, fetchAnswer: () => Promise<unknown> = () => Promise.reject(new TypeError("Failed to fetch")), playerKind = "guest", search = "") {
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
    // Enough of a page for Zaisma's own plates (the "Still there?" one) to come and go.
    document: { hidden: false, addEventListener: listen, getElementById: () => null, createElement: element, body: element() },
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

export const me = { id: "player_ana", name: "Ana", kind: "guest" };
export const settings = { isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {} };

/** Join a room the test plays the server of. */
export async function joinedRoom(sdk: ReturnType<typeof loadSdk>) {
  const joining = sdk.Zaisma.joinRoom({ roomCode: "K7Q2MX" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = sdk.sockets.at(-1)!;
  socket.onopen!();
  say(socket, { type: "welcome", me, players: [me, { id: "player_bo", name: "Bo", kind: "account" }], room: settings, hostPlayerId: null, awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null } });
  return { room: await joining, socket };
}

export function say(socket: StandInSocket, message: unknown) {
  socket.onmessage!({ data: JSON.stringify(message) });
}

