/**
 * Zaisma's own scrollbar on every page, on every device, never the browser's (docs/DESIGN.md, Rail). What's wrong with a
 * page the site served, one line per problem, [] when nothing is:
 *
 * - a whole page without the page's rail (data-rail="page"): RAIL_SCRIPT turns it on and hides the browser's (own-scroll),
 * - a whole page that doesn't load the components' script, where RAIL_SCRIPT gives every box that scrolls its rail,
 * - a style on the page that shows the browser's scrollbar (scrollbar-width other than none).
 *
 * A part of a page (no <!doctype html>, like the room list a game's page loads into itself) is inside a page that has them.
 */
export function defaultScrollbarProblems(page: string): string[] {
  if (!/^\s*<!doctype html>/i.test(page)) return [];
  const problems: string[] = [];
  if (!/\sdata-rail="page"/.test(page)) problems.push('no page rail (rail("page")), so the browser shows its own scrollbar');
  if (!/<script src="\/js\/components\.[0-9a-f]{16}\.js"/.test(page)) problems.push("doesn't load the components' script, so no box that scrolls gets its rail");
  const styles = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|\sstyle="([^"]*)"/g)].map((match) => match[1] ?? match[2] ?? "").join("\n");
  for (const [, value = ""] of styles.matchAll(/scrollbar-width:\s*([^;}"]+)/g)) if (value.trim() !== "none") problems.push(`shows the browser's scrollbar: scrollbar-width: ${value.trim()}`);
  return problems;
}
