// Arena game server: a real-time top-down arena for 2–8 players. Dash into
// other players to bump them off the platform. Ticks 20 times a second. Each
// player's best score goes in the game's database, and the game asks for the
// best scores board with a request (onRequest), outside the room. Once a day a
// schedule (onSchedule) keeps that board's table small. A player whose connection
// drops stays frozen where they were for the room's reconnectTimeoutSec (30 seconds),
// so a blip never costs them their place or their score. State sync sends each player the
// bodies as players see them, a full copy as they join and then only what changed each tick.
// Only plain JavaScript plus type annotations, so Node can run it as-is.
import type { GameServer, Player, Room } from "@zaisma/game-server";

const PLATFORM_RADIUS = 360;
const BODY_RADIUS = 18;
const ACCELERATION = 1400;
const FRICTION = 4;
const DASH_SPEED = 720;
const DASH_COOLDOWN_SEC = 1.2;
const DASH_DURATION_SEC = 0.25;
const RESPAWN_DELAY_SEC = 1.5;
const BOT_COUNT_WHEN_ALONE = 2;
const COLORS = ["#ff5d5d", "#4fc3ff", "#ffd84f", "#7dff8a", "#d07bff", "#ff9e4f", "#4fffe1", "#ff7bc4"];
const BEST_SCORES_TABLE = "CREATE TABLE IF NOT EXISTS best_scores (player_id TEXT PRIMARY KEY, name TEXT NOT NULL, best_score INTEGER NOT NULL)";

interface Body {
  name: string;
  color: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  /** Where the player is steering, from -1 to 1 on each axis. */
  inputX: number;
  inputY: number;
  dashCooldownSec: number;
  dashLeftSec: number;
  /** Seconds until respawn, 0 while in play. */
  respawnInSec: number;
  score: number;
  lastHitById: string | null;
  isBot: boolean;
}

interface State {
  bodies: Record<string, Body>;
  colorIndex: number;
  botCount: number;
}

/** What players send: where they steer, a dash, or a new color. */
interface PlayerMessage {
  input?: unknown;
  dash?: unknown;
  color?: unknown;
}

function spawn(body: Body): void {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * PLATFORM_RADIUS * 0.5;
  body.x = Math.cos(angle) * distance;
  body.y = Math.sin(angle) * distance;
  body.velocityX = body.velocityY = 0;
  body.respawnInSec = 0;
  body.lastHitById = null;
}

function newBody(state: State, name: string, isBot: boolean, color?: string): Body {
  const body: Body = { name, color: color ?? COLORS[state.colorIndex++ % COLORS.length]!, x: 0, y: 0, velocityX: 0, velocityY: 0, inputX: 0, inputY: 0, dashCooldownSec: 0, dashLeftSec: 0, respawnInSec: 0, score: 0, lastHitById: null, isBot };
  spawn(body);
  return body;
}

/** Bots keep a lone player company until friends arrive. */
function fillBots(state: State, room: Room): void {
  const wantedBotCount = room.players.length >= 2 ? 0 : BOT_COUNT_WHEN_ALONE;
  const botIds = Object.keys(state.bodies).filter((id) => state.bodies[id]!.isBot);
  for (let i = botIds.length; i < wantedBotCount; i++) state.bodies[`bot${++state.botCount}`] = newBody(state, `Bot ${state.botCount}`, true);
  for (const id of botIds.slice(wantedBotCount)) delete state.bodies[id];
}

function startDash(body: Body): void {
  if (body.dashCooldownSec > 0 || body.respawnInSec > 0) return;
  let directionX = body.inputX;
  let directionY = body.inputY;
  if (!directionX && !directionY) {
    const speed = Math.hypot(body.velocityX, body.velocityY) || 1;
    directionX = body.velocityX / speed;
    directionY = body.velocityY / speed;
  }
  body.velocityX = directionX * DASH_SPEED;
  body.velocityY = directionY * DASH_SPEED;
  body.dashCooldownSec = DASH_COOLDOWN_SEC;
  body.dashLeftSec = DASH_DURATION_SEC;
}

