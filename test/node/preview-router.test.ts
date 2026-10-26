import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import router from "../../scripts/preview/workers/router.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { environmentAt } from "../../scripts/preview/workers/addresses.mjs";

/**
 * The preview's front door (scripts/preview/workers/router.mjs) and the addresses its Workers name
 * (scripts/preview/workers/addresses.mjs): a request that arrives at localhost is answered with localhost addresses (the games
 * on 127.0.0.1) everywhere it's sent next, and one that arrives at the tailnet name with the tailnet's, so a session's checks
 * in the app's browser pane never leave localhost and Julius's phone never leaves the tailnet.
 */

const HOST = "julius-mac.tail1234.ts.net";
const PORTS = { SITE_PORT: "8800", GAMES_PORT: "8801", ROOMS_PORT: "8802" };
const TAILNET = { SITE_ORIGIN: `https://${HOST}:8800`, GAME_ORIGIN: `https://${HOST}:8801`, ROOMS_ORIGIN: `https://${HOST}:8802` };
const LOCAL = { SITE_ORIGIN: "http://localhost:8800", GAME_ORIGIN: "http://127.0.0.1:8801", ROOMS_ORIGIN: "http://localhost:8802" };
type Settings = typeof TAILNET;

/**
 * Stand-ins for the site, games and rooms Workers that answer from their settings as the real ones do (redirects, pages with
 * the game frame and links, CSP, CORS, Zaisma's script in a game, a room's invite), each run as its preview entry runs it, with
 * environmentAt. Each Worker's settings are run.mjs's: the tailnet's (or localhost's off the tailnet), and on the tailnet
 * PREVIEW_LOCAL_SETTINGS for a request at localhost.
 */
function preview(phoneHost = HOST) {
  const seen: { worker: string; request: Request }[] = [];
  const browserSettings = phoneHost ? TAILNET : LOCAL;
  const worker = (name: string, names: (keyof Settings)[], answer: (request: Request, settings: Settings) => Response) => {
    const pick = (settings: Settings) => Object.fromEntries(names.map((settingName) => [settingName, settings[settingName]]));
    const environment = { ...pick(browserSettings), ...(phoneHost ? { PREVIEW_LOCAL_SETTINGS: JSON.stringify(pick(LOCAL)) } : {}) };
    return {
      fetch: async (request: Request) => {
        seen.push({ worker: name, request });
        return answer(request, environmentAt(request, environment));
      },
      scheduled: async () => seen.push({ worker: name, request: new Request("http://scheduled/") }),
    };
  };
  const site = worker("site", ["SITE_ORIGIN", "GAME_ORIGIN"], (request, { SITE_ORIGIN, GAME_ORIGIN }) => {
    const url = new URL(request.url);
    if (url.pathname === "/dashboard") return new Response(null, { status: 303, headers: { location: `${SITE_ORIGIN}/signin?next=${encodeURIComponent(`${SITE_ORIGIN}/dashboard`)}` } });
    if (url.pathname === "/buy") return Response.json({ checkout_url: `http://localhost:8803/checkout?return_url=${encodeURIComponent(`${SITE_ORIGIN}/g/tiny-farm?play`)}` });
    return new Response(`<a href="${SITE_ORIGIN}/forum">Forum</a><iframe src="${GAME_ORIGIN}/tiny-farm/_zaisma/enter"></iframe>`, {
      headers: { "content-type": "text/html", "content-security-policy": `frame-src ${GAME_ORIGIN}`, "access-control-allow-origin": GAME_ORIGIN, "content-encoding": "gzip" },
    });
  });
  const games = worker("games", ["SITE_ORIGIN", "ROOMS_ORIGIN"], (_, { SITE_ORIGIN, ROOMS_ORIGIN }) =>
    new Response(`var __ZAISMA__ = {"site":"${SITE_ORIGIN}","rooms":"${ROOMS_ORIGIN.replace("http", "ws")}"};`, { headers: { "content-type": "text/javascript", "content-security-policy": `frame-ancestors ${SITE_ORIGIN}` } }));
  const rooms = worker("rooms", ["SITE_ORIGIN", "GAME_ORIGIN"], (request, { SITE_ORIGIN, GAME_ORIGIN }) => {
    if (new URL(request.url).pathname === "/") return Response.redirect(SITE_ORIGIN, 302);
    if (request.headers.get("origin") !== GAME_ORIGIN) return new Response("Not from the game's origin", { status: 403 });
    return Response.json({ invite_url: `${SITE_ORIGIN}/g/arena?room=K7PQ2M` });
  });
  const environment = { ...PORTS, PHONE_HOST: phoneHost, SITE: site, GAMES: games, ROOMS: rooms };
  return { seen, send: (request: Request): Promise<Response> => router.fetch(request, environment) };
}

