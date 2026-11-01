import { wordProblems, type WordsRegister } from "@zaisma/core";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { BLOCKED_PICTURE_PATTERNS } from "../../apps/site/src/components/checked-pages.ts";

/**
 * "A page is only gallery components, layout included. It has no styles of its own" (docs/DECISIONS.md): what a page served by the site
 * may carry, checked on its markup. test/site/design.test.ts holds every page to it, and the tests that render a signed-in page (the
 * connect page, the consent page) check theirs too.
 */

/** Classes a script or a screen reader uses, with no look of their own. */
export const UNSTYLED_HOOKS = new Set<string>([
  "wheel-read", // The birthday's spoken summary (and .sr hides it).
  // What a layout's cell holds (layout.ts), which the measuring check reads (scripts/layout-check.mjs); words' cells are styled.
  "is-control", "is-block",
  // Hooks a component's script finds its parts by: a Color field's None, a wheel field's kind of wheels, a search's icon and its typed
  // finish's row, a file drop's templates for a new row and its zoom mark, a filter menu open as its page loads, and a Progress whose end
  // isn't known yet (its Groove runs; the class says so to a script).
  "color-none", "birthday-wheels", "find-icon", "find-cover", "find-finish-row", "file-drop-zoom-template", "file-drop-row-template", "is-unknown",
  // A tertiary button's words, which a page's script changes (the buy sheet's Keep your saved card); a sheet that stays in the middle,
  // which the layers' script reads; a way in's mark, named for its way (only Google's has a look of its own); and the way a well scrolls.
  "tertiary-label", "placement-middle", "way-passkey", "way-discord", "way-apple_pay", "scrolls-across", "scrolls-down",
  // A Progress's words, which a page's script changes (the buy sheet's), and a video's two Grooves, which its script fills as it plays and
  // as its sound is set.
  "progress-label", "video-progress", "video-level-groove",
]);


/** The only style attributes a page carries, each a value a component offers and sets itself, with why. */
export const STYLE_ATTRIBUTE: { pattern: RegExp; why: string }[] = [
  { pattern: /^--h:\d+$/, why: "an account picture's own color, from its name (accountPicture)" },
  { pattern: /^--glass-hue:#[0-9a-f]{6}$/, why: "the page's glass hue (PageSettings, on <html>)" },
  { pattern: /^--swatch:(#[0-9a-fA-F]{3,8}|var\(--clear-swatch\))$/, why: "a color picker's swatch, its color" },
  { pattern: /^--fill:[0-9.]+$/, why: "a slider's fill, the share picked" },
  { pattern: /^width:[0-9.]+%$/, why: "a usage meter's fill, the share used; a chart's bar" },
  { pattern: /^z-index:\d+$/, why: "a picture row's pictures, each over the next" },
  { pattern: /^--card-count:\d+$/, why: "a row of cards: how many share it" },
  { pattern: /^--point-count:\d+$/, why: "a chart's points, for the room each takes" },
  { pattern: /^(left|right|top):-?[0-9.]+%$/, why: "a chart's point, bar or label, where its number puts it" },
  { pattern: /^--point-(left|top):-?[0-9.]+%$/, why: "a chart's number where you point, where its point is" },
  { pattern: /^--shown-row-count:\d+$/, why: "a table capped to a number of rows" },
  { pattern: /^--sent:[0-9.]+$/, why: "a file drop's upload, the share sent" },
  { pattern: /^--done-pct:[0-9.]+%$/, why: "Progress, the share done" },
  { pattern: /^--groove-filled:[0-9.]+$/, why: "a Groove's light, the share filled (a Progress, an upload, a usage meter)" },
  { pattern: /^--mark-index: ?\d$/, why: "a PIN's mark, its place in the row, for the wave of light across them while it's on its way" },
];

/** The page sheets pages may link: the site's and the gallery's, each every component's styles with the shell's or the gallery's. */
export const PAGE_SHEETS = ["site", "design"];

/** The sheets only Steel pages link, until they're rebuilt: the site's with Steel, and a few pages' own Steel styles. A rebuilt page links none. */
export const STEEL_PAGE_SHEETS = ["site-steel", "dashboard", "forum", "profile"];

const styledBy = (css: string, name: string) => new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);

/** What breaks the rule on a page, by its markup: a sheet or style of its own, a style attribute no component sets, a class no component styles. */
export function pageProblems(markup: string): string[] {
  const problems: string[] = [];
  const componentCss = COMPONENT_STYLES();
  // The rules a page carries from the site's stylesheet for its first paint are the stylesheet's (html.ts's layout), not its own.
  if (/<style[\s>]/.test(markup.replace(/<style data-first-paint>[\s\S]*?<\/style>/, ""))) problems.push("writes a <style> of its own");
  for (const [, name = ""] of markup.matchAll(/<link rel="stylesheet" href="\/css\/([a-z-]+)\.[0-9a-f]{16}\.css">/g)) if (!PAGE_SHEETS.includes(name)) problems.push(`links a stylesheet of its own: ${name}`);
  const body = markup.replace(/<script[\s\S]*?<\/script>|<template[\s\S]*?<\/template>/g, "");
  for (const [, style = ""] of body.matchAll(/\sstyle="([^"]*)"/g)) {
    for (const declaration of style.split(";").map((each) => each.trim()).filter(Boolean)) {
      if (!STYLE_ATTRIBUTE.some(({ pattern }) => pattern.test(declaration.replace(/\s+/g, "")))) problems.push(`style="${style}" sets ${declaration}, which no component offers`);
    }
  }
  for (const [, list = ""] of body.matchAll(/\sclass="([^"]*)"/g)) {
    for (const name of list.split(/\s+/).filter(Boolean)) {
      if (!styledBy(componentCss, name) && !UNSTYLED_HOOKS.has(name)) problems.push(`.${name} comes from no component`);
    }
  }
  return [...new Set(problems)];
}

