import { canonicalSave, iso, linkUrlsOf, readStoredSave, saveContentsJson, saveCopyKey, saveHash, type Account } from "@zaisma/core";
import { authUserRecord, realEmail } from "./auth.ts";
import type { Env } from "./env.ts";
import { storedSaveText } from "./saves.ts";
import { zipStream, type ZipSource } from "./zip-writer.ts";

/**
 * Download your data (docs/DECISIONS.md, "Players download everything Zaisma keeps about them"): everything
 * Zaisma keeps about an account as one .zip from the account page, written while it downloads, so nothing is
 * stored. The account page checks Confirm it's you and the limit, and logs it; this builds the files.
 *
 * Every table that holds an account's rows is in ACCOUNT_DATA_TABLES, sent or left out with the reason, and
 * test/site/accounts.test.ts fails when a migration adds one that isn't, so a new kind of data can't be missed.
 */

/** Every table with a column that names an account (by its id, player ID or owner), and what the download does with it. */
export const ACCOUNT_DATA_TABLES: Record<string, { file_path: string | null; reason: string }> = {
  accounts: { file_path: "account.json", reason: "The account's details and settings." },
  passkeys: { file_path: "signing-in.json", reason: "Passkeys: their device name and dates." },
  sign_in_grants: { file_path: "signing-in.json", reason: "Sites signed in to with Zaisma." },
  device_marks: { file_path: "signing-in.json", reason: "Devices signed in on, by date: the device ID itself is a fingerprint nobody can read back." },
  sign_in_networks: { file_path: "signing-in.json", reason: "Networks signed in from, by date: the network is kept as a fingerprint." },
  wrong_passwords: { file_path: "signing-in.json", reason: "When a wrong password was typed." },
  security_events: { file_path: "activity.json", reason: "The Activity list, and what the account did to its games." },
  friendships: { file_path: "friends.json", reason: "Friends, by username." },
  friend_invites: { file_path: "friends.json", reason: "Open friend invites." },
  blocks: { file_path: "friends.json", reason: "Blocks this account made; never who blocked it." },
  friend_requests: { file_path: "friends.json", reason: "Friend requests sent, and the ones sent to you with your answers; never how others answered yours." },
  room_visits: { file_path: "games-played.json", reason: "Rooms the account left in the last hour, for People I play with." },
  played: { file_path: "games-played.json", reason: "Continue playing." },
  games_ever_played: { file_path: "games-played.json", reason: "Every game played, kept so it can be told when the account is deleted." },
  game_returning_players: { file_path: "games-played.json", reason: "The games whose plays counted, and on how many different days, toward their developers' standing." },
  presences: { file_path: "games-played.json", reason: "When the account was last seen online, and in which game." },
  room_players: { file_path: "games-played.json", reason: "The rooms the account is in right now." },
  purchases: { file_path: "games-played.json", reason: "Items bought or granted in games, with what was paid." },
  saves: { file_path: "saves/", reason: "Game saves, as files." },
  saved_payment_methods: { file_path: "games-played.json", reason: "The card saved for buying in games: its brand, last digits and receipt email." },
  save_history: { file_path: "saves/", reason: "Earlier versions of each save, as files." },
  forum_topics: { file_path: "forum.json", reason: "Forum topics started." },
  forum_posts: { file_path: "forum.json", reason: "Forum posts." },
  forum_votes: { file_path: "forum.json", reason: "Forum votes." },
  forum_follows: { file_path: "forum.json", reason: "Forum topics followed." },
  forum_post_ratings: { file_path: "forum.json", reason: "Posts you liked or disliked." },
  forum_bookmarks: { file_path: "forum.json", reason: "Posts you bookmarked." },
  forum_misplaced_flags: { file_path: "forum.json", reason: "Topics flagged as in the wrong place." },
  forum_reports: { file_path: "forum.json", reason: "Forum posts reported." },
  forum_media: { file_path: "forum-images/", reason: "Images posted in the forum, as files." },
  profile_reports: { file_path: "reports.json", reason: "Profiles this account reported; never reports about it." },
  owners: { file_path: "developer.json", reason: "What the account owns as a developer." },
  games: { file_path: "developer.json", reason: "Games made, each with its own Export everything link." },
  api_keys: { file_path: "developer.json", reason: "API keys and connected AIs and apps, never their secrets." },
  webhooks: { file_path: "developer.json", reason: "Webhooks, never their signing secrets." },
  sign_in_apps: { file_path: "developer.json", reason: "Sign-in apps, never their secrets." },
  credit_entries: { file_path: "developer.json", reason: "Hosting credit: every top-up, charge and refund." },
  owner_cards: { file_path: "developer.json", reason: "The cards that paid Zaisma, as fingerprints nobody can read back, with when each first paid." },
  spending_requests: { file_path: "developer.json", reason: "Raises in spending an AI asked for, and how you answered." },
  webhook_deliveries: { file_path: null, reason: "Copies of events about the developer's games, kept 30 days and listed through the API." },
  performance_checks: { file_path: null, reason: "How each of the developer's versions started in Chrome, in the API with each version." },
  owned_blobs: { file_path: null, reason: "Storage bookkeeping: which uploaded files a developer's games share." },
  blob_owners: { file_path: null, reason: "Storage bookkeeping: which uploaded files a developer's games share." },
  reports: { file_path: null, reason: "Reports about the player, written by other players." },
  forum_mentions: { file_path: null, reason: "Other people's posts that mention the player." },
  chat_reviews: { file_path: null, reason: "A safety record: messages the chat filter stopped." },
  sign_in_codes: { file_path: null, reason: "One-time codes, kept as fingerprints for minutes." },
  email_codes: { file_path: null, reason: "One-time codes, kept as fingerprints for minutes." },
  passkey_challenges: { file_path: null, reason: "One-time passkey challenges, kept as fingerprints for minutes." },
  connected_app_codes: { file_path: null, reason: "One-time codes, kept as fingerprints for minutes." },
  session_proofs: { file_path: null, reason: "How each signed-in session last proved it's the owner, kept a day." },
  purchase_confirmations: { file_path: null, reason: "When each signed-in session last confirmed a buy, kept a day." },
  stripe_connect_states: { file_path: null, reason: "One-time links to connect a Stripe account, kept for minutes." },
  security_places: { file_path: null, reason: "Fingerprints of where API keys were used, never readable back." },
  room_keys: { file_path: null, reason: "Counts of room passes, kept a day." },
  player_erases: { file_path: null, reason: "Only exists once an account is deleted." },
  banned_marks: { file_path: null, reason: "A safety record: what a ban carries to new accounts, as fingerprints nobody can read back." },
  ban_matches: { file_path: null, reason: "A safety record: another account that used a banned card, for a person to decide." },
};

