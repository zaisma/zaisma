import { isIdOf, newId } from "./ids.ts";

export type AgeBand = "13-15" | "16-17" | "18+";

/**
 * Who an account can chat with (docs/DECISIONS.md, "Social modes decide who can talk to whom"):
 * nobody, friends only, or anyone in the same band group who is open and social too.
 */
export type SocialMode = "solo_focused" | "friends_focused" | "open_and_social";

export interface Account {
  /** The Supabase user ID. Stays inside Zaisma. */
  id: string;
  /** The player ID games see, the same in every game (player_…). */
  player_id: string;
  /** Public and unique ignoring case: the player's name everywhere on Zaisma, kept as they typed it. */
  username: string;
  age_band: AgeBand;
  social_mode: SocialMode;
  /** When the password was last set, or null while the account has none (made with an email code, Google or Discord). */
  password_changed_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface Owner {
  id: string;
  kind: "person" | "team";
  account_id: string | null;
  created_at_ms: number;
}

/**
 * Whole years between a birth date and today. The birth date is only used here,
 * in the request that asks for it; we keep the band, never the date.
 */
export function ageOn(birth: { yearNumber: number; monthNumber: number; dayNumber: number }, today: Date): number | null {
  const { yearNumber, monthNumber, dayNumber } = birth;
  if (![yearNumber, monthNumber, dayNumber].every(Number.isInteger) || monthNumber < 1 || monthNumber > 12 || dayNumber < 1) return null;
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (date.getUTCMonth() !== monthNumber - 1 || date > today || yearNumber < today.getUTCFullYear() - 120) return null;
  let ageYearCount = today.getUTCFullYear() - yearNumber;
  if (today.getUTCMonth() + 1 < monthNumber || (today.getUTCMonth() + 1 === monthNumber && today.getUTCDate() < dayNumber)) ageYearCount--;
  return ageYearCount;
}

/** 13–15, 16–17 or 18+, or null for under 13 (no account). */
export function ageBand(ageYearCount: number): AgeBand | null {
  return ageYearCount < 13 ? null : ageYearCount < 16 ? "13-15" : ageYearCount < 18 ? "16-17" : "18+";
}

export const AGE_BANDS: readonly AgeBand[] = ["13-15", "16-17", "18+"];
export const SOCIAL_MODES: readonly SocialMode[] = ["solo_focused", "friends_focused", "open_and_social"];

export const isAgeBand = (given: unknown): given is AgeBand => AGE_BANDS.includes(given as AgeBand);
export const isSocialMode = (given: unknown): given is SocialMode => SOCIAL_MODES.includes(given as SocialMode);

/** The social modes an age band can choose: 13–15 never open and social. */
export function socialModesFor(band: AgeBand): readonly SocialMode[] {
  return band === "13-15" ? ["solo_focused", "friends_focused"] : SOCIAL_MODES;
}

/** Where a new account starts: 13–15 with no chat, everyone else with friends only. */
export function defaultSocialMode(band: AgeBand): SocialMode {
  return band === "13-15" ? "solo_focused" : "friends_focused";
}

/**
 * Who an open-and-social account can meet: 16–17 only other 16–17s, 18+ only other 18+s. Null when
 * the account doesn't chat with strangers. Never leaves Zaisma as it is: passes carry an opaque
 * chat group made from it (chatGroupId), so games never learn an age.
 */
export function chatBandGroup(account: Pick<Account, "age_band" | "social_mode">): "16-17" | "18+" | null {
  if (account.social_mode !== "open_and_social") return null;
  return account.age_band === "16-17" ? "16-17" : account.age_band === "18+" ? "18+" : null;
}

export const USERNAME_RULES = "3 to 20 letters, numbers or underscores.";
const MINIMUM_USERNAME_CHARACTER_COUNT = 3;
const MAXIMUM_USERNAME_CHARACTER_COUNT = 20;

// Usernames everyone sees. Kept short and plain; reports catch what this misses.
const RESERVED = ["zaisma", "admin", "moderator", "official", "support", "staff"];
const BLOCKED = [
  // Substrings, so words like "grape" or "peacock" aren't caught by short ones.
  "fuck", "shit", "cunt", "bitch", "whore", "slut", "porn", "penis", "vagina", "pussy", "boob", "nazi", "hitler",
  "nigg", "faggot", "retard", "kike", "tranny",
];

/**
 * A username as it's kept, or an error message for the player. Letters, numbers and underscores only, so
 * it reads the same in a link (zaisma.com/@username) and a mention, and no lookalike letters can pass as
 * someone else. It starts and ends with a letter or number, has a letter, and no run of 7 digits (a phone number).
 */
export function checkUsername(input: string): { username: string } | { error: string } {
  const username = input.trim().replace(/^@/, "");
  if (username.length < MINIMUM_USERNAME_CHARACTER_COUNT || username.length > MAXIMUM_USERNAME_CHARACTER_COUNT || !/^[A-Za-z0-9_]+$/.test(username)) return { error: `Usernames are ${USERNAME_RULES}` };
  if (username.startsWith("_") || username.endsWith("_")) return { error: "Usernames start and end with a letter or number." };
  if (!/[A-Za-z]/.test(username)) return { error: "Usernames need at least one letter." };
  if (/[0-9]{7}/.test(username)) return { error: "That looks like a phone number. Pick a username without one." };
  const flat = username.toLowerCase().replace(/_/g, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (RESERVED.some((word) => flat.includes(word))) return { error: "That username is reserved. Try another." };
  if (BLOCKED.some((word) => flat.includes(word))) return { error: "That username isn't allowed. Try another." };
  return { username };
}

export const isUsernameRight = (username: string) => "username" in checkUsername(username);

/** The account with this username, ignoring case. */
export async function accountByUsername(database: D1Database, username: string): Promise<Account | null> {
  return database.prepare("SELECT * FROM accounts WHERE username = ? COLLATE NOCASE").bind(username).first<Account>();
}

/** Whether another account has this username, ignoring case. */
export async function isUsernameTaken(database: D1Database, username: string, exceptAccountId: string | null = null): Promise<boolean> {
  const row = await database.prepare("SELECT id FROM accounts WHERE username = ? COLLATE NOCASE").bind(username).first<{ id: string }>();
  return Boolean(row && row.id !== exceptAccountId);
}

const SUGGESTED_USERNAME_COUNT = 3;

/**
 * Free usernames close to the one a player wanted, for when it's taken or can't be used: what they typed
 * made to fit the rules, then with a number or two on the end.
 */
export async function suggestUsernames(database: D1Database, wanted: string): Promise<string[]> {
  const base = wanted
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/[0-9]{7,}/g, "")
    .slice(0, MAXIMUM_USERNAME_CHARACTER_COUNT - 4);
  const stem = /[A-Za-z]/.test(base) && isUsernameRight(base.padEnd(MINIMUM_USERNAME_CHARACTER_COUNT, "x")) ? base : "Player";
  // A number from lowest up to (not including) ten times lowest: 2, 3 or 4 digits.
  const randomNumber = (lowestNumber: number) => lowestNumber + (crypto.getRandomValues(new Uint32Array(1))[0]! % (lowestNumber * 9));
  const candidates = [
    ...(stem.length >= MINIMUM_USERNAME_CHARACTER_COUNT ? [stem] : []),
    `${stem}${randomNumber(10)}`,
    `${stem}_${randomNumber(10)}`,
    `${stem}${randomNumber(100)}`,
    `${stem}${randomNumber(1000)}`,
    `${stem}_${randomNumber(100)}`,
    `${stem}${randomNumber(1000)}`,
  ].filter((candidate, i, all) => all.indexOf(candidate) === i && isUsernameRight(candidate));
  const { results } = await database
    .prepare(`SELECT username FROM accounts WHERE username COLLATE NOCASE IN (${candidates.map(() => "?").join(", ")})`)
    .bind(...candidates)
    .all<{ username: string }>();
  const taken = new Set(results.map((row) => row.username.toLowerCase()));
  return candidates.filter((candidate) => !taken.has(candidate.toLowerCase()) && candidate.toLowerCase() !== wanted.toLowerCase()).slice(0, SUGGESTED_USERNAME_COUNT);
}

const now = () => Date.now();

export async function accountById(database: D1Database, id: string): Promise<Account | null> {
  return database.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<Account>();
}

/**
 * What anyone sees of an account by its player ID, games and servers included: exactly what a stranger
 * sees, as each part exists (today, its username). Never its email, age, saves or anything it didn't make
 * public (docs/DECISIONS.md, "A Zaisma account works in every game").
 */
export interface PlayerProfile {
  id: string;
  /** The name to show for them: their username, until profiles bring a name of their own. */
  name: string;
  /** Their unique username. */
  username: string;
}

/** An account's public profile, or null when no account has this player ID (a guest's, or a deleted account's). */
export async function playerProfile(database: D1Database, playerId: string): Promise<PlayerProfile | null> {
  if (!isIdOf("player", playerId)) return null;
  return database.prepare("SELECT player_id AS id, username AS name, username FROM accounts WHERE player_id = ?").bind(playerId).first<PlayerProfile>();
}

/** Another account took the username between the check and making the account (two made at once). */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`The username ${username} is taken.`);
  }
}

