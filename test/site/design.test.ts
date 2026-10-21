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
import { BACKDROP_SCRIPT, pageSettingsAttributes } from "../../apps/site/src/components/foundations.ts";
import { GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT } from "../../apps/site/src/components/shaders.ts";
import { html } from "../../apps/site/src/html.ts";
import foundationsSource from "../../apps/site/src/components/foundations.ts?raw";
import tokensSource from "../../apps/site/src/components/tokens.ts?raw";
import iconsSource from "../../apps/site/src/components/icons.ts?raw";
import glassScriptSource from "../../apps/site/src/components/glass-script.ts?raw";
import backdropScriptSource from "../../apps/site/src/components/backdrop-script.ts?raw";
import actionsSource from "../../apps/site/src/components/actions.ts?raw";
import fieldsSource from "../../apps/site/src/components/fields.ts?raw";
import switchSource from "../../apps/site/src/components/switch.ts?raw";
import choicesSource from "../../apps/site/src/components/choices.ts?raw";
import examplePaneSource from "../../apps/site/src/components/example-pane.ts?raw";
import inputsSource from "../../apps/site/src/components/inputs.ts?raw";
import navigationSource from "../../apps/site/src/components/navigation.ts?raw";
import panesSource from "../../apps/site/src/components/panes.ts?raw";
import dataSource from "../../apps/site/src/components/data.ts?raw";
import galleryPageSource from "../../apps/site/src/design-page.ts?raw";

