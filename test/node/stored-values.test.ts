import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { pageScripts } from "../../apps/site/src/page-scripts.ts";
import { CLOSED_COLUMN_NAME, CLOSED_TEXT_COLUMNS, STORED_VALUES } from "../../apps/site/src/stored-values.ts";

/**
 * Stored values safe where they show (docs/DECISIONS.md), in the code itself: every text column the migrations make
 * is a stored value with its shape or closed, nothing puts a stored column through raw(), and every place a page
 * script puts a value into a style, an address or HTML has been looked at. test/site/stored-values.test.ts checks
 * the doors and the pages.
 */

const ROOT = join(import.meta.dirname, "../..");
const SITE = join(ROOT, "apps/site/src");

/** Every text column the migrations make, as table.column (full-text search tables aside). */
function textColumns(): string[] {
  const database = new DatabaseSync(":memory:");
  const migrations = join(ROOT, "migrations");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) database.exec(readFileSync(join(migrations, file), "utf8"));
  const tables = database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string; sql: string }[];
  const virtual = tables.filter((table) => /^CREATE VIRTUAL TABLE/i.test(table.sql)).map((table) => table.name);
  return tables
    .filter((table) => !/^(sqlite_|d1_|_cf)/.test(table.name) && !virtual.some((name) => table.name === name || table.name.startsWith(`${name}_`)))
    .flatMap((table) =>
      (database.prepare(`SELECT name, type FROM pragma_table_info('${table.name}')`).all() as { name: string; type: string }[])
        .filter((column) => !/INT|REAL|NUM/i.test(column.type))
        .map((column) => `${table.name}.${column.name}`),
    );
}

