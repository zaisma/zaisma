// The preview's feedback comments, one JSON file each in .wrangler/preview-feedback/ (outside .wrangler/preview, so
// npm run preview -- --reset keeps them), shared by the feedback server (feedback-server.mjs) and the command a session
// runs when Julius says he left feedback (scripts/feedback.mjs). One file a comment, written whole through a rename, so
// the two never write over each other. Pictures sit beside each comment: <comment_id>.seen.png (drawn from the page as
// he saw it) and <comment_id>.live.png (the page loaded again).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const FEEDBACK_DIRECTORY = join(ROOT, ".wrangler/preview-feedback");

const COMMENT_ID_PATTERN = /^comment_[a-z0-9]{12}$/;
const ID_LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789";
export const MAXIMUM_TEXT_LENGTH = 4000;

export const isCommentId = (value) => typeof value === "string" && COMMENT_ID_PATTERN.test(value);

function newCommentId() {
  return `comment_${[...randomBytes(12)].map((byte) => ID_LETTERS[byte % ID_LETTERS.length]).join("")}`;
}

const commentFile = (directory, commentId) => join(directory, `${commentId}.json`);
export const pictureFile = (directory, commentId, kind) => join(directory, `${commentId}.${kind}.png`);
export const snapshotFile = (directory, commentId) => join(directory, `${commentId}.html`);

function writeWhole(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

export function readComment(commentId, directory = FEEDBACK_DIRECTORY) {
  if (!isCommentId(commentId) || !existsSync(commentFile(directory, commentId))) return null;
  return JSON.parse(readFileSync(commentFile(directory, commentId), "utf8"));
}

function writeComment(comment, directory) {
  writeWhole(commentFile(directory, comment.comment_id), JSON.stringify(comment, null, 2));
  return comment;
}

/** Every comment, oldest first; with status "open" or "closed", only those. */
export function listComments({ status, directory = FEEDBACK_DIRECTORY } = {}) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")))
    .filter((comment) => !status || comment.status === status)
    .sort((a, b) => a.created_at_ms - b.created_at_ms);
}

const integer = (value) => (Number.isFinite(value) ? Math.round(value) : 0);
const text = (value, length) => (typeof value === "string" ? value.slice(0, length) : "");

/** A new comment from what the overlay sent: closed to the fields below, the rest dropped. */
export function addComment(input, { signInCookieHeader = null, directory = FEEDBACK_DIRECTORY, nowMs = Date.now() } = {}) {
  const commentText = text(input.text, MAXIMUM_TEXT_LENGTH).trim();
  if (!commentText) return { error: { code: "missing_text", field: "text", message: "A comment needs some words." } };
  const pageUrl = text(input.page_url, 2000);
  if (!pageUrl.startsWith("/")) return { error: { code: "invalid_page_url", field: "page_url", message: "page_url is the page's path on the site, starting with /." } };
  const box = input.box ?? {};
  return {
    comment: writeComment(
      {
        comment_id: newCommentId(),
        page_url: pageUrl,
        is_in_frame: input.is_in_frame === true,
        viewport_width_px: integer(input.viewport_width_px),
        viewport_height_px: integer(input.viewport_height_px),
        scroll_x_px: integer(input.scroll_x_px),
        scroll_y_px: integer(input.scroll_y_px),
        theme: input.theme === "light" ? "light" : "dark",
        box: { left_px: integer(box.left_px), top_px: integer(box.top_px), width_px: Math.max(1, integer(box.width_px)), height_px: Math.max(1, integer(box.height_px)) },
        component: text(input.component, 200) || null,
        layout_rule: text(input.layout_rule, 500) || null,
        element_class: text(input.element_class, 300),
        element_text: text(input.element_text, 80),
        text: commentText,
        status: "open",
        replies: [],
        is_reply_unread: false,
        sign_in_cookie_header: signInCookieHeader,
        created_at_ms: nowMs,
      },
      directory,
    ),
  };
}

/** A reply on a comment, from Julius on the page (reviewer) or from a session (session); his reply opens a closed one again. */
export function replyToComment(commentId, author, replyText, { directory = FEEDBACK_DIRECTORY, nowMs = Date.now() } = {}) {
  const comment = readComment(commentId, directory);
  if (!comment) return { error: { code: "comment_not_found", field: "comment_id", message: `There's no comment ${commentId}. npm run feedback lists them.` } };
  const cleanText = text(replyText, MAXIMUM_TEXT_LENGTH).trim();
  if (!cleanText) return { error: { code: "missing_text", field: "text", message: "A reply needs some words." } };
  comment.replies.push({ author, text: cleanText, created_at_ms: nowMs });
  comment.is_reply_unread = author === "session";
  if (author === "reviewer") comment.status = "open";
  return { comment: writeComment(comment, directory) };
}

/** Julius closes or opens a comment, and marks its replies read, from the page. Sessions never close one. */
export function changeComment(commentId, change, { directory = FEEDBACK_DIRECTORY } = {}) {
  const comment = readComment(commentId, directory);
  if (!comment) return { error: { code: "comment_not_found", field: "comment_id", message: `There's no comment ${commentId}.` } };
  if (change.status === "open" || change.status === "closed") comment.status = change.status;
  if (change.is_reply_unread === false) comment.is_reply_unread = false;
  return { comment: writeComment(comment, directory) };
}

/** A comment as the page and the command show it: everything but the sign-in cookie. */
export function publicComment(comment) {
  const { sign_in_cookie_header: _cookie, ...shown } = comment;
  return shown;
}

export function writePicture(commentId, kind, bytes, directory = FEEDBACK_DIRECTORY) {
  writeWhole(pictureFile(directory, commentId, kind), bytes);
}

export function writeSnapshot(commentId, html, directory = FEEDBACK_DIRECTORY) {
  writeWhole(snapshotFile(directory, commentId), html);
}
