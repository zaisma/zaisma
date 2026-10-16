// Test players for the local preview: they keep a few rooms open, so the Rooms tab on game pages
// has something in it. They connect like a game does (a guest pass, then the room's WebSocket),
// stand still, and come back if the rooms server restarts.
import WebSocket from "ws";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
let address = 0;
/** The preview's zaisma.com, where test players get their keys to passes like a browser does. */
let site = "";

async function guestPass(rooms, origin, game) {
  // Each test player asks from its own made-up address, so they don't use up your own limits.
  const headers = { "content-type": "text/plain", "cf-connecting-ip": `198.51.100.${++address}` };
  // The game page's key, as a browser gets it when Cloudflare's check on Play passes: the preview uses
  // Cloudflare's test keys, which pass this token.
  // The site can still be settling right after it starts, so try a few times.
  let key;
  for (let i = 0; i < 5 && !key; i++) {
    const check = await fetch(`${site}/api/plays/${game}`, { method: "POST", headers: { ...headers, origin: site }, body: JSON.stringify({ token: "XXXX.DUMMY.TOKEN.XXXX" }) }).catch(() => null);
    key = check?.status === 200 ? (await check.json()).key : undefined;
    if (!key) await new Promise((r) => setTimeout(r, 1000));
  }
  const res = await fetch(`${rooms}/v1/pass`, { method: "POST", headers: { ...headers, origin }, body: JSON.stringify({ gameSlug: game, roomKey: key }) });
  if (!res.ok) throw new Error(`No pass for ${game}: ${res.status}`);
  return (await res.json()).pass;
}

/**
 * Ping like a game does, and say the player's still there now and then, as a game does while its
 * player gives input: otherwise rooms drop test players as gone or idle.
 */
function keepUp(ws) {
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(timer);
    ws.send("ping");
    ws.send(JSON.stringify({ type: "here" }));
  }, 20_000);
  ws.on("close", () => clearInterval(timer));
}

/** A room's message, or null for the room's answer to a ping. */
const read = (data) => (String(data) === "pong" ? null : JSON.parse(String(data)));

function stayIn(rooms, origin, game, code, pass, first) {
  const ws = new WebSocket(`${rooms.replace(/^http/, "ws")}/v1/rooms/${game}/${code}`, { origin });
  keepUp(ws);
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", pass, room: { isListed: first.isListed, name: first.name, labels: first.labels } })));
  ws.on("message", (data) => {
    const m = read(data);
    if (!m) return;
    // Once everyone's in, the room's first player closes it, as a game's host does when the match starts.
    if (m.type === "players" && first.closeAt && m.players.length >= first.closeAt) ws.send(JSON.stringify({ type: "room", isOpen: false }));
  });
  ws.on("error", () => {});
  // Back in after a restart; a refusal (4001) or an ended match (4000) is final.
  ws.on("close", (why) => why !== 4000 && why !== 4001 && setTimeout(() => stayIn(rooms, origin, game, code, pass, first), 2000));
}

/** Another lobby player, trying again while the rooms server restarts (it does when files change). */
function lobbyAgain(rooms, origin, code, ms) {
  setTimeout(() => lobbyBot(rooms, origin, code).catch(() => lobbyAgain(rooms, origin, code, 2000)), ms);
}

/**
 * A Four in a Row player waiting in the lobby (a room labelled Room: Lobby). When the game pairs it
 * with you, it follows the move to your match, plays random columns and leaves when you do; another
 * one takes its place in the lobby.
 */
async function lobbyBot(rooms, origin, code) {
  const game = "four-in-a-row";
  const pass = await guestPass(rooms, origin, game);
  const ws = new WebSocket(`${rooms.replace(/^http/, "ws")}/v1/rooms/${game}/${code}`, { origin });
  keepUp(ws);
  let moved = false;
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", pass, room: { labels: { Room: "Lobby" } } })));
  ws.on("message", (data) => {
    const m = read(data);
    if (!m || m.type !== "move" || moved) return;
    moved = true;
    ws.close(1000);
    play(rooms, origin, game, m.roomCode, pass);
    lobbyAgain(rooms, origin, code, 1000);
  });
  ws.on("error", () => {});
  ws.on("close", (why) => !moved && why !== 4000 && why !== 4001 && lobbyAgain(rooms, origin, code, 2000));
}