/** The gallery's own source, to check it draws nothing by hand. */
const SOURCES: Record<string, string> = {
  "components/foundations.ts": foundationsSource, "components/tokens.ts": tokensSource, "components/icons.ts": iconsSource, "components/glass-script.ts": glassScriptSource, 
  "components/backdrop-script.ts": backdropScriptSource, "components/actions.ts": actionsSource, "components/fields.ts": fieldsSource, "components/switch.ts": switchSource, "components/choices.ts": choicesSource, "components/example-pane.ts": examplePaneSource, "components/inputs.ts": inputsSource, "components/navigation.ts": navigationSource, "components/panes.ts": panesSource, "components/data.ts": dataSource,
  "design-page.ts": galleryPageSource,
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

  it("fades no background by itself: colors fade through registered colors, so nothing flashes as a fade ends", () => {
    // A background color that fades on its own is drawn on a layer the browser drops when the fade ends, a flash on glass.
    // Glass fades --glass-shown-tint and every control fades --face-color (foundations.ts) instead.
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const transition = /(?:^|[;\s])transition:\s*([^;}]+)/.exec(declarations)?.[1] ?? "";
      if (/autofill/.test(selectors)) continue; // the browser's own autofill color, held off on purpose
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


  it("puts controls side by side --gap-control-row-boxes apart (the edge rule's neighbor distance) and stacked --gap-control-stack apart", async () => {
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
        if (holder.classes.includes("shell") || holder.attributes.includes(" data-cut-line") || holder.attributes.includes(' role="menu"') || holder.attributes.includes(' role="listbox"')) continue;
        // A compact choice list's cards are its own inside, down its carved well like a vertical switch's places.
        if (holder.classes.includes("choice-list-in")) continue;
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
  it("put a page's settings on it, taking only a #rrggbb color as the glass's hue", () => {
    expect(pageSettingsAttributes({ theme: "dark", glass: { hueColor: "#2E9E6B" } }).html).toBe(' data-theme-choice="dark" style="--glass-hue:#2E9E6B"');
    expect(pageSettingsAttributes({}).html).toBe("");
    for (const hueColor of ["red", "#2E9E6B;background:url(x)", "#2E9E6", '"><script>']) expect(pageSettingsAttributes({ glass: { hueColor } }).html).toBe("");
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

  it("keep a delete quiet until its confirm step, whose button is the one red and no runner", () => {
    const markup = actions.deleteButton("Delete this game", { action: "/dashboard/games/ashen-crown/delete", confirmLabel: "Delete Ashen Crown", confirmText: "It's gone for good." }).html;
    expect(markup).toContain('<form class="sheet-form" method="post" action="/dashboard/games/ashen-crown/delete">');
    const confirmForm = markup.slice(markup.indexOf('<form class="sheet-form"'), markup.indexOf("</form>", markup.indexOf('<form class="sheet-form"')));
    expect(confirmForm).toMatch(/<span class="face danger cut-raised"/);
    expect(confirmForm).not.toMatch(/class="[^"]*\brun\b/);
    // Cancel closes the sheet without sending the delete.
    expect(confirmForm).toContain('formmethod="dialog" formnovalidate');
    // The button that opens it is a cut button, never orange, and names its sheet.
    const opener = markup.slice(markup.indexOf("</dialog>"));
    expect(opener).toContain('class="shell cut-btn" type="button" aria-controls="delete-dashboard-games-ashen-crown-delete"');
    expect(opener).not.toMatch(/\brun\b|danger/);
  });

  it("make a toggle a checkbox that posts with its form, with no script", () => {
    const markup = inputs.toggle({ name: "cloud_saves", label: "Cloud saves", isOn: true }).html;
    expect(markup).toContain('<input class="toggle-input" type="checkbox" role="switch" id="toggle-cloud_saves" name="cloud_saves" value="on" checked>');
    expect(inputs.toggle({ name: "cloud_saves", label: "Cloud saves", isOn: false }).html).not.toContain(" checked");
  });

  it("announce a problem notice as an alert and a done one as a status", () => {
    expect(panes.notice({ text: "Couldn't save", tone: "problem" }).html).toContain('role="alert"');
    expect(panes.notice({ text: "Saved", tone: "done" }).html).toContain('role="status"');
  });

  it("count a long field's characters only from 80% of its limit", () => {
    expect(inputs.longField({ name: "patch_notes", label: "What's new", rowCount: 3, maximumCharacterCount: 100, text: "x".repeat(79) }).html).toContain('<p class="long-count" id="field-patch_notes-count" hidden>79 of 100</p>');
    expect(inputs.longField({ name: "patch_notes", label: "What's new", rowCount: 3, maximumCharacterCount: 100, text: "x".repeat(80) }).html).toContain('<p class="long-count" id="field-patch_notes-count">80 of 100</p>');
  });

  it("head a table's columns for screen readers and line its numbers up on the right", () => {
    const markup = data.table({ caption: "Versions", columns: [{ label: "Version" }, { label: "Files", isNumeric: true }], rows: [["Version 14", "312"]] }).html;
    expect(markup).toContain('<p class="table-caption" id="table-versions-caption">Versions</p>');
    expect(markup).toContain('aria-labelledby="table-versions-caption"');
    expect(markup).toContain('<th scope="col" class="glass">Version</th><th scope="col" class="glass num">Files</th>');
    expect(markup).toContain('<td>Version 14</td><td class="num">312</td>');
    // A first column that names the rows is each row's head.
    expect(data.table({ caption: "Versions", hasRowHeads: true, columns: [{ label: "Version" }, { label: "Files", isNumeric: true }], rows: [["Version 14", "312"]] }).html).toContain('<th scope="row" class="glass">Version 14</th><td class="num">312</td>');
  });

  it("give a chart's numbers to screen readers as a table of the same values", () => {
    const markup = data.chart({ label: "Plays a day", points: [{ label: "Oct 20", amountNumber: 1205 }, { label: "Oct 21", amountNumber: 1712.5 }], unit: "plays" }).html;
    expect(markup).toContain('<div class="chart-body" aria-hidden="true">');
    expect(markup).toContain('<div class="sr"><table><caption>Plays a day</caption>');
    expect(markup).toContain('<tr><th scope="row">Oct 20</th><td>1,205 plays</td></tr><tr><th scope="row">Oct 21</th><td>1,712.5 plays</td></tr>');
  });

  it("send a date and time as ISO 8601 with its offset", () => {
    const markup = inputs.dateTimeField({ name: "publish_at", label: "Go live", pickedAt: "2026-10-23T15:30+02:00" }).html;
    const sent = /<input type="hidden" name="publish_at" value="([^"]*)"/.exec(markup)?.[1];
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(inputs.DATE_TIME_SCRIPT).toContain('sign + two(Math.floor(whole / 60)) + ":" + two(whole % 60)');
  });

  it("make a file drop a real file input across the whole field", () => {
    const markup = inputs.fileDrop({ name: "build", label: "Drop your build", accept: ".zip", hint: "Up to 500 MB." }).html;
    expect(markup).toContain('<input class="file-drop-input" type="file" id="drop-build" name="build" accept=".zip" aria-describedby="drop-build-hint">');
  });

  it("cut a stacked control by its place in the whole scrolled content, never by how far the pane happens to be scrolled", () => {
    // A tall pane scrolls inside itself (.own-scroll). Measured against the pane's visible box, the sign-in buttons below the fold had
    // negative gaps and took the pane's bottom corners while Continue as guest, last, went square. Against the scrolled content,
    // the passkey, Google and Discord buttons are square between and only the last of the stack is cut at the foot, wherever it's scrolled to.
    expect(glassScriptSource).toContain('function contentRectOf(el, holder)');
    expect(glassScriptSource).toContain('el.closest(".own-scroll")');
    expect(glassScriptSource).toContain("top - scroller.scrollTop");
    expect(glassScriptSource).toContain("top + scroller.scrollHeight");
    expect(glassScriptSource).toContain("p = contentRectOf(el, holder)");
    expect(glassScriptSource).not.toContain("p = rectOf(holder), ends");
  });

  it("tell the backdrop's shader where the glass is: the data-glass pieces in view, the largest few, no more than the shader holds", () => {
    // The runner (BACKDROP_SCRIPT) reads every piece of glass that isn't a control, keeps the largest MOST_GLASS_PANE_COUNT, and passes their
    // rectangles and cut corners to the pass round the shader, whose arrays are that long.
    expect(MOST_GLASS_PANE_COUNT).toBeLessThanOrEqual(16);
    expect(BACKDROP_SCRIPT).toContain('document.querySelectorAll("[data-glass]:not([data-cut-line])")');
    expect(BACKDROP_SCRIPT).toContain("found = found.slice(0, PANE_LIMIT)");
    expect(BACKDROP_SCRIPT).toContain(`PANE_LIMIT = ${MOST_GLASS_PANE_COUNT};`);
    expect(BACKDROP_SCRIPT).toContain('el.getAttribute("data-glass-corners")');
    expect(GLASS_LIGHT_PASS).toContain(`uniform vec4 zaismaPanes[${MOST_GLASS_PANE_COUNT}];`);
    expect(GLASS_LIGHT_PASS).toContain(`uniform vec4 zaismaPaneCuts[${MOST_GLASS_PANE_COUNT}];`);
    // Every shader keeps its own mainImage: the pass calls it once a pixel.
    expect(GLASS_LIGHT_PASS.match(/mainImage\(/g)?.length).toBe(1);
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
  // A pane: cut by its own corners (24 and 20, the header, the footer and the gallery's bar 20 and 14), which the edge rule fits all inside it to.
  ".top", ".foot", ".header-frame", ".backdrop-frame", ".glass-play", ".cuts .header-cut", ".cuts .pane-cut",
  // A shape for the glass demo to blur: what's behind the glass, not part of Zaisma.
  ".glass-play .cut",
  // The scroll rail's thumb and the labels its marks open.
  ".rail-thumb", ".rail:hover .rail-thumb, .rail.dragging .rail-thumb", ".rail[data-rail=\"page\"] .rail-thumb",
  ".rail[data-rail=\"page\"]:hover .rail-thumb, .rail[data-rail=\"page\"].dragging .rail-thumb", ".rail .rail-thumb",
  ".rail-mark span", ".rail:hover .rail-mark span, .rail.dragging .rail-mark span",
  ".rail.sideways .rail-mark span", ".rail.sideways:hover .rail-mark span, .rail.sideways.dragging .rail-mark span",
  ".rail:not(.dragging) .rail-mark span", ".rail.sideways:not(.dragging) .rail-mark span", ".rail.sideways .rail-mark:not(.is-near) span",
  // Tags and a cover's line: slanted at both ends, a mark on what it labels rather than a thing of its own.
  ".tag", ".cover-bar",
  // The same line under a text button's words, along a list row's foot and across a step flow's top.
  ".text-line", ".step-mark",
  // A picture's presence marks: the green line along its foot and the playing tab, slanted like a tag.
  ".presence-line", ".presence-play",
]);

// The gallery's own scaffolding, styled only by GALLERY_STYLES: what holds the components, never a piece of Zaisma's UI itself.
const GALLERY_ONLY = new Set<string>([
  // The page: its body, the stage that carries its settings, the bar, its title and its groups, the layout, the index and the main column.
  "gallery", "stage", "gallery-bar", "gallery-title", "gallery-groups", "gallery-layout", "gallery-index", "gallery-main", "group-name",
  // A section (a Tray) with its name and summary, and the grid of labeled examples on it.
  "component-section", "component-name", "component-summary", "examples", "example", "wide", "example-stage", "example-name",
  // Frames an example is shown in: a header over a stand-in page that scrolls under it, a dropdown hanging from its button, a short box
  // for the rail, a cover at a card's width, and the two Spacing examples that mark a pane's own padding and gap.
  "header-frame", "tall", "header-scroll", "stand-in-page", "stand-in-row", "dropdown-frame", "rail-box", "rail-side-box", "rail-example-part", "cover-sample", "example-pane",
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
  ['<svg class="chart-drawing"', "a chart's own line or bars, drawn from its numbers"],
  ['<svg class="chart-drawing chart-area-drawing"', "the shade under a chart's line"],
  ['<svg class="ring-drawing"', "a ring chart's parts, drawn from its shares"],
  ['fill="#FFC107"', "Google's mark, as Google asks it to be shown"],
  ['class="one-color"', "Discord's mark, as Discord asks it to be shown"],
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
  ['class="sheet glass', "a sheet"],
  ['class="select-list glass', "a select field's list"],
  ['class="notice glass', "a notice"],
  ['class="foot glass"', "the footer"],
  ['class="banner glass', "a banner"],
  ['class="top glass', "the header"],
  ['class="gallery-bar glass', "the gallery's bar"],
  ['class="gallery-index glass', "the gallery's index"],
  ['data-glass-play', "the Glass foundation's own demo: a window to drag over drifting shapes"],
  ["glassOpacityPct", "the Glass foundation's own demo: three strengths side by side"],
  ['class="backdrop-frame"', "the Backdrop foundation's own demo"],
  ['class="backdrop-frame is-tall', "the Glass foundation's own demos of the light glass bends and the pointer's light"],
  ['data-spacing-show', "the Spacing foundation's demos, which mark a pane's own padding and gap"],
]);

const LINK_IN_CONTROL = new Set<string>([
  // A tab: the header's tabs and a switch's.
  ".tab-switch > a",
  ".tab-switch.big > a", ".tab-switch.small > a", ".tab-switch.vertical > a", ".tab-switch.framed > a", ".tab-switch.is-tight > a", ".tab-switch.small.is-tight > a",
]);

const NOT_TYPE = new Set<string>([
  // A code field's code: inside a control, in code's letters, a size up from code in words so a key reads easily.
  ".code-text | font",
  "@font-face | font-family",
  // A control's inside: its words, set by each control's size.
  ".run | font", ".run.big | font-size", ".run | font-size", ".cut-btn > .face | font", ".cut-btn.big > .face | font-size",
  ".glass-btn > .face | font", ".guest-btn > .face | font", ".field input | font", '.find input[type="search"] | font', ".bday-field | font",
  '.wheel [role="option"] | font', '.wheel [role="option"][aria-selected="true"] | font-size', '.date-time-wheels [role="option"][aria-selected="true"] | font-size', ".tab-switch > a, .tab-switch > button | font",
  ".tab-switch.small > a, .tab-switch.small > button | font-size", ".top.is-compact .run | font-size", ".top .end .run | font-size",
  // A picture's initials, sized to the picture.
  ".frame .av | font", ".frame.xs .av | font-size", ".frame.xs .av::first-letter | font-size",
  ".danger | font", ".danger | font-size", ".field.long textarea | font", ".select-button | font",
  // The +N at the back of a row of pictures, sized to the pictures.
  ".frame.more | font",
]);

const NOT_SPACING = new Set<string>([
  // A pane on the city, on a phone: the city's room above it until CITY_SCRIPT measures how low it can start.
  ".city-page .city-pane | margin",
  // A pane that scrolls: room for its rail beside what's in it.
  ".glass-pane > .pane-in.own-scroll | padding-right",
  // A table's cells: room round a cell's words, set by the table's size.
  ".data-table thead th | padding", ".data-table td, .data-table tbody th | padding", ".data-table.compact thead th | padding", ".data-table.compact td, .data-table.compact tbody th | padding",
  // A chart's last point: centered on its spot. A meter's track: its fill's inset, like a well's.
  ".chart-last | margin", ".chart-dot | margin",
  // A chart's room for the dots at its ends.
  ".chart-inner | padding", ".usage-track | padding",
  // A chart's number where you point: a small label's own room round its words.
  ".chart-tip | padding",
  // A code field's code: clear of the field's edge, and of Copy and "Copied" at its end.
  ".code-text | padding",
  // A control's inside: its words and icon to its own edge, set by each control size.
  ".tab-switch.vertical > a, .tab-switch.vertical > button | gap", ".tab-switch.vertical > a, .tab-switch.vertical > button | padding", ".dropdown-choice | gap", ".dropdown-choice | padding", ".run | padding", ".run | gap", ".run.big | padding", ".run.big | gap",
  ".cut-btn > .face | gap", ".cut-btn > .face | padding", ".cut-btn.big > .face | padding", ".cut-btn.small > .face | padding", ".cut-btn.in-well > .face | padding", ".glass-btn > .face | gap",
  ".glass-btn > .face | padding", ".guest-btn > .face | gap", ".guest-btn > .face | padding", ".field input | padding",
  ".field.with-toggle input | padding-right", '.find input[type="search"] | padding', ".bday-field | gap",
  ".bday-field | padding", ".bday-chev | margin-right", ".tab-switch > a, .tab-switch > button | padding",
  ".tab-switch:not(.vertical) > :nth-child(1 of :not(.folded):not([aria-hidden])) | padding-inline-start",
  ".tab-switch:not(.vertical) > :nth-last-child(1 of :not(.folded):not([aria-hidden])) | padding-inline-end", ".logo | padding", ".top > .logo | margin-left",
  ".me | padding", ".top .end .run | padding", ".top .end .run | gap", ".tag | padding", ".tag.count | padding",
  ".text-btn > .face | padding", ".danger | padding", ".danger | gap", ".field.long textarea | padding", ".select-button | padding",
  ".field.select.no-icon .select-button | padding-left", ".choice-card | padding", ".list-row | padding", ".select-option | gap", ".select-option | padding",
  ".choice-list .choice-card | padding", ".choice-list | padding", ".choice-list .choice-words | gap", ".select-list | gap",
  // A control's own parts: a well's inset round its slab, the birthday's wheels, and a list of places, one control its slab glides along.
  ".tab-switch | padding", ".tab-switch.small | padding", ".color-well | padding", ".steps | padding", ".wheels | gap", ".wheels | padding",
  ".dropdown | gap", ".dropdown hr | margin",
  // Lines words up with the places' words under them.
  ".dropdown-head | padding",
  // Room to scroll, or for a scrollbar or a page's rail.
  ".wheel | padding", "html | scroll-padding-top", ".gallery-layout | padding-right", ".track | scroll-padding-inline",
  ".choice-list-in.own-scroll:has(+ .rail:not([hidden])) | padding-right", ".sheet-in.own-scroll:has(+ .rail:not([hidden])) | padding-right",
  // Room for the covers to lift into, given back round the row.
  ".track | padding", ".track | margin",
  // Where a small thing sits on what it marks: a rail's tick, a cover's line.
  ".rail-mark | margin-top", ".rail.sideways .rail-mark | margin", ".cover-bar | margin-top", ".text-line | margin-top",
  // Lines a box's or a card's icon up with the first line of its words.
  ".check-words | padding-top", ".choice-card > .ico | margin-top",
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

describe("the example page", () => {
  it("is built only from components: every class comes from one, and nothing is styled in place", async () => {
    const { response, text } = await page("/design/example");
    expect(response.status).toBe(200);
    const body = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "");
    const componentCss = COMPONENT_STYLES();
    const styledBy = (name: string) => new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(componentCss);
    const problems = [...body.matchAll(/\sclass="([^"]*)"/g)]
      .flatMap(([, list = ""]) => list.split(/\s+/).filter(Boolean))
      .filter((name) => !styledBy(name) && !UNSTYLED_HOOKS.has(name))
      .map((name) => `.${name} comes from no component`);
    // A page places components; its own look is a component's. Only the variables a component offers (--swatch, the pane's cut) or a placed size may be set.
    for (const [, style = ""] of body.matchAll(/\sstyle="([^"]*)"/g)) if (/(^|;)\s*(color|background|border|font|box-shadow|filter|opacity)/.test(style)) problems.push(`style="${style}" restyles a piece`);
    expect([...new Set(problems)]).toEqual([]);
    expect(text).not.toContain("<style");
  });

  it("uses the cached stylesheet and the components' script, like every page", async () => {
    const { text } = await page("/design/example");
    expect(text).toMatch(/<link rel="stylesheet" href="\/css\/site\.[0-9a-f]{16}\.css">/);
    expect(text).toMatch(/<script src="\/js\/components\.[0-9a-f]{16}\.js"/);
  });
});

describe("pages' stylesheets", () => {
  it("are linked, never written into the page: a page carries only its own markup and a link to a file cached for good", async () => {
    for (const path of ["/", "/design/example", "/design", "/design/actions"]) {
      const { response, text } = await page(path);
      expect(response.status, path).toBe(200);
      const sheet = path.startsWith("/design") && path !== "/design/example" ? "design" : "site";
      expect(text, path).toMatch(new RegExp(`<link rel="stylesheet" href="/css/${sheet}\\.[0-9a-f]{16}\\.css">`));
      // The components' own CSS (200 KB) is in the file; what a page writes itself is small.
      expect(text.length, path).toBeLessThan(120_000);
      expect(text, path).not.toContain(".cut-btn {");
    }
  });

  it("are served from /css/<name>.<hash>.css named for their contents, cached for good; an older address gets the current one uncached", async () => {
    const { text } = await page("/design/example");
    const path = text.match(/href="(\/css\/site\.[0-9a-f]{16}\.css)"/)![1]!;
    const sheet = await SELF.fetch(`${SITE}${path}`);
    const css = await sheet.text();
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(sheet.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(sheet.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(css).toContain(".cut-btn");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(path).toBe(`/css/site.${hash.slice(0, 16)}.css`);
    const older = await SELF.fetch(`${SITE}/css/site.0000000000000000.css`);
    expect(older.status).toBe(200);
    expect(older.headers.get("Cache-Control")).toBe("no-store");
    expect(await older.text()).toBe(css);
    for (const wrong of ["/css/nothing.0000000000000000.css", "/css/site.css", "/css/", "/css/../index.ts"]) expect((await SELF.fetch(`${SITE}${wrong}`)).status, wrong).toBe(404);
    expect((await SELF.fetch(`${SITE}${path}`, { method: "POST" })).status).toBe(405);
  });
});
