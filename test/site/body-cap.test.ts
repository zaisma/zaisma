import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BodyPastCapError, cappedRequest, createAccount, createApiKey, readBodyBytes, readBodyText } from "@zaisma/core";
import { guardSiteDoor } from "../../apps/site/src/guard.ts";
import { letPublish } from "../helpers.ts";

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

const requestWith = (body: BodyInit, headers: Record<string, string> = {}, path = "/csp-reports") => new Request(`${SITE}${path}`, { method: "POST", headers, body });

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

  it("counts an encoded body", async () => {
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
  it("stops at a form door's size, with no size stated", async () => {
    const path = "/g/sky-hopper/report";
    const { stream, read } = endlessBody();
    const refused = await guardSiteDoor(requestWith(stream, { "content-type": "application/x-www-form-urlencoded" }, path), env, path);
    expect(refused?.status).toBe(413);
    expect((read.chunkCount - 2) * CHUNK_SIZE_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("stops at a JSON door's size, with no size stated", async () => {
    const path = "/api/plays/sky-hopper/account";
    const { stream, read } = endlessBody();
    const refused = await guardSiteDoor(requestWith(stream, { "content-type": "application/json" }, path), env, path);
    expect(refused?.status).toBe(413);
    expect(read.chunkCount).toBeLessThanOrEqual(3);
  });
});

describe("Every door, from outside", () => {
  /** Sent from outside the Worker with no size stated. */
  const sent = (path: string, headers: Record<string, string>, sizeBytes: number) => {
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
  const bearer = async (accountId: string) => {
    await createAccount(env.DB, { id: accountId, username: `Emma_${accountId.length}`, ageBand: "18+" });
    await letPublish(env.DB, accountId);
    return { authorization: `Bearer ${(await createApiKey(env.DB, accountId, "laptop")).token}`, "content-type": "application/json" };
  };

  it("answers a form door's body past its size as too big", async () => {
    expect((await sent("/g/sky-hopper/report", { "content-type": "application/x-www-form-urlencoded" }, 5 * 1024 * 1024)).status).toBe(413);
  });

  it("answers a raw door's body past its size as too big", async () => {
    const answer = await sent("/github/secret-scanning", { "github-public-key-identifier": "key", "github-public-key-signature": "signature" }, 2 * 1024 * 1024);
    expect(answer.status).toBe(413);
  });

  it("answers an API call's JSON past its own size with the API's code", async () => {
    const answer = await sent("/api/dev/games", await bearer("body-cap-api"), 256 * 1024);
    expect(answer.status).toBe(413);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe("json_too_big");
  });

  it("answers an MCP message past its size as too big", async () => {
    expect((await sent("/mcp", await bearer("body-cap-mcp-key"), 9 * 1024 * 1024)).status).toBe(413);
  });
});
