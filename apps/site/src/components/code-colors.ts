import { esc } from "../markup.ts";

/** The languages a Code block colors; any other code shows in one color. */
export type CodeLanguage = "javascript" | "typescript" | "json" | "shell" | "gdscript" | "csharp" | "lua" | "html" | "css";

/** Each language's name as a Code block's head says it, the words that are its own, and how its comments open (and close). */
const LANGUAGES: Record<CodeLanguage, { name: string; keywords: string; lineComment?: string; blockComment?: [string, string] }> = {
  javascript: {
    name: "JavaScript",
    keywords: "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  typescript: {
    name: "TypeScript",
    keywords: "abstract as async await break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let new null of private protected public readonly return satisfies static super switch this throw true try type typeof undefined var void while yield",
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  json: { name: "JSON", keywords: "true false null" },
  shell: { name: "Shell", keywords: "case do done elif else esac export fi for function if in local return then until while", lineComment: "#" },
  gdscript: {
    name: "GDScript",
    keywords: "and await break class class_name const continue elif else enum extends false for func if in is match not null or pass return self signal static super true var while",
    lineComment: "#",
  },
  csharp: {
    name: "C#",
    keywords: "abstract async await base bool break case catch class const continue default do double else enum false finally float for foreach if in int interface internal namespace new null out override private protected public readonly return sealed static string struct switch this throw true try using var virtual void while",
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  lua: { name: "Lua", keywords: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while", lineComment: "--", blockComment: ["--[[", "]]"] },
  html: { name: "HTML", keywords: "", blockComment: ["<!--", "-->"] },
  css: { name: "CSS", keywords: "", blockComment: ["/*", "*/"] },
};

/** A language's name for a Code block's head: "JavaScript". */
export const codeLanguageName = (codeLanguage: CodeLanguage): string => LANGUAGES[codeLanguage].name;

const forRegExp = (words: string) => words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Code as safe HTML, its parts colored: the language's own words, strings, numbers and comments, each in a span (code-keyword,
 * code-string, code-number, code-comment); everything else as it was. HTML colors its tags instead of words. Done here, on the server, so
 * the page carries no highlighter. Without a language, it's the code escaped, in one color.
 */
export function colorCode(code: string, codeLanguage?: CodeLanguage): string {
  if (!codeLanguage) return esc(code);
  const language = LANGUAGES[codeLanguage];
  const keywords = new Set(language.keywords.split(" ").filter(Boolean));
  const comments = [
    language.blockComment ? `${forRegExp(language.blockComment[0])}[\\s\\S]*?(?:${forRegExp(language.blockComment[1])}|$)` : "",
    language.lineComment ? `${forRegExp(language.lineComment)}[^\\n]*` : "",
  ].filter(Boolean);
  const parts = [
    comments.length ? `(${comments.join("|")})` : "((?!))",
    `("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'${codeLanguage === "javascript" || codeLanguage === "typescript" ? "|`(?:\\\\.|[^`\\\\])*`" : ""})`,
    codeLanguage === "html" ? "(<\\/?[A-Za-z][\\w-]*|\\/?>)" : "(\\b\\d[\\w.]*)",
    "([A-Za-z_$][\\w$]*)",
  ];
  const pattern = new RegExp(parts.join("|"), "g");
  let out = "";
  let fromIndex = 0;
  for (const found of code.matchAll(pattern)) {
    const [whole, comment, quoted, numberOrTag, word] = found;
    const kind = comment ? "comment" : quoted ? "string" : numberOrTag ? (codeLanguage === "html" ? "keyword" : "number") : word && keywords.has(word) ? "keyword" : "";
    out += esc(code.slice(fromIndex, found.index)) + (kind ? `<span class="code-${kind}">${esc(whole)}</span>` : esc(whole));
    fromIndex = found.index + whole.length;
  }
  return out + esc(code.slice(fromIndex));
}
