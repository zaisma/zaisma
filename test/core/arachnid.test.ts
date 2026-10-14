import { describe, expect, it } from "vitest";
import { KNOWN_IMAGE_RULE, arachnidShield, type ImageForMatching } from "@zaisma/core";

const image = (path: string, text = path): ImageForMatching => ({ path, type: "image/png", load: async () => new TextEncoder().encode(text) });

/** A stand-in for Arachnid Shield: answers each picture by its contents, and records what it was sent. */
function shield(answer: (body: string) => Response | Promise<Response>) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = new TextDecoder().decode(init!.body as Uint8Array);
    calls.push({ url: String(input), headers: new Headers(init!.headers), body });
    return answer(body);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const clear = () => json({ classification: "no-known-match", match_type: null, near_match_details: [] });
const noWait = async () => {};

describe("Arachnid Shield image matching", () => {
  it("sends each picture with the API user's sign-in and passes clean ones", async () => {
    const s = shield(clear);
    const result = await arachnidShield("user:secret", { fetch: s.fetch }).check([image("a.png"), image("b.png")]);
    expect(result).toEqual({ provider: "arachnid-shield", connected: true, checked: 2, findings: [] });
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]!.url).toBe("https://shield.projectarachnid.com/v1/media/");
    expect(s.calls[0]!.headers.get("authorization")).toBe(`Basic ${btoa("user:secret")}`);
    expect(s.calls[0]!.headers.get("content-type")).toBe("image/png");
  });

  it("sends the same picture once, however many names it has", async () => {
    const s = shield(clear);
    const result = await arachnidShield("u:p", { fetch: s.fetch }).check([image("a.png", "same"), image("b/c.png", "same"), image("d.png")]);
    expect(s.calls).toHaveLength(2);
    expect(result.checked).toBe(3);
  });

  it("flags every name of a picture that matches known abuse material", async () => {
    const s = shield((body) => (body === "bad" ? json({ classification: "csam", match_type: "near", near_match_details: [] }) : clear()));
    const result = await arachnidShield("u:p", { fetch: s.fetch, baseUrl: "https://shield.test/" }).check([image("ok.png"), image("x.png", "bad"), image("y.png", "bad")]);
    expect(s.calls[0]!.url).toBe("https://shield.test/v1/media/");
    const known = result.findings.filter((f) => f.rule === KNOWN_IMAGE_RULE);
    expect(known.map((f) => f.path).sort()).toEqual(["x.png", "y.png"]);
    expect(known[0]).toMatchObject({ stage: "images", severity: "hold" });
    expect(known[0]!.detail).toMatch(/known child sexual abuse material \(a visual match\)/);
    expect(result.checked).toBe(3);
  });

  it("flags harmful material and classifications it doesn't know yet", async () => {
    const s = shield((body) => json({ classification: body === "h" ? "harmful-abusive-material" : "something-new", match_type: "exact" }));
    const result = await arachnidShield("u:p", { fetch: s.fetch }).check([image("h.png", "h"), image("n.png", "n")]);
    expect(result.findings.map((f) => f.rule)).toEqual([KNOWN_IMAGE_RULE, KNOWN_IMAGE_RULE]);
    expect(result.findings.map((f) => f.detail).join(" ")).toMatch(/harmful or abusive material.*the exact file/);
    expect(result.findings.map((f) => f.detail).join(" ")).toMatch(/classified "something-new"/);
  });

  it("stops and holds when the sign-in is turned down", async () => {
    const s = shield(() => json({ detail: "Invalid username/password." }, 401));
    const result = await arachnidShield("u:wrong", { fetch: s.fetch }).check(Array.from({ length: 10 }, (_, i) => image(`${i}.png`)));
    expect(s.calls.length).toBeLessThanOrEqual(4);
    expect(result.checked).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "image-matching-failed", severity: "hold" });
    expect(result.findings[0]!.detail).toMatch(/ARACHNID_SHIELD_KEY/);
  });

  it("tries again when Shield is busy, and holds if it stays down", async () => {
    let n = 0;
    const flaky = shield(() => (n++ === 0 ? new Response("busy", { status: 503 }) : clear()));
    expect((await arachnidShield("u:p", { fetch: flaky.fetch, wait: noWait }).check([image("a.png")])).findings).toEqual([]);
    expect(flaky.calls).toHaveLength(2);

    const down = shield(() => new Response("down", { status: 502 }));
    const result = await arachnidShield("u:p", { fetch: down.fetch, wait: noWait }).check([image("a.png")]);
    expect(down.calls).toHaveLength(3);
    expect(result.findings).toEqual([expect.objectContaining({ rule: "image-matching-failed", severity: "hold" })]);
    expect(result.findings[0]!.detail).toMatch(/didn't answer/);
  });

  it("holds a picture Shield can't read, and checks the rest", async () => {
    const s = shield((body) => (body === "odd" ? json({ detail: "Unsupported media type." }, 415) : clear()));
    const result = await arachnidShield("u:p", { fetch: s.fetch }).check([image("odd.webp", "odd"), image("fine.png")]);
    expect(result.checked).toBe(1);
    expect(result.findings).toEqual([expect.objectContaining({ rule: "image-matching-failed", path: "odd.webp" })]);
    expect(result.findings[0]!.detail).toMatch(/415: Unsupported media type/);
  });

  it("holds an answer without a classification rather than passing it", async () => {
    const s = shield(() => json({ classification: null }));
    const result = await arachnidShield("u:p", { fetch: s.fetch }).check([image("a.png")]);
    expect(result.findings).toEqual([expect.objectContaining({ rule: "image-matching-failed" })]);
  });
});