/**
 * A new account. A social mode its band can't choose (or none) becomes the band's default. Throws
 * UsernameTakenError when another account took the username first.
 */
export async function createAccount(database: D1Database, newAccount: { id: string; username: string; ageBand: AgeBand; socialMode?: SocialMode; hasPassword?: boolean }): Promise<Account> {
  const socialMode = newAccount.socialMode && socialModesFor(newAccount.ageBand).includes(newAccount.socialMode) ? newAccount.socialMode : defaultSocialMode(newAccount.ageBand);
  const createdAtMs = now();
  const account: Account = {
    id: newAccount.id,
    player_id: newId("player"),
    username: newAccount.username,
    age_band: newAccount.ageBand,
    social_mode: socialMode,
    password_changed_at_ms: newAccount.hasPassword ? createdAtMs : null,
    created_at_ms: createdAtMs,
    updated_at_ms: createdAtMs,
  };
  try {
    await database
      .prepare("INSERT INTO accounts (id, player_id, username, age_band, social_mode, password_changed_at_ms, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(account.id, account.player_id, account.username, account.age_band, account.social_mode, account.password_changed_at_ms, account.created_at_ms, account.updated_at_ms)
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE") && (await isUsernameTaken(database, newAccount.username, newAccount.id))) throw new UsernameTakenError(newAccount.username);
    throw error;
  }
  return (await accountById(database, newAccount.id)) ?? account;
}

/**
 * Change an account's age band or social mode. A social mode its band can't choose is refused
 * (false); the band only ever moves up (the caller checks the birth date), keeping the mode.
 */
export async function updateAccount(database: D1Database, id: string, change: { ageBand?: AgeBand; socialMode?: SocialMode }): Promise<boolean> {
  const current = await accountById(database, id);
  if (!current) return false;
  const band = change.ageBand ?? current.age_band;
  const socialMode = change.socialMode ?? current.social_mode;
  if (!socialModesFor(band).includes(socialMode)) return false;
  await database.prepare("UPDATE accounts SET age_band = ?, social_mode = ?, updated_at_ms = ? WHERE id = ?").bind(band, socialMode, now(), id).run();
  return true;
}

/** Give an account a new username (already checked), or false when another account has it. */
export async function changeUsername(database: D1Database, id: string, username: string): Promise<boolean> {
  if (await isUsernameTaken(database, username, id)) return false;
  try {
    await database.prepare("UPDATE accounts SET username = ?, updated_at_ms = ? WHERE id = ?").bind(username, now(), id).run();
    return true;
  } catch (error) {
    if (String(error).includes("UNIQUE")) return false;
    throw error;
  }
}

/** Note that the account's password was just set (Supabase keeps it). */
export async function markPasswordChanged(database: D1Database, id: string): Promise<void> {
  const changedAtMs = now();
  await database.prepare("UPDATE accounts SET password_changed_at_ms = ?, updated_at_ms = ? WHERE id = ?").bind(changedAtMs, changedAtMs, id).run();
}

/** Remove an account, its API keys, its save records, its friends and its forum topics (the caller deletes the save files and forum images). Its games stay up with no owner. */
export async function deleteAccount(database: D1Database, id: string): Promise<void> {
  const owner = await database.prepare("SELECT id FROM owners WHERE account_id = ?").bind(id).first<{ id: string }>();
  await database.batch([
    ...(owner
      ? [
          // Their sign-in apps go, with every player's yes to them and their codes not yet used.
          database.prepare("DELETE FROM sign_in_codes WHERE sign_in_app_id IN (SELECT id FROM sign_in_apps WHERE owner_id = ?)").bind(owner.id),
          database.prepare("DELETE FROM sign_in_grants WHERE sign_in_app_id IN (SELECT id FROM sign_in_apps WHERE owner_id = ?)").bind(owner.id),
          database.prepare("DELETE FROM sign_in_apps WHERE owner_id = ?").bind(owner.id),
          // Their webhooks, with what was on its way to them.
          database.prepare("DELETE FROM webhook_deliveries WHERE owner_id = ?").bind(owner.id),
          database.prepare("DELETE FROM webhooks WHERE owner_id = ?").bind(owner.id),
          database.prepare("UPDATE games SET owner_id = NULL WHERE owner_id = ?").bind(owner.id),
          database.prepare("DELETE FROM owners WHERE id = ?").bind(owner.id),
        ]
      : []),
    // The apps they signed in to with Zaisma.
    database.prepare("DELETE FROM sign_in_codes WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM sign_in_grants WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM save_history WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM passkeys WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM saves WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM played WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM api_keys WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM room_keys WHERE account_id = ?").bind(id),
    // Their friends, on both sides, and the invites they made.
    database.prepare("DELETE FROM friendships WHERE account_id = ? OR friend_account_id = ?").bind(id, id),
    database.prepare("DELETE FROM friend_invites WHERE account_id = ?").bind(id),
    // Their forum topics and posts go too (the caller deletes their images); a known issue they
    // started stays, nameless. Their replies and Me too come off other topics' counts.
    database.prepare(
      "UPDATE forum_topics SET reply_count = MAX(0, reply_count - (SELECT COUNT(*) FROM forum_posts post WHERE post.topic_id = forum_topics.id AND post.account_id = ? AND post.check_status = 'passed')) WHERE id IN (SELECT topic_id FROM forum_posts WHERE account_id = ? AND check_status = 'passed') AND COALESCE(account_id, '') != ?",
    ).bind(id, id, id),
    database.prepare("UPDATE forum_topics SET vote_count = MAX(0, vote_count - 1) WHERE id IN (SELECT topic_id FROM forum_votes WHERE account_id = ?)").bind(id),
    database.prepare("DELETE FROM forum_votes WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM forum_follows WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM forum_misplaced_flags WHERE account_id = ?").bind(id),
    database.prepare("UPDATE forum_posts SET helpful_count = MAX(0, helpful_count - 1) WHERE id IN (SELECT post_id FROM forum_helpful_marks WHERE account_id = ?)").bind(id),
    database.prepare("DELETE FROM forum_helpful_marks WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM forum_reports WHERE account_id = ?").bind(id),
    // Their posts' images and mentions (the files go with deleteForumFiles), and mentions of them.
    database.prepare("DELETE FROM forum_media WHERE account_id = ? OR post_id IN (SELECT id FROM forum_posts WHERE account_id = ? OR topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL))").bind(id, id, id),
    database.prepare("DELETE FROM forum_mentions WHERE account_id = ? OR post_id IN (SELECT id FROM forum_posts WHERE account_id = ? OR topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL))").bind(id, id, id),
    // Out of the forum's search too.
    database.prepare("DELETE FROM forum_search WHERE post_id IN (SELECT id FROM forum_posts WHERE account_id = ?)").bind(id),
    database.prepare("DELETE FROM forum_search WHERE topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_posts WHERE account_id = ?").bind(id),
    database.prepare("UPDATE forum_topics SET merged_into_topic_id = NULL WHERE merged_into_topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_posts WHERE topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_topic_tags WHERE topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_votes WHERE topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_follows WHERE topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_misplaced_flags WHERE topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)").bind(id),
    database.prepare("DELETE FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL").bind(id),
    database.prepare("UPDATE forum_topics SET account_id = NULL WHERE account_id = ?").bind(id),
    database.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
  ]);
}

/** The owner that stands for this person, made the first time they own something. */
export async function personOwner(database: D1Database, accountId: string): Promise<Owner> {
  await database
    .prepare("INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES (?, 'person', ?, ?) ON CONFLICT (account_id) DO NOTHING")
    .bind(newId("owner"), accountId, now())
    .run();
  return (await database.prepare("SELECT * FROM owners WHERE account_id = ?").bind(accountId).first<Owner>())!;
}

export async function setGameOwner(database: D1Database, gameId: string, ownerId: string | null): Promise<void> {
  await database.prepare("UPDATE games SET owner_id = ?, updated_at_ms = ? WHERE id = ?").bind(ownerId, now(), gameId).run();
}

/** Who a game belongs to, for the admin and (later) the game page. */
export async function gameOwner(database: D1Database, ownerId: string | null): Promise<{ owner: Owner; name: string } | null> {
  if (!ownerId) return null;
  const row = await database
    .prepare("SELECT owners.*, accounts.username AS name FROM owners LEFT JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?")
    .bind(ownerId)
    .first<Owner & { name: string | null }>();
  if (!row) return null;
  const { name, ...owner } = row;
  return { owner, name: name ?? "Deleted account" };
}

export async function gamesOwnedBy(database: D1Database, accountId: string): Promise<{ id: string; slug: string; title: string; review_status: string }[]> {
  const { results } = await database
    .prepare("SELECT games.id, games.slug, games.title, games.review_status FROM games JOIN owners ON owners.id = games.owner_id WHERE owners.account_id = ? ORDER BY games.updated_at_ms DESC")
    .bind(accountId)
    .all<{ id: string; slug: string; title: string; review_status: string }>();
  return results;
}

/** How many games Continue playing remembers. */
export const KEPT_PLAYED_GAME_COUNT = 20;

/** Remember that this account just played this game, keeping only the newest few. */
export async function recordPlayed(database: D1Database, accountId: string, gameId: string, playedAtMs = Date.now()): Promise<void> {
  await database.batch([
    database.prepare("INSERT INTO played (account_id, game_id, played_at_ms) VALUES (?, ?, ?) ON CONFLICT (account_id, game_id) DO UPDATE SET played_at_ms = excluded.played_at_ms").bind(accountId, gameId, playedAtMs),
    database
      .prepare("DELETE FROM played WHERE account_id = ? AND game_id NOT IN (SELECT game_id FROM played WHERE account_id = ? ORDER BY played_at_ms DESC LIMIT ?)")
      .bind(accountId, accountId, KEPT_PLAYED_GAME_COUNT),
  ]);
}

/** Add the games a guest played on this device to their new account, keeping the newer time for each. */
export async function mergePlayed(database: D1Database, accountId: string, played: { gameId: string; playedAtMs: number }[]): Promise<void> {
  if (!played.length) return;
  await database.batch([
    ...played.map((playedGame) =>
      database.prepare("INSERT INTO played (account_id, game_id, played_at_ms) VALUES (?, ?, ?) ON CONFLICT (account_id, game_id) DO UPDATE SET played_at_ms = MAX(played_at_ms, excluded.played_at_ms)").bind(accountId, playedGame.gameId, playedGame.playedAtMs),
    ),
    database
      .prepare("DELETE FROM played WHERE account_id = ? AND game_id NOT IN (SELECT game_id FROM played WHERE account_id = ? ORDER BY played_at_ms DESC LIMIT ?)")
      .bind(accountId, accountId, KEPT_PLAYED_GAME_COUNT),
  ]);
}

/** The games this account played, newest first, by link name. */
export async function recentlyPlayed(database: D1Database, accountId: string): Promise<{ slug: string; played_at_ms: number }[]> {
  const { results } = await database
    .prepare("SELECT games.slug, played.played_at_ms FROM played JOIN games ON games.id = played.game_id WHERE played.account_id = ? ORDER BY played.played_at_ms DESC LIMIT ?")
    .bind(accountId, KEPT_PLAYED_GAME_COUNT)
    .all<{ slug: string; played_at_ms: number }>();
  return results;
}
