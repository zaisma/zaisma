import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { addComment, changeComment, listComments, publicComment, readComment, replyToComment } from "../../scripts/preview/feedback-store.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { cookiesFromHeader } from "../../scripts/preview/feedback-pictures.mjs";

/**
 * The preview's feedback comments (scripts/preview/feedback-store.mjs): what the overlay sends is closed to the comment's fields,
 * a session's reply marks it unread, Julius's reply opens a closed one again, and the sign-in cookie never leaves the file.
 */

let directory = "";
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "preview-feedback-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

const sent = {
  page_url: "/signin",
  viewport_width_px: 320,
  viewport_height_px: 667,
  scroll_x_px: 0,
  scroll_y_px: 140.6,
  theme: "light",
  box: { left_px: 16, top_px: 300, width_px: 288, height_px: 44 },
  component: "Button",
  layout_rule: "Row: matched heights",
  element_class: "button primary",
  element_text: "Sign in",
  text: "Too close to the edge",
};

describe("preview feedback comments", () => {
  it("keeps only the comment's own fields, rounded, and starts open", () => {
    const { comment } = addComment({ ...sent, is_admin: true, status: "closed" }, { directory, signInCookieHeader: "zaisma_session=abc", nowMs: 1000 });
    expect(comment.comment_id).toMatch(/^comment_[a-z0-9]{12}$/);
    expect(comment).toMatchObject({ page_url: "/signin", is_in_frame: false, scroll_y_px: 141, theme: "light", status: "open", replies: [], is_reply_unread: false, created_at_ms: 1000 });
    expect(comment).not.toHaveProperty("is_admin");
    expect(readComment(comment.comment_id, directory)).toEqual(comment);
  });

  it("refuses a comment with no words, or a page that isn't a path on the site", () => {
    expect(addComment({ ...sent, text: "  " }, { directory }).error).toMatchObject({ code: "missing_text", field: "text" });
    expect(addComment({ ...sent, page_url: "https://example.com/" }, { directory }).error).toMatchObject({ code: "invalid_page_url", field: "page_url" });
    expect(listComments({ directory })).toEqual([]);
  });

  it("marks a session's reply unread, and Julius's reply opens a closed comment again", () => {
    const { comment } = addComment(sent, { directory });
    expect(replyToComment(comment.comment_id, "session", "Moved it in to the pane's margin.", { directory, nowMs: 2000 }).comment).toMatchObject({ is_reply_unread: true, replies: [{ author: "session", text: "Moved it in to the pane's margin.", created_at_ms: 2000 }] });
    expect(changeComment(comment.comment_id, { status: "closed", is_reply_unread: false }, { directory }).comment).toMatchObject({ status: "closed", is_reply_unread: false });
    expect(replyToComment(comment.comment_id, "reviewer", "Still tight on dark", { directory }).comment).toMatchObject({ status: "open", is_reply_unread: false });
    expect(replyToComment("comment_aaaaaaaaaaaa", "session", "Hi", { directory }).error).toMatchObject({ code: "comment_not_found" });
  });

  it("lists oldest first, open ones alone when asked", () => {
    const first = addComment(sent, { directory, nowMs: 1 }).comment;
    const second = addComment({ ...sent, text: "Second" }, { directory, nowMs: 2 }).comment;
    changeComment(first.comment_id, { status: "closed" }, { directory });
    expect(listComments({ directory }).map((comment: { comment_id: string }) => comment.comment_id)).toEqual([first.comment_id, second.comment_id]);
    expect(listComments({ directory, status: "open" }).map((comment: { comment_id: string }) => comment.comment_id)).toEqual([second.comment_id]);
  });

  it("keeps what he did before commenting, closed to each kind's fields, the last 40 only", () => {
    const moves = Array.from({ length: 45 }, (_, index) => ({ kind: "move", at_ms: index * 10, x_px: index, y_px: 5.4, pointer_type: "mouse", button: 2 }));
    const { comment } = addComment({ ...sent, is_page_comment: true, recent_actions: [...moves, { kind: "key", at_ms: 500, key: "Enter", x_px: 3 }, { kind: "key", at_ms: 510 }, { kind: "wave" }, { kind: "scroll", at_ms: 520, scroll_x_px: 0, scroll_y_px: 300 }, { kind: "press", at_ms: 530, x_px: 10, y_px: 20, pointer_type: "pen", element_label: "Cut button" }] }, { directory });
    expect(comment.is_page_comment).toBe(true);
    expect(comment.recent_actions).toHaveLength(40);
    expect(comment.recent_actions.at(-4)).toEqual({ kind: "move", at_ms: 440, x_px: 44, y_px: 5, pointer_type: "mouse", element_label: "" });
    expect(comment.recent_actions.slice(-3)).toEqual([
      { kind: "key", at_ms: 500, key: "Enter", element_label: "" },
      { kind: "scroll", at_ms: 520, scroll_x_px: 0, scroll_y_px: 300, element_label: "" },
      { kind: "press", at_ms: 530, x_px: 10, y_px: 20, pointer_type: "mouse", element_label: "Cut button" },
    ]);
    expect(addComment(sent, { directory }).comment).toMatchObject({ is_page_comment: false, recent_actions: [] });
  });

  it("keeps the sign-in cookie out of what the page and the command show", () => {
    const { comment } = addComment(sent, { directory, signInCookieHeader: "zaisma_session=abc" });
    expect(comment.sign_in_cookie_header).toBe("zaisma_session=abc");
    expect(publicComment(comment)).not.toHaveProperty("sign_in_cookie_header");
  });

  it("turns the page's cookies into Chrome's, __Host- ones secure", () => {
    expect(cookiesFromHeader("zaisma_in=1; __Host-zaisma_session=a=b", "http://localhost:8800")).toEqual([
      { name: "zaisma_in", value: "1", url: "http://localhost:8800", path: "/" },
      { name: "__Host-zaisma_session", value: "a=b", url: "http://localhost:8800", path: "/", secure: true },
    ]);
    expect(cookiesFromHeader(null, "http://localhost:8800")).toEqual([]);
  });
});
