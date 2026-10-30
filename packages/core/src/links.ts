/**
 * Registered links (docs/DECISIONS.md, "Games open outside links only through Zaisma"): each game's
 * list of up to 20 links on its details, which the game opens with Zaisma.links.open behind the
 * "You're leaving Zaisma" card. Signed-in adults open any of them; guests and under-18 accounts only
 * those on trusted domains (TRUSTED_LINK_DOMAINS). Every site is checked against Cloudflare's list of
 * malware and phishing sites when a link is added and again every day, and a flagged link opens for
 * nobody. The site's game page asks for one link at a time (apps/site/src/game-links.ts), and the
 * server hands it the address only when this player may open it.
 */

import type { InputProblem } from "./developers.ts";
import { reviewReason, type ReviewReason } from "./review.ts";
import { ZAISMA_DOMAINS } from "./reach.ts";

export const LINK_LIMITS = {
  /** Links on one game. */
  maximumLinkCount: 20,
  maximumLinkNameCharacterCount: 32,
  maximumDestinationUrlCharacterCount: 500,
  /** The path a game adds under a link's address. */
  maximumPathCharacterCount: 500,
  /** Query parameters a game adds, and each one's name and value. */
  maximumQueryParameterCount: 20,
  maximumQueryParameterCharacterCount: 500,
  /** The whole address that opens, the link's and what the game added. */
  maximumOpenedUrlCharacterCount: 2000,
} as const;

/** The name a game opens a link by, like "store" or "patreon": lowercase letters, digits and underscores, starting with a letter. */
export const LINK_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Who a link opens for: everyone (a trusted domain), signed_in_adults (any other site), waiting_for_standing (any
 * other site, while the developer has no standing for it: it opens once they're established or have a card or
 * Stripe account, standing.ts), nobody (flagged).
 */
export const LINK_AUDIENCES = ["everyone", "signed_in_adults", "waiting_for_standing", "nobody"] as const;
export type LinkAudience = (typeof LINK_AUDIENCES)[number];

/**
 * Domains whose links open for guests and under-18 accounts too: well-known store, payment and video
 * sites where strangers can't message players (docs/DECISIONS.md, "Which links open for whom"). A
 * domain covers the names under it (kit.itch.io). Chat apps and social networks with private messages
 * (Discord, Telegram, WhatsApp, Snapchat, Instagram, TikTok) are never on it. Developers ask for
 * another domain on the forum.
 */
export const TRUSTED_LINK_DOMAINS = [
  // Stores
  "itch.io",
  "store.steampowered.com",
  "gumroad.com",
  "apps.apple.com",
  "play.google.com",
  // Payment and support pages
  "patreon.com",
  "ko-fi.com",
  "paypal.com",
  "paypal.me",
  "buy.stripe.com",
  "checkout.stripe.com",
  "donate.stripe.com",
  // Hosted Bitcoin pages
  "strike.me",
  "getalby.com",
  "coinos.io",
  "geyser.fund",
  "pay.zaprite.com",
  "checkout.opennode.com",
  // Video
  "youtube.com",
  "youtu.be",
] as const;

/** Link shorteners: an address on one hides where it really goes, so it can't be registered. */
export const LINK_SHORTENER_DOMAINS = [
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "tiny.one",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "v.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "shorturl.com",
  "tiny.cc",
  "rb.gy",
  "t.ly",
  "s.id",
  "lnkd.in",
  "bl.ink",
  "short.io",
  "shorte.st",
  "adf.ly",
  "ouo.io",
  "bc.vc",
  "clck.ru",
  "dub.sh",
  "x.co",
  "trib.al",
  "qrco.de",
  "y2u.be",
] as const;

/** One of a game's links, as stored in games.links (JSON, snake_case). */
export interface GameLink {
  link_name: string;
  /** The https address it opens; a game can add a path and query under it. */
  destination_url: string;
  /** Whether the game page shows it too (Developer links on game pages). */
  is_on_game_page: boolean;
  /** Why it opens for nobody (link_flagged), or null. */
  review_reason: ReviewReason | null;
  /** When its site was last checked against Cloudflare's list; null until a check answered. */
  checked_at_ms: number | null;
}

/** A game's links, from its column. */
export const linksOf = (game: { links: string }): GameLink[] => JSON.parse(game.links || "[]") as GameLink[];

const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Whether a host is on a trusted domain, so its links open for everyone. */
export const isTrustedLinkHost = (host: string): boolean => TRUSTED_LINK_DOMAINS.some((domain) => isUnder(host, domain));

