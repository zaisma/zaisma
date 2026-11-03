/**
 * Door contracts (docs/DOORS.md). Every way into Zaisma, of every kind, states who may call it, what it may
 * reach and what it trusts from other doors, and goes through checkDoor before its own code runs. Here, in the
 * game server package's internal part, so a room on a developer's own server goes through the same check;
 * never in the package's published index.
 */

/** Callers the door's guard proves itself, from what it read of the request or the room. */
export type DoorCallerProvenByGuard =
  /** Guests too. A door that shows a signed-in person more trusts `session` as well. */
  | "anyone"
  /** A session that works. */
  | "signed_in"
  /** A session with a finished account, and no developer ban unless the door keeps it open to them. */
  | "developer"
  /** Cloudflare Access to /admin. */
  | "admin"
  /** Anyone in the room, spectators too. */
  | "room_member"
  /** A player in the room, not a spectator. */
  | "room_player"
  /** The room's host. */
  | "room_host";

/** Callers a named function proves, because the proof takes the door's own data (a body's signature, a token's row). */
export type DoorCallerProvenByFunction =
  /** The API router: an API key's access, or a session from Zaisma's own pages. */
  | "api_caller"
  /** A tester or preview link's token in the address. */
  | "link_holder"
  /** A Sign in with Zaisma code or access token. */
  | "token_holder"
  /** Stripe or GitHub, by the signature on the body. */
  | "signed_sender"
  /** A game's own page, by the request's Origin. */
  | "game_page"
  /** A signed player pass. */
  | "pass_holder";

export type DoorCaller = DoorCallerProvenByGuard | DoorCallerProvenByFunction;

/**
 * What a door may touch. The first seven are the API's own words (ApiRoute's reaches, apps/site/src/developer.ts):
 * `account`, `player_save`, `game`, `webhook`, `sign_in_app` and `forum_topic` are the caller's own or what the caller may read,
 * and `nothing_private` is what anyone may see. The `any_` ones and `zaisma_settings` are only ever an admin's.
 */
export type DoorReach = "account" | "player_save" | "game" | "webhook" | "sign_in_app" | "forum_topic" | "nothing_private" | "any_game" | "any_account" | "zaisma_settings" | "room" | "purchase";

/** What a door takes from another door, as the security map names them (scripts/security-map/doors.mjs). */
export type DoorTrust =
  | "session"
  | "api_key"
  | "oauth_code"
  | "oauth_access"
  | "tester_link"
  | "preview_link"
  | "player_pass"
  | "admin_access"
  | "player_id"
  | "stripe_signature"
  | "github_signature"
  | "game_origin"
  | "purchase_receipt"
  | "passkey"
  | "email_code";

/** The function that proves a caller; a test checks it exists. */
export interface DoorProof {
  source_path: string;
  symbol_name: string;
}

export interface DoorContractFields {
  reaches: DoorReach;
  trusts: readonly DoorTrust[];
}

/** A caller a function proves can't be stated without naming the function, so it doesn't build. */
export type DoorContract = DoorContractFields & ({ whoMayCall: DoorCallerProvenByGuard } | { whoMayCall: DoorCallerProvenByFunction; provenBy: DoorProof });

/**
 * The one check every door goes through. `proven` is who the door's guard found the caller to be; a caller a
 * named function proves passes here, and that function refuses them, before anything else of the door runs.
 */
export function checkDoor(contract: DoorContract, proven: readonly DoorCaller[]): boolean {
  return contract.whoMayCall === "anyone" || "provenBy" in contract || proven.includes(contract.whoMayCall);
}

/** Where a door's path parts come from: `:name` parts, each a [^/]+ unless named here, and a final `*` for the rest. */
export function doorPathPattern(path: string, partPatterns: Readonly<Record<string, string>> = {}): RegExp {
  const parts = path.split("/").map((part) => {
    if (part === "*") return ".*";
    if (part.startsWith(":")) return `(?<${part.slice(1)}>${partPatterns[part.slice(1)] ?? "[^/]+"})`;
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${parts.join("/")}$`);
}