/** Columns of accounts kept out of account.json: safety records and their counters. */
export const ACCOUNT_COLUMNS_LEFT_OUT: Record<string, string> = {
  profile_held_reason: "A safety record: why the profile check held it.",
  profile_check_attempt_count: "How many times the profile check ran.",
  chat_stopped_reason: "A safety record: why chat is paused.",
  chat_stopped_until_ms: "A safety record: until when chat is paused.",
  chat_repeat_block_count: "The chat filter's counter.",
  chat_repeat_window_started_at_ms: "The chat filter's counter.",
  purchase_pin_hash: "A fingerprint of the purchase PIN, never readable back.",
  purchase_pin_failed_count: "The purchase PIN's counter of wrong tries.",
  stripe_customer_id: "Zaisma's reference at Stripe for the saved card.",
  friend_requests_paused_until_ms: "A safety record: until when friend requests go nowhere.",
};

const encoder = new TextEncoder();
const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/** The same files the game page's saves are made of, read a few ahead so the download doesn't wait on each. */
const FILES_AHEAD_COUNT = 4;

type Row = Record<string, unknown>;

/** A row as the API would say it: times as ISO dates (`*_at`), yes/no columns as true or false. */
function rowJson(row: Row): Row {
  const out: Row = {};
  for (const [name, cell] of Object.entries(row)) {
    if (name.endsWith("_at_ms") || name.endsWith("_until_ms")) out[name.slice(0, -3)] = typeof cell === "number" ? iso(cell) : null;
    else if (/^(is|has|can)_|_enabled$/.test(name) && (cell === 0 || cell === 1)) out[name] = cell === 1;
    else out[name] = cell;
  }
  return out;
}

async function rows(env: Env, sql: string, ...values: unknown[]): Promise<Row[]> {
  return (await env.DB.prepare(sql).bind(...values).all<Row>()).results.map(rowJson);
}

