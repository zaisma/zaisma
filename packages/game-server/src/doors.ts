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

/**
 * What a door takes or answers, as the small part of JSON Schema Zaisma's schemas use. Written with the helpers below,
 * and every value a door takes has its bound in its type, so "accepts anything" can't be stated. Only a game's own
 * data goes by size alone, at the caps it has.
 */
export type DoorShape =
  | { type: "string"; maxLength: number; pattern?: string; enum?: readonly string[] }
  | { type: "integer" | "number"; minimum: number; maximum: number; enum?: readonly number[] }
  | { type: "boolean" }
  | { type: "null" }
  | { type: "array"; items: DoorShape; maxItems: number; minItems?: number }
  | { type: "object"; properties: Readonly<Record<string, DoorShape>>; required: readonly string[]; additionalProperties: false }
  | { anyOf: readonly DoorShape[] }
  /** A game's own data, of any shape: its size only, in characters of its JSON. */
  | { isGameData: true; maximumSizeBytes: number };

const LARGEST_INTEGER = Number.MAX_SAFE_INTEGER;

export const text = (maximumCharacterCount: number, pattern?: string): DoorShape => ({ type: "string", maxLength: maximumCharacterCount, ...(pattern ? { pattern } : {}) });
export const oneOfWords = (...words: readonly string[]): DoorShape => ({ type: "string", maxLength: Math.max(...words.map((word) => word.length)), enum: words });
export const integer = (minimum = 0, maximum = LARGEST_INTEGER): DoorShape => ({ type: "integer", minimum, maximum });
export const realNumber = (minimum: number, maximum: number): DoorShape => ({ type: "number", minimum, maximum });
export const yesOrNo: DoorShape = { type: "boolean" };
export const orNothing = (shape: DoorShape): DoorShape => ({ anyOf: [shape, { type: "null" }] });
export const anyOf = (...shapes: readonly DoorShape[]): DoorShape => ({ anyOf: shapes });
export const listOf = (items: DoorShape, maximumItemCount: number, minimumItemCount = 0): DoorShape => ({ type: "array", items, maxItems: maximumItemCount, ...(minimumItemCount ? { minItems: minimumItemCount } : {}) });
/** A closed object: these fields and no others, the required ones named. */
export const fieldsOf = (properties: Readonly<Record<string, DoorShape>>, required: readonly string[] = []): DoorShape => ({ type: "object", properties, required, additionalProperties: false });
export const gameData = (maximumSizeBytes: number): DoorShape => ({ isGameData: true, maximumSizeBytes });

/** A door's body, when it takes one. maximumSizeBytes is checked before any of it is read; raw bytes go by size alone, and the door reads them itself. */
export type DoorBody =
  | { kind: "json"; fields: Readonly<Record<string, DoorShape>>; required?: readonly string[]; maximumSizeBytes: number; isOptional?: true }
  | { kind: "form"; fields: Readonly<Record<string, DoorShape>>; fileNames?: readonly string[]; maximumSizeBytes: number }
  | { kind: "bytes"; maximumSizeBytes: number };

/** What a door takes: its query's names and its body. A query's values arrive as text: integer and boolean shapes read theirs. */
export interface DoorTakes {
  query: Readonly<Record<string, DoorShape>>;
  body: DoorBody | null;
}

/** Nothing: a door with no query it reads and no body. */
export const TAKES_NOTHING: DoorTakes = { query: {}, body: null };

/** What a door answers: a JSON schema, checked on live requests and cut to what it declares, or a kind with nothing to cut. */
export type DoorAnswer = { kind: "json"; schema: Readonly<Record<string, unknown>> } | { kind: "page" | "empty" | "redirect" | "file" | "bytes" };

export const ANSWERS_PAGE: DoorAnswer = { kind: "page" };
export const ANSWERS_EMPTY: DoorAnswer = { kind: "empty" };
export const ANSWERS_REDIRECT: DoorAnswer = { kind: "redirect" };
export const ANSWERS_FILE: DoorAnswer = { kind: "file" };
export const ANSWERS_BYTES: DoorAnswer = { kind: "bytes" };
export const answersJson = (schema: Readonly<Record<string, unknown>>): DoorAnswer => ({ kind: "json", schema });

