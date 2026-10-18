import type { Finding, ImageMatcher } from "@zaisma/core";
import type { ScanDeps } from "../../apps/site/src/scan.ts";
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
    declinedAttemptCount: 0,
    costCents: 1,
    inputTokenCount: 100,
    outputTokenCount: 10,
  });

/** Image matching connected and finding nothing, readers that find nothing, and a judge that passes. */
export const passingScanDeps = (overrides: Partial<ScanDeps> = {}): ScanDeps => ({ images: connectedImages, readCode: readsNothing, readPictures: seesNothing, judge: judgeSays("pass"), ...overrides });
