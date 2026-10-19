// One run of the checker outside Cloudflare, every 5 minutes from .github/workflows/watch.yml.
// Prints each check, keeps its state in WATCH_STATE_FILE (the workflow caches that folder between runs, and it's saved only after a push went out), and pushes
// Julius through Pushover (PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN). Exits 1 only when it couldn't push, so a broken
// alert path shows up as a failed run; a site that's down is not a failed run (GitHub would email every 5 minutes).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptyWatchState, nextWatchStep, runWatchChecks, sendPushover } from "./watch-checks.mjs";

const stateFile = process.env.WATCH_STATE_FILE ?? ".watch-state/state.json";
const userKey = process.env.PUSHOVER_USER_KEY;
const appToken = process.env.PUSHOVER_APP_TOKEN;

function readState() {
  try {
    return { ...emptyWatchState(), ...JSON.parse(readFileSync(stateFile, "utf8")) };
  } catch {
    return emptyWatchState();
  }
}

const results = await runWatchChecks();
for (const result of results) console.log(`${result.isPass ? "✓" : "✗"} ${result.note}`);
const { state, push } = nextWatchStep(readState(), results.filter((result) => !result.isPass).map((result) => result.note), Date.now());

if (push) {
  console.log(`Push (priority ${push.priority}): ${push.title}. ${push.message}`);
  if (!userKey || !appToken) {
    console.error("PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN aren't set: nothing was pushed.");
    process.exit(1);
  }
  try {
    await sendPushover({ userKey, appToken }, push);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }
}

// Saved last: a push that failed leaves the old state, so the next run tries to tell Julius again.
mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, JSON.stringify(state));
