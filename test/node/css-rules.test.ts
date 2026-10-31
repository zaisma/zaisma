import { describe, expect, it } from "vitest";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";

/** Chrome keeps a selector's place in its rule in 13 bits (Blink's RuleData): past 8,192 simple selectors, the rest of the rule's list is silently dropped. */
const MOST_SIMPLE_SELECTORS_IN_A_RULE = 8192;

/** Each rule's selector list, from a stylesheet with nested at-rules: what comes before every "{" that isn't an at-rule's. */
function selectorListsOf(css: string): string[] {
  const lists: string[] = [];
  let start = 0;
  let parenthesesDepth = 0;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (character === "(") parenthesesDepth += 1;
    else if (character === ")") parenthesesDepth -= 1;
    else if (parenthesesDepth === 0 && (character === "{" || character === "}" || character === ";")) {
      const prelude = css.slice(start, index).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (character === "{" && prelude && !prelude.startsWith("@")) lists.push(prelude);
      start = index + 1;
    }
  }
  return lists;
}

/** Every class, id, attribute, pseudo-class and type in it, those inside :is(), :not(), :has() and :nth-child(of) too: more than Chrome counts, never fewer. */
const simpleSelectorCountOf = (selectorList: string) => (selectorList.replace(/"[^"]*"/g, "").match(/[.#[:]|(?:^|[\s>+~,(])[a-z*][a-z0-9-]*/gi) ?? []).length;

describe("CSS rules", () => {
  it("keeps every rule's selector list short enough for Chrome to read all of it", () => {
    const tooLong = selectorListsOf(COMPONENT_STYLES())
      .map((selectorList) => ({ count: simpleSelectorCountOf(selectorList), start: selectorList.slice(0, 120) }))
      .filter((rule) => rule.count >= MOST_SIMPLE_SELECTORS_IN_A_RULE);
    expect(tooLong).toEqual([]);
  });

  it("counts a long generated list as too long", () => {
    const longList = Array.from({ length: 800 }, (_, index) => `.pane-in > *:nth-last-child(1 of :not([hidden], .edge)) > .is-words.n${index}:not(.row-cell)`).join(",\n");
    expect(simpleSelectorCountOf(selectorListsOf(`${longList} { padding: 0; }`)[0] ?? "")).toBeGreaterThanOrEqual(MOST_SIMPLE_SELECTORS_IN_A_RULE);
  });
});
