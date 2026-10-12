import { SAVE_LIMIT_BYTES, accountById, bumpSave, canonicalSave, gameBySlug, parseSave, saveHash, saveKey, saveRow } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * Cloud saves: GET and PUT /api/saves/<game>, called by the game page on zaisma.com
 * with the player's session cookie. The game itself never talks to this; it only
 * hands its browser save to the game page (see packages/sdk/saves.js).
 */
export async function handleSaves(request: Request, env: Env, slug: string): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method === "PUT") {
    // Only our own game page writes saves.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return json({ error: "Not allowed from here." }, 403);
  } else if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  if (!session || !account) return json({ error: "Sign in to save to your account." }, 401);
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status !== "live" || !game.cloud_saves) return json({ error: "This game doesn't save to accounts." }, 404);
  const withCookies = (res: Response) => {
    for (const c of session.cookies) res.headers.append("Set-Cookie", c);
    return res;
  };

  // A per-account, per-game tag the game page uses to remember which save this device last had.
  const tag = (await saveHash(`${account.id}:${game.id}`)).slice(0, 16);

  if (request.method === "GET") {
    const row = await saveRow(env.DB, account.id, game.id);
    const object = row ? await env.SAVES.get(saveKey(account.id, game.id)) : null;
    if (!row || !object) return withCookies(json({ tag, version: row?.version ?? 0 }));
    return withCookies(json({ tag, version: row.version, hash: row.hash, at: row.updated_at, data: JSON.parse(await object.text()) }));
  }

  if (env.SAVE_LIMIT && !(await env.SAVE_LIMIT.limit({ key: account.id })).success) return json({ error: "Saving too often." }, 429);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > SAVE_LIMIT_BYTES * 2 + 1024) return json({ error: "This save is too big." }, 413);
  let body: { base?: unknown; data?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Bad save." }, 400);
  }
  const base = Number(body.base);
  const data = typeof body.data === "string" ? parseSave(body.data) : null;
  if (!Number.isInteger(base) || base < 0 || !data) return json({ error: "Bad save." }, 400);
  const text = canonicalSave(data);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > SAVE_LIMIT_BYTES) return json({ error: "This save is too big." }, 413);

  const hash = await saveHash(text);
  const version = await bumpSave(env.DB, { accountId: account.id, gameId: game.id, base, hash, bytes });
  if (version === null) {
    // Another device saved since this one loaded: the player chooses which to keep.
    const row = await saveRow(env.DB, account.id, game.id);
    return withCookies(json({ error: "Played on another device.", version: row?.version ?? 0, at: row?.updated_at ?? null }, 409));
  }
  await env.SAVES.put(saveKey(account.id, game.id), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version: String(version) } });
  return withCookies(json({ version, hash, at: Date.now() }));
}

/** Delete every save file for an account (with the account). */
export async function deleteSaveFiles(env: Env, accountId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.SAVES.list({ prefix: `${accountId}/`, cursor });
    if (list.objects.length) await env.SAVES.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
