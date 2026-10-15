import { GAME_SERVER_OPTIONS, defineGameServer, readJoinAnswer, unknownOptionError, type AwayReason, type GameServer, type JoinAnswer, type JoinInfo, type LeaveInfo, type Player, type Room } from "@zaisma/game-server";
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
 * server that's stopped this often (FAILURE_COUNT): a stuck one can't keep freezing its rooms or burning CPU.
 */
const CPU_MS = 50;
const FAILURE_COUNT = 2;

/** What the game asked the room to do during one handler, in order. */
type Effect =
  | { do: "broadcast"; message: unknown; exceptPlayerId?: string }
  | { do: "send"; playerId: string; message: unknown }
  | { do: "end"; message?: string }
  | { do: "listed"; isListed: boolean }
  | { do: "open"; isOpen: boolean }
  | { do: "info"; nameAndLabels: unknown }
  | { do: "reserve"; reserveOptions: unknown; roomCode: string }
  | { do: "kick"; playerId: unknown; kickOptions: unknown }
  | { do: "moveTo"; roomCode: unknown; moveOptions: unknown };

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

/** A game server's options as the sandbox reports them, and which of its handlers it has. */
interface Settings {
  optionNames: unknown;
  maximumPlayerCount?: unknown;
  ticksPerSec?: unknown;
  hostControlsEnabled?: unknown;
  idleCheck?: unknown;
  idleTimeoutSec?: unknown;
  awayMode?: unknown;
  seatHoldDurationSec?: unknown;
  handlerNames: unknown;
}

