import { defineGameServer, type AwayReason, type GameServer, type JoinInfo, type Player, type Room } from "@zaisma/game-server";
import { SANDBOX_GAME_SERVER, manifestKey, serverModules, type Manifest } from "@zaisma/core";
import type { Env } from "./index.ts";

/**
 * Developers' own game servers, run in a Dynamic Worker: a sealed sandbox with no internet, no
 * bindings and a CPU limit. A game opts in with multiplayer_mode "own" and its game server in its
 * upload: a zaisma-server/ folder (index.js, importing the folder's other .js files by relative
 * path) or one zaisma-server.js. ES modules whose default export is the game server.
 *
 * The room (our Durable Object) still owns everything players touch: sockets, passes, limits,
 * mute, block and report. The sandbox only runs the game's handlers: each call gets the state and
 * a copy of the room, and hands back the new state plus what the game asked the room to do
 * (broadcast, send, end, kick, ...), which the room then does; canJoin only answers yes or no.
 * A room opens one session with the sandbox
 * when it wakes and makes every call through it, so a room is billed one request per wake rather
 * than one per message or tick.
 */

export const SANDBOX = SANDBOX_GAME_SERVER;
/**
 * CPU per call into the sandbox. Cloudflare stops a call that runs on, but in practice only after
 * about 2 seconds whatever this says (tested Oct 13, 2026), so the room also gives up on a game
 * server that's stopped this often (FAILURES): a stuck one can't keep freezing its rooms or burning CPU.
 */
const CPU_MS = 50;
const FAILURES = 2;

/** What the game asked the room to do during one handler, in order. */
type Effect =
  | { do: "broadcast"; messageData: unknown; options: unknown }
  | { do: "send"; playerId: unknown; messageData: unknown }
  | { do: "end"; message: unknown }
  | { do: "set_listed"; isListed: boolean }
  | { do: "set_open"; isOpen: boolean }
  | { do: "set_name"; name: unknown }
  | { do: "set_labels"; labels: unknown }
  | { do: "reserve"; options: unknown; roomCode: string }
  | { do: "kick"; playerId: unknown; options: unknown }
  | { do: "move_to"; roomCode: unknown; options: unknown };

interface Snapshot {
  players: Player[];
  isListed: boolean;
  isOpen: boolean;
  name: string | null;
  labels: Record<string, string>;
}

interface Answer {
  state?: unknown;
  effects: Effect[];
  error?: string;
}

/** Stands in for a handler in the game server's options, as the sandbox describes them (Session.options). */
const HANDLER = "(handler)";

export interface Session {
  /** The game server's options as the developer wrote them, with each handler as HANDLER, so the room checks them like any game server's. */
  options(): Promise<Record<string, unknown>>;
  setup(startData: unknown): Promise<Answer>;
  call(hook: string, state: unknown, args: unknown[], room: Snapshot): Promise<Answer>;
  /** canJoin: the game's answer on a player coming in. It can't change the state or the room. */
  check(state: unknown, player: Player, joinData: unknown, room: Snapshot, joinInfo: JoinInfo): Promise<{ answer?: unknown; error?: string }>;
}

