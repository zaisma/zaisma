import { FIRST_PAINT_SCRIPT_SOURCE } from "./components/index.ts";
import { pageStyleText, type PageStyle } from "./page-styles.ts";

/*
 * A page's own styles: the rules of the site's stylesheet its markup needs, carried inside the page (html.ts's layout) so its first paint
 * waits for no file. A rule is kept when one of its selectors could match: every class the selector asks for outright is on the page (or
 * one the first-paint script adds, FIRST_PAINT_CLASSES); a class inside :not(), :is(), :where(), :has() or an :nth-child(… of …) asks for
 * nothing, so such a rule is kept. @media, @supports, @container and @layer keep what's kept inside them; @font-face stays; @keyframes and
 * @property stay when what's kept names them. Then every custom property nothing kept reads is dropped, as many times as that frees others.
 * The whole sheet follows the first paint (components/first-paint-script.ts) and changes nothing that's on screen, since every rule that
 * matches the page is in the page already: it's there for what scripts add later.
 */

type CssNode =
  | { kind: "rule"; selectors: Selector[]; declarations: Declaration[] | null; bodyText: string }
  | { kind: "group"; prelude: string; children: CssNode[] }
  | { kind: "named"; prelude: string; name: string; bodyText: string }
  | { kind: "kept"; text: string };

/**
 * A selector, the classes it asks for outright, and for one that runs down from a holder through children only (.glass-pane > .pane-in >
 * * > *, the stack's edges), the holder's classes and how many levels down it reaches.
 */
interface Selector {
  text: string;
  neededClasses: string[];
  reach: { holderClasses: string[]; levelCount: number } | null;
}

/** A declaration, and the custom properties it reads. */
interface Declaration {
  text: string;
  /** A custom property this declaration sets (--glass-tint), or null. */
  setsProperty: string | null;
  readsProperties: string[];
}

const GROUP_RULE = /^@(media|supports|container|layer)\b/;
const READ_PROPERTY = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/** Where a block opened at "{" ends: the index of its "}", past quoted strings and comments. */
function blockEnd(css: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const character = css[i];
    if (character === "/" && css[i + 1] === "*") { i = css.indexOf("*/", i + 2) + 1; if (i === 0) return css.length - 1; continue; }
    if (character === '"' || character === "'") { const close = css.indexOf(character, i + 1); if (close < 0) return css.length - 1; i = close; continue; }
    if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return i;
  }
  return css.length - 1;
}

/** Splits at a character outside brackets, parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (quote) { if (character === quote && text[i - 1] !== "\\") quote = ""; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (character === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The classes a selector asks for outright: those outside any functional pseudo-class and outside attribute brackets. */
function neededClasses(selector: string): string[] {
  let outside = "", depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const character = selector[i]!;
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (depth === 0) outside += character;
  }
  return [...outside.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((found) => found[1]!);
}

/** Splits a selector at its combinators outside brackets: its compounds, and whether every combinator is a child one (>). */
function reachOf(selector: string): Selector["reach"] {
  const compounds: string[] = [];
  let depth = 0, current = "", isChildOnly = true;
  for (let i = 0; i < selector.length; i++) {
    const character = selector[i]!;
    if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    if (depth === 0 && (character === ">" || character === " " || character === "+" || character === "~")) {
      if (character === ">") { if (current.trim()) compounds.push(current.trim()); current = ""; }
      else if (character === "+" || character === "~") isChildOnly = false;
      else if (current.trim() && !/^\s*>/.test(selector.slice(i))) { compounds.push(current.trim()); current = ""; isChildOnly = false; }
      continue;
    }
    current += character;
  }
  if (current.trim()) compounds.push(current.trim());
  if (!isChildOnly || compounds.length < 3) return null;
  return { holderClasses: neededClasses(compounds[0]!), levelCount: compounds.length - 1 };
}

const selectorOf = (text: string): Selector => ({ text: text.trim(), neededClasses: neededClasses(text), reach: reachOf(text.trim()) });

function declarationsOf(bodyText: string): Declaration[] | null {
  // A rule with rules inside it (nesting) is kept as it is.
  if (bodyText.includes("{")) return null;
  return splitTopLevel(bodyText, ";").map((text) => text.trim()).filter(Boolean).map((text) => {
    const name = text.slice(0, text.indexOf(":")).trim();
    return { text, setsProperty: name.startsWith("--") ? name : null, readsProperties: [...text.matchAll(READ_PROPERTY)].map((found) => found[1]!) };
  });
}