/** Who a link opens for, given whether its developer's standing opens links to other sites (standingOf's outsideLinksEnabled). */
export function linkAudience(link: GameLink, outsideLinksEnabled: boolean): LinkAudience {
  if (link.review_reason) return "nobody";
  if (isTrustedLinkHost(new URL(link.destination_url).hostname)) return "everyone";
  return outsideLinksEnabled ? "signed_in_adults" : "waiting_for_standing";
}

/** Whether this player may open a link: a signed-in adult any that isn't flagged once the developer's standing opens other sites, anyone else only one on a trusted domain. */
export function canOpenLink(link: GameLink, isSignedInAdult: boolean, outsideLinksEnabled: boolean): boolean {
  const audience = linkAudience(link, outsideLinksEnabled);
  return audience === "everyone" || (audience === "signed_in_adults" && isSignedInAdult);
}

const LINK_EXAMPLE = '[{ "link_name": "store", "destination_url": "https://kit.itch.io/sky-hopper", "is_on_game_page": true }]';
const LINK_FIELDS = ["link_name", "destination_url", "is_on_game_page"];

/** Why an address can't be a link, or null when it can, with the address tidied. */
function destinationProblem(given: string): { message: string; fix: string } | { href: string } {
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    return { message: `${JSON.stringify(given)} isn't a full address.`, fix: 'Give the whole address, starting with https://, like "https://kit.itch.io/sky-hopper".' };
  }
  if (url.protocol !== "https:") return { message: `${JSON.stringify(given)} doesn't start with https://.`, fix: "Links open only https addresses; most sites have one." };
  if (url.username || url.password) return { message: `${JSON.stringify(given)} has a user name in it (the part before @).`, fix: "Give the address without it, like https://example.com/page." };
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host) || host.startsWith("[")) {
    return { message: `${JSON.stringify(given)} is an IP address or this computer.`, fix: "Give the site's name, like https://example.com." };
  }
  if (!host.includes(".") || !/[a-z]/.test(host.split(".").at(-1)!)) return { message: `${host} isn't a name on the internet.`, fix: "Give the site's name, like https://example.com." };
  const zaisma = ZAISMA_DOMAINS.find((domain) => isUnder(host, domain));
  if (zaisma) return { message: `${host} is on ${zaisma}, Zaisma's own domain, so it isn't an outside link.`, fix: "Register links to your own sites: your store, Patreon, Steam or Discord." };
  const shortener = LINK_SHORTENER_DOMAINS.find((domain) => isUnder(host, domain));
  if (shortener) return { message: `${host} is a link shortener, which hides where a link goes.`, fix: "Give the address it leads to, like https://www.patreon.com/kit." };
  if (url.href.length > LINK_LIMITS.maximumDestinationUrlCharacterCount) return { message: `The address is over ${LINK_LIMITS.maximumDestinationUrlCharacterCount} characters.`, fix: "Give a shorter address; the game can add a path and query under it when it opens the link." };
  return { href: url.href };
}

/**
 * A game's list of links from the API, checked and tidied, or the problem with it: up to 20, each with
 * a name, an https address and whether the game page shows it. Its sites aren't checked yet
 * (checkLinkSites does that), so each comes back with no review reason and no check.
 */
