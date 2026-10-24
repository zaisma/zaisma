#!/usr/bin/env node
// The preview in one step, for build sessions and anyone with several checkouts:
//   npm run preview:start [-- --reset] [--engines-only] [--local]
//                                        starts this checkout's preview in the background on the first
//                                        free port offset (8800, 8900, …), waits until it's ready and
//                                        prints its links and sign-ins. Already running: just prints them.
//                                        Stopped or broken: stops what's left and starts it again.
//                                        Over the memory cap on every preview on this machine (memory.mjs): it
//                                        waits in line, says its place and why, and starts by itself when there's
//                                        room. Its place is kept when this command ends; run it again to follow it.
//                                        --engines-only seeds only the engine samples (what npm run engines:play
//                                        plays, for GitHub's Engine exports jobs, each ENGINE_SAMPLE_SHARD's share
//                                        of them) instead of all the test data.
//                                        When this Mac is on a tailnet with HTTPS on (phone.mjs), its links are the
//                                        Mac's tailnet name over HTTPS, which open on a phone too; --local (and
//                                        --engines-only) keeps it on localhost.
//   npm run preview:stop                 stops this checkout's preview (or takes it out of the line), and nothing of another checkout's.
//   npm run preview:list                 every preview and test run on this machine, from any checkout: its address or
//   (or npm run test:list)               folder, how long it's been up, the memory it takes and how to stop it; all of
//                                        them against the cap, and the line.
// Its output goes to .wrangler/preview-run/preview.log; the servers' own log is .wrangler/preview/servers.log.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { capSourceText, DEFAULT_AWAKE_SIZE_BYTES, durationText, isAlive, leaveLine, LINE_DIRECTORY, listeners, measurePreviews, memoryCap, nextTurn, OFFSETS, placeText, readLine, sizeText, testRunSizeBytes, waitingInOrder, withLock, WORKERS_TEST_FILE_SIZE_BYTES, writeLine } from "./memory.mjs";
import { serveOnTailnet, stopServingOnTailnet, tailnetHost } from "./phone.mjs";
import { PASSWORD, SIGN_INS } from "./sign-ins.mjs";

const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../.."));
const RUN = join(ROOT, ".wrangler/preview-run");
const STATE_FILE = join(RUN, "state.json");
const LOG = join(RUN, "preview.log");
const PAGES = join(RUN, "pages.txt");
// run.mjs writes this once the test data is in; engine-only data starts with "engines-only".
const SEEDED = join(ROOT, ".wrangler/preview/seeded");
// run.mjs prints this once everything is up and the test data is in.
const READY_LINE = "Zaisma preview is running.";
// From its turn in the line for memory: the wait in line has no limit.
const READY_TIMEOUT_MS = 9 * 60_000;
// Every port run.mjs takes, for an offset (keep in step with its PORTS and inspector ports).
const portsFor = (offset) => [8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8799, 8800, 8801, 8802, 9340, 9341, 9342].map((port) => port + offset);
// Where a browser opens it: this Mac's tailnet name when the preview is on a phone (phoneHost), else localhost.
const addressFor = (port, phoneHost) => (phoneHost ? `https://${phoneHost}:${port}` : `http://localhost:${port}`);
const siteFor = (offset, phoneHost = null) => addressFor(8800 + offset, phoneHost);
const show = (path) => relative(process.cwd(), path) || ".";

const [command = "start", ...flags] = process.argv.slice(2);
if (command === "start") await start();
else if (command === "stop") console.log({ stopped: "Stopped this checkout's preview.", left_line: "Took this checkout's preview out of the line for memory." }[await stop()] ?? "This checkout's preview wasn't running.");
else if (command === "list") list();
else {
  console.error(`Unknown command "${command}". Use: npm run preview:start [-- --reset] [--engines-only], npm run preview:stop or npm run preview:list`);
  process.exit(1);
}