function parse(css: string): CssNode[] {
  const nodes: CssNode[] = [];
  let index = 0;
  while (index < css.length) {
    if (css.startsWith("/*", index)) { const close = css.indexOf("*/", index + 2); index = close < 0 ? css.length : close + 2; continue; }
    const openIndex = css.indexOf("{", index), semicolonIndex = css.indexOf(";", index);
    // A statement with no block (@import, @charset, a layer's order) stays as it is.
    if (semicolonIndex >= 0 && (openIndex < 0 || semicolonIndex < openIndex) && css.slice(index, semicolonIndex).trim().startsWith("@")) {
      nodes.push({ kind: "kept", text: css.slice(index, semicolonIndex + 1).trim() });
      index = semicolonIndex + 1;
      continue;
    }
    if (openIndex < 0) break;
    const prelude = css.slice(index, openIndex).trim(), closeIndex = blockEnd(css, openIndex), bodyText = css.slice(openIndex + 1, closeIndex);
    index = closeIndex + 1;
    if (!prelude) continue;
    if (GROUP_RULE.test(prelude)) nodes.push({ kind: "group", prelude, children: parse(bodyText) });
    else if (/^@(-webkit-)?keyframes\b/.test(prelude)) nodes.push({ kind: "named", prelude, name: prelude.replace(/^@(-webkit-)?keyframes\s+/, "").trim(), bodyText });
    else if (prelude.startsWith("@property")) nodes.push({ kind: "named", prelude, name: prelude.replace(/^@property\s+/, "").trim(), bodyText });
    else if (prelude.startsWith("@")) nodes.push({ kind: "kept", text: `${prelude}{${bodyText}}` });
    else nodes.push({ kind: "rule", selectors: splitTopLevel(prelude, ",").map(selectorOf), declarations: declarationsOf(bodyText), bodyText });
  }
  return nodes;
}

/** The words in the string literals of a piece of script. */
const wordsInStrings = (code: string): string[] => [...code.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)].flatMap((found) => (found[1] ?? found[2] ?? "").match(/-?[_a-zA-Z][_a-zA-Z0-9-]*/g) ?? []);

/**
 * The classes the first-paint script can add before the first paint: those it puts on with classList, className or a class attribute,
 * in markup it writes as well ('<stop class="gleam"') or builds, and every class that starts with a word it builds names from ("step-" + a number).
 * A class it only looks for (".layout-row") is the page's to have. The loading check (layout-check.mjs) is what catches one missed here:
 * what the script draws, unstyled until the whole sheet arrives, moves when it does.
 */