/** The .zip of everything about this account, streamed. */
export function accountDataZip(env: Env, account: Account, nowMs = Date.now()): ReadableStream<Uint8Array> {
  return zipStream(accountDataSources(env, account, nowMs));
}

export const accountDataFileName = (account: Account, nowMs: number) => `zaisma-${account.username}-${new Date(nowMs).toISOString().slice(0, 10)}.zip`;

async function* accountDataSources(env: Env, account: Account, nowMs: number): AsyncGenerator<ZipSource> {
  const id = account.id;
  const file = (path: string, bytes: Uint8Array | ReadableStream<Uint8Array>, modifiedAtMs = nowMs): ZipSource => ({ path, bytes, modifiedAtMs });
  const jsonFile = (path: string, contents: unknown) => file(path, encoder.encode(`${JSON.stringify(contents, null, 2)}\n`));
  const missing: string[] = [];

  yield file("README.txt", encoder.encode(readme(account, nowMs)));

  // --- account.json: the account row, and what Supabase keeps for signing in ---
  const accountRow = (await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<Row>()) ?? {};
  for (const column of Object.keys(ACCOUNT_COLUMNS_LEFT_OUT)) delete accountRow[column];
  const shown = rowJson(accountRow);
  shown.link_urls = linkUrlsOf({ link_urls: String(accountRow.link_urls ?? "") });
  const signIn = await authUserRecord(env, id);
  if (!signIn) missing.push("account.json: your email and how you sign in with Google or Discord (our sign-in provider didn't answer)");
  yield jsonFile("account.json", {
    downloaded_at: iso(nowMs),
    account: shown,
    email: signIn ? realEmail(signIn.email ?? "") : null,
    signed_up_at: signIn?.created_at ?? null,
    last_signed_in_at: signIn?.last_sign_in_at ?? null,
    // Google and Discord give a name and picture; the email "identity" is the password and code sign-in.
    sign_in_providers: (signIn?.identities ?? [])
      .filter((identity) => identity.provider !== "email")
      .map((identity) => ({
        provider: identity.provider,
        name: identity.identity_data?.full_name ?? identity.identity_data?.name ?? null,
        email: identity.identity_data?.email ?? null,
        picture_url: identity.identity_data?.avatar_url ?? identity.identity_data?.picture ?? null,
        added_at: identity.created_at ?? null,
        last_signed_in_at: identity.last_sign_in_at ?? null,
      })),
  });

  yield jsonFile("signing-in.json", {
    passkeys: await rows(env, "SELECT id, name, created_at_ms, last_used_at_ms, approves_from_at_ms FROM passkeys WHERE account_id = ? ORDER BY created_at_ms", id),
    sites_signed_in_to: await rows(
      env,
      "SELECT app.name, app.redirect_urls, grant_row.created_at_ms, grant_row.last_used_at_ms FROM sign_in_grants grant_row JOIN sign_in_apps app ON app.id = grant_row.sign_in_app_id WHERE grant_row.account_id = ? ORDER BY grant_row.created_at_ms",
      id,
    ),
    devices_signed_in_on: await rows(env, "SELECT signed_in_at_ms FROM device_marks WHERE account_id = ? ORDER BY signed_in_at_ms", id),
    networks_signed_in_from: await rows(env, "SELECT first_seen_at_ms, last_seen_at_ms FROM sign_in_networks WHERE account_id = ? ORDER BY first_seen_at_ms", id),
    wrong_passwords: await rows(env, "SELECT tried_at_ms FROM wrong_passwords WHERE account_id = ? ORDER BY tried_at_ms", id),
  });

  yield jsonFile("activity.json", {
    events: await rows(
      env,
      `SELECT event.kind, event.done_by, event.sign_in_kind, event.subject_name, event.api_key_name, game.slug AS game_slug, event.version_id, event.device, event.network_name,
        event.city_name, event.region_name, event.country_code, event.connection_address, event.is_new_place, event.occurrence_count, event.happened_at_ms, event.last_happened_at_ms, event.security_alert_status
       FROM security_events event LEFT JOIN games game ON game.id = event.game_id WHERE event.account_id = ? ORDER BY event.happened_at_ms`,
      id,
    ),
  });

  yield jsonFile("friends.json", {
    friends: await rows(env, "SELECT friend.username, friend.player_id, friendship.created_at_ms FROM friendships friendship JOIN accounts friend ON friend.id = friendship.friend_account_id WHERE friendship.account_id = ? ORDER BY friendship.created_at_ms", id),
    friend_invites: await rows(env, "SELECT invite_code, created_at_ms, expires_at_ms FROM friend_invites WHERE account_id = ? ORDER BY created_at_ms", id),
    blocks: await rows(env, "SELECT blocked.username, block.created_at_ms FROM blocks block JOIN accounts blocked ON blocked.id = block.blocked_account_id WHERE block.account_id = ? ORDER BY block.created_at_ms", id),
    // Never how the other player answered: a turn-down looks like nothing happened to its sender.
    friend_requests_sent: await rows(env, "SELECT recipient.username, request.created_at_ms, request.expires_at_ms FROM friend_requests request JOIN accounts recipient ON recipient.id = request.recipient_account_id WHERE request.sender_account_id = ? ORDER BY request.created_at_ms", id),
    friend_requests_received: await rows(env, "SELECT sender.username, request.created_at_ms, request.expires_at_ms, request.answer, request.answered_at_ms FROM friend_requests request JOIN accounts sender ON sender.id = request.sender_account_id WHERE request.recipient_account_id = ? ORDER BY request.created_at_ms", id),
  });

  yield jsonFile("games-played.json", {
    continue_playing: await rows(env, "SELECT game.slug AS game_slug, game.title, played.played_at_ms FROM played JOIN games game ON game.id = played.game_id WHERE played.account_id = ? ORDER BY played.played_at_ms DESC", id),
    games_ever_played: await rows(env, "SELECT game.slug AS game_slug, game.title, ever.first_played_at_ms FROM games_ever_played ever JOIN games game ON game.id = ever.game_id WHERE ever.account_id = ? ORDER BY ever.first_played_at_ms", id),
    counted_plays: await rows(env, "SELECT game.slug AS game_slug, game.title, returning.first_counted_date, returning.last_counted_date, returning.counted_day_count FROM game_returning_players returning JOIN games game ON game.id = returning.game_id WHERE returning.account_id = ? ORDER BY returning.first_counted_date", id),
    last_seen: (await rows(env, "SELECT presence.seen_at_ms, game.slug AS game_slug, presence.game_seen_at_ms FROM presences presence LEFT JOIN games game ON game.id = presence.game_id WHERE presence.account_id = ?", id))[0] ?? null,
    rooms_now: await rows(env, "SELECT game.slug AS game_slug, room.room_code, room.server_url, room.joined_at_ms, room.updated_at_ms FROM room_players room JOIN games game ON game.id = room.game_id WHERE room.player_id = ?", account.player_id),
    rooms_left_lately: await rows(env, "SELECT game.slug AS game_slug, visit.room_code, visit.server_url, visit.last_seen_at_ms FROM room_visits visit JOIN games game ON game.id = visit.game_id WHERE visit.player_id = ?", account.player_id),
    purchases: await rows(
      env,
      "SELECT COALESCE(game.slug, purchase.deleted_game_slug) AS game_slug, COALESCE(game.title, purchase.deleted_game_title) AS game_title, purchase.id, purchase.item_name, purchase.item_kind, purchase.item_count, purchase.purchase_source, purchase.purchase_status, purchase.paid_minor_units, purchase.currency_code, purchase.refunded_minor_units, purchase.receipt_email, purchase.purchased_at_ms, purchase.refunded_at_ms FROM purchases purchase LEFT JOIN games game ON game.id = purchase.game_id WHERE purchase.player_id = ? ORDER BY purchase.created_at_ms",
      account.player_id,
    ),
    saved_card: (await rows(env, "SELECT card_brand, card_last_digits, created_at_ms FROM saved_payment_methods WHERE account_id = ?", id))[0] ?? null,
  });

  // --- saves/<game>/: each save and its earlier versions, in the shape the save API answers (as v1, read without writing back) ---
  const saves = await env.DB.prepare("SELECT save.*, game.slug FROM saves save JOIN games game ON game.id = save.game_id WHERE save.account_id = ? ORDER BY game.slug").bind(id).all<{ game_id: string; slug: string; version_number: number; sha256: string; size_bytes: number; saved_at_ms: number; changed_by_kind: string }>();
  const copies = await env.DB.prepare("SELECT id, game_id, saved_at_ms, copy_reason, sha256, size_bytes FROM save_history WHERE account_id = ? ORDER BY saved_at_ms").bind(id).all<{ id: string; game_id: string; saved_at_ms: number; copy_reason: string; sha256: string; size_bytes: number }>();
  for (const save of saves.results) {
    const folder = `saves/${save.slug}`;
    const text = await storedSaveText(env, { account_id: id, game_id: save.game_id, version_number: save.version_number, sha256: save.sha256 });
    if (text === null) missing.push(`${folder}/save.json`);
    else {
      // Hash and size are of the v1 text the contents are written as, whatever shape the stored one is in.
      const v1Text = canonicalSave(readStoredSave(text));
      yield jsonFile(`${folder}/save.json`, { game_slug: save.slug, sha256: await saveHash(v1Text), size_bytes: encoder.encode(v1Text).byteLength, saved_at: iso(save.saved_at_ms), changed_by_kind: save.changed_by_kind, ...saveContentsJson(readStoredSave(v1Text), null) });
    }
    for (const copy of copies.results.filter((candidate) => candidate.game_id === save.game_id)) {
      const path = `${folder}/earlier/${new Date(copy.saved_at_ms).toISOString().replace(/:/g, "-")}.json`;
      const copyText = await (await env.SAVES.get(saveCopyKey(id, copy.game_id, copy.id)))?.text();
      if (copyText === undefined) missing.push(path);
      else {
        const v1Text = canonicalSave(readStoredSave(copyText));
        yield jsonFile(path, { game_slug: save.slug, saved_at: iso(copy.saved_at_ms), copy_reason: copy.copy_reason, sha256: await saveHash(v1Text), size_bytes: encoder.encode(v1Text).byteLength, ...saveContentsJson(readStoredSave(v1Text), null) });
      }
    }
  }

  // --- forum.json and forum-images/ ---
  const media = await env.DB.prepare("SELECT id, post_id, content_type, storage_key, created_at_ms FROM forum_media WHERE account_id = ? ORDER BY created_at_ms").bind(id).all<{ id: string; post_id: string | null; content_type: string; storage_key: string; created_at_ms: number }>();
  const imagePath = (image: { id: string; content_type: string }) => `forum-images/${image.id}.${IMAGE_EXTENSIONS[image.content_type] ?? "bin"}`;
  yield jsonFile("forum.json", {
    topics: await rows(env, "SELECT id, kind, title, category, topic_status, is_public, vote_count, reply_count, created_at_ms, updated_at_ms FROM forum_topics WHERE account_id = ? ORDER BY created_at_ms", id),
    posts: await rows(env, "SELECT id, topic_id, reply_to_post_id, kind, author_kind, posted_via, text_markdown, debug_context, check_status, like_count, dislike_count, created_at_ms FROM forum_posts WHERE account_id = ? ORDER BY created_at_ms", id),
    images: media.results.map((image) => ({ id: image.id, post_id: image.post_id, content_type: image.content_type, file_path: imagePath(image), created_at: iso(image.created_at_ms) })),
    votes: await rows(env, "SELECT topic_id, created_at_ms FROM forum_votes WHERE account_id = ? ORDER BY created_at_ms", id),
    follows: await rows(env, "SELECT topic_id, seen_at_ms FROM forum_follows WHERE account_id = ?", id),
    post_ratings: await rows(env, "SELECT post_id, rating, rated_via, created_at_ms FROM forum_post_ratings WHERE account_id = ? ORDER BY created_at_ms", id),
    bookmarks: await rows(env, "SELECT post_id, created_at_ms FROM forum_bookmarks WHERE account_id = ? ORDER BY created_at_ms", id),
    misplaced_flags: await rows(env, "SELECT topic_id, created_at_ms FROM forum_misplaced_flags WHERE account_id = ? ORDER BY created_at_ms", id),
    reports_made: await rows(env, "SELECT post_id, reason, details, created_at_ms FROM forum_reports WHERE account_id = ? ORDER BY created_at_ms", id),
  });
  const ahead: Promise<R2ObjectBody | null>[] = [];
  for (let i = 0; i < media.results.length; i++) {
    while (ahead.length < FILES_AHEAD_COUNT && i + ahead.length < media.results.length) ahead.push(env.GAMES.get(media.results[i + ahead.length]!.storage_key));
    const object = await ahead.shift()!;
    const image = media.results[i]!;
    if (object) yield file(imagePath(image), object.body, image.created_at_ms);
    else missing.push(imagePath(image));
  }

  yield jsonFile("reports.json", {
    profiles_reported: await rows(env, "SELECT reported.username, report.reason, report.details, report.created_at_ms FROM profile_reports report LEFT JOIN accounts reported ON reported.id = report.account_id WHERE report.reporter_account_id = ? ORDER BY report.created_at_ms", id),
  });

  const ownerIds = (await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(id).all<{ id: string }>()).results.map((owner) => owner.id);
  const owned = (table: string, columns: string) => (ownerIds.length ? rows(env, `SELECT ${columns} FROM ${table} WHERE owner_id IN (${ownerIds.map(() => "?").join(", ")}) ORDER BY created_at_ms`, ...ownerIds) : Promise.resolve([]));
  const games = await owned("games", "slug, title, review_status, visibility, created_at_ms");
  yield jsonFile("developer.json", {
    games: games.map((game) => ({ ...game, export_url: `${env.SITE_ORIGIN}/dashboard/${game.slug}/export.zip` })),
    api_keys: await rows(
      env,
      `SELECT name, kind, access_level, area_access, game_slugs, connected_app_host, created_at_ms, last_used_at_ms, mcp_first_used_at_ms, ends_at_ms, turned_off_at_ms, found_in, found_at_url,
        last_used_device, last_used_network_name, last_used_city_name, last_used_region_name, last_used_country_code FROM api_keys WHERE account_id = ? ORDER BY created_at_ms`,
      id,
    ),
    webhooks: await owned("webhooks", "id, destination_kind, endpoint_url, event_kinds, game_slugs, created_at_ms, updated_at_ms"),
    sign_in_apps: await owned("sign_in_apps", "id, name, kind, redirect_urls, created_at_ms, updated_at_ms"),
    credit_entries: await owned("credit_entries", "id, entry_kind, amount_cents, game_id, refundable_until_ms, refunded_cents, created_at_ms"),
    owner_cards: ownerIds.length ? await rows(env, `SELECT card_fingerprint_sha256, first_paid_at_ms FROM owner_cards WHERE owner_id IN (${ownerIds.map(() => "?").join(", ")}) ORDER BY first_paid_at_ms`, ...ownerIds) : [],
    spending_requests: await rows(env, "SELECT id, request_kind, game_id, monthly_budget_cents, request_status, created_at_ms, expires_at_ms, answered_at_ms FROM spending_requests WHERE account_id = ? ORDER BY created_at_ms", id),
  });

  if (missing.length) {
    yield file("MISSING.txt", encoder.encode(`These couldn't be read just now, so they aren't in this download. Download it again in a few minutes, or email privacy@zaisma.com with this list:\n\n${missing.join("\n")}\n`));
  }
}

