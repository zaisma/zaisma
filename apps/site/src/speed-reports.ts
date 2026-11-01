import { ApiError, DEVICE_KINDS } from "@zaisma/core";
import { CHECKED_PAGES } from "./components/checked-pages.ts";
import type { Env } from "./env.ts";
import { connectionAddressOf } from "./auth.ts";
import { pageScript } from "./page-scripts.ts";

/*
 * Speed on the live site: each page a real visit opens reports how fast it showed (POST /api/speed-reports, sent by SPEED_SCRIPT as the
 * page goes), with nothing that names the player or their device: which page, how long until its first paint, whether it was opened or
 * switched to from another of Zaisma's pages, and the kind of device and connection. Kept in Workers Analytics Engine
 * (zaisma_page_speed), which keeps no address and drops rows after 3 months; the admin MCP's get_page_speed reads it.
 */

export const SPEED_REPORT_PATH = "/api/speed-reports";
export const VISIT_KINDS = ["opened", "switched"] as const;
export const CONNECTION_KINDS = ["slow_2g", "2g", "3g", "4g", "unknown"] as const;
/** The longest wait reported: anything longer is a page left open in the background, not a page loading. */
export const FIRST_PAINT_DELAY_LIMIT_MS = 120_000;
/** A page that isn't on the checks' list reports as this. */
export const OTHER_PAGE_NAME = "other";
const REPORT_SIZE_LIMIT_BYTES = 512;

const PAGE_NAMES: ReadonlySet<string> = new Set([...CHECKED_PAGES.map((page) => page.name), OTHER_PAGE_NAME]);
const REPORT_FIELDS = ["page_name", "visit_kind", "first_paint_delay_ms", "device_kind", "connection_kind"] as const;

export interface SpeedReport {
  page_name: string;
  visit_kind: (typeof VISIT_KINDS)[number];
  first_paint_delay_ms: number;
  device_kind: (typeof DEVICE_KINDS)[number];
  connection_kind: (typeof CONNECTION_KINDS)[number];
}

/** A report as sent, or null when any field is missing, unknown or off its list. */
export function readSpeedReport(given: unknown): SpeedReport | null {
  if (!given || typeof given !== "object" || Array.isArray(given)) return null;
  const report = given as Record<string, unknown>;
  if (Object.keys(report).some((name) => !(REPORT_FIELDS as readonly string[]).includes(name))) return null;
  const delayMs = report.first_paint_delay_ms;
  if (typeof report.page_name !== "string" || !PAGE_NAMES.has(report.page_name)) return null;
  if (!(VISIT_KINDS as readonly unknown[]).includes(report.visit_kind)) return null;
  if (typeof delayMs !== "number" || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > FIRST_PAINT_DELAY_LIMIT_MS) return null;
  if (!(DEVICE_KINDS as readonly unknown[]).includes(report.device_kind)) return null;
  if (!(CONNECTION_KINDS as readonly unknown[]).includes(report.connection_kind)) return null;
  return report as unknown as SpeedReport;
}

const refused = (): Response =>
  Response.json(
    { error: { code: "bad_speed_report", message: `A speed report is { ${REPORT_FIELDS.join(", ")} }, each from its list, the delay a whole number of ms from 0 to ${FIRST_PAINT_DELAY_LIMIT_MS}.` } },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );

/** POST /api/speed-reports: one page's report. Answered 204, also when the limit is reached, so a page never retries. */
export async function handleSpeedReports(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== SPEED_REPORT_PATH) return null;
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.SITE_ORIGIN).origin) return new Response(null, { status: 403 });
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  // Counted by connection, never kept.
  if (env.SPEED_REPORT_LIMIT && !(await env.SPEED_REPORT_LIMIT.limit({ key: connectionAddressOf(request) ?? "unknown" })).success) return done;
  if (Number(request.headers.get("content-length") ?? "0") > REPORT_SIZE_LIMIT_BYTES) return refused();
  const text = await request.text();
  if (text.length > REPORT_SIZE_LIMIT_BYTES) return refused();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return refused(); }
  const report = readSpeedReport(parsed);
  if (!report) return refused();
  env.PAGE_SPEED?.writeDataPoint({ indexes: [report.page_name], blobs: [report.page_name, report.visit_kind, report.device_kind, report.connection_kind], doubles: [report.first_paint_delay_ms] });
  return done;
}

/**
 * The page's report, sent once as it's hidden or left: its first paint (first contentful paint), from the press that opened it when it was
 * prepared ahead (activationStart), its name from the checks' list (html.ts's checkedPageTag), switched when the page before was Zaisma's
 * (the referrer's origin, read here and never sent), and the kind of device measured as device-kind.ts does.
 */
