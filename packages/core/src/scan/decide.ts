import type { Finding, ScanReport } from "../types.ts";

/** Any reject wins, then any hold; otherwise the game can go live. */
export function decide(findings: Finding[]): ScanReport["decision"] {
  if (findings.some((finding) => finding.severity === "reject")) return "rejected";
  if (findings.some((finding) => finding.severity === "hold")) return "held";
  return "approved";
}
