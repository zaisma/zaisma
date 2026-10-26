/**
 * The v1 rooms transcript (test/contracts/v1/rooms-transcript.json) and the player that plays it against a runtime.
 * Plain TypeScript with no node: imports, so both test projects can use it: the Node runner's (test/node/runner.test.ts)
 * and Zaisma rooms' on Durable Objects (test/rooms/rooms.test.ts, in the Workers pool).
 *
 * The transcript is an ordered exchange for one wire: what a client sends and what the room says back, field for field.
 * Each runtime gives the player a driver (how to connect, make a player and do the few things a client can't do, like
 * publishing a version). The player sends the client's steps, takes the next message for each receive step (probes
 * are answered and left out by the drivers), swaps the values that change from run to run for placeholders, and
 * checks the whole message equals what the transcript says: the same keys, the same values.
 *
 * Placeholders (what a value is replaced with before it's compared):
 *   "<playerId:a>"    the ID of the player named a in the transcript ("a", "b", "c" are labels, not names)
 *   "<playerName:a>"  that player's name
 *   "<roomCode>"      the scene's room code
 *   "<isoTime>"       any ISO 8601 time
 *   "<ms>"            a number of milliseconds under a key ending in "Ms" (a clock reading or a ping), null stays null
 * In what a client sends, "<pass:a>" is that player's real pass.
 */
import { expect } from "vitest";
import transcriptText from "./contracts/v1/rooms-transcript.json?raw";

export type TranscriptRuntime = "node" | "rooms";

/** One step of a scene: who does what, and optionally which runtimes can do it. */
export type TranscriptStep = {
  runtimes?: TranscriptRuntime[];
  /** Why this step is here, for the person reading the JSON. */
  note?: string;
  /** Who the step is about, a label like "a". Not needed for an action. */
  client?: string;
  /** Open a connection: to the game's room, to a second room of the same game, from a site the game isn't on, or to a game that doesn't exist. */
  connect?: "room" | "other_room" | "other_site" | "unknown_game";
  /** Send this JSON message (with "<pass:a>" in a hello's pass swapped for the real pass). */
  send?: unknown;
  /** Send these bytes as a binary frame. */
  sendBytes?: number[];
  /** The next message from the room, with placeholders. */
  receive?: unknown;
  /** Close the connection with this code, as a player's game does. */
  close?: number;
  /** The room closes the connection with this code. */
  closedWith?: number;
  /** Something no client can do: the runtime's driver does it. */
  action?: TranscriptAction;
};

export type TranscriptAction = "publish_version_now" | "version_time_comes";

export type TranscriptScene = { name: string; runtimes?: TranscriptRuntime[]; steps: TranscriptStep[] };
export type Transcript = { protocolVersionNumber: number; about: string; scenes: TranscriptScene[] };

export function loadTranscript(): Transcript {
  return JSON.parse(transcriptText) as Transcript;
}

/** The game server both runtimes run: a Node runner through defineGameServer, a Zaisma room as the sandboxed server of a game. */
export const TRANSCRIPT_GAME_SERVER_SOURCE = `export default {
  maximumPlayerCount: 2,
  hostControlsEnabled: true,
  setup: () => ({}),
  onMessage(state, player, room, message) {
    if (message === "end") room.end("The match is over.");
    else room.broadcast(message, { exceptPlayerId: player.id, fromPlayerId: player.id });
    return state;
  },
};`;

/** The same game server as an object, for a runtime that isn't a sandbox. */
export function transcriptGameServerOptions(): Record<string, unknown> {
  return new Function(`return (${TRANSCRIPT_GAME_SERVER_SOURCE.replace(/^export default /, "").replace(/;\s*$/, "")});`)() as Record<string, unknown>;
}

/** Each scene gets a room of its own, in order. */
export const TRANSCRIPT_ROOM_CODES = ["ABCDEF", "BCDEFG", "CDEFGH", "DEFGHJ", "EFGHJK"];

export type TranscriptPlayer = { playerId: string; name: string; pass: string };

export type TranscriptConnection = {
  send(data: string | Uint8Array): void;
  /** The next message, parsed; probes are answered by the driver and never come here. */
  next(): Promise<unknown>;
  closed: Promise<number>;
  close(code: number): void;
};

export type TranscriptDriver = {
  runtime: TranscriptRuntime;
  /** Make a player: a guest with a pass for the transcript's game. */
  newPlayer(label: string): Promise<TranscriptPlayer>;
  connect(how: "room" | "other_site" | "unknown_game", roomCode: string): Promise<TranscriptConnection>;
  action(action: TranscriptAction, roomCode: string): Promise<void>;
};

