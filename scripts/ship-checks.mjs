// The checks `npm run ship` runs after every deploy (scripts/ship.mjs). Plain JavaScript like
// scripts/ship-github-check.mjs, so a test can import it with fetch stubbed (ship.mjs deploys when imported).
//
// "Security checks on every ship." in docs/DECISIONS.md: after a deploy, try the doors an attacker
// tries first on the live site. A door that opens is SHIP FAIL, fixed before anything else:
// a missing security header, a private game opening on a public address, an R2 bucket or the backups bucket reachable
// without signing, /admin answering without Cloudflare Access. It also checks that npm has the CLI's
// version, which .github/workflows/publish-cli.yml publishes from main.
//
// A result is { name, isPass, isSecurity, isChecked, note }: isChecked is false when the check couldn't get an
// answer at all (wrangler or the network failed under it), which fails like any check but says so.

export const SITE_URL = "https://zaisma.com";
export const GAME_DOMAIN = "zaismausercontent.com";
// A live, listed game whose page and files the live check loads.
export const CHECK_GAME_SLUG = "arena";
export const CHECK_GAME_URL = `https://${CHECK_GAME_SLUG}.${GAME_DOMAIN}/`;
export const ROOMS_URL = "https://rooms.zaisma.com";
// Zaisma's own private game with a live version (made once through the MCP, see this slice's pull
// request): never make it listed or delete it.
export const PRIVATE_CHECK_GAME_SLUG = "ship-check";
// The team domain must match ACCESS_TEAM_DOMAIN in apps/site/wrangler.jsonc.
// Zaisma's backups at Backblaze (apps/site/src/backups.ts): private, so its list and its newest main database copy refuse a stranger.
export const BACKUP_BUCKET_URL = "https://s3.us-east-005.backblazeb2.com/zaisma-backups/";
export const ACCESS_LOGIN_PREFIX = "https://zaisma.cloudflareaccess.com/cdn-cgi/access/login/";
// With Managed OAuth on, Access answers a request that isn't a browser's with a 401 naming its own
// resource metadata here; the origin never sends it.
export const ACCESS_RESOURCE_METADATA_PREFIX = `${SITE_URL}/.well-known/cloudflare-access-protected-resource/`;
export const TRANSPORT_SECURITY_MINIMUM_MAX_AGE_SEC = 31_536_000;
export const ALLOWED_SITE_SCRIPT_SOURCES = ["'self'", "https://challenges.cloudflare.com"];
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const PUBLISH_CLI_WORKFLOW_URL = "https://github.com/zaisma/zaisma/actions/workflows/publish-cli.yml";
export const PUBLISH_GAME_SERVER_WORKFLOW_URL = "https://github.com/zaisma/zaisma/actions/workflows/publish-game-server.yml";
export const PUBLISH_WAIT_SEC = 600;
// Past PUBLISH_WAIT_SEC the wait goes on only while the publish workflow's run for the commit is still queued or running
// (GitHub's runners have kept one queued for 14 minutes), or has published and npm is still processing the version
// (npm has taken 26 minutes to serve one after its run passed), up to this.
export const PUBLISH_LONGEST_WAIT_SEC = 2700;
export const PUBLISH_RUNNING_STATUSES = ["queued", "in_progress", "waiting", "pending", "requested"];
// What readPublishRunStatus answers for a run that finished and passed: its publish reached npm, which serves it once processed.
export const PUBLISHED_RUN_STATUS = "published";
export const PUBLISH_POLL_SEC = 15;
export const REQUEST_TIMEOUT_MS = 15_000;
export const ATTEMPT_COUNT = 4;
export const RETRY_WAIT_MS = 3000;
// A game's address answers its pages with a redirect to its version's own address (<base>_zaisma/versions/<id>/);
// checks of the game's page follow it on the same origin, at most this many times.
export const MAXIMUM_REDIRECT_COUNT = 3;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const asHeaders = (headers) => (typeof headers?.get === "function" ? headers : new Headers(headers ?? {}));

