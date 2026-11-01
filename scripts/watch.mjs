// One run of the checker outside Cloudflare, every 5 minutes from .github/workflows/watch.yml.
// Prints each check, keeps its state in WATCH_STATE_FILE (the workflow caches that folder between runs; it's saved
// at the end of every run whose pushes went out), and pushes Julius through Pushover (PUSHOVER_USER_KEY,
// PUSHOVER_APP_TOKEN). With CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_OUTSIDE_WATCH_TOKEN it also watches the Cloudflare
// account's members and API tokens (checkCloudflareAccount). Exits 1 only when it couldn't push, so a broken alert path
// shows up as a failed run; a site that's down is not a failed run (GitHub would email every 5 minutes).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLOUDFLARE_WATCH_STARTED_OVER_PUSH, checkCloudflareAccount, emptyWatchState, nextWatchStep, runWatchChecks, sendPushover } from "./watch-checks.mjs";

const stateFile = process.env.WATCH_STATE_FILE ?? ".watch-state/state.json";
const userKey = process.env.PUSHOVER_USER_KEY;
const appToken = process.env.PUSHOVER_APP_TOKEN;
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cloudflareToken = process.env.CLOUDFLARE_OUTSIDE_WATCH_TOKEN;

/** The last run's state; isMissing when there's no file at all (the first run, or GitHub dropped the cache). */
function readState() {
  try {
    return { state: { ...emptyWatchState(), ...JSON.parse(readFileSync(stateFile, "utf8")) }, isMissing: false };
  } catch {
    return { state: emptyWatchState(), isMissing: true };
  }
}

const nowMs = Date.now();
const { state: lastState, isMissing } = readState();
const results = await runWatchChecks();
for (const result of results) console.log(`${result.isPass ? "✓" : "✗"} ${result.note}`);
const cloudflare = cloudflareAccountId && cloudflareToken ? await checkCloudflareAccount(lastState, { accountId: cloudflareAccountId, token: cloudflareToken }, nowMs) : null;
for (const note of cloudflare?.failedNotes ?? []) console.log(`✗ ${note}`);
const failedNotes = [...results.filter((result) => !result.isPass).map((result) => result.note), ...(cloudflare?.failedNotes ?? [])];
const { state, push } = nextWatchStep(lastState, failedNotes, nowMs);
// A missing state file is a new baseline for the Cloudflare watch: Julius hears that once.
const pushes = [...(push ? [push] : []), ...(cloudflare?.pushes ?? []), ...(cloudflare && isMissing ? [CLOUDFLARE_WATCH_STARTED_OVER_PUSH] : [])];

for (const each of pushes) {
  console.log(`Push (priority ${each.priority}): ${each.title}. ${each.message}`);
  if (!userKey || !appToken) {
    console.error("PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN aren't set: nothing was pushed.");
    process.exit(1);
  }
  try {
    await sendPushover({ userKey, appToken }, each);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }
}

// Saved last: a push that failed leaves the old state, so the next run tries to tell Julius again.
const cloudflareState = cloudflare
  ? { cloudflareItemIds: cloudflare.cloudflareItemIds, cloudflareCheckedAtMs: cloudflare.checkedAtMs }
  : { cloudflareItemIds: lastState.cloudflareItemIds, cloudflareCheckedAtMs: lastState.cloudflareCheckedAtMs };
mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, JSON.stringify({ ...state, ...cloudflareState }));
