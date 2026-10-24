import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { loadSdk, ON_ZAISMA } from "../sdk-stand-in.ts";
import { lockSurfaces, ROOT, scriptConstantsOf, type Surface } from "./surface.ts";

/**
 * The SDK's v1 contract outside rooms: window.Zaisma's calls a game makes and what they hand back.
 * sdk.d.ts is a frozen copy of zaisma.d.ts as v1 had it, pinned by its SHA-256, so it changes only in a
 * reviewed diff. Each call of this row's roots is checked against it with the compiler: a game's v1
 * arguments still fit today's parameters, and today's answers still fit code written for v1's. Output
 * unions keep every v1 value, and gain one only when it's allowed below and its union says more may
 * come. sdk-runtime.json is the SDK as it runs, in the stand-in browser: its keys, option and event
 * lists, constants, refusals and what it sends. Rooms are rooms-v1.test.ts's, passes pass-v1.test.ts's.
 */

const SDK_TYPES = join(ROOT, "packages/sdk/zaisma.d.ts");
const FROZEN_TYPES_PATH = "test/contracts/v1/sdk.d.ts";
const FROZEN_TYPES = join(ROOT, FROZEN_TYPES_PATH);
const isWritingBaseline = Boolean(process.env.CONTRACTS_WRITE_BASELINE);

/** sdk.d.ts's SHA-256. A new baseline prints the new one: change it here, in the same reviewed diff. */
const FROZEN_TYPES_SHA256 = "41986bd9aabc4db16a38554e5860eea167b04e303479523d785c80bda38837c4";

/** window.Zaisma's members this lock holds: everything but joinRoom and rooms (rooms-v1.test.ts). */
const ROOTS = ["sdkVersionNumber", "gameSlug", "player", "invite", "checkChat", "openPlayersPanel", "friends", "links", "server", "saves", "versions", "items"];
/** Types rooms-v1.test.ts holds: unions past them aren't walked here. */
const ROOM_TYPES = new Set(["Room", "Rooms"]);

/**
 * Values an output union may gain past v1, each a deliberate change: the union by its type name (or
 * Interface.field for one written in place) and the new value. Its declaration must say "More values may
 * come", so games written for v1 already treat it as something to expect.
 */
const ALLOWED_OUTPUT_ADDITIONS: { union: string; value: string }[] = [];

const MORE_VALUES_NOTE = "More values may come";

