// Test players for the local preview: they keep a few rooms open, so the Rooms tab on game pages
// has something in it. They connect like a game does (a guest pass, then the room's WebSocket),
// stand still, and come back if the rooms server restarts.
import WebSocket from "ws";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
let address = 0;

async function guestPass(rooms, origin, game) {
  // Each test player asks from its own made-up address, so they don't use up your own pass limit.
  const res = await fetch(`${rooms}/v1/pass`, { method: "POST", headers: { origin, "content-type": "text/plain", "cf-connecting-ip": `198.51.100.${++address}` }, body: JSON.stringify({ game }) });
  if (!res.ok) throw new Error(`No pass for ${game}: ${res.status}`);
  return (await res.json()).pass;
}

function stayIn(rooms, origin, game, code, pass, first) {
  const ws = new WebSocket(`${rooms.replace(/^http/, "ws")}/v1/rooms/${game}/${code}`, { origin });
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", pass, room: { listed: first.listed, name: first.name, labels: first.labels } })));
  ws.on("message", (data) => {
    const m = JSON.parse(String(data));
    // Once everyone's in, the room's first player closes it, as a game's host does when the match starts.
    if (m.t === "players" && first.closeAt && m.players.length >= first.closeAt) ws.send(JSON.stringify({ t: "room", open: false }));
  });
  ws.on("error", () => {});
  // Back in after a restart; a refusal (4001) or an ended match (4000) is final.
  ws.on("close", (why) => why !== 4000 && why !== 4001 && setTimeout(() => stayIn(rooms, origin, game, code, pass, first), 2000));
}

/** Rooms of each kind: some with space, a full one, a closed one and a hidden one (never listed). */
export async function openTestRooms(rooms, origin) {
  const plan = [
    ["arena", 3, { name: "Bumper cars", labels: { Map: "Classic" } }],
    ["arena", 1, { labels: { Map: "Ice" } }],
    ["arena", 8],
    ["four-in-a-row", 1],
    ["cave-crew", 2],
    ["cave-crew", 5, { closeAt: 5 }],
    ["cave-crew", 3, { listed: false }],
  ];
  for (const [game, players, first = {}] of plan) {
    const code = newCode();
    for (let i = 0; i < players; i++) {
      stayIn(rooms, origin, game, code, await guestPass(rooms, origin, game), i === 0 ? first : {});
      // One at a time, so the first one in is the room's first player.
      await new Promise((r) => setTimeout(r, 150));
    }
  }
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
  return `INSERT OR REPLACE INTO live_rooms (game_id, code, players, max_players, open, name, labels, country, continent, created_at, updated_at) VALUES ${values.join(", ")}`;
}
