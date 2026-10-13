export type GameStatus = "pending" | "live" | "held" | "removed";
export type Visibility = "draft" | "listed" | "unlisted" | "private";
/** Where a game's rooms are listed: the game page and inside the game, only inside the game, or nowhere. */
export const ROOM_BROWSING = ["page", "game", "off"] as const;
export type RoomBrowsing = (typeof ROOM_BROWSING)[number];
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
  /** 1 when signed-in players' browser saves are copied to their account. */
  cloud_saves: number;
  /** The developer's choice; separate from status, which is ours. */
  visibility: Visibility;
  /** Device labels, comma-separated (see DEVICES, CONTROLS, SCREENS). */
  devices: string;
  controls: string;
  screen: string;
  /** How it's played (Players as JSON), or '' when the developer hasn't said. */
  players: string;
  /** Where its rooms on Zaisma are listed. */
  room_browsing: RoomBrowsing;
  /** A new title or description waiting for review, as JSON, for games players can already see. */
  details_draft: string | null;
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
  /** "zip": files under r2_prefix. "files": uploaded file by file, listed in a manifest. */
  kind: "zip" | "files";
  notes: string;
  publish_when_approved: number;
  /** Publish later: when this draft goes live by itself. */
  publish_at: number | null;
  preview_token: string | null;
  published_at: number | null;
  created_at: number;
  /** When a child-safety or illegal-content report paused this version, until a person looks. */
  report_held_at: number | null;
  /** When reports stopped pausing this version: a person checked it, or a report already went back to it. */
  cleared_at: number | null;
  /** When report triage had this version's files checked again. Once per version. */
  rechecked_at: number | null;
}

export type Severity = "reject" | "hold" | "info";

export interface Finding {
  stage: "static" | "images" | "ai";
  severity: Severity;
  rule: string;
  detail: string;
  path?: string;
  /** From the AI reviewer: a short exact quote from the file at path that shows the problem. */
  quote?: string;
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
  /** Look at a live version's files again after a report (AI report triage). Never publishes or changes the version. */
  recheck?: { reportId: string };
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

/** A room with players in it (migrations/0015_live_rooms.sql). */
export interface LiveRoom {
  game_id: string;
  code: string;
  players: number;
  max_players: number;
  listed: number;
  open: number;
  name: string | null;
  /** JSON, like {"Mode": "Classic"}. */
  labels: string;
  /** 1: a person hid the name and labels after a report. */
  name_hidden: number;
  country: string | null;
  continent: string | null;
  created_at: number;
  updated_at: number;
}

/** Rooms check in every hour, so a row older than this belongs to a room that stopped. */
export const ROOM_STALE_MS = 2 * 3600 * 1000;

/** The continents a room can run in, by Cloudflare's codes. */
export const CONTINENTS: Record<string, string> = { AF: "Africa", AN: "Antarctica", AS: "Asia", EU: "Europe", NA: "North America", OC: "Oceania", SA: "South America" };

/** Game servers built into the rooms Worker, by the name set on a game in admin. */
export const BUILT_IN_GAME_SERVERS = ["relay", "arena", "four-in-a-row"] as const;
/** The game server setting for a game that runs its own (its zaisma-server.js) in a sandbox on our rooms. */
export const SANDBOX_GAME_SERVER = "sandbox";
/**
 * A game's own game server, in its upload: a zaisma-server/ folder whose index.js may import the
 * folder's other .js files, or one zaisma-server.js file. Never served to players.
 */
export const SERVER_FILE = "zaisma-server.js";
export const SERVER_DIR = "zaisma-server/";
export const SERVER_ENTRY = "zaisma-server/index.js";

export function isServerPath(path: string): boolean {
  return path === SERVER_FILE || path.startsWith(SERVER_DIR);
}

/**
 * Multiplayer as developers set it: none, the relay, or their own game server (zaisma-server.js,
 * run in a sandbox on our rooms). "built-in" is one of ours, set in admin; developers can't pick it.
 */
export const MULTIPLAYER = ["none", "relay", "own"] as const;
export type Multiplayer = (typeof MULTIPLAYER)[number] | "built-in";

export function multiplayerOf(gameServer: string | null): Multiplayer {
  return gameServer === null ? "none" : gameServer === "relay" ? "relay" : gameServer === SANDBOX_GAME_SERVER ? "own" : "built-in";
}

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

/** How serious a report is, most serious first: reports.severity is the index. */
export const SEVERITIES = ["Child safety", "Urgent", "High", "Normal", "Low"] as const;
export const SEVERITY = { child_safety: 0, urgent: 1, high: 2, normal: 3, low: 4 } as const;
export type ReportSeverity = keyof typeof SEVERITY;

/** What AI report triage found and did about a report (reports.triage). */
export interface Triage {
  /** False when no AI read it: a child-safety report, or AI review isn't available. */
  ai: boolean;
  /** What the report is really about, whatever reason the player picked. */
  category: ReportReason;
  /** For the person reviewing it, in a sentence or two. */
  summary: string;
  /** What a person should do; "recheck" is done automatically. */
  recommendation: "dismiss" | "bug" | "recheck" | "person" | "take_down" | "restore";
  why: string;
  /** What triage did by itself, in plain words. */
  actions: string[];
  /** A fresh look at the reported version's files, asked for by triage. */
  recheck?: { status: "waiting" | "done" | "failed"; decision?: ScanStatus; summary?: string; findings?: string[] };
  /** The precedent the case fits, or challenges. */
  precedent?: { id: string; title: string; fit: "fits" | "challenges" };
  /** When no precedent fits, or the case challenges one: the ruling the AI proposes for a person. */
  draft?: { title: string; applies_when: string; decision: PrecedentDecision; why: string };
  /** The AI would have decided this alone under a precedent; kept for a person as a spot-check. */
  spot_check?: boolean;
}

/** What a precedent decides. Bugs and re-checks always happen automatically; takedowns never do. */
export const PRECEDENT_DECISIONS = {
  dismiss: "Dismiss",
  bug: "Tell the developer",
  recheck: "Check the game's files again",
  take_down: "Take the game down",
} as const;
export type PrecedentDecision = keyof typeof PRECEDENT_DECISIONS;

/** A ruling a person made on a report, which report triage follows (migrations/0014_precedents.sql). */
export interface Precedent {
  id: string;
  title: string;
  applies_when: string;
  decision: PrecedentDecision;
  why: string;
  /** 1: the AI may apply it by itself. Dismissals only. */
  ai_alone: number;
  status: "proposed" | "active" | "retired";
  replaces: string | null;
  from_report: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/** Reports for these reasons hide the game until it's reviewed. */
export const AUTO_HOLD_REASONS: ReportReason[] = ["child_safety", "illegal"];
