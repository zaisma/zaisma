import type { InputProblem } from "./developers.ts";

/**
 * Text a developer or player saves that Zaisma's pages show to others: titles, names, descriptions, patch
 * notes, forum posts (docs/DECISIONS.md, "Stored values safe where they show"). Any language and emoji are
 * welcome; what's refused is the characters that hide text or flip its direction, used for blank names,
 * names that pass for another game's and words smuggled to an AI that reads the page. Kept on purpose:
 * zero-width joiners (emoji and many scripts need them), the left-to-right and right-to-left marks
 * (right-to-left text needs them) and variation selectors.
 */

/**
 * The characters shown text can't hold: controls (a block keeps its line breaks and tabs), the soft
 * hyphen, the grapheme joiner, Hangul and Mongolian fillers, Khmer's invisible vowels, the zero-width
 * space, word joiner and invisible operators, direction embeddings, overrides and isolates, the byte
 * order mark, and tag characters (outside a flag, checked apart).
 */
export const HIDDEN_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180e\u200b\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0]|[\u{e0000}-\u{e007f}]/u;

/** A black flag followed by tag characters and the cancel tag: England's, Scotland's and Wales's flags. */
const TAG_FLAG = /\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f}/gu;

/** Something a person can see: a letter, number, punctuation or symbol (but the blank braille pattern, which is a symbol that shows nothing). */
const VISIBLE = /(?!\u2800)[\p{L}\p{N}\p{P}\p{S}]/u;

export interface ShownTextOptions {
  field: string;
  maximumCharacterCount: number;
  /** Keeps line breaks and tabs; otherwise every run of spaces becomes one. */
  isMultiline?: boolean;
  /** Needs something visible; otherwise "" is fine. */
  isRequired?: boolean;
}

/** The first character shown text can't hold, as U+XXXX, or null when there's none. */
export function hiddenCharacterOf(text: string): string | null {
  const found = HIDDEN_CHARACTERS.exec(text.replace(TAG_FLAG, ""));
  return found ? `U+${found[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` : null;
}

/**
 * Check shown text from a door (docs/NAMING.md): NFC, trimmed, single spaces on one line, no hidden
 * characters, at most maximumCharacterCount characters. Returns the tidied text or a plain error
 * (bad_<field>), naming the character so the developer or their AI can find it.
 */
export function checkShownText(input: unknown, options: ShownTextOptions): { text: string } | { problem: InputProblem } {
  const { field, maximumCharacterCount } = options;
  const fix = `Give ${options.isRequired ? "1" : "0"} to ${maximumCharacterCount} characters. Any language and emoji are fine; invisible characters and ones that flip text direction aren't.`;
  if (typeof input !== "string") return { problem: { field, message: `${field} isn't text.`, fix } };
  const normalized = input.normalize("NFC");
  const text = options.isMultiline ? normalized.replace(/\r\n?/g, "\n").trim() : normalized.replace(/\s+/g, " ").trim();
  const hidden = hiddenCharacterOf(text);
  if (hidden) return { problem: { field, message: `${field} holds ${hidden}, a character that's invisible or flips text direction.`, fix: `Remove ${hidden}. ${fix}`, messageForPeople: `It holds a character that's invisible or flips text direction (${hidden}). Remove it and try again.` } };
  if (options.isRequired && !VISIBLE.test(text)) return { problem: { field, message: text ? `${field} has nothing visible in it.` : `${field} is empty.`, fix, ...(text ? { messageForPeople: "It has nothing visible in it. Write something and try again." } : {}) } };
  if ([...text].length > maximumCharacterCount) return { problem: { field, message: `${field} is over ${maximumCharacterCount} characters.`, fix } };
  return { text };
}
