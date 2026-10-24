import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

/**
 * The v1 contract locks: what games and developers' own servers build on (passes, chat checks, webhooks,
 * rooms, saves) only gains things from the beta on. Each lock reads a module's public names with the
 * TypeScript compiler, writes what each one is into a snapshot (test/contracts/v1/<name>.json), and from
 * then on checks the code still has everything the snapshot has: a type may gain fields and a union may
 * gain values, but nothing a v1 snapshot says may go or change. A deliberate change rewrites the
 * snapshots with npm run contracts:baseline, never by hand.
 */

export const ROOT = join(import.meta.dirname, "../..");
const SNAPSHOTS = join(import.meta.dirname, "v1");
const isWritingBaseline = Boolean(process.env.CONTRACTS_WRITE_BASELINE);

/** What one public name is: an object type's fields, a union's string values, a constant's value, or a signature. */
export type Surface =
  | { kind: "fields"; fields: Record<string, string> }
  | { kind: "values"; values: string[] }
  | { kind: "constant"; value: unknown }
  | { kind: "signature"; signature: string };

const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrayAsGenericType;
// Types by their names alone, never where this checkout sits.
const withoutPaths = (text: string) => text.replace(/import\("[^"]*"\)\./g, "");

/** The surface of each name a module exports (or a namespace a declaration file declares), read by the compiler. */
export function surfaceOf(file: string, names: string[], namespace?: string): Record<string, Surface> {
  const path = join(ROOT, file);
  const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(path)!;
  const declared = namespace && source.statements.find((statement): statement is ts.ModuleDeclaration => ts.isModuleDeclaration(statement) && statement.name.text === namespace);
  if (namespace && !declared) throw new Error(`${file} doesn't declare the namespace ${namespace}`);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(declared ? declared.name : source)!);
  const text = (type: ts.Type) => withoutPaths(checker.typeToString(type, undefined, FORMAT));
  const surfaces: Record<string, Surface> = {};
  for (const name of names) {
    const symbol = exports.find((exported) => exported.name === name);
    if (!symbol) throw new Error(`${file} doesn't ${namespace ? `declare ${namespace}.` : "export "}${name}`);
    if (symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Class)) {
      const type = checker.getTypeOfSymbol(symbol);
      const signatures = symbol.flags & ts.SymbolFlags.Class ? type.getConstructSignatures() : type.getCallSignatures();
      surfaces[name] = { kind: "signature", signature: signatures.map((signature) => withoutPaths(checker.signatureToString(signature, undefined, FORMAT))).join(" | ") };
    } else if (symbol.flags & ts.SymbolFlags.Variable) {
      const declaration = symbol.valueDeclaration as ts.VariableDeclaration;
      const initializer = declaration.initializer && ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer;
      surfaces[name] = { kind: "constant", value: initializer ? evaluate(initializer) : text(checker.getTypeOfSymbol(symbol)) };
    } else {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const parts = type.isUnion() ? type.types : [type];
      if (parts.every((part) => part.isStringLiteral())) {
        surfaces[name] = { kind: "values", values: parts.map((part) => (part as ts.StringLiteralType).value).sort() };
      } else if (type.isUnion() && parts.some((part) => part.isStringLiteral())) {
        // An open set (Kind | (string & {})): its named values, and that it takes others.
        surfaces[name] = { kind: "values", values: [...parts.filter((part) => part.isStringLiteral()).map((part) => (part as ts.StringLiteralType).value).sort(), "(any other string)"] };
      } else {
        const fields: Record<string, string> = {};
        for (const property of checker.getPropertiesOfType(type)) {
          const isOptional = (property.flags & ts.SymbolFlags.Optional) !== 0;
          fields[property.name] = `${isOptional ? "?: " : ": "}${text(checker.getTypeOfSymbol(property))}`;
        }
        surfaces[name] = { kind: "fields", fields };
      }
    }
  }
  return surfaces;
}

/** A script's top-level-of-its-scope var constants (the SDK's lists and limits): a list of strings as values, anything else as a constant. */
export function scriptConstantsOf(file: string, names: string[]): Record<string, Surface> {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.ES2022, true);
  const found = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer && !found.has(node.name.text)) found.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const surfaces: Record<string, Surface> = {};
  for (const name of names) {
    const initializer = found.get(name);
    if (!initializer) throw new Error(`${file} has no var ${name}`);
    const value = evaluate(initializer);
    surfaces[name] = Array.isArray(value) && value.every((item) => typeof item === "string") ? { kind: "values", values: [...value].sort() } : { kind: "constant", value };
  }
  return surfaces;
}

/** A constant's literal value: numbers (with their arithmetic), strings, booleans, arrays and objects. */
function evaluate(node: ts.Expression): unknown {
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ""));
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return evaluate(node.expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -(evaluate(node.operand) as number);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return (evaluate(node.left) as number) * (evaluate(node.right) as number);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluate);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) throw new Error(`Can't read ${property.getText()}`);
      return [property.name.getText(), evaluate(property.initializer)];
    }));
  }
  throw new Error(`Can't read the constant ${node.getText()}`);
}

