// How npm run ship (scripts/ship.mjs) gets through an interruption instead of failing on it.
//
// A Mac that sleeps mid-ship (a closed lid) freezes the ship; when it wakes, the step that was talking to Cloudflare,
// GitHub or npm finds the network gone. That step waits for the network to come back and runs again, a few times at
// most, so the ship carries on. A real failure (a check that fails, Cloudflare's 7403, a build error while the network
// is up) is never run again. When the network stays away, the ship ends `SHIP FAIL interrupted: …` (exit code 3):
// nothing went wrong, and npm run ship again picks up where it stopped.
//
// A ship killed outright picks up where it stopped too: each Worker it deployed is written down with its version
// (zaisma-ship-progress.json, beside the ship's other files in the main checkout's .git), and a ship of the same commit
// keeps every Worker whose live version is still that one instead of deploying it again. Migrations need nothing here:
// the live database lists which are applied, and the next ship applies the rest.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** How many times a step runs again after the network went away. */
export const NETWORK_RETRY_COUNT = 3;
/** How often a step that lost the network looks for it again. */
export const NETWORK_LOOK_INTERVAL_SEC = 10;
/** How many looks before a step gives up on the network: 15 minutes of the Mac being awake (a frozen Mac's timers wait too). */
export const NETWORK_LOOK_COUNT = 90;
/** The wait before running a step again when the network blinked and is already back. */
export const NETWORK_BLINK_DELAY_SEC = 10;
/** Where a ship looks for the network: any answer at all from one of them means it's there. */
export const NETWORK_PROBE_URLS = ["https://api.cloudflare.com/client/v4/", "https://api.github.com/"];
const NETWORK_PROBE_TIMEOUT_MS = 5000;
/** The ship's last line when the network stayed away, and its exit code. */
export const INTERRUPTED_LINE_START = "SHIP FAIL interrupted:";
export const INTERRUPTED_EXIT_CODE = 3;

// What git, gh, npm, wrangler and fetch print when the network went away under them.
const NETWORK_FAILURE = /\b(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EHOSTDOWN|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)\b|fetch failed|getaddrinfo|socket hang up|network is (unreachable|down)|could not resolve host|failed to connect to|connection (reset|refused|timed out)|operation timed out|error connecting to|TLS handshake timeout|unexpected disconnect|the network connection was lost|cannot connect to the docker daemon/i;
// Answers that are real whatever else the output says: Cloudflare refusing the token, or its 7403.
const REAL_FAILURE = /\b7403\b|authentication error/i;

/** Whether a failed step's output says the network went away under it (and nothing says it failed for real). */
export function isNetworkFailure(output) {
  return NETWORK_FAILURE.test(output) && !REAL_FAILURE.test(output);
}

const waitSec = (durationSec) => new Promise((resolve) => setTimeout(resolve, durationSec * 1000));

/** Whether the network is there: true once any probe address answers anything. */
export async function isOnline({ fetchAnswer = fetch, probeUrls = NETWORK_PROBE_URLS } = {}) {
  const answers = await Promise.all(
    probeUrls.map((url) =>
      fetchAnswer(url, { method: "HEAD", signal: AbortSignal.timeout(NETWORK_PROBE_TIMEOUT_MS) }).then(
        () => true,
        () => false,
      ),
    ),
  );
  return answers.includes(true);
}

/** Looks for the network every NETWORK_LOOK_INTERVAL_SEC until it's back (true) or lookCount looks found nothing (false). */
export async function waitForNetwork({ isNetworkUp = isOnline, wait = waitSec, lookCount = NETWORK_LOOK_COUNT } = {}) {
  for (let lookIndex = 0; lookIndex < lookCount; lookIndex++) {
    if (await isNetworkUp()) return true;
    await wait(NETWORK_LOOK_INTERVAL_SEC);
  }
  return isNetworkUp();
}