/** Elements whose insides are code or not words a person reads: left out of the word check whole. */
const NOT_WORDS_TAGS = ["script", "style", "template", "code", "pre", "kbd", "svg", "noscript"];

/** The markup with every element marked data-words="theirs" (a developer's or player's own words, like a game's title) taken out, nested ones included. */
function withoutTheirWords(markup: string): string {
  let rest = markup;
  for (let opening = rest.search(/<[a-z][a-z0-9-]*\b[^>]*\sdata-words="theirs"/); opening >= 0; opening = rest.search(/<[a-z][a-z0-9-]*\b[^>]*\sdata-words="theirs"/)) {
    const tag = /^<([a-z][a-z0-9-]*)/.exec(rest.slice(opening))![1]!;
    const sameTag = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
    sameTag.lastIndex = opening;
    let depth = 0;
    let end = rest.length;
    for (let match = sameTag.exec(rest); match; match = sameTag.exec(rest)) {
      if (match[2] === "/" || VOID_TAGS.has(tag)) { if (depth === 0) { end = match.index + match[0].length; break; } continue; }
      depth += match[1] === "/" ? -1 : 1;
      if (depth === 0) { end = match.index + match[0].length; break; }
    }
    rest = rest.slice(0, opening) + " " + rest.slice(end);
  }
  return rest;
}

/** The words a person reads on a page: tags, attributes, code and their own words (data-words="theirs") left out, entities read. */
export function pageWords(markup: string): string {
  let text = withoutTheirWords(markup.replace(/<!--[\s\S]*?-->/g, " "));
  for (const tag of NOT_WORDS_TAGS) text = text.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** What breaks the word rules (packages/core/src/words.ts) in the words a person reads on a page, in its register. */
export function pageWordProblems(markup: string, register: WordsRegister): string[] {
  return wordProblems(pageWords(markup), register);
}

/** An element of a rendered page as HTMLRewriter reads it, with what's in it: other elements and its own words. */
interface PageNode { tag: string; classes: string[]; attributes: Map<string, string>; children: PageNode[]; words: string; parent: PageNode | null }

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** A page's markup as a tree, read by HTMLRewriter (the Workers runtime's own parser): every element, and the words directly in each. */
async function pageTree(markup: string): Promise<PageNode> {
  const root: PageNode = { tag: "#document", classes: [], attributes: new Map(), children: [], words: "", parent: null };
  let open = root;
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        // A drawing is one thing: what's inside an svg (its paths, which may close themselves) isn't read.
        if (element.namespaceURI === SVG_NAMESPACE && element.tagName !== "svg") return;
        const attributes = new Map([...element.attributes].map(([name = "", value = ""]) => [name, value]));
        const node: PageNode = { tag: element.tagName, classes: (attributes.get("class") ?? "").split(/\s+/).filter(Boolean), attributes, children: [], words: "", parent: open };
        open.children.push(node);
        // A void element (an input, an img) has no end tag, so nothing is ever inside it.
        if (VOID_TAGS.has(element.tagName)) return;
        open = node;
        element.onEndTag(() => { open = node.parent ?? root; });
      },
    })
    .onDocument({ text(text) { open.words += text.text; } })
    .transform(new Response(markup))
    .text();
  return root;
}

