// The budget a local npm run check runs under, on a Mac that previews and everything else share: its limits, how this machine's numbers
// are read, and the one run at a time. Over a hard limit a run stops at once and says so, never PASS; past a warning line it finishes and
// files an optimization task (scripts/check-records.mjs). The budget has no say on GitHub's runners: scripts/check.mjs runs here only on a person's machine.
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { RECORD_DIRECTORY } from "./check-records.mjs";
import { footprintBytes, isAlive } from "./preview/memory.mjs";

const GIGABYTE_BYTES = 1024 ** 3;
export const DURATION_WARNING_SEC = 240;
export const DURATION_HARD_SEC = 300;
export const CPU_WARNING_CORE_COUNT = 2;
export const CPU_HARD_CORE_COUNT = 3;
export const MEMORY_WARNING_SIZE_BYTES = 2 * GIGABYTE_BYTES;
export const MEMORY_HARD_SIZE_BYTES = 3 * GIGABYTE_BYTES;
/** macOS's own words, mildest first (NSProcessInfo's thermal state, and memorystatus's pressure level). */
export const HEAT_STATUSES = ["nominal", "fair", "serious", "critical"];
export const MEMORY_PRESSURE_STATUSES = ["normal", "warn", "critical"];
const HEAT_WARNING_STATUS = "fair";
const HEAT_HARD_STATUS = "serious";
const MEMORY_PRESSURE_HARD_STATUS = "critical";
/** kern.memorystatus_vm_pressure_level's values. */
const MEMORY_PRESSURE_BY_KERNEL_LEVEL = { 1: "normal", 2: "warn", 4: "critical" };
/** A run's average means nothing until it's run this long: every run starts with a burst of compiling. */
export const CPU_AVERAGE_FROM_SEC = 60;
const SAMPLE_INTERVAL_MS = 3000;
/** How much of this Mac everything else may use with a run still starting: its cores less the hard limit. */
export const BUSY_OTHER_CORE_COUNT = 5;
/** How long a run waits for a busy Mac before it hands everything to GitHub's check, and how often it looks. */
export const BUSY_WAIT_LIMIT_SEC = 120;
const BUSY_LOOK_INTERVAL_MS = 5000;
const RUN_FILE = "running.json";
const WAITING_FILE = "waiting.json";

const levelOf = (statuses, status) => statuses.indexOf(status);
const clockText = (durationSec) => `${Math.floor(Math.round(durationSec) / 60)}:${String(Math.round(durationSec) % 60).padStart(2, "0")}`;
const gigabytesText = (sizeBytes) => `${(sizeBytes / GIGABYTE_BYTES).toFixed(1)} GB`;

/**
 * Where a run's numbers stand against the budget: warnings and hard_limits, each { metric_name, line_value, seen_value, line }, the line
 * being what the run prints. Memory pressure at warn is only ever recorded: this Mac sits there with nothing else running.
 */
export function budgetVerdict({ duration_sec: durationSec, cpu_average_core_count: cpuCoreCount, memory_peak_size_bytes: memorySizeBytes, heat_peak_status: heatStatus, memory_pressure_peak_status: pressureStatus }) {
  const warnings = [];
  const hardLimits = [];
  const measure = (metricName, seenValue, warningValue, hardValue, sayValue) => {
    if (!Number.isFinite(seenValue)) return;
    if (hardValue !== null && seenValue > hardValue) hardLimits.push({ metric_name: metricName, line_value: hardValue, seen_value: seenValue, line: `${metricName} at ${sayValue(seenValue)}, over the hard limit of ${sayValue(hardValue)}` });
    else if (warningValue !== null && seenValue > warningValue) warnings.push({ metric_name: metricName, line_value: warningValue, seen_value: seenValue, line: `${metricName} at ${sayValue(seenValue)}, past the warning line of ${sayValue(warningValue)}` });
  };
  measure("duration_sec", durationSec, DURATION_WARNING_SEC, DURATION_HARD_SEC, clockText);
  measure("cpu_average_core_count", cpuCoreCount, CPU_WARNING_CORE_COUNT, CPU_HARD_CORE_COUNT, (cores) => `${cores.toFixed(1)} cores`);
  measure("memory_peak_size_bytes", memorySizeBytes, MEMORY_WARNING_SIZE_BYTES, MEMORY_HARD_SIZE_BYTES, gigabytesText);
  const heatLevel = levelOf(HEAT_STATUSES, heatStatus);
  if (heatLevel >= levelOf(HEAT_STATUSES, HEAT_HARD_STATUS)) hardLimits.push({ metric_name: "heat_level", line_value: levelOf(HEAT_STATUSES, HEAT_HARD_STATUS), seen_value: heatLevel, line: `macOS calls the heat ${heatStatus}, at the hard limit of ${HEAT_HARD_STATUS}` });
  else if (heatLevel >= levelOf(HEAT_STATUSES, HEAT_WARNING_STATUS)) warnings.push({ metric_name: "heat_level", line_value: levelOf(HEAT_STATUSES, HEAT_WARNING_STATUS), seen_value: heatLevel, line: `macOS calls the heat ${heatStatus}, the warning line` });
  if (levelOf(MEMORY_PRESSURE_STATUSES, pressureStatus) >= levelOf(MEMORY_PRESSURE_STATUSES, MEMORY_PRESSURE_HARD_STATUS)) hardLimits.push({ metric_name: "memory_pressure_level", line_value: levelOf(MEMORY_PRESSURE_STATUSES, MEMORY_PRESSURE_HARD_STATUS), seen_value: levelOf(MEMORY_PRESSURE_STATUSES, pressureStatus), line: `macOS calls the memory pressure ${pressureStatus}, the hard limit` });
  return { warnings, hard_limits: hardLimits };
}