/** A door's limit in calls a minute, from this short list. Each is a rate limit binding in the Workers that use it: LIMIT_<LEVEL>. */
export const DOOR_LIMIT_LEVELS = { very_rare: 2, guess: 5, rare: 10, steady: 30, busy: 120, building: 1000 } as const;
export type DoorLimitLevel = keyof typeof DOOR_LIMIT_LEVELS;

/** Why a door has no limit of its own: from this list only, and the daily review reads every door that gives one. */
export const DOOR_NO_LIMIT_REASONS = {
  answers_from_memory: "It answers fixed bytes from memory and reads nothing.",
  cached_file: "It serves a file Cloudflare caches, with no database behind it and no egress fee.",
  admin_only: "Cloudflare Access stands in front of it, and only Zaisma's own people get through.",
  signed_by_sender: "It reads nothing until the sender's signature on the body checks out.",
  counted_by_its_call: "All it does is make calls that have their own limit.",
  room_token_bucket: "A room's message bucket takes a token for each message, per player, before any door runs.",
} as const;
export type DoorNoLimitReason = keyof typeof DOOR_NO_LIMIT_REASONS;

/**
 * How much a door can be used. A limit counts the player, the account or the game wherever Zaisma knows it, and an
 * address only before it knows, at the level a whole building clears, so 25 players on one school's wifi play like
 * anyone. group shares one counter between doors; with none, each door counts on its own.
 */
export type DoorLimit =
  | { level: DoorLimitLevel; counts: "player" | "account" | "game"; group?: string }
  | { level: "building"; counts: "address"; group?: string }
  | { whyNoLimit: DoorNoLimitReason };

export interface DoorContractFields {
  reaches: DoorReach;
  trusts: readonly DoorTrust[];
  takes: DoorTakes;
  answers: DoorAnswer;
  limit: DoorLimit;
}

/** A caller a function proves can't be stated without naming the function, so it doesn't build. */
export type DoorContract = DoorContractFields & ({ whoMayCall: DoorCallerProvenByGuard } | { whoMayCall: DoorCallerProvenByFunction; provenBy: DoorProof });

/** A Worker's rate limit bindings, by level. A self-hosted room has none, and a missing one lets the call through. */
export type DoorLimitBindings = { [Level in DoorLimitLevel as `LIMIT_${Uppercase<Level>}`]?: { limit(options: { key: string }): Promise<{ success: boolean }> } };

/** Whether a call goes past a level's limit: door's own counter, for one subject. Keys never leave Cloudflare's counter. */
export async function isPastLevel(env: DoorLimitBindings, level: DoorLimitLevel, counterName: string, subject: string): Promise<boolean> {
  const binding = env[`LIMIT_${level.toUpperCase()}` as keyof DoorLimitBindings];
  return binding ? !(await binding.limit({ key: `${counterName}:${subject}` })).success : false;
}

/** Whether a call goes past a door's limit. doorName names its counter unless its limit shares a group. */
export async function isPastDoorLimit(env: DoorLimitBindings, limit: DoorLimit, doorName: string, subject: string): Promise<boolean> {
  return "whyNoLimit" in limit ? false : isPastLevel(env, limit.level, limit.group ?? doorName, subject);
}

/** A pattern once compiled: shapes check on every call. */
const compiledPatterns = new Map<string, RegExp>();
function compiled(pattern: string): RegExp {
  let found = compiledPatterns.get(pattern);
  if (!found) compiledPatterns.set(pattern, (found = new RegExp(pattern)));
  return found;
}

type Schema = Readonly<Record<string, unknown>>;

const typesOf = (schema: Schema): readonly string[] => {
  const { type } = schema;
  if (Array.isArray(type)) return type as string[];
  if (typeof type === "string") return [type];
  if (Array.isArray(schema.enum)) return [...new Set((schema.enum as unknown[]).map((value) => (value === null ? "null" : typeof value)))];
  return [];
};

