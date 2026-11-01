import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BACKGROUND_GUIDE } from "../../apps/site/src/background-guide.ts";
import { STAND_IN_BACKGROUNDS_SCRIPT } from "../../apps/site/src/components/foundations.ts";
import { STAND_IN_BACKGROUNDS } from "../../apps/site/src/components/shaders.ts";
import { pageScriptPath } from "../../apps/site/src/page-scripts.ts";

/**
 * The background guide at zaisma.com/developers/backgrounds, beside the cover guide: a developer page with the stand-in worlds drawn live,
 * and each world's source served as plain text. test/node/background-guide.test.ts holds its words to docs/BACKGROUNDS.md, and
 * test/site/design.test.ts holds it to the gallery's rules.
 */

const LOCAL = "http://localhost";

describe("the background guide", () => {
  it("is a developer page that loads the stand-in worlds' shaders, and links back to the cover guide", async () => {
    const response = await SELF.fetch(`${LOCAL}/developers/backgrounds`);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain(`<title>${BACKGROUND_GUIDE.title} · Zaisma</title>`);
    expect(page).toContain('<a class="flush-row quiet foldable" data-lights href="/developers" aria-current="page">Developer</a>');
    expect(page).not.toContain('<main class="steel">');
    expect(page).toContain(`<link rel="preload" as="script" href="${pageScriptPath(STAND_IN_BACKGROUNDS_SCRIPT)}" fetchpriority="low" data-page-script>`);
    for (const { slug } of STAND_IN_BACKGROUNDS) expect(page).toContain(`href="/developers/backgrounds/${slug}.glsl"`);
    expect(page).toContain('href="/developers/covers"');
    // The cover guide links here.
    expect(await (await SELF.fetch(`${LOCAL}/developers/covers`)).text()).toContain('href="/developers/backgrounds"');
  });

  it("serves each world's source as plain text, and nothing for a world it doesn't have", async () => {
    for (const background of STAND_IN_BACKGROUNDS) {
      const response = await SELF.fetch(`${LOCAL}/developers/backgrounds/${background.slug}.glsl`);
      expect(response.status, background.slug).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      const source = await response.text();
      expect(source.startsWith(`// ${background.title}, a stand-in world from zaisma.com/developers/backgrounds. MIT licensed`), background.slug).toBe(true);
      expect(source).toContain(background.shader.trim());
    }
    for (const path of ["/developers/backgrounds/nothing.glsl", "/developers/backgrounds/ashen-crown", "/developers/backgrounds/ashen-crown.txt"]) expect((await SELF.fetch(`${LOCAL}${path}`)).status, path).toBe(404);
  });
});
