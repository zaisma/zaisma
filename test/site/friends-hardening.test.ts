import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FRIEND_REQUEST_LIMITS,
  MAXIMUM_FRIEND_COUNT,
  MAXIMUM_OPEN_FRIEND_INVITE_COUNT,
  acceptFriendInvite,
  accountById,
  answerFriendRequest,
  blockPlayer,
  createAccount,
  createFriendInvite,
  friendCountOf,
  friendInvitesOf,
  friendPlayerIdsOf,
  friendRequestRefusalFor,
  sendFriendRequest,
  stopSocial,
  unblockPlayer,
  waitingFriendRequestsTo,
  type Account,
  type AgeBand,
} from "@zaisma/core";

// Friends under a block, a social side turned off, requests sent at the same moment and a sender's pause
// (docs/DECISIONS.md, "Friend requests in games", "How friends work", "How blocks work").

const DAY_MS = 86400_000;
const NOW_MS = Date.UTC(2026, 9, 29, 12);

const make = (id: string, ageBand: AgeBand = "18+") => createAccount(env.DB, { id, username: `${id[0]!.toUpperCase()}${id.slice(1)}_Test`, ageBand, socialMode: ageBand === "13-15" ? "friends_focused" : "open_and_social" });
/** The account as a request reads it now, as the site loads it for each request. */
const fresh = async (id: string) => (await accountById(env.DB, id))!;

/** Gives an account this many friends, each a new account, both ways. */
async function giveFriends(accountId: string, friendCount: number): Promise<void> {
  for (let start = 0; start < friendCount; start += 25) {
    const ids = Array.from({ length: Math.min(25, friendCount - start) }, (_, index) => `${accountId}friend${start + index}`);
    await Promise.all(ids.map((id) => make(id)));
    await env.DB.batch(
      ids.flatMap((id) => [
        env.DB.prepare("INSERT INTO friendships (account_id, friend_account_id, created_at_ms) VALUES (?, ?, ?)").bind(accountId, id, NOW_MS),
        env.DB.prepare("INSERT INTO friendships (account_id, friend_account_id, created_at_ms) VALUES (?, ?, ?)").bind(id, accountId, NOW_MS),
      ]),
    );
  }
}

const requestRow = (senderId: string, recipientId: string) => env.DB.prepare("SELECT answer FROM friend_requests WHERE sender_account_id = ? AND recipient_account_id = ?").bind(senderId, recipientId).first<{ answer: string | null }>();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM friend_requests; DELETE FROM friendships; DELETE FROM friend_invites; DELETE FROM blocks; DELETE FROM room_players; DELETE FROM room_visits; DELETE FROM accounts;");
});

describe("a block and a request already waiting", () => {
  it("hides Add friend from a player the other blocked, even while the blocker's own request to them waits", async () => {
    const alex = await make("alex");
    const mia = await make("mia");
    expect(await sendFriendRequest(env.DB, alex, mia.player_id, null, NOW_MS)).toMatchObject({ status: "sent" });
    await blockPlayer(env.DB, "alex", mia.player_id, NOW_MS + 1000);
    expect(await friendRequestRefusalFor(env.DB, mia, alex.player_id, NOW_MS + 2000)).toBe("not_taking_requests");
  });

  it("answers a blocked player's request as Add friend would, never 'They have as many friends as Zaisma keeps'", async () => {
    const alex = await make("alex");
    const mia = await make("mia");
    await sendFriendRequest(env.DB, alex, mia.player_id, null, NOW_MS);
    await blockPlayer(env.DB, "alex", mia.player_id, NOW_MS + 1000);
    expect(await sendFriendRequest(env.DB, mia, alex.player_id, null, NOW_MS + 2000)).toEqual({ error: "not_taking_requests" });
  });

  it("answers a request back from a player whose social side is off as Add friend would", async () => {
    const alex = await make("alex");
    await make("mia");
    await sendFriendRequest(env.DB, alex, (await fresh("mia")).player_id, null, NOW_MS);
    await stopSocial(env.DB, "mia", "following_after_block", NOW_MS + 1000);
    const mia = await fresh("mia");
    expect(await friendRequestRefusalFor(env.DB, mia, alex.player_id, NOW_MS + 2000)).toBe("not_taking_requests");
    expect(await sendFriendRequest(env.DB, mia, alex.player_id, null, NOW_MS + 2000)).toEqual({ error: "not_taking_requests" });
  });

  it("keeps a request sent before a block from coming back when the block is undone", async () => {
    const alex = await make("alex");
    const mia = await make("mia");
    await sendFriendRequest(env.DB, alex, mia.player_id, null, NOW_MS);
    await blockPlayer(env.DB, "mia", alex.player_id, NOW_MS + 1000);
    await unblockPlayer(env.DB, "mia", alex.player_id);
    // "Unblocked. You're not friends again unless one of you sends an invite."
    expect(await waitingFriendRequestsTo(env.DB, "mia", NOW_MS + 2000)).toEqual([]);
    // To Alex it still looks waiting, as any turn-down does.
    expect(await requestRow("alex", "mia")).toEqual({ answer: "turned_down" });
    expect(await friendRequestRefusalFor(env.DB, alex, mia.player_id, NOW_MS + 2000)).toBe("already_sent");
  });

  it("deletes the blocker's own waiting request, so it never counts toward their pause", async () => {
    const alex = await make("alex");
    const mia = await make("mia");
    await sendFriendRequest(env.DB, alex, mia.player_id, null, NOW_MS);
    await blockPlayer(env.DB, "alex", mia.player_id, NOW_MS + 1000);
    expect(await requestRow("alex", "mia")).toBeNull();
  });
});

