/**
 * Strict scripts on zaisma.com (docs/DECISIONS.md): what's wrong with a page the site served, one line
 * per problem, [] when nothing is. A page runs only the site's own script files, so it fails on:
 *
 * - a Content-Security-Policy whose script-src allows more than 'self' (and Cloudflare's check, and Stripe.js on the buy sheet's pages),
 *   like 'unsafe-inline', 'unsafe-eval', a nonce, a hash or another site,
 * - a <script> that isn't one of the site's files under /js/ (with nothing inside) or a
 *   <script type="application/json"> block (with valid JSON and no src),
 * - an on… attribute on any tag,
 * - a javascript: address in any attribute.
 */

const CHECK_ORIGIN = "https://challenges.cloudflare.com";
const STRIPE_SCRIPT_ORIGIN = "https://js.stripe.com";

/** A start tag: its name and its attributes as written, quoted values included. */
const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: "\t", newline: "\n", nbsp: " " };

/** An attribute's value as the browser reads it. */
function decodeAttribute(written: string): string {
  const unquoted = /^["']/.test(written) ? written.slice(1, -1) : written;
  return unquoted.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (entity, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1]!.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function attributesOf(written: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, value] of written.matchAll(ATTRIBUTE)) attributes.set(name!.toLowerCase(), value === undefined ? "" : decodeAttribute(value));
  return attributes;
}

export function scriptPolicyProblems(contentSecurityPolicy: string | null): string[] {
  if (!contentSecurityPolicy) return ["no Content-Security-Policy"];
  const scriptSources = contentSecurityPolicy
    .split(";")
    .map((directive) => directive.trim().split(/\s+/))
    .find(([name]) => name === "script-src")
    ?.slice(1);
  if (!scriptSources) return ["the Content-Security-Policy has no script-src"];
  return scriptSources.filter((source) => source !== "'self'" && source !== CHECK_ORIGIN && source !== STRIPE_SCRIPT_ORIGIN).map((source) => `script-src allows ${source}`);
}

/** The /js/ files a page loads, to fetch and check they're served. */
export function pageScriptPaths(page: string): string[] {
  return [...page.matchAll(START_TAG)].filter(([, name]) => name!.toLowerCase() === "script").map(([, , written]) => attributesOf(written!).get("src") ?? "").filter((path) => path.startsWith("/js/"));
}

export function strictScriptProblems(page: string, contentSecurityPolicy: string | null): string[] {
  const problems = scriptPolicyProblems(contentSecurityPolicy);
  for (const tag of page.matchAll(START_TAG)) {
    const [whole, name, written] = tag as unknown as [string, string, string];
    const tagName = name.toLowerCase();
    const attributes = attributesOf(written);
    for (const [attributeName, attributeValue] of attributes) {
      if (attributeName.startsWith("on")) problems.push(`an ${attributeName} attribute: ${whole.slice(0, 160)}`);
      // Browsers drop spaces and control characters from addresses before reading the scheme.
      if (/^javascript:/i.test(attributeValue.replace(/[\u0000- ]/g, ""))) problems.push(`a javascript: address: ${whole.slice(0, 160)}`);
    }
    if (tagName !== "script") continue;
    const contentStart = tag.index! + whole.length;
    const contentEnd = page.toLowerCase().indexOf("</script", contentStart);
    const content = page.slice(contentStart, contentEnd < 0 ? undefined : contentEnd);
    const src = attributes.get("src");
    // JSON blocks (html.ts's pageData, and search engines' structured data) are data browsers never run.
    if (attributes.get("type")?.toLowerCase() === "application/json" || attributes.get("type")?.toLowerCase() === "application/ld+json") {
      if (src !== undefined) problems.push(`a JSON block with a src: ${whole}`);
      try {
        JSON.parse(content);
      } catch {
        problems.push(`a JSON block that isn't JSON: ${whole}${content.slice(0, 120)}`);
      }
      continue;
    }
    // Stripe.js, from Stripe's own origin as Stripe requires: only the buy sheet's Stripe frame loads it (html.ts's STRIPE_SCRIPT_TAG).
    if (src === `${STRIPE_SCRIPT_ORIGIN}/v3/` && !content.trim()) continue;
    if (src === undefined || !/^\/js\/[a-z]+(-[a-z]+)*\.[0-9a-f]{16}\.js$/.test(src)) problems.push(`a script that isn't one of the site's files: ${whole}${content.slice(0, 120)}`);
    else if (content.trim()) problems.push(`a script file with text inside its tag: ${whole}${content.slice(0, 120)}`);
  }
  return problems;
}

/** A page's JSON block (html.ts's pageData), as its script reads it. */
export function pageDataOf(page: string, id: string): Record<string, unknown> {
  const block = page.match(new RegExp(`<script type="application/json" id="${id}">([^<]*)</script>`));
  if (!block) throw new Error(`The page has no ${id} block`);
  return JSON.parse(block[1]!) as Record<string, unknown>;
}

/** The site's script files a page loads, by name and in order, like "game-page". */
export function pageScriptNames(page: string): string[] {
  return pageScriptPaths(page).map((path) => path.slice("/js/".length).replace(/\.[0-9a-f]{16}\.js$/, ""));
}

/** The text of the script files a page loads, one after another, for tests that look at what they do. */
export async function pageScriptText(page: string, fetchPath: (path: string) => Promise<Response>): Promise<string> {
  const texts = await Promise.all(pageScriptPaths(page).map(async (path) => (await fetchPath(path)).text()));
  return texts.join("\n");
}
