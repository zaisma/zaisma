import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A sheet Zaisma really shows has one version: it's declared with gallerySheet (components/gallery-sheet.ts), which gives pages the function
 * they call and Panes › Sheets its entry, and Over a game shows that same one with its sample. So a sheet made any other way is refused here,
 * by reading the source: a gallery that shows a copy goes on looking right while the real one changes.
 */
const SITE = join(import.meta.dirname, "../../apps/site/src");
const MAKERS = /\b(sheet|sheetMarkup|storePanel|confirmSheet|notice)\(\{|<dialog\b/g;
const isSheetMaker = (found: RegExpMatchArray) => found[1] !== "notice";

/** Where a sheet may still be made by hand, and why. Each comes off this list when its page gets its build. */
const NAMED_EXCEPTIONS: Record<string, string> = {
  "developer-settings.ts": "Developer settings' sheets join when that page gets its build",
  "components/panes.ts": "the Sheet, Store panel and Confirm sheet components themselves, and their examples",
  "components/playing.ts": "the Zaisma overlay, a component of its own on Over a game",
  "components/navigation.ts": "the Sidebar, a component that is a sheet on a phone",
  "components/confirm-its-you.ts": "Confirm it's you, a component of its own",
  "components/screens.ts": "the Screens page's own large view, a gallery tool",
  "account.ts": "the old account page's two dialogs, until that page gets its build",
  "account-protection.ts": "the old account page's dialog, until that page gets its build",
  "components/foundations.ts": "where a Sheet's own dialog is written",
  "components/light-box.ts": "the Light box, a component of its own",
  "components/game-media.ts": "a game's screenshots in a Light box",
};

function sourceFiles(directory = SITE): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

/** Just past the bracket that closes the call opened at index, reading strings and templates as what they are. */
function endOfCall(source: string, opened: number): number {
  const stack: string[] = ["("];
  for (let index = opened + 1; index < source.length; index += 1) {
    const character = source[index]!;
    const top = stack[stack.length - 1]!;
    if (top === '"' || top === "'") {
      if (character === "\\") index += 1;
      else if (character === top) stack.pop();
    } else if (top === "`") {
      if (character === "\\") index += 1;
      else if (character === "`") stack.pop();
      else if (character === "$" && source[index + 1] === "{") { stack.push("{"); index += 1; }
    } else if (character === '"' || character === "'" || character === "`" || character === "(" || character === "{") stack.push(character);
    else if (character === ")" || character === "}") {
      stack.pop();
      if (!stack.length) return index + 1;
    }
  }
  return source.length;
}

/** Where each gallerySheet(...) call starts and ends. */
function declaredSpans(source: string): [number, number][] {
  return [...source.matchAll(/\bgallerySheet(?:<[^(]*>)?\(/g)].map((found) => [found.index, endOfCall(source, found.index + found[0].length - 1)]);
}

const FILES = sourceFiles().map((path) => ({ name: relative(SITE, path), source: readFileSync(path, "utf8") }));
const DECLARATIONS = FILES.flatMap(({ name, source }) => declaredSpans(source).map(([start, end]) => ({ name, text: source.slice(start, end) })));

describe("One version of every sheet", () => {
  it("makes a sheet only through gallerySheet, or names why not", () => {
    const strays = FILES.flatMap(({ name, source }) => {
      if (name in NAMED_EXCEPTIONS || name === "components/gallery-sheet.ts") return [];
      const spans = declaredSpans(source);
      return [...source.matchAll(MAKERS)].filter((found) => isSheetMaker(found) && !spans.some(([start, end]) => found.index >= start && found.index < end)).map((found) => `${name}: ${found[0]}`);
    });
    expect(strays, "Declare it with gallerySheet (components/gallery-sheet.ts), so the page and Panes › Sheets share one version").toEqual([]);
  });

  it("gives Over a game only what real pages use", () => {
    const overGame = FILES.find(({ name }) => name === "over-a-game.ts")!.source;
    expect([...overGame.matchAll(MAKERS)].map((found) => found[0]), "Over a game shows a real sheet's sample or a real notice's function, never its own").toEqual([]);
  });

  it("has one owner for each sheet's id", () => {
    const ids = DECLARATIONS.flatMap(({ text }) => [...text.matchAll(/(?:sheet|storePanel)\(\{(?:\s*isShown,)?\s*id: "([a-z-]+)"/g)].map((found) => found[1]!));
    expect(ids.length, "the declarations read as they're written").toBeGreaterThan(5);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    for (const { name, source } of FILES) {
      if (name in NAMED_EXCEPTIONS) continue;
      const spans = declaredSpans(source);
      for (const found of source.matchAll(/\bid: "([a-z-]+)"/g)) {
        if (ids.includes(found[1]!) && !spans.some(([start, end]) => found.index >= start && found.index < end)) expect.fail(`${name} uses the id of a declared sheet: ${found[1]}`);
      }
    }
  });

  it("keeps real sheets' names out of the gallery's own examples", () => {
    const panes = FILES.find(({ name }) => name === "components/panes.ts")!.source;
    const examples = [...panes.matchAll(/\b(?:sheet|confirmSheet)\(\{\s*id: "example-[a-z-]+",\s*title: "([^"]+)"/g)].map((found) => found[1]!);
    expect(examples.length).toBeGreaterThan(3);
    const realNames = ["Block", "Share", "Report", "Buy", "Leave", "Send a friend request", "You're leaving Zaisma", "Full screen on iPhone"];
    expect(examples.filter((title) => realNames.some((realName) => title.startsWith(realName)))).toEqual([]);
  });
});
