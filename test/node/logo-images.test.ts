import { describe, expect, it } from "vitest";
import { GLASS_LOGO_SVGS } from "../../apps/site/src/generated/logo-svgs.generated.ts";
import { LOGO_STYLES, withShortIds } from "../../apps/site/src/components/icons.ts";

/** The logo's drawings go into every page's first paint as images in the stylesheet, with their ids made short (icons.ts). */
describe("the logo's images", () => {
  const drawings = Object.entries(GLASS_LOGO_SVGS).flatMap(([fileName, colors]) => Object.entries(colors).map(([color, svg]) => [`${fileName} ${color}`, svg] as const));

  it("change only their ids, each reference following its id, so they draw the same", () => {
    const withoutIds = (svg: string) => svg.replace(/ id="[^"]+"/g, ' id=""').replace(/#[^)"]+(?=[)"])/g, (reference) => (/^#[0-9A-Fa-f]{3,8}$/.test(reference) && !svg.includes(` id="${reference.slice(1)}"`) ? reference : "#"));
    for (const [name, svg] of drawings) {
      const short = withShortIds(svg);
      expect(withoutIds(short), name).toBe(withoutIds(svg));
      const ids = new Set([...short.matchAll(/ id="([^"]+)"/g)].map((found) => found[1]));
      expect(ids.size, name).toBe([...svg.matchAll(/ id="/g)].length);
      for (const [, referenced] of short.matchAll(/url\(#([^)]+)\)/g)) expect(ids.has(referenced), `${name}: url(#${referenced})`).toBe(true);
      expect(short.length, name).toBeLessThan(svg.length);
    }
  });

  it("are in the stylesheet with the short ids", () => {
    expect(LOGO_STYLES).not.toContain("logo-wordmark-black");
    expect(LOGO_STYLES).toContain("url(%230)");
  });
});
