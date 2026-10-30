import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../../apps/site/src/components/index.ts";

const VOID_TAGS = /^(area|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

/**
 * The pieces each of a stack's cells holds, in one walk over the markup's tags: the elements right inside it, past words only a screen
 * reader hears and a list's empty state, which go with what they're beside. Pieces in one cell take no gap between them.
 */
function stackCellPieces(markup: string): string[][] {
  const found: string[][] = [];
  const open: { tagName: string; pieces: string[] | null }[] = [];
  for (const [, closing, tagName = "", attributes = ""] of markup.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[\s\S]*?<\/\1>/g, "").matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (closing) {
      const closed = open.pop();
      if (closed?.pieces) found.push(closed.pieces);
      continue;
    }
    const holder = open[open.length - 1];
    const className = /\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "";
    if (holder?.pieces && !/(^|\s)(sr|when-empty)(\s|$)/.test(className)) holder.pieces.push(`<${tagName}${className ? `.${className.split(" ")[0]}` : ""}>`);
    if (!attributes.endsWith("/") && !VOID_TAGS.test(tagName)) open.push({ tagName, pieces: tagName === "div" && /^stack-cell(\s|$)/.test(className) ? [] : null });
  }
  return found;
}

describe("stacks", () => {
  it("hold one piece a cell in every gallery example, so each piece takes its gap from the stack (stack(), not stackOfOne of several)", () => {
    const problems = COMPONENTS().flatMap((component) => component.examples.flatMap((example) =>
      stackCellPieces(example.markup.html).filter((pieces) => pieces.length > 1).map((pieces) => `${component.slug}, "${example.label}": ${pieces.join(" ")}`)));
    expect(problems).toEqual([]);
  });
});
