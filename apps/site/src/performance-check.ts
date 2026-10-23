import puppeteer from "@cloudflare/puppeteer";
import {
  FIRST_DRAW_WATCH,
  PERFORMANCE_CHECK_LIMITS,
  gameAddress,
  gameById,
  randomKey,
  reportFromObservations,
  versionById,
  type ObservedRequest,
  type PerformanceCheckRow,
  type PerformanceObservations,
  type Version,
} from "@zaisma/core";
import { assetHeadSizes, audioDurationSec, findAssetNotes, imageSizePx, type AssetFile } from "../../../packages/cli/performance.mjs";
import { gameUrl, type Env } from "./env.ts";
import { previewLinkToken } from "./preview-links.ts";
import { versionFiles } from "./scan.ts";

/**
 * Every version is started in Chrome (docs/DECISIONS.md, "Every version is started in Chrome, and what it finds
 * are notes."): once a version passes the scan it waits on the zaisma-performance queue, and one Worker at a
 * time opens it in Cloudflare's headless Chrome through its own preview link, then saves how it started:
 * its first frame, what it downloaded before it, its memory, its errors and the files that could be much
 * smaller. Notes never hold a version; past a developer's daily runs, a version just isn't measured.
 */

export interface PerformanceJob {
  versionId: string;
}

/** Opens a page in Chrome and says what it saw; tests bring their own. */
export type ChromeRun = (env: Env, pageUrl: string, gameBaseUrl: string) => Promise<PerformanceObservations>;

const DAY_MS = 24 * 3600 * 1000;

/** A version that just passed: queued for Chrome, or marked over the developer's daily limit. Zip versions and ones already queued are left alone. */
export async function queuePerformanceCheck(env: Env, version: Version): Promise<void> {
  if (version.kind !== "files") return;
  const game = await gameById(env.DB, version.game_id);
  if (!game?.owner_id) return;
  const nowMs = Date.now();
  const dayStartMs = nowMs - (nowMs % DAY_MS);
  const counted = await env.DB.prepare("SELECT COUNT(*) AS check_count FROM performance_checks WHERE owner_id = ? AND queued_at_ms >= ? AND check_status != 'over_daily_limit'")
    .bind(game.owner_id, dayStartMs)
    .first<{ check_count: number }>();
  const checkStatus = (counted?.check_count ?? 0) >= PERFORMANCE_CHECK_LIMITS.maximumDailyCheckCount ? "over_daily_limit" : "waiting";
  const inserted = await env.DB.prepare("INSERT INTO performance_checks (version_id, owner_id, check_status, queued_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (version_id) DO NOTHING RETURNING version_id")
    .bind(version.id, game.owner_id, checkStatus, nowMs)
    .first();
  if (inserted && checkStatus === "waiting") await env.PERFORMANCE_QUEUE.send({ versionId: version.id });
}

export async function handlePerformanceBatch(batch: MessageBatch<PerformanceJob>, env: Env, run: ChromeRun = runInChrome): Promise<void> {
  for (const message of batch.messages) {
    try {
      await checkVersion(env, message.body.versionId, run);
      message.ack();
    } catch (error) {
      // Chrome or Browser Rendering's limits: tried again a minute later, then two; after three, nothing for the developer to fix.
      console.error("performance check failed", message.body.versionId, error);
      if (message.attempts >= 3) {
        await env.DB.prepare("UPDATE performance_checks SET check_status = 'could_not_run', checked_at_ms = ? WHERE version_id = ?").bind(Date.now(), message.body.versionId).run();
        message.ack();
      } else {
        await env.DB.prepare("UPDATE performance_checks SET check_status = 'waiting' WHERE version_id = ?").bind(message.body.versionId).run();
        message.retry({ delaySeconds: 60 * message.attempts });
      }
    }
  }
}

