import type { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import type { API_ROUTES } from "../../apps/site/src/developer.ts";
import type { SITE_DOORS, SiteDoor } from "../../apps/site/src/doors.ts";
import type { TOOLS } from "../../apps/site/src/mcp.ts";
import type { GAME_FILE_DOORS } from "../../apps/games/src/doors.ts";
import type { ROOM_ADDRESS_DOORS } from "../../apps/rooms/src/doors.ts";
import type { ROOM_MESSAGE_DOORS } from "../../packages/game-server/src/internal.ts";
import { COVERED_ELSEWHERE } from "./samples.ts";

/**
 * Which doors each grid file tries, from the door tables alone, so a file that fails as a whole (it never loaded, or its setup
 * threw) lands on the doors it covers, not on the file. The grid files take their rows from here too, so the two can't drift.
 * Pure: the reporter runs it in Node on the tables scripts/security-map/load-site.mjs bundles.
 */

export interface GridTables {
  API_ROUTES: typeof API_ROUTES;
  TOOLS: typeof TOOLS;
  ADMIN_TOOLS: typeof ADMIN_TOOLS;
  SITE_DOORS: typeof SITE_DOORS;
  GAME_FILE_DOORS: typeof GAME_FILE_DOORS;
  ROOM_ADDRESS_DOORS: typeof ROOM_ADDRESS_DOORS;
  ROOM_MESSAGE_DOORS: typeof ROOM_MESSAGE_DOORS;
}

/** How many pages-N.grid.ts files share the site's doors. */
export const PAGE_SHARE_COUNT = 3;

/** The site's rows the grid tries: each method of a door, but those another grid file covers. */
export function pageRows(siteDoors: readonly SiteDoor[]): (readonly [string, SiteDoor, string])[] {
  return siteDoors
    .flatMap((door) => (door.methods === "any" ? (["POST"] as const) : door.methods).map((method) => ({ door, method })))
    .filter(({ door, method }) => !(`${method} ${door.path}` in COVERED_ELSEWHERE))
    .map(({ door, method }) => [door.methods === "any" ? `page:${door.path}` : `page:${method} ${door.path}`, door, method] as const);
}

/** The game domain's addresses the grid tries. */
export const gameFileAddresses = (gameFileDoors: GridTables["GAME_FILE_DOORS"]): string[] => ["--preview", "--tester", "/", "/<file>", ...Object.keys(gameFileDoors).filter((name) => name.startsWith("_zaisma/"))];

/** The door ids a grid file tries, by its path from the repository's root; null for a file that isn't the grid's. */
export function doorIdsOfGridFile(file: string, tables: GridTables): string[] | null {
  const pageShare = file.match(/^test\/grid\/pages-(\d+)\.grid\.ts$/);
  if (pageShare) return pageRows(tables.SITE_DOORS).filter((_, rowIndex) => rowIndex % PAGE_SHARE_COUNT === Number(pageShare[1]) - 1).map(([doorId]) => doorId);
  switch (file) {
    case "test/grid/api.grid.ts":
      return tables.API_ROUTES.map((apiRoute) => `api:${apiRoute.method} ${apiRoute.path}`);
    case "test/grid/mcp.grid.ts":
      return [...tables.TOOLS.filter((tool) => !tool.replacedBy).map((tool) => `mcp:${tool.name}`), ...tables.ADMIN_TOOLS.map((tool) => `admin:${tool.name}`)];
    case "test/grid/game-files.grid.ts":
      return gameFileAddresses(tables.GAME_FILE_DOORS).map((address) => `game-file:${address}`);
    case "test/grid/room-messages.grid.ts":
      return Object.keys(tables.ROOM_MESSAGE_DOORS).filter((type) => type !== "hello").map((type) => `room-message:${type}`);
    case "test/grid/rooms.grid.ts":
      return [...tables.ROOM_ADDRESS_DOORS.map((door) => `rooms:${door.path}`), "room-message:hello"];
    default:
      return null;
  }
}
