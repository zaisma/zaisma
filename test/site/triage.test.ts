import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { KNOWN_IMAGE_CODE, gameBySlug, versionById, type ImageMatcher, type Report, type Triage } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { recheckVersion, triageReports, type TriageAnswer, type TriageDeps, type TriageInput } from "../../apps/site/src/triage.ts";
import type { AiResult } from "../../apps/site/src/ai.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };
const DAY = 86400_000;

const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };
/** `where` is the file and quote the AI points to as evidence. */
const scanSays = (verdict: "pass" | "hold" | "reject", where: { path: string; quote: string } | null = null): ScanDeps => ({
  images: connected,
  ai: async () =>
    ({
      report: { model: "test", verdict, summary: `AI says ${verdict}`, input_token_count: 1000, output_token_count: 100 },
      findings: verdict === "pass" ? [] : [{ stage: "ai", severity: verdict, code: "ai_other", message: "test concern", ...(where ?? {}) }],
      isChildSafety: false,
    }) satisfies AiResult,
});

/** A live game; `daysOld` moves its version back so reports can't pause it. */
async function liveGame(daysOld = 30) {
  const form = new FormData();
  form.set("title", "Test Game");
  form.set("slug", "test-game");
  form.set("description", "A test.");
  form.set("zip", new File([makeZip(CLEAN_GAME)], "game.zip", { type: "application/zip" }));
  const { versionId, gameId } = (await (await SELF.fetch(`${LOCAL}/admin/api/games`, { method: "POST", body: form })).json()) as { versionId: string; gameId: string };
  await scanVersion(testEnv, versionId, scanSays("pass"));
  await env.DB.prepare("UPDATE versions SET published_at_ms = ? WHERE id = ?").bind(Date.now() - daysOld * DAY, versionId).run();
  return { versionId, gameId };
}

let address = 10;
const send = (body: Record<string, unknown>) =>
  SELF.fetch(`${LOCAL}/g/test-game/report`, { method: "POST", headers: { "Content-Type": "application/json", Origin: LOCAL, "CF-Connecting-IP": `198.51.100.${address++}` }, body: JSON.stringify(body) });

/** A stand-in for the AI: answers with `a`, and remembers what it was shown. */
function ai(a: Partial<TriageAnswer> | ((input: TriageInput) => Partial<TriageAnswer>)) {
  const seen: TriageInput[] = [];
  const deps: TriageDeps = {
    random: () => 0.5,
    ai: async (_key, _model, input) => {
      seen.push(input);
      return {
        severity: "normal",
        category: "other",
        summary: "A summary.",
        recommendation: "person",
        why: "Because.",
        same_as: "",
        precedent: "",
        fit: "none",
        draft: { title: "", applies_when: "", decision: "", why: "" },
        input_token_count: 500,
        output_token_count: 50,
        ...(typeof a === "function" ? a(input) : a),
      };
    },
  };
  return { deps, seen };
}

const reports = async () => (await env.DB.prepare("SELECT * FROM reports ORDER BY reported_at_ms, rowid").all<Report>()).results;
const triageOf = (r: Report) => JSON.parse(r.triage!) as Triage;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage; UPDATE precedents SET precedent_status = 'proposed', can_ai_apply_alone = 0; DELETE FROM precedents WHERE created_at_ms > 0;");
});

/** A seeded precedent, put in force. */
const inForce = (id: string, aiAlone = false) => env.DB.prepare("UPDATE precedents SET precedent_status = 'active', can_ai_apply_alone = ? WHERE id = ?").bind(aiAlone ? 1 : 0, id).run();

