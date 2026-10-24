// The preview's front door (run.mjs). The site, games, rooms and compress Workers all run in one wrangler dev, which
// listens on the site's port; run.mjs forwards the games and rooms ports to it, so a request's port says which Worker
// it's for. Each Worker sees the request as it was sent, its own port included. The every-few-minutes jobs
// (GET /__scheduled?cron=…, as wrangler's --test-scheduled answers them) go to that port's Worker's scheduled handler.
// On a phone (PHONE_HOST), Tailscale Serve hands requests on over http, and run.mjs sends its own to localhost: the Workers
// see every one as sent to https://PHONE_HOST on its port, the address the preview is on, so they match SITE_ORIGIN and the Origin.
// A browser on this Mac can open it at localhost too (a session's own checks in the app's browser pane): its Origin and Referer
// are told the tailnet address on the way in, and every tailnet address in the answer is told back at localhost on the way
// out (the games on 127.0.0.1, another site, as without the tailnet), so pages, sign-ins, games and rooms work at both.
// run.mjs marks its own requests (PREVIEW_SCRIPT_HEADER, the same name there): they get the tailnet answers, as before.
// A Worker exports only its handlers, so the name is written in both.
const PREVIEW_SCRIPT_HEADER = "x-preview-script";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// What can carry a tailnet address in its body. Never a stream that doesn't end (text/event-stream).
const TEXT_TYPE = /^(text\/(?!event-stream)|application\/(javascript|json|xml|[\w.-]+\+(json|xml))|image\/svg\+xml)/i;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    const isLocal = Boolean(environment.PHONE_HOST) && LOCAL_HOSTS.has(url.hostname) && !request.headers.has(PREVIEW_SCRIPT_HEADER);
    if (environment.PHONE_HOST && (url.hostname !== environment.PHONE_HOST || url.protocol !== "https:")) {
      url.protocol = "https:";
      url.hostname = environment.PHONE_HOST;
      request = new Request(url, request);
      request.headers.delete(PREVIEW_SCRIPT_HEADER);
      // Wrangler gives an Origin or Referer on the request's own name the request's http: they were sent as https.
      for (const name of ["origin", "referer"]) {
        const value = request.headers.get(name);
        if (value?.startsWith(`http://${environment.PHONE_HOST}:`)) request.headers.set(name, `https${value.slice(4)}`);
        else if (isLocal && value) request.headers.set(name, toTailnet(value, environment));
      }
    }
    const worker = url.port === environment.GAMES_PORT ? environment.GAMES : url.port === environment.ROOMS_PORT ? environment.ROOMS : environment.SITE;
    if (url.pathname === "/__scheduled" && worker !== environment.GAMES) {
      await worker.scheduled({ cron: url.searchParams.get("cron") ?? "", scheduledTime: Date.now() });
      return new Response("Ran scheduled event");
    }
    const response = await worker.fetch(request);
    // A game's own files never name the preview's address: only what Zaisma adds to them (/_zaisma/) is read.
    return isLocal ? toLocal(response, environment, worker !== environment.GAMES || url.pathname.includes("/_zaisma/")) : response;
  },
};

/** The ports a browser opens, each with the name it has at localhost (in step with run.mjs's SITE, GAMES, ROOMS and MAIL). */
const localNames = (environment) => ({
  [environment.SITE_PORT]: "localhost",
  [environment.GAMES_PORT]: "127.0.0.1",
  [environment.ROOMS_PORT]: "localhost",
  [environment.MAIL_PORT]: "localhost",
});

/** An Origin or Referer a browser sent at localhost, as it would have been on the tailnet. Anything else stays as it was. */
function toTailnet(value, environment) {
  const ports = Object.keys(localNames(environment)).join("|");
  return value.replace(new RegExp(`^http://(localhost|127\\.0\\.0\\.1|\\[::1\\]):(${ports})(?![0-9])`), `https://${environment.PHONE_HOST}:$2`);
}

/** Every tailnet address in a value (plain or URL-encoded, https or wss) at localhost instead. */
function localText(text, environment) {
  const names = localNames(environment);
  const pattern = new RegExp(`(https|wss)(://|%3A%2F%2F)${escapeRegExp(environment.PHONE_HOST)}(:|%3A)(${Object.keys(names).join("|")})(?![0-9])`, "gi");
  return text.replace(pattern, (_, scheme, slashes, colon, port) => `${scheme.toLowerCase() === "wss" ? "ws" : "http"}${slashes}${names[port]}${colon}${port}`);
}

/** The Worker's answer as a browser at localhost needs it: its headers (CSP, Location, CORS) and, when it's text, its body. */
async function toLocal(response, environment, canRewriteBody) {
  // A room's WebSocket goes through as it is.
  if (response.status === 101 || response.webSocket) return response;
  const headers = new Headers(response.headers);
  let isChanged = false;
  for (const [name, value] of response.headers) {
    if (name === "set-cookie" || !value.includes(environment.PHONE_HOST)) continue;
    headers.set(name, localText(value, environment));
    isChanged = true;
  }
  const type = response.headers.get("content-type") ?? "";
  if (canRewriteBody && response.body && TEXT_TYPE.test(type) && !response.headers.has("content-encoding")) {
    const text = await response.text();
    headers.delete("content-length");
    return new Response(localText(text, environment), { status: response.status, statusText: response.statusText, headers });
  }
  return isChanged ? new Response(response.body, { status: response.status, statusText: response.statusText, headers }) : response;
}
