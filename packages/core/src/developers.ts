import { newId, sha256Hex } from "./ids.ts";
import type { Game, Visibility } from "./types.ts";

/**
 * Developer accounts: API keys, game details, device labels and images.
 * The developer API, the MCP, the upload command and the dashboard all go through these.
 */

const now = () => Date.now();

// --- API keys ----------------------------------------------------------------

export interface ApiKey {
  id: string;
  account_id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export const MAX_API_KEYS = 10;
const KEY = /^zsk_([a-z0-9]{20})_([A-Za-z0-9_-]{43})$/;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Make a key. The full key is returned once; we keep only a hash of its secret part. */
export async function createApiKey(db: D1Database, accountId: string, name: string): Promise<{ key: ApiKey; token: string }> {
  const id = newId();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const key: ApiKey = { id, account_id: accountId, name, created_at: now(), last_used_at: null };
  await db
    .prepare("INSERT INTO api_keys (id, account_id, name, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, accountId, name, await sha256Hex(new TextEncoder().encode(secret)), key.created_at)
    .run();
  return { key, token: `zsk_${id}_${secret}` };
}

export async function apiKeysFor(db: D1Database, accountId: string): Promise<ApiKey[]> {
  const { results } = await db
    .prepare("SELECT id, account_id, name, created_at, last_used_at FROM api_keys WHERE account_id = ? ORDER BY created_at")
    .bind(accountId)
    .all<ApiKey>();
  return results;
}

export async function revokeApiKey(db: D1Database, accountId: string, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM api_keys WHERE id = ? AND account_id = ?").bind(id, accountId).run();
  return res.meta.changes > 0;
}

/** The account a key belongs to, or null. Marks the key used (at most once an hour, to save writes). */
export async function accountForApiKey(db: D1Database, token: string): Promise<string | null> {
  const m = token.match(KEY);
  if (!m) return null;
  const row = await db.prepare("SELECT account_id, secret_hash, last_used_at FROM api_keys WHERE id = ?").bind(m[1]).first<{ account_id: string; secret_hash: string; last_used_at: number | null }>();
  if (!row) return null;
  const hash = await sha256Hex(new TextEncoder().encode(m[2]!));
  let diff = hash.length ^ row.secret_hash.length;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ row.secret_hash.charCodeAt(i % row.secret_hash.length);
  if (diff !== 0) return null;
  if (!row.last_used_at || now() - row.last_used_at > 3600_000) {
    await db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), m[1]).run();
  }
  return row.account_id;
}

// --- Game details --------------------------------------------------------------

export const VISIBILITIES: Visibility[] = ["draft", "listed", "unlisted", "private"];
export const DEVICES = ["phone", "tablet", "computer"] as const;
export const CONTROLS = ["touch", "keyboard-mouse", "gamepad"] as const;
export const SCREENS = ["portrait", "landscape", "either"] as const;
export const MAX_GAMES_PER_OWNER = 50;

export interface DetailsChange {
  title?: string;
  description?: string;
  visibility?: Visibility;
  devices?: string[];
  controls?: string[];
  screen?: string;
}

/** Check a change from the API. Returns the tidied change or a plain error. */
export function checkDetails(input: Record<string, unknown>): { change: DetailsChange } | { error: string } {
  const change: DetailsChange = {};
  if ("title" in input) {
    const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 80) return { error: "The title needs 1 to 80 characters." };
    change.title = title;
  }
  if ("description" in input) {
    if (typeof input.description !== "string" || input.description.trim().length > 500) return { error: "The description can be up to 500 characters." };
    change.description = input.description.trim();
  }
  if ("visibility" in input) {
    if (!VISIBILITIES.includes(input.visibility as Visibility)) return { error: `Visibility is one of: ${VISIBILITIES.join(", ")}.` };
    change.visibility = input.visibility as Visibility;
  }
  const list = (field: "devices" | "controls", allowed: readonly string[]): string | null => {
    if (!(field in input)) return null;
    const value = input[field];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && allowed.includes(v))) return `${field} is a list of: ${allowed.join(", ")}.`;
    change[field] = allowed.filter((a) => value.includes(a));
    return null;
  };
  const listError = list("devices", DEVICES) ?? list("controls", CONTROLS);
  if (listError) return { error: listError };
  if ("screen" in input) {
    if (input.screen !== "" && !SCREENS.includes(input.screen as (typeof SCREENS)[number])) return { error: `screen is one of: ${SCREENS.join(", ")} (or "" for not set).` };
    change.screen = input.screen as string;
  }
  return { change };
}

/** Players can already see this game, so new words on it wait for review. */
export function shownToPlayers(game: Game): boolean {
  return Boolean(game.current_version_id) && game.visibility !== "draft" && game.status !== "pending";
}

/**
 * Apply a change. A new title or description on a game players can see is kept as a draft for review;
 * everything else applies straight away. Returns whether words are waiting for review.
 */
