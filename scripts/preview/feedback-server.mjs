// The preview's feedback server, for local previews only: the site's preview entry (workers/site.mjs) adds the overlay
// (feedback-overlay.js) to every page and sends /__preview/feedback/* here, so the page talks to it on its own origin. It keeps
// the comments (feedback-store.mjs) and the seen picture his device drew, and takes each one's live picture and the replay of what
// he did first as it's saved (feedback-pictures.mjs).
//   GET   /__preview/feedback/overlay.js
//   GET   /__preview/feedback/comments?page_url=…&page_url=…   the comments on those pages, and how many are open on every page
//   POST  /__preview/feedback/comments                         { comment, seen_picture_png_base64, seen_picture_svg }: a new comment
//                                                              and the page as he saw it, drawn on his device (or, when it couldn't
//                                                              read its drawing back, the SVG it drew from, for Chrome to draw); the
//                                                              site entry adds the page's cookies as x-preview-sign-in-cookie, so
//                                                              the live picture and the replay are signed in too
//   POST  /__preview/feedback/comments/<comment_id>/replies    { text }: Julius answering back
//   PATCH /__preview/feedback/comments/<comment_id>            { status, is_reply_unread }: closing, opening, reading replies
//   GET   /__preview/feedback/snapshots/<comment_id>           that SVG on a page, for Chrome to draw
//   POST  /__preview/feedback/comments/<comment_id>/pictures   the live picture and the replay taken again (npm run feedback -- retake)
//   GET   /__preview/feedback/pictures/<comment_id>/<seen|live>
// Every picture is taken here, one at a time in one Chrome, and on start it takes the ones an earlier run didn't get to.
// Run by run.mjs: node feedback-server.mjs <port> <site origin>.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openPictureTaker, liveUrl, seenUrl } from "./feedback-pictures.mjs";
import { addComment, changeComment, FEEDBACK_DIRECTORY, isCommentId, listComments, pictureFile, pngFromBase64, publicComment, readComment, readReplay, replyToComment, snapshotFile, writePicture, writeSnapshot } from "./feedback-store.mjs";

const [port, siteOrigin] = process.argv.slice(2);
const OVERLAY = join(dirname(fileURLToPath(import.meta.url)), "feedback-overlay.js");
const MAXIMUM_BODY_BYTES = 40 * 1024 * 1024;
const PICTURE_KINDS = new Set(["seen", "live"]);

// The feedback command (scripts/feedback.mjs) reads where the preview is from here.
mkdirSync(FEEDBACK_DIRECTORY, { recursive: true });
writeFileSync(join(FEEDBACK_DIRECTORY, "server.json"), JSON.stringify({ site_origin: siteOrigin, feedback_port: Number(port) }));

let pictureTaker = null;
const pictures = () => (pictureTaker ??= openPictureTaker({ siteOrigin, directory: FEEDBACK_DIRECTORY }).catch((error) => ((pictureTaker = null), Promise.reject(error))));

/** The comment's pictures it doesn't have yet, or all of them again with isRetake (the seen picture never changes): the seen one only
 *  when his device sent the SVG it copied instead of its drawing. */
async function takePictures(comment, isRetake = false) {
  try {
    const taker = await pictures();
    const isMissing = (kind) => !existsSync(pictureFile(FEEDBACK_DIRECTORY, comment.comment_id, kind));
    if (isMissing("seen") && existsSync(snapshotFile(FEEDBACK_DIRECTORY, comment.comment_id))) await taker.picture(comment, "seen", seenUrl(comment, siteOrigin));
    const live = isRetake || isMissing("live") ? await taker.picture(comment, "live", liveUrl(comment, siteOrigin)) : pictureFile(FEEDBACK_DIRECTORY, comment.comment_id, "live");
    const replaySteps = isRetake || !readReplay(comment.comment_id) ? await taker.replay(comment, liveUrl(comment, siteOrigin)) : readReplay(comment.comment_id);
    return { live_picture_path: live, replay_steps: replaySteps };
  } catch (error) {
    console.error(`Couldn't take the pictures for ${comment.comment_id}: ${error.message}`);
    return { error: { code: "pictures_failed", message: `Couldn't take the pictures: ${error.message}` } };
  }
}
// The ones an earlier run didn't get to (it was stopped mid-way, or Chrome was missing).
for (const comment of listComments({ status: "open" })) takePictures(comment);

