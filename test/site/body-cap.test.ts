import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BodyPastCapError, cappedRequest, createAccount, readBodyBytes, readBodyText } from "@zaisma/core";
import { guardSiteDoor } from "../../apps/site/src/guard.ts";

/**
 * No door on Zaisma reads more of a request's body than its own cap, whatever the request's headers say: the size is
 * held as bytes are read, for every kind of row, with a size stated, none stated, a wrong one or an encoded body.
 */

const SITE = "https://zaisma.test";
const CHUNK_SIZE_BYTES = 16 * 1024;

/** A body of as many chunks as are asked for, that says how many were. */
function endlessBody(chunkBytes = new Uint8Array(CHUNK_SIZE_BYTES).fill(0x20)) {
  const read = { chunkCount: 0, isCancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        read.chunkCount += 1;
        controller.enqueue(chunkBytes);
      },
      cancel() {
        read.isCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, read };
}

const requestWith = (body: BodyInit, headers: Record<string, string> = {}, path = "/csp-reports", method = "POST") => new Request(`${SITE}${path}`, { method, headers, body });

async function gzipped(text: string): Promise<Uint8Array> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("A body read up to a size", () => {
  it("reads a body within it whole", async () => {
    expect(await readBodyText(requestWith("hello"), 5)).toBe("hello");
    expect(await readBodyBytes(new Request(SITE), 5)).toEqual(new Uint8Array());
  });

  it("stops at the size with no size stated, and reads no further", async () => {
    const { stream, read } = endlessBody();
    await expect(readBodyBytes(requestWith(stream), 32 * 1024)).rejects.toBeInstanceOf(BodyPastCapError);
    expect(read.chunkCount).toBeLessThanOrEqual(3);
    expect(read.isCancelled).toBe(true);
  });

  it("stops at the size with a smaller size stated", async () => {
    const { stream, read } = endlessBody();
    await expect(readBodyBytes(requestWith(stream, { "content-length": "10" }), 32 * 1024)).rejects.toBeInstanceOf(BodyPastCapError);
    expect(read.chunkCount).toBeLessThanOrEqual(3);
  });

  it("refuses a stated size over it before reading any", async () => {
    const { stream, read } = endlessBody();
    await expect(readBodyBytes(requestWith(stream, { "content-length": String(1024 * 1024) }), 1024)).rejects.toBeInstanceOf(BodyPastCapError);
    expect(read.chunkCount).toBe(0);
  });
});

describe("A request capped at its door", () => {
  const readers: [string, (request: Request) => Promise<unknown>][] = [
    ["text", (request) => request.text()],
    ["json", (request) => request.json()],
    ["arrayBuffer", (request) => request.arrayBuffer()],
    ["formData", (request) => request.formData()],
    ["a copy", (request) => request.clone().text()],
  ];

  it.each(readers)("holds %s to the size, with no size stated", async (_name, reader) => {
    const { stream, read } = endlessBody();
    const capped = cappedRequest(requestWith(stream, { "content-type": "application/x-www-form-urlencoded" }), 32 * 1024);
    await expect(reader(capped)).rejects.toThrow();
    expect(read.chunkCount).toBeLessThanOrEqual(4);
  });

  it("holds a read to a stated size, whatever is sent", async () => {
    const { stream, read } = endlessBody();
    const capped = cappedRequest(requestWith(stream, { "content-length": "10" }), 1024 * 1024);
    await expect(capped.text()).rejects.toThrow();
    expect(read.chunkCount).toBeLessThanOrEqual(2);
  });

  it("counts an encoded body rather than go by the size it states", async () => {
    const { stream, read } = endlessBody();
    const capped = cappedRequest(requestWith(stream, { "content-length": "10", "content-encoding": "gzip" }), 32 * 1024);
    await expect(capped.text()).rejects.toBeInstanceOf(BodyPastCapError);
    expect(read.chunkCount).toBeLessThanOrEqual(4);
  });

  it("leaves a body within the size as it was", async () => {
    expect(await cappedRequest(requestWith("hello"), 5).text()).toBe("hello");
    expect(await cappedRequest(requestWith("hello", { "content-length": "5" }), 5).text()).toBe("hello");
    const form = await cappedRequest(requestWith("a=1", { "content-type": "application/x-www-form-urlencoded" }), 5).formData();
    expect(form.get("a")).toBe("1");
  });

  it("keeps what the request says of itself", () => {
    const capped = cappedRequest(requestWith("hello", { "x-kept": "yes" }), 5);
    expect([capped.method, capped.url, capped.headers.get("x-kept")]).toEqual(["POST", `${SITE}/csp-reports`, "yes"]);
  });

  it("is the same request when there's no body", () => {
    const request = new Request(SITE);
    expect(cappedRequest(request, 5)).toBe(request);
  });

  it("gives a stated size to storage, which takes only those", async () => {
    const capped = cappedRequest(requestWith(new TextEncoder().encode("hello"), { "content-length": "5" }), 5);
    await env.GAMES.put("body-cap/stated-size", capped.body);
    expect(await (await env.GAMES.get("body-cap/stated-size"))!.text()).toBe("hello");
  });
});

describe("The guard's own read", () => {
  it.each(["/oauth/register", "/g/sky-hopper/report"])("stops at the row's size at %s", async (path) => {
    const { stream, read } = endlessBody();
    await guardSiteDoor(requestWith(stream, { "content-type": "application/x-www-form-urlencoded" }, path), env, path);
    // What the row takes, in chunks: nothing is read to find a body too big but the first chunk past it.
    expect(read.chunkCount * CHUNK_SIZE_BYTES).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("refuses a door's JSON past its size with no size stated", async () => {
    const path = "/account/age";
    const { stream, read } = endlessBody();
    const refused = await guardSiteDoor(requestWith(stream, { "content-type": "application/json", origin: SITE }, path), env, path);
    expect(refused?.status === undefined || refused.status >= 300).toBe(true);
    expect(read.chunkCount * CHUNK_SIZE_BYTES).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});

describe("Every door, from outside", () => {
  /** Sent from outside the Worker with no size stated. */
  const sent = (path: string, headers: Record<string, string> = {}, sizeBytes = 8 * 1024 * 1024) => {
    const chunk = new Uint8Array(CHUNK_SIZE_BYTES).fill(0x20);
    let sentSizeBytes = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentSizeBytes >= sizeBytes) return controller.close();
        sentSizeBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    return SELF.fetch(`${SITE}${path}`, { method: "POST", headers: { origin: SITE, ...headers }, body });
  };

  it("answers a report door's body past its size as too big", async () => {
    const answer = await sent("/g/sky-hopper/report", { "content-type": "application/x-www-form-urlencoded" });
    expect(answer.status).toBe(413);
  });

  it("answers a door's bytes past its size without taking them", async () => {
    const answer = await sent("/csp-reports", { "content-type": "application/csp-report" }, 64 * 1024);
    expect(answer.status).toBe(413);
  });

  it("answers an API call's JSON past its own size, with the API's own code", async () => {
    await createAccount(env.DB, { id: "body-cap-emma", username: "Emma_Caps", ageBand: "18+" });
    const answer = await sent("/api/dev/games", { "content-type": "application/json", authorization: "Bearer not-a-key" });
    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
  });

  it("answers an MCP message past its size as too big", async () => {
    const answer = await sent("/mcp", { "content-type": "application/json", authorization: "Bearer not-a-key" }, 9 * 1024 * 1024);
    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
  });
});
