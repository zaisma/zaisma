import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, currentMonth, deleteAccount, newId, type ChatReview } from "@zaisma/core";
import { checkUnclearChat, type ChatCheckDeps } from "../../apps/site/src/chat-check.ts";
import { CHAT_REVIEW_ALERT, reviewChatMessages, type ChatReviewAnswer, type ChatReviewDeps } from "../../apps/site/src/chat-review.ts";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import type { Env } from "../../apps/site/src/env.ts";

const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" } as unknown as Env;
const YEAR_MS = 31_536_000_000;

/** The review AI, answering as told for each message. */
const reviewer = (verdicts: Record<string, ChatReviewAnswer["verdict"]>): ChatReviewDeps & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, ai: async (_key, model, review) => (asked.push(`${model}: ${review.text}`), { verdict: verdicts[review.text] ?? "unsure", reason: `Read as ${verdicts[review.text] ?? "unsure"}.`, inputTokenCount: 50, outputTokenCount: 10 }) };
};

let accountNumber = 0;
/** An adult whose message to a teen the filter kept, with the sender paused as the rooms Worker leaves them. */
async function keptMessage(text: string, source: "rooms" | "own_server" = "rooms") {
  const sender = await createAccount(env.DB, { id: `chat-review-${++accountNumber}`, username: `chat_review_${accountNumber}`, ageBand: "18+" });
  const id = newId("chat_review");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO chat_reviews (id, sender_account_id, game_id, source, text, recent_texts_json, created_at_ms) VALUES (?, ?, 'game_chatreview', ?, ?, '[\"hey\"]', ?)").bind(id, sender.id, source, text, Date.now()),
    env.DB.prepare(`UPDATE accounts SET chat_stopped_reason = ${source === "rooms" ? "'in_review'" : "NULL"} WHERE id = ?`).bind(sender.id),
  ]);
  return { id, senderId: sender.id };
}
const reviewOf = (id: string) => env.DB.prepare("SELECT * FROM chat_reviews WHERE id = ?").bind(id).first<ChatReview>();
const stoppedReasonOf = async (accountId: string) => (await env.DB.prepare("SELECT chat_stopped_reason FROM accounts WHERE id = ?").bind(accountId).first<{ chat_stopped_reason: string | null }>())!.chat_stopped_reason;

