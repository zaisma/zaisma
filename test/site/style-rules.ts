/*
 * The design rules a scan of the components' styles and icons can hold (docs/DESIGN.md, Rules): pure functions from a stylesheet or the
 * icons to a list of problems, so each rule runs on the real components and on a fixture that breaks it (test/node/style-rules.test.ts),
 * and the Workers design test (test/site/design.test.ts) reads the same copy. Each problem names the selector, the property and the value.
 */

/** A rule of a stylesheet: its selector list as written, its last line (what a named exception names), its declarations, and the @media it's in. */
export interface StyleRule {
  selectors: string;
  selector: string;
  declarations: string;
  media: string;
}

/** Every rule of a stylesheet, with the innermost @media round it ("" outside one), comments taken out. */
export function styleRulesOf(css: string): StyleRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: StyleRule[] = [];
  const preludes: string[] = [];
  let start = 0;
  let parenthesesDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") parenthesesDepth += 1;
    else if (character === ")") parenthesesDepth -= 1;
    else if (parenthesesDepth !== 0) continue;
    else if (character === "{") {
      const prelude = text.slice(start, index).trim();
      const closing = prelude.startsWith("@") ? -1 : text.indexOf("}", index);
      if (closing >= 0 && !text.slice(index + 1, closing).includes("{")) {
        const media = [...preludes].reverse().find((each) => each.startsWith("@media")) ?? "";
        rules.push({ selectors: prelude, selector: prelude.split("\n").pop()!.trim(), declarations: text.slice(index + 1, closing), media: media.replace(/^@media\s*/, "") });
        index = closing;
        start = closing + 1;
        continue;
      }
      preludes.push(prelude);
      start = index + 1;
    } else if (character === "}") {
      preludes.pop();
      start = index + 1;
    } else if (character === ";") start = index + 1;
  }
  return rules;
}

/** A list of selectors, split only at its own commas, past nested :is(), :not() and :has(). */
export function splitSelectors(selectors: string): string[] {
  const parts: string[] = [""];
  let depthNumber = 0;
  for (const letter of selectors) {
    if (letter === "(") depthNumber += 1;
    if (letter === ")") depthNumber -= 1;
    if (letter === "," && !depthNumber) parts.push("");
    else parts[parts.length - 1] += letter;
  }
  return parts.map((each) => each.trim());
}

/** A selector's subject: its last compound, never cut inside :is(), :not() or :has(). */
export const subjectOf = (selector: string) => selector.split(/[\s>+~]+(?![^(]*\))/).pop() ?? "";

