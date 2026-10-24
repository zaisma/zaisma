import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import router from "../../scripts/preview/workers/router.mjs";

/**
 * The preview's front door (scripts/preview/workers/router.mjs) on the tailnet: Tailscale's requests reach the Workers as
 * before, and a browser at localhost gets the same Workers, its Origin and Referer told the tailnet address on the way in and
 * every tailnet address in the answer told back at localhost (the games on 127.0.0.1) on the way out.
 */

const HOST = "julius-mac.tail1234.ts.net";
const PORTS = { SITE_PORT: "8800", GAMES_PORT: "8801", ROOMS_PORT: "8802", MAIL_PORT: "8795" };

/** The router with stand-in Workers that keep what they were sent and answer what `answer` makes. */
function preview(answer: (request: Request) => Response | { status: number; webSocket: object }, phoneHost = HOST) {
  const seen: { worker: string; request: Request }[] = [];
  const worker = (name: string) => ({
    fetch: async (request: Request) => {
      seen.push({ worker: name, request });
      return answer(request);
    },
  });
  const environment = { ...PORTS, PHONE_HOST: phoneHost, SITE: worker("site"), GAMES: worker("games"), ROOMS: worker("rooms") };
  return { seen, send: (request: Request): Promise<Response> => router.fetch(request, environment) };
}

const page = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });

