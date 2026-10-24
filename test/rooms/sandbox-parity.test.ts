import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, it } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import { PARITY_GAME_SERVER_SOURCE, playParity } from "../parity-transcript.ts";

// The parity transcript in Zaisma's sandbox. test/node/runner-parity.test.ts plays the same one on the Node runner.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const SLUG = "parity";
const GAME_ID = "gparity";
const e = env as unknown as Env;

let address = 0;
const nextAddress = () => `198.51.100.${++address % 250}`;

describe("the parity transcript, in Zaisma's sandbox", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("answers the same messages and logs the same errors as the Node runner", async () => {
    await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'vparity', 'own', 'page', 0, 0)").bind(GAME_ID, SLUG, SLUG).run();
    await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('vparity', ?, 'games/vparity', 2, 0, 'approved', 0)").bind(GAME_ID).run();
    await e.GAMES.put("games/vparity/zaisma-server.js", PARITY_GAME_SERVER_SOURCE);
    await playParity({
      newPass: async () => {
        const roomKey = await issueRoomKey(e.DB, GAME_ID);
        const response = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": nextAddress() }, body: JSON.stringify({ gameSlug: SLUG, roomKey }) });
        return (await response.json<{ pass: string }>()).pass;
      },
      connect: async () => {
        const upgraded = await SELF.fetch(`${R}/v1/rooms/${SLUG}/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": nextAddress() } });
        const socket = upgraded.webSocket!;
        socket.accept();
        const inbox: any[] = [];
        const waiters: ((message: any) => void)[] = [];
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data as string);
          if (message.type === "probe") return socket.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
          const waiter = waiters.shift();
          waiter ? waiter(message) : inbox.push(message);
        });
        return { send: (data) => socket.send(data), next: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve) => waiters.push(resolve))), close: () => socket.close(1000) };
      },
      errors: async (minimumCount) => {
        // The room hands its errors to the table a moment after the call that made them.
        for (let tries = 0; tries < 100; tries++) {
          const { results } = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = ? ORDER BY first_at_ms, rowid").bind(GAME_ID).all<{ message: string }>();
          if (results.length >= minimumCount) return results.map((row) => ({ code: /\((bad_room_call|room_call_limit|room_call_unavailable|bad_handler_answer|unknown_option|bad_option)\)/.exec(row.message)?.[1] ?? "", text: row.message }));
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return [];
      },
    });
  });
});
