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
  isAdultFilterEnabled: false,
  ...extra,
});

const accountOf = (id: string) => e.DB.prepare("SELECT chat_stopped_reason, chat_stopped_until_ms, chat_repeat_block_count FROM accounts WHERE id = ?").bind(id).first<{ chat_stopped_reason: string | null; chat_stopped_until_ms: number | null; chat_repeat_block_count: number }>();
const reviewsOf = (id: string) => e.DB.prepare("SELECT source, text, recent_texts_json, chat_review_status FROM chat_reviews WHERE sender_account_id = ?").bind(id).all().then((found) => found.results);

describe("the chat filter", () => {
  it("leaves adults' chat to the game, unchecked, with swearing flagged", async () => {
    const [adult, adultToo] = [await player("18+"), await player("18+")];
    const { asked, withAi } = stubbedAi({ verdict: "blocked", reason: "sexual" });
    expect(await filterChatMessage(withAi, message(adult, [adultToo], "add me on snap, this is shit"))).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: true, hasSlur: false });
    expect(asked).toEqual([]);
  });

  it("checks adults' chat like teens' when the game turns it on, counting each AI look on its meter", async () => {
    const [adult, adultToo] = [await player("18+"), await player("18+")];
    const { asked, withAi } = stubbedAi({ verdict: "blocked", reason: "contact_details" });
    const on = { isAdultFilterEnabled: true, gameId: "game_adultfilter" };
    expect(await filterChatMessage(withAi, message(adult, [adultToo], "add me on snap", on))).toMatchObject({ isAllowed: false, reason: "contact_details" });
    // The rules stopped that one: no AI look, nothing on the meter.
    expect(asked).toEqual([]);
    expect(await filterChatMessage(withAi, message(adult, [adultToo], "meet irl at westfield saturday, my mom can drive", on))).toMatchObject({ isAllowed: false, reason: "contact_details" });
    expect(await filterChatMessage(withAi, message(adult, [adultToo], "where are you", on))).toMatchObject({ isAllowed: false, reason: "contact_details" });
    expect(asked.map((check) => check.text)).toEqual(["where are you"]);
    expect(await e.DB.prepare("SELECT adult_chat_check_count FROM room_usage WHERE game_id = 'game_adultfilter'").first("adult_chat_check_count")).toBe(1);
    // A pause for repeats is only for chat toward teens.
    expect(await accountOf(adult.id)).toMatchObject({ chat_repeat_block_count: 0 });
  });

  it("stops contact details toward a teen, and sends what the AI can't check after the rules", async () => {
    const [adult, teen] = [await player("18+"), await player("13-15")];
    expect(await filterChatMessage(stubbedAi().withAi, message(adult, [teen], "add me on snap"))).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false, hasSlur: false });
    // Teen to teen, what the rules can't tell goes to the AI; when it can't answer, it goes, as when in doubt (Oct 26, 2026).
    const teenToo = await player("16-17");
    const down = stubbedAi({ verdict: "unchecked" });
    expect(await filterChatMessage(down.withAi, message(teen, [teenToo], "where are you"))).toMatchObject({ isAllowed: true, reason: null });
    expect(down.asked).toEqual([{ text: "where are you", recentTexts: [], isAdultToMinor: false }]);
    // So does one with no AI at all; the rules still stop what they know.
    expect(await filterChatMessage({ ...e, CHAT_CHECK: undefined } as Env, message(teen, [teenToo], "where are you"))).toMatchObject({ isAllowed: true });
    expect(await filterChatMessage({ ...e, CHAT_CHECK: undefined } as Env, message(teen, [teenToo], "call me 555 123 4567"))).toMatchObject({ isAllowed: false, reason: "contact_details" });
    // Between teens a phone number is stopped, and a slur passes, flagged for the game.
    expect(await filterChatMessage(stubbedAi().withAi, message(teen, [teenToo], "you f a g"))).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: false, hasSlur: true });
    // And a guest gets nothing: canChat keeps them out, and this is the backstop.
    expect(await filterChatMessage(stubbedAi().withAi, message(teen, [{ player_id: "player_guest1" }], "gg"))).toMatchObject({ isAllowed: false, reason: "chat_paused" });
  });

  it("checks the whole message, and refuses one over 2000 characters without asking anyone", async () => {
    const [adult, teen] = [await player("18+"), await player("13-15")];
    const ai = stubbedAi();
    expect(await filterChatMessage(ai.withAi, message(adult, [teen], "a".repeat(2001)))).toEqual({ isAllowed: false, reason: "too_long", message: "That message is too long to send.", hasSwearing: false, hasSlur: false });
    expect(ai.asked).toEqual([]);
    expect(await filterChatMessage(ai.withAi, message(adult, [teen], `${"nice ".repeat(300)}add me on snap`))).toMatchObject({ isAllowed: false, reason: "contact_details" });
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
    expect(await filterChatMessage(withAi, message(adult, [teen], "gg"), nowMs + 1000)).toEqual({ isAllowed: false, reason: "chat_paused", message: "Your chat is paused for now.", hasSwearing: false, hasSlur: false });
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
    expect(await filterChatMessage(withAi, message(adult, [teen], "u home alone?", { recentTexts: ["hey"] }))).toEqual({ isAllowed: false, reason: "sexual", message: "That can't be sent here.", hasSwearing: false, hasSlur: false });
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
    expect(await filterChatMessage(withAi, message(adult, [adultToo, teen, adultThree], "add me on snap"))).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false, hasSlur: false });
  });
});
