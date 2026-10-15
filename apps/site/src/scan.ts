import {
  IMAGE_TYPES,
  TEXT_EXTENSIONS,
  addAiUsage,
  aiUsage,
  audit,
  decide,
  extensionOf,
  gameById,
  notConnected,
  publishVersion,
  saveScan,
  setReviewStatus,
  sha256Hex,
  staticScan,
  versionById,
  type Finding,
  type ImageMatcher,
  type ImageMatchResult,
  type ScanJob,
  type ScanReport,
  type Manifest,
  type Version,
  type Game,
  KEPT_VERSION_COUNT,
  KNOWN_IMAGE_RULE,
  MATCH_TYPES,
  MATROSKA_HEAD_BYTES,
  SNIFF_BYTES,
  approveDraft,
  arachnidShield,
  embeddedMedia,
  matroskaHasVideo,
  sniffMedia,
  type MediaForMatching,
  blobKey,
  blobSizes,
  ownedBlobKey,
  manifestKey,
} from "@zaisma/core";
import { deletePrefix } from "./upload.ts";
import { TEXT_BUDGET_CHARS, aiReview, type AiInput, type AiResult } from "./ai.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { recheckFailed, recheckVersion } from "./triage.ts";

/** Most text we read for the static checks. Bigger games are held for a person. */
const STATIC_TEXT_LIMIT = 40 * 1024 * 1024;
const AI_IMAGE_LIMIT = 8;
const AI_IMAGE_MAX_BYTES = 1024 * 1024;
/** Most pictures and videos matched per version (each is a request to the matcher and one to storage). More are held for a person. */
export const MATCH_LIMIT = 5000;
/** Most other files whose first bytes are read, to find pictures and videos under other names. More are held for a person. */
export const SNIFF_LIMIT = 5000;

export interface ScanDeps {
  images: ImageMatcher;
  ai: (apiKey: string, model: string, input: AiInput) => Promise<AiResult>;
}

/** Arachnid Shield when its key is set; otherwise image matching isn't connected and every game waits for a person. */
export function imageMatcher(env: Env): ImageMatcher {
  return env.ARACHNID_SHIELD_KEY ? arachnidShield(env.ARACHNID_SHIELD_KEY, { baseUrl: env.ARACHNID_SHIELD_URL }) : notConnected;
}

export const scanDeps = (env: Env): ScanDeps => ({ images: imageMatcher(env), ai: aiReview });

export async function handleScanBatch(batch: MessageBatch<ScanJob>, env: Env, deps = scanDeps(env)): Promise<void> {
  for (const msg of batch.messages) {
    const { recheck, images } = msg.body;
    try {
      if (recheck) await recheckVersion(env, msg.body.versionId, recheck.reportId, deps);
      else if (images) await recheckImages(env, msg.body.versionId, deps);
      else await scanVersion(env, msg.body.versionId, deps);
      msg.ack();
    } catch (err) {
      console.error(recheck ? "re-check failed" : images ? "image check failed" : "scan failed", msg.body.versionId, err);
      if (images && msg.attempts >= 3) {
        // Tried again with tomorrow's batch; the version stays as it is.
        msg.ack();
      } else if (recheck && msg.attempts >= 3) {
        await recheckFailed(env, recheck.reportId, String(err));
        msg.ack();
      } else if (msg.attempts >= 3) {
        await saveScan(env.DB, msg.body.versionId, "held", null);
        await sendAlert(env, "A scan failed", `Version ${msg.body.versionId} couldn't be scanned and is held: ${String(err)}`);
        msg.ack();
      } else {
        msg.retry({ delaySeconds: 30 * msg.attempts });
      }
    }
  }
}

