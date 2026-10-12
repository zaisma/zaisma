import {
  SAVE_LIMIT_BYTES,
  accountById,
  addSaveCopy,
  bumpSave,
  canonicalSave,
  copyReason,
  gameBySlug,
  newId,
  parseSave,
  saveCopyKey,
  saveHash,
  saveHistory,
  saveKey,
  saveRow,
  savedGames,
  type Game,
  type SaveCopy,
  type SaveCopyReason,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { html, layout, type Raw } from "./html.ts";

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
  let body: { base?: unknown; data?: unknown; replace?: unknown; keep?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Bad save." }, 400);
  }
  const data = typeof body.data === "string" ? parseSave(body.data) : null;
  if (!data) return json({ error: "Bad save." }, 400);
  const text = canonicalSave(data);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > SAVE_LIMIT_BYTES) return json({ error: "This save is too big." }, 413);
  const hash = await saveHash(text);

  // The player picked the account's progress over this device's: keep this device's as an earlier version.
  if (body.keep === true) {
    await keepCopy(env, { account_id: account.id, game_id: game.id, at: Date.now(), reason: "device", hash, bytes }, async () => text);
    return withCookies(json({ kept: true }));
  }

  const base = Number(body.base);
  if (!Number.isInteger(base) || base < 0) return json({ error: "Bad save." }, 400);
  const current = base ? await saveRow(env.DB, account.id, game.id) : null;
  const version = await bumpSave(env.DB, { accountId: account.id, gameId: game.id, base, hash, bytes });
  if (version === null) {
    // Another device saved since this one loaded: the player chooses which to keep.
    const row = await saveRow(env.DB, account.id, game.id);
    return withCookies(json({ error: "Played on another device.", version: row?.version ?? 0, at: row?.updated_at ?? null }, 409));
  }
  // Before replacing the save, keep a copy now and then, and whenever progress looks about to be lost.
  if (current && current.version === base && current.hash !== hash) {
    const copy = { account_id: account.id, game_id: game.id, at: current.updated_at, hash: current.hash, bytes: current.bytes };
    await keepCopy(env, copy, () => readSave(env, account.id, game.id), (newest) => copyReason(current, { bytes, replace: body.replace === true }, newest));
  }
  await env.SAVES.put(saveKey(account.id, game.id), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version: String(version) } });
  return withCookies(json({ version, hash, at: Date.now() }));
}

const readSave = async (env: Env, accountId: string, gameId: string) => (await env.SAVES.get(saveKey(accountId, gameId)))?.text() ?? null;

/**
 * Keep a copy of some progress in the game's history, unless it already has this exact progress.
 * `reason` is fixed, or worked out from when the newest copy was made (null: no copy needed).
 */
async function keepCopy(
  env: Env,
  copy: Omit<SaveCopy, "id" | "reason"> & { reason?: SaveCopyReason },
  text: () => Promise<string | null>,
  why?: (newestAt: number | null) => SaveCopyReason | null,
): Promise<void> {
  const copies = await saveHistory(env.DB, copy.account_id, copy.game_id);
  if (copies.some((c) => c.hash === copy.hash)) return;
  const reason = copy.reason ?? why?.(copies[0]?.at ?? null) ?? null;
  const data = reason ? await text() : null;
  if (!reason || data === null) return;
  const full: SaveCopy = { ...copy, id: newId(), reason };
  await env.SAVES.put(saveCopyKey(full.account_id, full.game_id, full.id), data, { httpMetadata: { contentType: "application/json" } });
  const dropped = await addSaveCopy(env.DB, full, copies);
  if (dropped.length) await env.SAVES.delete(dropped.map((c) => saveCopyKey(c.account_id, c.game_id, c.id)));
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

// --- Earlier versions: /account/saves and /account/saves/<game> ---

const REASONS: Record<SaveCopyReason, string> = {
  hourly: "",
  replaced: "Replaced by a device's progress you picked",
  smaller: "Before the save shrank, like after a restart",
  restore: "Before you went back to an earlier version",
  device: "A device's progress you didn't pick",
};

/** The player's saves and each game's earlier versions, with a way back to any of them. */
export async function handleSaveHistory(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/account\/saves(?:\/([a-z0-9-]+)(\/restore)?)?$/);
  if (!match || !env.SUPABASE_URL) return null;
  const [, slug, restore] = match as unknown as [string, string | undefined, string | undefined];
  const post = request.method === "POST";
  if (post) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  if (!session || !account) return redirect(`/signin?next=${encodeURIComponent(path)}`);
  const done = (res: Response) => {
    for (const c of session.cookies) res.headers.append("Set-Cookie", c);
    return res;
  };

  if (!slug) return done(page(env, "Your saves", await listPage(env, account.id)));
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.status !== "live" || !game.cloud_saves) return done(page(env, "Your saves", html`<h1>No saves here</h1><p class="lead">This game doesn't save to accounts.</p><a class="btn ghost" href="/account/saves">Your saves</a>`, 404));

  if (restore && post) {
    const id = String((await request.formData()).get("id") ?? "");
    const ok = await goBack(env, account.id, game, id);
    return done(redirect(`/account/saves/${game.slug}?${ok ? "restored" : "failed"}`));
  }
  if (restore) return done(redirect(`/account/saves/${game.slug}`));
  return done(page(env, `${game.title} saves`, await gamePage(env, account.id, game, new URL(request.url).searchParams)));
}

