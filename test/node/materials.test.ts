import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../../apps/site/src/components/index.ts";

/*
 * Everything in the gallery is built of the materials (docs/DESIGN.md, Materials; apps/site/src/components/materials.ts). Only the materials
 * themselves (the components on Panes › Materials) and the layout components give anything a look, room, a size, a scroll or a timing: a
 * component puts them together and says nothing of its own about them. So a component's styles never set a background, a shadow, a
 * backdrop, a border, padding, a height or a scroll; never space its parts with the spacing tokens (a layout or a material's margin does:
 * layout.ts's stack and row, words-margin); never write a color (a token says it, so it turns with light and dark and takes a
 * game's tint); and never time a change or a loop but with the motion tokens. Nor does a style written into a component's markup, which
 * never lays things out either (a stack or a row does), and a
 * control's height is only ever its size class's (--control-height set to a size class, never a length): so a control can't be off its
 * size class's height, and the layout check no longer measures it.
 */

/** What may give itself a look: the materials, and the layout components that place them. */
const isMaterialOrLayout = (component: { group: string; subgroup?: string }) => component.group === "layout" || (component.group === "panes" && component.subgroup === "materials");

const OWN_LOOK = /^(background(-[a-z]+)?|box-shadow|-webkit-backdrop-filter|backdrop-filter|border(-[a-z]+)*|padding(-[a-z]+)*|height|min-height|max-height|overflow(-[xy])?)$/;
/** Taking a look away is never a look of its own, and filling what holds it is never a size of its own. */
const RESET = /^(none|0|0px|auto|visible|transparent|inherit|unset|initial|100%)$/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const OWN_TIMING = /(?<![\w.-])(?!0s\b)\d*\.?\d+m?s\b|cubic-bezier\(|steps\(/;
/** Pictures, icons and Zaisma's logo are sized, not built: their own height is their size. */
const PICTURE_OR_ICON = /(^|[\s>+~(])(img|svg|video|canvas|iframe|picture|\.ico|\.logo)(\.[\w-]+|:[\w-]+(\([^)]*\))?)*\)?$/;

/**
 * The few that aren't made of the materials, each with its reason: "selector | property", or "selector | *" for a mark drawn whole (a
 * chart's dot, a QR code's tile). A picture's own colors, a brand's marks, the gallery's demos of what glass does, and things drawn rather
 * than built.
 */
const NOT_MADE_OF_MATERIALS = new Map<string, string>([
  // A fold row's words keep the words margin at the pane's top and foot, where a flush row has no edge of its own to keep it.
  // A sheet's tabs are cut from the sheet's own glass, their row drawn as one outline that runs on into the sheet.
  // A banner narrower than its button and Close side by side: its words take the whole width, Close beside their first line.
  [".banner-icon | height", "the icon sits on the words' first line"],
  [".banner-in:not(.has-close) > .banner-words | padding-block-start", "narrow, with no Close, its words keep the margin at its top"],
  [".banner-in.has-close .banner-text::before | height", "narrow, its words make room for Close beside their first line"],
  // A way in's own color, its brand's, mixed into its slab; and a mark that may be one color.
  [".cut-btn[data-tint=\"plain\"] > .face | --way", "Google's plain white or black"],
  [".cut-btn[data-tint=\"blue\"] > .face | --way", "a way in's own blue"],
  [".cut-btn[data-tint=\"indigo\"] > .face | --way", "Discord's indigo"],
  [".cut-btn[data-tint=\"black\"] > .face | --way", "a way in's own black"],
  [".way-mark .one-color path | fill", "Discord's mark in its own color"],
  [".way-mark.way-google | padding", "Google's G on smoked glass sits on a white disc a little larger than it, as Google asks"],
  [".way-mark.way-google | background", "the white disc, only on smoked glass (--brand-mark-backing)"],
  [".way-mark.way-google | border-radius", "the disc is round"],
  // A field's drawn and hidden parts.
  [".pin-marks | min-height", "a PIN's row of marks takes a small control's height, so it lines up beside one"],
  [".pin-mark | height", "a PIN's mark is a carved diamond 20px across"],
  [".find-finish | overflow", "the finish a search offers ends where the field's end controls begin"],
  [".find-game > img | background", "a game's picture shows the carving's face while it loads"],
  [".select-sizes | overflow", "the hidden list of choices that holds a select as wide as its longest, at no height"],
  [".slider-input::-webkit-slider-thumb | height", "the system's own thumb, unseen, is the drawn thumb's size, so a press lands where it shows"],
  [".slider-input::-moz-range-thumb | height", "the system's own thumb, unseen, is the drawn thumb's size, so a press lands where it shows"],
  [".copy-field.is-masked:not(.is-code) .copy-field-text | padding", "a blurred secret's blur reaches past its words, inside its own clip"],
  [".tab-switch > .foldable | overflow", "a tab folding away narrows to nothing, its words cut as it goes"],
  // A wheel turns by scrolling inside its groove, three rows tall, the picked one snapped to the middle.
  [".wheel-channel | height", "three rows: the picked one in the middle, one above and one below"],
  [".wheel | overflow-y", "the wheel turns by scrolling inside its groove"],
  [".wheel | padding", "a row's room above the first and below the last, so either can come to the middle"],
  [".wheel [role=\"option\"]::after | overflow", "the label again in bold, unseen, holding the row as wide as when it's picked"],
  [".field input:-webkit-autofill | transition", "the browser's autofill color held off for good, so a filled field keeps the carving's face"],
  // A color field shows the color itself: the color picked, the square of hues and strengths, the brightness ramp.
  [".color-chip | background", "the color picked, in the field"],
  [".color-swatch | background", "the color picked, in the pane"],
  [".color-swatch | min-height", "the color picked shows at least a strip, however little room the column leaves"],
  [".color-square-light | background", "the square of hues across and strengths down"],
  [".color-square-light::after | background", "the square dimmed by the brightness"],
  [".color-side .groove | background", "the brightness slider's groove runs from black to the full color"],
  [".color-chip | margin-block", "the color sits a part's gap in from the field's top and foot, as in the picked color's carving"],
  // A file drop's picked files.
  [".file-drop-preview::before | background", "the picked file's own picture, on the carving's face"],
  [".file-drop-view | max-height", "the picture at its own size, made smaller only where the screen is"],
  [".file-drop-row.is-sending | padding-bottom", "room at its foot for the groove that shows how much has gone"],
  // The playing screen is the game's own: the page is the window's height, scrolls nothing, and is black behind the game.
  ["html.is-playing body | height", "the playing screen is the window's height"],
  ["html.is-playing body | overflow", "the playing screen scrolls nothing; the game has it all"],
  ["html.is-playing body | background", "black behind the game, as a game's own screen"],
  [".game-frame | background", "black behind the game while it loads, as a game's own screen"],
  [".screenshot-large | max-height", "a screenshot at its own size, made smaller only where the screen is"],
  // Where a page puts its foot and a sidebar's sheet: the page's own placing, not the pieces'.
  [".foot | margin", "the footer sits a block's gap under the page, the page's margin above the window's foot"],
  [".sheet.placement-start:not(.in-place) | height", "a sidebar's sheet is the screen's height less a gap at its top and foot"],
  // The gallery's stand-in phone round a sidebar's sheet.
  [".sidebar-example-phone | padding", "the stand-in phone's screen round the sheet"],
  [".sidebar-example-phone | box-shadow", "the stand-in phone's screen is carved"],
  // A card's brand mark, a picture of its own size.
  [".card-row-mark > .card-brand | height", "a card brand's mark is 32 by 20"],
  [".card-row-mark > .card-brand | background", "the mark fits its box"],
  // An account's picture and its presence marks: drawn from the account's name, sized to the picture.
  [".frame | height", "an account's picture is its frame's size"],
  [":is(.frame, .slab.holds-art) .av | *", "an account's picture: its colors drawn from its name, its initials in white"],
  [".frame-presence | *", "room under a picture for its presence marks"],
  [".presence-line | *", "online: a green line along a picture's foot"],
  [".presence-play | *", "playing: a green tab with a white play mark at the line's end"],
  [".presence-play > .play | height", "the play mark is sized to its tab"],
  [".picture-row-place:not(:last-child)::after | box-shadow", "pictures in a row lie over each other, each casting onto the next"],
  // A QR code is read by a camera: dark on white with a quiet zone round it, in light and dark alike.
  [".qr-tile | *", "the white tile and its quiet zone"],
  [".qr-tile > .cut-line | *", "the white tile's own bevel"],
  [".qr-picture | background", "the code's white"],
  [".qr-icon | outline", "the white round the mark in the code's middle, so the code still reads"],
  [".qr-code.is-large .qr-tile | padding", "a large code's wider quiet zone"],
  // A chart and a meter are drawn: their plot, marks, scale and the tip at a point.
  [".chart-scale | height", "the scale is the plot's height"],
  [".chart-plot | height", "the plot's height"],
  [".chart-empty | *", "an empty plot: its height and its baseline"],
  [".chart-scroll | *", "room above the plot for the tip at its highest point"],
  [".chart-inner | *", "room at the plot's ends for the dots at its first and last points, which never scroll it"],
  [".chart-grid | border-top", "the scale's lines across the plot"],
  [".chart-last | *", "the dot at the last point"],
  [".chart-dot | *", "the dot at the point you're on"],
  [".chart-tip | *", "the tip at the point you're on: its amount and when"],
  [".chart-inner.is-bars .chart-hit:is(:hover, .is-pointed), .chart:focus-visible .chart-inner.is-bars .chart-hit.is-focused | background", "the bar you're on lights its column"],
  [".ring-picture | height", "the ring's size"],
  [".ring-swatch | *", "a share's color in the key"],
  [".usage:is(.is-near, .is-full) .usage-groove .groove-fill | filter", "a meter near its limit glows amber"],
  [".usage.is-near .usage-groove .groove-light | background", "near its limit, the meter's light is amber"],
  [".usage.is-full .usage-groove .groove-light | background", "at its limit, the meter's light is striped"],
  [".usage-part | background", "a part's color in the meter"],
  [".usage.is-full .usage-part | background", "at its limit, a part's color is striped"],
  [".usage-swatch | *", "a part's color in the key"],
  [".loading-line | *", "the hairline a loading state runs its light along"],
  [".loading-line::after | background", "the light running along it"],
  // A table's cells: their rows' room and the line under its pinned head and beside its pinned first column, which a cell draws.
  [".data-table | border-collapse", "separate cells, so the pinned head and first column keep their lines as they stick"],
  [".data-table thead th | *", "the head's room and the line under it"],
  [".data-table td, .data-table tbody th | padding", "a row's room, its words at the words margin"],
  [".data-table.compact thead th | padding", "a compact head's room"],
  [".data-table.compact td, .data-table.compact tbody th | padding", "a compact row's room"],
  [".table-scroll.more-left .data-table tbody th | box-shadow", "the line beside the pinned first column, once what's beside it scrolls under it"],
  [".table-scroll.more-left .data-table.has-row-heads thead th:first-child | box-shadow", "the pinned corner's lines"],
  // A state sits a block's gap into where its content would be, its button a block's gap under its words.
  [".state-note | padding", "a state sits a block's gap into where its content would be"],
  [".state-action | margin-top", "its button a block's gap under its words"],
  [".glance li | min-height", "a fact's line is as tall as the friends' pictures beside it"],
  // Reading text is Markdown, which writes no classes: it spaces and draws its own parts.
  [".reading > :nth-child(n + 2) | margin-top", "a block's gap between paragraphs and anything else"],
  [".reading > :is(h2, h3) + :nth-child(n + 2) | margin-top", "a word's gap under a heading"],
  [".reading :is(ul, ol) | padding-inline", "a list's markers in from its words, and its words kept off the far edge by the words margin"],
  [".switch-well > .well-body > .tab-switch | --control-height", "a switch carved into a well takes the well's control height, so its tabs fill it"],
  [".reading :not(pre) > code | *", "code in a line: a sliver of carving"],
  [".reading pre | *", "a block of code: a carving out to the frame gap"],
  [".reading blockquote | *", "a quote, set in from a hairline"],
  [".reading table | border-collapse", "a Markdown table's lines run unbroken"],
  [".reading :is(th, td) | *", "a Markdown table's cells and lines"],
  // Foundations shows what the materials are made of: glass over moving shapes, the backdrop and the city behind it, the cut shapes, the
  // spacing marks and the colors themselves. These demonstrations draw their own shapes, colors and stages.
  [".swatches .chip-swatch | min-height", "a color shown as a chip a regular line tall"],
  [".glass-strip | *", "a strip of shapes for glass to sit over"],
  [".glass-strip > i | *", "the shapes under the glass"],
  [".glass-strip > i:nth-child(1) | background", "an orange shape"],
  [".glass-strip > i:nth-child(2) | *", "a blue shape"],
  [".glass-strip > i:nth-child(3) | background", "a teal shape"],
  [".glass-strip > .glass:not(.glass-pane) | *", "a slab of glass over the shapes, in each thickness"],
  [".glass-play | *", "a stage of moving shapes for glass to sit over"],
  [".glass-play .sun | *", "a moving orange disc"],
  [".glass-play .bar | *", "a moving blue bar"],
  [".glass-play .sea | *", "a moving teal disc"],
  [".glass-play .cut | *", "a moving pink shape"],
  [".glass-play .dot | *", "a moving yellow dot"],
  [".glass-window | *", "a window of glass to drag over the stage"],
  [".glass-window .glass-grip | height", "the window's grip"],
  [".cut-sample.is-pane | height", "a pane's cut shown at a pane's size"],
  [".cut-sample.is-header | height", "the header's cut shown at the header's height"],
  [".cut-sample.is-menu | height", "a menu's cut shown at a menu's size"],
  [".spacing-mark | *", "the hatched mark that shows a gap"],
  [".icon-set .play | height", "the play mark is drawn shorter than it's wide"],
  [".logo | padding", "the logo's room round its glass, as its file draws it"],
  [".loader | *", "the loader is drawn: a mark in the words' color"],
  [".loader > i | *", "the loader's dots, drawn in the words' color, turning once a second"],
  [".backdrop | *", "the backdrop: the window's height and its colored light"],
  [".backdrop-frame | *", "a frame showing the backdrop"],
  [".backdrop-frame > .glass | padding", "a pane in the backdrop's frame"],
  [".backdrop-frame.is-tall | *", "a taller frame for the backdrop"],
  [".shader-code | *", "a shader's source in a well, scrolling sideways"],
  [".city-stage | *", "the city's stage: the window's height and its sky"],
  [".city-stage .city-still | *", "the city's still picture while it loads"],
  [".city-stage.is-still .city-still | background-image", "the full still once it's in"],
  [".city-stage .city | transition", "the city fades and settles in"],
  [":root:not([data-theme-choice=\"light\"]) .city-stage | background", "the city's night sky"],
  ["[data-theme-choice=\"dark\"] .city-stage | background", "the city's night sky"],
  ["[data-theme-choice=\"light\"] .city-stage | background", "the city's day sky"],
  [".city-page | *", "the city's page, a window tall"],
  [".city-page .city-pane | *", "a pane over the city, below its skyline"],
  [".city-pane .or::before, .city-pane .or::after | *", "the lines either side of \"or\""],
  [".city-frame | *", "a frame showing the city"],
  // Where the window puts a sheet: the page's own placing, not the sheet's.
  [".sheet:not(.in-place) | margin", "a sheet sits a control's stack gap in from the window's sides and foot"],
  [".sheet.placement-foot:not(.in-place) | margin", "a sheet at the window's foot sits the page's margin above it"],
  [".sheet.placement-corner:not(.in-place) | margin", "a store panel over a game sits the page's margin in from the window's side and foot"],
  // A fold is a details element, whose parts take no gap in every browser: its body keeps a block's gap from its head itself.
  // Named caps (materials.ts, Caps and scrolls).
  [".sheet:not(.in-place) .store-cover.is-large | max-height", "a store panel's large cover is shorter on a short screen, so Buy keeps its room"],
  [".stripe-frame | height", "as tall as what Stripe draws in it, which its script says"],
  [".large-icon | padding-block", "a pane's key icon has a block's room above and below it"],
  [".floating-pane.dropdown .dropdown-head + .divider | margin-top", "a dropdown's head stands a control's gap from the rule under it"],
  [".floating-pane.dropdown[data-edge-light=\"left\"] > .edge-light::after | background", "a dropdown's edge light floods in from its left edge and fades"],
  [".cover-mark.at-device .tag | padding-inline", "a device tag on a cover keeps its icon optically centered"],
  [".cover-picture::after | box-shadow", "a cover's art sits under the carving's rim, its inner shadow at the top and sides"],
  [".pane-parts:has(> .pane-body .confirm-body) > .pane-head | margin-bottom", "Confirm it's you's Close sits beside its key icon, so its head takes no room of its own"],
  [".confirm-body [id$=\"-reason\"] | margin-bottom", "Confirm it's you's reason stands a block's gap from the field under it"],
  [".tag.is-removable | height", "a removable tag is as tall as its remove mark's reach"],
  [".tag.is-removable | padding-inline", "a removable tag keeps room for its remove mark"],
  [".tag.is-removable:focus-visible | box-shadow", "a removable tag shows the keyboard's focus ring inside its carving"],
  [".stripe-frame.is-covering | height", "over the whole window while a bank asks the player to confirm"],
  [".list-rows.is-capped | max-height", "a list capped at its shown rows and half the next, so it shows it scrolls"],
  [".table-scroll[data-fades-sideways] | max-height", "a table caps at the screen"],
  [".table-scroll[data-fades-sideways].is-capped | max-height", "a table capped at its head, its shown rows and half the next"],
  [".list-row-while-on, .list-row-fold-body | margin", "the rows a switch row turns on sit in a well a frame gap in from the list's sides, a frame gap above the next row"],
  // A control's height.
  [".cut-btn.in-well | --control-height", "a button in a well is a small control less the well's compact frame gap above and below"],
]);

/** How things sit together, which only a layout component says in markup. */
const MARKUP_LAYOUT = /^(display|gap|row-gap|column-gap|justify-content|justify-items|align-items|align-content|flex(-[a-z]+)?|grid(-[a-z]+)*)$/;

/** Styles written into a component's markup that aren't made of the materials, each with its reason: "file | property: value". */
const MARKUP_NOT_MADE_OF_MATERIALS = new Map<string, string>([
  // The gallery's stand-in worlds: a stretch of a game's backdrop for glass to sit on.
  ["actions.ts | overflow: hidden", "a stand-in world clips its backdrop to its box"],
  ["actions.ts | display: grid", "a stand-in world lays its pane over its backdrop"],
  ["foundations.ts | display: flex", "the logo's stage of glass holds the logo alone"],
  ["actions.ts | padding: var(--pad-pane)", "a stand-in world's backdrop shows a pane's margin round the pane on it"],
  ["foundations.ts | padding: var(--pad-pane)", "the logo on light or smoked glass, a pane's margin round it"],
  ["foundations.ts | background: ${glassKind === \"light\" ? \"#E7E4DF\" : \"#121110\"}", "the glass the logo sits on, light or smoked whatever the page's theme"],
  ["foundations.ts | background: var(${token})", "a color swatch is its token's color"],
  ["foundations.ts | --glass-tint: rgba(var(--glass-base),${glassOpacityPct / 100})", "glass at each opacity, side by side"],
  // Links in a line, spaced as the footer spaces its own (Footer, in Navigation), so each reads as its own.
  ["actions.ts | display: flex", "quiet links in a line, as the footer's"],
  ["actions.ts | flex-wrap: wrap", "quiet links in a line wrap, as the footer's"],
  ["actions.ts | column-gap: var(--gap-block-block)", "quiet links a block's gap apart, as the footer's"],
  ["actions.ts | row-gap: var(--gap-words-words)", "quiet links' lines a words gap apart, as the footer's"],
  // A value drawn as a share.
  ["data.ts | flex-grow: ${String(part.sharePct)}", "a usage meter's part takes its share of the bar"],
  // An example's room.
  ["fields.ts | min-height: 22rem", "an open search field's example keeps room for its finishes under it"],
]);

/** Every declaration in every component's styles: its component, its selector (the last in a list of several), its property and value. */
function declarations() {
  const found: { slug: string; selector: string; property: string; value: string; isMaterial: boolean }[] = [];
  for (const component of COMPONENTS()) {
    const styles = component.styles.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selectors = "", block = ""] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = selectors.trim().split("\n").pop()!.trim();
      for (const declaration of block.split(";")) {
        const colonIndex = declaration.indexOf(":");
        if (colonIndex < 0) continue;
        found.push({ slug: component.slug, selector, property: declaration.slice(0, colonIndex).trim(), value: declaration.slice(colonIndex + 1).trim(), isMaterial: isMaterialOrLayout(component) });
      }
    }
  }
  return found;
}

