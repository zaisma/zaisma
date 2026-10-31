import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * The files zaisma.com serves from brand/ (wrangler.jsonc, "assets"), and how long browsers keep them (brand/_headers). The font is
 * kept for good, so it's named for its contents: a changed font gets a new name, and every page must ask for the name that's there.
 * The glass logo's files are made by scripts/brand.mjs, never by hand, and every brand file the site names is there.
 */

const ROOT = join(import.meta.dirname, "../..");
const BRAND = join(ROOT, "brand");
const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "build", ".wrangler", "generated"]);

/** Every source file under a folder, its text read, skipping what's installed or built. */
function sourceTexts(folder: string): { path: string; text: string }[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : sourceTexts(path);
    return /\.(ts|mjs|js|html|css)$/.test(entry.name) ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}

/** The Cache-Control a brand file is served with, as Workers Static Assets applies _headers: each matching rule in order, its ! lines first, then its values, joined to one set by an earlier rule. */
function cacheControlOf(headersText: string, path: string): string | null {
  const rules: { pattern: RegExp; unset: string[]; set: [string, string][] }[] = [];
  for (const line of headersText.split("\n").map((each) => each.trim())) {
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) rules.push({ pattern: new RegExp(`^${line.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*")}$`), unset: [], set: [] });
    else if (line.startsWith("! ")) rules.at(-1)!.unset.push(line.slice(2).toLowerCase());
    else rules.at(-1)!.set.push([line.slice(0, line.indexOf(":")).trim().toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]);
  }
  let cacheControl: string | null = "public, max-age=0, must-revalidate";
  let isSetByRule = false;
  for (const rule of rules.filter((each) => each.pattern.test(path))) {
    if (rule.unset.includes("cache-control")) cacheControl = null;
    for (const [name, headerValue] of rule.set) {
      if (name !== "cache-control") continue;
      cacheControl = isSetByRule && cacheControl !== null ? `${cacheControl}, ${headerValue}` : headerValue;
      isSetByRule = true;
    }
  }
  return cacheControl;
}

describe("brand files", () => {
  const fonts = readdirSync(join(BRAND, "fonts")).filter((name) => name.endsWith(".woff2"));

  it("name each font for its contents: <name>.<the first 8 hex digits of its SHA-256>.woff2", () => {
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      const hash = createHash("sha256").update(readFileSync(join(BRAND, "fonts", font))).digest("hex").slice(0, 8);
      expect(font, "a font changed in place keeps the old name, which browsers keep for good: rename it").toMatch(new RegExp(`^[a-z]+(-[a-z]+)*\\.${hash}\\.woff2$`));
    }
  });

  it("are asked for by a name that's there: every /fonts/ path in the code is a file in brand/fonts", () => {
    const references = ["apps", "packages", "scripts"].flatMap((folder) => sourceTexts(join(ROOT, folder))).flatMap(({ path, text }) => [...text.matchAll(/\/fonts\/([A-Za-z0-9._-]+)/g)].map((match) => ({ path, font: match[1]! })));
    expect(references.length).toBeGreaterThan(0);
    for (const { path, font } of references) expect(fonts, `${path} asks for /fonts/${font}`).toContain(font);
  });

  it("are kept by browsers: the font for good, everything else for a day and refreshed in the background for a week", () => {
    const headersText = readFileSync(join(BRAND, "_headers"), "utf8");
    for (const font of fonts) expect(cacheControlOf(headersText, `/fonts/${font}`)).toBe("public, max-age=31536000, immutable");
    for (const path of ["/favicon.svg", "/zaisma-mark-glass-black.svg", "/share-card-light.png", "/loader/zaisma-loader.svg", "/flags/de.png", "/design/covers/verdant.webp"]) expect(cacheControlOf(headersText, path), path).toBe("public, max-age=86400, stale-while-revalidate=604800");
  });

  it("are what scripts/brand.mjs makes: its SVGs and manifest, unedited", () => {
    const out = temporaryFolder("zaisma-brand-");
    try {
      execFileSync(process.execPath, [join(ROOT, "scripts/brand.mjs"), "--svg-only", "--out", out]);
      const made = readdirSync(out);
      expect(made).toContain("zaisma-wordmark-glass-black.svg");
      for (const name of made) {
        expect(readFileSync(join(out, name), "utf8"), `${name} differs from what npm run brand makes: run it, never edit the file`).toBe(readFileSync(join(BRAND, name), "utf8"));
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("draw the favicon's Z whole: every point has both numbers, none cut short", () => {
    const pointLists = [...readFileSync(join(BRAND, "favicon.svg"), "utf8").matchAll(/points="([^"]*)"/g)].map((match) => match[1]!);
    expect(pointLists.length).toBeGreaterThan(0);
    const xs = pointLists.flatMap((list) => list.split(" ").map((point) => {
      expect(point, `a point in ${list}`).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
      return Number(point.split(",")[0]);
    }));
    // The Z is 4,287 units wide: a whole number that lost its trailing zeros (4000 as 4) leaves it far narrower.
    expect(Math.max(...xs)).toBeGreaterThan(4000);
  });

  it("are there: every brand file the site names under / is in brand/", () => {
    // A path after a quote, a parenthesis or the site's origin; one added to a page's own path ("/g/" + slug + "/qr-code.svg") or compared
    // with one is a page.
    const references = sourceTexts(join(ROOT, "apps/site/src")).flatMap(({ path, text }) => [...text.matchAll(/(?<!\+ |=== |endsWith\()(?:["'(]|SITE_ORIGIN\})\/([A-Za-z0-9_/.-]+\.(?:svg|png|ico|webmanifest))\b/g)].map((match) => ({ path, file: match[1]! })));
    expect(references.map(({ file }) => file)).toEqual(expect.arrayContaining(["favicon.svg", "manifest.webmanifest", "share-card-light.png", "zaisma-mark-glass-black.svg"]));
    for (const { path, file } of references) expect(existsSync(join(BRAND, file)), `${path} names /${file}`).toBe(true);
  });
});
