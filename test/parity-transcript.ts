/**
 * The parity transcript (test/contracts/v1/parity-transcript.json) and the player that plays it against a runtime.
 * Plain TypeScript with no node: imports, so the Node runner's test and Zaisma's sandbox test (in the Workers pool)
 * both use it. Where the rooms transcript (test/rooms-transcript.ts) checks the wire field for field, this checks
 * what a game server's mistakes do: the same messages come out, and the same errors are logged, compared by code
 * and field, never by text.
 */
import { expect } from "vitest";
import parityText from "./contracts/v1/parity-transcript.json?raw";

type ParityStep = {
  client: string;
  note?: string;
  join?: boolean;
  joinData?: unknown;
  say?: string;
  /** The game's messages (their data) that come out of this step, in order. */
  expect?: unknown[];
  /** The room turns the player away with this error code. */
  expectError?: string;
  /** The match ends with this endReason. */
  expectEnded?: string;
};

export type ParityTranscript = { about: string; steps: ParityStep[]; errors: { code: string; field: string }[] };

export function loadParityTranscript(): ParityTranscript {
  return JSON.parse(parityText) as ParityTranscript;
}

/** The game server both runtimes run: the Node runner through defineGameServer, a Zaisma room as the sandboxed server of a game. */
export const PARITY_GAME_SERVER_SOURCE = `export default {
  maximumPlayerCount: 2,
  setup: () => ({ count: 0 }),
  canJoin(state, player, room, joinData) {
    if (joinData && joinData.nothing) return;
    return true;
  },
  onJoin(state, player, room) {
    room.send(player.id, { hello: true });
  },
  onMessage(state, player, room, message) {
    if (message === "ping") {
      room.send(player.id, { pong: state.count + 1 });
      return { count: state.count + 1 };
    }
    if (message === "bad-broadcast") room.broadcast({}, { delivery: "lossy" });
    if (message === "answer-five") return 5;
    if (message === "reserve") {
      room.reserve({ playerIds: [player.id] });
      room.send(player.id, { reserved: true });
    }
    if (message === "count-players") room.send(player.id, { players: room.players.length });
    if (message === "end") room.end("bye");
  },
};`;

/** The same game server as an object, for a runtime that isn't a sandbox. */
export function parityGameServerOptions(): Record<string, unknown> {
  return new Function(`return (${PARITY_GAME_SERVER_SOURCE.replace(/^export default /, "").replace(/;\s*$/, "")});`)() as Record<string, unknown>;
}

export type ParityConnection = {
  send(data: string): void;
  /** The next message, parsed; probes are answered by the driver and never come here. */
  next(): Promise<any>;
  close(): void;
};

export type ParityDriver = {
  /** A guest's pass for the game. */
  newPass(label: string): Promise<string>;
  connect(): Promise<ParityConnection>;
  /** The errors the game's developer has been told of, in order, once there are this many (or the runtime has settled). */
  errors(minimumCount: number): Promise<{ code: string; text: string }[]>;
};

const GAME_MESSAGE_TYPES = ["message", "error", "ended"];

/** The next message that comes from the game or is about the player's seat, skipping the room's own lists. */
async function nextGameMessage(connection: ParityConnection) {
  for (;;) {
    const message = await connection.next();
    if (GAME_MESSAGE_TYPES.includes(message.type)) return message;
  }
}

/** Play the transcript: the same steps, the same messages, the same errors. */
export async function playParity(driver: ParityDriver): Promise<void> {
  const transcript = loadParityTranscript();
  const clients = new Map<string, ParityConnection>();
  for (const step of transcript.steps) {
    const context = step.note ?? `${step.client} ${step.say ?? "joins"}`;
    if (step.join) {
      const connection = await driver.connect();
      clients.set(step.client, connection);
      connection.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: await driver.newPass(step.client), ...(step.joinData !== undefined ? { joinData: step.joinData } : {}) }));
    } else if (step.say !== undefined) {
      clients.get(step.client)!.send(JSON.stringify({ type: "message", data: step.say }));
    }
    const connection = clients.get(step.client)!;
    for (const wanted of step.expect ?? []) {
      const message = await nextGameMessage(connection);
      expect(message, context).toMatchObject({ type: "message", data: wanted });
    }
    if (step.expectError) expect(await nextGameMessage(connection), context).toMatchObject({ type: "error", code: step.expectError });
    if (step.expectEnded) expect(await nextGameMessage(connection), context).toMatchObject({ type: "ended", endReason: step.expectEnded });
  }
  const errors = await driver.errors(transcript.errors.length);
  expect(errors.map((error) => error.code)).toEqual(transcript.errors.map((error) => error.code));
  transcript.errors.forEach((wanted, index) => expect(errors[index]!.text, `${wanted.code} says which call: ${wanted.field}`).toContain(wanted.field));
  for (const connection of clients.values()) connection.close();
}
