import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The relay script that goes first in every game page (packages/sdk/relay.js), run against a stand-in window.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../packages/sdk/relay.js"), "utf8");
const SITE = "https://zaisma.test";
const ZAISMA_RELAY = { urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "zaisma-user", credential: "zaisma-secret" };

type Configuration = { iceServers?: { urls: string | string[]; username?: string; credential?: string }[]; iceTransportPolicy?: string; iceCandidatePoolSize?: number; bundlePolicy?: string };

/** A browser's RTCPeerConnection, as far as the relay script sees it: what it was configured with when it gathered addresses. */
function browserPeerConnection() {
  return class RTCPeerConnection {
    configuration: Configuration;
    gatheredWith: Configuration[] = [];
    signalingState = "stable";
    constructor(configuration: Configuration = {}) {
      this.configuration = { ...configuration };
    }
    getConfiguration() {
      return { ...this.configuration };
    }
    setConfiguration(configuration: Configuration) {
      this.configuration = { ...configuration };
    }
    createOffer() {
      this.gatheredWith.push(this.getConfiguration());
      return Promise.resolve({ type: "offer", sdp: "v=0" });
    }
    createAnswer() {
      this.gatheredWith.push(this.getConfiguration());
      return Promise.resolve({ type: "answer", sdp: "v=0" });
    }
    setLocalDescription() {
      this.gatheredWith.push(this.getConfiguration());
      return Promise.resolve();
    }
    static generateCertificate() {
      return Promise.resolve("certificate");
    }
  };
}

type Native = ReturnType<typeof browserPeerConnection>;

/** A game page inside the Zaisma game page (or, with onZaisma false, opened on its own), with the relay script run in it. */
function gamePage(options: { onZaisma?: boolean; relayAnswer?: () => Response; config?: Record<string, unknown>; globals?: Record<string, unknown> } = {}) {
  const listeners: ((event: unknown) => void)[] = [];
  const warnings: string[] = [];
  const relayRequests: Record<string, unknown>[] = [];
  const stored = new Map<string, string>();
  const parent = {
    postMessage(message: { type: string }, origin: string) {
      if (message.type !== "zaisma:room-key" || origin !== SITE) return;
      setTimeout(() => listeners.slice().forEach((listener) => listener({ origin: SITE, source: parent, data: { type: "zaisma:room-key", key: "room_key_test", playerKind: "guest" } })));
    },
  };
  const Original = browserPeerConnection();
  const window: Record<string, unknown> = {
    console: { warn: (message: string) => warnings.push(message) },
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, listener: (event: unknown) => void) => type === "message" && listeners.push(listener),
    removeEventListener: (type: string, listener: (event: unknown) => void) => listeners.splice(listeners.indexOf(listener) >>> 0, 1),
    sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
    fetch: async (url: string, init: { body: string }) => {
      relayRequests.push({ url, ...JSON.parse(init.body) });
      return options.relayAnswer ? options.relayAnswer() : Response.json({ iceServers: [ZAISMA_RELAY], expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString() });
    },
  };
  Object.assign(window, options.globals);
  window.parent = options.onZaisma === false ? window : parent;
  // Like a browser's: a plain property of the window, writable and configurable.
  Object.defineProperty(window, "RTCPeerConnection", { value: Original, writable: true, configurable: true, enumerable: false });
  const config = { rooms: "https://rooms.zaisma.test", game: "arena", site: SITE, ownRelayHosts: ["turn.example.com"], fetchEarly: false, ...options.config };
  new Function("__ZAISMA_RELAY__", "window", source)(config, window);
  return { window, Original, PeerConnection: window.RTCPeerConnection as Native, warnings, relayRequests };
}

const GAME_ASKS: Configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: ["turn:turn.example.com:3478", "turn:somewhere-else.example:3478"], username: "own", credential: "own-secret" },
    { urls: "turn:openrelay.example:80", username: "free", credential: "free" },
  ],
  iceCandidatePoolSize: 4,
  bundlePolicy: "max-bundle",
};
const GAMES_OWN_RELAY = { urls: ["turn:turn.example.com:3478"], username: "own", credential: "own-secret" };

