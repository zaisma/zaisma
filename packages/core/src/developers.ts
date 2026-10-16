import { newRandomPart, sha256Hex } from "./ids.ts";
import type { ReviewReason } from "./review.ts";
import { ACCOUNT_REQUIREMENTS, MULTIPLAYER_MODES, ROOM_BROWSING, type AccountRequirement, type Game, type RoomBrowsing, type Visibility } from "./types.ts";

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
  created_at_ms: number;
  last_used_at_ms: number | null;
}

export const MAXIMUM_API_KEY_COUNT = 10;
const KEY = /^zsk_([a-z0-9]{20})_([A-Za-z0-9_-]{43})$/;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Make a key. The full key is returned once; we keep only a hash of its secret part. */
export async function createApiKey(database: D1Database, accountId: string, name: string): Promise<{ key: ApiKey; token: string }> {
  const id = newRandomPart();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const key: ApiKey = { id, account_id: accountId, name, created_at_ms: now(), last_used_at_ms: null };
  await database
    .prepare("INSERT INTO api_keys (id, account_id, name, secret_hash, created_at_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(id, accountId, name, await sha256Hex(new TextEncoder().encode(secret)), key.created_at_ms)
    .run();
  return { key, token: `zsk_${id}_${secret}` };
}

export async function apiKeysFor(database: D1Database, accountId: string): Promise<ApiKey[]> {
  const { results } = await database
    .prepare("SELECT id, account_id, name, created_at_ms, last_used_at_ms FROM api_keys WHERE account_id = ? ORDER BY created_at_ms")
    .bind(accountId)
    .all<ApiKey>();
  return results;
}

export async function revokeApiKey(database: D1Database, accountId: string, id: string): Promise<boolean> {
  const deletion = await database.prepare("DELETE FROM api_keys WHERE id = ? AND account_id = ?").bind(id, accountId).run();
  return deletion.meta.changes > 0;
}

/** The account a key belongs to, or null. Marks the key used (at most once an hour, to save writes). */
export async function accountForApiKey(database: D1Database, token: string): Promise<string | null> {
  const keyMatch = token.match(KEY);
  if (!keyMatch) return null;
  const row = await database.prepare("SELECT account_id, secret_hash, last_used_at_ms FROM api_keys WHERE id = ?").bind(keyMatch[1]).first<{ account_id: string; secret_hash: string; last_used_at_ms: number | null }>();
  if (!row) return null;
  const hash = await sha256Hex(new TextEncoder().encode(keyMatch[2]!));
  let mismatchNumber = hash.length ^ row.secret_hash.length;
  for (let i = 0; i < hash.length; i++) mismatchNumber |= hash.charCodeAt(i) ^ row.secret_hash.charCodeAt(i % row.secret_hash.length);
  if (mismatchNumber !== 0) return null;
  if (!row.last_used_at_ms || now() - row.last_used_at_ms > 3600_000) {
    await database.prepare("UPDATE api_keys SET last_used_at_ms = ? WHERE id = ?").bind(now(), keyMatch[1]).run();
  }
  return row.account_id;
}

// --- Game details --------------------------------------------------------------

export const VISIBILITIES: Visibility[] = ["draft", "listed", "unlisted", "private"];
export const DEVICES = ["phone", "tablet", "computer"] as const;
export const CONTROLS = ["touch", "keyboard_mouse", "gamepad"] as const;
export const SCREENS = ["portrait", "landscape", "either"] as const;
export const MAXIMUM_GAME_COUNT_PER_OWNER = 50;
export const PLAY_STYLES = ["co-op", "versus", "both"] as const;
/** The most players we name; more than that shows as "<n>+". */
export const MAXIMUM_PLAYER_COUNT = 1000;

/** One way to play, stored in games.play_modes and shown by the API as it is (docs/NAMING.md). */
export interface PlayMode {
  mode: "single" | "local" | "online";
  /** null for single. */
  minimum_player_count: number | null;
  /** null: no upper limit, shown as "<minimum>+ players", and for single. */
  maximum_player_count: number | null;
  play_style: (typeof PLAY_STYLES)[number] | null;
}

/** A game's play modes from its column, or null when the developer hasn't said. */
export function readPlayModes(json: string): PlayMode[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as PlayMode[];
  } catch {
    return null;
  }
}

