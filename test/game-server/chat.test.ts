import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCheckError, checkChat } from "@zaisma/game-server";
import { OutsideCallError } from "@zaisma/game-server/internal";

/** A pass's look, unsigned: checkChat reads only whose it is and where it's from, and Zaisma checks the rest. */
const passOf = (claims: Record<string, unknown>) => `e30.${btoa(JSON.stringify({ aud: "own-game", iss: "https://rooms.zaisma.com", ...claims })).replace(/=+$/, "")}.signature`;

describe("checkChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the passes and the sender's recent messages to Zaisma, and answers its verdict", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false });
    });
    const sender = passOf({ sub: "player_sender1" });
    const receiver = passOf({ sub: "player_receiver1" });
    await checkChat({ text: "555", senderPass: sender, receiverPasses: [receiver] });
    await checkChat({ text: "123", senderPass: sender, receiverPasses: [receiver] });
    const check = await checkChat({ text: "4567", senderPass: sender, receiverPasses: [receiver] });
    expect(check).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false });
    expect(sent.at(-1)).toEqual({ url: "https://rooms.zaisma.com/v1/chat/check", body: { gameSlug: "own-game", senderPass: sender, receiverPasses: [receiver], text: "4567", recentTexts: ["555", "123"] } });
    // Another sender's messages are their own.
    await checkChat({ text: "hi", senderPass: passOf({ sub: "player_sender2" }), receiverPasses: [receiver] });
    expect(sent.at(-1)!.body.recentTexts).toEqual([]);
  });

  it("answers unchecked when Zaisma can't be reached, or the pass isn't Zaisma's", async () => {
    const unchecked = { isAllowed: false, reason: "unchecked", message: "This message couldn't be checked. Try again in a moment.", hasSwearing: false };
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("fetch failed")));
    expect(await checkChat({ text: "gg", senderPass: passOf({ sub: "player_sender3" }), receiverPasses: [] })).toEqual(unchecked);
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    expect(await checkChat({ text: "gg", senderPass: passOf({ sub: "player_sender3" }), receiverPasses: [] })).toEqual(unchecked);
    // A made-up pass can't send players' messages anywhere else.
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (asked.push(url), Response.json({ isAllowed: true, reason: null, message: null, hasSwearing: false })));
    expect(await checkChat({ text: "gg", senderPass: passOf({ sub: "player_sender4", iss: "https://evil.example" }), receiverPasses: [] })).toEqual(unchecked);
    expect(asked).toEqual([]);
  });

  it("refuses a message over 2000 characters as too_long, without cutting or sending it", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => (asked.push(url), Response.json({ isAllowed: true, reason: null, message: null, hasSwearing: false })));
    expect(await checkChat({ text: "a".repeat(2001), senderPass: passOf({ sub: "player_sender6" }), receiverPasses: [] })).toEqual({ isAllowed: false, reason: "too_long", message: "That message is too long to send.", hasSwearing: false });
    expect(asked).toEqual([]);
    expect((await checkChat({ text: "a".repeat(2000), senderPass: passOf({ sub: "player_sender6" }), receiverPasses: [] })).isAllowed).toBe(true);
  });

  it("refuses in Zaisma rooms, where the room filters chat itself", async () => {
    // The gateway refuses a call to Zaisma's own address, which the sandbox's fetch turns into an OutsideCallError.
    vi.stubGlobal("fetch", async () => {
      throw new OutsideCallError("host_not_allowed", "That host isn't allowed.", "Call your own server.");
    });
    const refused = await checkChat({ text: "gg", senderPass: passOf({ sub: "player_sender5" }), receiverPasses: [] }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ChatCheckError);
    expect(refused).toMatchObject({ code: "own_server_only", fix: expect.stringContaining("Zaisma.filterText") });
  });
});
