import { defineGameServer, type GameServer, type Player, type Room } from "@zaisma/game-server";
import { fileKey, manifestKey, type Manifest } from "@zaisma/core";
import type { Env } from "./index.ts";

/**
 * Developers' own game servers, run in a Dynamic Worker: a sealed sandbox with no internet, no
 * bindings and a CPU limit. A game opts in with game_server "sandbox" and a zaisma-server.js file
 * in its upload (an ES module whose default export is the game server, with no imports).
 *
 * The room (our Durable Object) still owns everything players touch: sockets, passes, limits,
 * mute, block and report. The sandbox only runs the game's handlers: each call gets the state and
 * a copy of the room, and hands back the new state plus what the game asked the room to do
 * (broadcast, send, end, ...), which the room then does. A room opens one session with the sandbox
 * when it wakes and makes every call through it, so a room is billed one request per wake rather
 * than one per message or tick.
 */

export const SANDBOX = "sandbox";
export const SERVER_FILE = "zaisma-server.js";
/** A game server file bigger than this isn't loaded. */
const MAX_BYTES = 1024 * 1024;
/** CPU per call into the sandbox: plenty for a tick, not for a loop that never ends. */
const CPU_MS = 50;

/** What the game asked the room to do during one handler, in order. */
type Effect =
  | { do: "broadcast"; msg: unknown; except?: string }
  | { do: "send"; to: string; msg: unknown }
  | { do: "end"; reason?: string }
  | { do: "listed"; value: boolean }
  | { do: "open"; value: boolean }
  | { do: "info"; info: unknown }
  | { do: "reserve"; opts: unknown; code: string };

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

interface Session {
  settings(): Promise<{ maxPlayers?: unknown; tickRate?: unknown; hostControls?: unknown }>;
  setup(data: unknown): Promise<Answer>;
  call(hook: string, state: unknown, args: unknown[], room: Snapshot): Promise<Answer>;
}

// Runs inside the sandbox, beside the game's file. Plain JavaScript: nothing here is trusted by the
// room, which checks everything it's handed back like any message from a player.
const HARNESS = `
import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";
import server from "./${SERVER_FILE}";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b & 31]).join("");
const HOOKS = ["onJoin", "onLeave", "onMessage", "onTick"];

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
    return { maxPlayers: server.maxPlayers, tickRate: server.tickRate, hostControls: server.hostControls };
  }
  setup(data) {
    return answer(() => server.setup(data), [], undefined);
  }
  call(hook, state, args, snap) {
    const effects = [];
    if (!HOOKS.includes(hook) || typeof server[hook] !== "function") return { state, effects };
    const room = recorder(snap, effects);
    // onJoin(state, player, room, data), onLeave(state, player, room),
    // onMessage(state, player, msg, room), onTick(state, dt, room)
    const full = hook === "onJoin" ? [state, args[0], room, args[1]] : hook === "onMessage" ? [state, args[0], args[1], room] : [state, args[0], room];
    return answer(() => server[hook](...full), effects, state);
  }
}

export default class extends WorkerEntrypoint {
  open() {
    if (!server || typeof server.setup !== "function") throw new Error("${SERVER_FILE} must export default a game server with a setup() function");
    return new Session();
  }
}
`;

/** Read the game server file from a version's upload, or null if it has none. */
async function serverFile(env: Env, versionId: string): Promise<string | null> {
  const version = await env.DB.prepare("SELECT id, kind, r2_prefix FROM versions WHERE id = ?").bind(versionId).first<{ id: string; kind: "zip" | "files"; r2_prefix: string }>();
  if (!version) return null;
  const manifest = version.kind === "files" ? await (await env.GAMES.get(manifestKey(version.id)))?.json<Manifest>() ?? null : null;
  const key = fileKey(version as never, manifest, SERVER_FILE);
  const object = key ? await env.GAMES.get(key) : null;
  if (!object || object.size > MAX_BYTES) return null;
  return object.text();
}

/**
 * Open a session with a game version's server in its sandbox, and wrap it as a game server the room
 * can run. One sandbox per game version, shared by all its rooms in a place, and warm while in use.
 * Null if the version has no game server file.
 */
export async function sandboxServer(env: Env, gameId: string, versionId: string): Promise<GameServer | null> {
  const source = await serverFile(env, versionId);
  if (source === null) return null;
  const worker = env.LOADER.get(`${gameId}:${versionId}`, () => ({
    compatibilityDate: "2026-10-01",
    mainModule: "harness.js",
    modules: { "harness.js": HARNESS, [SERVER_FILE]: source },
    // No internet and no bindings: the game server can only answer the room.
    globalOutbound: null,
    env: {},
    limits: { cpuMs: CPU_MS },
  }));
  const open = () => (worker.getEntrypoint() as unknown as { open(): Promise<Session> }).open();
  let session = await open();
  const s = await session.settings();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const stats = { calls: 0, ms: 0 };

  const ask = async (work: () => Promise<Answer>, room: Room | null): Promise<unknown> => {
    const started = Date.now();
    let answer: Answer;
    try {
      answer = await work();
    } catch (err) {
      // The sandbox itself failed (over its CPU limit, or restarted): this call is lost, and the
      // next one gets a fresh session. The room and its players carry on.
      session = await open();
      throw err;
    }
    stats.calls++;
    stats.ms += Date.now() - started;
    if (room) apply(answer.effects, room);
    if (answer.error) throw new Error(`Game server error: ${answer.error.slice(0, 2000)}`);
    return answer.state;
  };
  const snap = (room: Room): Snapshot => ({ players: [...room.players], listed: room.listed, open: room.open, name: room.name, labels: room.labels });
  const call = (hook: string, state: unknown, args: unknown[], room: Room) => ask(() => session.call(hook, state, args, snap(room)), room);

  const server: GameServer & { stats: typeof stats } = {
    maxPlayers: num(s.maxPlayers),
    tickRate: num(s.tickRate),
    hostControls: s.hostControls === true,
    stats,
    setup: (data) => ask(() => session.setup(data), null),
    onJoin: (state, player, room, data) => call("onJoin", state, [player, data], room),
    onLeave: (state, player, room) => call("onLeave", state, [player], room),
    onMessage: (state, player, msg, room) => call("onMessage", state, [player, msg], room),
    onTick: (state, dt, room) => call("onTick", state, [dt], room),
  };
  return defineGameServer(server);
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
      }
    } catch (err) {
      console.error("Game server error:", err);
    }
  }
}
