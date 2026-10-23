// The site Worker as the preview runs it: unchanged, except database calls are tried again when
// another preview server has the database locked (retry-when-locked.mjs), developers' calls
// (DEV_LIMIT, FILE_LIMIT) have no rate limit, so seeding the test data never waits on a 429, and every
// page gets the feedback overlay (withFeedback, below). Production keeps its limits and never has the
// overlay: this file is only the preview's entry.
import site from "../../../apps/site/src/index.ts";
import { workerRetryingWhenLocked } from "./retry-when-locked.mjs";

export * from "../../../apps/site/src/index.ts";

const unlimited = { limit: async () => ({ success: true }) };
const unlimitedBindings = new Set(["DEV_LIMIT", "FILE_LIMIT"]);
const withoutDeveloperLimits = new WeakMap();

function unlimitedDeveloperCalls(environment) {
  let unlimitedEnvironment = withoutDeveloperLimits.get(environment);
  if (!unlimitedEnvironment) {
    unlimitedEnvironment = new Proxy(environment, { get: (target, name) => (unlimitedBindings.has(name) ? unlimited : Reflect.get(target, name)) });
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

// The test data's SQL (run.mjs, sql()): POST /__preview/sql with this run's token and { sql }, run as
// `wrangler d1 execute --command` runs it (split into statements, one batch), answering each statement's rows.
// Here, in the process that has the database open, it takes a few milliseconds instead of a wrangler of its own.
const SQL_PATH = "/__preview/sql";

/** The statements in SQL text, split on the semicolons outside quotes and comments. */
function statementsOf(text) {
  const statements = [""];
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (!quote && character === "-" && text[index + 1] === "-") {
      // A comment, to the end of its line.
      const lineEndIndex = text.indexOf("\n", index);
      index = lineEndIndex === -1 ? text.length : lineEndIndex;
      continue;
    }
    if (!quote && character === ";") {
      statements.push("");
      continue;
    }
    if (quote ? character === quote : character === "'" || character === '"' || character === "`") quote = quote ? null : character;
    statements[statements.length - 1] += character;
  }
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

async function answerSql(request, environment) {
  if (request.method !== "POST" || !environment.PREVIEW_SQL_TOKEN || request.headers.get("x-preview-sql-token") !== environment.PREVIEW_SQL_TOKEN) return new Response("Not found", { status: 404 });
  const { sql } = await request.json();
  try {
    const answers = await environment.DB.batch(statementsOf(sql).map((statement) => environment.DB.prepare(statement)));
    return Response.json({ results: answers.map((answer) => answer.results ?? []) });
  } catch (error) {
    return Response.json({ error: String(error?.message ?? error) }, { status: 500 });
  }
}

export default workerRetryingWhenLocked({
  ...site,
  fetch: (request, environment, context) => {
    if (new URL(request.url).pathname === SQL_PATH) return answerSql(request, environment);
    const answer = (asked) => site.fetch(asked, unlimitedDeveloperCalls(environment), context);
    return withFeedback(request, environment, () => answer(request), answer);
  },
});
