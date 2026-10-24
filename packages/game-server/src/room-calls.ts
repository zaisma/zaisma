// What a game's room calls (room.broadcast, room.kick, room.reserve …) are checked for. Zaisma's rooms run a
// game server in a sandbox, where a call only records what the game asked; the same checks run there, at the
// call, so a mistake throws in the game's own handler and its developer sees it in the game's logs, exactly
// as on their own server, where the room checks the call itself.

/** The room limits the checks read; ROOM_LIMITS has all of them. */
export interface RoomCallLimits {
  maximumKickMessageCharacterCount: number;
  maximumLatestKeyCharacterCount: number;
  maximumSetupDataSizeBytes: number;
  maximumJoinDataSizeBytes: number;
  maximumNameCharacterCount: number;
  maximumLabelNameCharacterCount: number;
  maximumLabelValueCharacterCount: number;
  maximumLabelCount: number;
}

/** The error a mistake in a room call throws: GameServerError, or the sandbox's copy of it. */
export type RoomCallErrorClass = new (code: "bad_room_call" | "room_call_unavailable", field: string, message: string, fix: string) => Error;

/** A send's delivery as the room acts on it: latest-only, with its latestKey, or reliable. */
export type CheckedDelivery = { isLatestOnly: false } | { isLatestOnly: true; latestKey: string };

export interface CheckedSend {
  delivery: CheckedDelivery;
  fromPlayerId: string | null;
}

export interface CheckedBroadcast extends CheckedSend {
  audience: "everyone" | "players" | "spectators";
  exceptPlayerId: string | undefined;
}

export interface CheckedReserve {
  playerIds: string[];
  setupData: unknown;
  isListed: boolean;
  friendJoinsEnabled: boolean;
  isKept: boolean;
  name: string | null;
  labels: Record<string, string>;
}

export interface CheckedMove {
  playerIds: string[];
  joinData: unknown;
}

export interface RoomCallChecks {
  checkBroadcast(message: unknown, broadcastOptions: unknown): CheckedBroadcast;
  checkSend(playerId: unknown, message: unknown, sendOptions: unknown): CheckedSend & { playerId: string };
  checkBroadcastBytes(bytes: unknown, broadcastOptions: unknown): CheckedBroadcast & { bytes: Uint8Array };
  checkSendBytes(playerId: unknown, bytes: unknown, sendOptions: unknown): CheckedSend & { playerId: string; bytes: Uint8Array };
  checkKick(playerId: unknown, kickOptions: unknown): { playerId: string; message: string; isKeptOut: boolean };
  checkReserve(reserveOptions: unknown, playerIdsInRoom: readonly string[]): CheckedReserve;
  checkMoveTo(toRoomCode: unknown, moveOptions: unknown, playerIdsInRoom: readonly string[]): CheckedMove & { toRoomCode: string };
  checkSetInfo(nameAndLabels: unknown): { name?: string | null; labels?: Record<string, string> };
  checkEnd(message: unknown): string | undefined;
  /** Text with hidden characters dropped, spaces collapsed, cut to the length. */
  tidy(given: unknown, maximumCharacterCount: number): string;
  /** A name and labels within the limits, with hidden characters dropped. Fields left out stay out. */
  tidyRoomInfo(nameAndLabels: { name?: unknown; labels?: unknown }): { name?: string | null; labels?: Record<string, string> };
  /** Plain JSON within maximumSizeBytes, copied, or isValid false. Nothing (undefined or null) is null. */
  checkRoomData(given: unknown, maximumSizeBytes: number): { isValid: true; checkedData: unknown } | { isValid: false };
}

interface RoomCallChecksParts {
  checksFor(ErrorClass: RoomCallErrorClass, limits: RoomCallLimits): RoomCallChecks;
}

