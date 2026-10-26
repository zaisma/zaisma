// The site Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), a request at localhost gets the site's
// settings at localhost (addresses.mjs), developers' calls
// (DEV_LIMIT, FILE_LIMIT) have no rate limit, so seeding the test data never waits on a 429, the Brotli
// jobs it queues are noted (notingCompressJobs, below), and every page gets the feedback overlay (withFeedback). Production keeps its limits and never has the
// overlay: this file is only the preview's entry.
import site from "../../../apps/site/src/index.ts";
import { environmentAt } from "./addresses.mjs";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/site/src/index.ts";

const unlimited = { limit: async () => ({ success: true }) };
const unlimitedBindings = new Set(["DEV_LIMIT", "FILE_LIMIT"]);
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

export default workerRetryingWhenLocked({
  ...site,
  fetch: (request, environment, context) => {
    const answer = (asked) => site.fetch(asked, unlimitedDeveloperCalls(environmentAt(asked, environment)), context);
    return withFeedback(request, environment, () => answer(request), answer);
  },
});
