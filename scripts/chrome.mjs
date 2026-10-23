// Headless Chrome for the scripts that look at pages in a real browser (scripts/engines/play.mjs, scripts/layout-check.mjs), the same
// way `zaisma check` draws a shader (packages/cli/chrome.mjs): the Chrome in CHROME_PATH, the system's, one Playwright or
// @puppeteer/browsers downloaded, or, with fetch, Chrome for Testing downloaded by @puppeteer/browsers (already a devDependency) into
// .wrangler/chrome.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome as findChromeIn } from "../packages/cli/chrome.mjs";

export { openChrome } from "../packages/cli/chrome.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Where Chrome is downloaded: .wrangler/chrome here, or ./chrome where `npx @puppeteer/browsers install chrome@stable` put it (GitHub's check). */
const CHROME_CACHES = [join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")];

/** A Chrome on this machine, or null. */
export async function findChrome() {
  return findChromeIn(CHROME_CACHES);
}

/** Downloads Chrome for Testing's stable build into .wrangler/chrome, once, and gives its path; null when it can't be fetched. */
export async function fetchChrome() {
  try {
    const { Browser, detectBrowserPlatform, install, resolveBuildId } = await import("@puppeteer/browsers");
    const platform = detectBrowserPlatform();
    const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
    const installed = await install({ browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHES[0] });
    return installed.executablePath;
  } catch (error) {
    console.log(`  Couldn't fetch Chrome: ${error.message}`);
    return null;
  }
}