/** zaisma.d.ts's namespace renamed ZaismaV1Lock, without the Window block, to compile beside today's. */
function frozenTypes(): string {
  const text = readFileSync(SDK_TYPES, "utf8");
  const windowAt = text.indexOf("\ninterface Window {");
  if (!text.includes("declare namespace Zaisma {") || windowAt === -1) throw new Error(`${SDK_TYPES} has no Zaisma namespace and Window block`);
  return [
    "// Written by npm run contracts:baseline from packages/sdk/zaisma.d.ts: the SDK's types as v1 had them. Never edit by hand; its SHA-256 is pinned in sdk-v1.test.ts.",
    text.slice(0, windowAt).replace("declare namespace Zaisma {", "declare namespace ZaismaV1Lock {").trimEnd(),
    "",
  ].join("\n");
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A file as GitHub's main has it, or null where it has none (a new file, or a checkout without main). */
function onMain(path: string): string | null {
  try {
    return execFileSync("git", ["show", `origin/main:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// --- Types ---

const COMPILER_OPTIONS: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], strict: true, noEmit: true, types: [] };
const FROZEN_FILE = join(ROOT, "test/contracts/v1/frozen-in-memory.d.ts");
const ASSERTIONS_FILE = join(ROOT, "test/contracts/v1/assertions-in-memory.ts");

/** A program of today's zaisma.d.ts and in-memory files beside it. */
function compile(files: Record<string, string>, oldProgram?: ts.Program): ts.Program {
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const realSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => (fileName in files ? ts.createSourceFile(fileName, files[fileName]!, languageVersion, true) : realSourceFile(fileName, languageVersion, ...rest));
  host.fileExists = (fileName) => fileName in files || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => files[fileName] ?? ts.sys.readFile(fileName);
  return ts.createProgram([SDK_TYPES, ...Object.keys(files)], COMPILER_OPTIONS, host, oldProgram);
}

function namespaceIn(program: ts.Program, file: string, name: string): ts.Symbol {
  const declaration = program.getSourceFile(file)!.statements.find((statement): statement is ts.ModuleDeclaration => ts.isModuleDeclaration(statement) && statement.name.text === name);
  if (!declaration) throw new Error(`${file} declares no namespace ${name}`);
  return program.getTypeChecker().getSymbolAtLocation(declaration.name)!;
}

/** Where a union is declared in a namespace: a type alias, or Interface.field for one written in place. */
function unionDeclaration(source: ts.SourceFile, namespace: string, union: string): ts.Node | null {
  const body = source.statements.find((statement): statement is ts.ModuleDeclaration => ts.isModuleDeclaration(statement) && statement.name.text === namespace)?.body;
  if (!body || !ts.isModuleBlock(body)) return null;
  const [typeName, fieldName] = union.split(".");
  for (const statement of body.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName && !fieldName) return statement;
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName && fieldName) {
      return statement.members.find((member) => member.name && ts.isIdentifier(member.name) && member.name.text === fieldName) ?? null;
    }
  }
  return null;
}

/** The frozen copy with the allowed additions written into it, so they pass the compiler's checks. */
function withAllowedAdditions(frozen: string): string {
  const source = ts.createSourceFile(FROZEN_FILE, frozen, ts.ScriptTarget.ES2022, true);
  const insertions: { at: number; text: string }[] = [];
  for (const { union, value } of ALLOWED_OUTPUT_ADDITIONS) {
    const declaration = unionDeclaration(source, "ZaismaV1Lock", union);
    if (!declaration) continue; // the union is new since v1, so nothing to widen
    const type = ts.isTypeAliasDeclaration(declaration) ? declaration.type : (declaration as ts.PropertySignature).type;
    if (type) insertions.push({ at: type.end, text: ` | ${JSON.stringify(value)}` });
  }
  return insertions.sort((first, second) => second.at - first.at).reduce((text, { at, text: added }) => text.slice(0, at) + added + text.slice(at), frozen);
}

/** The assertions for one root, by name: inputs from v1 to today, awaited outputs from today to v1, never whole function types. */
function assertionsFor(checker: ts.TypeChecker, frozen: ts.Symbol): string[] {
  const lines: string[] = [];
  const old = (path: string) => `typeof ZaismaV1Lock.${path}`;
  const now = (path: string) => `typeof Zaisma.${path}`;
  const name = (path: string) => path.replace(/\./g, "_");
  const call = (path: string) => {
    lines.push(`type Inputs_${name(path)} = Fits<Parameters<${old(path)}>, Parameters<${now(path)}>>;`);
    lines.push(`type Output_${name(path)} = Fits<Awaited<ReturnType<${now(path)}>>, Awaited<ReturnType<${old(path)}>>>;`);
  };
  const value = (path: string) => lines.push(`type Value_${name(path)} = Fits<${now(path)}, ${old(path)}>;`);
  const type = checker.getTypeOfSymbol(frozen);
  if (type.getCallSignatures().length) call(frozen.name);
  else if (type.flags & ts.TypeFlags.Object) {
    for (const property of type.getProperties()) {
      const path = `${frozen.name}.${property.name}`;
      const propertyType = checker.getTypeOfSymbol(property);
      if (!propertyType.getCallSignatures().length) {
        value(path);
        continue;
      }
      call(path);
      // An event map behind a generic on(event, listener): each v1 listener still takes what today's SDK hands it.
      for (const signature of propertyType.getCallSignatures()) {
        for (const parameter of signature.getTypeParameters() ?? []) {
          const constraint = parameter.getConstraint();
          const events = constraint && constraint.flags & ts.TypeFlags.Index ? (constraint as ts.IndexType).type : null;
          const eventMap = events?.getSymbol()?.name;
          if (!events || !eventMap) continue;
          for (const event of events.getProperties()) lines.push(`type Listener_${eventMap}_${event.name} = Fits<ZaismaV1Lock.${eventMap}[${JSON.stringify(event.name)}], Zaisma.${eventMap}[${JSON.stringify(event.name)}]>;`);
        }
      }
    }
  } else value(frozen.name);
  return lines;
}

/**
 * Every string literal union this row's roots reach, by where it's declared (its type name, or
 * Interface.field), with its values: through fields, parameters, answers and type arguments, stopping
 * at the room types.
 */
function literalUnions(checker: ts.TypeChecker, roots: ts.Symbol[]): Map<string, Set<string>> {
  const unions = new Map<string, Set<string>>();
  const seen = new Set<ts.Type>();
  const nameOf = (type: ts.Type, owner: string) => {
    const symbolName = type.aliasSymbol?.name ?? type.getSymbol()?.name;
    return symbolName && !symbolName.startsWith("__") ? symbolName : owner;
  };
  const visit = (type: ts.Type, owner: string): void => {
    // Unions are noted wherever they're used (the compiler shares one union between fields); shapes once.
    if (type.isUnion() || type.isIntersection()) {
      const values = type.types.filter((part): part is ts.StringLiteralType => part.isStringLiteral()).map((part) => part.value);
      if (type.isUnion() && values.length) {
        const key = type.aliasSymbol?.name ?? owner;
        unions.set(key, new Set([...(unions.get(key) ?? []), ...values]));
      }
      for (const part of type.types) visit(part, owner);
      return;
    }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint && constraint !== type) visit(constraint, owner);
      return;
    }
    if (type.flags & ts.TypeFlags.IndexedAccess) return visit((type as ts.IndexedAccessType).objectType, owner);
    if (type.flags & ts.TypeFlags.Index) return visit((type as ts.IndexType).type, owner);
    if (!(type.flags & ts.TypeFlags.Object) || seen.has(type)) return;
    seen.add(type);
    const typeName = nameOf(type, owner);
    if (ROOM_TYPES.has(typeName)) return;
    if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) for (const argument of checker.getTypeArguments(type as ts.TypeReference)) visit(argument, owner);
    for (const signature of type.getCallSignatures()) {
      for (const parameter of signature.getParameters()) visit(checker.getTypeOfSymbol(parameter), `${owner}(${parameter.name})`);
      visit(signature.getReturnType(), `${owner}()`);
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) return;
    for (const property of type.getProperties()) {
      if (typeName === "Promise") break;
      visit(checker.getTypeOfSymbol(property), `${typeName}.${property.name}`);
    }
  };
  for (const root of roots) visit(checker.getTypeOfSymbol(root), root.name);
  return unions;
}

/** ErrorCode's values, from the namespace's own declaration. */
function errorCodes(checker: ts.TypeChecker, namespace: ts.Symbol): string[] {
  const alias = checker.getExportsOfModule(namespace).find((member) => member.name === "ErrorCode");
  if (!alias) throw new Error(`${namespace.name} declares no ErrorCode`);
  const type = checker.getDeclaredTypeOfSymbol(alias);
  return (type.isUnion() ? type.types : [type]).filter((part): part is ts.StringLiteralType => part.isStringLiteral()).map((part) => part.value).sort();
}

/** What today's SDK types lost against a frozen copy, or added that v1 doesn't allow: an empty list when they only gained what they may. */
function typeProblems(frozenText: string): string[] {
  const frozen = withAllowedAdditions(frozenText);
  const first = compile({ [FROZEN_FILE]: frozen });
  const checker = first.getTypeChecker();
  const frozenNamespace = namespaceIn(first, FROZEN_FILE, "ZaismaV1Lock");
  const currentNamespace = namespaceIn(first, SDK_TYPES, "Zaisma");
  const frozenMembers = checker.getExportsOfModule(frozenNamespace);
  const currentMembers = checker.getExportsOfModule(currentNamespace);
  const problems: string[] = [];
  const roots = ROOTS.flatMap((root) => {
    const member = frozenMembers.find((each) => each.name === root && each.flags & ts.SymbolFlags.Value);
    // A root v1 didn't have yet (items, before it merged) has nothing to keep.
    return member ? [member] : [];
  });
  for (const root of roots) if (!currentMembers.some((member) => member.name === root.name && member.flags & ts.SymbolFlags.Value)) problems.push(`Zaisma.${root.name} is gone`);

  // Inputs v1 to today, outputs today to v1, compiled.
  const assertions = ["/** Compiles only when Given fits Wanted. */", "type Fits<Given extends Wanted, Wanted> = true;", ...roots.flatMap((root) => assertionsFor(checker, root)), "export {};", ""].join("\n");
  const second = compile({ [FROZEN_FILE]: frozen, [ASSERTIONS_FILE]: assertions }, first);
  const lines = assertions.split("\n");
  for (const diagnostic of ts.getPreEmitDiagnostics(second)) {
    if (diagnostic.file?.fileName !== ASSERTIONS_FILE) {
      problems.push(`${diagnostic.file?.fileName.replace(ROOT, "") ?? ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
      continue;
    }
    const line = lines[diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line] ?? "";
    problems.push(`${line.match(/^type (\w+)/)?.[1] ?? line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").split("\n").slice(0, 3).join(" ")}`);
  }

  // Output unions keep every v1 value (the compiler only says when one is added).
  const before = literalUnions(checker, roots);
  const after = literalUnions(checker, roots.flatMap((root) => currentMembers.filter((member) => member.name === root.name && member.flags & ts.SymbolFlags.Value)));
  for (const [union, values] of before) {
    const kept = after.get(union);
    if (!kept) problems.push(`${union} is gone`);
    else for (const value of values) if (!kept.has(value)) problems.push(`${union} lost "${value}"`);
  }

  // The whole ErrorCode union: nothing lost, and only allowed additions.
  const frozenCodes = errorCodes(checker, frozenNamespace);
  const currentCodes = errorCodes(checker, currentNamespace);
  for (const code of frozenCodes) if (!currentCodes.includes(code)) problems.push(`ErrorCode lost "${code}"`);
  for (const code of currentCodes) if (!frozenCodes.includes(code)) problems.push(`ErrorCode gained "${code}": add it to ALLOWED_OUTPUT_ADDITIONS`);

  // An allowed addition is in today's union, which tells games more may come.
  const currentSource = first.getSourceFile(SDK_TYPES)!;
  for (const { union, value } of ALLOWED_OUTPUT_ADDITIONS) {
    const declaration = unionDeclaration(currentSource, "Zaisma", union);
    if (!declaration) {
      problems.push(`ALLOWED_OUTPUT_ADDITIONS names ${union}, which zaisma.d.ts doesn't declare`);
      continue;
    }
    if (!declaration.getText(currentSource).includes(JSON.stringify(value))) problems.push(`ALLOWED_OUTPUT_ADDITIONS has "${value}", which ${union} doesn't`);
    const comments = ts.getJSDocCommentsAndTags(declaration).map((comment) => comment.getText(currentSource)).join("\n");
    if (!comments.includes(MORE_VALUES_NOTE)) problems.push(`${union} gained "${value}" but its comment doesn't say "${MORE_VALUES_NOTE}; treat an unknown one as …"`);
  }
  return problems.filter((problem) => !(problem.startsWith("ErrorCode gained") && ALLOWED_OUTPUT_ADDITIONS.some((allowed) => allowed.union === "ErrorCode" && problem.includes(`"${allowed.value}"`))));
}

// --- The SDK as it runs ---

type Sdk = ReturnType<typeof loadSdk>;
type FetchAnswer = (url: string, init?: { method?: string; body?: string }) => Promise<unknown>;

const PLAYER_ID = "player_bo";
const SAVE_COPY_ID = "save_copy_k2v9q4x7m1p3w8r5t6y0";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An answer that notes every field the SDK reads from it, as a path like friends[].room_code. */
function noting(value: unknown, path: string, reads: Set<string>): unknown {
  if (!value || typeof value !== "object") return value;
  return new Proxy(value, {
    get(target, key) {
      const found = Reflect.get(target, key);
      // Promises ask anything they resolve with for then: that's not the SDK reading a field.
      if (typeof key === "symbol" || key === "then") return found;
      if (Array.isArray(target)) return /^\d+$/.test(key) ? noting(found, `${path}[]`, reads) : found;
      const at = path ? `${path}.${key}` : key;
      reads.add(at);
      return noting(found, at, reads);
    },
  });
}

/** What Zaisma's servers answer each call with in the stand-in, by method and path. */
const SERVER_ANSWERS: Record<string, unknown> = {
  "POST /v1/pass": { player: { id: "player_ana", name: "Ana", kind: "account" }, pass: "header.e30.signature", expiresAt: "2099-01-01T00:00:00Z" },
  "POST /v1/filter": { isAllowed: true, reason: null, message: null, hasSwearing: false, text: "hi" },
  [`GET /v1/players/<playerId>`]: {
    player: {
      id: PLAYER_ID, name: "bo", username: "bo", display_name: null, bio: null, link_urls: [], profile_url: "https://zaisma.test/@bo", is_profile_private: false,
      published_games: [{ slug: "sky-hopper", title: "Sky Hopper", page_url: "https://zaisma.test/g/sky-hopper" }],
      played_games: [{ slug: "sky-hopper", title: "Sky Hopper", page_url: "https://zaisma.test/g/sky-hopper", played_period: "today" }],
      playing_now: { slug: "sky-hopper", title: "Sky Hopper", page_url: "https://zaisma.test/g/sky-hopper" },
    },
  },
  "POST /v1/friends": { friends: [{ player_id: PLAYER_ID, username: "bo", room_code: "K7Q2MX", server_url: null, join_refusal: null }] },
  "POST /v1/friends/room": {},
  "GET /v1/items/<gameSlug>": { items: [{ itemName: "revive", title: "Revive", description: "", itemKind: "consumable", itemCategory: "gameplay", priceMinorUnits: 199, currencyCode: "usd", priceText: "$1.99" }] },
  "POST /v1/requests/<gameSlug>": { answer: { coinCount: 3 } },
};

/** What the page around the game answers each message with, so calls that ask it resolve. */
function answerPage(sdk: Sdk, message: Record<string, unknown>): void {
  const signedIn = { type: "zaisma:signed-in", player: { id: "player_ana", name: "Ana" } };
  const copy = { id: SAVE_COPY_ID, savedAt: "2026-10-24T00:00:00.000Z", copyReason: "hourly", sizeBytes: 10, isCurrentSave: false, version_id: null };
  const savesAnswers: Record<string, unknown> = { list_copies: [copy], get_copy: { ...copy, localStorageItems: {}, indexeddbDatabases: [] }, restore_copy: null };
  if (message.type === "zaisma:sign-in" || message.type === "zaisma:account-offer") sdk.page.say(signedIn);
  if (message.type === "zaisma:share") sdk.page.say({ type: "zaisma:share-answer", requestNumber: message.requestNumber, isOpened: true });
  if (message.type === "zaisma:link") sdk.page.say({ type: "zaisma:link", requestNumber: message.requestNumber, status: "opened" });
  if (message.type === "zaisma:saves-request" && message.request !== "listen") sdk.page.say({ type: "zaisma:saves-answer", requestNumber: message.requestNumber, answer: savesAnswers[message.request as string] });
}

/** The SDK on a Zaisma page, signed in, with a fetch and a page that note what it sends. */
function recordingSdk(config: Record<string, unknown> = ON_ZAISMA) {
  const fetched: { method: string; path: string; bodyKeys: string[] | null; reads: Set<string> }[] = [];
  const fetchAnswer: FetchAnswer = (url, init) => {
    const path = url.replace(ON_ZAISMA.rooms, "").replace(`/${ON_ZAISMA.game}`, "/<gameSlug>").replace(`/${PLAYER_ID}`, "/<playerId>");
    const method = init?.method ?? "GET";
    const step = { method, path, bodyKeys: init?.body ? Object.keys(JSON.parse(init.body)).sort() : null, reads: new Set<string>() };
    fetched.push(step);
    const answer = SERVER_ANSWERS[`${method} ${path}`];
    if (answer === undefined) return Promise.reject(new TypeError(`No answer for ${method} ${path} in the stand-in`));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(noting(structuredClone(answer), "", step.reads)) });
  };
  const sdk = loadSdk(config as typeof ON_ZAISMA, fetchAnswer as () => Promise<unknown>, "account");
  sdk.navigator.userActivation = { isActive: true };
  return { sdk, fetched };
}

/** What one call sends: each message to the page and each fetch, in order, and the fields it reads from Zaisma's answers. */
async function wireOf(call: (Zaisma: any) => unknown, { needsPass = false } = {}): Promise<Record<string, Surface>> {
  const { sdk, fetched } = recordingSdk();
  if (needsPass) await sdk.Zaisma.player.getPass();
  const postedBefore = sdk.page.posted.length;
  const fetchedBefore = fetched.length;
  const answered = new Set<unknown>();
  // A call the SDK now refuses (an option it no longer takes) shows as a changed wire, not a broken file.
  const settled = Promise.resolve()
    .then(() => call(sdk.Zaisma))
    .then(
      () => null,
      (error: { code?: string }) => error?.code ?? String(error),
    );
  for (let round = 0; round < 5; round++) {
    await flush();
    for (const message of sdk.page.posted.slice(postedBefore)) {
      if (answered.has(message)) continue;
      answered.add(message);
      answerPage(sdk, message as Record<string, unknown>);
    }
  }
  const refusal = await settled;
  const surfaces: Record<string, Surface> = {};
  const steps: string[] = [];
  for (const message of sdk.page.posted.slice(postedBefore) as Record<string, unknown>[]) {
    const step = `post ${message.type}${typeof message.request === "string" ? ` ${message.request}` : ""}`;
    steps.push(step);
    surfaces[step] = { kind: "values", values: Object.keys(message).sort() };
  }
  for (const step of fetched.slice(fetchedBefore)) {
    const name = `${step.method} ${step.path}`;
    steps.push(name);
    if (step.bodyKeys) surfaces[`${name} body`] = { kind: "values", values: step.bodyKeys };
    // Only the leaves: reading friends[].room_code reads friends too.
    const reads = [...step.reads].filter((read) => ![...step.reads].some((other) => other.startsWith(`${read}.`) || other.startsWith(`${read}[]`))).sort();
    surfaces[`${name} answer`] = { kind: "values", values: reads };
  }
  if (refusal) steps.push(`refused with ${refusal}`);
  surfaces.steps = { kind: "constant", value: steps };
  return surfaces;
}

/** How a call fails, and whether it sent anything first: for every input the SDK checks itself. */
async function refusalOf(call: (Zaisma: any) => unknown, onZaisma = true): Promise<Surface> {
  const { sdk, fetched } = onZaisma ? recordingSdk() : recordingSdk({});
  return refusalIn(sdk, fetched, call);
}
async function refusalIn(sdk: Sdk, fetched: unknown[], call: (Zaisma: any) => unknown): Promise<Surface> {
  const postedBefore = sdk.page.posted.length;
  const fetchedBefore = fetched.length;
  let code: string | null = null;
  try {
    await call(sdk.Zaisma);
  } catch (error) {
    code = (error as { code?: string }).code ?? null;
  }
  if (!code) throw new Error(`The SDK took ${call}`);
  await flush();
  return { kind: "constant", value: { code, isSent: sdk.page.posted.length > postedBefore || fetched.length > fetchedBefore } };
}

/** The names a refusal lists after "It takes:" or "… has:", sorted. */
function listedBy(call: () => unknown): Surface {
  try {
    call();
  } catch (error) {
    const list = (error as Error).message.match(/(?:It takes|has): (.*)\.$/);
    if (list) return { kind: "values", values: list[1]!.split(", ").sort() };
    throw error;
  }
  throw new Error(`${call} took it`);
}
async function listedByRejection(call: () => Promise<unknown>): Promise<Surface> {
  const error = await call().then(() => null, (refused: Error) => refused);
  const list = error?.message.match(/It takes: (.*)\.$/);
  if (!list) throw new Error(`${call} gave no list: ${error?.message}`);
  return { kind: "values", values: list[1]!.split(", ").sort() };
}

/** zaisma.js's patterns, by their var names, as /source/flags. */
function scriptPatterns(file: string, names: string[]): Record<string, Surface> {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.ES2022, true);
  const found: Record<string, Surface> = {};
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer && ts.isRegularExpressionLiteral(node.initializer)) found[node.name.text] = { kind: "constant", value: node.initializer.text };
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const name of names) if (!found[name]) throw new Error(`${file} has no pattern ${name}`);
  return found;
}

