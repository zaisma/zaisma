// The site Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), a request at localhost gets the site's
// settings at localhost (addresses.mjs), developers' calls
// (LIMIT_BUSY, LIMIT_BUILDING) have no rate limit, so seeding the test data never waits on a 429, nor does a password's
// (LIMIT_GUESS), since the layout check signs in as a closed account on every screen to measure its page, the Brotli
// jobs it queues are noted (notingCompressJobs, below), every page gets the feedback overlay (withFeedback), and the Screens bench lives here (withBench,
// ../bench/). The seed's shader checks draw beside the scan queue instead of holding it (withSeedShaderChecks, below). Production keeps its limits and
// its one queue and never has the overlay or the bench: this file is only the preview's entry.
import site from "../../../apps/site/src/index.ts";
import { runShaderCheck, shaderCheckDeps } from "../../../apps/site/src/shader-check.ts";
import { environmentAt } from "./addresses.mjs";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";
import { PASSWORD } from "../sign-ins.mjs";
import { qrCodeSvg } from "@zaisma/core";
import { BENCH_PATH, answerAsScreen, forgetJar, markOf } from "../bench/bench-server.mjs";
import { benchPage } from "../bench/bench-page.ts";
import { readyStates, setUpsScript } from "../bench/places.ts";

export * from "../../../apps/site/src/index.ts";

const unlimited = { limit: async () => ({ success: true }) };
const unlimitedBindings = new Set(["LIMIT_BUSY", "LIMIT_BUILDING", "LIMIT_GUESS"]);
const withoutDeveloperLimits = new WeakMap();

// Each Brotli job the site queues is noted in preview_compress_jobs, so the preview can wait until the compress Worker has
// answered every one (a compressed_blobs row) before games play: run.mjs's waitForBrotliCopies.
function notingCompressJobs(environment) {
  const queue = environment.COMPRESS_QUEUE;
  const note = async (jobs) => {
    await environment.DB.prepare("CREATE TABLE IF NOT EXISTS preview_compress_jobs (storage_key TEXT PRIMARY KEY)").run();
    for (const job of jobs) await environment.DB.prepare("INSERT OR IGNORE INTO preview_compress_jobs (storage_key) VALUES (?)").bind(job.storageKey).run();
  };
  return {
    send: async (job, options) => (await note([job]), queue.send(job, options)),
    sendBatch: async (messages, options) => (await note(messages.map((message) => message.body)), queue.sendBatch(messages, options)),
  };
}

function unlimitedDeveloperCalls(environment) {
  let unlimitedEnvironment = withoutDeveloperLimits.get(environment);
  if (!unlimitedEnvironment) {
    const compressQueue = notingCompressJobs(environment);
    unlimitedEnvironment = new Proxy(environment, { get: (target, name) => (unlimitedBindings.has(name) ? unlimited : name === "COMPRESS_QUEUE" ? compressQueue : Reflect.get(target, name)) });
    withoutDeveloperLimits.set(environment, unlimitedEnvironment);
  }
  return unlimitedEnvironment;
}

// The feedback layer (scripts/preview/feedback-server.mjs): /__preview/feedback/* goes to the feedback server, with the page's
// cookies so its pictures are taken as the same test account, and every page the site answers gets the overlay's script, from
// its own origin so the site's script policy stays as it is. When the site serves the layout inspector (window.zaismaInspect,
// any /js/layout-inspect.<16 hex>.js address answers the current one), it comes first, so each comment names the component
// and the rule under it.
const FEEDBACK_PATH = "/__preview/feedback/";
const OVERLAY_TAG = `<script src="${FEEDBACK_PATH}overlay.js" defer></script>`;
const INSPECTOR_PATH = "/js/layout-inspect.0000000000000000.js";
let hasInspector = null;

async function withFeedback(request, environment, answerPage, answer) {
  const feedbackOrigin = environment.PREVIEW_FEEDBACK_ORIGIN;
  if (!feedbackOrigin) return answerPage();
  const url = new URL(request.url);
  if (url.pathname.startsWith(FEEDBACK_PATH)) {
    const headers = new Headers({ "x-preview-sign-in-cookie": request.headers.get("cookie") ?? "" });
    if (request.headers.has("content-type")) headers.set("content-type", request.headers.get("content-type"));
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    return fetch(`${feedbackOrigin}${url.pathname}${url.search}`, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined });
  }
  const response = await answerPage();
  if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return response;
  hasInspector ??= await answer(new Request(new URL(INSPECTOR_PATH, url))).then((found) => found.ok, () => false);
  const tags = `${hasInspector ? `<script src="${INSPECTOR_PATH}" defer></script>` : ""}${OVERLAY_TAG}`;
  return new HTMLRewriter().on("head", { element: (head) => head.append(tags, { html: true }) }).transform(response);
}

