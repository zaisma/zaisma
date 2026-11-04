import type { DoorContract } from "@zaisma/core";

/**
 * Every kind of address on the game domain (docs/DOORS.md). All of them are GET and HEAD, and all go through serve,
 * whose guard is the row found here. A game's files are public once it's live, a game's status is read on each
 * request; a tester or preview address opens only through its link, which openThroughLink proves.
 * test/node/doors.test.ts fails on an _zaisma/ address in this Worker's code that has no row here.
 */
export type GameFileDoorName = "file" | "preview_address" | "tester_address" | ZaismaAddress;

/** The addresses Zaisma answers itself, inside every game's own address. */
export type ZaismaAddress = (typeof ZAISMA_ADDRESSES)[number];
const ZAISMA_ADDRESSES = [
  "_zaisma/enter",
  "_zaisma/entered",
  "_zaisma/background",
  "_zaisma/background.json",
  "_zaisma/background.glsl",
  "_zaisma/background-still.png",
  "_zaisma/background-texture",
  "_zaisma/shader-preview",
  "_zaisma/v1.js",
  "_zaisma/v1.d.ts",
  "_zaisma/relay.js",
  "_zaisma/picture.js",
  "_zaisma/performance.js",
  "_zaisma/saves.js",
  "_zaisma/restore",
  "_zaisma/warm",
  "_zaisma/warm.json",
  "_zaisma/warm.js",
  "_zaisma/warm-redirects.json",
] as const;

const PUBLIC: DoorContract = { whoMayCall: "anyone", reaches: "nothing_private", trusts: [] };
const OPEN_THROUGH_LINK = { source_path: "apps/games/src/index.ts", symbol_name: "openThroughLink" };

export const GAME_FILE_DOORS: Readonly<Record<GameFileDoorName, DoorContract>> = {
  file: PUBLIC,
  preview_address: { whoMayCall: "link_holder", reaches: "game", trusts: ["preview_link"], provenBy: OPEN_THROUGH_LINK },
  tester_address: { whoMayCall: "link_holder", reaches: "game", trusts: ["tester_link"], provenBy: OPEN_THROUGH_LINK },
  "_zaisma/enter": { whoMayCall: "link_holder", reaches: "game", trusts: ["preview_link", "tester_link"], provenBy: OPEN_THROUGH_LINK },
  "_zaisma/entered": { whoMayCall: "link_holder", reaches: "game", trusts: ["preview_link", "tester_link"], provenBy: OPEN_THROUGH_LINK },
  "_zaisma/background": PUBLIC,
  "_zaisma/background.json": PUBLIC,
  "_zaisma/background.glsl": PUBLIC,
  "_zaisma/background-still.png": PUBLIC,
  "_zaisma/background-texture": PUBLIC,
  "_zaisma/shader-preview": PUBLIC,
  "_zaisma/v1.js": PUBLIC,
  "_zaisma/v1.d.ts": PUBLIC,
  "_zaisma/relay.js": PUBLIC,
  "_zaisma/picture.js": PUBLIC,
  "_zaisma/performance.js": PUBLIC,
  "_zaisma/saves.js": { whoMayCall: "anyone", reaches: "nothing_private", trusts: ["session"] },
  "_zaisma/restore": { whoMayCall: "anyone", reaches: "nothing_private", trusts: ["session"] },
  "_zaisma/warm": PUBLIC,
  "_zaisma/warm.json": PUBLIC,
  "_zaisma/warm.js": PUBLIC,
  "_zaisma/warm-redirects.json": PUBLIC,
};

/** The door a request is at: its address's kind first, since a link's address opens only through its link, whatever the path. */
export function gameFileDoorAt(path: string, addressKind: "preview" | "tester" | null): DoorContract {
  if (addressKind === "preview") return GAME_FILE_DOORS.preview_address;
  if (addressKind === "tester") return GAME_FILE_DOORS.tester_address;
  return Object.hasOwn(GAME_FILE_DOORS, path) && path !== "file" ? GAME_FILE_DOORS[path as ZaismaAddress] : GAME_FILE_DOORS.file;
}