describe("limits under requests sent at the same moment", () => {
  it("never lets an account past 200 friends when two of its invites are used at once, and keeps the losing invite", async () => {
    await make("host");
    await giveFriends("host", MAXIMUM_FRIEND_COUNT - 1);
    const first = await createFriendInvite(env.DB, "host", NOW_MS);
    const second = await createFriendInvite(env.DB, "host", NOW_MS);
    if (!("invite" in first) || !("invite" in second)) throw new Error("no invites");
    await make("yuki");
    await make("omar");
    const answers = await Promise.all([acceptFriendInvite(env.DB, "yuki", first.invite.invite_code, NOW_MS + 1000), acceptFriendInvite(env.DB, "omar", second.invite.invite_code, NOW_MS + 1000)]);
    expect(await friendCountOf(env.DB, "host")).toBe(MAXIMUM_FRIEND_COUNT);
    expect(answers.filter((answer) => "friend" in answer)).toHaveLength(1);
    expect(answers.filter((answer) => "error" in answer)).toEqual([{ error: "inviter_has_too_many_friends" }]);
    expect(await friendInvitesOf(env.DB, "host", NOW_MS + 1000)).toHaveLength(1);
  });

  it("lets one person take an invite when two use the same link at once", async () => {
    await make("host");
    const made = await createFriendInvite(env.DB, "host", NOW_MS);
    if (!("invite" in made)) throw new Error("no invite");
    await make("yuki");
    await make("omar");
    const answers = await Promise.all([acceptFriendInvite(env.DB, "yuki", made.invite.invite_code, NOW_MS + 1000), acceptFriendInvite(env.DB, "omar", made.invite.invite_code, NOW_MS + 1000)]);
    expect(answers.filter((answer) => "friend" in answer)).toHaveLength(1);
    expect(answers.filter((answer) => "error" in answer)).toEqual([{ error: "invite_not_found" }]);
    expect(await friendCountOf(env.DB, "host")).toBe(1);
  });

  it("never lets an account past 200 friends when it accepts two requests at once, and leaves the losing one waiting", async () => {
    await make("host");
    await giveFriends("host", MAXIMUM_FRIEND_COUNT - 1);
    const yuki = await make("yuki");
    const omar = await make("omar");
    await env.DB.batch(
      ["yuki", "omar"].map((senderId) =>
        env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms) VALUES (?, 'host', ?, ?)").bind(senderId, NOW_MS, NOW_MS + 7 * DAY_MS),
      ),
    );
    const host = await fresh("host");
    const answers = await Promise.all([answerFriendRequest(env.DB, host, yuki.player_id, "accepted", NOW_MS + 1000), answerFriendRequest(env.DB, host, omar.player_id, "accepted", NOW_MS + 1000)]);
    expect(await friendCountOf(env.DB, "host")).toBe(MAXIMUM_FRIEND_COUNT);
    expect(answers).toContainEqual({ answer: "accepted" });
    expect(answers).toContainEqual({ error: "too_many_friends" });
    const { results } = await env.DB.prepare("SELECT sender_account_id, answer FROM friend_requests WHERE recipient_account_id = 'host' ORDER BY answer").all();
    expect(results.map((row) => row.answer).sort()).toEqual(["accepted", null].sort());
  });

  it("lets only one of two tabs accept the same request", async () => {
    const alex = await make("alex");
    await make("mia");
    await sendFriendRequest(env.DB, alex, (await fresh("mia")).player_id, null, NOW_MS);
    const mia = await fresh("mia");
    const answers = await Promise.all([answerFriendRequest(env.DB, mia, alex.player_id, "accepted", NOW_MS + 1000), answerFriendRequest(env.DB, mia, alex.player_id, "accepted", NOW_MS + 1000)]);
    expect(answers).toContainEqual({ answer: "accepted" });
    expect(answers).toContainEqual({ error: "request_not_found" });
    expect(await friendCountOf(env.DB, "mia")).toBe(1);
    expect(await friendCountOf(env.DB, "alex")).toBe(1);
  });

  it("keeps at most 10 invites waiting, even when they're made at the same moment", async () => {
    await make("host");
    const answers = await Promise.all(Array.from({ length: MAXIMUM_OPEN_FRIEND_INVITE_COUNT + 1 }, () => createFriendInvite(env.DB, "host", NOW_MS)));
    expect(await friendInvitesOf(env.DB, "host", NOW_MS)).toHaveLength(MAXIMUM_OPEN_FRIEND_INVITE_COUNT);
    expect(answers.filter((answer) => "error" in answer)).toEqual([{ error: "too_many_invites" }]);
  });

  it("sends at most 20 in a day from an adult, even when they go out at the same moment", async () => {
    const alex = await make("alex");
    const recipients = await Promise.all(Array.from({ length: FRIEND_REQUEST_LIMITS.dailyCount + 5 }, (_, index) => make(`stranger${index}`)));
    const answers = await Promise.all(recipients.map((recipient) => sendFriendRequest(env.DB, alex, recipient.player_id, null, NOW_MS)));
    expect(await env.DB.prepare("SELECT COUNT(*) AS request_count FROM friend_requests WHERE sender_account_id = 'alex'").first<number>("request_count")).toBe(FRIEND_REQUEST_LIMITS.dailyCount);
    expect(answers.filter((answer) => "error" in answer)).toEqual(Array(5).fill({ error: "too_many_friend_requests" }));
  });

  it("sends at most 10 in a day from a 13–15 account, even when they go out at the same moment", async () => {
    const noah = await make("noah", "13-15");
    const recipients: Account[] = [];
    for (let index = 0; index < FRIEND_REQUEST_LIMITS.teenDailyCount + 5; index++) recipients.push(await make(`classmate${index}`, "13-15"));
    // Everyone takes requests from players they play with, and they're all in one room.
    await env.DB.exec("UPDATE accounts SET who_can_send_friend_requests = 'played_with'");
    await env.DB.batch(
      [noah, ...recipients].map((account) => env.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES ('game_raid', 'RAID01', ?, ?, ?)").bind(account.player_id, NOW_MS, NOW_MS)),
    );
    await Promise.all(recipients.map((recipient) => sendFriendRequest(env.DB, noah, recipient.player_id, null, NOW_MS)));
    expect(await env.DB.prepare("SELECT COUNT(*) AS request_count FROM friend_requests WHERE sender_account_id = 'noah'").first<number>("request_count")).toBe(FRIEND_REQUEST_LIMITS.teenDailyCount);
  });

  it("lets a request to someone already asked today go out at the cap: it replaces the old one", async () => {
    const alex = await make("alex");
    const mia = await make("mia");
    // Mia accepted Alex's request this morning and they're no longer friends; Alex has sent 19 more since.
    await env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms, answer, answered_at_ms) VALUES ('alex', 'mia', ?, ?, 'accepted', ?)").bind(NOW_MS - 3_600_000, NOW_MS + 6 * DAY_MS, NOW_MS - 3_000_000).run();
    await env.DB.batch(
      Array.from({ length: FRIEND_REQUEST_LIMITS.dailyCount - 1 }, (_, index) =>
        env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms) VALUES ('alex', ?, ?, ?)").bind(`someone${index}`, NOW_MS - 60_000, NOW_MS + 6 * DAY_MS),
      ),
    );
    expect(await sendFriendRequest(env.DB, alex, mia.player_id, null, NOW_MS)).toEqual({ status: "sent", is_paused_now: false });
    expect(await sendFriendRequest(env.DB, alex, (await make("yuki")).player_id, null, NOW_MS)).toEqual({ error: "too_many_friend_requests" });
  });

  it("puts at most 200 friends in a pass", async () => {
    await make("host");
    await giveFriends("host", MAXIMUM_FRIEND_COUNT + 5);
    expect(await friendPlayerIdsOf(env.DB, "host")).toHaveLength(MAXIMUM_FRIEND_COUNT);
  });
});

