/**
 * The word rules every public word keeps (docs/DESIGN.md, Voice), as data and one checker, so the
 * docs, the tests and the pages share one list. A page is checked in its register: "page" for the
 * site, dashboard and notices, "legal" for everything under /legal/, which also writes contractions out.
 */
export type WordsRegister = "page" | "legal";

/** Marketing, startup and platform words: a hard noun or the plain fact says it instead. */
export const BANNED_WORDS = [
  "unlock",
  "seamless",
  "seamlessly",
  "exclusive",
  "powerful",
  "next-level",
  "leverage",
  "ecosystem",
  "empower",
  "unleash",
  "worlds",
  "magic",
  "journey",
  "community",
  "creators",
  "imagination",
  "experiences",
] as const;

/** Words that cushion or pad a sentence and carry no fact. */
export const FILLER_WORDS = ["just", "simply", "really", "actually", "of course", "easily", "invisibly", "don't worry", "hang tight", "heads up", "oops", "feel free"] as const;

// Lowercase or capitalized only: all-caps "US" is the country.
const OUR_WORDS = /\b(?:we|us|our|ours|We|Us|Our|Ours)\b/g;
const CODE_NAME = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g;
const LEGAL_CONTRACTIONS = /n['’]t\b|['’](?:re|ve|ll|d)\b|\b(?:it|that|there|here|what)['’]s\b/gi;

const wordPattern = (words: readonly string[]) =>
  new RegExp(`(?<![\\w-])(?:${words.map((word) => word.replace(/[-]/g, "\\-").replace(/'/g, "['’]").replace(/ /g, "\\s+")).join("|")})(?![\\w-])`, "gi");
const BANNED_PATTERN = wordPattern(BANNED_WORDS);
const FILLER_PATTERN = wordPattern(FILLER_WORDS);

const found = (text: string, pattern: RegExp) => [...new Set([...text.matchAll(pattern)].map((match) => match[0]))];

/** What breaks the word rules in text a person reads, each naming the rule and the words; empty when nothing does. */
export function wordProblems(text: string, register: WordsRegister): string[] {
  const problems: string[] = [];
  const rule = (name: string, words: string[]) => {
    if (words.length) problems.push(`${name}: ${words.join(", ")}`);
  };
  rule('Zaisma, never "we"', found(text, OUR_WORDS));
  if (text.includes("!")) problems.push('No "!"');
  rule("No marketing words", found(text, BANNED_PATTERN));
  rule("No filler", found(text, FILLER_PATTERN));
  rule("No names from the code", found(text, CODE_NAME));
  if (register === "legal") rule("No contractions on legal pages", found(text, LEGAL_CONTRACTIONS));
  return problems;
}
