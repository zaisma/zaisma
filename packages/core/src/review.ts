import { PLAN_LIMITS, type PlanKind, type PlanLimits } from "./plans.ts";
import type { ScanReport } from "./types.ts";

/**
 * Why Zaisma held, rejected or took something down ("Support, reports and moderation are designed
 * for AI first" in docs/DECISIONS.md): every hold, rejection and takedown has a stable code from one
 * list, a plain message, the content rule it's about and a fix, the same in the dashboard, the
 * developer API and the MCP. docs/DEVELOPER-API.md lists every code and rule, and
 * test/node/errors.test.ts keeps the two in step.
 */

/**
 * Zaisma's content rules (zaisma.com/legal/content-rules), in the page's order, by the name holds and
 * takedowns give them. The page's anchors are these names. Where a player's report reason means the
 * same thing (REPORT_REASONS), the name is the same.
 */
export const CONTENT_RULES = {
  child_safety: "Sexual content involving minors, in any form. Zaisma reports it to the National Center for Missing & Exploited Children.",
  sexual: "Sexually explicit content.",
  malware: "Malware, crypto mining, phishing, scams or anything that tries to break out of the game.",
  illegal: "Content that is illegal in the United States, including real-money gambling.",
  real_people: "Private details about real people, or real threats.",
  copyright: "Other people's games, art, music or characters used without permission.",
  defamation: "False claims that a real private person committed a crime.",
  personal_details:
    "Asking players for personal details like emails, real names, birthdays or location inside the game. Every player has a Zaisma ID and name; games with their own accounts link them through Sign in with Zaisma, and anything more happens on the developer's own site.",
  chat: "Typed chat between players outside Zaisma's chat hosting. In Zaisma rooms, chat goes through room.chat; on your own server, through canChat and checkChat. Preset phrases and emotes are always fine.",
  crypto:
    "Cryptocurrency other than Bitcoin: using or promoting other coins, tokens, NFTs or airdrops. A story that mentions one is fine. Bitcoin games are welcome, but not investment advice, mining on the player's device, paying players sats, or asking for seed phrases or permission to spend from a wallet.",
  purchases:
    "Selling paid random rewards (loot boxes), including through coins bought with money, or showing prices in coins or gems bought with money without the real price beside each one, even when the coins themselves are sold at a real price.",
  faked_plays: "Faking plays or players, with bots, scripts or click farms.",
} as const;
export type ContentRule = keyof typeof CONTENT_RULES;
/**
 * Where each rule's line is: the page shows it under the rule's short title, with its test, what's fine and what isn't, and an
 * explanation where the words alone leave the line unclear. The test is one yes/no question written from the Fine
 * and Not fine examples: the AI review lists evidence and judges only by it, and a clear yes rejects the version
 * ("Clear breaks are rejected without a person" in docs/DECISIONS.md).
 */
export const CONTENT_RULE_DETAILS: Record<ContentRule, { title: string; test: string; explanation?: string; fine: string; notFine: string }> = {
  child_safety: {
    title: "Child safety",
    test: "Is anything sexual involving someone who is or looks under 18, drawn, animated or AI-made included?",
    fine: "kids and teens as characters in any story that is not sexual.",
    notFine: "anything sexual involving someone who is or looks under 18, drawn, animated or AI-made included.",
  },
  sexual: {
    title: "Sexual content",
    test: "Does the game show nudity, or show or describe sex in detail, a \"censored\" bar included?",
    fine: "romance, kissing, dating sims, swimwear and dirty jokes.",
    notFine: "nudity, sex shown or described in detail, or porn behind a \"censored\" bar.",
  },
  malware: {
    title: "Malware and scams",
    test: "Does the code mine cryptocurrency, hide what it runs (obfuscated beyond ordinary minifying, or running text it decodes), get around one of Zaisma's protections, or imitate Zaisma or another service, or promise prizes, to get players' passwords, details or wallet access?",
    fine: "minified builds, opening your own site from the game's links, and saving in the browser.",
    notFine: "a \"free skins\" page that asks for a password, mining while you play, or code that tries to leave the game's frame.",
  },
  illegal: {
    title: "Illegal content and gambling",
    test: "Can players bet real money, or chips or anything bought with real money or cashed out, on chance?",
    fine: "casino, poker and slots played for points that cannot be bought or cashed out; crime as gameplay.",
    notFine: "bets with real money, or with chips that can be bought or cashed out.",
  },
  real_people: {
    title: "Real people",
    test: "Does it give a way to find or reach a real person who did not make it public (a home address, phone number, personal email, private account, school or work), or make a real threat of violence against a real person?",
    explanation:
      "Anything that lets players find or reach a real person who did not make it public: a home address, phone number, personal email or private account, or where they go to school or work. Or a real threat of violence against a real person.",
    fine: "anyone's name, face and photo; mocking, memes and satire; violence that is gameplay; places famous on their own (the White House, Epstein's island, a company's HQ); accounts and addresses people publish themselves.",
    notFine: "\"Jake lives at 12 Oak St\", a celebrity's leaked phone number, the school a kid goes to, or a message that means a real threat.",
  },
  copyright: {
    title: "Copyright",
    test: "Is someone else's game, art, music or characters used without their permission or license?",
    explanation: "Zaisma acts on it only when the owner sends a notice (see Copyright and DMCA notices).",
    fine: "a game inspired by another (the same genre, the same mechanics), parody with your own characters, and assets used within their license.",
    notFine: "Mario in your game, a ripped soundtrack, or someone else's game uploaded as yours.",
  },
  defamation: {
    title: "Defamation",
    test: "Does the game falsely say a real private person committed a crime?",
    explanation: "Zaisma acts on it only when that person sends a notice (see Defamation notices); Zaisma does not judge it itself.",
    fine: "satire, jokes and wild stories about politicians, celebrities and other public figures; crimes someone was publicly charged with or convicted of; made-up people.",
    notFine: "a game that names your neighbor Emma Clarke as the town's thief, or says a real classmate sells drugs.",
  },
  personal_details: {
    title: "Personal details",
    test: "Does the game ask players for an email, real name, birthday, age, location, phone number or password?",
    fine: "a nickname for the scoreboard, Sign in with Zaisma, and a link to your own site.",
    notFine: "\"Enter your email to save\", or asking for a birthday, age, city or real name.",
  },
  chat: {
    title: "Typed chat",
    test: "Can a player type text that another player reads as written, without it going through room.chat, or canChat and checkChat?",
    fine: "a chat box that sends with room.chat, preset phrases (\"GG\", \"Follow me\"), emotes, names for levels and rooms, text only the player who typed it sees, and a word game that checks what you type against its own list and tells everyone only whether it was right.",
    notFine: "players' typed messages sent with room.send or broadcast, or through another service.",
  },
  crypto: {
    title: "Crypto",
    test: "Does it use or promote a coin other than Bitcoin, a token, an NFT or an airdrop, or use Bitcoin for investment advice, mining on the player's device, paying players sats, or asking for a seed phrase or permission to spend from a wallet?",
    fine: "teaching Bitcoin, items for sats, tips, and a story with a meme-coin villain.",
    notFine: "an NFT skin shop, an airdrop, \"deposit sats, invite friends, earn more\", or asking for a seed phrase.",
  },
  purchases: {
    title: "Purchases",
    test: "Can players pay real money, or coins or gems bought with real money, for a random reward? Or are coins or gems sold for real money (like gem bundles bought with Zaisma.items.buy) and anything priced in them with no real price beside each price?",
    explanation: "Players always know what they pay for and what it costs in money: an item is sold by name, and a price in coins or gems shows the real price beside it.",
    fine: "a free daily chest, a shop that shows \"500 gems ($4.99)\", and cosmetics bought by name.",
    notFine: "a paid crate with a random skin, gems bought with money spent on a gacha pull, or a shop that sells gem bundles priced only in gems.",
  },
  faked_plays: {
    title: "Faked plays",
    test: "Does code, with no player action, join rooms or load the game again and again, so plays or players are counted that are not people?",
    fine: "asking players to share your game, tester links, and playing your own game.",
    notFine: "scripts that open your game in a thousand tabs, click farms, or bots that fill rooms.",
  },
};
/**
 * Rules Zaisma acts on only when the person they're about sends a notice: the review never looks for
 * them, since games borrow code and assets all the time and no file shows whether they may (Julius,
 * Oct 18, 2026), and whether a claim about a real person is true isn't Zaisma's to judge.
 */