// Runs inside the sandbox, beside the game's file. Plain JavaScript: nothing here is trusted by the
// room, which checks everything it's handed back like any message from a player.
const harness = (entry: string) => `
import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";
import server from "./${entry}";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => ALPHABET[byte & 31]).join("");
const HOOKS = ["onJoin", "onLeave", "onMessage", "onTick", "onMoved", "onAway", "onBack"];

// Options a call doesn't take throw here, inside the game's handler, so the error shows with its line.
function closed(options, allowed, what) {
  if (options === undefined || options === null) return;
  const unknown = typeof options === "object" && !Array.isArray(options) ? Object.keys(options).filter((name) => !allowed.includes(name)) : [];
  if (unknown.length) throw new Error(what + " doesn't take " + unknown.join(", ") + ". It takes " + allowed.join(", ") + ".");
}

function recorder(snapshot, effects) {
  const room = {
    get players() { return snapshot.players.map((player) => ({ ...player })); },
    broadcast(messageData, options) { closed(options, ["exceptPlayerId"], "room.broadcast"); effects.push({ do: "broadcast", messageData, options }); },
    send(playerId, messageData) { effects.push({ do: "send", playerId, messageData }); },
    end(message) { effects.push({ do: "end", message }); },
    get isListed() { return snapshot.isListed; },
    setListed(isListed) { snapshot.isListed = Boolean(isListed); effects.push({ do: "set_listed", isListed: snapshot.isListed }); },
    get isOpen() { return snapshot.isOpen; },
    setOpen(isOpen) { snapshot.isOpen = Boolean(isOpen); effects.push({ do: "set_open", isOpen: snapshot.isOpen }); },
    get name() { return snapshot.name; },
    get labels() { return { ...snapshot.labels }; },
    setName(name) { effects.push({ do: "set_name", name }); },
    setLabels(labels) { effects.push({ do: "set_labels", labels }); },
    reserve(options) {
      closed(options, ["playerIds", "startData", "isListed", "name", "labels"], "room.reserve");
      const roomCode = newRoomCode();
      effects.push({ do: "reserve", options, roomCode });
      return roomCode;
    },
    kick(playerId, options) { closed(options, ["message", "keepOut"], "room.kick"); effects.push({ do: "kick", playerId, options }); },
    moveTo(roomCode, options) { closed(options, ["playerIds", "joinData"], "room.moveTo"); effects.push({ do: "move_to", roomCode, options }); },
  };
  return room;
}

function answer(fn, effects, state) {
  try {
    const next = fn();
    return { state: next === undefined ? state : next, effects };
  } catch (error) {
    return { effects, error: String((error && error.stack) || error) };
  }
}

class Session extends RpcTarget {
  options() {
    const options = {};
    for (const [name, value] of Object.entries(server)) {
      options[name] = typeof value === "function" ? "${HANDLER}" : ["number", "string", "boolean"].includes(typeof value) || value === null || value === undefined ? value : "(" + typeof value + ")";
    }
    // A game server written as a class keeps its handlers on the prototype.
    for (const name of ["setup", "canJoin", ...HOOKS]) if (typeof server[name] === "function") options[name] = "${HANDLER}";
    return options;
  }
  setup(startData) {
    return answer(() => server.setup(startData), [], undefined);
  }
  call(hook, state, args, snapshot) {
    const effects = [];
    if (!HOOKS.includes(hook) || typeof server[hook] !== "function") return { state, effects };
    const room = recorder(snapshot, effects);
    // onJoin(state, player, room, joinData, joinInfo), onLeave(state, player, room, leaveInfo), onAway(state, player, room, awayReason),
    // onMessage(state, player, messageData, room), onTick(state, tickDurationSec, room), onMoved(state, moveResult, room), onBack(state, player, room)
    const full =
      hook === "onJoin" ? [state, args[0], room, args[1], args[2]]
      : hook === "onMessage" ? [state, args[0], args[1], room]
      : hook === "onLeave" || hook === "onAway" ? [state, args[0], room, args[1]]
      : [state, args[0], room];
    return answer(() => server[hook](...full), effects, state);
  }
  check(state, player, joinData, snapshot, joinInfo) {
    if (typeof server.canJoin !== "function") return { answer: true };
    try {
      const given = server.canJoin(state, player, recorder(snapshot, []), joinData, joinInfo);
      if (given === true || given === false || given === undefined || given === null) return { answer: given !== false };
      if (given && typeof given === "object" && typeof given.refusalMessage === "string") return { answer: { refusalMessage: given.refusalMessage } };
      return { answer: false, error: "canJoin must answer true, false or { refusalMessage }, not " + (typeof given === "string" ? JSON.stringify(given.slice(0, 60)) : typeof given) };
    } catch (error) {
      return { error: String((error && error.stack) || error) };
    }
  }
}

export default class extends WorkerEntrypoint {
  open() {
    if (!server || typeof server.setup !== "function") throw new Error("${entry} must export default a game server with a setup() function");
    return new Session();
  }
}
`;

