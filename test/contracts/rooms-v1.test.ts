import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isRoomCode } from "../../packages/game-server/src/names.ts";
import { bytesFrame } from "../../packages/game-server/src/room.ts";
import { loadSdk } from "../sdk-stand-in.ts";
import { lockSurfaces, ROOT, scriptConstantsOf, surfaceOf } from "./surface.ts";

/**
 * The rooms' v1 contract: everything a room says between the SDK, the game server and the game. rooms.json
 * holds the SDK's room types and lists, rooms-wire.json the messages on the socket, the limits and the
 * close codes; both are also checked against GitHub's main, so a baseline can't take back what v1 had.
 * sdk-rooms.d.ts is a frozen copy of the SDK's types as v1 had them, compiled against today's: a game's
 * old options still fit, and what the SDK hands the game still fits code written for v1.
 */

const SDK_TYPES = "packages/sdk/zaisma.d.ts";
const FROZEN_TYPES = join(import.meta.dirname, "v1/sdk-rooms.d.ts");
const isWritingBaseline = Boolean(process.env.CONTRACTS_WRITE_BASELINE);

/** The SDK's room types: what a game passes in and what it's handed. */
const SDK_ROOM_TYPES = [
  "JoinOptions",
  "QuickJoinOptions",
  "ListOptions",
  "MoveJoinOptions",
  "KickOptions",
  "RoomInfo",
  "SendOptions",
  "SmoothingOptions",
  "Room",
  "RoomEvents",
  "Player",
  "ListedPlayer",
  "RoomSettings",
  "RoomSettingsChange",
  "Ended",
  "Ending",
  "Moved",
  "Idle",
  "Away",
  "Back",
  "Kicked",
  "Move",
  "RoomError",
  "VersionUpdate",
  "RoomList",
  "ListedRoom",
  "ConnectionStatus",
  "RoomErrorCode",
  "EndReason",
  "FriendJoinRefusal",
  "Region",
];

/** Options a game writes: v1's must still fit today's. */
const INPUTS = ["JoinOptions", "QuickJoinOptions", "ListOptions", "MoveJoinOptions", "KickOptions", "RoomInfo", "SendOptions", "SmoothingOptions", "RoomEvents"];
/** What the SDK hands a game: today's must still fit code written for v1's. */
const OUTPUTS = ["Room", "Player", "ListedPlayer", "RoomSettings", "RoomSettingsChange", "Ended", "Ending", "Moved", "Idle", "Away", "Back", "Kicked", "Move", "RoomError", "VersionUpdate", "RoomList", "ListedRoom", "ConnectionStatus"];
/**
 * Unions v1 lets grow: the frozen copy takes any other string too, so a new value doesn't break it. One added
 * here after the baseline is opened when the frozen copy is checked (PlayerKind, for outside_zaisma).
 */
const GROWING = ["RoomErrorCode", "EndReason", "FriendJoinRefusal", "PlayerKind"];

/** Each growing union in a namespace's text opened to any other string, once. */
function withGrowingOpen(namespace: string, file: string): string {
  let opened = namespace;
  for (const name of GROWING) {
    const declaration = new RegExp(`(\\n  type ${name} =[\\s\\S]*?);\\n`);
    if (!declaration.test(opened)) throw new Error(`No type ${name} in ${file}`);
    opened = opened.replace(declaration, (_, union: string) => (union.endsWith("(string & {})") ? `${union};\n` : `${union} | (string & {});\n`));
  }
  return opened;
}

