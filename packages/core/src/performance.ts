import { ASSET_NOTE_CODES, type PerformanceNote } from "../../cli/performance.mjs";
import { readVersionAddress } from "./uploads.ts";

/**
 * How a version started in headless Chrome (docs/DECISIONS.md, "Every version is started in Chrome, and what it
 * finds are notes."): the limits of a run, every note it can give with its fix, and the report a run's
 * observations make. The run itself is apps/site/src/performance-check.ts; the asset notes are
 * packages/cli/performance.mjs, shared with `zaisma check`.
 */

export const PERFORMANCE_CHECK_LIMITS = {
  /** The longest a run waits for a first frame. */
  maximumRunDurationSec: 120,
  /** How long a run keeps going after the first frame, for memory at start. */
  afterFirstFrameDurationSec: 5,
  /** A game that hasn't drawn by then, with nothing downloading, gets one click: many wait for one before drawing. */
  clickAfterSec: 10,
  bigStartDownloadSizeBytes: 200 * 1024 ** 2,
  longFreezeDurationMs: 2000,
  /** The most notes of one kind (errors, missing files, blocked addresses) a run gives. */
  maximumErrorNoteCount: 5,
  /** The most files a game page preloads (First files preloaded). */
  maximumPreloadFileCount: 20,
  /** How much a game page downloads before Play (Game files start before Play). */
  maximumWarmUpSizeBytes: 100 * 1024 ** 2,
};

/** Notes only a run in Chrome gives. */
const RUN_NOTE_CODES = {
  error_at_start: { meaning: "The game threw an error while starting.", fix: "Open the preview_url in Chrome with the console open; fix the error, then upload again." },
  missing_file_at_start: { meaning: "The game asked for a file that isn't in the version while starting.", fix: "Upload it, or stop the game asking for it; paths are case-sensitive." },
  blocked_at_start: {
    meaning: "An address the game loaded or connected to was blocked while starting.",
    fix: "Games can only load their own files and connect to Zaisma rooms and their own servers: bundle the file into the upload, or add your server with update_game.",
  },
  no_frame_drawn: { meaning: "Nothing was drawn while the run waited, even after a click.", fix: "Open the preview_url and check it starts; if it waits for something only a player does, that's fine." },
  big_download_at_start: {
    meaning: "Players download a lot before the first frame.",
    fix: "Load what the first minutes need, then the rest while they play (levels, music, high-resolution textures); the SDK's guide on loading in pieces shows how.",
  },
  long_freeze_at_start: {
    meaning: "The page froze for a long time in one go while starting.",
    fix: "Split the work over several frames or move it to a worker (big JSON parses, shader compiles, level generation).",
  },
};

/** Every note a version's performance_check can give: run notes first, then asset notes. */
export const PERFORMANCE_NOTE_CODES: Record<string, { meaning: string; fix: string }> = { ...RUN_NOTE_CODES, ...ASSET_NOTE_CODES };

export type PerformanceCheckStatus = "waiting" | "checking" | "checked" | "over_daily_limit" | "could_not_run";

/** A game file the run downloaded before its first frame: what its game page preloads and warms up. */
export interface StartFile {
  /** The path inside the game, with its query if it had one. */
  path: string;
  /** How the browser asked for it, as a preload's as=: fetch for fetch() and XMLHttpRequest. */
  destination: "script" | "fetch" | "style" | "image" | "font";
  /** It was asked for in CORS mode (fetch(), XMLHttpRequest, module scripts, fonts), so its preload says crossorigin, or it would download twice. */
  is_cors_request: boolean;
  /** As sent, compressed. */
  downloaded_size_bytes: number;
}

/** The stored report (performance_checks.report and start_files): the API's fields, snake_case. */
export interface PerformanceReport {
  browser_description: string;
  loading_duration_sec: number | null;
  start_download_size_bytes: number | null;
  start_file_count: number | null;
  start_memory_size_bytes: number | null;
  longest_start_task_duration_ms: number | null;
  notes: PerformanceNote[];
  start_files: StartFile[];
}

