import type { FindingCode } from "./review.ts";
import type { EvidenceItem } from "./review-evidence.ts";
import { ownServerUrlsOf } from "./own-servers.ts";

/** Zaisma's review of a game, separate from its visibility: no version has passed yet, live, paused while checked, or taken down. */
export type ReviewStatus = "pending" | "live" | "held" | "removed";
export type Visibility = "draft" | "listed" | "unlisted" | "private";
/** Where a game's rooms are listed: the game page and inside the game, only inside the game, or nowhere. */
export const ROOM_BROWSING = ["page", "game", "off"] as const;
export type RoomBrowsing = (typeof ROOM_BROWSING)[number];
/** What a game needs a Zaisma account for: nothing (guests welcome), multiplayer (guests play alone) or the whole game. */
export const ACCOUNT_REQUIREMENTS = ["none", "multiplayer", "whole_game"] as const;
export type AccountRequirement = (typeof ACCOUNT_REQUIREMENTS)[number];
/** The youngest age that can play a game, in years: 13 (everyone), 16 or 18. Above 13 the whole game needs an account. */
export const MINIMUM_PLAYER_AGES = [13, 16, 18] as const;
export type MinimumPlayerAge = (typeof MINIMUM_PLAYER_AGES)[number];
export type ScanStatus = "scanning" | "held" | "approved" | "rejected";