const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** A message from the room with what changes from run to run replaced by placeholders. */
export function normalizeMessage(value: unknown, context: { players: Map<string, TranscriptPlayer>; roomCode: string }, key = ""): unknown {
  if (typeof value === "string") {
    for (const [label, player] of context.players) {
      if (value === player.playerId) return `<playerId:${label}>`;
      if (value === player.name) return `<playerName:${label}>`;
    }
    if (value === context.roomCode) return "<roomCode>";
    return ISO_TIME.test(value) ? "<isoTime>" : value;
  }
  if (typeof value === "number" && key.endsWith("Ms")) return "<ms>";
  if (Array.isArray(value)) return value.map((item) => normalizeMessage(item, context, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, normalizeMessage(inner, context, name)]));
  return value;
}

/** What a client sends, with each "<pass:a>" swapped for that player's pass. */
export function fillPasses(value: unknown, players: Map<string, TranscriptPlayer>): unknown {
  if (typeof value === "string") {
    const label = /^<pass:(\w+)>$/.exec(value)?.[1];
    return label === undefined ? value : players.get(label)!.pass;
  }
  if (Array.isArray(value)) return value.map((item) => fillPasses(item, players));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, fillPasses(inner, players)]));
  return value;
}

const runsHere = (runtimes: TranscriptRuntime[] | undefined, runtime: TranscriptRuntime) => !runtimes || runtimes.includes(runtime);

/** The labels of the players a scene's clients send passes for. */
function passLabelsOf(scene: TranscriptScene): string[] {
  return [...new Set([...JSON.stringify(scene).matchAll(/<pass:(\w+)>/g)].map((found) => found[1]!))];
}

function withinSeconds<T>(promise: Promise<T>, seconds: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => void (timer = setTimeout(() => reject(new Error(`${what}: nothing came in ${seconds} seconds`)), seconds * 1000)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Play the transcript against a runtime: every receive step must be the next message, equal field for field. */
export async function playTranscript(driver: TranscriptDriver): Promise<{ stepCount: number; skippedStepCount: number }> {
  const transcript = loadTranscript();
  let stepCount = 0;
  let skippedStepCount = 0;
  for (const [sceneIndex, scene] of transcript.scenes.entries()) {
    if (!runsHere(scene.runtimes, driver.runtime)) {
      skippedStepCount += scene.steps.length;
      continue;
    }
    const roomCode = TRANSCRIPT_ROOM_CODES[sceneIndex]!;
    const players = new Map<string, TranscriptPlayer>();
    for (const label of passLabelsOf(scene)) players.set(label, await driver.newPlayer(label));
    const connections = new Map<string, TranscriptConnection>();
    for (const [stepIndex, step] of scene.steps.entries()) {
      if (!runsHere(step.runtimes, driver.runtime)) {
        skippedStepCount++;
        continue;
      }
      stepCount++;
      const where = `${driver.runtime}, scene "${scene.name}", step ${stepIndex + 1} ${JSON.stringify({ ...step, note: undefined })}`;
      if (step.action) {
        await driver.action(step.action, roomCode);
        continue;
      }
      const label = step.client!;
      if (step.connect) {
        // A second room of the game is the next scene's room code, which no scene is using while this one plays.
        connections.set(label, step.connect === "other_room" ? await driver.connect("room", TRANSCRIPT_ROOM_CODES[sceneIndex + 1]!) : await driver.connect(step.connect, roomCode));
        continue;
      }
      const connection = connections.get(label);
      if (!connection) throw new Error(`${where}: client ${label} isn't connected`);
      if (step.send !== undefined) connection.send(JSON.stringify(fillPasses(step.send, players)));
      else if (step.sendBytes) connection.send(new Uint8Array(step.sendBytes));
      else if (step.receive !== undefined) {
        const message = await withinSeconds(connection.next(), 4, where);
        expect(normalizeMessage(message, { players, roomCode }), where).toEqual(step.receive);
      } else if (step.close !== undefined) connection.close(step.close);
      else if (step.closedWith !== undefined) expect(await withinSeconds(connection.closed, 4, where), where).toBe(step.closedWith);
      else throw new Error(`${where}: a step must do something`);
    }
    for (const connection of connections.values()) {
      try {
        connection.close(1000);
      } catch {
        // Already closed.
      }
    }
  }
  return { stepCount, skippedStepCount };
}