export async function scanVersion(env: Env, versionId: string, deps: ScanDeps = scanDeps(env)): Promise<ScanReport> {
  const version = await versionById(env.DB, versionId);
  if (!version) throw new Error(`No version ${versionId}`);
  const game = await gameById(env.DB, version.game_id);
  if (!game) throw new Error(`No game for version ${versionId}`);

  const report = await inspectVersion(env, version, game, deps);
  const { decision, findings, childSafety } = report;
  await saveScan(env.DB, version.id, decision, report);
  if (decision === "approved") {
    await passVersion(env, version, "Passed the scan");
  } else {
    await audit(env.DB, game.id, decision === "held" ? "scan-held" : "scan-rejected", `${version.id}\n${summarize(findings)}`);
    const known = findings.some((f) => f.rule === KNOWN_IMAGE_RULE);
    if (known) {
      await sendAlert(
        env,
        `URGENT: known abuse images uploaded to ${game.slug}`,
        `${KNOWN_IMAGE_ALERT}\n\n${summarize(findings)}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
      );
    } else if (decision === "held" || childSafety) {
      await sendAlert(
        env,
        childSafety ? `URGENT child-safety flag on ${game.slug}` : `${game.slug} needs review`,
        `${childSafety ? "The scan flagged possible child sexual abuse material. Don't delete anything; review it and report to NCMEC if confirmed.\n\n" : ""}${summarize(findings)}\n\nReview: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
      );
    }
  }
  return report;
}

/** What to do when image matching finds known abuse material, for the alert and the admin page. */
export const KNOWN_IMAGE_ALERT =
  "Image matching (Arachnid Shield) found pictures that match known child sexual abuse material. The version is held and nothing was deleted. Don't open the pictures and don't delete anything: the law requires a report to NCMEC's CyberTipline (report.cybertip.org) as soon as possible, and the files must be kept.";

/**
 * Every check on a version's files, deciding but changing nothing: the scan saves and acts on the
 * result, and a re-check after a report (triage.ts) only compares it. `reported` is what a player
 * reported, passed to the AI reviewer as something to look into.
 */
export async function inspectVersion(env: Env, version: Version, game: Game, deps: ScanDeps = scanDeps(env), reported?: string): Promise<ScanReport> {
  // 1. Collect the files: under the version's prefix (zip uploads) or from its manifest (file-by-file uploads).
  const objects = await versionFiles(env, version);
  const findings: Finding[] = [];
  const { texts, disguised, tooMuch } = await readCode(env, objects);
  if (tooMuch) findings.push({ stage: "static", severity: "hold", rule: "too-much-code", detail: "More code than the automatic checks read. A person should look." });

  // 2. Static checks.
  const stat = staticScan(texts);
  findings.push(...stat.findings);
  if (env.VT_API_KEY) findings.push(...(await virusTotal(env, objects)));

  // 3. Known-illegal-image matching, before any picture is passed on.
  const imageObjects = objects.filter((o) => extensionOf(o.path) in IMAGE_TYPES);
  const images = await matchMedia(env, objects, texts, disguised, deps.images);
  findings.push(...images.findings);
  const knownImage = images.findings.some((f) => f.rule === KNOWN_IMAGE_RULE);

  // 4. AI review, within the monthly budget. Never with pictures that matched known abuse material.
  let ai: ScanReport["ai"] = null;
  let childSafety = knownImage;
  const cap = Number(env.AI_MONTHLY_INPUT_TOKENS) || 0;
  const used = await aiUsage(env.DB);
  if (knownImage) {
    ai = { model: env.AI_MODEL, verdict: "skipped", summary: "Not sent for AI review: image matching found known abuse material.", inputTokens: 0, outputTokens: 0 };
  } else if (!env.ANTHROPIC_API_KEY) {
    ai = { model: env.AI_MODEL, verdict: "skipped", summary: "No API key set.", inputTokens: 0, outputTokens: 0 };
    findings.push({ stage: "ai", severity: "hold", rule: "ai-not-configured", detail: "AI review isn't set up, so a person has to approve this game." });
  } else if (used.input_tokens >= cap) {
    ai = { model: env.AI_MODEL, verdict: "skipped", summary: "Monthly AI review budget used up.", inputTokens: 0, outputTokens: 0 };
    findings.push({ stage: "ai", severity: "hold", rule: "ai-budget", detail: "This month's AI review budget is used up, so a person has to approve this game." });
  } else {
    const aiImages = await pickImages(env, imageObjects);
    const result = await deps.ai(env.ANTHROPIC_API_KEY, env.AI_MODEL, {
      title: game.title,
      description: game.description,
      fileList: objects.map((o) => ({ path: o.path, size: o.size })),
      texts: trimTexts(texts),
      images: aiImages,
      staticFindings: stat.findings,
      outsideHosts: stat.outsideHosts,
      ...(reported ? { reported } : {}),
    });
    await addAiUsage(env.DB, result.report.inputTokens, result.report.outputTokens);
    ai = result.report;
    findings.push(...result.findings);
    childSafety ||= result.childSafety;
  }

  // 5. Decide. Child-safety signals are held (never deleted) so they can be reported.
  let decision = decide(findings);
  if (childSafety) decision = "held";
  return {
    finishedAt: Date.now(),
    decision,
    findings,
    outsideHosts: stat.outsideHosts,
    images: { provider: images.provider, connected: images.connected, checked: images.checked },
    ai,
    childSafety,
  };
}

