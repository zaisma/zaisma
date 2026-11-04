import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, it } from "vitest";
import { addTesterLink, createAccessGrant, createApiKey, createAccount } from "@zaisma/core";
import { GAME_FILE_DOORS } from "../../apps/games/src/doors.ts";
import { cellOf, problemWithAnswer, type CallAnswer, type CallerKind, type GridCell } from "./cells.ts";

/**
 * Every address on the game domain by every kind of caller (test/grid/cells.ts). Nothing here reads a session: what proves a
 * caller is a game's status, and for a link's address the access cookie its link gave. A key proves nothing, a banned developer's
 * games are down, and another game's cookie opens nothing here.
 */

const G = "https://games.example";
let gameNumber = 0;

async function addGame(status: string, visibility: string): Promise<{ id: string; slug: string; versionId: string }> {
  const n = ++gameNumber;
  const id = `game${n}`;
  const slug = `grid-game-${n}`;
  const versionId = `version_v${n}`;
  const prefix = `games/${id}/${versionId}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 0, 0)").bind(id, slug, slug, status, visibility, status === "pending" ? null : versionId).run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, preview_link_key, ai_review_status, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', ?, 'passed', 0)").bind(versionId, id, prefix, `key${n}`).run();
  await env.GAMES.put(`${prefix}/index.html`, "<!doctype html><p>private page</p>");
  return { id, slug, versionId };
}

/** A browser's access cookie for a link's address, from a grant, as zaisma.com gives one. */
async function accessCookie(slug: string, addressKind: "preview" | "tester", grantKey: string): Promise<string> {
  const entered = await SELF.fetch(`${G}/${slug}--${addressKind}/_zaisma/enter?grant=${grantKey}`, { redirect: "manual" });
  return (entered.headers.get("set-cookie") ?? "").split(";")[0]!;
}

const answerOf = async (path: string, headers: Record<string, string> = {}, redirect: RequestRedirect = "manual"): Promise<CallAnswer> => {
  const response = await SELF.fetch(`${G}${path}`, { headers, redirect });
  const text = await response.text();
  return { http_status: response.status, location: response.headers.get("location"), is_owners_changed: false, is_private_value_shown: text.includes("private page") };
};

/** Addresses that answer the same at any status, and why that shows nothing of a game's. */
const SAME_AT_ANY_STATUS: Readonly<Record<string, string>> = {
  "_zaisma/shader-preview": "The shader runner's own page, with nothing of the game's: the dashboard posts it what to draw.",
};

const LINK_ADDRESSES = { "--preview": "preview", "--tester": "tester" } as const;
const callers = ["another_account", "stranger", "weaker_key", "another_games_key", "banned_account", "banned_developer"] as const;

describe("every address on the game domain", () => {
  let token: string;
  beforeAll(async () => {
    await createAccount(env.DB, { id: "grid-files-account", username: "Files_Owner", ageBand: "18+" });
    token = (await createApiKey(env.DB, "grid-files-account", "Grid key")).token;
  });
  afterAll(() => env.DB.exec("DELETE FROM api_keys; DELETE FROM accounts; DELETE FROM game_access_passes; DELETE FROM tester_links;"));

  const addresses = [
    ...(["--preview", "--tester"] as const),
    "/",
    "/<file>",
    ...Object.keys(GAME_FILE_DOORS).filter((name) => name.startsWith("_zaisma/")),
  ];

  it.for(addresses.map((address) => [`game-file:${address}`, address] as const))("%s", { timeout: 60_000 }, async ([doorId, address], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const push = (callerKind: CallerKind, problem: string | null) => cells.push(cellOf(doorId, callerKind, problem));
    const live = await addGame("live", "listed");
    const draft = await addGame("pending", "draft");
    const held = await addGame("held", "listed");
    const removed = await addGame("removed", "listed");
    // A game that was live and went private: its version is still its live one, and only its status may keep it in.
    const hidden = await addGame("live", "private");

    if (address === "--preview" || address === "--tester") {
      const addressKind = LINK_ADDRESSES[address];
      const grantFor = async (game: { id: string; versionId: string }) => (addressKind === "preview" ? createAccessGrant(env.DB, { gameId: game.id, addressKind, versionId: game.versionId, expiresAtMs: Date.now() + 3_600_000 }) : createAccessGrant(env.DB, { gameId: game.id, addressKind, testerId: (await addTesterLink(env.DB, env, game.id, "Testers")).id, expiresAtMs: Date.now() + 3_600_000 }));
      // A preview opens a draft; a tester link opens what its game has live or passed.
      const opened = addressKind === "preview" ? draft : live;
      const cookie = await accessCookie(opened.slug, addressKind, await grantFor(opened));
      const path = `/${opened.slug}--${addressKind}/`;
      // The cookie of another game's link, under this game's name.
      const other = addressKind === "preview" ? await addGame("pending", "draft") : await addGame("live", "listed");
      const othersCookie = (await accessCookie(other.slug, addressKind, await grantFor(other))).replace(other.slug, opened.slug);
      const refusedAt = async (callerKind: CallerKind, given: string, headers: Record<string, string>) => push(callerKind, problemWithAnswer("refused", null, await answerOf(given, headers)));
      push("owner", problemWithAnswer("goes_through", null, await answerOf(path, { cookie })));
      await refusedAt("stranger", path, {});
      await refusedAt("another_account", path, { cookie: othersCookie });
      await refusedAt("another_games_key", path, { cookie: othersCookie });
      await refusedAt("weaker_key", path, { authorization: `Bearer ${token}` });
      await refusedAt("banned_account", `/${held.slug}--${addressKind}/`, { cookie });
      await refusedAt("banned_developer", `/${removed.slug}--${addressKind}/`, { cookie });
      return;
    }

    // The same request at a draft nobody may see, and at a game that's down: only a live game answers, whoever asks.
    const pathAt = (slug: string) => (address === "/" ? `/${slug}/` : address === "/<file>" ? `/${slug}/index.html` : `/${slug}/${address}`);
    const isLinkEntry = address === "_zaisma/enter" || address === "_zaisma/entered";
    // A live game's address sends on to its version's own, as a browser follows.
    const ownerAnswer = await answerOf(pathAt(live.slug), {}, address === "/" || address === "/<file>" ? "follow" : "manual");
    // A game's own files must answer, so a refusal below can't be a world that serves nothing. Zaisma's addresses may have nothing to show yet (no background): only their own code failing is wrong.
    const isGameFile = address === "/" || address === "/<file>";
    push("owner", isGameFile ? (ownerAnswer.http_status === 200 && ownerAnswer.is_private_value_shown ? null : `Answered ${ownerAnswer.http_status}, where a live game's file should open.`) : isLinkEntry || ownerAnswer.http_status < 500 ? null : `Answered ${ownerAnswer.http_status}.`);
    for (const callerKind of callers) {
      const slug = callerKind === "banned_account" ? held.slug : callerKind === "banned_developer" ? removed.slug : callerKind === "another_account" ? hidden.slug : draft.slug;
      const headers: Record<string, string> = callerKind === "weaker_key" || callerKind === "another_games_key" ? { authorization: `Bearer ${token}` } : {};
      push(callerKind, problemWithAnswer(address in SAME_AT_ANY_STATUS ? "own_things_only" : "refused", null, await answerOf(pathAt(slug), headers)));
    }
  });
});
