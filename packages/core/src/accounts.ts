import { isIdOf, newId } from "./ids.ts";
import { SOCIAL_SETTINGS, defaultSocialMode, isWithinAgeLimits, pickSocialSettings, socialModeSettings, socialModesFor, socialSettingsInNewBand, socialSettingsOf, type SocialMode, type SocialSettings } from "./social-settings.ts";

export type AgeBand = "13-15" | "16-17" | "18+";

/** An account, with its social settings (social-settings.ts). */
export interface Account extends SocialSettings {
  /** The Supabase user ID. Stays inside Zaisma. */
  id: string;
  /** The player ID games see, the same in every game (player_…). */
  player_id: string;
  name: string;
  age_band: AgeBand;
  /** The birth date (YYYY-MM-DD), kept only while the account is under 18 so its band moves up on the birthday by itself; null from 18. */
  birth_date: string | null;
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
 * Whole years between a birth date and today. We keep the band, and the date itself only while the
 * account is under 18 (docs/DECISIONS.md, "13+ at launch").
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

/** A birth date as accounts keep it: YYYY-MM-DD. */
export function birthDateText(birth: { yearNumber: number; monthNumber: number; dayNumber: number }): string {
  return `${String(birth.yearNumber).padStart(4, "0")}-${String(birth.monthNumber).padStart(2, "0")}-${String(birth.dayNumber).padStart(2, "0")}`;
}

/** The band a kept birth date is in on that day, or null for one that doesn't read (or is under 13). */
export function ageBandOn(birthDate: string, today: Date): AgeBand | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const ageYearCount = parts ? ageOn({ yearNumber: Number(parts[1]), monthNumber: Number(parts[2]), dayNumber: Number(parts[3]) }, today) : null;
  return ageYearCount === null ? null : ageBand(ageYearCount);
}

/**
 * The day it is in the last time zone on Earth (UTC−12), for birthdays: an account moves up a band only
 * once its birthday has come everywhere, so it's never early wherever the player is.
 */
export function birthdayToday(nowMs = Date.now()): Date {
  return new Date(nowMs - 12 * 3600_000);
}

const AGE_BAND_ORDER: Record<AgeBand, number> = { "13-15": 0, "16-17": 1, "18+": 2 };

export const isAgeBand = (given: unknown): given is AgeBand => AGE_BANDS.includes(given as AgeBand);

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
  if (RESERVED.some((word) => flat.includes(word))) return { error: "That name is reserved. Try another." };
  if (BLOCKED.some((word) => flat.includes(word))) return { error: "That name isn't allowed. Try another." };
  return { name };
}

const now = () => Date.now();

/** An account, with any birthday since it was last read applied first (birthdayChange). */
export async function accountById(database: D1Database, id: string, nowMs = Date.now()): Promise<Account | null> {
  const account = await database.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<Account>();
  const change = account && birthdayChange(account, nowMs);
  if (!account || !change) return account;
  await birthdayStatement(database, account, change, nowMs).run();
  return { ...account, ...change, updated_at_ms: nowMs };
}

/**
 * What an account's kept birth date changes today, or null for nothing: its band moves up (carrying its
 * preset over, socialSettingsInNewBand) and from 18 the date is deleted. Bands never move down, and a
 * date that doesn't read is deleted.
 */
function birthdayChange(account: Account, nowMs: number): (Pick<Account, "age_band" | "birth_date"> & SocialSettings) | null {
  if (!account.birth_date) return null;
  const band = ageBandOn(account.birth_date, birthdayToday(nowMs));
  if (!band || account.age_band === "18+") return { age_band: account.age_band, birth_date: null, ...socialSettingsOf(account) };
  if (AGE_BAND_ORDER[band] <= AGE_BAND_ORDER[account.age_band]) return null;
  return { age_band: band, birth_date: band === "18+" ? null : account.birth_date, ...socialSettingsInNewBand(account, band) };
}

/** Writes a birthday's change, unless the account moved meanwhile. */
function birthdayStatement(database: D1Database, account: Account, change: Pick<Account, "age_band" | "birth_date"> & SocialSettings, nowMs: number): D1PreparedStatement {
  return database
    .prepare(`UPDATE accounts SET age_band = ?, birth_date = ?, ${SOCIAL_SETTINGS.map((setting) => `${setting} = ?`).join(", ")}, updated_at_ms = ? WHERE id = ? AND age_band = ?`)
    .bind(change.age_band, change.birth_date, ...SOCIAL_SETTINGS.map((setting) => change[setting]), nowMs, account.id, account.age_band);
}