/** Plain words for each way to play, like "Local co-op" and "2–4 players". */
export function describePlayModes(playModes: PlayMode[]): { mode: PlayMode["mode"]; label: string; playerCount: string | null }[] {
  const styleWords = (style: PlayMode["play_style"]) => (style === "both" ? "co-op and versus" : style);
  const playerCount = (playMode: PlayMode) =>
    playMode.maximum_player_count === null
      ? `${playMode.minimum_player_count}+ players`
      : playMode.minimum_player_count === playMode.maximum_player_count
        ? `${playMode.minimum_player_count} players`
        : `${playMode.minimum_player_count}–${playMode.maximum_player_count} players`;
  return playModes.map((playMode) =>
    playMode.mode === "single"
      ? { mode: "single", label: "Single-player", playerCount: null }
      : { mode: playMode.mode, label: `${playMode.mode === "local" ? "Local" : "Online"} ${styleWords(playMode.play_style)}`, playerCount: playerCount(playMode) },
  );
}

const PLAY_MODES_EXAMPLE = '[{ "mode": "single" }, { "mode": "online", "minimum_player_count": 2, "maximum_player_count": 4, "play_style": "co-op" }]';
const MODE_ORDER = ["single", "local", "online"] as const;

/** Why an input was refused, before it becomes an error answer: the input at fault, what happened and what to do. */
export interface InputProblem {
  field: string;
  message: string;
  fix: string;
}

/** Check play modes from the API: each mode once, in a fixed order, with every key. Returns them, null to clear, or what's wrong. */
function checkPlayModes(given: unknown): PlayMode[] | null | InputProblem {
  if (given === null) return null;
  if (!Array.isArray(given) || given.length === 0) {
    return { field: "play_modes", message: "play_modes isn't a list with at least one play mode.", fix: `Send a list like ${PLAY_MODES_EXAMPLE}, or null to clear it.` };
  }
  const playModes: PlayMode[] = [];
  for (const [i, givenPlayMode] of given.entries()) {
    const playMode = givenPlayMode as Partial<PlayMode> | null;
    if (!playMode || typeof playMode !== "object" || !MODE_ORDER.includes(playMode.mode as PlayMode["mode"])) {
      return { field: `play_modes[${i}].mode`, message: `play_modes[${i}] has no mode, or one that isn't single, local or online.`, fix: `Make each entry an object with its mode, like { "mode": "single" }: ${PLAY_MODES_EXAMPLE}.` };
    }
    if (playModes.some((other) => other.mode === playMode.mode)) return { field: `play_modes[${i}].mode`, message: `play_modes has ${playMode.mode} twice.`, fix: "List each mode once." };
    if (playMode.mode === "single") {
      if ((playMode.minimum_player_count ?? null) !== null || (playMode.maximum_player_count ?? null) !== null || (playMode.play_style ?? null) !== null) {
        return { field: `play_modes[${i}]`, message: "The single mode takes no player counts or play_style.", fix: 'Send it as { "mode": "single" }.' };
      }
      playModes.push({ mode: "single", minimum_player_count: null, maximum_player_count: null, play_style: null });
      continue;
    }
    const minimumPlayerCount = playMode.minimum_player_count;
    const maximumPlayerCount = playMode.maximum_player_count ?? null;
    const example = `{ "mode": "${playMode.mode}", "minimum_player_count": 2, "maximum_player_count": 4, "play_style": "co-op" }`;
    if (!Number.isInteger(minimumPlayerCount) || minimumPlayerCount! < 2 || minimumPlayerCount! > MAXIMUM_PLAYER_COUNT) {
      return { field: `play_modes[${i}].minimum_player_count`, message: `The ${playMode.mode} mode's minimum_player_count is missing or isn't a whole number from 2 to ${MAXIMUM_PLAYER_COUNT}.`, fix: `Give the fewest players it takes, 2 or more, like ${example}.` };
    }
    if (maximumPlayerCount !== null && (!Number.isInteger(maximumPlayerCount) || maximumPlayerCount < minimumPlayerCount! || maximumPlayerCount > MAXIMUM_PLAYER_COUNT)) {
      return { field: `play_modes[${i}].maximum_player_count`, message: `The ${playMode.mode} mode's maximum_player_count is under its minimum_player_count or isn't a whole number up to ${MAXIMUM_PLAYER_COUNT}.`, fix: "Give the most players it takes, at least the minimum, or null for no limit." };
    }
    if (!PLAY_STYLES.includes(playMode.play_style as (typeof PLAY_STYLES)[number])) {
      return { field: `play_modes[${i}].play_style`, message: `The ${playMode.mode} mode's play_style is missing or isn't co-op, versus or both.`, fix: `Give play_style: co-op (together), versus (against each other) or both, like ${example}.` };
    }
    playModes.push({ mode: playMode.mode!, minimum_player_count: minimumPlayerCount!, maximum_player_count: maximumPlayerCount, play_style: playMode.play_style! });
  }
  return playModes.sort((first, second) => MODE_ORDER.indexOf(first.mode) - MODE_ORDER.indexOf(second.mode));
}