const answer = (response, status, body, headers = {}) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(body));
};

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAXIMUM_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function onPages(pageUrls) {
  const all = listComments();
  return { comments: all.filter((comment) => pageUrls.includes(comment.page_url)).map(publicComment), open_comment_count: all.filter((comment) => comment.status === "open").length };
}

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    const parts = url.pathname.replace(/^\/__preview\/feedback\/?/, "").split("/").filter(Boolean);
    try {
      if (request.method === "GET" && parts[0] === "overlay.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        return response.end(readFileSync(OVERLAY));
      }
      if (parts[0] === "comments" && parts.length === 1) {
        if (request.method === "GET") return answer(response, 200, onPages(url.searchParams.getAll("page_url")));
        if (request.method === "POST") {
          const body = await readJson(request);
          if (!body?.comment) return answer(response, 400, { error: { code: "invalid_body", message: "Send { comment, seen_picture_png_base64, seen_picture_svg } as JSON." } });
          const { comment, error } = addComment(body.comment, { signInCookieHeader: request.headers["x-preview-sign-in-cookie"] || null });
          if (error) return answer(response, 400, { error });
          const seenPicture = pngFromBase64(body.seen_picture_png_base64);
          if (seenPicture) writePicture(comment.comment_id, "seen", seenPicture);
          else if (typeof body.seen_picture_svg === "string" && body.seen_picture_svg.startsWith("<svg")) writeSnapshot(comment.comment_id, body.seen_picture_svg);
          takePictures(comment);
          return answer(response, 201, { comment: publicComment(comment) });
        }
      }
      if (parts[0] === "comments" && isCommentId(parts[1])) {
        const body = request.method === "GET" ? null : await readJson(request);
        if (parts[2] === "replies" && request.method === "POST") {
          const { comment, error } = replyToComment(parts[1], "reviewer", body?.text);
          return error ? answer(response, error.code === "comment_not_found" ? 404 : 400, { error }) : answer(response, 201, { comment: publicComment(comment) });
        }
        if (parts[2] === "pictures" && request.method === "POST") {
          const comment = readComment(parts[1]);
          if (!comment) return answer(response, 404, { error: { code: "comment_not_found", message: `There's no comment ${parts[1]}.` } });
          const taken = await takePictures(comment, true);
          return answer(response, taken.error ? 500 : 200, taken);
        }
        if (parts.length === 2 && request.method === "PATCH") {
          const { comment, error } = changeComment(parts[1], body ?? {});
          return error ? answer(response, 404, { error }) : answer(response, 200, { comment: publicComment(comment) });
        }
      }
      if (request.method === "GET" && parts[0] === "snapshots" && isCommentId(parts[1]) && existsSync(snapshotFile(FEEDBACK_DIRECTORY, parts[1]))) {
        // The SVG as a picture on a page of its size: it carries its own styles, fonts and pictures, and nothing in it runs.
        const comment = readComment(parts[1]);
        const svg = readFileSync(snapshotFile(FEEDBACK_DIRECTORY, parts[1])).toString("base64");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'" });
        return response.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}img{display:block}</style><img src="data:image/svg+xml;base64,${svg}" width="${comment?.viewport_width_px ?? ""}" height="${comment?.viewport_height_px ?? ""}" alt="">`);
      }
      if (request.method === "GET" && parts[0] === "pictures" && isCommentId(parts[1]) && PICTURE_KINDS.has(parts[2]) && readComment(parts[1])) {
        const file = pictureFile(FEEDBACK_DIRECTORY, parts[1], parts[2]);
        if (!existsSync(file)) return answer(response, 404, { error: { code: "picture_not_taken", message: "The picture is still being taken." } });
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        return response.end(readFileSync(file));
      }
      answer(response, 404, { error: { code: "not_found", message: `Nothing at ${request.method} ${url.pathname}.` } });
    } catch (error) {
      answer(response, 500, { error: { code: "feedback_server_failed", message: error.message } });
    }
  })
  .listen(Number(port), "127.0.0.1");

process.on("SIGTERM", async () => {
  if (pictureTaker) await (await pictureTaker.catch(() => null))?.close().catch(() => {});
  process.exit(0);
});
