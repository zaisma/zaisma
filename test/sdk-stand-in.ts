/**
 * zaisma.js in a stand-in browser, for tests that play the room's side of its WebSocket and the Zaisma
 * page around the game: test/node/sdk-types.test.ts and the v1 lock (test/contracts/rooms-v1.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SDK = readFileSync(join(import.meta.dirname, "../packages/sdk/zaisma.js"), "utf8");

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

