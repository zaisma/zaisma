import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, gameBySlug, imagesForGame, readReviewReason, type ImageKind } from "@zaisma/core";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { GAME, IMAGE } from "../../apps/site/src/schemas.ts";
import { letPublish } from "../helpers.ts";
import type { Env } from "../../apps/site/src/env.ts";
import { runListingCheck } from "../../apps/site/src/listing-check.ts";
import { listingOutcomes, type ListingAnswer, type ListingBrief, type ListingJudge, type PictureAnswer } from "../../apps/site/src/listing-judge.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" } as unknown as Env;

/** The smallest PNG header with a chosen size: enough for the API to take it. */
function png(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, widthPx);
  new DataView(bytes.buffer).setUint32(20, heightPx);
  return bytes;
}

let token = "";

async function api(path: string, init: { method?: string; body?: unknown; raw?: Uint8Array } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  if (!response.ok) expect(errorProblems(await response.clone().json(), response.status)).toEqual([]);
  return response;
}

const NO: PictureAnswer = { number: 0, extra_text: "", overlay: "", fake_reward: "", famous_name: "", main_subject: "", is_main_subject_in_screenshots: true, added_after_capture: "", has_safety_concern: false };
const CLEAN_WORDS = { title_fake_reward: "", title_famous_name: "", title_tag: "", description_fake_reward: "", has_words_safety_concern: false };

/** A stand-in judge: each picture's answer by its kind (covers and screenshots), the words' answer as given; it records what it was sent. */
function judgeSays(byKind: Partial<Record<ImageKind, Partial<PictureAnswer>>>, words: Partial<ListingAnswer> = {}, briefs: ListingBrief[] = []): ListingJudge {
  return async (_apiKey, _model, brief) => {
    briefs.push(brief);
    const pictures = brief.pictures.flatMap((picture, index) => (picture.isJudged ? [{ ...NO, ...byKind[picture.kind], number: index + 1 }] : []));
    return { answer: { pictures, ...CLEAN_WORDS, ...words }, declinedAttemptCount: 0, costCents: 3 };
  };
}

/** A listed, live game with a cover and a screenshot sent through the API, waiting for the check. */
async function liveGameWithPictures(slug: string) {
  await api("/games", { body: { title: "Lava Leap", slug } });
  const game = (await gameBySlug(env.DB, slug))!;
  await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'version_stand', visibility = 'listed' WHERE id = ?").bind(game.id).run();
  const cover = ((await (await api(`/games/${slug}/images?kind=cover`, { raw: png(1280, 720) })).json()) as { image: { id: string } }).image.id;
  const screenshot = ((await (await api(`/games/${slug}/images?kind=screenshot`, { raw: png(1280, 720) })).json()) as { image: { id: string } }).image.id;
  return { game: (await gameBySlug(env.DB, slug))!, cover, screenshot };
}

const homeHas = async (slug: string) => (await (await SELF.fetch(`${SITE}/`)).text()).includes(`/g/${slug}`);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM ai_usage; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "test")).token;
});