// ---- The judges: each returns a list of problems, [] when it holds ----

/** Directive name (lowercased) -> list of its sources. */
export function parseContentSecurityPolicy(headerText) {
  const directives = new Map();
  for (const part of String(headerText ?? "").split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

export function transportSecurityProblems(headers) {
  const value = asHeaders(headers).get("strict-transport-security");
  if (!value) return ["no Strict-Transport-Security"];
  const problems = [];
  const maxAgeSec = Number(value.match(/max-age=(\d+)/i)?.[1]);
  if (!(maxAgeSec >= TRANSPORT_SECURITY_MINIMUM_MAX_AGE_SEC)) problems.push(`Strict-Transport-Security max-age ${Number.isNaN(maxAgeSec) ? "unreadable" : maxAgeSec} is under ${TRANSPORT_SECURITY_MINIMUM_MAX_AGE_SEC}`);
  if (!/includesubdomains/i.test(value)) problems.push("Strict-Transport-Security lacks includeSubDomains");
  return problems;
}

function exactDirectiveProblem(policy, directive, expected) {
  const sources = policy.get(directive);
  return sources && sources.length === 1 && sources[0] === expected ? [] : [`${directive} isn't ${expected}`];
}

function nosniffProblems(headers) {
  return asHeaders(headers).get("x-content-type-options")?.toLowerCase() === "nosniff" ? [] : ["X-Content-Type-Options isn't nosniff"];
}

/**
 * The hashes a page's script-src may also name: exactly those of the first-paint pieces the shipped code puts inline at the start of
 * a page's body (FIRST_PAINT_SCRIPT_TEXTS, apps/site/src/html.ts), worked out from this checkout, so any other inline script, or a
 * piece changed without its code, still fails. html.ts is TypeScript, so it's bundled with esbuild and imported from memory.
 */
export async function firstPaintHashSources() {
  const [{ build }, { createHash }, { join }] = await Promise.all([import("esbuild"), import("node:crypto"), import("node:path")]);
  const bundled = await build({ entryPoints: [join(import.meta.dirname, "../apps/site/src/html.ts")], bundle: true, write: false, format: "esm", platform: "node", target: "node22", logLevel: "error", external: ["cloudflare:*"] });
  const { FIRST_PAINT_SCRIPT_TEXTS } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  return FIRST_PAINT_SCRIPT_TEXTS.map((text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`);
}

export function siteHeaderProblems(headers, allowedHashSources = []) {
  const problems = transportSecurityProblems(headers);
  const policyText = asHeaders(headers).get("content-security-policy");
  if (!policyText) return [...problems, "no Content-Security-Policy", ...nosniffProblems(headers)];
  const policy = parseContentSecurityPolicy(policyText);
  const scriptSources = policy.get("script-src");
  if (!scriptSources) problems.push("no script-src");
  else {
    if (!scriptSources.includes("'self'")) problems.push("script-src lacks 'self'");
    for (const source of scriptSources) if (!ALLOWED_SITE_SCRIPT_SOURCES.includes(source) && !allowedHashSources.includes(source)) problems.push(`script-src allows ${source}`);
  }
  problems.push(...exactDirectiveProblem(policy, "frame-ancestors", "'none'"), ...exactDirectiveProblem(policy, "object-src", "'none'"), ...exactDirectiveProblem(policy, "base-uri", "'none'"), ...nosniffProblems(headers));
  return problems;
}

export function gameHeaderProblems(headers) {
  const problems = transportSecurityProblems(headers);
  const policyText = asHeaders(headers).get("content-security-policy");
  if (!policyText) return [...problems, "no Content-Security-Policy", ...nosniffProblems(headers)];
  const policy = parseContentSecurityPolicy(policyText);
  problems.push(...exactDirectiveProblem(policy, "frame-ancestors", SITE_URL), ...exactDirectiveProblem(policy, "form-action", "'none'"), ...exactDirectiveProblem(policy, "object-src", "'none'"), ...nosniffProblems(headers));
  return problems;
}

export function httpsRedirectProblems(response, expectedUrl) {
  const isRedirect = (response.status === 301 || response.status === 308) && response.headers.get("location") === expectedUrl;
  return isRedirect ? [] : [`answered ${response.status} instead of a redirect to ${expectedUrl}`];
}

/** The live security.txt (the security policy slice, docs/DECISIONS.md "Anyone can report a hole safely"): there, with Zaisma's security contact, and not expired. */
export function securityTxtProblems(response, body, now = new Date()) {
  if (response.status !== 200) return [`answered ${response.status}`];
  const problems = [];
  if (!/^Contact: mailto:security@zaisma\.com$/m.test(body)) problems.push("no Contact: mailto:security@zaisma.com");
  const expires = Date.parse(body.match(/^Expires: (.+)$/m)?.[1] ?? "");
  if (Number.isNaN(expires)) problems.push("no readable Expires");
  else if (expires <= now.getTime()) problems.push("Expires is in the past");
  return problems;
}

export function privateAddressProblems(response) {
  return response.status === 404 ? [] : [`answered ${response.status}`];
}

/**
 * Cloudflare Access answered, not the origin: a redirect to its login (a browser), or, with Managed
 * OAuth, a 401 whose www-authenticate names Access's resource metadata (anything else).
 */
export function adminAccessProblems(response) {
  const location = response.headers.get("location") ?? "";
  if ((response.status === 302 || response.status === 303) && location.startsWith(ACCESS_LOGIN_PREFIX)) return [];
  const resourceMetadataUrl = (response.headers.get("www-authenticate") ?? "").match(/resource_metadata="([^"]*)"/)?.[1] ?? "";
  if (response.status === 401 && resourceMetadataUrl.startsWith(ACCESS_RESOURCE_METADATA_PREFIX)) return [];
  return [`answered ${response.status} without Cloudflare Access${location ? ` (Location ${location})` : ""}`];
}

/** The backups bucket answers a request without a signature only with a refusal. */
export function backupBucketProblems(response) {
  return response.status === 401 || response.status === 403 ? [] : [`answered ${response.status} without being signed in`];
}

/** Every `name:` line of `wrangler r2 bucket list`. */
export function bucketNames(listOutput) {
  return [...String(listOutput).matchAll(/^name:\s+(\S+)/gm)].map((match) => match[1]);
}

const lastLines = (output, count) => String(output).trim().split("\n").slice(-count).join(" ").trim();

export const R2_DEV_DISABLED_LINE = "Public access via the r2.dev URL is disabled.";
export const NO_CUSTOM_DOMAINS_LINE = "There are no custom domains connected to this bucket.";

/** Why wrangler gave no answer: its ✘ [ERROR] line, else its last line that isn't where it wrote its log. */
export function wranglerFailure(answer) {
  const lines = String(answer.output).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("🪵"));
  const errorLine = lines.find((line) => /\[ERROR\]/.test(line));
  const why = errorLine ? errorLine.replace(/^.*\[ERROR\]\s*/, "") : lines.at(-1);
  return `wrangler ${answer.exitCode === 0 ? "answered" : `exited ${answer.exitCode}`}${why ? `: ${why}` : " with nothing"}`;
}

/**
 * devUrl and domainList are wrangler's answers ({ exitCode, output }) to `r2 bucket dev-url get` and `r2 bucket domain list`.
 * Each is read for its exact lines: an answer that's neither "off" nor a public address is "couldn't check", never a pass.
 */
export function bucketAccessProblems(devUrl, domainList) {
  const problems = [];
  const devUrlOutput = String(devUrl.output);
  const publicDevUrl = devUrlOutput.match(/^Public access is enabled at '(https:\/\/[^']+)'\.$/m)?.[1];
  if (devUrl.exitCode === 0 && publicDevUrl) problems.push(`public r2.dev address is on: ${publicDevUrl}`);
  else if (devUrl.exitCode !== 0 || !devUrlOutput.split("\n").some((line) => line.trim() === R2_DEV_DISABLED_LINE)) problems.push(`couldn't check its r2.dev address (${wranglerFailure(devUrl)})`);
  const domainListOutput = String(domainList.output);
  // wrangler lists each connected domain as a block of labelled values starting with `domain:`.
  const connectedDomains = [...domainListOutput.matchAll(/^domain:\s+(\S+)/gm)].map((match) => match[1]);
  if (domainList.exitCode === 0 && connectedDomains.length) problems.push(`custom domain connected: ${connectedDomains.join(", ")}`);
  else if (domainList.exitCode !== 0 || !domainListOutput.split("\n").some((line) => line.trim() === NO_CUSTOM_DOMAINS_LINE)) problems.push(`couldn't check its custom domains (${wranglerFailure(domainList)})`);
  return problems;
}

// ---- The runners ----

const passed = (name, isSecurity, note) => ({ name, isPass: true, isSecurity, isChecked: true, note });
const failed = (name, isSecurity, problems) => ({ name, isPass: false, isSecurity, isChecked: true, note: `${name}: ${problems.join(", ")}` });
const unchecked = (name, isSecurity, problems) => ({ ...failed(name, isSecurity, problems), isChecked: false });

/** fetch without following redirects, except to the same origin when isSameOriginRedirectFollowed (up to MAXIMUM_REDIRECT_COUNT). */
async function fetchOnce(url, requestInit, isSameOriginRedirectFollowed) {
  let address = url;
  for (let redirectCount = 0; ; redirectCount++) {
    const response = await fetch(address, { ...requestInit, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const location = response.headers.get("location");
    if (!isSameOriginRedirectFollowed || response.status < 300 || response.status > 399 || !location || redirectCount === MAXIMUM_REDIRECT_COUNT) return response;
    const next = new URL(location, address);
    if (next.origin !== new URL(url).origin) return response;
    address = next.href;
  }
}

/**
 * One address with its tries. A thrown fetch and a status of 500 or more are always retried; a problem
 * on any other answer only when isRetriedOnProblem. Answers { problems, response, body, error }.
 */
async function probe(url, requestInit, findProblems, { isRetriedOnProblem = true, isSameOriginRedirectFollowed = false, attemptCount = ATTEMPT_COUNT, retryWaitMs = RETRY_WAIT_MS } = {}) {
  let last = { problems: [], response: null, body: "", error: null };
  for (let attempt = 0; attempt < attemptCount; attempt++) {
    if (attempt) await wait(retryWaitMs);
    try {
      const response = await fetchOnce(url, requestInit, isSameOriginRedirectFollowed);
      const body = await response.text();
      last = { problems: findProblems(response, body), response, body, error: null };
      if (!last.problems.length) return last;
      if (response.status < 500 && !isRetriedOnProblem) return last;
    } catch (error) {
      last = { problems: [error.message], response: null, body: "", error };
    }
  }
  return last;
}

/** How many keys a JWKS answer lists, 0 when it isn't one. */
export function publishedKeyCount(body) {
  try {
    const { keys } = JSON.parse(body);
    return Array.isArray(keys) ? keys.length : 0;
  } catch {
    return 0;
  }
}

/** findProblems(response, body) answers a list. A pass note is `<name> <status>` (just `<name>` for a security check). */
export async function checkUrl(name, url, requestInit, findProblems, { isSecurity = false, passNote = "", ...retryOptions } = {}) {
  const result = await probe(url, requestInit, findProblems, retryOptions);
  if (!result.problems.length) return passed(name, isSecurity, isSecurity ? `${name}${passNote}` : `${name} ${result.response.status}${passNote}`);
  if (isSecurity) return failed(name, true, result.problems);
  // The existing non-security checks keep their detail: the status and the start of the body.
  const detail = result.response ? `${result.response.status} ${result.body.slice(0, 120).replace(/\s+/g, " ")}` : result.error.message;
  return { name, isPass: false, isSecurity: false, isChecked: true, note: `${name} ${detail}` };
}

/** runWrangler(argumentList) answers { exitCode, output }. Every bucket in the account is checked. */
export function checkBuckets(runWrangler) {
  const list = runWrangler(["r2", "bucket", "list"]);
  const names = list.exitCode === 0 ? bucketNames(list.output) : [];
  if (!names.length) return [unchecked("R2 buckets", true, [`couldn't list them (${list.exitCode === 0 ? "no buckets" : wranglerFailure(list)})`])];
  return names.map((bucket) => {
    const devUrl = runWrangler(["r2", "bucket", "dev-url", "get", bucket]);
    const domains = runWrangler(["r2", "bucket", "domain", "list", bucket]);
    const problems = bucketAccessProblems(devUrl, domains);
    if (!problems.length) return passed(`bucket ${bucket}`, true, `bucket ${bucket} private`);
    return problems.every((problem) => problem.startsWith("couldn't check")) ? unchecked(`bucket ${bucket}`, true, problems) : failed(`bucket ${bucket}`, true, problems);
  });
}

async function checkPrivateCheckGame({ zaismaKey, ...retryOptions }) {
  const name = "private check game";
  const slug = PRIVATE_CHECK_GAME_SLUG;
  const addresses = [`${SITE_URL}/g/${slug}`, `https://${slug}.${GAME_DOMAIN}/`, `https://${slug}.${GAME_DOMAIN}/index.html`, `https://${slug}--preview.${GAME_DOMAIN}/`, `https://${slug}--tester.${GAME_DOMAIN}/`];
  const problems = [];
  const answers = await Promise.all(addresses.map((address) => probe(address, {}, privateAddressProblems, { ...retryOptions, isRetriedOnProblem: false })));
  answers.forEach((answer, index) => {
    for (const problem of answer.problems) problems.push(`${addresses[index]} ${problem}`);
  });
  if (zaismaKey) {
    const api = await probe(`${SITE_URL}/api/dev/games/${slug}`, { headers: { authorization: `Bearer ${zaismaKey}` } }, () => [], { ...retryOptions, isRetriedOnProblem: false });
    if (!api.response || api.response.status !== 200) problems.push(`the API answered ${api.response?.status ?? api.error?.message} for ${slug}`);
    else {
      let body = {};
      try {
        body = JSON.parse(api.body);
      } catch {}
      const game = body.game ?? {};
      const hasLiveVersion = Array.isArray(body.versions) ? body.versions.some((version) => version.is_live === true) : false;
      if (game.visibility !== "private" || game.review_status !== "live" || !hasLiveVersion) {
        problems.push(`${slug} isn't a private live game (visibility ${game.visibility}, review_status ${game.review_status}): put it back with update_game and publish_version`);
      }
    }
  }
  if (problems.length) return failed(name, true, problems);
  return passed(name, true, zaismaKey ? `${name} closed (5 addresses, confirmed private)` : `${name} closed (5 addresses; not confirmed private: no ZAISMA_KEY)`);
}

export async function checkSecurityAddresses({ zaismaKey, attemptCount = ATTEMPT_COUNT, retryWaitMs = RETRY_WAIT_MS, hashSources } = {}) {
  const retryOptions = { attemptCount, retryWaitMs };
  const allowedHashSources = hashSources ?? (await firstPaintHashSources());
  const security = { isSecurity: true, ...retryOptions };
  const headerCheck = (findHeaderProblems) => (response) => (response.status === 200 ? findHeaderProblems(response.headers) : [`answered ${response.status}`]);
  return Promise.all([
    checkUrl("zaisma.com headers", `${SITE_URL}/`, {}, headerCheck((headers) => siteHeaderProblems(headers, allowedHashSources)), security),
    checkUrl("game page headers", `${SITE_URL}/g/${CHECK_GAME_SLUG}`, {}, headerCheck((headers) => siteHeaderProblems(headers, allowedHashSources)), security),
    // The game's page, at its version's own address.
    checkUrl("game domain headers", CHECK_GAME_URL, {}, headerCheck(gameHeaderProblems), { ...security, isSameOriginRedirectFollowed: true }),
    checkUrl("zaisma.com over http", `http://zaisma.com/g/${CHECK_GAME_SLUG}?from=ship`, {}, (response) => httpsRedirectProblems(response, `${SITE_URL}/g/${CHECK_GAME_SLUG}?from=ship`), security),
    checkUrl("game domain over http", `http://${CHECK_GAME_SLUG}.${GAME_DOMAIN}/`, {}, (response) => httpsRedirectProblems(response, CHECK_GAME_URL), security),
    checkPrivateCheckGame({ zaismaKey, ...retryOptions }),
    (async () => {
      const addresses = [BACKUP_BUCKET_URL, `${BACKUP_BUCKET_URL}main-database.sql`];
      const answers = await Promise.all(addresses.map((address) => probe(address, {}, backupBucketProblems, { ...retryOptions, isRetriedOnProblem: false })));
      const problems = answers.flatMap((answer, index) => answer.problems.map((problem) => `${addresses[index]} ${problem}`));
      return problems.length ? failed("backups bucket", true, problems) : passed("backups bucket", true, "backups bucket private");
    })(),
    (async () => {
      const [page, mcp] = await Promise.all([
        probe(`${SITE_URL}/admin`, {}, adminAccessProblems, { ...retryOptions, isRetriedOnProblem: false }),
        probe(`${SITE_URL}/admin/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, adminAccessProblems, { ...retryOptions, isRetriedOnProblem: false }),
      ]);
      const problems = [...page.problems.map((problem) => `GET /admin ${problem}`), ...mcp.problems.map((problem) => `POST /admin/mcp ${problem}`)];
      return problems.length ? failed("/admin", true, problems) : passed("/admin", true, "/admin behind Cloudflare Access");
    })(),
  ]);
}

/**
 * Waits for npm to have a package's version, which its publish workflow (workflowUrl) puts there from main.
 * readPublishRunStatus answers the status of that workflow's run for the shipped commit ("queued", "in_progress",
 * "completed", …), PUBLISHED_RUN_STATUS once it finished and passed, or null when there's none to read.
 */
export async function checkPackageOnNpm(packageName, version, workflowUrl, { waitSec = PUBLISH_WAIT_SEC, longestWaitSec = PUBLISH_LONGEST_WAIT_SEC, pollSec = PUBLISH_POLL_SEC, readPublishRunStatus = async () => null } = {}) {
  const name = `${packageName} on npm`;
  const started = Date.now();
  let runStatus = null;
  for (;;) {
    try {
      const response = await fetch(`${NPM_REGISTRY_URL}/${packageName.replace("/", "%2f")}/${version}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status === 200) return passed(name, false, `${packageName} ${version} on npm`);
    } catch {}
    const waitedMs = Date.now() - started;
    if (waitedMs >= waitSec * 1000) {
      if (waitSec === 0 || waitedMs >= longestWaitSec * 1000) break;
      runStatus = await readPublishRunStatus().catch(() => null);
      if (!PUBLISH_RUNNING_STATUSES.includes(runStatus) && runStatus !== PUBLISHED_RUN_STATUS) break;
    }
    await wait(pollSec * 1000);
  }
  const waitedMin = Math.round((Date.now() - started) / 60_000);
  let note = `${packageName} ${version} not on npm after ${waitedMin} min: see ${workflowUrl}`;
  if (waitSec === 0) note = `${packageName} ${version} not on npm yet (its publish workflow puts it there from main)`;
  else if (runStatus === PUBLISHED_RUN_STATUS) note = `${packageName} ${version} published by its run but npm still isn't serving it after ${waitedMin} min: see ${workflowUrl}`;
  else if (PUBLISH_RUNNING_STATUSES.includes(runStatus)) note = `${packageName} ${version} still publishing after ${waitedMin} min (its run is ${runStatus.replace("_", " ")}): see ${workflowUrl}`;
  return { name, isPass: false, isSecurity: false, isChecked: true, note };
}
