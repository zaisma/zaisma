/**
 * Checks for docs/NAMING.md: that schemas follow the naming rules, and that answers match their
 * schemas exactly. A small JSON Schema reader, only the parts our schemas use, so no dependency.
 */
import { EVERY_ERROR_CODE, ID_KINDS, type ErrorAnswer } from "@zaisma/core";
import { ERROR } from "../apps/site/src/schemas.ts";

type Schema = Record<string, unknown>;

const UNITS = ["ms", "sec", "min", "hours", "days", "years", "bytes", "px", "deg", "pct", "cents"];
const RATE = /_per_(sec|min|hour|day)$/;
/** Short forms and vague words that never make a name on their own (rules 1 and 3). */
const VAGUE = new Set(["t", "data", "info", "value", "result", "context", "time", "size", "length", "rate", "duration", "timeout", "delay", "interval", "count", "at", "since", "url", "max", "min"]);
/** Short forms that never appear anywhere in a name. */
const SHORT = new Set(["dt", "dx", "dy", "msg", "opts", "pos", "num", "cfg"]);
/** Plurals that would read as a list, so they can't name a number or an object (rule 9). */
const PLURALS = new Set(["files", "players", "images", "versions", "rooms", "plays", "messages", "days", "testers", "topics", "posts", "reports", "games", "events"]);
/** Yes/no inputs that ask for an action are verbs, and these are the ones in use. */
const VERBS = new Set(["confirm", "reopen", "publish_when_approved", "undo", "replace_client_secret", "replace_signing_secret"]);
/** Plurals that don't end in s. */
const IRREGULAR_PLURALS = new Set(["people", "media"]);
/** Formats a list of values can be sent in, after the plural: images_base64 (docs/NAMING.md). */
const FORMATS = new Set(["base64", "markdown"]);
/** A pattern that says an ID's kind (docs/NAMING.md, IDs). */
const ID_PATTERN = new RegExp(`^\\^(${ID_KINDS.join("|")})_`);
/** Objects whose keys are the caller's own, not ours: next steps' arguments, and a game database's rows, by its own columns. */
const OPEN_OBJECTS = new Set(["arguments", "rows[]", "local_storage_items", "indexeddb_databases[]"]);

const typesOf = (s: Schema): string[] => {
  const t = s.type;
  if (Array.isArray(t)) return t as string[];
  if (typeof t === "string") return [t];
  if (Array.isArray(s.enum)) return [...new Set((s.enum as unknown[]).map((v) => (v === null ? "null" : typeof v)))];
  return [];
};

/** What breaks the naming rules in a schema, as "path: problem" lines. */
export function namingProblems(schema: Schema, where: string, input: boolean): string[] {
  const out: string[] = [];
  const walk = (s: Schema, path: string) => {
    const props = s.properties as Record<string, Schema> | undefined;
    const types = typesOf(s);
    if (types.includes("object") && !OPEN_OBJECTS.has(path.split(".").pop()!)) {
      if (!props) out.push(`${path}: an object needs its properties (no free-form objects)`);
      else {
        if (s.additionalProperties !== false) out.push(`${path}: an object needs additionalProperties: false`);
        if (!input) {
          const required = new Set((s.required as string[] | undefined) ?? []);
          for (const k of Object.keys(props)) if (!required.has(k)) out.push(`${path}.${k}: answers have every key every time (required)`);
        }
      }
    }
    if (props) for (const [name, p] of Object.entries(props)) checkName(name, p, `${path}.${name}`);
    if (s.items && typeof s.items === "object") walk(s.items as Schema, `${path}[]`);
  };
  const checkName = (name: string, s: Schema, path: string) => {
    const types = typesOf(s);
    const tokens = name.split("_");
    const say = (problem: string) => out.push(`${path}: ${problem}`);
    if (VAGUE.has(name)) say(`"${name}" alone doesn't say what it is`);
    if (tokens.some((t) => SHORT.has(t))) say("no short forms like dt, msg, opts or pos");
    if (tokens.length > 1 && (tokens[0] === "max" || tokens[0] === "min")) say("spell out maximum_ or minimum_");
    if (types.includes("integer") || types.includes("number")) {
      if (!name.endsWith("_count") && !UNITS.some((u) => name.endsWith(`_${u}`)) && !RATE.test(name)) say("a number ends in _count, a unit suffix or _per_<unit>");
    }
    if (name.endsWith("_at") !== (s.format === "date-time")) say("a point in time is named *_at and is an ISO date-time string");
    if ((name === "date" || name.endsWith("_date")) !== (s.format === "date")) say("a calendar day is named date or *_date, format date");
    if (types.includes("boolean")) {
      const shaped = /^(is|has|can)_/.test(name) || name.endsWith("_enabled") || (input && VERBS.has(name));
      if (!shaped) say("a yes/no starts with is_, has_ or can_, ends in _enabled, or (an input asking for an action) is a verb");
    }
    const listWord = tokens.length > 1 && FORMATS.has(tokens[tokens.length - 1]!) ? tokens[tokens.length - 2]! : tokens[tokens.length - 1]!;
    if (types.includes("array") && !listWord.endsWith("s") && !IRREGULAR_PLURALS.has(listWord)) say("a list is named with a plural");
    const last = tokens[tokens.length - 1]!;
    const unitSuffix = tokens.length > 1 && UNITS.includes(last);
    if (!types.includes("array") && PLURALS.has(last) && !unitSuffix) say("a plural names a list; a number of things is <thing>_count");
    if ((name === "id" || name.endsWith("_id")) && !types.includes("string")) say("an ID is a string");
    if ((name === "id" || name.endsWith("_id")) && !(typeof s.pattern === "string" && ID_PATTERN.test(s.pattern))) say("an ID says its kind: give it a pattern like ^version_");
    walk(s, path);
  };
  walk(schema, where);
  return out;
}

