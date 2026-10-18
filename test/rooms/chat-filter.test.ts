import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAccount, type AgeBand } from "@zaisma/core";
import { filterChatMessage, type ChatMessage } from "../../apps/rooms/src/chat-filter.ts";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { UnclearChatCheck } from "../../apps/site/src/chat-check.ts";

const e = env as unknown as Env;

/** A stand-in for the site's AI step that says what it was asked and answers as told. */
function stubbedAi(answer: UnclearChatCheck = { verdict: "allowed" }) {
  const asked: { text: string; recentTexts: string[]; isAdultToMinor: boolean }[] = [];
  const withAi = { ...e, CHAT_CHECK: { checkUnclear: async (given: (typeof asked)[number]) => (asked.push(given), answer) } } as unknown as Env;
  return { asked, withAi };
}

let accountNumber = 0;
async function player(ageBand: AgeBand) {
  const account = await createAccount(e.DB, { id: `chat-filter-${++accountNumber}`, username: `chat_filter_${accountNumber}`, ageBand, socialMode: "open_and_social" });
  return account;
}

const message = (sender: { player_id: string }, receivers: { player_id: string }[], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  gameId: "game_chatfilter",
  text,
  senderPlayerId: sender.player_id,
  receiverPlayerIds: receivers.map((receiver) => receiver.player_id),
  recentTexts: [],
  source: "rooms",
  ...extra,
});

const accountOf = (id: string) => e.DB.prepare("SELECT chat_stopped_reason, chat_stopped_until_ms, chat_repeat_block_count FROM accounts WHERE id = ?").bind(id).first<{ chat_stopped_reason: string | null; chat_stopped_until_ms: number | null; chat_repeat_block_count: number }>();
const reviewsOf = (id: string) => e.DB.prepare("SELECT source, text, recent_texts_json, chat_review_status FROM chat_reviews WHERE sender_account_id = ?").bind(id).all().then((found) => found.results);

