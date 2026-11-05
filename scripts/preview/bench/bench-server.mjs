// The Screens bench's server side, for local previews only: the site's preview entry (workers/site.mjs) calls it, and production
// never loads it. Each screen on the bench is a frame whose address carries a mark (bench_screen=<group>.<screen>.<profile>.<backgrounds>).
// A browser has one set of cookies, so the marked requests leave them behind: this keeps a jar of cookies per profile, fills it by
// signing in through the site's own POST /signin, and puts it on each request a screen makes, read from its address or, for a page's
// own fetches and links, from its Referer. And three screens replaying one press mustn't buy three times: the first send runs,
// and the other screens get the same answer (mirrored).
export const BENCH_PATH = "/__preview/bench/";
export const SCREEN_MARK_NAME = "bench_screen";
/** A state to enter once the page is there, on a real phone (On my phone's link) where no bench can press it. */
export const STATE_MARK_NAME = "bench_state";

export const GUEST_PROFILE = "guest";
export const SCREEN_NAMES = ["phone", "turned", "laptop", "real"];
const MARK_PATTERN = new RegExp(`^([a-z0-9-]+)\\.(${SCREEN_NAMES.join("|")})\\.(guest|[A-Za-z0-9_]+)\\.(still|moving)$`);
/** The cookies a page's own script writes, so they stay the browser's. Every other cookie is the profile's. */
const BROWSER_COOKIE_PATTERN = /^(__Host-)?(zaisma_played|zaisma_closed_news|download_started)$/;
/** A screen's device kind, as a real phone's or laptop's script would keep it (device-kind.ts). */
const DEVICE_KIND_COOKIE = "zaisma_device_kind";
const DEVICE_KIND_OF_SCREEN = { phone: "phone", turned: "phone", laptop: "computer" };
/** How long the other screens' same send is answered from the first one's. */
export const MIRROR_WINDOW_MS = 3000;
const OWN_ORIGIN_REQUEST_DESTINATIONS = new Set(["script", "style", "font", "image", "manifest"]);

/** A mark's parts, or null for anything else. */
export function parseMark(markText) {
  const found = MARK_PATTERN.exec(markText ?? "");
  return found ? { groupName: found[1], screenName: found[2], profile: found[3], backgrounds: found[4], markText } : null;
}

/**
 * Where a redirect sends a screen. On this site it keeps the screen's mark: a screen sent on by the bench has no marked page behind it to say
 * whose it is. The stand-in Google or Discord, which answers at once, is asked here, since a screen's frame can't go to another address, and
 * its way back taken as a redirect on this site. Any other address is as it was.
 */
export async function screenLocation(locationText, url, mark) {
  const onward = new URL(locationText, url);
  const isStandIn = onward.pathname.endsWith("/auth/v1/authorize");
  if (!isStandIn && !locationText.startsWith("/")) return locationText;
  const here = isStandIn ? new URL((await fetch(onward, { redirect: "manual" })).headers.get("location")) : onward;
  here.searchParams.set(SCREEN_MARK_NAME, mark.markText);
  return `${here.pathname}${here.search}${here.hash}`;
}

/** The mark a request carries: on its own address, or, from a page on a marked screen, on its Referer's. */
export function markOf(url, refererText) {
  const own = url.searchParams.get(SCREEN_MARK_NAME);
  if (own !== null) return parseMark(own);
  if (!refererText) return null;
  try {
    const referer = new URL(refererText);
    return referer.origin === url.origin ? parseMark(referer.searchParams.get(SCREEN_MARK_NAME)) : null;
  } catch {
    return null;
  }
}

/** The address as the site sees it: no marks. */
export function withoutMarks(url) {
  const clean = new URL(url);
  clean.searchParams.delete(SCREEN_MARK_NAME);
  clean.searchParams.delete(STATE_MARK_NAME);
  return clean;
}

const cookiesOf = (header) => (header ?? "").split(/;\s*/).filter(Boolean).map((pair) => { const at = pair.indexOf("="); return at < 0 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)]; });