/** What a declaration does that only a material may: undefined when it's the component's to say. */
function ownLookOf(property: string, value: string, selector: string): string | undefined {
  // A mask is how much of something shows, not a color: its black is only "all of it".
  if (/^(-webkit-)?mask(-image)?$/.test(property)) return undefined;
  // A picture drawn into a box (a card brand's mark) is the picture's own, colors and all.
  if (property === "background-image" && /^url\(/.test(value)) return undefined;
  if (RAW_COLOR.test(value)) return "a color of its own";
  if (property === "--control-height" && !/^var\(--control-height-(small|regular|field|big)\)$/.test(value)) return "a control height of its own";
  if (property.startsWith("--")) return undefined;
  if (/^(transition|animation)(-[a-z]+)?$/.test(property) && OWN_TIMING.test(value)) return "a timing of its own";
  if (property === "filter" && /drop-shadow\(/.test(value)) return "a shadow of its own";
  if (/^margin/.test(property) && /var\(--(gap|pad)-/.test(value)) return "spacing of its own";
  if (!OWN_LOOK.test(property) || RESET.test(value)) return undefined;
  if (/height$/.test(property) && PICTURE_OR_ICON.test(selector.split(",").pop()!.trim())) return undefined;
  return /^(height|min-height|max-height)$/.test(property) ? "a size of its own" : /^overflow/.test(property) ? "a scroll of its own" : /^padding/.test(property) ? "room of its own" : "a look of its own";
}

/** Every declaration in a style written into a component's markup (style="..."), with its file. */
function markupDeclarations() {
  const folder = join(import.meta.dirname, "../../apps/site/src/components");
  const found: { file: string; property: string; value: string }[] = [];
  // The materials and the layout components say all of it.
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".ts") && name !== "materials.ts" && name !== "layout.ts")) {
    for (const [, style = ""] of readFileSync(join(folder, file), "utf8").matchAll(/\sstyle="((?:[^"$]|\$\{[^}]*\})*)"/g)) {
      for (const declaration of style.split(";")) {
        const colonIndex = declaration.indexOf(":");
        if (colonIndex > 0) found.push({ file, property: declaration.slice(0, colonIndex).trim(), value: declaration.slice(colonIndex + 1).trim() });
      }
    }
  }
  return found;
}

