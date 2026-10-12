// Arena game server: a real-time top-down arena for 2–8 players. Dash into
// other players to bump them off the platform. Ticks 20 times a second.
// Only plain JavaScript plus type annotations, so Node can run it as-is.
import type { GameServer, Player, Room } from "@zaisma/game-server";

const RADIUS = 360; // platform
const BODY = 18; // player
const ACCEL = 1400;
const FRICTION = 4;
const DASH_SPEED = 720;
const DASH_COOLDOWN = 1.2;
const RESPAWN = 1.5;
const BOTS_WHEN_ALONE = 2;
const COLORS = ["#ff5d5d", "#4fc3ff", "#ffd84f", "#7dff8a", "#d07bff", "#ff9e4f", "#4fffe1", "#ff7bc4"];

interface Body {
  name: string;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ix: number;
  iy: number;
  dash: number; // cooldown left
  dashing: number; // seconds of dash left
  out: number; // seconds until respawn, 0 if in play
  score: number;
  lastHit: string | null;
  bot: boolean;
}

interface State {
  bodies: Record<string, Body>;
  colorIndex: number;
  botCount: number;
}

function spawn(b: Body): void {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * RADIUS * 0.5;
  b.x = Math.cos(a) * r;
  b.y = Math.sin(a) * r;
  b.vx = b.vy = 0;
  b.out = 0;
  b.lastHit = null;
}

function newBody(state: State, name: string, bot: boolean, color?: string): Body {
  const b: Body = { name, color: color ?? COLORS[state.colorIndex++ % COLORS.length]!, x: 0, y: 0, vx: 0, vy: 0, ix: 0, iy: 0, dash: 0, dashing: 0, out: 0, score: 0, lastHit: null, bot };
  spawn(b);
  return b;
}

/** Bots keep a lone player company until friends arrive. */
function fillBots(state: State, room: Room): void {
  const humans = room.players.length;
  const want = humans >= 2 ? 0 : BOTS_WHEN_ALONE;
  const bots = Object.keys(state.bodies).filter((id) => state.bodies[id]!.bot);
  for (let i = bots.length; i < want; i++) state.bodies[`bot${++state.botCount}`] = newBody(state, `Bot ${state.botCount}`, true);
  for (const id of bots.slice(want)) delete state.bodies[id];
}

function startDash(b: Body): void {
  if (b.dash > 0 || b.out > 0) return;
  let dx = b.ix;
  let dy = b.iy;
  if (!dx && !dy) {
    const s = Math.hypot(b.vx, b.vy) || 1;
    dx = b.vx / s;
    dy = b.vy / s;
  }
  b.vx = dx * DASH_SPEED;
  b.vy = dy * DASH_SPEED;
  b.dash = DASH_COOLDOWN;
  b.dashing = 0.25;
}

function steerBot(state: State, id: string, b: Body): void {
  let target: Body | null = null;
  let best = Infinity;
  for (const [oid, o] of Object.entries(state.bodies)) {
    if (oid === id || o.out) continue;
    const d = Math.hypot(o.x - b.x, o.y - b.y);
    if (d < best) [best, target] = [d, o];
  }
  // Head for the nearest player, but back away from the edge.
  let dx = target ? target.x - b.x : -b.x;
  let dy = target ? target.y - b.y : -b.y;
  if (Math.hypot(b.x, b.y) > RADIUS * 0.75) [dx, dy] = [-b.x, -b.y];
  const s = Math.hypot(dx, dy) || 1;
  b.ix = (dx / s) * 0.7;
  b.iy = (dy / s) * 0.7;
  if (target && best < 90 && Math.random() < 0.04) startDash(b);
}

const arena: GameServer<State> = {
  maxPlayers: 8,
  tickRate: 20,

  setup: () => ({ bodies: {}, colorIndex: 0, botCount: 0 }),

  // The player's game sends the color they picked last time as join data.
  onJoin(state, player: Player, room, data) {
    const color = (data as { color?: unknown } | undefined)?.color;
    state.bodies[player.id] = newBody(state, player.name, false, typeof color === "string" && COLORS.includes(color) ? color : undefined);
    fillBots(state, room);
  },

  onLeave(state, player, room) {
    delete state.bodies[player.id];
    fillBots(state, room);
  },

  onMessage(state, player, msg) {
    const b = state.bodies[player.id];
    if (!b || !msg || typeof msg !== "object") return;
    const m = msg as { i?: unknown; d?: unknown; c?: unknown };
    if (typeof m.c === "string" && COLORS.includes(m.c)) b.color = m.c;
    if (Array.isArray(m.i) && m.i.length === 2) {
      let [x, y] = m.i.map(Number) as [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const s = Math.hypot(x, y);
      if (s > 1) [x, y] = [x / s, y / s];
      b.ix = x;
      b.iy = y;
    }
    if (m.d) startDash(b);
  },

  onTick(state, dt, room) {
    dt = Math.min(dt, 0.1);
    const ids = Object.keys(state.bodies);
    for (const id of ids) {
      const b = state.bodies[id]!;
      if (b.out > 0) {
        b.out -= dt;
        if (b.out <= 0) spawn(b);
        continue;
      }
      if (b.bot) steerBot(state, id, b);
      b.dash = Math.max(0, b.dash - dt);
      b.dashing = Math.max(0, b.dashing - dt);
      b.vx += b.ix * ACCEL * dt;
      b.vy += b.iy * ACCEL * dt;
      const f = Math.exp(-FRICTION * dt);
      b.vx *= f;
      b.vy *= f;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    // Bumps: push overlapping players apart; a dashing player hits much harder.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = state.bodies[ids[i]!]!;
        const c = state.bodies[ids[j]!]!;
        if (a.out || c.out) continue;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d >= BODY * 2) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = BODY * 2 - d;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        c.x += (nx * overlap) / 2;
        c.y += (ny * overlap) / 2;
        const push = 260 + (a.dashing ? 520 : 0) + (c.dashing ? 520 : 0);
        const aHits = a.dashing >= c.dashing;
        if (aHits) {
          c.vx += nx * push;
          c.vy += ny * push;
          a.vx -= nx * push * 0.3;
          a.vy -= ny * push * 0.3;
          c.lastHit = ids[i]!;
        } else {
          a.vx -= nx * push;
          a.vy -= ny * push;
          c.vx += nx * push * 0.3;
          c.vy += ny * push * 0.3;
          a.lastHit = ids[j]!;
        }
      }
    }
    // Off the edge: whoever bumped them last scores.
    for (const id of ids) {
      const b = state.bodies[id]!;
      if (b.out || Math.hypot(b.x, b.y) <= RADIUS) continue;
      b.out = RESPAWN;
      const hitter = b.lastHit && state.bodies[b.lastHit];
      if (hitter) hitter.score++;
      room.broadcast({ ko: id, by: b.lastHit });
    }
    room.broadcast({
      s: ids.map((id) => {
        const b = state.bodies[id]!;
        return [id, Math.round(b.x), Math.round(b.y), b.score, b.dashing > 0 ? 1 : 0, b.out > 0 ? 1 : 0, b.name, b.color];
      }),
    });
  },
};

export default arena;
