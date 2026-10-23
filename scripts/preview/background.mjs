#!/usr/bin/env node
// The preview in one step, for build sessions and anyone with several checkouts:
//   npm run preview:start [-- --reset] [--engines-only]
//                                        starts this checkout's preview in the background on the first
//                                        free port offset (8800, 8900, …), waits until it's ready and
//                                        prints its links and sign-ins. Already running: just prints them.
//                                        Stopped or broken: stops what's left and starts it again.
//                                        --engines-only seeds only the engine samples (what npm run engines:play
//                                        plays, for GitHub's Engine exports job) instead of all the test data.
//   npm run preview:stop                 stops this checkout's preview, and nothing of another checkout's.
//   npm run preview:list                 every preview running on this machine, from any checkout: its address, folder,
//                                        how long it's been up, the memory it takes and the command that stops it.
// Its output goes to .wrangler/preview-run/preview.log; the servers' own log is .wrangler/preview/servers.log.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
const READY_TIMEOUT_MS = 9 * 60_000;
const OFFSETS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
// Every port run.mjs takes, for an offset (keep in step with its PORTS and inspector ports).
const portsFor = (offset) => [8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8800, 8801, 8802, 9340, 9341, 9342].map((port) => port + offset);
const siteFor = (offset) => `http://localhost:${8800 + offset}`;
const show = (path) => relative(process.cwd(), path) || ".";

const [command = "start", ...flags] = process.argv.slice(2);
if (command === "start") await start();
else if (command === "stop") console.log((await stop()) ? "Stopped this checkout's preview." : "This checkout's preview wasn't running.");
else if (command === "list") list();
else {
  console.error(`Unknown command "${command}". Use: npm run preview:start [-- --reset] [--engines-only], npm run preview:stop or npm run preview:list`);
  process.exit(1);
}

async function start() {
  let reset = flags.includes("--reset");
  const enginesOnly = flags.includes("--engines-only");
  const unknown = flags.filter((flag) => flag !== "--reset" && flag !== "--engines-only");
  if (unknown.length) {
    console.error(`Unknown option ${unknown.join(" ")}. The options are --reset (fresh test data) and --engines-only (only the engine samples as test data).`);
    process.exit(1);
  }
  // Engine-only data is a different set of test data: asking for the other kind starts fresh.
  if (!reset && !enginesOnly && readSeeded().startsWith("engines-only")) {
    console.log("The test data is the engine samples only, so this start makes the full test data.");
    reset = true;
  }
  const state = readState();
  if (!reset && state && isAlive(state.pid) && (await answers(siteFor(state.offset))) && readLog().includes(READY_LINE)) {
    printReady(state.offset, "already running");
    return;
  }
  if (await stop()) console.log("Stopped what was left of this checkout's last preview.");

  // Stopped while adding test data: a second go would add it twice, so it starts from fresh data.
  if (!reset && existsSync(join(ROOT, ".wrangler/preview")) && !existsSync(join(ROOT, ".wrangler/preview/seeded"))) {
    console.log("The last start stopped while adding test data, so this one starts with fresh test data.");
    reset = true;
  }
  const offset = await freeOffset(state?.offset);
  if (offset === undefined) fail(`No free ports: every offset from 8800 to 9700 is taken. See what holds them with: lsof -nP -iTCP:8800 -sTCP:LISTEN`);
  mkdirSync(RUN, { recursive: true });
  const log = openSync(LOG, "w");
  // Its own process group, so stopping it also stops wrangler and workerd under it.
  const child = spawn(process.execPath, [join(ROOT, "scripts/preview/run.mjs"), ...(reset ? ["--reset"] : []), ...(enginesOnly ? ["--engines-only"] : [])], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PREVIEW_PORT_OFFSET: String(offset) },
  });
  child.unref();
  writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, offset, started_at: new Date().toISOString() }));
  console.log(`Starting the preview on ${siteFor(offset)}${reset ? " with fresh test data (a few minutes)" : ""}${enginesOnly ? ", the engine samples only" : ""}…`);

  const startedAtMs = Date.now();
  let shownLength = 0;
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
    if (!isAlive(child.pid)) {
      await stop();
      fail("The preview stopped while starting.", text);
    }
    if (Date.now() - startedAtMs > READY_TIMEOUT_MS) {
      await stop();
      fail(`The preview wasn't ready after ${READY_TIMEOUT_MS / 60_000} minutes, so it was stopped.`, text);
    }
  }
  printReady(offset, "started");
}

