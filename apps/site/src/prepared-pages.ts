import { createHash } from "node:crypto";
import { pageScript, pageScriptPath, scriptPathsRunningWhilePrepared } from "./page-scripts.ts";

/**
 * Pages prepared ahead ("Page switches that never wait"): a link the pointer rests on or presses is prerendered (the speculation rules in
 * html.ts), and on phones the links on screen once scrolling stops are fetched (PREPARE_SCRIPT), so the page is there when the tap lands.
 * A prepared page counts nothing and wakes nothing until it's opened: no play counted, no check-in, no game warmed, no topic marked seen.
 */

/**
 * The site's addresses never prepared ahead, as URL patterns (* is anything, slashes too): what answers no page (the API, the MCP, files,
 * webhooks), what acts on a GET (a tester link's page notes it was opened), admin pages, and a game's report and rooms pages.
 */
const NEVER_PREPARED_PATHS = ["/api/*", "/admin", "/admin/*", "/mcp", "/mcp/*", "/oauth/*", "/signout", "/t/*", "/g/*/*", "/js/*", "/css/*", "/img/*", "/fonts/*", "/github/*", "/stripe/*", "/csp-reports", "/speculation-rules*"];
/** The same as one regular expression's source, for PREPARE_SCRIPT. */
const NEVER_PREPARED_PATH_SOURCE = `^(${NEVER_PREPARED_PATHS.map((path) => path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")).join("|")})$`;
/** A link the page may prepare: on this site, not to an address above, not a download, another tab, nofollow or marked data-never-prepared. */
const PREPARED_LINKS = {
  and: [
    { href_matches: { pathname: "/*" } },
    { not: { href_matches: NEVER_PREPARED_PATHS.map((pathname) => ({ pathname })) } },
    { not: { selector_matches: "[download], [target]:not([target=_self]), [rel~=nofollow], [data-never-prepared]" } },
  ],
};

/**
 * Every page's speculation rules (Speculation-Rules, html.ts): a link the pointer rests on or presses ("moderate") is prerendered, so the
 * page is whole when the tap lands; a link PREPARE_SCRIPT marks as on a phone's screen is fetched ahead ("immediate"). Browsers without
 * them just follow the link. The prerendered page holds its scripts until it's opened (heldUntilOpened).
 */
export const SPECULATION_RULES = {
  prerender: [{ source: "document", where: PREPARED_LINKS, eagerness: "moderate" }],
  prefetch: [{ source: "document", where: { and: [PREPARED_LINKS, { selector_matches: "[data-prepared-ahead]" }] }, eagerness: "immediate" }],
};
const SPECULATION_RULES_TEXT = JSON.stringify(SPECULATION_RULES);
/** Where they're served, named for their contents like a page's script, so a change reaches every page at once. */
export const SPECULATION_RULES_PATH = `/speculation-rules.${createHash("sha256").update(SPECULATION_RULES_TEXT).digest("hex").slice(0, 16)}.json`;