/** A version's code files, read in full, and any that are really pictures or videos under a code file's name. */
async function readCode(env: Env, objects: FileRef[]): Promise<{ texts: { path: string; text: string }[]; disguised: MediaForMatching[]; tooMuch: boolean }> {
  const texts: { path: string; text: string }[] = [];
  const disguised: MediaForMatching[] = [];
  let textBytes = 0;
  for (const o of objects) {
    if (!TEXT_EXTENSIONS.has(extensionOf(o.path))) continue;
    if (textBytes + o.size > STATIC_TEXT_LIMIT) return { texts, disguised, tooMuch: true };
    const body = await env.GAMES.get(o.key);
    if (!body) continue;
    const bytes = new Uint8Array(await body.arrayBuffer());
    textBytes += o.size;
    const type = sniffMedia(bytes.subarray(0, SNIFF_BYTES));
    if (type && (type !== "video/webm" || matroskaHasVideo(bytes))) disguised.push({ path: o.path, type, id: o.key, body: async () => bytes });
    else texts.push({ path: o.path, text: new TextDecoder().decode(bytes) });
  }
  return { texts, disguised, tooMuch: false };
}

/**
 * Image matching on every picture and video in a version: by name, by their first bytes whatever they're
 * called (a picture renamed .bin), and written into code as base64. Files are streamed from storage, so
 * a big video never sits in memory. Audio-only WebM files aren't sent.
 */
export async function matchMedia(env: Env, objects: FileRef[], texts: { path: string; text: string }[], disguised: MediaForMatching[], matcher: ImageMatcher): Promise<ImageMatchResult> {
  if (matcher === notConnected) return matcher.check([]);
  const findings: Finding[] = [];
  const media: MediaForMatching[] = [...disguised];
  const stored = (o: FileRef, type: string): MediaForMatching => ({ path: o.path, type, id: o.key, body: () => streamFile(env, o.key) });
  let sniffed = 0;
  for (const o of objects) {
    const ext = extensionOf(o.path);
    if (TEXT_EXTENSIONS.has(ext)) continue; // Read in full already.
    const named = MATCH_TYPES[ext];
    if (named && named !== "video/webm") {
      media.push(stored(o, named));
      continue;
    }
    if (o.size < 4) continue;
    if (++sniffed > SNIFF_LIMIT) continue;
    const type = sniffMedia(await readStart(env, o.key, SNIFF_BYTES));
    if (!type || (type === "video/webm" && !matroskaHasVideo(await readStart(env, o.key, MATROSKA_HEAD_BYTES)))) continue;
    media.push(stored(o, type));
  }
  if (sniffed > SNIFF_LIMIT) findings.push({ stage: "images", severity: "hold", rule: "too-many-files", detail: `More than ${SNIFF_LIMIT} files that aren't code or pictures: the first ${SNIFF_LIMIT} were checked for hidden pictures, and a person should look at the rest.` });
  for (const t of texts) {
    embeddedMedia(t.text).forEach(({ type, bytes }, i) => media.push({ path: `${t.path} (picture ${i + 1} in the code)`, type, id: `embedded:${t.path}:${i}`, body: async () => bytes }));
  }
  if (media.length > MATCH_LIMIT) findings.push({ stage: "images", severity: "hold", rule: "too-many-images", detail: `More than ${MATCH_LIMIT} pictures and videos: the first ${MATCH_LIMIT} were matched, and a person should look at the rest.` });
  const result = await matcher.check(media.slice(0, MATCH_LIMIT));
  return { ...result, findings: [...findings, ...result.findings] };
}