export const FIRST_PAINT_CLASSES: ReadonlySet<string> = new Set([
  ...[...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/classList\.(?:add|toggle|replace)\(([^)]*)\)/g)].flatMap((found) => wordsInStrings(found[1]!)),
  ...[...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/className\s*\+?=\s*([^;\n]*)/g)].flatMap((found) => wordsInStrings(found[1]!)),
  ...[...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/(?:setAttribute\(\s*["']class["']\s*,|["']class["']\s*:)\s*([^)},\n]*)/g)].flatMap((found) => wordsInStrings(found[1]!)),
  ...[...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/class=\\?["']([^"'\\]*)/g)].flatMap((found) => found[1]!.match(/-?[_a-zA-Z][_a-zA-Z0-9-]*/g) ?? []),
  // A name it builds ("cut-band on-" + the side a band faces), kept in a variable first.
  ...[...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/("[^"\\\n]*"|'[^'\\\n]*')\s*\+/g)].flatMap((found) => wordsInStrings(found[1]!)),
]);
export const FIRST_PAINT_CLASS_PREFIXES: readonly string[] = [...new Set([...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/["' ]([a-z][a-z0-9]*(?:-[a-z0-9]+)*-)["']\s*\+/g)].map((found) => found[1]!))];
const isShownClass = (classes: ReadonlySet<string>, name: string): boolean => classes.has(name) || FIRST_PAINT_CLASS_PREFIXES.some((prefix) => name.startsWith(prefix));

/** Whether an element starts closed: a template, a dialog that isn't open, a popover. What's inside it shows only once a script opens it. */
const isClosedElement = (tag: string, attributes: string): boolean =>
  tag === "template" || (tag === "dialog" && !/\sopen(?=[\s=/]|$)/.test(attributes)) || /\spopover(?=[\s=/]|$)/.test(attributes);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** A page's markup without what starts closed in it (isClosedElement), for the first-paint pieces it carries (html.ts). */
export function shownMarkup(markup: string): string {
  let shown = "", readIndex = 0, closedTag: string | null = null, closedDepth = 0;
  for (const found of markup.matchAll(TAG)) {
    const [whole, isClosing, tagName, attributes] = found as unknown as [string, string, string, string];
    const tag = tagName.toLowerCase(), index = found.index!;
    if (closedTag === null) {
      if (!isClosing && !VOID_ELEMENTS.has(tag) && !attributes.endsWith("/") && isClosedElement(tag, attributes)) { shown += markup.slice(readIndex, index); closedTag = tag; closedDepth = 1; }
      continue;
    }
    if (tag !== closedTag) continue;
    if (!isClosing && !attributes.endsWith("/")) closedDepth++;
    else if (isClosing && --closedDepth === 0) { closedTag = null; readIndex = index + whole.length; }
  }
  return closedTag === null ? shown + markup.slice(readIndex) : shown;
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * The classes on a page's markup, and for each, how many levels deep the most nested thing inside an element with it goes (0 for an
 * element with nothing inside): a selector that runs further down from a holder than the page's own holders reach matches nothing.
 * What starts closed doesn't count (a sheet's dialog, a popover, a template): it shows only once a script opens it, and every script file
 * runs after the whole sheet has arrived.
 */
export function classesOf(markup: string): { classes: Set<string>; levelCountsByClass: Map<string, number> } {
  const classes = new Set<string>(), levelCountsByClass = new Map<string, number>();
  const open: { tag: string; classNames: string[]; levelCount: number; isClosed: boolean }[] = [];
  const closed = (element: { classNames: string[]; levelCount: number }): void => {
    for (const name of element.classNames) levelCountsByClass.set(name, Math.max(levelCountsByClass.get(name) ?? 0, element.levelCount));
    const parent = open[open.length - 1];
    if (parent) parent.levelCount = Math.max(parent.levelCount, element.levelCount + 1);
  };
  for (const found of markup.matchAll(TAG)) {
    const [, isClosing, tagName, attributes] = found as unknown as [string, string, string, string];
    const tag = tagName.toLowerCase();
    if (isClosing) {
      const at = open.map((element) => element.tag).lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) closed(open.pop()!);
      continue;
    }
    const isClosed = Boolean(open[open.length - 1]?.isClosed) || isClosedElement(tag, attributes);
    const classNames = isClosed ? [] : (/\bclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/).filter(Boolean);
    for (const name of classNames) classes.add(name);
    const element = { tag, classNames, levelCount: 0, isClosed };
    if (VOID_ELEMENTS.has(tag) || attributes.endsWith("/")) closed(element);
    else open.push(element);
  }
  while (open.length) closed(open.pop()!);
  return { classes, levelCountsByClass };
}

const parsedByStyleName = new Map<string, CssNode[]>();
function parsedSheet(style: PageStyle): CssNode[] {
  let nodes = parsedByStyleName.get(style.name);
  if (!nodes) { nodes = parse(pageStyleText(style)); parsedByStyleName.set(style.name, nodes); }
  return nodes;
}

/** Whether a selector could match the page: its classes are on it, and a holder on it reaches as far down as it runs. */
function couldMatch(selector: Selector, page: PageClasses): boolean {
  if (!selector.neededClasses.every((name) => isShownClass(page.classes, name))) return false;
  // A holder only the first-paint script makes may be anywhere; one on the page reaches as deep as it does there.
  if (!selector.reach || !selector.reach.holderClasses.length || !selector.reach.holderClasses.every((name) => page.levelCountsByClass.has(name))) return true;
  return Math.min(...selector.reach.holderClasses.map((name) => page.levelCountsByClass.get(name) ?? 0)) >= selector.reach.levelCount;
}

type PageClasses = { classes: ReadonlySet<string>; levelCountsByClass: ReadonlyMap<string, number> };

/** The rules a page could match, before custom properties are pruned. */
function matching(nodes: CssNode[], page: PageClasses): CssNode[] {
  const kept: CssNode[] = [];
  for (const node of nodes) {
    // Only the selectors that could match are kept: a list's others are for pieces the page doesn't have.
    if (node.kind === "rule") { const selectors = node.selectors.filter((selector) => couldMatch(selector, page)); if (selectors.length) kept.push(selectors.length === node.selectors.length ? node : { ...node, selectors }); }
    else if (node.kind === "group") { const children = matching(node.children, page); if (children.length) kept.push({ ...node, children }); }
    else kept.push(node);
  }
  return kept;
}

/**
 * The custom properties the first-paint script reads: those it names, and the cuts' sizes, whose names it builds from a kind of slab
 * (glass-script.ts, cutToken).
 */
const SCRIPT_READ_PROPERTIES: readonly string[] = [
  ...[...FIRST_PAINT_SCRIPT_SOURCE.matchAll(/["'(](--[A-Za-z0-9_-]+)/g)].map((found) => found[1]!),
  ...["pane", "header", "menu", "strip"].flatMap((kind) => [`--${kind}-cut-large`, `--${kind}-cut-small`]),
];

/** Every custom property the kept rules, the page's markup and the first-paint script read, following what each read one reads. */
function readProperties(nodes: CssNode[], markup: string): Set<string> {
  const setters = new Map<string, string[]>();
  const read = new Set<string>([...[...markup.matchAll(READ_PROPERTY)].map((found) => found[1]!), ...SCRIPT_READ_PROPERTIES]);
  const visit = (each: CssNode[]): void => {
    for (const node of each) {
      if (node.kind === "group") visit(node.children);
      else if (node.kind === "rule" && node.declarations) {
        for (const declaration of node.declarations) {
          if (declaration.setsProperty) setters.set(declaration.setsProperty, [...(setters.get(declaration.setsProperty) ?? []), ...declaration.readsProperties]);
          else for (const name of declaration.readsProperties) read.add(name);
        }
      } else if (node.kind === "rule" || node.kind === "kept" || node.kind === "named") {
        const text = node.kind === "kept" ? node.text : node.bodyText;
        // A @property's own name isn't a read of it; what's inside a keyframe or a nested rule is.
        for (const found of text.matchAll(READ_PROPERTY)) read.add(found[1]!);
      }
    }
  };
  visit(nodes);
  const waiting = [...read];
  while (waiting.length) {
    for (const name of setters.get(waiting.pop()!) ?? []) if (!read.has(name)) { read.add(name); waiting.push(name); }
  }
  return read;
}

function written(nodes: CssNode[], read: ReadonlySet<string>, keptText: string): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "kept") out += node.text;
    else if (node.kind === "group") { const inner = written(node.children, read, keptText); if (inner) out += `${node.prelude}{${inner}}`; }
    else if (node.kind === "named") {
      const isNamed = node.prelude.startsWith("@property") ? read.has(node.name) : new RegExp(`(^|[\\s:,])${node.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s;,]|$)`, "m").test(keptText);
      if (isNamed) out += `${node.prelude}{${node.bodyText}}`;
    } else if (!node.declarations) out += `${node.selectors.map((selector) => selector.text).join(",")}{${node.bodyText}}`;
    else {
      const declarations = node.declarations.filter((declaration) => !declaration.setsProperty || read.has(declaration.setsProperty));
      if (declarations.length) out += `${node.selectors.map((selector) => selector.text).join(",")}{${declarations.map((declaration) => declaration.text).join(";")}}`;
    }
  }
  return out;
}

/** The animations the kept rules name, to keep their @keyframes. */
function animationText(nodes: CssNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.kind === "group") text += animationText(node.children);
    else if (node.kind === "rule") for (const declaration of node.declarations ?? [{ text: node.bodyText }]) { if (/animation/.test(declaration.text)) text += `${declaration.text};\n`; }
  }
  return text;
}

const STYLES_KEPT_COUNT = 200;
const stylesByKey = new Map<string, string>();

/** A page's own styles, from its stylesheets and its markup (head and body): worked out once for each set of classes and reads. */
export function firstPaintStyles(styles: PageStyle[], markup: string): string {
  const { classes, levelCountsByClass } = classesOf(markup);
  for (const name of FIRST_PAINT_CLASSES) classes.add(name);
  const markupReads = [...new Set([...markup.matchAll(READ_PROPERTY)].map((found) => found[1]!))].sort();
  const key = `${styles.map((style) => style.name).join(",")}|${[...classes].sort().join(" ")}|${[...levelCountsByClass].map(([name, levelCount]) => `${name}:${levelCount}`).sort().join(" ")}|${markupReads.join(" ")}`;
  const known = stylesByKey.get(key);
  if (known !== undefined) return known;
  const kept = matching(styles.flatMap(parsedSheet), { classes, levelCountsByClass });
  const read = readProperties(kept, markupReads.map((name) => `var(${name})`).join(" "));
  const shown = written(kept, read, animationText(kept));
  if (stylesByKey.size >= STYLES_KEPT_COUNT) stylesByKey.delete(stylesByKey.keys().next().value!);
  stylesByKey.set(key, shown);
  return shown;
}
