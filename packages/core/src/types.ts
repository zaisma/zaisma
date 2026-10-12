export type GameStatus = "pending" | "live" | "held" | "removed";
export type ScanStatus = "scanning" | "held" | "approved" | "rejected";

export interface Game {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: GameStatus;
  current_version_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Version {
  id: string;
  game_id: string;
  r2_prefix: string;
  file_count: number;
  bytes: number;
  scan_status: ScanStatus;
  scan_report: string | null;
  created_at: number;
}

export type Severity = "reject" | "hold" | "info";

export interface Finding {
  stage: "static" | "images" | "ai";
  severity: Severity;
  rule: string;
  detail: string;
  path?: string;
}

export interface ScanReport {
  finishedAt: number;
  decision: "approved" | "held" | "rejected";
  findings: Finding[];
  outsideHosts: string[];
  images: { provider: string; connected: boolean; checked: number };
  ai: { model: string; verdict: "pass" | "hold" | "reject" | "skipped"; summary: string; inputTokens: number; outputTokens: number } | null;
  /** Child-safety signal: hold, never delete, alert Julius (NCMEC reporting duty). */
  childSafety: boolean;
}

export interface ScanJob {
  versionId: string;
}

export const REPORT_REASONS = {
  child_safety: "Child safety",
  illegal: "Illegal content",
  malware: "Malware, scam or phishing",
  sexual: "Sexual content",
  hate: "Hate or harassment",
  copyright: "Copyright (use the DMCA page)",
  broken: "Broken or not a game",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Reports for these reasons hide the game until it's reviewed. */
export const AUTO_HOLD_REASONS: ReportReason[] = ["child_safety", "illegal"];