function readme(account: Account, nowMs: number): string {
  return `Everything Zaisma keeps about the account @${account.username}, downloaded ${iso(nowMs)}.

account.json         Your details and settings: username, name, bio, links, age group (and birth date while you're under 18),
                     social settings, and your email and Google or Discord sign-in, as our sign-in provider keeps them.
signing-in.json      Your passkeys, the sites you signed in to with Zaisma, when you signed in on each device and network,
                     and when a wrong password was typed for your account.
activity.json        Your account's Activity: sign-ins on new devices, changes to how you sign in and to your API keys,
                     and what you did to your games, with where it came from when you keep that.
friends.json         Your friends, your open friend invites and the players you blocked.
games-played.json    Continue playing, every game you've played, when you were last online, and any room you're in now.
saves/               Your game saves, one folder per game: save.json is the save, and earlier/ holds its earlier versions.
                     local_storage_items is the game's localStorage, and indexeddb_databases its IndexedDB.
forum.json           Your forum topics, posts, votes, follows and the posts you reported.
forum-images/        The images you posted in the forum.
reports.json         The profiles you reported.
developer.json       If you make games: your games (each with a link to export everything about it), API keys,
                     webhooks and sign-in apps. Secrets are never included.
MISSING.txt          Only there when something couldn't be read just now.

Times are in UTC.

Not in this download:
- What other people wrote about you: reports about you, who blocked you, and posts that mention you.
- Safety records: messages the chat filter stopped, and why a profile check held your profile or chat is paused.
- Fingerprints and one-time codes we can't read back, like the random ID of each device you signed in on.
- What games keep in their own databases. Those are the developer's records: ask the game's developer, and give
  them your player ID, ${account.player_id}.

Questions: privacy@zaisma.com
`;
}
