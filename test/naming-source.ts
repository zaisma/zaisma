/**
 * docs/NAMING.md for Zaisma's own code: the names declared in apps/ and packages/, the SDK's types and
 * the JavaScript the packages ship (read with the TypeScript compiler we already have), and the columns
 * the migrations make (replayed in Node's built-in SQLite). No new dependencies.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

/** Short forms and abbreviations that never make a word in a name (NAMING.md, rule 1). */
const SHORT = new Set(
  "dt dx dy dz msg msgs opts opt pos num nums cfg conf res resp req reqs err errs ev evt evts fn fns cb cbs el els elem elems btn btns img imgs idx len str strs obj objs arr arrs val vals tmp temp buf bufs src dst doc ref refs arg args param params prev cur curr cnt amt qty sz desc attr attrs hdr hdrs ver stmt stmts db col cols def defs pkg mgr ctl ctrl lbl txt mb kb gb".split(" "),
);
/** Words that say nothing on their own (rule 3); fine with a subject, like joinData. */
const VAGUE = new Set(["data", "info", "value", "result", "context", "time", "size", "length", "rate", "count", "at", "since", "max", "min", "t", "item", "thing", "stuff"]);
/** How a number's name ends: a count, a unit, an index or a number (docs/NAMING.md). */
const NUMBER_ENDINGS = new Set(["count", "ms", "sec", "min", "hours", "days", "years", "bytes", "px", "deg", "pct", "cents", "index", "number", "code", "byte", "level"]);
const UNITS = new Set(["ms", "sec", "min", "hour", "day"]);
/** Platform names kept as the platform spells them. */
const PLATFORM = new Set(["env", "ctx"]);
/** Fields a standard names (MCP tool annotations). */
const STANDARD_FIELDS = new Set(["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]);
/** Shapes a standard or the platform names: Worker bindings, JSON-RPC messages, MCP images. */
const STANDARD_SHAPES = new Set(["Env", "RpcMessage", "McpImage"]);
/** Room messages say type and data (docs/NAMING.md): there, data is the game's own message. */
const MESSAGE_SHAPES = new Set(["ServerMessage", "ClientMessage"]);
/**
 * The fields a standard or an outside service names, in the shape we declare for it (docs/NAMING.md,
 * Exceptions): JWT claims, WebAuthn's structures, R2's ranges and what Cloudflare (DNS, relay analytics) and VirusTotal answer. Only
 * these fields of these shapes; anything of ours in them still follows the rules.
 */
const STANDARD_FIELDS_BY_SHAPE: Record<string, string[]> = {
  AccessJwtClaims: ["exp", "nbf"],
  SupabaseJwtClaims: ["exp", "timestamp"],
  PassClaims: ["iat", "exp"],
  ReceiptClaims: ["iat", "jti", "exp"],
  ReceiptClaimsInput: ["iat", "jti"],
  IdTokenClaims: ["iat", "exp", "auth_time"],
  AccessTokenClaims: ["iat", "exp"],
  CollectedClientData: ["crossOrigin"],
  AuthenticatorData: ["flags"],
  TurnstileAnswer: ["success"],
  VirusTotalAnswer: ["data", "malicious"],
  R2RangeFields: ["offset", "length", "suffix"],
  CloudflareDnsAnswer: ["Answer", "data"],
  TurnAnalyticsAnswer: ["data"],
  StripeEvent: ["data"],
};
/** Inputs that ask for an action are a verb (docs/NAMING.md, Yes or no), like kicking with keepOut, or a quick join's hello asking to avoidBlockedPlayers. */
const ACTION_FIELDS_BY_SHAPE: Record<string, string[]> = { KickOptions: ["keepOut"], ClientMessage: ["keepOut", "avoidBlockedPlayers"], SignInAppChange: ["replaceClientSecret"], WebhookChange: ["replaceSigningSecret"] };

/** The name of the interface or type a type literal belongs to, or "" for one on its own. */
function shapeName(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent)) return parent.name.text;
  }
  return "";
}

