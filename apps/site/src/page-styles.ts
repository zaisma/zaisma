import { createHash } from "node:crypto";

/**
 * Pages' stylesheets, the way page-scripts.ts serves their scripts: a file under /css/ named for its contents and
 * cached for good, so a page links it instead of carrying its CSS in every response (the components' CSS alone is
 * over 200 KB). A sheet is made with pageStyle at module load; its CSS is read the first time a page or the router
 * asks, once every component has defined itself (components/index.ts), and kept from then on.
 */
export interface PageStyle {
  /** Lowercase words joined by dashes, the first part of its address. */
  readonly name: string;
  readonly readSourceText: () => string;
}

const stylesByName = new Map<string, PageStyle>();
const sourceTextsByName = new Map<string, string>();
const pathsByName = new Map<string, string>();

export function pageStyle(name: string, readSourceText: () => string): PageStyle {
  if (!/^[a-z]+(-[a-z]+)*$/.test(name)) throw new Error(`A page style's name is lowercase words joined by dashes, not ${name}`);
  if (stylesByName.has(name)) throw new Error(`Two page styles are called ${name}`);
  const style = { name, readSourceText };
  stylesByName.set(name, style);
  return style;
}

function sourceTextOf(style: PageStyle): string {
  let sourceText = sourceTextsByName.get(style.name);
  if (sourceText === undefined) {
    sourceText = style.readSourceText();
    sourceTextsByName.set(style.name, sourceText);
  }
  return sourceText;
}

/** Where pages load it: /css/<name>.<the first 16 hex digits of its contents' SHA-256>.css. */
export function pageStylePath(style: PageStyle): string {
  let path = pathsByName.get(style.name);
  if (!path) {
    path = `/css/${style.name}.${createHash("sha256").update(sourceTextOf(style)).digest("hex").slice(0, 16)}.css`;
    pathsByName.set(style.name, path);
  }
  return path;
}

/** Every page style the site has made, for the tests. */
export const pageStyles = (): PageStyle[] => [...stylesByName.values()];

/** The CSS a page's stylesheet holds, for the tests. */
export const pageStyleText = (style: PageStyle): string => sourceTextOf(style);

/**
 * GET /css/<name>.<hash>.css. The current one is cached for good, since a change gives it a new address. A page from
 * before a deploy can still ask for an older one: it gets the current sheet, never cached, rather than a page with no styles.
 */
export function pageStyleResponse(path: string): Response {
  const named = path.match(/^\/css\/([a-z]+(?:-[a-z]+)*)\.[0-9a-f]{16}\.css$/);
  const style = named ? stylesByName.get(named[1]!) : undefined;
  if (!style) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(sourceTextOf(style), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": pageStylePath(style) === path ? "public, max-age=31536000, immutable" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