export function checkLinks(given: unknown): { links: GameLink[] } | { problem: InputProblem } {
  const refuse = (field: string, message: string, fix: string) => ({ problem: { field, message, fix } });
  if (!Array.isArray(given)) return refuse("links", "links isn't a list.", `Send the whole list, like ${LINK_EXAMPLE}, or [] for none.`);
  if (given.length > LINK_LIMITS.maximumLinkCount) return refuse("links", `links has ${given.length} links.`, `A game has up to ${LINK_LIMITS.maximumLinkCount}; leave some out.`);
  const links: GameLink[] = [];
  for (const [i, entry] of given.entries()) {
    const field = `links[${i}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return refuse(field, `${field} isn't a link.`, `Each link is { link_name, destination_url, is_on_game_page }, like ${LINK_EXAMPLE}.`);
    const fields = Object.keys(entry);
    const unknown = fields.filter((name) => !LINK_FIELDS.includes(name));
    if (unknown.length) return refuse(`${field}.${unknown[0]}`, `${field} has ${unknown.join(", ")}, which a link doesn't take.`, "A link takes link_name, destination_url and is_on_game_page.");
    const missing = LINK_FIELDS.filter((name) => !fields.includes(name));
    if (missing.length) return refuse(`${field}.${missing[0]}`, `${field} has no ${missing.join(" or ")}.`, `Give all three, like ${LINK_EXAMPLE}.`);
    const { link_name: linkName, destination_url: destinationUrl, is_on_game_page: isOnGamePage } = entry as Record<string, unknown>;
    if (typeof linkName !== "string" || !LINK_NAME_PATTERN.test(linkName)) {
      return refuse(`${field}.link_name`, `${JSON.stringify(linkName)} isn't a link name.`, 'A link name is what the game opens it by: up to 32 lowercase letters, digits and underscores, starting with a letter, like "store" or "patreon".');
    }
    if (links.some((link) => link.link_name === linkName)) return refuse(`${field}.link_name`, `Two links are named ${linkName}.`, "Give each link its own name.");
    if (typeof destinationUrl !== "string") return refuse(`${field}.destination_url`, `${field}.destination_url isn't an address.`, 'Give the whole address, like "https://kit.itch.io/sky-hopper".');
    const destination = destinationProblem(destinationUrl);
    if ("message" in destination) return refuse(`${field}.destination_url`, destination.message, destination.fix);
    if (typeof isOnGamePage !== "boolean") return refuse(`${field}.is_on_game_page`, `${field}.is_on_game_page isn't true or false.`, "Send true (the game page shows the link too) or false (only the game opens it).");
    links.push({ link_name: linkName, destination_url: destination.href, is_on_game_page: isOnGamePage, review_reason: null, checked_at_ms: null });
  }
  return { links };
}

/** Cloudflare's resolver for families' "malware" setting (1.1.1.2), asked over HTTPS: it answers 0.0.0.0 for sites known for malware and phishing. */
export const LINK_CHECK_DNS_URL = "https://security.cloudflare-dns.com/dns-query";

/** What Cloudflare's DNS over HTTPS answers, in its own names (docs/NAMING.md, Exceptions): only what's read here. */
interface CloudflareDnsAnswer {
  Answer?: { data: string }[];
}

/** Whether Cloudflare lists a host for malware or phishing, or null when it couldn't be asked. */
export async function isHostFlagged(host: string, dnsUrl: string = LINK_CHECK_DNS_URL): Promise<boolean | null> {
  try {
    const response = await fetch(`${dnsUrl}?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const answer = (await response.json()) as CloudflareDnsAnswer;
    return (answer.Answer ?? []).some((record) => record.data === "0.0.0.0");
  } catch {
    return null;
  }
}

/**
 * Links with their sites checked: each host once, at the same time. A link whose site is listed gets
 * link_flagged; one whose check couldn't be made keeps what it had (a link the same as one in kept, or
 * none), for the daily check to try again. Links whose address is unchanged from kept aren't asked again
 * unless recheck is set.
 */
export async function checkLinkSites(links: GameLink[], kept: GameLink[], options: { dnsUrl?: string; nowMs?: number; isRecheck?: boolean } = {}): Promise<GameLink[]> {
  const nowMs = options.nowMs ?? Date.now();
  const before = (link: GameLink) => kept.find((keptLink) => keptLink.destination_url === link.destination_url) ?? null;
  const asked = links.filter((link) => options.isRecheck || !before(link) || before(link)!.checked_at_ms === null);
  const hosts = [...new Set(asked.map((link) => new URL(link.destination_url).hostname))];
  const flaggedByHost = new Map(await Promise.all(hosts.map(async (host) => [host, await isHostFlagged(host, options.dnsUrl)] as const)));
  return links.map((link) => {
    const earlier = before(link);
    const carried = { review_reason: earlier?.review_reason ?? null, checked_at_ms: earlier?.checked_at_ms ?? null };
    if (!asked.includes(link)) return { ...link, ...carried };
    const isFlagged = flaggedByHost.get(new URL(link.destination_url).hostname);
    if (isFlagged === null || isFlagged === undefined) return { ...link, ...carried };
    return { ...link, review_reason: isFlagged ? reviewReason("link_flagged") : null, checked_at_ms: nowMs };
  });
}

/**
 * The address a link opens with what the game added: a path under the link's (its own path, then this
 * one) and query parameters beside the link's own. Never another site or a path outside the link's.
 */
export function openedLinkUrl(link: GameLink, path: unknown, queryParameters: unknown): { url: string } | { code: "bad_link_path" | "bad_link_query"; message: string } {
  const base = new URL(link.destination_url);
  const basePath = base.pathname.replace(/\/+$/, "");
  const url = new URL(base.href);
  if (path !== undefined && path !== null) {
    const isPath =
      typeof path === "string" &&
      path.length <= LINK_LIMITS.maximumPathCharacterCount &&
      /^(\/[^/?#\\]+)+\/?$/.test(path) &&
      path.split("/").every((segment) => ![".", ".."].includes(segment.replace(/%2e/gi, ".")));
    if (!isPath) return { code: "bad_link_path", message: `path ${JSON.stringify(path)} isn't a path to add under the link's address: it starts with /, like "/buy", with no ?, #, . or .. parts. Give query parameters as queryParameters.` };
    url.pathname = basePath + path;
  }
  if (queryParameters !== undefined && queryParameters !== null) {
    const isObject = typeof queryParameters === "object" && !Array.isArray(queryParameters);
    const entries = isObject ? Object.entries(queryParameters as Record<string, unknown>) : [];
    const isFine =
      isObject &&
      entries.length <= LINK_LIMITS.maximumQueryParameterCount &&
      entries.every(([name, given]) => name.length > 0 && name.length <= 100 && typeof given === "string" && given.length <= LINK_LIMITS.maximumQueryParameterCharacterCount);
    if (!isFine) return { code: "bad_link_query", message: `queryParameters takes up to ${LINK_LIMITS.maximumQueryParameterCount} names, each with text of up to ${LINK_LIMITS.maximumQueryParameterCharacterCount} characters, like { item: "sword", count: String(3) }.` };
    const repeated = entries.find(([name]) => base.searchParams.has(name));
    if (repeated) return { code: "bad_link_query", message: `The link's own address already sets ${repeated[0]}, so the game can't change it.` };
    for (const [name, given] of entries) url.searchParams.append(name, given as string);
  }
  // The backstop: whatever was added, the address stays on the link's site, under its path.
  const isUnderLink = url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(`${basePath}/`));
  if (!isUnderLink) return { code: "bad_link_path", message: "That path leads outside the link's address." };
  if (url.href.length > LINK_LIMITS.maximumOpenedUrlCharacterCount) return { code: "bad_link_query", message: `The address with what the game added is over ${LINK_LIMITS.maximumOpenedUrlCharacterCount} characters.` };
  return { url: url.href };
}

