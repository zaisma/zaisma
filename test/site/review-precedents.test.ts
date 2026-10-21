import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_PRECEDENT_LIMITS, type EvidenceItem, type ImageMatcher, type JudgedReviewPrecedent, type ReviewPrecedent, type ScanReport } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { judgeVersion, type JudgeBrief } from "../../apps/site/src/review-judge.ts";
import { draftMiss, draftWithAi, isAiHold, type DraftSource, type ReviewPrecedentDrafter } from "../../apps/site/src/review-precedents.ts";
import { standInCase } from "../../apps/site/src/review-set.ts";
import { testPlan, testWaitingReviewPrecedents } from "../../apps/site/src/review-precedent-tests.ts";
import { PUBLIC_REVIEW_CASES } from "../../apps/site/src/generated/review-set-public-cases.generated.ts";
import { judgeSays, passingScanDeps, readsNothing, seesNothing } from "./scan-stubs.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };

const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };
const holdsFor = (message = "A preset-phrase menu that reads as free chat."): ScanDeps => passingScanDeps({ images: connected, judge: judgeSays("hold", [{ stage: "ai", severity: "hold", code: "ai_free_text_chat", message }]) });
const passes = (): ScanDeps => passingScanDeps({ images: connected, judge: judgeSays("pass") });

/** A drafter with a fixed answer, counting calls and remembering what it was shown. */
function drafter(draft: Partial<{ title: string; applies_when: string; why: string; case_title: string; case_description: string; case_index_html: string }> | null = {}) {
  const seen: DraftSource[] = [];
  const draftReviewPrecedent: ReviewPrecedentDrafter = async (_key, _model, source) => {
    seen.push(source);
    return {
      costCents: 0.5,
      draft: draft && {
        title: "Preset phrases in a menu",
        applies_when: "A menu of fixed phrases players pick from; nothing typed reaches another player.",
        why: "Fixed phrases aren't free chat.",
        case_title: "Phrase menu",
        case_description: "A tiny game with a menu of fixed phrases.",
        case_index_html: "<!doctype html><title>Phrase menu</title><button>Good game</button>",
        ...draft,
      },
    };
  };
  return { draftReviewPrecedent, seen };
}

async function upload(slug = "test-game") {
  const form = new FormData();
  form.set("title", "Test Game");
  form.set("slug", slug);
  form.set("description", "A test.");
  form.set("zip", new File([makeZip(CLEAN_GAME)], "game.zip", { type: "application/zip" }));
  const response = await SELF.fetch(`${LOCAL}/admin/api/games`, { method: "POST", body: form });
  expect(response.status).toBe(201);
  return (await response.json()) as { versionId: string; gameId: string };
}

const post = (path: string, fields: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return SELF.fetch(`${LOCAL}${path}`, { method: "POST", body: form, redirect: "manual" });
};
const rows = async () => (await env.DB.prepare("SELECT * FROM review_precedents ORDER BY created_at_ms, rowid").all<ReviewPrecedent>()).results;
const versionRow = (id: string) => env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(id).first<{ scan_status: string; is_review_refunded: number; scan_report: string }>();

const GOOD_FORM = {
  review_precedent: "1",
  rp_title: "Preset phrases in a menu",
  rp_when: "A menu of fixed phrases players pick from.",
  rp_why: "Fixed phrases aren't free chat.",
  rp_rule: "chat",
  rp_case_title: "Phrase menu",
  rp_case_description: "A tiny game.",
  rp_case_html: "<!doctype html><title>Phrase menu</title><button>Good game</button>",
};

