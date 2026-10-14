import { newId } from "./ids.ts";

export type AgeBand = "13-17" | "18+";

export interface Account {
  /** The Supabase user ID. */
  id: string;
  name: string;
  age_band: AgeBand;
  created_at: number;
  updated_at: number;
}

export interface Owner {
  id: string;
  kind: "person" | "team";
  account_id: string | null;
  created_at: number;
}

/**
 * Whole years between a birth date and today. The birth date is only used here,
 * in the request that asks for it; we keep the band, never the date.
 */
export function ageOn(birth: { year: number; month: number; day: number }, today: Date): number | null {
  const { year, month, day } = birth;
  if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date > today || year < today.getUTCFullYear() - 120) return null;
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age--;
  return age;
}

/** 13–17 or 18+, or null for under 13 (no account). */
export function ageBand(age: number): AgeBand | null {
  return age < 13 ? null : age < 18 ? "13-17" : "18+";
}

export const NAME_RULES = "3 to 20 letters, numbers, spaces, dashes or underscores.";

// Names other players see. Kept short and plain; reports catch what this misses.
const RESERVED = ["zaisma", "admin", "moderator", "official", "support", "staff"];
const BLOCKED = [
  // Substrings, so words like "grape" or "peacock" aren't caught by short ones.
  "fuck", "shit", "cunt", "bitch", "whore", "slut", "porn", "penis", "vagina", "pussy", "boob", "nazi", "hitler",
  "nigg", "faggot", "retard", "kike", "tranny",
];

/** A tidy name, or an error message for the player. */
export function checkName(input: string): { name: string } | { error: string } {
  const name = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{1,18}[\p{L}\p{N}]$/u.test(name)) return { error: `Names are ${NAME_RULES}` };
  const flat = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (RESERVED.some((w) => flat.includes(w))) return { error: "That name is reserved. Try another." };
  if (BLOCKED.some((w) => flat.includes(w))) return { error: "That name isn't allowed. Try another." };
  return { name };
}

const now = () => Date.now();

export async function accountById(db: D1Database, id: string): Promise<Account | null> {
  return db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<Account>();
}