describe("preview router on the tailnet", () => {
  it("hands Tailscale's requests on as sent to the tailnet address over https, and their answers as they were", async () => {
    const answer = new Response(`<iframe src="https://${HOST}:8801/tiny-farm/">`, { headers: { "content-type": "text/html" } });
    const { seen, send } = preview(() => answer);
    const response = await send(new Request(`http://${HOST}:8800/g/tiny-farm`, { method: "POST", headers: { origin: `http://${HOST}:8800` } }));
    expect(seen[0].request.url).toBe(`https://${HOST}:8800/g/tiny-farm`);
    expect(seen[0].request.headers.get("origin")).toBe(`https://${HOST}:8800`);
    expect(response).toBe(answer);
  });

  it("tells the Workers a localhost browser's Origin and Referer at the tailnet address", async () => {
    const { seen, send } = preview(page("ok"));
    await send(new Request("http://localhost:8800/signin", { method: "POST", headers: { origin: "http://localhost:8800", referer: "http://localhost:8800/signin?next=%2Fdashboard" } }));
    expect(seen[0].worker).toBe("site");
    expect(seen[0].request.url).toBe(`https://${HOST}:8800/signin`);
    expect(seen[0].request.headers.get("origin")).toBe(`https://${HOST}:8800`);
    expect(seen[0].request.headers.get("referer")).toBe(`https://${HOST}:8800/signin?next=%2Fdashboard`);
  });

  it("tells a game's requests from 127.0.0.1 at the tailnet address, to the games and rooms Workers by their port", async () => {
    const { seen, send } = preview(page("ok"));
    await send(new Request("http://localhost:8800/api/plays", { method: "POST", headers: { origin: "http://127.0.0.1:8801" } }));
    await send(new Request("http://127.0.0.1:8801/tiny-farm/", { headers: { referer: "http://localhost:8800/g/tiny-farm" } }));
    await send(new Request("http://localhost:8802/rooms/abc", { headers: { origin: "http://127.0.0.1:8801" } }));
    expect(seen.map(({ worker }) => worker)).toEqual(["site", "games", "rooms"]);
    expect(seen[0].request.headers.get("origin")).toBe(`https://${HOST}:8801`);
    expect(seen[1].request.url).toBe(`https://${HOST}:8801/tiny-farm/`);
    expect(seen[1].request.headers.get("referer")).toBe(`https://${HOST}:8800/g/tiny-farm`);
    expect(seen[2].request.headers.get("origin")).toBe(`https://${HOST}:8801`);
  });

  it("leaves another site's Origin on this Mac as it was (Sky Hopper Online, the sign-in stand-in's site)", async () => {
    const { seen, send } = preview(page("ok"));
    await send(new Request("http://localhost:8800/oauth/token", { method: "POST", headers: { origin: "http://localhost:8793" } }));
    await send(new Request("http://localhost:8800/oauth/token", { method: "POST", headers: { origin: "http://localhost:88000" } }));
    expect(seen.map(({ request }) => request.headers.get("origin"))).toEqual(["http://localhost:8793", "http://localhost:88000"]);
  });

  it("answers a localhost browser with every tailnet address at localhost, the games on 127.0.0.1", async () => {
    const html = [
      `<iframe src="https://${HOST}:8801/tiny-farm/">`,
      `<a href="https://${HOST}:8795/">Email codes</a>`,
      `{"rooms":"https://${HOST}:8802","socket":"wss://${HOST}:8802/rooms/abc","site":"https://${HOST}:8800"}`,
      `<a href="/signin?return_to=https%3A%2F%2F${HOST}%3A8800%2Fdashboard">`,
      `rpId: "${HOST}"`,
    ].join("\n");
    const { send } = preview(page(html, {
      "content-length": String(html.length),
      "content-security-policy": `frame-src https://${HOST}:8801; connect-src https://${HOST}:8802 wss://${HOST}:8802`,
      "access-control-allow-origin": `https://${HOST}:8801`,
      "set-cookie": "__Host-zaisma_session=abc; Path=/; Secure; HttpOnly",
    }));
    const response = await send(new Request("http://localhost:8800/g/tiny-farm"));
    expect(await response.text()).toBe([
      `<iframe src="http://127.0.0.1:8801/tiny-farm/">`,
      `<a href="http://localhost:8795/">Email codes</a>`,
      `{"rooms":"http://localhost:8802","socket":"ws://localhost:8802/rooms/abc","site":"http://localhost:8800"}`,
      `<a href="/signin?return_to=http%3A%2F%2Flocalhost%3A8800%2Fdashboard">`,
      `rpId: "${HOST}"`,
    ].join("\n"));
    expect(response.headers.get("content-security-policy")).toBe("frame-src http://127.0.0.1:8801; connect-src http://localhost:8802 ws://localhost:8802");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8801");
    expect(response.headers.get("set-cookie")).toBe("__Host-zaisma_session=abc; Path=/; Secure; HttpOnly");
    expect(response.headers.get("content-length")).not.toBe(String(html.length));
  });

  it("answers a redirect at localhost, with its status", async () => {
    const { send } = preview(() => new Response(null, { status: 303, headers: { location: `https://${HOST}:8800/dashboard` } }));
    const response = await send(new Request("http://localhost:8800/signin", { method: "POST", headers: { origin: "http://localhost:8800" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:8800/dashboard");
  });

  it("reads only what Zaisma adds to a game, never the game's own files, though their headers are told at localhost", async () => {
    const config = `var __ZAISMA__ = {"site":"https://${HOST}:8800"};`;
    const own = `fetch("https://${HOST}:8800/")`;
    const { send } = preview((request) =>
      new Response(request.url.includes("/_zaisma/") ? config : own, { headers: { "content-type": "text/javascript", "content-security-policy": `frame-ancestors https://${HOST}:8800` } }));
    const zaisma = await send(new Request("http://127.0.0.1:8801/tiny-farm/_zaisma/v1.js"));
    const game = await send(new Request("http://127.0.0.1:8801/tiny-farm/game.js"));
    expect(await zaisma.text()).toBe(`var __ZAISMA__ = {"site":"http://localhost:8800"};`);
    expect(await game.text()).toBe(own);
    expect(game.headers.get("content-security-policy")).toBe("frame-ancestors http://localhost:8800");
  });

  it("passes compressed bodies, streams and WebSockets through unread", async () => {
    const body = `"https://${HOST}:8800"`;
    const compressed = preview(() => new Response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip" } }));
    expect(await (await compressed.send(new Request("http://localhost:8800/api/x"))).text()).toBe(body);
    const stream = preview(() => new Response(body, { headers: { "content-type": "text/event-stream" } }));
    expect(await (await stream.send(new Request("http://localhost:8800/events"))).text()).toBe(body);
    const socket = { status: 101, webSocket: {} };
    const room = preview(() => socket);
    expect(await room.send(new Request("http://localhost:8802/rooms/abc", { headers: { upgrade: "websocket" } }))).toBe(socket);
  });

  it("answers the preview's own script at localhost as on the tailnet, without its mark", async () => {
    const answer = new Response(`https://${HOST}:8800/`, { headers: { "content-type": "text/plain" } });
    const { seen, send } = preview(() => answer);
    const response = await send(new Request("http://localhost:8800/api/dev/games", { headers: { "x-preview-script": "1", origin: `https://${HOST}:8800` } }));
    expect(seen[0].request.url).toBe(`https://${HOST}:8800/api/dev/games`);
    expect(seen[0].request.headers.has("x-preview-script")).toBe(false);
    expect(seen[0].request.headers.get("origin")).toBe(`https://${HOST}:8800`);
    expect(response).toBe(answer);
  });

  it("changes nothing off the tailnet", async () => {
    const answer = new Response(`<a href="http://localhost:8800/">`, { headers: { "content-type": "text/html" } });
    const { seen, send } = preview(() => answer, "");
    const request = new Request("http://localhost:8800/", { headers: { origin: "http://localhost:8800" } });
    expect(await send(request)).toBe(answer);
    expect(seen[0].request).toBe(request);
  });
});