/** What the site sees as the Cookie header: the browser's own script-written cookies, then the jar, then this screen's device kind. */
export function cookieHeaderFor(browserCookieHeader, jar, screenName) {
  const kept = cookiesOf(browserCookieHeader).filter(([name]) => BROWSER_COOKIE_PATTERN.test(name));
  const deviceKind = DEVICE_KIND_OF_SCREEN[screenName];
  return [...kept, ...jar, ...(deviceKind ? [[DEVICE_KIND_COOKIE, deviceKind]] : [])].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** The jar after a response's Set-Cookie lines: each sets its cookie, or takes it out when it has expired. */
export function jarAfter(jar, setCookieLines, nowMs) {
  const cookies = new Map(jar);
  for (const line of setCookieLines) {
    const [pair, ...attributes] = line.split(/;\s*/);
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    const isExpired = !value || attributes.some((attribute) => {
      const [attributeName, attributeValue] = attribute.split("=");
      if (attributeName.toLowerCase() === "max-age") return Number(attributeValue) <= 0;
      return attributeName.toLowerCase() === "expires" && Date.parse(attributeValue) <= nowMs;
    });
    if (isExpired) cookies.delete(name);
    else cookies.set(name, value);
  }
  return [...cookies];
}

const isSignedInJar = (jar) => jar.some(([name, value]) => /^(__Host-)?zaisma_in$/.test(name) && value === "1");

/**
 * The first of a group's same sends runs and the others wait for its answer, for a moment after it starts. A second send from the same
 * screen is a new one (a real press, not the copy of one).
 */
export function makeMirror() {
  const sends = new Map();
  return {
    async answer({ keyText, screenName, nowMs, run }) {
      for (const [key, send] of sends) if (nowMs - send.startedAtMs > MIRROR_WINDOW_MS) sends.delete(key);
      const known = sends.get(keyText);
      if (known && !known.screenNames.has(screenName)) {
        known.screenNames.add(screenName);
        return known.answered;
      }
      const answered = run();
      sends.set(keyText, { startedAtMs: nowMs, screenNames: new Set([screenName]), answered });
      return answered;
    },
  };
}

const jars = new Map();
/** A jar holds one address's cookies: https names them __Host-, and a sign-in's token is that address's. */
export const jarKeyOf = (origin, profile) => `${origin} ${profile}`;
const mirror = makeMirror();

/** Everything needed to answer a request again: a Response's body can be read once. */
const keptResponse = async (response) => ({ status: response.status, headers: [...response.headers], body: await response.arrayBuffer() });
const responseOf = (kept) => new Response(kept.status === 204 || kept.status === 304 || (kept.status >= 300 && kept.status < 400) ? null : kept.body, { status: kept.status, headers: kept.headers });

/** A profile's jar, signing in through the site's own form the first time. A guest's starts empty. */
async function jarOf(profile, origin, password, answer, nowMs) {
  const key = jarKeyOf(origin, profile);
  const known = jars.get(key);
  if (known) return known;
  if (profile === GUEST_PROFILE) { jars.set(key, []); return []; }
  const form = new URLSearchParams({ username: profile, password, turnstile_token: "XXXX.DUMMY.TOKEN.XXXX" });
  const signedIn = await answer(new Request(`${origin}/signin`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin, "sec-fetch-site": "same-origin" }, body: form }));
  const jar = jarAfter([], signedIn.headers.getSetCookie(), nowMs);
  jars.set(key, jar);
  return jar;
}

/** Press a profile: it starts over, as if just signed in, or as a new guest. */
export const forgetJar = (origin, profile) => jars.delete(jarKeyOf(origin, profile));

/**
 * A marked request: answered as its profile, its Set-Cookie kept in the jar, and on a page the screen's script first of all, which
 * makes the frame a phone or a laptop before the page's own scripts look (frame-script.js).
 */
export async function answerAsScreen({ request, mark, password, answer, nowMs }) {
  const url = new URL(request.url);
  const destination = request.headers.get("sec-fetch-dest");
  // The site's content-addressed files are the same for everyone.
  if (OWN_ORIGIN_REQUEST_DESTINATIONS.has(destination)) return answer(request);
  const asked = async () => {
    const jar = await jarOf(mark.profile, url.origin, password, answer, nowMs);
    const headers = new Headers(request.headers);
    headers.set("cookie", cookieHeaderFor(request.headers.get("cookie"), jar, mark.screenName));
    const sentBack = await answer(new Request(withoutMarks(url), { method: request.method, headers, body: request.body, redirect: "manual", ...(request.body ? { duplex: "half" } : {}) }));
    const lines = sentBack.headers.getSetCookie();
    jars.set(jarKeyOf(url.origin, mark.profile), jarAfter(jars.get(jarKeyOf(url.origin, mark.profile)) ?? jar, lines, nowMs));
    const response = new Response(sentBack.body, sentBack);
    response.headers.delete("set-cookie");
    const wayOut = sentBack.headers.get("location");
    if (wayOut) response.headers.set("location", await screenLocation(wayOut, url, mark));
    for (const line of lines) if (/^(__Host-)?download_started=/.test(line)) response.headers.append("set-cookie", line);
    return response;
  };
  const isSend = request.method !== "GET" && request.method !== "HEAD";
  const response = isSend
    ? responseOf(await mirror.answer({ keyText: `${mark.groupName} ${request.method} ${url.pathname}`, screenName: mark.screenName, nowMs, run: () => asked().then(keptResponse) }))
    : await asked();
  if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
  const isSignedIn = isSignedInJar(jars.get(jarKeyOf(url.origin, mark.profile)) ?? []);
  const stateValue = url.searchParams.get(STATE_MARK_NAME);
  const scriptQuery = new URLSearchParams({ mark: mark.markText, signed_in: isSignedIn ? "1" : "0", ...(stateValue ? { state: stateValue } : {}) });
  const page = new Response(response.body, response);
  page.headers.set("cache-control", "no-store");
  return new HTMLRewriter().on("head", { element: (head) => head.prepend(`<script src="${BENCH_PATH}frame.js?${scriptQuery.toString().replace(/&/g, "&amp;")}"></script>`, { html: true }) }).transform(page);
}