/**
 * Once a day: every birthday nobody's account was read for since (accountById does it for the rest),
 * so a teen moves up a band and an 18-year-old's birth date is deleted even while they're away. Answers
 * how many accounts changed.
 */
export async function applyBirthdays(database: D1Database, nowMs = Date.now()): Promise<number> {
  const today = birthdayToday(nowMs);
  // Born on or before this day that many years ago: as old as that today, the same as ageOn.
  const yearsAgo = (yearCount: number) => birthDateText({ yearNumber: today.getUTCFullYear() - yearCount, monthNumber: today.getUTCMonth() + 1, dayNumber: today.getUTCDate() });
  let changedCount = 0;
  for (let i = 0; i < 20; i++) {
    const { results } = await database
      .prepare("SELECT * FROM accounts WHERE birth_date IS NOT NULL AND ((age_band = '13-15' AND birth_date <= ?) OR (age_band = '16-17' AND birth_date <= ?) OR age_band = '18+') LIMIT 500")
      .bind(yearsAgo(16), yearsAgo(18))
      .all<Account>();
    const statements = results.flatMap((account) => {
      const change = birthdayChange(account, nowMs);
      return change ? [birthdayStatement(database, account, change, nowMs)] : [];
    });
    if (statements.length) await database.batch(statements);
    changedCount += statements.length;
    if (results.length < 500 || statements.length === 0) break;
  }
  return changedCount;
}

/**
 * What anyone sees of an account by its player ID, games and servers included: exactly what a stranger
 * sees, as each part exists (today, its name). Never its email, age, saves or anything it didn't make
 * public (docs/DECISIONS.md, "A Zaisma account works in every game").
 */
export interface PlayerProfile {
  id: string;
  name: string;
}

/** An account's public profile, or null when no account has this player ID (a guest's, or a deleted account's). */
export async function playerProfile(database: D1Database, playerId: string): Promise<PlayerProfile | null> {
  if (!isIdOf("player", playerId)) return null;
  return database.prepare("SELECT player_id AS id, name FROM accounts WHERE player_id = ?").bind(playerId).first<PlayerProfile>();
}

/** A new account, on a social mode's preset. A social mode its band can't choose (or none) becomes the band's default. */
export async function createAccount(database: D1Database, newAccount: { id: string; name: string; ageBand: AgeBand; birthDate?: string | null; socialMode?: SocialMode }): Promise<Account> {
  const socialMode = newAccount.socialMode && socialModesFor(newAccount.ageBand).includes(newAccount.socialMode) ? newAccount.socialMode : defaultSocialMode(newAccount.ageBand);
  // The birth date stays only while under 18 (accountById moves the band up on the birthday).
  const birthDate = newAccount.ageBand !== "18+" && newAccount.birthDate ? newAccount.birthDate : null;
  const account: Account = { id: newAccount.id, player_id: newId("player"), name: newAccount.name, age_band: newAccount.ageBand, birth_date: birthDate, ...socialModeSettings(socialMode, newAccount.ageBand), created_at_ms: now(), updated_at_ms: now() };
  await database
    .prepare(`INSERT INTO accounts (id, player_id, name, age_band, birth_date, ${SOCIAL_SETTINGS.join(", ")}, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ${SOCIAL_SETTINGS.map(() => "?").join(", ")}, ?, ?) ON CONFLICT (id) DO NOTHING`)
    .bind(account.id, account.player_id, account.name, account.age_band, account.birth_date, ...SOCIAL_SETTINGS.map((setting) => account[setting]), account.created_at_ms, account.updated_at_ms)
    .run();
  return (await accountById(database, newAccount.id)) ?? account;
}

/**
 * Change an account's name or social settings. Settings past its band's limits are refused (false).
 * Nobody changes their band: it moves up by itself on birthdays (accountById).
 */
export async function updateAccount(database: D1Database, id: string, change: { name?: string; socialSettings?: SocialSettings }): Promise<boolean> {
  const current = await accountById(database, id);
  if (!current) return false;
  const settings = change.socialSettings ? pickSocialSettings(change.socialSettings) : socialSettingsOf(current);
  if (!isWithinAgeLimits(settings, current.age_band)) return false;
  await database
    .prepare(`UPDATE accounts SET name = ?, ${SOCIAL_SETTINGS.map((setting) => `${setting} = ?`).join(", ")}, updated_at_ms = ? WHERE id = ?`)
    .bind(change.name ?? current.name, ...SOCIAL_SETTINGS.map((setting) => settings[setting]), now(), id)
    .run();
  return true;
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
    .prepare("SELECT owners.*, accounts.name AS name FROM owners LEFT JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?")
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