/** A performance_checks row. */
export interface PerformanceCheckRow {
  version_id: string;
  owner_id: string;
  check_status: PerformanceCheckStatus;
  report: string | null;
  start_files: string | null;
  queued_at_ms: number;
  checked_at_ms: number | null;
}

/** One request the run saw, from Chrome's DevTools protocol. */
export interface ObservedRequest {
  url: string;
  startedAtMs: number;
  /** null: it never finished, or failed. */
  finishedAtMs: number | null;
  httpStatus: number | null;
  /** As sent over the network, compressed. */
  downloadedSizeBytes: number;
  /** The request's Sec-Fetch-Dest: script, style, image, font, empty (fetch and XMLHttpRequest), document and the like. */
  fetchDestination: string;
  /** The request's Sec-Fetch-Mode: cors, no-cors, navigate and the like. */
  fetchMode: string;
  /** Why Chrome blocked it (csp, mixed-content and the like), or null. */
  blockedReason: string | null;
}

/** What a run saw. Times are the run's own clock in milliseconds. */
export interface PerformanceObservations {
  /** Chrome's own product name, like HeadlessChrome/128.0.6613.84. */
  browserVersion: string;
  /** The address the version's files are under, ending in /: requests under it are the game's own. */
  gameBaseUrl: string;
  /** When the run opened the game, for when its page's own request isn't seen. */
  openedAtMs: number;
  firstDrawAtMs: number | null;
  /** The first draw was WebGL or WebGPU, not a 2D canvas; null when nothing was drawn. */
  isDrawnWithGpu: boolean | null;
  requests: ObservedRequest[];
  errors: { message: string; url: string | null; lineNumber: number | null }[];
  longTaskDurationsMs: number[];
  /** JavaScript heap plus WebAssembly memory after the first frame, or null when it couldn't be read. */
  memorySizeBytes: number | null;
  /** The longest the run waited for a first frame: PERFORMANCE_CHECK_LIMITS.maximumRunDurationSec, or the preview's shorter wait. */
  maximumRunDurationSec: number;
}

/**
 * The first draw and WebAssembly memories, as a page script, shared by the Chrome check's probe
 * (apps/site/src/performance-check.ts) and the game frame's measuring (packages/sdk/performance.js), so a load
 * time means the same in both: the time of the first draw on a canvas in the page with a size (WebGL, WebGL 2,
 * 2D or WebGPU), each wrapper removed once one has counted, so the game runs untouched from then on. Its state
 * is window.__zaismaFirstDraw: { firstDrawAtMs (wall time), drawKind, memories (a Set of WebAssembly.Memory) }.
 * Runs once a page, whichever script comes first.
 */
