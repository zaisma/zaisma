import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAccount, createGame, personOwner } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { COMPONENTS, COMPONENT_STYLES, hoverOnlyWherePointing } from "../../apps/site/src/components/index.ts";
import { MATERIAL_STYLES } from "../../apps/site/src/components/materials.ts";
import { COMPONENT_GROUPS, GALLERY_PLACES, component, galleryPagePath } from "../../apps/site/src/components/component.ts";
import { GALLERY_STYLES } from "../../apps/site/src/design-page.ts";
import * as actions from "../../apps/site/src/components/actions.ts";
import * as inputs from "../../apps/site/src/components/inputs.ts";
import * as navigation from "../../apps/site/src/components/navigation.ts";
import * as panes from "../../apps/site/src/components/panes.ts";
import * as data from "../../apps/site/src/components/data.ts";
import * as layoutComponents from "../../apps/site/src/components/layout.ts";
import { COLUMNS_STYLES, COLUMN_LEAST_PX, GRID_STYLES, PANE_PARTS_STYLES, ROW_STYLES, STACK_STYLES, TRACK_STYLES, columns, grid, paneParts, row, stack, type GridItem, type LayoutItem } from "../../apps/site/src/components/layout.ts";
import { pageStyles } from "../../apps/site/src/page-styles.ts";
import { CHECKED_PAGES, LOCAL_SCREEN_NAMES, MEASURED_SCREEN_NAMES, SCREEN_SIZES, STRESS_ACCOUNTS, TEXT_SCREEN_NAMES, UNIQUE_WORD, stressBaseName, type StepToTake } from "../../apps/site/src/components/checked-pages.ts";
import { layout, type LayoutOptions } from "../../apps/site/src/html.ts";
import { PAGE_SHEETS, STEEL_PAGE_SHEETS, UNSTYLED_HOOKS, pageProblems, pageStructureProblems, pictureBoxProblems, pageWordProblems, pageWords } from "./page-rules.ts";
import { BACKDROP_SCRIPT, glassPane, pageSettingsAttributes } from "../../apps/site/src/components/foundations.ts";
import { GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT } from "../../apps/site/src/components/shaders.ts";
import { SHADER_HEAD, SHADER_LIMITS, SHADER_UPSCALE_SOURCE } from "@zaisma/core";
import { html } from "../../apps/site/src/html.ts";
import { NO_EMPTY_NOTE, raw } from "../../apps/site/src/markup.ts";
import foundationsSource from "../../apps/site/src/components/foundations.ts?raw";
import materialsSource from "../../apps/site/src/components/materials.ts?raw";
import tokensSource from "../../apps/site/src/components/tokens.ts?raw";
import iconsSource from "../../apps/site/src/components/icons.ts?raw";
import glassScriptSource from "../../apps/site/src/components/glass-script.ts?raw";
import backdropScriptSource from "../../apps/site/src/components/backdrop-script.ts?raw";
import actionsSource from "../../apps/site/src/components/actions.ts?raw";
import fieldsSource from "../../apps/site/src/components/fields.ts?raw";
import switchSource from "../../apps/site/src/components/switch.ts?raw";
import lightBoxSource from "../../apps/site/src/components/light-box.ts?raw";
import qrCodeSource from "../../apps/site/src/components/qr-code.ts?raw";
import choicesSource from "../../apps/site/src/components/choices.ts?raw";
import examplePaneSource from "../../apps/site/src/components/example-pane.ts?raw";
import inputsSource from "../../apps/site/src/components/inputs.ts?raw";
import navigationSource from "../../apps/site/src/components/navigation.ts?raw";
import panesSource from "../../apps/site/src/components/panes.ts?raw";
import confirmItsYouSource from "../../apps/site/src/components/confirm-its-you.ts?raw";
import stripeFrameSource from "../../apps/site/src/components/stripe-frame.ts?raw";
import dataSource from "../../apps/site/src/components/data.ts?raw";
import layoutSource from "../../apps/site/src/components/layout.ts?raw";
import layoutGallerySource from "../../apps/site/src/components/layout-gallery.ts?raw";
import controlMarkupSource from "../../apps/site/src/components/control-markup.ts?raw";
import citySource from "../../apps/site/src/components/city.ts?raw";
import screensSource from "../../apps/site/src/components/screens.ts?raw";
import playingSource from "../../apps/site/src/components/playing.ts?raw";
import layersSource from "../../apps/site/src/components/layers.ts?raw";
import readingSource from "../../apps/site/src/components/reading.ts?raw";
import peopleSource from "../../apps/site/src/components/people.ts?raw";
import gameCoverSource from "../../apps/site/src/components/game-cover.ts?raw";
import waitingSource from "../../apps/site/src/components/waiting.ts?raw";
import codeColorsSource from "../../apps/site/src/components/code-colors.ts?raw";
import gameMediaSource from "../../apps/site/src/components/game-media.ts?raw";
import loadMoreSource from "../../apps/site/src/components/load-more.ts?raw";
import videoPlayerSource from "../../apps/site/src/components/video-player.ts?raw";
import firstPaintScriptSource from "../../apps/site/src/components/first-paint-script.ts?raw";
import galleryPageSource from "../../apps/site/src/design-page.ts?raw";

/** The gallery's own source, to check it draws nothing by hand. */
const SOURCES: Record<string, string> = {
  "components/foundations.ts": foundationsSource, "components/materials.ts": materialsSource, "components/tokens.ts": tokensSource, "components/icons.ts": iconsSource, "components/glass-script.ts": glassScriptSource, 
  "components/backdrop-script.ts": backdropScriptSource, "components/actions.ts": actionsSource, "components/fields.ts": fieldsSource, "components/switch.ts": switchSource, "components/light-box.ts": lightBoxSource, "components/qr-code.ts": qrCodeSource, "components/choices.ts": choicesSource, "components/example-pane.ts": examplePaneSource, "components/inputs.ts": inputsSource, "components/navigation.ts": navigationSource, "components/panes.ts": panesSource, "components/confirm-its-you.ts": confirmItsYouSource, "components/stripe-frame.ts": stripeFrameSource, "components/data.ts": dataSource,
  "components/layout.ts": layoutSource, "components/layout-gallery.ts": layoutGallerySource, "components/control-markup.ts": controlMarkupSource, "components/city.ts": citySource, "components/screens.ts": screensSource, "components/playing.ts": playingSource, "components/layers.ts": layersSource,
  "components/reading.ts": readingSource, "components/people.ts": peopleSource, "components/game-cover.ts": gameCoverSource, "components/waiting.ts": waitingSource, "components/first-paint-script.ts": firstPaintScriptSource,
  "components/code-colors.ts": codeColorsSource, "components/game-media.ts": gameMediaSource, "components/load-more.ts": loadMoreSource, "components/video-player.ts": videoPlayerSource,
  "design-page.ts": galleryPageSource,
};

/** A rule's selectors, split at its own commas, never at those inside :is(), :not() or :has(). */
const splitSelectors = (selectors: string) => selectors.split(/,(?![^(]*\))/).map((each) => each.trim());
/** A selector's subject: its last compound, never cut inside :is(), :not() or :has(). */
const subjectOf = (selector: string) => selector.split(/[\s>+~]+(?![^(]*\))/).pop() ?? "";

/** Every rule the materials define (materials.ts): their looks, room and type are theirs by definition, so the checks on a component's own skip them. */
const MATERIAL_SELECTORS = new Set([...MATERIAL_STYLES.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = ""]) => selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim()));

/** Every file in components/, so a new one can't be left out of SOURCES (Vite lists them as it builds the test). */
declare global {
  interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>> }
}
const COMPONENT_FILES = Object.keys(import.meta.glob("../../apps/site/src/components/*.ts")).map((path) => `components/${path.split("/").pop()}`);

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

/**
 * The page a state only forms and links reach shows (checked-pages.ts, stepsToTake): each form sent as a browser would, with its hidden
 * fields, the cookies its answers set and their redirects followed. Null when the steps lead off the site (a stand-in sign-in a test has none of).
 */
