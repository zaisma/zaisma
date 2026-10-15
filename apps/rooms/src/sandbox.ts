import { defineGameServer, type AwayReason, type GameServer, type JoinInfo, type LeaveInfo, type Player, type Room } from "@zaisma/game-server";
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
  | { do: "broadcast"; msg: unknown; except?: string }
  | { do: "send"; to: string; msg: unknown }
  | { do: "end"; reason?: string }
  | { do: "listed"; value: boolean }
  | { do: "open"; value: boolean }
  | { do: "info"; info: unknown }
  | { do: "reserve"; opts: unknown; code: string }
  | { do: "kick"; player: unknown; opts: unknown }
  | { do: "moveTo"; code: unknown; opts: unknown };

interface Snapshot {
  players: Player[];
  listed: boolean;
  open: boolean;
  name: string | null;
  labels: Record<string, string>;
}

interface Answer {
  state?: unknown;
  effects: Effect[];
  error?: string;
}

export interface Session {
  settings(): Promise<{ maxPlayers?: unknown; tickRate?: unknown; hostControls?: unknown; canJoin?: unknown; idleAfter?: unknown; away?: unknown; holdFor?: unknown; onAway?: unknown; onBack?: unknown }>;
  setup(data: unknown): Promise<Answer>;
  call(hook: string, state: unknown, args: unknown[], room: Snapshot): Promise<Answer>;
  /** canJoin: the game's verdict on a player coming in. It can't change the state or the room. */
  check(state: unknown, player: Player, data: unknown, room: Snapshot, info: JoinInfo): Promise<{ verdict?: unknown; error?: string }>;
}