/** GET /speculation-rules.<hash>.json: kept for good. An older address, from a page before a deploy, gets today's rules, never kept. */
export function speculationRulesResponse(path: string): Response {
  return new Response(SPECULATION_RULES_TEXT, {
    headers: { "Content-Type": "application/speculationrules+json", "Cache-Control": path === SPECULATION_RULES_PATH ? "public, max-age=31536000, immutable" : "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** A request for a page fetched or rendered ahead of a tap: Chrome's speculation rules say so in Sec-Purpose, PREPARE_SCRIPT in Purpose. */
export function isPreparedRequest(request: Request): boolean {
  return /\bprefetch\b/.test(`${request.headers.get("Sec-Purpose") ?? ""} ${request.headers.get("Purpose") ?? ""}`);
}

/** What marks a script file a prepared page holds until it's opened (FOLLOWING_FILES_SCRIPT runs it then). */
export const HELD_FILE_ATTRIBUTE = "data-when-opened";

/** A held script's type: no browser fetches or runs a script of a type it doesn't know. */
const WAITING_SCRIPT_TYPE = "zaisma/when-opened";

/**
 * The end of a prepared page: its held scripts run, in their order, once the page is opened. A prerendered page waits for the tap
 * (prerenderingchange); one only fetched ahead, then opened, runs them at once.
 */
const WHEN_OPENED_SCRIPT = pageScript(
  "when-opened",
  `(function () {
  function open() {
    Array.prototype.forEach.call(document.querySelectorAll('script[type="${WAITING_SCRIPT_TYPE}"]'), function (held) {
      var script = document.createElement("script");
      script.src = held.getAttribute("src");
      script.async = false;
      held.replaceWith(script);
    });
  }
  if (document.prerendering) document.addEventListener("prerenderingchange", open, { once: true });
  else open();
})();
`,
  { runsWhilePreparedBecause: "It only starts the page's held scripts once the page is opened." },
);

/**
 * A prepared page as it's sent: every script of the page's body that isn't on the reviewed list (page-scripts.ts, runsWhilePreparedBecause)
 * is held until the page is opened, so a new script waits by default, and fetched ahead (a preload beside it), so it runs the moment the
 * page is opened and the page's buttons work from its first tap; <html> says the page was prepared (data-prepared-ahead), for a script
 * that does on opening what the server left undone; and the browser may keep it for half a minute, so a browser without speculation rules
 * (Safari) opens it from its cache. Vary: Cookie, so it never opens for someone else's sign-in.
 */
export function heldUntilOpened(response: Response): Response {
  if (response.status !== 200 || !(response.headers.get("Content-Type") ?? "").startsWith("text/html")) return response;
  const running = scriptPathsRunningWhilePrepared();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, max-age=30");
  headers.append("Vary", "Cookie");
  return new HTMLRewriter()
    .on("html", { element: (root) => void root.setAttribute("data-prepared-ahead", "") })
    // A page's script files are named at its body's end and run by its first-paint script once it's styled (html.ts, FOLLOWING_FILES_SCRIPT):
    // each held one is marked, and that script runs it once the page is opened.
    .on("body link[rel=preload][data-page-script]", {
      element: (named) => {
        const source = named.getAttribute("href") ?? "";
        if (source.startsWith("/js/") && !running.has(source)) named.setAttribute(HELD_FILE_ATTRIBUTE, "");
      },
    })
    .on("body script[src]", {
      element: (script) => {
        const source = script.getAttribute("src") ?? "";
        if (!source.startsWith("/js/") || running.has(source)) return;
        script.setAttribute("type", WAITING_SCRIPT_TYPE);
        script.before(`<link rel="preload" as="script" href="${source}">`, { html: true });
      },
    })
    .on("body", { element: (body) => body.onEndTag((end) => void end.before(`<script src="${pageScriptPath(WHEN_OPENED_SCRIPT)}"></script>`, { html: true })) })
    .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}

/**
 * Preparing what's on a phone's screen, and preparing in browsers without speculation rules. On a touch screen without Data Saver, once
 * scrolling stops (anywhere on the page, a shelf too) the links on screen are prepared: marked data-prepared-ahead for the speculation
 * rules to fetch, or, without them (Safari), fetched here at low priority with Purpose: prefetch, which the site answers as a page the
 * browser keeps for half a minute. Without speculation rules, a link the pointer rests on (200 ms) or presses is fetched the same way.
 * With Data Saver on, only what's pointed at or pressed. Never a link the rules leave out.
 */
export const PREPARE_SCRIPT = `/* prepare */(function () {
  var connection = navigator.connection, isSavingData = Boolean(connection && connection.saveData === true);
  var hasRules = Boolean(HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules"));
  var NEVER = new RegExp(${JSON.stringify(NEVER_PREPARED_PATH_SOURCE)});
  function preparedAddress(link) {
    if (!link || !link.href || link.hasAttribute("download") || link.hasAttribute("data-never-prepared") || (link.target && link.target !== "_self") || /(^|\\s)nofollow(\\s|$)/.test(link.rel)) return null;
    var to = new URL(link.href, location.href);
    if (to.origin !== location.origin || NEVER.test(to.pathname) || (to.pathname === location.pathname && to.search === location.search)) return null;
    to.hash = "";
    return to.href;
  }
  var fetched = {};
  function fetchAhead(address) {
    if (!address || fetched[address]) return;
    fetched[address] = true;
    fetch(address, { credentials: "same-origin", priority: "low", headers: { Purpose: "prefetch" } }).then(function (response) { return response.arrayBuffer(); }).catch(function () {});
  }
  function prepare(link) {
    var address = preparedAddress(link);
    if (!address) return;
    if (hasRules) link.setAttribute("data-prepared-ahead", "");
    else fetchAhead(address);
  }
  if (!hasRules) {
    document.addEventListener("pointerover", function (event) {
      var link = event.target.closest && event.target.closest("a[href]");
      if (!preparedAddress(link)) return;
      var timer = setTimeout(function () { fetchAhead(preparedAddress(link)); }, 200);
      link.addEventListener("pointerleave", function () { clearTimeout(timer); }, { once: true });
    });
    document.addEventListener("pointerdown", function (event) { fetchAhead(preparedAddress(event.target.closest && event.target.closest("a[href]"))); });
  }
  if (isSavingData || !matchMedia("(pointer: coarse)").matches || !window.IntersectionObserver || !window.zaismaWatch) return;
  var shown = new Set();
  var watcher = new IntersectionObserver(function (entries) { entries.forEach(function (entry) { if (entry.isIntersecting) shown.add(entry.target); else shown.delete(entry.target); }); });
  window.zaismaWatch.each("a[href]", function (link) { if (preparedAddress(link)) watcher.observe(link); });
  var timer = 0;
  function stopped() { clearTimeout(timer); timer = setTimeout(function () { shown.forEach(prepare); }, 150); }
  window.zaismaWatch.scroll(stopped);
  stopped();
})();
`;
