import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { currentAnnouncement } from "../../apps/site/src/announcements.ts";
import { PUBLIC_ANNOUNCEMENT_LIST } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

/** Announcements: posted, listed and ended through the admin MCP, shown on the home and at GET /api/announcements. */

const LOCAL = "http://localhost";
const DAY_MS = 86400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

/** Call an admin MCP tool: every answer matches its output schema, and every error the error's shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await SELF.fetch(`${LOCAL}/admin/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const { result } = (await response.json()) as { result: { content: { text: string }[]; isError?: boolean; structuredContent: { error: { message: string; fix: string; code: string } } } };
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    const { message, fix, code } = result.structuredContent.error;
    expect(result.content[0]!.text).toBe(`${message} ${fix} (${code})`);
  } else {
    expect(schemaProblems(ADMIN_TOOLS.find((candidate) => candidate.name === name)!.outputSchema, result.structuredContent, name)).toEqual([]);
  }
  return result;
}
const data = async (name: string, args: Record<string, unknown> = {}) => (await tool(name, args)).structuredContent;
const refusal = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await tool(name, args);
  expect(result.isError).toBe(true);
  return result.structuredContent.error;
};
const publicList = async () => {
  const response = await SELF.fetch(`${LOCAL}/api/announcements`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  const answer = await response.json();
  expect(schemaProblems(PUBLIC_ANNOUNCEMENT_LIST, answer, "GET /api/announcements")).toEqual([]);
  return answer as { announcements: { id: string; text: string; link_url: string | null; link_label: string | null; starts_at: string; ends_at: string }[] };
};

beforeEach(async () => {
  await env.DB.exec("DELETE FROM announcements; DELETE FROM audit_log;");
});

describe("announcements", () => {
  it("are posted, listed, shown on the home and ended", async () => {
    expect(await currentAnnouncement(env)).toBeNull();
    expect((await publicList()).announcements).toEqual([]);

    const first = await data("post_announcement", { text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", link_url: "/forum", ends_at: inDays(14) });
    expect(first.announcement).toMatchObject({ text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", link_url: "/forum", link_label: "Read more", announcement_status: "current", is_shown: true });
    expect(first.announcement.id).toMatch(/^announcement_[a-z0-9]{20}$/);
    expect(first.next_steps).toEqual([{ tool: "list_announcements", arguments: {}, after_sec: null, reason: expect.any(String) }]);

    // A newer one replaces what's showing; one still to start doesn't show yet.
    const second = await data("post_announcement", { text: "Cloud saves now keep 30 days of copies.", link_url: "https://zaisma.com/forum", link_label: "See how", ends_at: inDays(7) });
    const upcoming = await data("post_announcement", { text: "Something new next week.", starts_at: inDays(3), ends_at: inDays(10) });
    expect(upcoming.announcement).toMatchObject({ announcement_status: "upcoming", is_shown: false, link_url: null, link_label: null });

    expect(await currentAnnouncement(env)).toEqual({ id: second.announcement.id, text: "Cloud saves now keep 30 days of copies.", link_url: "https://zaisma.com/forum", link_label: "See how" });
    const listed = await data("list_announcements");
    expect(listed.announcements.map((announcement: { id: string }) => announcement.id)).toEqual([upcoming.announcement.id, second.announcement.id, first.announcement.id]);
    expect(listed.announcements.map((announcement: { is_shown: boolean }) => announcement.is_shown)).toEqual([false, true, false]);
    expect((await publicList()).announcements.map((announcement) => announcement.id)).toEqual([second.announcement.id, first.announcement.id]);

    // Ending the shown one brings back the one before it, and it stays listed as ended.
    const ended = await data("end_announcement", { announcement_id: second.announcement.id });
    expect(ended.announcement).toMatchObject({ id: second.announcement.id, announcement_status: "ended", is_shown: false });
    expect(ended.next_steps).toHaveLength(1);
    expect((await currentAnnouncement(env))?.id).toBe(first.announcement.id);
    expect((await publicList()).announcements).toEqual([{ id: first.announcement.id, text: first.announcement.text, link_url: "/forum", link_label: "Read more", starts_at: first.announcement.starts_at, ends_at: first.announcement.ends_at }]);
    expect((await data("list_announcements")).announcements.find((announcement: { id: string }) => announcement.id === second.announcement.id).announcement_status).toBe("ended");
    expect((await refusal("end_announcement", { announcement_id: second.announcement.id })).code).toBe("announcement_ended");

    const { results } = await env.DB.prepare("SELECT action, actor FROM audit_log ORDER BY id").all<{ action: string }>();
    expect(results.map((row) => row.action)).toEqual(["announcement-posted", "announcement-posted", "announcement-posted", "announcement-ended"]);
  });

  it("refuse what they don't take", async () => {
    const ends_at = inDays(5);
    expect((await refusal("post_announcement", { text: "x".repeat(201), ends_at })).code).toBe("bad_text");
    expect((await refusal("post_announcement", { text: "  ", ends_at })).code).toBe("bad_text");
    expect((await refusal("post_announcement", { text: "<b>New</b> things.", ends_at })).code).toBe("bad_text");
    expect((await refusal("post_announcement", { text: "One. Two. Three.", ends_at })).code).toBe("bad_text");
    expect((await refusal("post_announcement", { text: "Read https://example.com now.", ends_at })).code).toBe("bad_text");
    expect(await refusal("post_announcement", { text: "New things.", link_label: "See more", ends_at })).toMatchObject({ code: "bad_link_label", field: "link_label" });
    expect((await refusal("post_announcement", { text: "New things.", link_url: "/forum", link_label: "x".repeat(31), ends_at })).code).toBe("bad_link_label");
    for (const link_url of ["http://example.com", "javascript:alert(1)", "//evil.example", "forum"]) {
      expect((await refusal("post_announcement", { text: "New things.", link_url, ends_at })).code, link_url).toBe("bad_link_url");
    }
    expect(await refusal("post_announcement", { text: "New things.", starts_at: inDays(3), ends_at: inDays(2) })).toMatchObject({ code: "bad_time", field: "ends_at" });
    expect(await refusal("post_announcement", { text: "New things.", ends_at: inDays(61) })).toMatchObject({ code: "bad_time", field: "ends_at" });
    expect(await refusal("post_announcement", { text: "New things.", ends_at: inDays(-1) })).toMatchObject({ code: "bad_time", field: "ends_at" });
    expect(await refusal("post_announcement", { text: "New things.", ends_at: "tomorrow" })).toMatchObject({ code: "bad_time", field: "ends_at" });
    expect(await refusal("post_announcement", { text: "New things.", ends_at: 1792012345678 })).toMatchObject({ code: "bad_time", field: "ends_at" });
    expect(await refusal("post_announcement", { text: "New things.", starts_at: inDays(-2), ends_at })).toMatchObject({ code: "bad_time", field: "starts_at" });
    expect((await refusal("post_announcement", { text: "New things." })).code).toBe("missing_field");
    expect((await refusal("post_announcement", { text: "New things.", ends_at, link: "/forum" })).code).toBe("unknown_field");
    expect(await refusal("end_announcement", { announcement_id: "topic_8f3k2m9q1x7c4v6b0n5z" })).toMatchObject({ code: "wrong_id_kind", field: "announcement_id" });
    expect((await refusal("end_announcement", { announcement_id: "announcement_8f3k2m9q1x7c4v6b0n5z" })).code).toBe("no_announcement");
    expect((await data("list_announcements")).announcements).toEqual([]);
  });

  it("answer only GET at the public route", async () => {
    expect((await SELF.fetch(`${LOCAL}/api/announcements`, { method: "POST", headers: { Origin: LOCAL } })).status).toBe(405);
  });
});
