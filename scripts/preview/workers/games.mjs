// The games Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), and the access cookies'
// __Host- prefix is spelled zaisma-host- on the wire. The preview is plain http, and the Chrome that
// wrangler runs for the site's runs in Chrome (performance-check.ts) is 126, which drops __Host- cookies
// on http://localhost, so it couldn't open a preview link; the Worker itself still sees __Host- names.
import games from "../../../apps/games/src/index.ts";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/games/src/index.ts";

const WIRE_PREFIX = "zaisma-host-";

async function withPlainCookieNames(request, environment, context) {
  const cookie = request.headers.get("cookie");
  const inbound = cookie ? new Request(request, { headers: new Headers([...request.headers].map(([name, headerValue]) => [name, name === "cookie" ? headerValue.replaceAll(WIRE_PREFIX, "__Host-") : headerValue])) }) : request;
  const response = await games.fetch(inbound, environment, context);
  const setCookies = response.headers.getSetCookie();
  if (!setCookies.some((setCookie) => setCookie.startsWith("__Host-"))) return response;
  const outbound = new Response(response.body, response);
  outbound.headers.delete("set-cookie");
  for (const setCookie of setCookies) outbound.headers.append("set-cookie", setCookie.replace(/^__Host-/, WIRE_PREFIX));
  return outbound;
}

export default workerRetryingWhenLocked({ ...games, fetch: withPlainCookieNames });
