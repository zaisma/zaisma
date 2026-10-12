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
  sha256Hex,
  staticScan,
  versionById,
  type Finding,
  type ImageMatcher,
  type ScanJob,
  type ScanReport,
  type Manifest,
  type Version,
  KEEP_VERSIONS,
  approveDraft,
  blobKey,
  ownedBlobKey,
  manifestKey,
} from "@zaisma/core";
import { deletePrefix } from "./upload.ts";
import { TEXT_BUDGET_CHARS, aiReview, type AiInput, type AiResult } from "./ai.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";

/** Most text we read for the static checks. Bigger games are held for a person. */
const STATIC_TEXT_LIMIT = 40 * 1024 * 1024;
const AI_IMAGE_LIMIT = 8;
const AI_IMAGE_MAX_BYTES = 1024 * 1024;

export interface ScanDeps {
  images: ImageMatcher;
  ai: (apiKey: string, model: string, input: AiInput) => Promise<AiResult>;
}

const defaultDeps: ScanDeps = { images: notConnected, ai: aiReview };

export async function handleScanBatch(batch: MessageBatch<ScanJob>, env: Env, deps = defaultDeps): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await scanVersion(env, msg.body.versionId, deps);
      msg.ack();
    } catch (err) {
      console.error("scan failed", msg.body.versionId, err);
      if (msg.attempts >= 3) {
        await saveScan(env.DB, msg.body.versionId, "held", null);
        await sendAlert(env, "A scan failed", `Version ${msg.body.versionId} couldn't be scanned and is held: ${String(err)}`);
        msg.ack();
      } else {
        msg.retry({ delaySeconds: 30 * msg.attempts });
      }
    }
  }
}

export async function scanVersion(env: Env, versionId: string, deps: ScanDeps = defaultDeps): Promise<ScanReport> {
  const version = await versionById(env.DB, versionId);
  if (!version) throw new Error(`No version ${versionId}`);
  const game = await gameById(env.DB, version.game_id);
  if (!game) throw new Error(`No game for version ${versionId}`);

  // 1. Collect the files: under the version's prefix (zip uploads) or from its manifest (file-by-file uploads).
  const objects = await versionFiles(env, version);
  const findings: Finding[] = [];
  const texts: { path: string; text: string }[] = [];
  let textBytes = 0;
  for (const o of objects) {
    if (!TEXT_EXTENSIONS.has(extensionOf(o.path))) continue;
    if (textBytes + o.size > STATIC_TEXT_LIMIT) {
      findings.push({ stage: "static", severity: "hold", rule: "too-much-code", detail: "More code than the automatic checks read. A person should look." });
      break;
    }
    const body = await env.GAMES.get(o.key);
    if (!body) continue;
    texts.push({ path: o.path, text: await body.text() });
    textBytes += o.size;
  }

  // 2. Static checks.
  const stat = staticScan(texts);
  findings.push(...stat.findings);
  if (env.VT_API_KEY) findings.push(...(await virusTotal(env, objects)));

  // 3. Known-illegal-image matching.
  const imageObjects = objects.filter((o) => extensionOf(o.path) in IMAGE_TYPES);
  const toMatch =
    deps.images === notConnected
      ? []
      : await Promise.all(
          imageObjects.map(async (o) => {
            const bytes = new Uint8Array(await (await env.GAMES.get(o.key))!.arrayBuffer());
            return { path: o.path, bytes, sha256: await sha256Hex(bytes) };
          }),
        );
  const images = await deps.images.check(toMatch);
  findings.push(...images.findings);

  // 4. AI review, within the monthly budget.
  let ai: ScanReport["ai"] = null;
  let childSafety = images.findings.some((f) => f.rule === "known-illegal-image");
  const cap = Number(env.AI_MONTHLY_INPUT_TOKENS) || 0;
  const used = await aiUsage(env.DB);
  if (!env.ANTHROPIC_API_KEY) {
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
    });
    await addAiUsage(env.DB, result.report.inputTokens, result.report.outputTokens);
    ai = result.report;
    findings.push(...result.findings);
    childSafety ||= result.childSafety;
  }

  // 5. Decide. Child-safety signals are held (never deleted) so they can be reported.
  let decision = decide(findings);
  if (childSafety) decision = "held";
  const report: ScanReport = {
    finishedAt: Date.now(),
    decision,
    findings,
    outsideHosts: stat.outsideHosts,
    images: { provider: images.provider, connected: images.connected, checked: images.checked },
    ai,
    childSafety,
  };

  await saveScan(env.DB, version.id, decision, report);
  if (decision === "approved") {
    await passVersion(env, version, "Passed the scan");
  } else {
    await audit(env.DB, game.id, decision === "held" ? "scan-held" : "scan-rejected", summarize(findings));
    if (decision === "held" || childSafety) {
      await sendAlert(
        env,
        childSafety ? `URGENT child-safety flag on ${game.slug}` : `${game.slug} needs review`,
        `${childSafety ? "The scan flagged possible child sexual abuse material. Don't delete anything; review it and report to NCMEC if confirmed.\n\n" : ""}${summarize(findings)}\n\nReview: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
      );
    }
  }
  return report;
}

function summarize(findings: Finding[]): string {
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
    return Object.entries(files).map(([path, f]) => ({ path, key: f.owner ? ownedBlobKey(f.owner, f.sha256) : blobKey(f.sha256), size: f.bytes }));
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
  if (version.publish_when_approved) {
    await publishVersion(env.DB, version);
    await audit(env.DB, version.game_id, "published", `${why}: version ${version.id}`, actor);
    await pruneVersions(env, version.game_id);
  } else {
    await approveDraft(env.DB, version.id);
    await audit(env.DB, version.game_id, "draft-ready", `${why}: version ${version.id} is ready to preview and publish`, actor);
  }
}

/** Keep the live version plus the last few approved ones for rolling back; delete older approved versions. */
export async function pruneVersions(env: Env, gameId: string): Promise<void> {
  const game = await gameById(env.DB, gameId);
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE game_id = ? AND scan_status = 'approved' ORDER BY created_at DESC").bind(gameId).all<Version>();
  const old = results.filter((v) => v.id !== game?.current_version_id).slice(KEEP_VERSIONS);
  for (const v of old) await deleteVersion(env, v);
}

/** Delete a version and its own files. Shared files are left for the daily cleanup. */
export async function deleteVersion(env: Env, v: Version): Promise<void> {
  if (v.kind === "files") await env.GAMES.delete(manifestKey(v.id));
  else await deletePrefix(env.GAMES, v.r2_prefix);
  await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(v.id).run();
}
