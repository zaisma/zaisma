import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { gameBySlug, versionById, type ImageMatcher, type Report, type Triage } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { recheckVersion, triageReports, type TriageAnswer, type TriageDeps, type TriageInput } from "../../apps/site/src/triage.ts";
import type { AiResult } from "../../apps/site/src/ai.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };
const DAY = 86400_000;

const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", connected: true, checked: imgs.length, findings: [] }) };
const scanSays = (verdict: "pass" | "hold" | "reject", childSafety = false): ScanDeps => ({
  images: connected,
  ai: async () =>
    ({
      report: { model: "test", verdict, summary: `AI says ${verdict}`, inputTokens: 1000, outputTokens: 100 },
      findings: verdict === "pass" ? [] : [{ stage: "ai", severity: verdict, rule: "ai-test", detail: "test concern" }],
      childSafety,
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
  await env.DB.prepare("UPDATE versions SET published_at = ? WHERE id = ?").bind(Date.now() - daysOld * DAY, versionId).run();
  return { versionId, gameId };
}

let address = 10;
const send = (body: Record<string, unknown>) =>
  SELF.fetch(`${LOCAL}/g/test-game/report`, { method: "POST", headers: { "Content-Type": "application/json", Origin: LOCAL, "CF-Connecting-IP": `198.51.100.${address++}` }, body: JSON.stringify(body) });

/** A stand-in for the AI: answers with `a`, and remembers what it was shown. */
function ai(a: Partial<TriageAnswer> | ((input: TriageInput) => Partial<TriageAnswer>)) {
  const seen: TriageInput[] = [];
  const deps: TriageDeps = {
    ai: async (_key, _model, input) => {
      seen.push(input);
      return { severity: "normal", category: "other", summary: "A summary.", recommendation: "person", why: "Because.", same_as: "", inputTokens: 500, outputTokens: 50, ...(typeof a === "function" ? a(input) : a) };
    },
  };
  return { deps, seen };
}

const reports = async () => (await env.DB.prepare("SELECT * FROM reports ORDER BY created_at").all<Report>()).results;
const triageOf = (r: Report) => JSON.parse(r.triage!) as Triage;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage;");
});

describe("report triage", () => {
  it("sorts a report, keeps what it found, and merges a report about the same problem", async () => {
    await liveGame();
    await send({ reason: "other", details: "a boss says slurs in level 3" });
    await triageReports(testEnv, ai({ severity: "high", category: "hate", summary: "Hateful words in level 3." }).deps);
    await send({ reason: "hate", details: "level 3 boss is racist" });
    const second = ai((input) => ({ severity: "high", category: "hate", same_as: input.text.match(/id ([a-z0-9]+), sent/)![1] }));
    expect(await triageReports(testEnv, second.deps)).toBe(1);

    const [first, dup] = await reports();
    expect(first).toMatchObject({ severity: 2, group_id: null, status: "open" });
    expect(triageOf(first!)).toMatchObject({ ai: true, category: "hate", summary: "Hateful words in level 3.", recommendation: "person" });
    expect(dup).toMatchObject({ severity: 2, group_id: first!.id });
    // The AI saw the earlier report, the game and what the player wrote, marked as untrusted blocks.
    expect(second.seen[0]!.text).toContain("Hateful words in level 3.");
    expect(second.seen[0]!.text).toContain('Details: "level 3 boss is racist"');
    expect(second.seen[0]!.text).toContain("Title: Test Game");
    expect(await env.DB.prepare("SELECT reports FROM ai_usage").first("reports")).toBe(2);
  });

  it("passes a bug to the developer and closes it", async () => {
    await liveGame();
    await send({ reason: "other", details: "freezes when I press jump twice" });
    await triageReports(testEnv, ai({ category: "broken", recommendation: "bug" }).deps);
    const [r] = await reports();
    expect(r).toMatchObject({ status: "actioned", bug: 1 });
    expect(triageOf(r!).actions[0]).toMatch(/developer/);
    expect(await (await SELF.fetch(`${LOCAL}/admin/reports`)).text()).toContain("Passed to developers by triage this week (1)");
  });

  it("never lets the AI read a child-safety report", async () => {
    await liveGame();
    await send({ reason: "child_safety", details: "something awful" });
    const { deps, seen } = ai({ severity: "low", recommendation: "dismiss" });
    await triageReports(testEnv, deps);
    expect(seen).toHaveLength(0);
    const [r] = await reports();
    expect(r).toMatchObject({ severity: 0, status: "open" });
    expect(triageOf(r!)).toMatchObject({ ai: false, category: "child_safety", recommendation: "person" });
  });

  it("treats child safety the AI finds in another report like a child-safety report", async () => {
    await liveGame(1); // Brand new, so the pause rule hides it.
    await send({ reason: "other", details: "a character asks kids for pictures" });
    await triageReports(testEnv, ai({ severity: "child_safety", category: "child_safety" }).deps);
    const [r] = await reports();
    expect(r).toMatchObject({ severity: 0, status: "open" });
    expect(triageOf(r!).actions).toContain("Hid the new game until a person looks");
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("held");
  });

  it("checks the game's files again once, and never takes an established game offline over it", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "malware", details: "it asks for my steam password" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    let [r] = await reports();
    expect(triageOf(r!).recheck).toEqual({ status: "waiting" });
    expect((await versionById(env.DB, versionId))?.rechecked_at).toBeTypeOf("number");
    // Nothing happens to the game until the files are checked.
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");

    await recheckVersion(testEnv, versionId, r!.id, scanSays("reject"));
    [r] = await reports();
    expect(r!.severity).toBe(1);
    expect(triageOf(r!)).toMatchObject({ recommendation: "take_down", recheck: { status: "done", decision: "rejected" } });
    // The files haven't changed since its scan: a person decides.
    expect(triageOf(r!).actions).toContain("Left the game up: it's established, so a person decides");
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");
    // The version's own scan stays as it was.
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("approved");

    // A second report can't have the same version checked again.
    await send({ reason: "malware", details: "password stealer" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    const second = (await reports())[1]!;
    expect(triageOf(second)).toMatchObject({ recommendation: "person" });
    expect(triageOf(second).recheck).toBeUndefined();
  });

  it("hides a brand-new game when the check finds a clear problem", async () => {
    const { versionId } = await liveGame(1);
    await send({ reason: "malware", details: "fake login page" });
    await triageReports(testEnv, ai({ severity: "high", category: "malware", recommendation: "recheck" }).deps);
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("reject"));
    expect(triageOf((await reports())[0]!).actions).toContain("Hid the new game until a person looks");
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("held");
  });

  it("leaves the game up when the check finds nothing, and recommends dismissing", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "sexual", details: "nudity on the title screen" });
    await triageReports(testEnv, ai({ severity: "high", category: "sexual", recommendation: "recheck" }).deps);
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("pass"));
    const [r] = await reports();
    expect(triageOf(r!)).toMatchObject({ recommendation: "dismiss", recheck: { decision: "approved" } });
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");
  });

  it("asks a person when the check finds something new that isn't clear-cut", async () => {
    const { versionId } = await liveGame();
    await send({ reason: "hate", details: "symbols on the walls" });
    await triageReports(testEnv, ai({ severity: "normal", category: "hate", recommendation: "recheck" }).deps);
    await recheckVersion(testEnv, versionId, (await reports())[0]!.id, scanSays("hold"));
    const [r] = await reports();
    expect(r!.severity).toBe(2);
    expect(triageOf(r!)).toMatchObject({ recommendation: "person", recheck: { decision: "held", findings: ["ai-test: test concern"] } });
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");
  });

  it("recommends putting back a game a wrong report paused", async () => {
    await liveGame(1);
    await send({ reason: "illegal", details: "this game is illegal because it is too hard" });
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("held");
    await triageReports(testEnv, ai({ severity: "low", category: "other", recommendation: "dismiss" }).deps);
    const [r] = await reports();
    expect(r!.severity).toBe(2); // Paused games stay near the top.
    expect(triageOf(r!).recommendation).toBe("restore");
  });

  it("leaves reports for a person when the month's AI budget is used up", async () => {
    await liveGame();
    await env.DB.prepare("UPDATE ai_usage SET input_tokens = ?").bind(999_999_999).run();
    await send({ reason: "broken", details: "black screen" });
    const { deps, seen } = ai({ recommendation: "dismiss" });
    await triageReports(testEnv, deps);
    expect(seen).toHaveLength(0);
    const [r] = await reports();
    expect(r).toMatchObject({ severity: 3, status: "open", bug: 1 });
    expect(triageOf(r!)).toMatchObject({ ai: false, recommendation: "person" });
    expect(triageOf(r!).summary).toMatch(/budget/);
  });

  it("tries again when the AI fails, then hands the report to a person", async () => {
    await liveGame();
    await send({ reason: "hate" });
    const failing: TriageDeps = { ai: async () => Promise.reject(new Error("overloaded")) };
    expect(await triageReports(testEnv, failing)).toBe(0);
    expect(await triageReports(testEnv, failing)).toBe(0);
    expect((await reports())[0]!.triaged_at).toBeNull();
    expect(await triageReports(testEnv, failing)).toBe(1);
    const [r] = await reports();
    expect(r).toMatchObject({ severity: 2, triage_tries: 3 });
    expect(triageOf(r!)).toMatchObject({ ai: false, recommendation: "person" });
  });
});

