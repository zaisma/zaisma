import type { Finding, ImageMatcher } from "@zaisma/core";
import { moveAiReviewOn, scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import type { Env } from "../../apps/site/src/env.ts";
import type { ScanReport } from "@zaisma/core";
import type { JudgeVersion } from "../../apps/site/src/review-judge.ts";
import type { ReadCode, ReadPictures } from "../../apps/site/src/review-readers.ts";

/** Stand-ins for the game review's readers and judge, so scans in tests never call a model. */

export const connectedImages: ImageMatcher = { check: async (media) => ({ provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [] }) };

/** Readers that find nothing to list. */
export const readsNothing: ReadCode = async () => ({ items: [], outcome: "read", costCents: 0.01, inputTokenCount: 10, outputTokenCount: 1 });
export const seesNothing: ReadPictures = async () => ({ items: [], outcome: "read", costCents: 0.01, inputTokenCount: 10, outputTokenCount: 1 });

/** A judge with a fixed answer. A hold or reject with no findings gets ai_concern, as the real judge's does. */
export const judgeSays =
  (verdict: "pass" | "hold" | "reject", findings: Finding[] = [], isChildSafety = false): JudgeVersion =>
  async () => ({
    verdict,
    summary: "A platformer.",
    findings: verdict !== "pass" && findings.length === 0 ? [{ stage: "ai", severity: verdict, code: "ai_concern", message: "A platformer." }] : findings,
    isChildSafety,
    followedReviewPrecedentNumbers: [],
    declinedAttemptCount: 0,
    costCents: 1,
    inputTokenCount: 100,
    outputTokenCount: 10,
  });

/** Image matching connected and finding nothing, readers that find nothing, and a judge that passes. */
export const passingScanDeps = (overrides: Partial<ScanDeps> = {}): ScanDeps => ({ images: connectedImages, readCode: readsNothing, readPictures: seesNothing, judge: judgeSays("pass"), ...overrides });

/** A scan and the AI review behind it, run at once to the end, whoever the developer and whatever the game: for what a review decides, not who waits for it. */
export async function reviewedScan(env: Env, versionId: string, deps: ScanDeps): Promise<ScanReport> {
  const scanned = await scanVersion(env, versionId, deps);
  await env.DB.prepare("UPDATE versions SET ai_review_status = 'waiting', ai_review_speed = 'at_once', ai_review_requested_at_ms = COALESCE(ai_review_requested_at_ms, ?) WHERE id = ? AND scan_status = 'approved' AND ai_review_status IN ('not_started', 'waiting')").bind(Date.now(), versionId).run();
  await moveAiReviewOn(env, versionId, deps);
  const version = await env.DB.prepare("SELECT scan_report FROM versions WHERE id = ?").bind(versionId).first<{ scan_report: string | null }>();
  return version?.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : scanned;
}
