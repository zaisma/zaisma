import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../../apps/site/src/index.ts";
import { COMPONENTS, COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { COMPONENT_GROUPS, component } from "../../apps/site/src/components/component.ts";
import { GALLERY_STYLES, groupPath } from "../../apps/site/src/design-page.ts";
import * as actions from "../../apps/site/src/components/actions.ts";
import * as inputs from "../../apps/site/src/components/inputs.ts";
import * as navigation from "../../apps/site/src/components/navigation.ts";
import * as panes from "../../apps/site/src/components/panes.ts";
import * as data from "../../apps/site/src/components/data.ts";
import { pageSettingsAttributes } from "../../apps/site/src/components/foundations.ts";
import { html } from "../../apps/site/src/html.ts";

/**
 * Every page is built from one gallery of components (docs/DECISIONS.md): zaisma.com/design shows each one,
 * rendered from the code pages use. These check that every component is on it, that nothing ships outside it,
 * and that its views and frames answer as they should.
 */

const SITE = "https://zaisma.test";
const page = async (path: string) => {
  const response = await SELF.fetch(`${SITE}${path}`);
  return { response, text: await response.text() };
};

describe("the gallery", () => {
  it("shows every component, by name, with its examples, on its group's page", async () => {
    for (const each of COMPONENTS()) {
      const { response, text } = await page(groupPath(each.group));
      expect(response.status, each.group).toBe(200);
      const at = text.indexOf(`<section class="component-section" id="${each.slug}"`);
      expect(at, each.slug).toBeGreaterThan(-1);
      const next = text.indexOf('<section class="component-section"', at + 1);
      const section = text.slice(at, next === -1 ? undefined : next);
      expect(section, each.slug).toContain(each.name.replace(/'/g, "&#39;"));
      expect(section.split('<figure class="example').length - 1, each.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it("has a component for every markup function the pages can call, so nothing ships outside it", () => {
    const renders = COMPONENTS().map((each) => each.render);
    const problems = Object.entries({ actions, inputs, navigation, panes, data }).flatMap(([file, exports]) =>
      Object.entries(exports)
        .filter(([, value]) => typeof value === "function")
        .filter(([, value]) => renders.filter((render) => render === value).length !== 1)
        .map(([name]) => `${file}.ts: ${name} isn't the render of exactly one component`),
    );
    expect(problems).toEqual([]);
  });

  it("puts every component's styles in the pages' styles", () => {
    const styles = COMPONENT_STYLES();
    for (const each of COMPONENTS()) expect(styles, each.slug).toContain(each.styles);
  });

  it("gives every component a slug of its own", () => {
    const slugs = COMPONENTS().map((each) => each.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(() => component({ name: "Again", slug: "runner-button", group: "actions", summary: "", styles: "", examples: [] })).toThrow(/Two components/);
    expect(() => component({ name: "Bad", slug: "Not_A_Slug", group: "actions", summary: "", styles: "", examples: [] })).toThrow(/lowercase/);
  });

  it("never moves what you point at or press, only what's inside it, so the pointer can't slip off as it moves", () => {
    // A rule whose subject (the last part of its selector) is in a pointer state must not move that element.
    // Moving what's inside it (a shell's .face) is how a component lifts or sinks; see "Still under the pointer" in TOKEN_STYLES.
    const POINTER_STATE = /:hover|:active|\.is-pointed|\.is-pressed|\.over\b/;
    const MOVES = /(^|[;{\s])(transform|translate|scale|rotate|top|left|right|bottom|inset|margin(-[a-z]+)?)\s*:/;
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!MOVES.test(declarations)) continue;
      for (const selector of selectors.split(",").map((each) => each.trim())) {
        const subject = selector.split(/[\s>+~]+/).pop() ?? "";
        if (POINTER_STATE.test(subject) && !/::(before|after)/.test(subject)) problems.push(selector);
      }
    }
    expect(problems).toEqual([]);
  });

  it("makes every glass from one look: only the .glass rule paints glass, and components only set its variables", () => {
    // Glass is defined once (foundations.ts, ".glass"): anything made of glass takes that class and may set --glass-tint or
    // --glass-layer, never its own blur, tint or light, so every piece of glass looks and changes alike.
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const isTheGlass = selectors.trim().replace(/^\/\*[\s\S]*?\*\/\s*/g, "") === ".glass";
      const blur = /(?:^|[;\s])backdrop-filter:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
      if (blur && blur !== "none" && !isTheGlass) problems.push(`${selectors.trim()}: its own blur`);
      if (/(?:^|[;\s])background(?:-color|-image)?:[^;]*var\(--glass-/.test(declarations) && !isTheGlass) problems.push(`${selectors.trim()}: paints with the glass's tokens`);
    }
    expect(problems).toEqual([]);
  });

  it("cuts every action and input by the one edge rule: no control carries a shape of its own", () => {
    // The edge rule (GLASS_SCRIPT) gives every control its shape as --cut-shape: a slant only beside another control in a row,
    // and corners that fit what holds it. A control's CSS only ever clips to that, and its markup never names corners of its own.
    const controls = COMPONENTS().filter((each) => each.group === "actions" || each.group === "inputs");
    const navigationControls = COMPONENTS().filter((each) => each.slug === "header" || each.slug === "row-arrows");
    const problems: string[] = [];
    const check = (styles: string, isControlRule: (selector: string) => boolean) => {
      for (const [, selectors = "", declarations = ""] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const clip = /(?:^|[;\s])clip-path:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
        if (!clip || clip === "var(--cut-shape)" || clip === "none") continue;
        const selector = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (isControlRule(selector)) problems.push(`${selector}: clip-path: ${clip}`);
      }
    };
    for (const each of controls) check(each.styles, () => true);
    for (const each of navigationControls) check(each.styles, (selector) => /\.(nav|steps?)\b/.test(selector));
    for (const each of controls) for (const example of each.examples) if (/data-cut-corners/.test(example.markup.html)) problems.push(`${each.slug}, ${example.label}: corners of its own`);
    expect(problems).toEqual([]);
  });

  it("fades no background by itself: colours fade through registered colours, so nothing flashes as a fade ends", () => {
    // A background colour that fades on its own is drawn on a layer the browser drops when the fade ends, a flash on glass.
    // Glass fades --glass-shown-tint and every control fades --face-colour (foundations.ts) instead.
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const transition = /(?:^|[;\s])transition:\s*([^;}]+)/.exec(declarations)?.[1] ?? "";
      if (/autofill/.test(selectors)) continue; // the browser's own autofill colour, held off on purpose
      if (/(^|,\s*)background(-color)?\s/.test(transition)) problems.push(`${selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim()}: transition: ${transition.trim()}`);
    }
    expect(problems).toEqual([]);
  });

  it("lets no glass change differently: a rule on anything made of glass that sets a transition starts it with the glass's", async () => {
    // The classes that sit beside "glass" on the gallery's pages (the header, a pane, a menu, a button's face, the rail's thumb).
    const glassClasses = new Set<string>();
    for (const { group } of COMPONENT_GROUPS) {
      for (const [, classes = ""] of (await page(groupPath(group))).text.matchAll(/class="([^"]*)"/g)) {
        const list = classes.split(/\s+/);
        if (list.includes("glass")) list.filter((each) => each && each !== "glass").forEach((each) => glassClasses.add(each));
      }
    }
    // Classes that only say a state or a size, shared with things that aren't glass.
    for (const state of ["shut", "is-compact", "is-page", "is-collapsed", "medium", "small", "large", "full", "face"]) glassClasses.delete(state);
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const transition = /(?:^|[;\s])transition:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
      if (!transition || transition.startsWith("var(--glass-transition)")) continue;
      for (const selector of selectors.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((each) => each.trim())) {
        const subject = selector.split(/[\s>+~]+/).pop() ?? "";
        if (/::/.test(subject)) continue;
        const classes = [...subject.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1] ?? "");
        if (classes.includes("glass") || classes.some((each) => glassClasses.has(each))) problems.push(`${selector}: transition: ${transition}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("spaces everything with the spacing tokens: no gap, padding or margin is a number of its own", async () => {
    // docs/DESIGN.md, Spacing. A length is 0, auto or the tokens (in calc, times plain numbers). What isn't spacing between things
    // (a control's inside, room a box keeps for its scrollbar or for what lifts in it) is NOT_SPACING below, named one by one.
    const isSpacing = (value: string) => !/(\d|\.)(px|em|rem|vw|vh|%)/.test(value.replace(/var\(--(gap|pad)-[a-z-]+\)/g, ""));
    const problems: string[] = [];
    const checkDeclarations = (where: string, declarations: string) => {
      for (const [, property = "", value = ""] of declarations.matchAll(/(?:^|[;\s{])((?:row-|column-)?gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|scroll-padding(?:-[a-z]+)?):\s*([^;}]+)/g)) {
        if (!isSpacing(value) && !NOT_SPACING.has(`${where} | ${property}`)) problems.push(`${where} | ${property}: ${value.trim()}`);
      }
    };
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      checkDeclarations(selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim(), declarations);
    }
    for (const { group } of COMPONENT_GROUPS) {
      for (const [, style = ""] of (await page(groupPath(group))).text.matchAll(/style="([^"]*)"/g)) checkDeclarations(`${group}, style="${style}"`, style);
    }
    expect(problems).toEqual([]);
  });

  it("puts controls side by side --gap-control-row-boxes apart (the edge rule's neighbour distance) and stacked --gap-control-stack apart", async () => {
    const problems: string[] = [];
    const rules = [...(COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors = "", declarations = ""]) => {
      const gap = /(?:^|[;\s])gap:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
      const isStack = /(?:^|[;\s])(display:\s*grid|flex-direction:\s*column)/.test(declarations);
      return gap ? selectors.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((selector) => ({ subject: selector.trim().split(/[\s>+~]+/).pop() ?? "", gap, isStack })) : [];
    });
    for (const { group } of COMPONENT_GROUPS) {
      for (const holder of elementTree((await page(groupPath(group))).text)) {
        const children = holder.children.filter((child) => child.tag !== "svg" && child.tag !== "template");
        // A control's own parts (a switch's tabs, the row arrows' two slabs) are its inside, not controls beside each other.
        if (holder.classes.includes("shell") || holder.attributes.includes(" data-cut-line")) continue;
        if (children.length < 2 || !children.every((child) => child.classes.includes("shell") || child.attributes.includes(" data-cut-line"))) continue;
        const matching = rules.filter(({ subject }) => matchesSubject(holder, subject));
        const isStack = matching.some((rule) => rule.isStack) || /(^|;)\s*(display:\s*grid|flex-direction:\s*column)/.test(holder.style);
        const gaps = [...matching.map(({ gap }) => gap), ...(/(?:^|;)\s*gap:\s*([^;]+)/.exec(holder.style)?.slice(1) ?? [])];
        // A row is a .control-row (foundations.ts): a gap can't be negative, so its controls overlap by a margin of --gap-control-row-boxes.
        if (!isStack && holder.classes.includes("control-row")) continue;
        if (!isStack || gaps.length === 0 || gaps.some((gap) => gap !== "var(--gap-control-stack)")) problems.push(`${group}: <${holder.tag} class="${holder.classes.join(" ")}">: gap ${gaps.join(", ") || "not set"}`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it("opens light or dark from its address, and the other groups' pages keep it", async () => {
    for (const { group } of COMPONENT_GROUPS) {
      const { text } = await page(`${groupPath(group)}?theme=dark`);
      expect(text).toContain('<div id="stage" class="stage" data-theme-choice="dark">');
      expect(text).toContain(`<a href="${groupPath("panes")}?theme=dark" data-gallery-page="${groupPath("panes")}"`);
    }
    // Anything but dark is light: the parameter is closed.
    expect((await page("/design?theme=purple")).text).toContain('<div id="stage" class="stage" data-theme-choice="light">');
  });

  it("is never framed", async () => {
    for (const path of ["/design", "/design/panes"]) expect((await SELF.fetch(`${SITE}${path}`)).headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
  });

  it("has a page for each group and none for anything else", async () => {
    expect((await page("/design/actions")).text).toMatch(/<a href="\/design\/actions" data-gallery-page="\/design\/actions" aria-current="page"[^>]*>.*?Actions<\/span><\/a>/);
    expect((await page("/design/frame/runner-button")).response.status).toBe(404);
    expect((await page("/design/foundations")).response.status).toBe(404);
    expect((await page("/design/no-such-group")).response.status).toBe(404);
  });

});

describe("components", () => {
  it("put a page's settings on it, taking only a #rrggbb colour as the glass's hue", () => {
    expect(pageSettingsAttributes({ theme: "dark", glass: { hueColour: "#2E9E6B" } }).html).toBe(' data-theme-choice="dark" style="--glass-hue:#2E9E6B"');
    expect(pageSettingsAttributes({}).html).toBe("");
    for (const hueColour of ["red", "#2E9E6B;background:url(x)", "#2E9E6", '"><script>']) expect(pageSettingsAttributes({ glass: { hueColour } }).html).toBe("");
  });

  it("make the runner a link with an address and a button without one", () => {
    expect(actions.runButton("Play", { href: "/g/x" }).html).toMatch(/<a class="shell run-wrap" href="\/g\/x">/);
    expect(actions.runButton("Play").html).toMatch(/<button class="shell run-wrap" type="submit">/);
  });

  it("give a password field its Show toggle, and an error its message", () => {
    expect(inputs.cutField({ name: "password", label: "Password", type: "password", icon: "lock" }).html).toMatch(/<button type="button" class="show cut-raised" data-cut-line="7" aria-controls="field-password" aria-pressed="false"><svg class="cut-line" aria-hidden="true"><polygon\/><\/svg><span class="show-words">Show<\/span><\/button>/);
    const marked = inputs.cutField({ name: "username", label: "Username", type: "text", icon: "person", error: "Use letters only." }).html;
    expect(marked).toContain('aria-invalid="true" aria-describedby="field-username-error"');
    expect(marked).toContain('<p class="field-error" id="field-username-error">Use letters only.</p>');
  });

  it("open the Developer and Forum tabs only on a developer page", () => {
    const account = { username: "emma_r", pictureMarkup: html`` };
    const onDashboard = navigation.header({ current: "developer", isOnDeveloperPage: true, account }).html;
    expect(onDashboard).toContain('<a href="/dashboard" class="dev" aria-current="page">Developer</a>');
    expect(onDashboard).toContain('<a href="/forum" class="dev">Forum</a>');
    const atHome = navigation.header({ current: "home", isOnDeveloperPage: false, account }).html;
    expect(atHome).toContain('<a href="/dashboard" class="dev off" tabindex="-1" aria-hidden="true">Developer</a>');
    expect(atHome).toContain('<a href="/forum" class="dev off" tabindex="-1" aria-hidden="true">Forum</a>');
  });
});

// What isn't spacing between things, so it keeps a number of its own (docs/DESIGN.md, Spacing). Named one by one, with why,
// so a new one is a deliberate choice.
const NOT_SPACING = new Set<string>([
  // A control's inside: its words and icon to its own edge, set by each control size.
  ".place | gap", ".place | padding", ".place-count | padding", ".run | padding", ".run | gap", ".run.big | padding", ".run.big | gap",
  ".cut-btn > .face | gap", ".cut-btn > .face | padding", ".cut-btn.big > .face | padding", ".glass-btn > .face | gap",
  ".glass-btn > .face | padding", ".guest-btn > .face | gap", ".guest-btn > .face | padding", ".field input | padding",
  ".field.with-toggle input | padding-right", ".field .show | padding", '.find input[type="search"] | padding', ".bday-field | gap",
  ".bday-field | padding", ".bday-field .chev | margin-right", ".tab-switch > a, .tab-switch > button | padding",
  ".tab-switch.small > a, .tab-switch.small > button | padding", ".logo | padding", ".logo | margin-left", ".nav a | padding", ".me | gap",
  ".me | padding", ".top .end .run | padding", ".top .end .run | gap", ".rail-mark span | padding", ".chip | padding",
  // A control's own parts: a well's inset round its slab, the birthday's wheels, and a list of places, one control its slab glides along.
  ".tab-switch | padding", ".tab-switch.small | padding", ".nav | padding", ".steps | padding", ".wheels | gap", ".wheels | padding",
  ".sidebar-list | gap", ".menu | gap", ".menu hr | margin",
  // Lines words up with the places' words under them.
  ".sidebar-heading | padding", ".menu-head | padding",
  // Room to scroll, or for a scrollbar or a page's rail.
  ".wheel | padding", ".glass-pane > .pane-in | margin-right", ".glass-pane > .pane-in::-webkit-scrollbar-track | margin-block",
  "html | scroll-padding-top", ".gallery-layout | padding-right", ".track | scroll-padding-inline",
  // Room for the covers to lift into, given back round the row.
  ".track | padding", ".track | margin",
  // Where a small thing sits on what it marks: a rail's tick, a cover's line, faces overlapping.
  ".rail-mark | margin-top", ".cover-bar | margin-top", ".faces .frame + .frame | margin-left",
  // A header example's stand-in page: room for the header over it, and to scroll the header compact.
  ".stand-in-page | padding", ".stand-in-page | padding-top",
]);

interface Element { tag: string; classes: string[]; attributes: string; style: string; children: Element[] }

/** Every element in a page's markup, as a tree: enough to see what holds what. */
function elementTree(markup: string): Element[] {
  const all: Element[] = [];
  const open: Element[] = [];
  const voids = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path", "polygon", "circle", "rect", "line", "polyline", "stop", "use"]);
  const body = markup.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "");
  for (const [tag, closing = "", name = "", attributes = ""] of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const tagName = name.toLowerCase();
    if (closing) {
      const at = open.map((each) => each.tag).lastIndexOf(tagName);
      if (at !== -1) open.length = at;
      continue;
    }
    const element: Element = { tag: tagName, classes: (/\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/).filter(Boolean), attributes, style: /\sstyle="([^"]*)"/.exec(attributes)?.[1] ?? "", children: [] };
    open.at(-1)?.children.push(element);
    all.push(element);
    if (!voids.has(tagName) && !tag.endsWith("/>")) open.push(element);
  }
  return all;
}

/** Whether a selector's last compound (".a.b", "div.a", "button") could be this element. Attributes and states are ignored. */
function matchesSubject(element: Element, subject: string): boolean {
  const plain = subject.replace(/\[[^\]]*\]|::?[a-z-]+(\([^)]*\))?/g, "");
  if (!plain) return false;
  const tag = /^[a-z][a-z0-9-]*/.exec(plain)?.[0];
  const classes = [...plain.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((match) => match[1] ?? "");
  if (tag && tag !== element.tag) return false;
  if (!tag && classes.length === 0) return false;
  return classes.every((each) => element.classes.includes(each));
}