/** A stored file as a stream of known length: sent to the matcher without holding it in memory. */
async function streamFile(env: Env, key: string): Promise<ReadableStream> {
  const object = await env.GAMES.get(key);
  if (!object) throw new Error(`No file at ${key}`);
  const { readable, writable } = new FixedLengthStream(object.size);
  object.body.pipeTo(writable).catch(() => {});
  return readable;
}

async function readStart(env: Env, key: string, length: number): Promise<Uint8Array> {
  const object = await env.GAMES.get(key, { range: { offset: 0, length } });
  return object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array();
}

/** Versions image matching hasn't fully checked yet (they passed before it was connected), queued once a day. */
export async function queueImageChecks(env: Env, matcher = imageMatcher(env)): Promise<number> {
  if (matcher === notConnected) return 0;
  const { results } = await env.DB
    .prepare("SELECT id FROM versions WHERE scan_status = 'approved' AND (scan_report IS NULL OR json_extract(scan_report, '$.images.connected') IS NOT 1) ORDER BY created_at_ms DESC LIMIT 1000")
    .all<{ id: string }>();
  for (let i = 0; i < results.length; i += 100) await env.SCAN_QUEUE.sendBatch(results.slice(i, i + 100).map((v) => ({ body: { versionId: v.id, images: true } })));
  return results.length;
}

/**
 * Image matching on a version that already passed review (it passed before matching was connected).
 * A match takes it off at once (holdKnownImages). Otherwise its report notes the check, so it isn't
 * checked again; if Shield couldn't finish, this throws and the queue tries again.
 */