export async function applyDetails(db: D1Database, game: Game, change: DetailsChange): Promise<{ waiting: boolean }> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };
  const words: { title?: string; description?: string } = {};
  if (change.title !== undefined && change.title !== game.title) words.title = change.title;
  if (change.description !== undefined && change.description !== game.description) words.description = change.description;
  let waiting = false;
  if (Object.keys(words).length) {
    if (shownToPlayers(game)) {
      const draft = { ...(game.details_draft ? (JSON.parse(game.details_draft) as object) : {}), ...words };
      set("details_draft", JSON.stringify(draft));
      waiting = true;
    } else {
      if (words.title !== undefined) set("title", words.title);
      if (words.description !== undefined) set("description", words.description);
    }
  }
  if (change.visibility) set("visibility", change.visibility);
  if (change.devices) set("devices", change.devices.join(","));
  if (change.controls) set("controls", change.controls.join(","));
  if (change.screen !== undefined) set("screen", change.screen);
  if (sets.length) {
    set("updated_at", now());
    await db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, game.id).run();
  }
  return { waiting };
}

/** Admin: accept or drop the words waiting for review. */
export async function settleDetailsDraft(db: D1Database, game: Game, accept: boolean): Promise<void> {
  const draft = game.details_draft ? (JSON.parse(game.details_draft) as { title?: string; description?: string }) : {};
  await db
    .prepare("UPDATE games SET title = ?, description = ?, details_draft = NULL, updated_at = ? WHERE id = ?")
    .bind(accept ? (draft.title ?? game.title) : game.title, accept ? (draft.description ?? game.description) : game.description, now(), game.id)
    .run();
}

export async function gamesWithDetailsDrafts(db: D1Database): Promise<Game[]> {
  const { results } = await db.prepare("SELECT * FROM games WHERE details_draft IS NOT NULL ORDER BY updated_at").all<Game>();
  return results;
}

// --- Covers and screenshots ------------------------------------------------------

export type ImageKind = "cover" | "screenshot";
export type ImageStatus = "pending" | "approved" | "rejected";

export interface GameImage {
  id: string;
  game_id: string;
  kind: ImageKind;
  content_type: string;
  width: number;
  height: number;
  bytes: number;
  status: ImageStatus;
  created_at: number;
}

export const IMAGE_LIMITS = { bytes: 5 * 1024 * 1024, minSide: 320, maxSide: 8192, screenshots: 8 };

/** Where an image's file lives in the games bucket. */
export const imageKey = (img: Pick<GameImage, "game_id" | "id">) => `images/${img.game_id}/${img.id}`;

/**
 * What an image really is, read from its bytes (never the name or the type it claims):
 * PNG, JPEG or WebP with its size, or null. SVG and everything else is refused.
 */
export function sniffImage(b: Uint8Array): { type: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  const u24le = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length < 30) return null;

  if (b[0] === 0x89 && ascii(1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(12, 4) === "IHDR") {
    return { type: "image/png", width: u32be(16), height: u32be(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Start-of-frame markers carry the size; C4, C8 and CC are other tables.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "image/jpeg", width: u16be(i + 7), height: u16be(i + 5) };
      }
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { type: "image/webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    }
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { type: "image/webp", width: u24le(24) + 1, height: u24le(27) + 1 };
  }
  return null;
}

export async function addImage(db: D1Database, img: Omit<GameImage, "status" | "created_at">): Promise<GameImage> {
  const row: GameImage = { ...img, status: "pending", created_at: now() };
  await db
    .prepare("INSERT INTO game_images (id, game_id, kind, content_type, width, height, bytes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.game_id, row.kind, row.content_type, row.width, row.height, row.bytes, row.status, row.created_at)
    .run();
  return row;
}

export async function imageById(db: D1Database, id: string): Promise<GameImage | null> {
  return db.prepare("SELECT * FROM game_images WHERE id = ?").bind(id).first<GameImage>();
}

export async function imagesForGame(db: D1Database, gameId: string): Promise<GameImage[]> {
  const { results } = await db.prepare("SELECT * FROM game_images WHERE game_id = ? ORDER BY kind, created_at").bind(gameId).all<GameImage>();
  return results;
}

export async function pendingImages(db: D1Database): Promise<(GameImage & { slug: string; title: string })[]> {
  const { results } = await db
    .prepare("SELECT game_images.*, games.slug, games.title FROM game_images JOIN games ON games.id = game_images.game_id WHERE game_images.status = 'pending' ORDER BY game_images.created_at LIMIT 100")
    .all<GameImage & { slug: string; title: string }>();
  return results;
}

/**
 * Approve or reject an image. An approved cover replaces the game's old one; the old files
 * to delete from storage are returned. Rejected files are kept, in case they need reporting.
 */
export async function settleImage(db: D1Database, img: GameImage, approve: boolean): Promise<GameImage[]> {
  if (!approve) {
    await db.prepare("UPDATE game_images SET status = 'rejected' WHERE id = ?").bind(img.id).run();
    return [];
  }
  const { results: replaced } =
    img.kind === "cover"
      ? await db.prepare("SELECT * FROM game_images WHERE game_id = ? AND kind = 'cover' AND status = 'approved' AND id != ?").bind(img.game_id, img.id).all<GameImage>()
      : { results: [] as GameImage[] };
  await db.batch([
    db.prepare("UPDATE game_images SET status = 'approved' WHERE id = ?").bind(img.id),
    ...replaced.map((r) => db.prepare("DELETE FROM game_images WHERE id = ?").bind(r.id)),
  ]);
  return replaced;
}

export async function deleteImageRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM game_images WHERE id = ?").bind(id).run();
}