/**
 * Runs a step that needs the network, again after the network went away under it. attempt(retryIndex) answers
 * { exitCode, output, … }; this answers the last one, with isInterrupted: true when the network was still gone at the
 * end. A failure while the network is up that doesn't say the network went away is real: answered as it is, never run
 * again. One that says so while the network is up is a blink: run again after a short wait, and real if it stays.
 */
export async function runThroughInterruptions(label, attempt, { retryCount = NETWORK_RETRY_COUNT, isNetworkUp = isOnline, waitForNetworkBack = () => waitForNetwork({ isNetworkUp }), wait = waitSec, say = () => {} } = {}) {
  for (let retryIndex = 0; ; retryIndex++) {
    const answer = await attempt(retryIndex);
    if (answer.exitCode === 0 || REAL_FAILURE.test(answer.output)) return answer;
    const isUp = await isNetworkUp();
    if (isUp && !isNetworkFailure(answer.output)) return answer;
    if (retryIndex === retryCount) return isUp ? answer : { ...answer, isInterrupted: true };
    const why = answer.output.split("\n").find((line) => NETWORK_FAILURE.test(line))?.trim().slice(0, 160) ?? "no answer";
    if (isUp) {
      say(`While ${label}, the network blinked (${why}); trying again (${retryIndex + 1} of ${retryCount})…`);
      await wait(NETWORK_BLINK_DELAY_SEC);
      continue;
    }
    say(`While ${label}, the network went away (${why}); waiting for it to come back, then trying again (${retryIndex + 1} of ${retryCount})…`);
    if (!(await waitForNetworkBack())) return { ...answer, isInterrupted: true };
    say("The network is back.");
  }
}

/** What a ship of commitSha did before it stopped: { commit_sha, version_ids: { <worker>: <version id> }, applied_migrations }. */
export function readShipProgress(progressPath, commitSha) {
  const fresh = { commit_sha: commitSha, version_ids: {}, applied_migrations: [] };
  if (!existsSync(progressPath)) return fresh;
  try {
    const progress = JSON.parse(readFileSync(progressPath, "utf8"));
    return progress.commit_sha === commitSha ? { ...fresh, ...progress } : fresh;
  } catch {
    return fresh;
  }
}

/** Written whole and then moved into place, so a ship killed while writing leaves the last one. */
export function writeShipProgress(progressPath, progress) {
  writeFileSync(`${progressPath}.tmp`, `${JSON.stringify(progress, null, 2)}\n`);
  renameSync(`${progressPath}.tmp`, progressPath);
}

/** The one version `wrangler deployments status --json` says takes all of a Worker's traffic, or null. */
export function liveVersionIdOf(statusOutput) {
  try {
    const deployment = JSON.parse(statusOutput.slice(statusOutput.indexOf("{")));
    const versions = deployment.versions ?? [];
    return versions.length === 1 && versions[0].percentage === 100 ? versions[0].version_id : null;
  } catch {
    return null;
  }
}

/**
 * Deploys the workers in order, writing each one's version down as it goes. A Worker this commit's ship already
 * deployed, whose live version is still that one, is kept, not deployed again. deployWorker(worker) answers the new
 * version's id (null when wrangler didn't say it); readLiveVersionId(worker) answers the live one (null when unknown).
 */
export async function deployWorkers({ workers, commitSha, progressPath, deployWorker, readLiveVersionId, say = () => {} }) {
  const progress = readShipProgress(progressPath, commitSha);
  const keptWorkers = [];
  const deployedWorkers = [];
  for (const worker of workers) {
    const recordedVersionId = progress.version_ids[worker];
    if (recordedVersionId && (await readLiveVersionId(worker)) === recordedVersionId) {
      say(`Keeping ${worker}: this commit's version ${recordedVersionId.slice(0, 8)} is live already.`);
      keptWorkers.push(worker);
      continue;
    }
    const versionId = await deployWorker(worker);
    if (versionId) progress.version_ids[worker] = versionId;
    else delete progress.version_ids[worker];
    writeShipProgress(progressPath, progress);
    deployedWorkers.push(worker);
  }
  return { keptWorkers, deployedWorkers };
}