/** A version's game server files and their code, or null if it has none (or too much). */
async function serverCode(env: Env, versionId: string): Promise<{ entry: string; modules: Record<string, string | WorkerLoaderModule> } | null> {
  const version = await env.DB.prepare("SELECT id, kind, r2_prefix FROM versions WHERE id = ?").bind(versionId).first<{ id: string; kind: "zip" | "files"; r2_prefix: string }>();
  if (!version) return null;
  const manifest = version.kind === "files" ? ((await (await env.GAMES.get(manifestKey(version.id)))?.json<Manifest>()) ?? null) : null;
  const found = await serverModules(env.GAMES, version, manifest);
  if (!found || "error" in found) return null;
  const modules: Record<string, string | WorkerLoaderModule> = {};
  for (const f of found.files) {
    const object = await env.GAMES.get(f.key);
    if (!object) return null;
    // import levels from "./levels.json" gives the data; import physics from "./physics.wasm" a WebAssembly.Module.
    if (f.path.endsWith(".wasm")) modules[f.path] = { wasm: await object.arrayBuffer() };
    else if (f.path.endsWith(".json")) {
      try {
        modules[f.path] = { json: JSON.parse(await object.text()) };
      } catch {
        throw new Error(`${f.path} isn't valid JSON`);
      }
    } else modules[f.path] = { js: await object.text() };
  }
  return { entry: found.entry, modules };
}

/**
 * Open a session with a game version's server in its sandbox, and wrap it as a game server the room
 * can run. One sandbox per game version, shared by all its rooms in a place, and warm while in use.
 * Null if the version has no game server file.
 */
export async function sandboxServer(env: Env, gameId: string, versionId: string, onBroken: () => void): Promise<GameServer | null> {
  const code = await serverCode(env, versionId);
  if (code === null) return null;
  const worker = env.LOADER.get(`${gameId}:${versionId}`, () => ({
    compatibilityDate: "2026-10-01",
    mainModule: "harness.js",
    // The game's files keep their paths, so its relative imports work: ./physics.js from zaisma-server/index.js.
    modules: { ...code.modules, "harness.js": harness(code.entry) },
    // No internet and no bindings: the game server can only answer the room.
    globalOutbound: null,
    env: {},
    limits: { cpuMs: CPU_MS },
  }));
  return wrapSession(() => (worker.getEntrypoint() as unknown as { open(): Promise<Session> }).open(), onBroken);
}

/**
 * A game server that runs its handlers through a session with the sandbox. If the sandbox itself
 * fails (over its CPU limit, or restarted), that call is lost and the next gets a fresh session;
 * after FAILURES of those, onBroken is called once and every later call fails at once.
 */
export async function wrapSession(open: () => Promise<Session>, onBroken: () => void): Promise<GameServer & { stats: SandboxStats }> {
  let session = await open();
  // The options as the developer wrote them, checked like any game server's: names it doesn't take and values out of range throw.
  const declared = await session.options();
  const definition = defineGameServer(Object.fromEntries(Object.entries(declared).map(([name, value]) => [name, value === HANDLER ? () => undefined : value])) as unknown as GameServer);
  const has = (name: string) => declared[name] === HANDLER;
  const stats: SandboxStats = { calls: 0, ms: 0, failures: 0, crashes: 0, stops: 0, errors: new Map() };
  const record = (kind: "crash" | "stopped", text: string) => {
    const message = errorLine(text);
    const seen = stats.errors.get(`${kind}\n${message}`);
    if (seen) seen.count++;
    // A room keeps a handful of distinct errors; a game that throws a new message every tick can't fill the table.
    else if (stats.errors.size < MAX_ERRORS) stats.errors.set(`${kind}\n${message}`, { kind, message, count: 1, first: Date.now() });
  };

  /** One call into the sandbox, counting it and handling a sandbox that fails. */
  const reach = async <T extends { error?: string }>(work: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    if (stats.failures >= FAILURES) throw new Error("This game's server stopped working");
    let answer: T;
    try {
      answer = await work();
    } catch (error) {
      stats.stops++;
      record("stopped", /CPU time/i.test(String(error)) ? "Ran on too long and was stopped, like a loop that never ends" : `The game server stopped: ${String(error)}`);
      if (++stats.failures >= FAILURES) onBroken();
      else session = await open();
      throw error;
    }
    stats.calls++;
    stats.ms += Date.now() - started;
    if (answer.error) {
      stats.crashes++;
      record("crash", answer.error);
    }
    return answer;
  };
  const ask = async (work: () => Promise<Answer>, room: Room | null): Promise<unknown> => {
    const answer = await reach(work);
    if (room) apply(answer.effects, room);
    if (answer.error) throw new Error(`Game server error: ${answer.error.slice(0, 2000)}`);
    return answer.state;
  };
  const snapshot = (room: Room): Snapshot => ({ players: [...room.players], isListed: room.isListed, isOpen: room.isOpen, name: room.name, labels: room.labels });
  const call = (hook: string, state: unknown, args: unknown[], room: Room) => ask(() => session.call(hook, state, args, snapshot(room)), room);

  return {
    maximumPlayerCount: definition.maximumPlayerCount,
    ticksPerSec: definition.ticksPerSec,
    hostControlsEnabled: definition.hostControlsEnabled,
    idleCheck: definition.idleCheck,
    idleTimeoutSec: definition.idleTimeoutSec,
    awayMode: definition.awayMode,
    seatHoldDurationSec: definition.seatHoldDurationSec,
    stats,
    setup: (startData) => ask(() => session.setup(startData), null),
    onJoin: (state, player, room, joinData, joinInfo) => call("onJoin", state, [player, joinData, joinInfo], room),
    onLeave: (state, player, room, leaveInfo) => call("onLeave", state, [player, leaveInfo], room),
    onMessage: (state, player, messageData, room) => call("onMessage", state, [player, messageData], room),
    onTick: (state, tickDurationSec, room) => call("onTick", state, [tickDurationSec], room),
    onMoved: (state, moveResult, room) => call("onMoved", state, [moveResult], room),
    // Only for game servers that have them: with onAway, players who walk away stay in the room.
    ...(has("onAway") ? { onAway: (state: unknown, player: Player, room: Room, awayReason: AwayReason) => call("onAway", state, [player, awayReason], room) } : {}),
    ...(has("onBack") ? { onBack: (state: unknown, player: Player, room: Room) => call("onBack", state, [player], room) } : {}),
    ...(has("canJoin")
      ? {
          canJoin: async (state: unknown, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo) => {
            const verdict = await reach(() => session.check(state, player, joinData, snapshot(room), joinInfo));
            if (verdict.error) throw new Error(`Game server error: ${verdict.error.slice(0, 2000)}`);
            const refusal = verdict.answer as { refusalMessage?: unknown } | boolean;
            return typeof refusal === "object" && typeof refusal?.refusalMessage === "string" ? { refusalMessage: refusal.refusalMessage } : refusal !== false;
          },
        }
      : {}),
  } satisfies GameServer & { stats: SandboxStats };
}