/** Where a value doesn't match its shape or schema, as "path: problem" lines; [] when it fits. Answers and inputs both come here. */
export function schemaProblems(schema: Schema, value: unknown, path = "answer"): string[] {
  // anyOf: it fits when one of them fits; otherwise say how it misses the nearest.
  if (Array.isArray(schema.anyOf)) {
    const misses = (schema.anyOf as Schema[]).map((option) => schemaProblems(option, value, path));
    return misses.some((problems) => problems.length === 0) ? [] : misses.sort((first, second) => first.length - second.length)[0]!;
  }
  if (schema.isGameData === true) {
    const sizeBytes = JSON.stringify(value)?.length ?? 0;
    return sizeBytes > (schema.maximumSizeBytes as number) ? [`${path}: over ${schema.maximumSizeBytes as number} bytes`] : [];
  }
  const out: string[] = [];
  const types = typesOf(schema);
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  const fits = types.length === 0 || types.includes(actual) || (actual === "integer" && types.includes("number"));
  if (!fits) return [`${path}: is ${actual}, expected ${types.join(" or ")}`];
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) out.push(`${path}: ${JSON.stringify(value)} isn't one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) out.push(`${path}: over ${schema.maxLength} characters`);
    if (schema.format === "date-time" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) out.push(`${path}: ${value} isn't an ISO time in UTC`);
    if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) out.push(`${path}: ${value} isn't YYYY-MM-DD`);
    if (schema.format === "uri" && !/^https?:\/\//.test(value)) out.push(`${path}: ${value} isn't a link`);
    if (typeof schema.pattern === "string" && !compiled(schema.pattern).test(value)) out.push(`${path}: ${value} doesn't match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return [...out, `${path}: over ${schema.maxItems} items`];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) out.push(`${path}: under ${schema.minItems} items`);
    if (schema.items) value.forEach((item, index) => out.push(...schemaProblems(schema.items as Schema, item, `${path}[${index}]`)));
  }
  if (actual === "object" && schema.properties) {
    const properties = schema.properties as Record<string, Schema>;
    const given = value as Record<string, unknown>;
    for (const name of (schema.required as string[] | undefined) ?? []) if (!(name in given)) out.push(`${path}.${name}: missing`);
    if (schema.additionalProperties === false) for (const name of Object.keys(given)) if (!(name in properties)) out.push(`${path}.${name}: not in the schema`);
    for (const [name, property] of Object.entries(properties)) if (name in given) out.push(...schemaProblems(property, given[name], `${path}.${name}`));
  }
  return out;
}

/**
 * An answer with every field its schema didn't declare taken out, and the paths it took (a list's index as []): the
 * caller still gets the answer. Nothing else changes, and an answer with nothing to cut comes back as the same value.
 * Only closed objects cut, so a game's own rows and arguments pass as they are.
 */
export function cutUndeclared(schema: Schema, value: unknown, path = "answer"): { value: unknown; cutPaths: string[] } {
  if (Array.isArray(schema.anyOf)) {
    const options = schema.anyOf as Schema[];
    // The option that fits as it is, or else the one that needs least cut and then fits.
    const fitting = options.find((option) => schemaProblems(option, value, path).length === 0);
    if (fitting) return { value, cutPaths: [] };
    const tried = options.map((option) => cutUndeclared(option, value, path)).map((cut, index) => ({ cut, problemCount: schemaProblems(options[index]!, cut.value, path).length }));
    tried.sort((first, second) => first.problemCount - second.problemCount || first.cut.cutPaths.length - second.cut.cutPaths.length);
    return tried[0]?.cut ?? { value, cutPaths: [] };
  }
  if (Array.isArray(value)) {
    if (!schema.items) return { value, cutPaths: [] };
    const cutPaths: string[] = [];
    let changed: unknown[] | null = null;
    value.forEach((item, index) => {
      const cut = cutUndeclared(schema.items as Schema, item, `${path}[]`);
      if (!cut.cutPaths.length) return;
      cutPaths.push(...cut.cutPaths);
      (changed ??= [...value])[index] = cut.value;
    });
    return { value: changed ?? value, cutPaths: [...new Set(cutPaths)] };
  }
  if (value === null || typeof value !== "object" || !schema.properties) return { value, cutPaths: [] };
  const properties = schema.properties as Record<string, Schema>;
  const given = value as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  const cutPaths: string[] = [];
  for (const [name, fieldValue] of Object.entries(given)) {
    const property = properties[name];
    if (!property) {
      if (schema.additionalProperties === false) cutPaths.push(`${path}.${name}`);
      else kept[name] = fieldValue;
      continue;
    }
    const cut = cutUndeclared(property, fieldValue, `${path}.${name}`);
    kept[name] = cut.value;
    cutPaths.push(...cut.cutPaths);
  }
  return cutPaths.length ? { value: kept, cutPaths } : { value, cutPaths: [] };
}

/** A query value read as its shape says: a number or a yes or no comes as text. Text that can't be one stays text, so the shape refuses it. */
function queryValueOf(shape: Schema, given: string): unknown {
  if (Array.isArray(shape.anyOf)) {
    for (const option of shape.anyOf as Schema[]) {
      const value = queryValueOf(option, given);
      if (schemaProblems(option, value).length === 0) return value;
    }
    return given;
  }
  if ((shape.type === "integer" || shape.type === "number") && given.trim() !== "" && Number.isFinite(Number(given))) return Number(given);
  if (shape.type === "boolean" && (given === "true" || given === "false")) return given === "true";
  return given;
}

/** The first problem with a query, as [name, what's wrong], or null. isOpenToOtherNames: a page ignores names it doesn't read, since share links pick some up. */
export function queryProblem(fields: Readonly<Record<string, DoorShape>>, query: URLSearchParams, isOpenToOtherNames = false): { field: string; problem: string } | null {
  for (const [name, given] of query) {
    const shape = fields[name];
    if (!shape) {
      if (isOpenToOtherNames) continue;
      return { field: name, problem: `${name} isn't one of the query's names` };
    }
    const [problem] = schemaProblems(shape as Schema, queryValueOf(shape as Schema, given), name);
    if (problem) return { field: name, problem };
  }
  return null;
}

/** The first problem with a JSON body's fields: closed, each field its shape, the required ones there. */
export function bodyProblem(fields: Readonly<Record<string, DoorShape>>, required: readonly string[], body: Readonly<Record<string, unknown>>): { field: string; problem: string } | null {
  for (const name of required) if (!(name in body)) return { field: name, problem: `${name} is missing` };
  for (const [name, given] of Object.entries(body)) {
    const shape = fields[name];
    if (!shape) return { field: name, problem: `${name} isn't one of this door's fields` };
    const [problem] = schemaProblems(shape as Schema, given, name);
    if (problem) return { field: name, problem };
  }
  return null;
}

/** The first problem with a form's fields: its names closed, each value text, or a list where it may repeat. A form's text boxes send what they send, so its numbers are the door's to read. */
export function formProblem(fields: Readonly<Record<string, DoorShape>>, fileNames: readonly string[], form: { keys(): IterableIterator<string>; getAll(name: string): unknown[] }): { field: string; problem: string } | null {
  for (const name of new Set(form.keys())) {
    if (fileNames.includes(name)) continue;
    const shape = fields[name] as Schema | undefined;
    if (!shape) return { field: name, problem: `${name} isn't one of this form's fields` };
    const given = form.getAll(name);
    if (given.some((value) => typeof value !== "string")) return { field: name, problem: `${name} is a file, not text` };
    const value = shape.type === "array" ? given : given.length === 1 ? given[0] : given;
    const [problem] = schemaProblems(shape, typeof value === "string" ? queryValueOf(shape, value) : value, name);
    if (problem) return { field: name, problem };
  }
  return null;
}

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