/** A row of the games table: the same names the developer API shows (docs/NAMING.md). */
export interface Game {
  id: string;
  slug: string;
  title: string;
  description: string;
  review_status: ReviewStatus;
  /** Why it's held or removed, as JSON (a ReviewReason); NULL while it's pending or live. */
  review_reason: string | null;
  live_version_id: string | null;
  /** Multiplayer on Zaisma rooms (see MULTIPLAYER_MODES). */
  multiplayer_mode: MultiplayerMode;
  /** Which of Zaisma's own game servers it runs, when multiplayer_mode is "built-in". */
  built_in_server: string | null;
  /** The game's own servers players' browsers connect to, a JSON list like ["wss://play.example.com"]; set by the developer. */
  own_server_urls: string;
  /** Who owns the game: a person now, a team later. NULL until it's assigned. */
  owner_id: string | null;
  /** 1 when signed-in players' browser saves are copied to their account. */
  cloud_saves_enabled: number;
  /** 1 when guests with progress get the "Keep your progress" card offering an account. */
  account_offer_enabled: number;
  /** 1 when Zaisma erases a player who deletes their account from the game's database (rows whose player_id is theirs). */
  deleted_account_erase_enabled: number;
  /** 1 when Zaisma's Join (friends on zaisma.com, Zaisma.friends) takes players into its rooms; 0 grays it as "This game doesn't take joins". */
  friend_joins_enabled: number;
  /** When a player last came into one of its rooms through quickJoin, so its Rooms tab can say Play finds you one; NULL when none has. */
  quick_joined_at_ms: number | null;
  /** The hosts its game server may call (game server reach), a JSON list like ["discord.com", "*.example.com"]. */
  game_server_allowed_hosts: string;
  /** Its registered links, a JSON list of GameLink (links.ts). */
  links: string;
  /** When its links' sites were last checked against Cloudflare's malware and phishing list; NULL when they're waiting for a check. */
  links_checked_at_ms: number | null;
  /** When its secrets last changed, so running rooms read them again; NULL when it never had any. */
  secrets_changed_at_ms: number | null;
  /** The developer's choice; separate from review_status, which is ours. */
  visibility: Visibility;
  /** Device labels, comma-separated (see DEVICES, CONTROLS, SCREENS). */
  devices: string;
  controls: string;
  screen_orientation: string;
  /** How it's played: a list of PlayMode as JSON, or '' when the developer hasn't said. */
  play_modes: string;
  /** Where its rooms on Zaisma are listed. */
  room_browsing: RoomBrowsing;
  /** What it needs a Zaisma account for; guests get no player passes unless it's none. */
  account_requirement: AccountRequirement;
  /** The youngest age that can play, in years; younger accounts can't find or open it. Above 13 it's accounts only. */
  minimum_player_age_years: MinimumPlayerAge;
  /** The key behind the game entry to its public address when it's accounts only (game-access.ts). Internal: never in an answer. */
  entry_signing_key: string;
  /** 1 when Zaisma keeps it off Popular, Trending and New (faked plays, or while a spike is checked). */
  is_off_shelves: number;
  /** A new title or description waiting for review, as JSON, for games players can already see. */
  details_waiting_for_review: string | null;
  /** Why the title keeps the game off lists ("No slop"), as JSON (a ReviewReason); NULL when none. */
  title_listing_reason: string | null;
  /** The title a person cleared: the listing check leaves the title alone while it's this. */
  cleared_title: string | null;
  /** When a change last asked for the listing check (listing-check.ts), and when it last ran; NULL when never. */
  listing_check_requested_at_ms: number | null;
  listing_checked_at_ms: number | null;
  /** The color Zaisma tints its glass with over the game's background, as #RRGGBB; NULL for none. */
  glass_tint_color: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

/** A row of the versions table: the same names the developer API shows. */
export interface Version {
  id: string;
  game_id: string;
  r2_prefix: string;
  file_count: number;
  size_bytes: number;
  scan_status: ScanStatus;
  scan_report: string | null;
  /** A person's decision about it, as JSON (a ReviewReason): why they rejected it. What the scan found is in scan_report. */
  review_reason: string | null;
  /** "zip": files under r2_prefix. "files": uploaded file by file, listed in a manifest. */
  kind: "zip" | "files";
  patch_notes: string;
  /** 1 when it goes live by itself as soon as it passes review. */
  publish_when_approved_enabled: number;
  /** Publish later: when this draft goes live by itself. */
  scheduled_publish_at_ms: number | null;
  /** The key this version's preview links are made with (apps/site/src/preview-links.ts); a new one ends every link made so far. Null until it passes. */
  preview_link_key: string | null;
  published_at_ms: number | null;
  created_at_ms: number;
  /** When a child-safety or illegal-content report paused this version, until a person looks. */
  report_held_at_ms: number | null;
  /** When reports stopped pausing this version: a person checked it, or a report already went back to it. */
  cleared_at_ms: number | null;
  /** When report triage had this version's files checked again. Once per version. */
  rechecked_at_ms: number | null;
  /** The newer version of the game that replaced this one while it waited for review; null when none did. */
  replaced_by_version_id: string | null;
  /** When this version's small review ran (its reads called the reader model); null when nothing was read. */
  read_at_ms: number | null;
}

export type Severity = "reject" | "hold" | "info";

/** Something a scan found in a version's files (stored in ScanReport.findings). */
export interface Finding {
  stage: "static" | "images" | "ai";
  severity: Severity;
  /** Which problem: a code from REVIEW_CODES, or one only Zaisma sees (INTERNAL_FINDING_CODES). */
  code: FindingCode;
  /** What was found, for a person at Zaisma; the developer reads it only for codes with their own message. */
  message: string;
  path?: string;
  /** From the AI reviewer: a short exact quote from the file at path that shows the problem. */
  quote?: string;
}

/** A version's scan result (versions.scan_report): stored JSON, so snake_case all the way down. */
export interface ScanReport {
  finished_at_ms: number;
  decision: "approved" | "held" | "rejected";
  findings: Finding[];
  outside_hosts: string[];
  /** Image matching: pictures and videos checked against known abuse material. */
  images: {
    provider: string;
    is_connected: boolean;
    checked_media_count: number;
    /** Pictures and videos cleared in the last 30 days (checked_files) and not sent again. Absent on reports from before migration 0088. */
    reused_media_count?: number;
  };
  ai: ReviewAi | LegacyReviewAi | null;
  /** Child-safety signal: hold, never delete, alert Julius (NCMEC reporting duty). */
  is_child_safety: boolean;
  /** What the checks and readers found, numbered as the judge saw them. Absent on reports from before evidence (migration 0075). */
  evidence?: EvidenceItem[];
  /** The files (and pictures) the readers read, so the next version re-reads only what changed. */
  read_file_sha256s?: string[];
  /** Another developer's game most of this version's files come from (matches_another_developers_game). For Zaisma's eyes only: the developer is never told which game. */
  matched_game?: { game_id: string; matched_file_count: number; compared_file_count: number };
}

/** The AI review in a scan report: readers, then one judge. */
export interface ReviewAi {
  judge_model: string;
  reader_model: string;
  /** reused: a tweak of a version that passed, so the judge wasn't asked again. skipped: no AI review ran. */
  verdict: "pass" | "hold" | "reject" | "skipped" | "reused";
  reused_from_version_id: string | null;
  summary: string;
  /** The review precedents the judge followed (migrations/0093_review_precedents.sql); absent when none. */
  followed_review_precedent_ids?: string[];
  /** Its reads called the reader model, so it counted as one of the developer's small reviews. Absent when nothing was read, on re-checks and before migration 0104. */
  is_small_review?: boolean;
  cost_cents: number;
  input_token_count: number;
  output_token_count: number;
}

/** The AI review in reports from before evidence came first: one model read the code and judged. */
export interface LegacyReviewAi {
  model: string;
  verdict: "pass" | "hold" | "reject" | "skipped";
  summary: string;
  input_token_count: number;
  output_token_count: number;
}

/** The model that decided a report's AI verdict, whichever shape the report has. */
export const reviewModelOf = (ai: ReviewAi | LegacyReviewAi): string => ("judge_model" in ai ? ai.judge_model : ai.model);

export interface ScanJob {
  versionId: string;
  /** Look at a live version's files again after a report (AI report triage). Never publishes or changes the version. */
  recheck?: { reportId: string };
  /** Image matching on a version that already passed (before matching was connected). Takes it off only on a match. */
  isImageRecheck?: true;
}

/** The listing check on a game's covers, screenshots and words ("No slop"), on the scan queue beside ScanJob. */
export interface ListingCheckJob {
  listingCheckGameId: string;
}

/** The shader check on one shader a game sent for its background (apps/site/src/shader-check.ts), on the scan queue too. */
export interface ShaderCheckJob {
  shaderCheckId: string;
}

/** Why a player reports another player in a room. */
export const PLAYER_REPORT_REASONS = {
  real_life_threat: "Threatening them in real life",
  personal_details: "Sharing someone's personal details",
  following_after_block: "Following me after I blocked them",
  sexual: "Sexual behavior",
  harassment: "Harassing or bullying",
  cheating: "Cheating",
  other: "Something else",
} as const;
export type PlayerReportReason = keyof typeof PLAYER_REPORT_REASONS;

/**
 * The player reports Zaisma itself looks at (docs/DECISIONS.md, "Zaisma steps into players' chat only
 * where block can't help"). Every sexual one, since nothing about the reporter is kept to say whether it
 * was toward a teen. The rest go to the game's developer, with mute and block.
 */
export const ZAISMA_PLAYER_REPORT_REASONS = ["real_life_threat", "personal_details", "following_after_block", "sexual"] as const satisfies readonly PlayerReportReason[];
export type ZaismaPlayerReportReason = (typeof ZAISMA_PLAYER_REPORT_REASONS)[number];
export const isForZaisma = (playerReason: string): playerReason is ZaismaPlayerReportReason => (ZAISMA_PLAYER_REPORT_REASONS as readonly string[]).includes(playerReason);

/** A room with players in it (migrations/0015_live_rooms.sql, 0034). */
export interface LiveRoom {
  game_id: string;
  room_code: string;
  /** Players in the match who haven't walked away. */
  player_count: number;
  /** Seats held for players out of the match for now, or on their way (migrations/0025_held_seats.sql). */
  held_seat_count: number;
  maximum_player_count: number;
  is_listed: number;
  is_open: number;
  /** 1 when Zaisma's Join offers the room; 0 grays it as "Private room" (room.setFriendJoinsEnabled). */
  friend_joins_enabled: number;
  name: string | null;
  /** JSON, like {"Mode": "Classic"}. */
  labels: string;
  /** 1: a person hid the name and labels after a report. */
  is_name_hidden: number;
  country: string | null;
  continent: string | null;
  created_at_ms: number;
  updated_at_ms: number;
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
export const SERVER_FOLDER = "zaisma-server/";
export const SERVER_ENTRY = "zaisma-server/index.js";

export function isServerPath(path: string): boolean {
  return path === SERVER_FILE || path.startsWith(SERVER_FOLDER);
}

/**
 * Multiplayer as developers set it: none, the relay, or their own game server (zaisma-server.js,
 * run in a sandbox on our rooms). "built-in" is one of ours (built_in_server), set in admin; developers can't pick it.
 */
export const MULTIPLAYER_MODES = ["none", "relay", "own"] as const;
export type MultiplayerMode = (typeof MULTIPLAYER_MODES)[number] | "built-in";

/**
 * Whether a game plays online with Zaisma's player passes, on Zaisma rooms or its own servers: the game
 * page gives it a key to passes, and to relay credentials for connections between players.
 */
export const playsOnline = (game: Pick<Game, "multiplayer_mode" | "own_server_urls">) => game.multiplayer_mode !== "none" || ownServerUrlsOf(game).length > 0;

/** The game server a game's rooms run: the relay, its own (in the sandbox), one built into Zaisma, or none. */
export function gameServerOf(game: Pick<Game, "multiplayer_mode" | "built_in_server">): string | null {
  if (game.multiplayer_mode === "relay") return "relay";
  if (game.multiplayer_mode === "own") return SANDBOX_GAME_SERVER;
  if (game.multiplayer_mode === "built-in") return game.built_in_server;
  return null;
}

export const REPORT_REASONS = {
  child_safety: "Child safety",
  illegal: "Illegal content",
  malware: "Malware, scam or phishing",
  sexual: "Sexual content",
  real_people: "Private details or threats",
  copyright: "Copyright (use the DMCA page)",
  broken: "Broken or not a game",
  player: "Another player's behavior",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** How serious a report is, most serious first: reports.severity_index is the index. */
export const SEVERITIES = ["Child safety", "Urgent", "High", "Normal", "Low"] as const;
export const SEVERITY = { child_safety: 0, urgent: 1, high: 2, normal: 3, low: 4 } as const;
export type ReportSeverity = keyof typeof SEVERITY;
/** The same, as the admin MCP says it: reports.severity_index is the index. */
export const REPORT_SEVERITIES = Object.keys(SEVERITY) as ReportSeverity[];

/** What AI report triage found and did about a report (reports.triage): stored JSON, in the admin MCP's words. */
export interface Triage {
  /** False when no AI read it: a child-safety report, or AI review isn't available. */
  is_by_ai: boolean;
  /** What the report is really about, whatever reason the player picked. */
  category: ReportReason;
  /** For the person reviewing it, in a sentence or two. */
  summary: string;
  /** What a person should do; "recheck" is done automatically. */
  recommendation: "dismiss" | "bug" | "recheck" | "person" | "take_down" | "restore" | "pass_to_developer" | "stop_social";
  why: string;
  /** What triage did by itself, in plain words. */
  ai_actions: string[];
  /** A fresh look at the reported version's files, asked for by triage. */
  recheck?: { recheck_status: "waiting" | "done" | "failed"; scan_status?: ScanStatus; summary?: string; findings?: string[] };
  /** The precedent the case fits, or challenges. */
  precedent?: { id: string; title: string; fit: "fits" | "challenges" };
  /** When no precedent fits, or the case challenges one: the ruling the AI proposes for a person. */
  precedent_draft?: { title: string; applies_when: string; decision: PrecedentDecision; why: string };
  /** The AI would have decided this alone under a precedent; kept for a person as a spot-check. */
  is_spot_check?: boolean;
}

/** What a precedent decides. Bugs and re-checks always happen automatically; takedowns never do. */
export const PRECEDENT_DECISIONS = {
  dismiss: "Dismiss",
  bug: "Tell the developer",
  recheck: "Check the game's files again",
  take_down: "Take the game down",
  pass_to_developer: "Pass to the game's developer",
  stop_social: "Turn off their social side",
} as const;
export type PrecedentDecision = keyof typeof PRECEDENT_DECISIONS;

/** proposed (waiting for a person), active (in force) or retired. */
export const PRECEDENT_STATUSES = ["proposed", "active", "retired"] as const;
export type PrecedentStatus = (typeof PRECEDENT_STATUSES)[number];

/** A ruling a person made on a report, which report triage follows (migrations/0014_precedents.sql, 0033). */
export interface Precedent {
  id: string;
  title: string;
  applies_when: string;
  decision: PrecedentDecision;
  why: string;
  /** 1: the AI may apply it by itself. Dismissals only. */
  can_ai_apply_alone: number;
  precedent_status: PrecedentStatus;
  /** The precedent this one changed, and the report group it was set while deciding. */
  replaces_precedent_id: string | null;
  from_report_group_id: string | null;
  created_by: string;
  created_at_ms: number;
  updated_at_ms: number;
}

/** Reports for these reasons hide the game until it's reviewed. */
export const AUTO_HOLD_REASONS: ReportReason[] = ["child_safety", "illegal"];
