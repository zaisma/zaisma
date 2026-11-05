#!/usr/bin/env node
// CI's ceiling and warning line. Plain JavaScript with no packages, so it runs from a sparse checkout before npm ci.
//
//   node scripts/ci-time-limit.mjs --check    In "Tests and typecheck": fails this run when it took over CI_CEILING_SEC, naming its slowest job.
//   node scripts/ci-time-limit.mjs --report   Each night: the slowest tenth of the last RECENT_RUN_COUNT runs, and a push to Julius when it's over
//                                             CI_WARNING_SEC, while there's still room to optimize. Nothing fails for it.
//
// Over the ceiling, the answer is to make CI faster without cutting a check, never to raise the number. test/node/ci-time-limit.test.ts holds each
// job's own time limit in .github/workflows/check.yml to the same line.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_CEILING_SEC = 300;
export const CI_WARNING_SEC = 240;
export const RECENT_RUN_COUNT = 50;
const API_TRY_COUNT = 3;
const CHECK_JOB_NAME = "Tests and typecheck";

/** A length of time as 4:05. */
export function clockText(durationSec) {
  const wholeSec = Math.round(durationSec);
  return `${Math.floor(wholeSec / 60)}:${String(wholeSec % 60).padStart(2, "0")}`;
}

const secBetween = (startedAt, endMs) => (endMs - Date.parse(startedAt)) / 1000;
const hasRun = (job) => job.started_at && job.completed_at && !["skipped", "cancelled"].includes(job.conclusion);

/** The job that took longest, as { name, duration_sec }, or null when none finished. */
export function slowestJob(jobs) {
  return jobs.filter(hasRun).map((job) => ({ name: job.name, duration_sec: secBetween(job.started_at, Date.parse(job.completed_at)) })).sort((first, second) => second.duration_sec - first.duration_sec)[0] ?? null;
}

/** How a run stands against the ceiling: { is_over_ceiling, elapsed_sec, line }, the line being what the log says. */
export function ceilingVerdict({ runStartedAt, nowMs, jobs }) {
  const elapsedSec = secBetween(runStartedAt, nowMs);
  const isOverCeiling = elapsedSec > CI_CEILING_SEC;
  const slowest = slowestJob(jobs);
  const slowestWords = slowest ? ` Its slowest job: ${slowest.name}, ${clockText(slowest.duration_sec)}.` : "";
  return {
    is_over_ceiling: isOverCeiling,
    elapsed_sec: elapsedSec,
    line: isOverCeiling
      ? `This run took ${clockText(elapsedSec)}, over CI's ${clockText(CI_CEILING_SEC)} ceiling.${slowestWords} Make it faster without cutting a check; the ceiling doesn't move.`
      : `This run took ${clockText(elapsedSec)} of CI's ${clockText(CI_CEILING_SEC)}.${slowestWords}`,
  };
}

/** How long a finished run took: from its start to its last job's end, since a run's own updated_at moves long after it ends. Null when no job ran. */
export function finishedRunSec(runStartedAt, jobs) {
  const endsMs = jobs.filter(hasRun).map((job) => Date.parse(job.completed_at));
  return endsMs.length ? secBetween(runStartedAt, Math.max(...endsMs)) : null;
}

/** What the slowest tenth of these runs start from, in seconds. */
export function slowestTenthSec(durationsSec) {
  const sorted = [...durationsSec].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length * 0.9)];
}

/** The night's reading: { is_over_warning, line }. A run a newer push cancelled says nothing, and isn't in durationsSec. */
export function warningVerdict(durationsSec) {
  const slowestTenth = slowestTenthSec(durationsSec);
  const isOverWarning = slowestTenth > CI_WARNING_SEC;
  return {
    is_over_warning: isOverWarning,
    line: `The slowest tenth of the last ${durationsSec.length} CI runs start at ${clockText(slowestTenth)}${isOverWarning ? `, past the ${clockText(CI_WARNING_SEC)} warning line: time to optimize, before the ${clockText(CI_CEILING_SEC)} ceiling.` : `, under the ${clockText(CI_WARNING_SEC)} warning line.`}`,
  };
}

async function github(path) {
  let lastError;
  for (let tryNumber = 1; tryNumber <= API_TRY_COUNT; tryNumber++) {
    try {
      const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, { headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: "application/vnd.github+json" } });
      if (response.ok) return await response.json();
      lastError = new Error(`GitHub answered ${response.status} to ${path}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 2000 * tryNumber));
  }
  throw lastError;
}

async function check() {
  const attemptPath = `actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`;
  let attempt, jobs;
  try {
    attempt = await github(attemptPath);
    jobs = (await github(`${attemptPath}/jobs?per_page=100`)).jobs.filter((job) => job.name !== CHECK_JOB_NAME);
  } catch (error) {
    // GitHub's own trouble isn't the change's: each job's time limit still holds, and the night reads this run.
    console.log(`Couldn't read this run's time from GitHub, so it's not held to the ceiling: ${error.message}`);
    return;
  }
  const verdict = ceilingVerdict({ runStartedAt: attempt.run_started_at, nowMs: Date.now(), jobs });
  console.log(verdict.is_over_ceiling ? `::error::${verdict.line}` : verdict.line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verdict.line}\n`);
  if (verdict.is_over_ceiling) process.exitCode = 1;
}

/** The push to Julius when CI passes its warning line. */
export const warningPush = (line) => ({ title: "CI is growing", message: line, priority: 0 });

/** Runs the report and turns anything it throws into a warning: a failed run here would read as a failed sweep and stop npm run ship. */
export async function reportWithoutFailing(runReport = report) {
  try {
    await runReport();
  } catch (error) {
    console.log(`::warning::The CI time report didn't finish: ${error.message}`);
  }
}

async function report() {
  const { workflow_runs: runs } = await github(`actions/workflows/check.yml/runs?status=completed&per_page=100`);
  const durationsSec = [];
  for (const run of runs) {
    if (durationsSec.length === RECENT_RUN_COUNT) break;
    if (!["pull_request", "merge_group"].includes(run.event) || run.conclusion === "cancelled") continue;
    const durationSec = finishedRunSec(run.run_started_at, (await github(`actions/runs/${run.id}/jobs?per_page=100`)).jobs);
    if (durationSec !== null) durationsSec.push(durationSec);
  }
  if (!durationsSec.length) return console.log("No finished CI runs to read.");
  const verdict = warningVerdict(durationsSec);
  console.log(verdict.line);
  if (verdict.is_over_warning && process.env.PUSHOVER_USER_KEY && process.env.PUSHOVER_APP_TOKEN) {
    // Loaded only here, so the required check's --check depends on nothing beyond this file.
    const { sendPushover } = await import("./watch-checks.mjs");
    await sendPushover({ userKey: process.env.PUSHOVER_USER_KEY, appToken: process.env.PUSHOVER_APP_TOKEN }, warningPush(verdict.line));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = process.argv[2];
  if (flag === "--check") await check();
  else if (flag === "--report") await reportWithoutFailing();
  else {
    console.error("Use: node scripts/ci-time-limit.mjs --check | --report");
    process.exit(2);
  }
}