function steerBot(state: State, id: string, bot: Body): void {
  let target: Body | null = null;
  let nearest = Infinity;
  for (const [otherId, other] of Object.entries(state.bodies)) {
    if (otherId === id || other.respawnInSec) continue;
    const distance = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (distance < nearest) [nearest, target] = [distance, other];
  }
  // Head for the nearest player, but back away from the edge.
  let towardX = target ? target.x - bot.x : -bot.x;
  let towardY = target ? target.y - bot.y : -bot.y;
  if (Math.hypot(bot.x, bot.y) > PLATFORM_RADIUS * 0.75) [towardX, towardY] = [-bot.x, -bot.y];
  const length = Math.hypot(towardX, towardY) || 1;
  bot.inputX = (towardX / length) * 0.7;
  bot.inputY = (towardY / length) * 0.7;
  if (target && nearest < 90 && Math.random() < 0.04) startDash(bot);
}

/** A body as every player's game draws it: whole pixels, and nothing of the game server's own physics. */
interface ShownBody {
  name: string;
  color: string;
  x: number;
  y: number;
  score: number;
  isDashing: boolean;
  isOut: boolean;
}

const arena: GameServer<State> = {
  maximumPlayerCount: 8,
  // Friends can watch a round without playing: they get the snapshots everyone gets, and send nothing.
  maximumSpectatorCount: 20,
  ticksPerSec: 20,
  stateSyncEnabled: true,

  // Everyone sees every body, without inputs, velocities and timers: only what changed of this goes out each tick.
  stateView(state) {
    const bodies: Record<string, ShownBody> = {};
    for (const [id, body] of Object.entries(state.bodies)) {
      bodies[id] = { name: body.name, color: body.color, x: Math.round(body.x), y: Math.round(body.y), score: body.score, isDashing: body.dashLeftSec > 0, isOut: body.respawnInSec > 0 };
    }
    return { bodies };
  },

  setup: () => ({ bodies: {}, colorIndex: 0, botCount: 0 }),

  // The player's game sends the color they picked last time as join data.
  onJoin(state, player: Player, room, joinData) {
    const color = (joinData as { color?: unknown } | null)?.color;
    state.bodies[player.id] = newBody(state, player.name, false, typeof color === "string" && COLORS.includes(color) ? color : undefined);
    fillBots(state, room);
    // On Zaisma this goes to the game's logs (get_logs); on your own server, to its terminal.
    console.log(`${player.name} joined: ${room.players.length} in the room`);
  },

  // A player's best score is kept in the game's database, for the best scores board (onRequest).
  async onLeave(state, player, room) {
    const score = state.bodies[player.id]?.score ?? 0;
    delete state.bodies[player.id];
    fillBots(state, room);
    console.log(`${player.name} left with ${score} points`);
    if (score > 0) {
      await room.database.query(BEST_SCORES_TABLE);
      await room.database.query(
        "INSERT INTO best_scores VALUES (?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET name = excluded.name, best_score = max(best_score, excluded.best_score)",
        [player.id, player.name, score],
      );
    }
  },

  // The best scores board, outside any room: Zaisma.server.request({ type: "bestScores" }) in the game.
  async onRequest(player, request, server) {
    if ((request as { type?: unknown } | null)?.type !== "bestScores") return null;
    await server.database.query(BEST_SCORES_TABLE);
    const rows = await server.database.query("SELECT player_id, name, best_score FROM best_scores ORDER BY best_score DESC LIMIT 10");
    return rows.map((row) => ({ name: row.name, bestScore: row.best_score, isMe: row.player_id === player.id }));
  },

  // Every day at 04:00 UTC the game server tidies the best scores by itself: only the top 100 stay.
  schedules: [{ name: "tidy-best-scores", cron: "0 4 * * *" }],
  async onSchedule(run, server) {
    if (run.name !== "tidy-best-scores") return;
    await server.database.query(BEST_SCORES_TABLE);
    await server.database.query("DELETE FROM best_scores WHERE player_id NOT IN (SELECT player_id FROM best_scores ORDER BY best_score DESC LIMIT 100)");
  },

  onMessage(state, player, message) {
    const body = state.bodies[player.id];
    if (!body || !message || typeof message !== "object") return;
    const sent = message as PlayerMessage;
    if (typeof sent.color === "string" && COLORS.includes(sent.color)) body.color = sent.color;
    if (Array.isArray(sent.input) && sent.input.length === 2) {
      let [inputX, inputY] = sent.input.map(Number) as [number, number];
      if (!Number.isFinite(inputX) || !Number.isFinite(inputY)) return;
      const length = Math.hypot(inputX, inputY);
      if (length > 1) [inputX, inputY] = [inputX / length, inputY / length];
      body.inputX = inputX;
      body.inputY = inputY;
    }
    if (sent.dash === true) startDash(body);
  },

  // Back after a dropped connection: their body unfreezes by itself (onTick), and state sync sends their game a full copy.
  onBack(state, player) {
    console.log(`${player.name} is back`);
  },

  onTick(state, tickDurationSec, room) {
    // A late tick moves things at most a tenth of a second, so nobody jumps through a wall.
    const stepSec = Math.min(tickDurationSec, 0.1);
    // Players whose connection dropped are frozen until they're back: they don't move, bump or get bumped.
    // Reading room.awayReason here, rather than adding onAway, leaves idle and hidden players to the room.
    const frozenIds = new Set(room.players.filter((player) => room.awayReason(player.id) === "lost").map((player) => player.id));
    const ids = Object.keys(state.bodies);
    for (const id of ids) {
      const body = state.bodies[id]!;
      if (frozenIds.has(id)) {
        body.inputX = body.inputY = body.velocityX = body.velocityY = 0;
        continue;
      }
      if (body.respawnInSec > 0) {
        body.respawnInSec -= stepSec;
        if (body.respawnInSec <= 0) spawn(body);
        continue;
      }
      if (body.isBot) steerBot(state, id, body);
      body.dashCooldownSec = Math.max(0, body.dashCooldownSec - stepSec);
      body.dashLeftSec = Math.max(0, body.dashLeftSec - stepSec);
      body.velocityX += body.inputX * ACCELERATION * stepSec;
      body.velocityY += body.inputY * ACCELERATION * stepSec;
      const slowdown = Math.exp(-FRICTION * stepSec);
      body.velocityX *= slowdown;
      body.velocityY *= slowdown;
      body.x += body.velocityX * stepSec;
      body.y += body.velocityY * stepSec;
    }
    // Bumps: push overlapping players apart; a dashing player hits much harder.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const first = state.bodies[ids[i]!]!;
        const second = state.bodies[ids[j]!]!;
        if (first.respawnInSec || second.respawnInSec || frozenIds.has(ids[i]!) || frozenIds.has(ids[j]!)) continue;
        const gapX = second.x - first.x;
        const gapY = second.y - first.y;
        const distance = Math.hypot(gapX, gapY);
        if (distance === 0 || distance >= BODY_RADIUS * 2) continue;
        const normalX = gapX / distance;
        const normalY = gapY / distance;
        const overlap = BODY_RADIUS * 2 - distance;
        first.x -= (normalX * overlap) / 2;
        first.y -= (normalY * overlap) / 2;
        second.x += (normalX * overlap) / 2;
        second.y += (normalY * overlap) / 2;
        const push = 260 + (first.dashLeftSec ? 520 : 0) + (second.dashLeftSec ? 520 : 0);
        if (first.dashLeftSec >= second.dashLeftSec) {
          second.velocityX += normalX * push;
          second.velocityY += normalY * push;
          first.velocityX -= normalX * push * 0.3;
          first.velocityY -= normalY * push * 0.3;
          second.lastHitById = ids[i]!;
        } else {
          first.velocityX -= normalX * push;
          first.velocityY -= normalY * push;
          second.velocityX += normalX * push * 0.3;
          second.velocityY += normalY * push * 0.3;
          first.lastHitById = ids[j]!;
        }
      }
    }
    // Off the edge: whoever bumped them last scores.
    for (const id of ids) {
      const body = state.bodies[id]!;
      if (body.respawnInSec || Math.hypot(body.x, body.y) <= PLATFORM_RADIUS) continue;
      body.respawnInSec = RESPAWN_DELAY_SEC;
      const hitter = body.lastHitById && state.bodies[body.lastHitById];
      if (hitter) hitter.score++;
      room.broadcast({ knockedOutId: id, byId: body.lastHitById });
    }
    // Everyone's place goes out by itself after this tick: state sync sends what changed of stateView.
  },
};

export default arena;