describe("materials", () => {
  it("builds every component of the materials: none gives itself a look, room, spacing, a size, a scroll, a color or a timing", () => {
    const problems: string[] = [];
    for (const { slug, selector, property, value, isMaterial } of declarations()) {
      if (isMaterial) continue;
      const own = ownLookOf(property, value, selector);
      if (own && !NOT_MADE_OF_MATERIALS.has(`${selector} | ${property}`) && !NOT_MADE_OF_MATERIALS.has(`${selector} | *`)) problems.push(`${slug}: ${selector} { ${property}: ${value} }: ${own}`);
    }
    expect(problems).toEqual([]);
  });

  it("writes nothing into a component's markup that only a material may say", () => {
    const problems = markupDeclarations().flatMap(({ file, property, value }) => {
      // Nor how things sit together: a layout component (layout.ts's stack, row, grid) places them, so spacing and order come from it.
      const own = MARKUP_LAYOUT.test(property) && !RESET.test(value) ? "a layout of its own" : ownLookOf(property, value, "");
      return own && !MARKUP_NOT_MADE_OF_MATERIALS.has(`${file} | ${property}: ${value}`) ? [`${file} | ${property}: ${value}: ${own}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it("names nothing in NOT_MADE_OF_MATERIALS that's gone", () => {
    const present = new Set(declarations().flatMap(({ selector, property }) => [`${selector} | ${property}`, `${selector} | *`]));
    expect([...NOT_MADE_OF_MATERIALS.keys()].filter((entry) => !present.has(entry))).toEqual([]);
    const inMarkup = new Set(markupDeclarations().map(({ file, property, value }) => `${file} | ${property}: ${value}`));
    expect([...MARKUP_NOT_MADE_OF_MATERIALS.keys()].filter((entry) => !inMarkup.has(entry))).toEqual([]);
  });
});
