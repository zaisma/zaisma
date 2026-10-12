import type { Finding, ScanReport } from "../types.ts";

/** Any reject wins, then any hold; otherwise the game can go live. */
export function decide(findings: Finding[]): ScanReport["decision"] {
  if (findings.some((f) => f.severity === "reject")) return "rejected";
  if (findings.some((f) => f.severity === "hold")) return "held";
  return "approved";
}
