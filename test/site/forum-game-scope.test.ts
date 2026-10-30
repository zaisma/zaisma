import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, createGame, personOwner } from "@zaisma/core";
import { errorProblems } from "../schema-check.ts";

const SITE = "https://zaisma.test";

let token = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, init: { body?: unknown; key?: string } = {}): Promise<{ status: number; data: any }> {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.body ? "POST" : "GET",
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) expect(errorProblems(data, res.status)).toEqual([]);
  return { status: res.status, data };
}

const imageAt = async (topicId: string, imageId: string, key: string) => (await SELF.fetch(`${SITE}/api/dev/forum/${topicId}/media/${imageId}`, { headers: { authorization: `Bearer ${key}` } })).status;

const PNG = (() => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 400);
  new DataView(bytes.buffer).setUint32(20, 300);
  return btoa(String.fromCharCode(...bytes));
})();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM forum_posts; DELETE FROM forum_topic_tags; DELETE FROM forum_topics; DELETE FROM forum_media; DELETE FROM forum_search");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
});

describe("a key limited to some games", () => {
  it("lists, searches and fetches images of only those games' topics", async () => {
    const owner = await personOwner(env.DB, "dev-1");
    for (const slug of ["game-a", "game-b"]) await createGame(env.DB, { slug, title: slug, description: "", ownerId: owner.id, visibility: "draft" });
    const limited = (await createApiKey(env.DB, "dev-1", "only-a", { accessLevel: "full", gameSlugs: ["game-a"] })).token;
    const topicAbout = async (gameSlug: string) => {
      const { data } = await api("/forum", { body: { is_public: false, kind: "question", title: `About ${gameSlug}`, text_markdown: "How?", game_slug: gameSlug, images_base64: [PNG] } });
      return { topic: data.topic.id as string, image: data.posts[0].media[0].id as string };
    };
    const aboutB = await topicAbout("game-b");
    const aboutA = await topicAbout("game-a");

    const listed = async (key: string, query: string) => ((await api(`/forum?tab=messages${query}`, { key })).data.topics as { id: string }[]).map((topic) => topic.id);
    expect(await listed(limited, "")).toEqual([aboutA.topic]);
    expect(await listed(limited, "&search_text=About")).toEqual([aboutA.topic]);
    expect(await listed(token, "")).toContain(aboutB.topic);

    expect(await imageAt(aboutA.topic, aboutA.image, limited)).toBe(200);
    expect(await imageAt(aboutB.topic, aboutB.image, limited)).toBe(403);
    // An image of another topic, asked for through an allowed one.
    expect(await imageAt(aboutA.topic, aboutB.image, limited)).toBe(404);
    expect(await imageAt(aboutB.topic, aboutB.image, token)).toBe(200);
  });
});