/** A change to a game's details, in the games table's own names, so it's stored as it is. */
export interface DetailsChange {
  title?: string;
  description?: string;
  visibility?: Visibility;
  devices?: string[];
  controls?: string[];
  /** null: not set. */
  screen_orientation?: (typeof SCREENS)[number] | null;
  /** null clears it. */
  play_modes?: PlayMode[] | null;
  /** Copy signed-in players' browser saves to their account. Off for games that keep their own saves. */
  cloud_saves_enabled?: boolean;
  room_browsing?: RoomBrowsing;
  /** none (guests welcome), multiplayer (guests play alone) or whole_game (accounts only). */
  account_requirement?: AccountRequirement;
  /** none, relay, or own (the game's zaisma-server.js in a sandbox on our rooms). */
  multiplayer_mode?: (typeof MULTIPLAYER_MODES)[number];
}

/** Check a change from the API (docs/NAMING.md). Returns the tidied change or a plain error. */
export function checkDetails(input: Record<string, unknown>): { change: DetailsChange } | { problem: InputProblem } {
  const change: DetailsChange = {};
  const refuse = (field: string, message: string, fix: string) => ({ problem: { field, message, fix } });
  if ("title" in input) {
    const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 80) return refuse("title", "title is empty or over 80 characters.", "Give a title of 1 to 80 characters.");
    change.title = title;
  }
  if ("description" in input) {
    if (typeof input.description !== "string" || input.description.trim().length > 500) return refuse("description", "description isn't text of up to 500 characters.", "Shorten it to 500 characters; it's shown on the game page.");
    change.description = input.description.trim();
  }
  if ("visibility" in input) {
    if (!VISIBILITIES.includes(input.visibility as Visibility)) {
      return refuse("visibility", `visibility ${JSON.stringify(input.visibility)} isn't one of the choices.`, "Give listed (on Zaisma for everyone), unlisted (only people with the link), or private or draft (only you and tester links).");
    }
    change.visibility = input.visibility as Visibility;
  }
  for (const [field, allowed] of [["devices", DEVICES], ["controls", CONTROLS]] as const) {
    if (!(field in input)) continue;
    const given = input[field];
    if (!Array.isArray(given) || !given.every((label) => typeof label === "string" && (allowed as readonly string[]).includes(label))) {
      return refuse(field, `${field} isn't a list of ${allowed.join(", ")}.`, `Send a list of any of: ${allowed.join(", ")}, like ["${allowed[0]}"].`);
    }
    change[field] = allowed.filter((label) => given.includes(label));
  }
  if ("screen_orientation" in input) {
    if (input.screen_orientation !== null && !SCREENS.includes(input.screen_orientation as (typeof SCREENS)[number])) {
      return refuse("screen_orientation", `screen_orientation ${JSON.stringify(input.screen_orientation)} isn't one of the choices.`, `Give one of ${SCREENS.join(", ")}, or null for not set.`);
    }
    change.screen_orientation = input.screen_orientation as (typeof SCREENS)[number] | null;
  }
  if ("play_modes" in input) {
    const playModes = checkPlayModes(input.play_modes);
    if (playModes && !Array.isArray(playModes)) return { problem: playModes };
    change.play_modes = playModes;
  }
  if ("cloud_saves_enabled" in input) {
    if (typeof input.cloud_saves_enabled !== "boolean") return refuse("cloud_saves_enabled", "cloud_saves_enabled isn't true or false.", "Send true (players' saves follow them to any device) or false (the game keeps its own saves).");
    change.cloud_saves_enabled = input.cloud_saves_enabled;
  }
  if ("room_browsing" in input) {
    if (!ROOM_BROWSING.includes(input.room_browsing as RoomBrowsing)) {
      return refuse("room_browsing", `room_browsing ${JSON.stringify(input.room_browsing)} isn't one of the choices.`, "Give page (open rooms listed on the game page and to the game), game (only to the game) or off.");
    }
    change.room_browsing = input.room_browsing as RoomBrowsing;
  }
  if ("account_requirement" in input) {
    if (!ACCOUNT_REQUIREMENTS.includes(input.account_requirement as AccountRequirement)) {
      return refuse("account_requirement", `account_requirement ${JSON.stringify(input.account_requirement)} isn't one of the choices.`, "Give none (guests play everything), multiplayer (guests play alone; only signed-in players get player passes) or whole_game (players sign in before Play).");
    }
    change.account_requirement = input.account_requirement as AccountRequirement;
  }
  if ("multiplayer_mode" in input) {
    if (!MULTIPLAYER_MODES.includes(input.multiplayer_mode as (typeof MULTIPLAYER_MODES)[number])) {
      return refuse("multiplayer_mode", `multiplayer_mode ${JSON.stringify(input.multiplayer_mode)} isn't one of the choices.`, "Give none (no Zaisma rooms), relay (Zaisma passes messages, no server code) or own (your game server from zaisma-server/).");
    }
    change.multiplayer_mode = input.multiplayer_mode as (typeof MULTIPLAYER_MODES)[number];
  }
  return { change };
}

