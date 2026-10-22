/**
 * How games run for their players, as totals (docs/DECISIONS.md, "How a game runs for its players is the
 * developer's, as totals"). The game frame measures each play (packages/sdk/performance.js), the game page adds
 * the summary to its time reports (apps/site/src/plays.ts), and the totals are kept a day at a time per version
 * and device group in performance_days, as fixed-bucket histograms: no player IDs, nothing kept per play.
 * get_stats reads them back through playerPerformanceRow.
 */

/** Load time buckets' upper edges, in seconds; the last bucket is above 80. */
export const LOADING_BUCKETS_SEC = [2, 5, 10, 20, 40, 80] as const;
/** Frame rate buckets' upper edges, in frames a second, counting seconds of play; the last bucket is 120 and up. */
export const FRAME_RATE_BUCKETS = [15, 25, 30, 45, 60, 90, 120] as const;
const MEBIBYTE_SIZE_BYTES = 1024 ** 2;
/** Peak memory buckets' upper edges, in bytes (256 MB to 4 GB); the last bucket is above 4 GB. */
export const MEMORY_BUCKETS_BYTES = [256 * MEBIBYTE_SIZE_BYTES, 512 * MEBIBYTE_SIZE_BYTES, 1024 * MEBIBYTE_SIZE_BYTES, 2048 * MEBIBYTE_SIZE_BYTES, 4096 * MEBIBYTE_SIZE_BYTES];

export const BROWSER_NAMES = ["chrome", "edge", "firefox", "safari", "samsung_internet", "other"] as const;
/** The device labels' words: the game page's own guess, from its pointer and screen. */
export const DEVICE_KINDS = ["computer", "phone", "tablet"] as const;
export const OS_NAMES = ["windows", "macos", "linux", "chromeos", "android", "ios", "other"] as const;
export const GRAPHICS_FAMILIES = ["nvidia", "amd", "intel", "apple", "qualcomm", "arm", "imagination", "other", "unknown"] as const;
export const CRASH_KINDS = ["error_stop", "context_lost", "stopped_responding"] as const;

export type BrowserName = (typeof BROWSER_NAMES)[number];
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type OsName = (typeof OS_NAMES)[number];
export type GraphicsFamily = (typeof GRAPHICS_FAMILIES)[number];
export type CrashKind = (typeof CRASH_KINDS)[number];

/**
 * The graphics chip family from the browser's renderer string, matched in the game frame so only the family
 * leaves it (the full string is a fingerprint). Checked in order; nothing matching is other.
 */
export const GRAPHICS_FAMILY_PATTERNS: [GraphicsFamily, string][] = [
  ["nvidia", "nvidia|geforce|quadro|tesla|rtx"],
  ["amd", "\\bamd\\b|radeon|\\bati\\b"],
  ["intel", "intel|iris|uhd graphics"],
  ["apple", "apple"],
  ["qualcomm", "adreno|qualcomm"],
  ["arm", "mali|\\barm\\b|immortalis"],
  ["imagination", "powervr|imagination"],
];

export const PLAYER_PERFORMANCE_LIMITS = {
  /** Device groups with fewer plays than this fold into other, so a rare device can't single out a player. */
  minimumGroupPlayCount: 20,
  /** A frame this long or longer is a stutter. */
  longFrameDurationMs: 50,
  /** The game frame not answering this long while visible is a crash (stopped_responding). */
  stoppedRespondingAfterSec: 15,
  /** An uncaught error followed by no frame for this long while visible is a crash (error_stop). */
  errorStopAfterSec: 5,
  /** How often the game frame sends the game page what it measured. */
  reportIntervalSec: 30,
  /** How often the game frame says it's still answering. */
  aliveIntervalSec: 5,
  /** A play nothing was drawn in for this long is reported without a load time (the Chrome check waits as long). */
  loadingGivenUpAfterSec: 120,
  maximumReportSizeBytes: 1024,
  /** The most of any count one report gives. */
  maximumReportedCount: 10_000,
};

