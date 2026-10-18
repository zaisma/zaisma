import { isIdOf } from "./ids.ts";
import type { Account } from "./accounts.ts";
import { hasBlockBetweenAccounts } from "./blocks.ts";
import { playingNowOf } from "./friends-now.ts";
import { socialSettingsOf } from "./social-settings.ts";
import { checkText, tidyText } from "./text-filter.ts";

/**
 * Profiles (docs/DECISIONS.md, "What a profile shows"): zaisma.com/@username. A short header (picture,
 * name and @username, bio, links), then covers: a developer's own published games, Playing now, then
 * Played with rough times. Who sees my profile (friends or anyone) decides who gets past the header;
 * everyone else sees the picture, name, @username and published games, and "Mia's profile is private.".
 * Past the wall each part still follows its own setting. What the owner writes shows to others only
 * once the profile check passed it (apps/site/src/profile-check.ts).
 */

export const MAXIMUM_DISPLAY_NAME_CHARACTER_COUNT = 30;
export const MAXIMUM_BIO_CHARACTER_COUNT = 160;
export const MAXIMUM_LINK_COUNT = 3;
const MAXIMUM_LINK_CHARACTER_COUNT = 200;

/** How long ago, roughly: a profile never shows a clock time or hours, so it can't be used to follow someone. */
export type PlayedPeriod = "today" | "this_week" | "this_month" | "earlier";

export const PLAYED_PERIOD_WORDS: Record<PlayedPeriod, string> = { today: "today", this_week: "this week", this_month: "this month", earlier: "a while ago" };

const DAY_MS = 86400_000;

export function playedPeriodOf(playedAtMs: number, nowMs = Date.now()): PlayedPeriod {
  const ageMs = nowMs - playedAtMs;
  return ageMs < DAY_MS ? "today" : ageMs < 7 * DAY_MS ? "this_week" : ageMs < 30 * DAY_MS ? "this_month" : "earlier";
}

/** What the owner can write on their profile, as kept. */
export interface ProfileText {
  display_name: string | null;
  bio: string | null;
  link_urls: string[];
}

/** The account's links, from its column (one per line). */
export const linkUrlsOf = (account: Pick<Account, "link_urls">) => (account.link_urls ? account.link_urls.split("\n").filter(Boolean) : []);

/**
 * What a player typed for their profile, tidied, or what's wrong with it in words for them. Contact
 * details and "add me on…" are refused here at once, like chat (checkText); the profile check looks
 * again before anyone else sees it. Links are https only and only for 18+ accounts.
 */
export function readProfileText(given: { display_name?: unknown; bio?: unknown; link_urls?: unknown }, account: Pick<Account, "age_band">): { profileText: ProfileText } | { error: string; field: "display_name" | "bio" | "link_urls" } {
  const displayName = tidyText(given.display_name, MAXIMUM_DISPLAY_NAME_CHARACTER_COUNT + 1);
  if (displayName.length > MAXIMUM_DISPLAY_NAME_CHARACTER_COUNT) return { error: `A name is ${MAXIMUM_DISPLAY_NAME_CHARACTER_COUNT} characters at most.`, field: "display_name" };
  // A bio keeps its line breaks (up to 4 lines); everything else is tidied like chat.
  const bioLines = String(given.bio ?? "")
    .split(/\r?\n/)
    .map((line) => tidyText(line, MAXIMUM_BIO_CHARACTER_COUNT + 1))
    .filter(Boolean);
  if (bioLines.length > 4) return { error: "A bio is 4 lines at most.", field: "bio" };
  const bio = bioLines.join("\n");
  if (bio.length > MAXIMUM_BIO_CHARACTER_COUNT) return { error: `A bio is ${MAXIMUM_BIO_CHARACTER_COUNT} characters at most.`, field: "bio" };
  for (const [text, field] of [[displayName, "display_name"], [bio, "bio"]] as const) {
    const checked = checkText(text);
    if (!checked.isAllowed) {
      return { error: checked.reason === "contact" ? "Keep contact details, links and other apps off your name and bio. Links go in Links." : "That has words Zaisma doesn't show. Try other words.", field };
    }
  }
  const linkInputs = (Array.isArray(given.link_urls) ? given.link_urls : String(given.link_urls ?? "").split(/\s*\n\s*/)).map((link) => String(link ?? "").trim()).filter(Boolean);
  if (linkInputs.length && account.age_band !== "18+") return { error: "Links can't be shown on this profile.", field: "link_urls" };
  if (linkInputs.length > MAXIMUM_LINK_COUNT) return { error: `A profile shows ${MAXIMUM_LINK_COUNT} links at most.`, field: "link_urls" };
  const linkUrls: string[] = [];
  for (const input of linkInputs) {
    const withScheme = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = URL.canParse(withScheme) ? new URL(withScheme) : null;
    if (!parsed || parsed.protocol !== "https:" || !parsed.hostname.includes(".") || parsed.username || parsed.password || /^[\d.]+$/.test(parsed.hostname) || withScheme.length > MAXIMUM_LINK_CHARACTER_COUNT) {
      return { error: `${input.slice(0, 60)} isn't a link Zaisma can show. Links are https addresses, like https://instagram.com/yourname.`, field: "link_urls" };
    }
    if (!linkUrls.includes(parsed.href)) linkUrls.push(parsed.href);
  }
  return { profileText: { display_name: displayName || null, bio: bio || null, link_urls: linkUrls } };
}