async function start() {
  let reset = flags.includes("--reset");
  const enginesOnly = flags.includes("--engines-only");
  const unknown = flags.filter((flag) => flag !== "--reset" && flag !== "--engines-only" && flag !== "--local");
  if (unknown.length) {
    console.error(`Unknown option ${unknown.join(" ")}. The options are --reset (fresh test data), --engines-only (only the engine samples as test data) and --local (links on localhost only, not on the phone).`);
    process.exit(1);
  }
  // On the phone when Tailscale can carry it; --local and the engine samples (GitHub's jobs) stay on localhost.
  const phone = flags.includes("--local") || enginesOnly ? { host: null, reason: null } : tailnetHost();
  // Engine-only data is a different set of test data: asking for the other kind starts fresh.
  if (!reset && !enginesOnly && readSeeded().startsWith("engines-only")) {
    console.log("The test data is the engine samples only, so this start makes the full test data.");
    reset = true;
  }
  let cap;
  try {
    cap = memoryCap();
  } catch (error) {
    fail(error.message);
  }
  const state = readState();
  // Asleep, it answers once it has woken up (run.mjs): a few seconds, longer on a busy machine, or once its turn to wake comes.
  // Running on another address than this start's (Tailscale came on or went off, or --local) starts it again there.
  const isSameAddress = (state?.phone_host ?? null) === phone.host;
  if (!reset && state && isSameAddress && isAlive(state.pid) && readLog().includes(READY_LINE) && (await answers(siteFor(state.offset), 120_000))) {
    printReady(state.offset, "already running", phone);
    return;
  }
  // Waiting in line for memory: it keeps its place, and this follows it again.
  if (!reset && state && isAlive(state.pid) && isWaitingInLine(state.pid)) {
    console.log(`This checkout's preview is waiting in line for memory, to start on ${siteFor(state.offset, state.phone_host)}…`);
    await follow(state.pid, state.offset, "Waiting in line");
    printReady(state.offset, "started", phone);
    return;
  }
  if (await stop()) console.log("Stopped what was left of this checkout's last preview.");

  // Stopped while adding test data: a second go would add it twice, so it starts from fresh data.
  if (!reset && existsSync(join(ROOT, ".wrangler/preview")) && !existsSync(join(ROOT, ".wrangler/preview/seeded"))) {
    console.log("The last start stopped while adding test data, so this one starts with fresh test data.");
    reset = true;
  }
  mkdirSync(RUN, { recursive: true });
  const log = openSync(LOG, "w");
  const startPreview = async (takenOffsets) => {
    const offset = await freeOffset(state?.offset, takenOffsets);
    if (offset === undefined) return {};
    const serveProblem = phone.host && serveOnTailnet(offset);
    if (serveProblem) {
      stopServingOnTailnet(offset);
      phone.reason = `Tailscale Serve said: ${serveProblem}`;
      phone.host = null;
    }
    // Its own process group, so stopping it also stops wrangler and workerd under it.
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "scripts/preview/run.mjs"), ...(reset ? ["--reset"] : []), ...(enginesOnly ? ["--engines-only"] : [])], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, PREVIEW_PORT_OFFSET: String(offset), PREVIEW_PHONE_HOST: phone.host ?? "" },
    });
    child.unref();
    return { child, offset };
  };
  // With a cap, the offset is picked and the start joins the line under the line's lock, so two checkouts starting at once
  // never pick the same one, and a preview waiting in line keeps its offset while it holds no port yet.
  const { child, offset } = cap.capBytes
    ? await withLock(async () => {
        const line = readLine();
        const entries = line.entries.filter((entry) => isAlive(entry.pid));
        const started = await startPreview(new Set(entries.map((entry) => entry.offset)));
        if (started.child) writeLine({ ...line, entries: [...entries, { pid: started.child.pid, folder: ROOT, offset: started.offset, kind: "start", asked_at_ms: Date.now(), turn_given_at_ms: null }] });
        return started;
      })
    : await startPreview(new Set());
  if (offset === undefined) fail(`No free ports: every offset from 8800 to 9700 is taken. See what holds them with: lsof -nP -iTCP:8800 -sTCP:LISTEN`);
  writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, offset, phone_host: phone.host, started_at: new Date().toISOString() }));
  console.log(`Starting the preview on ${siteFor(offset, phone.host)}${reset ? " with fresh test data (a few minutes)" : ""}${enginesOnly ? ", the engine samples only" : ""}…`);
  await follow(child.pid, offset);
  printReady(offset, "started", phone);
}

/** Prints the preview's progress lines from its log until it's ready: all of them, or from the last one starting with fromLast. */
async function follow(pid, offset, fromLast) {
  let clockStartedAtMs = Date.now();
  let shownLength = fromLast ? Math.max(0, readLog().lastIndexOf(fromLast)) : 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    const text = readLog();
    // Its progress lines, up to the banner (which pages.txt keeps).
    const upTo = text.includes(READY_LINE) ? text.indexOf(READY_LINE) : text.lastIndexOf("\n") + 1;
    if (upTo > shownLength) {
      for (const line of text.slice(shownLength, upTo).split("\n")) if (line.trim()) console.log(`  ${line.trim()}`);
      shownLength = upTo;
    }
    if (text.includes(READY_LINE) && (await answers(siteFor(offset)))) break;
    if (!isAlive(pid)) {
      await stop();
      fail("The preview stopped while starting.", text);
    }
    if (isWaitingInLine(pid)) clockStartedAtMs = Date.now();
    if (Date.now() - clockStartedAtMs > READY_TIMEOUT_MS) {
      await stop();
      fail(`The preview wasn't ready ${READY_TIMEOUT_MS / 60_000} minutes after it started, so it was stopped.`, text);
    }
  }
}

