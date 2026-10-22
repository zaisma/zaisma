#!/usr/bin/env node
// What Julius left on this checkout's preview with its Feedback button (scripts/preview/feedback-overlay.js), for the session
// to work through when he says he left feedback:
//   npm run feedback                                  every open comment, oldest first, with its pictures (the preview's feedback
//                                                     server takes them, about a minute after each comment)
//   npm run feedback -- --all                         closed ones too
//   npm run feedback -- --json                        the same, as JSON
//   npm run feedback -- reply <comment_id> "<text>"   a reply he sees on the page, under the comment
//   npm run feedback -- retake <comment_id>           the live picture and the replay taken again, after a change
// Only he closes a comment, on the page. Pictures: <comment_id>.seen.png is the page as he saw it, <comment_id>.live.png the page
// loaded again, both with his box in orange, and <comment_id>.replay-<step>.jpg what he did on the page before commenting, done
// again a step at a time, for what a still picture can't show (a hover, an animation, a click that does nothing).
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FEEDBACK_DIRECTORY, listComments, pictureFile, publicComment, readComment, readReplay, replyToComment } from "./preview/feedback-store.mjs";

const [command, ...rest] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")));
const isJson = flags.has("--json");
const show = (path) => relative(process.cwd(), path);

/** The feedback server of this checkout's preview, which takes every picture in its one Chrome; null when it isn't running. */
async function runningServer() {
  const file = join(FEEDBACK_DIRECTORY, "server.json");
  if (!existsSync(file)) return null;
  const { feedback_port: feedbackPort } = JSON.parse(readFileSync(file, "utf8"));
  const server = `http://127.0.0.1:${feedbackPort}`;
  const isUp = await fetch(`${server}/__preview/feedback/comments`).then((response) => response.ok, () => false);
  return isUp ? server : null;
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
  const server = await runningServer();
  if (!server) fail({ code: "preview_not_running", message: "This checkout's preview isn't running." }, "npm run preview:start, then try again.");
  const answer = await (await fetch(`${server}/__preview/feedback/comments/${commentId}/pictures`, { method: "POST" })).json();
  if (answer.error) fail(answer.error, "Its log is .wrangler/preview/feedback.log.");
  const { live_picture_path: path, replay_steps: replaySteps } = answer;
  if (isJson) console.log(JSON.stringify({ comment_id: commentId, live_picture_path: path, replay_steps: replaySteps }, null, 2));
  else {
    console.log(`Took ${show(path)} again: ${comment.page_url} at ${comment.viewport_width_px} x ${comment.viewport_height_px}, ${comment.theme}.`);
    if (replaySteps.length) console.log(`Replayed what Julius did: ${replaySteps.length} pictures, ${show(replaySteps[0].picture_path)} on.`);
  }
} else if (command === undefined) {
  const comments = listComments({ status: flags.has("--all") ? undefined : "open" });
  // Pictures still to come: the server takes them in turn, and catches up on any it missed when it starts.
  const isServerUp = Boolean(await runningServer());
  const notYet = isServerUp ? "being taken (run this again in a minute)" : "not taken (npm run preview:start takes it)";
  const shown = comments.map((comment) => {
    const paths = pictures(comment);
    return { ...publicComment(comment), seen_picture_path: existsSync(paths.seen_picture_path) ? paths.seen_picture_path : null, live_picture_path: existsSync(paths.live_picture_path) ? paths.live_picture_path : null, replay_steps: readReplay(comment.comment_id) ?? [] };
  });
  const nextSteps = shown.length ? ["Look at each comment's pictures, make the changes, run npm run layout:check, then npm run feedback -- reply <comment_id> \"what changed\" for each.", "npm run feedback -- retake <comment_id> takes the live picture again after a change."] : [];
  if (isJson) console.log(JSON.stringify({ comments: shown, next_steps: nextSteps }, null, 2));
  else if (!shown.length) console.log(flags.has("--all") ? "No feedback on this checkout's preview yet." : "No open feedback. (--all shows closed comments too.)");
  else {
    for (const comment of shown) {
      const under = comment.is_page_comment ? "the whole page" : comment.component ? `${comment.component}${comment.layout_rule ? ` (${comment.layout_rule})` : ""}` : comment.element_class ? `.${comment.element_class.split(/\s+/).join(".")}` : "the page";
      console.log(`\n${comment.comment_id}  ${comment.status === "closed" ? "closed  " : ""}${comment.page_url}${comment.is_in_frame ? " (in a frame)" : ""}`);
      console.log(`  ${comment.viewport_width_px} x ${comment.viewport_height_px}, ${comment.theme}, scrolled to ${comment.scroll_x_px}, ${comment.scroll_y_px}; box at ${comment.box.left_px}, ${comment.box.top_px}, ${comment.box.width_px} x ${comment.box.height_px}`);
      console.log(`  On ${under}${comment.element_text ? `: "${comment.element_text}"` : ""}`);
      console.log(`  Julius: ${comment.text}`);
      for (const reply of comment.replies) console.log(`  ${reply.author === "session" ? "Claude" : "Julius"}: ${reply.text}`);
      console.log(`  Seen: ${comment.seen_picture_path ? show(comment.seen_picture_path) : notYet}`);
      console.log(`  Live: ${comment.live_picture_path ? show(comment.live_picture_path) : notYet}`);
      if (comment.recent_actions.length) {
        console.log(`  What he did first (${comment.recent_actions.length} actions), replayed:${comment.replay_steps.length ? "" : ` ${notYet}`}`);
        for (const step of comment.replay_steps) console.log(`    ${show(step.picture_path)}  ${step.label}`);
      }
    }
    console.log(`\n${nextSteps.join("\n")}`);
  }
} else {
  fail({ code: "unknown_command", field: "command", message: `Unknown command "${command}".` }, 'Use npm run feedback, npm run feedback -- reply <comment_id> "<text>", or npm run feedback -- retake <comment_id>.');
}
