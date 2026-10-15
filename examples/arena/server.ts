// Arena game server: a real-time top-down arena for 2–8 players. Dash into
// other players to bump them off the platform. Ticks 20 times a second.
// Only plain JavaScript plus type annotations, so Node can run it as-is.
//
// Messages, in whole words (rooms are billed per message, not by size):
//   from players: { input: [x, y] } (a direction, each -1 to 1), { dash: true }, { color: "#ff5d5d" }
//   to players:   { snapshot: [{ playerId, x, y, score, isDashing, isOut, name, color }] } every tick,
//                 { knockedOutPlayerId, byPlayerId } when someone falls off (byPlayerId null if nobody bumped them)
import type { GameServer, Player, Room } from "@zaisma/game-server";

const PLATFORM_RADIUS_PX = 360;
const BODY_RADIUS_PX = 18;
/** Speed gained each second while steering, in px per second. */
const ACCELERATION = 1400;
const FRICTION_PER_SEC = 4;
const DASH_SPEED_PX_PER_SEC = 720;
const DASH_DURATION_SEC = 0.25;
const DASH_COOLDOWN_SEC = 1.2;
const RESPAWN_DELAY_SEC = 1.5;
const BOT_COUNT_WHEN_ALONE = 2;
const COLORS = ["#ff5d5d", "#4fc3ff", "#ffd84f", "#7dff8a", "#d07bff", "#ff9e4f", "#4fffe1", "#ff7bc4"];

interface Body {
  name: string;
  color: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  inputX: number;
  inputY: number;
  dashCooldownSec: number;
  dashLeftSec: number;
  /** Seconds until they're back on the platform, 0 while in play. */
  respawnInSec: number;
  score: number;
  lastHitByPlayerId: string | null;
  isBot: boolean;
}

interface State {
  bodies: Record<string, Body>;
  colorIndex: number;
  botCount: number;
}

function spawn(body: Body): void {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * PLATFORM_RADIUS_PX * 0.5;
  body.x = Math.cos(angle) * distance;
  body.y = Math.sin(angle) * distance;
  body.velocityX = body.velocityY = 0;
  body.respawnInSec = 0;
  body.lastHitByPlayerId = null;
}

function newBody(state: State, name: string, isBot: boolean, color?: string): Body {
  const body: Body = {
    name,
    color: color ?? COLORS[state.colorIndex++ % COLORS.length]!,
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    inputX: 0,
    inputY: 0,
    dashCooldownSec: 0,
    dashLeftSec: 0,
    respawnInSec: 0,
    score: 0,
    lastHitByPlayerId: null,
    isBot,
  };
  spawn(body);
  return body;
}

/** Bots keep a lone player company until friends arrive. */
function fillBots(state: State, room: Room): void {
  const wanted = room.players.length >= 2 ? 0 : BOT_COUNT_WHEN_ALONE;
  const bots = Object.keys(state.bodies).filter((id) => state.bodies[id]!.isBot);
  for (let i = bots.length; i < wanted; i++) state.bodies[`bot${++state.botCount}`] = newBody(state, `Bot ${state.botCount}`, true);
  for (const id of bots.slice(wanted)) delete state.bodies[id];
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
  body.velocityX = directionX * DASH_SPEED_PX_PER_SEC;
  body.velocityY = directionY * DASH_SPEED_PX_PER_SEC;
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
  if (Math.hypot(bot.x, bot.y) > PLATFORM_RADIUS_PX * 0.75) [towardX, towardY] = [-bot.x, -bot.y];
  const length = Math.hypot(towardX, towardY) || 1;
  bot.inputX = (towardX / length) * 0.7;
  bot.inputY = (towardY / length) * 0.7;
  if (target && nearest < 90 && Math.random() < 0.04) startDash(bot);
}

const arena: GameServer<State> = {
  maximumPlayerCount: 8,
  ticksPerSec: 20,

  setup: () => ({ bodies: {}, colorIndex: 0, botCount: 0 }),

  // The player's game sends the color they picked last time as joinData.
  onJoin(state, player: Player, room, joinData) {
    const color = (joinData as { color?: unknown } | undefined)?.color;
    state.bodies[player.id] = newBody(state, player.name, false, typeof color === "string" && COLORS.includes(color) ? color : undefined);
    fillBots(state, room);
  },

  onLeave(state, player, room) {
    delete state.bodies[player.id];
    fillBots(state, room);
  },

  onMessage(state, player, messageData) {
    const body = state.bodies[player.id];
    if (!body || !messageData || typeof messageData !== "object") return;
    const message = messageData as { input?: unknown; dash?: unknown; color?: unknown };
    if (typeof message.color === "string" && COLORS.includes(message.color)) body.color = message.color;
    if (Array.isArray(message.input) && message.input.length === 2) {
      let [inputX, inputY] = message.input.map(Number) as [number, number];
      if (!Number.isFinite(inputX) || !Number.isFinite(inputY)) return;
      const length = Math.hypot(inputX, inputY);
      if (length > 1) [inputX, inputY] = [inputX / length, inputY / length];
      body.inputX = inputX;
      body.inputY = inputY;
    }
    if (message.dash === true) startDash(body);
  },

  onTick(state, tickDurationSec, room) {
    const stepSec = Math.min(tickDurationSec, 0.1);
    const ids = Object.keys(state.bodies);
    for (const id of ids) {
      const body = state.bodies[id]!;
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
      const slowdown = Math.exp(-FRICTION_PER_SEC * stepSec);
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
        if (first.respawnInSec || second.respawnInSec) continue;
        const gapX = second.x - first.x;
        const gapY = second.y - first.y;
        const distance = Math.hypot(gapX, gapY);
        if (distance === 0 || distance >= BODY_RADIUS_PX * 2) continue;
        const normalX = gapX / distance;
        const normalY = gapY / distance;
        const overlap = BODY_RADIUS_PX * 2 - distance;
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
          second.lastHitByPlayerId = ids[i]!;
        } else {
          first.velocityX -= normalX * push;
          first.velocityY -= normalY * push;
          second.velocityX += normalX * push * 0.3;
          second.velocityY += normalY * push * 0.3;
          first.lastHitByPlayerId = ids[j]!;
        }
      }
    }
    // Off the edge: whoever bumped them last scores.
    for (const id of ids) {
      const body = state.bodies[id]!;
      if (body.respawnInSec || Math.hypot(body.x, body.y) <= PLATFORM_RADIUS_PX) continue;
      body.respawnInSec = RESPAWN_DELAY_SEC;
      const hitter = body.lastHitByPlayerId && state.bodies[body.lastHitByPlayerId];
      if (hitter) hitter.score++;
      room.broadcast({ knockedOutPlayerId: id, byPlayerId: body.lastHitByPlayerId });
    }
    room.broadcast({
      snapshot: ids.map((id) => {
        const body = state.bodies[id]!;
        return { playerId: id, x: Math.round(body.x), y: Math.round(body.y), score: body.score, isDashing: body.dashLeftSec > 0, isOut: body.respawnInSec > 0, name: body.name, color: body.color };
      }),
    });
  },
};

export default arena;