/** A field's type parts, split at the top level of its union. */
function unionParts(type: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < type.length; i++) {
    const character = type[i]!;
    if ("({[<".includes(character)) depth++;
    else if (")}]>".includes(character)) depth--;
    else if (depth === 0 && type.startsWith(" | ", i)) {
      parts.push(type.slice(start, i));
      start = i + 3;
    }
  }
  return [...parts, type.slice(start)];
}

/** Whether a field's type is the same, or the same union with values added (and its optional mark kept). */
function isGrownFrom(was: string, now: string): boolean {
  if (was === now) return true;
  const markOf = (type: string) => (type.startsWith("?: ") ? "?: " : ": ");
  if (markOf(was) !== markOf(now)) return false;
  const nowParts = unionParts(now.slice(markOf(now).length));
  return unionParts(was.slice(markOf(was).length)).every((part) => nowParts.includes(part));
}

/**
 * Whether a constant only moved the way v1 lets it: the same value, or a limit object whose maximum* numbers
 * rose and minimum* numbers fell, everything else in it staying exactly as it was.
 */
function isWidenedFrom(was: unknown, now: unknown, key = ""): boolean {
  if (JSON.stringify(was) === JSON.stringify(now)) return true;
  if (typeof was === "number" && typeof now === "number") return (key.startsWith("maximum") && now > was) || (key.startsWith("minimum") && now < was);
  if (!was || !now || typeof was !== "object" || typeof now !== "object" || Array.isArray(was) || Array.isArray(now)) return false;
  return Object.entries(was).every(([field, value]) => field in now && isWidenedFrom(value, (now as Record<string, unknown>)[field], field));
}

/** What the snapshot has that the code lost or changed: an empty list when the code only gained things. */
export function lostSince(snapshot: Record<string, Surface>, current: Record<string, Surface>): string[] {
  const lost: string[] = [];
  for (const [name, was] of Object.entries(snapshot)) {
    const now = current[name];
    if (!now) lost.push(`${name} is gone`);
    else if (was.kind !== now.kind) lost.push(`${name} was ${was.kind}, now ${now.kind}`);
    else if (was.kind === "fields" && now.kind === "fields") {
      for (const [field, type] of Object.entries(was.fields)) {
        if (!(field in now.fields)) lost.push(`${name}.${field} is gone`);
        else if (!isGrownFrom(type, now.fields[field]!)) lost.push(`${name}.${field} was ${type}, now ${now.fields[field]}`);
      }
    } else if (was.kind === "values" && now.kind === "values") {
      for (const value of was.values) if (!now.values.includes(value)) lost.push(`${name} lost ${value}`);
    } else if (was.kind === "constant" && now.kind === "constant") {
      if (!isWidenedFrom(was.value, now.value)) lost.push(`${name} was ${JSON.stringify(was)}, now ${JSON.stringify(now)}`);
    } else if (JSON.stringify(was) !== JSON.stringify(now)) lost.push(`${name} was ${JSON.stringify(was)}, now ${JSON.stringify(now)}`);
  }
  return lost;
}

/** The snapshot as GitHub's main has it, or null where this checkout has no main to read (a shallow copy, or a new snapshot). */
function snapshotOnMain(snapshotName: string): Record<string, Surface> | null {
  try {
    const text = execFileSync("git", ["show", `origin/main:test/contracts/v1/${snapshotName}.json`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(text) as Record<string, Surface>;
  } catch {
    return null;
  }
}

/** One lock: the snapshot test/contracts/v1/<snapshotName>.json against what the code says now. */
export function lockSurface(snapshotName: string, file: string, names: string[]): void {
  lockSurfaces(snapshotName, surfaceOf(file, names));
}

/**
 * A lock on surfaces read any way (several files, a namespace, a script's lists). With isMainKept, the
 * code is also checked against the snapshot on GitHub's main, so a baseline can't take back what v1 had.
 */
export function lockSurfaces(snapshotName: string, current: Record<string, Surface>, { isMainKept = false } = {}): void {
  const path = join(SNAPSHOTS, `${snapshotName}.json`);
  if (isWritingBaseline) {
    it(`writes the ${snapshotName} snapshot`, () => writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`));
    return;
  }
  it(`keeps everything the v1 ${snapshotName} snapshot has`, () => {
    expect(existsSync(path), `No snapshot yet: npm run contracts:baseline writes ${path}`).toBe(true);
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as Record<string, Surface>;
    expect(lostSince(snapshot, current), "v1 only gains things. A deliberate change: npm run contracts:baseline").toEqual([]);
    // Every locked name is in the snapshot, so a new one is locked the moment it's added.
    expect(Object.keys(current).filter((name) => !(name in snapshot)), "New names: npm run contracts:baseline").toEqual([]);
  });
  if (isMainKept) {
    it(`keeps everything the v1 ${snapshotName} snapshot has on GitHub's main`, () => {
      const onMain = snapshotOnMain(snapshotName);
      if (onMain) expect(lostSince(onMain, current), "v1 only gains things, and main's snapshot is v1 as it shipped").toEqual([]);
    });
  }
}