// Runs inside the sandbox, beside the game's file. Plain JavaScript: nothing here is trusted by the
// room, which checks everything it's handed back like any message from a player.
const harness = (entry: string) => `
import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";
import server from "./${entry}";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b & 31]).join("");
const HOOKS = ["onJoin", "onLeave", "onMessage", "onTick", "onMoved", "onAway", "onBack"];

function recorder(snap, effects) {
  const room = {
    get players() { return snap.players.map((p) => ({ ...p })); },
    broadcast(msg, o) { effects.push({ do: "broadcast", msg, except: o && o.except }); },
    send(to, msg) { effects.push({ do: "send", to, msg }); },
    end(reason) { effects.push({ do: "end", reason }); },
    get listed() { return snap.listed; },
    setListed(v) { snap.listed = Boolean(v); effects.push({ do: "listed", value: snap.listed }); },
    get open() { return snap.open; },
    setOpen(v) { snap.open = Boolean(v); effects.push({ do: "open", value: snap.open }); },
    get name() { return snap.name; },
    get labels() { return { ...snap.labels }; },
    setInfo(info) { effects.push({ do: "info", info }); },
    reserve(opts) { const c = code(); effects.push({ do: "reserve", opts, code: c }); return c; },
    kick(player, opts) { effects.push({ do: "kick", player, opts }); },
    moveTo(code, opts) { effects.push({ do: "moveTo", code, opts }); },
  };
  return room;
}

function answer(fn, effects, state) {
  try {
    const next = fn();
    return { state: next === undefined ? state : next, effects };
  } catch (err) {
    return { effects, error: String((err && err.stack) || err) };
  }
}

class Session extends RpcTarget {
  settings() {
    return {
      maxPlayers: server.maxPlayers,
      tickRate: server.tickRate,
      hostControls: server.hostControls,
      canJoin: typeof server.canJoin === "function",
      idleAfter: server.idleAfter,
      away: server.away,
      holdFor: server.holdFor,
      onAway: typeof server.onAway === "function",
      onBack: typeof server.onBack === "function",
    };
  }
  setup(data) {
    return answer(() => server.setup(data), [], undefined);
  }
  call(hook, state, args, snap) {
    const effects = [];
    if (!HOOKS.includes(hook) || typeof server[hook] !== "function") return { state, effects };
    const room = recorder(snap, effects);
    // onJoin(state, player, room, data, info), onLeave(state, player, room, info), onAway(state, player, room, why),
    // onMessage(state, player, msg, room), onTick(state, dt, room), onMoved(state, result, room), onBack(state, player, room)
    const full =
      hook === "onJoin" ? [state, args[0], room, args[1], args[2] || {}]
      : hook === "onMessage" ? [state, args[0], args[1], room]
      : hook === "onLeave" ? [state, args[0], room, args[1] || { why: "left" }]
      : hook === "onAway" ? [state, args[0], room, args[1]]
      : [state, args[0], room];
    return answer(() => server[hook](...full), effects, state);
  }
  check(state, player, data, snap, info) {
    if (typeof server.canJoin !== "function") return { verdict: true };
    try {
      const verdict = server.canJoin(state, player, recorder(snap, []), data, info || {});
      return { verdict: typeof verdict === "boolean" || typeof verdict === "string" ? verdict : true };
    } catch (err) {
      return { error: String((err && err.stack) || err) };
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
  const s = await session.settings();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
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
    } catch (err) {
      stats.stops++;
      record("stopped", /CPU time/i.test(String(err)) ? "Ran on too long and was stopped, like a loop that never ends" : `The game server stopped: ${String(err)}`);
      if (++stats.failures >= FAILURES) onBroken();
      else session = await open();
      throw err;
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
  const snap = (room: Room): Snapshot => ({ players: [...room.players], listed: room.listed, open: room.open, name: room.name, labels: room.labels });
  const call = (hook: string, state: unknown, args: unknown[], room: Room) => ask(() => session.call(hook, state, args, snap(room)), room);

  const server = {
    maxPlayers: num(s.maxPlayers),
    tickRate: num(s.tickRate),
    hostControls: s.hostControls === true,
    idleAfter: s.idleAfter === false || s.idleAfter === "client" ? s.idleAfter : num(s.idleAfter),
    away: s.away === "lobby" ? ("lobby" as const) : undefined,
    holdFor: num(s.holdFor),
    stats,
    setup: (data) => ask(() => session.setup(data), null),
    onJoin: (state, player, room, data, info) => call("onJoin", state, [player, data, info ?? {}], room),
    onLeave: (state, player, room, info?: LeaveInfo) => call("onLeave", state, [player, info ?? { why: "left" }], room),
    onMessage: (state, player, msg, room) => call("onMessage", state, [player, msg], room),
    onTick: (state, dt, room) => call("onTick", state, [dt], room),
    onMoved: (state, result, room) => call("onMoved", state, [result], room),
    // Only for game servers that have them: with onAway, players who walk away stay in the room.
    ...(s.onAway === true ? { onAway: (state: unknown, player: Player, room: Room, why: AwayReason) => call("onAway", state, [player, why], room) } : {}),
    ...(s.onBack === true ? { onBack: (state: unknown, player: Player, room: Room) => call("onBack", state, [player], room) } : {}),
    ...(s.canJoin === true
      ? {
          canJoin: async (state: unknown, player: Player, room: Room, data: unknown, info?: JoinInfo) => {
            const answer = await reach(() => session.check(state, player, data, snap(room), info ?? {}));
            if (answer.error) throw new Error(`Game server error: ${answer.error.slice(0, 2000)}`);
            return typeof answer.verdict === "boolean" || typeof answer.verdict === "string" ? answer.verdict : true;
          },
        }
      : {}),
  } satisfies GameServer & { stats: typeof stats };
  defineGameServer(server);
  return server;
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
  for (const e of effects.slice(0, 1000) as Effect[]) {
    try {
      switch (e?.do) {
        case "broadcast":
          room.broadcast(e.msg, typeof e.except === "string" ? { except: e.except } : undefined);
          break;
        case "send":
          if (typeof e.to === "string") room.send(e.to, e.msg);
          break;
        case "end":
          room.end(typeof e.reason === "string" ? e.reason.slice(0, 200) : undefined);
          break;
        case "listed":
          room.setListed(e.value === true);
          break;
        case "open":
          room.setOpen(e.value === true);
          break;
        case "info":
          room.setInfo((e.info ?? {}) as never);
          break;
        case "reserve":
          room.reserve({ ...(e.opts as object), code: e.code } as never);
          break;
        case "kick":
          if (typeof e.player === "string") room.kick(e.player, (e.opts && typeof e.opts === "object" ? e.opts : {}) as never);
          break;
        case "moveTo":
          room.moveTo(e.code as string, (e.opts && typeof e.opts === "object" ? e.opts : {}) as never);
          break;
      }
    } catch (err) {
      console.error("Game server error:", err);
    }
  }
}