/** The SDK's namespace as it is now, renamed ZaismaV1, with the growing unions opened and the checks after it. */
function frozenTypes(): string {
  const text = readFileSync(join(ROOT, SDK_TYPES), "utf8");
  const start = text.indexOf("declare namespace Zaisma {");
  const end = text.indexOf("\ninterface Window");
  const namespace = withGrowingOpen(text.slice(start, end).trimEnd().replace("declare namespace Zaisma {", "declare namespace ZaismaV1 {"), SDK_TYPES);
  const checks = [
    ...INPUTS.map((name) => `type ${name}Fits = Fits<ZaismaV1.${name}, Zaisma.${name}>;`),
    ...OUTPUTS.map((name) => `type ${name}StillFits = Fits<Zaisma.${name}, ZaismaV1.${name}>;`),
  ];
  return [
    "// Written by npm run contracts:baseline from packages/sdk/zaisma.d.ts: the SDK's room types as v1 had them. Never edit by hand.",
    "",
    namespace,
    "",
    "/** Compiles only when Given fits Wanted. */",
    "type Fits<Given extends Wanted, Wanted> = [Given, Wanted];",
    ...checks,
    "",
  ].join("\n");
}

describe("rooms v1", () => {
  lockSurfaces(
    "rooms",
    {
      ...surfaceOf(SDK_TYPES, SDK_ROOM_TYPES, "Zaisma"),
      ...scriptConstantsOf("packages/sdk/zaisma.js", [
        "ROOM_EVENTS",
        "JOIN_OPTIONS",
        "QUICK_JOIN_OPTIONS",
        "LIST_OPTIONS",
        "SEND_OPTIONS",
        "SMOOTHING_OPTIONS",
        "REGIONS",
        "PROTOCOL_VERSION_NUMBER",
        "MAXIMUM_QUEUED_SEND_COUNT",
        "MAXIMUM_SEND_SIZE_BYTES",
        "MINIMUM_IDLE_TIMEOUT_SEC",
        "MAXIMUM_IDLE_TIMEOUT_SEC",
        "IDLE_ANSWER_TIMEOUT_SEC",
      ]),
    },
    { isMainKept: true },
  );

  lockSurfaces(
    "rooms-wire",
    surfaceOf("packages/game-server/src/room.ts", [
      "ClientMessage",
      "ServerMessage",
      "EndReason",
      "RoomErrorCode",
      "VersionUpdate",
      "ROOM_LIMITS",
      "PROTOCOL_VERSION_NUMBER",
      "ENDED_CLOSE_CODE",
      "REMOVED_CLOSE_CODE",
      "SEAT_GONE_CLOSE_CODE",
      "NO_ANSWER_CLOSE_CODE",
      "VERSION_UPDATE_CLOSE_CODE",
      "BUSY_CLOSE_CODE",
    ]),
    { isMainKept: true },
  );

  if (isWritingBaseline) {
    it("writes the frozen SDK room types", () => writeFileSync(FROZEN_TYPES, frozenTypes()));
  } else {
    it("still fits the SDK's room types as v1 had them", () => {
      const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], strict: true, noEmit: true, types: [] };
      const host = ts.createCompilerHost(options);
      const readFile = host.readFile.bind(host);
      host.readFile = (file) => (file === FROZEN_TYPES ? withGrowingOpen(readFileSync(FROZEN_TYPES, "utf8"), FROZEN_TYPES) : readFile(file));
      const program = ts.createProgram([join(ROOT, SDK_TYPES), FROZEN_TYPES], options, host);
      const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) => `${diagnostic.file?.fileName.replace(ROOT, "") ?? ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
      expect(errors, "Today's SDK types no longer fit v1's (test/contracts/v1/sdk-rooms.d.ts)").toEqual([]);
    });
  }

  it("frames bytes as v1 did: the sender's ID length, the ID, then the bytes", () => {
    const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    expect(hex(bytesFrame(new Uint8Array([1, 2, 3]), "player_ab"))).toBe("09 70 6c 61 79 65 72 5f 61 62 01 02 03");
  });

  it("refuses room codes that are invalid forever, in the game server and the SDK", async () => {
    // Only codes no growth makes valid: a 0, and lowercase. Six characters may become up to 12.
    for (const roomCode of ["K7Q2M0", "abc"]) {
      expect(isRoomCode(roomCode)).toBe(false);
      const sdk = loadSdk();
      await expect(sdk.Zaisma.joinRoom({ roomCode })).rejects.toMatchObject({ code: "bad_room_code" });
    }
  });
});