const columnOf = (stored: string) => stored.split(/[.[]/).slice(0, 2).join(".");

describe("the stored values list", () => {
  const columns = textColumns();
  const listed = new Set(STORED_VALUES.map((entry) => columnOf(entry.stored)));

  it("has every text column, as a stored value or a closed one", () => {
    const missing = columns.filter((column) => !listed.has(column) && !CLOSED_COLUMN_NAME.test(column.split(".")[1]!) && !CLOSED_TEXT_COLUMNS.includes(column));
    expect(missing, "Add each to STORED_VALUES with its shape, source, doors and pages, or to CLOSED_TEXT_COLUMNS when only Zaisma's code or a fixed list fills it").toEqual([]);
  });

  it("names only columns that exist, each once, and none that's also closed", () => {
    expect([...listed, ...CLOSED_TEXT_COLUMNS].filter((column) => !columns.includes(column))).toEqual([]);
    expect(STORED_VALUES.map((entry) => entry.stored).filter((stored, index, all) => all.indexOf(stored) !== index)).toEqual([]);
    expect([...listed].filter((column) => CLOSED_TEXT_COLUMNS.includes(column) || CLOSED_COLUMN_NAME.test(column.split(".")[1]!))).toEqual([]);
  });

  it("says what checks each value a developer or player saves, and that check exists", () => {
    const unchecked = STORED_VALUES.filter((entry) => (entry.source === "developer" || entry.source === "player") && entry.format !== "escaped_text" && !entry.checked_by);
    expect(unchecked.map((entry) => entry.stored)).toEqual([]);
    const gone = STORED_VALUES.filter((entry) => entry.checked_by && !new RegExp(`(function|const|let) ${entry.checked_by.symbol_name}\\b`).test(readFileSync(join(ROOT, entry.checked_by.source_path), "utf8")));
    expect(gone.map((entry) => `${entry.stored}: ${entry.checked_by!.source_path} ${entry.checked_by!.symbol_name}`)).toEqual([]);
  });

  it("gives only values Zaisma checks on the way in a door that saves them", () => {
    expect(STORED_VALUES.filter((entry) => entry.saved_by_door_ids.length && entry.format === "escaped_text" && entry.source !== "developer" && entry.source !== "player").map((entry) => entry.stored)).toEqual([]);
  });
});

describe("the site's code", () => {
  const sources = [...readdirSync(SITE), ...readdirSync(join(SITE, "components")).map((name) => `components/${name}`)].filter((name) => name.endsWith(".ts"));
  // The last part of each stored value's name: title, glass_tint_color, destination_url…
  const storedNames = new Set(STORED_VALUES.map((entry) => entry.stored.split(/[.[\]]+/).filter(Boolean).at(-1)!));

  it("never puts a stored value through raw(), which skips escaping", () => {
    const problems: string[] = [];
    for (const name of sources) {
      const source = ts.createSourceFile(name, readFileSync(join(SITE, name), "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "raw") {
          const reach = (inner: ts.Node) => {
            // Forum markdown goes through its renderer, which escapes everything and checks every link (forum_markdown).
            if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "renderMarkdown") return;
            if (ts.isPropertyAccessExpression(inner) && storedNames.has(inner.name.text)) problems.push(`${name}:${source.getLineAndCharacterOfPosition(inner.getStart()).line + 1} raw() takes ${inner.getText()}`);
            ts.forEachChild(inner, reach);
          };
          node.arguments.forEach(reach);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(problems, "Put it in html`…` (escaped), or through shownColor or shownAddress (markup.ts) for CSS and links").toEqual([]);
  });
});

/**
 * Where page scripts put a value into a style, an address or HTML, counted per script. Each was looked at: fixed
 * markup, numbers, addresses the server built or checked (a game's link, a profile's link through the leaving
 * page), a color checked against #rrggbb, or HTML the site rendered. A new one changes a count: look at what it
 * puts there, then change the count.
 */
const REVIEWED_SINK_COUNTS: Record<string, number> = {
  "access-choices": 3, "account-gate": 1, "account-link": 1, "back-to-app": 1, "back-to-game": 1, "background-preview": 4, "block-sheet": 1, "bot-check": 2, browse: 2, city: 3, "city-pane": 5,
  components: 37, "design-loops": 3, forum: 2, "forum-posts": 8, gallery: 3, "game-embedded": 1, "game-links": 2, "game-page": 9, "game-updates": 2, home: 8, "layout-inspect": 1,
  "passkey-add": 4, "passkey-confirm": 1, passkeys: 1, "play-counter": 1, "players-sheet": 3, profile: 1, "qr-png": 1, "report-sheet": 1, saves: 2, screens: 2, "sign-in-while-playing": 1, site: 4, upload: 1,
};

const SINK = /\.innerHTML\s*\+?=|\.outerHTML\s*=|insertAdjacentHTML\(|\.style\.setProperty\(|\.style\.cssText\s*=|\.href\s*=(?!=)|\.src\s*=(?!=)|\.srcset\s*=(?!=)|window\.open\(|location\.(assign|replace)\(|location\.href\s*=(?!=)|setAttribute\(\s*["'](style|href|src|srcset|action|formaction)["']/g;

describe("page scripts", async () => {
  await import("../../apps/site/src/index.ts");

  it("put values into styles, addresses and HTML only where that was looked at", () => {
    const counts = Object.fromEntries(pageScripts().map((script) => [script.name, script.sourceText.match(SINK)?.length ?? 0]).filter(([, count]) => count));
    const changed = Object.keys({ ...counts, ...REVIEWED_SINK_COUNTS })
      .filter((name) => counts[name] !== REVIEWED_SINK_COUNTS[name])
      .map((name) => `${name}: ${counts[name] ?? 0}, was ${REVIEWED_SINK_COUNTS[name] ?? 0}: ${[...(pageScripts().find((script) => script.name === name)?.sourceText.matchAll(new RegExp(`(${SINK.source})[^;\\n]{0,80}`, "g")) ?? [])].map((found) => found[0]).join(" | ")}`);
    expect(changed, "Check what each puts there (a stored color through #rrggbb, an address the server checked, HTML the site rendered), then change REVIEWED_SINK_COUNTS").toEqual([]);
  });

  it("check a game's color before it goes into the page's CSS", () => {
    const home = pageScripts().find((script) => script.name === "home")!.sourceText;
    expect(home).toMatch(/\/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(game\.glass_tint_color/);
  });
});
