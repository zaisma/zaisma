export type GameStatus = "pending" | "live" | "held" | "removed";
export type ScanStatus = "scanning" | "held" | "approved" | "rejected";

export interface Game {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: GameStatus;
  current_version_id: string | null;
  /** NULL for single-player, "relay", or a built-in game server name. */
  game_server: string | null;
  /** The game's own servers, one origin per line. */
  connect_hosts: string;
  /** Who owns the game: a person now, a team later. NULL until it's assigned. */
  owner_id: string | null;
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

/** Why a player reports another player in a room. */
export const PLAYER_REPORT_REASONS = {
  harassment: "Harassing or bullying",
  hate: "Hate or threats",
  sexual: "Sexual behavior",
  cheating: "Cheating",
  other: "Something else",
} as const;
export type PlayerReportReason = keyof typeof PLAYER_REPORT_REASONS;

/** Game servers built into the rooms Worker, by the name set on a game in admin. */
export const BUILT_IN_GAME_SERVERS = ["relay", "arena", "four-in-a-row"] as const;

export const REPORT_REASONS = {
  child_safety: "Child safety",
  illegal: "Illegal content",
  malware: "Malware, scam or phishing",
  sexual: "Sexual content",
  hate: "Hate or harassment",
  copyright: "Copyright (use the DMCA page)",
  broken: "Broken or not a game",
  player: "Another player's behavior",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Reports for these reasons hide the game until it's reviewed. */
export const AUTO_HOLD_REASONS: ReportReason[] = ["child_safety", "illegal"];
