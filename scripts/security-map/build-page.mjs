import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { build } from "esbuild";
import { publicExportProblems } from "./export-public.mjs";
import { defaultMapDir } from "./generate.mjs";
import { sanitizeExport } from "./page/graph.mjs";

/**
 * Builds the Security map page: one self-contained HTML file with the sanitized export embedded, which the
 * security-map skill's Page section publishes as a private claude.ai Artifact. The template, styles and
 * code (scripts/security-map/page/) hold no private data; the data is embedded here at build time, into a
 * file written outside both repos, so a built page can never be committed.
 */

export const MAXIMUM_PAGE_BYTES = 15_000_000;

const PAGE_DIR = join(import.meta.dirname, "page");
const REPO_ROOT = join(import.meta.dirname, "../..");
const MARKERS = ["/*@page-css*/", "@page-data", "/*@page-script*/"];

/** Replaces the one occurrence of a marker; split/join, because a "$" in the text must stay a "$". */
function fill(template, marker, text) {
  const parts = template.split(marker);
  if (parts.length !== 2) throw new Error(`The page template should hold ${marker} exactly once, and holds it ${parts.length - 1} times.`);
  return parts.join(text);
}

export async function buildPage(exportObject) {
  const problems = publicExportProblems(exportObject);
  if (problems.length) throw new Error(`Refused to build the map page: ${problems.length} export problems: ${problems.slice(0, 3).join("; ")}`);
  const { exportData } = sanitizeExport(exportObject);
  const embeddedData = JSON.stringify(exportData).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  const bundle = await build({ entryPoints: [join(PAGE_DIR, "page.mjs")], bundle: true, format: "iife", target: "es2020", write: false, minifyWhitespace: true, legalComments: "none", logLevel: "silent" });
  const script = bundle.outputFiles[0].text;
  if (/<\/script/i.test(script)) throw new Error("The page's script contains a closing script tag, which would end it early.");
  const css = readFileSync(join(PAGE_DIR, "page.css"), "utf8");
  let html = readFileSync(join(PAGE_DIR, "template.html"), "utf8");
  for (const marker of MARKERS) if (html.split(marker).length !== 2) throw new Error(`The page template should hold ${marker} exactly once, and holds it ${html.split(marker).length - 1} times.`);
  html = fill(html, "/*@page-css*/", css);
  html = fill(html, "@page-data", embeddedData);
  html = fill(html, "/*@page-script*/", script);
  if (Buffer.byteLength(html) > MAXIMUM_PAGE_BYTES) throw new Error(`The page is ${Buffer.byteLength(html)} bytes, over the ${MAXIMUM_PAGE_BYTES} an artifact may hold.`);
  return html;
}

const isInside = (folder, path) => {
  const from = relative(folder, path);
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
};

/** The backstop against committing a built page: nothing goes inside the map dir or the public repo, except .wrangler/ (git-ignored). */
export function refusePageOutsidePath(outPath, { mapDir = defaultMapDir() } = {}) {
  const target = resolve(outPath);
  const wrangler = join(REPO_ROOT, ".wrangler");
  const message = "Write the page outside the repos: your session's scratchpad, or .wrangler/security-map/ in a run with no scratchpad.";
  if (isInside(resolve(mapDir), target)) throw new Error(message);
  if (isInside(REPO_ROOT, target) && !isInside(wrangler, target)) throw new Error(message);
}

/** Reads the export at exportPath (or takes exportObject, as --demo does), builds the page and writes it to outPath. */
export async function writePage({ exportPath, exportObject = JSON.parse(readFileSync(exportPath, "utf8")), outPath, mapDir }) {
  refusePageOutsidePath(outPath, { mapDir });
  const html = await buildPage(exportObject);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, html);
  const { exportData } = sanitizeExport(exportObject);
  const doorCount = exportData.sectors.reduce((sum, sector) => sum + sector.doors.length, 0);
  const caseCount = exportData.sectors.reduce((sum, sector) => sum + sector.doors.reduce((inner, door) => inner + door.cases.length, 0), 0);
  console.log(`Wrote ${outPath} (${Math.round(Buffer.byteLength(html) / 1024)} KB): ${exportData.sectors.length} sectors, ${doorCount} doors, ${caseCount} cases.`);
}