/** A ruling already tested and in force, or waiting for its test. */
async function insertRuling(fields: Partial<ReviewPrecedent> = {}): Promise<ReviewPrecedent> {
  const precedent: ReviewPrecedent = {
    id: `review_precedent_${Math.random().toString(36).slice(2, 12)}`,
    title: "Preset phrases in a menu",
    applies_when: "A menu of fixed phrases players pick from.",
    decision: "pass",
    content_rule: "chat",
    why: "Fixed phrases aren't free chat.",
    review_precedent_status: "active",
    from_version_id: null,
    from_report_group_id: null,
    replaces_review_precedent_id: null,
    case_title: "Phrase menu",
    case_description: "A tiny game.",
    case_index_html: "<!doctype html><title>Phrase menu</title><button>Good game</button>",
    test_result: null,
    tested_at_ms: null,
    created_by: "test@example.invalid",
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
    ...fields,
  };
  await env.DB
    .prepare(
      "INSERT INTO review_precedents (id, title, applies_when, decision, content_rule, why, review_precedent_status, from_version_id, from_report_group_id, replaces_review_precedent_id, case_title, case_description, case_index_html, test_result, tested_at_ms, created_by, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(precedent.id, precedent.title, precedent.applies_when, precedent.decision, precedent.content_rule, precedent.why, precedent.review_precedent_status, precedent.from_version_id, precedent.from_report_group_id, precedent.replaces_review_precedent_id, precedent.case_title, precedent.case_description, precedent.case_index_html, precedent.test_result, precedent.tested_at_ms, precedent.created_by, precedent.created_at_ms, precedent.updated_at_ms)
    .run();
  return precedent;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM review_precedents; DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage;");
});
afterEach(() => vi.restoreAllMocks());

describe("the judge reads review precedents", () => {
  it("lists the active ones in the brief, oldest first, and the report names the ones it followed", async () => {
    const first = await insertRuling({ title: "First", created_at_ms: 1000 });
    const second = await insertRuling({ title: "Second", decision: "hold", content_rule: "malware", created_at_ms: 2000 });
    await insertRuling({ title: "Not yet", review_precedent_status: "testing", created_at_ms: 3000 });
    const briefs: JudgeBrief[] = [];
    const { versionId } = await upload();
    const report = await scanVersion(testEnv, versionId, passingScanDeps({
      images: connected,
      judge: async (_key, _model, brief) => {
        briefs.push(brief);
        return { ...(await judgeSays("pass")(_key, _model, brief)), followedReviewPrecedentNumbers: [2] };
      },
    }));
    expect(briefs[0]!.reviewPrecedents!.map((precedent: JudgedReviewPrecedent) => precedent.title)).toEqual(["First", "Second"]);
    expect(report.ai).toMatchObject({ verdict: "pass", followed_review_precedent_ids: [second.id] });
    expect(first.id).not.toBe(second.id);
  });

  it("shows the rulings to the model as numbered lines, and keeps only the numbers it was given", async () => {
    const answers = (text: string) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text }] }), { headers: { "Content-Type": "application/json" } }));
    const spy = answers(JSON.stringify({ verdict: "pass", summary: "S.", has_sexual_content_involving_minors: false, followed_ruling_numbers: [1, 7, 1], findings: [] }));
    const items: EvidenceItem[] = [];
    const ruling: JudgedReviewPrecedent = { id: "review_precedent_a", title: "T", applies_when: "A menu of fixed phrases.", decision: "pass", content_rule: "chat", why: "W." };
    const answer = await judgeVersion("test-key", "claude-sonnet-5-5", { title: "T", description: "", fileCount: 1, items, pictures: [], reviewPrecedents: [ruling] });
    expect(answer.followedReviewPrecedentNumbers).toEqual([1]);
    const body = JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body));
    const sent = JSON.stringify(body.messages);
    expect(sent).toContain("<rulings>");
    expect(sent).toContain('\\"number\\":1');
    expect(sent).toContain("A menu of fixed phrases.");
    // With no rulings in force, the block isn't sent at all.
    vi.restoreAllMocks();
    const none = answers(JSON.stringify({ verdict: "pass", summary: "S.", has_sexual_content_involving_minors: false, followed_ruling_numbers: [], findings: [] }));
    await judgeVersion("test-key", "claude-sonnet-5-5", { title: "T", description: "", fileCount: 1, items, pictures: [] });
    expect(JSON.stringify(JSON.parse(String((none.mock.calls[0]![1] as RequestInit).body)).messages)).not.toContain("<rulings>");
  });
});