/** Every origin an answer names, in its headers and its body. */
async function originsIn(response: Response) {
  const text = `${[...response.headers].map(([name, value]) => `${name}: ${value}`).join("\n")}\n${await response.text()}`;
  return [...decodeURIComponent(text).matchAll(/\b(?:https?|wss?):\/\/[\w.[\]-]+(?::\d+)?/g)].map(([origin]) => origin);
}

/** A browser at `base` (an origin) asking for the site's, games' and rooms' answers, as a page and its game frame do. */
async function browse(send: (request: Request) => Promise<Response>, base: { site: string; games: string; rooms: string }) {
  const answers = [
    await send(new Request(`${base.site}/g/tiny-farm`)),
    await send(new Request(`${base.site}/dashboard`, { redirect: "manual" })),
    await send(new Request(`${base.site}/buy`, { method: "POST", headers: { origin: base.site } })),
    await send(new Request(`${base.games}/tiny-farm/_zaisma/v1.js`, { headers: { referer: `${base.site}/g/tiny-farm` } })),
    await send(new Request(`${base.rooms}/`, { redirect: "manual" })),
    await send(new Request(`${base.rooms}/v1/rooms`, { method: "POST", headers: { origin: base.games } })),
  ];
  expect(answers.map(({ status }) => status)).toEqual([200, 303, 200, 200, 302, 200]);
  return (await Promise.all(answers.map(originsIn))).flat();
}

