import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";
import { CHAT_FILTER_LIMITS } from "./chat-filter.ts";

/**
 * Zaisma's text filter, for words players type that other players see on zaisma.com, like room names
 * and labels (docs/DECISIONS.md). It blocks two things, including spellings dressed up to get past it:
 * ways to reach someone somewhere else (links, emails, handles, phone numbers, contact apps), which
 * is how strangers move a 13-year-old to a private chat, and slurs and sexual words (the obscenity
 * library's English list). It doesn't judge meaning; reports catch what it misses. Chat has its own
 * rules below (checkChatText), which games reach through Zaisma.filterText.
 */

const words = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

// Characters that hide text or flip its direction: dropped before anything is checked or shown.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Tidy text before it's checked or stored: no hidden characters, single spaces, at most maximumCharacterCount characters. */
export function tidyText(text: unknown, maximumCharacterCount: number): string {
  return String(text ?? "")
    .normalize("NFKC")
    // A line break or tab is a space, so the words on either side never run together.
    .replace(/[\t\n\v\f\r\u2028\u2029]/g, " ")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumCharacterCount)
    .trim();
}

/** Tidy a chat message to show: as tidyText, but its line breaks stay (at most one blank line in a row). */
export function tidyChatText(text: unknown, maximumCharacterCount: number): string {
  const lines = String(text ?? "").replace(/\r\n?|\u2028|\u2029/g, "\n").split("\n").map((line) => tidyText(line, maximumCharacterCount));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maximumCharacterCount).trim();
}

// A phone number, however it's spaced.
const PHONE_NUMBER = /(\d[\s.\-()+]*){7,}/;

const CONTACT = [
  /https?:|www\.|\.(com|net|org|gg|io|me|co|xyz|app|ly|tv|link|chat)\b/i, // links
  /\b(dot|d0t)\s*(com|net|org|gg|io|me)\b/i, // "example dot com"
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, // emails
  /(^|[\s(])@[a-z0-9_.]{2,}/i, // handles
  PHONE_NUMBER,
  /\b(add|dm|msg|message|text|call|follow|hmu|hit)\s+(me|us)\b/i, // "add me", "dm me"
  /\bmy\s+(number|snap|insta|ig|discord|tag|user(name)?)\b/i,
  /\b(snap|sc|ig|insta|kik|fb|tg)\s*[:=-]\s*\S/i, // "snap: name"
];

// Contact apps, matched with every gap and dressed-up letter taken out ("d i s c 0 r d").
const APPS = ["discord", "snapchat", "instagram", "tiktok", "whatsapp", "telegram", "skype", "facebook", "wechat", "onlyfans"];
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "!": "i", "|": "l" };
const squeeze = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0134578@$!|]/g, (character) => LEET[character] ?? character)
    .replace(/[^a-z]/g, "");

export interface TextCheck {
  isAllowed: boolean;
  /** Why it was blocked: a way to contact someone, or words that aren't allowed. */
  reason?: "contact" | "words";
}

/** Whether text can be shown to other players. Empty text is fine. */
export function checkText(text: string): TextCheck {
  const clean = tidyText(text, 500);
  if (!clean) return { isAllowed: true };
  const squeezed = squeeze(clean);
  if (CONTACT.some((pattern) => pattern.test(clean)) || APPS.some((app) => squeezed.includes(app))) return { isAllowed: false, reason: "contact" };
  // Letters spelled out one at a time ("f u c k") are joined back up; real words are left apart.
  const joined = clean.replace(/(?:(?<![\p{L}\p{N}])[\p{L}\p{N}](?![\p{L}\p{N}])[\s._*-]*){3,}/gu, (run) => run.replace(/[\s._*-]/g, "") + " ");
  if (words.hasMatch(clean) || words.hasMatch(joined)) return { isAllowed: false, reason: "words" };
  return { isAllowed: true };
}