/** One version's run: through its preview link, so it's served exactly as players get it; previews never count as plays. */
export async function checkVersion(env: Env, versionId: string, run: ChromeRun = runInChrome): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM performance_checks WHERE version_id = ?").bind(versionId).first<PerformanceCheckRow>();
  if (!row || (row.check_status !== "waiting" && row.check_status !== "checking")) return;
  let version = await versionById(env.DB, versionId);
  const game = version ? await gameById(env.DB, version.game_id) : null;
  // Held again by a report or a person since it passed: it isn't opened, and isn't measured.
  if (!version || !game || version.scan_status !== "approved") {
    await env.DB.prepare("UPDATE performance_checks SET check_status = 'could_not_run', checked_at_ms = ? WHERE version_id = ?").bind(Date.now(), versionId).run();
    return;
  }
  await env.DB.prepare("UPDATE performance_checks SET check_status = 'checking' WHERE version_id = ?").bind(versionId).run();
  // A version published straight away never got a preview key.
  await env.DB.prepare("UPDATE versions SET preview_link_key = COALESCE(preview_link_key, ?) WHERE id = ?").bind(randomKey(32), versionId).run();
  version = (await versionById(env.DB, versionId))!;
  const preview = previewLinkToken(version)!;
  const observations = await run(env, `${env.SITE_ORIGIN}/p/${preview.token}`, gameUrl(env, gameAddress(game.slug, "preview")));
  const report = reportFromObservations(observations, findAssetNotes(await assetFiles(env, version), { isDrawnWithGpu: observations.isDrawnWithGpu }));
  const { start_files: startFiles, ...shown } = report;
  await env.DB.prepare("UPDATE performance_checks SET check_status = 'checked', report = ?, start_files = ?, checked_at_ms = ? WHERE version_id = ?")
    .bind(JSON.stringify(shown), JSON.stringify(startFiles), Date.now(), versionId)
    .run();
}

/**
 * The version's files for the asset notes, read from storage: each image's size and each sound's length from its
 * first bytes, read and let go one at a time (a game can have thousands); a model's first bytes; and an engine's
 * loader beside its .wasm, for a development build. Other code isn't read: the run itself saw what draws.
 */
async function assetFiles(env: Env, version: Version): Promise<AssetFile[]> {
  const stored = await versionFiles(env, version);
  const paths = new Set(stored.map((file) => file.path));
  const headSizes = assetHeadSizes(stored);
  const files: AssetFile[] = [];
  const queue = [...stored];
  const readHead = async (key: string, byteCount: number) => {
    const object = await env.GAMES.get(key, { range: { offset: 0, length: byteCount } });
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  };
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const assetFile: AssetFile = { path: file.path, sizeBytes: file.sizeBytes, contentText: null };
        files.push(assetFile);
        const byteCount = headSizes.get(file.path);
        if (!byteCount) continue;
        const extension = file.path.slice(file.path.lastIndexOf(".") + 1).toLowerCase();
        const isCode = ["js", "mjs", "html", "htm"].includes(extension);
        if (isCode && !paths.has(`${file.path.replace(/\.[^./]+$/, "")}.wasm`)) continue;
        const headBytes = await readHead(file.key, byteCount);
        if (["png", "jpg", "jpeg", "webp"].includes(extension)) assetFile.sizePx = imageSizePx(headBytes);
        else if (["wav", "aif", "aiff"].includes(extension)) assetFile.durationSec = audioDurationSec(headBytes, file.sizeBytes);
        else assetFile.headBytes = headBytes;
      }
    }),
  );
  return files.sort((first, second) => (first.path < second.path ? -1 : 1));
}

/**
 * The page script the run puts in every page before the game's own: the first draw and WebAssembly memories
 * (FIRST_DRAW_WATCH, shared with the game frame's measuring, so load times mean the same), and the page's long tasks.
 */
export const PERFORMANCE_PROBE = `${FIRST_DRAW_WATCH}
(() => {
  if (window.__zaismaPerformance) return;
  const drawn = window.__zaismaFirstDraw;
  const state = { longTaskDurationsMs: [] };
  window.__zaismaPerformance = state;
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) state.longTaskDurationsMs.push(entry.duration); }).observe({ type: "longtask", buffered: true });
  } catch {}
  state.read = () => ({
    firstDrawAtMs: drawn.firstDrawAtMs,
    drawKind: drawn.drawKind,
    longTaskDurationsMs: state.longTaskDurationsMs,
    wasmMemorySizeBytes: [...drawn.memories].reduce((sumBytes, memory) => sumBytes + memory.buffer.byteLength, 0),
  });
})();`;

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