/** A run's numbers as one line. */
export function budgetLine(numbers) {
  const parts = [`${clockText(numbers.duration_sec)} of ${clockText(DURATION_HARD_SEC)}`];
  if (Number.isFinite(numbers.cpu_average_core_count)) parts.push(`${numbers.cpu_average_core_count.toFixed(1)} cores of ${CPU_HARD_CORE_COUNT}`);
  if (Number.isFinite(numbers.memory_peak_size_bytes)) parts.push(`${gigabytesText(numbers.memory_peak_size_bytes)} of ${gigabytesText(MEMORY_HARD_SIZE_BYTES)}`);
  if (numbers.heat_peak_status) parts.push(`heat ${numbers.heat_peak_status}`);
  if (numbers.memory_pressure_peak_status) parts.push(`memory pressure ${numbers.memory_pressure_peak_status}`);
  return `Budget: ${parts.join(", ")}.`;
}

/** ps's cumulative CPU time (12:34.56, or 1:02:03.45 on a long-lived process) in seconds. */
export function cpuTimeSec(text) {
  return text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** macOS's heat and memory pressure now, and how many cores everything else is using, leaving out these process groups. Null where this isn't a Mac. */
export function readMachineState({ processGroupIds = [] } = {}) {
  if (process.platform !== "darwin") return { heat_status: null, memory_pressure_status: null, other_core_count: 0 };
  const heatLevel = spawnSync("osascript", ["-l", "JavaScript", "-e", "ObjC.import('Foundation'); $.NSProcessInfo.processInfo.thermalState"], { encoding: "utf8" }).stdout;
  const pressureLevel = spawnSync("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { encoding: "utf8" }).stdout;
  const rows = spawnSync("ps", ["-A", "-o", "pgid=,pcpu="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).stdout ?? "";
  const otherPct = rows.split("\n").reduce((sum, row) => {
    const [groupId, cpuPct] = row.trim().split(/\s+/).map(Number);
    return processGroupIds.includes(groupId) ? sum : sum + (cpuPct || 0);
  }, 0);
  return { heat_status: HEAT_STATUSES[Number(heatLevel)] ?? null, memory_pressure_status: MEMORY_PRESSURE_BY_KERNEL_LEVEL[Number(pressureLevel)] ?? null, other_core_count: otherPct / 100 };
}

/** Why the Mac has no room for a run to start right now, or null. */
export function busyReason({ heat_status: heatStatus, memory_pressure_status: pressureStatus, other_core_count: otherCoreCount }) {
  if (levelOf(HEAT_STATUSES, heatStatus) >= levelOf(HEAT_STATUSES, HEAT_WARNING_STATUS)) return `macOS calls the heat ${heatStatus}`;
  if (pressureStatus === MEMORY_PRESSURE_HARD_STATUS) return "macOS calls the memory pressure critical";
  if (otherCoreCount >= BUSY_OTHER_CORE_COUNT) return `everything else is using ${otherCoreCount.toFixed(1)} cores`;
  return null;
}

function readOwner(path) {
  try {
    const owner = JSON.parse(readFileSync(path, "utf8"));
    return isAlive(owner.process_id) ? owner : null;
  } catch {
    return null;
  }
}

/** Takes the machine's one local run if it's free: whether it did. A run whose process died holds nothing. */
export function takeRunTurn({ directory = RECORD_DIRECTORY, processId = process.pid } = {}) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, RUN_FILE);
  const owner = readOwner(path);
  if (owner && owner.process_id !== processId) return false;
  if (!owner) rmSync(path, { force: true });
  try {
    writeFileSync(path, JSON.stringify({ process_id: processId }), { flag: "wx" });
  } catch {
    return readOwner(path)?.process_id === processId;
  }
  return true;
}

export function releaseRunTurn({ directory = RECORD_DIRECTORY, processId = process.pid } = {}) {
  if (readOwner(join(directory, RUN_FILE))?.process_id === processId) rmSync(join(directory, RUN_FILE), { force: true });
}

/** A run waiting its turn says so, and the run going leaves off its extra test files between batches to let it in. */
export const isRunWaiting = ({ directory = RECORD_DIRECTORY } = {}) => readOwner(join(directory, WAITING_FILE)) !== null;

/**
 * Waits up to BUSY_WAIT_LIMIT_SEC for the machine's one run and a Mac with room: { is_turn_taken, wait_duration_sec, busy_reason }, with
 * busy_reason saying why it gave up. A run never waits longer: GitHub's check runs everything anyway.
 */
export async function waitForRunTurn({ say = () => {}, readState = readMachineState, nowMs = () => Date.now(), pause = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)), directory = RECORD_DIRECTORY, processId = process.pid } = {}) {
  const startMs = nowMs();
  let isSaid = false;
  let reason = null;
  try {
    for (;;) {
      const hasTurn = takeRunTurn({ directory, processId });
      reason = hasTurn ? busyReason(readState()) : "another local check is running";
      if (hasTurn && !reason) return { is_turn_taken: true, wait_duration_sec: (nowMs() - startMs) / 1000, busy_reason: null };
      if (hasTurn) releaseRunTurn({ directory, processId });
      if ((nowMs() - startMs) / 1000 >= BUSY_WAIT_LIMIT_SEC) return { is_turn_taken: false, wait_duration_sec: (nowMs() - startMs) / 1000, busy_reason: reason };
      if (!isSaid) {
        say(`Waiting up to ${BUSY_WAIT_LIMIT_SEC} seconds: ${reason}.`);
        isSaid = true;
        writeFileSync(join(directory, WAITING_FILE), JSON.stringify({ process_id: processId }));
      }
      await pause(BUSY_LOOK_INTERVAL_MS);
    }
  } finally {
    if (readOwner(join(directory, WAITING_FILE))?.process_id === processId) rmSync(join(directory, WAITING_FILE), { force: true });
  }
}

