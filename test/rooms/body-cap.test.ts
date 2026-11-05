import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// A room door's body is read up to what its row takes, with no size stated too.

const ROOMS = "https://rooms.zaisma.test";

/** A body in chunks, with no size stated. */
function bodyOf(sizeBytes: number) {
  const chunk = new Uint8Array(16 * 1024).fill(0x20);
  let sentSizeBytes = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sentSizeBytes >= sizeBytes) return controller.close();
      sentSizeBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

describe("A room door's body", () => {
  it("is refused past the row's size", async () => {
    const answer = await SELF.fetch(`${ROOMS}/v1/filter`, { method: "POST", headers: { "Content-Type": "text/plain", "cf-connecting-ip": "198.51.100.200" }, body: bodyOf(512 * 1024) });
    expect(answer.status).toBe(413);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe("too_big");
  });

  it("is read within the row's size", async () => {
    const answer = await SELF.fetch(`${ROOMS}/v1/filter`, { method: "POST", headers: { "Content-Type": "text/plain", "cf-connecting-ip": "198.51.100.201" }, body: bodyOf(16 * 1024) });
    expect(answer.status).toBe(400);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });
});