/** Where a value doesn't match its schema, as "path: problem" lines. */
export function schemaProblems(schema: Schema, value: unknown, path = "answer"): string[] {
  // anyOf: it fits when one of them fits; otherwise say how it misses the nearest.
  if (Array.isArray(schema.anyOf)) {
    const misses = (schema.anyOf as Schema[]).map((option) => schemaProblems(option, value, path));
    return misses.some((problems) => problems.length === 0) ? [] : misses.sort((first, second) => first.length - second.length)[0]!;
  }
  const out: string[] = [];
  const types = typesOf(schema);
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  const fits = types.length === 0 || types.includes(actual) || (actual === "integer" && types.includes("number"));
  if (!fits) return [`${path}: is ${actual}, expected ${types.join(" or ")}`];
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) out.push(`${path}: ${JSON.stringify(value)} isn't one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (schema.format === "date-time" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) out.push(`${path}: ${value} isn't an ISO time in UTC`);
    if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) out.push(`${path}: ${value} isn't YYYY-MM-DD`);
    if (schema.format === "uri" && !/^https?:\/\//.test(value)) out.push(`${path}: ${value} isn't a link`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) out.push(`${path}: ${value} doesn't match ${schema.pattern}`);
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...schemaProblems(schema.items as Schema, v, `${path}[${i}]`)));
  if (actual === "object" && schema.properties) {
    const props = schema.properties as Record<string, Schema>;
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (!(k in obj)) out.push(`${path}.${k}: missing`);
    if (schema.additionalProperties === false) for (const k of Object.keys(obj)) if (!(k in props)) out.push(`${path}.${k}: not in the schema`);
    for (const [k, p] of Object.entries(props)) if (k in obj) out.push(...schemaProblems(p, obj[k], `${path}.${k}`));
  }
  return out;
}

/**
 * Where an error answer breaks docs/NAMING.md, Errors: the shape, a listed code with the HTTP status
 * it's listed with, and a fix that says more than the message.
 */
export function errorProblems(answer: unknown, httpStatus?: number): string[] {
  const out = schemaProblems(ERROR, answer, "error answer");
  if (out.length) return out;
  const { code, message, fix } = (answer as ErrorAnswer).error;
  if (!(code in EVERY_ERROR_CODE)) return [`error answer: ${code} isn't in ERROR_CODES or ADMIN_ERROR_CODES`];
  if (httpStatus !== undefined && EVERY_ERROR_CODE[code].httpStatus !== httpStatus) out.push(`error answer: ${code} came with HTTP ${httpStatus}, listed as ${EVERY_ERROR_CODE[code].httpStatus}`);
  if (!message.trim() || !fix.trim() || fix === message) out.push(`error answer: ${code} needs a message and a different fix`);
  return out;
}