export async function createAccount(db: D1Database, a: { id: string; name: string; ageBand: AgeBand }): Promise<Account> {
  const account: Account = { id: a.id, name: a.name, age_band: a.ageBand, created_at: now(), updated_at: now() };
  await db
    .prepare("INSERT INTO accounts (id, name, age_band, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
    .bind(account.id, account.name, account.age_band, account.created_at, account.updated_at)
    .run();
  return (await accountById(db, a.id)) ?? account;
}

export async function updateAccount(db: D1Database, id: string, a: { name?: string; ageBand?: AgeBand }): Promise<void> {
  const current = await accountById(db, id);
  if (!current) return;
  await db
    .prepare("UPDATE accounts SET name = ?, age_band = ?, updated_at = ? WHERE id = ?")
    .bind(a.name ?? current.name, a.ageBand ?? current.age_band, now(), id)
    .run();
}

/** Remove an account, its API keys, its save records and its feedback (the caller deletes the save files and screenshots). Its games stay up with no owner. */
export async function deleteAccount(db: D1Database, id: string): Promise<void> {
  const owner = await db.prepare("SELECT id FROM owners WHERE account_id = ?").bind(id).first<{ id: string }>();
  await db.batch([
    ...(owner
      ? [db.prepare("UPDATE games SET owner_id = NULL WHERE owner_id = ?").bind(owner.id), db.prepare("DELETE FROM owners WHERE id = ?").bind(owner.id)]
      : []),
    db.prepare("DELETE FROM save_history WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM passkeys WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM saves WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM played WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM api_keys WHERE account_id = ?").bind(id),
    // Their forum topics and posts go too (the caller deletes their screenshots); a known issue they
    // started stays, nameless. Their replies and Me too come off other topics' counts.
    db.prepare(
      "UPDATE feedback SET replies = MAX(0, replies - (SELECT COUNT(*) FROM feedback_posts p WHERE p.feedback_id = feedback.id AND p.account_id = ? AND p.check_state = 'ok')) WHERE id IN (SELECT feedback_id FROM feedback_posts WHERE account_id = ? AND check_state = 'ok') AND COALESCE(account_id, '') != ?",
    ).bind(id, id, id),
    db.prepare("UPDATE feedback SET votes = MAX(0, votes - 1) WHERE id IN (SELECT feedback_id FROM feedback_votes WHERE account_id = ?)").bind(id),
    db.prepare("DELETE FROM feedback_votes WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM feedback_follows WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM feedback_misplaced WHERE account_id = ?").bind(id),
    db.prepare("UPDATE feedback_posts SET helpful = MAX(0, helpful - 1) WHERE id IN (SELECT post_id FROM feedback_helpful WHERE account_id = ?)").bind(id),
    db.prepare("DELETE FROM feedback_helpful WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM forum_reports WHERE account_id = ?").bind(id),
    // Their posts' images and mentions (the files go with deleteFeedbackPictures), and mentions of them.
    db.prepare("DELETE FROM feedback_media WHERE post_id IN (SELECT id FROM feedback_posts WHERE account_id = ? OR feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL))").bind(id, id),
    db.prepare("DELETE FROM feedback_mentions WHERE account_id = ? OR post_id IN (SELECT id FROM feedback_posts WHERE account_id = ? OR feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL))").bind(id, id, id),
    // Out of the forum's search too.
    db.prepare("DELETE FROM forum_search WHERE post_id IN (SELECT id FROM feedback_posts WHERE account_id = ?)").bind(id),
    db.prepare("DELETE FROM forum_search WHERE topic_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback_posts WHERE account_id = ?").bind(id),
    db.prepare("UPDATE feedback SET group_id = NULL WHERE group_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback_posts WHERE feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback_tags WHERE feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback_votes WHERE feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback_follows WHERE feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback_misplaced WHERE feedback_id IN (SELECT id FROM feedback WHERE account_id = ? AND known_title IS NULL)").bind(id),
    db.prepare("DELETE FROM feedback WHERE account_id = ? AND known_title IS NULL").bind(id),
    db.prepare("UPDATE feedback SET account_id = NULL WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
  ]);
}

/** The owner that stands for this person, made the first time they own something. */
export async function personOwner(db: D1Database, accountId: string): Promise<Owner> {
  await db
    .prepare("INSERT INTO owners (id, kind, account_id, created_at) VALUES (?, 'person', ?, ?) ON CONFLICT (account_id) DO NOTHING")
    .bind(newId(), accountId, now())
    .run();
  return (await db.prepare("SELECT * FROM owners WHERE account_id = ?").bind(accountId).first<Owner>())!;
}

export async function setGameOwner(db: D1Database, gameId: string, ownerId: string | null): Promise<void> {
  await db.prepare("UPDATE games SET owner_id = ?, updated_at = ? WHERE id = ?").bind(ownerId, now(), gameId).run();
}

/** Who a game belongs to, for the admin and (later) the game page. */
export async function gameOwner(db: D1Database, ownerId: string | null): Promise<{ owner: Owner; name: string } | null> {
  if (!ownerId) return null;
  const row = await db
    .prepare("SELECT owners.*, accounts.name AS name FROM owners LEFT JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?")
    .bind(ownerId)
    .first<Owner & { name: string | null }>();
  if (!row) return null;
  const { name, ...owner } = row;
  return { owner, name: name ?? "Deleted account" };
}

export async function gamesOwnedBy(db: D1Database, accountId: string): Promise<{ id: string; slug: string; title: string; status: string }[]> {
  const { results } = await db
    .prepare("SELECT games.id, games.slug, games.title, games.status FROM games JOIN owners ON owners.id = games.owner_id WHERE owners.account_id = ? ORDER BY games.updated_at DESC")
    .bind(accountId)
    .all<{ id: string; slug: string; title: string; status: string }>();
  return results;
}

/** How many games Continue playing remembers. */
export const PLAYED_KEEP = 20;

/** Remember that this account just played this game, keeping only the newest few. */
export async function recordPlayed(db: D1Database, accountId: string, gameId: string, at = Date.now()): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO played (account_id, game_id, at) VALUES (?, ?, ?) ON CONFLICT (account_id, game_id) DO UPDATE SET at = excluded.at").bind(accountId, gameId, at),
    db
      .prepare("DELETE FROM played WHERE account_id = ? AND game_id NOT IN (SELECT game_id FROM played WHERE account_id = ? ORDER BY at DESC LIMIT ?)")
      .bind(accountId, accountId, PLAYED_KEEP),
  ]);
}

/** Add the games a guest played on this device to their new account, keeping the newer time for each. */
export async function mergePlayed(db: D1Database, accountId: string, played: { gameId: string; at: number }[]): Promise<void> {
  if (!played.length) return;
  await db.batch([
    ...played.map((p) =>
      db.prepare("INSERT INTO played (account_id, game_id, at) VALUES (?, ?, ?) ON CONFLICT (account_id, game_id) DO UPDATE SET at = MAX(at, excluded.at)").bind(accountId, p.gameId, p.at),
    ),
    db
      .prepare("DELETE FROM played WHERE account_id = ? AND game_id NOT IN (SELECT game_id FROM played WHERE account_id = ? ORDER BY at DESC LIMIT ?)")
      .bind(accountId, accountId, PLAYED_KEEP),
  ]);
}

/** The games this account played, newest first, by link name. */
export async function recentlyPlayed(db: D1Database, accountId: string): Promise<{ slug: string; at: number }[]> {
  const { results } = await db
    .prepare("SELECT games.slug, played.at FROM played JOIN games ON games.id = played.game_id WHERE played.account_id = ? ORDER BY played.at DESC LIMIT ?")
    .bind(accountId, PLAYED_KEEP)
    .all<{ slug: string; at: number }>();
  return results;
}