describe("preview addresses", () => {
  it("answers a browser at localhost with localhost addresses only, the games on 127.0.0.1", async () => {
    const { send } = preview();
    const origins = await browse(send, { site: "http://localhost:8800", games: "http://127.0.0.1:8801", rooms: "http://localhost:8802" });
    expect(origins.length).toBeGreaterThan(10);
    for (const origin of origins) expect(origin).toMatch(/^(https?|wss?):\/\/(localhost|127\.0\.0\.1):\d+$/);
    expect(origins).toContain("http://127.0.0.1:8801");
    expect(origins).not.toContain("http://localhost:8801");
  });

  it("answers a browser on the tailnet with the tailnet's addresses only", async () => {
    const { send } = preview();
    // Tailscale Serve hands each request on over http, to its own port here, with the Host it was sent to.
    const origins = await browse(send, { site: `http://${HOST}:8800`, games: `http://${HOST}:8801`, rooms: `http://${HOST}:8802` });
    expect(origins.length).toBeGreaterThan(10);
    for (const origin of origins) if (!origin.startsWith("http://localhost:8803")) expect(origin).toMatch(new RegExp(`^(https|wss)://${HOST.replaceAll(".", "\\.")}:\\d+$`));
  });

  it("hands Tailscale's requests on as sent to the tailnet address over https, their Origin and Referer too", async () => {
    const { seen, send } = preview();
    await send(new Request(`http://${HOST}:8800/signin`, { method: "POST", headers: { origin: `http://${HOST}:8800`, referer: `http://${HOST}:8800/signin` } }));
    expect(seen[0]!.request.url).toBe(`https://${HOST}:8800/signin`);
    expect(seen[0]!.request.headers.get("origin")).toBe(`https://${HOST}:8800`);
    expect(seen[0]!.request.headers.get("referer")).toBe(`https://${HOST}:8800/signin`);
  });

  it("hands a localhost browser's requests on as they were sent, to each Worker by its port", async () => {
    const { seen, send } = preview();
    const request = new Request("http://localhost:8800/signin", { method: "POST", headers: { origin: "http://localhost:8800" } });
    await send(request);
    await send(new Request("http://127.0.0.1:8801/tiny-farm/"));
    await send(new Request("http://localhost:8802/v1/rooms", { headers: { origin: "http://127.0.0.1:8801" } }));
    expect(seen.map(({ worker }) => worker)).toEqual(["site", "games", "rooms"]);
    expect(seen[0]!.request).toBe(request);
  });

  it("answers the preview's own script at localhost as on the tailnet, without its mark", async () => {
    const { seen, send } = preview();
    const response = await send(new Request("http://localhost:8800/dashboard", { headers: { "x-preview-script": "1", origin: `https://${HOST}:8800` } }));
    expect(seen[0]!.request.url).toBe(`https://${HOST}:8800/dashboard`);
    expect(seen[0]!.request.headers.has("x-preview-script")).toBe(false);
    expect(response.headers.get("location")).toMatch(new RegExp(`^https://${HOST.replaceAll(".", "\\.")}:8800/`));
  });

  it("runs the every-few-minutes jobs on the port's Worker", async () => {
    const { seen, send } = preview();
    const response = await send(new Request("http://localhost:8802/__scheduled?cron=*+*+*+*+*"));
    expect(await response.text()).toBe("Ran scheduled event");
    expect(seen.map(({ worker }) => worker)).toEqual(["rooms"]);
  });

  it("changes nothing off the tailnet: localhost is the only address", async () => {
    const { seen, send } = preview("");
    const request = new Request("http://localhost:8800/", { headers: { origin: "http://localhost:8800" } });
    await send(request);
    expect(seen[0]!.request).toBe(request);
    const origins = await browse(send, { site: "http://localhost:8800", games: "http://127.0.0.1:8801", rooms: "http://localhost:8802" });
    for (const origin of origins) expect(origin).toMatch(/^(https?|wss?):\/\/(localhost|127\.0\.0\.1):\d+$/);
  });
});

describe("environmentAt", () => {
  const environment = { SITE_ORIGIN: TAILNET.SITE_ORIGIN, DB: { prepare: () => "statement" }, PREVIEW_LOCAL_SETTINGS: JSON.stringify({ SITE_ORIGIN: LOCAL.SITE_ORIGIN }) };

  it("swaps in the localhost settings for localhost, 127.0.0.1 and [::1], and keeps every other binding", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const local = environmentAt(new Request(`http://${host}:8800/`), environment);
      expect(local.SITE_ORIGIN).toBe(LOCAL.SITE_ORIGIN);
      expect(local.DB).toBe(environment.DB);
      expect({ ...local }.SITE_ORIGIN).toBe(LOCAL.SITE_ORIGIN);
    }
  });

  it("gives the same environment to every localhost request, so what a Worker keeps per environment stays kept", () => {
    expect(environmentAt(new Request("http://localhost:8800/a"), environment)).toBe(environmentAt(new Request("http://127.0.0.1:8800/b"), environment));
  });

  it("leaves the environment as it was at the tailnet name, and when there are no localhost settings", () => {
    expect(environmentAt(new Request(`https://${HOST}:8800/`), environment)).toBe(environment);
    const offTailnet = { SITE_ORIGIN: LOCAL.SITE_ORIGIN };
    expect(environmentAt(new Request("http://localhost:8800/"), offTailnet)).toBe(offTailnet);
  });
});