/** Whether this process (a preview's run.mjs) is in the line for memory, its turn still to come. */
function isWaitingInLine(pid) {
  return readLine().entries.some((entry) => entry.pid === pid && entry.turn_given_at_ms === null);
}

/**
 * Stops this checkout's preview: its process group, then anything of this checkout's still holding a preview port, and takes it
 * out of the line for memory. "stopped" when something was running, "left_line" when it was waiting in line, else false.
 */
async function stop() {
  const state = readState();
  let stopped = false;
  if (state && hasGroup(state.pid)) {
    stopped = isWaitingInLine(state.pid) ? "left_line" : "stopped";
    killGroup(state.pid, "SIGTERM");
    for (let i = 0; i < 20 && hasGroup(state.pid); i++) await new Promise((r) => setTimeout(r, 250));
    killGroup(state.pid, "SIGKILL");
  }
  if (state?.phone_host) stopServingOnTailnet(state.offset);
  // Servers that outlived their group (an older preview started by hand, or one killed hard).
  const left = ourListeners();
  if (left.length) {
    stopped ||= "stopped";
    for (const pid of left) killPid(pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    for (const pid of ourListeners()) killPid(pid, "SIGKILL");
  }
  // Its run.mjs is gone, so the line would drop it at its next look anyway; this lets the next one's turn come at once.
  // This checkout's preview entries only: its test runs keep their places.
  if (existsSync(join(LINE_DIRECTORY, "line.json"))) await leaveLine((entry) => (entry.kind !== "test" && entry.folder === ROOT) || entry.pid === state?.pid);
  rmSync(STATE_FILE, { force: true });
  return stopped;
}

/**
 * Prints every preview on this machine, from any checkout: each one's run.mjs and everything under it, with the memory it
 * takes (memory.mjs measures it), all of them against the memory cap, then the line for memory.
 */
function list() {
  let cap;
  try {
    cap = memoryCap();
  } catch (error) {
    fail(error.message);
  }
  const line = readLine();
  const entries = line.entries.filter((entry) => isAlive(entry.pid));
  const { previews, testRuns } = measurePreviews(entries);
  const awakeSizeBytes = line.awake_size_bytes ?? DEFAULT_AWAKE_SIZE_BYTES;
  const capText = cap.capBytes ? `of the ${sizeText(cap.capBytes)} memory cap (${capSourceText(cap.source)})` : `with no memory cap (${cap.source === "not_macos" ? "there's none off macOS" : `${capSourceText(cap.source)} is 0`})`;
  if (!previews.length && !testRuns.length) return console.log(`No preview or test run is going on this machine, and none is waiting in line. Memory: 0 MB ${capText}.`);
  const waiting = waitingInOrder(entries);
  // A preview's entry is its run.mjs's (another process can hold the offset an entry waits for).
  const entryOf = (preview) => entries.find((entry) => entry.pid === preview.rootPid);
  const shownFolder = (folder) => (folder === ROOT ? `${folder} (this checkout)` : (folder ?? "(its folder is unknown)"));
  const { usedBytes, keptBytes } = nextTurn({ entries, previews, testRuns, capBytes: cap.capBytes, awakeSizeBytes });
  const running = previews.filter((preview) => preview.isListening || entryOf(preview)?.turn_given_at_ms !== null);
  if (running.length) console.log(`${running.length === 1 ? "One preview is" : `${running.length} previews are`} running on this machine:\n`);
  for (const preview of running) {
    const entry = entryOf(preview);
    const isAsleep = !preview.isAwake && /Asleep at [^\n]*\n(?![\s\S]*Waking up at)/.test(readText(join(preview.folder ?? "", ".wrangler/preview-run/preview.log")));
    const stateText =
      entry?.turn_given_at_ms !== null && entry?.kind === "start" ? `starting, about ${sizeText(Math.max(0, awakeSizeBytes - preview.sizeBytes))} more kept for it`
      : entry?.turn_given_at_ms !== null && entry?.kind === "wake" ? "waking up"
      : entry ? `asleep, ${placeText(waiting.indexOf(entry) + 1)} in line to wake`
      : isAsleep ? "asleep: opening a page wakes it"
      : !preview.isAwake ? "starting"
      : "";
    console.log(`  ${siteFor(preview.offset, phoneHostOf(preview.folder))}  ${shownFolder(preview.folder)}${stateText ? `  ${stateText}` : ""}`);
    console.log(`    up ${preview.upFor ? upForText(preview.upFor) : "?"}, ${sizeText(preview.sizeBytes)} in ${preview.processCount === 1 ? "1 process" : `${preview.processCount} processes`}. Stop it: npm --prefix "${preview.folder}" run preview:stop`);
  }
  const runningTests = testRuns.filter((run) => run.isRunning);
  if (runningTests.length) console.log(`${running.length ? "\n" : ""}${runningTests.length === 1 ? "One test run is" : `${runningTests.length} test runs are`} going on this machine:\n`);
  for (const run of runningTests) {
    console.log(`  tests in ${shownFolder(run.folder)}, ${run.workerCount === 1 ? "one file at a time" : `${run.workerCount} files at once`}`);
    console.log(`    up ${run.upFor ? upForText(run.upFor) : "?"}, ${sizeText(run.sizeBytes)} in ${run.processCount === 1 ? "1 process" : `${run.processCount} processes`}. Stop it: Ctrl+C where it runs, or kill ${run.pid}`);
  }
  console.log(`\nAll together: ${sizeText(usedBytes)}${keptBytes ? `, and ${sizeText(keptBytes)} kept for previews starting or waking and test runs growing` : ""}, ${capText}.`);
  if (cap.capBytes) console.log(`The cap: PREVIEW_MEMORY_CAP_BYTES for one shell, or { "memory_cap_bytes": … } in ${join(LINE_DIRECTORY, "settings.json")} for this machine.`);
  if (!waiting.length) return;
  console.log(`\nWaiting in line for memory, each starting by itself when there's room (an awake preview takes about ${sizeText(awakeSizeBytes)} here, a test run ${sizeText(testRunSizeBytes(1))} and ${sizeText(WORKERS_TEST_FILE_SIZE_BYTES)} more for each Workers file at once):\n`);
  for (const [index, entry] of waiting.entries()) {
    const askedText = `asked ${durationText(Date.now() - entry.asked_at_ms)} ago`;
    if (entry.kind === "test") {
      console.log(`  ${index + 1}. tests in ${shownFolder(entry.folder)}, ${askedText} (up to ${entry.requested_worker_count === 1 ? "one file at a time" : `${entry.requested_worker_count} files at once`})`);
      console.log(`     Take it out: Ctrl+C where it runs, or kill ${entry.pid}`);
      continue;
    }
    const preview = previews.find((each) => each.offset === entry.offset);
    console.log(`  ${index + 1}. ${siteFor(entry.offset, phoneHostOf(entry.folder))}  ${shownFolder(entry.folder)}  ${entry.kind === "wake" ? `to wake: someone opened a page, ${askedText}` : `to start, ${askedText}${preview ? ` (${sizeText(preview.sizeBytes)} while it waits)` : ""}`}`);
    console.log(`     Take it out: npm --prefix "${entry.folder}" run preview:stop`);
  }
}

/** ps's elapsed time ([[days-]hours:]minutes:seconds) in words: "3 h 12 min". */
function upForText(elapsed) {
  const [days, rest] = elapsed.includes("-") ? elapsed.split("-") : ["0", elapsed];
  const [seconds, minutes, hours = 0] = rest.split(":").map(Number).reverse();
  const parts = [[Number(days), "days"], [hours, "h"], [minutes, "min"]].filter(([count]) => count > 0).map(([count, unit]) => `${count} ${unit}`);
  return parts.length ? parts.join(" ") : `${seconds} s`;
}

/**
 * The first offset with none of its ports taken and not held by a preview waiting in line, trying this checkout's last one
 * first so links stay the same.
 */
async function freeOffset(last, heldOffsets) {
  const taken = new Set(listeners().map((listener) => listener.port));
  for (const offset of [...new Set([last, ...OFFSETS])].filter((offset) => OFFSETS.includes(offset) && !heldOffsets.has(offset))) {
    const ports = portsFor(offset);
    if (ports.some((port) => taken.has(port))) continue;
    // lsof only sees this user's processes; a listen check catches the rest.
    if ((await Promise.all(ports.map(canListen))).every(Boolean)) return offset;
  }
}

/** Processes listening on a preview port whose folder is this checkout. */
function ourListeners() {
  const previewPorts = new Set(OFFSETS.flatMap(portsFor));
  return inCheckout([...new Set(listeners().filter((listener) => previewPorts.has(listener.port)).map((listener) => listener.pid))]);
}

/** The ones of these processes whose folder is this checkout (not another worktree inside it). */
function inCheckout(pids) {
  if (!pids.length) return [];
  const out = spawnSync("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"], { encoding: "utf8" }).stdout ?? "";
  const ours = [];
  let pid;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) {
      const inside = relative(ROOT, line.slice(1));
      if (!inside.startsWith("..") && !inside.startsWith(".claude")) ours.push(pid);
    }
  }
  return ours;
}

