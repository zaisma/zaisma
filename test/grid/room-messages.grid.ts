import { describe, it } from "vitest";
import { ROOM_MESSAGE_DOORS, RoomCore, relay, type Transport } from "../../packages/game-server/src/internal.ts";
import { cellOf, type CallerKind, type GridCell } from "./cells.ts";

/**
 * Every message a room takes, by every kind of caller in a room (test/grid/cells.ts): its host, a player, a spectator, someone
 * who never joined, and someone who was removed. `hello` proves its sender with a pass, before there's a room member at all, so
 * test/grid/rooms.grid.ts tries it through the real address.
 */

const SAMPLE_MESSAGES: Record<string, Record<string, unknown>> = {
  probe_answer: { probeNumber: 1 },
  room: { room: { isOpen: false } },
  kick: { playerId: "other", message: "Removed." },
  here: {},
  idle: {},
  hidden: {},
  shown: {},
  back: {},
  message: { data: "hit" },
  bytes: {},
  chat: { text: "hello" },
  block: { playerId: "other" },
  unblock: { playerId: "other" },
  friend_request: { playerId: "other" },
  "zaisma:purchase": { receipt: "not-a-receipt" },
};

function roomWithEveryone() {
  const sent: string[] = [];
  const transport: Transport = { roomCode: "K7Q2MX", send: (id, text) => void sent.push(`${id} ${text}`), sendBytes: (id) => void sent.push(`${id} bytes`), close: (id) => void sent.push(`${id} closed`) };
  const room = new RoomCore(relay, transport);
  room.join({ id: "host", name: "Host", kind: "guest" }, { isListed: true });
  room.join({ id: "other", name: "Other", kind: "guest" });
  room.join({ id: "watcher", name: "Watcher", kind: "guest" }, { isSpectator: true });
  room.join({ id: "removed", name: "Removed", kind: "guest" });
  room.receive("host", JSON.stringify({ type: "kick", playerId: "removed", message: "Removed." }));
  sent.length = 0;
  return { room, sent };
}

describe("every room message", () => {
  const messageTypes = Object.keys(ROOM_MESSAGE_DOORS).filter((type) => type !== "hello");
  it.for(messageTypes.map((type) => [`room-message:${type}`, type] as const))("%s", ([doorId, type], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const contract = ROOM_MESSAGE_DOORS[type as keyof typeof ROOM_MESSAGE_DOORS];
    const text = JSON.stringify({ type, ...SAMPLE_MESSAGES[type] });
    const answerOf = (playerId: string) => {
      const { room, sent } = roomWithEveryone();
      return { answer: room.receive(playerId, text), sent };
    };
    const refused = (playerId: string, callerKind: CallerKind) => {
      const { answer, sent } = answerOf(playerId);
      cells.push(cellOf(doorId, callerKind, answer === "not_allowed" || sent.length === 0 ? null : "Answered, where a room should refuse this caller."));
    };
    const goesThrough = (playerId: string, callerKind: CallerKind) => cells.push(cellOf(doorId, callerKind, answerOf(playerId).answer === "not_allowed" ? "Refused, where it should go through." : null));

    goesThrough("host", "owner");
    if (contract.whoMayCall === "room_host") refused("other", "another_account");
    else goesThrough("other", "another_account");
    // A spectator is the weaker caller: in the room, without a player's say.
    if (contract.whoMayCall === "room_member") goesThrough("watcher", "weaker_key");
    else refused("watcher", "weaker_key");
    refused("nobody", "stranger");
    // A ban takes someone out of the room: what they send after that does nothing.
    refused("removed", "banned_account");
    refused("removed", "banned_developer");
  });
});