export const NOTICE_ONLY_CONTENT_RULES: readonly ContentRule[] = ["copyright", "defamation"];
/** The rules the review looks for, in the page's order. */
export const REVIEWED_CONTENT_RULES = (Object.keys(CONTENT_RULES) as ContentRule[]).filter((rule) => !NOTICE_ONLY_CONTENT_RULES.includes(rule));
/**
 * What other platforms often ban that's fine on Zaisma, so developers and their AI don't hedge: the
 * rules page lists it, and the AI review and report triage treat it as fine.
 */
export const ALLOWED_CONTENT = [
  "Offensive, edgy and dark humor, insults and swearing.",
  "Jokes and opinions about any group, religion, country or political side. There's no hate-speech rule.",
  "Mocking, memes and satire of real people, from politicians to celebrities, with their name, face and photo.",
  "Violence that is gameplay: shooting, fighting, war and horror, including against real people.",
  "Real wars and history, with their uniforms, flags and symbols.",
  "Drinking, smoking and drugs as part of a story or setting.",
  "Casino and card games played for points or coins that cannot be bought or cashed out.",
  "Trash talk and fiery lobbies: how players talk to each other is up to each game.",
  "Bitcoin games: teaching it, Bitcoin themes, selling items for sats, and tips.",
] as const;
/** ALLOWED_CONTENT in a few words each, in the same order, for the rules page's tags: one title per entry, which the compiler holds. */
type TitlesOf<Entries extends readonly string[]> = { readonly [Index in keyof Entries]: string };
export const ALLOWED_CONTENT_TITLES: TitlesOf<typeof ALLOWED_CONTENT> = [
  "Edgy and dark humor",
  "Jokes about any group",
  "Satire of real people",
  "Gameplay violence",
  "Real wars and their symbols",
  "Drugs in a story",
  "Play-money casinos",
  "Trash talk",
  "Bitcoin games",
];
export const isContentRule = (candidate: unknown): candidate is ContentRule => typeof candidate === "string" && Object.hasOwn(CONTENT_RULES, candidate);

/** The fix for a hold a person decides: there's nothing for the developer to change. */
const PERSON_LOOKS = "Nothing to change: a person at Zaisma looks, usually within a day.";
/** What follows a fixed version of a game held on a notice. */
const NOTICE_CHECKED = "a person at Zaisma checks it's gone and shows the game again, usually within a day.";
/** Where the cover guide is, and how to ask a person when the listing check got it wrong. */
const COVER_GUIDE = "zaisma.com/developers/covers shows covers that pass and ones that don't.";
const IF_THE_CHECK_IS_WRONG = "If the check got it wrong: message_zaisma with the game_slug, and a person at Zaisma looks.";
/** What follows a listing line: the game is back on the lists once it's fixed. */
const BACK_ON_LISTS = "The game plays by its link meanwhile, and is back in lists about a minute after the fix.";