export interface Session {
  settings(): Promise<Settings>;
  setup(setupData: unknown): Promise<Answer>;
  call(hook: string, state: unknown, handlerArguments: unknown[], room: Snapshot): Promise<Answer>;
  /** canJoin: the game's answer on a player coming in, as plain JSON. It can't change the state or the room. */
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
const HANDLERS = ["setup", "canJoin", ...HOOKS];

function recorder(snapshot, effects) {
  return {
    get players() { return snapshot.players.map((player) => ({ ...player })); },
    broadcast(message, broadcastOptions) { effects.push({ do: "broadcast", message, exceptPlayerId: broadcastOptions && broadcastOptions.exceptPlayerId }); },
    send(playerId, message) { effects.push({ do: "send", playerId, message }); },
    end(message) { effects.push({ do: "end", message }); },
    get isListed() { return snapshot.isListed; },
    setListed(isListed) { snapshot.isListed = Boolean(isListed); effects.push({ do: "listed", isListed: snapshot.isListed }); },
    get isOpen() { return snapshot.isOpen; },
    setOpen(isOpen) { snapshot.isOpen = Boolean(isOpen); effects.push({ do: "open", isOpen: snapshot.isOpen }); },
    get name() { return snapshot.name; },
    get labels() { return { ...snapshot.labels }; },
    setInfo(nameAndLabels) { effects.push({ do: "info", nameAndLabels }); },
    reserve(reserveOptions) { const roomCode = newRoomCode(); effects.push({ do: "reserve", reserveOptions, roomCode }); return roomCode; },
    kick(playerId, kickOptions) { effects.push({ do: "kick", playerId, kickOptions }); },
    moveTo(roomCode, moveOptions) { effects.push({ do: "moveTo", roomCode, moveOptions }); },
  };
}

function answer(handler, effects, state) {
  try {
    const next = handler();
    return { state: next === undefined ? state : next, effects };
  } catch (error) {
    return { effects, error: String((error && error.stack) || error) };
  }
}

class Session extends RpcTarget {
  settings() {
    return {
      optionNames: Object.keys(server),
      maximumPlayerCount: server.maximumPlayerCount,
      ticksPerSec: server.ticksPerSec,
      hostControlsEnabled: server.hostControlsEnabled,
      idleCheck: server.idleCheck,
      idleTimeoutSec: server.idleTimeoutSec,
      awayMode: server.awayMode,
      seatHoldDurationSec: server.seatHoldDurationSec,
      handlerNames: HANDLERS.filter((name) => typeof server[name] === "function"),
    };
  }
  setup(setupData) {
    return answer(() => server.setup(setupData), [], undefined);
  }
  call(hook, state, handlerArguments, snapshot) {
    const effects = [];
    if (!HOOKS.includes(hook) || typeof server[hook] !== "function") return { state, effects };
    const room = recorder(snapshot, effects);
    // onJoin(state, player, room, joinData, joinInfo), onLeave(state, player, room, leaveInfo), onAway(state, player, room, reason),
    // onMessage(state, player, message, room), onTick(state, tickDurationSec, room), onMoved(state, moveResult, room), onBack(state, player, room)
    const full =
      hook === "onJoin" ? [state, handlerArguments[0], room, handlerArguments[1], handlerArguments[2]]
      : hook === "onMessage" ? [state, handlerArguments[0], handlerArguments[1], room]
      : hook === "onLeave" || hook === "onAway" ? [state, handlerArguments[0], room, handlerArguments[1]]
      : [state, handlerArguments[0], room];
    return answer(() => server[hook](...full), effects, state);
  }
  async check(state, player, joinData, snapshot, joinInfo) {
    if (typeof server.canJoin !== "function") return { answer: true };
    let answer;
    try {
      answer = await server.canJoin(state, player, recorder(snapshot, []), joinData, joinInfo);
    } catch (error) {
      return { error: String((error && error.stack) || error) };
    }
    // Handed back as plain JSON; the room reads it like any game server's answer (true, false or { refusalMessage }).
    try {
      return { answer: answer === undefined ? null : JSON.parse(JSON.stringify(answer)) };
    } catch {
      return { answer: "(an answer that isn't plain JSON)" };
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
 * after FAILURE_COUNT of those, onBroken is called once and every later call fails at once. A game
 * server with an option it doesn't take, or one out of range, doesn't start (GameServerError).
 */
export async function wrapSession(open: () => Promise<Session>, onBroken: () => void): Promise<GameServer & { stats: SandboxStats }> {
  let session = await open();
  const settings = await session.settings();
  const optionNames = Array.isArray(settings.optionNames) ? settings.optionNames.map(String) : [];
  for (const name of optionNames) if (!(GAME_SERVER_OPTIONS as readonly string[]).includes(name)) throw unknownOptionError(name);
  const handlerNames = new Set(Array.isArray(settings.handlerNames) ? settings.handlerNames.map(String) : []);
  const stats: SandboxStats = { calls: 0, ms: 0, failures: 0, crashes: 0, stops: 0, errors: new Map() };
  const record = (kind: "crash" | "stopped", text: string) => {
    const message = errorLine(text);
    const seen = stats.errors.get(`${kind}\n${message}`);
    if (seen) seen.count++;
    // A room keeps a handful of distinct errors; a game that throws a new message every tick can't fill the table.
    else if (stats.errors.size < MAXIMUM_ERROR_COUNT) stats.errors.set(`${kind}\n${message}`, { kind, message, count: 1, first: Date.now() });
  };

  /** One call into the sandbox, counting it and handling a sandbox that fails. */
  const reach = async <T extends { error?: string }>(work: () => Promise<T>): Promise<T> => {
    const startedAtMs = Date.now();
    if (stats.failures >= FAILURE_COUNT) throw new Error("This game's server stopped working");
    let answer: T;
    try {
      answer = await work();
    } catch (error) {
      stats.stops++;
      record("stopped", /CPU time/i.test(String(error)) ? "Ran on too long and was stopped, like a loop that never ends" : `The game server stopped: ${String(error)}`);
      if (++stats.failures >= FAILURE_COUNT) onBroken();
      else session = await open();
      throw error;
    }
    stats.calls++;
    stats.ms += Date.now() - startedAtMs;
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
  const call = (hook: string, state: unknown, handlerArguments: unknown[], room: Room) => ask(() => session.call(hook, state, handlerArguments, snapshot(room)), room);

  // The options pass through as the game gave them, so defineGameServer checks them like any game server's.
  const server = {
    ...(settings.maximumPlayerCount !== undefined ? { maximumPlayerCount: settings.maximumPlayerCount as number } : {}),
    ...(settings.ticksPerSec !== undefined ? { ticksPerSec: settings.ticksPerSec as number } : {}),
    ...(settings.hostControlsEnabled !== undefined ? { hostControlsEnabled: settings.hostControlsEnabled as boolean } : {}),
    ...(settings.idleCheck !== undefined ? { idleCheck: settings.idleCheck as GameServer["idleCheck"] } : {}),
    ...(settings.idleTimeoutSec !== undefined ? { idleTimeoutSec: settings.idleTimeoutSec as number } : {}),
    ...(settings.awayMode !== undefined ? { awayMode: settings.awayMode as GameServer["awayMode"] } : {}),
    ...(settings.seatHoldDurationSec !== undefined ? { seatHoldDurationSec: settings.seatHoldDurationSec as number } : {}),
    setup: (setupData: unknown) => ask(() => session.setup(setupData), null),
    onJoin: (state: unknown, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo) => call("onJoin", state, [player, joinData, joinInfo], room),
    onLeave: (state: unknown, player: Player, room: Room, leaveInfo: LeaveInfo) => call("onLeave", state, [player, leaveInfo], room),
    onMessage: (state: unknown, player: Player, message: unknown, room: Room) => call("onMessage", state, [player, message], room),
    onTick: (state: unknown, tickDurationSec: number, room: Room) => call("onTick", state, [tickDurationSec], room),
    onMoved: (state: unknown, moveResult: unknown, room: Room) => call("onMoved", state, [moveResult], room),
    // Only for game servers that have them: with onAway, players who walk away stay in the room.
    ...(handlerNames.has("onAway") ? { onAway: (state: unknown, player: Player, room: Room, reason: AwayReason) => call("onAway", state, [player, reason], room) } : {}),
    ...(handlerNames.has("onBack") ? { onBack: (state: unknown, player: Player, room: Room) => call("onBack", state, [player], room) } : {}),
    ...(handlerNames.has("canJoin")
      ? {
          canJoin: async (state: unknown, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo) => {
            const checked = await reach(() => session.check(state, player, joinData, snapshot(room), joinInfo));
            if (checked.error) throw new Error(`Game server error: ${checked.error.slice(0, 2000)}`);
            // A wrong answer (like a string) turns the player away, and its developer sees why with the game's server errors.
            const read = readJoinAnswer(checked.answer);
            if ("mistake" in read) {
              stats.crashes++;
              record("crash", read.mistake);
              throw new Error(`Game server error: ${read.mistake}`);
            }
            return checked.answer as JoinAnswer;
          },
        }
      : {}),
  } satisfies GameServer;
  defineGameServer(server);
  return { ...server, stats };
}

export interface SandboxStats {
  calls: number;
  /** Time spent waiting on the game server, for our own measurements. */
  ms: number;
  /** Times the sandbox itself failed; FAILURE_COUNT of them end the room. */
  failures: number;
  crashes: number;
  stops: number;
  errors: Map<string, { kind: "crash" | "stopped"; message: string; count: number; first: number }>;
}

/** Distinct errors a room keeps until it records them. */
const MAXIMUM_ERROR_COUNT = 5;

/**
 * An error as its developer should see it: the message and where in zaisma-server.js it happened,
 * without our harness's lines. Up to 300 characters.
 */
export function errorLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim());
  const where = lines.find((line) => /zaisma-server[^\s:()]*\.js:\d+:\d+/.test(line))?.match(/zaisma-server[^\s:()]*\.js:\d+:\d+/)?.[0];
  const message = lines[0]!.replace(/^Error: /, "");
  return (where ? `${message} (${where})` : message).slice(0, 300);
}

/** Do what the game asked, through the same room API built-in game servers use, so the same checks apply. */
function apply(effects: unknown, room: Room): void {
  if (!Array.isArray(effects)) return;
  const asObject = (given: unknown): object => (given && typeof given === "object" ? given : {});
  for (const effect of effects.slice(0, 1000) as Effect[]) {
    try {
      switch (effect?.do) {
        case "broadcast":
          room.broadcast(effect.message, typeof effect.exceptPlayerId === "string" ? { exceptPlayerId: effect.exceptPlayerId } : undefined);
          break;
        case "send":
          if (typeof effect.playerId === "string") room.send(effect.playerId, effect.message);
          break;
        case "end":
          room.end(typeof effect.message === "string" ? effect.message.slice(0, 200) : undefined);
          break;
        case "listed":
          room.setListed(effect.isListed === true);
          break;
        case "open":
          room.setOpen(effect.isOpen === true);
          break;
        case "info":
          room.setInfo(asObject(effect.nameAndLabels) as never);
          break;
        case "reserve":
          room.reserve({ ...asObject(effect.reserveOptions), roomCode: effect.roomCode } as never);
          break;
        case "kick":
          if (typeof effect.playerId === "string") room.kick(effect.playerId, asObject(effect.kickOptions) as never);
          break;
        case "moveTo":
          room.moveTo(effect.roomCode as string, asObject(effect.moveOptions) as never);
          break;
      }
    } catch (error) {
      console.error("Game server error:", error);
    }
  }
}