describe("the chat filter", () => {
  it("leaves adults' chat to the game, unchecked, with swearing flagged", async () => {
    const [adult, adultToo] = [await player("18+"), await player("18+")];
    const { asked, withAi } = stubbedAi({ verdict: "blocked", reason: "sexual" });
    expect(await filterChatMessage(withAi, message(adult, [adultToo], "add me on snap, this is shit"))).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: true });
    expect(asked).toEqual([]);
  });

  it("stops contact details toward a teen, and anything the AI can't check", async () => {
    const [adult, teen] = [await player("18+"), await player("13-15")];
    expect(await filterChatMessage(stubbedAi().withAi, message(adult, [teen], "add me on snap"))).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false });
    // Teen to teen, what the rules can't tell goes to the AI; when it can't answer, it's stopped.
    const teenToo = await player("16-17");
    const down = stubbedAi({ verdict: "unchecked" });
    expect(await filterChatMessage(down.withAi, message(teen, [teenToo], "where are you"))).toMatchObject({ isAllowed: false, reason: "unchecked" });
    expect(down.asked).toEqual([{ text: "where are you", recentTexts: [], isAdultToMinor: false }]);
    // So is one with no AI at all.
    expect(await filterChatMessage({ ...e, CHAT_CHECK: undefined } as Env, message(teen, [teenToo], "where are you"))).toMatchObject({ isAllowed: false, reason: "unchecked" });
    // And a guest gets nothing: canChat keeps them out, and this is the backstop.
    expect(await filterChatMessage(stubbedAi().withAi, message(teen, [{ player_id: "player_guest1" }], "gg"))).toMatchObject({ isAllowed: false, reason: "chat_paused" });
  });

  it("sends every message from an adult to a teen to the AI", async () => {
    const [adult, teen] = [await player("18+"), await player("16-17")];
    const { asked, withAi } = stubbedAi();
    expect(await filterChatMessage(withAi, message(adult, [teen], "nice jump", { recentTexts: ["gg"] }))).toMatchObject({ isAllowed: true });
    expect(asked).toEqual([{ text: "nice jump", recentTexts: ["gg"], isAdultToMinor: true }]);
  });

  it("pauses a sender an hour on the fifth contact block toward teens in a day", async () => {
    const [adult, teen] = [await player("18+"), await player("13-15")];
    const { withAi } = stubbedAi();
    const nowMs = Date.now();
    for (let i = 1; i <= 4; i++) expect(await filterChatMessage(withAi, message(adult, [teen], "what school do you go to"), nowMs)).toMatchObject({ reason: "personal_details" });
    expect((await accountOf(adult.id))!.chat_repeat_block_count).toBe(4);
    expect(await filterChatMessage(withAi, message(adult, [teen], "add me on snap"), nowMs)).toMatchObject({ reason: "contact_details" });
    expect(await accountOf(adult.id)).toEqual({ chat_stopped_reason: "paused_for_repeats", chat_stopped_until_ms: nowMs + 3_600_000, chat_repeat_block_count: 0 });
    expect(await filterChatMessage(withAi, message(adult, [teen], "gg"), nowMs + 1000)).toEqual({ isAllowed: false, reason: "chat_paused", message: "Your chat is paused for now.", hasSwearing: false });
    // The pause ends by itself.
    expect(await filterChatMessage(withAi, message(adult, [teen], "gg"), nowMs + 3_600_001)).toMatchObject({ isAllowed: true });

    // Blocks a day apart don't add up.
    const other = await player("18+");
    await filterChatMessage(withAi, message(other, [teen], "add me on snap"), nowMs);
    await filterChatMessage(withAi, message(other, [teen], "add me on snap"), nowMs + 86_400_001);
    expect((await accountOf(other.id))!.chat_repeat_block_count).toBe(1);
  });

  it("keeps an adult's sexual message to a teen for review, pausing the sender only in Zaisma's rooms", async () => {
    const [adult, teen] = [await player("18+"), await player("13-15")];
    const { withAi } = stubbedAi({ verdict: "blocked", reason: "sexual" });
    expect(await filterChatMessage(withAi, message(adult, [teen], "u home alone?", { recentTexts: ["hey"] }))).toEqual({ isAllowed: false, reason: "sexual", message: "That can't be sent here.", hasSwearing: false });
    expect(await reviewsOf(adult.id)).toEqual([{ source: "rooms", text: "u home alone?", recent_texts_json: '["hey"]', chat_review_status: "pending" }]);
    expect((await accountOf(adult.id))!.chat_stopped_reason).toBe("in_review");
    expect(await filterChatMessage(withAi, message(adult, [teen], "gg"))).toMatchObject({ reason: "chat_paused" });

    // From a developer's own server it's kept, but pauses nobody: the server could have made it up.
    const otherAdult = await player("18+");
    expect(await filterChatMessage(withAi, message(otherAdult, [teen], "send nudes", { source: "own_server" }))).toMatchObject({ reason: "sexual" });
    expect(await reviewsOf(otherAdult.id)).toEqual([{ source: "own_server", text: "send nudes", recent_texts_json: "[]", chat_review_status: "pending" }]);
    expect((await accountOf(otherAdult.id))!.chat_stopped_reason).toBeNull();

    // Teen to teen, a sexual message is stopped and nothing is kept.
    const teenToo = await player("16-17");
    expect(await filterChatMessage(withAi, message(teenToo, [teen], "send nudes"))).toMatchObject({ reason: "sexual" });
    expect(await reviewsOf(teenToo.id)).toEqual([]);
  });

  it("gives one verdict for every receiver, so a game never learns which one is a teen", async () => {
    const [adult, adultToo, adultThree, teen] = [await player("18+"), await player("18+"), await player("18+"), await player("16-17")];
    const { withAi } = stubbedAi();
    expect(await filterChatMessage(withAi, message(adult, [adultToo, adultThree], "add me on snap"))).toMatchObject({ isAllowed: true });
    expect(await filterChatMessage(withAi, message(adult, [adultToo, teen, adultThree], "add me on snap"))).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false });
  });
});