export const FIRST_DRAW_WATCH = String.raw`(() => {
  if (window.__zaismaFirstDraw) return;
  const state = { firstDrawAtMs: null, drawKind: null, memories: new Set() };
  window.__zaismaFirstDraw = state;
  const restorers = [];
  // isCanvasKnown: the draw call's context says its canvas; WebGPU's queue and WebGL 1's instancing extension don't.
  const wrap = (prototype, names, kind, isCanvasKnown = true) => {
    if (!prototype) return;
    for (const name of names) {
      const original = prototype[name];
      if (typeof original !== "function") continue;
      prototype[name] = function (...args) {
        const canvas = this && this.canvas;
        // Only a canvas in the page counts: engines test what they can do on canvases they never show.
        if (state.firstDrawAtMs === null && (!isCanvasKnown || (canvas && canvas.isConnected && canvas.width && canvas.height))) {
          state.firstDrawAtMs = performance.timeOrigin + performance.now();
          state.drawKind = kind;
          for (const restore of restorers) restore();
        }
        return original.apply(this, args);
      };
      restorers.push(() => { prototype[name] = original; });
    }
  };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype, ["drawArrays", "drawElements"], "webgl");
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"], "webgl");
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ["drawImage", "fill", "fillRect", "fillText", "putImageData"], "2d");
  // macroquad and other WebGL 1 engines draw everything instanced, through an extension the page has no global for.
  const originalGetExtension = window.WebGLRenderingContext && WebGLRenderingContext.prototype.getExtension;
  if (originalGetExtension) {
    let isInstancingWrapped = false;
    WebGLRenderingContext.prototype.getExtension = function (name) {
      const extension = originalGetExtension.call(this, name);
      if (extension && !isInstancingWrapped && state.firstDrawAtMs === null && String(name).toLowerCase() === "angle_instanced_arrays") {
        isInstancingWrapped = true;
        wrap(Object.getPrototypeOf(extension), ["drawArraysInstancedANGLE", "drawElementsInstancedANGLE"], "webgl", false);
      }
      return extension;
    };
    restorers.push(() => { WebGLRenderingContext.prototype.getExtension = originalGetExtension; });
  }
  wrap(window.GPUQueue && GPUQueue.prototype, ["submit"], "webgpu", false);
  if (!window.WebAssembly) return;
  const keep = (exports) => { for (const value of Object.values(exports || {})) if (value instanceof WebAssembly.Memory) state.memories.add(value); };
  const OriginalMemory = WebAssembly.Memory;
  WebAssembly.Memory = function Memory(descriptor) { const memory = new OriginalMemory(descriptor); state.memories.add(memory); return memory; };
  WebAssembly.Memory.prototype = OriginalMemory.prototype;
  for (const name of ["instantiate", "instantiateStreaming"]) {
    const original = WebAssembly[name];
    if (typeof original !== "function") continue;
    WebAssembly[name] = function (...args) {
      return original.apply(this, args).then((made) => { keep((made.instance || made).exports); return made; });
    };
  }
})();`;

const START_FILE_DESTINATIONS:Record<string, StartFile["destination"]> = { script: "script", empty: "fetch", style: "style", image: "image", font: "font" };

