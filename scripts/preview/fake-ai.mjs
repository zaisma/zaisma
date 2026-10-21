// A stand-in for the Claude API, for local previews only, so scans and report triage run without a
// real key or cost. It answers from keywords, nothing clever:
// - scans pass, unless a re-check after a report mentions a password or login (then it's phishing);
// - forum posts pass, unless they ask to be reached on another app;
// - profiles pass, unless they name a school or ask to meet up;
// - the listing check finds every picture fine, and reads the title for tags and "robux";
// - reports are sorted by what the player wrote: bugs go to the developer, claims about the game's
//   content get its files checked again, players get a person, and the rest is dismissed. A report
//   fits the drafted precedent for its kind once that precedent is in force; until then it comes
//   with a draft.
import http from "node:http";
import { fileURLToPath } from "node:url";

const KINDS = [
  { precedent: "hard-or-boring", title: "Too hard, boring or not fun", when: "The player doesn't like the game but names nothing against the content rules.", test: /boring|too hard|not fun|unfair/i, severity: "low", category: "other", recommendation: "dismiss", summary: (d) => `Doesn't like the game: ${d}`, why: "Not liking a game isn't a rule break." },
  { precedent: "broken", title: "Crashes, freezes or won't load", when: "The game won't load, crashes or freezes, or its controls don't work.", test: /freez|crash|stuck|won.?t load|black screen|lag|bug|broken/i, severity: "normal", category: "broken", recommendation: "bug", summary: (d) => `A bug: ${d}`, why: "It's a technical problem for the developer." },
  { precedent: "asks-for-login", title: "Asks for a password or login", when: "The game asks players for a password, a card or a login for another site.", test: /password|login|card|steam|wallet|download/i, severity: "urgent", category: "malware", recommendation: "recheck", summary: (d) => `Says the game asks for something it shouldn't: ${d}`, why: "If the game is phishing, its files will show it." },
  { precedent: "sexual-in-game", title: "Nudity in the game", when: "The report says the game itself shows nudity or sexual content.", test: /nud|naked|sex|porn/i, severity: "high", category: "sexual", recommendation: "recheck", summary: (d) => `Says the game shows sexual content: ${d}`, why: "Its files will show whether that's in the game." },
  { precedent: "real-people-in-game", title: "A real person's private details in the game", when: "The report says the game shows where a real person lives, their number or school, or threatens them.", test: /address|lives at|phone number|school|doxx|threat/i, severity: "high", category: "real_people", recommendation: "recheck", summary: (d) => `Says the game shows a real person's private details: ${d}`, why: "Its files will show whether that's in the game." },
];

/** Fits the precedent in force for this kind of report, or drafts one. */
function precedentFor(system, kind) {
  if (kind?.precedent && system.includes(`[${kind.precedent}]`)) return { precedent: kind.precedent, fit: "fits", draft: { title: "", applies_when: "", decision: "", why: "" } };
  const draft = kind
    ? { title: kind.title, applies_when: kind.when, decision: kind.recommendation, why: kind.why }
    : { title: "Nothing specific", applies_when: "The report names nothing against the content rules.", decision: "dismiss", why: "Nothing to act on." };
  return { precedent: "", fit: "none", draft };
}

