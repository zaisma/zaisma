#!/usr/bin/env node
// What Julius left on this checkout's preview with its Feedback button (scripts/preview/feedback-overlay.js), for the session
// to work through when he says he left feedback:
//   npm run feedback                                  every open comment, oldest first, with its pictures (taken now when missing)
//   npm run feedback -- --all                         closed ones too
//   npm run feedback -- --json                        the same, as JSON
//   npm run feedback -- reply <comment_id> "<text>"   a reply he sees on the page, under the comment
//   npm run feedback -- retake <comment_id>           the live picture taken again, after a change
// Only he closes a comment, on the page. Pictures: <comment_id>.seen.png is the page as he saw it, <comment_id>.live.png the page
// loaded again, both with his box in orange.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { liveUrl, openPictureTaker, seenUrl } from "./preview/feedback-pictures.mjs";
import { FEEDBACK_DIRECTORY, listComments, pictureFile, publicComment, readComment, replyToComment } from "./preview/feedback-store.mjs";

const [command, ...rest] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")));
const isJson = flags.has("--json");
const show = (path) => relative(process.cwd(), path);

/** Where this checkout's preview runs, from the feedback server; null when it hasn't run. */
async function runningSite() {
  const file = join(FEEDBACK_DIRECTORY, "server.json");
  if (!existsSync(file)) return null;
  const { site_origin: siteOrigin } = JSON.parse(readFileSync(file, "utf8"));
  const isUp = await fetch(`${siteOrigin}/__preview/feedback/comments`).then((response) => response.ok, () => false);
  return isUp ? siteOrigin : null;
}

function fail(error, nextStep) {
  if (isJson) console.log(JSON.stringify({ error: { ...error, next_step: nextStep } }, null, 2));
  else console.error(`${error.message}${nextStep ? `\n${nextStep}` : ""}`);
  process.exit(1);
}

const pictures = (comment) => ({ seen_picture_path: pictureFile(FEEDBACK_DIRECTORY, comment.comment_id, "seen"), live_picture_path: pictureFile(FEEDBACK_DIRECTORY, comment.comment_id, "live") });

if (command === "reply") {
  const [commentId, ...words] = rest;
  const { comment, error } = replyToComment(commentId, "session", words.join(" "));
  if (error) fail(error, error.code === "missing_text" ? `npm run feedback -- reply ${commentId} "what changed"` : "npm run feedback lists the open comments.");
  if (isJson) console.log(JSON.stringify({ comment: publicComment(comment) }, null, 2));
  else console.log(`Replied on ${commentId}. Julius sees it on ${comment.page_url}, where he closes it or answers back.`);
} else if (command === "retake") {
  const [commentId] = rest;
  const comment = readComment(commentId);
  if (!comment) fail({ code: "comment_not_found", field: "comment_id", message: `There's no comment ${commentId}.` }, "npm run feedback lists them.");
  const siteOrigin = await runningSite();
  if (!siteOrigin) fail({ code: "preview_not_running", message: "This checkout's preview isn't running." }, "npm run preview:start, then try again.");
  const taker = await openPictureTaker({ siteOrigin, directory: FEEDBACK_DIRECTORY });
  const path = await taker.picture(comment, "live", liveUrl(comment, siteOrigin));
  await taker.close();
  if (isJson) console.log(JSON.stringify({ comment_id: commentId, live_picture_path: path }, null, 2));
  else console.log(`Took ${show(path)} again: ${siteOrigin}${comment.page_url} at ${comment.viewport_width_px} x ${comment.viewport_height_px}, ${comment.theme}.`);
} else if (command === undefined) {
  const comments = listComments({ status: flags.has("--all") ? undefined : "open" });
  // Pictures the server didn't get to (it was stopped, or Chrome was missing) are taken now, when the preview runs.
  const missing = comments.filter((comment) => Object.values(pictures(comment)).some((path) => !existsSync(path)));
  const siteOrigin = missing.length ? await runningSite() : null;
  if (siteOrigin) {
    const taker = await openPictureTaker({ siteOrigin, directory: FEEDBACK_DIRECTORY });
    for (const comment of missing) {
      if (!existsSync(pictures(comment).seen_picture_path)) await taker.picture(comment, "seen", seenUrl(comment, siteOrigin)).catch(() => {});
      if (!existsSync(pictures(comment).live_picture_path)) await taker.picture(comment, "live", liveUrl(comment, siteOrigin)).catch(() => {});
    }
    await taker.close();
  }
  const shown = comments.map((comment) => {
    const paths = pictures(comment);
    return { ...publicComment(comment), seen_picture_path: existsSync(paths.seen_picture_path) ? paths.seen_picture_path : null, live_picture_path: existsSync(paths.live_picture_path) ? paths.live_picture_path : null };
  });
  const nextSteps = shown.length ? ["Look at each comment's pictures, make the changes, run npm run layout:check, then npm run feedback -- reply <comment_id> \"what changed\" for each.", "npm run feedback -- retake <comment_id> takes the live picture again after a change."] : [];
  if (isJson) console.log(JSON.stringify({ comments: shown, next_steps: nextSteps }, null, 2));
  else if (!shown.length) console.log(flags.has("--all") ? "No feedback on this checkout's preview yet." : "No open feedback. (--all shows closed comments too.)");
  else {
    for (const comment of shown) {
      const under = comment.component ? `${comment.component}${comment.layout_rule ? ` (${comment.layout_rule})` : ""}` : comment.element_class ? `.${comment.element_class.split(/\s+/).join(".")}` : "the page";
      console.log(`\n${comment.comment_id}  ${comment.status === "closed" ? "closed  " : ""}${comment.page_url}${comment.is_in_frame ? " (in a frame)" : ""}`);
      console.log(`  ${comment.viewport_width_px} x ${comment.viewport_height_px}, ${comment.theme}, scrolled to ${comment.scroll_x_px}, ${comment.scroll_y_px}; box at ${comment.box.left_px}, ${comment.box.top_px}, ${comment.box.width_px} x ${comment.box.height_px}`);
      console.log(`  On ${under}${comment.element_text ? `: "${comment.element_text}"` : ""}`);
      console.log(`  Julius: ${comment.text}`);
      for (const reply of comment.replies) console.log(`  ${reply.author === "session" ? "Claude" : "Julius"}: ${reply.text}`);
      console.log(`  Seen: ${comment.seen_picture_path ? show(comment.seen_picture_path) : "not taken yet (start the preview and run this again)"}`);
      console.log(`  Live: ${comment.live_picture_path ? show(comment.live_picture_path) : "not taken yet"}`);
    }
    console.log(`\n${nextSteps.join("\n")}`);
  }
} else {
  fail({ code: "unknown_command", field: "command", message: `Unknown command "${command}".` }, 'Use npm run feedback, npm run feedback -- reply <comment_id> "<text>", or npm run feedback -- retake <comment_id>.');
}