/**
 * Keep what the owner wrote. When it changed, it's checked again before others see it (pending); with
 * nothing written there's nothing to check. Answers whether there's something to check now.
 */
export async function saveProfileText(database: D1Database, accountId: string, profileText: ProfileText): Promise<boolean> {
  const current = await database.prepare("SELECT display_name, bio, link_urls, profile_check_status FROM accounts WHERE id = ?").bind(accountId).first<Pick<Account, "display_name" | "bio" | "link_urls" | "profile_check_status">>();
  if (!current) return false;
  const linkUrls = profileText.link_urls.join("\n");
  const isEmpty = !profileText.display_name && !profileText.bio && !linkUrls;
  const isSame = current.display_name === profileText.display_name && current.bio === profileText.bio && current.link_urls === linkUrls;
  if (isSame && current.profile_check_status !== null) return current.profile_check_status === "pending";
  const checkStatus = isEmpty ? null : "pending";
  await database
    .prepare("UPDATE accounts SET display_name = ?, bio = ?, link_urls = ?, profile_check_status = ?, profile_held_reason = NULL, profile_check_attempt_count = 0, updated_at_ms = ? WHERE id = ?")
    .bind(profileText.display_name, profileText.bio, linkUrls, checkStatus, Date.now(), accountId)
    .run();
  // Words that are gone settle any reports about them.
  await database.prepare("DELETE FROM profile_reports WHERE account_id = ?").bind(accountId).run();
  return checkStatus === "pending";
}

/** Who's looking at a profile. The owner can also look at it as a friend or anyone would (view_as). */
export type ProfileViewer = { kind: "owner" } | { kind: "friend"; accountId: string | null } | { kind: "signed_in"; accountId: string } | { kind: "anyone" };

/** A game on a profile. */
export interface ProfileGame {
  slug: string;
  title: string;
}

export interface PlayedProfileGame extends ProfileGame {
  played_at_ms: number;
  played_period: PlayedPeriod;
}

/** A face among the friends a visitor and the owner have in common. */
export interface MutualFriend {
  player_id: string;
  username: string;
}

/** What one viewer sees of a profile. */
export interface ProfileView {
  player_id: string;
  username: string;
  /** The name they chose, once checked; null shows the username alone. */
  display_name: string | null;
  bio: string | null;
  /** Only on 18+ profiles. */
  link_urls: string[];
  /** The viewer stopped at the wall: only the header and published games show. */
  is_private: boolean;
  published_games: ProfileGame[];
  /** Null when this viewer doesn't see what they've played (their setting); else newest first. */
  played_games: PlayedProfileGame[] | null;
  /** Whether this viewer sees what they're playing now (who_sees_playing_now), for Playing now. */
  can_see_playing_now: boolean;
  /** Friends the signed-in visitor and the owner have in common, only past the wall. */
  mutual_friends: MutualFriend[];
}