/** The run in Cloudflare's headless Chrome, over its DevTools protocol, as scripts/engines/play.mjs does locally. */
export const runInChrome: ChromeRun = async (env, pageUrl, gameBaseUrl) => {
  if (!env.BROWSER) throw new Error("No Browser Rendering binding (BROWSER)");
  // The preview waits less for a game that never draws (its Chrome can't start one that needs a cross-origin isolated frame).
  const maximumRunDurationSec = Number(env.PERFORMANCE_CHECK_MAXIMUM_RUN_DURATION_SEC) || PERFORMANCE_CHECK_LIMITS.maximumRunDurationSec;
  const browser = await puppeteer.launch(env.BROWSER as unknown as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(PERFORMANCE_PROBE);
    const session = await page.target().createCDPSession();
    const requests = new Map<string, ObservedRequest>();
    // Chrome's network times are its own clock; each request's wall time says how far it is from the page's.
    const wallOffsetsSec = new Map<string, number>();
    const errors: PerformanceObservations["errors"] = [];
    let inFlightCount = 0;
    session.on("Network.requestWillBeSent", (event) => {
      if (!/^https?:/.test(event.request.url)) return;
      if (!requests.has(event.requestId)) inFlightCount++;
      requests.set(event.requestId, {
        url: event.request.url,
        startedAtMs: event.wallTime * 1000,
        finishedAtMs: null,
        httpStatus: null,
        downloadedSizeBytes: 0,
        fetchDestination: event.type === "Document" ? "document" : "",
        fetchMode: "",
        blockedReason: null,
      });
      wallOffsetsSec.set(event.requestId, event.wallTime - event.timestamp);
    });
    session.on("Network.requestWillBeSentExtraInfo", (event) => {
      const request = requests.get(event.requestId);
      const headers = Object.fromEntries(Object.entries(event.headers).map(([name, headerValue]) => [name.toLowerCase(), String(headerValue)]));
      if (!request) return;
      request.fetchDestination = headers["sec-fetch-dest"] ?? request.fetchDestination;
      request.fetchMode = headers["sec-fetch-mode"] ?? "";
    });
    session.on("Network.responseReceived", (event) => {
      const request = requests.get(event.requestId);
      if (request) request.httpStatus = event.response.status;
    });
    session.on("Network.loadingFinished", (event) => {
      const request = requests.get(event.requestId);
      if (!request || request.finishedAtMs !== null) return;
      inFlightCount--;
      request.finishedAtMs = (event.timestamp + wallOffsetsSec.get(event.requestId)!) * 1000;
      request.downloadedSizeBytes = event.encodedDataLength;
    });
    session.on("Network.loadingFailed", (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      inFlightCount--;
      request.blockedReason = event.blockedReason ?? null;
    });
    session.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      errors.push({ message: exceptionDetails.exception?.description ?? exceptionDetails.text, url: exceptionDetails.url ?? null, lineNumber: exceptionDetails.lineNumber !== undefined ? exceptionDetails.lineNumber + 1 : null });
    });
    // Engines report their own errors with console.error (Unity, Godot).
    session.on("Runtime.consoleAPICalled", (event) => {
      if (event.type !== "error") return;
      const frame = event.stackTrace?.callFrames[0];
      errors.push({ message: event.args.map((argument) => String(argument.value ?? argument.description ?? "")).join(" "), url: frame?.url || null, lineNumber: frame ? frame.lineNumber + 1 : null });
    });
    await session.send("Network.enable");
    await session.send("Runtime.enable");
    await session.send("Performance.enable");

    const openedAtMs = Date.now();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: maximumRunDurationSec * 1000 });
    type ProbeState = { firstDrawAtMs: number | null; drawKind: string | null; longTaskDurationsMs: number[]; wasmMemorySizeBytes: number };
    const readProbe = () => page.evaluate("window.__zaismaPerformance ? window.__zaismaPerformance.read() : null").catch(() => null) as Promise<ProbeState | null>;
    let isClicked = false;
    let probe: ProbeState | null = null;
    while (Date.now() - openedAtMs < maximumRunDurationSec * 1000) {
      await wait(500);
      probe = await readProbe();
      if (probe?.firstDrawAtMs) {
        await wait(PERFORMANCE_CHECK_LIMITS.afterFirstFrameDurationSec * 1000);
        break;
      }
      // Many games wait for a click (to start their sound) before they draw anything.
      if (!isClicked && Date.now() - openedAtMs >= PERFORMANCE_CHECK_LIMITS.clickAfterSec * 1000 && inFlightCount <= 0) {
        isClicked = true;
        await page.mouse.click(640, 400).catch(() => {});
      }
    }
    probe = (await readProbe()) ?? probe;
    const { metrics } = await session.send("Performance.getMetrics");
    const heapSizeBytes = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? null;
    return {
      browserVersion: await browser.version(),
      gameBaseUrl,
      openedAtMs,
      firstDrawAtMs: probe?.firstDrawAtMs ?? null,
      isDrawnWithGpu: probe?.drawKind ? probe.drawKind !== "2d" : null,
      requests: [...requests.values()],
      errors,
      longTaskDurationsMs: probe?.longTaskDurationsMs ?? [],
      memorySizeBytes: heapSizeBytes === null ? null : heapSizeBytes + (probe?.wasmMemorySizeBytes ?? 0),
      maximumRunDurationSec,
    };
  } finally {
    await browser.close().catch(() => {});
  }
};