/** The browser, from a User-Agent header (the header itself is never kept). */
export function browserOf(userAgent: string): BrowserName {
  if (/SamsungBrowser\//.test(userAgent)) return "samsung_internet";
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) return "edge";
  // Opera, Yandex and the like are Chromium with their own name: other.
  if (/\b(OPR|OPX|YaBrowser|Vivaldi|UCBrowser)\//.test(userAgent)) return "other";
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return "firefox";
  if (/\b(Chrome|CriOS|Chromium)\//.test(userAgent)) return "chrome";
  if (/\bVersion\/[\d.]+.*Safari\//.test(userAgent)) return "safari";
  return "other";
}

/** The system, from a User-Agent header. iPads that ask for the desktop site say Macintosh, so they read as macos. */
export function osOf(userAgent: string): OsName {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return "ios";
  if (/\bAndroid\b/.test(userAgent)) return "android";
  if (/\bCrOS\b/.test(userAgent)) return "chromeos";
  if (/\bWindows\b/.test(userAgent)) return "windows";
  if (/\b(Macintosh|Mac OS X)\b/.test(userAgent)) return "macos";
  if (/\bLinux\b/.test(userAgent)) return "linux";
  return "other";
}

/** The bucket a value falls in: buckets are upper edges, so the bucket holds values below its edge. */
export function bucketOf(buckets: readonly number[], givenNumber: number): number {
  return buckets.filter((edgeNumber) => givenNumber >= edgeNumber).length;
}

/** Counts summed bucket by bucket. */
export function sumCounts(first: readonly number[], second: readonly number[]): number[] {
  return Array.from({ length: Math.max(first.length, second.length) }, (_, i) => (first[i] ?? 0) + (second[i] ?? 0));
}

/**
 * The value at a fraction of the counts (0.5 for the median), interpolated inside its bucket; the last bucket,
 * which has no upper edge, gives its lower one. Null with no counts.
 */
export function percentileOf(buckets: readonly number[], counts: readonly number[], fractionNumber: number): number | null {
  const found = bucketAt(counts, fractionNumber);
  if (!found) return null;
  const lowerEdgeNumber = found.index === 0 ? 0 : buckets[found.index - 1]!;
  const upperEdgeNumber = buckets[found.index];
  return upperEdgeNumber === undefined ? lowerEdgeNumber : lowerEdgeNumber + (upperEdgeNumber - lowerEdgeNumber) * found.insideNumber;
}

/**
 * The frame rate at a fraction of the seconds played. Frame rates gather at screens' refresh rates (30, 60, 120),
 * which are the buckets' edges, so interpolating would put a steady 60 halfway to 90: a bucket gives its lower
 * edge (60 means 60 to 89), and only the lowest, below 15, is interpolated.
 */
export function frameRateAt(counts: readonly number[], fractionNumber: number): number | null {
  const found = bucketAt(counts, fractionNumber);
  if (!found) return null;
  return found.index === 0 ? FRAME_RATE_BUCKETS[0] * found.insideNumber : FRAME_RATE_BUCKETS[found.index - 1]!;
}

/** The bucket a fraction of the counts falls in, and how far into it (0 to 1). */
function bucketAt(counts: readonly number[], fractionNumber: number): { index: number; insideNumber: number } | null {
  const totalCount = counts.reduce((sumCount, bucketCount) => sumCount + bucketCount, 0);
  if (totalCount <= 0) return null;
  const targetCount = totalCount * Math.min(Math.max(fractionNumber, 0), 1);
  let belowCount = 0;
  for (let index = 0; index < counts.length; index++) {
    const bucketCount = counts[index]!;
    if (bucketCount > 0 && belowCount + bucketCount >= targetCount) return { index, insideNumber: (targetCount - belowCount) / bucketCount };
    belowCount += bucketCount;
  }
  return { index: counts.length - 1, insideNumber: 1 };
}

/** A performance_days row, its JSON columns read. */
export interface PerformanceDay {
  version_id: string;
  browser_name: string;
  os_name: string;
  device_kind: string;
  graphics_family: string;
  play_count: number;
  loading_counts: number[];
  frame_rate_seconds: number[];
  long_frame_count: number;
  measured_duration_sec: number;
  error_stop_count: number;
  context_lost_count: number;
  stopped_responding_count: number;
  memory_counts: number[];
}

/** What get_stats says about a set of plays (PLAYER_PERFORMANCE_ROW in apps/site/src/schemas.ts, less what names the group). */
export interface PlayerPerformanceRow {
  play_count: number;
  median_loading_duration_sec: number | null;
  slow_tenth_loading_duration_sec: number | null;
  median_frames_per_sec: number | null;
  low_tenth_frames_per_sec: number | null;
  long_frames_per_min: number | null;
  crashed_play_pct: number | null;
  error_stop_count: number;
  context_lost_count: number;
  stopped_responding_count: number;
  median_peak_memory_size_bytes: number | null;
  is_measured: boolean;
}

const oneDecimal = (givenNumber: number | null) => (givenNumber === null ? null : Math.round(givenNumber * 10) / 10);

/** Days of one group (or a version, or other) added up into what get_stats says. */
export function playerPerformanceRow(days: readonly PerformanceDay[]): PlayerPerformanceRow {
  let loadingCounts: number[] = [];
  let frameRateSeconds: number[] = [];
  let memoryCounts: number[] = [];
  let playCount = 0, longFrameCount = 0, measuredDurationSec = 0;
  let errorStopCount = 0, contextLostCount = 0, stoppedRespondingCount = 0;
  for (const day of days) {
    playCount += day.play_count;
    loadingCounts = sumCounts(loadingCounts, day.loading_counts);
    frameRateSeconds = sumCounts(frameRateSeconds, day.frame_rate_seconds);
    memoryCounts = sumCounts(memoryCounts, day.memory_counts);
    longFrameCount += day.long_frame_count;
    measuredDurationSec += day.measured_duration_sec;
    errorStopCount += day.error_stop_count;
    contextLostCount += day.context_lost_count;
    stoppedRespondingCount += day.stopped_responding_count;
  }
  const crashedPlayCount = errorStopCount + contextLostCount + stoppedRespondingCount;
  const isMeasured = measuredDurationSec > 0;
  const medianPeakMemorySizeBytes = percentileOf(MEMORY_BUCKETS_BYTES, memoryCounts, 0.5);
  return {
    play_count: playCount,
    median_loading_duration_sec: oneDecimal(percentileOf(LOADING_BUCKETS_SEC, loadingCounts, 0.5)),
    slow_tenth_loading_duration_sec: oneDecimal(percentileOf(LOADING_BUCKETS_SEC, loadingCounts, 0.9)),
    median_frames_per_sec: isMeasured ? Math.round(frameRateAt(frameRateSeconds, 0.5)!) : null,
    low_tenth_frames_per_sec: isMeasured ? Math.round(frameRateAt(frameRateSeconds, 0.1)!) : null,
    long_frames_per_min: isMeasured ? oneDecimal(longFrameCount / (measuredDurationSec / 60)) : null,
    crashed_play_pct: playCount ? oneDecimal(Math.min(100, (crashedPlayCount / playCount) * 100)) : null,
    error_stop_count: errorStopCount,
    context_lost_count: contextLostCount,
    stopped_responding_count: stoppedRespondingCount,
    median_peak_memory_size_bytes: medianPeakMemorySizeBytes === null ? null : Math.round(medianPeakMemorySizeBytes),
    is_measured: isMeasured,
  };
}

/** A game page's performance report, checked and clamped: what the server keeps of it. */
export interface PlayPerformanceReport {
  version_id: string | null;
  device_kind: DeviceKind;
  graphics_family: GraphicsFamily;
  loading_duration_sec: number | null;
  frame_rate_seconds: number[];
  long_frame_count: number;
  measured_duration_sec: number;
  /** The first crash it reports, in CRASH_KINDS' order; a play counts one. */
  crash_kind: CrashKind | null;
  peak_memory_size_bytes: number;
}

/** The most memory a report can claim: 64 GB, past any browser's. */
const MAXIMUM_MEMORY_SIZE_BYTES = 64 * 1024 ** 3;
/** The longest load a report can claim; the ticket's own age bounds it further. */
const MAXIMUM_LOADING_DURATION_SEC = 3600;

/**
 * The performance part of a game page's time report (apps/site/src/plays.ts), from untrusted JSON: anything
 * outside the choice lists folds into other (a hidden graphics chip is unknown), every number is clamped, and a
 * report with no device kind is no report. The ticket's own limits (time open, once a play) come after, in plays.ts.
 */
export function readPlayPerformanceReport(sent: unknown): PlayPerformanceReport | null {
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) return null;
  const report = sent as Record<string, unknown>;
  if (!DEVICE_KINDS.includes(report.device_kind as DeviceKind)) return null;
  const maximumCount = PLAYER_PERFORMANCE_LIMITS.maximumReportedCount;
  const amount = (sent: unknown, maximumNumber: number) => (typeof sent === "number" && Number.isFinite(sent) && sent > 0 ? Math.min(sent, maximumNumber) : 0);
  const graphicsFamily = report.graphics_family === null || report.graphics_family === undefined ? "unknown" : GRAPHICS_FAMILIES.includes(report.graphics_family as GraphicsFamily) ? (report.graphics_family as GraphicsFamily) : "other";
  const sentFrameRateSeconds = Array.isArray(report.frame_rate_seconds) ? report.frame_rate_seconds : [];
  const crashKindCounts = report.crash_kind_counts && typeof report.crash_kind_counts === "object" ? (report.crash_kind_counts as Record<string, unknown>) : {};
  return {
    version_id: typeof report.version_id === "string" && /^[a-z0-9_]{1,64}$/.test(report.version_id) ? report.version_id : null,
    device_kind: report.device_kind as DeviceKind,
    graphics_family: graphicsFamily,
    loading_duration_sec: typeof report.loading_duration_sec === "number" && Number.isFinite(report.loading_duration_sec) && report.loading_duration_sec >= 0 ? Math.min(report.loading_duration_sec, MAXIMUM_LOADING_DURATION_SEC) : null,
    frame_rate_seconds: Array.from({ length: FRAME_RATE_BUCKETS.length + 1 }, (_, i) => Math.round(amount(sentFrameRateSeconds[i], maximumCount))),
    long_frame_count: Math.round(amount(report.long_frame_count, maximumCount)),
    measured_duration_sec: Math.round(amount(report.measured_duration_sec, maximumCount)),
    crash_kind: CRASH_KINDS.find((kind) => amount(crashKindCounts[kind], maximumCount) > 0) ?? null,
    peak_memory_size_bytes: Math.round(amount(report.peak_memory_size_bytes, MAXIMUM_MEMORY_SIZE_BYTES)),
  };
}

/** Counts scaled down so they add up to at most total, each rounded down. */
export function countsWithin(counts: readonly number[], totalCount: number): number[] {
  const sumCount = counts.reduce((addedCount, bucketCount) => addedCount + bucketCount, 0);
  return sumCount <= totalCount ? [...counts] : counts.map((bucketCount) => Math.floor((bucketCount * totalCount) / sumCount));
}