describe("report triage", () => {
  it("sorts a report, keeps what it found, and merges a report about the same problem", async () => {
    await liveGame();
    await send({ reason: "other", details: "a boss says slurs in level 3" });
    await triageReports(testEnv, ai({ severity: "high", category: "hate", summary: "Hateful words in level 3." }).deps);
    await send({ reason: "hate", details: "level 3 boss is racist" });
    const second = ai((input) => ({ severity: "high", category: "hate", same_as: input.text.match(/id (report_[a-z0-9]+), sent/)![1] }));
    expect(await triageReports(testEnv, second.deps)).toBe(1);

    const [first, dup] = await reports();
    expect(first).toMatchObject({ severity_index: 2, report_group_id: null, report_status: "open" });
    expect(triageOf(first!)).toMatchObject({ is_by_ai: true, category: "hate", summary: "Hateful words in level 3.", recommendation: "person" });
    expect(dup).toMatchObject({ severity_index: 2, report_group_id: first!.id });
    // The AI saw the earlier report, the game and what the player wrote, marked as untrusted blocks.
    expect(second.seen[0]!.text).toContain("Hateful words in level 3.");
    expect(second.seen[0]!.text).toContain('Details: "level 3 boss is racist"');
    expect(second.seen[0]!.text).toContain("Title: Test Game");
    expect(await env.DB.prepare("SELECT report_triage_call_count FROM ai_usage").first("report_triage_call_count")).toBe(2);
  });

  it("passes a bug to the developer and closes it", async () => {
    await liveGame();
    await send({ reason: "other", details: "freezes when I press jump twice" });
    await triageReports(testEnv, ai({ category: "broken", recommendation: "bug" }).deps);
    const [r] = await reports();
    expect(r).toMatchObject({ report_status: "actioned", is_bug_report: 1 });
    expect(triageOf(r!).ai_actions[0]).toMatch(/developer/);
    expect(await (await SELF.fetch(`${LOCAL}/admin/reports`)).text()).toContain("Handled without you this week (1)");
  });

  it("never lets the AI read a child-safety report", async () => {
    await liveGame();
    await send({ reason: "child_safety", details: "something awful" });
    const { deps, seen } = ai({ severity: "low", recommendation: "dismiss" });
    await triageReports(testEnv, deps);
    expect(seen).toHaveLength(0);
    const [r] = await reports();
    expect(r).toMatchObject({ severity_index: 0, report_status: "open" });
    expect(triageOf(r!)).toMatchObject({ is_by_ai: false, category: "child_safety", recommendation: "person" });
  });

  it("treats child safety the AI finds in another report like a child-safety report", async () => {
    await liveGame(1); // Brand new, so the pause rule hides it.
    await send({ reason: "other", details: "a character asks kids for pictures" });
    await triageReports(testEnv, ai({ severity: "child_safety", category: "child_safety" }).deps);
    const [r] = await reports();
    expect(r).toMatchObject({ severity_index: 0, report_status: "open" });
    expect(triageOf(r!).ai_actions).toContain("Hid the new game until a person looks");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
  });

  it("checks the game's files again once, and never takes an established game offline over it", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "malware", details: "it asks for my steam password" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    let [r] = await reports();
    expect(triageOf(r!).recheck).toEqual({ recheck_status: "waiting" });
    expect((await versionById(env.DB, versionId))?.rechecked_at_ms).toBeTypeOf("number");
    // Nothing happens to the game until the files are checked.
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");

    await recheckVersion(testEnv, versionId, r!.id, scanSays("reject", { path: "game.js", quote: "let score = 0;" }));
    [r] = await reports();
    expect(r!.severity_index).toBe(1);
    expect(triageOf(r!)).toMatchObject({ recommendation: "take_down", recheck: { recheck_status: "done", scan_status: "rejected" } });
    // The files haven't changed since its scan: a person decides.
    expect(triageOf(r!).ai_actions).toContain("Left the game up: it's established, so a person decides");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
    // The version's own scan stays as it was.
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("approved");

    // A second report can't have the same version checked again.
    await send({ reason: "malware", details: "password stealer" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    const second = (await reports())[1]!;
    expect(triageOf(second)).toMatchObject({ recommendation: "person" });
    expect(triageOf(second).recheck).toBeUndefined();
  });

  it("hides even an established game when its files match known abuse material", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "other", details: "weird pictures in the menu" });
    await triageReports(testEnv, ai({ severity: "high", category: "sexual", recommendation: "recheck" }).deps);
    const known: ImageMatcher = { check: async (media) => ({ provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [{ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: "Known.", path: "game.js" }] }) };
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, { ...scanSays("pass"), images: known });
    const [r] = await reports();
    expect(r!.severity_index).toBe(0);
    expect(triageOf(r!).ai_actions).toContain("Hid the game: its files match known abuse material");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("held");
  });

  it("hides a brand-new game when the check finds a clear problem it can point to in the files", async () => {
    const { versionId } = await liveGame(1);
    await send({ reason: "malware", details: "fake login page" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("reject", { path: "game.js", quote: "requestAnimationFrame(function  loop(){" }));
    const t = triageOf((await reports())[0]!);
    expect(t.ai_actions).toContain("Hid the new game until a person looks");
    expect(t.recheck?.findings?.[0]).toContain("game.js");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
  });

  it("pauses nothing when the check can't point to the problem in the files", async () => {
    const { versionId } = await liveGame(1);
    await send({ reason: "malware", details: "fake login page" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    // An unquoted claim, then a quote that isn't in the file: the AI's word alone pauses nothing.
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("reject"));
    expect(triageOf((await reports())[0]!)).toMatchObject({ recommendation: "person" });
    await env.DB.exec("UPDATE versions SET rechecked_at_ms = NULL");
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("reject", { path: "game.js", quote: "window.location = 'https://phish.example'" }));
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
  });

  it("leaves the game up when the check finds nothing, and recommends dismissing", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "sexual", details: "nudity on the title screen" });
    await triageReports(testEnv, ai({ severity: "high", category: "sexual", recommendation: "recheck" }).deps);
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("pass"));
    const [r] = await reports();
    expect(triageOf(r!)).toMatchObject({ recommendation: "dismiss", recheck: { scan_status: "approved" } });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
  });

  it("asks a person when the check finds something new that isn't clear-cut", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "hate", details: "symbols on the walls" });
    await triageReports(testEnv, ai({ severity: "normal", category: "hate", recommendation: "recheck" }).deps);
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("hold"));
    const [r] = await reports();
    expect(r!.severity_index).toBe(2);
    expect(triageOf(r!)).toMatchObject({ recommendation: "person", recheck: { scan_status: "held", findings: ["ai_other: test concern"] } });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
  });

  it("recommends putting back a game a wrong report paused", async () => {
    await liveGame(1);
    await send({ reason: "illegal", details: "this game is illegal because it is too hard" });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
    await triageReports(testEnv, ai({ severity: "low", category: "other", recommendation: "dismiss" }).deps);
    const [r] = await reports();
    expect(r!.severity_index).toBe(2); // Paused games stay near the top.
    expect(triageOf(r!).recommendation).toBe("restore");
  });

  it("leaves reports for a person when the month's AI budget is used up", async () => {
    await liveGame();
    await env.DB.prepare("UPDATE ai_usage SET input_token_count = ?").bind(999_999_999).run();
    await send({ reason: "broken", details: "black screen" });
    const { deps, seen } = ai({ recommendation: "dismiss" });
    await triageReports(testEnv, deps);
    expect(seen).toHaveLength(0);
    const [r] = await reports();
    expect(r).toMatchObject({ severity_index: 3, report_status: "open", is_bug_report: 1 });
    expect(triageOf(r!)).toMatchObject({ is_by_ai: false, recommendation: "person" });
    expect(triageOf(r!).summary).toMatch(/budget/);
  });

  it("tries again when the AI fails, then hands the report to a person", async () => {
    await liveGame();
    await send({ reason: "hate" });
    const failing: TriageDeps = { ai: async () => Promise.reject(new Error("overloaded")) };
    expect(await triageReports(testEnv, failing)).toBe(0);
    expect(await triageReports(testEnv, failing)).toBe(0);
    expect((await reports())[0]!.triaged_at_ms).toBeNull();
    expect(await triageReports(testEnv, failing)).toBe(1);
    const [r] = await reports();
    expect(r).toMatchObject({ severity_index: 2, triage_attempt_count: 3 });
    expect(triageOf(r!)).toMatchObject({ is_by_ai: false, recommendation: "person" });
  });
});

