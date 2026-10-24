import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startServer } from "../../packages/game-server/bin/node.js";
import { GameServerError, defineGameServer, generateSigningKey, loadSigningKey, signPass } from "../../packages/game-server/src/internal.ts";
import { parityGameServerOptions, playParity } from "../parity-transcript.ts";

// The parity transcript on the Node runner. test/rooms/sandbox-parity.test.ts plays the same one in Zaisma's sandbox.

const ISSUER = "https://rooms.zaisma.test";
const ORIGIN = "https://arena.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());

describe("the parity transcript, on the Node runner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers the same messages and logs the same errors as Zaisma's sandbox", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const running = startServer({ gameServer: defineGameServer(parityGameServerOptions() as never), gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISSUER, loadPassKeys: async () => [signing.publicKey], roomStateFile: null });
    await new Promise((resolve) => running.httpServer.once("listening", resolve));
    const port = (running.httpServer.address() as { port: number }).port;
    await playParity({
      newPass: async (label) => {
        const now = Math.floor(Date.now() / 1000);
        return signPass(signing, { sub: `player_parity_${label}`, name: label.toUpperCase(), aud: "arena", iss: ISSUER, pass_version_number: 1, kind: "guest", iat: now, exp: now + 60 });
      },
      connect: async () => {
        const socket = new WebSocket(`ws://localhost:${port}/v1/rooms/arena/ABCDEF`, { origin: ORIGIN });
        const inbox: any[] = [];
        const waiters: ((message: any) => void)[] = [];
        socket.on("message", (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.type === "probe") return socket.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
          const waiter = waiters.shift();
          waiter ? waiter(message) : inbox.push(message);
        });
        await new Promise((resolve) => socket.on("open", resolve));
        return { send: (data) => socket.send(data), next: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve) => waiters.push(resolve))), close: () => socket.close(1000) };
      },
      errors: async () => logged.mock.calls.flatMap((call) => call.filter((each): each is GameServerError => each instanceof GameServerError).map((error) => ({ code: error.code, text: error.message }))),
    });
    expect(logged.mock.calls.flat().filter((each) => typeof each === "string" && each.includes("Game server error")).length).toBeGreaterThan(0);
    await running.close();
  });
});