/** The sites whose links get their own look on the game page; any other site is a `website`. */
export const LINK_BRANDS = ["steam", "itch", "discord", "youtube", "x", "bluesky", "reddit", "tiktok", "instagram", "patreon", "kofi", "github", "kickstarter", "app_store", "google_play", "twitch", "gumroad", "website"] as const;
export type LinkBrand = (typeof LINK_BRANDS)[number];

const BRAND_DOMAINS: [LinkBrand, string[], string][] = [
  ["steam", ["store.steampowered.com", "steamcommunity.com"], "Steam"],
  ["itch", ["itch.io"], "itch.io"],
  ["discord", ["discord.gg", "discord.com"], "Discord"],
  ["youtube", ["youtube.com", "youtu.be"], "YouTube"],
  ["x", ["x.com", "twitter.com"], "X"],
  ["bluesky", ["bsky.app"], "Bluesky"],
  ["reddit", ["reddit.com"], "Reddit"],
  ["tiktok", ["tiktok.com"], "TikTok"],
  ["instagram", ["instagram.com"], "Instagram"],
  ["patreon", ["patreon.com"], "Patreon"],
  ["kofi", ["ko-fi.com"], "Ko-fi"],
  ["github", ["github.com"], "GitHub"],
  ["kickstarter", ["kickstarter.com"], "Kickstarter"],
  ["app_store", ["apps.apple.com"], "App Store"],
  ["google_play", ["play.google.com"], "Google Play"],
  ["twitch", ["twitch.tv"], "Twitch"],
  ["gumroad", ["gumroad.com"], "Gumroad"],
];

/**
 * How a link looks on the game page (Developer links on game pages): its site's brand and the words on
 * its button. A Steam store page says "Wishlist on Steam"; any other site shows its address.
 */
export function linkBrand(destinationUrl: string): { brand: LinkBrand; label: string } {
  const url = new URL(destinationUrl);
  const host = url.hostname;
  const found = BRAND_DOMAINS.find(([, domains]) => domains.some((domain) => isUnder(host, domain)));
  if (!found) return { brand: "website", label: host.replace(/^www\./, "") };
  const [brand, , name] = found;
  if (brand === "steam" && host === "store.steampowered.com" && url.pathname.startsWith("/app/")) return { brand, label: "Wishlist on Steam" };
  return { brand, label: name };
}