/** The value a declaration of a property has in a rule's declarations, or undefined. */
export const valueOf = (declarations: string, property: string) => new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;}]+)`).exec(declarations)?.[1]?.trim();

/** A frame of an animation's keyframes: from, to or a percentage. */
const isKeyframe = (selector: string) => /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(selector);

/* ---------- Margins and gaps: every gap, padding and margin is a spacing token ---------- */

/** Whether a gap, padding or margin's value is the spacing tokens alone (0, auto, or the tokens in calc, times plain numbers). */
export const isSpacing = (value: string) => !/(\d|\.)(px|em|rem|vw|vh|%)/.test(value.replace(/var\(--(gap|pad)-[a-z-]+\)/g, ""));

/** Every gap, padding, margin and scroll padding in some declarations that's a number of its own, as "where | property: value", past those named. */
export function spacingProblems(where: string, declarations: string, named: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const [, property = "", value = ""] of declarations.matchAll(/(?:^|[;\s{])((?:row-|column-)?gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*|scroll-padding(?:-[a-z]+)*):\s*([^;}]+)/g)) {
    if (!isSpacing(value) && !named.has(`${where} | ${property}`)) problems.push(`${where} | ${property}: ${value.trim()}`);
  }
  return problems;
}

/* ---------- Flicker and flashes: no background fades on its own ---------- */

/** Every rule that fades a background color itself, which the browser draws on a layer it drops as the fade ends: a flash on glass. */
export function backgroundFadeProblems(rules: readonly StyleRule[]): string[] {
  return rules.flatMap((rule) => {
    const transition = valueOf(rule.declarations, "transition") ?? "";
    // The browser's own autofill color, held off on purpose.
    if (/autofill/.test(rule.selectors)) return [];
    return /(^|,\s*)background(-color)?\s/.test(transition) ? [`${rule.selectors.trim()}: transition: ${transition}`] : [];
  });
}

/* ---------- Corners and edges ---------- */

/** Cut corners, never rounded: every border-radius but 0, past the marks named with their reason ("selector"). */
export function roundedCornerProblems(rules: readonly StyleRule[], named: ReadonlyMap<string, string>): string[] {
  return rules.flatMap((rule) => {
    const radius = valueOf(rule.declarations, "border-radius");
    if (!radius || /^0(px)?$/.test(radius) || named.has(rule.selector)) return [];
    return [`${rule.selector}: border-radius: ${radius}`];
  });
}

/** Whether a box-shadow casts outside its box: any layer of it that isn't inset. */
const castsOutside = (shadow: string) => shadow !== "none" && splitSelectors(shadow).some((layer) => !/\binset\b/.test(layer) && !/^var\(/.test(layer) || /^var\(--[a-z-]*(cast|shadow|lift|float)[a-z-]*\)/.test(layer));

/**
 * A shadow takes its glass's cut: a box clipped to a shape (the edge rule's --cut-shape, a pane's --glass-clip, any clip-path) can't cast a
 * shadow outside it, since the clip cuts the shadow off square at its edge. Its shadow is cast by what holds it (a drop-shadow on the holder
 * follows the cut). Every rule that clips and casts a box-shadow outside fails, past those named ("selector").
 */
export function cutShadowProblems(rules: readonly StyleRule[], named: ReadonlyMap<string, string>): string[] {
  const clipped = new Set<string>();
  for (const rule of rules) {
    const clip = valueOf(rule.declarations, "clip-path");
    if (clip && !/^none\b/.test(clip)) for (const selector of splitSelectors(rule.selectors)) clipped.add(subjectOf(selector));
  }
  return rules.flatMap((rule) => {
    const shadow = valueOf(rule.declarations, "box-shadow");
    if (!shadow || !castsOutside(shadow) || named.has(rule.selector)) return [];
    const subjects = splitSelectors(rule.selectors).map(subjectOf);
    const ownClip = valueOf(rule.declarations, "clip-path");
    const isClipped = (ownClip && !/^none\b/.test(ownClip)) || subjects.some((subject) => clipped.has(subject));
    return isClipped ? [`${rule.selector}: box-shadow: ${shadow}`] : [];
  });
}

/* ---------- Pops: what a state changes animates ---------- */

/** States that change while a player watches: pointing, pressing, opening, closing, picking, folding and arriving. */
export const LIVE_STATE = /:hover|:active|\.is-pointed\b|\.is-pressed\b|\.over\b|\[open\]|:popover-open|\.is-open\b|\.shut\b|\[aria-(?:selected|pressed|expanded|checked)[^\]]*\]|:checked|\.is-shown\b|\.folded\b|\.is-folding\b/;
const SHOWN_PROPERTIES = ["opacity", "visibility", "transform", "translate", "scale", "filter", "backdrop-filter"] as const;

/** The plain classes of a subject, without its states: what the rule that times its changes names too. */
const plainClassesOf = (subject: string) => [...subject.replace(new RegExp(LIVE_STATE.source, "g"), "").matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1]!).filter((each) => !/^is-/.test(each));

/** Whether a transition's value moves a property: names it, all, or a timing token that names its own (var(--glass-transition)). */
const transitionMoves = (transition: string, property: string) => new RegExp(`(^|[\\s,])(${property}|all)\\b`).test(transition) || /var\(--[a-z-]*transition[a-z-]*\)/.test(transition);

/**
 * What a state shows, hides or moves, it animates: a rule in a live state (LIVE_STATE) that sets opacity, visibility, a transform, a filter or
 * a blur needs a transition that moves it on the same piece (a rule whose subject shares one of its plain classes, or itself), or an
 * animation of its own, so nothing appears or vanishes in one frame. Named ones ("selector | property") are left alone with their reason.
 */
export function statePopProblems(rules: readonly StyleRule[], named: ReadonlyMap<string, string>): string[] {
  const timings: { classes: string[]; transition: string }[] = [];
  for (const rule of rules) {
    // An animation on a piece's state times what it shows as much as a transition does (a picture arriving fades in by one).
    const transition = valueOf(rule.declarations, "transition") ?? valueOf(rule.declarations, "transition-property") ?? (valueOf(rule.declarations, "transition-duration") || valueOf(rule.declarations, "animation") ? "all" : undefined);
    if (!transition || transition === "none") continue;
    for (const selector of splitSelectors(rule.selectors)) timings.push({ classes: plainClassesOf(subjectOf(selector)), transition });
  }
  const problems: string[] = [];
  for (const rule of rules) {
    if (isKeyframe(rule.selector) || valueOf(rule.declarations, "animation")) continue;
    const selectors = splitSelectors(rule.selectors);
    for (const property of SHOWN_PROPERTIES) {
      const value = valueOf(rule.declarations, property);
      if (value === undefined || named.has(`${rule.selector} | ${property}`)) continue;
      // A rule that sets the same value at rest too changes nothing between states.
      const atRest = selectors.filter((selector) => !LIVE_STATE.test(selector)).flatMap((selector) => plainClassesOf(subjectOf(selector)));
      for (const selector of selectors) {
        if (plainClassesOf(subjectOf(selector)).some((each) => atRest.includes(each))) continue;
        const subject = subjectOf(selector);
        if (!LIVE_STATE.test(selector) || /::/.test(subject)) continue;
        const classes = plainClassesOf(subject);
        if (!classes.length) continue;
        const isTimed = timings.some((timing) => timing.classes.some((each) => classes.includes(each)) && transitionMoves(timing.transition, property));
        if (!isTimed) problems.push(`${selector} | ${property}: ${value}`);
      }
    }
  }
  return [...new Set(problems)];
}

/* ---------- Jitter: motion moves no layout ---------- */

const LAYOUT_PROPERTY = /^(width|height|min-width|max-width|min-height|max-height|top|left|right|bottom|inset(-[a-z-]+)?|margin(-[a-z-]+)?|padding(-[a-z-]+)?|gap|row-gap|column-gap|font-size|line-height|grid-template-(rows|columns)|flex-basis|all)$/;

/**
 * Motion moves only what doesn't lay the page out: a transition names transform, opacity, a filter, a color or the glass's own, never a size,
 * a place or a margin, which the browser lays out again every frame, so neighbors shift and settle late (most of all in Safari). The few that
 * must (the header slimming, a fold opening to its height) are named ("selector | property") with their reason.
 */
export function layoutTransitionProblems(rules: readonly StyleRule[], named: ReadonlyMap<string, string>): string[] {
  return rules.flatMap((rule) => {
    const transition = valueOf(rule.declarations, "transition") ?? valueOf(rule.declarations, "transition-property");
    if (!transition) return [];
    return splitSelectors(transition)
      .map((layer) => layer.split(/\s+/)[0] ?? "")
      .filter((property) => LAYOUT_PROPERTY.test(property) && !named.has(`${rule.selector} | ${property}`))
      .map((property) => `${rule.selector} | ${property}: transition: ${transition}`);
  });
}

/* ---------- Jitter: nothing bounces ---------- */

/**
 * Nothing bounces past its end: the page, every box that scrolls sideways, and every box that scrolls in a sheet or a floating pane stop at
 * their ends instead of stretching (overscroll-behavior: none), so a pane never rubber-bands under a finger. Answers what's missing.
 */
export function bounceProblems(rules: readonly StyleRule[]): string[] {
  const stops = (test: (rule: StyleRule) => boolean, property: string) => rules.some((rule) => test(rule) && valueOf(rule.declarations, property) === "none");
  const problems: string[] = [];
  if (!stops((rule) => rule.selector === "*", "overscroll-behavior-x") && !stops((rule) => rule.selector === "*", "overscroll-behavior")) problems.push("a box that scrolls sideways bounces: no * { overscroll-behavior-x: none }");
  if (!stops((rule) => /^html, body$/.test(rule.selector), "overscroll-behavior")) problems.push("the page bounces: no html, body { overscroll-behavior: none }");
  if (!stops((rule) => /^:is\(dialog, \[popover\]\)/.test(rule.selector) && /\.scrolls/.test(rule.selector), "overscroll-behavior-y")) problems.push("a box that scrolls in a sheet or a floating pane bounces: no :is(dialog, [popover]) .scrolls { overscroll-behavior-y: none }");
  return problems;
}

/* ---------- The turned phone and narrow screens: one set of named screens ---------- */

/** Whether a media query asks about the screen's size or shape (not hover, pointer, motion or theme alone). */
const asksScreen = (query: string) => /\b(min-|max-)?(width|height|aspect-ratio)\s*:|\borientation\s*:/.test(query);

/**
 * Every media query about the screen is one of the named screens (SCREEN_QUERIES in tokens.ts), spelled as it is there, so a phone on its
 * side gets what every other piece gives it and no piece invents a breakpoint of its own. Container queries go by a piece's own room and are
 * free.
 */
export function screenQueryProblems(rules: readonly StyleRule[], css: string, screens: Readonly<Record<string, string>>): string[] {
  const named = new Set(Object.values(screens));
  const queries = new Set<string>();
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@media\s*([^{]+)\{/g)) queries.add(match[1]!.trim());
  for (const rule of rules) if (rule.media) queries.add(rule.media.trim());
  return [...queries].filter((query) => asksScreen(query) && !named.has(query)).map((query) => `@media ${query}`);
}

/* ---------- Off-center: an icon is drawn in its box's middle ---------- */

/** The box a path's drawing covers, sampled along its curves and arcs. */
function pathPoints(path: string): [number, number][] {
  const tokens = path.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const next = () => parseFloat(tokens[index++]!);
  const flag = () => {
    // Arc flags may be written together ("0 1 1" or "011"): one digit each.
    const token = tokens[index]!;
    if (token.length > 1 && /^[01]/.test(token)) { tokens[index] = token.slice(1); return Number(token[0]); }
    index += 1;
    return Number(token);
  };
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index]!)) command = tokens[index++]!;
    const isRelative = command === command.toLowerCase();
    const kind = command.toUpperCase();
    if (kind === "Z") { x = startX; y = startY; continue; }
    if (kind === "M" || kind === "L" || kind === "T") {
      const [a, b] = [next(), next()];
      x = isRelative ? x + a : a; y = isRelative ? y + b : b;
      if (kind === "M") { startX = x; startY = y; command = isRelative ? "l" : "L"; }
      points.push([x, y]);
    } else if (kind === "H") { const a = next(); x = isRelative ? x + a : a; points.push([x, y]); }
    else if (kind === "V") { const a = next(); y = isRelative ? y + a : a; points.push([x, y]); }
    else if (kind === "C" || kind === "S" || kind === "Q") {
      const count = kind === "C" ? 3 : 2;
      const values = Array.from({ length: count * 2 }, next);
      const absolute = values.map((value, at) => (isRelative ? value + (at % 2 ? y : x) : value));
      const [x0, y0] = [x, y];
      const controls: [number, number][] = [[x0, y0]];
      if (kind === "S") controls.push([x0, y0]);
      for (let at = 0; at < absolute.length; at += 2) controls.push([absolute[at]!, absolute[at + 1]!]);
      // A Bézier curve, sampled (its control points lie outside its drawing).
      for (let step = 0; step <= 16; step += 1) {
        const t = step / 16;
        let layer = controls.map((point) => [...point] as [number, number]);
        while (layer.length > 1) layer = layer.slice(1).map((point, at) => [layer[at]![0] + (point[0] - layer[at]![0]) * t, layer[at]![1] + (point[1] - layer[at]![1]) * t] as [number, number]);
        points.push(layer[0]!);
      }
      [x, y] = controls[controls.length - 1]!;
    } else if (kind === "A") {
      let [rx, ry] = [Math.abs(next()), Math.abs(next())];
      const rotation = (next() * Math.PI) / 180;
      const [isLarge, isSweep] = [flag(), flag()];
      const [a, b] = [next(), next()];
      const [x0, y0] = [x, y];
      const [x1, y1] = [isRelative ? x + a : a, isRelative ? y + b : b];
      // The arc's center from its ends (SVG's implementation notes, F.6.5), then sampled along it.
      const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
      const [dx, dy] = [(x0 - x1) / 2, (y0 - y1) / 2];
      const [px, py] = [cos * dx + sin * dy, -sin * dx + cos * dy];
      const scale = (px * px) / (rx * rx) + (py * py) / (ry * ry);
      if (scale > 1) { rx *= Math.sqrt(scale); ry *= Math.sqrt(scale); }
      const sign = isLarge === isSweep ? -1 : 1;
      const factor = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px) / (rx * rx * py * py + ry * ry * px * px)));
      const [cxp, cyp] = [(factor * rx * py) / ry, (-factor * ry * px) / rx];
      const [cx, cy] = [cos * cxp - sin * cyp + (x0 + x1) / 2, sin * cxp + cos * cyp + (y0 + y1) / 2];
      const angle = (ux: number, uy: number) => Math.atan2(uy, ux);
      const start = angle((px - cxp) / rx, (py - cyp) / ry);
      let sweep = angle((-px - cxp) / rx, (-py - cyp) / ry) - start;
      if (isSweep && sweep < 0) sweep += 2 * Math.PI;
      if (!isSweep && sweep > 0) sweep -= 2 * Math.PI;
      for (let step = 0; step <= 32; step += 1) {
        const theta = start + (sweep * step) / 32;
        points.push([cx + rx * Math.cos(theta) * cos - ry * Math.sin(theta) * sin, cy + rx * Math.cos(theta) * sin + ry * Math.sin(theta) * cos]);
      }
      [x, y] = [x1, y1];
    } else index += 1;
  }
  return points;
}

/** How far an icon's drawing sits from its box's middle, across and down, in the units of its viewBox; null for one with no viewBox. */
export function iconOffsetOf(svg: string): { box: number[]; offsetX: number; offsetY: number } | null {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1]?.split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4) return null;
  const points: [number, number][] = [];
  for (const [, path = ""] of svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)) points.push(...pathPoints(path));
  const number = (tag: string, name: string) => Number(new RegExp(`\\s${name}="([^"]+)"`).exec(tag)?.[1] ?? 0);
  for (const [tag] of svg.matchAll(/<circle\b[^>]*>/g)) points.push([number(tag, "cx") - number(tag, "r"), number(tag, "cy") - number(tag, "r")], [number(tag, "cx") + number(tag, "r"), number(tag, "cy") + number(tag, "r")]);
  for (const [tag] of svg.matchAll(/<ellipse\b[^>]*>/g)) points.push([number(tag, "cx") - number(tag, "rx"), number(tag, "cy") - number(tag, "ry")], [number(tag, "cx") + number(tag, "rx"), number(tag, "cy") + number(tag, "ry")]);
  for (const [, list = ""] of svg.matchAll(/<poly(?:line|gon)\b[^>]*\spoints="([^"]+)"/g)) {
    const values = list.trim().split(/[\s,]+/).map(Number);
    for (let at = 0; at + 1 < values.length; at += 2) points.push([values[at]!, values[at + 1]!]);
  }
  for (const [tag] of svg.matchAll(/<rect\b[^>]*>/g)) points.push([number(tag, "x"), number(tag, "y")], [number(tag, "x") + number(tag, "width"), number(tag, "y") + number(tag, "height")]);
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/g)) points.push([number(tag, "x1"), number(tag, "y1")], [number(tag, "x2"), number(tag, "y2")]);
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const [left, top, width, height] = viewBox as [number, number, number, number];
  return { box: viewBox, offsetX: (Math.min(...xs) + Math.max(...xs)) / 2 - (left + width / 2), offsetY: (Math.min(...ys) + Math.max(...ys)) / 2 - (top + height / 2) };
}

/** How far off its box's middle an icon's drawing may sit: 1.5% of its box, under a third of a pixel at 18px. */
export const ICON_OFF_CENTER_SHARE = 0.015;

/**
 * An icon is drawn in its box's middle, so a control that centers its box centers what shows: every icon's drawing is within
 * ICON_OFF_CENTER_SHARE of its viewBox's middle both ways, past those named with their reason (an icon a set lines up with its siblings).
 * An icon's box is moved by its viewBox, never by a nudge where it's used.
 */
export function iconCenterProblems(icons: Readonly<Record<string, string>>, named: ReadonlyMap<string, string>): string[] {
  return Object.entries(icons).flatMap(([name, svg]) => {
    if (named.has(name)) return [];
    const offset = iconOffsetOf(svg);
    if (!offset) return [];
    const [, , width, height] = offset.box as [number, number, number, number];
    const isOff = Math.abs(offset.offsetX) > width * ICON_OFF_CENTER_SHARE || Math.abs(offset.offsetY) > height * ICON_OFF_CENTER_SHARE;
    return isOff ? [`${name}: drawn ${offset.offsetX.toFixed(2)} across and ${offset.offsetY.toFixed(2)} down from its box's middle`] : [];
  });
}