const everyNode = (node: PageNode): PageNode[] => node.children.flatMap((child) => [child, ...everyNode(child)]);
/** Whether a node is one of these, by tag and classes or by an attribute: "h1", ".run-wrap", "header.top", "[hidden]", "[aria-hidden=true]". */
const isNode = (node: PageNode, ...selectors: string[]) => selectors.some((selector) => {
  const attribute = /^\[([a-z-]+)(?:=([^\]]+))?\]$/.exec(selector);
  if (attribute) return node.attributes.has(attribute[1]!) && (attribute[2] === undefined || node.attributes.get(attribute[1]!) === attribute[2]);
  const [tag = "", ...classes] = selector.split(".");
  return (!tag || node.tag === tag) && classes.every((name) => node.classes.includes(name));
});
const isInside = (node: PageNode, ...selectors: string[]) => { for (let walk = node.parent; walk; walk = walk.parent) if (isNode(walk, ...selectors)) return true; return false; };
const isOrInside = (node: PageNode, ...selectors: string[]) => isNode(node, ...selectors) || isInside(node, ...selectors);
const nameOf = (node: PageNode) => `${node.tag}${node.classes.length ? `.${node.classes.join(".")}` : ""} "${everyNode(node).map((each) => each.words).join(" ").concat(node.words).replace(/\s+/g, " ").trim().slice(0, 40)}"`;

/**
 * The pictures whose box isn't sized before they load: the layout check measures with pictures blocked (BLOCKED_PICTURE_PATTERNS), so each
 * one it blocks has its width and height attributes or sits in a holder whose styles size it (holds-art; test/node/materials.test.ts
 * holds each holder to a size). A picture sheet is left out: it shows one picture at the picture's own shape (a screenshot's is its game's),
 * and no measured state opens one (checked-pages.ts).
 */