export interface SandboxStats {
  calls: number;
  /** Time spent waiting on the game server, for our own measurements. */
  ms: number;
  /** Times the sandbox itself failed; FAILURES of them end the room. */
  failures: number;
  crashes: number;
  stops: number;
  errors: Map<string, { kind: "crash" | "stopped"; message: string; count: number; first: number }>;
}

/** Distinct errors a room keeps until it records them. */
const MAX_ERRORS = 5;

/**
 * An error as its developer should see it: the message and where in zaisma-server.js it happened,
 * without our harness's lines. Up to 300 characters.
 */
export function errorLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  const where = lines.find((l) => /zaisma-server[^\s:()]*\.js:\d+:\d+/.test(l))?.match(/zaisma-server[^\s:()]*\.js:\d+:\d+/)?.[0];
  const message = lines[0]!.replace(/^Error: /, "");
  return (where ? `${message} (${where})` : message).slice(0, 300);
}

/** Do what the game asked, through the same room API built-in game servers use, so the same checks apply. */
function apply(effects: unknown, room: Room): void {
  if (!Array.isArray(effects)) return;
  for (const effect of effects.slice(0, 1000) as Effect[]) {
    try {
      switch (effect?.do) {
        case "broadcast":
          room.broadcast(effect.messageData, (effect.options ?? undefined) as never);
          break;
        case "send":
          if (typeof effect.playerId === "string") room.send(effect.playerId, effect.messageData);
          break;
        case "end":
          room.end(typeof effect.message === "string" ? effect.message : undefined);
          break;
        case "set_listed":
          room.setListed(effect.isListed === true);
          break;
        case "set_open":
          room.setOpen(effect.isOpen === true);
          break;
        case "set_name":
          room.setName((typeof effect.name === "string" ? effect.name : null) as string | null);
          break;
        case "set_labels":
          room.setLabels((effect.labels && typeof effect.labels === "object" ? effect.labels : null) as never);
          break;
        case "reserve":
          (room.reserve as (options: unknown, chosenRoomCode: string) => string)(effect.options, effect.roomCode);
          break;
        case "kick":
          if (typeof effect.playerId === "string") room.kick(effect.playerId, (effect.options ?? undefined) as never);
          break;
        case "move_to":
          room.moveTo(effect.roomCode as string, (effect.options ?? {}) as never);
          break;
      }
    } catch (error) {
      console.error("Game server error:", error);
    }
  }
}