describe("the listing check's outcomes", () => {
  const brief = (kinds: ImageKind[], words: Partial<ListingBrief> = {}): ListingBrief => ({
    title: "Lava Leap",
    isTitleJudged: true,
    description: "",
    isDescriptionJudged: true,
    pictures: kinds.map((kind, index) => ({ id: `picture-${index}`, kind, mediaType: "image/png", base64: "", isJudged: true })),
    ...words,
  });
  const answer = (pictures: Partial<PictureAnswer>[], words: Partial<ListingAnswer> = {}): ListingAnswer => ({ pictures: pictures.map((picture, index) => ({ ...NO, ...picture, number: index + 1 })), ...CLEAN_WORDS, ...words });

  it("hold a game for a fake reward anywhere, before any other line", () => {
    const outcomes = listingOutcomes(brief(["cover"]), answer([{ fake_reward: "FREE 5K ROBUX", extra_text: "FREE 5K ROBUX" }]));
    expect(outcomes.pictures["picture-0"]).toMatchObject({ outcome: "held", reason: { code: "fake_reward", content_rule: "malware" } });
    expect(outcomes.heldReason?.message).toBe('The cover promises "FREE 5K ROBUX".');
    expect(listingOutcomes(brief([]), answer([], { description_fake_reward: "free robux" })).heldReason?.code).toBe("fake_reward");
  });

  it("keep a cover off lists for each line, quoting what it found", () => {
    const cases: [Partial<PictureAnswer>, string, string][] = [
      [{ famous_name: "Naruto" }, "famous_name", "The cover shows Naruto."],
      [{ extra_text: "NEW MECHAS / 100 WALLS!" }, "extra_text_on_cover", 'The cover has words besides the title: "NEW MECHAS", "100 WALLS!".'],
      [{ overlay: "a shop panel" }, "overlay_on_cover", "Something is laid over the cover: a shop panel."],
      [{ main_subject: "a giant robot", is_main_subject_in_screenshots: false }, "cover_not_from_game", "The cover is built around a giant robot, which isn't in any of the game's screenshots."],
    ];
    for (const [pictureAnswer, code, message] of cases) {
      expect(listingOutcomes(brief(["cover", "screenshot"]), answer([pictureAnswer, {}])).pictures["picture-0"]).toEqual({ outcome: "off_lists", reason: { code, message, content_rule: null } });
    }
  });

  it("never judge a cover's subject when the game has no screenshots", () => {
    expect(listingOutcomes(brief(["cover"]), answer([{ main_subject: "a giant robot", is_main_subject_in_screenshots: false }])).pictures["picture-0"]).toEqual({ outcome: "fine" });
  });

  it("reject a screenshot only for what was added after the capture", () => {
    expect(listingOutcomes(brief(["screenshot"]), answer([{ added_after_capture: "a caption and an arrow" }])).pictures["picture-0"]).toMatchObject({ outcome: "rejected", reason: { code: "screenshot_not_from_game" } });
    // Text on a screenshot is the game's own: only covers are held to the title-only line.
    expect(listingOutcomes(brief(["screenshot"]), answer([{ extra_text: "Score 1,240", famous_name: "Mario" }])).pictures["picture-0"]).toEqual({ outcome: "fine" });
  });

  it("keep a title off lists for a tag or a famous name, and leave it alone when it isn't judged", () => {
    expect(listingOutcomes(brief([]), answer([], { title_tag: "[UPDATE]" })).title).toMatchObject({ outcome: "off_lists", reason: { code: "tag_in_title" } });
    expect(listingOutcomes(brief([]), answer([], { title_famous_name: "Minecraft" })).title).toMatchObject({ outcome: "off_lists", reason: { code: "famous_name", message: 'The title names "Minecraft".' } });
    expect(listingOutcomes(brief([], { isTitleJudged: false }), answer([], { title_tag: "[UPDATE]" })).title).toEqual({ outcome: "fine" });
  });

  it("leave safety, and anything without an answer, to a person", () => {
    const concern = listingOutcomes(brief(["cover"]), answer([{ has_safety_concern: true, famous_name: "Mario" }], { has_words_safety_concern: true }));
    expect(concern.pictures["picture-0"]).toEqual({ outcome: "person" });
    expect(concern.isWordsClear).toBe(false);
    expect(concern.title).toEqual({ outcome: "person" });
    const unanswered = listingOutcomes(brief(["cover", "screenshot"]), null);
    expect(Object.values(unanswered.pictures)).toEqual([{ outcome: "person" }, { outcome: "person" }]);
    expect(unanswered.isWordsClear).toBe(false);
  });
});