export async function recheckImages(env: Env, versionId: string, deps: ScanDeps = scanDeps(env)): Promise<void> {
  const version = await versionById(env.DB, versionId);
  const game = version && (await gameById(env.DB, version.game_id));
  if (!version || !game || version.scan_status !== "approved" || deps.images === notConnected) return;
  const objects = await versionFiles(env, version);
  const { texts, disguised, tooMuch } = await readCode(env, objects);
  const result = await matchMedia(env, objects, texts, disguised, deps.images);
  if (result.findings.some((f) => f.rule === KNOWN_IMAGE_RULE)) {
    await holdKnownImages(env, game, version, result, "Image matching on a version that passed before it was connected");
    return;
  }
  const unfinished = result.findings.filter((f) => f.rule === "image-matching-failed" && !f.path);
  if (unfinished.length) throw new Error(summarize(unfinished));
  const report = reportOf(version);
  report.images = { provider: result.provider, connected: true, checked: result.checked };
  await env.DB.prepare("UPDATE versions SET scan_report = ? WHERE id = ?").bind(JSON.stringify(report), version.id).run();
  const loose = [...result.findings, ...(tooMuch ? [{ stage: "static", severity: "hold", rule: "too-much-code", detail: "More code than the checks read." } as Finding] : [])];
  await audit(env.DB, game.id, "images-checked", `${version.id}: ${result.checked} pictures and videos matched, no known abuse material${loose.length ? `\nNot fully checked:\n${summarize(loose)}` : ""}`);
  if (loose.length) await sendAlert(env, `${game.slug}: some files couldn't be image-matched`, `Version ${version.id} passed before image matching was connected. It was matched now and nothing known was found, but:\n\n${summarize(loose)}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
}

/**
 * Pictures or videos in a version that already passed matched known abuse material: it comes off at
 * once, whatever its age or reports. Held, its preview link and scheduled publish off, the game hidden
 * if players get this version, and an urgent alert. Nothing is deleted. Returns whether the game was hidden.
 */
export async function holdKnownImages(env: Env, game: Game, version: Version, images: ImageMatchResult, why: string): Promise<boolean> {
  const known = images.findings.filter((f) => f.rule === KNOWN_IMAGE_RULE);
  const report = reportOf(version);
  report.findings = [...report.findings.filter((f) => f.rule !== KNOWN_IMAGE_RULE), ...known];
  report.decision = "held";
  report.childSafety = true;
  report.images = { provider: images.provider, connected: images.connected, checked: images.checked };
  await env.DB.prepare("UPDATE versions SET scan_status = 'held', preview_token = NULL, scheduled_publish_at_ms = NULL, scan_report = ? WHERE id = ?").bind(JSON.stringify(report), version.id).run();
  const hide = game.live_version_id === version.id && game.review_status === "live";
  if (hide) await setReviewStatus(env.DB, game.id, "held");
  await audit(env.DB, game.id, "image-match-hold", `${why}: ${version.id} is held${hide ? " and the game is hidden" : ""}\n${summarize(known)}`);
  await sendAlert(env, `URGENT: known abuse images in ${game.slug}${hide ? " (game hidden)" : ""}`, `${why}.\n\n${KNOWN_IMAGE_ALERT}${hide ? " The game is hidden from players." : ""}\n\n${summarize(known)}\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
  return hide;
}

function reportOf(version: Version): ScanReport {
  return version.scan_report
    ? (JSON.parse(version.scan_report) as ScanReport)
    : { finishedAt: Date.now(), decision: "approved", findings: [], outsideHosts: [], images: { provider: "none", connected: false, checked: 0 }, ai: null, childSafety: false };
}

export function summarize(findings: Finding[]): string {
  const important = findings.filter((f) => f.severity !== "info");
  return important.length ? important.map((f) => `${f.rule}: ${f.detail}`).join("\n") : "No problems found.";
}

/** index.html first, then other HTML, then scripts, smallest first, up to the budget. */
export function trimTexts(texts: { path: string; text: string }[]): { path: string; text: string }[] {
  const rank = (p: string) => (p === "index.html" ? 0 : /\.html?$/.test(p) ? 1 : /\.m?js$/.test(p) ? 2 : 3);
  const sorted = [...texts].sort((a, b) => rank(a.path) - rank(b.path) || a.text.length - b.text.length);
  const out: { path: string; text: string }[] = [];
  let left = TEXT_BUDGET_CHARS;
  for (const t of sorted) {
    if (left <= 0) break;
    const text = t.text.length > left ? `${t.text.slice(0, left)}\n…[trimmed]` : t.text;
    out.push({ path: t.path, text });
    left -= text.length;
  }
  return out;
}

async function pickImages(env: Env, objects: FileRef[]): Promise<AiInput["images"]> {
  const chosen = objects
    .filter((o) => o.size > 2048 && o.size <= AI_IMAGE_MAX_BYTES)
    .sort((a, b) => b.size - a.size)
    .slice(0, AI_IMAGE_LIMIT);
  return Promise.all(
    chosen.map(async (o) => {
      const bytes = new Uint8Array(await (await env.GAMES.get(o.key))!.arrayBuffer());
      return { path: o.path, mediaType: IMAGE_TYPES[extensionOf(o.path)] as AiInput["images"][number]["mediaType"], base64: toBase64(bytes) };
    }),
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Optional VirusTotal hash lookup for the four largest scripts (free API: 4 lookups a minute). */
async function virusTotal(env: Env, objects: FileRef[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const scripts = objects.filter((o) => ["js", "mjs", "wasm", "html"].includes(extensionOf(o.path))).sort((a, b) => b.size - a.size).slice(0, 4);
  for (const o of scripts) {
    const bytes = await (await env.GAMES.get(o.key))!.arrayBuffer();
    const hash = await sha256Hex(bytes);
    const res = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, { headers: { "x-apikey": env.VT_API_KEY! } });
    if (res.status === 404) continue;
    if (!res.ok) {
      findings.push({ stage: "static", severity: "info", rule: "virustotal-unavailable", detail: `VirusTotal lookup failed (${res.status}).`, path: o.path });
      continue;
    }
    const data = (await res.json()) as { data?: { attributes?: { last_analysis_stats?: { malicious?: number } } } };
    const malicious = data.data?.attributes?.last_analysis_stats?.malicious ?? 0;
    if (malicious >= 3) findings.push({ stage: "static", severity: "reject", rule: "virustotal", detail: `${malicious} antivirus engines flag this file.`, path: o.path });
    else if (malicious > 0) findings.push({ stage: "static", severity: "hold", rule: "virustotal", detail: `${malicious} antivirus engine(s) flag this file.`, path: o.path });
  }
  return findings;
}

export interface FileRef {
  /** Path inside the game. */
  path: string;
  /** Where the file is in the games bucket. */
  key: string;
  size: number;
}

export async function versionFiles(env: Env, version: Version): Promise<FileRef[]> {
  if (version.kind === "files") {
    const manifest = await env.GAMES.get(manifestKey(version.id));
    if (!manifest) throw new Error(`No manifest for version ${version.id}`);
    const { files } = (await manifest.json()) as Manifest;
    // A manifest lists where each file is; the blobs tables know their sizes.
    const sizes = await blobSizes(env.DB, Object.values(files).map((file) => file.sha256));
    return Object.entries(files).map(([path, file]) => ({ path, key: file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : blobKey(file.sha256), size: sizes.get(file.sha256) ?? 0 }));
  }
  const out: FileRef[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.GAMES.list({ prefix: `${version.r2_prefix}/`, cursor });
    for (const o of list.objects) out.push({ path: o.key.slice(version.r2_prefix.length + 1), key: o.key, size: o.size });
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * A version passed review (the scan or a person). Admin uploads and versions sent with
 * "publish when approved" go live; developers' drafts get a private preview link and wait.
 */
export async function passVersion(env: Env, version: Version, why: string, actor = "system"): Promise<void> {
  if (version.publish_when_approved_enabled) {
    await publishVersion(env.DB, version);
    await audit(env.DB, version.game_id, "published", `${why}: ${version.id}`, actor);
    await pruneVersions(env, version.game_id);
  } else {
    await approveDraft(env.DB, version.id);
    await audit(env.DB, version.game_id, "draft-ready", `${why}: ${version.id} is ready to preview and publish`, actor);
  }
}

/** Keep the live version plus the last few approved ones for rolling back; delete older approved versions. */
export async function pruneVersions(env: Env, gameId: string): Promise<void> {
  const game = await gameById(env.DB, gameId);
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE game_id = ? AND scan_status = 'approved' ORDER BY created_at_ms DESC").bind(gameId).all<Version>();
  const old = results.filter((v) => v.id !== game?.live_version_id).slice(KEPT_VERSION_COUNT);
  for (const v of old) await deleteVersion(env, v);
}

/** Delete a version and its own files. Shared files are left for the daily cleanup. */
export async function deleteVersion(env: Env, v: Version): Promise<void> {
  if (v.kind === "files") await env.GAMES.delete(manifestKey(v.id));
  else await deletePrefix(env.GAMES, v.r2_prefix);
  await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(v.id).run();
}