/** Stops this checkout's preview: its process group, then anything of this checkout's still holding a preview port. True when something was running. */
async function stop() {
  const state = readState();
  let stopped = false;
  if (state && hasGroup(state.pid)) {
    stopped = true;
    killGroup(state.pid, "SIGTERM");
    for (let i = 0; i < 20 && hasGroup(state.pid); i++) await new Promise((r) => setTimeout(r, 250));
    killGroup(state.pid, "SIGKILL");
  }
  // Servers that outlived their group (an older preview started by hand, or one killed hard).
  const left = ourListeners();
  if (left.length) {
    stopped = true;
    for (const pid of left) killPid(pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    for (const pid of ourListeners()) killPid(pid, "SIGKILL");
  }
  rmSync(STATE_FILE, { force: true });
  return stopped;
}

/** Prints every preview running on this machine: what listens on a preview's site port, with everything in its process group. */
function list() {
  const sitePorts = new Map(OFFSETS.map((offset) => [8800 + offset, offset]));
  // One per port (lsof lists a port once for each address it listens on).
  const running = [...new Map(listeners().filter((listener) => sitePorts.has(listener.port)).map((listener) => [listener.port, listener])).values()];
  if (!running.length) return console.log("No preview is running on this machine.");
  const processes = new Map();
  for (const line of (spawnSync("ps", ["-axo", "pid=,pgid=,etime="], { encoding: "utf8" }).stdout ?? "").split("\n")) {
    const [pid, pgid, upFor] = line.trim().split(/\s+/);
    if (pid) processes.set(Number(pid), { pgid: Number(pgid), upFor });
  }
  // top's memory is what each process takes, swapped and compressed parts too (ps counts only what's in memory now).
  const megabytes = new Map();
  for (const line of (spawnSync("top", ["-l", "1", "-stats", "pid,mem"], { encoding: "utf8" }).stdout ?? "").split("\n")) {
    const match = /^(\d+)\s+([\d.]+)([KMG])/.exec(line.trim());
    if (match) megabytes.set(Number(match[1]), Number(match[2]) * { K: 1 / 1024, M: 1, G: 1024 }[match[3]]);
  }
  let totalMegabytes = 0;
  console.log(`${running.length === 1 ? "One preview is" : `${running.length} previews are`} running on this machine:\n`);
  for (const listener of running.sort((a, b) => a.port - b.port)) {
    const group = processes.get(listener.pid)?.pgid;
    const members = [...processes].filter(([, each]) => each.pgid === group).map(([pid]) => pid);
    const groupMegabytes = members.reduce((sum, pid) => sum + (megabytes.get(pid) ?? 0), 0);
    totalMegabytes += groupMegabytes;
    const folder = processFolder(group) ?? processFolder(listener.pid) ?? "(its folder is unknown)";
    const upFor = processes.get(group)?.upFor ?? processes.get(listener.pid)?.upFor ?? "?";
    console.log(`  ${siteFor(sitePorts.get(listener.port))}  ${folder === ROOT ? `${folder} (this checkout)` : folder}`);
    console.log(`    up ${upForText(upFor)}, ${(groupMegabytes / 1024).toFixed(1)} GB in ${members.length} processes. Stop it: npm --prefix "${folder}" run preview:stop`);
  }
  console.log(`\nAll together: ${(totalMegabytes / 1024).toFixed(1)} GB.`);
}

/** ps's elapsed time ([[days-]hours:]minutes:seconds) in words: "3 h 12 min". */
function upForText(elapsed) {
  const [days, rest] = elapsed.includes("-") ? elapsed.split("-") : ["0", elapsed];
  const [seconds, minutes, hours = 0] = rest.split(":").map(Number).reverse();
  const parts = [[Number(days), "days"], [hours, "h"], [minutes, "min"]].filter(([count]) => count > 0).map(([count, unit]) => `${count} ${unit}`);
  return parts.length ? parts.join(" ") : `${seconds} s`;
}

/** The folder a process runs in. */
function processFolder(pid) {
  if (!pid) return null;
  const line = (spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" }).stdout ?? "").split("\n").find((each) => each.startsWith("n"));
  return line ? line.slice(1) : null;
}

/** The first offset with none of its ports taken, trying this checkout's last one first so links stay the same. */
async function freeOffset(last) {
  const taken = new Set(listeners().map((listener) => listener.port));
  for (const offset of [...new Set([last, ...OFFSETS])].filter((offset) => OFFSETS.includes(offset))) {
    const ports = portsFor(offset);
    if (ports.some((port) => taken.has(port))) continue;
    // lsof only sees this user's processes; a listen check catches the rest.
    if ((await Promise.all(ports.map(canListen))).every(Boolean)) return offset;
  }
}

/** Every TCP port something of this user's listens on, with its process. */
function listeners() {
  const out = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8" }).stdout ?? "";
  const found = [];
  let pid;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) found.push({ pid, port: Number(line.slice(line.lastIndexOf(":") + 1)) });
  }
  return found;
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

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function answers(url) {
  try {
    await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

function printReady(offset, how) {
  const site = siteFor(offset);
  const text = readLog();
  if (text.includes(READY_LINE)) writeFileSync(PAGES, text.slice(text.indexOf(READY_LINE)));
  if (readSeeded().startsWith("engines-only")) {
    console.log(`\nPreview ${how}: ${site}  (the engine samples only; this checkout only, nothing touches the live site)\n\nPlay them: npm run engines:play   Stop: npm run preview:stop   All the test data: npm run preview:start -- --reset\nLog: ${show(LOG)}`);
    return;
  }
  const width = Math.max(...SIGN_INS.map((account) => account.username.length));
  console.log(`
Preview ${how}: ${site}  (this checkout only; nothing touches the live site)

Sign in at ${site}/signin, password "${PASSWORD}" for every one:
${SIGN_INS.map((account) => `  ${account.username.padEnd(width)}  ${account.about}`).join("\n")}
Admin pages (${site}/admin) need no sign-in here. Email codes: http://localhost:${8795 + offset}

Every test page and state, with what it shows: ${show(PAGES)}
Log: ${show(LOG)}  (the servers' own: .wrangler/preview/servers.log)
Stop: npm run preview:stop   Fresh test data: npm run preview:start -- --reset`);
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


function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function readSeeded() {
  return existsSync(SEEDED) ? readFileSync(SEEDED, "utf8") : "";
}

function readLog() {
  return existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