describe("the listing check", () => {
  it("is asked for when an image arrives, which waits for it", async () => {
    await api("/games", { body: { title: "Pics" } });
    const response = await api("/games/pics/images?kind=cover", { raw: png(1280, 720) });
    const added = (await response.json()) as { image: unknown; review_message: string; next_steps: { tool: string; after_sec: number }[] };
    expect(schemaProblems(IMAGE, added.image)).toEqual([]);
    expect(added.image).toMatchObject({ review_status: "pending", listing_reason: null });
    expect(added.review_message).toContain("about a minute");
    expect(added.next_steps).toMatchObject([{ tool: "get_game", after_sec: 60 }]);
    expect((await gameBySlug(env.DB, "pics"))!.listing_check_requested_at_ms).not.toBeNull();
  });

  it("approves clean pictures in place of a person, and counts its cost toward the review's budget", async () => {
    const { game, cover, screenshot } = await liveGameWithPictures("lava-leap");
    await runListingCheck(testEnv, game.id, judgeSays({}));
    const images = await imagesForGame(env.DB, game.id);
    expect(images.map((image) => [image.id, image.review_status, image.listing_reason, image.cleared_at_ms])).toEqual(
      expect.arrayContaining([
        [cover, "approved", null, null],
        [screenshot, "approved", null, null],
      ]),
    );
    expect((await SELF.fetch(`${SITE}/img/${cover}`)).status).toBe(200);
    expect((await env.DB.prepare("SELECT review_cost_cents FROM ai_usage").first<{ review_cost_cents: number }>())!.review_cost_cents).toBe(3);
    expect(await homeHas("lava-leap")).toBe(true);
  });

  it("keeps a game whose cover breaks a line off every list, while it still plays by its link", async () => {
    const { game, cover } = await liveGameWithPictures("lava-leap");
    await runListingCheck(testEnv, game.id, judgeSays({ cover: { extra_text: "NEW LEVELS!" } }));
    const image = (await imagesForGame(env.DB, game.id)).find((each) => each.id === cover)!;
    expect(image.review_status).toBe("approved");
    expect(readReviewReason(image.listing_reason)?.code).toBe("extra_text_on_cover");

    const answer = (await (await api("/games/lava-leap")).json()) as { game: unknown; images: { id: string; listing_reason: { code: string; fix: string } | null }[]; alerts: { kind: string; message: string }[] };
    expect(schemaProblems(GAME, answer.game)).toEqual([]);
    expect(answer.images.find((each) => each.id === cover)!.listing_reason).toMatchObject({ code: "extra_text_on_cover" });
    expect(answer.images.find((each) => each.id === cover)!.listing_reason!.fix).toContain("zaisma.com/developers/covers");
    expect(answer.alerts.find((alert) => alert.kind === "game_off_lists")?.message).toContain('"NEW LEVELS!"');

    expect(await homeHas("lava-leap")).toBe(false);
    expect(await (await SELF.fetch(`${SITE}/sitemap.xml`)).text()).not.toContain("/g/lava-leap");
    const page = await SELF.fetch(`${SITE}/g/lava-leap`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    await page.arrayBuffer();

    // Fixed: a clean cover replaces it, and the game is back.
    await api("/games/lava-leap/images?kind=cover", { raw: png(1920, 1080) });
    await runListingCheck(testEnv, game.id, judgeSays({}));
    expect(await homeHas("lava-leap")).toBe(true);
  });

  it("rejects a screenshot with something added after the capture", async () => {
    const { game, screenshot } = await liveGameWithPictures("lava-leap");
    await runListingCheck(testEnv, game.id, judgeSays({ screenshot: { added_after_capture: "a caption" } }));
    const image = (await imagesForGame(env.DB, game.id)).find((each) => each.id === screenshot)!;
    expect(image.review_status).toBe("rejected");
    expect(readReviewReason(image.review_reason)?.code).toBe("screenshot_not_from_game");
  });

  it("holds a game for a fake reward until a person looks, and doesn't hold it again once they clear it", async () => {
    const { game, cover } = await liveGameWithPictures("lava-leap");
    const sayFakeReward = judgeSays({ cover: { fake_reward: "FREE 5K ROBUX" } });
    await runListingCheck(testEnv, game.id, sayFakeReward);
    const held = (await gameBySlug(env.DB, "lava-leap"))!;
    expect(held.review_status).toBe("held");
    expect(readReviewReason(held.review_reason)?.code).toBe("fake_reward");
    expect((await imagesForGame(env.DB, game.id)).find((each) => each.id === cover)!.review_status).toBe("pending");

    await SELF.fetch(`http://localhost/admin/games/${game.id}/restore`, { method: "POST", body: new URLSearchParams({ reason: "A coin, not Robux" }) });
    const restored = (await gameBySlug(env.DB, "lava-leap"))!;
    expect(restored.review_status).toBe("live");
    const clearedCover = (await imagesForGame(env.DB, game.id)).find((each) => each.id === cover)!;
    expect(clearedCover).toMatchObject({ review_status: "approved", listing_reason: null });
    expect(clearedCover.cleared_at_ms).not.toBeNull();

    await env.DB.prepare("UPDATE games SET listing_check_requested_at_ms = ? WHERE id = ?").bind(Date.now() + 1000, game.id).run();
    await runListingCheck(testEnv, game.id, sayFakeReward);
    expect((await gameBySlug(env.DB, "lava-leap"))!.review_status).toBe("live");
  });

  it("leaves a picture a person cleared alone, and still shows the judge screenshots to compare", async () => {
    const { game, cover, screenshot } = await liveGameWithPictures("lava-leap");
    await runListingCheck(testEnv, game.id, judgeSays({ cover: { famous_name: "Mario" } }));
    expect(await homeHas("lava-leap")).toBe(false);
    await SELF.fetch(`http://localhost/admin/images/${cover}/clear-listing`, { method: "POST", body: new URLSearchParams({}) });
    expect(await homeHas("lava-leap")).toBe(true);

    const briefs: ListingBrief[] = [];
    await env.DB.prepare("UPDATE games SET listing_check_requested_at_ms = ? WHERE id = ?").bind(Date.now() + 1000, game.id).run();
    await runListingCheck(testEnv, game.id, judgeSays({ cover: { famous_name: "Mario" } }, {}, briefs));
    expect(briefs[0]!.pictures.map((picture) => [picture.id, picture.isJudged])).toEqual([[screenshot, true]]);
    expect(await homeHas("lava-leap")).toBe(true);
  });

  it("applies new words on a shown game once nothing about them needs a person", async () => {
    const { game } = await liveGameWithPictures("lava-leap");
    await api("/games/lava-leap", { method: "PATCH", body: { title: "Lava Leap [UPDATE]" } });
    expect((await gameBySlug(env.DB, "lava-leap"))!.details_waiting_for_review).not.toBeNull();
    await runListingCheck(testEnv, game.id, judgeSays({}, { title_tag: "[UPDATE]" }));
    const changed = (await gameBySlug(env.DB, "lava-leap"))!;
    expect(changed).toMatchObject({ title: "Lava Leap [UPDATE]", details_waiting_for_review: null });
    expect(readReviewReason(changed.title_listing_reason)?.code).toBe("tag_in_title");
    expect(await homeHas("lava-leap")).toBe(false);

    // Words a person must see keep waiting.
    await api("/games/lava-leap", { method: "PATCH", body: { description: "Something a person should read" } });
    await runListingCheck(testEnv, game.id, judgeSays({}, { has_words_safety_concern: true }));
    expect((await gameBySlug(env.DB, "lava-leap"))!.details_waiting_for_review).not.toBeNull();
  });

  it("does nothing without an AI key, or when nothing changed since it last ran", async () => {
    const { game, cover } = await liveGameWithPictures("lava-leap");
    const briefs: ListingBrief[] = [];
    await runListingCheck({ ...testEnv, ANTHROPIC_API_KEY: "" }, game.id, judgeSays({}, {}, briefs));
    expect(briefs).toEqual([]);
    expect((await imagesForGame(env.DB, game.id)).find((each) => each.id === cover)!.review_status).toBe("pending");
    await runListingCheck(testEnv, game.id, judgeSays({}, {}, briefs));
    await runListingCheck(testEnv, game.id, judgeSays({}, {}, briefs));
    expect(briefs.length).toBe(1);
  });
});
