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
import foundationsSource from "../../apps/site/src/components/foundations.ts?raw";
import actionsSource from "../../apps/site/src/components/actions.ts?raw";
import inputsSource from "../../apps/site/src/components/inputs.ts?raw";
import navigationSource from "../../apps/site/src/components/navigation.ts?raw";
import panesSource from "../../apps/site/src/components/panes.ts?raw";
import dataSource from "../../apps/site/src/components/data.ts?raw";
import galleryPageSource from "../../apps/site/src/design-page.ts?raw";

/** The gallery's own source, to check it draws nothing by hand. */
const SOURCES: Record<string, string> = {
  "components/foundations.ts": foundationsSource, "components/actions.ts": actionsSource, "components/inputs.ts": inputsSource,
  "components/navigation.ts": navigationSource, "components/panes.ts": panesSource, "components/data.ts": dataSource, "design-page.ts": galleryPageSource,
};

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
      const at = text.indexOf(`<div class="component-section" id="${each.slug}"`);
      expect(at, each.slug).toBeGreaterThan(-1);
      const next = text.indexOf('<div class="component-section"', at + 1);
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

  it("cuts everything by the one edge rule: nothing carries a shape of its own", () => {
    // The edge rule (GLASS_SCRIPT) gives every control, picture and swatch its shape as --cut-shape: a slant only beside another
    // in a row, and corners that fit what holds it. CSS only ever clips to that; the few shapes that aren't the rule's are
    // HAND_CUT below, named one by one with their reason, and markup never names corners of its own.
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const clip = /(?:^|[;\s])clip-path:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
      if (!clip || clip === "var(--cut-shape)" || clip === "none" || clip === "inset(50%)") continue;
      const selector = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim();
      if (!HAND_CUT.has(selector)) problems.push(`${selector}: clip-path: ${clip}`);
    }
    for (const each of COMPONENTS()) for (const example of each.examples) if (/data-cut-corners/.test(example.markup.html)) problems.push(`${each.slug}, ${example.label}: corners of its own`);
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

  it("sets every word in a type token: no font or size is a number of its own", async () => {
    // Words take one of Type's whole fonts (--type-*, foundations.ts). A control's own inside (its words, set by its size) and the
    // few other fonts that aren't words on a page are NOT_TYPE below, named one by one; font-weight alone may change inside words.
    const problems: string[] = [];
    const checkDeclarations = (where: string, declarations: string) => {
      for (const [, property = "", value = ""] of declarations.matchAll(/(?:^|[;\s{])(font|font-size|font-family):\s*([^;}]+)/g)) {
        if (/^var\(--type-[a-z]+\)$/.test(value.trim()) || value.trim() === "inherit" || NOT_TYPE.has(`${where} | ${property}`)) continue;
        problems.push(`${where} | ${property}: ${value.trim()}`);
      }
    };
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      checkDeclarations(selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim(), declarations);
    }
    for (const { group } of COMPONENT_GROUPS) {
      for (const [, style = ""] of (await page(groupPath(group))).text.matchAll(/style="([^"]*)"/g)) checkDeclarations(`${group}, style="${style}"`, style);
    }
    expect(problems).toEqual([]);
  });

  it("makes every link a Link: only .link underlines, and no other link is styled outside a control", () => {
    // A link in words is textLink (actions.ts). Anything else you can follow is a control (a button, a tab, a place) or the logo:
    // the only rules that style a bare link are a control's, in LINK_IN_CONTROL.
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim();
      const decoration = /(?:^|[;\s])text-decoration(?:-line)?:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
      if (decoration && decoration !== "none" && !/:focus|is-focused/.test(selector) && !selector.split(",").every((each) => /^\.link\b/.test(each.trim()))) problems.push(`${selector}: text-decoration: ${decoration}`);
      for (const each of selector.split(",").map((one) => one.trim())) {
        const subject = each.split(/[\s>+~]+/).pop() ?? "";
        if (/^a(?=$|[:.[])/.test(subject) && !LINK_IN_CONTROL.has(each.replace(/:[a-z-]+(\([^)]*\))?/g, ""))) problems.push(`${each}: styles a link of its own`);
      }
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
        // A control's own parts (a switch's tabs, the row arrows' two slabs, a dropdown's choices) are its inside, not controls beside each other.
        if (holder.classes.includes("shell") || holder.attributes.includes(" data-cut-line") || holder.attributes.includes(' role="menu"')) continue;
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

  it("shows keyboard focus the one way: every focus line or outline is --focus (or --focus-on-run on the runner)", () => {
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/:focus|is-focused/.test(selectors)) continue;
      for (const [, property = "", value = ""] of declarations.matchAll(/(?:^|[;\s])(outline|stroke|text-decoration):\s*([^;}]+)/g)) {
        if (/^none$/.test(value.trim()) || /var\(--focus(-on-run)?\)/.test(value)) continue;
        problems.push(`${selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim()}: ${property}: ${value.trim()}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("builds everything on its pages from the gallery: every piece comes from a component, or is a named exception", async () => {
    // A class on a gallery page is a component's (its styles define it) or the gallery's own scaffolding (GALLERY_ONLY, with why).
    // The gallery may place a component (where it sits and how big its box is) or set the variables it offers, never restyle it.
    // No source draws its own icon, button or pane: icons are the icon set's (or a named brand mark), buttons come from actions.ts,
    // and glass sheets from Glass pane or Tray, or one of the named pieces made of glass (OWN_GLASS).
    const problems: string[] = [];
    const componentCss = COMPONENT_STYLES();
    const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = "", declarations = ""]) => ({ selector: selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim(), declarations }));
    const styledBy = (css: string, name: string) => new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);
    for (const { group } of COMPONENT_GROUPS) {
      const body = (await page(groupPath(group))).text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "");
      for (const [, list = ""] of body.matchAll(/\sclass="([^"]*)"/g)) {
        for (const name of list.split(/\s+/).filter(Boolean)) {
          if (styledBy(componentCss, name) || GALLERY_ONLY.has(name) || UNSTYLED_HOOKS.has(name)) continue;
          problems.push(`${group}: .${name} comes from no component`);
        }
      }
    }
    const PLACING = /^(--[\w-]+|margin(-[a-z]+)?|position|top|right|bottom|left|inset|z-index|flex(-[a-z]+)?|order|align-self|justify-self|grid-(column|row)|width|max-width|min-width|height|max-height|min-height|display)$/;
    for (const { selector, declarations } of rules(GALLERY_STYLES)) {
      if (selector.startsWith("@")) continue;
      for (const each of selector.split(",")) {
        const subject = each.trim().split(/[\s>+~]+/).pop() ?? "";
        const classes = [...subject.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
        // The gallery's own element (a class only it styles) is the gallery's to style.
        if (!classes.length || classes.some((name) => GALLERY_ONLY.has(name)) || !classes.some((name) => styledBy(componentCss, name))) continue;
        for (const [, property = ""] of declarations.matchAll(/(?:^|[;\s])([\w-]+)\s*:/g)) if (!PLACING.test(property)) problems.push(`gallery restyles ${each.trim()}: ${property}`);
      }
    }
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const line of source.split("\n")) {
        if (/<svg[\s>]/.test(line) && ![...OWN_SVG.keys()].some((name) => line.includes(name))) problems.push(`${file}: draws an svg of its own: ${line.trim().slice(0, 70)}`);
        if (/class=\\?"shell/.test(line) && file !== "components/actions.ts") problems.push(`${file}: builds a button by hand: ${line.trim().slice(0, 70)}`);
        if (/<[a-z][^>]*\sdata-glass(?=[\s>])/.test(line) && ![...OWN_GLASS.keys()].some((name) => line.includes(name))) problems.push(`${file}: makes glass by hand: ${line.trim().slice(0, 70)}`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it("names no exception that's gone: every entry in the lists below is still in the code", async () => {
    const problems: string[] = [];
    const css = COMPONENT_STYLES() + GALLERY_STYLES;
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = "", declarations = ""]) => ({ selector: selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim(), declarations }));
    const declared = new Set(rules.flatMap(({ selector, declarations }) => [...declarations.matchAll(/(?:^|[;\s{])([\w-]+)\s*:/g)].map(([, property]) => `${selector} | ${property}`)));
    for (const entry of [...NOT_SPACING, ...NOT_TYPE]) if (!declared.has(entry)) problems.push(`${entry} (NOT_SPACING or NOT_TYPE)`);
    const selectors = new Set(rules.flatMap(({ selector }) => [selector, ...selector.split(",").map((each) => each.trim().replace(/:[a-z-]+(\([^)]*\))?/g, ""))]));
    for (const entry of [...LINK_IN_CONTROL, ...HAND_CUT]) if (!selectors.has(entry)) problems.push(`${entry} (LINK_IN_CONTROL or HAND_CUT)`);
    let pages = "";
    for (const { group } of COMPONENT_GROUPS) pages += (await page(groupPath(group))).text;
    for (const name of [...GALLERY_ONLY, ...UNSTYLED_HOOKS]) if (!new RegExp(`class="[^"]*\\b${name}\\b`).test(pages)) problems.push(`.${name} (GALLERY_ONLY or UNSTYLED_HOOKS)`);
    const source = Object.values(SOURCES).join("\n");
    for (const name of [...OWN_SVG.keys(), ...OWN_GLASS.keys()]) if (!source.includes(name)) problems.push(`${name} (OWN_SVG or OWN_GLASS)`);
    expect(problems).toEqual([]);
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
    expect((await page("/design/actions")).text).toContain('<a href="/design/actions" data-gallery-page="/design/actions" aria-current="page">Actions</a>');
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
    expect(inputs.cutField({ name: "password", label: "Password", type: "password", icon: "lock" }).html).toContain(actions.cutButton("Show", { type: "button", isSmall: true, isPressed: false, controls: "field-password" }).html);
    const marked = inputs.cutField({ name: "username", label: "Username", type: "text", icon: "person", error: "Use letters only." }).html;
    expect(marked).toContain('aria-invalid="true" aria-describedby="field-username-error"');
    expect(marked).toContain('<p class="field-error" id="field-username-error">Use letters only.</p>');
  });

  it("open the Developer and Forum tabs only on a developer page", () => {
    const account = { username: "emma_r", pictureMarkup: html`` };
    const onDashboard = navigation.header({ current: "developer", isOnDeveloperPage: true, account }).html;
    expect(onDashboard).toContain('<a href="/dashboard" class="foldable" aria-current="page">Developer</a>');
    expect(onDashboard).toContain('<a href="/forum" class="foldable">Forum</a>');
    const atHome = navigation.header({ current: "home", isOnDeveloperPage: false, account }).html;
    expect(atHome).toContain('<a href="/dashboard" class="foldable folded" tabindex="-1" aria-hidden="true">Developer</a>');
    expect(atHome).toContain('<a href="/forum" class="foldable folded" tabindex="-1" aria-hidden="true">Forum</a>');
  });
});

// What isn't spacing between things, so it keeps a number of its own (docs/DESIGN.md, Spacing). Named one by one, with why,
// so a new one is a deliberate choice.
const HAND_CUT = new Set<string>([
  // A pane: cut by its own corners (24 and 20, the header and the gallery's bar 20 and 14), which the edge rule fits all inside it to.
  ".top", ".header-frame", ".backdrop-frame", ".glass-play", ".cuts .header-cut", ".cuts .pane-cut",
  // A shape for the glass demo to blur: what's behind the glass, not part of Zaisma.
  ".glass-play .cut",
  // The scroll rail's thumb and the labels its marks open.
  ".rail-thumb", ".rail:hover .rail-thumb, .rail.dragging .rail-thumb", ".rail[data-rail=\"page\"] .rail-thumb",
  ".rail[data-rail=\"page\"]:hover .rail-thumb, .rail[data-rail=\"page\"].dragging .rail-thumb", ".rail .rail-thumb",
  ".rail-mark span", ".rail:hover .rail-mark span, .rail.dragging .rail-mark span",
  // Tags and a cover's line: slanted at both ends, a mark on what it labels rather than a thing of its own.
  ".tag", ".cover-bar",
]);

// The gallery's own scaffolding, styled only by GALLERY_STYLES: what holds the components, never a piece of Zaisma's UI itself.
const GALLERY_ONLY = new Set<string>([
  // The page: its body, the stage that carries its settings, the bar, its title and its groups, the layout, the index and the main column.
  "gallery", "stage", "gallery-bar", "gallery-title", "gallery-groups", "gallery-layout", "gallery-index", "gallery-main", "group-name",
  // A section (a Tray) with its name and summary, and the grid of labelled examples on it.
  "component-section", "component-name", "component-summary", "examples", "example", "wide", "example-stage", "example-name",
  // Frames an example is shown in: a header over a stand-in page that scrolls under it, a dropdown hanging from its button, a short box
  // for the rail, a cover at a card's width, and the two Spacing examples that mark a pane's own padding and gap.
  "header-frame", "tall", "logo-frame", "header-scroll", "stand-in-page", "stand-in-row", "dropdown-frame", "rail-box", "cover-sample", "example-pane",
]);

// Classes a script or a screen reader uses, with no look of their own.
const UNSTYLED_HOOKS = new Set<string>([
  "bday-read", // The birthday's spoken summary (and .sr hides it).
  "row", // A row of covers, for the rail's marks.
]);

// The only svgs drawn in source, each with why: everything else is an icon from the set.
const OWN_SVG = new Map<string, string>([
  ["const stroke = ", "the icon set's line icons"],
  ['"arrow-back"', "the icon set's filled arrows"],
  ['"arrow-on"', "the icon set's filled arrows"],
  ["play: '<svg", "the icon set's play triangle"],
  ["9988 2820", "Zaisma's wordmark (the Logo)"],
  ["4527 3300", "Zaisma's mark (the Logo)"],
  ['class="cut-line"', "the edge rule's outline (CUT_LINE)"],
  ['class="edge"', "glass's drawn rim (EDGE)"],
  ['fill="#FFC107"', "Google's mark, as Google asks it to be shown"],
  ['class="one-colour"', "Discord's mark, as Discord asks it to be shown"],
  ["cursor.innerHTML", "the gallery's loops' own pointer"],
  ["data-glass-play", "the Glass foundation's demo window's resize grip"],
]);

// The only places glass is made by hand, each with why: every other sheet is a Glass pane or a Tray.
const OWN_GLASS = new Map<string, string>([
  ['class="glass glass-pane', "Glass pane itself"],
  ['class="tray-group"', "Tray itself"],
  ['class="face glass"', "a glass button's face"],
  ['class="frame ${pictureSize} glass', "a picture's frame"],
  ['class="dropdown glass', "a dropdown"],
  ['class="top glass', "the header"],
  ['class="gallery-bar glass', "the gallery's bar"],
  ['class="gallery-index glass', "the gallery's index"],
  ['data-glass-play', "the Glass foundation's own demo: a window to drag over drifting shapes"],
  ["glassOpacityPct", "the Glass foundation's own demo: three strengths side by side"],
  ['class="backdrop-frame"', "the Backdrop foundation's own demo"],
  ['data-spacing-show', "the Spacing foundation's demos, which mark a pane's own padding and gap"],
]);

const LINK_IN_CONTROL = new Set<string>([
  // A tab: the header's tabs and a switch's.
  ".tab-switch > a",
  ".tab-switch.big > a", ".tab-switch.small > a", ".tab-switch.vertical > a", ".tab-switch.framed > a",
]);

const NOT_TYPE = new Set<string>([
  "@font-face | font-family",
  // A control's inside: its words, set by each control's size.
  ".run | font", ".run.big | font-size", ".run | font-size", ".cut-btn > .face | font", ".cut-btn.big > .face | font-size",
  ".glass-btn > .face | font", ".guest-btn > .face | font", ".field input | font", '.find input[type="search"] | font', ".bday-field | font",
  '.wheel [role="option"] | font', '.wheel [role="option"][aria-selected="true"] | font-size', ".tab-switch > a, .tab-switch > button | font",
  ".tab-switch.small > a, .tab-switch.small > button | font-size", ".top.is-compact .run | font-size", ".top .end .run | font-size", ".me | font",
  // A picture's initials, sized to the picture.
  ".frame .av | font", ".frame.xs .av | font-size", ".frame.xs .av::first-letter | font-size", ]);

const NOT_SPACING = new Set<string>([
  // A control's inside: its words and icon to its own edge, set by each control size.
  ".tab-switch.vertical > a, .tab-switch.vertical > button | gap", ".tab-switch.vertical > a, .tab-switch.vertical > button | padding", ".dropdown-choice | gap", ".dropdown-choice | padding", ".run | padding", ".run | gap", ".run.big | padding", ".run.big | gap",
  ".cut-btn > .face | gap", ".cut-btn > .face | padding", ".cut-btn.big > .face | padding", ".cut-btn.small > .face | padding", ".cut-btn.in-well > .face | padding", ".glass-btn > .face | gap",
  ".glass-btn > .face | padding", ".guest-btn > .face | gap", ".guest-btn > .face | padding", ".field input | padding",
  ".field.with-toggle input | padding-right", '.find input[type="search"] | padding', ".bday-field | gap",
  ".bday-field | padding", ".bday-chev | margin-right", ".tab-switch > a, .tab-switch > button | padding",
  ".tab-switch.small > a, .tab-switch.small > button | padding", ".logo | padding", ".top > .logo | margin-left", ".me | gap",
  ".me | padding", ".top .end .run | padding", ".top .end .run | gap", ".tag | padding", ".tag.count | padding",
  // A control's own parts: a well's inset round its slab, the birthday's wheels, and a list of places, one control its slab glides along.
  ".tab-switch | padding", ".tab-switch.small | padding", ".steps | padding", ".wheels | gap", ".wheels | padding",
  ".dropdown | gap", ".dropdown hr | margin",
  // Lines words up with the places' words under them.
  ".dropdown-head | padding",
  // Room to scroll, or for a scrollbar or a page's rail.
  ".wheel | padding", "html | scroll-padding-top", ".gallery-layout | padding-right", ".track | scroll-padding-inline",
  // Room for the covers to lift into, given back round the row.
  ".track | padding", ".track | margin",
  // Where a small thing sits on what it marks: a rail's tick, a cover's line.
  ".rail-mark | margin-top", ".cover-bar | margin-top",
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
