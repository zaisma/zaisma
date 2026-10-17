// The PhotoDNA hasher, inside the photodna Worker's container. One picture in, its Edge Hash out:
//   GET  /health  200 once Microsoft's SDK is ready
//   POST /hash    the picture's bytes; answers { kind: "hash", hash } or { kind: "skip", why }
// It loads the SDK the way Microsoft's own Node sample does (PhotoDNA.CloudService.Samples/node).
// Nothing here reads or changes the SDK's files; they're loaded as Microsoft ships them.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import sharp from "sharp";

const SDK_SCRIPT_PATH = "/app/sdk/photoDnaEdgeHashS.js";
/** Biggest picture accepted, and the most pixels decoded: bigger ones are skipped (Arachnid Shield still checks them). */
const MAXIMUM_PICTURE_SIZE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_PIXEL_COUNT = 100_000_000;

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
  if (request.method !== "POST" || request.url !== "/hash") return answer(response, 404, { kind: "skip", why: "not found" });
  if (!isReady()) return answer(response, 503, { why: "the SDK is still loading" });
  let bytes;
  try {
    bytes = await readBody(request);
  } catch {
    return answer(response, 200, { kind: "skip", why: `bigger than ${MAXIMUM_PICTURE_SIZE_BYTES / 1024 / 1024} MB` });
  }
  answer(response, 200, await hash(bytes));
}).listen(8080);