/** Whether a setting of friends or anyone lets this viewer in. The owner always sees their own. */
function lets(setting: "nobody" | "friends" | "anyone", viewer: ProfileViewer): boolean {
  if (viewer.kind === "owner") return true;
  return setting === "anyone" || (setting === "friends" && viewer.kind === "friend");
}

/** Games the owner made that anyone can find: live and listed, and not for players older than the viewer. */
export async function publishedGamesOf(database: D1Database, accountId: string, viewerAgeFloorYears: number): Promise<ProfileGame[]> {
  const { results } = await database
    .prepare("SELECT games.slug, games.title FROM games JOIN owners ON owners.id = games.owner_id WHERE owners.account_id = ? AND games.review_status = 'live' AND games.visibility = 'listed' AND games.live_version_id IS NOT NULL AND games.minimum_player_age_years <= ? ORDER BY games.created_at_ms DESC LIMIT 24")
    .bind(accountId, viewerAgeFloorYears)
    .all<ProfileGame>();
  return results;
}

/**
 * What a viewer sees of an account's profile. A block between them, either way, keeps the visitor at
 * the wall, as if the profile were private: the same view a private profile gives, so the blocked one
 * is never told. Games for players older than the viewer (viewerAgeFloorYears, 18 signed out) are left
 * out, as if they weren't there.
 */
export async function profileView(database: D1Database, owner: Account, viewer: ProfileViewer, viewerAgeFloorYears: number, nowMs = Date.now()): Promise<ProfileView> {
  const settings = socialSettingsOf(owner);
  const visitorId = viewer.kind === "signed_in" || viewer.kind === "friend" ? viewer.accountId : null;
  const isBlocked = visitorId !== null && (await hasBlockBetweenAccounts(database, visitorId, owner.id));
  const isPastWall = !isBlocked && lets(settings.who_sees_profile, viewer);
  const isChecked = owner.profile_check_status === "passed" || viewer.kind === "owner";
  const showsPlayed = isPastWall && lets(settings.who_sees_played_games, viewer);
  const [publishedGames, played, mutual] = await Promise.all([
    publishedGamesOf(database, owner.id, viewerAgeFloorYears),
    showsPlayed
      ? database
          .prepare("SELECT games.slug, games.title, played.played_at_ms FROM played JOIN games ON games.id = played.game_id WHERE played.account_id = ? AND games.review_status = 'live' AND games.visibility = 'listed' AND games.minimum_player_age_years <= ? ORDER BY played.played_at_ms DESC LIMIT 12")
          .bind(owner.id, viewerAgeFloorYears)
          .all<{ slug: string; title: string; played_at_ms: number }>()
      : null,
    isPastWall && visitorId
      ? database
          .prepare("SELECT accounts.player_id, accounts.username FROM friendships mine JOIN friendships theirs ON theirs.friend_account_id = mine.friend_account_id AND theirs.account_id = ? JOIN accounts ON accounts.id = mine.friend_account_id WHERE mine.account_id = ? ORDER BY accounts.username COLLATE NOCASE LIMIT 12")
          .bind(owner.id, visitorId)
          .all<MutualFriend>()
      : null,
  ]);
  return {
    player_id: owner.player_id,
    username: owner.username,
    display_name: isChecked ? owner.display_name : null,
    bio: isPastWall && isChecked ? owner.bio : null,
    link_urls: isPastWall && isChecked && owner.age_band === "18+" ? linkUrlsOf(owner) : [],
    is_private: !isPastWall,
    published_games: publishedGames,
    played_games: played ? played.results.map((game) => ({ ...game, played_period: playedPeriodOf(game.played_at_ms, nowMs) })) : null,
    can_see_playing_now: isPastWall && lets(settings.who_sees_playing_now, viewer),
    mutual_friends: mutual?.results ?? [],
  };
}

/**
 * What anyone sees of an account by its player ID, games and servers included: exactly what a stranger
 * sees on its profile page. Never its email, age, saves or anything it didn't make public (docs/DECISIONS.md,
 * "A Zaisma account works in every game").
 */
export interface PlayerProfile {
  id: string;
  /** The name games show for them: their username. */
  name: string;
  /** Their unique username. */
  username: string;
  /** The name they chose to show beside @username on their profile, or null. */
  display_name: string | null;
  bio: string | null;
  link_urls: string[];
  profile_url: string;
  is_profile_private: boolean;
  published_games: { slug: string; title: string; page_url: string }[];
  played_games: { slug: string; title: string; page_url: string; played_period: PlayedPeriod }[];
  /** The game they're playing right now, when they show that to anyone and it's out; else null. */
  playing_now: { slug: string; title: string; page_url: string } | null;
}

