import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Code is identical" for the security map: a door's verdicts hold only while the code they relied on is
 * the same text. Each anchor is one named function, method or const in a file; its hash is the sha256 of
 * its source text with whitespace collapsed, so a reformat isn't a change and a real edit is. A plain
 * bracket matcher, not a TypeScript parser, to keep dependencies few; it skips strings, template
 * literals, comments and regular expressions so the brackets inside them don't count.
 */

const OPENERS = { "(": ")", "[": "]", "{": "}" };
/** After one of these (or nothing), a / starts a regular expression rather than a division. */
const BEFORE_REGEX = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "void", "yield", "await", "else"]);

/** The index just past a string, comment, template literal or regular expression that starts at index, or -1 when none does. */
function skipNonCode(text, index) {
  const char = text[index];
  if (char === '"' || char === "'") {
    let at = index + 1;
    while (at < text.length && text[at] !== char && text[at] !== "\n") at += text[at] === "\\" ? 2 : 1;
    return at + 1;
  }
  if (char === "`") {
    let at = index + 1;
    while (at < text.length && text[at] !== "`") {
      if (text[at] === "\\") at += 2;
      else if (text[at] === "$" && text[at + 1] === "{") at = matchingCloseIndex(text, at + 1) + 1;
      else at += 1;
    }
    return at + 1;
  }
  if (char !== "/") return -1;
  if (text[index + 1] === "/") {
    const end = text.indexOf("\n", index);
    return end === -1 ? text.length : end;
  }
  if (text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (!startsRegex(text, index)) return -1;
  let at = index + 1;
  let isInClass = false;
  while (at < text.length && text[at] !== "\n") {
    if (text[at] === "\\") at += 2;
    else if (text[at] === "[") (isInClass = true), (at += 1);
    else if (text[at] === "]") (isInClass = false), (at += 1);
    else if (text[at] === "/" && !isInClass) break;
    else at += 1;
  }
  at += 1;
  while (/[a-z]/.test(text[at] ?? "")) at += 1;
  return at;
}

function startsRegex(text, index) {
  let at = index - 1;
  while (at >= 0 && /\s/.test(text[at])) at -= 1;
  if (at < 0) return true;
  if (BEFORE_REGEX.has(text[at])) return true;
  const word = /[A-Za-z_$]+$/.exec(text.slice(Math.max(0, at - 10), at + 1))?.[0];
  return word !== undefined && KEYWORDS_BEFORE_REGEX.has(word);
}

/** The index of the bracket closing the one at openIndex, or the text's end when it never closes. */
export function matchingCloseIndex(text, openIndex) {
  const closers = [OPENERS[text[openIndex]]];
  let at = openIndex + 1;
  while (at < text.length) {
    const skipped = skipNonCode(text, at);
    if (skipped !== -1) {
      at = skipped;
      continue;
    }
    const char = text[at];
    if (OPENERS[char]) closers.push(OPENERS[char]);
    else if (char === closers.at(-1)) {
      closers.pop();
      if (closers.length === 0) return at;
    }
    at += 1;
  }
  return text.length;
}

/** The next index at or after index that isn't whitespace. */
function skipSpace(text, index) {
  let at = index;
  while (at < text.length && /\s/.test(text[at])) at += 1;
  return at;
}

/** Past a generic's <…> starting at index (the `=>` of a function type isn't a close). */
function skipAngles(text, index) {
  let depth = 0;
  let at = index;
  while (at < text.length) {
    const char = text[at];
    if (OPENERS[char]) at = matchingCloseIndex(text, at) + 1;
    else if (char === "<") (depth += 1), (at += 1);
    else if (char === ">" && text[at - 1] !== "=") {
      depth -= 1;
      at += 1;
      if (depth === 0) return at;
    } else at += 1;
  }
  return at;
}

/** The index of a function's body `{`, from just past its parameter list (skipping a return type), or -1 when there's no body here. */
function bodyOpenIndex(text, afterParameters) {
  let at = skipSpace(text, afterParameters);
  if (text[at] === "{") return at;
  if (text[at] !== ":") return -1;
  at += 1;
  let isTypeStarted = false;
  while (at < text.length) {
    at = skipSpace(text, at);
    const char = text[at];
    if (char === "{" && isTypeStarted) return at;
    if (char === ";" || char === "=" || char === undefined) return -1;
    if (OPENERS[char]) at = matchingCloseIndex(text, at) + 1;
    else if (char === "<") at = skipAngles(text, at);
    else at += 1;
    if (!/[|&]/.test(char)) isTypeStarted = true;
    else isTypeStarted = false;
  }
  return -1;
}

/** The end (inclusive) of a function or method whose name ends at nameEnd, or -1 when it isn't one. */
function functionEndIndex(text, nameEnd) {
  let at = skipSpace(text, nameEnd);
  if (text[at] === "<") at = skipSpace(text, skipAngles(text, at));
  if (text[at] !== "(") return -1;
  const bodyAt = bodyOpenIndex(text, matchingCloseIndex(text, at) + 1);
  return bodyAt === -1 ? -1 : matchingCloseIndex(text, bodyAt);
}

/** The end (inclusive) of a const whose name ends at nameEnd: its value up to the `;` that ends it. */
function constEndIndex(text, nameEnd) {
  let at = nameEnd;
  while (at < text.length) {
    const skipped = skipNonCode(text, at);
    if (skipped !== -1) {
      at = skipped;
      continue;
    }
    const char = text[at];
    if (OPENERS[char]) at = matchingCloseIndex(text, at) + 1;
    else if (char === "<") at = skipAngles(text, at);
    else if (char === ";") return at;
    else at += 1;
  }
  return text.length - 1;
}

const escapeForRegex = (name) => name.replace(/[$]/g, "\\$&");

/**
 * The source text of one named top-level function, const or class, a class's method, or the file's
 * `export default` (symbolName "default"), from its first line to its closing bracket; null when the file
 * has none by that name.
 */
export function extractSymbol(sourceText, symbolName) {
  const name = escapeForRegex(symbolName);
  const declarations = [
    { pattern: new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:async[ \\t]+)?function\\*?[ \\t]+${name}(?![\\w$])`, "gm"), endOf: functionEndIndex },
    { pattern: new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:const|let|var)[ \\t]+${name}(?![\\w$])`, "gm"), endOf: constEndIndex },
    { pattern: new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?class[ \\t]+${name}(?![\\w$])`, "gm"), endOf: (text, nameEnd) => matchingCloseIndex(text, text.indexOf("{", nameEnd)) },
    { pattern: new RegExp(`^[ \\t]+(?:(?:public|private|protected|static|async|readonly|override)[ \\t]+)*${name}(?=[ \\t]*[<(])`, "gm"), endOf: functionEndIndex },
  ];
  if (symbolName === "default") declarations.push({ pattern: /^export[ \t]+default[ \t]+(?=\{)/gm, endOf: (text, nameEnd) => matchingCloseIndex(text, nameEnd) });
  for (const { pattern, endOf } of declarations) {
    for (const match of sourceText.matchAll(pattern)) {
      const endIndex = endOf(sourceText, match.index + match[0].length);
      if (endIndex !== -1) return sourceText.slice(match.index, endIndex + 1);
    }
  }
  return null;
}

/** Runs of whitespace as one space, trimmed: a reformat isn't a change. */
export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** The sha256 (hex) of a symbol's whitespace-normalised source, or null when the file has no such symbol. */
export function hashSymbol(sourceText, symbolName) {
  const symbolText = extractSymbol(sourceText, symbolName);
  return symbolText === null ? null : createHash("sha256").update(normalizeWhitespace(symbolText)).digest("hex");
}

/**
 * { [anchor_id]: hash or null } for a door's anchors, each { anchor_id, source_path, symbol_name }; a
 * missing file hashes null too. sourceByPath keeps files read across calls.
 */
export function anchorHashes(repoRoot, anchorList, sourceByPath = new Map()) {
  const readSource = (sourcePath) => {
    if (!sourceByPath.has(sourcePath)) {
      try {
        sourceByPath.set(sourcePath, readFileSync(join(repoRoot, sourcePath), "utf8"));
      } catch {
        sourceByPath.set(sourcePath, null);
      }
    }
    return sourceByPath.get(sourcePath);
  };
  return Object.fromEntries(anchorList.map((anchor) => {
    const sourceText = readSource(anchor.source_path);
    return [anchor.anchor_id, sourceText === null ? null : hashSymbol(sourceText, anchor.symbol_name)];
  }));
}