/** The path of a URL inside the game, decoded, with its query, at the game's address or its version's; null when it's not one of the game's files (another site, or Zaisma's own _zaisma/ scripts). */
function gamePathOf(url: string, gameBaseUrl: string): string | null {
  if (!url.startsWith(gameBaseUrl)) return null;
  const rest = url.slice(gameBaseUrl.length).split("#")[0]!;
  const queryIndex = rest.indexOf("?");
  const pathPart = queryIndex === -1 ? rest : rest.slice(0, queryIndex);
  let path: string;
  try {
    path = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  // A file at its version's own address (where the game's pages open) is the same file of the game.
  const versionAddress = readVersionAddress(path);
  if (versionAddress) path = versionAddress.path;
  else if (path.startsWith("_zaisma/")) return null;
  return path + (queryIndex === -1 ? "" : rest.slice(queryIndex));
}

const megabytesText = (sizeBytes: number) => `${Math.max(1, Math.round(sizeBytes / 1024 ** 2))} MB`;
const secondsText = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;

/**
 * A run's report from what it saw (pure, so it's tested without a browser), with the version's asset notes
 * after the run's own. The game's page counts from its own request, so zaisma.com's redirects to it don't.
 */
export function reportFromObservations(observations: PerformanceObservations, assetNotes: PerformanceNote[]): PerformanceReport {
  const { gameBaseUrl, firstDrawAtMs } = observations;
  const requests = [...observations.requests].sort((first, second) => first.startedAtMs - second.startedAtMs);
  const pageRequest = requests.find((request) => request.fetchDestination === "document" && (request.url === gameBaseUrl || gamePathOf(request.url, gameBaseUrl) === "index.html"));
  const openedAtMs = pageRequest?.startedAtMs ?? observations.openedAtMs;
  const startRequests = firstDrawAtMs === null ? [] : requests.filter((request) => request.startedAtMs >= openedAtMs && request.finishedAtMs !== null && request.finishedAtMs <= firstDrawAtMs);

  const notes: PerformanceNote[] = [];
  const note = (code: string, message: string, path: string | null = null, savedSizeBytes: number | null = null) => notes.push({ code, message, path, saved_size_bytes: savedSizeBytes, fix: PERFORMANCE_NOTE_CODES[code]!.fix });
  const maximumCount = PERFORMANCE_CHECK_LIMITS.maximumErrorNoteCount;

  for (const error of observations.errors.slice(0, maximumCount)) {
    const file = error.url ? (gamePathOf(error.url, gameBaseUrl) ?? error.url) : null;
    note("error_at_start", `${error.message.split("\n")[0]!.slice(0, 300)}${file ? ` at ${file}${error.lineNumber !== null ? `:${error.lineNumber}` : ""}` : ""} while starting.`, file);
  }
  const missingPaths = [...new Set(requests.filter((request) => request.httpStatus === 404).map((request) => gamePathOf(request.url, gameBaseUrl)).filter((path): path is string => path !== null))];
  for (const path of missingPaths.slice(0, maximumCount)) note("missing_file_at_start", `The game asked for ${path} while starting, and it isn't in this version.`, path);
  const blockedAddresses = [...new Set(requests.filter((request) => request.blockedReason !== null).map((request) => request.url.split(/[?#]/)[0]!))];
  for (const address of blockedAddresses.slice(0, maximumCount)) note("blocked_at_start", `${address} was blocked while starting.`, gamePathOf(address, gameBaseUrl));
  if (firstDrawAtMs === null) note("no_frame_drawn", `Nothing was drawn in ${observations.maximumRunDurationSec} seconds, even after a click.`);

  const startDownloadSizeBytes = firstDrawAtMs === null ? null : startRequests.reduce((sumBytes, request) => sumBytes + request.downloadedSizeBytes, 0);
  if (startDownloadSizeBytes !== null && startDownloadSizeBytes >= PERFORMANCE_CHECK_LIMITS.bigStartDownloadSizeBytes) note("big_download_at_start", `Players download ${megabytesText(startDownloadSizeBytes)} before the first frame.`);
  const longestTaskDurationMs = observations.longTaskDurationsMs.length ? Math.round(Math.max(...observations.longTaskDurationsMs)) : null;
  if (longestTaskDurationMs !== null && longestTaskDurationMs >= PERFORMANCE_CHECK_LIMITS.longFreezeDurationMs) {
    note("long_freeze_at_start", `The page froze for ${secondsText(longestTaskDurationMs)} in one go while starting, so even a loading bar stops moving.`);
  }

  const startFiles: StartFile[] = [];
  const seenPaths = new Set<string>();
  for (const request of startRequests) {
    const path = gamePathOf(request.url, gameBaseUrl);
    const destination = START_FILE_DESTINATIONS[request.fetchDestination];
    // The page itself is never preloaded, and a part of a file (206) wouldn't match a whole-file preload.
    if (path === null || path === "" || path === "index.html" || !destination || request.httpStatus !== 200 || seenPaths.has(path)) continue;
    seenPaths.add(path);
    startFiles.push({ path, destination, is_cors_request: request.fetchMode === "cors", downloaded_size_bytes: request.downloadedSizeBytes });
  }

  const chromeMajorVersion = /Chrome\/(\d+)/.exec(observations.browserVersion)?.[1];
  return {
    browser_description: `Chrome${chromeMajorVersion ? ` ${chromeMajorVersion}` : ""} on a computer with no graphics card`,
    loading_duration_sec: firstDrawAtMs === null ? null : Math.round(Math.max(0, firstDrawAtMs - openedAtMs) / 100) / 10,
    start_download_size_bytes: startDownloadSizeBytes,
    start_file_count: firstDrawAtMs === null ? null : startRequests.length,
    start_memory_size_bytes: firstDrawAtMs === null || observations.memorySizeBytes === null ? null : Math.round(observations.memorySizeBytes),
    longest_start_task_duration_ms: longestTaskDurationMs,
    notes: [...notes, ...assetNotes],
    start_files: startFiles,
  };
}