function play(rooms, origin, game, code, pass) {
  const ws = new WebSocket(`${rooms.replace(/^http/, "ws")}/v1/rooms/${game}/${code}`, { origin });
  keepUp(ws);
  let me = null;
  let met = false;
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", pass })));
  ws.on("message", (data) => {
    const m = read(data);
    if (!m) return;
    if (m.type === "welcome") me = m.me.id;
    // Once you've arrived, it leaves when you do.
    if (m.type === "players") met = met || m.players.length >= 2;
    if (m.type === "players" && met && m.players.length < 2) ws.close(1000);
    if (m.type !== "message" || !m.data.board) return;
    const match = m.data;
    const mySeat = match.seatPlayerIds.indexOf(me) + 1;
    if (match.winnerSeat || match.isDraw) return void setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "message", data: { playAgain: true } })), 3000);
    if (match.turnSeat !== mySeat) return;
    const open = [0, 1, 2, 3, 4, 5, 6].filter((column) => match.board[column] === 0);
    setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "message", data: { column: open[Math.floor(Math.random() * open.length)] } })), 700);
  });
  ws.on("error", () => {});
}

/** Rooms of each kind: some with space, a full one, a closed one and a hidden one (never listed). */
export async function openTestRooms(rooms, origin, siteOrigin) {
  site = siteOrigin;
  const plan = [
    ["arena", 3, { name: "Bumper cars", labels: { Map: "Classic" } }],
    ["arena", 1, { labels: { Map: "Ice" } }],
    ["arena", 8],
    ["four-in-a-row", 1],
    ["cave-crew", 2],
    ["cave-crew", 5, { closeAt: 5 }],
    ["cave-crew", 3, { isListed: false }],
  ];
  for (const [game, players, first = {}] of plan) {
    const code = newCode();
    for (let i = 0; i < players; i++) {
      stayIn(rooms, origin, game, code, await guestPass(rooms, origin, game), i === 0 ? first : {});
      // One at a time, so the first one in is the room's first player.
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  await lobbyBot(rooms, origin, newCode());
}

/**
 * Pretend rooms for Cave Crew, as if a busy game had players around the world: they show names and
 * labels (and a name the text filter keeps off the page), label and region filters, "Show more" and a
 * room bigger than ours allow yet. They're only rows in the list, so joining one starts an empty room.
 * Run again to keep them from going stale.
 */
export function pretendRoomsSql(now = Date.now()) {
  // Names and labels as players might type them; one name fails Zaisma's text filter, so the page leaves it out.
  const rooms = [
    ["DEFR44", 9, 16, "DE", "EU", "Ana's castle", { Mode: "Survival", World: "Desert" }],
    ["FRPAR2", 4, 16, "FR", "EU", null, { Mode: "Creative" }],
    ["GBLDN3", 12, 16, "GB", "EU", "Friday night crew", { Mode: "Survival", World: "Islands" }],
    ["PLWAW5", 2, 16, "PL", "EU", null, {}],
    ["ESMAD6", 15, 16, "ES", "EU", "Mina los túneles", { Mode: "Survival", World: "Caves" }],
    ["SEST27", 6, 16, "SE", "EU", null, { Mode: "Creative" }],
    ["BRSAW8", 7, 16, "BR", "SA", "Base dos amigos", { Mode: "Survival" }],
    ["ARBUE9", 3, 16, "AR", "SA", null, {}],
    ["JPTKY2", 11, 16, "JP", "AS", "Sakura village", { Mode: "Creative", World: "Islands" }],
    ["KRSEL3", 16, 16, "KR", "AS", null, { Mode: "Survival" }],
    ["JNDEL4", 5, 16, "IN", "AS", "add me on snap: digger99", { Mode: "Survival" }],
    ["AUSYD5", 8, 16, "AU", "OC", "Outback diggers", { Mode: "Survival", World: "Desert" }],
    ["CATQR6", 10, 16, "CA", "NA", null, { Mode: "Survival" }],
    ["MXMEX7", 1, 16, "MX", "NA", null, {}],
    ["ZAJNB8", 4, 16, "ZA", "AF", null, { Mode: "Creative" }],
    ["USBHG9", 31, 40, "US", "NA", "Community server #1", { Mode: "Survival", World: "Desert" }],
  ];
  const sql = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
  const values = rooms.map(
    ([code, players, max, country, continent, name, labels]) =>
      `((SELECT id FROM games WHERE slug = 'cave-crew'), '${code}', ${players}, ${max}, 1, ${sql(name)}, ${sql(JSON.stringify(labels))}, '${country}', '${continent}', ${now}, ${now})`,
  );
  return `INSERT OR REPLACE INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, name, labels, country, continent, created_at_ms, updated_at_ms) VALUES ${values.join(", ")}`;
}