/** What a hold tells the developer a fixed version is checked for ("A fix is checked against its hold." in docs/DECISIONS.md). */
const FIXED_VERSION_CHECKED = "Upload a fixed version: it's checked for what this names and for anything you added. What we already passed stays passed.";

/** What follows an AI review's concern, whatever the developer changes. */
const IF_THE_AI_IS_WRONG = "If the review got it wrong: message_zaisma with the version_id, and a person at Zaisma looks, usually within a day; a version a person approves doesn't count against your daily reviews.";

interface ReviewCode {
  /** What it means, in one sentence: listed in docs/DEVELOPER-API.md, and the message when the code has no message of its own. */
  meaning: string;
  /** The content rule it's about, or null when it breaks none (a check that couldn't finish) or a person picks one each time. */
  contentRule: ContentRule | null;
  /** What to do about it, naming the call when there is one. */
  fix: string;
  /** The finding and what to do on the dashboard, in a page's words: never a call or field name. Kept even when the message is the case's own. */
  messageForPeople: string;
  /** The message is the case's own (the AI's words, a person's), not the meaning. */
  hasOwnMessage?: true;
  /** A person picks the content rule each time (or none). */
  isRulePicked?: true;
}


/** The two daily review findings' message: the developer's own limit, with the Pro number added on the free plan (plans.ts). */
export function dailyReviewMeaning(code: "daily_large_reviews_used" | "daily_small_reviews_used", plan: PlanKind): string {
  const [kind, limit, what, waits]: [string, keyof PlanLimits, string, string] =
    code === "daily_large_reviews_used"
      ? ["large", "maximumLargeReviewsPerDay", "a new game or a real change, judged", "waits"]
      : ["small", "maximumSmallReviewsPerDay", "versions read by the AI", "waits unread"];
  const proNote = plan === "free" ? ` Zaisma Pro has ${PLAN_LIMITS.pro[limit]} ${kind} reviews a day.` : "";
  return `This developer's ${PLAN_LIMITS[plan][limit]} ${kind} reviews for today (${what}) are used, so this version ${waits} for the next one to free up.${proNote}`;
}

/**
 * Every code a hold, rejection or takedown can have, by what decided it. Codes are lowercase
 * snake_case, never reused for another problem, and never the same as an error code.
 */