function sortReport(text, system) {
  const report = text.match(/<report[^>]*>([\s\S]*?)<\/report>/)?.[1] ?? "";
  const details = report.match(/Details: "([\s\S]*)"/)?.[1] ?? "";
  const player = report.match(/About a player: "([^"]*)"/)?.[1];
  const playerId = report.match(/temporary ID ([^,)]+)/)?.[1];
  const kindOf = (s) => KINDS.find((k) => k.test.test(s));
  const kind = kindOf(details);
  // The same problem: an earlier open report with the same kind of words.
  const same = [...text.matchAll(/^id ([a-z0-9_]+), sent [^:]*: (.*)$/gm)].find(([, , line]) => (player ? line.includes(`player ${playerId}`) : kindOf(line) && kindOf(line) === kind));
  if (player) {
    const reason = report.match(/Reason picked: [^:]*: (.*)/)?.[1] ?? "Something else";
    // The four Zaisma looks at itself go to a person; the rest are the game's call, unless the words reach into real life.
    const isForZaisma = /in real life|personal details|after I blocked|Sexual/.test(reason);
    const reachesRealLife = /school|address|lives|wait outside|find (you|me)|meet up|phone/i.test(details);
    const isThreat = /in real life/.test(reason);
    const severity = reachesRealLife ? "urgent" : isForZaisma ? "high" : "normal";
    const recommendation = reachesRealLife || (isForZaisma && !isThreat) ? "person" : "pass_to_developer";
    const draft = recommendation === "person"
      ? { title: "A threat that reaches into real life", applies_when: "A player says they know where someone lives or goes to school, or that they'll find them.", decision: "stop_social", why: "That's past trash talk: Zaisma acts on it." }
      : { title: "Trash talk", applies_when: "A player is rude, insulting or says violent things about the game, with nothing that reaches into real life.", decision: "pass_to_developer", why: "How players talk to each other is the game's call." };
    return { severity, category: "player", summary: `${player} reported for ${reason.toLowerCase()}${details ? `: ${details}` : "."}`, recommendation, why: recommendation === "person" ? "It's one of the four things Zaisma acts on. (Preview stand-in AI.)" : "Nothing in it reaches into real life: the game's call. (Preview stand-in AI.)", same_as: same?.[1] ?? "", precedent: "", fit: "none", draft };
  }
  if (!kind) return { severity: "low", category: "other", summary: details ? `A player wrote: ${details}` : "No details given.", recommendation: "dismiss", why: "Nothing in it breaks the rules.", same_as: "", ...precedentFor(system, null) };
  return { severity: kind.severity, category: kind.category, summary: kind.summary(details), recommendation: kind.recommendation, why: kind.why, same_as: same?.[1] ?? "", ...precedentFor(system, kind) };
}

const CATEGORIES = [
  ["publishing", /upload|publish|version|build|MB\b/i],
  ["rooms", /room|multiplayer|player.*join|disconnect/i],
  ["saves", /save/i],
  ["mcp", /\bmcp\b|tool/i],
  ["pages", /game page|cover|screenshot/i],
  ["accounts", /account|sign.?in|domain/i],
];
const WORDS = (s) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

// Forum topics are sorted by their words: urgent for data loss or security, high when it blocks
// publishing, low for questions. A candidate sharing four or more words is the same problem;
// otherwise it drafts a known issue from the title, unless it's a question.
function sortTopic(text) {
  const item = text.match(/<topic[^>]*>([\s\S]*?)<\/topic>/)?.[1] ?? "";
  const kind = item.match(/^Kind: (.*)$/m)?.[1] ?? "bug";
  const title = item.match(/^Title: (.*)$/m)?.[1] ?? "";
  const severity = /lost|leak|security|everyone/i.test(item) ? "urgent" : /can.?t publish|blocks|stuck|fails/i.test(item) ? "high" : kind === "question" ? "low" : "normal";
  const category = CATEGORIES.find(([, re]) => re.test(item))?.[0] ?? "other";
  const words = WORDS(`${title} ${item}`);
  const same = [...text.matchAll(/^id ([a-z0-9_]+), (.*)$/gm)].find(([, , line]) => [...WORDS(line)].filter((w) => words.has(w)).length >= 4);
  return {
    severity,
    category,
    summary: `${kind === "question" ? "Asks" : kind === "bug" ? "Reports" : "Asks for"}: ${title}. (Preview stand-in AI.)`,
    why: same ? `Same words as ${same[1]}.` : `Looks ${severity}; nothing like it yet.`,
    same_as_topic_id: same?.[1] ?? "",
    known_issue_draft: same || kind === "question" ? { title: "", workaround: "" } : { title, workaround: "" },
  };
}

// Forum posts pass unless they ask to be reached somewhere else or share a number.
function checkPost(text) {
  const post = text.match(/<post>([\s\S]*?)<\/post>/)?.[1] ?? "";
  if (/discord|whatsapp|snapchat|my number|dm me/i.test(post)) return { verdict: "hold", reason: "Asks people to reach them on another app. (Preview stand-in AI.)" };
  return { verdict: "ok", reason: "" };
}

function checkProfile(text) {
  const profile = text.match(/<profile>([\s\S]*?)<\/profile>/)?.[1] ?? "";
  if (/school|high\b|meet up|my number/i.test(profile)) return { verdict: "hold", reason: "Names a school and asks to meet up. (Preview stand-in AI.)" };
  return { verdict: "ok", reason: "" };
}

