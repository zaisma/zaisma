import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The live city's camera follows only its own sequence: no page scroll, touch, resize or viewport input reaches its framing. */
describe("the city's camera", () => {
  const source = readFileSync(join(__dirname, "../../apps/site/src/components/city.ts"), "utf8");
  it("holds its framing from the first measure instead of re-measuring the page", () => {
    expect(source).toContain("var shiftHeld = shiftFor();");
    expect(source).toContain("function shiftTarget() { return shiftHeld; }");
    expect(source).not.toMatch(/function shiftTarget\(\) \{ return shiftFor\(\)/);
  });
  it("listens to no scroll or visual viewport events", () => {
    expect(source).not.toMatch(/addEventListener\("(scroll|orientationchange|touchmove|wheel)"/);
    expect(source).not.toContain("visualViewport");
  });
  it("sizes its stage to the largest window height so a browser bar crops it instead of rescaling it", () => {
    expect(source).toMatch(/\.city-stage \{ position: fixed; inset: 0 0 auto 0; height: 100vh; height: 100lvh;/);
    expect(source).toContain(".city-stage.is-framed { position: absolute; inset: 0; height: auto;");
  });
});