export const REVIEW_CODES = {
  // The scan's rule-based checks
  crypto_miner: { meaning: "The code mines cryptocurrency.", messageForPeople: "The game's code mines cryptocurrency. Take the mining code out and upload a new version.", contentRule: "malware", fix: "Take the mining code out and upload a new version." },
  packed_code: {
    meaning: "Code is packed or decoded at runtime (eval of encoded text), which hides what it does.",
    messageForPeople: "Some of the code is packed so that it hides what it runs. A person at Zaisma looks, usually within a day; an ordinary minified build passes by itself next time.",
    contentRule: "malware",
    fix: "A person at Zaisma looks, usually within a day. To pass by itself next time, upload the code without eval of encoded text; an ordinary minified build is fine.",
  },
  top_navigation: {
    meaning: "The code tries to change the page outside the game (the top or parent window's location).",
    messageForPeople: "The code tries to change the page outside the game. Take that code out and upload a new version, and open your sites from the game's links. A person at Zaisma also looks at this one, usually within a day.",
    contentRule: "malware",
    fix: 'Take out code that sets top.location or parent.location, and upload a new version; open your sites with Zaisma.links.open, from the links registered on the game (update_game links). A person also looks at the held one, usually within a day.',
  },
  relay_bypass: {
    meaning: "The code makes a WebRTC connection from a frame of its own, which skips Zaisma's relay and would show players each other's internet address.",
    messageForPeople: "The code connects players from a frame of its own, which skips Zaisma's relay and would show players each other's internet address. Connect from the game page itself and upload a new version. A person at Zaisma also looks at this one, usually within a day.",
    contentRule: "malware",
    fix: "Make connections with the game page's own RTCPeerConnection, as PeerJS and Godot do: on Zaisma every connection already goes through the relay, with no code to change. Upload a new version without the frame. A person also looks at the held one, usually within a day.",
  },
  password_field: {
    meaning: "The game has a password field. Games don't need one, and phishing pages do.",
    messageForPeople: "The game has a password field. Players sign in with Zaisma, so games never ask for passwords: take it out and upload a new version. A person at Zaisma also looks at this one, usually within a day.",
    contentRule: "malware",
    fix: "Take the password field out and upload a new version: players sign in with Zaisma, so games never ask for passwords. A person also looks at the held one, usually within a day.",
  },
  external_form: {
    meaning: "The game has a form that sends what players type to another site.",
    messageForPeople: "The game has a form that sends what players type to another site. Take it out and upload a new version. A person at Zaisma also looks at this one, usually within a day.",
    contentRule: "personal_details",
    fix: "Take the form out and upload a new version. A person also looks at the held one, usually within a day.",
  },
  antivirus_flag: {
    meaning: "Antivirus engines flag a file: three or more reject the version, fewer hold it for a person.",
    messageForPeople: "Antivirus engines flag a file in this version. Build it again from clean sources and upload a new version. If it's a false alarm, message Zaisma.",
    contentRule: "malware",
    fix: "Build the file again from clean sources and upload a new version. If it's a false alarm: a person at Zaisma decides a held version, usually within a day; for a rejected one, message_zaisma with the version_id.",
    hasOwnMessage: true,
  },
  unregistered_link: {
    meaning: "The game opens a site with window.open or a link that opens a new tab. The sandbox blocks that, so players tapping it get nothing.",
    messageForPeople: "The game opens a site the sandbox blocks, so players who tap it get nothing. Add the site to the game's links and open it from a tap. Nothing is held: this is a note.",
    contentRule: null,
    fix: "Register the site on the game (update_game links) and open it with Zaisma.links.open(name) from a tap. Nothing is held: this is a note.",
  },
  unlisted_address: {
    meaning: "The game connects to an address that isn't Zaisma rooms or one of its own servers. The game's security policy blocks it, so the call fails for players.",
    messageForPeople: "The game connects to a server it doesn't list, so the connection fails for players. Add the server to the game's own servers, or bundle what it loads into the files. Nothing is held: this is a note.",
    contentRule: null,
    fix: "Add the server to the game's own servers (update_game own_server_urls), or bundle what it loads into the files. Nothing is held: this is a note.",
  },
  matches_another_developers_game: {
    meaning: "Most of this version's files are already in another developer's game, so a person at Zaisma looks first.",
    messageForPeople: "Most of this version's files are in another developer's game, so a person at Zaisma looks first, usually within a day. If it's your own game on another account, or you have permission, message Zaisma.",
    contentRule: "copyright",
    fix: "Nothing to change if the game is yours: a person at Zaisma looks, usually within a day. If it's your own game on another account, or the developer gave you permission, say so with message_zaisma and the version_id.",
  },
  matches_banned_account_files: {
    meaning: "Most of its files match a game Zaisma took down.",
    messageForPeople: "Most of its files match a game Zaisma took down, so a person at Zaisma checks it within a day.",
    contentRule: null,
    fix: "A person checks it within a day.",
  },
  api_key_in_files: {
    meaning: "A Zaisma API key was in the game's files, so Zaisma turned it off: anyone who plays the game could have read it.",
    messageForPeople: "A Zaisma API key was in the game's files, so Zaisma turned it off: anyone playing could read it. Take the key out and upload a new version, and make a new key in Settings for your AI tool.",
    contentRule: null,
    fix: "Take the key out of the file and upload a new version. Games never need an API key; make a new one on zaisma.com/dashboard/settings for your AI tool or the upload command.",
  },

  // Checks that couldn't finish: no rule is broken, and a person looks instead
  too_much_code: { meaning: "The game has more code than the review reads (about 19 MB of text), so a person at Zaisma looks first.", messageForPeople: "The game has more code than the review reads, so a person at Zaisma looks first, usually within a day. Leaving unused files out keeps the next version under the limit.", contentRule: null, fix: `${PERSON_LOOKS} Leaving unused files out keeps the next version under the limit.` },
  too_many_files_to_check: { meaning: "The game has more files than the scan checks for hidden pictures (5,000), so a person at Zaisma looks at the rest.", messageForPeople: "The game has more files than the scan checks for hidden pictures, so a person at Zaisma looks at the rest, usually within a day.", contentRule: null, fix: PERSON_LOOKS },
  too_many_images_to_check: { meaning: "The game has more pictures and videos than image matching checks (5,000), so a person at Zaisma looks at the rest.", messageForPeople: "The game has more pictures and videos than image matching checks, so a person at Zaisma looks at the rest, usually within a day.", contentRule: null, fix: PERSON_LOOKS },
  too_many_pictures_inside_packs: { meaning: "The game's packs hold more pictures than image matching checks inside them (10,000), so the first 10,000 were matched.", messageForPeople: "The game's packs hold more pictures than image matching checks, so the first 10,000 were matched. Nothing is held: this is a note.", contentRule: null, fix: "Nothing to change: nothing is held, this is a note." },
  image_matching_off: { meaning: "Image matching isn't connected, so a person at Zaisma approves each version.", messageForPeople: "Image matching isn't connected here, so a person at Zaisma approves each version.", contentRule: null, fix: PERSON_LOOKS },
  image_matching_failed: { meaning: "Image matching couldn't check every picture and video, so a person at Zaisma looks first.", messageForPeople: "Image matching couldn't check every picture and video, so a person at Zaisma looks first, usually within a day.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_off: { meaning: "AI review isn't set up, so a person at Zaisma approves each version.", messageForPeople: "AI review isn't set up here, so a person at Zaisma approves each version.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_budget_used: { meaning: "This month's AI reviews are used up, so a person at Zaisma approves each version.", messageForPeople: "This month's AI reviews are used, so a person at Zaisma approves each version, usually within a day.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_declined: { meaning: "The AI reviewer wouldn't review the game, so a person at Zaisma looks.", messageForPeople: "The AI review wouldn't review the game, so a person at Zaisma looks, usually within a day.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_failed: { meaning: "The AI review didn't finish, so a person at Zaisma looks.", messageForPeople: "The AI review didn't finish, so a person at Zaisma looks, usually within a day.", contentRule: null, fix: PERSON_LOOKS },
  daily_large_reviews_used: {
    meaning: dailyReviewMeaning("daily_large_reviews_used", "free"),
    messageForPeople: "Today's large reviews are used, so this version waits for the next one to free up, within a day. Nothing to change.",
    contentRule: null,
    fix: "Nothing to do: it's checked by itself within a day, as soon as one of your daily large reviews frees up. A tweak of a game that already passed (levels, sprites, balance) uses a small review instead.",
  },
  daily_small_reviews_used: {
    meaning: dailyReviewMeaning("daily_small_reviews_used", "free"),
    messageForPeople: "Today's small reviews are used, so this version waits for the next one to free up, within a day. Nothing to change.",
    contentRule: null,
    fix: "Nothing to do: it's read by itself within a day, as soon as one of your daily small reviews frees up.",
  },
  version_replaced: {
    meaning: "A newer version of this game came in while this one waited, so this one isn't reviewed.",
    messageForPeople: "A newer version came in while this one waited, so the newer one is reviewed instead. Upload this one again to have it reviewed.",
    contentRule: null,
    fix: "Nothing to do: the newest version is reviewed. To have this one reviewed, upload it again.",
  },
  scan_failed: { meaning: "The scan didn't finish after three tries, so a person at Zaisma looks.", messageForPeople: "The scan didn't finish after three tries, so a person at Zaisma looks, usually within a day. Uploading the version again scans it again.", contentRule: null, fix: `${PERSON_LOOKS} Uploading the version again scans it again.` },

  // The AI review's concerns, in the AI's words
  ai_malware: {
    meaning: "The AI review found malware: a crypto miner, or code that hides what it runs.",
    messageForPeople: "The AI review found malware in the code. Take it out and upload a new version; obfuscated code can't be reviewed, and an ordinary minified build is fine. If the review got it wrong, message Zaisma.",
    contentRule: "malware",
    fix: `Take it out and upload a new version. Obfuscated code can't be reviewed, so upload the readable build; an ordinary minified build is fine. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_phishing_or_scam: { meaning: "The AI review found phishing or a scam.", messageForPeople: "The AI review found phishing or a scam. If the game does that, take it out and upload a new version. If the review got it wrong, message Zaisma.", contentRule: "malware", fix: `If the game does that, take it out and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_data_collection: {
    meaning: "The AI review found the game asking players for personal details, like emails, real names, birthdays or location.",
    messageForPeople: "The AI review found the game asking players for personal details. Zaisma gives each player an ID and a name, so stop asking and upload a new version. If the review got it wrong, message Zaisma.",
    contentRule: "personal_details",
    fix: `Stop asking players for personal details (Zaisma gives each player an ID and a name) and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_sexual_content: { meaning: "The AI review found sexual content or nudity.", messageForPeople: "The AI review found sexual content or nudity. If the game has it, take it out and upload a new version. If the review got it wrong, message Zaisma.", contentRule: "sexual", fix: `If the game has it, take it out and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_private_details_or_threats: {
    meaning: "The AI review found private details about a real person, like a home address, phone number or school, or a real threat against one.",
    messageForPeople: "The AI review found a real person's private details, or a real threat against one. Take out what lets players find or reach that person, or the threat, and upload a new version; names, faces and satire are fine. If the review got it wrong, message Zaisma.",
    contentRule: "real_people",
    fix: `Take out what lets players find or reach that person, or the threat, and upload a new version. Names, faces, mocking and satire are fine. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_protection_dodged: {
    meaning: "The AI review found code that tries to get around one of Zaisma's protections: the page outside the game's frame, the relay between players, registered links or the list of servers.",
    messageForPeople: "The AI review found code that gets around one of Zaisma's protections. Take it out and upload a new version: a version that only removes it passes by itself. If the review got it wrong, message Zaisma.",
    contentRule: "malware",
    fix: `Take out the code that does it and upload a new version: open sites with Zaisma.links.open from a tap, and connect only to Zaisma rooms and your own servers. A version that only removes it passes by itself. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_lifelike_gore: {
    meaning: "The AI review found lifelike gore (photo-real or lifelike injury shown up close), which plays only in games for 16 and up.",
    messageForPeople: "The AI review found lifelike gore, which plays only in games for 16 and up. Set the game for 16 and up in its details, or make the gore stylized and upload a new version to keep guests. If the review got it wrong, message Zaisma.",
    contentRule: null,
    fix: `Pick one: set the game for 16 and up (update_game with minimum_player_age_years 16; the whole game then needs a Zaisma account, since only accounts have an age) and the version passes by itself, or make the gore stylized (cartoon, pixel or less detailed) and upload a new version to keep guests. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_real_money_gambling: { meaning: "The AI review found real-money gambling.", messageForPeople: "The AI review found betting with real money. Take it out and upload a new version. If the review got it wrong, message Zaisma.", contentRule: "illegal", fix: `Take out betting with real money or anything bought with it, and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_paid_random_rewards: {
    meaning: "The AI review found paid random rewards (loot boxes): something bought with money, or with coins bought with money, that gives a random item.",
    messageForPeople: "The AI review found paid random rewards. Sell each item by name, so players know what they get, and upload a new version; free random rewards are fine. If the review got it wrong, message Zaisma.",
    contentRule: "purchases",
    fix: `Sell the item itself, by name, so the player knows what they get, and upload a new version. Free random rewards (a daily chest) are fine. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_coin_price_without_real_price: {
    meaning: "The AI review found prices in coins or gems with no real price beside them, for coins or gems bought with money.",
    messageForPeople: "The AI review found coin prices with no real price beside them. Show the real price beside each one and upload a new version. If the review got it wrong, message Zaisma.",
    contentRule: "purchases",
    fix: `Show the real price beside coin prices (Zaisma.items.list() gives each item's price in the player's currency as priceText), and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_free_text_chat: {
    meaning: "The AI review found typed text another player reads as written that doesn't go through Zaisma's chat hosting (room.chat in Zaisma rooms, canChat and checkChat on your own server).",
    messageForPeople: "The AI review found typed chat that doesn't go through Zaisma's chat hosting. Send chat through it and upload a new version. If the review got it wrong, message Zaisma.",
    contentRule: "chat",
    fix: `Send typed chat with room.chat (or canChat and checkChat on your own server), and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_disallowed_crypto: {
    meaning: "The AI review found cryptocurrency the rules don't allow: coins other than Bitcoin, tokens, NFTs or airdrops, or Bitcoin used for investment advice, paying players or asking for wallet access.",
    messageForPeople: "The AI review found cryptocurrency the rules don't allow. Take it out and upload a new version; Bitcoin itself is fine. If the review got it wrong, message Zaisma.",
    contentRule: "crypto",
    fix: `Take it out and upload a new version. Bitcoin itself is welcome, and so is a story that mentions another coin. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_other: { meaning: "The AI review found faked plays or players, or text that addresses the reviewer.", messageForPeople: "The AI review found faked plays or players, or text aimed at the reviewer. Take out what it names and upload a new version. If the review got it wrong, message Zaisma.", contentRule: null, fix: `Take out what the message names and upload a new version. ${FIXED_VERSION_CHECKED} ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_concern: { meaning: "The AI review held or rejected the version without naming one concern; the message is its summary.", messageForPeople: "The AI review stopped this version. If it's right, change what it names and upload a new version. If it got it wrong, message Zaisma.", contentRule: null, fix: `If the message is right, change it and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },

  // People and reports
  needs_review: { meaning: "A person at Zaisma needs to look at it first.", messageForPeople: "A person at Zaisma looks at this first, usually within a day. Nothing to change.", contentRule: null, fix: "Nothing to change: a person at Zaisma looks." },
  report_paused_game: {
    meaning: "A player report paused the game while Zaisma checks it.",
    messageForPeople: "A player report paused the game while Zaisma checks it, usually within a day, and nobody can open it until then. Nothing to change.",
    contentRule: null,
    fix: "Nothing to change: a person at Zaisma checks it, usually within a day. Until then players and tester links can't open the game.",
  },
  report_paused_update: {
    meaning: "A player report paused this update while Zaisma checks it; players get the version before it.",
    messageForPeople: "A player report paused this update while Zaisma checks it, usually within a day; players get the version before it. Nothing to change.",
    contentRule: null,
    fix: "Nothing to change: a person at Zaisma checks it, usually within a day, and puts it back if the report was wrong.",
  },
  rejected_by_zaisma: {
    meaning: "A person at Zaisma rejected the version; the message says why.",
    messageForPeople: "A person at Zaisma rejected this version for the reason given. Change what it names and upload a new version. If it's a mistake, message Zaisma.",
    contentRule: null,
    fix: "Change what the message says and upload a new version. If it's a mistake, message_zaisma with the version_id.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  taken_down: {
    meaning: "A person at Zaisma took the game down; the message says why.",
    messageForPeople: "A person at Zaisma took the game down for the reason given. Until Zaisma restores it, the game takes no new versions. If it's a mistake, message Zaisma.",
    contentRule: null,
    fix: "If it's a mistake, or to say what you'll change, message_zaisma with the game_slug. Until Zaisma restores it, the game can't get new versions or change who can play it.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  copyright_notice: {
    meaning: "The owner of a work sent a copyright (DMCA) notice, so players can't open the game; the message says what it names.",
    messageForPeople: "A copyright notice names something in the game, so players can't open it. Take it out and publish a fixed version, and a person at Zaisma shows the game again, usually within a day. If you own the work or may use it, send a counter-notice to dmca@zaisma.com.",
    contentRule: "copyright",
    fix: `Take out what the notice names and publish a fixed version (upload_files, then publish_version): ${NOTICE_CHECKED} If you own the work or may use it, send a counter-notice to dmca@zaisma.com instead; zaisma.com/legal/dmca says what to put in it.`,
    hasOwnMessage: true,
  },
  defamation_notice: {
    meaning: "A private person sent a defamation notice saying the game falsely accuses them of a crime, so players can't open the game; the message says what it names.",
    messageForPeople: "A defamation notice says the game falsely accuses a private person of a crime, so players can't open it. Take out what it names and publish a fixed version, and a person at Zaisma shows the game again, usually within a day. If the claim is true, send a counter-notice to safety@zaisma.com.",
    contentRule: "defamation",
    fix: `Take out what the notice names and publish a fixed version (upload_files, then publish_version): ${NOTICE_CHECKED} If the claim is true or isn't about a private person, send a counter-notice to safety@zaisma.com instead; zaisma.com/legal/defamation says what to put in it.`,
    hasOwnMessage: true,
  },
  country_law_notice: {
    meaning: "A notice says the game breaks a law of one country that US law allows, so players in that country can't open it, and everyone else still can; the message says which law and what it names.",
    messageForPeople: "A notice says the game breaks a law of one country, so players there can't open it; everyone else still can. Take out what it names and publish a fixed version, and a person at Zaisma lifts the block, usually within a day.",
    contentRule: null,
    fix: "Take out what the notice names and publish a fixed version (upload_files, then publish_version): a person at Zaisma checks it's gone and lifts the block, usually within a day. If the notice is wrong, write to safety@zaisma.com with the game_slug and why.",
    hasOwnMessage: true,
  },
  developer_account_deleted: {
    meaning: "The game's developer deleted their Zaisma account, which takes their games down with it.",
    messageForPeople: "The developer deleted their account, which deletes their games with it.",
    contentRule: null,
    fix: "Nothing to change: the game is deleted with the account.",
  },
  image_rejected: {
    meaning: "A person at Zaisma didn't approve the image; the message says why.",
    messageForPeople: "A person at Zaisma didn't approve this picture for the reason given. Send a different one in Add image: covers and screenshots show the game itself.",
    contentRule: null,
    fix: "Send a different one with add_image. Covers and screenshots show the actual game, with no fake rewards and no characters or brands you don't own.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  link_flagged: {
    meaning: "Cloudflare lists the link's site for malware or phishing, so the link opens for nobody.",
    messageForPeople: "Cloudflare lists this link's site for malware or phishing, so the link opens for nobody. If the site is yours and safe, ask Cloudflare to look again; Zaisma checks every link each day. Or change the link in the game's details.",
    contentRule: "malware",
    fix: "If the site is yours and safe, ask Cloudflare to look again at https://radar.cloudflare.com/domains/feedback; Zaisma checks every link again each day, and it opens again once the site is off the list. Or remove the link, or point it at another site, with update_game.",
  },
  details_rejected: {
    meaning: "A person at Zaisma didn't approve the new title or description; the message says why.",
    messageForPeople: "A person at Zaisma didn't approve the new title or description for the reason given. Write new words in the game's details; players see the old ones meanwhile.",
    contentRule: null,
    fix: "Send new words with update_game; players see the old ones meanwhile.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  // The listing check ("No slop" in docs/DECISIONS.md): lines on covers, screenshots and titles anyone can check against the picture
  extra_text_on_cover: {
    meaning: "The cover, square cover or share picture has words besides the game's title, a subtitle and the studio's logo; the message quotes them.",
    messageForPeople: "The picture has words besides the game's title, a subtitle and the studio's logo. Send one with only those in Add image. The game plays by its link meanwhile, and is back in lists a minute after the fix.",
    contentRule: null,
    fix: `Send a picture with only the title (and a subtitle or your studio's logo) with add_image; words that are part of the scene, like a sign on a building, are fine. ${BACK_ON_LISTS} ${COVER_GUIDE} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  overlay_on_cover: {
    meaning: "Something is laid over the cover, square cover or share picture: a button, menu, shop panel, badge, sticker, or an arrow or circle pointing at something; the message says what.",
    messageForPeople: "Something is laid over the picture, like a button, badge or arrow. Send it without in Add image. The game plays by its link meanwhile, and is back in lists a minute after the fix.",
    contentRule: null,
    fix: `Send the picture without it with add_image. ${BACK_ON_LISTS} ${COVER_GUIDE} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  famous_name: {
    meaning: "The cover, square cover, share picture or title shows a famous character, logo or name, from a film, show, game, brand or club, that the developer doesn't own; the message names it.",
    messageForPeople: "A picture or the title shows a famous character, logo or name the game doesn't own. Use your own in Add image or the game's details. If you own it or have permission, message Zaisma.",
    contentRule: null,
    fix: `Use your own characters and name with add_image or update_game. Only obvious ones count, and the game itself may borrow (Zaisma acts on that only when the owner sends a notice). If you own it or have permission, message_zaisma with the game_slug. ${BACK_ON_LISTS} ${COVER_GUIDE}`,
    hasOwnMessage: true,
  },
  cover_not_from_game: {
    meaning: "The cover, square cover or share picture is built around a character, creature or thing that doesn't appear in any of the game's screenshots; the message says what.",
    messageForPeople: "The picture is built around something that isn't in any screenshot. Send a cover of something players meet in the game in Add image, or add a screenshot that shows it.",
    contentRule: null,
    fix: `Send a cover built around something players meet in the game with add_image, or add a screenshot that shows it. ${BACK_ON_LISTS} ${COVER_GUIDE} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  tag_in_title: {
    meaning: "The title carries a tag instead of only naming the game: a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag. \"+1\" and \"2x\" are fine.",
    messageForPeople: "The title carries a tag, like [UPDATE], an emoji or FREE, instead of only the game's name. Write the name alone in the game's details; patch notes say what's new.",
    contentRule: null,
    fix: `Send the game's name alone with update_game; patch notes say what's new. ${BACK_ON_LISTS} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  fake_reward: {
    meaning: "A cover, screenshot, title or description promises a fake reward or real-money bait, like free Robux, V-Bucks, gift cards or cash; the message quotes it. Players can't open the game until a person looks.",
    messageForPeople: "A picture or the game's words promise a fake reward, like free currency, gift cards or cash, so players can't open the game until a person at Zaisma looks. Take the promise out in Add image or the game's details.",
    contentRule: "malware",
    fix: `Take the promise out (add_image for a picture, update_game for words): a person at Zaisma looks, usually within a day. ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  screenshot_not_from_game: {
    meaning: "The screenshot has something added after it was captured, like a caption, an arrow or circle, a sticker, a pasted logo or a device frame, so it doesn't show. The game's own interface is fine.",
    messageForPeople: "The screenshot has something added after it was captured, like a caption, an arrow or a device frame. Send a plain capture in Add image; the game's own score and menus are fine.",
    contentRule: null,
    fix: `Send a plain capture of the game with add_image; its score, menus and buttons can show. ${COVER_GUIDE} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  text_on_background: {
    meaning: "A background has no title, logo or text on it; those go on the cover. The message quotes what it found.",
    messageForPeople: "The background has a title, logo or text on it; those go on the cover. Send it without them in Background.",
    contentRule: null,
    fix: `Send the background without words or logos (add_image, or add_shader for a shader); words that are part of the scene, like a sign on a building, are fine. ${COVER_GUIDE} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  overlay_on_background: {
    meaning: "Something is laid over a background instead of being part of its world, like a button, badge or sticker, so it doesn't show; the message says what.",
    messageForPeople: "Something is laid over the background, like a button, badge or sticker. Send it without in Background.",
    contentRule: null,
    fix: `Send the background without it (add_image, or add_shader for a shader). ${COVER_GUIDE} ${IF_THE_CHECK_IS_WRONG}`,
    hasOwnMessage: true,
  },
  famous_name_on_background: {
    meaning: "A background shows a famous character, logo or name, from a film, show, game, brand or club, so it doesn't show; the message names it.",
    messageForPeople: "The background shows a famous character, logo or name. Send one of the game's own setting in Background. If you own it or have permission, message Zaisma.",
    contentRule: null,
    fix: `Send a background of your game's own world (add_image, or add_shader for a shader). Only obvious ones count. If you own it or have permission, message_zaisma with the game_slug. ${COVER_GUIDE}`,
    hasOwnMessage: true,
  },
  // The shader check (Backgrounds in docs/DEVELOPER-API.md): a shader is drawn before anyone sees it
  shader_does_not_compile: {
    meaning: "The shader didn't compile; the message gives the first compiler error.",
    messageForPeople: "The shader didn't compile, and the first error is given. Fix that line and send the shader again in Background.",
    contentRule: null,
    fix: "Fix the line the error names (a buffer's errors start with its name; line numbers are the pass's own) and send it again with add_shader: WebGL2's GLSL, void mainImage(out vec4 fragColor, in vec2 fragCoord). check_shader draws a shader before it's sent.",
    hasOwnMessage: true,
  },
  shader_too_slow: {
    meaning: "The shader took too long to draw a frame in the check, at one of its quality levels; the message says which, how long, and the most it can take.",
    messageForPeople: "The shader takes too long to draw a frame. Do less for each pixel and send it again in Background.",
    contentRule: null,
    fix: "Do less for each pixel at that level (fewer loop steps, octaves or lights where iQuality is lower) and send it again with add_shader; check_shader times it first. Zaisma draws backgrounds at fewer pixels and 30 frames a second, so fine detail costs more than it shows.",
    hasOwnMessage: true,
  },
  shader_flashes: {
    meaning: "The shader flashes more than 3 times a second, which can cause seizures.",
    messageForPeople: "The shader flashes more than 3 times a second, which can cause seizures. Make its light change slowly and send it again in Background.",
    contentRule: null,
    fix: "Make its light change slowly: no flicker, strobes or sudden jumps between light and dark more than 3 times a second. Send it again with add_shader.",
    hasOwnMessage: true,
  },
} as const satisfies Record<string, ReviewCode>;
export type ReviewCodeName = keyof typeof REVIEW_CODES;

/** Codes whose findings are only notes (severity info), yet the developer is told: the version isn't held or rejected for them. */
export const DEVELOPER_INFO_FINDING_CODES: readonly string[] = ["api_key_in_files", "unregistered_link", "unlisted_address"];

/**
 * Codes on scan findings that only Zaisma sees: notes for a person (severity info), and child-safety
 * signals, which are never described to the developer (they get needs_review).
 */
export const INTERNAL_FINDING_CODES = ["wallet_words", "svg_script", "outside_hosts", "antivirus_unavailable", "known_illegal_image", "image_matching_later", "ai_minors_sexualized"] as const;
export type FindingCode = ReviewCodeName | (typeof INTERNAL_FINDING_CODES)[number];

/** A person's or a report's decision, as stored (games, versions, game_images and audit_log .review_reason): JSON, snake_case. */
export interface ReviewReason {
  code: ReviewCodeName;
  /** What the developer reads: the code's meaning, or a person's own words for codes that have them. */
  message: string;
  content_rule: ContentRule | null;
}

/** A decision with no words of its own: the code's meaning and rule. */
export function reviewReason(code: ReviewCodeName, message?: string, contentRule?: ContentRule | null): ReviewReason {
  const known: ReviewCode = REVIEW_CODES[code];
  return { code, message: message?.trim() || known.meaning, content_rule: contentRule === undefined ? known.contentRule : contentRule };
}

/**
 * A person's decision, from what they picked and wrote. Child safety is never described to the
 * developer (telling them could warn someone abusing a child): they get the plain code alone.
 */
export function decidedReason(code: ReviewCodeName, contentRule: ContentRule | null, words: string): ReviewReason {
  if (contentRule === "child_safety") return { code, message: REVIEW_CODES[code].meaning, content_rule: null };
  const notice = Object.values(NOTICE_CODES).find((candidate) => candidate.code === code);
  return reviewReason(code, words, notice ? notice.contentRule : contentRule);
}

/**
 * The notices the law asks Zaisma to act on, by kind: each holds the game with its own code until the
 * developer publishes a fixed version and a person shows it again, or a counter-notice brings it back
 * (docs/DECISIONS.md, "The content rules draw exact lines, so developers don't hedge").
 */
export const NOTICE_CODES = {
  copyright: { code: "copyright_notice", contentRule: "copyright" },
  defamation: { code: "defamation_notice", contentRule: "defamation" },
} as const satisfies Record<string, { code: ReviewCodeName; contentRule: ContentRule }>;
export type NoticeKind = keyof typeof NOTICE_CODES;
export const NOTICE_KINDS = Object.keys(NOTICE_CODES) as NoticeKind[];
export const isNoticeKind = (candidate: unknown): candidate is NoticeKind => typeof candidate === "string" && Object.hasOwn(NOTICE_CODES, candidate);
/** Whether a stored review reason is a notice's. */
export const isNoticeReason = (reason: ReviewReason | null): boolean => Boolean(reason && Object.values(NOTICE_CODES).some((notice) => notice.code === reason.code));

/** A review reason as the developer API answers it: { code, message, content_rule, fix, message_for_people }. */
export function reviewReasonAnswer(reason: ReviewReason): { code: ReviewCodeName; message: string; content_rule: ContentRule | null; fix: string; message_for_people: string } {
  const known: ReviewCode = REVIEW_CODES[reason.code] ?? REVIEW_CODES.needs_review;
  return { code: reason.code, message: known.hasOwnMessage ? reason.message : known.meaning, content_rule: reason.content_rule, fix: known.fix, message_for_people: known.messageForPeople };
}

export const readReviewReason = (stored: string | null | undefined): ReviewReason | null => (stored ? (JSON.parse(stored) as ReviewReason) : null);

/** Lifelike gore plays only in games set for this age and up. */
export const LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS = 16;

/** The scan found lifelike gore in this version, at any severity (it's kept as info on games for 16 and up). */
export const needsLifelikeGoreAge = (report: ScanReport | null): boolean => !!report?.findings.some((finding) => finding.code === "ai_lifelike_gore");

/** The build needs threads (SharedArrayBuffer), so it runs only in Chrome and Edge; false on reports from before the flag. */
export const hasThreads = (report: ScanReport | null): boolean => report?.has_threads === true;