describe("drafting a ruling for a miss", () => {
  it("drafts a pass ruling when the judge holds a game, once, with costs in the review's budget", async () => {
    const { draftReviewPrecedent, seen } = drafter();
    const { versionId } = await upload();
    await scanVersion(testEnv, versionId, { ...holdsFor(), draft: draftReviewPrecedent });
    const [draft] = await rows();
    expect(draft).toMatchObject({ review_precedent_status: "proposed", decision: "pass", content_rule: "chat", from_version_id: versionId, created_by: "ai", title: "Preset phrases in a menu" });
    expect(draft!.case_index_html).toContain("<button>");
    expect(seen[0]).toMatchObject({ decision: "pass", contentRule: "chat" });
    expect(seen[0]!.concerns[0]).toContain("ai_free_text_chat");
    expect(await env.DB.prepare("SELECT review_cost_cents FROM ai_usage").first("review_cost_cents")).toBeGreaterThan(0.5);
    // The same miss isn't drafted twice.
    expect(await draftMiss(testEnv, { versionId, decision: "pass" }, draftReviewPrecedent)).toBe(draft!.id);
    expect(seen).toHaveLength(1);
  });

  it("leaves the draft empty for a person when the AI can't write one", async () => {
    const { draftReviewPrecedent } = drafter(null);
    const { versionId } = await upload();
    await scanVersion(testEnv, versionId, { ...holdsFor(), draft: draftReviewPrecedent });
    expect(await rows()).toMatchObject([{ review_precedent_status: "proposed", title: "", case_index_html: "" }]);
  });

  it("doesn't draft for a hold that only says the review couldn't finish", async () => {
    const { draftReviewPrecedent, seen } = drafter();
    for (const code of ["ai_review_declined", "ai_review_failed", "daily_large_reviews_used"] as const) {
      const { versionId } = await upload(`unfinished-${code.replace(/_/g, "-")}`);
      await scanVersion(testEnv, versionId, { ...passingScanDeps({ images: connected, judge: judgeSays("hold", [{ stage: "ai", severity: "hold", code, message: "Couldn't finish." }]) }), draft: draftReviewPrecedent });
      const version = (await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first())!;
      expect(isAiHold(version as never)).toBe(false);
    }
    expect(await rows()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("never drafts for child safety, for a pass, or for a hold the judge didn't make", async () => {
    const { draftReviewPrecedent, seen } = drafter();
    const childSafety = await upload("child-safety");
    await scanVersion(testEnv, childSafety.versionId, { ...passingScanDeps({ images: connected, judge: judgeSays("hold", [{ stage: "ai", severity: "hold", code: "ai_minors_sexualized", message: "Never shown." }], true) }), draft: draftReviewPrecedent });
    const passed = await upload("passed");
    await scanVersion(testEnv, passed.versionId, { ...passes(), draft: draftReviewPrecedent });
    expect(await draftMiss(testEnv, { versionId: passed.versionId, decision: "pass" }, draftReviewPrecedent)).toBeNull();
    expect(await rows()).toEqual([]);
    expect(seen).toEqual([]);
    // A passed game can be a "hold" miss, once a report finds something in it.
    const id = await draftMiss(testEnv, { versionId: passed.versionId, decision: "hold", reportGroupId: "report_abc", reason: "A player found a private address.", contentRule: "real_people" }, draftReviewPrecedent);
    expect(await rows()).toMatchObject([{ id, decision: "hold", content_rule: "real_people", from_report_group_id: "report_abc" }]);
    expect(seen[0]).toMatchObject({ decision: "hold", concerns: ["A player found a private address."] });
  });
});

describe("the drafter", () => {
  const answers = (text: string, stopReason = "end_turn") =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: stopReason, usage: { input_tokens: 1000, output_tokens: 500 }, content: text ? [{ type: "text", text }] : [] }), { headers: { "Content-Type": "application/json" } }));
  const source: DraftSource = { decision: "pass", contentRule: "chat", concerns: ["ai_free_text_chat: A menu."], evidence: [{ kind: "content", subject: "player_text", detail: "A menu of phrases.", path: "index.html", quote: "SECRET QUOTE", file_sha256: "", source: "reader" }], reason: "" };

  it("sends the evidence without its quotes, and cuts the answer to size", async () => {
    const spy = answers(JSON.stringify({ title: "T".repeat(300), applies_when: "A", why: "W", case_title: "C", case_description: "D", case_index_html: "<p>x</p>" }));
    const { draft, costCents } = await draftWithAi("test-key", "claude-haiku-5-5", source);
    expect(draft).toMatchObject({ applies_when: "A", case_index_html: "<p>x</p>" });
    expect(draft!.title).toHaveLength(120);
    expect(costCents).toBeGreaterThan(0);
    const sent = JSON.stringify(JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body)).messages);
    expect(sent).toContain("A menu of phrases.");
    expect(sent).not.toContain("SECRET QUOTE");
  });

  it("gives no draft when the model declines or answers badly", async () => {
    answers("", "refusal");
    expect((await draftWithAi("test-key", "claude-haiku-5-5", source)).draft).toBeNull();
    vi.restoreAllMocks();
    answers("not json");
    expect((await draftWithAi("test-key", "claude-haiku-5-5", source)).draft).toBeNull();
  });
});