/**
 * The chat filter's rules (docs/DECISIONS.md, "The text filter catches what matters and leaves the rest
 * alone"), run on Zaisma's side on every message to or from an under-18 account. They stop contact
 * details in any disguise, moving apps or meeting up, personal details, slurs and sexual words; swearing
 * is only flagged (hasSwearing), since it's the game's call. What the rules can't tell goes to a small
 * AI model as unclear: words that often come before grooming, a lone run of digits (a score or a phone
 * number) and other languages, whose words the English lists don't know.
 */
export type ChatBlockReason = "contact_details" | "personal_details" | "slur" | "sexual";

export interface ChatTextCheck {
  verdict: "allowed" | "blocked" | "unclear";
  /** Why it was blocked; null unless verdict is blocked. */
  reason: ChatBlockReason | null;
  /** Whether it swears: allowed by Zaisma, for the game to block if it likes. */
  hasSwearing: boolean;
}

/** Slurs in the obscenity library's English list, by the word each of its phrases stands for. */
export const SLUR_WORDS: readonly string[] = ["abo", "abeed", "africoon", "arabush", "boonga", "chingchong", "chink", "dyke", "fag", "kike", "negro", "nigger", "retard", "spastic", "tranny"];

/** Sexual words in the same list. Every other word in it is swearing, which is flagged and never blocked. */
export const SEXUAL_WORDS: readonly string[] = [
  "anal", "anus", "bestiality", "blowjob", "boob", "buttplug", "cock", "cum", "deepthroat", "dildo", "doggystyle", "double penetration", "ejaculate", "felch", "fellatio", "finger bang", "fisting",
  "gangbang", "handjob", "hentai", "hooker", "incest", "jerk off", "jizz", "lubejob", "masturbate", "orgasm", "orgy", "penis", "porn", "pussy", "rape", "semen", "sex", "slut", "tit", "vagina", "wank", "whore",
];

/** Words and phrases the AI should see in chat: they're fine in most messages but often come before grooming. */
export const CHAT_UNCLEAR_WORDS: readonly string[] = ["where", "live", "school", "address", "street", "pic", "pics", "photo", "picture", "selfie", "alone", "parents", "secret", "meet", "irl", "body", "cam", "video call", "real name", "last name"];

const matcherOf = (keep: (word: string) => boolean) =>
  new RegExpMatcher({ ...new DataSet<{ originalWord: string }>().addAll(englishDataset).removePhrasesIf((phrase) => !keep(phrase.metadata!.originalWord)).build(), ...englishRecommendedTransformers });
const slurs = matcherOf((word) => SLUR_WORDS.includes(word));
const sexualWords = matcherOf((word) => SEXUAL_WORDS.includes(word));
const swearing = matcherOf((word) => !SLUR_WORDS.includes(word) && !SEXUAL_WORDS.includes(word));