async function pageAfterSteps(path: string, steps: readonly StepToTake[]): Promise<string | null> {
  const cookies = new Map<string, string>();
  const go = async (address: string, init: { method?: string; body?: URLSearchParams } = {}): Promise<string | null> => {
    for (let hopCount = 0; hopCount < 5; hopCount++) {
      if (new URL(address).origin !== SITE) return null;
      const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const headers: Record<string, string> = { cookie, ...(init.body ? { "content-type": "application/x-www-form-urlencoded", origin: SITE } : {}) };
      const response = await SELF.fetch(address, { ...init, headers, redirect: "manual" });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0]!;
        cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
      }
      const location = response.headers.get("location");
      if (!location) return response.text();
      address = new URL(location, address).href;
      init = {};
    }
    throw new Error(`${path}: redirected more than 5 times`);
  };
  let text = await go(`${SITE}${path}`);
  for (const step of steps) {
    if (text === null) return null;
    if ("path" in step) {
      text = await go(`${SITE}${step.path}`);
      continue;
    }
    const markup = [...text.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map((match) => match[0]).find((each) => each.includes(`action="${step.formAction}"`));
    if (!markup) throw new Error(`${path}: no form is sent to ${step.formAction}`);
    const body = new URLSearchParams([...markup.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((match) => [match[1]!, match[2]!.replaceAll("&amp;", "&")]));
    for (const [name, value] of Object.entries(step.fieldValues)) body.set(name, value.replaceAll(UNIQUE_WORD, crypto.randomUUID().slice(0, 8)));
    text = await go(`${SITE}${step.formAction}`, { method: "POST", body });
  }
  return text;
}

describe("the gallery", () => {
  it("reads every component's source: none is left out of the checks below", () => {
    // Modules with no markup, styles or pieces of their own to check: plain lists and data.
    const READ_ELSEWHERE = new Set(["components/index.ts", "components/component.ts", "components/checked-pages.ts", "components/layout-measure.ts", "components/shaders.ts"]);
    expect(COMPONENT_FILES.length).toBeGreaterThan(20);
    expect(COMPONENT_FILES.filter((file) => !SOURCES[file] && !READ_ELSEWHERE.has(file))).toEqual([]);
  });

  it("shows every component, by name, with its examples, on its subgroup's page", async () => {
    // A component with nothing of its own to draw, shown by its words alone: a Stripe frame is an empty window Stripe draws in.
    const NOTHING_TO_SHOW = new Set(["stripe-frame"]);
    for (const each of COMPONENTS()) {
      const { response, text } = await page(galleryPagePath(each.group, each.subgroup));
      expect(response.status, each.group).toBe(200);
      const at = text.indexOf(`<div class="component-section" id="${each.slug}"`);
      expect(at, each.slug).toBeGreaterThan(-1);
      const next = text.indexOf('<div class="component-section"', at + 1);
      const section = text.slice(at, next === -1 ? undefined : next);
      expect(section, each.slug).toContain(each.name.replace(/'/g, "&#39;"));
      if (!NOTHING_TO_SHOW.has(each.slug)) expect(section.split('<figure class="example').length - 1, each.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it("has a component for every markup function the pages can call, so nothing ships outside it", () => {
    const renders = COMPONENTS().map((each) => each.render);
    // A component's second way in, for one of its variants, with the component it belongs to: its examples show it.
    const VARIANTS: Record<string, string> = { tagsInUse: "tag", sidebarButton: "sidebar", stackOfOne: "stack", gameKeyDetails: "key-details" };
    for (const slug of Object.values(VARIANTS)) expect(COMPONENTS().some((each) => each.slug === slug), slug).toBe(true);
    const problems = Object.entries({ actions, inputs, navigation, panes, data, layout: layoutComponents }).flatMap(([file, exports]) =>
      Object.entries(exports)
        .filter(([name, value]) => typeof value === "function" && !/^class\b/.test(String(value)) && !VARIANTS[name])
        .filter(([, value]) => renders.filter((render) => render === value).length !== 1)
        .map(([name]) => `${file}.ts: ${name} isn't the render of exactly one component`),
    );
    expect(problems).toEqual([]);
  });

  it("puts every component's styles in the pages' styles", () => {
    const styles = COMPONENT_STYLES();
    for (const each of COMPONENTS()) expect(styles, each.slug).toContain(hoverOnlyWherePointing(each.styles));
  });

  it("moves a pointed look under hover without breaking a selector: a list splits only at its own commas, past nested :is() and :has()", () => {
    expect(hoverOnlyWherePointing(".a:is(:hover, :has(:focus-visible)) > .b, .c.is-on .b { width: 1px; }")).toBe(".c.is-on .b { width: 1px; }\n@media (hover: hover) { .a:is(:hover, :has(:focus-visible)) > .b { width: 1px; } }");
    // Every rule in the pages' styles closes each bracket it opens, so no broken selector swallows the rules after it.
    const unbalanced = [...COMPONENT_STYLES().replace(/\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'/g, "").matchAll(/([^{}]*)\{/g)].map(([, selector = ""]) => selector.trim()).filter((selector) => selector.split("(").length !== selector.split(")").length);
    expect(unbalanced).toEqual([]);
  });

  it("gives every component a slug of its own", () => {
    const slugs = COMPONENTS().map((each) => each.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(() => component({ name: "Again", slug: "primary-button", group: "actions", summary: "", styles: "", examples: [] })).toThrow(/Two components/);
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
      for (const selector of splitSelectors(selectors)) {
        const subject = subjectOf(selector);
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
      // The glass itself: its slab, the layer it paints its tint and blur on, and pinned glass, which blurs its own box.
      const isTheGlass = /^\.glass(::before|\.pinned)?$/.test(selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim());
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
      // Glass cut by its own corners (--glass-clip, the pane cut tokens the edge rule fits everything in it to).
      if (/^var\(--glass-clip\b/.test(clip)) continue;
      const selector = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim();
      // A frame of an animation: the loader drawing Zaisma's mark stroke by stroke.
      if (/^(from|to|\d+(\.\d+)?%)$/.test(selector)) continue;
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
    for (const { group, subgroup } of GALLERY_PLACES()) {
      for (const [, classes = ""] of (await page(galleryPagePath(group, subgroup))).text.matchAll(/class="([^"]*)"/g)) {
        const list = classes.split(/\s+/);
        if (list.includes("glass")) list.filter((each) => each && each !== "glass").forEach((each) => glassClasses.add(each));
      }
    }
    // Classes that only say a state or a size, shared with things that aren't glass.
    for (const state of ["shut", "is-compact", "is-page", "is-collapsed", "fit", "full", "face"]) glassClasses.delete(state);
    const problems: string[] = [];
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const transition = /(?:^|[;\s])transition:\s*([^;}]+)/.exec(declarations)?.[1]?.trim();
      if (!transition || transition === "none" || transition.startsWith("var(--glass-transition)")) continue;
      for (const selector of splitSelectors(selectors.replace(/\/\*[\s\S]*?\*\//g, ""))) {
        const subject = subjectOf(selector);
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
      for (const [, property = "", value = ""] of declarations.matchAll(/(?:^|[;\s{])((?:row-|column-)?gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*|scroll-padding(?:-[a-z]+)*):\s*([^;}]+)/g)) {
        if (!isSpacing(value) && !NOT_SPACING.has(`${where} | ${property}`)) problems.push(`${where} | ${property}: ${value.trim()}`);
      }
    };
    for (const [, selectors = "", declarations = ""] of (COMPONENT_STYLES() + GALLERY_STYLES).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const where = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      // A material's room is its own (materials.ts, materials.test.ts holds the rest).
      if (!MATERIAL_SELECTORS.has(where.split("\n").pop()!.trim())) checkDeclarations(where, declarations);
    }
    for (const { group, subgroup } of GALLERY_PLACES()) {
      for (const [, style = ""] of (await page(galleryPagePath(group, subgroup))).text.matchAll(/style="([^"]*)"/g)) checkDeclarations(`${group}, style="${style}"`, style);
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
      const where = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim();
      // A material's words are a control's inside, set by its size (materials.ts).
      if (!MATERIAL_SELECTORS.has(where)) checkDeclarations(where, declarations);
    }
    for (const { group, subgroup } of GALLERY_PLACES()) {
      for (const [, style = ""] of (await page(galleryPagePath(group, subgroup))).text.matchAll(/style="([^"]*)"/g)) checkDeclarations(`${group}, style="${style}"`, style);
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
      // Reading text's own links, in the HTML a post or the rules bring, are Links too: the same rule as .link.
      if (decoration && decoration !== "none" && !/:focus|is-focused/.test(selector) && !splitSelectors(selector).every((each) => /^(\.link\b|\.reading :where\(a\b)/.test(each))) problems.push(`${selector}: text-decoration: ${decoration}`);
      for (const each of splitSelectors(selector)) {
        const subject = subjectOf(each);
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
      return gap ? selectors.replace(/\/\*[\s\S]*?\*\//g, "").split(/,(?![^(]*\))/).map((selector) => ({ subject: subjectOf(selector.trim()), gap, isStack })) : [];
    });
    for (const { group, subgroup } of GALLERY_PLACES()) {
      for (const holder of elementTree((await page(galleryPagePath(group, subgroup))).text)) {
        const children = holder.children.filter((child) => child.tag !== "svg" && child.tag !== "template");
        // A control's own parts (a switch's tabs, the row arrows' two slabs, a dropdown's choices, a wheel field's wheels, a file drop's files)
        // are its inside, not controls beside each other.
        if (holder.classes.includes("wheels") || holder.classes.includes("file-drop-list") || holder.classes.includes("shell") || holder.attributes.includes(" data-cut-line") || holder.attributes.includes(' role="menu"') || holder.classes.includes("dropdown-in") || holder.attributes.includes(' role="listbox"')) continue;
        // What a well holds is its own inside (a compact choice list's cards, down its carving like a vertical switch's places), and a
        // fold's row and what it opens to are one thing.
        // A list's rows and a chart's share rows lie flush, one under the next, with no gap between them.
        if (holder.classes.includes("well-body") || holder.tag === "details" || holder.children[0]?.classes.includes("list-row") || holder.classes.includes("share-rows")) continue;
        if (children.length < 2 || !children.every((child) => child.classes.includes("shell") || child.attributes.includes(" data-cut-line"))) continue;
        // Marks and pictures that stay square (tags, a game's media wells and their strip) never slant toward a neighbor.
        if (children.every((child) => child.attributes.includes(" data-cut-square"))) continue;
        const matching = rules.filter(({ subject }) => matchesSubject(holder, subject));
        const isStack = matching.some((rule) => rule.isStack) || /(^|;)\s*(display:\s*grid|flex-direction:\s*column)/.test(holder.style);
        const gaps = [...matching.map(({ gap }) => gap), ...(/(?:^|;)\s*gap:\s*([^;]+)/.exec(holder.style)?.slice(1) ?? [])];
        // Choice cards while they fit side by side: a gap can't be negative, so they overlap by a margin of --gap-control-row-boxes (and
        // stack --gap-control-stack apart once they can't). A row of controls is row()'s, its cells holding them.
        if (!isStack && holder.classes.includes("choice-cards")) continue;
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

  // It renders every gallery page, one after another: more than the default 5s on a busy runner.
  it("builds everything on its pages from the gallery: every piece comes from a component, or is a named exception", async () => {
    // A class on a gallery page is a component's (its styles define it) or the gallery's own scaffolding (GALLERY_ONLY, with why).
    // The gallery may place a component (where it sits and how big its box is) or set the variables it offers, never restyle it.
    // No source draws its own icon, button or pane: icons are the icon set's (or a named brand mark), buttons come from actions.ts,
    // and glass sheets from Glass pane or Tray, or one of the named pieces made of glass (OWN_GLASS).
    const problems: string[] = [];
    const componentCss = COMPONENT_STYLES();
    const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = "", declarations = ""]) => ({ selector: selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim(), declarations }));
    const styledBy = (css: string, name: string) => new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);
    for (const { group, subgroup } of GALLERY_PLACES()) {
      const body = (await page(galleryPagePath(group, subgroup))).text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "");
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
      for (const each of splitSelectors(selector)) {
        const subject = subjectOf(each);
        const classes = [...subject.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
        // The gallery's own element (a class only it styles) is the gallery's to style.
        if (!classes.length || classes.some((name) => GALLERY_ONLY.has(name)) || !classes.some((name) => styledBy(componentCss, name))) continue;
        for (const [, property = ""] of declarations.matchAll(/(?:^|[;\s])([\w-]+)\s*:/g)) if (!PLACING.test(property)) problems.push(`gallery restyles ${each.trim()}: ${property}`);
      }
    }
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const line of source.split("\n")) {
        if (/<svg[\s>]/.test(line) && ![...OWN_SVG.keys()].some((name) => line.includes(name))) problems.push(`${file}: draws an svg of its own: ${line.trim().slice(0, 70)}`);
        // The account button is a component of its own (Navigation): the player's picture as a slab that opens their menu.
        if (/class=\\?"shell/.test(line) && file !== "components/actions.ts" && !line.includes('class="shell me')) problems.push(`${file}: builds a button by hand: ${line.trim().slice(0, 70)}`);
        if (/<[a-z][^>]*\sdata-glass(?=[\s>])/.test(line) && ![...OWN_GLASS.keys()].some((name) => line.includes(name))) problems.push(`${file}: makes glass by hand: ${line.trim().slice(0, 70)}`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  }, 20_000);

  it("names no exception that's gone: every entry in the lists below is still in the code", async () => {
    const problems: string[] = [];
    const css = COMPONENT_STYLES() + GALLERY_STYLES;
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = "", declarations = ""]) => ({ selector: selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim(), declarations }));
    const declared = new Set(rules.flatMap(({ selector, declarations }) => [...declarations.matchAll(/(?:^|[;\s{])([\w-]+)\s*:/g)].map(([, property]) => `${selector} | ${property}`)));
    for (const entry of [...NOT_SPACING, ...NOT_TYPE]) if (!declared.has(entry)) problems.push(`${entry} (NOT_SPACING or NOT_TYPE)`);
    const selectors = new Set(rules.flatMap(({ selector }) => [selector, ...selector.split(",").map((each) => each.trim().replace(/:[a-z-]+(\([^)]*\))?/g, ""))]));
    for (const entry of [...LINK_IN_CONTROL, ...HAND_CUT]) if (!selectors.has(entry)) problems.push(`${entry} (LINK_IN_CONTROL or HAND_CUT)`);
    let pages = "";
    for (const { group, subgroup } of GALLERY_PLACES()) pages += (await page(galleryPagePath(group, subgroup))).text;
    for (const name of [...GALLERY_ONLY, ...UNSTYLED_HOOKS]) if (!new RegExp(`class="[^"]*\\b${name}\\b`).test(pages)) problems.push(`.${name} (GALLERY_ONLY or UNSTYLED_HOOKS)`);
    const source = Object.values(SOURCES).join("\n");
    for (const name of [...OWN_SVG.keys(), ...OWN_GLASS.keys()]) if (!source.includes(name)) problems.push(`${name} (OWN_SVG or OWN_GLASS)`);
    expect(problems).toEqual([]);
  });

  it("opens light or dark from its address, and the other pages' links keep it", async () => {
    for (const { group, subgroup } of GALLERY_PLACES()) {
      const { text } = await page(`${galleryPagePath(group, subgroup)}?theme=dark`);
      expect(text).toContain('<div id="stage" class="stage" data-theme-choice="dark">');
      expect(text).toMatch(/<a class="sidebar-place[^"]*" href="\/design\/panes\/glass\?theme=dark"/);
    }
    // Anything but dark is light: the parameter is closed.
    expect((await page("/design?theme=purple")).text).toContain('<div id="stage" class="stage" data-theme-choice="light">');
  });

  it("is never framed", async () => {
    for (const path of ["/design", "/design/panes/glass"]) expect((await SELF.fetch(`${SITE}${path}`)).headers.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
  });

  it("has a page for each subgroup, nested in the sidebar, and none for anything else", async () => {
    const open = (await page("/design")).text;
    // Only the page you're on is selected; its group is open, never selected itself.
    expect(open).toContain('<button class="sidebar-place sidebar-group flush-row compact quiet" type="button" data-cut-line="8" aria-expanded="true"><svg class="cut-line" aria-hidden="true"><polygon/></svg><span class="sidebar-words">Foundations</span>');
    expect(open).toMatch(/<a class="sidebar-place flush-row compact quiet lights-start" href="\/design" data-cut-line="8" aria-current="page">/);
    expect(open.match(/aria-current="page"/g)?.length).toBe(2);
    expect(open).toContain("<title>Look · Foundations · Design · Zaisma</title>");
    const fields = await page("/design/inputs/fields");
    expect(fields.response.status).toBe(200);
    expect(fields.text).toContain('<button class="sidebar-place sidebar-group flush-row compact quiet" type="button" data-cut-line="8" aria-expanded="true"><svg class="cut-line" aria-hidden="true"><polygon/></svg><span class="sidebar-words">Inputs</span>');
    expect(fields.text).toMatch(/<a class="sidebar-place flush-row compact quiet lights-start" href="\/design\/inputs\/fields" data-cut-line="8" aria-current="page">.*?<span class="sidebar-words">Fields<\/span>/);
    expect(fields.text).toContain('<h1 class="group-name">Fields · Inputs</h1>');
    expect(fields.text).toContain('id="cut-field"');
    expect(fields.text).not.toContain('id="slider"');
    // Every group is a folder of its pages; only the one holding this page starts open.
    expect(fields.text).toContain('<button class="sidebar-place sidebar-group flush-row compact quiet" type="button" data-cut-line="8" aria-expanded="false"><svg class="cut-line" aria-hidden="true"><polygon/></svg><span class="sidebar-words">Actions</span>');
    expect(fields.text).toContain('href="/design/actions/words"');
    expect(fields.text).toMatch(/<button [^>]*data-sidebar-button[^>]*aria-controls="gallery-places" aria-expanded="true"/);
    expect((await page("/design/layout")).response.status).toBe(200);
    for (const [path, location] of [["/design/inputs", "/design/inputs/fields"], ["/design/foundations", "/design"], ["/design/foundations/look", "/design"], ["/design/panes?theme=dark", "/design/panes/materials?theme=dark"]] as const) {
      const response = await SELF.fetch(`${SITE}${path}`, { redirect: "manual" });
      expect(response.status, path).toBe(308);
      expect(response.headers.get("location"), path).toBe(location);
    }
    for (const path of ["/design/inputs/no-such", "/design/no-such-group", "/design/layout/stack", "/design/inputs/fields/more", "/design/frame/primary-button"]) expect((await page(path)).response.status, path).toBe(404);
    // A link to a component (/design#primary-button) goes on to the page that shows it.
    const pages = JSON.parse(/<script type="application\/json" id="design-pages">([^<]*)<\/script>/.exec(open)![1]!) as Record<string, string>;
    for (const each of COMPONENTS()) expect(pages[each.slug], each.slug).toBe(galleryPagePath(each.group, each.subgroup));
  });

});

describe("components", () => {
  it("put a page's settings on it, taking only a #rrggbb color as the glass's hue", () => {
    expect(pageSettingsAttributes({ theme: "dark", glass: { hueColor: "#2E9E6B" } }).html).toBe(' data-theme-choice="dark" style="--glass-hue:#2e9e6b"');
    expect(pageSettingsAttributes({}).html).toBe("");
    for (const hueColor of ["red", "#2E9E6B;background:url(x)", "#2E9E6", '"><script>']) expect(pageSettingsAttributes({ glass: { hueColor } }).html).toBe("");
  });

  it("make the runner a link with an address and a button without one", () => {
    expect(actions.primaryButton("Play", { href: "/g/x" }).html).toMatch(/<a class="shell run-wrap" href="\/g\/x">/);
    expect(actions.primaryButton("Play").html).toMatch(/<button class="shell run-wrap" type="submit">/);
  });

  it("give a password field its Show toggle, and an error its message", () => {
    expect(inputs.cutField({ name: "password", label: "Password", type: "password", icon: "lock" }).html).toContain(actions.toggleButton("Show", { type: "button", isSmall: true, isPressed: false, controls: "field-password" }).html);
    const marked = inputs.cutField({ name: "username", label: "Username", type: "text", icon: "person", error: "Use letters only." }).html;
    expect(marked).toContain('aria-invalid="true" aria-describedby="field-username-error"');
    expect(marked).toContain('<p class="field-error words-margin" id="field-username-error">Use letters only.</p>');
  });

  it("give a delete's confirm step a secondary button tinted red and no runner", () => {
    const markup = panes.confirmSheet({ id: "delete-ashen-crown", title: "Delete Ashen Crown?", action: "/dashboard/games/ashen-crown/delete", confirmLabel: "Delete Ashen Crown", text: "It's gone for good.", isDelete: true }).html;
    // The sheet is one form, posting the delete; its buttons sit at its foot.
    expect(markup).toContain('<form class="sheet-in scrolls" method="post" action="/dashboard/games/ashen-crown/delete">');
    const confirmForm = markup.slice(markup.indexOf('<div class="pane-foot"'), markup.indexOf("</form>"));
    expect(confirmForm).toMatch(/class="[^"]*\bcut-btn\b[^"]*"[^>]*data-tint="red"/);
    expect(confirmForm).not.toMatch(/class="[^"]*\brun\b/);
    // Cancel closes the sheet without sending the delete.
    expect(confirmForm).toContain('formmethod="dialog" formnovalidate');
    // Any other confirm's action is the runner, never red.
    expect(panes.confirmSheet({ id: "sign-out", title: "Sign out everywhere?", action: "/account/sign-out-everywhere", confirmLabel: "Sign out everywhere", text: "Every device is signed out." }).html).not.toContain('data-tint="red"');
  });

  it("make a row's switch a checkbox that posts with its form, with no script, the whole row its label", () => {
    const switchRow = (isOn: boolean) => data.listRows({ whenEmpty: NO_EMPTY_NOTE, rows: [{ title: "Cloud saves", switch: { name: "cloud_saves", isOn } }] }).html;
    expect(switchRow(true)).toContain('<input class="toggle-input" type="checkbox" role="switch" id="switch-cloud_saves" name="cloud_saves" value="on" checked>');
    expect(switchRow(true)).toContain('<label class="list-row flush-row toggle" for="switch-cloud_saves"');
    expect(switchRow(false)).not.toContain(" checked");
  });

  it("announce a problem notice as an alert and a done one as a status", () => {
    expect(panes.notice({ text: "Couldn't save", tone: "problem" }).html).toContain('role="alert"');
    expect(panes.notice({ text: "Saved", tone: "done" }).html).toContain('role="status"');
  });

  it("count a long field's characters only from 80% of its limit", () => {
    expect(inputs.longField({ name: "patch_notes", label: "What's new", rowCount: 3, maximumCharacterCount: 100, text: "x".repeat(79) }).html).toContain('<p class="long-count words-margin" id="field-patch_notes-count" hidden>79 of 100</p>');
    expect(inputs.longField({ name: "patch_notes", label: "What's new", rowCount: 3, maximumCharacterCount: 100, text: "x".repeat(80) }).html).toContain('<p class="long-count words-margin" id="field-patch_notes-count">80 of 100</p>');
  });

  it("head a table's columns for screen readers and line its numbers up on the right", () => {
    const markup = data.table({ whenEmpty: data.stateNote({ stateKind: "empty", title: "No rows yet", text: "Rows show here as they come." }), caption: "Versions", columns: [{ label: "Version" }, { label: "Files", isNumeric: true }], rows: [["Version 14", "312"]] }).html;
    expect(markup).toContain('<p class="table-caption words-margin" id="table-versions-caption">Versions</p>');
    expect(markup).toContain('aria-labelledby="table-versions-caption"');
    expect(markup).toContain('<th scope="col">Version</th><th scope="col" class="num">Files</th>');
    expect(markup).toContain('<td>Version 14</td><td class="num">312</td>');
    // A first column that names the rows is each row's head.
    expect(data.table({ whenEmpty: data.stateNote({ stateKind: "empty", title: "No rows yet", text: "Rows show here as they come." }), caption: "Versions", hasRowHeads: true, columns: [{ label: "Version" }, { label: "Files", isNumeric: true }], rows: [["Version 14", "312"]] }).html).toContain('<th scope="row">Version 14</th><td class="num">312</td>');
  });

  it("give a chart's numbers to screen readers as a table of the same values", () => {
    const markup = data.chart({ label: "Plays a day", points: [{ label: "Oct 20", amountNumber: 1205 }, { label: "Oct 21", amountNumber: 1712.5 }], unit: "plays" }).html;
    expect(markup).toContain('<div class="chart-body" aria-hidden="true">');
    expect(markup).toContain('<div class="sr"><table><caption>Plays a day</caption>');
    expect(markup).toContain('<tr><th scope="row">Oct 20</th><td>1,205 plays</td></tr><tr><th scope="row">Oct 21</th><td>1,712.5 plays</td></tr>');
  });

  it("send a date and time as ISO 8601 with its offset", () => {
    const markup = inputs.wheelField({ name: "publish_at", label: "Go live", wheelKind: "date-time", pickedValue: "2026-10-23T15:30+02:00" }).html;
    const sent = /<input type="hidden" name="publish_at" value="([^"]*)"/.exec(markup)?.[1];
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(inputs.WHEEL_SCRIPT).toContain('sign + two(Math.floor(whole / 60)) + ":" + two(whole % 60)');
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
    // The box that scrolls round it, never itself: a table capped in height scrolls inside itself, and sits where it sits.
    expect(glassScriptSource).toContain('el.parentElement && el.parentElement.closest(".own-scroll")');
    // The scroller's offsets are read with the rest of a pass's measures, before anything is drawn (scrollOf).
    expect(glassScriptSource).toContain("top: p.top - scrolled.scrollTop");
    expect(glassScriptSource).toContain("bottom: p.bottom + scrolled.scrollHeight - scrolled.clientHeight - scrolled.scrollTop");
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
    expect(BACKDROP_SCRIPT).toContain('window.zaismaCorners(el, "pane")');
    expect(SHADER_HEAD).toContain(`uniform vec4 iGlassPanes[${MOST_GLASS_PANE_COUNT}];`);
    expect(GLASS_LIGHT_PASS).toContain(`uniform vec4 zaismaPaneCuts[${MOST_GLASS_PANE_COUNT}];`);
    // Every shader keeps its own mainImage: the pass calls it once a pixel.
    expect(GLASS_LIGHT_PASS.match(/mainImage\(/g)?.length).toBe(1);
  });

  it("draw every backdrop on a page in one WebGL2 context, as a game's shader is drawn, sharpened up from fewer pixels", () => {
    // A browser keeps only about 16 contexts and takes the oldest away past that, so many backdrops (the gallery) share one: the script
    // asks for a WebGL context in one place, made once and kept, and copies each frame into each canvas's own 2D picture.
    expect(BACKDROP_SCRIPT.match(/getContext\("webgl/g)?.length).toBe(1);
    expect(BACKDROP_SCRIPT).toContain('if (shared) return shared.isLost ? null : shared;');
    expect(BACKDROP_SCRIPT).toContain('board.getContext("webgl2"');
    expect(BACKDROP_SCRIPT).toContain('canvas.getContext("2d", { alpha: false })');
    // WebGL2's GLSL, with the same head and glass pass as a game's shader, compiled in the background where it can be.
    expect(BACKDROP_SCRIPT).toContain(JSON.stringify(SHADER_HEAD));
    expect(BACKDROP_SCRIPT).toContain(JSON.stringify(SHADER_UPSCALE_SOURCE));
    expect(BACKDROP_SCRIPT).toContain("KHR_parallel_shader_compile");
    expect(BACKDROP_SCRIPT).not.toContain("gl_FragColor");
    // Fewer frames when nobody's touched the page for a while, and a game's frame is told, since it never sees the page's input.
    expect(BACKDROP_SCRIPT).toContain(`IDLE_AFTER_MS = ${SHADER_LIMITS.runtimeIdleTimeoutSec * 1000}`);
    // It's told no glass: a frame can't redraw a bend in the frame the page scrolls in, so it bends nothing under glass, and a scroll tells it nothing.
    expect(BACKDROP_SCRIPT).toContain("postMessage({ panes: [], isIdle: isIdle }");
    expect(BACKDROP_SCRIPT).not.toContain("isScrolling");
  });

  it("open the Developer and Forum tabs only on a developer page", () => {
    const account = { username: "emma_r", pictureMarkup: html`` };
    const onDashboard = navigation.header({ current: "developer", isOnDeveloperPage: true, account }).html;
    expect(onDashboard).toMatch(/<a class="flush-row quiet foldable" data-lights href="\/dashboard" aria-current="page">.*?Developer/);
    expect(onDashboard).toMatch(/<a class="flush-row quiet foldable" data-lights href="\/forum">.*?Forum/);
    const atHome = navigation.header({ current: "home", isOnDeveloperPage: false, account }).html;
    expect(atHome).toMatch(/<a class="flush-row quiet foldable folded" data-lights href="\/dashboard" tabindex="-1" aria-hidden="true">.*?Developer/);
    expect(atHome).toMatch(/<a class="flush-row quiet foldable folded" data-lights href="\/forum" tabindex="-1" aria-hidden="true">.*?Forum/);
  });
});

// What isn't spacing between things, so it keeps a number of its own (docs/DESIGN.md, Spacing). Named one by one, with why,
// so a new one is a deliberate choice.
const HAND_CUT = new Set<string>([
  // A pane: cut by its own corners (24 and 20, the header, the footer and the gallery's bar 20 and 14), which the edge rule fits all inside it to.
  ".top", ".foot", ".header-frame", ".backdrop-frame", ".city-frame", ".glass-strip", ".glass-play",
  // A shape for the glass demo to blur: what's behind the glass, not part of Zaisma.
  ".glass-play .cut",
  // A toggle's front surface: swept down from its slab's own cut (TOGGLE_SCRIPT reads the edge rule's shape), so it keeps the rule's corners.
  ".toggle-front",
  // The scroll rail's thumb and the labels its marks open.
  ".rail-thumb", ".rail.sideways .rail-thumb",
  // Tags: slanted at both ends, a mark on what it labels rather than a thing of its own.
  ".tag",
  // The same line along a tertiary button's foot, along a list row's foot and across a step flow's top.
  ".tertiary-line", ".step-mark",
  // A tray's step: its lip's light stops inside the sheet's rim, before its bevel.
  ".tray-group > .glass.tray-head::after",
  // The gallery's stand-in game screen, cut as a pane is.
  ".game-stand-in",
]);

// The gallery's own scaffolding, styled only by GALLERY_STYLES: what holds the components, never a piece of Zaisma's UI itself.
const GALLERY_ONLY = new Set<string>([
  // The page: its body, the stage that carries its settings, the bar, its title and its buttons, the layout and the main column.
  "gallery", "stage", "gallery-bar", "gallery-title", "gallery-start", "gallery-buttons", "gallery-layout", "gallery-main", "group-name",
  // A section (a Tray) with its name and summary, and the grid of labeled examples on it.
  "component-section", "component-name", "component-summary", "examples", "example", "wide", "example-stage", "example-name",
  // Frames an example is shown in: a header over a stand-in page that scrolls under it, a dropdown hanging from its button, a short box
  // for the rail, a cover at a card's width, and the two Spacing examples that mark a pane's own padding and gap.
  "header-frame", "tall", "is-fitted", "header-scroll", "stand-in-page", "stand-in-row", "dropdown-frame", "rail-box", "rail-side-box", "rail-example-part", "cover-sample",
  // A menu's Try it, a backdrop that holds menus and banners side by side, a banner's frame on it, and a stand-in game screen behind a card.
  "dropdown-try", "holds-menus", "banner-frame", "game-stand-in",
]);

// The only svgs drawn in source, each with why: everything else is an icon from the set.
const OWN_SVG = new Map<string, string>([
  ["const stroke = ", "the icon set's line icons"],
  ['"arrow-back"', "the icon set's filled arrows"],
  ['"arrow-on"', "the icon set's filled arrows"],
  ['"arrow-first"', "the icon set's filled arrows"],
  ['"arrow-last"', "the icon set's filled arrows"],
  ["play: '<svg", "the icon set's play triangle"],
  ["4527 3300", "Zaisma's flat mark (MARK_FLAT)"],
  ['class="cut-line"', "the edge rule's outline (CUT_LINE)"],
  ['class="edge"', "glass's drawn rim (EDGE)"],
  ['<svg class="chart-drawing"', "a chart's own line or bars, drawn from its numbers"],
  ['<svg class="chart-drawing chart-area-drawing"', "the shade under a chart's line"],
  ['fill="#FFC107"', "Google's mark, as Google asks it to be shown"],
  ["const cardBrandImage = ", "the card brands' marks on a card row (Visa, Mastercard and the rest), as their owners draw them"],
  ['class="one-color"', "Discord's mark, as Discord asks it to be shown"],
  ['class="pay-mark"', "Apple Pay's mark beside its words, as Apple draws it"],
  ['data-shown-when="off"', "a toggle's two icons, each shown in its own state (the icon set's, marked)"],
  ["cursor.innerHTML", "the gallery's loops' own pointer"],
  ["data-glass-play", "the Glass foundation's demo window's resize grip"],
  ["const STAND_IN_GAME_ICON", "the gallery's stand-in game icon, a picture as a game's own icon would be"],
  ["data-shown-at=", "a video's sound button's three icons, each shown at its own level (the icon set's, marked)"],
]);

// The only places glass is made by hand, each with why: every other sheet is a Glass pane or a Tray.
const OWN_GLASS = new Map<string, string>([
  ['class="glass glass-pane', "Glass pane itself"],
  ['class="glass tray-group ', "Tray itself"],
  ['class="glass cut-sample', "Cut shapes' own samples: a pane's, the header's and a menu's cut, on glass"],
  ['class="frame ${pictureSize} glass', "a picture's frame"],
  ['class="sheet glass', "a sheet"],
  ['class="floating-pane ', "a floating pane: a dropdown, a select field's list, a search's suggestions"],
  ['class="notice glass', "a notice"],
  ['class="foot glass glass-bar"', "the footer"],
  ['class="banner glass"', "a banner"],
  ['class="top bar-layout glass', "the header"],
  ['class="playing-bar glass', "the bar beside a running game"],
  ['class="playing-card glass', "a card over a running game's corner"],
  ['class="gallery-bar glass', "the gallery's bar"],
  ['class="chart-tip glass', "a chart's number where you point, on a small piece of floating glass"],
  ['class="video-controls glass', "a video's controls, a bar of smoked glass along its foot"],
  ['class="sidebar glass glass-pane compact pinned"', "Sidebar itself"],
  ['const stillSidebar = ', "Sidebar's still copy on its gallery page"],
  ['class="sidebar-example-phone glass"', "Sidebar's still phone screen, the sheet over its page"],
  ['data-glass-play', "the Glass foundation's own demo: a window to drag over drifting shapes"],
  ["glassOpacityPct", "the Glass foundation's own demo: three strengths side by side"],
  ["([name, thickness, use]) =>", "the Materials page's own demo: each thickness of glass side by side"],
  ['class="backdrop-frame"', "the Backdrop foundation's own demo"],
  ['class="backdrop-frame is-tall', "the Glass foundation's own demos of the light glass bends and the pointer's light"],
]);

const LINK_IN_CONTROL = new Set<string>([
  // A tab: the header's tabs and a switch's.
  ".tab-switch > a",
  ".tab-switch.small > a", ".tab-switch.vertical > a",
]);

const NOT_TYPE = new Set<string>([
  // A code field's code: inside a control, in code's letters, a size up from code in words so a key reads easily.
  ".copy-field.is-code .copy-field-text | font",
  // A typed password's dots: a face whose dots are round and big enough to count, a size up.
  '.field input[type="password"]:not(:placeholder-shown) | font-family', '.field input[type="password"]:not(:placeholder-shown) | font-size',
  // A search's typed finish, shown in the field's own words.
  ".find-finish | font",
  "@font-face | font-family",
  // A control's inside: its words, set by each control's size.
  ".run.big | font-size", ".run | font-size",
  ".field input | font", '.find input[type="search"] | font', ".wheel-button | font",
  '.wheel [role="option"] | font', ".tab-switch > a, .tab-switch > button | font",
  ".tab-switch.small > a, .tab-switch.small > button | font-size", ".top .end .run | font-size",
  // A picture's initials, sized to the picture.
  ":is(.frame, .slab.holds-art) .av | font", ".frame.xs .av | font-size", ".frame.xs .av::first-letter | font-size",
  // A PIN's one field, unseen over its marks: 16px, so a phone doesn't zoom in as it's typed in.
  ".pin-input | font-size",
  ".field.long textarea | font", ".select-button | font",
  // On a phone what's typed is 16px, the least that keeps a phone from zooming in.
  '.field input, .find input[type="search"], .find-finish, .wheel-button | font-size',
  // The +N at the back of a row of pictures, sized to the pictures.
  ".frame.more | font",
]);

const NOT_SPACING = new Set<string>([
  // A pane that starts low on a phone: the room above it is the viewport left over, not spacing.
  ".glass-pane.is-started-low | margin-top",
  // A pane on the city, on a phone: the city's room above it until CITY_SCRIPT measures how low it can start.
  ".city-page .city-pane | margin",
  // A table's cells: room round a cell's words, set by the table's size.
  ".data-table thead th | padding", ".data-table td, .data-table tbody th | padding", ".data-table.compact thead th | padding", ".data-table.compact td, .data-table.compact tbody th | padding",
  // A chart's last point: centered on its spot. A meter's track: its fill's inset, like a well's.
  ".chart-dot | margin",
  // A chart's room for the dots at its ends.
  ".chart-inner | padding",
  // A chart's number where you point: a small label's own room round its words.
  ".chart-tip.glass | padding",
  // A key detail's label close over its value, and friends' pictures as tall as the value's words.
  ".key-detail | gap", ".key-detail-value > .picture-row | margin-block",
  // A quiet share row: its words close over their hairline groove.
  ".share-rows.is-quiet li | row-gap",
  // A table's header slab and fades, sticky in one grid cell: moved past the row heads by a margin, a place rather than spacing.
  ".table-scroll > .table-frost.is-start | margin-left", ".table-scroll > .table-frost.is-end | margin-left", ".table-scroll:has(> .table-corner-slab) > .table-head-slab | margin-left",
  // A masked link's words: room round them for their blur, taken back by a margin so they sit where they would.
  ".copy-field.is-masked:not(.is-code) .copy-field-text | padding", ".copy-field.is-masked:not(.is-code) .copy-field-text | margin",
  // A search's list: its head's words lined up with the field's, and a game's two lines, closer than any gap.
".find-game-words | gap",
  // A file on its way: room at its row's foot for the Groove along it.
  ".file-drop-row.is-sending | padding-bottom",
  // A color square's knob: centered on its point.
  ".color-knob | margin",
  // A QR code's tile: white round the code, so a camera finds its edge on any glass.
  ".qr-tile | padding",
  // A control's inside: its words and icon to its own edge, set by each control size.
  ".tab-switch.vertical > a, .tab-switch.vertical > button | gap",".run | gap",".run.big | gap",
  ".cut-btn > .face | gap",
".wheel-button | gap",
".wheel-chev | margin-right",
  ".logo | padding",
".top .end .run | gap", ".tag | padding", ".tag.count | padding",
".select-option | gap",
".choice-well .choice-words | gap",
  // picked choice up with the field's words, and its choices are a little shorter there.
  ".floating-pane | padding", ".select-options | gap", ".floating-pane.placed-over.in-place | margin-top",
  // A control's own parts: a well's inset round its slab, the birthday's wheels, and a list of places, one control its slab glides along.
".wheels | gap",
  ".floating-pane.dropdown | gap", ".dropdown-in | gap",
  // Room to scroll, or for a scrollbar or a page's rail.
  ".wheel | padding", "html | scroll-padding-top", ".gallery-layout | padding-right",
  // Where a small thing sits on what it marks: a rail's tick.
  ".rail-mark | margin-top", ".rail.sideways .rail-mark | margin",
  // Lines a box's or a card's icon up with the first line of its words.
".choice-card > .ico | margin-top",
  // Lines words beside controls up with the controls' center line: half the tallest control's height less a line's, above the first line and below the last.
  ".layout-row[data-control-height]:not(.is-wrapped) > .row-cell.is-words > :first-child | padding-top", ".layout-row[data-control-height]:not(.is-wrapped) > .row-cell.is-words > :last-child | padding-bottom",
  ".pane-head[data-control-height] > .pane-head-words > :first-child | padding-top",
  ".pane-foot[data-control-height] > .pane-foot-start.is-words > :first-child | padding-top", ".pane-foot[data-control-height] > .pane-foot-start.is-words > :last-child | padding-bottom",
  // A step's name under its line: the words' gap, or more where the pane's margin over it is more (less the line's own 4px).
  ".step-line | row-gap", ".step-line > li | gap",
  // A tag's icon and its words: closer than any gap, inside a tag's own small carving.
  ".tag:has(> .ico) | gap",
  // A word of code in a line of reading: its own room round it in the well, smaller than any gap.
  ".reading :not(pre) > code | padding",
  // A header example's stand-in page: room for the header over it, and to scroll the header compact.
  ".stand-in-page | padding", ".stand-in-page | padding-top",
  // Choice cards side by side, overlapping by the row's slant, wrap one under another once each can't have a card's least width.
  ".cards-row > :not(:last-child) | margin-inline-end",
  // Google's G on smoked glass sits on its white disc, a little larger than it, as Google asks.
  ".way-mark.way-google | padding", ".way-mark.way-google | margin",
  // A search's list: its head's words lined up with the field's.
  ".find-head | margin",
  // A select's choice lines its words up with the field's, past the field's icon.
  ".select-list.after-icon .select-option > span:first-of-type | margin-inline-start",
  // Lines a box's words up with the first line of its words.
  ".check-words | margin-top",
  // A slider's thumb: centered on its groove, its reach a touch target's.
  ".slider-thumb | margin-block",
  // A menu's rule between groups: a hair's room either side, inside a control's own inset.
  ".floating-pane.dropdown .divider | margin-block",
  // Tags: a small carving's own room round its words, and its icon close beside them.
  ".cover-mark.at-device .tag | padding-inline", ".tag.is-removable | gap", ".tag.is-removable | padding-inline",
  // A notice's icon: centered on its first line of words, as far from its start as from its top.
  ".notice > .ico | margin-block", ".notice > .ico | margin-inline-start",
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

describe("pages", () => {
  // "A page is only gallery components, layout included. It has no styles of its own" (docs/DECISIONS.md), on every state the layout
  // check measures (components/checked-pages.ts) that a plain visit shows: states seen signed in, on a developer's site or after a form are
  // checked where their tests render them (test/site/mcp-sign-in.test.ts, test/site/accounts.test.ts), and every one is measured in Chrome
  // by npm run layout:check (scripts/layout-check.mjs).
  // One live, listed game, so the Browse states that need a game to show (a genre, multiplayer, a search for "farm") are those states here too.
  beforeAll(async () => {
    await createAccount(env.DB, { id: "design-dev", username: "Field_Works", ageBand: "18+" });
    const owner = await personOwner(env.DB, "design-dev");
    const game = await createGame(env.DB, { slug: "design-farm", title: "Farm Lords", description: "About Farm Lords.", ownerId: owner.id, visibility: "listed" });
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', '', ?, 0)").bind("v-design-farm", game.id, "games/design-farm/v1", Date.now()).run();
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ?, genres = 'strategy', play_modes = ? WHERE id = ?")
      .bind("v-design-farm", '[{"mode":"online","minimum_player_count":2,"maximum_player_count":8,"play_style":"together"}]', game.id)
      .run();
  });
  // A step through Cloudflare's bot check or a sign-in provider is taken only in Chrome, where the preview's stand-ins answer it;
  // accounts.test.ts renders those answers.
  const needsStandIns = (each: (typeof CHECKED_PAGES)[number]) =>
    (each.stepsToTake ?? []).some((step) => ("fieldValues" in step ? "turnstile_token" in step.fieldValues : step.path.startsWith("/signin/with/")));
  // A game's pages show the preview's test games (scripts/preview), which this test doesn't make; npm run layout:check measures them there.
  const needsPreviewGames = (each: (typeof CHECKED_PAGES)[number]) => each.path.startsWith("/g/") || each.path.startsWith("/t/") || each.path.startsWith("/buy/");
  const PUBLIC_STATES = CHECKED_PAGES.filter((each) => !each.account && !each.isOnSignInSite && !each.isGallery && !needsStandIns(each) && !needsPreviewGames(each));
  const PUBLIC_PAGES = [...new Set(PUBLIC_STATES.filter((each) => !each.stepsToTake).map((each) => each.path))];

  it("are only gallery components in every state a form shows too, and each says the state it's listed as", async () => {
    for (const state of PUBLIC_STATES) {
      const text = state.stepsToTake ? await pageAfterSteps(state.path, state.stepsToTake) : (await page(state.path)).text;
      if (text === null) continue;
      expect(text.match(/<meta name="checked-page" content="([^"]*)">/)?.[1]?.replaceAll("&#39;", "'"), state.name).toBe(state.stateBeforeSetUp ?? state.name);
      expect(pageProblems(text), state.name).toEqual([]);
    }
  });

  it("size every picture's box before it loads, on the pages and the gallery's, so measuring with pictures blocked measures what loads", async () => {
    const galleryPaths = [...new Set(COMPONENTS().map((each) => galleryPagePath(each.group, each.subgroup)))];
    const problems: string[] = [];
    for (const path of [...PUBLIC_PAGES, ...galleryPaths]) for (const problem of await pictureBoxProblems((await page(path)).text)) problems.push(`${path}: ${problem}`);
    expect(problems).toEqual([]);
  });

  it("make no stylesheet of their own: the only sheets are the site's and the gallery's", async () => {
    for (const path of PUBLIC_PAGES) expect((await page(path)).response.status, path).toBeLessThan(500);
    expect(pageStyles().map((style) => style.name).sort()).toEqual([...PAGE_SHEETS, ...STEEL_PAGE_SHEETS].sort());
  });

  it("are only gallery components: no style, class or stylesheet of their own, and no component's insides", async () => {
    for (const path of PUBLIC_PAGES) expect(pageProblems((await page(path)).text), path).toEqual([]);
  });

  it("carry the rules their first paint needs, and name the cached stylesheet and the components' script for after it", async () => {
    for (const path of ["/", "/design/example"]) {
      const { response, text } = await page(path);
      expect(response.status, path).toBe(200);
      expect(text, path).toMatch(/<style data-first-paint>[\s\S]{1000,}<\/style>/);
      expect(text, path).toMatch(/<link rel="preload" as="style" href="\/css\/site\.[0-9a-f]{16}\.css" fetchpriority="low" data-site-style>/);
      expect(text, path).toMatch(/<link rel="preload" as="script" href="\/js\/components\.[0-9a-f]{16}\.js" fetchpriority="low" data-page-script>/);
      // Only the rules its markup can match: never the whole sheet, nor the gallery's own.
      expect(text, path).not.toContain(".gallery-main");
    }
    // The gallery is a tool, and links its files, holding its first paint for them.
    for (const path of ["/design", "/design/actions/buttons"]) {
      const { text } = await page(path);
      expect(text, path).toMatch(/<link rel="stylesheet" href="\/css\/design\.[0-9a-f]{16}\.css">/);
      expect(text, path).toMatch(/<script src="\/js\/components\.[0-9a-f]{16}\.js"/);
    }
  });

  it("are served their sheet from /css/<name>.<hash>.css named for its contents, cached for good; an older address gets the current one uncached", async () => {
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

  it("fail the rule on a style, a class or a sheet of their own, and on a component's insides", () => {
    expect(pageProblems('<div class="glass-pane" style="width:390px"><p class="game-note">Hi</p><div class="control-row"></div></div><style>.x{}</style>')).toEqual([
      "writes a <style> of its own",
      'style="width:390px" sets width:390px, which no component offers',
      ".game-note comes from no component",
      ".control-row comes from no component",
    ]);
  });

  // The game page as the design test's own game shows it, and the gallery's pages (Screens is only on a local preview), besides the
  // states above: the rules below hold on each.
  const STRUCTURE_PATHS = ["/g/design-farm", ...CHECKED_PAGES.filter((each) => each.isGallery && !each.path.startsWith("/design/screens")).map((each) => each.path)];

  it("keep the rules their markup can't break unseen: one title, headings in order, no capitals, no token's name, few equal choices, fields in groups, one runner", async () => {
    for (const state of PUBLIC_STATES) {
      const text = state.stepsToTake ? await pageAfterSteps(state.path, state.stepsToTake) : (await page(state.path)).text;
      if (text !== null) expect(await pageStructureProblems(text), state.name).toEqual([]);
    }
    for (const path of STRUCTURE_PATHS) {
      const { response, text } = await page(path);
      expect(response.status, path).toBe(200);
      expect(await pageStructureProblems(text), path).toEqual([]);
    }
  });

  /** Runs with a session for the design test's developer, as Supabase signs one (auth.ts reads its keys from Supabase's address). */
  async function signedInAsDesignDev(run: (cookie: string) => Promise<void>) {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href === "https://supabase.test/auth/v1/.well-known/jwks.json") return Response.json({ keys: [{ ...publicKey, kid: "design-test-key", alg: "ES256" }] });
      return realFetch(input, init);
    });
    const encode = (given: ArrayBuffer | string) => btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const nowSec = Math.floor(Date.now() / 1000);
    const head = `${encode(JSON.stringify({ alg: "ES256", kid: "design-test-key", typ: "JWT" }))}.${encode(JSON.stringify({ sub: "design-dev", email: "", aud: "authenticated", iss: "https://supabase.test/auth/v1", exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }))}`;
    const cookie = `__Host-zaisma=${head}.${encode(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(head)))}~r-design-dev`;
    try {
      await run(cookie);
    } finally {
      vi.unstubAllGlobals();
    }
  }
  // The signed-in states a plain visit shows, besides the game pages the preview's test games show.
  const SIGNED_IN_STATES = CHECKED_PAGES.filter((each) => each.account && !each.isGallery && !each.isOnSignInSite && !each.setUp && !each.stepsToTake && !each.shownStateName && !needsPreviewGames(each));

  it("list what depends on who's looking as each stress account too: a signed-in page with a list has its long, empty and full states", async () => {
    await signedInAsDesignDev(async (cookie) => {
      const signedIn = SIGNED_IN_STATES;
      expect(signedIn.length).toBeGreaterThan(2);
      for (const state of signedIn) {
        const text = await (await SELF.fetch(`${SITE}${state.path}`, { headers: { cookie } })).text();
        const said = text.match(/<meta name="checked-page" content="([^"]*)">/)?.[1]?.replaceAll("&#39;", "'");
        // A page that sends this account on elsewhere isn't the state: its list, if it has one, is read where it shows.
        if (said !== state.name) continue;
        const main = text.slice(text.indexOf("<main"), text.lastIndexOf("</main>"));
        if (!main.includes('class="when-empty"')) continue;
        const missing = STRESS_ACCOUNTS.map((stress) => `${stressBaseName(state.name)}, ${stress.nameEnding}`).filter((name) => !CHECKED_PAGES.some((each) => each.name === name));
        expect(missing, `${state.name} lists what depends on who's looking: CHECKED_PAGES needs these (checked-pages.ts, STRESS_ACCOUNTS)`).toEqual([]);
      }
    });
  });

  // Every public word is for one reader (docs/DESIGN.md, Voice): what a person reads on a page keeps the word rules, and the legal pages are
  // in the formal register too. A developer's or player's own words are marked data-words="theirs" and left out.
  const registerOf = (path: string) => (path.startsWith("/legal/") ? "legal" : "page");

  it("keep Zaisma's words in every state a plain visit shows: no \"we\", \"!\", filler, marketing words or names from the code, and no contractions on legal pages", async () => {
    const problems: string[] = [];
    for (const state of PUBLIC_STATES) {
      const text = state.stepsToTake ? await pageAfterSteps(state.path, state.stepsToTake) : (await page(state.path)).text;
      if (text !== null) problems.push(...pageWordProblems(text, registerOf(state.path)).map((problem) => `${state.name}: ${problem}`));
    }
    expect(problems).toEqual([]);
  });

  it("keep Zaisma's words in every signed-in state a plain visit shows", async () => {
    const problems: string[] = [];
    await signedInAsDesignDev(async (cookie) => {
      for (const state of SIGNED_IN_STATES) {
        const text = await (await SELF.fetch(`${SITE}${state.path}`, { headers: { cookie } })).text();
        problems.push(...pageWordProblems(text, registerOf(state.path)).map((problem) => `${state.name}: ${problem}`));
      }
    });
    expect(problems).toEqual([]);
  });

  it("read a page's words without code, attributes or their own words", () => {
    const markup = '<p title="our title">Play <code>update_game</code> now &amp; later</p><script>let we = 1</script><h2 data-words="theirs">We <b>love</b> it!</h2><p>Done</p>';
    expect(pageWords(markup)).toBe("Play now & later Done");
    expect(pageWordProblems("<p>We're sorry! Just call update_game.</p>", "page")).toEqual(['Zaisma, never "we": We', 'No "!"', "No filler: Just", "No names from the code: update_game"]);
    expect(pageWordProblems("<p>Zaisma doesn't keep it.</p>", "legal")).toEqual(["No contractions on legal pages: n't"]);
    expect(pageWordProblems("<p>Zaisma does not keep it.</p>", "legal")).toEqual([]);
  });
});

describe("page structure", () => {
  // Each rule a page's markup can't break unseen (page-rules.ts, pageStructureProblems): a page made to break it, named by the rule and
  // what breaks it, and the same page made right, which passes.
  const onPage = (body: string) => `<!doctype html><html><body><header class="top">${actions.primaryButton("Sign in").html}</header><main>${body}</main></body></html>`;
  // A pane's body built by hand past the types, as a page could still forge one: these pages are the problems the structure check must catch.
  const paneOf = (body: string) => glassPane({ paneWidth: "full", body: raw(body) as unknown as layoutComponents.LayoutMarkup }).html;
  const problemsOn = async (body: string) => pageStructureProblems(onPage(body));

  it("finds a second title and a heading that skips a level", async () => {
    expect(await problemsOn(paneOf("<h1>First title</h1><h1>Second title</h1><h4>Skipped a level</h4>"))).toEqual([
      'more than one title: h1 "Second title", a second h1 after h1 "First title"',
      'headings out of order: h4 "Skipped a level", an h4 after an h1',
    ]);
    expect(await problemsOn(paneOf("<h1>The title</h1><h2>A part</h2><h3>Inside it</h3>"))).toEqual([]);
  });

  it("finds words in capitals and a token's name outside code", async () => {
    expect(await problemsOn(paneOf("<p>PLAY THE GAME</p><p>Set --pad-pane here</p>"))).toEqual([
      'words in capitals: p "PLAY THE GAME"',
      'a token\'s name outside code: p "Set --pad-pane here", set it in code',
    ]);
    expect(await problemsOn(paneOf("<p>Play the game, with an MCP key</p><p>Set <code>--pad-pane</code> here</p>"))).toEqual([]);
  });

  it("finds more equal choices side by side than five, and a menu of more than nine with no groups", async () => {
    const choiceRow = (count: number) => row({ widths: "fit", items: Array.from({ length: count }, (_, index) => ({ kind: "control" as const, markup: actions.secondaryButton(`Choice ${index + 1}`, { type: "button" }) })) }).html;
    const menu = (count: number) => panes.dropdown({ id: `menu-${count}`, label: `${count} choices`, items: Array.from({ length: count }, (_, index) => ({ label: `Item ${index + 1}`, href: "#" })), isOpen: true }).html;
    const found = await problemsOn(paneOf(choiceRow(6)) + menu(10));
    expect(found.some((problem) => /^too many equal choices: div\.layout-row.*6 side by side, at most 5$/.test(problem)), found.join("\n")).toBe(true);
    expect(found.some((problem) => /^too many equal choices: div\.floating-pane.*10 in one menu with no groups, at most 9$/.test(problem)), found.join("\n")).toBe(true);
    expect(await problemsOn(paneOf(choiceRow(5)) + menu(9))).toEqual([]);
  });

  it("finds more than seven fields in a pane with no heading between them", async () => {
    const fields = (count: number) => Array.from({ length: count }, (_, index) => ({ kind: "control" as const, markup: inputs.cutField({ id: `field-${index}`, name: `field_${index}`, label: `Field ${index + 1}`, type: "text" }) }));
    const found = await problemsOn(paneOf(stack({ items: fields(8) }).html));
    expect(found.length, found.join("\n")).toBe(1);
    expect(found[0]).toMatch(/^a long form in one piece: .*Field 8.*, 8 fields with no heading between them, at most 7$/);
    expect(await problemsOn(paneOf(stack({ items: [...fields(4), { kind: "words" as const, markup: html`<h2>More</h2>` }, ...fields(4)] }).html))).toEqual([]);
  });

  it("finds two runners in one state, leaving the header's Sign in and what a sheet holds out", async () => {
    const found = await problemsOn(paneOf(actions.primaryButton("Play").html + actions.primaryButton("Play again").html));
    expect(found, found.join("\n")).toEqual([expect.stringMatching(/^two runners in view: .*"Play again" beside .*"Play"$/)]);
    expect(await problemsOn(paneOf(actions.primaryButton("Play").html) + panes.sheet({ id: "more", title: "More", body: layoutComponents.stackOfOne(actions.primaryButton("Buy")), closeLabel: "Close" }).html)).toEqual([]);
  });

  // What these rules ask of the components' styles, which every page's look comes from (a page has no styles of its own).
  const STYLES = () => COMPONENT_STYLES() + GALLERY_STYLES;
  const rulesOf = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors = "", declarations = ""]) => ({ selectors: selectors.trim(), declarations }));

  it("set no words in capitals and no words in the title's type: a page's one title is its h1", () => {
    expect(rulesOf(STYLES()).filter((rule) => /text-transform:\s*uppercase|font-variant(-caps)?:\s*(all-)?small-caps/.test(rule.declarations)).map((rule) => rule.selectors)).toEqual([]);
    expect(rulesOf(STYLES()).filter((rule) => /font:\s*var\(--type-title\)/.test(rule.declarations)).map((rule) => rule.selectors)).toEqual([]);
  });

  it("set words orange only on what you act on: a link or a button", () => {
    // The orange tokens, and every token made from them.
    const orange = new Set(["--run", "--run-hi", "--run-lo"]);
    const tokens = [...STYLES().matchAll(/(--[a-z0-9-]+):\s*([^;}]+)/g)];
    for (let size = 0; size !== orange.size; ) { size = orange.size; for (const [, name = "", value = ""] of tokens) if ([...orange].some((each) => value.includes(`var(${each})`))) orange.add(name); }
    // A part of something you act on counts too: a toggle's icon, on.
    const ACTED_ON = /(^|[\s>+~(])(a|button|summary|label)\b|\.(run|link|cut-btn|toggle-btn|tertiary-btn|danger)\b|\[role="?(tab|button)/;
    const problems = rulesOf(STYLES()).flatMap((rule) => [...rule.declarations.matchAll(/(?:^|[;\s])color:\s*([^;]+)/g)]
      .filter(([, value = ""]) => [...orange].some((each) => value.includes(`var(${each})`)))
      .flatMap(() => splitSelectors(rule.selectors).filter((selector) => !ACTED_ON.test(selector))));
    expect(problems).toEqual([]);
  });

  it("keep a heading never bigger than the one it's under: in one place, a lower level's type is never a larger size", () => {
    const remOf = (token: string) => Number(new RegExp(`${token}:\\s*\\d+\\s+([\\d.]+)rem`).exec(tokensSource)?.[1] ?? NaN);
    const sizes = rulesOf(STYLES()).flatMap((rule) => {
      const token = /font:\s*var\((--type-[a-z]+)\)/.exec(rule.declarations)?.[1];
      if (!token) return [];
      return rule.selectors.split(/,(?![^(]*\))/).flatMap((selector) => {
        const heading = /(?:^|\s)(?::is\(([^)]*)\)|(h[1-6]))$/.exec(selector.trim());
        if (!heading) return [];
        const levels = heading[1] ? heading[1].split(",").map((each) => each.trim()).filter((each) => /^h[1-6]$/.test(each)) : [heading[2]!];
        return levels.map((level) => ({ place: selector.trim().slice(0, heading.index).trim(), level: Number(level[1]), rem: remOf(token) }));
      });
    });
    expect(sizes.length).toBeGreaterThan(2);
    const problems = sizes.flatMap((lower) => sizes.filter((upper) => upper.place === lower.place && upper.level < lower.level && lower.rem > upper.rem).map((upper) => `${lower.place} h${lower.level} at ${lower.rem}rem is bigger than its h${upper.level} at ${upper.rem}rem`));
    expect(problems).toEqual([]);
  });

  it("keep a switch's tabs and a step flow's steps on one line: neither wraps", () => {
    const rules = rulesOf(STYLES()).filter((rule) => /\.(tab-switch|step-line)(?![\w-])[^\s,]*\s*(,|$)/.test(rule.selectors) && !/\.vertical/.test(rule.selectors));
    expect(rules.filter((rule) => /flex-wrap:\s*wrap|grid-auto-flow:\s*row/.test(rule.declarations)).map((rule) => rule.selectors)).toEqual([]);
    expect(rules.find((rule) => rule.selectors === ".tab-switch")?.declarations).toMatch(/display: flex;/);
    expect(rules.find((rule) => rule.selectors === ".step-line")?.declarations).toMatch(/grid-auto-flow: column;/);
  });
});

describe("layout", () => {
  it("makes a rebuilt page say its shape: the compiler refuses one without it", () => {
    // @ts-expect-error: a page that names its state is rebuilt, and a rebuilt page names its shape.
    const withoutShape: LayoutOptions = { title: "A page", body: html`<p>Hi</p>`, checkedPage: "Example page" };
    const withShape: LayoutOptions = { title: "A page", body: html`<p>Hi</p>`, checkedPage: "Example page", pageShape: "reading" };
    expect(withoutShape.title).toBe(withShape.title);
    expect(typeof layout).toBe("function");
  });

  it("sets no words in px: type and controls grow with the browser's text size", () => {
    // A picture's initials are sized to the picture, which doesn't grow: the one font in px.
    // A PIN's one field, unseen over its marks: 16px, the least that keeps a phone from zooming in as it's typed in.
    const IN_PX = new Set([".frame.xs .av::first-letter", ".pin-input"]);
    const problems = [...COMPONENT_STYLES().matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors = "", declarations = ""]) => {
      const selector = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop()!.trim();
      return [...declarations.matchAll(/(?:^|[;\s])(font(?:-size)?|--type-[a-z]+|--control-height-[a-z]+):\s*([^;}]+)/g)].filter(([, , value = ""]) => /\d(px)/.test(value) && !IN_PX.has(selector)).map(([, property, value]) => `${selector} | ${property}: ${value!.trim()}`);
    });
    expect(problems).toEqual([]);
  });

  it("changes only colours in dark: a rule for dark sets colour, background, border colour, shadow, filter, opacity or a glass variable", () => {
    // The one rule that swaps what shows in dark, with why: the city's day and night stills are one picture in two lights, in one place.
    const SWAPPED_IN_DARK = new Set([".city-stage .city-still.is-day | display", ".city-stage .city-still.is-night | display"]);
    const COLOUR = /^(color|color-scheme|caret-color|accent-color|outline-color|text-decoration-color|fill|stroke|background(-color|-image)?|border(-(top|right|bottom|left))?-color|box-shadow|text-shadow|filter|backdrop-filter|opacity)$/;
    // A custom property is a colour or glass's look unless it names a size, a space, a type or a shape.
    const LAYOUT_TOKEN = /^--(pad|gap|size|type|control-height|control-slant|cut|bevel|header-room|tab-room)/;
    const css = COMPONENT_STYLES().replace(/\/\*[\s\S]*?\*\//g, "");
    // Every rule with the blocks it's in (an @media), so a rule inside prefers-color-scheme: dark is known as dark.
    const rules: { context: string; selector: string; declarations: string }[] = [];
    const open: string[] = [];
    let start = 0;
    for (let at = 0; at < css.length; at++) {
      if (css[at] === "{") { open.push(css.slice(start, at).trim()); start = at + 1; }
      else if (css[at] === "}") { const selector = open.pop() ?? ""; const declarations = css.slice(start, at); if (!declarations.includes("{") && declarations.trim() && !selector.startsWith("@")) rules.push({ context: open.join(" "), selector, declarations }); start = at + 1; }
    }
    const darkRules = rules.filter((rule) => /prefers-color-scheme:\s*dark/.test(rule.context) || /data-theme-choice="dark"/.test(rule.selector));
    expect(darkRules.length).toBeGreaterThan(1);
    const problems = darkRules.flatMap((rule) => [...rule.declarations.matchAll(/([a-z-]+|--[a-z0-9-]+)\s*:\s*[^;]+/g)].map((match) => match[1]!)
      .filter((property) => (property.startsWith("--") ? LAYOUT_TOKEN.test(property) : !COLOUR.test(property)))
      .map((property) => `${rule.selector.replace(/^(:root:not\(\[data-theme-choice="light"\]\)|\[data-theme-choice="dark"\])\s*/, "")} | ${property}`)
      .filter((each) => !SWAPPED_IN_DARK.has(each)));
    expect(problems).toEqual([]);
  });

  it("names the old column width nowhere: a page's widths are its shape's", () => {
    expect(COMPONENT_STYLES()).not.toContain("--size-column");
    for (const source of [layoutSource, navigationSource, panesSource, tokensSource]) expect(source).not.toContain("--size-column");
  });

  it("measures on seven screens, each named once, and runs the screens a run starts with and its 200% text on screens from that list", () => {
    const names = SCREEN_SIZES.map((size) => size.name);
    expect(new Set(names).size).toBe(7);
    for (const name of [...LOCAL_SCREEN_NAMES, ...TEXT_SCREEN_NAMES, ...MEASURED_SCREEN_NAMES]) expect(names).toContain(name);
  });

  it("lists each stress state with the page it's of: the same page, as a stress account", () => {
    for (const page of CHECKED_PAGES.filter((each) => STRESS_ACCOUNTS.some((stress) => stress.account === each.account))) {
      const stress = STRESS_ACCOUNTS.find((each) => each.account === page.account)!;
      expect(page.name.endsWith(`, ${stress.nameEnding}`), page.name).toBe(true);
      expect(CHECKED_PAGES.some((each) => each.name === page.shownStateName), page.name).toBe(true);
    }
  });

  const words = (text: string): LayoutItem => ({ kind: "words", markup: html`<p>${text}</p>` });
  const block = (text: string): GridItem => ({ kind: "block", markup: html`<div>${text}</div>` });
  const control = (markup: ReturnType<typeof actions.secondaryButton>): LayoutItem => ({ kind: "control", markup });
  const cells = (markup: string) => [...markup.matchAll(/<div class="((?:stack|row|grid)-cell[^"]*)"/g)].map((match) => match[1]!.split(" "));

  it("stacks things with the gap picked from what's on each side, never one passed", () => {
    const markup = stack({ items: [words("Welcome back"), words("Sign in to keep your progress."), control(actions.primaryButton("Sign in")), control(actions.secondaryButton("Cancel")), control(inputs.cutField({ name: "email", label: "Email", type: "email", icon: "mail" })), block("A table")] }).html;
    expect(cells(markup).map((classes) => classes.find((each) => each.startsWith("gap-top-")) ?? "")).toEqual(["", "gap-top-words-words", "gap-top-words-control", "gap-top-control-stack", "gap-top-block-block", "gap-top-block-block"]);
    // Words keep the pane's margin; controls and blocks sit at the frame gap.
    expect(cells(markup).map((classes) => classes[1])).toEqual(["is-words", "is-words", "is-control", "is-control", "is-control", "is-block"]);
    expect(STACK_STYLES).toContain(".stack-cell.is-words { padding-inline: var(--pad-words); }");
  });

  it("shares a row's width as it's told: the lead fills and the rest fit their words, equal shares, or each fits", () => {
    const items = [control(actions.primaryButton("Play", { isBig: true })), control(actions.secondaryButton("Details"))];
    expect(cells(row({ widths: "lead-fills", items }).html).map((classes) => classes.includes("fills"))).toEqual([true, false]);
    expect(cells(row({ widths: "equal", items }).html).map((classes) => classes.includes("fills"))).toEqual([true, true]);
    expect(cells(row({ widths: "fit", alignment: "end", items }).html).map((classes) => classes.includes("fills"))).toEqual([false, false]);
    expect(row({ widths: "fit", alignment: "end", items }).html).toContain('class="layout-row alignment-end"');
    expect(row({ widths: "equal", items }).html).toContain('class="layout-row widths-equal alignment-start"');
    // Two controls side by side slant toward each other: their boxes overlap by the edge rule's neighbor distance.
    expect(cells(row({ widths: "lead-fills", items }).html)[0]).toContain("gap-end-control-row-boxes");
    expect(ROW_STYLES).toContain(".layout-row > .row-cell.gap-end-control-row-boxes { margin-inline-end: var(--gap-control-row-boxes); }");
  });

  it("sets every control in a row to one height, the tallest one's", () => {
    const heightOf = (items: LayoutItem[]) => /data-control-height="([a-z]+)"/.exec(row({ widths: "fit", items }).html)?.[1];
    expect(heightOf([control(actions.secondaryButton("Dismiss", { isSmall: true })), control(actions.secondaryButton("Read more"))])).toBe("regular");
    expect(heightOf([control(inputs.cutField({ name: "room", label: "Room code", type: "text", icon: "people" })), control(actions.secondaryButton("Join"))])).toBe("field");
    expect(heightOf([control(actions.primaryButton("Play", { isBig: true })), control(actions.secondaryButton("Details"))])).toBe("big");
    expect(ROW_STYLES).toContain('.layout-row[data-control-height="big"] > .row-cell > .cut-btn');
    // A field that shows its label sits on its box: the row lines its controls up on the boxes.
    expect(row({ widths: "lead-fills", items: [control(inputs.cutField({ name: "room", label: "Room code", type: "text", icon: "people" })), control(actions.secondaryButton("Join"))] }).html).toContain("is-on-field-boxes");
  });

  it("puts a pane's corner control in its corner, a tertiary button too", () => {
    const markup = paneParts({ head: { words: html`<h2>Rooms</h2>`, end: actions.secondaryButton("Refresh") }, body: html`<p>Rooms here</p>`, foot: { end: actions.tertiaryButton("See all") } }).html;
    expect(markup).toMatch(/<div class="pane-head" data-control-height="regular"><div class="pane-head-words"><h2>Rooms<\/h2><\/div><div class="pane-head-end"><button class="shell cut-btn"/);
    // A tertiary button is a control like any other: in a corner it takes the corner's cut, its words on the pane's margin inside it.
    expect(markup).toContain('<div class="pane-foot" data-control-height="regular"><div class="pane-foot-end">');
    expect(PANE_PARTS_STYLES).toContain(".pane-head-end, .pane-foot-end { display: flex; margin-inline-start: auto; }");
  });

  it("takes only named sizes: a grid's cells, a track's covers, columns' halves, never a number of a page's", () => {
    expect(grid({ whenEmpty: data.stateNote({ stateKind: "empty", title: "No games here yet", text: "Games show here as they come." }), itemSize: "cover", items: [block("a")] }).html).toContain('class="layout-grid item-cover"');
    // Every width, height, basis or template in the layout components is a named size or a share: no pane has a width of its own.
    const SIZE_PROPERTY = /(?:^|[;\s{])((?:min-|max-)?(?:width|height)|flex-basis|flex|grid-template-columns):\s*([^;}]+)/g;
    // A length, other than a share (%), a fraction or a flex number, is a named one: a size token, or a track's cover.
    const NAMED_LENGTHS = ["clamp(200px, 20cqi, 260px)"];
    const problems: string[] = [];
    for (const css of [STACK_STYLES, ROW_STYLES, GRID_STYLES, TRACK_STYLES, COLUMNS_STYLES, PANE_PARTS_STYLES]) {
      for (const [, property = "", sizeValue = ""] of css.matchAll(SIZE_PROPERTY)) {
        const rest = NAMED_LENGTHS.reduce((left, named) => left.split(named).join(""), sizeValue).replace(/var\(--[a-z-]+\)/g, "");
        if (/\d(px|em|rem|vw|vh|cqi|cqw)/.test(rest)) problems.push(`${property}: ${sizeValue.trim()}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("gives a pane the whole width or what's in it, never a width of its own: one that should take half the screen is a column", () => {
    expect(glassPane({ paneWidth: "fit", body: layoutComponents.stackOfOne(html`<p>Hi</p>`, "words") }).html).toContain('class="glass glass-pane fit"');
    const paneWidths = [...COMPONENT_STYLES().matchAll(/\.glass-pane(?:\.[a-z-]+)*\s*\{[^}]*?\bwidth:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    expect([...new Set(paneWidths)].sort()).toEqual(["100%", "fit-content"]);
    const halves = columns({ columns: [html`<p>A</p>`, html`<p>B</p>`] }).html;
    expect(halves.match(/<div class="column">/g)).toHaveLength(2);
    expect(COLUMNS_STYLES).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(COLUMNS_STYLES).toContain(`@container (max-width: ${2 * COLUMN_LEAST_PX + 24 - 1}px)`);
  });

  it("is made of controls only from the controls' own functions, so a paragraph can't be passed as one", () => {
    const MAKERS = ["components/actions.ts", "components/fields.ts", "components/choices.ts", "components/inputs.ts", "components/switch.ts", "components/navigation.ts", "components/control-markup.ts"];
    const makers = Object.entries(SOURCES).filter(([, source]) => /\bcontrolMarkup\(|new ControlMarkup\(/.test(source)).map(([file]) => file);
    expect(makers.filter((file) => !MAKERS.includes(file))).toEqual([]);
  });

  // What the layout check stopped measuring (scripts/layout-check.mjs judges only what a player would notice) is held here, in the
  // components' own styles and scripts.
  it("keeps every word in a pane at its margin, and everything with an edge at the frame gap", () => {
    expect(tokensSource).toContain('${WORDS_SURFACES.join(", ")} { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); }');
    expect(tokensSource).toContain(':where(${WORDS_HOLDERS.join(", ")}) :where(h1, h2, h3, h4, p) { padding-inline: var(--pad-words); }');
    expect(tokensSource).toContain(':where(${BARE_GROUPS.join(", ")}) { padding-inline: var(--pad-words); }');
    expect(panesSource).toContain(".tray { padding: var(--pad-frame); --pad-words: calc(var(--pad-tray) - var(--pad-frame)); }");
  });

  it("cuts every corner the edge rule cuts to a bevel of at least 4px", () => {
    expect(glassScriptSource).toContain("var LEAST_BEVEL_PX = 4;");
    expect(glassScriptSource).toContain("cut > 0 ? Math.max(LEAST_BEVEL_PX, cut) : 0");
  });

  it("sets a row's words on its controls' center line", () => {
    expect(ROW_STYLES).toContain(".row-cell { display: flex; align-items: center; }");
  });

  it("keeps a pane over the page to its kind's size and the screen", () => {
    expect(panesSource).toContain(".floating-pane.dropdown { width: max-content; max-width: min(var(--size-menu), calc(100vw - 2 * var(--pad-frame)));");
    expect(materialsSource).toContain(".floating-pane { max-height: min(var(--size-menu-height),");
    expect(panesSource).toContain(".sheet { width: fit-content; max-width: min(var(--size-sheet), calc(100% - 2 * var(--pad-pane)));");
    expect(panesSource).toContain(".sheet.is-picture { max-width: min(var(--size-sheet-picture), calc(100% - 2 * var(--pad-pane))); }");
  });

  it("runs words to a reading width, and a reading page's column to its shape's", () => {
    expect(tokensSource).toContain(':where(${WORDS_HOLDERS.join(", ")}, .tray-head) :where(p, li) { max-width: 75ch;');
    expect(layoutSource).toContain('html[data-page-shape="reading"] body > main:not(:has(> .sidebar-layout)) { width: min(var(--size-page-reading), calc(100% - 2 * var(--pad-pane))); }');
  });

  it("scrolls a select's list by more than a sliver", () => {
    expect(choicesSource).toContain("extraPx > 0 && extraPx < LEAST_SCROLL_PX");
  });

  it("gives nothing empty a gap, and takes controls side by side only in a row", () => {
    const markup = stack({ items: [{ kind: "words", markup: html`` }, { kind: "words", markup: html`<p>Kept</p>` }, { kind: "block", id: "filled-later", markup: html`` }] }).html;
    expect(markup.match(/class="stack-cell/g)?.length).toBe(2);
    expect(markup).toContain('id="filled-later"');
    expect(STACK_STYLES).toContain(".stack-cell:is(:empty, :has(> [hidden]:only-child)) { display: none; }");
    // @ts-expect-error: a grid's cell is a block or words, never a bare control.
    grid({ itemSize: "figure", items: [{ kind: "control", markup: actions.secondaryButton("Keep", { type: "button" }) }] });
    // @ts-expect-error: a column holds a pane or a stack, never a bare control.
    columns({ columns: [actions.secondaryButton("Keep", { type: "button" }), html`<p>Beside</p>`] });
  });

  it("gives a pane's body only a layout's markup, made by the layouts alone, so every word in a pane keeps its margin", () => {
    const makers = Object.entries(SOURCES).filter(([, source]) => /new LayoutMarkup\(|as (unknown as )?LayoutMarkup\b/.test(source)).map(([file]) => file);
    expect(makers).toEqual(["components/layout.ts"]);
  });
});