/** Players can already see this game, so new words on it wait for review. */
export function shownToPlayers(game: Game): boolean {
  return Boolean(game.live_version_id) && game.visibility !== "draft" && game.review_status !== "pending";
}

/**
 * Apply a change. A new title or description on a game players can see waits for review in
 * details_waiting_for_review; everything else applies straight away. Returns whether words are waiting.
 */
export async function applyDetails(database: D1Database, game: Game, change: DetailsChange): Promise<{ isWaitingForReview: boolean }> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, columnValue: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(columnValue);
  };
  const words: { title?: string; description?: string } = {};
  if (change.title !== undefined && change.title !== game.title) words.title = change.title;
  if (change.description !== undefined && change.description !== game.description) words.description = change.description;
  let isWaitingForReview = false;
  if (Object.keys(words).length) {
    if (shownToPlayers(game)) {
      const waitingWords = { ...(game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as object) : {}), ...words };
      set("details_waiting_for_review", JSON.stringify(waitingWords));
      isWaitingForReview = true;
    } else {
      if (words.title !== undefined) set("title", words.title);
      if (words.description !== undefined) set("description", words.description);
    }
  }
  if (change.visibility) set("visibility", change.visibility);
  if (change.devices) set("devices", change.devices.join(","));
  if (change.controls) set("controls", change.controls.join(","));
  if (change.screen_orientation !== undefined) set("screen_orientation", change.screen_orientation ?? "");
  if (change.play_modes !== undefined) set("play_modes", change.play_modes ? JSON.stringify(change.play_modes) : "");
  if (change.cloud_saves_enabled !== undefined) set("cloud_saves_enabled", change.cloud_saves_enabled ? 1 : 0);
  if (change.room_browsing !== undefined) set("room_browsing", change.room_browsing);
  if (change.account_requirement !== undefined) set("account_requirement", change.account_requirement);
  // Rooms running the old setting end within a minute, when they next check the game.
  if (change.multiplayer_mode !== undefined) set("multiplayer_mode", change.multiplayer_mode);
  if (assignments.length) {
    set("updated_at_ms", now());
    await database.prepare(`UPDATE games SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, game.id).run();
  }
  // Rooms update their own rows when they next check in; turning listing off takes them off lists at once.
  if (change.room_browsing === "off") await database.prepare("UPDATE live_rooms SET is_listed = 0 WHERE game_id = ?").bind(game.id).run();
  return { isWaitingForReview };
}

/** Admin: accept or drop the words waiting for review. */
export async function settleDetailsWaitingForReview(database: D1Database, game: Game, accept: boolean): Promise<void> {
  const waitingWords = game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as { title?: string; description?: string }) : {};
  await database
    .prepare("UPDATE games SET title = ?, description = ?, details_waiting_for_review = NULL, updated_at_ms = ? WHERE id = ?")
    .bind(accept ? (waitingWords.title ?? game.title) : game.title, accept ? (waitingWords.description ?? game.description) : game.description, now(), game.id)
    .run();
}

export async function gamesWithDetailsWaitingForReview(database: D1Database): Promise<Game[]> {
  const { results } = await database.prepare("SELECT * FROM games WHERE details_waiting_for_review IS NOT NULL ORDER BY updated_at_ms").all<Game>();
  return results;
}

// --- Covers and screenshots ------------------------------------------------------

/** cover: landscape, the game's card and picture. square: an optional second cover for phones. */
export type ImageKind = "cover" | "square" | "screenshot";
export type ImageReviewStatus = "pending" | "approved" | "rejected";

/** A row of the game_images table: the same names the developer API shows. */
export interface GameImage {
  id: string;
  game_id: string;
  kind: ImageKind;
  content_type: string;
  width_px: number;
  height_px: number;
  size_bytes: number;
  review_status: ImageReviewStatus;
  /** Why a person didn't approve it, as JSON (a ReviewReason); NULL otherwise. */
  review_reason: string | null;
  created_at_ms: number;
}

export const IMAGE_LIMITS = { maximumSizeBytes: 5 * 1024 * 1024, minimumSidePx: 320, maximumSidePx: 8192, maximumScreenshotCount: 8, minimumSquareSidePx: 512 };

/** A square cover is as wide as it is tall, give or take 1%. */
export const isSquare = (widthPx: number, heightPx: number) => Math.abs(widthPx - heightPx) <= Math.max(widthPx, heightPx) * 0.01;

/** Where an image's file lives in the games bucket. */
export const imageKey = (image: Pick<GameImage, "game_id" | "id">) => `images/${image.game_id}/${image.id}`;
/** Where a cover or screenshot that matched known abuse material is kept for reporting. Never served or listed. */
export const heldImageKey = (gameId: string, id: string) => `held-images/${gameId}/${id}`;

/**
 * What an image really is, read from its bytes (never the name or the type it claims):
 * PNG, JPEG or WebP with its size, or null. SVG and everything else is refused.
 */
export function sniffImage(bytes: Uint8Array): { type: "image/png" | "image/jpeg" | "image/webp"; widthPx: number; heightPx: number } | null {
  const uint16BigEndian = (byteIndex: number) => (bytes[byteIndex]! << 8) | bytes[byteIndex + 1]!;
  const uint32BigEndian = (byteIndex: number) => ((bytes[byteIndex]! << 24) >>> 0) + (bytes[byteIndex + 1]! << 16) + (bytes[byteIndex + 2]! << 8) + bytes[byteIndex + 3]!;
  const uint24LittleEndian = (byteIndex: number) => bytes[byteIndex]! | (bytes[byteIndex + 1]! << 8) | (bytes[byteIndex + 2]! << 16);
  const ascii = (byteIndex: number, characterCount: number) => String.fromCharCode(...bytes.subarray(byteIndex, byteIndex + characterCount));
  if (bytes.length < 30) return null;

  if (bytes[0] === 0x89 && ascii(1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a && ascii(12, 4) === "IHDR") {
    return { type: "image/png", widthPx: uint32BigEndian(16), heightPx: uint32BigEndian(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let byteIndex = 2;
    while (byteIndex + 9 < bytes.length) {
      if (bytes[byteIndex] !== 0xff) return null;
      const markerCode = bytes[byteIndex + 1]!;
      if (markerCode === 0xff) {
        byteIndex++;
        continue;
      }
      // Start-of-frame markers carry the size; C4, C8 and CC are other tables.
      if (markerCode >= 0xc0 && markerCode <= 0xcf && markerCode !== 0xc4 && markerCode !== 0xc8 && markerCode !== 0xcc) {
        return { type: "image/jpeg", widthPx: uint16BigEndian(byteIndex + 7), heightPx: uint16BigEndian(byteIndex + 5) };
      }
      byteIndex += 2 + uint16BigEndian(byteIndex + 2);
    }
    return null;
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { type: "image/webp", widthPx: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, heightPx: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const packedSizeNumber = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { type: "image/webp", widthPx: (packedSizeNumber & 0x3fff) + 1, heightPx: ((packedSizeNumber >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { type: "image/webp", widthPx: uint24LittleEndian(24) + 1, heightPx: uint24LittleEndian(27) + 1 };
  }
  return null;
}

export async function addImage(database: D1Database, image: Omit<GameImage, "review_status" | "review_reason" | "created_at_ms">): Promise<GameImage> {
  const row: GameImage = { ...image, review_status: "pending", review_reason: null, created_at_ms: now() };
  await database
    .prepare("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.game_id, row.kind, row.content_type, row.width_px, row.height_px, row.size_bytes, row.review_status, row.created_at_ms)
    .run();
  return row;
}

export async function imageById(database: D1Database, id: string): Promise<GameImage | null> {
  return database.prepare("SELECT * FROM game_images WHERE id = ?").bind(id).first<GameImage>();
}

export async function imagesForGame(database: D1Database, gameId: string): Promise<GameImage[]> {
  const { results } = await database.prepare("SELECT * FROM game_images WHERE game_id = ? ORDER BY kind, created_at_ms").bind(gameId).all<GameImage>();
  return results;
}

export async function pendingImages(database: D1Database): Promise<(GameImage & { slug: string; title: string })[]> {
  const { results } = await database
    .prepare("SELECT game_images.*, games.slug, games.title FROM game_images JOIN games ON games.id = game_images.game_id WHERE game_images.review_status = 'pending' ORDER BY game_images.created_at_ms LIMIT 100")
    .all<GameImage & { slug: string; title: string }>();
  return results;
}

/**
 * Approve an image (rejectedReason null) or reject it, saying why. An approved cover (landscape or square) replaces the game's
 * old one of that kind; the old files to delete from storage are returned. Rejected files are kept, in case they need reporting.
 */
export async function settleImage(database: D1Database, image: GameImage, rejectedReason: ReviewReason | null): Promise<GameImage[]> {
  if (rejectedReason) {
    await database.prepare("UPDATE game_images SET review_status = 'rejected', review_reason = ? WHERE id = ?").bind(JSON.stringify(rejectedReason), image.id).run();
    return [];
  }
  const { results: replaced } =
    image.kind !== "screenshot"
      ? await database.prepare("SELECT * FROM game_images WHERE game_id = ? AND kind = ? AND review_status = 'approved' AND id != ?").bind(image.game_id, image.kind, image.id).all<GameImage>()
      : { results: [] as GameImage[] };
  await database.batch([
    database.prepare("UPDATE game_images SET review_status = 'approved' WHERE id = ?").bind(image.id),
    ...replaced.map((old) => database.prepare("DELETE FROM game_images WHERE id = ?").bind(old.id)),
  ]);
  return replaced;
}

export async function deleteImageRow(database: D1Database, id: string): Promise<void> {
  await database.prepare("DELETE FROM game_images WHERE id = ?").bind(id).run();
}
