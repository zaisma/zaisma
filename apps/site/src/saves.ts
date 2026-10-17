import {
  SAVE_LIMIT_BYTES,
  accountById,
  addSaveCopy,
  bumpSave,
  canonicalSave,
  copyReason,
  gameBySlug,
  iso,
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
  type SaveRow,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { html, layout, type Raw } from "./html.ts";

/**
 * Cloud saves: GET and PUT /api/saves/<game>, called by the game page on zaisma.com
 * with the player's session cookie. The game itself never talks to this; it only
 * hands its browser save to the game page (see packages/sdk/saves.js).
 *
 *   GET  answers { tag, version_number, sha256, updated_at, changed_by_kind, save_data }, or { tag, version_number: 0 } with no save yet
 *   GET  ?version answers only { version_number, changed_by_kind }, from the database alone, for an open game to check cheaply
 *   PUT  { base_version_number, save_json, replace? } answers { version_number, sha256, updated_at },
 *        or 409 { error, version_number, updated_at, changed_by_kind } when another device (or the developer) saved first
 *   PUT  { keep: true, save_json } keeps this device's progress as an earlier version: { is_kept: true }
 *
 * changed_by_kind "developer" means the game's developer changed the save through the API (saves-api.ts):
 * the game page then takes it without asking the player, keeping this device's progress as an earlier version.
 */
export async function handleSaves(request: Request, env: Env, slug: string): Promise<Response> {
  const json = (body: unknown, httpStatus = 200) => Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
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
  if (!game || game.review_status !== "live" || !game.cloud_saves_enabled) return json({ error: "This game doesn't save to accounts." }, 404);
  const withCookies = (response: Response) => {
    for (const cookie of session.cookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };

  // A per-account, per-game tag the game page uses to remember which save this device last had.
  const tag = (await saveHash(`${account.id}:${game.id}`)).slice(0, 16);

  if (request.method === "GET") {
    const row = await saveRow(env.DB, account.id, game.id);
    if (new URL(request.url).searchParams.has("version")) return withCookies(json({ version_number: row?.version_number ?? 0, changed_by_kind: row?.changed_by_kind ?? null }));
    const object = row ? await env.SAVES.get(saveKey(account.id, game.id)) : null;
    if (!row || !object) return withCookies(json({ tag, version_number: row?.version_number ?? 0 }));
    return withCookies(
      json({ tag, version_number: row.version_number, sha256: row.sha256, updated_at: iso(row.updated_at_ms), changed_by_kind: row.changed_by_kind, save_data: JSON.parse(await object.text()) }),
    );
  }

  if (env.SAVE_LIMIT && !(await env.SAVE_LIMIT.limit({ key: account.id })).success) return json({ error: "Saving too often." }, 429);
  const contentLengthBytes = Number(request.headers.get("content-length") ?? 0);
  if (contentLengthBytes > SAVE_LIMIT_BYTES * 2 + 1024) return json({ error: "This save is too big." }, 413);
  let body: { base_version_number?: unknown; save_json?: unknown; replace?: unknown; keep?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Bad save." }, 400);
  }
  const saveData = typeof body.save_json === "string" ? parseSave(body.save_json) : null;
  if (!saveData) return json({ error: "Bad save." }, 400);
  const text = canonicalSave(saveData);
  const sizeBytes = new TextEncoder().encode(text).length;
  if (sizeBytes > SAVE_LIMIT_BYTES) return json({ error: "This save is too big." }, 413);
  const sha256 = await saveHash(text);

  // The player picked the account's progress over this device's: keep this device's as an earlier version.
  if (body.keep === true) {
    await keepCopy(env, { account_id: account.id, game_id: game.id, saved_at_ms: Date.now(), copy_reason: "device", sha256, size_bytes: sizeBytes }, async () => text);
    return withCookies(json({ is_kept: true }));
  }

  const baseVersionNumber = Number(body.base_version_number);
  if (!Number.isInteger(baseVersionNumber) || baseVersionNumber < 0) return json({ error: "Bad save." }, 400);
  const current = baseVersionNumber ? await saveRow(env.DB, account.id, game.id) : null;
  const versionNumber = await bumpSave(env.DB, { accountId: account.id, gameId: game.id, baseVersionNumber, sha256, sizeBytes, changedByKind: "player" });
  if (versionNumber === null) {
    // Another device saved since this one loaded: the player chooses which to keep. A developer's change wins without asking.
    const row = await saveRow(env.DB, account.id, game.id);
    return withCookies(json({ error: "Played on another device.", version_number: row?.version_number ?? 0, updated_at: iso(row?.updated_at_ms), changed_by_kind: row?.changed_by_kind ?? null }, 409));
  }
  // Before replacing the save, keep a copy now and then, and whenever progress looks about to be lost.
  if (current && current.version_number === baseVersionNumber && current.sha256 !== sha256) {
    const copy = { account_id: account.id, game_id: game.id, saved_at_ms: current.updated_at_ms, sha256: current.sha256, size_bytes: current.size_bytes };
    await keepCopy(env, copy, () => readSave(env, account.id, game.id), (newestCopyAtMs) => copyReason(current, { sizeBytes, isReplacing: body.replace === true }, newestCopyAtMs));
  }
  await env.SAVES.put(saveKey(account.id, game.id), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version_number: String(versionNumber) } });
  return withCookies(json({ version_number: versionNumber, sha256, updated_at: iso(Date.now()) }));
}