/** Every wait of 3 seconds for the page's answer in zaisma.js, by the function it's in. */
function pageWaits(file: string): Record<string, Surface> {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.ES2022, true);
  const waits: Record<string, Surface> = {};
  const visit = (node: ts.Node, inFunction: string) => {
    const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text : inFunction;
    if (ts.isCallExpression(node) && node.expression.getText(source) === "setTimeout" && node.arguments[1] && ts.isNumericLiteral(node.arguments[1]) && node.arguments[1].text === "3000") {
      waits[`wait in ${name}`] = { kind: "constant", value: 3000 };
    }
    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(source, "(top)");
  return waits;
}

async function runtimeSurfaces(): Promise<Record<string, Surface>> {
  const surfaces: Record<string, Surface> = {};
  const { sdk } = recordingSdk();
  const Zaisma = sdk.Zaisma;
  surfaces.Zaisma = { kind: "values", values: Object.keys(Zaisma).sort() };
  for (const namespace of ["player", "links", "friends", "saves", "versions", "server", "items"]) surfaces[`Zaisma.${namespace}`] = { kind: "values", values: Object.keys(Zaisma[namespace]).sort() };

  // Option and event lists, as the SDK's own refusals list them.
  surfaces["Zaisma.links.open options"] = await listedByRejection(() => Zaisma.links.open("store", { nope: 1 }));
  surfaces["Zaisma.server.request options"] = await listedByRejection(() => Zaisma.server.request({}, { nope: 1 }));
  surfaces["Zaisma.friends.setRoom options"] = await listedByRejection(() => Zaisma.friends.setRoom({ nope: 1 }));
  surfaces["Zaisma.saves events"] = listedBy(() => Zaisma.saves.on("nope", () => {}));
  surfaces["Zaisma.versions events"] = listedBy(() => Zaisma.versions.on("nope", () => {}));

  // Constants, exact.
  const constants = scriptConstantsOf("packages/sdk/zaisma.js", ["MAXIMUM_REQUEST_SIZE_BYTES", "FRIENDS_KEPT_MS", "OWN_ROOM_CHECK_IN_MS", "SAVES_ERROR_CODES", "LINK_ERROR_CODES"]);
  for (const [name, surface] of Object.entries(constants)) surfaces[name] = surface.kind === "values" ? { kind: "constant", value: surface.values } : surface;
  Object.assign(surfaces, scriptPatterns("packages/sdk/zaisma.js", ["SAVE_COPY_ID", "LINK_NAME", "LINK_PATH", "OWN_SERVER_URL"]), pageWaits("packages/sdk/zaisma.js"));

  // Bad input, and what it fails with: every input the SDK checks itself.
  const refusals: [string, (Zaisma: any) => unknown, boolean?][] = [
    ["Zaisma.player.getPass off Zaisma", (z) => z.player.getPass(), false],
    ["Zaisma.player.getProfile with a bad player ID", (z) => z.player.getProfile("nope")],
    ["Zaisma.player.getProfile off Zaisma", (z) => z.player.getProfile(PLAYER_ID), false],
    ["Zaisma.player.signIn off Zaisma", (z) => z.player.signIn(), false],
    ["Zaisma.player.offerAccount off Zaisma", (z) => z.player.offerAccount(), false],
    ["Zaisma.checkChat off Zaisma", (z) => z.checkChat("hello"), false],
    ["Zaisma.friends.list off Zaisma", (z) => z.friends.list(), false],
    ["Zaisma.friends.setRoom off Zaisma", (z) => z.friends.setRoom(null), false],
    ["Zaisma.friends.setRoom with an unknown option", (z) => z.friends.setRoom({ nope: 1 })],
    ["Zaisma.friends.setRoom with no room", (z) => z.friends.setRoom(undefined)],
    ["Zaisma.friends.setRoom with a ws:// server", (z) => z.friends.setRoom({ serverUrl: "ws://play.example.com", roomCode: "K7Q2MX" })],
    ["Zaisma.friends.setRoom with a bad room code", (z) => z.friends.setRoom({ serverUrl: "wss://play.example.com", roomCode: "K7Q2M0" })],
    ["Zaisma.links.open with an unknown option", (z) => z.links.open("store", { nope: 1 })],
    ["Zaisma.links.open with a bad link name", (z) => z.links.open("Store!")],
    ["Zaisma.links.open with a path without /", (z) => z.links.open("store", { path: "buy" })],
    ["Zaisma.links.open with a .. path", (z) => z.links.open("store", { path: "/../admin" })],
    ["Zaisma.links.open with bad query parameters", (z) => z.links.open("store", { queryParameters: { item: 3 } })],
    ["Zaisma.links.open with an http:// ownSiteUrl", (z) => z.links.open("store", { ownSiteUrl: "http://kit.itch.io/sky-hopper" })],
    ["Zaisma.links.open off Zaisma without ownSiteUrl", (z) => z.links.open("store"), false],
    ["Zaisma.items.owns with no item name", (z) => z.items.owns("")],
    ["Zaisma.items.list off Zaisma", (z) => z.items.list(), false],
    ["Zaisma.server.request with an unknown option", (z) => z.server.request({}, { nope: 1 })],
    ["Zaisma.server.request off Zaisma without serverUrl", (z) => z.server.request({ type: "leaderboard" }), false],
    ["Zaisma.server.request with a bad serverUrl", (z) => z.server.request({}, { serverUrl: "ftp://play.example.com" })],
    ["Zaisma.server.request with what isn't JSON", (z) => z.server.request({ coinCount: 1n })],
    ["Zaisma.server.request over 16 KB", (z) => z.server.request({ text: "x".repeat(16 * 1024) })],
    ["Zaisma.saves.getCopy with a bad save copy ID", (z) => z.saves.getCopy("nope")],
    ["Zaisma.saves.restoreCopy with a bad save copy ID", (z) => z.saves.restoreCopy(42)],
    ["Zaisma.saves.listCopies off Zaisma", (z) => z.saves.listCopies(), false],
    ["Zaisma.saves.on an unknown event", (z) => z.saves.on("nope", () => {})],
    ["Zaisma.versions.on an unknown event", (z) => z.versions.on("nope", () => {})],
  ];
  for (const [name, call, onZaisma] of refusals) surfaces[`refusal: ${name}`] = await refusalOf(call, onZaisma ?? true);
  // Invite and links only right after the player's tap, on Zaisma or off it.
  for (const [name, call, onZaisma] of [
    ["Zaisma.invite without a tap", (z: any) => z.invite(null), true],
    ["Zaisma.invite off Zaisma without a tap", (z: any) => z.invite(null), false],
    ["Zaisma.links.open without a tap", (z: any) => z.links.open("store"), true],
  ] as const) {
    const { sdk: untapped, fetched } = onZaisma ? recordingSdk() : recordingSdk({});
    untapped.navigator.userActivation = { isActive: false };
    surfaces[`refusal: ${name}`] = await refusalIn(untapped, fetched, call);
  }

  // What each call sends, and what it reads back.
  const wires: [string, (Zaisma: any) => unknown, boolean?][] = [
    ["Zaisma.player.getPass", (z) => z.player.getPass()],
    ["Zaisma.player.getProfile", (z) => z.player.getProfile(PLAYER_ID)],
    ["Zaisma.player.signIn", (z) => z.player.signIn()],
    ["Zaisma.player.offerAccount", (z) => z.player.offerAccount()],
    ["Zaisma.invite", (z) => z.invite(null)],
    ["Zaisma.checkChat", (z) => z.checkChat("hi")],
    ["Zaisma.openPlayersPanel", (z) => z.openPlayersPanel({})],
    ["Zaisma.friends.list", (z) => z.friends.list(), true],
    ["Zaisma.friends.setRoom", (z) => z.friends.setRoom({ serverUrl: "wss://play.example.com", roomCode: "K7Q2MX" }), true],
    ["Zaisma.friends.setRoom(null)", (z) => z.friends.setRoom(null), true],
    ["Zaisma.links.open", (z) => z.links.open("store", { path: "/buy", queryParameters: { item: "sword" } })],
    ["Zaisma.items.list", (z) => z.items.list(), true],
    ["Zaisma.server.request", (z) => z.server.request({ type: "leaderboard" }), true],
    ["Zaisma.saves.on", (z) => z.saves.on("conflict", () => {})],
    ["Zaisma.saves.listCopies", (z) => z.saves.listCopies()],
    ["Zaisma.saves.getCopy", (z) => z.saves.getCopy(SAVE_COPY_ID)],
    ["Zaisma.saves.restoreCopy", (z) => z.saves.restoreCopy(SAVE_COPY_ID)],
  ];
  for (const [name, call, needsPass] of wires) {
    for (const [step, surface] of Object.entries(await wireOf(call, { needsPass }))) surfaces[`wire: ${name}${step === "steps" ? "" : `, ${step}`}`] = surface;
  }
  // Which version the tab runs, said as the SDK loads.
  const loaded = recordingSdk({ ...ON_ZAISMA, version: "version_k2v9q4x7m1p3w8r5t6y0" }).sdk.page.posted as Record<string, unknown>[];
  surfaces["wire: at load"] = { kind: "constant", value: loaded.map((message) => `post ${message.type}`) };
  for (const message of loaded) surfaces[`wire: at load, post ${message.type}`] = { kind: "values", values: Object.keys(message).sort() };
  return surfaces;
}