/** Adds one reading of the process table to a watch's numbers: each process's CPU time is the most it was seen at, so one that ended still counts. */
export function addCpuReading(cpuSecByProcess, rows, processGroupIds) {
  for (const { process_id: processId, process_group_id: processGroupId, cpu_time_sec: cpuSec } of rows) {
    if (processGroupIds.has(processGroupId)) cpuSecByProcess.set(processId, Math.max(cpuSecByProcess.get(processId) ?? 0, cpuSec));
  }
}

async function readProcessRows() {
  const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,pgid=,time="], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").flatMap((row) => {
    const [processId, processGroupId, time] = row.trim().split(/\s+/);
    return time ? [{ process_id: Number(processId), process_group_id: Number(processGroupId), cpu_time_sec: cpuTimeSec(time) }] : [];
  });
}

/**
 * Watches a run's process groups until stop(): its CPU, memory, heat and pressure, and the clock. onHardLimit(limits) is called once, the
 * first time a hard limit is crossed; the run stops its groups there. numbers() is where it all stands.
 */
export function startBudgetWatch({ onHardLimit, intervalMs = SAMPLE_INTERVAL_MS, nowMs = () => Date.now(), readRows = readProcessRows, readState = readMachineState, readMemory = (processIds) => [...footprintBytes(processIds).values()].reduce((sum, sizeBytes) => sum + sizeBytes, 0) } = {}) {
  const startMs = nowMs();
  const processGroupIds = new Set();
  const cpuSecByProcess = new Map();
  let memoryPeakSizeBytes = 0;
  let heatPeakStatus = null;
  let pressurePeakStatus = null;
  let isCalled = false;
  let isStopped = false;
  const numbers = () => {
    const durationSec = (nowMs() - startMs) / 1000;
    const cpuSec = [...cpuSecByProcess.values()].reduce((sum, value) => sum + value, 0);
    return {
      duration_sec: Math.round(durationSec * 10) / 10,
      cpu_average_core_count: durationSec > 0 ? Math.round((cpuSec / durationSec) * 100) / 100 : 0,
      memory_peak_size_bytes: memoryPeakSizeBytes,
      heat_peak_status: heatPeakStatus,
      memory_pressure_peak_status: pressurePeakStatus,
    };
  };
  const look = async () => {
    const rows = await readRows().catch(() => []);
    if (isStopped) return;
    addCpuReading(cpuSecByProcess, rows, processGroupIds);
    const processIds = rows.filter((row) => processGroupIds.has(row.process_group_id)).map((row) => row.process_id);
    if (processIds.length) memoryPeakSizeBytes = Math.max(memoryPeakSizeBytes, readMemory(processIds));
    const state = readState({ processGroupIds: [...processGroupIds] });
    if (levelOf(HEAT_STATUSES, state.heat_status) > levelOf(HEAT_STATUSES, heatPeakStatus)) heatPeakStatus = state.heat_status;
    if (levelOf(MEMORY_PRESSURE_STATUSES, state.memory_pressure_status) > levelOf(MEMORY_PRESSURE_STATUSES, pressurePeakStatus)) pressurePeakStatus = state.memory_pressure_status;
    const current = numbers();
    const limits = budgetVerdict({ ...current, cpu_average_core_count: current.duration_sec >= CPU_AVERAGE_FROM_SEC ? current.cpu_average_core_count : null }).hard_limits;
    if (limits.length && !isCalled) {
      isCalled = true;
      onHardLimit?.(limits);
    }
  };
  const timer = setInterval(() => void look(), intervalMs);
  void look();
  return {
    addProcessGroup: (processGroupId) => processGroupIds.add(processGroupId),
    numbers,
    stop: () => {
      isStopped = true;
      clearInterval(timer);
      return numbers();
    },
  };
}
