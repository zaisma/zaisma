// The memory cap on every preview on this machine, and the line for the starts it holds back (Julius, Oct 23, 2026), so
// several checkouts' previews never take more than an 8 GB Mac can give them.
//   The cap is one budget for all previews, wherever they were started. Each preview's processes (its run.mjs and everything
//   under it) are measured by their physical footprint, what Activity Monitor shows: what's in memory and its compressed part.
//   ps's resident memory leaves the compressed part out, and on a full Mac that's most of it.
//   A start, or a wake from sleep, that would go over it waits in a line every checkout shares: line.json in LINE_DIRECTORY,
//   changed only under one lock. The process that waits is the preview's own run.mjs, so a place in line outlives the command
//   that asked for it, and it starts by itself once a preview stops, sleeps or shrinks. Wakes go first: someone is at a page.
//   One preview may always run on its own, even over the cap.
//   PREVIEW_MEMORY_CAP_BYTES sets the cap for one shell, memory_cap_bytes in LINE_DIRECTORY/settings.json for the machine,
//   and without either it's 3/8 of this machine's memory (3 GB on an 8 GB Mac). 0 is no cap. macOS only: elsewhere (GitHub's
//   check, one preview a runner) there's no cap and no line.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";

export const LINE_DIRECTORY = join(homedir(), ".zaisma/previews");
// Every port offset a preview can take (site on 8800 + offset); background.mjs picks the first free one.
export const OFFSETS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const DEFAULT_CAP_SHARE = 3 / 8;
// What an awake preview takes until one has been measured on this machine.
export const DEFAULT_AWAKE_SIZE_BYTES = 1024 ** 3;
// A waiter looks at the line this often, and the line is measured again when its measurement is older than this.
const LOOK_INTERVAL_MS = 2000;
const MEASURE_INTERVAL_MS = 4000;
// Memory is kept for a preview whose turn came until it's up, or this long at most (background.mjs gives a start 9 minutes).
const KEPT_DURATION_MS = 10 * 60_000;
// A lock older than this is from a process that died holding it.
const LOCK_STALE_MS = 20_000;
// A waiter says its place again when it changes, or this often.
const PLACE_REPEAT_MS = 5 * 60_000;

/** The cap in bytes and where it came from: "environment", "settings_file", "default" or "not_macos" (0 is no cap). */
export function memoryCap({ env = process.env, directory = LINE_DIRECTORY, platform = process.platform, totalMemoryBytes = totalmem() } = {}) {
  if (platform !== "darwin") return { capBytes: 0, source: "not_macos" };
  const fromEnvironment = env.PREVIEW_MEMORY_CAP_BYTES?.trim();
  if (fromEnvironment) return { capBytes: capFrom(fromEnvironment, "PREVIEW_MEMORY_CAP_BYTES"), source: "environment" };
  const settingsFile = join(directory, "settings.json");
  let settings = null;
  try {
    settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`${settingsFile} isn't JSON (${error.message}). It holds { "memory_cap_bytes": 4294967296 } for a 4 GB cap, or 0 for none.`);
  }
  if (settings?.memory_cap_bytes !== undefined) return { capBytes: capFrom(settings.memory_cap_bytes, `memory_cap_bytes in ${settingsFile}`), source: "settings_file" };
  return { capBytes: Math.round(totalMemoryBytes * DEFAULT_CAP_SHARE), source: "default" };
}

function capFrom(value, name) {
  const bytes = typeof value === "number" ? value : /^\d+$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`${name} is ${JSON.stringify(value)}: it takes a whole number of bytes, like 4294967296 for 4 GB, or 0 for no cap.`);
  return bytes;
}

/** Where the cap came from, in words. */
export function capSourceText(source) {
  return { environment: "PREVIEW_MEMORY_CAP_BYTES", settings_file: `memory_cap_bytes in ${join(LINE_DIRECTORY, "settings.json")}`, default: "3/8 of this machine's memory, the default", not_macos: "none off macOS" }[source];
}