export interface Problem {
  /** The file, or table.column for a column. */
  where: string;
  name: string;
  problem: string;
  /** Where in the file, for a person fixing it; not part of the baseline. */
  line?: number;
}

/** The words of a name in any style: getHTTPStatus, play_duration_min, MAX_COUNT. */
export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/_+/)
    .filter(Boolean);
}

function wordProblems(name: string): string[] {
  if (name === "i" || name === "_" || PLATFORM.has(name)) return [];
  const all = words(name);
  const problems: string[] = [];
  if (VAGUE.has(name.toLowerCase())) problems.push(`"${name}" alone doesn't say what it is`);
  if (all.some((word) => SHORT.has(word) || (word.length === 1 && !/\d/.test(word)))) problems.push("a short form, not a whole word");
  if (all.length > 1 && (all[0] === "max" || all[0] === "min")) problems.push("spell out maximum or minimum");
  return problems;
}

/**
 * A number's name ends in a count, a unit, Index, Number or Code, or Per<unit>; a 0 or 1 flag is named like
 * a yes/no. "per <thing>" after a count is fine: MAXIMUM_GAME_COUNT_PER_OWNER.
 */
function isNumberShaped(name: string): boolean {
  if (name === "i" || name === "httpStatus" || name === "id" || isBooleanShaped(name)) return true;
  const all = words(name);
  if (all.length > 2 && all[all.length - 2] === "per" && NUMBER_ENDINGS.has(all[all.length - 3]!)) return true;
  const last = all[all.length - 1]!;
  // Money in the smallest unit of the currency beside it: price_minor_units.
  if (all.length > 1 && all[all.length - 2] === "minor" && last === "units") return true;
  return NUMBER_ENDINGS.has(last) || (all.length > 1 && all[all.length - 2] === "per" && UNITS.has(last));
}

const isBooleanShaped = (name: string) => /^(is|has|can)[A-Z_]/.test(name) || /(_e|E)nabled$/.test(name);

/**
 * Zaisma's own code: the TypeScript under apps/*\/src and packages/*\/src, the JavaScript the packages
 * ship (the SDK, the CLI, the Node runner) and the types a package declares (the SDK's zaisma.d.ts).
 */
export function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, isCode: (name: string) => boolean) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") walk(full, isCode);
      else if (entry.isFile() && isCode(entry.name)) out.push(full);
    }
  };
  const isTypeScript = (name: string) => /\.ts$/.test(name) && !/\.d\.ts$/.test(name);
  for (const entry of readdirSync(join(root, "apps"), { withFileTypes: true })) {
    if (entry.isDirectory() && readdirSync(join(root, "apps", entry.name)).includes("src")) walk(join(root, "apps", entry.name, "src"), isTypeScript);
  }
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pack = join(root, "packages", entry.name);
    walk(pack, (name) => isTypeScript(name) || /\.m?js$/.test(name));
    const { types } = JSON.parse(readFileSync(join(pack, "package.json"), "utf8")) as { types?: string };
    if (types) out.push(join(pack, types));
  }
  return out.sort();
}