describe("the pause on a sender whose requests are mostly turned down", () => {
  /** Requests Sam sent at sentAtMs that the people they reached turned down. */
  async function turnedDown(count: number, sentAtMs: number, label: string): Promise<void> {
    await env.DB.batch(
      Array.from({ length: count }, (_, index) =>
        env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms, answer, answered_at_ms) VALUES ('sam', ?, ?, ?, 'turned_down', ?)").bind(
          `${label}${index}`,
          sentAtMs,
          sentAtMs + FRIEND_REQUEST_LIMITS.durationDays * DAY_MS,
          sentAtMs + 60_000,
        ),
      ),
    );
  }

  it("ends after its week with a fresh record: the refusals that started it and the requests held during it don't count", async () => {
    await make("sam");
    // Ten requests Sam sent 5 days ago, all turned down: well inside the 30 days the pause looks back over.
    await turnedDown(FRIEND_REQUEST_LIMITS.pauseMinimumCount, NOW_MS - 5 * DAY_MS, "old");
    expect(await sendFriendRequest(env.DB, await fresh("sam"), (await make("first")).player_id, null, NOW_MS)).toEqual({ status: "sent", is_paused_now: true });
    // During the week Sam sends ten more, which go nowhere.
    for (let index = 0; index < 10; index++) {
      expect(await sendFriendRequest(env.DB, await fresh("sam"), (await make(`during${index}`)).player_id, null, NOW_MS + 2 * DAY_MS + index * 60_000)).toEqual({ status: "sent", is_paused_now: false });
    }
    expect(await waitingFriendRequestsTo(env.DB, "during0", NOW_MS + 2 * DAY_MS)).toEqual([]);
    // Eight days on the week is over, though the real refusals are still inside 30 days: the record starts fresh.
    const laterMs = NOW_MS + 8 * DAY_MS;
    await make("fresh");
    expect(await sendFriendRequest(env.DB, await fresh("sam"), (await fresh("fresh")).player_id, null, laterMs)).toEqual({ status: "sent", is_paused_now: false });
    expect(await waitingFriendRequestsTo(env.DB, "fresh", laterMs)).toHaveLength(1);
  });

  it("pauses again only on new refusals after the pause ended", async () => {
    await make("sam");
    const pausedUntilMs = NOW_MS - DAY_MS;
    await env.DB.prepare("UPDATE accounts SET friend_requests_paused_until_ms = ? WHERE id = 'sam'").bind(pausedUntilMs).run();
    await turnedDown(FRIEND_REQUEST_LIMITS.pauseMinimumCount, pausedUntilMs - 3 * DAY_MS, "before");
    await turnedDown(FRIEND_REQUEST_LIMITS.pauseMinimumCount - 1, pausedUntilMs + 3_600_000, "after");
    expect(await sendFriendRequest(env.DB, await fresh("sam"), (await make("one")).player_id, null, NOW_MS)).toEqual({ status: "sent", is_paused_now: false });
    await turnedDown(1, pausedUntilMs + 7_200_000, "last");
    expect(await sendFriendRequest(env.DB, await fresh("sam"), (await make("two")).player_id, null, NOW_MS)).toEqual({ status: "sent", is_paused_now: true });
  });
});