// A draft ruling for a miss the review made (review-precedents.ts): a fixed one with a stand-in game.
function draftRuling(text) {
  const decision = text.match(/<decision>(\w+)<\/decision>/)?.[1] ?? "pass";
  return {
    title: decision === "pass" ? "Menu of fixed phrases" : "A real address in a level",
    applies_when: decision === "pass" ? "A menu of fixed phrases players pick from; nothing typed reaches another player." : "A level shows the street address of a real private person.",
    why: "A person decided the review was wrong. (Preview stand-in AI.)",
    case_title: "Stand-in game",
    case_description: "Written to show the pattern.",
    case_index_html: "<!doctype html><title>Stand-in</title><p>[a menu of fixed phrases]</p><button>Good game</button>",
  };
}

// The listing check ("No slop"): pictures can't be read here, so they're all fine; the title gets a tag for
// brackets, an emoji or NEW/UPDATE as a word, a fake reward for "robux", and a famous name for "minecraft".
function checkListing(text) {
  const words = text.match(/<words>([\s\S]*?)<\/words>/)?.[1] ?? "";
  const title = words.match(/^Title(?: \(not judged\))?: (.*)$/m)?.[1] ?? "";
  const isTitleJudged = !/^Title \(not judged\)/m.test(words);
  const description = words.match(/^Description(?: \(not judged\))?: (.*)$/m)?.[1] ?? "";
  const judgedCount = [...text.matchAll(/^Picture (\d+): .+, JUDGE$/gm)].map((match) => Number(match[1]));
  const no = { extra_text: "", overlay: "", fake_reward: "", famous_name: "", main_subject: "", is_main_subject_in_screenshots: true, added_after_capture: "", background_text: "", has_safety_concern: false };
  const tag = title.match(/\[[^\]]*\]|\([^)]*\)|\p{Extended_Pictographic}|\b(?:NEW|UPDATE)\b/u)?.[0] ?? "";
  return {
    pictures: judgedCount.map((number) => ({ ...no, number })),
    title_fake_reward: isTitleJudged && /robux/i.test(title) ? title : "",
    title_famous_name: isTitleJudged && /minecraft/i.test(title) ? "Minecraft" : "",
    title_tag: isTitleJudged ? tag : "",
    description_fake_reward: /robux/i.test(description) ? description : "",
    has_words_safety_concern: false,
  };
}

// The game review's readers take this as finding nothing (no items), and its judge as its verdict.
function scan(text) {
  const reported = text.match(/a player reported it[^:]*: (.*)/)?.[1] ?? "";
  if (/password|login|steam|card/i.test(reported)) {
    return { verdict: "reject", summary: "A login form copied from a real store collects passwords and sends them away.", has_sexual_content_involving_minors: false, followed_ruling_numbers: [], findings: [{ code: "ai_phishing_or_scam", evidence_item_numbers: [1], message: "Asks players for a store password." }], items: [] };
  }
  return { verdict: "pass", summary: "An ordinary game. (Preview stand-in AI.)", has_sexual_content_involving_minors: false, followed_ruling_numbers: [], findings: [], items: [] };
}

export function startFakeAi(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const request = JSON.parse(body || "{}");
        const content = request.messages?.[0]?.content ?? [];
        const text = (Array.isArray(content) ? content : [{ text: String(content) }]).map((b) => b.text ?? "").join("\n");
        // The system prompt is a string, or a list of blocks (the review's and the drafts', cached).
        const system = Array.isArray(request.system) ? request.system.map((b) => b.text ?? "").join("\n") : String(request.system ?? "");
        const answer = system.startsWith("You help Zaisma's AI game review learn") ? draftRuling(text) : system.startsWith("You sort reports") ? sortReport(text, system) : system.startsWith("You sort topics") ? sortTopic(text) : system.startsWith("You check forum posts") ? checkPost(text) : system.startsWith("You check player profiles") ? checkProfile(text) : system.startsWith("You check the pictures and words") ? checkListing(text) : scan(text);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `msg_preview_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: request.model,
            content: [{ type: "text", text: JSON.stringify(answer) }],
            stop_reason: "end_turn",
            usage: { input_tokens: Math.round(body.length / 4), output_tokens: 80 },
          }),
        );
      });
    });
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}

// Run on its own (node fake-ai.mjs <port>): the preview's set-up blocks while it waits for scans, and they need this to answer.
if (process.argv[1] === fileURLToPath(import.meta.url)) await startFakeAi(Number(process.argv[2]));
