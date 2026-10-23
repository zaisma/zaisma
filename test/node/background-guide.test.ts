import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHADER_LIMITS } from "@zaisma/core";
import { BACKGROUND_GUIDE, BACKGROUND_GUIDE_PATH, backgroundGuideBody, backgroundSourcePath, backgroundSourceText } from "../../apps/site/src/background-guide.ts";
import { SHADER_HELPERS, STAND_IN_BACKGROUNDS } from "../../apps/site/src/components/shaders.ts";
import { esc } from "../../apps/site/src/markup.ts";

/**
 * The background guide (zaisma.com/developers/backgrounds, apps/site/src/background-guide.ts) and docs/BACKGROUNDS.md say the same, word
 * for word, so any AI reading the file reads what the page says; and every stand-in world's source is served whole, as a game sends it.
 * A node test, so a change to docs/ alone runs it too.
 */

const ROOT = join(import.meta.dirname, "../..");
const doc = readFileSync(join(ROOT, "docs/BACKGROUNDS.md"), "utf8");
const docLines = doc.split("\n");
const sourceUrl = (slug: string) => `https://zaisma.com${backgroundSourcePath(slug)}`;

describe("docs/BACKGROUNDS.md", () => {
  it("says what the page says: its title, headings and paragraphs, word for word", () => {
    expect(docLines[0]).toBe(`# ${BACKGROUND_GUIDE.title}`);
    for (const heading of [BACKGROUND_GUIDE.linesHeading, BACKGROUND_GUIDE.worldsHeading, BACKGROUND_GUIDE.whatHappensHeading]) expect(docLines, heading).toContain(`## ${heading}`);
    for (const words of [BACKGROUND_GUIDE.lead, BACKGROUND_GUIDE.linesIntro, BACKGROUND_GUIDE.worldsIntro, BACKGROUND_GUIDE.worldsSource, BACKGROUND_GUIDE.whatHappens]) expect(docLines, words.slice(0, 40)).toContain(words);
  });

  it("lists the page's lines, in its order, each with its reason", () => {
    expect(docLines.filter((line) => /^\d+\. /.test(line))).toEqual(BACKGROUND_GUIDE.lines.map((line, lineIndex) => `${lineIndex + 1}. **${line.rule}** ${line.reason}`));
  });

  it("lists every stand-in world with its genre, what it shows and its source", () => {
    expect(docLines.filter((line) => line.startsWith("- ["))).toEqual(STAND_IN_BACKGROUNDS.map((background) => `- [${background.title}](${sourceUrl(background.slug)}), ${background.genre}: ${background.summary}`));
  });

  it("gives the check's numbers as the check has them", () => {
    for (const words of [`${SHADER_LIMITS.qualityLevels[0]!.maximumCheckFrameMs} ms`, `${SHADER_LIMITS.checkWidthPx} by ${SHADER_LIMITS.checkHeightPx}`, `${SHADER_LIMITS.maximumFlashCountPerSec} times a second`, `still at ${SHADER_LIMITS.stillTimeSec} seconds`]) expect(doc).toContain(words);
  });
});

describe("the background guide's page", () => {
  const body = backgroundGuideBody().html;

  it("shows every line and every stand-in world live, framed, with a link to its source", () => {
    for (const line of BACKGROUND_GUIDE.lines) expect(body).toContain(`<strong>${esc(line.rule)}</strong>`);
    for (const { slug } of STAND_IN_BACKGROUNDS) {
      expect(body).toContain(`data-backdrop-stand-in="${slug}"`);
      expect(body).toContain(`href="${backgroundSourcePath(slug)}"`);
    }
    // Code in a reason is set as code, its words escaped.
    expect(body).toContain("<code>shader_flashes</code>");
    expect(body).not.toContain("`");
  });

  it("links the cover guide, the developer docs and this guide's file", () => {
    for (const href of ["/developers/covers", "https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#backgrounds", "https://github.com/zaisma/zaisma/blob/main/docs/BACKGROUNDS.md"]) expect(body).toContain(`href="${href}"`);
  });
});

describe("the stand-in worlds' sources", () => {
  it("are each the whole shader as a game sends it: a line naming it, the helpers it calls, then its mainImage", () => {
    for (const background of STAND_IN_BACKGROUNDS) {
      const text = backgroundSourceText(background);
      expect(text.split("\n")[0], background.slug).toBe(`// ${background.title}, a stand-in world from zaisma.com${BACKGROUND_GUIDE_PATH}. MIT licensed: free to start from.`);
      expect(text.indexOf(SHADER_HELPERS.trim()), background.slug).toBeGreaterThan(0);
      expect(text.indexOf(background.shader.trim()), background.slug).toBeGreaterThan(text.indexOf(SHADER_HELPERS.trim()));
      expect(text, background.slug).toMatch(/void mainImage\(/);
    }
  });

  it("are each small enough to send as they are", () => {
    for (const background of STAND_IN_BACKGROUNDS) expect(new TextEncoder().encode(backgroundSourceText(background)).length, background.slug).toBeLessThanOrEqual(SHADER_LIMITS.maximumPassSizeBytes);
  });
});