describe("precedents", () => {
  it("dismisses a case that fits a precedent the AI may apply alone, and records it", async () => {
    await liveGame();
    await inForce("precedent_hard-or-boring", true);
    await send({ reason: "other", details: "way too hard" });
    const { deps, seen } = ai({ severity: "low", recommendation: "dismiss", precedent: "precedent_hard-or-boring", fit: "fits" });
    await triageReports(testEnv, deps);
    // The AI was given the precedents in force.
    expect(seen[0]!.precedents.map((p) => p.id)).toEqual(["precedent_hard-or-boring"]);
    const [r] = await reports();
    expect(r).toMatchObject({ report_status: "dismissed", precedent_id: "precedent_hard-or-boring" });
    expect(triageOf(r!).ai_actions).toEqual(["Dismissed under precedent “Too hard, boring or not fun”"]);
    expect(await (await SELF.fetch(`${LOCAL}/admin/reports`)).text()).toContain("Handled without you this week (1)");
  });

  it("keeps 1 in 20 for a person as a spot-check", async () => {
    await liveGame();
    await inForce("precedent_hard-or-boring", true);
    await send({ reason: "other", details: "boring" });
    const { deps } = ai({ severity: "low", precedent: "precedent_hard-or-boring", fit: "fits" });
    await triageReports(testEnv, { ...deps, random: () => 0.01 });
    const [r] = await reports();
    expect(r).toMatchObject({ report_status: "open", precedent_id: "precedent_hard-or-boring" });
    expect(triageOf(r!)).toMatchObject({ is_spot_check: true, recommendation: "dismiss" });
  });

  it("only recommends when the precedent isn't for the AI alone, or the report is urgent", async () => {
    await liveGame();
    await inForce("precedent_cartoon-violence");
    await send({ reason: "other", details: "too much blood" });
    await triageReports(testEnv, ai({ precedent: "precedent_cartoon-violence", fit: "fits", recommendation: "person" }).deps);
    await inForce("precedent_cartoon-violence", true);
    await send({ reason: "other", details: "someone gets shot" });
    await triageReports(testEnv, ai({ severity: "urgent", precedent: "precedent_cartoon-violence", fit: "fits" }).deps);
    const all = await reports();
    expect(all.map((r) => r.report_status)).toEqual(["open", "open"]);
    expect(all.map((r) => triageOf(r).recommendation)).toEqual(["dismiss", "dismiss"]);
    expect(triageOf(all[0]!).why).toContain("Precedent “Cartoon and fantasy violence”");
  });

  it("sends a case that challenges a precedent to a person, with a drafted change", async () => {
    await liveGame();
    await inForce("precedent_cartoon-violence", true);
    await send({ reason: "other", details: "realistic beheadings" });
    const draft = { title: "Realistic gore", applies_when: "Realistic, detailed gore.", decision: "take_down" as const, why: "Extreme gore isn't fine for 13+." };
    await triageReports(testEnv, ai({ severity: "high", precedent: "precedent_cartoon-violence", fit: "challenges", draft }).deps);
    const [r] = await reports();
    expect(r!.report_status).toBe("open");
    expect(triageOf(r!)).toMatchObject({ recommendation: "person", precedent: { id: "precedent_cartoon-violence", fit: "challenges" }, precedent_draft: draft });
    const page = await (await SELF.fetch(`${LOCAL}/admin/reports`)).text();
    expect(page).toContain("Challenges the precedent");
    expect(page).toContain("Change the precedent “Cartoon and fantasy violence”");
  });

  it("sets a precedent while deciding, replacing the one it changes", async () => {
    await liveGame();
    await inForce("precedent_cartoon-violence", true);
    await send({ reason: "other", details: "realistic beheadings" });
    await triageReports(testEnv, ai({ fit: "challenges", precedent: "precedent_cartoon-violence" }).deps);
    const form = new FormData();
    for (const [k, v] of Object.entries({ back: "queue", group: (await reports())[0]!.id, precedent: "1", p_replaces: "precedent_cartoon-violence", p_title: "Violence", p_when: "Fighting or cartoon blood; realistic gore is different.", p_why: "Fine for 13+.", p_alone: "1", reason: "Fine" })) form.set(k, v);
    await SELF.fetch(`${LOCAL}/admin/report-groups/${(await reports())[0]!.id}/dismiss`, { method: "POST", body: form, redirect: "manual" });
    const made = await env.DB.prepare("SELECT * FROM precedents WHERE replaces_precedent_id = 'precedent_cartoon-violence'").first<Record<string, unknown>>();
    expect(made).toMatchObject({ title: "Violence", decision: "dismiss", can_ai_apply_alone: 1, precedent_status: "active", created_by: "dev@localhost" });
    expect(await env.DB.prepare("SELECT precedent_status FROM precedents WHERE id = 'precedent_cartoon-violence'").first("precedent_status")).toBe("retired");
    expect((await reports())[0]).toMatchObject({ report_status: "dismissed", precedent_id: made!.id });
  });

  it("never lets the AI take a game down alone, whatever the precedent says", async () => {
    await liveGame();
    const form = new FormData();
    for (const [k, v] of Object.entries({ p_title: "Fake stores", p_when: "Copies a real store's login.", p_why: "Phishing.", p_decision: "take_down", p_alone: "1" })) form.set(k, v);
    await SELF.fetch(`${LOCAL}/admin/precedents`, { method: "POST", body: form, redirect: "manual" });
    expect(await env.DB.prepare("SELECT can_ai_apply_alone FROM precedents WHERE title = 'Fake stores'").first("can_ai_apply_alone")).toBe(0);
  });

  it("shows the drafted precedents for approval", async () => {
    const page = await (await SELF.fetch(`${LOCAL}/admin/precedents`)).text();
    expect(page).toContain("Waiting for you (10)");
    const form = new FormData();
    for (const [k, v] of Object.entries({ p_title: "Too hard or boring", p_when: "The player just doesn't like it.", p_why: "Taste.", p_decision: "dismiss", p_alone: "1" })) form.set(k, v);
    await SELF.fetch(`${LOCAL}/admin/precedents/precedent_hard-or-boring/activate`, { method: "POST", body: form, redirect: "manual" });
    expect(await env.DB.prepare("SELECT title, precedent_status, can_ai_apply_alone FROM precedents WHERE id = 'precedent_hard-or-boring'").first()).toEqual({ title: "Too hard or boring", precedent_status: "active", can_ai_apply_alone: 1 });
  });
});