describe("releasing a hold the review got wrong", () => {
  async function heldVersion(draft = drafter()) {
    const { versionId } = await upload();
    await scanVersion(testEnv, versionId, { ...holdsFor(), draft: draft.draftReviewPrecedent });
    return versionId;
  }

  it("refunds the daily review and says so in the history, and saves the ruling in the same click", async () => {
    const versionId = await heldVersion();
    const version = (await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first())!;
    expect(isAiHold(version as never)).toBe(true);
    const [draft] = await rows();
    const response = await post(`/admin/versions/${versionId}/approve`, { ...GOOD_FORM, rp_id: draft!.id, rp_version: versionId, rp_title: "Edited name" });
    expect(response.status).toBe(303);
    expect(await versionRow(versionId)).toMatchObject({ scan_status: "approved", is_review_refunded: 1 });
    expect(await rows()).toMatchObject([{ id: draft!.id, review_precedent_status: "testing", title: "Edited name", decision: "pass", content_rule: "chat" }]);
    const audit = await env.DB.prepare("SELECT action, reason FROM audit_log WHERE action = 'review-hold-released'").first();
    expect(audit).toEqual({ action: "review-hold-released", reason: versionId });
  });

  it("refunds without teaching when the box isn't ticked", async () => {
    const versionId = await heldVersion();
    await post(`/admin/versions/${versionId}/approve`);
    expect(await versionRow(versionId)).toMatchObject({ scan_status: "approved", is_review_refunded: 1 });
    expect((await rows())[0]!.review_precedent_status).toBe("proposed");
  });

  it("changes nothing, and says what's missing, when the ruling can't be saved", async () => {
    const versionId = await heldVersion(drafter(null));
    const response = await post(`/admin/versions/${versionId}/approve`, { review_precedent: "1", rp_title: "Name", rp_when: "When." });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("stand-in test game");
    expect(await versionRow(versionId)).toMatchObject({ scan_status: "held", is_review_refunded: 0 });
  });

  it("doesn't refund a hold that wasn't the judge's: a report's pause, or one waiting for a daily review", async () => {
    const { versionId } = await upload();
    await scanVersion(testEnv, versionId, passes());
    await env.DB.prepare("UPDATE versions SET scan_status = 'held', report_held_at_ms = 1 WHERE id = ?").bind(versionId).run();
    await post(`/admin/versions/${versionId}/approve`);
    expect((await versionRow(versionId))!.is_review_refunded).toBe(0);
  });

  it("doesn't count a refunded review toward the owner's 5 a day", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms) VALUES ('owner_refund', 'person', 1)").run();
    const versions: string[] = [];
    for (let index = 1; index <= 5; index++) {
      const { versionId, gameId } = await upload(`refund-${index}`);
      await env.DB.prepare("UPDATE games SET owner_id = 'owner_refund' WHERE id = ?").bind(gameId).run();
      await scanVersion(testEnv, versionId, holdsFor());
      versions.push(versionId);
    }
    // Five judged reviews today: a sixth version waits for a free one.
    const sixth = await upload("refund-6");
    await env.DB.prepare("UPDATE games SET owner_id = 'owner_refund' WHERE id = ?").bind(sixth.gameId).run();
    const waiting = await scanVersion(testEnv, sixth.versionId, holdsFor());
    expect(waiting.findings.map((finding) => finding.code)).toEqual(["daily_large_reviews_used"]);
    // A person releases one of the five: the review was wrong, so it's given back.
    await post(`/admin/versions/${versions[0]}/approve`);
    const seventh = await upload("refund-7");
    await env.DB.prepare("UPDATE games SET owner_id = 'owner_refund' WHERE id = ?").bind(seventh.gameId).run();
    const judged = await scanVersion(testEnv, seventh.versionId, holdsFor());
    expect(judged.findings.map((finding) => finding.code)).toEqual(["ai_free_text_chat"]);
  });
});