// Contact details in chat: CONTACT without its digit run, which alone is unclear (a score or a phone
// number), plus moving apps or meeting up, and numbers written as words.
const CHAT_CONTACT = [
  ...CONTACT.filter((pattern) => pattern !== PHONE_NUMBER),
  /\b(meet\s*(up|me|irl)|come\s+(over\s+)?to\s+my\s+(house|place|home)|what'?s\s+your\s+(address|number|phone|snap|insta|discord))\b/i,
  /\b(move|go|talk|chat)\s+(to|on)\s+(another|a different|a private|other)\s+(app|site|server|chat)\b/i,
];
const NUMBER_WORDS = /(?:(?:\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b|\d)[\s,.\-()+]*){7,}/i;
const DIGITS_ONLY = /^[\d\s.\-()+]+$/;

const PERSONAL = [
  /\b(what|which)\s+school\b|\bwhere\s+do\s+(you|u)\s+(live|go\s+to\s+school)\b/i,
  /\bwhat'?s?\s+(is\s+)?(your|ur)\s+(real|full|last)\s+name\b/i,
  /\bi\s+live\s+(on|at)\s+\d|\b\d+\s+[a-z]+\s+(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|boulevard|blvd)\b/i,
  /\bmy\s+(address|school|home\s+address)\s+is\b|\bi\s+go\s+to\s+[a-z]+\s+(school|high|middle|elementary|academy)\b/i,
  /\bsend\s+(me\s+)?(a\s+|some\s+|ur\s+|your\s+)?(pic|pics|photo|photos|picture|pictures|selfie|selfies)\b/i,
];

// Sexual asks the word list doesn't have.
const SEXUAL_PHRASES = /\b(nudes?|noods?|nudez|sext(ing)?)\b/i;

const UNCLEAR = new RegExp(`\\b(${CHAT_UNCLEAR_WORDS.map((word) => word.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

const isContact = (text: string) => CHAT_CONTACT.some((pattern) => pattern.test(text)) || APPS.some((app) => squeeze(text).includes(app)) || (NUMBER_WORDS.exec(text)?.[0] ?? "").match(/[a-z]/i) !== null;
const spelledOut = (text: string) => text.replace(/(?:(?<![\p{L}\p{N}])[\p{L}\p{N}](?![\p{L}\p{N}])[\s._*-]*){3,}/gu, (run) => run.replace(/[\s._*-]/g, "") + " ");
// Numbers on their own aren't words, even when they read as letters ("455").
const hasWords = (matcher: RegExpMatcher, text: string) => {
  const words = text.replace(/(?<![\p{L}\p{N}])\p{N}+(?![\p{L}\p{N}])/gu, " ");
  return matcher.hasMatch(words) || matcher.hasMatch(spelledOut(words));
};

/**
 * Whether a chat message can be sent. recentTexts are the same sender's last messages (up to 5 in the
 * last 2 minutes, oldest first), so contact details sent in pieces are caught too.
 */
export function checkChatText(text: string, recentTexts: string[] = []): ChatTextCheck {
  const clean = tidyText(text, CHAT_FILTER_LIMITS.maximumMessageCharacterCount);
  const hasSwearing = clean !== "" && hasWords(swearing, clean);
  const blocked = (reason: ChatBlockReason): ChatTextCheck => ({ verdict: "blocked", reason, hasSwearing });
  if (!clean) return { verdict: "allowed", reason: null, hasSwearing };
  const recent = recentTexts.map((recentText) => tidyText(recentText, CHAT_FILTER_LIMITS.maximumMessageCharacterCount)).filter(Boolean);
  // Pieces: the message joined to the ones before it, unless one of those was contact details already (and blocked then).
  const isSplitContact = recent.length > 0 && !recent.some(isContact) && isContact([...recent, clean].join(" "));
  // A number sent a few digits at a time: the run of digit-only messages this one ends.
  const digitPieces: string[] = [];
  for (const piece of [...recent, clean].reverse()) {
    if (!DIGITS_ONLY.test(piece)) break;
    digitPieces.unshift(piece);
  }
  const isSplitNumber = digitPieces.length > 1 && DIGITS_ONLY.test(clean) && PHONE_NUMBER.test(digitPieces.join(" ")) && !PHONE_NUMBER.test(clean);
  if (isContact(clean) || isSplitContact || isSplitNumber) return blocked("contact_details");
  if (PERSONAL.some((pattern) => pattern.test(clean))) return blocked("personal_details");
  if (hasWords(slurs, clean)) return blocked("slur");
  if (hasWords(sexualWords, clean) || SEXUAL_PHRASES.test(clean)) return blocked("sexual");
  // Letters outside English's a to z (accents, other scripts): the lists are English, so the AI looks.
  const isOtherLanguage = /[^\P{L}a-z]/iu.test(clean);
  if (UNCLEAR.test(clean) || PHONE_NUMBER.test(clean) || isOtherLanguage) return { verdict: "unclear", reason: null, hasSwearing };
  return { verdict: "allowed", reason: null, hasSwearing };
}