export async function pictureBoxProblems(markup: string): Promise<string[]> {
  const blocked = BLOCKED_PICTURE_PATTERNS.map((pattern) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.?+^${}()|[\]\\/]/g, "\\$&")).join(".*")}$`));
  const isBlocked = (address: string) => blocked.some((pattern) => pattern.test(new URL(address, "https://zaisma.test").href));
  return everyNode(await pageTree(markup))
    .filter((node) => node.tag === "img" && isBlocked(node.attributes.get("src") ?? "") && !(node.attributes.has("width") && node.attributes.has("height")) && !isInside(node, ".holds-art", ".sheet.is-picture"))
    .map((node) => `a picture with no size before it loads: <img src="${node.attributes.get("src")}" class="${node.classes.join(" ")}">, give it width and height or a holds-art holder`);
}

/** A gallery example is a piece shown alone, not a page; what sits over the page (a sheet, a menu, a card over the game) is a layer of its own. */
const EXAMPLE = ".example-stage";
const OVER_PAGE = [".sheet", ".dropdown", "[popover]", ".notice", ".playing-card", ".playing-bar", ".playing-check"];
/** What's never shown as words on the page: scripts, templates, what's only for screen readers or hidden, and code, which is set as typed. */
const NOT_WORDS = ["script", "style", "template", "textarea", "code", "kbd", "pre", ".code", ".sr", "[aria-hidden=true]"];
/** What isn't on the page in the state it's in: closed, hidden, or a template a script fills in. */
const NOT_SHOWN = ["template", "[hidden]", "dialog", "[popover]"];
/** At most this many equal choices side by side (Hick's law), and this many in one menu with no groups. */
export const MAXIMUM_EQUAL_CHOICE_COUNT = 5;
export const MAXIMUM_UNGROUPED_MENU_ITEM_COUNT = 9;
/** At most this many fields in a pane with no heading between them (Miller's law). */
export const MAXIMUM_UNBROKEN_FIELD_COUNT = 7;
const FIELDS = [".cut-field", ".wheel-field", ".pin-field", ".choice-cards", ".toggle", ".check", ".slider"];

/**
 * The layout rules a rendered page can't break unseen, scanned on its markup (docs/DESIGN.md, Rules: made impossible before they're
 * measured): one title, headings in order, no words in capitals, no token's name outside code, few equal choices, fields in groups, and one
 * runner. Each problem names its rule as the measuring check would and what breaks it. test/site/design.test.ts holds every page to it.
 */
export async function pageStructureProblems(markup: string): Promise<string[]> {
  const nodes = everyNode(await pageTree(markup));
  const problems: string[] = [];
  // Hierarchy: one h1, and headings that never skip a level.
  const titles = nodes.filter((node) => node.tag === "h1" && isInside(node, "main", ".city") && !isInside(node, EXAMPLE, "dialog", "template"));
  if (titles.length > 1) problems.push(`more than one title: ${nameOf(titles[1]!)}, a second h1 after ${nameOf(titles[0]!)}`);
  let lastLevel = 1;
  for (const heading of nodes.filter((node) => /^h[1-4]$/.test(node.tag) && isInside(node, "main") && !isInside(node, EXAMPLE, "template", ...OVER_PAGE))) {
    const level = Number(heading.tag[1]);
    if (level > lastLevel + 1) problems.push(`headings out of order: ${nameOf(heading)}, an h${level} after an h${lastLevel}`);
    lastLevel = level;
  }
  // Words: never in capitals for show, and a token's name only in code (Jost draws its two hyphens as one dash).
  for (const node of nodes.filter((each) => each.words.trim() && !isOrInside(each, ...NOT_WORDS))) {
    if (/\b[A-Z]{3,}\s+[A-Z]{3,}\b/.test(node.words)) problems.push(`words in capitals: ${nameOf(node)}`);
    if (/--[a-z]/.test(node.words)) problems.push(`a token's name outside code: ${nameOf(node)}, set it in code`);
  }
  // Hick's law and choice overload: few equal choices in a row, and a long menu in groups. A switch is a strip that scrolls sideways past its
  // room (filters, places, regions), read as one control, so it isn't counted.
  const isChoiceGroup = (node: PageNode) => node.classes.includes("layout-row") && node.attributes.has("data-control-height");
  for (const group of nodes.filter((node) => isChoiceGroup(node) && !isInside(node, EXAMPLE))) {
    const choices = group.children.filter((cell) => cell.classes.includes("row-cell") && cell.classes.includes("is-control") && !cell.attributes.has("hidden") && cell.children.some((child) => (child.classes.includes("shell") || child.classes.includes("run-wrap")) && !child.attributes.has("hidden")));
    if (choices.length > MAXIMUM_EQUAL_CHOICE_COUNT) problems.push(`too many equal choices: ${nameOf(group)}, ${choices.length} side by side, at most ${MAXIMUM_EQUAL_CHOICE_COUNT}`);
  }
  for (const menu of nodes.filter((node) => node.classes.includes("dropdown") && node.attributes.get("role") === "menu" && !isInside(node, EXAMPLE))) {
    const items = everyNode(menu).filter((node) => node.attributes.get("role") === "menuitem" && !node.attributes.has("hidden"));
    if (items.length > MAXIMUM_UNGROUPED_MENU_ITEM_COUNT && !everyNode(menu).some((node) => node.tag === "hr")) problems.push(`too many equal choices: ${nameOf(menu)}, ${items.length} in one menu with no groups, at most ${MAXIMUM_UNGROUPED_MENU_ITEM_COUNT}`);
  }
  // Miller's law and chunking: a pane's fields come in groups, a heading between.
  for (const holder of nodes.filter((node) => (node.classes.includes("pane-in") || node.classes.includes("sheet-in")) && !isInside(node, EXAMPLE))) {
    let run = 0;
    for (const node of everyNode(holder)) {
      if (/^(h2|h3|h4|legend)$/.test(node.tag)) run = 0;
      else if (FIELDS.some((field) => isNode(node, field)) && !FIELDS.some((field) => isInside(node, field)) && !isOrInside(node, "[hidden]") && ++run > MAXIMUM_UNBROKEN_FIELD_COUNT) {
        problems.push(`a long form in one piece: ${nameOf(node)}, ${run} fields with no heading between them, at most ${MAXIMUM_UNBROKEN_FIELD_COUNT}`);
        break;
      }
    }
  }
  // One runner, the page's one main action, in each state (the header's Sign in apart, and what a layer or a later state shows).
  const runners = nodes.filter((node) => node.classes.includes("run-wrap") && !isInside(node, "header", "[data-on-no-pane]", EXAMPLE, ...NOT_SHOWN, ...OVER_PAGE));
  if (runners.length > 1) problems.push(`two runners in view: ${nameOf(runners[1]!)} beside ${nameOf(runners[0]!)}`);
  return [...new Set(problems)];
}
