import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { defaultMapDir } from "./generate.mjs";
import { demoScenarios } from "./page/demo-data.mjs";
import { renderDemoPage, renderPage } from "./page/render.mjs";
import { pageDataOfMapDir } from "./page-data.mjs";

/**
 * Builds the Security map page: one self-contained HTML file, which the security-map skill's Page section
 * publishes as a private claude.ai Artifact. The code here holds no private data; the data goes in at build
 * time, into a file written outside both repos, so a built page can never be committed.
 */

export const MAXIMUM_PAGE_BYTES = 15_000_000;

const REPO_ROOT = join(import.meta.dirname, "../..");
const pageCss = () => readFileSync(join(import.meta.dirname, "page", "page.css"), "utf8");

export const buildPage = (pageData) => renderPage(pageData, pageCss());
export const buildDemoPage = () => renderDemoPage(demoScenarios(), pageCss());

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

/** Builds the page from the private repo, or the made-up demo with isDemo, and writes it to outPath. */
export function writePage({ outPath, mapDir = defaultMapDir(), isDemo = false }) {
  refusePageOutsidePath(outPath, { mapDir });
  const pageData = isDemo ? null : pageDataOfMapDir(mapDir);
  if (!isDemo && !pageData) throw new Error(`${mapDir} has no promises yet, so there's nothing to draw. --demo builds from made-up data.`);
  const html = isDemo ? buildDemoPage() : buildPage(pageData);
  if (Buffer.byteLength(html) > MAXIMUM_PAGE_BYTES) throw new Error(`The page is ${Buffer.byteLength(html)} bytes, over the ${MAXIMUM_PAGE_BYTES} an artifact may hold.`);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, html);
  console.log(`Wrote ${outPath} (${Math.round(Buffer.byteLength(html) / 1024)} KB)${isDemo ? ", made-up data." : `: Zaisma ${pageData.shield_state}, ${pageData.attention_count} need attention, ${pageData.ahead_count} ahead.`}`);
}