describe("the report queue", () => {
  it("shows the most serious problem first, and closes a whole group in one click", async () => {
    await liveGame();
    await send({ reason: "broken", details: "stuck on level 2" });
    await send({ reason: "broken", details: "level 2 never ends" });
    await send({ reason: "sexual", details: "nudity" });
    await triageReports(testEnv, ai((input) => (input.text.includes("nudity") ? { severity: "high", summary: "Says there's nudity." } : { summary: "Stuck on level 2.", same_as: input.text.match(/id ([a-z0-9]+), sent/)?.[1] ?? "" })).deps);

    const page = await (await SELF.fetch(`${LOCAL}/admin/reports`)).text();
    expect(page).toContain("3 open reports about 2 problems");
    expect(page.indexOf("Says there's nudity.")).toBeLessThan(page.indexOf("Stuck on level 2."));

    const head = (await reports())[0]!;
    const form = new FormData();
    form.set("back", "queue");
    form.set("reason", "Not a rule break");
    const res = await SELF.fetch(`${LOCAL}/admin/report-groups/${head.id}/dismiss`, { method: "POST", body: form, redirect: "manual" });
    expect(res.headers.get("location")).toBe("/admin/reports");
    expect((await reports()).map((r) => r.status)).toEqual(["dismissed", "dismissed", "open"]);
  });

  it("passes a group to the developer as bugs", async () => {
    await liveGame();
    await send({ reason: "other", details: "the music cuts out" });
    await triageReports(testEnv, ai({ severity: "high" }).deps);
    const form = new FormData();
    form.set("back", "queue");
    await SELF.fetch(`${LOCAL}/admin/report-groups/${(await reports())[0]!.id}/bug`, { method: "POST", body: form, redirect: "manual" });
    expect(await reports()).toMatchObject([{ status: "actioned", bug: 1 }]);
  });
});
