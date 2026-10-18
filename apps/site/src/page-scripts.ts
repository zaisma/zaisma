import { createHash } from "node:crypto";

/**
 * Strict scripts on zaisma.com (docs/DECISIONS.md): pages run only Zaisma's own script files, never an
 * inline script, an on… attribute or a javascript: link, so text slipped into a page can't run there.
 * Each script is a file the site serves under /js/, named for its contents and cached for good; what it
 * needs from its page comes in data- attributes or a <script type="application/json"> block
 * (html.ts's pageData), which never runs. Page scripts put text in with textContent; innerHTML takes
 * only fixed markup or HTML the site itself rendered.
 *
 * The module that owns a page makes its scripts with pageScript as it loads, so the router knows every
 * one before the first request, and puts them on the page with html.ts's scriptTags.
 */
export interface PageScript {
  /** Lowercase words joined by dashes, the first part of its address. */
  readonly name: string;
  readonly sourceText: string;
}

const scriptsByName = new Map<string, PageScript>();
const pathsByName = new Map<string, string>();

export function pageScript(name: string, sourceText: string): PageScript {
  if (!/^[a-z]+(-[a-z]+)*$/.test(name)) throw new Error(`A page script's name is lowercase words joined by dashes, not ${name}`);
  if (scriptsByName.has(name)) throw new Error(`Two page scripts are called ${name}`);
  const script = { name, sourceText };
  scriptsByName.set(name, script);
  return script;
}

/** Where pages load it: /js/<name>.<the first 16 hex digits of its contents' SHA-256>.js. */
export function pageScriptPath(script: PageScript): string {
  let path = pathsByName.get(script.name);
  if (!path) {
    path = `/js/${script.name}.${createHash("sha256").update(script.sourceText).digest("hex").slice(0, 16)}.js`;
    pathsByName.set(script.name, path);
  }
  return path;
}

/** Every page script the site has made, for the tests. */
export const pageScripts = (): PageScript[] => [...scriptsByName.values()];

/**
 * GET /js/<name>.<hash>.js. The current one is cached for good, since a change gives it a new address.
 * A page from before a deploy can still ask for an older one: it gets the current script, never cached,
 * rather than a page with no script at all.
 */
export function pageScriptResponse(path: string): Response {
  const named = path.match(/^\/js\/([a-z]+(?:-[a-z]+)*)\.[0-9a-f]{16}\.js$/);
  const script = named ? scriptsByName.get(named[1]!) : undefined;
  if (!script) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(script.sourceText, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": pageScriptPath(script) === path ? "public, max-age=31536000, immutable" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