/** The names declared in the source that break docs/NAMING.md. */
export function sourceProblems(root: string): Problem[] {
  const files = sourceFiles(root);
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, allowJs: true, noEmit: true, strict: true, types: [] });
  const checker = program.getTypeChecker();
  const problems: Problem[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const where = relative(root, file);
    let at: ts.Node = source;
    const report = (name: string, problem: string) => problems.push({ where, name, problem, line: source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1 });
    const isNumber = (node: ts.Node) => {
      const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
      return Boolean(type.getFlags() & ts.TypeFlags.NumberLike) || (type.isUnion() && type.types.every((part) => part.getFlags() & ts.TypeFlags.NumberLike));
    };
    const isBoolean = (node: ts.Node) => Boolean(checker.getNonNullableType(checker.getTypeAtLocation(node)).getFlags() & ts.TypeFlags.BooleanLike);
    const checkVariable = (name: ts.Identifier) => {
      const text = name.text;
      for (const problem of wordProblems(text)) report(text, problem);
      if (/_/.test(text) && /[a-z]/.test(text) && text !== "_") report(text, "variables and functions are camelCase");
      if (isNumber(name) && !isNumberShaped(text)) report(text, "a number's name ends in Count, a unit, Index, Level or Number");
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) return;
      at = node;
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) checkVariable(node.name);
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) && node.name && ts.isIdentifier(node.name)) {
        for (const problem of wordProblems(node.name.text)) report(node.name.text, problem);
      }
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        for (const problem of wordProblems(node.name.text)) report(node.name.text, problem);
      }
      if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
        // Env's fields are Worker bindings and secrets, and some shapes are a standard's: their names, not ours.
        const isEnv = ts.isInterfaceDeclaration(node) && STANDARD_SHAPES.has(node.name.text);
        const fields = node.members.filter((member): member is ts.PropertySignature => ts.isPropertySignature(member) && Boolean(member.name) && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)));
        const names = fields.map((field) => (field.name as ts.Identifier | ts.StringLiteral).text);
        if (!isEnv && names.some((name) => /_/.test(name)) && names.some((name) => /[a-z][A-Z]/.test(name))) report(names.join(","), "mixes snake_case and camelCase in one shape");
        if (!isEnv) {
          const shape = ts.isInterfaceDeclaration(node) ? node.name.text : shapeName(node);
          const isMessage = MESSAGE_SHAPES.has(shape);
          const keptAsTheyAre = [...(STANDARD_FIELDS_BY_SHAPE[shape] ?? []), ...(ACTION_FIELDS_BY_SHAPE[shape] ?? [])];
          for (const field of fields) {
            const name = (field.name as ts.Identifier | ts.StringLiteral).text;
            if (/[^A-Za-z0-9_]/.test(name) || STANDARD_FIELDS.has(name) || (isMessage && name === "data") || keptAsTheyAre.includes(name)) continue;
            for (const problem of wordProblems(name)) report(name, problem);
            if (field.type && isNumber(field.name) && !isNumberShaped(name)) report(name, "a number's name ends in a count, a unit, index, level or number");
            if (field.type && isBoolean(field.name) && !isBooleanShaped(name)) report(name, "a yes/no field starts with is, has or can, or ends in enabled");
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return problems;
}

/** The columns the migrations make that break docs/NAMING.md, as table.column. */
export function columnProblems(migrationsDir: string): Problem[] {
  const database = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) database.exec(readFileSync(join(migrationsDir, file), "utf8"));
  const tables = database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string; sql: string }[];
  // Full-text search tables and the shadow tables SQLite makes for them aren't ours to name.
  const virtual = tables.filter((table) => /^CREATE VIRTUAL TABLE/i.test(table.sql)).map((table) => table.name);
  const problems: Problem[] = [];
  for (const table of tables) {
    if (table.name.startsWith("sqlite_") || table.name.startsWith("d1_") || table.name.startsWith("_cf") || virtual.some((name) => table.name === name || table.name.startsWith(`${name}_`))) continue;
    const columns = database.prepare(`SELECT name, type FROM pragma_table_info('${table.name}')`).all() as { name: string; type: string }[];
    for (const column of columns) {
      const report = (problem: string) => problems.push({ where: `${table.name}.${column.name}`, name: column.name, problem });
      for (const problem of wordProblems(column.name)) report(problem);
      if (column.name === "at" || column.name.endsWith("_at")) report("a stored time is <event>_at_ms");
      if (/INT|REAL|NUM/i.test(column.type) && column.name !== "id" && !isNumberShaped(column.name) && !isBooleanShaped(column.name)) {
        report("a number column ends in _count, a unit or _ms; a yes/no column starts with is_, has_ or can_ or ends in _enabled");
      }
    }
  }
  return problems;
}

/** Problems counted by where they are and what they are, the shape the baseline keeps. */
export function tally(problems: Problem[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const { where, name, problem } of problems) {
    const key = `${name}: ${problem}`;
    out[where] ??= {};
    out[where]![key] = (out[where]![key] ?? 0) + 1;
  }
  return out;
}