/** Make an earlier version the current save, keeping a copy of the progress it replaces. */
async function goBack(env: Env, accountId: string, game: Game, id: string): Promise<boolean> {
  const copies = await saveHistory(env.DB, accountId, game.id);
  const copy = copies.find((c) => c.id === id);
  const text = copy ? await (await env.SAVES.get(saveCopyKey(accountId, game.id, copy.id)))?.text() : null;
  if (!copy || !text) return false;
  const row = await saveRow(env.DB, accountId, game.id);
  if (row?.hash === copy.hash) return true;
  if (row) await keepCopy(env, { account_id: accountId, game_id: game.id, at: row.updated_at, reason: "restore", hash: row.hash, bytes: row.bytes }, () => readSave(env, accountId, game.id));
  const version = await bumpSave(env.DB, { accountId, gameId: game.id, base: row?.version ?? 0, hash: copy.hash, bytes: copy.bytes });
  if (version === null) return false;
  await env.SAVES.put(saveKey(accountId, game.id), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version: String(version) } });
  return true;
}

async function listPage(env: Env, accountId: string): Promise<Raw> {
  const games = await savedGames(env.DB, accountId);
  return html`<h1>Your saves</h1>
<p class="lead">Games that save to your account keep your progress on every device. If progress goes missing, open the game here and go back to an earlier version.</p>
${games.length
    ? html`<ul class="keys">${games.map(
        (g) => html`<li><span><a href="/account/saves/${g.slug}">${g.title}</a> <span class="muted small">saved ${ago(g.updated_at)}${g.copies ? `, ${g.copies} earlier ${g.copies === 1 ? "version" : "versions"}` : ""}</span></span>
<a class="btn ghost" href="/account/saves/${g.slug}">Earlier versions</a></li>`,
      )}</ul>`
    : html`<p class="note">No saves yet. Play a game while you're signed in and your progress shows up here.</p>`}
<p><a href="/account">Back to your account</a></p>`;
}

async function gamePage(env: Env, accountId: string, game: Game, query: URLSearchParams): Promise<Raw> {
  const [row, copies] = await Promise.all([saveRow(env.DB, accountId, game.id), saveHistory(env.DB, accountId, game.id)]);
  return html`<h1>${game.title} saves</h1>
${query.has("restored")
    ? html`<div class="note" role="status"><p><strong>Done.</strong> ${game.title} starts from that progress the next time you play. The progress it replaced is in the list below, in case you change your mind.</p><a class="btn" href="/g/${game.slug}">Play ${game.title}</a></div>`
    : query.has("failed")
      ? html`<p class="error" role="alert">Couldn't go back to that version. It may have just been replaced, or you saved from another device at the same moment. Try again.</p>`
      : ""}
<p class="lead">${row ? `Your progress was saved ${ago(row.updated_at)}.` : "No progress saved to your account yet."}</p>
<h2>Earlier versions</h2>
${copies.length
    ? html`<p>Going back replaces your current progress on every device. Close the game first if it's open.</p>
<ul class="keys">${copies.map(
        (c) => html`<li><span>Saved ${ago(c.at)}${REASONS[c.reason] ? html`<span class="why muted small">${REASONS[c.reason]}</span>` : ""}</span>
${row?.hash === c.hash
          ? html`<span class="muted small">Your progress now</span>`
          : html`<form method="post" action="/account/saves/${game.slug}/restore"><input type="hidden" name="id" value="${c.id}"><button class="btn ghost" type="submit">Go back to this</button></form>`}</li>`,
      )}</ul>`
    : html`<p class="note">None yet. While you play, Zaisma keeps a copy about once an hour, and one whenever your progress is about to be replaced. Up to five are kept.</p>`}
<p><a href="/account/saves">All your saves</a></p>`;
}

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : `on ${new Date(ms).toISOString().slice(0, 10)}`;
}

function page(env: Env, title: string, body: Raw, status = 200): Response {
  const res = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>`, private: true });
  return new Response(res.body, { status, headers: res.headers });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}