/** An account's public profile, or null when no account has this player ID (a guest's, or a deleted account's). */
export async function playerProfile(database: D1Database, playerId: string, siteOrigin: string): Promise<PlayerProfile | null> {
  if (!isIdOf("player", playerId)) return null;
  const account = await database.prepare("SELECT * FROM accounts WHERE player_id = ?").bind(playerId).first<Account>();
  if (!account) return null;
  // As a stranger signed out sees it (games see what the public sees), so every listed game.
  const view = await profileView(database, account, { kind: "anyone" }, 18);
  // Playing now as a stranger sees it on the profile; a game that isn't out yet has no name to give.
  const playingNow = view.can_see_playing_now ? (await playingNowOf(database, account.id, null, 18))?.game ?? null : null;
  const pageUrl = (slug: string) => `${siteOrigin}/g/${slug}`;
  return {
    id: account.player_id,
    name: account.username,
    username: account.username,
    display_name: view.display_name,
    bio: view.bio,
    link_urls: view.link_urls,
    profile_url: `${siteOrigin}/@${account.username}`,
    is_profile_private: view.is_private,
    published_games: view.published_games.map((game) => ({ slug: game.slug, title: game.title, page_url: pageUrl(game.slug) })),
    played_games: (view.played_games ?? []).map((game) => ({ slug: game.slug, title: game.title, page_url: pageUrl(game.slug), played_period: game.played_period })),
    playing_now: playingNow ? { slug: playingNow.slug, title: playingNow.title, page_url: pageUrl(playingNow.slug) } : null,
  };
}

/** The name games show for a player: an account's username, or null for no account. Rooms read only this. */
export async function accountUsernameOf(database: D1Database, playerId: string): Promise<string | null> {
  if (!isIdOf("player", playerId)) return null;
  return (await database.prepare("SELECT username FROM accounts WHERE player_id = ?").bind(playerId).first<{ username: string }>())?.username ?? null;
}

/** Why a signed-in player reports a profile. */
export const PROFILE_REPORT_REASONS = {
  contact: "Shares contact details or asks to talk elsewhere",
  harassment: "Harassing or bullying",
  hate: "Hate or threats",
  sexual: "Sexual",
  impersonation: "Pretends to be someone else",
  child_safety: "Puts a young person at risk",
  other: "Something else",
} as const;
export type ProfileReportReason = keyof typeof PROFILE_REPORT_REASONS;

/** Reports from this many players hide a profile's words until a person looks; child safety hides them at once. */
export const PROFILE_HIDING_REPORT_COUNT = 3;

/**
 * A signed-in player reports a profile. Answers whether its words are hidden now: they go back to held
 * (others see the username alone) until a person lets them through or clears them.
 */
export async function reportProfile(database: D1Database, owner: Account, reporterAccountId: string, reason: ProfileReportReason, details: string): Promise<{ is_hidden: boolean }> {
  await database
    .prepare("INSERT OR REPLACE INTO profile_reports (account_id, reporter_account_id, reason, details, created_at_ms) VALUES (?, ?, ?, ?, ?)")
    .bind(owner.id, reporterAccountId, reason, details || null, Date.now())
    .run();
  const reportCount = (await database.prepare("SELECT COUNT(*) AS report_count FROM profile_reports WHERE account_id = ?").bind(owner.id).first<{ report_count: number }>())?.report_count ?? 0;
  const isHidden = reason === "child_safety" || reportCount >= PROFILE_HIDING_REPORT_COUNT;
  if (isHidden && owner.profile_check_status === "passed") {
    await database
      .prepare("UPDATE accounts SET profile_check_status = 'held', profile_held_reason = ? WHERE id = ? AND profile_check_status = 'passed'")
      .bind(`Reported: ${PROFILE_REPORT_REASONS[reason]}${reportCount > 1 ? ` (${reportCount} reports)` : ""}`, owner.id)
      .run();
  }
  return { is_hidden: isHidden };
}
