import { describe, expect, it } from "vitest";
import { PERFORMANCE_CHECK_LIMITS, reportFromObservations, type ObservedRequest, type PerformanceObservations } from "../../packages/core/src/performance.ts";

/**
 * A run in Chrome's report from what it saw (packages/core/src/performance.ts), with made-up observations: the
 * first frame, what was downloaded before it, the files its game page preloads, and the run's notes.
 */

const BASE = "https://sky-hopper--preview.zaismausercontent.com/";
const OPENED_AT_MS = 1_000_000;
const MEGABYTE_BYTES = 1024 * 1024;

const request = (path: string, startedAfterMs: number, finishedAfterMs: number | null, fields: Partial<ObservedRequest> = {}): ObservedRequest => ({
  url: path.startsWith("https://") ? path : BASE + path,
  startedAtMs: OPENED_AT_MS + startedAfterMs,
  finishedAtMs: finishedAfterMs === null ? null : OPENED_AT_MS + finishedAfterMs,
  httpStatus: 200,
  downloadedSizeBytes: 1000,
  fetchDestination: "script",
  fetchMode: "no-cors",
  blockedReason: null,
  ...fields,
});

const observed = (fields: Partial<PerformanceObservations>): PerformanceObservations => ({
  browserVersion: "HeadlessChrome/128.0.6613.84",
  gameBaseUrl: BASE,
  openedAtMs: OPENED_AT_MS - 400,
  firstDrawAtMs: null,
  isDrawnWithGpu: null,
  requests: [request("", 0, 50, { fetchDestination: "document", fetchMode: "navigate" })],
  errors: [],
  longTaskDurationsMs: [],
  memorySizeBytes: null,
  maximumRunDurationSec: 120,
  ...fields,
});

