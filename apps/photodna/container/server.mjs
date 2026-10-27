// The PhotoDNA hasher, inside the photodna Worker's container. One picture in, its Edge Hash out:
//   GET  /health  200 once Microsoft's SDK is ready
//   POST /hash    the picture's bytes; answers { kind: "hash", hash } or { kind: "skip", why }
//   POST /frames  a video's bytes; answers { kind: "frames", frames: [{ hash, timeInVideoMs }] } or { kind: "skip", why }
// It loads the SDK the way Microsoft's own Node sample does (PhotoDNA.CloudService.Samples/node).
// Nothing here reads or changes the SDK's files; they're loaded as Microsoft ships them.
import { createServer } from "node:http";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { videoFrames } from "./frames.mjs";

const SDK_SCRIPT_PATH = "/app/sdk/photoDnaEdgeHashS.js";
/** Biggest picture accepted, and the most pixels decoded: bigger ones are skipped (Arachnid Shield still checks them). */
const MAXIMUM_PICTURE_SIZE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_PIXEL_COUNT = 100_000_000;
/** Biggest video accepted: the biggest file an upload takes (FILE_LIMITS in packages/core/src/uploads.ts). */
const MAXIMUM_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;

// The SDK expects a browser: Microsoft's sample stubs document.currentScript the same way.
globalThis.document = { currentScript: { src: SDK_SCRIPT_PATH } };
vm.runInThisContext(readFileSync(SDK_SCRIPT_PATH, "utf8"));
const isReady = () => typeof globalThis.pdnaHash === "function";

/** Raw RGBA pixels of a picture's first frame, or why it can't be read. */
async function pixels(bytes) {
  try {
    const { data, info } = await sharp(bytes, { pages: 1, limitInputPixels: MAXIMUM_PIXEL_COUNT, failOn: "none" }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (error) {
    return { why: `can't read the picture: ${String(error.message || error).slice(0, 200)}` };
  }
}

async function hash(bytes) {
  const picture = await pixels(bytes);
  if (picture.why) return { kind: "skip", why: picture.why };
  try {
    const result = await globalThis.PhotoDnaEdgeHashV2FromImageData(picture.data, picture.width, picture.height, "RGBA");
    // The last entry is the whole picture's hash (Microsoft's sample takes the same one).
    const value = result && result.count > 0 ? result.data[result.count - 1].PhotoDna : "";
    return value ? { kind: "hash", hash: value } : { kind: "skip", why: `no hash for a ${picture.width}×${picture.height} picture` };
  } catch (error) {
    return { kind: "skip", why: `PhotoDNA couldn't hash it: ${String(error?.message ?? JSON.stringify(error)).slice(0, 200)}` };
  }
}

/** A video's frames, each hashed. The video is written to disk first (an MP4 can keep its index at the end), and removed after. */
async function hashFrames(request) {
  const folder = await mkdtemp(join(tmpdir(), "video-"));
  try {
    const videoPath = join(folder, "video");
    const isWritten = await writeBody(request, videoPath);
    if (!isWritten) return { kind: "skip", why: `bigger than ${MAXIMUM_VIDEO_SIZE_BYTES / 1024 / 1024} MB` };
    const taken = await videoFrames(videoPath, join(folder, "frames"));
    if (!taken.frames) return { kind: "skip", why: taken.why };
    const frames = [];
    for (const frame of taken.frames) {
      const outcome = await hash(await readFile(frame.path));
      if (outcome.kind === "hash") frames.push({ hash: outcome.hash, timeInVideoMs: frame.timeInVideoMs });
    }
    return frames.length ? { kind: "frames", frames } : { kind: "skip", why: `none of its ${taken.frames.length} frames could be hashed` };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Writes the request's body to `path`; false when it's bigger than MAXIMUM_VIDEO_SIZE_BYTES (the rest is read and dropped, so the answer still gets back). */
function writeBody(request, path) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(path);
    let sizeBytes = 0;
    request.on("data", (chunk) => {
      sizeBytes += chunk.length;
      if (sizeBytes > MAXIMUM_VIDEO_SIZE_BYTES) {
        if (!file.destroyed) file.destroy();
        return;
      }
      if (!file.write(chunk)) {
        request.pause();
        file.once("drain", () => request.resume());
      }
    });
    request.on("end", () => (file.destroyed ? resolve(false) : file.end(() => resolve(true))));
    request.on("error", reject);
    file.on("error", reject);
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let sizeBytes = 0;
    request.on("data", (chunk) => {
      sizeBytes += chunk.length;
      if (sizeBytes > MAXIMUM_PICTURE_SIZE_BYTES) {
        reject(new Error("too big"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const answer = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return answer(response, isReady() ? 200 : 503, { isReady: isReady() });
  if (request.method !== "POST" || (request.url !== "/hash" && request.url !== "/frames")) return answer(response, 404, { kind: "skip", why: "not found" });
  if (!isReady()) return answer(response, 503, { why: "the SDK is still loading" });
  if (request.url === "/frames") {
    try {
      return answer(response, 200, await hashFrames(request));
    } catch (error) {
      return answer(response, 200, { kind: "skip", why: `couldn't read the video: ${String(error?.message ?? error).slice(0, 200)}` });
    }
  }
  let bytes;
  try {
    bytes = await readBody(request);
  } catch {
    return answer(response, 200, { kind: "skip", why: `bigger than ${MAXIMUM_PICTURE_SIZE_BYTES / 1024 / 1024} MB` });
  }
  answer(response, 200, await hash(bytes));
}).listen(8080);