export const readSave = async (env: Env, accountId: string, gameId: string) => (await env.SAVES.get(saveKey(accountId, gameId)))?.text() ?? null;

/**
 * Keep a copy of some progress in the game's history, unless it already has this exact progress.
 * `copy_reason` is fixed, or worked out from when the newest copy was made (null: no copy needed).
 * Answers the ID of the copy that holds this progress (the new one, or the one it already had), or null when none was kept.
 */
async function keepCopy(
  env: Env,
  copy: Omit<SaveCopy, "id" | "copy_reason"> & { copy_reason?: SaveCopyReason },
  text: () => Promise<string | null>,
  why?: (newestCopyAtMs: number | null) => SaveCopyReason | null,
): Promise<string | null> {
  const copies = await saveHistory(env.DB, copy.account_id, copy.game_id);
  const existing = copies.find((savedCopy) => savedCopy.sha256 === copy.sha256);
  if (existing) return existing.id;
  const copyReason = copy.copy_reason ?? why?.(copies[0]?.saved_at_ms ?? null) ?? null;
  const copyText = copyReason ? await text() : null;
  if (!copyReason || copyText === null) return null;
  const full: SaveCopy = { ...copy, id: newId("save_copy"), copy_reason: copyReason };
  await env.SAVES.put(saveCopyKey(full.account_id, full.game_id, full.id), copyText, { httpMetadata: { contentType: "application/json" } });
  const dropped = await addSaveCopy(env.DB, full, copies);
  if (dropped.length) await env.SAVES.delete(dropped.map((droppedCopy) => saveCopyKey(droppedCopy.account_id, droppedCopy.game_id, droppedCopy.id)));
  return full.id;
}

/**
 * The game's developer makes `text` (a canonical save) the player's save: a change, a reset or a restore
 * through the API. A copy of the save it replaces is kept first, unless that save was the developer's own
 * last change, so a script changing a save again and again can't push the player's own copies out.
 * Open games take it on their next check (saves-client.ts). Tries again when the player's game saves at
 * the same moment; null when it kept losing that race.
 */
export async function changeSaveAsDeveloper(env: Env, accountId: string, gameId: string, text: string): Promise<{ row: SaveRow; keptSaveCopyId: string | null } | null> {
  const sha256 = await saveHash(text);
  const sizeBytes = new TextEncoder().encode(text).length;
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
    const row = await saveRow(env.DB, accountId, gameId);
    if (row?.sha256 === sha256) return { row, keptSaveCopyId: null };
    const keptSaveCopyId =
      row && row.changed_by_kind !== "developer"
        ? await keepCopy(env, { account_id: accountId, game_id: gameId, saved_at_ms: row.updated_at_ms, copy_reason: "developer", sha256: row.sha256, size_bytes: row.size_bytes }, () => readSave(env, accountId, gameId))
        : null;
    const versionNumber = await bumpSave(env.DB, { accountId, gameId, baseVersionNumber: row?.version_number ?? 0, sha256, sizeBytes, changedByKind: "developer" });
    if (versionNumber === null) continue;
    await env.SAVES.put(saveKey(accountId, gameId), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version_number: String(versionNumber) } });
    return { row: (await saveRow(env.DB, accountId, gameId))!, keptSaveCopyId };
  }
  return null;
}