/** Bytes in words: "1.2 GB", or "44 MB" under a gigabyte. */
export function sizeText(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** 1st, 2nd, 3rd, 4th… */
export function placeText(place) {
  const last = place % 10;
  const suffix = place % 100 >= 11 && place % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[last] ?? "th";
  return `${place}${suffix}`;
}

/**
 * Runs fn while holding the line's lock, the one lock every checkout's preview takes before it changes the line. A lock left
 * by a process that died holding it is taken over.
 */
export async function withLock(fn, { directory = LINE_DIRECTORY } = {}) {
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, "lock");
  const owner = join(lock, "owner.json");
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let isStale = false;
    try {
      const { pid, locked_at_ms: lockedAtMs } = JSON.parse(readFileSync(owner, "utf8"));
      isStale = !isAlive(pid) || Date.now() - lockedAtMs > LOCK_STALE_MS;
    } catch {
      // Taken this moment, its owner not written yet; or written by a process that died before it could.
      try {
        isStale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
      } catch {}
    }
    if (isStale) {
      // Moved aside first, so only one process takes a stale lock over.
      const aside = `${lock}-stale-${process.pid}-${Date.now()}`;
      try {
        renameSync(lock, aside);
        rmSync(aside, { recursive: true, force: true });
      } catch {}
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
  }
  const lockedAtMs = Date.now();
  try {
    writeFileSync(owner, JSON.stringify({ pid: process.pid, locked_at_ms: lockedAtMs }));
    return await fn();
  } finally {
    // Unless another process took it over (this one held it too long: the Mac slept, say).
    let isOurs = false;
    try {
      const held = JSON.parse(readFileSync(owner, "utf8"));
      isOurs = held.pid === process.pid && held.locked_at_ms === lockedAtMs;
    } catch {}
    if (isOurs) rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * The line: { entries, measurement, awake_size_bytes }. Each entry is a preview's run.mjs asking for memory:
 * { pid, folder, offset, kind: "start" or "wake", asked_at_ms, turn_given_at_ms } (null until its turn comes).
 */
export function readLine({ directory = LINE_DIRECTORY } = {}) {
  try {
    const line = JSON.parse(readFileSync(join(directory, "line.json"), "utf8"));
    return { entries: line.entries ?? [], measurement: line.measurement ?? null, awake_size_bytes: line.awake_size_bytes ?? null };
  } catch {
    return { entries: [], measurement: null, awake_size_bytes: null };
  }
}

/** Written whole and renamed into place, so a reader never sees half of it. Only under the lock. */
export function writeLine(line, { directory = LINE_DIRECTORY } = {}) {
  const file = join(directory, "line.json");
  const written = `${file}.${process.pid}.tmp`;
  writeFileSync(written, JSON.stringify(line, null, 2));
  renameSync(written, file);
}

/** The entries still waiting, in the order their turns come: wakes first (someone is at a page), then starts, each by when it asked. */
export function waitingInOrder(entries) {
  return entries.filter((entry) => entry.turn_given_at_ms === null).sort((a, b) => (a.kind === b.kind ? a.asked_at_ms - b.asked_at_ms : a.kind === "wake" ? -1 : 1));
}

/**
 * Whose turn it is, from the line and what was measured: the first entry waiting gets it when what's in use, what's kept for
 * previews still starting or waking, and what it needs fit in the cap, or when nothing else is awake or starting.
 * previews: [{ offset, sizeBytes, isAwake }] as measured; capBytes 0 is no cap.
 */
export function nextTurn({ entries, previews, capBytes, awakeSizeBytes, nowMs = Date.now() }) {
  const sizeAt = (offset) => previews.find((preview) => preview.offset === offset)?.sizeBytes ?? 0;
  const usedBytes = previews.reduce((sum, preview) => sum + preview.sizeBytes, 0);
  const coming = entries.filter((entry) => entry.turn_given_at_ms !== null && nowMs - entry.turn_given_at_ms < KEPT_DURATION_MS);
  const keptBytes = coming.reduce((sum, entry) => sum + Math.max(0, awakeSizeBytes - sizeAt(entry.offset)), 0);
  const [first] = waitingInOrder(entries);
  if (!first) return { turnPid: null, usedBytes, keptBytes, neededBytes: 0, isAlone: false };
  const neededBytes = Math.max(0, awakeSizeBytes - sizeAt(first.offset));
  const isAlone = !coming.length && !previews.some((preview) => preview.isAwake && preview.offset !== first.offset);
  const fits = capBytes === 0 || isAlone || usedBytes + keptBytes + neededBytes <= capBytes;
  return { turnPid: fits ? first.pid : null, usedBytes, keptBytes, neededBytes, isAlone };
}

/**
 * Waits for this process's turn in the line, as a preview's run.mjs, before it starts ("start") or wakes ("wake"), and says
 * its place and why through say(). Resolves once its turn has come, with how long it waited; at once without a cap.
 */
export async function waitForTurn({ kind, offset, folder, say = console.log, directory = LINE_DIRECTORY }) {
  const { capBytes } = memoryCap({ directory });
  if (!capBytes) return { waitedMs: 0 };
  const askedAtMs = Date.now();
  let shown = "";
  let shownAtMs = 0;
  for (;;) {
    const status = await withLock(() => lookAtLine({ kind, offset, folder, capBytes, directory }), { directory });
    if (status.isTurn) {
      const waitedMs = Date.now() - askedAtMs;
      if (shown) say(`Room for it after ${durationText(waitedMs)} in line (${sizeText(status.usedBytes)} of the ${sizeText(capBytes)} cap in use): ${kind === "wake" ? "waking up" : "starting"}.`);
      else if (status.isAlone && status.usedBytes + status.neededBytes > capBytes) say(`It takes more than the ${sizeText(capBytes)} memory cap, but no other preview is awake, so it ${kind === "wake" ? "wakes" : "starts"} anyway.`);
      return { waitedMs };
    }
    const text = `Waiting in line for memory, ${status.place === 1 ? "next up" : `${placeText(status.place)} of ${status.waitingCount}`}: previews take ${sizeText(status.usedBytes + status.keptBytes)} of the ${sizeText(capBytes)} cap, and this one needs about ${sizeText(status.neededBytes)} more. It ${kind === "wake" ? "wakes" : "starts"} by itself when a preview stops, sleeps or shrinks.`;
    if (text.replace(/[\d.]+ [GM]B/g, "") !== shown.replace(/[\d.]+ [GM]B/g, "") || Date.now() - shownAtMs > PLACE_REPEAT_MS) {
      say(text);
      shown = text;
      shownAtMs = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, LOOK_INTERVAL_MS));
  }
}

/** One look at the line under its lock: makes sure this process is in it, drops the dead, gives the next turn when it's time. */
function lookAtLine({ kind, offset, folder, capBytes, directory }) {
  const line = readLine({ directory });
  const nowMs = Date.now();
  line.entries = line.entries.filter((entry) => isAlive(entry.pid) && !(entry.turn_given_at_ms !== null && nowMs - entry.turn_given_at_ms >= KEPT_DURATION_MS));
  let mine = line.entries.find((entry) => entry.pid === process.pid);
  if (!mine) {
    mine = { pid: process.pid, folder, offset, kind, asked_at_ms: nowMs, turn_given_at_ms: null };
    line.entries.push(mine);
  } else if (mine.kind !== kind || mine.offset !== offset) Object.assign(mine, { kind, offset, asked_at_ms: nowMs, turn_given_at_ms: null });
  if (mine.turn_given_at_ms === null && (!line.measurement || nowMs - line.measurement.measured_at_ms >= MEASURE_INTERVAL_MS)) {
    const { previews, processes } = measurePreviews(line.entries);
    // The dead were dropped above; this drops an entry whose process number now belongs to something else.
    line.entries = line.entries.filter((entry) => processes.get(entry.pid)?.command.includes("scripts/preview/run.mjs"));
    if (!line.entries.includes(mine)) line.entries.push(mine);
    line.awake_size_bytes = awakeSize(previews, line.entries) ?? line.awake_size_bytes;
    const awakeSizeBytes = line.awake_size_bytes ?? DEFAULT_AWAKE_SIZE_BYTES;
    const turn = nextTurn({ entries: line.entries, previews, capBytes, awakeSizeBytes, nowMs });
    if (turn.turnPid !== null) line.entries.find((entry) => entry.pid === turn.turnPid).turn_given_at_ms = nowMs;
    line.measurement = { measured_at_ms: nowMs, cap_bytes: capBytes, used_bytes: turn.usedBytes, kept_bytes: turn.keptBytes, needed_bytes: turn.neededBytes, is_alone: turn.isAlone, previews: previews.map(({ offset, sizeBytes, isAwake }) => ({ offset, size_bytes: sizeBytes, is_awake: isAwake })) };
  }
  writeLine(line, { directory });
  const waiting = waitingInOrder(line.entries);
  const measurement = line.measurement;
  return {
    isTurn: mine.turn_given_at_ms !== null,
    place: waiting.indexOf(mine) + 1,
    waitingCount: waiting.length,
    usedBytes: measurement.used_bytes,
    keptBytes: measurement.kept_bytes,
    neededBytes: Math.max(0, (line.awake_size_bytes ?? DEFAULT_AWAKE_SIZE_BYTES) - (measurement.previews.find((preview) => preview.offset === offset)?.size_bytes ?? 0)),
    isAlone: measurement.is_alone,
  };
}

/** What an awake preview takes on this machine: the middle size of the awake ones up and running (none still starting or waking). */
function awakeSize(previews, entries) {
  const sizes = previews.filter((preview) => preview.isAwake && preview.isListening && !entries.some((entry) => entry.offset === preview.offset)).map((preview) => preview.sizeBytes).sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;
}

/** Takes this process out of the line, once it's up or awake: from then on it's measured like any running preview. */
export async function finishTurn({ directory = LINE_DIRECTORY } = {}) {
  if (!memoryCap({ directory }).capBytes) return;
  await leaveLine((entry) => entry.pid === process.pid, { directory });
}

/** Takes the entries that match out of the line (preview:stop takes its checkout's). */
export async function leaveLine(matches, { directory = LINE_DIRECTORY } = {}) {
  await withLock(() => {
    const line = readLine({ directory });
    const left = line.entries.filter((entry) => !matches(entry));
    if (left.length !== line.entries.length) writeLine({ ...line, entries: left, measurement: null }, { directory });
  }, { directory });
}

/**
 * Every preview on this machine, measured: one for each preview site port something listens on, and one for each entry in the
 * line not listening yet. Each is its run.mjs and every process under it, with their physical footprint added up.
 * Answers previews ([{ offset, rootPid, folder, sizeBytes, processCount, upFor, isListening, isAwake }], by offset) and the
 * process table it read.
 */
export function measurePreviews(entries = []) {
  const processes = processTable();
  const children = new Map();
  for (const [pid, { parentPid }] of processes) children.set(parentPid, [...(children.get(parentPid) ?? []), pid]);
  const roots = new Map();
  const sitePorts = new Map(OFFSETS.map((offset) => [8800 + offset, offset]));
  for (const listener of listeners()) {
    if (!sitePorts.has(listener.port) || roots.has(sitePorts.get(listener.port))) continue;
    // The run.mjs it runs under (before the one wrangler, a preview's site port was a workerd's, under its run.mjs).
    let pid = listener.pid;
    for (let step = 0; step < 6 && pid > 1 && !processes.get(pid)?.command.includes("scripts/preview/run.mjs"); step++) pid = processes.get(pid)?.parentPid ?? 0;
    roots.set(sitePorts.get(listener.port), { pid: pid > 1 ? pid : listener.pid, isListening: true });
  }
  for (const entry of entries) if (!roots.has(entry.offset) && processes.has(entry.pid)) roots.set(entry.offset, { pid: entry.pid, isListening: false, folder: entry.folder });
  const members = new Map();
  for (const [offset, root] of roots) {
    const found = [root.pid];
    for (let i = 0; i < found.length; i++) found.push(...(children.get(found[i]) ?? []));
    members.set(offset, found);
  }
  const footprints = footprintBytes([...members.values()].flat());
  const folders = processFolders([...roots.values()].filter((root) => !root.folder).map((root) => root.pid));
  const previews = [...roots]
    .map(([offset, root]) => {
      const pids = members.get(offset);
      return {
        offset,
        rootPid: root.pid,
        folder: root.folder ?? folders.get(root.pid) ?? null,
        sizeBytes: pids.reduce((sum, pid) => sum + (footprints.get(pid) ?? 0), 0),
        processCount: pids.length,
        upFor: processes.get(root.pid)?.upFor ?? null,
        isListening: root.isListening,
        isAwake: pids.some((pid) => /\bworkerd\b/.test(processes.get(pid)?.command ?? "")),
      };
    })
    .sort((a, b) => a.offset - b.offset);
  return { previews, processes };
}

/** Every process: pid → { parentPid, upFor (ps's elapsed time), command }. */
function processTable() {
  const table = new Map();
  const out = spawnSync("ps", ["-axo", "pid=,ppid=,etime=,args="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (match) table.set(Number(match[1]), { parentPid: Number(match[2]), upFor: match[3], command: match[4] });
  }
  return table;
}

/**
 * Each process's physical footprint in bytes, from macOS's footprint (about a tenth of a second for all of them; top takes
 * seconds). It refuses the whole call when one is gone, so that one is left out and it's asked again. Without footprint, ps's
 * resident memory.
 */
function footprintBytes(pids) {
  const sizes = new Map();
  let asked = [...new Set(pids)];
  for (let tryNumber = 0; asked.length && tryNumber < 5; tryNumber++) {
    const result = spawnSync("footprint", ["--noCategories", "-f", "bytes", ...asked.flatMap((pid) => ["-p", String(pid)])], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.error) break;
    const gone = [...(result.stderr ?? "").matchAll(/Unable to find pid for process matching '(\d+)'/g)].map((match) => Number(match[1]));
    if (gone.length) {
      asked = asked.filter((pid) => !gone.includes(pid));
      continue;
    }
    for (const match of (result.stdout ?? "").matchAll(/\[(\d+)\]:[^\n]*?Footprint:\s*(\d+) B/g)) sizes.set(Number(match[1]), Number(match[2]));
    return sizes;
  }
  if (!asked.length) return sizes;
  const out = spawnSync("ps", ["-o", "pid=,rss=", "-p", asked.join(",")], { encoding: "utf8" }).stdout ?? "";
  for (const line of out.split("\n")) {
    const [pid, kilobytes] = line.trim().split(/\s+/).map(Number);
    if (pid) sizes.set(pid, kilobytes * 1024);
  }
  return sizes;
}

/** Every TCP port something of this user's listens on, with its process. */
export function listeners() {
  const out = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { encoding: "utf8" }).stdout ?? "";
  const found = [];
  let pid;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) found.push({ pid, port: Number(line.slice(line.lastIndexOf(":") + 1)) });
  }
  return found;
}

/** The folder each of these processes runs in. */
export function processFolders(pids) {
  const folders = new Map();
  if (!pids.length) return folders;
  const out = spawnSync("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"], { encoding: "utf8" }).stdout ?? "";
  let pid;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) folders.set(pid, line.slice(1));
  }
  return folders;
}

/** A length of time in words: "4 min", "1 h 5 min", "20 s". */
export function durationText(durationMs) {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes < 1) return `${Math.round(durationMs / 1000)} s`;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

/** Whether a process is running (one another user or sandbox owns counts too). */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