/** The parts, as one function with nothing from outside it, so its source runs the same in the sandbox. */
function roomCallChecksParts(): RoomCallChecksParts {
  // Characters that hide text or flip its direction.
  const HIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
  const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const BROADCAST_FIELDS = ["exceptPlayerId", "audience", "delivery", "latestKey", "fromPlayerId"];
  const SEND_FIELDS = ["delivery", "latestKey", "fromPlayerId"];

  function checksFor(ErrorClass: RoomCallErrorClass, limits: RoomCallLimits): RoomCallChecks {
    const mistake = (call: string, message: string, fix: string) => new ErrorClass("bad_room_call", call, message, fix);

    const tidy = (given: unknown, maximumCharacterCount: number): string =>
      String(given ?? "")
        .normalize("NFKC")
        .replace(HIDDEN, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maximumCharacterCount)
        .trim();

    /** A call's options with only the fields it takes: anything else throws, naming the ones it does. */
    const closed = (given: unknown, fields: readonly string[], call: string): Record<string, unknown> => {
      if (given === undefined || given === null) return {};
      if (typeof given !== "object" || Array.isArray(given)) throw mistake(call, `${call}'s options must be an object.`, `Give { ${fields.join(", ")} } or leave them out.`);
      for (const field of Object.keys(given)) {
        if (!fields.includes(field)) throw mistake(call, `${call} doesn't take ${field}.`, `It takes: ${fields.join(", ")}.`);
      }
      return given as Record<string, unknown>;
    };

    const readText = (given: unknown, name: string, call: string): string => {
      if (typeof given !== "string" || !given) throw mistake(call, `${call}'s ${name} must be a player's ID, like player.id.`, `Give the ${name} as text.`);
      return given;
    };

    /** A send's delivery and latestKey. latest_only needs its latestKey. */
    const readDelivery = (given: Record<string, unknown>, call: string): CheckedDelivery => {
      const { delivery, latestKey } = given;
      if (delivery !== undefined && delivery !== "reliable" && delivery !== "latest_only") throw mistake(call, `${call}'s delivery is ${JSON.stringify(delivery) ?? "not text"}.`, 'Give "reliable" (the default) or "latest_only".');
      if (latestKey !== undefined && (typeof latestKey !== "string" || latestKey.length > limits.maximumLatestKeyCharacterCount)) {
        throw mistake(call, `${call}'s latestKey must be text up to ${limits.maximumLatestKeyCharacterCount} characters.`, 'Give a short name for the slot this update replaces, like "positions".');
      }
      if (delivery !== "latest_only") return { isLatestOnly: false };
      if (latestKey === undefined) throw mistake(call, `${call}'s delivery is "latest_only" with no latestKey.`, 'latest_only needs a latestKey: the slot this update replaces, like "position".');
      return { isLatestOnly: true, latestKey: latestKey as string };
    };

    /** Who a send says it's from (SendOptions.fromPlayerId), or null for the game server. */
    const readFromPlayerId = (given: Record<string, unknown>, call: string): string | null => {
      if (given.fromPlayerId === undefined) return null;
      if (typeof given.fromPlayerId !== "string" || !given.fromPlayerId) throw mistake(call, `${call}'s fromPlayerId must be a player's ID, like player.id.`, "Give the ID of the player the message is from, or leave it out.");
      return given.fromPlayerId;
    };

    const readAudience = (given: Record<string, unknown>, call: string): "everyone" | "players" | "spectators" => {
      const audience = given.audience;
      if (audience === undefined || audience === "everyone") return "everyone";
      if (audience === "players" || audience === "spectators") return audience;
      throw mistake(call, `${call}'s audience is ${typeof audience === "string" ? JSON.stringify(audience.slice(0, 40)) : typeof audience}.`, 'Give "everyone", "players" or "spectators", or leave it out for everyone.');
    };

    const readExcept = (given: Record<string, unknown>, call: string): string | undefined => {
      if (given.exceptPlayerId === undefined) return undefined;
      return readText(given.exceptPlayerId, "exceptPlayerId", call);
    };

    /** Bytes a game handed the room, as a Uint8Array: anything else is a mistake in the game's call. */
    const readBytes = (given: unknown, call: string): Uint8Array => {
      if (given instanceof Uint8Array) return given;
      if (given instanceof ArrayBuffer) return new Uint8Array(given);
      if (ArrayBuffer.isView(given)) return new Uint8Array(given.buffer, given.byteOffset, given.byteLength);
      throw mistake(call, `${call} takes bytes.`, "Give a Uint8Array, another typed array or an ArrayBuffer.");
    };

    const checkRoomData = (given: unknown, maximumSizeBytes: number): { isValid: true; checkedData: unknown } | { isValid: false } => {
      if (given === undefined || given === null) return { isValid: true, checkedData: null };
      let text: string | undefined;
      try {
        text = JSON.stringify(given);
      } catch {
        return { isValid: false };
      }
      if (text === undefined || new TextEncoder().encode(text).length > maximumSizeBytes) return { isValid: false };
      return { isValid: true, checkedData: JSON.parse(text) };
    };

    const tidyRoomInfo = (nameAndLabels: { name?: unknown; labels?: unknown }): { name?: string | null; labels?: Record<string, string> } => {
      const out: { name?: string | null; labels?: Record<string, string> } = {};
      if (nameAndLabels.name !== undefined) out.name = nameAndLabels.name === null ? null : tidy(nameAndLabels.name, limits.maximumNameCharacterCount) || null;
      if (nameAndLabels.labels !== undefined) {
        const labels: Record<string, string> = {};
        if (nameAndLabels.labels && typeof nameAndLabels.labels === "object") {
          for (const [labelName, labelValue] of Object.entries(nameAndLabels.labels)) {
            const key = tidy(labelName, limits.maximumLabelNameCharacterCount);
            const shown = typeof labelValue === "string" || typeof labelValue === "number" ? tidy(labelValue, limits.maximumLabelValueCharacterCount) : "";
            if (key && shown && Object.keys(labels).length < limits.maximumLabelCount) labels[key] = shown;
          }
        }
        out.labels = labels;
      }
      return out;
    };

    const checkBroadcast = (message: unknown, broadcastOptions: unknown): CheckedBroadcast => {
      const given = closed(broadcastOptions, BROADCAST_FIELDS, "room.broadcast");
      return { audience: readAudience(given, "room.broadcast"), exceptPlayerId: readExcept(given, "room.broadcast"), delivery: readDelivery(given, "room.broadcast"), fromPlayerId: readFromPlayerId(given, "room.broadcast") };
    };

    const checkSend = (playerId: unknown, message: unknown, sendOptions: unknown): CheckedSend & { playerId: string } => {
      const given = closed(sendOptions, SEND_FIELDS, "room.send");
      return { playerId: readText(playerId, "playerId", "room.send"), delivery: readDelivery(given, "room.send"), fromPlayerId: readFromPlayerId(given, "room.send") };
    };

    const checkBroadcastBytes = (bytes: unknown, broadcastOptions: unknown): CheckedBroadcast & { bytes: Uint8Array } => {
      const given = closed(broadcastOptions, BROADCAST_FIELDS, "room.broadcastBytes");
      return {
        bytes: readBytes(bytes, "room.broadcastBytes"),
        audience: readAudience(given, "room.broadcastBytes"),
        exceptPlayerId: readExcept(given, "room.broadcastBytes"),
        delivery: readDelivery(given, "room.broadcastBytes"),
        fromPlayerId: readFromPlayerId(given, "room.broadcastBytes"),
      };
    };

    const checkSendBytes = (playerId: unknown, bytes: unknown, sendOptions: unknown): CheckedSend & { playerId: string; bytes: Uint8Array } => {
      const given = closed(sendOptions, SEND_FIELDS, "room.sendBytes");
      return { playerId: readText(playerId, "playerId", "room.sendBytes"), bytes: readBytes(bytes, "room.sendBytes"), delivery: readDelivery(given, "room.sendBytes"), fromPlayerId: readFromPlayerId(given, "room.sendBytes") };
    };

    const checkKick = (playerId: unknown, kickOptions: unknown) => {
      const given = closed(kickOptions, ["message", "keepOut"], "room.kick");
      return { playerId: readText(playerId, "playerId", "room.kick"), message: tidy(given.message, limits.maximumKickMessageCharacterCount), isKeptOut: given.keepOut === true };
    };

    const checkReserve = (reserveOptions: unknown, playerIdsInRoom: readonly string[]): CheckedReserve => {
      const given = closed(reserveOptions, ["playerIds", "setupData", "isListed", "friendJoinsEnabled", "isKept", "name", "labels"], "room.reserve");
      const playerIds = [...new Set(Array.isArray(given.playerIds) ? given.playerIds : [])].filter((id): id is string => typeof id === "string" && playerIdsInRoom.includes(id));
      if (!playerIds.length) throw mistake("room.reserve", "room.reserve needs playerIds of players who are in this room.", "Give playerIds from room.players.");
      const checked = checkRoomData(given.setupData, limits.maximumSetupDataSizeBytes);
      if (!checked.isValid) throw mistake("room.reserve", `room.reserve's setupData isn't plain JSON up to ${limits.maximumSetupDataSizeBytes / 1024} KB.`, "Give numbers, text, true or false, null, lists and plain objects, and keep them small.");
      const nameAndLabels = tidyRoomInfo({ name: given.name ?? null, labels: given.labels ?? {} });
      return {
        playerIds,
        setupData: checked.checkedData,
        isListed: given.isListed === true,
        friendJoinsEnabled: given.friendJoinsEnabled !== false,
        isKept: given.isKept === true,
        name: nameAndLabels.name ?? null,
        labels: nameAndLabels.labels ?? {},
      };
    };

    const checkMoveTo = (toRoomCode: unknown, moveOptions: unknown, playerIdsInRoom: readonly string[]): CheckedMove & { toRoomCode: string } => {
      if (typeof toRoomCode !== "string" || !ROOM_CODE.test(toRoomCode)) throw mistake("room.moveTo", "room.moveTo needs a room code.", "Give the code of a room of this game, like the one room.reserve answered.");
      const given = closed(moveOptions, ["playerIds", "joinData"], "room.moveTo");
      const playerIds = [...new Set(Array.isArray(given.playerIds) ? given.playerIds : [])].filter((id): id is string => typeof id === "string" && playerIdsInRoom.includes(id));
      if (!playerIds.length) throw mistake("room.moveTo", "room.moveTo needs playerIds of players who are in this room.", "Give playerIds from room.players.");
      const checked = checkRoomData(given.joinData, limits.maximumJoinDataSizeBytes);
      if (!checked.isValid) throw mistake("room.moveTo", `room.moveTo's joinData isn't plain JSON up to ${limits.maximumJoinDataSizeBytes / 1024} KB.`, "Give numbers, text, true or false, null, lists and plain objects, and keep them small.");
      return { toRoomCode, playerIds, joinData: checked.checkedData };
    };

    const checkSetInfo = (nameAndLabels: unknown) => tidyRoomInfo(closed(nameAndLabels, ["name", "labels"], "room.setInfo"));

    const checkEnd = (message: unknown): string | undefined => {
      if (message === undefined || message === null) return undefined;
      if (typeof message !== "string") throw mistake("room.end", "room.end's message must be text.", "Give the text players see, or leave it out.");
      return message.slice(0, limits.maximumKickMessageCharacterCount);
    };

    return { checkBroadcast, checkSend, checkBroadcastBytes, checkSendBytes, checkKick, checkReserve, checkMoveTo, checkSetInfo, checkEnd, tidy, tidyRoomInfo, checkRoomData };
  }

  return { checksFor };
}

/** The checks for a runtime: pass its GameServerError class and the room limits. */
export function roomCallChecks(ErrorClass: RoomCallErrorClass, limits: RoomCallLimits): RoomCallChecks {
  return roomCallChecksParts().checksFor(ErrorClass, limits);
}

/**
 * The same parts as an ES module's source, for the game server's sandbox: export default is { checksFor }.
 * A bundler that names functions (esbuild's keepNames) calls __name inside them, so the module gives it.
 */
export function roomCallChecksModuleSource(): string {
  return `var __name = (target) => target;\nexport default (${roomCallChecksParts.toString()})();\n`;
}
