import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { extractSymbol } from "../../scripts/security-map/anchors.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { apiRoutesOfTool, collectDoors } from "../../scripts/security-map/doors.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { loadSiteModule } from "../../scripts/security-map/load-site.mjs";
import { sampleOf } from "../door-samples.ts";

/**
 * Every door has a contract (docs/DOORS.md). The tables say what a door is; this reads the code that answers,
 * so a path, message or address a handler names without a row fails here, before the guard refuses it for real.
 */

const ROOT = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** A file's paths: the shapes route code writes them in. */
function pathsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/path\s*(?:===|!==)\s*"(\/[^"]*)"/g)) found.push(match[1]!);
  for (const match of text.matchAll(/\[((?:\s*"[^"]*"\s*,?)+)\]\.includes\(path\)/g)) for (const literal of match[1]!.matchAll(/"([^"]*)"/g)) found.push(literal[1]!);
  for (const match of text.matchAll(/path\.match\(\/(\^(?:\\.|[^/\\\n])*)\/[a-z]*\)/g)) found.push(sampleOf(match[1]!));
  return found;
}

const SITE_ROUTE_FILES = ["account", "passkeys", "sign-in", "mcp-sign-in", "dashboard", "developer-settings", "forum-pages", "friends", "friend-requests", "friends-now", "blocks", "players-sheet", "profiles", "plays", "home", "game-links", "admin", "admin-feedback", "admin-publishing", "admin-profiles", "admin-chat-reviews", "precedents", "review-precedents", "index", "buy", "announcements", "speed-reports"];

describe("Every door has a contract", () => {
  let site: any;
  let doors: any[];
  beforeAll(async () => {
    site = await loadSiteModule(ROOT);
    doors = await collectDoors(ROOT, site);
  });

  it("gives every path a site handler names a row", () => {
    const missing = SITE_ROUTE_FILES.flatMap((name) => {
      const file = `apps/site/src/${name}.ts`;
      const text = read(file);
      const arrayPaths = name === "account" ? [...extractSymbol(text, "PATHS")!.matchAll(/"([^"]*)"/g)].map((match) => match[1]!) : [];
      return [...pathsIn(text), ...arrayPaths].filter((path) => site.siteDoorAt(path, "GET") === "no_door").map((path) => `${file}: ${path}`);
    });
    expect(missing, "Add a row to SITE_DOORS (apps/site/src/doors.ts): the guard answers each of these as nothing there").toEqual([]);
  });

  it("gives every form on a game's dashboard and on developer settings a row of its own", () => {
    const dashboard = read("apps/site/src/dashboard.ts");
    const settings = read("apps/site/src/developer-settings.ts");
    const actions = [
      ...[...dashboard.matchAll(/action === "(\/[^"]+)"/g)].map((match) => match[1]!),
      ...[...dashboard.matchAll(/action\.match\(\/\^\\(\/(?:\\.|[^/\\\n])*)\$\//g)].map((match) => sampleOf(match[1]!)),
    ].filter((action) => action !== "/export.zip");
    const subs = [...settings.matchAll(/sub === "([^"]+)"/g)].map((match) => match[1]!);
    const subPatterns = [...settings.matchAll(/sub\.match\(\/\^((?:\\.|[^/\\\n])*)\$\//g)].map((match) => sampleOf(match[1]!));
    const paths = [...actions.map((action) => `/dashboard/sky-hopper${action}`), ...[...subs, ...subPatterns].map((sub) => `/dashboard/settings/${sub}`)];
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.filter((path) => typeof site.siteDoorAt(path, "POST") === "string"), "Add a row to SITE_DOORS").toEqual([]);
  });

  it("gives every message a room's receive names a row", () => {
    const receive = extractSymbol(read("packages/game-server/src/room.ts"), "receive")!;
    const named = [...receive.matchAll(/case "([^"]+)":/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((type) => !Object.hasOwn(site.ROOM_MESSAGE_DOORS, type))).toEqual([]);
  });

  it("gives every address Zaisma answers on the game domain a row", () => {
    const named = ["apps/games/src/index.ts", "apps/games/src/background.ts"].flatMap((file) => [...read(file).matchAll(/(?:===\s*|^\s*)"(_zaisma\/[^"]+)"/gm)].map((match) => match[1]!));
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((address) => !Object.hasOwn(site.GAME_FILE_DOORS, address))).toEqual([]);
  });

  it("gives every address the rooms Worker names a row", () => {
    const fetchText = read("apps/rooms/src/index.ts");
    const named = [...fetchText.matchAll(/url\.pathname\s*===\s*"(\/[^"]*)"/g)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(10);
    const rowPaths = site.ROOM_ADDRESS_DOORS.map((door: { path: string }) => door.path);
    expect(named.filter((path) => !rowPaths.includes(path))).toEqual([]);
  });

  it("states a contract on every door, and names a function that exists wherever one proves the caller", () => {
    const contracted = doors.filter((door: { door_kind: string }) => door.door_kind !== "token_or_session");
    expect(contracted.filter((door: { contract: unknown }) => !door.contract).map((door: { door_id: string }) => door.door_id)).toEqual([]);
    const proofs = new Set(contracted.flatMap((door: { contract: { provenBy?: { source_path: string; symbol_name: string } } }) => (door.contract.provenBy ? [`${door.contract.provenBy.source_path}:${door.contract.provenBy.symbol_name}`] : [])));
    expect(proofs.size).toBeGreaterThan(5);
    const gone = [...proofs].filter((proof) => {
      const [file, symbol] = (proof as string).split(":") as [string, string];
      return extractSymbol(read(file), symbol) === null;
    });
    expect(gone).toEqual([]);
  });

  it("keeps Zaisma's whole-site reach for Zaisma's own people", () => {
    const wide = doors.filter((door: { contract: { reaches?: string; whoMayCall?: string } | null }) => door.contract && (door.contract.reaches === "any_game" || door.contract.reaches === "zaisma_settings"));
    expect(wide.length).toBeGreaterThan(20);
    expect(wide.filter((door: { contract: { whoMayCall: string } }) => door.contract.whoMayCall !== "admin").map((door: { door_id: string }) => door.door_id)).toEqual([]);
  });

  it("has every live MCP tool make an API call, so the router holds it", async () => {
    const withNoCall = [];
    for (const tool of site.TOOLS.filter((candidate: { replacedBy?: string }) => !candidate.replacedBy)) if ((await apiRoutesOfTool(site, tool)).length === 0) withNoCall.push(tool.name);
    expect(withNoCall).toEqual([]);
  });

  it("names only doors that exist on a stored value", () => {
    const ids = new Set(doors.map((door: { door_id: string }) => door.door_id));
    const missing = site.STORED_VALUES.flatMap((entry: { stored: string; saved_by_door_ids: string[]; shown_on_door_ids: string[] }) => [...entry.saved_by_door_ids, ...entry.shown_on_door_ids].filter((id) => !ids.has(id)).map((id) => `${entry.stored}: ${id}`));
    expect(missing).toEqual([]);
  });

  it("answers only a rooms address's own method, and opens a link's address only through its link", () => {
    expect(site.ROOM_ADDRESS_DOORS.filter((door: { contract: { whoMayCall: string; provenBy?: unknown } }) => door.contract.whoMayCall !== "anyone" && !door.contract.provenBy)).toEqual([]);
    expect(site.GAME_FILE_DOORS.preview_address.whoMayCall).toBe("link_holder");
    expect(site.GAME_FILE_DOORS.tester_address.whoMayCall).toBe("link_holder");
  });

  it("leaves the internal Workers with no address of their own", () => {
    for (const app of ["compress", "photodna"]) {
      const wrangler = read(`apps/${app}/wrangler.jsonc`);
      expect(wrangler).toMatch(/"workers_dev":\s*false/);
      expect(wrangler).not.toMatch(/"routes"/);
    }
  });
});
