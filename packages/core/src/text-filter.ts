import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

/**
 * Zaisma's text filter, for words players type that other players see on zaisma.com, like room names
 * and labels (docs/DECISIONS.md). It blocks two things, including spellings dressed up to get past it:
 * ways to reach someone somewhere else (links, emails, handles, phone numbers, contact apps), which
 * is how strangers move a 13-year-old to a private chat, and slurs and sexual words (the obscenity
 * library's English list). It doesn't judge meaning; reports catch what it misses. Games can use it
 * too, through Zaisma.filterText.
 */

const words = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

// Characters that hide text or flip its direction: dropped before anything is checked or shown.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Tidy text before it's checked or stored: no hidden characters, single spaces, at most maximumCharacterCount characters. */
export function tidyText(text: unknown, maximumCharacterCount: number): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumCharacterCount)
    .trim();
}

const CONTACT = [
  /https?:|www\.|\.(com|net|org|gg|io|me|co|xyz|app|ly|tv|link|chat)\b/i, // links
  /\b(dot|d0t)\s*(com|net|org|gg|io|me)\b/i, // "example dot com"
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, // emails
  /(^|[\s(])@[a-z0-9_.]{2,}/i, // handles
  /(\d[\s.\-()+]*){7,}/, // phone numbers, however they're spaced
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