/** Delete every save file for an account (with the account). */
export async function deleteSaveFiles(env: Env, accountId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.SAVES.list({ prefix: `${accountId}/`, cursor });
    if (list.objects.length) await env.SAVES.delete(list.objects.map((object) => object.key));
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
  developer: "Before the game's developer changed it",
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
  const done = (response: Response) => {
    for (const cookie of session.cookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };

  if (!slug) return done(page(env, "Your saves", await listPage(env, account.id)));
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.review_status !== "live" || !game.cloud_saves_enabled) return done(page(env, "Your saves", html`<h1>No saves here</h1><p class="lead">This game doesn't save to accounts.</p><a class="btn ghost" href="/account/saves">Your saves</a>`, 404));

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
  const copy = copies.find((savedCopy) => savedCopy.id === id);
  const text = copy ? await (await env.SAVES.get(saveCopyKey(accountId, game.id, copy.id)))?.text() : null;
  if (!copy || !text) return false;
  const row = await saveRow(env.DB, accountId, game.id);
  if (row?.sha256 === copy.sha256) return true;
  if (row) await keepCopy(env, { account_id: accountId, game_id: game.id, saved_at_ms: row.updated_at_ms, copy_reason: "restore", sha256: row.sha256, size_bytes: row.size_bytes }, () => readSave(env, accountId, game.id));
  const versionNumber = await bumpSave(env.DB, { accountId, gameId: game.id, baseVersionNumber: row?.version_number ?? 0, sha256: copy.sha256, sizeBytes: copy.size_bytes, changedByKind: "player" });
  if (versionNumber === null) return false;
  await env.SAVES.put(saveKey(accountId, game.id), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version_number: String(versionNumber) } });
  return true;
}

async function listPage(env: Env, accountId: string): Promise<Raw> {
  const games = await savedGames(env.DB, accountId);
  return html`<h1>Your saves</h1>
<p class="lead">Games that save to your account keep your progress on every device. If progress goes missing, open the game here and go back to an earlier version.</p>
${games.length
    ? html`<ul class="keys">${games.map(
        (game) => html`<li><span><a href="/account/saves/${game.slug}">${game.title}</a> <span class="muted small">saved ${ago(game.updated_at_ms)}${game.save_copy_count ? `, ${game.save_copy_count} earlier ${game.save_copy_count === 1 ? "version" : "versions"}` : ""}</span></span>
<a class="btn ghost" href="/account/saves/${game.slug}">Earlier versions</a></li>`,
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
<p class="lead">${row ? `Your progress was saved ${ago(row.updated_at_ms)}.` : "No progress saved to your account yet."}</p>
<h2>Earlier versions</h2>
${copies.length
    ? html`<p>Going back replaces your current progress on every device. Close the game first if it's open.</p>
<ul class="keys">${copies.map(
        (savedCopy) => html`<li><span>Saved ${ago(savedCopy.saved_at_ms)}${REASONS[savedCopy.copy_reason] ? html`<span class="why muted small">${REASONS[savedCopy.copy_reason]}</span>` : ""}</span>
${row?.sha256 === savedCopy.sha256
          ? html`<span class="muted small">Your progress now</span>`
          : html`<form method="post" action="/account/saves/${game.slug}/restore"><input type="hidden" name="id" value="${savedCopy.id}"><button class="btn ghost" type="submit">Go back to this</button></form>`}</li>`,
      )}</ul>`
    : html`<p class="note">None yet. While you play, Zaisma keeps a copy about once an hour, and one whenever your progress is about to be replaced. Up to five are kept.</p>`}
<p><a href="/account/saves">All your saves</a></p>`;
}

function ago(savedAtMs: number): string {
  const elapsedMin = Math.round((Date.now() - savedAtMs) / 60000);
  if (elapsedMin < 1) return "just now";
  if (elapsedMin < 60) return `${elapsedMin} ${elapsedMin === 1 ? "minute" : "minutes"} ago`;
  const elapsedHours = Math.round(elapsedMin / 60);
  if (elapsedHours < 24) return `${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
  const elapsedDays = Math.round(elapsedHours / 24);
  return elapsedDays === 1 ? "yesterday" : elapsedDays < 60 ? `${elapsedDays} days ago` : `on ${new Date(savedAtMs).toISOString().slice(0, 10)}`;
}

function page(env: Env, title: string, body: Raw, httpStatus = 200): Response {
  const response = layout(env, { title: `${title} · Zaisma`, body: html`<div class="narrow">${body}</div>`, isPrivate: true });
  return new Response(response.body, { status: httpStatus, headers: response.headers });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}
