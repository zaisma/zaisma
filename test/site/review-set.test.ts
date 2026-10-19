import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { notConnected } from "@zaisma/core";
import { scanVersion } from "../../apps/site/src/scan.ts";
import { reviewCase } from "../../apps/site/src/review-set.ts";
import type { ScanDeps } from "../../apps/site/src/scan.ts";
import { makeZip } from "../helpers.ts";

// reviewCase (the review test set's runner) mirrors the scan's steps 2 and 4. If the scan changes what it
// hands the readers or the judge, this fails until reviewCase follows.

const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };
const picture = new Uint8Array(4096).fill(7);
picture.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const files: Record<string, string | Uint8Array> = {
  "index.html": '<!doctype html><title>Drift</title><script src="game.js"></script>',
  "game.js": "top.location = 'https://example.invalid/'; const outside = 'https://cdn.example.invalid/lib.js';",
  "style.css": "body { margin: 0 }",
  "art/hero.png": picture,
};

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage;");
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((object) => object.key));
});

describe("reviewCase", () => {
  it("hands the readers and the judge what the scan hands them, and decides the same way", async () => {
    // Every call's arguments after the API key, in order; the readers list one item each, so the judge sees evidence too.
    const recorder = () => {
      const seen: unknown[] = [];
      const deps: Omit<ScanDeps, "images"> = {
        readCode: async (_key, model, chunk, context) => {
          seen.push(["readCode", model, chunk, context]);
          return { items: [{ kind: "connects_to", subject: "cdn.example.invalid", detail: "Loads a library.", path: "game.js", quote: "https://cdn.example.invalid/lib.js" }], outcome: "read", costCents: 0.1, inputTokenCount: 5, outputTokenCount: 1 };
        },
        readPictures: async (_key, model, pictures) => {
          seen.push(["readPictures", model, pictures]);
          return { items: [{ kind: "content", subject: "sexual", detail: "A suggestive picture.", path: "art/hero.png", quote: "" }], outcome: "read", costCents: 0.1, inputTokenCount: 5, outputTokenCount: 1 };
        },
        judge: async (_key, model, brief) => {
          seen.push(["judge", model, brief]);
          return { verdict: "pass", summary: "ok", findings: [], isChildSafety: false, declinedAttemptCount: 0, costCents: 1, inputTokenCount: 5, outputTokenCount: 1 };
        },
      };
      return { seen, deps };
    };
    const scan = recorder();
    const caseCalls = recorder();

    const form = new FormData();
    form.set("title", "Drift");
    form.set("slug", "drift");
    form.set("description", "A test.");
    form.set("zip", new File([makeZip(files)], "game.zip", { type: "application/zip" }));
    const upload = await SELF.fetch("http://localhost/admin/api/games", { method: "POST", body: form });
    expect(upload.status).toBe(201);
    const { versionId } = (await upload.json()) as { versionId: string };
    const report = await scanVersion(testEnv, versionId, { images: notConnected, ...scan.deps });

    const run = await reviewCase(
      testEnv,
      {
        name: "drift",
        title: "Drift",
        description: "A test.",
        is_honest: false,
        content_rule: "malware",
        protection: null,
        why: "Drift check.",
        is_private: false,
        files: Object.entries(files).map(([path, content]) => ({ path, bytes: typeof content === "string" ? new TextEncoder().encode(content) : content })),
      },
      caseCalls.deps,
    );

    expect(scan.seen.map((call) => (call as unknown[])[0])).toEqual(["readCode", "readPictures", "judge"]);
    expect(caseCalls.seen).toEqual(scan.seen);
    expect(run.decision).toBe("held");
    const staticCodes = report.findings.filter((finding) => finding.stage === "static" && finding.severity !== "info").map((finding) => finding.code);
    expect(run.finding_codes.sort()).toEqual(staticCodes.sort());
    expect(run.finding_codes).toContain("top_navigation");
  });
});