describe("a run's report", () => {
  it("times the first frame from the game's own page, and counts what came before it", () => {
    const report = reportFromObservations(
      observed({
        firstDrawAtMs: OPENED_AT_MS + 9100,
        memorySizeBytes: 1.2 * 1024 ** 3,
        requests: [
          request("", 0, 50, { fetchDestination: "document", fetchMode: "navigate", downloadedSizeBytes: 5000 }),
          request("_zaisma/relay.js?v=6", 60, 80),
          request("Build/build.loader.js", 70, 200, { downloadedSizeBytes: 30_000 }),
          request("Build/build.framework.js", 210, 900, { downloadedSizeBytes: 600_000 }),
          request("Build/build.data", 220, 8000, { fetchDestination: "empty", fetchMode: "cors", downloadedSizeBytes: 610 * MEGABYTE_BYTES }),
          request("Build/build.wasm", 230, 7000, { fetchDestination: "empty", fetchMode: "cors", downloadedSizeBytes: 9 * MEGABYTE_BYTES }),
          // After the first frame: not counted, not preloaded.
          request("levels/forest.bundle", 9500, 9800, { fetchDestination: "empty", fetchMode: "cors" }),
        ],
      }),
      [],
    );
    expect(report.browser_description).toBe("Chrome 128 on a computer with no graphics card");
    expect(report.loading_duration_sec).toBe(9.1);
    expect(report.start_file_count).toBe(6);
    expect(report.start_download_size_bytes).toBe(5000 + 1000 + 30_000 + 600_000 + 610 * MEGABYTE_BYTES + 9 * MEGABYTE_BYTES);
    expect(report.start_memory_size_bytes).toBe(Math.round(1.2 * 1024 ** 3));
    // In request order, without the page itself or Zaisma's own scripts; CORS requests say so for their preload.
    expect(report.start_files).toEqual([
      { path: "Build/build.loader.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 30_000 },
      { path: "Build/build.framework.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 600_000 },
      { path: "Build/build.data", destination: "fetch", is_cors_request: true, downloaded_size_bytes: 610 * MEGABYTE_BYTES },
      { path: "Build/build.wasm", destination: "fetch", is_cors_request: true, downloaded_size_bytes: 9 * MEGABYTE_BYTES },
    ]);
    expect(report.notes.map((note) => note.code)).toEqual(["big_download_at_start"]);
    expect(report.notes[0]!.message).toBe(`Players download ${Math.round(report.start_download_size_bytes! / MEGABYTE_BYTES)} MB before the first frame.`);
  });

  it("says a game file that wasn't there, and what was blocked", () => {
    const report = reportFromObservations(
      observed({
        firstDrawAtMs: OPENED_AT_MS + 2000,
        requests: [
          request("", 0, 50, { fetchDestination: "document", fetchMode: "navigate" }),
          request("Build/levels/forest.bundle", 100, 150, { httpStatus: 404, fetchDestination: "empty", fetchMode: "cors" }),
          request("https://cdn.example.com/lib.js?v=2", 120, null, { httpStatus: null, blockedReason: "csp" }),
        ],
      }),
      [],
    );
    expect(report.notes).toEqual([
      { code: "missing_file_at_start", message: "The game asked for Build/levels/forest.bundle while starting, and it isn't in this version.", path: "Build/levels/forest.bundle", saved_size_bytes: null, fix: expect.stringContaining("case-sensitive") },
      { code: "blocked_at_start", message: "https://cdn.example.com/lib.js was blocked while starting.", path: null, saved_size_bytes: null, fix: expect.stringContaining("update_game") },
    ]);
    // A file that wasn't there is never preloaded.
    expect(report.start_files).toEqual([]);
  });

  it("reads files at the version's own address, where the game's pages open, as the game's own paths", () => {
    const VERSION = "_zaisma/versions/version_1c2r6z4i462017691t6s/";
    const report = reportFromObservations(
      observed({
        firstDrawAtMs: OPENED_AT_MS + 3000,
        requests: [
          request("", 0, 20, { fetchDestination: "document", fetchMode: "navigate", httpStatus: 302 }),
          request(VERSION, 25, 50, { fetchDestination: "document", fetchMode: "navigate" }),
          request("_zaisma/relay.js?v=6", 60, 80),
          request(`${VERSION}Build/build.loader.js`, 70, 200),
          request(`${VERSION}Build/missing.data`, 80, 210, { httpStatus: 404, fetchDestination: "empty", fetchMode: "cors" }),
        ],
      }),
      [],
    );
    expect(report.start_files).toEqual([{ path: "Build/build.loader.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 1000 }]);
    expect(report.notes.map((note) => note.path)).toEqual(["Build/missing.data"]);
  });

  it("gives errors with their file and line, up to 5", () => {
    const errors = Array.from({ length: 7 }, (_, i) => ({ message: `TypeError: player ${i} is undefined\n    at start (game.js:12)`, url: `${BASE}game.js`, lineNumber: 12 }));
    const report = reportFromObservations(observed({ firstDrawAtMs: OPENED_AT_MS + 1000, errors }), []);
    const errorNotes = report.notes.filter((note) => note.code === "error_at_start");
    expect(errorNotes).toHaveLength(PERFORMANCE_CHECK_LIMITS.maximumErrorNoteCount);
    expect(errorNotes[0]).toMatchObject({ message: "TypeError: player 0 is undefined at game.js:12 while starting.", path: "game.js" });
  });

  it("says nothing was drawn, with no numbers but its longest freeze", () => {
    const report = reportFromObservations(observed({ longTaskDurationsMs: [300, 2400.4, 900], memorySizeBytes: 50_000_000 }), []);
    expect(report.loading_duration_sec).toBeNull();
    expect(report.start_download_size_bytes).toBeNull();
    expect(report.start_file_count).toBeNull();
    expect(report.start_memory_size_bytes).toBeNull();
    expect(report.longest_start_task_duration_ms).toBe(2400);
    expect(report.notes.map((note) => note.code)).toEqual(["no_frame_drawn", "long_freeze_at_start"]);
    expect(report.notes[0]!.message).toBe("Nothing was drawn in 120 seconds, even after a click.");
    expect(report.notes[1]!.message).toBe("The page froze for 2.4 s in one go while starting, so even a loading bar stops moving.");
  });

  it("puts the asset notes after the run's own", () => {
    const assetNote = { code: "audio_could_be_opus", message: "10 MB of WAV and AIFF audio could be about 1 MB as Ogg Opus.", path: "theme.wav", saved_size_bytes: 9_000_000, fix: "Convert it." };
    const report = reportFromObservations(observed({}), [assetNote]);
    expect(report.notes.map((note) => note.code)).toEqual(["no_frame_drawn", "audio_could_be_opus"]);
  });
});