describe("rejecting or taking down a game the review passed", () => {
  it("saves a hold ruling from a rejection, with the rule picked beside it", async () => {
    const { versionId } = await upload();
    await scanVersion(testEnv, versionId, passes());
    const response = await post(`/admin/versions/${versionId}/reject`, { ...GOOD_FORM, rp_rule: "", content_rule: "real_people", reason: "A real address.", rp_version: versionId });
    expect(response.status).toBe(303);
    expect(await rows()).toMatchObject([{ review_precedent_status: "testing", decision: "hold", content_rule: "real_people", from_version_id: versionId }]);
  });

  it("needs a content rule for a hold ruling, and a test game", async () => {
    const { versionId, gameId } = await upload();
    await scanVersion(testEnv, versionId, passes());
    const noRule = await post(`/admin/games/${gameId}/takedown`, { ...GOOD_FORM, rp_rule: "", content_rule: "malware", reason: "x", rp_case_html: "" });
    expect(await noRule.text()).toContain("stand-in test game");
    expect((await env.DB.prepare("SELECT review_status FROM games WHERE id = ?").bind(gameId).first())!.review_status).not.toBe("removed");
    const response = await post(`/admin/games/${gameId}/takedown`, { ...GOOD_FORM, rp_rule: "", content_rule: "malware", reason: "It steals logins.", rp_version: versionId });
    expect(response.status).toBe(303);
    expect((await env.DB.prepare("SELECT review_status FROM games WHERE id = ?").bind(gameId).first())!.review_status).toBe("removed");
    expect(await rows()).toMatchObject([{ decision: "hold", content_rule: "malware", review_precedent_status: "testing" }]);
  });
});