/** Whether the port is free on this Mac's own addresses, where the preview listens (its tailnet address is Tailscale Serve's). */
async function canListen(port) {
  for (const address of ["127.0.0.1", "::1"]) {
    const isFree = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, address, () => server.close(() => resolve(true)));
    });
    if (!isFree) return false;
  }
  return true;
}

async function answers(url, timeoutMs = 5000) {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/** phone: this start's { host, reason }, the reason saying why the links aren't on the phone when they could have been. */
function printReady(offset, startedHow, phone) {
  const site = siteFor(offset, phone.host);
  // At localhost too (workers/router.mjs): a session's own checks open it there in the app's browser pane, which asks before every
  // step on the tailnet name but never on localhost. Passkeys work only at the address they were made on, the tailnet one.
  const phoneText = phone.host ? `Opens on your phone too, on this Mac's tailnet (Tailscale).\nFor Claude's own checks, on this Mac: ${addressFor(8800 + offset, null)} (passkeys only at the tailnet address)` : phone.reason ? `On this Mac only: ${phone.reason}. The preview skill says how to open it on a phone.` : "On this Mac only (--local).";
  const text = readLog();
  if (text.includes(READY_LINE)) writeFileSync(PAGES, text.slice(text.indexOf(READY_LINE)));
  // run.mjs says how long it waited in line for memory, when it did.
  const waited = startedHow === "started" && /^Room for it after (.+?) in line/m.exec(text.slice(0, text.indexOf(READY_LINE)))?.[1];
  const how = waited ? `started after ${waited} in line for memory` : startedHow;
  if (readSeeded().startsWith("engines-only")) {
    console.log(`\nPreview ${how}: ${site}  (the engine samples only; this checkout only, nothing touches the live site)\n\nPlay them: npm run engines:play   Stop: npm run preview:stop   All the test data: npm run preview:start -- --reset\nLog: ${show(LOG)}`);
    return;
  }
  const width = Math.max(...SIGN_INS.map((account) => account.username.length));
  console.log(`
Preview ${how}: ${site}  (this checkout only; nothing touches the live site)
${phoneText}

Sign in at ${site}/signin, password "${PASSWORD}" for every one:
${SIGN_INS.map((account) => `  ${account.username.padEnd(width)}  ${account.about}`).join("\n")}
Admin pages (${site}/admin) need no sign-in here. Email codes: ${addressFor(8795 + offset, phone.host)}

Every test page and state, with what it shows: ${show(PAGES)}
Log: ${show(LOG)}  (the servers' own: .wrangler/preview/servers.log)
It sleeps after 30 minutes with nobody looking, and the next page opened wakes it in a few seconds, data and sign-ins as they were.
Stop: npm run preview:stop   Fresh test data: npm run preview:start -- --reset   Every preview on this machine: npm run preview:list`);
}

function fail(message, logText) {
  console.error(`\n${message}`);
  if (logText) {
    console.error(`\nLast lines of ${show(LOG)}:`);
    console.error(logText.trimEnd().split("\n").slice(-30).map((line) => `  ${line}`).join("\n"));
    console.error("\nThe servers' own log: .wrangler/preview/servers.log");
  }
  process.exit(1);
}


function readState(file = STATE_FILE) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The tailnet name a checkout's preview is on, or null on localhost. */
function phoneHostOf(folder) {
  return readState(join(folder, ".wrangler/preview-run/state.json"))?.phone_host ?? null;
}

function readSeeded() {
  return existsSync(SEEDED) ? readFileSync(SEEDED, "utf8") : "";
}

function readLog() {
  return readText(LOG);
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** Whether anything of this checkout's is left in the process group the preview started (its leader may be gone, and the number reused). */
function hasGroup(pgid) {
  const members = (spawnSync("pgrep", ["-g", String(pgid)], { encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean).map(Number);
  return inCheckout(members).length > 0;
}

function killGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {}
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {}
}