describe("the relay script", () => {
  it("relays a connection made before it has servers, with Zaisma's relay and the game's own, by its first offer", async () => {
    const page = gamePage();
    const connection = new page.PeerConnection(GAME_ASKS) as InstanceType<Native>;
    // Nothing is gathered yet: only the relay, with what's there, and no gathering ahead of time.
    expect(connection.getConfiguration()).toEqual({ iceTransportPolicy: "relay", iceServers: [GAMES_OWN_RELAY], iceCandidatePoolSize: 0, bundlePolicy: "max-bundle" });
    await connection.createOffer();
    expect(connection.gatheredWith).toEqual([{ iceTransportPolicy: "relay", iceServers: [ZAISMA_RELAY, GAMES_OWN_RELAY], iceCandidatePoolSize: 4, bundlePolicy: "max-bundle" }]);
    expect(page.relayRequests).toEqual([{ url: "https://rooms.zaisma.test/v1/relay", gameSlug: "arena", roomKey: "room_key_test" }]);
  });

  it("gives later connections the servers straight away, keeps them for the tab, and still looks like the browser's own", async () => {
    const page = gamePage();
    await new page.PeerConnection().createAnswer();
    const connection = new page.PeerConnection({ iceServers: [{ urls: "stun:stun.example" }] });
    expect(connection.getConfiguration()).toEqual({ iceTransportPolicy: "relay", iceServers: [ZAISMA_RELAY] });
    await connection.setLocalDescription();
    expect(page.relayRequests).toHaveLength(1);
    expect(connection).toBeInstanceOf(page.Original);
    expect(connection).toBeInstanceOf(page.PeerConnection);
    expect(Object.getPrototypeOf(connection).constructor).toBe(page.PeerConnection);
    expect(await (page.PeerConnection as unknown as { generateCertificate: () => Promise<string> }).generateCertificate()).toBe("certificate");
    // A game's own class on top of it works too.
    class Mine extends page.PeerConnection {}
    const mine = new Mine({ iceServers: [] });
    expect(mine).toBeInstanceOf(Mine);
    expect(mine.getConfiguration().iceTransportPolicy).toBe("relay");
  });

  it("asks for servers while the game loads when it plays online", async () => {
    const page = gamePage({ config: { fetchEarly: true } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.relayRequests).toHaveLength(1);
    expect(new page.PeerConnection().getConfiguration().iceServers).toEqual([ZAISMA_RELAY]);
  });

  it("keeps the relay when the game changes its servers, or a library wraps RTCPeerConnection, and never gives the original back", async () => {
    const page = gamePage();
    const connection = new page.PeerConnection();
    await connection.createOffer();
    connection.setConfiguration({ iceServers: [{ urls: "stun:stun.example" }], iceTransportPolicy: "all" });
    expect(connection.getConfiguration()).toEqual({ iceTransportPolicy: "relay", iceServers: [ZAISMA_RELAY] });
    // Like webrtc-adapter: its own function around the one it finds.
    const Found = page.window.RTCPeerConnection as Native;
    const Adapter = function (configuration: Configuration) {
      return new Found(configuration);
    } as unknown as Native;
    page.window.RTCPeerConnection = Adapter;
    expect(page.window.RTCPeerConnection).toBe(Adapter);
    expect(new (page.window.RTCPeerConnection as Native)({ iceTransportPolicy: "all" }).getConfiguration().iceTransportPolicy).toBe("relay");
    page.window.RTCPeerConnection = page.Original;
    expect(page.window.RTCPeerConnection).toBe(page.PeerConnection);
  });

  it("relays a connection made with the original too, before it gathers", async () => {
    const page = gamePage();
    const connection = new page.Original({ iceServers: [{ urls: "stun:stun.example" }], iceTransportPolicy: "all" });
    await connection.createOffer();
    expect(connection.gatheredWith).toEqual([{ iceTransportPolicy: "relay", iceServers: [ZAISMA_RELAY] }]);
  });

  it("refuses to gather when a connection can't be set to relay", async () => {
    const page = gamePage();
    const connection = new page.Original({ iceTransportPolicy: "all" });
    // A browser that won't take the change.
    Object.defineProperty(connection, "configuration", { get: () => ({ iceTransportPolicy: "all" }), set: () => {} });
    await expect(connection.createOffer()).rejects.toThrow(/only through Zaisma's relay/);
    expect(connection.gatheredWith).toEqual([]);
  });

  it("doesn't connect, rather than connect directly, when there's no relay to be had", async () => {
    const offZaisma = gamePage({ onZaisma: false });
    const connection = new offZaisma.PeerConnection(GAME_ASKS);
    await connection.createOffer();
    expect(connection.gatheredWith).toEqual([{ iceTransportPolicy: "relay", iceServers: [GAMES_OWN_RELAY], iceCandidatePoolSize: 0, bundlePolicy: "max-bundle" }]);
    expect(offZaisma.relayRequests).toEqual([]);
    expect(offZaisma.warnings).toEqual([expect.stringContaining("work when the game is played on Zaisma")]);

    const pastFreeTier = gamePage({ relayAnswer: () => Response.json({ error: { code: "month_limit", message: "This game has used this month's multiplayer time." } }, { status: 403 }) });
    const refused = new pastFreeTier.PeerConnection();
    await refused.createOffer();
    await new pastFreeTier.PeerConnection().createOffer();
    expect(refused.gatheredWith).toEqual([{ iceTransportPolicy: "relay", iceServers: [], iceCandidatePoolSize: 0 }]);
    // One ask, not one per connection, and one warning.
    expect(pastFreeTier.relayRequests).toHaveLength(1);
    expect(pastFreeTier.warnings).toEqual([expect.stringContaining("used this month's multiplayer time")]);
  });

  it("wraps the RTCPeerConnection of a frame the game makes, as soon as the game reaches into it", async () => {
    const FrameOriginal = browserPeerConnection();
    const frameWindow: Record<string, unknown> = {};
    Object.defineProperty(frameWindow, "RTCPeerConnection", { value: FrameOriginal, writable: true, configurable: true });
    class HTMLIFrameElement {
      get contentWindow() {
        return frameWindow;
      }
    }
    const page = gamePage({ globals: { HTMLIFrameElement } });
    const FromFrame = (new HTMLIFrameElement().contentWindow as { RTCPeerConnection: Native }).RTCPeerConnection;
    expect(FromFrame).not.toBe(FrameOriginal);
    const connection = new FromFrame({ iceTransportPolicy: "all" });
    await connection.createOffer();
    expect(connection.gatheredWith).toEqual([{ iceTransportPolicy: "relay", iceServers: [ZAISMA_RELAY], iceCandidatePoolSize: 0 }]);
    expect(page.relayRequests).toHaveLength(1);
  });
});
