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
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", pass, room: first.listed === false ? { listed: false } : undefined })));
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
    ["arena", 3],
    ["arena", 1],
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
 * Pretend rooms for Cave Crew, as if a busy game had players around the world: they show the region
 * filter, "Show more" and the gauge for big rooms (bigger than our rooms allow yet). They're only rows
 * in the list, so joining one starts an empty room. Run again to keep them from going stale.
 */
export function pretendRoomsSql(now = Date.now()) {
  const rooms = [
    ["DEFR44", 9, 16, "DE", "EU"], ["FRPAR2", 4, 16, "FR", "EU"], ["GBLDN3", 12, 16, "GB", "EU"], ["PLWAW5", 2, 16, "PL", "EU"],
    ["ESMAD6", 15, 16, "ES", "EU"], ["SEST07", 6, 16, "SE", "EU"], ["BRSAO8", 7, 16, "BR", "SA"], ["ARBUE9", 3, 16, "AR", "SA"],
    ["JPTKY2", 11, 16, "JP", "AS"], ["KRSEL3", 16, 16, "KR", "AS"], ["INDEL4", 5, 16, "IN", "AS"], ["AUSYD5", 8, 16, "AU", "OC"],
    ["CATOR6", 10, 16, "CA", "NA"], ["MXMEX7", 1, 16, "MX", "NA"], ["ZAJNB8", 4, 16, "ZA", "AF"], ["USBIG9", 31, 40, "US", "NA"],
  ];
  const values = rooms.map(([code, players, max, country, continent]) => `((SELECT id FROM games WHERE slug = 'cave-crew'), '${code}', ${players}, ${max}, 1, '${country}', '${continent}', ${now}, ${now})`);
  return `INSERT OR REPLACE INTO open_rooms (game_id, code, players, max_players, open, country, continent, created_at, updated_at) VALUES ${values.join(", ")}`;
}