describe("testing a ruling before the judge reads it", () => {
  const botsAreHeld = (isOwnApproved: boolean) =>
    passingScanDeps({
      judge: async (key, model, brief) => {
        const isStandIn = brief.title === "Phrase menu";
        if (isStandIn) return judgeSays(isOwnApproved ? "pass" : "hold")(key, model, brief);
        // Honest public cases pass, bad ones are held.
        const publicCase = PUBLIC_REVIEW_CASES.find((candidate) => candidate.title === brief.title)!;
        return judgeSays(publicCase.is_honest ? "pass" : "hold")(key, model, brief);
      },
    });
  const deps = (isOwnApproved = true) => ({ readCode: readsNothing, readPictures: seesNothing, judge: botsAreHeld(isOwnApproved).judge });

  it("plans a pass ruling on its own game and the bad games of its rule, and a hold ruling on its own and every honest one", () => {
    const pass = { ...({} as ReviewPrecedent), id: "review_precedent_p", decision: "pass", content_rule: "chat", title: "T", case_title: "C", case_description: "", case_index_html: "<p>", why: "w", applies_when: "a" } as ReviewPrecedent;
    const passPlan = testPlan(pass);
    expect(passPlan[0]).toMatchObject({ isOwnCase: true, runCount: REVIEW_PRECEDENT_LIMITS.testRunCount });
    expect(passPlan[0]!.gameCase.is_honest).toBe(true);
    expect(passPlan.slice(1).every((planned) => !planned.gameCase.is_honest && planned.gameCase.content_rule === "chat")).toBe(true);
    expect(passPlan.length).toBeGreaterThan(1);
    const hold = { ...pass, decision: "hold" } as ReviewPrecedent;
    const holdPlan = testPlan(hold);
    expect(holdPlan[0]!.gameCase).toMatchObject({ is_honest: false, content_rule: "chat" });
    expect(holdPlan.slice(1).every((planned) => planned.gameCase.is_honest && planned.runCount === REVIEW_PRECEDENT_LIMITS.honestTestRunCount)).toBe(true);
    expect(holdPlan.length - 1).toBe(PUBLIC_REVIEW_CASES.filter((publicCase) => publicCase.is_honest).length);
    // The stand-in is a case like any other.
    expect(standInCase(pass)).toMatchObject({ is_honest: true, content_rule: null, is_private: true });
  });

  it("puts a ruling in force when the cases come out right, and retires the one it replaces", async () => {
    const old = await insertRuling({ title: "Old wording" });
    const ruling = await insertRuling({ review_precedent_status: "testing", replaces_review_precedent_id: old.id, title: "New wording", created_at_ms: Date.now() + 1 });
    expect(await testWaitingReviewPrecedents(testEnv, deps(true))).toBe(1);
    const [oldRow, newRow] = await rows();
    expect(oldRow).toMatchObject({ id: old.id, review_precedent_status: "retired" });
    expect(newRow).toMatchObject({ id: ruling.id, review_precedent_status: "active" });
    expect(JSON.parse(newRow!.test_result!)).toMatchObject({ is_passing: true });
    expect(await env.DB.prepare("SELECT review_cost_cents FROM ai_usage").first("review_cost_cents")).toBeGreaterThan(0);
  });

  it("fails a ruling whose own game doesn't come out as it says, and says which", async () => {
    const ruling = await insertRuling({ review_precedent_status: "testing" });
    await testWaitingReviewPrecedents(testEnv, deps(false));
    const [row] = await rows();
    expect(row).toMatchObject({ id: ruling.id, review_precedent_status: "failed" });
    expect(JSON.parse(row!.test_result!).summary).toContain("its own test game");
  });

  it("fails a pass ruling that lets a bad game through", async () => {
    await insertRuling({ review_precedent_status: "testing" });
    const lax = { readCode: readsNothing, readPictures: seesNothing, judge: judgeSays("pass") };
    await testWaitingReviewPrecedents(testEnv, lax);
    const [row] = await rows();
    expect(row!.review_precedent_status).toBe("failed");
    expect(JSON.parse(row!.test_result!).summary).toContain("missed bad");
  });

  it("tests a few at a time and no more than the day allows", async () => {
    for (let index = 0; index < 4; index++) await insertRuling({ review_precedent_status: "testing", created_at_ms: Date.now() + index, updated_at_ms: Date.now() + index });
    expect(await testWaitingReviewPrecedents(testEnv, deps(true))).toBe(2);
    expect(await testWaitingReviewPrecedents(testEnv, deps(true))).toBe(2);
    expect(await testWaitingReviewPrecedents(testEnv, deps(true))).toBe(0);
    // The day's cap counts tests started in the last 24 hours.
    await env.DB.exec("UPDATE review_precedents SET review_precedent_status = 'testing', test_result = NULL");
    await env.DB.prepare("UPDATE review_precedents SET tested_at_ms = ?").bind(Date.now()).run();
    expect(await testWaitingReviewPrecedents(testEnv, deps(true), Date.now() + 1000)).toBe(0);
    expect(REVIEW_PRECEDENT_LIMITS.maximumTestCountPerDay).toBe(10);
  });

  it("does nothing without a key or once the review's budget is used", async () => {
    await insertRuling({ review_precedent_status: "testing" });
    expect(await testWaitingReviewPrecedents({ ...testEnv, ANTHROPIC_API_KEY: "" }, deps(true))).toBe(0);
    await env.DB.prepare("INSERT INTO ai_usage (month, review_cost_cents) VALUES (?, 100000000) ON CONFLICT(month) DO UPDATE SET review_cost_cents = 100000000").bind(new Date().toISOString().slice(0, 7)).run();
    expect(await testWaitingReviewPrecedents(testEnv, deps(true))).toBe(0);
    expect((await rows())[0]!.review_precedent_status).toBe("testing");
  });
});

describe("the admin page", () => {
  it("lists rulings by where they stand, and retires one", async () => {
    const active = await insertRuling({ title: "Menu of phrases" });
    await insertRuling({ title: "A failing one", review_precedent_status: "failed", test_result: JSON.stringify({ is_passing: false, cases: [], summary: "Didn't hold: noir-detective (held honest)." }) });
    const page = await (await SELF.fetch(`${LOCAL}/admin/review-precedents`)).text();
    expect(page).toContain("Menu of phrases");
    expect(page).toContain("Failed the test");
    expect(page).toContain("noir-detective (held honest)");
    expect(page).toContain("Test game: Phrase menu");
    const retired = await post(`/admin/review-precedents/${active.id}/retire`);
    expect(retired.status).toBe(303);
    expect((await rows()).find((row) => row.id === active.id)!.review_precedent_status).toBe("retired");
  });

  it("shows the Teach the review block with the drafted ruling on a held version", async () => {
    const { versionId, gameId } = await upload();
    await scanVersion(testEnv, versionId, { ...holdsFor(), draft: drafter().draftReviewPrecedent });
    const page = await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text();
    expect(page).toContain("teach it to pass games like it");
    expect(page).toContain("Preset phrases in a menu");
    expect(page).toContain('name="review_precedent"');
  });
});
