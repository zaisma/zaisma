import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BodyPastCapError, cappedRequest, createAccount, createApiKey, FILE_LIMITS, formOf, IMAGE_LIMITS, readBodyBytes, readBodyText, ZIP_LIMITS } from "@zaisma/core";
import { siteDoorAt, type SiteDoor } from "../../apps/site/src/doors.ts";
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
    const request = cappedRequest(requestWith(stream, { "content-type": "application/x-www-form-urlencoded" }, path), 4 * 1024 * 1024);
    const refused = await guardSiteDoor(request, env, path);
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

describe("A form, read once", () => {
  const REPORT_PATH = "/g/sky-hopper/report";
  /** A report's form with its picture, which says how many copies of itself were asked for. */
  const reportForm = (picture: Uint8Array, names: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("picture", new File([picture], "picture.png", { type: "image/png" }));
    for (const [name, value] of Object.entries(names)) form.set(name, value);
    const request = new Request(`${SITE}${REPORT_PATH}`, { method: "POST", body: form });
    const copies = { count: 0 };
    const clone = request.clone.bind(request);
    request.clone = () => {
      copies.count += 1;
      return clone();
    };
    return { request, copies };
  };

  it("takes no copy of a file form, and hands the door the form it read", async () => {
    const picture = new Uint8Array(64 * 1024).fill(7);
    const { request, copies } = reportForm(picture);
    expect(await guardSiteDoor(request, env, REPORT_PATH)).toBeNull();
    expect(copies.count).toBe(0);
    const file = (await formOf(request)).get("picture") as unknown as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(picture);
    expect(await formOf(request)).toBe(await formOf(request));
  });

  it("still refuses a name the door doesn't take, without a copy", async () => {
    const { request, copies } = reportForm(new Uint8Array(16), { no_such_field: "x" });
    expect((await guardSiteDoor(request, env, REPORT_PATH))?.status).toBe(400);
    expect(copies.count).toBe(0);
  });

  it("takes an empty form, and refuses one it can't read", async () => {
    const empty = new Request(`${SITE}${REPORT_PATH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(await guardSiteDoor(empty, env, REPORT_PATH)).toBeNull();
    const broken = new Request(`${SITE}${REPORT_PATH}`, { method: "POST", headers: { "content-type": "multipart/form-data" }, body: "not a form" });
    expect((await guardSiteDoor(broken, env, REPORT_PATH))?.status).toBe(400);
  });

  it("reads a signed-out caller's form once too", async () => {
    const path = "/account/social";
    const request = new Request(`${SITE}${path}`, { method: "POST", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "next=%2Ffriends" });
    request.clone = () => {
      throw new Error("a copy");
    };
    const refused = await guardSiteDoor(request, { ...env, SUPABASE_URL: "https://supabase.test", SUPABASE_SECRET_KEY: "key" }, path);
    expect(refused?.headers.get("location")).toBe("/signin?next=%2Ffriends");
  });
});

describe("What each file door takes", () => {
  const FIELDS_SIZE_BYTES = 256 * 1024;
  const rowOf = (path: string, method = "POST") => siteDoorAt(path, method) as SiteDoor;
  const sizeOf = (path: string, method?: string) => rowOf(path, method).contract.takes.body?.maximumSizeBytes;
  const fileNamesOf = (path: string) => {
    const body = rowOf(path).contract.takes.body;
    return body?.kind === "form" ? (body.fileNames ?? []) : [];
  };

  it.each([
    ["/dashboard/sky-hopper/images", ["file"], IMAGE_LIMITS.maximumSizeBytes],
    ["/dashboard/sky-hopper/backgrounds", ["file"], IMAGE_LIMITS.maximumSizeBytes],
    ["/forum/media", ["file"], 5 * 1024 * 1024],
    ["/admin/upload", ["zip"], ZIP_LIMITS.maximumZipSizeBytes],
    ["/admin/api/games", ["zip"], ZIP_LIMITS.maximumZipSizeBytes],
  ])("%s takes its file and the form's fields", (path, fileNames, fileSizeBytes) => {
    expect(fileNamesOf(path)).toEqual(fileNames);
    expect(sizeOf(path)).toBe(fileSizeBytes + FIELDS_SIZE_BYTES);
  });

  it.each(["/dashboard/new", "/dashboard/sky-hopper/details", "/dashboard/sky-hopper/delete", "/forum/new", "/forum/messages/new", "/forum/topic_abc/reply", "/forum/topic_abc/vote", "/forum/preview", "/admin/versions/version_abc/approve", "/admin/precedents"])("%s takes fields and no file", (path) => {
    expect(fileNamesOf(path)).toEqual([]);
    expect(sizeOf(path)).toBe(FIELDS_SIZE_BYTES);
  });

  it("leaves a big build's whole files and parts their room, on the doors the upload command uses", () => {
    for (const [method, path] of [["PUT", "/api/dev/files/abc"], ["PUT", "/api/dev/files/abc/parts/1"]] as const) {
      expect(sizeOf(path, method)).toBeGreaterThanOrEqual(FILE_LIMITS.maximumDirectSizeBytes);
      expect(sizeOf(path, method)).toBeGreaterThanOrEqual(FILE_LIMITS.partSizeBytes);
    }
    expect(sizeOf("/api/dev/files/abc", "PUT")).toBe(110 * 1024 * 1024);
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

  it("says how much a page's form takes", async () => {
    const report = await SELF.fetch(`${SITE}/g/sky-hopper/report`, { method: "POST", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded", "content-length": String(5 * 1024 * 1024) }, body: new Uint8Array(5 * 1024 * 1024) });
    expect(report.status).toBe(413);
    expect(await report.text()).toContain("This form takes up to 4 MB.");
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