const runtime = await runtimeSurfaces();

describe("the SDK v1, outside rooms", () => {
  if (isWritingBaseline) {
    it("writes the frozen SDK types", () => {
      const frozen = frozenTypes();
      writeFileSync(FROZEN_TYPES, frozen);
      if (sha256(frozen) !== FROZEN_TYPES_SHA256) console.log(`test/contracts/v1/sdk.d.ts changed: set FROZEN_TYPES_SHA256 in test/contracts/sdk-v1.test.ts to "${sha256(frozen)}"`);
    });
  } else {
    it("keeps the frozen SDK types as reviewed", () => {
      expect(existsSync(FROZEN_TYPES), `No frozen types yet: npm run contracts:baseline writes ${FROZEN_TYPES_PATH}`).toBe(true);
      expect(sha256(readFileSync(FROZEN_TYPES, "utf8")), `${FROZEN_TYPES_PATH} changed: a deliberate change sets FROZEN_TYPES_SHA256 to its new SHA-256 in the same reviewed diff`).toBe(FROZEN_TYPES_SHA256);
    });

    it("still fits the SDK's types as v1 had them", () => {
      expect(typeProblems(readFileSync(FROZEN_TYPES, "utf8")), "v1 only gains things. A deliberate change: npm run contracts:baseline").toEqual([]);
    });

    it("still fits the SDK's types as GitHub's main has them", () => {
      const frozenOnMain = onMain(FROZEN_TYPES_PATH);
      if (frozenOnMain && frozenOnMain !== readFileSync(FROZEN_TYPES, "utf8")) expect(typeProblems(frozenOnMain), "v1 only gains things, and main's sdk.d.ts is v1 as it shipped").toEqual([]);
    });
  }

  lockSurfaces("sdk-runtime", runtime, { isMainKept: true });
});