describe("chat reviews", () => {
  let alerts: string[];
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM chat_reviews; DELETE FROM ai_usage;");
    alerts = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void alerts.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());

  it("deletes a false alarm and lifts the pause; removes chat for a confirmed one from rooms, keeps it a year and alerts", async () => {
    const falseAlarm = await keptMessage("nice cock-up there");
    const confirmed = await keptMessage("u home alone? send pics");
    const ai = reviewer({ "nice cock-up there": "false_alarm", "u home alone? send pics": "sexual_toward_minor" });
    expect(await reviewChatMessages(testEnv, ai)).toBe(2);
    expect(ai.asked).toEqual(["claude-opus-5-5: nice cock-up there", "claude-opus-5-5: u home alone? send pics"]);

    expect(await reviewOf(falseAlarm.id)).toBeNull();
    expect(await stoppedReasonOf(falseAlarm.senderId)).toBeNull();

    const kept = (await reviewOf(confirmed.id))!;
    expect(kept).toMatchObject({ chat_review_status: "confirmed", ai_reason: "Read as sexual_toward_minor.", reported_at_ms: null });
    expect(kept.kept_until_ms! - kept.decided_at_ms!).toBe(YEAR_MS);
    expect(await stoppedReasonOf(confirmed.senderId)).toBe("removed");
    expect(alerts).toEqual([`[alert] ${CHAT_REVIEW_ALERT}`]);
    // Usage counts toward chat's own budget, not the shared one.
    expect(await env.DB.prepare("SELECT input_token_count, chat_input_token_count, chat_call_count FROM ai_usage WHERE month = ?").bind(currentMonth()).first()).toEqual({ input_token_count: 0, chat_input_token_count: 100, chat_call_count: 2 });
  });

  it("leaves own servers' messages and unsure ones to a person", async () => {
    const ownServer = await keptMessage("send nudes", "own_server");
    const unsure = await keptMessage("ur cute");
    expect(await reviewChatMessages(testEnv, reviewer({ "send nudes": "sexual_toward_minor" }))).toBe(2);
    expect(await reviewOf(ownServer.id)).toMatchObject({ chat_review_status: "needs_person", kept_until_ms: null });
    expect(await stoppedReasonOf(ownServer.senderId)).toBeNull();
    expect(await reviewOf(unsure.id)).toMatchObject({ chat_review_status: "needs_person" });
    expect(await stoppedReasonOf(unsure.senderId)).toBe("in_review");
    expect(alerts).toEqual([`[alert] ${CHAT_REVIEW_ALERT}`, "[alert] A chat message needs you"]);

    // The admin page's buttons decide them.
    const page = await SELF.fetch("http://localhost/admin/chat-reviews").then((response) => response.text());
    expect(page).toContain("send nudes");
    expect(page).toContain("From a developer&#39;s own server: you decide");
    await SELF.fetch(`http://localhost/admin/chat-reviews/${ownServer.id}/reported`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(await reviewOf(ownServer.id)).toMatchObject({ chat_review_status: "confirmed" });
    expect((await reviewOf(ownServer.id))!.reported_at_ms).toBeGreaterThan(0);
    expect(await stoppedReasonOf(ownServer.senderId)).toBe("removed");
    await SELF.fetch(`http://localhost/admin/chat-reviews/${unsure.id}/false-alarm`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(await reviewOf(unsure.id)).toBeNull();
    expect(await stoppedReasonOf(unsure.senderId)).toBeNull();
  });

  it("waits with no AI key, and the daily clean-up deletes what's past its year", async () => {
    const waiting = await keptMessage("u alone?");
    expect(await reviewChatMessages({ ...testEnv, ANTHROPIC_API_KEY: "" }, reviewer({}))).toBe(0);
    expect(await reviewOf(waiting.id)).toMatchObject({ chat_review_status: "pending", check_attempt_count: 0 });
    expect(await stoppedReasonOf(waiting.senderId)).toBe("in_review");

    const old = await keptMessage("old one");
    await env.DB.prepare("UPDATE chat_reviews SET chat_review_status = 'confirmed', kept_until_ms = ? WHERE id = ?").bind(Date.now() - 1, old.id).run();
    await dailyCleanup(testEnv);
    expect(await reviewOf(old.id)).toBeNull();
    expect(await reviewOf(waiting.id)).not.toBeNull();
  });

  it("deletes an account's kept messages with it, except confirmed ones, which stay nameless for the report", async () => {
    const pending = await keptMessage("u alone?");
    const confirmed = await keptMessage("send pics");
    await env.DB.prepare("UPDATE chat_reviews SET sender_account_id = ?, chat_review_status = 'confirmed', kept_until_ms = ? WHERE id = ?").bind(pending.senderId, Date.now() + YEAR_MS, confirmed.id).run();
    await deleteAccount(env.DB, pending.senderId);
    expect(await reviewOf(pending.id)).toBeNull();
    expect(await reviewOf(confirmed.id)).toMatchObject({ chat_review_status: "confirmed", sender_account_id: null });
  });

  it("checks unclear chat within chat's own budget, telling Julius once a month when it's used up", async () => {
    const ai: ChatCheckDeps = { ai: async (_key, _model, text) => ({ verdict: text.includes("sn4p") ? "blocked" : "allowed", reason: text.includes("sn4p") ? "contact_details" : null, inputTokenCount: 600, outputTokenCount: 5 }) };
    const given = (text: string) => ({ text, recentTexts: [], isAdultToMinor: false });
    expect(await checkUnclearChat(testEnv, given("where r u"), ai)).toEqual({ verdict: "allowed" });
    expect(await checkUnclearChat(testEnv, given("sn4p me"), ai)).toEqual({ verdict: "blocked", reason: "contact_details" });
    expect(await checkUnclearChat({ ...testEnv, ANTHROPIC_API_KEY: "" }, given("where r u"), ai)).toEqual({ verdict: "unchecked" });
    expect(await checkUnclearChat(testEnv, given("where r u"), { ai: async () => Promise.reject(new Error("down")) })).toEqual({ verdict: "unchecked" });

    const overBudget = { ...testEnv, AI_CHAT_MONTHLY_INPUT_TOKENS: "1000" };
    expect(await checkUnclearChat(overBudget, given("where r u"), ai)).toEqual({ verdict: "unchecked" });
    expect(await checkUnclearChat(overBudget, given("where r u"), ai)).toEqual({ verdict: "unchecked" });
    expect(alerts).toEqual(["[alert] Chat filter budget used up"]);
  });
});