export const SPEED_SCRIPT = pageScript("speed-reports", `(function () {
  if (!window.PerformanceObserver || !navigator.sendBeacon) return;
  var paintMs = null, isSent = false;
  try { new PerformanceObserver(function (list) { list.getEntries().forEach(function (entry) { if (entry.name === "first-contentful-paint") paintMs = entry.startTime; }); }).observe({ type: "paint", buffered: true }); } catch (error) { return; }
  function send() {
    if (isSent || paintMs === null) return;
    isSent = true;
    var navigation = performance.getEntriesByType("navigation")[0] || {}, named = document.querySelector('meta[name="checked-page"]'), from = "";
    try { from = new URL(document.referrer).origin; } catch (error) {}
    var connection = navigator.connection && navigator.connection.effectiveType;
    var report = {
      page_name: named ? named.content : "${OTHER_PAGE_NAME}",
      visit_kind: from === location.origin ? "switched" : "opened",
      first_paint_delay_ms: Math.min(${FIRST_PAINT_DELAY_LIMIT_MS}, Math.max(0, Math.round(paintMs - (navigation.activationStart || 0)))),
      device_kind: matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet") : "computer",
      connection_kind: connection === "slow-2g" ? "slow_2g" : /^[234]g$/.test(connection || "") ? connection : "unknown"
    };
    navigator.sendBeacon("${SPEED_REPORT_PATH}", new Blob([JSON.stringify(report)], { type: "application/json" }));
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") send(); });
  addEventListener("pagehide", send);
})();`);

/** get_page_speed's inputs (admin-mcp.ts). */
export const MAXIMUM_PAGE_SPEED_DAY_COUNT = 30;

export interface PageSpeedRow {
  page_name: string;
  visit_kind: string;
  device_kind: string | null;
  report_count: number;
  median_first_paint_delay_ms: number;
  p75_first_paint_delay_ms: number;
  p95_first_paint_delay_ms: number;
}

/** Analytics Engine's SQL API (Cloudflare's), on the account the site runs in. */
const sqlApiUrl = (env: Env): string => `${env.CLOUDFLARE_API_URL ?? "https://api.cloudflare.com/client/v4"}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`;

/** How fast pages showed on real visits over the last days, per page and visit kind (and kind of device when asked), most reported first. */
export async function pageSpeedAnswer(env: Env, options: { dayCount: number; isByDeviceKind: boolean }): Promise<{ pages: PageSpeedRow[] }> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.ANALYTICS_API_TOKEN) throw new ApiError("speed_not_set_up", { message: "The site has no CLOUDFLARE_ACCOUNT_ID and ANALYTICS_API_TOKEN to read Analytics Engine with.", fix: "Set both as the site Worker's secrets: a token with Account Analytics read." });
  const byDevice = options.isByDeviceKind ? ", blob3" : "";
  const sql = `SELECT blob1 AS page_name, blob2 AS visit_kind${options.isByDeviceKind ? ", blob3 AS device_kind" : ""}, SUM(_sample_interval) AS report_count,
quantileExactWeighted(0.5)(double1, _sample_interval) AS median_first_paint_delay_ms,
quantileExactWeighted(0.75)(double1, _sample_interval) AS p75_first_paint_delay_ms,
quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_first_paint_delay_ms
FROM zaisma_page_speed WHERE timestamp > NOW() - INTERVAL '${Math.round(options.dayCount)}' DAY
GROUP BY blob1, blob2${byDevice} ORDER BY report_count DESC LIMIT 500 FORMAT JSON`;
  const answer = await fetch(sqlApiUrl(env), { method: "POST", headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` }, body: sql });
  if (!answer.ok) throw new ApiError("speed_unreadable", { message: `Analytics Engine answered ${answer.status}.`, fix: "Try again in a minute; the dataset is made by the first report a page sends." });
  const answered = (await answer.json()) as { data: Record<string, string | number>[] };
  return {
    pages: answered.data.map((row) => ({
      page_name: String(row.page_name),
      visit_kind: String(row.visit_kind),
      device_kind: options.isByDeviceKind ? String(row.device_kind) : null,
      report_count: Math.round(Number(row.report_count)),
      median_first_paint_delay_ms: Math.round(Number(row.median_first_paint_delay_ms)),
      p75_first_paint_delay_ms: Math.round(Number(row.p75_first_paint_delay_ms)),
      p95_first_paint_delay_ms: Math.round(Number(row.p95_first_paint_delay_ms)),
    })),
  };
}