// The Screens bench (../bench/): its own addresses, and a request from a screen on it answered as that screen's profile. The scripts and the
// seen marks are the feedback server's, which can read the disk.
async function withBench(request, environment, answerPage, answer) {
  const url = new URL(request.url);
  if (url.pathname.startsWith(BENCH_PATH)) {
    if (request.method === "POST" && url.pathname === `${BENCH_PATH}forget-profile`) {
      forgetJar(url.origin, url.searchParams.get("profile"));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `${BENCH_PATH}states.js`) return new Response(setUpsScript(), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
    if (url.pathname === `${BENCH_PATH}qr`) return new Response(qrCodeSvg(url.searchParams.get("text") ?? ""), { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
    if (url.pathname === `${BENCH_PATH}state`) {
      const state = readyStates().find((each) => `${each.placeValue}/${each.stateValue}` === url.searchParams.get("value"));
      return new Response(JSON.stringify(state ?? null), { status: state ? 200 : 404, headers: { "content-type": "application/json" } });
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    return fetch(`${environment.PREVIEW_FEEDBACK_ORIGIN}${url.pathname}${url.search}`, { method: request.method, headers: { "content-type": request.headers.get("content-type") ?? "text/plain" }, body: hasBody ? await request.arrayBuffer() : undefined });
  }
  if (url.pathname === "/design/screens") {
    const profiles = await fetch(`${environment.PREVIEW_FEEDBACK_ORIGIN}${BENCH_PATH}profiles`).then((answered) => answered.json());
    return benchPage(environmentAt(request, environment), url, profiles, environment.SITE_ORIGIN);
  }
  const mark = markOf(url, request.headers.get("referer"));
  return mark ? answerAsScreen({ request, mark, password: PASSWORD, answer, nowMs: Date.now() }) : answerPage();
}

// A shader check takes about 20 seconds, and the scan queue takes one message at a time, so while the seed adds its test data its shaders' checks
// don't go on the queue, where every upload after them would wait behind them. Its calls say so with this header (SEED_HEADER), and it asks for each
// check here instead, beside everything else (run.mjs, settleSentShaders). Every other shader, one sent to a running preview, goes on the queue as in production.
const SEED_HEADER = "x-preview-seed";
const DRAW_SHADER_CHECK_PATH = "/__preview/draw-shader-check";
function withSeedShaderChecks(request, environment) {
  if (!request.headers.has(SEED_HEADER)) return environment;
  const queue = environment.SCAN_QUEUE;
  return { ...environment, SCAN_QUEUE: { send: async (body, options) => ("shaderCheckId" in Object(body) ? undefined : queue.send(body, options)) } };
}
/** A drawing as text, for the seed to keep: its pictures are bytes. */
const drawingAsText = (drawing) => JSON.stringify(drawing, (_, value) => (value instanceof Uint8Array ? { bytes_base64: btoa(String.fromCharCode(...value)) } : value));
const drawingFromText = (text) => JSON.parse(text, (_, value) => (typeof value?.bytes_base64 === "string" ? Uint8Array.from(atob(value.bytes_base64), (letter) => letter.charCodeAt(0)) : value));
/**
 * One shader's check, tried again as the queue would, at once: nothing else waits on it. The seed sends a drawing it kept from the same shader and the
 * same check, and only the drawing is skipped; the rest of the check runs on it. Otherwise this answers the new drawing, for the seed to keep.
 */
async function drawShaderCheck(request, environment) {
  const deps = shaderCheckDeps(environment);
  if (!deps) return new Response(null, { status: 204 });
  const kept = await request.text();
  let drawing = kept ? drawingFromText(kept) : null;
  let isNewDrawing = false;
  const render = async (input) => {
    if (!drawing) {
      drawing = await deps.render(input);
      isNewDrawing = true;
    }
    return drawing;
  };
  const shaderId = new URL(request.url).searchParams.get("shader_id");
  for (let tryNumber = 1; tryNumber <= 3; tryNumber++) {
    try {
      await runShaderCheck(environment, shaderId, { ...deps, render });
      break;
    } catch (error) {
      console.error("shader check failed", shaderId, error);
    }
  }
  return new Response(isNewDrawing ? drawingAsText(drawing) : null);
}

export default workerRetryingWhenLocked({
  ...site,
  fetch: (request, environment, context) => {
    const pathname = new URL(request.url).pathname;
    if (request.method === "POST" && pathname === DRAW_SHADER_CHECK_PATH) return drawShaderCheck(request, environmentAt(request, environment));
    const answer = (asked) => site.fetch(asked, unlimitedDeveloperCalls(withSeedShaderChecks(asked, environmentAt(asked, environment))), context);
    return withFeedback(request, environment, () => withBench(request, environment, () => answer(request), answer), answer);
  },
});
