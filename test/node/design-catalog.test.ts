import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPONENTS, COMPONENT_GROUPS } from "../../apps/site/src/components/index.ts";
// @ts-expect-error plain JavaScript without type declarations
import { DESIGN_PATH, catalogMarkdown, withCatalog } from "../../scripts/design-catalog.mjs";

/**
 * docs/DESIGN.md's component catalog is written from the gallery's registry by scripts/design-catalog.mjs, so it lists every
 * component with the call that makes it and its options, and can't go stale.
 */
describe("docs/DESIGN.md's component catalog", () => {
  const designText = readFileSync(DESIGN_PATH, "utf8");
  const catalog: string = catalogMarkdown(COMPONENTS(), COMPONENT_GROUPS);

  it("is current: run npm run design:catalog after changing a component", () => {
    expect(designText).toBe(withCatalog(designText, catalog));
  });

  it("lists every component by its gallery name, under its group", () => {
    for (const each of COMPONENTS()) expect(catalog, each.slug).toContain(`- **${each.name}**`);
    for (const { group, name } of COMPONENT_GROUPS) if (COMPONENTS().some((each) => each.group === group)) expect(catalog, group).toContain(`### ${name}`);
  });

  it("gives every component with a markup function its call and options", () => {
    for (const each of COMPONENTS().filter((one) => one.render)) {
      const line = catalog.split("\n").find((entry) => entry.startsWith(`- **${each.name}**`));
      expect(line, each.slug).toMatch(/\(`\w+\(.*\)`, `[\w-]+\.ts`\)/);
    }
  });
});