describe("the report queue", () => {
  it("shows the most serious problem first, and closes a whole group in one click", async () => {
    await liveGame();
    await send({ reason: "broken", details: "stuck on level 2" });
    await send({ reason: "broken", details: "level 2 never ends" });
    await send({ reason: "sexual", details: "nudity" });
    // Reports sent in the same millisecond can list each other in any order, so the stand-in goes by words, never by position.
    const sorter = ai((input) => {
      const [own, others] = input.text.split("<other_reports>") as [string, string];
      return own.includes("nudity") ? { severity: "high", summary: "Says there's nudity." } : { summary: "Stuck on level 2.", same_as: others.match(/id (report_[a-z0-9]+), sent [^\n]*level 2/)?.[1] ?? "" };
    });
    await triageReports(testEnv, sorter.deps);

    const page = await (await SELF.fetch(`${LOCAL}/admin/reports`)).text();
    expect(page).toContain("3 open reports about 2 problems");
    expect(page.indexOf("Says there's nudity.")).toBeLessThan(page.indexOf("Stuck on level 2."));

    const level2 = (await reports()).find((r) => r.player_text === "stuck on level 2")!;
    const form = new FormData();
    form.set("back", "queue");
    form.set("reason", "Not a rule break");
    const res = await SELF.fetch(`${LOCAL}/admin/report-groups/${level2.report_group_id ?? level2.id}/dismiss`, { method: "POST", body: form, redirect: "manual" });
    expect(res.headers.get("location")).toBe("/admin/reports");
    expect(Object.fromEntries((await reports()).map((r) => [r.player_text, r.report_status]))).toEqual({ "stuck on level 2": "dismissed", "level 2 never ends": "dismissed", nudity: "open" });
  });

  it("passes a group to the developer as bugs", async () => {
    await liveGame();
    await send({ reason: "other", details: "the music cuts out" });
    await triageReports(testEnv, ai({ severity: "high" }).deps);
    const form = new FormData();
    form.set("back", "queue");
    await SELF.fetch(`${LOCAL}/admin/report-groups/${(await reports())[0]!.id}/bug`, { method: "POST", body: form, redirect: "manual" });
    expect(await reports()).toMatchObject([{ report_status: "actioned", is_bug_report: 1 }]);
  });
});
